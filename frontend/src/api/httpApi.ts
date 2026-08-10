/**
 * 게임 백엔드(`/api/v1`) 연결 어댑터.
 *
 * 백엔드 계약(backend/docs/api-spec.md)과 프런트엔드 `ArcadiaApi` 계약은 모양이 다르다.
 * 이 파일이 그 차이를 흡수해서, UI와 Zustand 액션은 mock 모드와 동일한 인터페이스만 본다.
 *
 * 주요 변환:
 * - `{success, message, data}` 봉투를 벗기고 오류를 `ArcadiaApiError`로 정규화한다.
 * - 백엔드 8단계 세션 상태를 프런트엔드 4단계 상태로 축약한다.
 * - 프런트엔드 오브젝트 조사를 장소 탐사로 옮긴다. 기록 검색은 수사 보조 탭이 담당한다.
 * - 세션별 `오브젝트 ID → 서버 단서 ID` 원장을 유지해 심문 증거 제시와 최종 추리에 사용한다.
 *
 * 백엔드에 대응 엔드포인트가 없어 클라이언트에서만 처리하는 항목은 각 구현에 표시했다.
 */
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
  SessionPrepStage,
  SessionStatus,
  TrialVerdictResponse,
} from "./contracts";
import type { ArcadiaApi } from "./client";
import { ArcadiaApiError } from "./errors";
import { INVESTIGATION_OBJECTS, NPC_DIALOGUE } from "../data/investigation";
import type { TheoryDraft, TrialResult } from "../store/gameStore";
import {
  EVIDENCE_ROLES,
  LEGACY_LOCATION_ALIASES,
  OBJECT_BINDINGS,
  ROLE_SOURCE_FIELD,
  toCharacterId,
  type ApiEnvelope,
  type BackendAssistantResult,
  type BackendClue,
  type BackendFinalReveal,
  type BackendLocationId,
  type BackendDeductionResult,
  type BackendNpcTurn,
  type BackendPlayerCaseView,
  type BackendSessionState,
  type BackendSessionSummary,
  type EvidenceRole,
} from "./backendContract";

const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const NORMALIZED_BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");
const V1_BASE_URL = NORMALIZED_BASE_URL.endsWith("/v1")
  ? NORMALIZED_BASE_URL
  : `${NORMALIZED_BASE_URL}/v1`;

/** DB만 오가는 요청. */
const FAST_TIMEOUT_MS = 12_000;
/** LLM을 거치는 요청. 백엔드 자체 타임아웃이 65초라 그보다 길게 잡는다. */
const AI_TIMEOUT_MS = 70_000;
/** 실제 AI 사건 생성은 수십 초가 걸린다. 백엔드 폴링 예산(210초)보다 짧게 잡는다. */
const SESSION_POLL_BUDGET_MS = 180_000;
const SESSION_POLL_INTERVAL_MS = 2_000;

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 전송과 오류 정규화
// ---------------------------------------------------------------------------

function normalizeHttpError(status: number, message: string | null | undefined): ArcadiaApiError {
  const text = message?.trim() ? message.trim() : "서버 요청을 완료하지 못했습니다.";
  switch (status) {
    case 400:
      return new ArcadiaApiError(text, "INVALID_REQUEST", false);
    case 404:
      return new ArcadiaApiError(text, "SESSION_NOT_FOUND", false);
    case 409:
      return new ArcadiaApiError(text, "INVALID_SESSION_STATE", false);
    default:
      return new ArcadiaApiError(
        text,
        status >= 500 ? "SERVER_ERROR" : `HTTP_${status}`,
        status >= 500,
      );
  }
}

async function requestBackend<T>(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${V1_BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ArcadiaApiError(
      "게임 서버와 통신하지 못했습니다.",
      "NETWORK_ERROR",
      true,
    );
  }

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || envelope?.success === false) {
    throw normalizeHttpError(response.status, envelope?.message);
  }
  if (!envelope) {
    throw new ArcadiaApiError("서버 응답을 해석하지 못했습니다.", "INVALID_RESPONSE", true);
  }
  return envelope.data as T;
}

