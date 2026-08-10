import type { TheoryDraft, TrialResult } from "../store/gameStore";

export type SessionStatus = "PREPARING" | "READY" | "IN_PROGRESS" | "RESULT";

export type SessionDto = {
  sessionId: string;
  status: SessionStatus;
  day: 1 | 2 | 3;
  version: number;
  pollAfterMs?: number;
};

/**
 * 사건 생성 진행 단계.
 *
 * AI가 사건을 만드는 데 수십 초에서 2분까지 걸린다. 그 동안 진입 화면이 아무것도 말해 주지
 * 않으면 멈춘 것처럼 보이므로, 백엔드 세션 상태를 그대로 단계로 옮겨 로딩 화면 문구의 근거로
 * 삼는다. 지어낸 진행률이 아니라 실제 서버 상태다.
 */
export type SessionPrepStage = "CREATING" | "VALIDATING" | "READY";

/** 사건 생성 단계가 바뀔 때마다 호출된다. */
export type SessionPrepProgress = (stage: SessionPrepStage) => void;

/** 서버가 판정에 사용하는 단서 종류. */
export type EvidenceType = "PHYSICAL" | "DIGITAL" | "MOTIVE" | "OPPORTUNITY";

/**
 * 서버가 해금해 준 단서 한 건.
 *
 * 수첩·이론·재판이 표시하고 제출하는 증거의 유일한 출처다. 프런트엔드 조사 오브젝트는
 * 3D 소품의 물리적 정체성만 담당하고 증거 내용은 갖지 않는다.
 */
/** 단서가 드러낸 사실. 참·거짓 여부는 서버가 내려주지 않는다. */
export type RevealedFact = {
  factId: string;
  statement: string;
};

export type DiscoveredEvidence = {
  clueId: string;
  title: string;
  clueType: EvidenceType;
  playerText: string;
  /** 이 단서를 확보한 조사 오브젝트. 수첩에서 출처를 보여주는 용도이며 없을 수 있다. */
  sourceObjectId: string | null;
  /** 곁가지가 아닌 핵심 기록인지. */
  isCore: boolean;
  /** 이 기록이 말해 주는 사실. */
  revealedFacts: RevealedFact[];
  /** 같은 사실을 가리키는 다른 기록. 이미 확보한 것만 담긴다. */
  linkedClueIds: string[];
  /**
   * 이 기록이 아직 열리지 않은 기록의 재료인지.
   *
   * 무엇과 맞물리는지는 알려주지 않는다. "여기서 끝이 아니다"라는 방향만 준다.
   */
  hasPendingConnection: boolean;
};

/** 사건의 공개 상태. 새로고침 복구와 진행 중 동기화에 사용한다. */
export type CaseStateResponse = {
  title: string | null;
  briefing: string | null;
  suspectIds: string[];
  evidence: DiscoveredEvidence[];
};

export type InspectObjectResponse = {
  objectId: string;
  /** 이번 조사로 새로 확보한 단서. 없으면 빈 배열이며 오류가 아니다. */
  discoveredEvidence: DiscoveredEvidence[];
  version: number;
};

/**
 * 서버가 제안한 다음 질문.
 *
 * 심문이 한 번 오가면 이어지는 선택지는 이 목록으로 바뀐다. 정적 질문 목록은 사건과 무관하게
 * 고정돼 있어서, 대화가 진행된 뒤에는 방금 들은 답변과 이어지지 않는다.
 */
export type RecommendedQuestion = {
  topicId: string;
  label: string;
};

export type InterrogationMessage = {
  interrogationId: string;
  npcId: string;
  response: string;
  revealedEvidenceIds: string[];
  /** 이 답변에 이어서 물을 수 있는 질문. 비어 있을 수 있다. */
  recommendedQuestions: RecommendedQuestion[];
  version: number;
};

export type InterrogationInput = {
  npcId: string;
  choiceId?: string;
  /** 제시할 서버 단서 ID. */
  evidenceId?: string;
  query?: string;
};

export type InterrogationSession = {
  interrogationId: string;
  npcId: string;
  opening: string;
  version: number;
};

export type CompleteDayResponse = {
  completedDay: 1 | 2;
  nextDay: 2 | 3;
  version: number;
};

export type AssistantResponse = {
  summary: string;
  citations: string[];
  observation: string;
  suggestedQuery: string | null;
  fallback: boolean;
};

export type SaveTheoryRequest = {
  theory: TheoryDraft;
  version: number;
};

/** 최종 추리에서 서버가 매기는 축별 정오. */
export type RoleMark = "CORRECT" | "INCORRECT";

/** 배제 근거의 정오. 부족한 경우 무엇이 정답인지는 알려주지 않는다. */
export type ExclusionMark = "CORRECT" | "INSUFFICIENT";

/**
 * 부족한 논리 한 건.
 *
 * 서버는 "무엇이 모자란지"까지만 말하고 "무엇이 정답인지"는 말하지 않는다. 정답 단서 ID와
 * 정답 인물은 이 안에 담기지 않는다.
 */
export type MissingLogicItem = {
  code: "WRONG_CULPRIT" | "WEAK_ROLE_EVIDENCE" | "WEAK_EXCLUSION";
  /** `WEAK_ROLE_EVIDENCE`일 때만 채워진다. */
  role: string | null;
  /** `WEAK_EXCLUSION`일 때만 채워진다. */
  characterId: string | null;
  message: string;
};

/**
 * 최종 추리 판정.
 *
 * 오답이어도 `remainingAttempts`가 남아 있으면 다시 제출할 수 있다. 기회를 모두 쓰면 서버가
 * 세션을 종료 상태로 넘기고 그때부터 사건 해설을 볼 수 있다.
 */
export type VerdictJudgement = {
  verdict: "CORRECT" | "PARTIAL" | "INCORRECT";
  culpritCorrect: boolean;
  roleResults: Record<string, RoleMark>;
  exclusionResults: Record<string, ExclusionMark>;
  remainingAttempts: number;
  feedback: string;
  missingLogic: MissingLogicItem[];
};

export type TrialVerdictResponse = TrialResult & {
  judgement: VerdictJudgement;
  version: number;
};

/** 사건 해설 타임라인 한 칸. */
export type RevealTimelineEvent = {
  eventId: string;
  time: string;
  actorIds: string[];
  locationId: string;
  summary: string;
};

/** 인물별 알리바이와 그 진위. */
export type RevealAlibi = {
  characterId: string;
  initialClaim: string;
  actualWhereabouts: string;
  /** 이 알리바이를 무너뜨린 사실. 비어 있으면 진술과 실제가 어긋나지 않았다는 뜻이다. */
  contradictions: string[];
};

/**
 * 재판이 끝난 뒤에만 열리는 사건의 전모.
 *
 * 정답으로 끝났든 오답으로 기회를 소진했든 똑같이 볼 수 있다. 틀린 채로 끝난 사람도 무엇이
 * 진실이었는지는 알아야 사건이 닫힌다.
 */
export type FinalReveal = {
  culpritId: string;
  truthSummary: string;
  methodSummary: string | null;
  victimCondition: string | null;
  timeline: RevealTimelineEvent[];
  alibis: RevealAlibi[];
  /** 역할별 정답 증거 ID. 플레이어가 무엇을 놓쳤는지 대조하는 데 쓴다. */
  requiredEvidenceByRole: Record<string, string[]>;
  exclusions: { characterId: string; reason: string }[];
  /** 플레이어가 스스로 맞혀서 끝났는지. 해설 도입 문구가 달라진다. */
  resolvedByPlayer: boolean;
};
