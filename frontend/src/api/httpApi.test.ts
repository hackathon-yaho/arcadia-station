import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpApi } from "./httpApi";
import { ArcadiaApiError, isSessionLost } from "./errors";
import type { TheoryDraft } from "../store/gameStore";

type FetchCall = { url: string; method: string; body: unknown };

type StubResponse = { status?: number; body: unknown };

let calls: FetchCall[] = [];
let respond: (url: string, method: string) => StubResponse;

function envelope(data: unknown): StubResponse {
  return { body: { success: true, message: null, data } };
}

function lastCallTo(fragment: string): FetchCall | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment));
}

function firstCallTo(fragment: string): FetchCall | undefined {
  return calls.find((call) => call.url.includes(fragment));
}

/** 직렬 큐에 쌓인 배경 작업이 모두 끝날 때까지 기다린다. */
const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls = [];
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
  // delay()가 쓰는 window.setTimeout. 가짜 타이머가 적용되도록 호출 시점에 조회한다.
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
  });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const stub = respond(String(url), method);
    const status = stub.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => stub.body,
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createSession", () => {
  it("사건 생성이 끝날 때까지 상태를 폴링하고 봉투를 벗겨 반환한다", async () => {
    vi.useFakeTimers();
    let polls = 0;
    respond = (url) => {
      if (url.endsWith("/status")) {
        polls += 1;
        return envelope({ sessionId: "game_1", status: polls === 1 ? "VALIDATING" : "BRIEFING" });
      }
      return envelope({ sessionId: "game_1", status: "CREATING" });
    };

    const pending = httpApi.createSession();
    await vi.advanceTimersByTimeAsync(6_000);
    const session = await pending;

    expect(session.sessionId).toBe("game_1");
    expect(session.status).toBe("READY");
    expect(polls).toBe(2);
    expect(calls[0]).toMatchObject({ url: "/api/v1/sessions", method: "POST" });
  });

  it("사건 생성이 실패하면 재시도 가능한 오류를 던진다", async () => {
    respond = () => envelope({ sessionId: "game_fail", status: "FAILED" });

    await expect(httpApi.createSession()).rejects.toMatchObject({
      code: "AI_CASE_GENERATION_FAILED",
      retryable: true,
    });
  });
});

describe("inspectObject", () => {
  it("오브젝트를 정식 장소로 옮겨 탐사하고 해금 단서를 원장에 연결한다", async () => {
    respond = (url) => {
      if (url.endsWith("/explore")) {
        return envelope([
          {
            clueId: "CLUE-SETUP-LOG",
            title: "의료 안전 점검 예약 기록",
            clueType: "DIGITAL",
            playerText: "...",
          },
        ]);
      }
      return envelope(null);
    };

    const result = await httpApi.inspectObject("game_2", "MD_MEDICAL_STORAGE");

    expect(firstCallTo("/explore")).toMatchObject({
      method: "POST",
      body: { locationId: "MEDICAL_BAY", objectHint: "MD_MEDICAL_STORAGE" },
    });
    // 수첩이 표시할 증거는 전부 서버 단서다. 문맥 필드가 빠진 응답(구형 백엔드)이 와도
    // 화면이 깨지지 않도록 빈 값으로 채워야 한다.
    expect(result.discoveredEvidence).toEqual([
      {
        clueId: "CLUE-SETUP-LOG",
        title: "의료 안전 점검 예약 기록",
        clueType: "DIGITAL",
        playerText: "...",
        sourceObjectId: "MD_MEDICAL_STORAGE",
        isCore: false,
        revealedFacts: [],
        linkedClueIds: [],
        hasPendingConnection: false,
      },
    ]);
  });

  it("서버가 준 단서 문맥을 그대로 수첩으로 넘긴다", async () => {
    respond = (path) => {
      if (path.includes("/explore") && path.includes("game_ctx")) {
        return envelope([
          {
            clueId: "CLUE-SETUP-LOG",
            title: "의료 안전 점검 예약 기록",
            clueType: "DIGITAL",
            playerText: "...",
            isCore: true,
            revealedFacts: [{ factId: "FACT-SETUP", statement: "소피아가 점검을 예약했다." }],
            linkedClueIds: ["CLUE-ACCESS-HISTORY"],
            suspectEffects: [{ characterId: "SOPHIA", effect: "SUPPORTS" }],
            hasPendingConnection: true,
          },
        ]);
      }
      return envelope(null);
    };

    const result = await httpApi.inspectObject("game_ctx", "MD_MEDICAL_STORAGE");

    expect(result.discoveredEvidence[0]).toMatchObject({
      isCore: true,
      revealedFacts: [{ factId: "FACT-SETUP", statement: "소피아가 점검을 예약했다." }],
      linkedClueIds: ["CLUE-ACCESS-HISTORY"],
      hasPendingConnection: true,
    });
  });

  // 배제 판정이 이 값을 그대로 정답으로 쓴다. 화면까지 흘러가면 최종 추리가 받아쓰기가 된다.
  it("서버가 준 용의자 영향은 수첩으로 넘기지 않는다", async () => {
    respond = (path) => {
      if (path.includes("/explore")) {
        return envelope([
          {
            clueId: "CLUE-ALIBI",
            title: "의무실 출입 기록",
            clueType: "DIGITAL",
            playerText: "...",
            suspectEffects: [{ characterId: "MAYA", effect: "EXCLUDES" }],
          },
        ]);
      }
      return envelope(null);
    };

    const result = await httpApi.inspectObject("game_effect", "MD_MEDICAL_STORAGE");

    expect(result.discoveredEvidence[0]).not.toHaveProperty("suspectEffects");
  });

  it("조사는 탐사만 하고 사건기록 검색은 건드리지 않는다", async () => {
    respond = () => envelope([]);

    await httpApi.inspectObject("game_3", "EN_LIFE_SUPPORT");
    await flushBackground();

    expect(firstCallTo("/explore")?.body).toMatchObject({ locationId: "ENGINEERING_BAY" });
    // 같은 방을 가리키는 구형 ID까지 함께 조회한다.
    expect(lastCallTo("/explore")?.body).toMatchObject({ locationId: "LIFE_SUPPORT_CORRIDOR" });
    // 검색은 수사 보조 탭 전용이다. 조사가 몰래 질의를 날리면 화면과 수첩이 어긋난다.
    expect(lastCallTo("/assistant/queries")).toBeUndefined();
  });

  it("다시 조사하면 그 방을 한 번 더 탐사한다", async () => {
    respond = () => envelope([]);

    await httpApi.inspectObject("game_3b", "MD_MEDICAL_STORAGE");
    const first = calls.filter((call) => call.url.endsWith("/explore")).length;
    await httpApi.inspectObject("game_3b", "MD_MEDICAL_STORAGE");
    const second = calls.filter((call) => call.url.endsWith("/explore")).length;

    expect(second).toBeGreaterThan(first);
  });
});