// ---------------------------------------------------------------------------
// 세션별 직렬 큐
// ---------------------------------------------------------------------------

/**
 * 세션 상태를 바꾸는 요청을 한 번에 하나씩 보낸다.
 *
 * 백엔드는 탐사·검색·심문·판정에서 `EvidenceInventory` 한 행을 읽고 다시 쓴다. 요청을 동시에
 * 보내면 나중에 끝난 쓰기가 앞선 해금을 덮어써서 단서가 조용히 사라진다. 실제로 검색 질의
 * 7건을 동시에 보내면 단서 2개, 순차로 보내면 4개가 열렸다.
 *
 * 조회 전용 요청(세션 상태·공개 상태)은 큐를 거치지 않는다.
 */
const sessionQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
  // 앞선 작업이 실패해도 뒤따르는 작업은 그대로 진행한다.
  const next = previous.then(task, task);
  sessionQueues.set(
    sessionId,
    next.catch(() => undefined),
  );
  return next;
}

// ---------------------------------------------------------------------------
// 세션 원장: 프런트엔드 오브젝트 ID ↔ 서버 단서 ID 연결
// ---------------------------------------------------------------------------

type SessionLedger = {
  sessionId: string;
  /** 백엔드에 낙관적 잠금이 없어 프런트엔드 계약용 `version`을 여기서 발급한다. */
  version: number;
  objectClues: Record<string, string[]>;
  discoveredClueIds: string[];
  /** 단서 ID → 제목. 증거 제시 질문 문구를 만들 때 쓴다. */
  clueTitles: Record<string, string>;
};

const LEDGER_STORAGE_KEY = "arcadia-station-backend-ledger-v1";

let activeLedger: SessionLedger | null = null;

function emptyLedger(sessionId: string): SessionLedger {
  return {
    sessionId,
    version: 1,
    objectClues: {},
    discoveredClueIds: [],
    clueTitles: {},
  };
}

function readStoredLedger(): SessionLedger | null {
  try {
    const raw = localStorage.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionLedger> | null;
    if (!parsed || typeof parsed.sessionId !== "string") return null;
    return { ...emptyLedger(parsed.sessionId), ...parsed, sessionId: parsed.sessionId };
  } catch {
    // 손상된 원장은 게임 저장 데이터와 같은 정책으로 격리한다.
    localStorage.removeItem(LEDGER_STORAGE_KEY);
    return null;
  }
}

function ledgerFor(sessionId: string): SessionLedger {
  if (activeLedger?.sessionId === sessionId) return activeLedger;
  const stored = readStoredLedger();
  activeLedger = stored && stored.sessionId === sessionId ? stored : emptyLedger(sessionId);
  return activeLedger;
}

function persistLedger(): void {
  if (!activeLedger) return;
  try {
    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(activeLedger));
  } catch {
    // 저장 실패는 진행을 막지 않는다. 원장은 세션 메모리에 남는다.
  }
}

function nextVersion(sessionId: string): number {
  const ledger = ledgerFor(sessionId);
  ledger.version += 1;
  persistLedger();
  return ledger.version;
}

function recordClues(sessionId: string, objectId: string | null, clues: BackendClue[]): void {
  if (clues.length === 0) return;
  const ledger = ledgerFor(sessionId);
  for (const clue of clues) {
    if (!ledger.discoveredClueIds.includes(clue.clueId)) {
      ledger.discoveredClueIds.push(clue.clueId);
    }
    ledger.clueTitles[clue.clueId] = clue.title;
    if (objectId) {
      const linked = ledger.objectClues[objectId] ?? [];
      if (!linked.includes(clue.clueId)) linked.push(clue.clueId);
      ledger.objectClues[objectId] = linked;
    }
  }
  persistLedger();
}

function cluesForObject(sessionId: string, objectId: string): string[] {
  return ledgerFor(sessionId).objectClues[objectId] ?? [];
}

/** 이 단서를 확보한 조사 오브젝트. 수첩에서 출처를 보여주는 용도다. */
function sourceObjectFor(sessionId: string, clueId: string): string | null {
  const { objectClues } = ledgerFor(sessionId);
  for (const [objectId, clueIds] of Object.entries(objectClues)) {
    if (clueIds.includes(clueId)) return objectId;
  }
  return null;
}

