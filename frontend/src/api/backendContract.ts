/**
 * 게임 백엔드(`/api/v1`) 계약과 프런트엔드 조사 모델 사이의 변환표.
 *
 * 프런트엔드는 자체 오브젝트 ID(`CO_BODY` 등)로 증거를 식별하고, 백엔드는 AI가 생성한
 * 단서 ID(`CLUE-*`)로 식별한다. 이 파일은 두 식별 체계를 잇는 정적 매핑만 담고,
 * 세션별 동적 연결은 `httpApi.ts`의 원장이 담당한다.
 *
 * 장소 ID는 `ARCADIA_WORLD:1.1.0` 정식 로스터 8종을 따른다.
 * (backend/docs/ai-server-response-location-roster.md)
 */

export const BACKEND_LOCATION_IDS = [
  "COMMANDER_OFFICE",
  "DEPUTY_COMMANDER_OFFICE",
  "CENTRAL_HUB",
  "MEDICAL_BAY",
  "ENGINEERING_BAY",
  "COMMUNICATIONS_CENTER",
  "CARGO_BAY",
  "COMMON_AREA",
] as const;

export type BackendLocationId = (typeof BACKEND_LOCATION_IDS)[number];

export type ObjectBinding = {
  locationId: BackendLocationId;
};

/**
 * 프런트엔드 조사 오브젝트 16종이 속한 장소.
 *
 * 오브젝트를 조사하면 그 장소를 탐사한다. 백엔드 단서 중 `acquisition.type`이 `RAG_QUERY`인
 * 항목은 탐사로 열리지 않고 수사 보조 탭의 기록 검색으로만 열린다. 두 경로를 섞지 않는다.
 *
 * AI 서버의 `integration/frontend-contract-v1.json`을 기준으로 하되, 그 파일이 아직
 * 구형 장소 ID(`COMMAND_DECK`, `SECURITY_HUB` 등)를 쓰고 있어 로스터 문서 6절의
 * 이전표에 따라 1.1.0 값으로 옮겼다.
 */
export const OBJECT_BINDINGS: Record<string, ObjectBinding> = {
  CO_BODY: {
    locationId: "COMMANDER_OFFICE",
  },
  CO_DOOR_LOG: {
    locationId: "COMMANDER_OFFICE",
  },
  CO_XO_PASSAGE: {
    locationId: "DEPUTY_COMMANDER_OFFICE",
  },
  CO_ENV_PANEL: {
    locationId: "CENTRAL_HUB",
  },
  CO_TERMINAL: {
    locationId: "COMMANDER_OFFICE",
  },
  CO_SCANNER: {
    locationId: "COMMANDER_OFFICE",
  },
  HB_MAINTENANCE: {
    locationId: "CENTRAL_HUB",
  },
  XO_RESOURCE_BOARD: {
    locationId: "DEPUTY_COMMANDER_OFFICE",
  },
  MD_MEDICAL_TERMINAL: {
    locationId: "MEDICAL_BAY",
  },
  MD_MEDICAL_STORAGE: {
    locationId: "MEDICAL_BAY",
  },
  EN_LIFE_SUPPORT: {
    locationId: "ENGINEERING_BAY",
  },
  CM_SECURITY_ARCHIVE: {
    locationId: "COMMUNICATIONS_CENTER",
  },
  CG_AIRLOCK_LOG: {
    locationId: "CARGO_BAY",
  },
  CG_CARGO_MANIFEST: {
    locationId: "CARGO_BAY",
  },
  CMN_FOOD_STATION: {
    locationId: "COMMON_AREA",
  },
  QT_ACCESS_BUFFER: {
    locationId: "COMMON_AREA",
  },
};

/**
 * 정식 장소별 구형 ID 별칭.
 *
 * 백엔드 Fake 프로필 픽스처(`sample-case-blueprint.json`)는 아직 1.1.0 이전 장소 ID를 쓴다.
 * `CLUE-ACCESS-HISTORY`가 `LIFE_SUPPORT_CORRIDOR`, `CLUE-MOTIVE-MESSAGE`가
 * `PERSONAL_QUARTERS`에 있어서, 정식 로스터 8종만 탐사하면 그 단서를 영영 얻을 수 없다.
 * 게임 백엔드의 탐사 API는 로스터를 검사하지 않으므로 별칭도 함께 조회해 메운다.
 *
 * 대응 관계는 로스터 문서 6절의 이전표를 따른다. 실제 AI 사건은 정식 ID만 쓰기 때문에
 * 별칭 조회는 빈 배열을 돌려받고 끝난다.
 */
export const LEGACY_LOCATION_ALIASES: Record<BackendLocationId, string[]> = {
  COMMANDER_OFFICE: ["COMMAND_DECK", "SECURITY_HUB"],
  DEPUTY_COMMANDER_OFFICE: [],
  CENTRAL_HUB: ["LIFE_SUPPORT_CONTROL", "COMMAND_CORRIDOR", "MAINTENANCE_CORRIDOR"],
  MEDICAL_BAY: [],
  ENGINEERING_BAY: ["LIFE_SUPPORT_CORRIDOR"],
  COMMUNICATIONS_CENTER: [],
  CARGO_BAY: ["DOCKING_CONTROL"],
  COMMON_AREA: ["PERSONAL_QUARTERS"],
};

/** 프런트엔드 NPC 오브젝트 ID(`NPC_MAYA`) → 백엔드 인물 ID(`MAYA`). */
export function toCharacterId(npcId: string): string {
  return npcId.startsWith("NPC_") ? npcId.slice(4) : npcId;
}

