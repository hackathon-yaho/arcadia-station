import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  INVESTIGATION_OBJECTS,
  REQUIRED_SCENE_IDS,
  SUSPECTS,
} from "../data/investigation";
import { validateTheory } from "../domain/theoryValidation";
import type {
  CaseStateResponse,
  DiscoveredEvidence,
  VerdictJudgement,
} from "../api/contracts";

export type UiLayer =
  | "opening"
  | "playing"
  | "inspection"
  | "interrogation"
  | "notebook"
  | "dayReview"
  | "trial"
  | "result";
export type NotebookTab = "evidence" | "timeline" | "suspects" | "assistant" | "theory";
export type InvestigationPhase = "DAY1" | "DAY2";
/** 백엔드 판정 4역할과 1:1로 대응하는 이론 축. */
export type TheoryEvidenceField = "setup" | "trigger" | "opportunity" | "motive";
/** 플레이어가 증거에 직접 붙이는 후보 역할. 백엔드 판정 역할과 이름을 맞춘다. */
export type EvidenceTag = "SETUP" | "TRIGGER" | "OPPORTUNITY" | "MOTIVE" | "EXCLUSION";
export type TrialEnding =
  | "CULPRIT_EXPELLED"
  | "CULPRIT_SURVIVED"
  | "INNOCENT_EXPELLED"
  | "TRIAL_DEADLOCK";

/**
 * 이론 초안. 증거 필드는 모두 서버 단서 ID(`clueId`)이며 백엔드 판정 4역할과 1:1로 맞춘다.
 * 프런트엔드 오브젝트 ID를 넣으면 서버 판정에서 거절된다.
 *
 * 사건에 따라 준비(setup)와 실행(trigger)이 서로 다른 단서라, 두 축을 하나로 합치면
 * 정답 판정이 구조적으로 불가능해진다.
 */
export type TheoryDraft = {
  suspectId: string | null;
  setup: string | null;
  trigger: string | null;
  opportunity: string | null;
  motive: string | null;
  exclusions: Record<string, string>;
};

const EMPTY_THEORY: TheoryDraft = {
  suspectId: null,
  setup: null,
  trigger: null,
  opportunity: null,
  motive: null,
  exclusions: {},
};

export type TrialResult = {
  accusedId: string;
  votesFor: number;
  ending: TrialEnding;
  correctAccusation: boolean;
};

/**
 * 저장 데이터에서 되살아난 단서.
 *
 * 옛 빌드가 남긴 레코드에는 나중에 필수가 된 문맥 필드가 아예 없다. 타입이 아니라 저장
 * 시점의 계약이 달랐던 것이므로, 되살릴 때는 실제 모양을 그대로 적는다.
 */
type StoredEvidence = Omit<
  DiscoveredEvidence,
  "isCore" | "revealedFacts" | "linkedClueIds" | "hasPendingConnection"
> &
  Partial<DiscoveredEvidence>;

/**
 * 되살린 단서를 현재 계약에 맞춘다.
 *
 * 문맥 필드가 없는 레코드를 수첩이 그대로 그리면 `undefined.map`으로 화면 전체가 죽는다.
 * 서버 공개 상태를 한 번 받으면 온전한 레코드로 덮이지만, 렌더가 언제나 그보다 빠르다.
 */
function normalizeEvidence(record: StoredEvidence): DiscoveredEvidence {
  return {
    ...record,
    isCore: record.isCore ?? false,
    revealedFacts: record.revealedFacts ?? [],
    linkedClueIds: record.linkedClueIds ?? [],
    hasPendingConnection: record.hasPendingConnection ?? false,
  };
}