function toEvidence(sessionId: string, clue: BackendClue): DiscoveredEvidence {
  return {
    clueId: clue.clueId,
    title: clue.title,
    clueType: clue.clueType,
    playerText: clue.playerText,
    sourceObjectId: sourceObjectFor(sessionId, clue.clueId),
    // 문맥 필드는 요청 A로 나중에 추가됐다. 옛 백엔드가 응답해도 화면이 깨지지 않게 채워 둔다.
    isCore: clue.isCore ?? false,
    revealedFacts: clue.revealedFacts ?? [],
    linkedClueIds: clue.linkedClueIds ?? [],
    // suspectEffects는 일부러 옮기지 않는다. 그 값이 곧 배제 판정의 정답이라 화면에 쓰지 않는다.
    hasPendingConnection: clue.hasPendingConnection ?? false,
  };
}

// ---------------------------------------------------------------------------
// 상태 변환
// ---------------------------------------------------------------------------

function assertNotFailed(state: BackendSessionState): void {
  if (state === "FAILED") {
    throw new ArcadiaApiError(
      "사건 생성에 실패했습니다. 새 사건으로 다시 시도하십시오.",
      "AI_CASE_GENERATION_FAILED",
      true,
    );
  }
}

/** 백엔드 세션 상태를 사건 생성 로딩 화면의 단계로 옮긴다. */
function toPrepStage(state: BackendSessionState): SessionPrepStage {
  if (state === "CREATING") return "CREATING";
  if (state === "VALIDATING") return "VALIDATING";
  return "READY";
}

function toSessionStatus(state: BackendSessionState): SessionStatus {
  switch (state) {
    case "CREATING":
    case "VALIDATING":
      return "PREPARING";
    case "READY":
    case "BRIEFING":
      return "READY";
    // 오답 소진(INCORRECT)도 더 진행할 수 없는 끝난 세션이라 정답 종료와 같이 다룬다.
    case "COMPLETED":
    case "INCORRECT":
      return "RESULT";
    default:
      return "IN_PROGRESS";
  }
}

// ---------------------------------------------------------------------------
// 조사 · 심문 보조
// ---------------------------------------------------------------------------

function exploreLocation(
  sessionId: string,
  locationId: string,
  objectHint: string,
): Promise<BackendClue[]> {
  return enqueue(sessionId, () =>
    requestBackend<BackendClue[]>(
      `/sessions/${sessionId}/explore`,
      { method: "POST", body: JSON.stringify({ locationId, objectHint }) },
      FAST_TIMEOUT_MS,
    ),
  );
}

function runAssistantQuery(
  sessionId: string,
  question: string,
  timeoutMs: number,
): Promise<BackendAssistantResult> {
  return enqueue(sessionId, () =>
    requestBackend<BackendAssistantResult>(
      `/sessions/${sessionId}/assistant/queries`,
      { method: "POST", body: JSON.stringify({ question }) },
      timeoutMs,
    ),
  );
}

/**
 * 이미 조사한 장소를 다시 훑는다.
 *
 * 백엔드 Fake 픽스처가 아직 1.1.0 이전 장소 ID를 써서, 정식 로스터만 탐사하면 단서 절반을
 * 얻지 못한다. 같은 방을 가리키는 구형 ID까지 함께 조회해 메운다. 실제 AI 사건에서는 빈
 * 배열만 돌아오므로 부작용이 없다.
 *
 * 탐사는 서버 DB만 오가고 이미 발견한 단서는 건너뛰므로 비용이 낮다. 백엔드가 세션
 * 인벤토리를 읽고 다시 쓰기 때문에 순차로 보낸다.
 */
async function exploreRoom(
  sessionId: string,
  locationId: BackendLocationId,
  objectId: string,
): Promise<BackendClue[]> {
  const found = [...(await exploreLocation(sessionId, locationId, objectId))];
  for (const alias of LEGACY_LOCATION_ALIASES[locationId] ?? []) {
    try {
      found.push(...(await exploreLocation(sessionId, alias, objectId)));
    } catch {
      // 별칭은 보조 경로다. 실패해도 조사 자체를 막지 않는다.
    }
  }
  return found;
}

