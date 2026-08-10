import type {
  AssistantResponse,
  CaseStateResponse,
  CompleteDayResponse,
  DiscoveredEvidence,
  FinalReveal,
  InspectObjectResponse,
  InterrogationInput,
  InterrogationMessage,
  InterrogationSession,
  SaveTheoryRequest,
  SessionDto,
  SessionPrepProgress,
  TrialVerdictResponse,
} from "./contracts";
import { INVESTIGATION_OBJECTS, NPC_DIALOGUE, SUSPECTS } from "../data/investigation";
import {
  resolveMockJudgement,
  resolveMockTrial,
  type MockCaseId,
} from "../data/mockVerdict";
import type { TheoryDraft } from "../store/gameStore";
import { ArcadiaApiError } from "./errors";
import { httpApi } from "./httpApi";

export { ArcadiaApiError };

const API_MODE = import.meta.env.VITE_API_MODE ?? "mock";

const mockDelay = (ms = 420) => new Promise((resolve) => window.setTimeout(resolve, ms));
const shouldFail = (target: string) =>
  new URLSearchParams(location.search).get("mockError") === target;
const getMockCase = (): MockCaseId => {
  const requested = new URLSearchParams(location.search).get("mockCase")?.toUpperCase();
  return requested === "MAYA" ||
    requested === "JUNHO" ||
    requested === "SOPHIA" ||
    requested === "KASIM" ||
    requested === "YUNA"
    ? requested
    : "JUNHO";
};
const mockDiscoveredEvidence = new Map<string, DiscoveredEvidence[]>();
/** 세션별 오답 횟수. 백엔드가 인벤토리에 들고 있는 값을 mock에서 대신 센다. */
const mockWrongAttempts = new Map<string, number>();

/**
 * mock 모드용 단서. HTTP 모드와 같은 모양의 서버 단서를 정적 조사 데이터에서 만들어,
 * UI가 두 모드에서 동일한 지식 계층을 보게 한다.
 */
const MOCK_CLUE_PREFIX = "MOCK-";

/**
 * mock 사건 해설. 실제 서버는 세션마다 다른 사건을 돌려주므로 이 내용은 개발용 표본이다.
 * 화면이 비지 않도록 실제 응답과 같은 모양을 갖춘다.
 */
const MOCK_FINAL_REVEAL: FinalReveal = {
  culpritId: "JUNHO",
  truthSummary:
    "백준호는 사령관실 환경 제어를 정비 우회로 조작해 산소 분압을 낮췄다. 감사 보고서가 공개되면 예산 유용이 드러날 상황이었다.",
  methodSummary:
    "정비 권한으로 로컬 환경 패널의 안전 한계를 미리 풀어 두고, 야간 진단 주기에 맞춰 실행되도록 예약했다.",
  victimCondition: "피해자는 감사 초안을 확인하던 중 환경 패널 앞에서 의식을 잃었다.",
  timeline: [
    {
      eventId: "EVT-001",
      time: "01:40",
      actorIds: ["JUNHO"],
      locationId: "ENGINEERING_BAY",
      summary: "정비 단말에서 사령관실 환경 안전 한계를 해제했다.",
    },
    {
      eventId: "EVT-002",
      time: "02:05",
      actorIds: ["JUNHO"],
      locationId: "CENTRAL_HUB",
      summary: "예약된 진단 작업이 실행되며 산소 분압이 떨어지기 시작했다.",
    },
    {
      eventId: "EVT-003",
      time: "02:40",
      actorIds: ["DANIEL"],
      locationId: "COMMANDER_OFFICE",
      summary: "사령관이 환경 패널 앞에서 쓰러졌다.",
    },
    {
      eventId: "EVT-004",
      time: "07:20",
      actorIds: ["MAYA"],
      locationId: "COMMANDER_OFFICE",
      summary: "정기 보고를 위해 들어온 부사령관이 시신을 발견했다.",
    },
  ],
  alibis: [
    {
      characterId: "JUNHO",
      initialClaim: "엔지니어링에서 태양풍 부하를 감시했다.",
      actualWhereabouts: "ENGINEERING_BAY",
      contradictions: ["02:05 정비 인증으로 환경 진단이 실행됐다."],
    },
    {
      characterId: "MAYA",
      initialClaim: "개인실에서 대기했다.",
      actualWhereabouts: "PERSONAL_QUARTERS",
      contradictions: [],
    },
  ],
  requiredEvidenceByRole: {
    SETUP: ["MOCK-CO_ENV_PANEL"],
    TRIGGER: ["MOCK-EN_LIFE_SUPPORT"],
    OPPORTUNITY: ["MOCK-CO_DOOR_LOG"],
    MOTIVE: ["MOCK-CO_TERMINAL"],
  },
  exclusions: [
    { characterId: "MAYA", reason: "직통 통로 출입 기록이 없다." },
    { characterId: "SOPHIA", reason: "환경 제어 권한이 없다." },
  ],
  resolvedByPlayer: true,
};