export const resilientLocalStorage: StateStorage = {
  getItem: (name) => {
    const value = localStorage.getItem(name);
    if (!value) return null;
    try {
      JSON.parse(value);
      return value;
    } catch {
      localStorage.removeItem(name);
      return null;
    }
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

type GameState = {
  sessionId: string | null;
  sessionVersion: number;
  layer: UiLayer;
  notebookReturnLayer: "playing" | "result";
  phase: InvestigationPhase;
  notebookTab: NotebookTab;
  focusedId: string | null;
  selectedId: string | null;
  /** 플레이어가 조사한 3D 오브젝트 ID. 진행 게이트와 현장 표시에 쓰는 물리 계층 상태다. */
  discoveredIds: string[];
  /** 서버가 해금해 준 단서. 수첩·이론·재판이 표시하고 제출하는 유일한 증거 출처다. */
  evidence: DiscoveredEvidence[];
  /** 서버가 생성한 사건 개요. */
  caseTitle: string | null;
  caseBriefing: string | null;
  /** 서버가 알려준 이 사건의 용의자 명단. 비어 있으면 정적 로스터로 대체한다. */
  suspectIds: string[];
  interviewedIds: string[];
  /**
   * 플레이어가 증거에 붙인 후보 역할.
   *
   * 서버는 어느 증거가 어느 역할의 정답인지 알려주지 않는다. 그건 곧 정답이기 때문이다.
   * 대신 조사하면서 스스로 판단한 것을 여기 남기고, 사건 재구성에서 그 판단으로 목록을 좁힌다.
   */
  evidenceTags: Record<string, EvidenceTag[]>;
  theory: TheoryDraft;
  trialResult: TrialResult | null;
  /**
   * 마지막 최종 추리 판정.
   *
   * 오답이어도 기회가 남아 있으면 엔딩으로 가지 않고 이 판정을 보여준 뒤 다시 고치게 한다.
   * 사건 재구성 화면도 이걸 읽어 어느 축이 틀렸는지 표시한다.
   */
  verdictJudgement: VerdictJudgement | null;
  /**
   * 방금 받은 판정을 아직 검토하지 않았는지.
   *
   * 판정 자체는 사건 재구성 화면에서 계속 참고하므로 지우지 않는다. 대신 이 깃발로 "지금
   * 재판을 멈추고 검토 화면을 띄워야 하는지"만 구분한다. 다시 재판에 들어왔을 때 지난 판정이
   * 그대로 떠 있으면 안 되기 때문이다.
   */
  judgementPending: boolean;
  scanUntil: number;
  hasMoved: boolean;
  beginInvestigation: (sessionId?: string, version?: number) => void;
  updateSessionVersion: (version: number) => void;
  setFocused: (id: string | null) => void;
  openInspection: (id: string) => void;
  closeOverlay: () => void;
  toggleNotebook: () => void;
  setNotebookTab: (tab: NotebookTab) => void;
  markInspected: (objectId: string) => void;
  recordEvidence: (found: DiscoveredEvidence[]) => void;
  syncCaseState: (state: CaseStateResponse) => void;
  markInterviewed: (id: string) => void;
  toggleEvidenceTag: (clueId: string, tag: EvidenceTag) => void;
  openDayReview: () => void;
  beginDayTwo: () => void;
  setTheorySuspect: (id: string) => void;
  setTheoryEvidence: (field: TheoryEvidenceField, evidenceId: string) => void;
  setTheoryExclusion: (suspectId: string, evidenceId: string) => void;
  startTrial: () => void;
  recordJudgement: (judgement: VerdictJudgement) => void;
  reviseTheory: () => void;
  completeTrial: (result: TrialResult) => void;
  resetSession: () => void;
  activateScan: () => void;
  markMoved: () => void;
};

export const useGameStore = create<GameState>()(persist((set, get) => ({
  sessionId: null,
  sessionVersion: 0,
  layer: "opening",
  notebookReturnLayer: "playing",
  phase: "DAY1",
  notebookTab: "evidence",
  focusedId: null,
  selectedId: null,
  discoveredIds: [],
  evidence: [],
  caseTitle: null,
  caseBriefing: null,
  suspectIds: [],
  interviewedIds: [],
  evidenceTags: {},
  theory: EMPTY_THEORY,
  trialResult: null,
  verdictJudgement: null,
  judgementPending: false,
  scanUntil: 0,
  hasMoved: false,
  beginInvestigation: (sessionId, sessionVersion = 1) =>
    set({ sessionId: sessionId ?? "LOCAL-RESTORED", sessionVersion, layer: "playing" }),
  updateSessionVersion: (sessionVersion) => set({ sessionVersion }),
  setFocused: (focusedId) => {
    if (get().focusedId !== focusedId) set({ focusedId });
  },
  openInspection: (selectedId) => {
    document.exitPointerLock?.();
    set({
      selectedId,
      layer: INVESTIGATION_OBJECTS[selectedId]?.kind === "PERSON" ? "interrogation" : "inspection",
    });
  },
  closeOverlay: () =>
    set((state) => ({
      selectedId: null,
      layer: state.layer === "notebook" ? state.notebookReturnLayer : "playing",
    })),
  toggleNotebook: () => {
    const currentLayer = get().layer;
    const isNotebook = currentLayer === "notebook";
    if (!isNotebook) document.exitPointerLock?.();
    set({
      layer: isNotebook ? get().notebookReturnLayer : "notebook",
      notebookReturnLayer:
        !isNotebook && currentLayer === "result" ? "result" : get().notebookReturnLayer,
      selectedId: null,
    });
  },
  setNotebookTab: (notebookTab) => set({ notebookTab }),
  markInspected: (objectId) => {
    if (
      INVESTIGATION_OBJECTS[objectId]?.kind !== "PERSON" &&
      !get().discoveredIds.includes(objectId)
    ) {
      set((state) => ({ discoveredIds: [...state.discoveredIds, objectId] }));
    }
  },
  recordEvidence: (found) => {
    if (found.length === 0) return;
    set((state) => {
      const known = new Set(state.evidence.map((item) => item.clueId));
      const added = found.filter((item) => !known.has(item.clueId));
      return added.length === 0 ? state : { evidence: [...state.evidence, ...added] };
    });
  },
  // 서버 공개 상태를 기준으로 맞춘다. 새로고침 복구와 배경 해금 반영에 쓴다.
  // 단서는 쌓이기만 하므로 덮어쓰지 않고 합친다. 조회가 잠깐 뒤처져도 기록이 사라지지 않는다.
  syncCaseState: ({ title, briefing, suspectIds, evidence }) =>
    set((state) => {
      const merged = [...state.evidence];
      for (const record of evidence) {
        const index = merged.findIndex((item) => item.clueId === record.clueId);
        if (index === -1) merged.push(record);
        else merged[index] = record;
      }
      return {
        caseTitle: title ?? state.caseTitle,
        caseBriefing: briefing ?? state.caseBriefing,
        suspectIds: suspectIds.length > 0 ? suspectIds : state.suspectIds,
        evidence: merged,
      };
    }),
  markInterviewed: (id) => {
    if (!get().interviewedIds.includes(id)) {
      set((state) => ({ interviewedIds: [...state.interviewedIds, id] }));
    }
  },
  toggleEvidenceTag: (clueId, tag) =>
    set((state) => {
      const current = state.evidenceTags[clueId] ?? [];
      const next = current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag];
      const evidenceTags = { ...state.evidenceTags };
      // 태그를 다 떼면 항목 자체를 지운다. 빈 배열이 쌓이면 저장 데이터만 커진다.
      if (next.length === 0) delete evidenceTags[clueId];
      else evidenceTags[clueId] = next;
      return { evidenceTags };
    }),
  openDayReview: () => {
    const progress = getRequiredProgress(get().discoveredIds);
    if (progress.complete && get().interviewedIds.length >= 3) {
      document.exitPointerLock?.();
      set({ layer: "dayReview" });
    }
  },
  beginDayTwo: () => set({ phase: "DAY2", layer: "playing" }),
  setTheorySuspect: (suspectId) =>
    set((state) => ({
      theory: { ...state.theory, suspectId, exclusions: {} },
    })),
  setTheoryEvidence: (field, evidenceId) =>
    set((state) => ({ theory: { ...state.theory, [field]: evidenceId } })),
  setTheoryExclusion: (suspectId, evidenceId) =>
    set((state) => ({
      theory: {
        ...state.theory,
        exclusions: { ...state.theory.exclusions, [suspectId]: evidenceId },
      },
    })),
  startTrial: () => {
    const { theory, phase, evidence, suspectIds } = get();
    const validation = validateTheory(
      theory,
      evidence.map((item) => item.clueId),
      suspectIds.length > 0 ? suspectIds : SUSPECTS.map((suspect) => suspect.id),
    );
    if (phase === "DAY2" && validation.valid) {
      document.exitPointerLock?.();
      set({ layer: "trial" });
    }
  },
  recordJudgement: (verdictJudgement) => set({ verdictJudgement, judgementPending: true }),
  // 오답 판정을 받은 뒤 사건 재구성으로 돌아간다. 판정은 남겨 둬야 어디를 고칠지 볼 수 있다.
  reviseTheory: () =>
    set({
      layer: "notebook",
      notebookTab: "theory",
      notebookReturnLayer: "playing",
      judgementPending: false,
    }),
  completeTrial: (trialResult) =>
    set({ trialResult, layer: "result", judgementPending: false }),
  resetSession: () =>
    set({
      sessionId: null,
      sessionVersion: 0,
      layer: "opening",
      notebookReturnLayer: "playing",
      phase: "DAY1",
      notebookTab: "evidence",
      focusedId: null,
      selectedId: null,
      discoveredIds: [],
      evidence: [],
      caseTitle: null,
      caseBriefing: null,
      suspectIds: [],
      interviewedIds: [],
      evidenceTags: {},
      theory: EMPTY_THEORY,
      trialResult: null,
      verdictJudgement: null,
      judgementPending: false,
      scanUntil: 0,
      hasMoved: false,
    }),
  activateScan: () => set({ scanUntil: performance.now() + 3_000 }),
  markMoved: () => {
    if (!get().hasMoved) set({ hasMoved: true });
  },
}), {
  name: "arcadia-station-session-v1",
  storage: createJSONStorage(() => resilientLocalStorage),
  partialize: (state) => ({
    sessionId: state.sessionId,
    sessionVersion: state.sessionVersion,
    layer:
      state.layer === "result"
        ? "result"
        : state.layer === "opening"
          ? "opening"
          : "playing",
    notebookReturnLayer: "playing",
    phase: state.phase,
    notebookTab: state.notebookTab,
    focusedId: null,
    selectedId: null,
    discoveredIds: state.discoveredIds,
    evidence: state.evidence,
    caseTitle: state.caseTitle,
    caseBriefing: state.caseBriefing,
    suspectIds: state.suspectIds,
    interviewedIds: state.interviewedIds,
    evidenceTags: state.evidenceTags,
    theory: state.theory,
    trialResult: state.trialResult,
    verdictJudgement: state.verdictJudgement,
    judgementPending: false,
    scanUntil: 0,
    hasMoved: state.hasMoved,
  }),
  /**
   * 복구할 때마다 저장 데이터를 현재 계약에 맞춘다.
   *
   * `migrate`는 저장된 버전이 현재와 다를 때만 돈다. 그래서 필드를 추가하면서 `version`을
   * 올리지 않으면 옛 저장 데이터가 그대로 화면까지 올라간다. 실제로 단서 문맥 필드가 그렇게
   * 들어와 수첩이 죽었다. 버전과 무관하게 반드시 지나는 이 자리에서 다듬는다.
   *
   * 저장된 게 없으면 `persisted`는 undefined다.
   */
  merge: (persisted, current) => {
    const state = (persisted ?? {}) as Partial<GameState>;
    return {
      ...current,
      ...state,
      evidence: (state.evidence ?? []).map(normalizeEvidence),
    };
  },
  version: 2,
  migrate: (persistedState, fromVersion) => {
    const state = persistedState as Partial<GameState>;
    return {
      ...state,
      sessionVersion: typeof state.sessionVersion === "number" ? state.sessionVersion : 1,
      // v1은 증거를 프런트엔드 오브젝트 ID로 저장했다. 그 ID는 서버 판정에서 거절되므로
      // 증거와 이론을 비우고 서버 공개 상태로 다시 채운다.
      evidence: fromVersion < 2 ? [] : (state.evidence ?? []),
      caseTitle: fromVersion < 2 ? null : (state.caseTitle ?? null),
      caseBriefing: fromVersion < 2 ? null : (state.caseBriefing ?? null),
      suspectIds: fromVersion < 2 ? [] : (state.suspectIds ?? []),
      theory:
        fromVersion < 2
          ? EMPTY_THEORY
          : state.theory,
    } as GameState;
  },
}));

export function getRequiredProgress(discoveredIds: string[]) {
  const found = REQUIRED_SCENE_IDS.filter((id) => discoveredIds.includes(id)).length;
  return { found, total: REQUIRED_SCENE_IDS.length, complete: found === REQUIRED_SCENE_IDS.length };
}