describe("세션 직렬 큐", () => {
  it("상태를 바꾸는 요청을 겹치지 않게 하나씩 보낸다", async () => {
    // 백엔드가 세션 인벤토리를 읽고 다시 쓰기 때문에 요청이 겹치면 해금이 사라진다.
    let inFlight = 0;
    let maxInFlight = 0;
    const release: (() => void)[] = [];

    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight -= 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, message: null, data: [] }),
      } as Response;
    });

    const pending = [
      httpApi.inspectObject("game_queue", "CO_BODY"),
      httpApi.inspectObject("game_queue", "MD_MEDICAL_STORAGE"),
      httpApi.inspectObject("game_queue", "CG_CARGO_MANIFEST"),
    ];

    // 큐가 하나씩만 내보내는지 확인하면서 순서대로 응답을 풀어 준다.
    for (let i = 0; i < 12; i += 1) {
      await flushBackground();
      release.shift()?.();
    }
    await Promise.all(pending);

    expect(maxInFlight).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe("sendInterrogationMessage", () => {
  it("선택지 문구를 질문으로 보내고 NPC 접두사를 인물 ID로 바꾼다", async () => {
    respond = () =>
      envelope({
        dialogue: "그 시간엔 엔지니어링에 있었습니다.",
        emotion: "DEFENSIVE",
        revealedFactIds: ["FACT-TRIGGER"],
        recommendedQuestions: [],
      });

    const message = await httpApi.sendInterrogationMessage("game_4::JUNHO", {
      npcId: "NPC_JUNHO",
      choiceId: "whereabouts",
    });

    const call = lastCallTo("/interrogations");
    expect(call?.url).toBe("/api/v1/sessions/game_4/interrogations/JUNHO/turns");
    expect(call?.body).toMatchObject({
      question: "D-0 야간에는 어디에 있었습니까?",
      presentedClueIds: [],
    });
    expect(message.response).toBe("그 시간엔 엔지니어링에 있었습니다.");
  });

  it("서버가 해금을 확인한 단서만 증거로 제시한다", async () => {
    respond = (url) => {
      if (url.endsWith("/explore")) {
        return envelope([
          { clueId: "CLUE-ACCESS-HISTORY", title: "접근 이력", clueType: "OPPORTUNITY", playerText: "..." },
        ]);
      }
      return envelope({
        dialogue: "확인했습니다.",
        emotion: "CALM",
        revealedFactIds: [],
        recommendedQuestions: [],
      });
    };

    await httpApi.inspectObject("game_5", "CG_CARGO_MANIFEST");
    await flushBackground();

    // 서버가 해금해 준 단서는 그대로 제시하고, 질문 문구에도 단서 제목을 쓴다.
    await httpApi.sendInterrogationMessage("game_5::YUNA", {
      npcId: "NPC_YUNA",
      evidenceId: "CLUE-ACCESS-HISTORY",
    });
    expect(lastCallTo("/interrogations")?.body).toMatchObject({
      presentedClueIds: ["CLUE-ACCESS-HISTORY"],
      question: "접근 이력 기록을 제시합니다. 이에 대해 설명해 주십시오.",
    });

    // 해금된 적 없는 단서는 빈 배열로 보내 400을 피한다.
    await httpApi.sendInterrogationMessage("game_5::YUNA", {
      npcId: "NPC_YUNA",
      evidenceId: "CLUE-NEVER-FOUND",
    });
    expect(lastCallTo("/interrogations")?.body).toMatchObject({ presentedClueIds: [] });
  });
});