function buildQuestion(sessionId: string, input: InterrogationInput): string {
  if (input.choiceId) {
    const label = NPC_DIALOGUE[input.npcId]?.choices.find(
      (choice) => choice.id === input.choiceId,
    )?.label;
    if (label) return label;
  }
  if (input.evidenceId) {
    const title = ledgerFor(sessionId).clueTitles[input.evidenceId] ?? input.evidenceId;
    return `${title} 기록을 제시합니다. 이에 대해 설명해 주십시오.`;
  }
  const query = input.query?.trim();
  if (query) return query;
  return "당시 상황을 다시 설명해 주십시오.";
}

function buildObservation(result: BackendAssistantResult): string {
  if (result.newlyDiscoveredClues.length > 0) {
    const titles = result.newlyDiscoveredClues.map((clue) => clue.title).join(", ");
    return `이 검색으로 새 기록 ${result.newlyDiscoveredClues.length}건을 확보했습니다: ${titles}.`;
  }
  if (result.citedRecordIds.length > 0) {
    return `사건 기록 ${result.citedRecordIds.length}건을 근거로 비교했습니다. 시간·구역·접근 권한을 함께 검토하십시오.`;
  }
  return "이 질문에 대응하는 사건 기록을 찾지 못했습니다. 조사 구역을 넓히거나 질문을 구체화하십시오.";
}

// ---------------------------------------------------------------------------
// 최종 추리
// ---------------------------------------------------------------------------

/**
 * 이론의 네 축을 백엔드 판정 역할로 옮긴다. 증거 필드가 이미 서버 단서 ID라 1:1로 대응한다.
 *
 * 백엔드는 네 역할 모두에 **이미 발견한** 단서 ID를 요구하고, 하나라도 비거나 미발견이면
 * 400으로 거절한다.
 */
function selectEvidenceByRole(
  theory: TheoryDraft,
  discovered: BackendClue[],
): Record<EvidenceRole, string> {
  const discoveredIds = new Set(discovered.map((clue) => clue.clueId));
  const selection = {} as Record<EvidenceRole, string>;

  for (const role of EVIDENCE_ROLES) {
    const clueId = theory[ROLE_SOURCE_FIELD[role]];
    if (!clueId) {
      throw new ArcadiaApiError(
        "재판 판정에 필요한 이론 항목이 누락되었습니다.",
        "INVALID_REQUEST",
        false,
      );
    }
    if (!discoveredIds.has(clueId)) {
      throw new ArcadiaApiError(
        "서버에 기록되지 않은 단서는 제출할 수 없습니다. 조사를 더 진행한 뒤 다시 시도하십시오.",
        "UNDISCOVERED_CLUE",
        false,
      );
    }
    selection[role] = clueId;
  }

  return selection;
}

/**
 * 배제 근거를 백엔드 요청 형태로 옮긴다.
 *
 * 백엔드는 범인으로 지목한 인물을 배제 키로 받으면 400을 돌려주고, 아직 발견하지 않은 단서도
 * 같은 이유로 거절한다. 이론 초안이 오래돼 이미 사라진 단서를 들고 있을 수 있으므로 서버가
 * 확인해 준 목록으로 한 번 거른다.
 */
function selectExclusions(
  theory: TheoryDraft,
  discovered: BackendClue[],
): Record<string, string> {
  const discoveredIds = new Set(discovered.map((clue) => clue.clueId));
  const selection: Record<string, string> = {};
  for (const [characterId, clueId] of Object.entries(theory.exclusions)) {
    if (characterId === theory.suspectId || !clueId || !discoveredIds.has(clueId)) continue;
    selection[characterId] = clueId;
  }
  return selection;
}