/** mock 심문이 돌려주는 후속 질문. 실제 백엔드의 `recommendedQuestions`와 같은 모양이다. */
const MOCK_RECOMMENDED_QUESTIONS = [
  { topicId: "TOPIC-WHEREABOUTS", label: "그 시간에 어느 구역에 있었습니까?" },
  { topicId: "TOPIC-ACCESS", label: "사령관실 접근 권한은 누구에게 있었습니까?" },
  { topicId: "TOPIC-LAST-CONTACT", label: "사령관과 마지막으로 나눈 대화는 무엇이었습니까?" },
];

function mockEvidenceFor(objectId: string): DiscoveredEvidence | null {
  const object = INVESTIGATION_OBJECTS[objectId];
  if (!object || object.kind === "PERSON") return null;
  // 문맥 필드도 실제 응답과 같은 모양으로 채운다. 오브젝트 ID를 씨앗으로 삼아 세션마다
  // 같은 결과가 나오게 하고, 연결과 미해결 표시가 화면에서 실제로 보이도록 섞는다.
  const seed = objectId.length;
  return {
    clueId: `${MOCK_CLUE_PREFIX}${objectId}`,
    title: object.evidenceLabel,
    clueType: object.kind === "WORLD" ? "OPPORTUNITY" : object.kind,
    playerText: object.detail,
    sourceObjectId: objectId,
    isCore: seed % 2 === 0,
    revealedFacts: [
      { factId: `FACT-${objectId}`, statement: `${object.evidenceLabel}에 해당하는 기록이 남아 있다.` },
    ],
    linkedClueIds: [],
    hasPendingConnection: seed % 4 === 0,
  };
}

/**
 * mock 연결 관계.
 *
 * 실제 서버는 같은 사실을 가리키는 단서끼리 이어 준다. mock에는 사실 그래프가 없어 같은 종류의
 * 기록끼리 묶는다. 연결 표시가 화면에서 실제로 보이는지 확인하는 용도다.
 */
function withMockLinks(all: DiscoveredEvidence[]): DiscoveredEvidence[] {
  return all.map((record) => ({
    ...record,
    linkedClueIds: all
      .filter((other) => other.clueId !== record.clueId && other.clueType === record.clueType)
      .map((other) => other.clueId),
  }));
}

export type ArcadiaApi = {
  /** `onProgress`는 사건 생성 단계가 바뀔 때마다 호출된다. 로딩 화면 문구의 근거다. */
  createSession: (onProgress?: SessionPrepProgress) => Promise<SessionDto>;
  completeOpening: (sessionId: string) => Promise<SessionDto>;
  /** 사건 개요와 지금까지 확보한 단서 전체. 새로고침 복구와 진행 중 동기화에 쓴다. */
  fetchCaseState: (sessionId: string) => Promise<CaseStateResponse>;
  inspectObject: (sessionId: string, objectId: string) => Promise<InspectObjectResponse>;
  startInterrogation: (sessionId: string, npcId: string) => Promise<InterrogationSession>;
  sendInterrogationMessage: (
    interrogationId: string,
    input: InterrogationInput,
  ) => Promise<InterrogationMessage>;
  completeDay: (sessionId: string, day: 1 | 2) => Promise<CompleteDayResponse>;
  askAssistant: (
    sessionId: string,
    query: string,
    discoveredEvidenceIds?: string[],
  ) => Promise<AssistantResponse>;
  saveTheory: (sessionId: string, requestBody: SaveTheoryRequest) => Promise<{ version: number }>;
  submitVerdict: (sessionId: string, theory: TheoryDraft) => Promise<TrialVerdictResponse>;
  /** 재판이 끝난 뒤에만 열린다. 정답이든 오답 소진이든 사건의 전모를 돌려준다. */
  fetchFinalReveal: (sessionId: string) => Promise<FinalReveal>;
};