describe("submitVerdict", () => {
  // 이론의 증거 필드는 서버 단서 ID다.
  const theory: TheoryDraft = {
    suspectId: "SOPHIA",
    setup: "CLUE-SETUP-LOG",
    trigger: "CLUE-TRIGGER-LOG",
    opportunity: "CLUE-ACCESS-HISTORY",
    motive: "CLUE-MOTIVE-MESSAGE",
    exclusions: {},
  };

  const discoveredClues = [
    { clueId: "CLUE-SETUP-LOG", title: "예약 기록", clueType: "DIGITAL", playerText: "..." },
    { clueId: "CLUE-TRIGGER-LOG", title: "감사 로그", clueType: "DIGITAL", playerText: "..." },
    { clueId: "CLUE-ACCESS-HISTORY", title: "접근 이력", clueType: "OPPORTUNITY", playerText: "..." },
    { clueId: "CLUE-MOTIVE-MESSAGE", title: "동기 메시지", clueType: "MOTIVE", playerText: "..." },
  ];

  it("세 축 이론을 네 역할로 펴서 제출하고 정답을 범인 추방 엔딩으로 옮긴다", async () => {
    respond = (url, method) => {
      if (url.endsWith("/explore")) return envelope([]);
      if (url.endsWith("/deductions") && method === "POST") {
        return envelope({
          verdict: "CORRECT",
          culpritCorrect: true,
          roleResults: {
            SETUP: "CORRECT",
            TRIGGER: "CORRECT",
            OPPORTUNITY: "CORRECT",
            MOTIVE: "CORRECT",
          },
          remainingAttempts: 3,
          feedback: "정확한 추리입니다.",
        });
      }
      return envelope({
        sessionId: "game_6",
        status: "INVESTIGATION",
        title: "사건",
        briefing: "브리핑",
        discoveredClues,
        suspectCharacterIds: ["SOPHIA"],
        exploreLocationIds: [],
      });
    };

    const result = await httpApi.submitVerdict("game_6", theory);

    const submitted = lastCallTo("/deductions")?.body as {
      culpritId: string;
      evidenceByRole: Record<string, string>;
    };
    expect(submitted.culpritId).toBe("SOPHIA");
    // 이론 4축이 백엔드 4역할과 1:1로 대응한다.
    expect(submitted.evidenceByRole).toEqual({
      SETUP: "CLUE-SETUP-LOG",
      TRIGGER: "CLUE-TRIGGER-LOG",
      OPPORTUNITY: "CLUE-ACCESS-HISTORY",
      MOTIVE: "CLUE-MOTIVE-MESSAGE",
    });
    // 발견 단서만 제출한다.
    for (const clueId of Object.values(submitted.evidenceByRole)) {
      expect(discoveredClues.map((clue) => clue.clueId)).toContain(clueId);
    }

    expect(result).toMatchObject({
      accusedId: "SOPHIA",
      ending: "CULPRIT_EXPELLED",
      correctAccusation: true,
    });
  });

  it("범인은 맞고 증거가 틀리면 범인 생존 엔딩으로 옮긴다", async () => {
    respond = (url, method) => {
      if (url.endsWith("/explore")) return envelope([]);
      if (url.endsWith("/deductions") && method === "POST") {
        return envelope({
          verdict: "PARTIAL",
          culpritCorrect: true,
          roleResults: {
            SETUP: "CORRECT",
            TRIGGER: "CORRECT",
            OPPORTUNITY: "INCORRECT",
            MOTIVE: "CORRECT",
          },
          remainingAttempts: 2,
          feedback: "기회와 권한 증거를 다시 확인하십시오.",
        });
      }
      return envelope({
        sessionId: "game_7",
        status: "INVESTIGATION",
        title: "사건",
        briefing: "브리핑",
        discoveredClues,
        suspectCharacterIds: ["SOPHIA"],
        exploreLocationIds: [],
      });
    };

    await expect(httpApi.submitVerdict("game_7", theory)).resolves.toMatchObject({
      ending: "CULPRIT_SURVIVED",
      correctAccusation: true,
    });
  });

  it("서버가 해금하지 않은 단서는 제출하지 않고 안내 오류를 던진다", async () => {
    respond = (url) => {
      if (url.endsWith("/explore")) return envelope([]);
      return envelope({
        sessionId: "game_8",
        status: "INVESTIGATION",
        title: "사건",
        briefing: "브리핑",
        discoveredClues: [],
        suspectCharacterIds: ["SOPHIA"],
        exploreLocationIds: [],
      });
    };

    await expect(httpApi.submitVerdict("game_8", theory)).rejects.toBeInstanceOf(ArcadiaApiError);
    expect(lastCallTo("/deductions")).toBeUndefined();
  });
});