/** 백엔드 최종 추리의 증거 역할. 4개를 모두 채워야 제출할 수 있다. */
export const EVIDENCE_ROLES = ["SETUP", "TRIGGER", "OPPORTUNITY", "MOTIVE"] as const;

export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/**
 * 프런트엔드 이론 필드 → 백엔드 증거 역할. 1:1로 대응한다.
 *
 * 사건에 따라 준비와 실행이 서로 다른 단서라, 두 역할을 한 축으로 합치면 정답 판정이
 * 구조적으로 불가능해진다. 그래서 프런트엔드 이론도 네 축을 그대로 갖는다.
 */
export const ROLE_SOURCE_FIELD: Record<
  EvidenceRole,
  "setup" | "trigger" | "opportunity" | "motive"
> = {
  SETUP: "setup",
  TRIGGER: "trigger",
  OPPORTUNITY: "opportunity",
  MOTIVE: "motive",
};

// ---------------------------------------------------------------------------
// 백엔드 응답 타입 (backend/docs/api-spec.md)
// ---------------------------------------------------------------------------

/** 모든 백엔드 응답을 감싸는 공통 봉투. */
export type ApiEnvelope<T> = {
  success: boolean;
  message: string | null;
  data: T | null;
};

export type BackendSessionState =
  | "CREATING"
  | "VALIDATING"
  | "READY"
  | "BRIEFING"
  | "INVESTIGATION"
  | "DEDUCTION"
  | "COMPLETED"
  /** 오답 기회를 모두 소진해 끝난 세션. 정답은 아니지만 사건 해설은 열린다. */
  | "INCORRECT"
  | "FAILED";

export type BackendClueType = "PHYSICAL" | "DIGITAL" | "MOTIVE" | "OPPORTUNITY";

export type BackendClue = {
  clueId: string;
  title: string;
  clueType: BackendClueType;
  playerText: string;
  /**
   * 단서 문맥 필드. 요청 A로 추가됐다.
   *
   * 배포 시점이 어긋나 옛 백엔드가 응답할 수 있으므로 없을 수 있는 값으로 둔다.
   * 정답을 그대로 드러내는 `solutionRoles`는 의도적으로 내려오지 않는다.
   */
  isCore?: boolean;
  revealedFacts?: { factId: string; statement: string }[];
  linkedClueIds?: string[];
  /**
   * 서버는 내려주지만 화면은 쓰지 않는다.
   *
   * 배제 판정이 이 값을 그대로 정답으로 쓰기 때문에(`solution.nonCulpritExclusions`),
   * 카드에 적으면 최종 추리의 배제 항목이 받아쓰기가 된다. 계약을 정확히 남겨 두되
   * `toEvidence`에서 의도적으로 버린다.
   */
  suspectEffects?: { characterId: string; effect: "SUPPORTS" | "EXCLUDES" | "NEUTRAL" }[];
  hasPendingConnection?: boolean;
};

export type BackendSessionSummary = {
  sessionId: string;
  status: BackendSessionState;
};

export type BackendPlayerCaseView = {
  sessionId: string;
  status: BackendSessionState;
  title: string | null;
  briefing: string | null;
  discoveredClues: BackendClue[];
  suspectCharacterIds: string[];
  exploreLocationIds: string[];
};

export type BackendAssistantResult = {
  answer: string;
  citedRecordIds: string[];
  suggestedQueries: string[];
  newlyDiscoveredClues: BackendClue[];
};

export type BackendNpcTurn = {
  dialogue: string;
  emotion: string;
  revealedFactIds: string[];
  recommendedQuestions: { topicId: string; label: string }[];
};

export type BackendDeductionResult = {
  verdict: "CORRECT" | "PARTIAL" | "INCORRECT";
  culpritCorrect: boolean;
  roleResults: Record<string, "CORRECT" | "INCORRECT">;
  remainingAttempts: number;
  feedback: string;
  /** 요청에 배제 근거를 담지 않으면 빈 객체가 온다. */
  exclusionResults: Record<string, "CORRECT" | "INSUFFICIENT">;
  missingLogic: {
    code: "WRONG_CULPRIT" | "WEAK_ROLE_EVIDENCE" | "WEAK_EXCLUSION";
    role: string | null;
    characterId: string | null;
    message: string;
  }[];
};

/**
 * 판정 완료 후에만 열리는 사건 전체 재구성.
 *
 * 정답으로 끝난 세션(`COMPLETED`)과 오답을 모두 소진한 세션(`INCORRECT`) 양쪽에서 조회할 수 있다.
 */
export type BackendFinalReveal = {
  sessionId: string;
  culpritId: string;
  truthSummary: string;
  method: {
    fictionalSummary: string | null;
    victimCondition: string | null;
  } | null;
  timeline: {
    eventId: string;
    time: string;
    actorIds: string[];
    locationId: string;
    actionType: string;
    summary: string;
    factIds: string[];
  }[];
  facts: { factId: string; kind: string; statement: string; truthValue: boolean }[];
  alibis: {
    characterId: string;
    initialClaim: string;
    actualWhereabouts: string;
    supportingFactIds: string[];
    contradictingFactIds: string[];
  }[];
  solution: {
    culpritId: string;
    requiredEvidenceByRole: Record<string, string[]>;
    acceptedAlternativesByRole: Record<string, string[]>;
    nonCulpritExclusions: {
      characterId: string;
      excludedByClueIds: string[];
      reason: string;
    }[];
  };
};