const mockApi: ArcadiaApi = {
  async createSession(onProgress): Promise<SessionDto> {
    // 실제 AI 사건 생성은 수십 초가 걸린다. mock은 빨라야 개발이 편하지만 그러면 생성 대기
    // 화면을 볼 수가 없어서, `?mockSlowCase=1`로 실제에 가까운 길이를 재현할 수 있게 둔다.
    const stageMs = new URLSearchParams(location.search).has("mockSlowCase") ? 6_000 : 420;
    onProgress?.("CREATING");
    await mockDelay(stageMs);
    if (shouldFail("session")) {
      throw new ArcadiaApiError("격리 서버와 보안 채널을 열지 못했습니다.", "MOCK_OFFLINE", true);
    }
    onProgress?.("VALIDATING");
    await mockDelay(stageMs);
    onProgress?.("READY");
    const sessionId = `LOCAL-${crypto.randomUUID()}`;
    mockDiscoveredEvidence.set(sessionId, []);
    return {
      sessionId,
      status: "READY",
      day: 1,
      version: 1,
    };
  },
  async completeOpening(sessionId: string): Promise<SessionDto> {
    await mockDelay(160);
    return {
      sessionId,
      status: "IN_PROGRESS",
      day: 1,
      version: 2,
    };
  },
  async fetchCaseState(sessionId: string): Promise<CaseStateResponse> {
    await mockDelay(120);
    return {
      title: "아르카디아 스테이션 사건",
      briefing:
        "태양풍 격리 중 사령관 다니엘 로스가 사망했다. 외부 통신은 두절됐고 정거장에 남은 인원은 여섯 명이다.",
      suspectIds: SUSPECTS.map((suspect) => suspect.id),
      evidence: withMockLinks(mockDiscoveredEvidence.get(sessionId) ?? []),
    };
  },
  async inspectObject(sessionId: string, objectId: string): Promise<InspectObjectResponse> {
    await mockDelay(180);
    if (shouldFail("inspect")) {
      throw new ArcadiaApiError("증거 기록 장치가 응답하지 않습니다.", "MOCK_INSPECT_TIMEOUT", true);
    }
    const found = mockEvidenceFor(objectId);
    const discovered = mockDiscoveredEvidence.get(sessionId) ?? [];
    const isNew = Boolean(found) && !discovered.some((item) => item.clueId === found?.clueId);
    if (found && isNew) {
      discovered.push(found);
      mockDiscoveredEvidence.set(sessionId, discovered);
    }
    return {
      objectId,
      discoveredEvidence:
        found && isNew
          ? withMockLinks(discovered).filter((record) => record.clueId === found.clueId)
          : [],
      version: 2,
    };
  },
  async startInterrogation(
    _sessionId: string,
    npcId: string,
  ): Promise<InterrogationSession> {
    await mockDelay(220);
    if (shouldFail("interrogation")) {
      throw new ArcadiaApiError("심문 채널의 음성 동기화에 실패했습니다.", "MOCK_CHANNEL_LOST", true);
    }
    return {
      interrogationId: `LOCAL-INT-${npcId}`,
      npcId,
      opening: NPC_DIALOGUE[npcId]?.opening ?? "응답이 없습니다.",
      version: 2,
    };
  },
  async sendInterrogationMessage(
    interrogationId: string,
    input: InterrogationInput,
  ): Promise<InterrogationMessage> {
    await mockDelay(360);
    if (shouldFail("interrogation")) {
      throw new ArcadiaApiError("심문 채널이 끊어졌습니다.", "MOCK_CHANNEL_LOST", true);
    }
    const dialogue = NPC_DIALOGUE[input.npcId];
    const choiceResponse = dialogue?.choices.find((choice) => choice.id === input.choiceId)?.response;
    const sessionId = interrogationId.replace(/^LOCAL-INT-/, "");
    const evidenceTitle =
      mockDiscoveredEvidence
        .get(sessionId)
        ?.find((item) => item.clueId === input.evidenceId)?.title ??
      (input.evidenceId ? input.evidenceId.replace(MOCK_CLUE_PREFIX, "").replaceAll("_", " ") : null);
    const freeQuestionResponse = input.query
      ? `“${input.query}”에 대한 제 답은 같습니다. 추측이 아니라 당시 보안 기록과 제 동선으로 판단해 주십시오.`
      : null;
    return {
      interrogationId,
      npcId: input.npcId,
      response:
        choiceResponse ??
        (evidenceTitle
          ? `그 기록은 확인했습니다. 하지만 ${evidenceTitle}만으로 제 행동과 사망을 직접 연결할 수는 없습니다.`
          : freeQuestionResponse ?? "답변할 수 없습니다."),
      revealedEvidenceIds: [],
      // 실제 백엔드는 방금 답변에 이어지는 질문을 돌려준다. mock도 같은 자리를 채워
      // 이어서 질문 목록이 정적 질문에서 서버 제안으로 바뀌는 흐름을 그대로 재현한다.
      recommendedQuestions: MOCK_RECOMMENDED_QUESTIONS,
      version: 3,
    };
  },
  async completeDay(_sessionId: string, day: 1 | 2): Promise<CompleteDayResponse> {
    await mockDelay(300);
    if (shouldFail("day")) {
      throw new ArcadiaApiError("일일 조사 기록을 봉인하지 못했습니다.", "MOCK_SAVE_FAILED", true);
    }
    return { completedDay: day, nextDay: day === 1 ? 2 : 3, version: 4 };
  },
  async askAssistant(
    sessionId: string,
    query: string,
    discoveredEvidenceIds = [],
  ): Promise<AssistantResponse> {
    await mockDelay(520);
    if (shouldFail("assistant")) {
      throw new ArcadiaApiError("수사 보조 연산이 지연되고 있습니다.", "MOCK_AI_TIMEOUT", true);
    }
    const known = mockDiscoveredEvidence.get(sessionId) ?? [];
    const knownIds = new Set([...known.map((item) => item.clueId), ...discoveredEvidenceIds]);
    const citations = [...knownIds].slice(-3);
    if (citations.length === 0) {
      return {
        summary: "현재 검색할 수 있는 현장 기록이 없습니다.",
        citations: [],
        observation: "먼저 현장 오브젝트를 조사해 로컬 보안 기록에 등록하십시오.",
        suggestedQuery: null,
        fallback: false,
      };
    }
    const labels = citations
      .map((id) => known.find((item) => item.clueId === id)?.title)
      .filter(Boolean)
      .join(", ");
    return {
      summary: `“${query}”와 관련해 현재 공개된 기록 ${citations.length}건을 비교했습니다.`,
      citations,
      observation: `${labels} 사이의 시간·접근 권한·물리 흔적을 함께 검토해야 합니다.`,
      suggestedQuery: "이 기록들 사이에서 시간대가 일치하지 않는 항목은?",
      fallback: false,
    };
  },
  async saveTheory(_sessionId: string, requestBody: SaveTheoryRequest): Promise<{ version: number }> {
    await mockDelay(240);
    if (shouldFail("theory")) {
      throw new ArcadiaApiError("사건 재구성 기록을 저장하지 못했습니다.", "MOCK_SAVE_FAILED", true);
    }
    return { version: requestBody.version + 1 };
  },
  async submitVerdict(sessionId: string, theory: TheoryDraft): Promise<TrialVerdictResponse> {
    await mockDelay(500);
    if (shouldFail("verdict")) {
      throw new ArcadiaApiError("투표 집계 장치가 응답하지 않습니다.", "MOCK_VOTE_TIMEOUT", true);
    }
    const culpritId = getMockCase();
    const wrongAttemptsBefore = mockWrongAttempts.get(sessionId) ?? 0;
    const judgement = resolveMockJudgement(theory, culpritId, wrongAttemptsBefore);
    if (judgement.verdict !== "CORRECT") {
      mockWrongAttempts.set(sessionId, wrongAttemptsBefore + 1);
    }
    return { ...resolveMockTrial(theory, culpritId), judgement, version: 6 };
  },

  async fetchFinalReveal(_sessionId: string): Promise<FinalReveal> {
    await mockDelay(320);
    if (shouldFail("reveal")) {
      throw new ArcadiaApiError("사건 재구성 기록을 불러오지 못했습니다.", "MOCK_REVEAL_FAILED", true);
    }
    return MOCK_FINAL_REVEAL;
  },
};

export const arcadiaApi = API_MODE === "http" ? httpApi : mockApi;