describe("오류 정규화", () => {
  it("409는 재시도 불가 세션 상태 오류로 옮긴다", async () => {
    respond = () => ({
      status: 409,
      body: { success: false, message: "이미 종료된 세션입니다.", data: null },
    });

    await expect(httpApi.inspectObject("game_9", "CO_BODY")).rejects.toMatchObject({
      code: "INVALID_SESSION_STATE",
      message: "이미 종료된 세션입니다.",
      retryable: false,
    });
  });

  it("5xx는 재시도 가능한 오류로 옮긴다", async () => {
    respond = () => ({
      status: 500,
      body: { success: false, message: "서버 오류가 발생했습니다.", data: null },
    });

    await expect(httpApi.inspectObject("game_10", "CO_BODY")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      retryable: true,
    });
  });

  // 복구 화면은 이 판정 하나로 세션을 버릴지 정한다. 전송 계층과 어긋나면 안 된다.
  it("사라진 세션 조회는 세션 소실로 판정된다", async () => {
    respond = () => ({
      status: 404,
      body: { success: false, message: "세션을 찾을 수 없습니다.", data: null },
    });

    const error = await httpApi.fetchCaseState("game_gone").catch((caught) => caught);
    expect(isSessionLost(error)).toBe(true);
  });

  it("서버 오류나 통신 실패는 세션 소실로 판정하지 않는다", async () => {
    respond = () => ({
      status: 503,
      body: { success: false, message: "잠시 후 다시 시도해주세요.", data: null },
    });

    const serverError = await httpApi.fetchCaseState("game_11").catch((caught) => caught);
    expect(isSessionLost(serverError)).toBe(false);

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const networkError = await httpApi.fetchCaseState("game_11").catch((caught) => caught);
    expect(networkError).toMatchObject({ code: "NETWORK_ERROR", retryable: true });
    expect(isSessionLost(networkError)).toBe(false);
  });
});

describe("askAssistant", () => {
  it("백엔드 필드를 수사 보조 화면 계약으로 옮긴다", async () => {
    respond = () =>
      envelope({
        answer: "02:05 생명 유지 시스템에서 의료 안전 진단이 실행됐다.",
        citedRecordIds: ["RECORD-TRIGGER"],
        suggestedQueries: ["다른 시각의 기록도 보여줘", "다른 인물 관련 기록을 보여줘"],
        newlyDiscoveredClues: [
          { clueId: "CLUE-TRIGGER-LOG", title: "02:05 감사 로그", clueType: "DIGITAL", playerText: "..." },
        ],
      });

    const response = await httpApi.askAssistant("game_11", "02:05 기록을 보여줘", []);

    expect(response.summary).toBe("02:05 생명 유지 시스템에서 의료 안전 진단이 실행됐다.");
    expect(response.suggestedQuery).toBe("다른 시각의 기록도 보여줘");
    // 수첩이 렌더링할 수 있는 서버 단서 ID만 인용한다.
    expect(response.citations).toEqual(["CLUE-TRIGGER-LOG"]);
    expect(response.observation).toContain("02:05 감사 로그");
    expect(response.fallback).toBe(false);
  });

  it("빈 질문은 요청하지 않는다", async () => {
    respond = () => envelope(null);

    await expect(httpApi.askAssistant("game_12", "   ")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(calls).toHaveLength(0);
  });
});