/** 백엔드 사건 재구성을 해설 화면이 그대로 그릴 수 있는 모양으로 줄인다. */
function toFinalReveal(reveal: BackendFinalReveal, resolvedByPlayer: boolean): FinalReveal {
  const statements = new Map(reveal.facts.map((fact) => [fact.factId, fact.statement]));
  return {
    culpritId: reveal.culpritId,
    truthSummary: reveal.truthSummary,
    methodSummary: reveal.method?.fictionalSummary ?? null,
    victimCondition: reveal.method?.victimCondition ?? null,
    timeline: reveal.timeline.map((event) => ({
      eventId: event.eventId,
      time: event.time,
      actorIds: event.actorIds,
      locationId: event.locationId,
      summary: event.summary,
    })),
    alibis: reveal.alibis.map((alibi) => ({
      characterId: alibi.characterId,
      initialClaim: alibi.initialClaim,
      actualWhereabouts: alibi.actualWhereabouts,
      // 사실 ID만으로는 화면에 쓸 수 없다. 진술 문장으로 바꿔 둔다.
      contradictions: alibi.contradictingFactIds
        .map((factId) => statements.get(factId))
        .filter((statement): statement is string => Boolean(statement)),
    })),
    requiredEvidenceByRole: reveal.solution.requiredEvidenceByRole,
    exclusions: reveal.solution.nonCulpritExclusions.map((exclusion) => ({
      characterId: exclusion.characterId,
      reason: exclusion.reason,
    })),
    resolvedByPlayer,
  };
}

/**
 * 백엔드 판정을 프런트엔드 재판 결과로 옮긴다.
 *
 * 백엔드는 표 계산을 하지 않으므로 투표 수는 판정 강도에서 유도한다.
 * 엔딩 분기 기준은 mock 어댑터(`resolveMockTrial`)와 동일하게 맞췄다.
 */
function toTrialResult(accusedId: string, result: BackendDeductionResult): TrialResult {
  const correctRoles = Object.values(result.roleResults).filter(
    (value) => value === "CORRECT",
  ).length;

  if (result.verdict === "CORRECT") {
    return { accusedId, votesFor: 5, ending: "CULPRIT_EXPELLED", correctAccusation: true };
  }
  if (result.culpritCorrect) {
    return { accusedId, votesFor: 3, ending: "CULPRIT_SURVIVED", correctAccusation: true };
  }
  if (correctRoles >= 2) {
    return { accusedId, votesFor: 4, ending: "INNOCENT_EXPELLED", correctAccusation: false };
  }
  return { accusedId, votesFor: 2, ending: "TRIAL_DEADLOCK", correctAccusation: false };
}

// ---------------------------------------------------------------------------
// ArcadiaApi 구현
// ---------------------------------------------------------------------------

