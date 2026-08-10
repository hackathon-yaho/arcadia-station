import { describe, expect, it, vi } from "vitest";

/**
 * adac391(2026-08-06) 이전 빌드가 남긴 저장 데이터.
 *
 * 그 커밋이 단서 문맥 필드를 필수로 추가하면서 persist `version`은 2로 두었다. 버전이 같으면
 * `migrate`가 돌지 않으므로, 이 모양이 그대로 수첩까지 올라가 `undefined.map`으로 죽었다.
 */
const LEGACY_SAVE = {
  state: {
    sessionId: "SESSION-LEGACY",
    sessionVersion: 7,
    layer: "playing",
    phase: "DAY1",
    notebookTab: "evidence",
    discoveredIds: ["CO_DOOR_LOG"],
    evidence: [
      {
        clueId: "CLUE-LEGACY",
        title: "출입 기록",
        clueType: "DIGITAL",
        playerText: "02:14 사령관실 출입 기록.",
        sourceObjectId: "CO_DOOR_LOG",
      },
    ],
    caseTitle: "사건",
    caseBriefing: "브리핑",
    suspectIds: ["MAYA"],
    interviewedIds: [],
    theory: {
      suspectId: null,
      setup: null,
      trigger: null,
      opportunity: null,
      motive: null,
      exclusions: {},
    },
    trialResult: null,
    scanUntil: 0,
    hasMoved: true,
  },
  version: 2,
};

/** 지금 계약대로 저장된 단서. 복구가 값을 건드리지 않는지 확인하는 대조군이다. */
const CURRENT_RECORD = {
  clueId: "CLUE-CURRENT",
  title: "환경 제어 로그",
  clueType: "PHYSICAL",
  playerText: "02:31 산소 분압 조정.",
  sourceObjectId: "CO_ENV_PANEL",
  isCore: true,
  revealedFacts: [{ factId: "FACT-1", statement: "누군가 수동으로 조정했다." }],
  linkedClueIds: ["CLUE-LEGACY"],
  hasPendingConnection: true,
};

async function rehydrate(save: unknown) {
  const store = new Map<string, string>();
  if (save !== undefined) store.set("arcadia-station-session-v1", JSON.stringify(save));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  // 복구는 모듈을 처음 평가할 때 한 번만 일어난다. 케이스마다 새로 불러와야 한다.
  vi.resetModules();
  const { useGameStore } = await import("./gameStore");
  return useGameStore.getState();
}

describe("저장 데이터 복구", () => {
  it("문맥 필드가 없는 옛 단서를 현재 계약으로 메운다", async () => {
    const state = await rehydrate(LEGACY_SAVE);

    expect(state.sessionId).toBe("SESSION-LEGACY");
    expect(state.evidence).toEqual([
      {
        clueId: "CLUE-LEGACY",
        title: "출입 기록",
        clueType: "DIGITAL",
        playerText: "02:14 사령관실 출입 기록.",
        sourceObjectId: "CO_DOOR_LOG",
        isCore: false,
        revealedFacts: [],
        linkedClueIds: [],
        hasPendingConnection: false,
      },
    ]);
  });

  it("옛 단서와 새 단서가 섞여 있어도 새 단서 값은 그대로 둔다", async () => {
    const mixed = {
      ...LEGACY_SAVE,
      state: {
        ...LEGACY_SAVE.state,
        evidence: [...LEGACY_SAVE.state.evidence, CURRENT_RECORD],
      },
    };

    const state = await rehydrate(mixed);

    expect(state.evidence).toHaveLength(2);
    expect(state.evidence[0].linkedClueIds).toEqual([]);
    expect(state.evidence[1]).toEqual(CURRENT_RECORD);
  });

  it("저장된 게 없으면 빈 상태로 시작한다", async () => {
    const state = await rehydrate(undefined);

    expect(state.sessionId).toBeNull();
    expect(state.layer).toBe("opening");
    expect(state.evidence).toEqual([]);
  });
});