export const httpApi: ArcadiaApi = {
  async createSession(onProgress?: SessionPrepProgress): Promise<SessionDto> {
    const created = await requestBackend<BackendSessionSummary>(
      "/sessions",
      { method: "POST", body: JSON.stringify({ seed: null }) },
      FAST_TIMEOUT_MS,
    );

    activeLedger = emptyLedger(created.sessionId);
    persistLedger();

    let state = created.status;
    onProgress?.(toPrepStage(state));
    const deadline = Date.now() + SESSION_POLL_BUDGET_MS;
    while (state === "CREATING" || state === "VALIDATING") {
      if (Date.now() >= deadline) {
        throw new ArcadiaApiError(
          "사건 생성이 제한 시간 안에 완료되지 않았습니다.",
          "SESSION_PREPARATION_TIMEOUT",
          true,
        );
      }
      await delay(SESSION_POLL_INTERVAL_MS);
      const polled = await requestBackend<BackendSessionSummary>(
        `/sessions/${created.sessionId}/status`,
        undefined,
        FAST_TIMEOUT_MS,
      );
      state = polled.status;
      onProgress?.(toPrepStage(state));
    }
    assertNotFailed(state);

    return {
      sessionId: created.sessionId,
      status: toSessionStatus(state),
      day: 1,
      version: nextVersion(created.sessionId),
    };
  },

  /**
   * 백엔드에 오프닝 완료 엔드포인트가 없다. 공개 상태를 한 번 조회해 사건이 실제로
   * 동결됐는지 확인하는 것으로 대신하고, 진행 상태 전환은 클라이언트가 기록한다.
   */
  async completeOpening(sessionId: string): Promise<SessionDto> {
    const view = await requestBackend<BackendPlayerCaseView>(
      `/sessions/${sessionId}`,
      undefined,
      FAST_TIMEOUT_MS,
    );
    assertNotFailed(view.status);
    return {
      sessionId,
      status: view.status === "COMPLETED" ? "RESULT" : "IN_PROGRESS",
      day: 1,
      version: nextVersion(sessionId),
    };
  },

  async fetchCaseState(sessionId: string): Promise<CaseStateResponse> {
    const view = await requestBackend<BackendPlayerCaseView>(
      `/sessions/${sessionId}`,
      undefined,
      FAST_TIMEOUT_MS,
    );
    recordClues(sessionId, null, view.discoveredClues);
    return {
      title: view.title,
      briefing: view.briefing,
      suspectIds: view.suspectCharacterIds,
      evidence: view.discoveredClues.map((clue) => toEvidence(sessionId, clue)),
    };
  },

  async inspectObject(sessionId: string, objectId: string): Promise<InspectObjectResponse> {
    const binding = OBJECT_BINDINGS[objectId];
    if (!binding) {
      // 백엔드 장소 로스터에 대응이 없는 오브젝트는 조사해도 서버 단서가 없다.
      return { objectId, discoveredEvidence: [], version: nextVersion(sessionId) };
    }

    const unlocked = await exploreRoom(sessionId, binding.locationId, objectId);
    recordClues(sessionId, objectId, unlocked);

    return {
      objectId,
      discoveredEvidence: unlocked.map((clue) => toEvidence(sessionId, clue)),
      version: nextVersion(sessionId),
    };
  },

  /**
   * 백엔드 심문은 턴 단위 무상태 API라 개설 엔드포인트가 없다. 채널 ID는 여기서 합성하고
   * 첫 대사는 프런트엔드 정적 데이터를 쓴다. 실패로 처리하지 않아야 UI가 실시간 경로를 유지한다.
   */
  async startInterrogation(sessionId: string, npcId: string): Promise<InterrogationSession> {
    return {
      interrogationId: `${sessionId}::${toCharacterId(npcId)}`,
      npcId,
      opening: NPC_DIALOGUE[npcId]?.opening ?? "응답이 없습니다.",
      version: nextVersion(sessionId),
    };
  },

  async sendInterrogationMessage(
    interrogationId: string,
    input: InterrogationInput,
  ): Promise<InterrogationMessage> {
    const separator = interrogationId.lastIndexOf("::");
    const sessionId = separator > 0 ? interrogationId.slice(0, separator) : interrogationId;
    const characterId = toCharacterId(input.npcId);

    // 미발견 단서를 제시하면 400이므로, 서버가 해금을 확인해 준 단서만 보낸다.
    const discoveredClueIds = ledgerFor(sessionId).discoveredClueIds;
    const presentedClueIds =
      input.evidenceId && discoveredClueIds.includes(input.evidenceId) ? [input.evidenceId] : [];

    // 심문도 세션 인벤토리(제시 이력·공개 사실)를 갱신하므로 같은 큐를 통과시킨다.
    const turn = await enqueue(sessionId, () =>
      requestBackend<BackendNpcTurn>(
        `/sessions/${sessionId}/interrogations/${characterId}/turns`,
        {
          method: "POST",
          body: JSON.stringify({ question: buildQuestion(sessionId, input), presentedClueIds }),
        },
        AI_TIMEOUT_MS,
      ),
    );

    return {
      interrogationId,
      npcId: input.npcId,
      // 백엔드가 돌려주는 revealedFactIds는 내부 사실 ID라 프런트엔드 증거와 대응하지 않는다.
      revealedEvidenceIds: [],
      response: turn.dialogue,
      recommendedQuestions: turn.recommendedQuestions,
      version: nextVersion(sessionId),
    };
  },

  /** 백엔드에 일차 개념이 없다. 진행 기록은 클라이언트가 유지한다. */
  async completeDay(sessionId: string, day: 1 | 2): Promise<CompleteDayResponse> {
    return { completedDay: day, nextDay: day === 1 ? 2 : 3, version: nextVersion(sessionId) };
  },

  async askAssistant(
    sessionId: string,
    query: string,
    discoveredEvidenceIds: string[] = [],
  ): Promise<AssistantResponse> {
    const question = query.trim();
    if (!question) {
      throw new ArcadiaApiError("검색할 질문을 입력하십시오.", "INVALID_REQUEST", false);
    }

    const result = await runAssistantQuery(sessionId, question, AI_TIMEOUT_MS);
    recordClues(sessionId, null, result.newlyDiscoveredClues);

    const known = new Set(ledgerFor(sessionId).discoveredClueIds);
    return {
      summary: result.answer,
      // 백엔드 citedRecordIds는 내부 기록 ID라 수첩이 렌더링할 수 없다. 확보한 단서 ID만 넘긴다.
      citations: [
        ...result.newlyDiscoveredClues.map((clue) => clue.clueId),
        ...discoveredEvidenceIds.filter((id) => known.has(id)),
      ]
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, 3),
      observation: buildObservation(result),
      suggestedQuery: result.suggestedQueries[0] ?? null,
      fallback: result.citedRecordIds.length === 0,
    };
  },

  /** 백엔드에 이론 초안 저장 엔드포인트가 없다. 초안은 로컬 저장소에만 남는다. */
  async saveTheory(sessionId: string, _requestBody: SaveTheoryRequest): Promise<{ version: number }> {
    return { version: nextVersion(sessionId) };
  },

  async submitVerdict(sessionId: string, theory: TheoryDraft): Promise<TrialVerdictResponse> {
    if (
      !theory.suspectId ||
      !theory.setup ||
      !theory.trigger ||
      !theory.opportunity ||
      !theory.motive
    ) {
      throw new ArcadiaApiError(
        "재판 판정에 필요한 이론 항목이 누락되었습니다.",
        "INVALID_REQUEST",
        false,
      );
    }

    // 제출 가능한 단서의 기준은 서버 기록이다. 원장 대신 공개 상태를 먼저 조회해 맞춘다.
    const view = await requestBackend<BackendPlayerCaseView>(
      `/sessions/${sessionId}`,
      undefined,
      FAST_TIMEOUT_MS,
    );
    recordClues(sessionId, null, view.discoveredClues);

    const result = await enqueue(sessionId, () =>
      requestBackend<BackendDeductionResult>(
        `/sessions/${sessionId}/deductions`,
        {
          method: "POST",
          body: JSON.stringify({
            culpritId: theory.suspectId,
            evidenceByRole: selectEvidenceByRole(theory, view.discoveredClues),
            // 배제 근거는 범인으로 지목하지 않은 인물만 담는다. 범인 본인을 키로 보내면 400이다.
            exclusionsByCharacter: selectExclusions(theory, view.discoveredClues),
          }),
        },
        FAST_TIMEOUT_MS,
      ),
    );

    return {
      ...toTrialResult(theory.suspectId, result),
      judgement: {
        verdict: result.verdict,
        culpritCorrect: result.culpritCorrect,
        roleResults: result.roleResults ?? {},
        exclusionResults: result.exclusionResults ?? {},
        remainingAttempts: result.remainingAttempts,
        feedback: result.feedback,
        missingLogic: result.missingLogic ?? [],
      },
      version: nextVersion(sessionId),
    };
  },

  async fetchFinalReveal(sessionId: string): Promise<FinalReveal> {
    const reveal = await requestBackend<BackendFinalReveal>(
      `/sessions/${sessionId}/result`,
      undefined,
      FAST_TIMEOUT_MS,
    );
    // 세션 상태가 정답 종료인지 오답 소진인지에 따라 해설 문구가 달라진다. 서버는 결과 응답에
    // 그 구분을 담지 않으므로 공개 상태를 한 번 더 읽어 판별한다.
    const view = await requestBackend<BackendPlayerCaseView>(
      `/sessions/${sessionId}`,
      undefined,
      FAST_TIMEOUT_MS,
    );
    return toFinalReveal(reveal, view.status === "COMPLETED");
  },
};
