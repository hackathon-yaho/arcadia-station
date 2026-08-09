import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  INVESTIGATION_OBJECTS,
  NPC_DIALOGUE,
  SUSPECTS,
  TIMELINE,
  type TargetKind,
} from "../data/investigation";
import {
  getRequiredProgress,
  useGameStore,
  type EvidenceTag,
  type NotebookTab,
} from "../store/gameStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  useCompleteDay,
  useCreateSession,
  useAskAssistant,
  useCaseState,
  useFinalReveal,
  useInspectObject,
  useInterrogationSession,
  useSaveTheory,
  useSendInterrogationMessage,
  useSubmitVerdict,
} from "../api/hooks";
import { validateTheory } from "../domain/theoryValidation";
import { ROLE_SOURCE_FIELD } from "../api/backendContract";
import { GuideTour, NOTEBOOK_TOUR_STEPS, PLAY_TOUR_STEPS } from "./GuideTour";
import { Portrait, type PortraitState } from "./Portrait";
import type {
  DiscoveredEvidence,
  EvidenceType,
  RecommendedQuestion,
  SessionPrepStage,
  VerdictJudgement,
} from "../api/contracts";

/** 3D 소품의 종류. 물리 계층 표시에만 쓴다. */
const KIND_LABELS: Record<TargetKind, string> = {
  PHYSICAL: "물리 단서",
  DIGITAL: "디지털 기록",
  MOTIVE: "동기 자료",
  WORLD: "구조 정보",
  PERSON: "용의자 심문",
};

/** 서버 단서의 종류. 수첩과 이론 구성에 쓴다. */
const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  PHYSICAL: "물리 증거",
  DIGITAL: "디지털 기록",
  MOTIVE: "동기 자료",
  OPPORTUNITY: "기회와 권한",
};

/**
 * 플레이 진행 단계.
 *
 * 이 게임에는 제한 시간 규칙이 없다. 예전 HUD가 보여주던 구조선 도착 카운트다운은 어떤 규칙과도
 * 연결되지 않은 장식이라, 압박만 주고 정작 "지금 어디쯤인지"는 알려주지 못했다. 실제 진행 축인
 * 1일차 조사 → 2일차 조사 → 최종 추리를 대신 표시한다.
 */
const STAGES = [
  { id: "DAY1", short: "1일차", label: "1일차 조사" },
  { id: "DAY2", short: "2일차", label: "2일차 조사" },
  { id: "DEDUCTION", short: "추리", label: "최종 추리" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

/** 지금 단계. 재판과 결과 화면은 일차와 무관하게 추리 단계로 본다. */
function useStage(): StageId {
  const phase = useGameStore((state) => state.phase);
  const layer = useGameStore((state) => state.layer);
  if (layer === "trial" || layer === "result") return "DEDUCTION";
  return phase === "DAY2" ? "DAY2" : "DAY1";
}

/** 카운트다운이 있던 자리를 대신하는 진행 단계 표시기. */
function StageIndicator({ current }: { current: StageId }) {
  const currentIndex = STAGES.findIndex((stage) => stage.id === current);
  return (
    <div
      className="stage-indicator"
      aria-label={`진행 단계 · ${STAGES[currentIndex].label}`}
    >
      <span>진행 단계</span>
      <div>
        {STAGES.map((stage, index) => (
          <i
            key={stage.id}
            className={
              index === currentIndex ? "is-current" : index < currentIndex ? "is-done" : ""
            }
          >
            {stage.short}
          </i>
        ))}
      </div>
    </div>
  );
}

/**
 * 한글 조사를 골라 붙인다.
 *
 * 인물 이름과 단서 제목이 사건마다 달라서, 문장에 "이(가)" 같은 병기 표기를 그대로 두면
 * 화면에 그 괄호가 남는다. 마지막 글자의 종성 유무로 조사를 정한다. 한글 음절이 아니면
 * 판단할 수 없으므로 병기 표기로 물러난다.
 */
function particleFor(word: string, afterJongseong: string, afterVowel: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) {
    return `${afterJongseong}(${afterVowel})`;
  }
  return (code - 0xac00) % 28 === 0 ? afterVowel : afterJongseong;
}

function withParticle(word: string, afterJongseong: string, afterVowel: string): string {
  return `${word}${particleFor(word, afterJongseong, afterVowel)}`;
}

/** 서버 용의자 ID를 화면 표시용 정보로 옮긴다. 정적 로스터에 없으면 ID를 그대로 쓴다. */
function suspectProfile(id: string) {
  return (
    SUSPECTS.find((suspect) => suspect.id === id) ?? {
      id,
      name: id,
      role: "승무원",
      color: "#8f86e8",
    }
  );
}

/** 최종 추리 4축과 이론 초안 필드의 대응. 백엔드 판정 역할 이름을 그대로 쓴다. */
const THEORY_ROLE_FIELDS = [
  ["SETUP", "setup"],
  ["TRIGGER", "trigger"],
  ["OPPORTUNITY", "opportunity"],
  ["MOTIVE", "motive"],
] as const;

/** 이 사건의 용의자 목록. 서버가 알려준 명단을 우선한다. */
function useSuspects() {
  const suspectIds = useGameStore((state) => state.suspectIds);
  return useMemo(
    () => (suspectIds.length > 0 ? suspectIds.map(suspectProfile) : SUSPECTS),
    [suspectIds],
  );
}

function OpeningOverlay() {
  const beginInvestigation = useGameStore((state) => state.beginInvestigation);
  const syncCaseState = useGameStore((state) => state.syncCaseState);
  const caseBriefing = useGameStore((state) => state.caseBriefing);
  const [prepStage, setPrepStage] = useState<SessionPrepStage>("CREATING");
  const createSession = useCreateSession(setPrepStage);

  const enterStation = () => {
    setPrepStage("CREATING");
    createSession.mutate(undefined, {
      onSuccess: ({ session, caseState }) => {
        syncCaseState(caseState);
        beginInvestigation(session.sessionId, session.version);
      },
    });
  };

  // 사건 생성은 AI가 처음부터 만드는 작업이라 수십 초에서 2분까지 걸린다. 그 동안 진입 화면을
  // 그대로 두면 멈춘 것처럼 보이므로 전용 대기 화면으로 덮는다.
  if (createSession.isPending) return <CasePreparingOverlay stage={prepStage} />;

  return (
    <section className="opening-overlay" aria-label="사건 브리핑">
      <div className="opening-noise" />
      <header className="opening-header">
        <span>CORVIS CONSORTIUM // SECURITY CHANNEL 04</span>
        <span className="status-live"><i /> LIVE</span>
      </header>

      <div className="opening-content">
        <p className="opening-kicker">격리 프로토콜 발령 · D1 07:24</p>
        <h1>
          ARCADIA
          <span>INCIDENT 72</span>
        </h1>
        <div className="opening-rule" />
        {/* 사건 개요는 서버가 세션마다 생성한다. 아직 못 받았으면 격리 상황 안내를 보여준다. */}
        <p className="opening-lead">
          {caseBriefing ?? (
            <>
              사령관 다니엘 로스가 사망했다.
              <br />
              외부 통신은 두절됐고, 정거장에는 여섯 명이 남았다.
            </>
          )}
        </p>

        <dl className="brief-grid">
          <div>
            <dt>현장</dt>
            <dd>사령관실 CO · 01</dd>
          </div>
          <div>
            <dt>최초 발견자</dt>
            <dd>마야 헨드릭스</dd>
          </div>
          <div>
            <dt>잔류 인원</dt>
            <dd>생존 6명</dd>
          </div>
          <div>
            <dt>외부 통신</dt>
            <dd className="danger-text">완전 두절</dd>
          </div>
        </dl>

        <button className="primary-action" type="button" onClick={enterStation}>
          <span>보안 권한으로 현장 진입</span>
          <kbd>ENTER</kbd>
        </button>
        <p className="opening-guide-note">
          사건은 진입할 때마다 새로 생성됩니다. 현장에 들어가면 화면 요소를 하나씩 짚어 주는
          안내가 시작됩니다.
        </p>
        {createSession.isError && (
          <div className="opening-error" role="alert">
            <span>CONNECTION REFUSED</span>
            <p>{createSession.error.message}</p>
            <button type="button" onClick={enterStation}>채널 재시도</button>
          </div>
        )}
        <p className="opening-footnote">
          사건 기록 ARK-D1-0724 · 모든 조사 행위가 로컬 보안 장치에 기록됩니다.
        </p>
      </div>

      <aside className="opening-call">
        <div className="call-avatar">MH</div>
        <div>
          <span>긴급 호출 수신</span>
          <strong>마야 헨드릭스</strong>
          <p>“보안담당관, 즉시 사령관실로 와주세요.”</p>
        </div>
      </aside>

      <div className="opening-index">072</div>
    </section>
  );
}

/**
 * 사건 생성 단계별 진행 문구.
 *
 * 문구는 실제 백엔드 세션 상태(`CREATING` → `VALIDATING` → `READY`)에 붙어 있다. 가짜 진행률
 * 막대가 아니라 서버가 지금 실제로 하고 있는 일을 정거장 말투로 옮긴 것이다.
 */
const PREP_STORY: Record<SessionPrepStage, { caption: string; lines: string[] }> = {
  CREATING: {
    caption: "사건 파일 생성",
    lines: [
      "정거장 로그 복호화 중",
      "D-0 출입 이벤트 재정렬 중",
      "승무원 인사 기록 대조 중",
      "사망 추정 시각 구간 계산 중",
      "현장 물리 흔적 목록화 중",
    ],
  },
  VALIDATING: {
    caption: "사건 정합성 검증",
    lines: [
      "승무원 진술 패턴 분석 중",
      "알리바이 상호 대조 중",
      "단서 연결 그래프 점검 중",
      "단일 범인 성립 여부 확인 중",
    ],
  },
  READY: {
    caption: "브리핑 준비",
    lines: ["보안 채널 확보", "사건 파일 봉인 완료"],
  },
};

const PREP_TIPS = [
  "조사 표식에 다가가 E를 누르면 조사합니다.",
  "무엇을 조사할지 모르겠으면 Q로 주변을 스캔하세요.",
  "TAB으로 사건 수첩을 열어 확보한 증거를 확인합니다.",
  "사건마다 단서 배치가 달라서, 아무것도 나오지 않는 오브젝트도 있습니다.",
  "승무원에게 확보한 증거를 제시하면 진술이 달라집니다.",
  "현장에서 못 찾는 기록은 수첩의 수사 보조에서 검색할 수 있습니다.",
];

const PREP_LOG_INTERVAL_MS = 2_400;
const PREP_TIP_INTERVAL_MS = 6_000;
/** 이 시간을 넘기면 오래 걸린다는 사실을 먼저 알려 준다. */
const PREP_LONG_WAIT_SECONDS = 45;

/** 사건이 만들어지는 동안 보여 주는 대기 화면. */
function CasePreparingOverlay({ stage }: { stage: SessionPrepStage }) {
  const [log, setLog] = useState<string[]>([]);
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const stageIndex = Object.keys(PREP_STORY).indexOf(stage);

  // 단계가 바뀌면 그 단계의 문구를 순서대로 흘린다. 지나간 기록은 지우지 않고 이어 붙인다.
  useEffect(() => {
    const { lines } = PREP_STORY[stage];
    const append = (line: string) =>
      setLog((current) =>
        current[current.length - 1] === line ? current : [...current, line],
      );

    append(lines[0]);
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      if (index >= lines.length) return;
      append(lines[index]);
    }, PREP_LOG_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    const tipTimer = window.setInterval(
      () => setTipIndex((current) => (current + 1) % PREP_TIPS.length),
      PREP_TIP_INTERVAL_MS,
    );
    const clockTimer = window.setInterval(() => setElapsed((current) => current + 1), 1_000);
    return () => {
      window.clearInterval(tipTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  return (
    <section className="case-prep" role="status" aria-live="polite" aria-label="사건 생성 중">
      <div className="case-prep-sweep" />
      <div className="case-prep-body">
        <span className="case-prep-kicker">
          CASE SYNTHESIS // {PREP_STORY[stage].caption}
        </span>
        <h2>사건 파일을 만들고 있습니다</h2>
        <p>
          아르카디아의 사건은 매번 새로 생성됩니다. 범인도, 단서 배치도, 승무원이 감추는 것도
          지난번과 같지 않습니다.
        </p>

        <div className="case-prep-steps">
          {Object.entries(PREP_STORY).map(([key, value], index) => (
            <div
              key={key}
              className={
                index === stageIndex ? "is-current" : index < stageIndex ? "is-done" : ""
              }
            >
              <i />
              <span>{value.caption}</span>
            </div>
          ))}
        </div>

        <ol className="case-prep-log">
          {log.slice(-5).map((line, index, visible) => (
            <li key={`${line}-${index}`} className={index === visible.length - 1 ? "is-active" : ""}>
              {line}
            </li>
          ))}
        </ol>

        <div className="case-prep-tip">
          <span>TIP</span>
          <p>{PREP_TIPS[tipIndex]}</p>
        </div>

        <small className="case-prep-clock">
          경과 {minutes}:{seconds}
          {elapsed >= PREP_LONG_WAIT_SECONDS && " · 사건 생성에는 최대 2분까지 걸릴 수 있습니다"}
        </small>
      </div>
    </section>
  );
}

/** 1일차를 넘기는 데 필요한 최소 심문 인원. `openDayReview`의 게이트와 같이 유지한다. */
const REQUIRED_INTERVIEWS = 3;

/**
 * 지금 무엇을 해야 하는지 한 문장으로 알려 준다.
 *
 * 예전 문구는 "사령관실 현장 보존"처럼 임무 이름이라 상황 설명으로 읽혔다. 처음 하는 사람이
 * 읽고 바로 손을 움직일 수 있도록 필요한 조작과 조건을 그대로 적는다.
 */
function describeObjective(context: {
  stage: StageId;
  recordsComplete: boolean;
  interviewCount: number;
  readyForReview: boolean;
}): { title: string; body: string } {
  if (context.stage === "DEDUCTION") {
    return {
      title: "모은 증거로 범인을 지목하세요",
      body:
        "준비·실행·기회·동기를 각각 다른 증거로 연결하고, 나머지 승무원을 배제할 근거까지 제시합니다.",
    };
  }
  if (context.stage === "DAY2") {
    return {
      title: "기록을 교차 검증하세요",
      body:
        "새로 열린 구역을 조사하고 1일차 진술과 대조해 모순을 찾습니다. 정리되면 TAB을 눌러 사건 재구성에서 범인을 지목하세요.",
    };
  }
  if (context.readyForReview) {
    return {
      title: "1일차 조사를 마감하세요",
      body: "필요한 기록과 진술을 모두 확보했습니다. 아래 버튼으로 2일차 심층 조사에 들어갑니다.",
    };
  }
  if (context.recordsComplete) {
    return {
      title: "승무원을 심문하세요",
      body: `각 구역에 흩어진 승무원에게 다가가 E로 말을 겁니다. 1일차에는 ${REQUIRED_INTERVIEWS}명 이상 심문해야 합니다.`,
    };
  }
  return {
    title: "정거장을 탐색해 증거를 찾으세요",
    body:
      "WASD로 걸으며 마름모 표식에 다가가 E로 조사합니다. 붉은 표식이 1일차 필수 기록이고, 무엇을 조사할지 모르겠으면 Q로 주변을 스캔하세요.",
  };
}

function MissionHud() {
  const openSettings = useSettingsStore((state) => state.setOpen);
  const openGuide = useSettingsStore((state) => state.setGuideOpen);
  const focusedId = useGameStore((state) => state.focusedId);
  const discoveredIds = useGameStore((state) => state.discoveredIds);
  const hasMoved = useGameStore((state) => state.hasMoved);
  const interviewedIds = useGameStore((state) => state.interviewedIds);
  const activateScan = useGameStore((state) => state.activateScan);
  const toggleNotebook = useGameStore((state) => state.toggleNotebook);
  const openDayReview = useGameStore((state) => state.openDayReview);
  const stage = useStage();
  const progress = getRequiredProgress(discoveredIds);
  const interviewCount = Math.min(interviewedIds.length, REQUIRED_INTERVIEWS);
  const readyForReview = progress.complete && interviewedIds.length >= REQUIRED_INTERVIEWS;
  const objective = describeObjective({
    stage,
    recordsComplete: progress.complete,
    interviewCount: interviewedIds.length,
    readyForReview,
  });
  const focused = focusedId ? INVESTIGATION_OBJECTS[focusedId] : null;

  return (
    <div className="hud-layer">
      <div className="hud-topline">
        <div className="hud-brand">
          <i />
          <div>
            <span>ARK SECURITY</span>
            <strong>INCIDENT // 072</strong>
          </div>
        </div>
        <StageIndicator current={stage} />
      </div>

      <aside className="objective-panel" data-tour="objective">
        <header>
          <span>지금 할 일</span>
          <em>{STAGES.find((item) => item.id === stage)?.label}</em>
        </header>
        <h2>{objective.title}</h2>
        <p>{objective.body}</p>
        {stage !== "DEDUCTION" && (
          <>
            <div className="objective-progress">
              <span style={{ width: `${(progress.found / progress.total) * 100}%` }} />
            </div>
            <small>
              증거 기록 {String(progress.found).padStart(2, "0")} /{" "}
              {String(progress.total).padStart(2, "0")}
            </small>
            <div className="objective-progress">
              <span
                style={{ width: `${(interviewCount / REQUIRED_INTERVIEWS) * 100}%` }}
              />
            </div>
            <small>
              승무원 심문 {String(interviewCount).padStart(2, "0")} /{" "}
              {String(REQUIRED_INTERVIEWS).padStart(2, "0")}
            </small>
          </>
        )}
        {stage === "DAY1" && readyForReview && (
          <button className="day-review-action" type="button" onClick={openDayReview}>
            1일차 조사 마감
          </button>
        )}
      </aside>

      {/* 조준점이 있던 자리. 탑다운에는 시선이 없으므로 가까이 간 대상만 알려 준다. */}
      <div className="interaction-prompt" data-tour="prompt" hidden={!focused}>
        {focused && (
          <>
            <kbd>E</kbd>
            <div>
              <span>{KIND_LABELS[focused.kind]}</span>
              <strong>{focused.title}</strong>
            </div>
          </>
        )}
      </div>

      <div className="hud-controls">
        {!hasMoved && <span><kbd>WASD</kbd> 이동</span>}
        <button type="button" data-tour="scan" onClick={activateScan}>
          <kbd>Q</kbd> 조사 스캔
        </button>
        <button
          className="notebook-trigger"
          type="button"
          data-tour="notebook"
          onClick={toggleNotebook}
        >
          <kbd>TAB</kbd> 사건 수첩
        </button>
      </div>

      <div className="hud-system-actions" data-tour="system">
        <button
          className="guide-trigger"
          type="button"
          aria-label="플레이 안내 열기"
          onClick={() => openGuide(true)}
        >
          안내 <kbd>?</kbd>
        </button>
        <button
          className="settings-trigger"
          type="button"
          aria-label="설정 열기"
          onClick={() => openSettings(true)}
        >
          SYS <kbd>ESC</kbd>
        </button>
      </div>

      <div className="signal-meter">
        <span>EXTERNAL LINK</span>
        <div><i /><i /><i /><i /><i /></div>
        <strong>NO SIGNAL</strong>
      </div>
    </div>
  );
}

/**
 * 조사 패널.
 *
 * 오브젝트의 이름과 위치는 3D 소품의 물리적 정체성이라 프런트엔드가 갖고 있지만, 조사해서
 * 얻는 기록은 전부 서버가 생성한 사건 단서다. 사건마다 단서 배치가 달라 아무것도 나오지 않는
 * 오브젝트가 있고, 그건 오류가 아니다.
 */
function InspectionPanel() {
  const sessionId = useGameStore((state) => state.sessionId);
  const updateSessionVersion = useGameStore((state) => state.updateSessionVersion);
  const selectedId = useGameStore((state) => state.selectedId);
  const discoveredIds = useGameStore((state) => state.discoveredIds);
  const evidence = useGameStore((state) => state.evidence);
  const closeOverlay = useGameStore((state) => state.closeOverlay);
  const markInspected = useGameStore((state) => state.markInspected);
  const recordEvidence = useGameStore((state) => state.recordEvidence);
  const inspectObject = useInspectObject(sessionId);
  const item = selectedId ? INVESTIGATION_OBJECTS[selectedId] : null;

  if (!item) return null;

  const isInspected = discoveredIds.includes(item.id);
  const found = evidence.filter((record) => record.sourceObjectId === item.id);

  return (
    <section className="inspection-shell" aria-label={`${item.title} 조사`}>
      <button className="overlay-scrim" aria-label="조사 화면 닫기" onClick={closeOverlay} />
      <article className="inspection-card">
        <header className="inspection-card__head">
          <div>
            <span>{item.eyebrow}</span>
            <small>{item.zone} // {item.id}</small>
          </div>
          <button type="button" onClick={closeOverlay} aria-label="닫기">×</button>
        </header>

        <div className="inspection-visual">
          <div className={`evidence-glyph evidence-glyph--${item.kind.toLowerCase()}`}>
            <i />
            <span>{item.id.slice(-2)}</span>
          </div>
          <div className="scan-lines" />
          <span className="inspection-kind">{KIND_LABELS[item.kind]}</span>
        </div>

        <div className="inspection-copy">
          <p className="inspection-index">OBSERVATION // {item.id}</p>
          <h2>{item.title}</h2>

          {!isInspected && (
            <p className="inspection-summary">
              아직 조사하지 않았습니다. 정밀 조사로 사건 기록을 확인하십시오.
            </p>
          )}

          {isInspected && found.length === 0 && (
            <p className="inspection-summary">
              이곳에서는 이번 사건과 연결되는 기록을 찾지 못했습니다. 새 기록을 확보한 뒤
              다시 조사하면 놓쳤던 흔적이 보일 수 있습니다.
            </p>
          )}

          {found.map((record) => (
            <div className="inspection-detail" key={record.clueId}>
              <span>{EVIDENCE_TYPE_LABELS[record.clueType]} · {record.title}</span>
              <p>{record.playerText}</p>
              {/* 이 기록을 무엇과 맞춰 봐야 하는지 여기서 바로 알려 준다. 정답은 알려주지 않는다. */}
              <EvidenceContext record={record} evidence={evidence} />
            </div>
          ))}
        </div>

        <footer>
          <div>
            <span>확보 기록</span>
            <strong>{isInspected ? `${found.length}건` : "조사 전"}</strong>
          </div>
          {/* 검색으로 선행 기록을 얻으면 이미 조사한 방에서 새 흔적이 열릴 수 있어 재조사를 막지 않는다. */}
          <button
            className={isInspected ? "record-action is-recorded" : "record-action"}
            type="button"
            disabled={inspectObject.isPending}
            onClick={() =>
              inspectObject.mutate(item.id, {
                onSuccess: (result) => {
                  updateSessionVersion(result.version);
                  recordEvidence(result.discoveredEvidence);
                  markInspected(item.id);
                },
              })
            }
          >
            {inspectObject.isPending
              ? "보안 기록 조회 중"
              : isInspected
                ? "다시 조사"
                : "정밀 조사"}
          </button>
          {inspectObject.isError && (
            <small className="inline-error" role="alert">{inspectObject.error.message}</small>
          )}
        </footer>
      </article>
    </section>
  );
}

const NOTEBOOK_TABS: Array<{ id: NotebookTab; label: string; index: string }> = [
  { id: "evidence", label: "증거", index: "01" },
  { id: "timeline", label: "타임라인", index: "02" },
  { id: "suspects", label: "용의자", index: "03" },
  { id: "assistant", label: "수사 보조", index: "04" },
  { id: "theory", label: "사건 재구성", index: "05" },
];

/**
 * 플레이어가 증거에 붙이는 후보 역할.
 *
 * 서버는 어느 증거가 어느 역할의 정답인지 내려주지 않는다. 그 값이 곧 판정 기준이라 그대로
 * 보여주면 최종 추리가 사라진다. 대신 플레이어가 직접 표시하고, 그 표시로 사건 재구성의
 * 긴 목록을 좁힌다. 실제 사건은 증거가 열네 장 넘게 쌓인다.
 */
const EVIDENCE_TAG_LABELS: Record<EvidenceTag, string> = {
  SETUP: "준비",
  TRIGGER: "실행",
  OPPORTUNITY: "기회",
  MOTIVE: "동기",
  EXCLUSION: "배제",
};

const EVIDENCE_TAGS = Object.keys(EVIDENCE_TAG_LABELS) as EvidenceTag[];

const SUSPECT_EFFECT_LABELS: Record<string, string> = {
  SUPPORTS: "혐의를 뒷받침",
  EXCLUDES: "혐의에서 배제",
  NEUTRAL: "판단 보류",
};

/**
 * 증거 한 장이 사건 안에서 갖는 위치.
 *
 * 서버가 알려주는 것은 세 가지다. 이 기록이 말해 주는 사실, 같은 사실을 가리키는 다른 기록,
 * 그리고 아직 맞물리지 않은 데가 남았는지. 어느 역할의 정답인지는 알려주지 않는다.
 */
function EvidenceContext({
  record,
  evidence,
  onSelect,
}: {
  record: DiscoveredEvidence;
  evidence: DiscoveredEvidence[];
  onSelect?: (clueId: string) => void;
}) {
  const links = record.linkedClueIds
    .map((clueId) => evidence.find((item) => item.clueId === clueId))
    .filter((item): item is DiscoveredEvidence => Boolean(item));

  if (
    links.length === 0 &&
    record.revealedFacts.length === 0 &&
    record.suspectEffects.length === 0 &&
    !record.hasPendingConnection
  ) {
    return null;
  }

  return (
    <div className="evidence-context">
      {record.revealedFacts.length > 0 && (
        <div className="evidence-facts">
          <span>이 기록이 말해 주는 것</span>
          <ul>
            {record.revealedFacts.map((fact) => (
              <li key={fact.factId}>{fact.statement}</li>
            ))}
          </ul>
        </div>
      )}

      {record.suspectEffects.length > 0 && (
        <div className="evidence-effects">
          {record.suspectEffects.map((effect) => (
            <em
              key={`${effect.characterId}-${effect.effect}`}
              className={`is-${effect.effect.toLowerCase()}`}
            >
              {suspectProfile(effect.characterId).name} · {SUSPECT_EFFECT_LABELS[effect.effect]}
            </em>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <div className="evidence-links">
          <span>같은 사실을 가리키는 기록</span>
          <div>
            {links.map((link) => (
              <button
                key={link.clueId}
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(link.clueId)}
              >
                {link.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {record.hasPendingConnection && (
        <p className="evidence-pending">
          이 기록은 아직 다른 기록과 맞물리지 않았습니다. 짝이 되는 자료를 더 찾으면 새로운 사실이
          드러납니다.
        </p>
      )}
    </div>
  );
}

function EvidenceTab({ evidence }: { evidence: DiscoveredEvidence[] }) {
  const [focusedClueId, setFocusedClueId] = useState<string | null>(null);
  const evidenceTags = useGameStore((state) => state.evidenceTags);
  const toggleEvidenceTag = useGameStore((state) => state.toggleEvidenceTag);

  if (evidence.length === 0) {
    return (
      <div className="notebook-empty">
        <span>NO EVIDENCE LOGGED</span>
        <h3>확보한 기록이 없습니다.</h3>
        <p>현장 오브젝트를 조사하거나 수사 보조로 사건 기록을 검색하십시오.</p>
      </div>
    );
  }

  const focused = evidence.find((record) => record.clueId === focusedClueId) ?? null;
  const relatedIds = new Set(focused?.linkedClueIds ?? []);
  const untagged = evidence.filter(
    (record) => (evidenceTags[record.clueId] ?? []).length === 0,
  ).length;

  return (
    <>
    <div className="evidence-toolbar">
      <p>
        이 기록을 어디에 쓸지 직접 표시해 두면, 사건 재구성에서 그 표시로 목록이 좁혀집니다.
      </p>
      <strong className={untagged === 0 ? "is-clear" : ""}>미분류 {untagged}건</strong>
    </div>
    <div className="evidence-grid">
      {evidence.map((record, index) => {
        const source = record.sourceObjectId
          ? INVESTIGATION_OBJECTS[record.sourceObjectId]
          : null;
        const kindClass = record.clueType.toLowerCase();
        const isFocused = record.clueId === focusedClueId;
        return (
          <article
            className={[
              "evidence-card",
              isFocused ? "is-focused" : "",
              // 고른 기록과 같은 사실을 가리키는 카드를 함께 밝힌다.
              focused && relatedIds.has(record.clueId) ? "is-linked" : "",
              focused && !isFocused && !relatedIds.has(record.clueId) ? "is-dimmed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={record.clueId}
          >
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <em>{EVIDENCE_TYPE_LABELS[record.clueType]}</em>
              {record.isCore && <b className="evidence-core">핵심</b>}
            </header>
            <div className={`evidence-card__mark evidence-card__mark--${kindClass}`} />
            <small>{source ? `${source.zone} · ${source.title}` : "사건 기록 검색"}</small>
            <h3>{record.title}</h3>
            <p>{record.playerText}</p>
            <EvidenceContext
              record={record}
              evidence={evidence}
              onSelect={(clueId) => setFocusedClueId(clueId)}
            />
            <div className="evidence-tags" role="group" aria-label={`${record.title} 후보 역할`}>
              {EVIDENCE_TAGS.map((tag) => {
                const on = (evidenceTags[record.clueId] ?? []).includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={on ? "is-on" : ""}
                    aria-pressed={on}
                    onClick={() => toggleEvidenceTag(record.clueId, tag)}
                  >
                    {EVIDENCE_TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>
            <footer>
              <button
                type="button"
                className="evidence-focus-toggle"
                onClick={() => setFocusedClueId(isFocused ? null : record.clueId)}
              >
                {isFocused ? "연결 표시 끄기" : "연결 보기"}
              </button>
              <span>{record.clueId}</span>
            </footer>
          </article>
        );
      })}
    </div>
    </>
  );
}

function TimelineTab() {
  return (
    <div className="timeline-list">
      {TIMELINE.map((event, index) => (
        <article key={`${event.time}-${event.title}`}>
          <div className="timeline-node">
            <i className={index === TIMELINE.length - 1 ? "is-current" : ""} />
          </div>
          <time>{event.time}</time>
          <div>
            <h3>{event.title}</h3>
            <p>{event.detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function SuspectsTab() {
  const interviewedIds = useGameStore((state) => state.interviewedIds);
  const suspects = useSuspects();
  return (
    <div className="suspect-list">
      {suspects.map((suspect, index) => (
        <article key={suspect.id}>
          <div className="suspect-number" style={{ "--suspect": suspect.color } as React.CSSProperties}>
            <Portrait id={suspect.id} rim={false} />
            <b>{String(index + 1).padStart(2, "0")}</b>
          </div>
          <div>
            <span>{suspect.role}</span>
            <h3>{suspect.name}</h3>
          </div>
          <dl>
            <div>
              <dt>진술</dt>
              <dd>{interviewedIds.includes(`NPC_${suspect.id}`) ? "1차 확보" : "미확보"}</dd>
            </div>
            <div><dt>알리바이</dt><dd>검증 전</dd></div>
          </dl>
          <button type="button" disabled>
            {interviewedIds.includes(`NPC_${suspect.id}`) ? "진술 기록됨" : "심문 필요"}
          </button>
        </article>
      ))}
    </div>
  );
}

const ASSISTANT_QUERIES = [
  "02시 전후의 환경 제어 기록을 시간순으로 비교해줘.",
  "출입 기록과 각 구역 원본 사이의 모순을 찾아줘.",
  "현재 증거만으로 확인할 수 없는 부분을 알려줘.",
];

function AssistantTab() {
  const sessionId = useGameStore((state) => state.sessionId);
  const evidence = useGameStore((state) => state.evidence);
  const [query, setQuery] = useState(ASSISTANT_QUERIES[0]);
  const assistant = useAskAssistant(sessionId);
  const caseState = useCaseState(sessionId);
  const submit = (nextQuery = query) => {
    const normalized = nextQuery.trim();
    if (!normalized) return;
    setQuery(normalized);
    assistant.mutate(
      { query: normalized, discoveredEvidenceIds: evidence.map((record) => record.clueId) },
      // 검색으로 새 단서가 열릴 수 있다. 서버 공개 상태를 다시 읽어 수첩을 맞춘다.
      { onSuccess: () => void caseState.refetch() },
    );
  };

  return (
    <div className="assistant-console">
      <header>
        <div>
          <span>LOCAL EVIDENCE INDEX // READ ONLY</span>
          <h3>아르카디아 수사 보조</h3>
        </div>
        <strong>{evidence.length} RECORDS AVAILABLE</strong>
      </header>

      <div className="assistant-presets">
        {ASSISTANT_QUERIES.map((preset) => (
          <button type="button" key={preset} onClick={() => submit(preset)}>
            {preset}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="assistant-query">발견한 기록에 질문</label>
        <div>
          <input
            id="assistant-query"
            value={query}
            maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={!query.trim() || assistant.isPending}>
            {assistant.isPending ? "검색 중" : "기록 비교"}
          </button>
        </div>
      </form>

      {assistant.isError && (
        <article className="assistant-answer is-fallback" role="status">
          <span>STATIC FALLBACK // AI OFFLINE</span>
          <h4>자동 비교를 완료하지 못했습니다.</h4>
          <p>
            증거 탭에서 시간·구역·접근 주체를 직접 대조할 수 있습니다. 핵심 단서
            획득과 재판 진행은 수사 보조 상태와 무관합니다.
          </p>
          <button type="button" onClick={() => submit()}>다시 검색</button>
        </article>
      )}

      {assistant.data && (
        <article className="assistant-answer" aria-live="polite">
          <span>{assistant.data.fallback ? "STATIC FALLBACK" : "SUPPORTED FINDING"}</span>
          <h4>{assistant.data.summary}</h4>
          <p>{assistant.data.observation}</p>
          <div>
            {assistant.data.citations.map((id) => (
              <button
                type="button"
                key={id}
                onClick={() => useGameStore.getState().setNotebookTab("evidence")}
              >
                {evidence.find((record) => record.clueId === id)?.title ?? id}
              </button>
            ))}
          </div>
          {assistant.data.suggestedQuery && (
            <button type="button" onClick={() => submit(assistant.data!.suggestedQuery!)}>
              후속 질문 · {assistant.data.suggestedQuery}
            </button>
          )}
        </article>
      )}
    </div>
  );
}

/** 각 축이 세우는 주장. 증거가 무엇을 받쳐야 하는지 문장으로 못박는다. */
const ROLE_CLAIMS: Record<string, string> = {
  SETUP: "범인이 이 죽음을 미리 준비했다.",
  TRIGGER: "이 시점에 범행이 실행됐다.",
  OPPORTUNITY: "범인에게 그럴 기회와 권한이 있었다.",
  MOTIVE: "범인에게 죽여야 할 이유가 있었다.",
};

/** 논증 한 줄의 판정 상태. 연결선 색과 꼬리표가 여기서 갈린다. */
type BoardMark = "EMPTY" | "LINKED" | "CORRECT" | "INSUFFICIENT";

/**
 * 논증 보드 한 줄.
 *
 * 왼쪽에 주장, 오른쪽에 그 주장을 받치는 기록, 사이에 연결선을 둔다. 예전 화면은 드롭다운만
 * 나열해서 무엇을 골랐는지도, 그게 어떤 주장을 받치는지도 보이지 않았다.
 *
 * 연결선은 SVG 오버레이가 아니라 격자 가운데 칸이다. 위치를 재지 않으므로 스크롤·창 크기
 * 변화에 어긋나지 않고, 좁은 화면에서는 같은 구조가 세로로 떨어진다.
 */
function BoardRow({
  code,
  claim,
  statement,
  picker,
  evidence,
  mark,
  accent,
}: {
  code: string;
  claim: string;
  statement: string;
  picker: React.ReactNode;
  evidence: DiscoveredEvidence | undefined;
  mark: BoardMark;
  accent?: string;
}) {
  const source = evidence?.sourceObjectId
    ? INVESTIGATION_OBJECTS[evidence.sourceObjectId]
    : null;

  return (
    <div
      className={`board-row is-${mark.toLowerCase()}`}
      style={accent ? ({ "--suspect": accent } as React.CSSProperties) : undefined}
    >
      <div className="board-claim">
        <span>{code}</span>
        <strong>{claim}</strong>
        <p>{statement}</p>
        {picker}
      </div>

      <div className="board-link" aria-hidden="true">
        <i />
        {mark === "INSUFFICIENT" && <em>부족</em>}
        {mark === "CORRECT" && <em>성립</em>}
      </div>

      <div className="board-evidence">
        {evidence ? (
          <>
            <header>
              <span>{EVIDENCE_TYPE_LABELS[evidence.clueType]}</span>
              <small>{source ? `${source.zone} · ${source.title}` : "사건 기록 검색"}</small>
            </header>
            <h4>{evidence.title}</h4>
            {evidence.revealedFacts.length > 0 ? (
              <ul>
                {evidence.revealedFacts.map((fact) => (
                  <li key={fact.factId}>{fact.statement}</li>
                ))}
              </ul>
            ) : (
              <p>{evidence.playerText}</p>
            )}
          </>
        ) : (
          <div className="board-empty">
            <i />
            받쳐 줄 기록이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function TheoryTab() {
  const sessionId = useGameStore((state) => state.sessionId);
  const sessionVersion = useGameStore((state) => state.sessionVersion);
  const phase = useGameStore((state) => state.phase);
  const theory = useGameStore((state) => state.theory);
  const evidence = useGameStore((state) => state.evidence);
  const evidenceTags = useGameStore((state) => state.evidenceTags);
  const suspects = useSuspects();
  const updateSessionVersion = useGameStore((state) => state.updateSessionVersion);
  const setTheorySuspect = useGameStore((state) => state.setTheorySuspect);
  const setTheoryEvidence = useGameStore((state) => state.setTheoryEvidence);
  const setTheoryExclusion = useGameStore((state) => state.setTheoryExclusion);
  const startTrial = useGameStore((state) => state.startTrial);
  const judgement = useGameStore((state) => state.verdictJudgement);
  const saveTheory = useSaveTheory(sessionId);

  const otherSuspects = suspects.filter((suspect) => suspect.id !== theory.suspectId);
  const accused = suspects.find((suspect) => suspect.id === theory.suspectId) ?? null;
  const findEvidence = (clueId: string | null | undefined) =>
    clueId ? evidence.find((record) => record.clueId === clueId) : undefined;

  // 직전 판정이 남아 있고 아직 정답이 아니면 그 결과를 선 위에 그대로 보여준다. 어느 기록이
  // 정답인지는 여전히 알려주지 않고, 내가 세운 연결이 성립했는지만 표시한다.
  const showMarks = Boolean(judgement) && judgement?.verdict !== "CORRECT";
  const roleMark = (role: string): BoardMark => {
    const clueId = theory[ROLE_SOURCE_FIELD[role as keyof typeof ROLE_SOURCE_FIELD]];
    if (!clueId) return "EMPTY";
    if (!showMarks) return "LINKED";
    return judgement?.roleResults[role] === "INCORRECT" ? "INSUFFICIENT" : "CORRECT";
  };
  const exclusionMark = (characterId: string): BoardMark => {
    if (!theory.exclusions[characterId]) return "EMPTY";
    if (!showMarks) return "LINKED";
    const mark = judgement?.exclusionResults[characterId];
    if (!mark) return "LINKED";
    return mark === "INSUFFICIENT" ? "INSUFFICIENT" : "CORRECT";
  };

  const validation = validateTheory(
    theory,
    evidence.map((record) => record.clueId),
    suspects.map((suspect) => suspect.id),
  );
  const ready = phase === "DAY2" && validation.valid;
  const submitTheory = () => {
    if (!ready) return;
    saveTheory.mutate(
      { theory, version: sessionVersion },
      {
        onSuccess: ({ version }) => {
          updateSessionVersion(version);
          startTrial();
        },
      },
    );
  };

  if (phase !== "DAY2") {
    return (
      <div className="theory-locked">
        <span>RECONSTRUCTION LOCKED</span>
        <i />
        <h3>D2 심층 조사 이후 개방됩니다.</h3>
        <p>첫날 현장 기록과 용의자 진술을 먼저 확보하십시오.</p>
      </div>
    );
  }

  /**
   * 역할별 기록 선택기.
   *
   * 실제 사건은 증거가 열네 장 넘게 쌓여서, 여덟 개 칸마다 전체 목록을 훑는 건 사실상 불가능하다.
   * 증거 탭에서 플레이어가 그 역할 후보로 표시해 둔 기록이 있으면 그것만 보여주고, 표시가
   * 하나도 없으면 전체를 그대로 보여준다. 표시는 판정에 아무 영향도 주지 않는다.
   */
  const evidenceOptions = (
    value: string | null,
    onChange: (id: string) => void,
    tag?: EvidenceTag,
  ) => {
    const tagged = tag
      ? evidence.filter((record) => (evidenceTags[record.clueId] ?? []).includes(tag))
      : [];
    const selected = evidence.find((record) => record.clueId === value);
    const options =
      tagged.length === 0
        ? evidence
        : selected && !tagged.some((record) => record.clueId === selected.clueId)
          ? [...tagged, selected]
          : tagged;

    return (
      <>
        <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>기록 선택</option>
          {options.map((record) => (
            <option key={record.clueId} value={record.clueId}>
              [{EVIDENCE_TYPE_LABELS[record.clueType]}] {record.title}
            </option>
          ))}
        </select>
        {tagged.length > 0 && (
          <small className="theory-filter-note">
            내가 {withParticle(EVIDENCE_TAG_LABELS[tag!], "으로", "로")} 표시한 {tagged.length}건만 보는 중
          </small>
        )}
      </>
    );
  };

  return (
    <div className="theory-builder">
      {/* 재판에서 부족하다고 판정받은 축을 여기서 다시 짚어 준다. 어느 기록이 정답인지는 없다. */}
      {judgement && judgement.verdict !== "CORRECT" && judgement.remainingAttempts > 0 && (
        <section className="theory-verdict-note" role="status">
          <header>
            <span>LAST RULING · 남은 기회 {judgement.remainingAttempts}회</span>
            <strong>{judgement.feedback}</strong>
          </header>
          <ul>
            {judgement.missingLogic.map((item, index) => (
              <li key={`${item.code}-${item.role ?? item.characterId ?? index}`}>
                {item.characterId
                  ? `${withParticle(suspectProfile(item.characterId).name, "을", "를")} 배제할 근거가 부족합니다.`
                  : item.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="theory-accused">
        <header>
          <span>01 // ACCUSED</span>
          <h3>범인 지목</h3>
          <p>범행 조건을 모두 만족하는 한 명을 선택합니다.</p>
        </header>
        <div>
          {suspects.map((suspect) => (
            <button
              key={suspect.id}
              type="button"
              className={theory.suspectId === suspect.id ? "is-selected" : ""}
              style={{ "--suspect": suspect.color } as React.CSSProperties}
              onClick={() => setTheorySuspect(suspect.id)}
            >
              <i>{suspect.name.slice(0, 1)}</i>
              <span>{suspect.role}</span>
              <strong>{suspect.name}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="theory-board">
        <header>
          <span>02 // ARGUMENT BOARD</span>
          <h3>논증 구성</h3>
          <p>
            각 주장이 어느 기록에 기대고 있는지 선으로 잇습니다. 끊긴 선은 아직 받쳐 줄 기록이
            없다는 뜻입니다.
          </p>
        </header>

        {accused && (
          <div className="board-conclusion">
            <span>CONCLUSION</span>
            <strong>{withParticle(accused.name, "이", "가")} 로스 사령관을 살해했다.</strong>
            <small>아래 주장이 모두 기록으로 받쳐져야 재판을 열 수 있습니다.</small>
          </div>
        )}

        <div className="board-rows">
          {THEORY_ROLE_FIELDS.map(([role, field]) => (
            <BoardRow
              key={role}
              code={role}
              claim={ROLE_LABELS[role]}
              statement={ROLE_CLAIMS[role]}
              evidence={findEvidence(theory[field])}
              mark={roleMark(role)}
              picker={evidenceOptions(
                theory[field],
                (id) => setTheoryEvidence(field, id),
                role,
              )}
            />
          ))}
        </div>

        <div className="board-divider">
          <span>다른 용의자 배제</span>
          <small>권한 부재가 아닌 알리바이·전문성·물리 흔적으로 배제합니다.</small>
        </div>

        {!theory.suspectId ? (
          <div className="theory-placeholder">범인을 먼저 지목하십시오.</div>
        ) : (
          <div className="board-rows">
            {otherSuspects.map((suspect) => (
              <BoardRow
                key={suspect.id}
                code="EXCLUSION"
                claim={suspect.name}
                statement={`${withParticle(suspect.name, "은", "는")} 이 사건에서 배제된다.`}
                accent={suspect.color}
                evidence={findEvidence(theory.exclusions[suspect.id] ?? null)}
                mark={exclusionMark(suspect.id)}
                picker={evidenceOptions(
                  theory.exclusions[suspect.id] ?? null,
                  (id) => setTheoryExclusion(suspect.id, id),
                  "EXCLUSION",
                )}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="theory-submit">
        <div>
          <span>TRIAL READINESS</span>
          <strong>{ready ? "재판 준비 완료" : validation.message}</strong>
        </div>
        {saveTheory.isError && (
          <p className="inline-api-error" role="alert">{saveTheory.error.message}</p>
        )}
        <button
          type="button"
          disabled={!ready || saveTheory.isPending}
          onClick={submitTheory}
        >
          {saveTheory.isPending ? "사건 재구성 봉인 중" : "D3 생존자 재판 시작"} <i>→</i>
        </button>
      </footer>
    </div>
  );
}

/** 심문 한 번의 문답. `answer`가 null이면 응답을 기다리는 중이다. */
type InterrogationTurn = {
  id: number;
  kind: "choice" | "free" | "evidence";
  question: string;
  answer: string | null;
};

function InterrogationPanel() {
  const subtitles = useSettingsStore((state) => state.subtitles);
  const sessionId = useGameStore((state) => state.sessionId);
  const selectedId = useGameStore((state) => state.selectedId);
  const evidence = useGameStore((state) => state.evidence);
  const closeOverlay = useGameStore((state) => state.closeOverlay);
  const markInterviewed = useGameStore((state) => state.markInterviewed);
  const updateSessionVersion = useGameStore((state) => state.updateSessionVersion);
  const [turns, setTurns] = useState<InterrogationTurn[]>([]);
  /** 서버가 방금 답변에 이어 제안한 질문. 두 번째 질문부터는 이 목록을 선택지로 쓴다. */
  const [followUps, setFollowUps] = useState<RecommendedQuestion[]>([]);
  const [activeChoice, setActiveChoice] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [freeQuestion, setFreeQuestion] = useState("");
  const turnIdRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const target = selectedId ? INVESTIGATION_OBJECTS[selectedId] : null;
  const dialogue = selectedId ? NPC_DIALOGUE[selectedId] : null;
  const interrogation = useInterrogationSession(sessionId, selectedId);
  const sendMessage = useSendInterrogationMessage(
    interrogation.data?.interrogationId ?? null,
  );

  useEffect(() => {
    setTurns([]);
    setFollowUps([]);
    setActiveChoice(null);
    setShowEvidence(false);
    setFreeQuestion("");
    turnIdRef.current = 0;
  }, [selectedId]);

  // 새 답변이 도착하면 대화 기록의 끝으로 따라간다.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  if (!target || !dialogue || !selectedId) return null;

  const npcId = selectedId;

  /** 질문을 기록에 먼저 남기고, 답변이 오면 그 자리를 채운다. */
  const openTurn = (kind: InterrogationTurn["kind"], question: string) => {
    turnIdRef.current += 1;
    const turnId = turnIdRef.current;
    setTurns((current) => [...current, { id: turnId, kind, question, answer: null }]);
    return turnId;
  };

  const closeTurn = (turnId: number, answer: string) => {
    setTurns((current) =>
      current.map((turn) => (turn.id === turnId ? { ...turn, answer } : turn)),
    );
    setActiveChoice(null);
    markInterviewed(npcId);
  };

  const send = (
    payload: Parameters<typeof sendMessage.mutate>[0],
    turnId: number,
    fallbackResponse: string,
  ) => {
    if (interrogation.isError) {
      closeTurn(turnId, fallbackResponse);
      return;
    }
    sendMessage.mutate(payload, {
      onSuccess: (message) => {
        closeTurn(turnId, message.response);
        setFollowUps(message.recommendedQuestions);
        updateSessionVersion(message.version);
      },
      onError: () => closeTurn(turnId, fallbackResponse),
    });
  };

  const ask = (choiceId: string) => {
    const selectedChoice = dialogue.choices.find((choice) => choice.id === choiceId);
    setActiveChoice(choiceId);
    setShowEvidence(false);
    const turnId = openTurn("choice", selectedChoice?.label ?? "질문");
    send(
      { npcId, choiceId },
      turnId,
      selectedChoice?.response ?? "지금은 답변할 수 없습니다.",
    );
  };

  /**
   * 서버가 제안한 후속 질문을 그대로 묻는다.
   *
   * 정적 질문과 달리 사건마다 내용이 달라서 프런트엔드에 대응하는 응답문이 없다. 질문 문구를
   * 그대로 자유 질문으로 보내고, 실패하면 자유 질문과 같은 안전 응답으로 대체한다.
   */
  const askRecommended = (question: RecommendedQuestion) => {
    setActiveChoice(`topic-${question.topicId}`);
    setShowEvidence(false);
    const turnId = openTurn("choice", question.label);
    send(
      { npcId, query: question.label },
      turnId,
      "그 부분은 지금 확인해 드릴 수 없습니다. 보안 기록을 직접 대조해 주십시오.",
    );
  };

  const presentEvidence = (evidenceId: string) => {
    setActiveChoice(`evidence-${evidenceId}`);
    setShowEvidence(false);
    const title =
      evidence.find((record) => record.clueId === evidenceId)?.title ?? evidenceId;
    const turnId = openTurn("evidence", `증거 제시 · ${title}`);
    send(
      { npcId, evidenceId },
      turnId,
      "해당 기록은 확인하겠습니다. 다만 그 자료만으로 제 행동과 사망을 직접 연결할 수는 없습니다.",
    );
  };

  const askFreeQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = freeQuestion.trim();
    if (!query) return;

    setActiveChoice("free-question");
    setShowEvidence(false);
    setFreeQuestion("");
    const turnId = openTurn("free", query);
    send(
      { npcId, query },
      turnId,
      `“${query}”에 대해선 당시 보안 기록과 제 동선으로 판단해 주십시오. 추측으로 답하지 않겠습니다.`,
    );
  };

  const askedLabels = new Set(
    turns.filter((turn) => turn.kind === "choice").map((turn) => turn.question),
  );
  // 초상 연출. 증거를 들이민 직후에는 압박, 답변이 오는 동안에는 발화로 둔다.
  const lastTurn = turns[turns.length - 1];
  const portraitState: PortraitState =
    lastTurn?.kind === "evidence" && lastTurn.answer === null
      ? "pressed"
      : lastTurn?.answer !== null || turns.length === 0
        ? "speaking"
        : "idle";
  // 첫 질문은 정적 목록에서 고르고, 한 번 오간 뒤부터는 서버가 제안한 후속 질문을 보여준다.
  // 서버가 제안을 주지 않은 턴에서는 다시 정적 목록으로 돌아가 선택지가 비지 않게 한다.
  const showFollowUps = turns.length > 0 && followUps.length > 0;

  return (
    <section className="interrogation-shell" aria-label={`${target.title} 심문`}>
      <div className="interrogation-backdrop" />
      <header className="interrogation-topbar">
        <div>
          <span>INTERROGATION CHANNEL // D1</span>
          <strong>{dialogue.callSign}</strong>
        </div>
        <div className="interrogation-state">
          <i />
          <span>로컬 보안 기록 중</span>
        </div>
        <button type="button" onClick={closeOverlay}>심문 종료 <kbd>ESC</kbd></button>
      </header>

      <div className="interrogation-layout">
        <aside className="suspect-portrait">
          {/* 마지막 문답이 증거 제시였고 답을 기다리는 중이면 압박 상태로 보여 준다. */}
          <Portrait id={npcId} state={portraitState} className="suspect-portrait__art" />
          <footer>
            <span>{target.eyebrow}</span>
            <strong>{target.title}</strong>
            <small>{dialogue.posture}</small>
          </footer>
        </aside>

        <main className="interrogation-main">
          <div className="dialogue-transcript">
            <div className="speaker-line">
              <span>{dialogue.callSign}</span>
              <time>LIVE · {String(turns.length + 1).padStart(2, "0")}</time>
            </div>
            {/* 첫 진술은 위에 남겨 두고, 주고받은 문답은 아래에 계속 쌓는다. */}
            <blockquote
              className={`${subtitles ? "is-subtitled" : ""} ${
                turns.length > 0 ? "is-compact" : ""
              }`.trim()}
            >
              {interrogation.isPending
                ? "보안 음성 채널을 동기화하고 있습니다…"
                : interrogation.data?.opening ?? dialogue.opening}
            </blockquote>
            {turns.length > 0 && (
              <div className="dialogue-log" ref={logRef} aria-live="polite">
                {turns.map((turn) => (
                  <article
                    key={turn.id}
                    className={`transcript-turn${turn.answer === null ? " is-pending" : ""}`}
                  >
                    <div className="interrogator-query">
                      <Portrait id="PLAYER" rim={false} className="interrogator-face" />
                      <div>
                        <span>
                          {turn.kind === "evidence"
                            ? "INVESTIGATOR // EVIDENCE"
                            : "INVESTIGATOR // QUERY"}
                        </span>
                        <p>{turn.question}</p>
                      </div>
                    </div>
                    <blockquote className={subtitles ? "is-subtitled" : ""}>
                      {turn.answer ?? "응답을 수신하고 있습니다…"}
                    </blockquote>
                  </article>
                ))}
              </div>
            )}
            {(interrogation.isError || sendMessage.isError) && (
              <div className="inline-api-error" role="alert">
                <span>
                  {interrogation.error?.message ?? sendMessage.error?.message}
                </span>
                {interrogation.isError && (
                  <button type="button" onClick={() => interrogation.refetch()}>
                    채널 재연결
                  </button>
                )}
              </div>
            )}
          </div>

          {!showEvidence && (
            <div className="question-list">
              <span className="question-label">
                {turns.length > 0 ? "이어서 질문" : "질문 선택"}
              </span>
              {showFollowUps
                ? followUps.map((question, index) => {
                    const asked = askedLabels.has(question.label);
                    return (
                      <button
                        key={question.topicId}
                        type="button"
                        className={[
                          activeChoice === `topic-${question.topicId}` ? "is-active" : "",
                          asked ? "is-asked" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={interrogation.isPending || sendMessage.isPending}
                        onClick={() => askRecommended(question)}
                      >
                        <em>{String(index + 1).padStart(2, "0")}</em>
                        <span>{question.label}</span>
                        <i>{asked ? "✓" : "→"}</i>
                      </button>
                    );
                  })
                : dialogue.choices.map((choice, index) => {
                    const asked = askedLabels.has(choice.label);
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        className={[
                          activeChoice === choice.id ? "is-active" : "",
                          asked ? "is-asked" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={interrogation.isPending || sendMessage.isPending}
                        onClick={() => ask(choice.id)}
                      >
                        <em>{String(index + 1).padStart(2, "0")}</em>
                        <span>{choice.label}</span>
                        <i>{asked ? "✓" : "→"}</i>
                      </button>
                    );
                  })}
              <form className="free-question-form" onSubmit={askFreeQuestion}>
                <label htmlFor="free-interrogation-question">
                  <span>FREE QUESTION</span>
                  직접 질문
                </label>
                <div>
                  <input
                    id="free-interrogation-question"
                    type="text"
                    value={freeQuestion}
                    maxLength={240}
                    placeholder="용의자에게 직접 질문을 입력하십시오."
                    disabled={interrogation.isPending || sendMessage.isPending}
                    onChange={(event) => setFreeQuestion(event.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={
                      !freeQuestion.trim() ||
                      interrogation.isPending ||
                      sendMessage.isPending
                    }
                  >
                    {sendMessage.isPending && activeChoice === "free-question"
                      ? "전송 중"
                      : "질문 전송"}
                    <i>→</i>
                  </button>
                </div>
                <small>{freeQuestion.length} / 240</small>
              </form>
              <button
                className="present-evidence"
                type="button"
                onClick={() => setShowEvidence(true)}
                disabled={
                  evidence.length === 0 ||
                  interrogation.isPending ||
                  sendMessage.isPending
                }
              >
                <em>EV</em>
                <span>{evidence.length > 0 ? "발견한 증거 제시" : "제시할 증거 없음"}</span>
                <i>+</i>
              </button>
            </div>
          )}

          {showEvidence && (
            <div className="interrogation-evidence">
              <header>
                <div>
                  <span>EVIDENCE PRESENTATION</span>
                  <h3>제시할 증거 선택</h3>
                </div>
                <button type="button" onClick={() => setShowEvidence(false)}>돌아가기</button>
              </header>
              <div>
                {evidence.map((record) => (
                  <button
                    key={record.clueId}
                    type="button"
                    disabled={sendMessage.isPending}
                    onClick={() => presentEvidence(record.clueId)}
                  >
                    <small>
                      {record.sourceObjectId
                        ? INVESTIGATION_OBJECTS[record.sourceObjectId]?.zone
                        : "검색"}
                    </small>
                    <strong>{record.title}</strong>
                    <span>{EVIDENCE_TYPE_LABELS[record.clueType]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function Notebook() {
  const sessionId = useGameStore((state) => state.sessionId);
  const closeOverlay = useGameStore((state) => state.closeOverlay);
  const tab = useGameStore((state) => state.notebookTab);
  const setTab = useGameStore((state) => state.setNotebookTab);
  const discoveredIds = useGameStore((state) => state.discoveredIds);
  const evidence = useGameStore((state) => state.evidence);
  const setNotebookGuideOpen = useSettingsStore((state) => state.setNotebookGuideOpen);
  const progress = getRequiredProgress(discoveredIds);
  // 수첩을 열 때마다 서버 공개 상태로 맞춘다. 배경에서 열린 단서가 여기서 반영된다.
  useCaseState(sessionId);

  // 탭 이름만으로는 어디서 무엇을 하는지 알기 어려워, 수첩을 처음 연 순간에 한 번만 짚어 준다.
  // 수첩이 닫히면 안내도 반드시 함께 내린다. 안내가 열린 상태로 남으면 게임 조작이 계속 막힌다.
  useEffect(() => {
    if (!useSettingsStore.getState().notebookGuideSeen) setNotebookGuideOpen(true);
    return () => setNotebookGuideOpen(false);
  }, [setNotebookGuideOpen]);

  return (
    <section className="notebook-shell" aria-label="사건 수첩">
      <div className="notebook-topbar">
        <div className="notebook-brand">
          <span>ARK / SECURITY ARCHIVE</span>
          <strong>사건 기록 장치</strong>
        </div>
        <div className="notebook-meta">
          <span>CASE</span>
          <strong>ARK-D1-0724</strong>
          <span>SYNC</span>
          <strong className="danger-text">OFFLINE</strong>
        </div>
        <button type="button" onClick={closeOverlay}>수첩 닫기 <kbd>TAB</kbd></button>
      </div>

      <div className="notebook-body">
        <nav>
          {NOTEBOOK_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-tour={`notebook-tab-${item.id}`}
              className={tab === item.id ? "is-active" : ""}
              onClick={() => setTab(item.id)}
            >
              <span>{item.index}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <main>
          <header className="notebook-title">
            <div>
              <p>INVESTIGATION DATABASE</p>
              <h2>{NOTEBOOK_TABS.find((item) => item.id === tab)?.label}</h2>
            </div>
            <div className="notebook-progress" data-tour="notebook-progress">
              <span>1일차 증거 기록</span>
              <strong>{progress.found} / {progress.total}</strong>
              <i><b style={{ width: `${(progress.found / progress.total) * 100}%` }} /></i>
            </div>
          </header>

          <div className="notebook-content">
            {tab === "evidence" && <EvidenceTab evidence={evidence} />}
            {tab === "timeline" && <TimelineTab />}
            {tab === "suspects" && <SuspectsTab />}
            {tab === "assistant" && <AssistantTab />}
            {tab === "theory" && <TheoryTab />}
          </div>
        </main>
      </div>
    </section>
  );
}

function ScanEffect() {
  const scanUntil = useGameStore((state) => state.scanUntil);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const remaining = scanUntil - performance.now();
    if (remaining <= 0) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), remaining);
    return () => window.clearTimeout(timer);
  }, [scanUntil]);

  return visible ? <div className="scan-sweep" /> : null;
}

function DayReview() {
  const sessionId = useGameStore((state) => state.sessionId);
  const discoveredIds = useGameStore((state) => state.discoveredIds);
  const interviewedIds = useGameStore((state) => state.interviewedIds);
  const updateSessionVersion = useGameStore((state) => state.updateSessionVersion);
  const beginDayTwo = useGameStore((state) => state.beginDayTwo);
  const completeDay = useCompleteDay(sessionId);
  const progress = getRequiredProgress(discoveredIds);
  const continueToDayTwo = () => {
    completeDay.mutate(1, {
      onSuccess: ({ version }) => {
        updateSessionVersion(version);
        beginDayTwo();
      },
    });
  };

  return (
    <section className="day-review-shell" aria-label="D1 조사 정리">
      <div className="day-review-atmosphere" />
      <header>
        <span>INVESTIGATION CYCLE COMPLETE</span>
        <strong>DAY 01</strong>
        <small>아르카디아 표준시 · 22:40</small>
      </header>

      <main>
        <div className="day-review-title">
          <p>현장 보존 및 1차 진술</p>
          <h2>첫날의 기록이<br />동기보다 기회를 가리킨다.</h2>
          <span>
            모든 용의자는 숨기는 것이 있다. 하지만 거짓말의 존재만으로 살인을 증명할 수는 없다.
          </span>
        </div>

        <div className="day-review-results">
          <article>
            <span>01</span>
            <div>
              <small>SCENE RECORDS</small>
              <strong>{progress.found} / {progress.total}</strong>
              <p>사령관실 필수 기록 확보</p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <small>TESTIMONIES</small>
              {/* 1일차 통과 조건과 같은 분모를 쓴다. 목표 패널이 말한 기준과 어긋나면 안 된다. */}
              <strong>
                {Math.min(interviewedIds.length, REQUIRED_INTERVIEWS)} / {REQUIRED_INTERVIEWS}
              </strong>
              <p>승무원 진술 확보</p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <small>LOG INTEGRITY</small>
              <strong>UNVERIFIED</strong>
              <p>중앙 기록과 로컬 원본 비교 필요</p>
            </div>
          </article>
        </div>

        <div className="day-review-next">
          <div>
            <span>NEXT // DAY 02</span>
            <h3>심층 조사 개방</h3>
            <p>의료 원시 데이터, 정비 기록, 통신 원본과 화물 로그를 교차 검증합니다.</p>
          </div>
          <button
            type="button"
            disabled={completeDay.isPending}
            onClick={continueToDayTwo}
          >
            <span>{completeDay.isPending ? "D1 기록 봉인 중" : "D2 조사 시작"}</span>
            <i>→</i>
          </button>
        </div>
        {completeDay.isError && (
          <p className="inline-api-error" role="alert">{completeDay.error.message}</p>
        )}
      </main>

      <footer>
        <StageIndicator current="DAY1" />
      </footer>
    </section>
  );
}

/** 최종 추리 4축. 백엔드 판정 역할과 1:1로 대응한다. */
const ROLE_LABELS: Record<string, string> = {
  SETUP: "범행 준비",
  TRIGGER: "실행 트리거",
  OPPORTUNITY: "기회와 권한",
  MOTIVE: "범행 동기",
};

/**
 * 오답 판정 검토 화면.
 *
 * 예전에는 한 번 제출하면 맞든 틀리든 곧바로 엔딩으로 갔다. 서버는 오답을 세 번까지 허용하고
 * 어느 축이 모자란지도 알려주는데 그 정보를 아무도 보지 못했다. 정답은 알려주지 않고 부족한
 * 논리만 짚어 다시 세우게 한다.
 */
function DeductionReview({
  judgement,
  suspects,
  onRevise,
}: {
  judgement: VerdictJudgement;
  suspects: ReturnType<typeof useSuspects>;
  onRevise: () => void;
}) {
  const nameOf = (characterId: string) =>
    suspects.find((suspect) => suspect.id === characterId)?.name ?? characterId;

  return (
    <section className="deduction-review" aria-label="추리 판정 검토">
      <div className="trial-atmosphere" />
      <div className="deduction-review-body">
        <header>
          <span>DEDUCTION REJECTED</span>
          <h2>{judgement.culpritCorrect ? "지목은 맞지만 입증이 모자랍니다" : "이 추리로는 결론에 이르지 못합니다"}</h2>
          <p>{judgement.feedback}</p>
        </header>

        <div className="deduction-review-attempts">
          <span>남은 기회</span>
          <div>
            {Array.from({ length: 3 }, (_, index) => (
              <i key={index} className={index < judgement.remainingAttempts ? "is-left" : ""} />
            ))}
          </div>
          <strong>{judgement.remainingAttempts}회</strong>
        </div>

        <div className="deduction-review-marks">
          {Object.entries(ROLE_LABELS).map(([role, label]) => {
            const mark = judgement.roleResults[role];
            return (
              <div key={role} className={mark === "CORRECT" ? "is-correct" : "is-wrong"}>
                <span>{label}</span>
                <strong>{mark === "CORRECT" ? "성립" : "부족"}</strong>
              </div>
            );
          })}
        </div>

        {Object.keys(judgement.exclusionResults).length > 0 && (
          <div className="deduction-review-marks is-exclusions">
            {Object.entries(judgement.exclusionResults).map(([characterId, mark]) => (
              <div key={characterId} className={mark === "CORRECT" ? "is-correct" : "is-wrong"}>
                <span>{nameOf(characterId)} 배제</span>
                <strong>{mark === "CORRECT" ? "성립" : "부족"}</strong>
              </div>
            ))}
          </div>
        )}

        {judgement.missingLogic.length > 0 && (
          <ul className="deduction-review-gaps">
            {judgement.missingLogic.map((item, index) => (
              <li key={`${item.code}-${item.role ?? item.characterId ?? index}`}>
                <em>{item.code === "WRONG_CULPRIT" ? "지목" : item.code === "WEAK_EXCLUSION" ? "배제" : "입증"}</em>
                {item.characterId
                  ? `${withParticle(nameOf(item.characterId), "을", "를")} 배제할 근거가 부족합니다.`
                  : item.message}
              </li>
            ))}
          </ul>
        )}

        <footer>
          <p>어느 기록이 정답인지는 알려주지 않습니다. 확보한 자료를 다시 맞춰 보십시오.</p>
          <button type="button" onClick={onRevise}>
            사건 재구성 수정 <i>→</i>
          </button>
        </footer>
      </div>
    </section>
  );
}

function TrialScreen() {
  const sessionId = useGameStore((state) => state.sessionId);
  const theory = useGameStore((state) => state.theory);
  const evidenceRecords = useGameStore((state) => state.evidence);
  const suspects = useSuspects();
  const updateSessionVersion = useGameStore((state) => state.updateSessionVersion);
  const completeTrial = useGameStore((state) => state.completeTrial);
  const recordJudgement = useGameStore((state) => state.recordJudgement);
  const reviseTheory = useGameStore((state) => state.reviseTheory);
  const judgement = useGameStore((state) => state.verdictJudgement);
  const judgementPending = useGameStore((state) => state.judgementPending);
  const submitVerdict = useSubmitVerdict(sessionId);
  const [step, setStep] = useState(0);
  const accused = suspects.find((suspect) => suspect.id === theory.suspectId);
  const findEvidence = (clueId: string | null | undefined) =>
    clueId ? evidenceRecords.find((record) => record.clueId === clueId) : undefined;

  if (
    !accused ||
    !theory.setup ||
    !theory.trigger ||
    !theory.opportunity ||
    !theory.motive
  ) {
    return null;
  }

  const stages = [
    {
      code: "ACCUSATION",
      title: `${accused.name}을 살인 혐의로 지목합니다.`,
      line: "당신의 추론에는 빈틈이 있습니다. 접근할 수 있었다는 사실과 실제로 죽였다는 사실은 다릅니다.",
      evidenceId: null,
      action: "기소 내용 확정",
    },
    {
      code: "SETUP",
      title: "범행 준비를 입증하십시오.",
      line: "그 기록은 제 담당 업무만 보여줄 뿐입니다. 준비 행위였다고 단정할 수 있습니까?",
      evidenceId: theory.setup,
      action: "준비 증거 제시",
    },
    {
      code: "TRIGGER",
      title: "실행 시점을 입증하십시오.",
      line: "작업이 실행됐다는 것과 제가 실행했다는 것은 다릅니다. 사망 시점까지 연결할 수 있습니까?",
      evidenceId: theory.trigger,
      action: "실행 증거 제시",
    },
    {
      code: "MOTIVE",
      title: "살인의 직접 동기를 입증하십시오.",
      line: "감사 대상은 저뿐만이 아니었습니다. 비밀을 숨겼다는 이유로 모두를 살인자로 만들 수는 없습니다.",
      evidenceId: theory.motive,
      action: "동기 증거 제시",
    },
    {
      code: "EXCLUSION",
      title: "다른 용의자를 배제하십시오.",
      line: "다른 사람도 같은 시간과 장소에 접근할 수 있었습니다. 왜 반드시 저여야 합니까?",
      evidenceId: theory.opportunity,
      action: "배제 논리 제출",
    },
    {
      code: "VOTE",
      title: "생존자 투표를 요청합니다.",
      line: "이 결정은 되돌릴 수 없습니다. 당신이 제시한 기록만으로 한 사람을 진공에 내보내려는 겁니까?",
      evidenceId: null,
      action: "최종 투표 진행",
    },
  ];
  const stage = stages[step];
  const evidence = findEvidence(stage.evidenceId);
  const exclusions = suspects
    .filter((suspect) => suspect.id !== theory.suspectId)
    .map((suspect) => ({
      suspect,
      evidence: findEvidence(theory.exclusions[suspect.id]),
    }));

  const proceed = () => {
    if (step < stages.length - 1) {
      setStep((current) => current + 1);
      return;
    }
    submitVerdict.mutate(theory, {
      onSuccess: ({ version, judgement, ...result }) => {
        updateSessionVersion(version);
        recordJudgement(judgement);
        // 틀렸어도 기회가 남아 있으면 엔딩으로 넘기지 않는다. 무엇이 모자랐는지 보여주고
        // 사건 재구성으로 돌아가 고칠 수 있게 한다.
        if (judgement.verdict !== "CORRECT" && judgement.remainingAttempts > 0) return;
        completeTrial(result);
      },
    });
  };

  // 판정을 받았고 아직 기회가 남은 상태. 재판을 끝내지 않고 부족한 논리를 보여준다.
  const pendingRetry =
    judgement !== null &&
    judgementPending &&
    judgement.verdict !== "CORRECT" &&
    judgement.remainingAttempts > 0;

  if (pendingRetry) {
    return <DeductionReview judgement={judgement} suspects={suspects} onRevise={reviseTheory} />;
  }

  return (
    <section className="trial-shell" aria-label="D3 생존자 재판">
      <div className="trial-atmosphere" />
      <header className="trial-topbar">
        <div>
          <span>EMERGENCY TRIBUNAL // DAY 03</span>
          <strong>생존 승무원 과반 의결 규정</strong>
        </div>
        <div className="trial-steps">
          {stages.map((item, index) => (
            <i key={item.code} className={index <= step ? "is-active" : ""}>
              {String(index + 1).padStart(2, "0")}
            </i>
          ))}
        </div>
        <StageIndicator current="DEDUCTION" />
      </header>

      {/* 지목된 인물만 앞으로·컬러로 세운다. 3D가 못 만들던 법정의 시선이 여기서 나온다. */}
      <div className="trial-jury">
        {suspects.map((suspect) => {
          const isAccused = suspect.id === accused.id;
          return (
            <div
              key={suspect.id}
              className={isAccused ? "is-accused" : ""}
              style={{ "--suspect": suspect.color } as React.CSSProperties}
            >
              {isAccused && <em className="trial-seal">ACCUSED</em>}
              <Portrait id={suspect.id} state={isAccused ? "culprit" : "excluded"} />
              <span>{suspect.role}</span>
              <strong>{suspect.name}</strong>
            </div>
          );
        })}
      </div>

      <main className="trial-main">
        <div className="trial-stage-copy">
          <p>{String(step + 1).padStart(2, "0")} // {stage.code}</p>
          <h2>{stage.title}</h2>
          <blockquote>
            <span>{accused.name}</span>
            {stage.line}
          </blockquote>
        </div>

        <div className="trial-proof">
          {evidence && (
            <article>
              <header>
                <span>{EVIDENCE_TYPE_LABELS[evidence.clueType]}</span>
                <small>
                  {evidence.sourceObjectId
                    ? INVESTIGATION_OBJECTS[evidence.sourceObjectId]?.title
                    : "사건 기록 검색"}
                </small>
              </header>
              <div
                className={`trial-proof-mark trial-proof-mark--${evidence.clueType.toLowerCase()}`}
              />
              <h3>{evidence.title}</h3>
              <p>{evidence.playerText}</p>
            </article>
          )}

          {stage.code === "EXCLUSION" && (
            <div className="trial-exclusions">
              {exclusions.map(({ suspect, evidence: exclusionEvidence }) => (
                <article key={suspect.id}>
                  <i style={{ "--suspect": suspect.color } as React.CSSProperties}>
                    {suspect.name.slice(0, 1)}
                  </i>
                  <div>
                    <span>{suspect.name}</span>
                    <strong>{exclusionEvidence?.title}</strong>
                  </div>
                </article>
              ))}
            </div>
          )}

          {stage.code === "ACCUSATION" && (
            <div className="accusation-seal">
              <span>ACCUSED</span>
              <strong>{accused.name}</strong>
              <small>{accused.role}</small>
            </div>
          )}

          {stage.code === "VOTE" && (
            <div className="vote-warning">
              <span>IRREVERSIBLE ACTION</span>
              <h3>추방에는 생존자 6명 중 4표가 필요합니다.</h3>
              <p>오답으로 확정된 추방 역시 취소하거나 되돌릴 수 없습니다.</p>
            </div>
          )}
        </div>
      </main>

      <footer className="trial-actions">
        <div>
          <span>PLAYER VOTE</span>
          <strong>추방 찬성 · 1표</strong>
          {submitVerdict.isError && (
            <small className="inline-api-error" role="alert">
              {submitVerdict.error.message}
            </small>
          )}
        </div>
        <button type="button" disabled={submitVerdict.isPending} onClick={proceed}>
          {submitVerdict.isPending ? "투표 집계 중" : stage.action} <i>→</i>
        </button>
      </footer>
    </section>
  );
}

const ENDING_COPY = {
  CULPRIT_EXPELLED: {
    eyebrow: "CASE CLOSED",
    title: "진범은 에어록 너머로 사라졌다.",
    text: "제시된 수단·동기·흔적이 하나의 실행자를 가리켰다. 구조선은 진실이 확정된 정거장에 도착한다.",
    accent: "#8ce0c8",
  },
  CULPRIT_SURVIVED: {
    eyebrow: "INSUFFICIENT PROOF",
    title: "진범을 알았지만 입증하지 못했다.",
    text: "과반의 동의를 얻지 못했다. 피고는 생존한 채 구조선을 기다리고, 사건은 미완의 기록으로 남는다.",
    accent: "#e2a164",
  },
  INNOCENT_EXPELLED: {
    eyebrow: "FALSE CONVICTION",
    title: "무고한 사람이 진공으로 방출됐다.",
    text: "표는 충분했지만 결론은 틀렸다. 진범은 남은 생존자 사이에서 조용히 구조선을 기다린다.",
    accent: "#de6952",
  },
  TRIAL_DEADLOCK: {
    eyebrow: "TRIAL DEADLOCK",
    title: "재판은 결론 없이 끝났다.",
    text: "증거는 누구도 설득하지 못했다. 추방은 집행되지 않았고 살인자는 정거장에 남아 있다.",
    accent: "#9aa29f",
  },
};

/**
 * 사건 해설.
 *
 * 재판이 끝나야 서버가 열어 준다. 정답으로 끝났든 기회를 모두 소진했든 똑같이 볼 수 있다.
 * 틀린 채로 끝난 사람도 무엇이 진실이었는지는 알아야 사건이 닫힌다.
 */
function CaseDebrief({ sessionId }: { sessionId: string | null }) {
  const evidence = useGameStore((state) => state.evidence);
  const reveal = useFinalReveal(sessionId, Boolean(sessionId));

  if (reveal.isPending) {
    return (
      <section className="case-debrief is-loading" role="status">
        <span>CASE FILE // DECLASSIFIED</span>
        <p>사건 기록을 복호화하는 중입니다…</p>
      </section>
    );
  }
  // 해설을 못 불러와도 엔딩 자체는 이미 확정됐다. 결과 화면을 막지 않고 조용히 접는다.
  if (reveal.isError || !reveal.data) return null;

  const data = reveal.data;
  const culprit = suspectProfile(data.culpritId);
  const titleOf = (clueId: string) =>
    evidence.find((record) => record.clueId === clueId)?.title ?? clueId;

  return (
    <section className="case-debrief" aria-label="사건 해설">
      <header>
        <span>CASE FILE // DECLASSIFIED</span>
        <h2>
          {data.resolvedByPlayer
            ? "당신이 세운 논증이 그대로 진실이었습니다."
            : "사건의 전모는 다음과 같았습니다."}
        </h2>
        <p>{data.truthSummary}</p>
      </header>

      {(data.methodSummary || data.victimCondition) && (
        <div className="debrief-method">
          {data.methodSummary && (
            <div>
              <span>수법</span>
              <p>{data.methodSummary}</p>
            </div>
          )}
          {data.victimCondition && (
            <div>
              <span>피해자 상태</span>
              <p>{data.victimCondition}</p>
            </div>
          )}
        </div>
      )}

      <div className="debrief-block">
        <h3>사건 당일의 실제 순서</h3>
        <ol className="debrief-timeline">
          {data.timeline.map((event) => (
            <li key={event.eventId}>
              <time>{event.time}</time>
              <div>
                <span>
                  {event.actorIds.map((id) => suspectProfile(id).name).join(", ") || "—"}
                </span>
                <p>{event.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="debrief-block">
        <h3>정답 논증</h3>
        <div className="debrief-roles">
          {THEORY_ROLE_FIELDS.map(([role]) => (
            <div key={role}>
              <span>{ROLE_LABELS[role]}</span>
              <strong>
                {(data.requiredEvidenceByRole[role] ?? []).map(titleOf).join(" · ") || "—"}
              </strong>
            </div>
          ))}
        </div>
        {data.exclusions.length > 0 && (
          <ul className="debrief-exclusions">
            {data.exclusions.map((exclusion) => (
              <li key={exclusion.characterId}>
                <em>{suspectProfile(exclusion.characterId).name}</em>
                {exclusion.reason}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.alibis.length > 0 && (
        <div className="debrief-block">
          <h3>진술과 실제</h3>
          <div className="debrief-alibis">
            {data.alibis.map((alibi) => (
              <article
                key={alibi.characterId}
                className={alibi.characterId === data.culpritId ? "is-culprit" : ""}
              >
                <header>
                  <strong>{suspectProfile(alibi.characterId).name}</strong>
                  {alibi.characterId === data.culpritId && <em>범인</em>}
                </header>
                <p className="alibi-claim">“{alibi.initialClaim}”</p>
                {alibi.contradictions.length > 0 ? (
                  <ul>
                    {alibi.contradictions.map((statement) => (
                      <li key={statement}>{statement}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="alibi-clean">진술과 어긋나는 사실이 없었습니다.</p>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      <footer className="debrief-footer">
        진범은 <strong>{culprit.name}</strong>
        {particleFor(culprit.name, "이었", "였")}습니다.
      </footer>
    </section>
  );
}

function ResultScreen() {
  const sessionId = useGameStore((state) => state.sessionId);
  const result = useGameStore((state) => state.trialResult);
  const toggleNotebook = useGameStore((state) => state.toggleNotebook);
  const resetSession = useGameStore((state) => state.resetSession);
  if (!result) return null;

  const accused = SUSPECTS.find((suspect) => suspect.id === result.accusedId);
  const copy = ENDING_COPY[result.ending];

  return (
    <section
      className="result-shell"
      aria-label="재판 결과"
      style={{ "--ending-accent": copy.accent } as React.CSSProperties}
    >
      <div className="result-airlock">
        <div className="airlock-ring"><i /><i /><i /></div>
        <div className="airlock-person" />
        <div className="airlock-haze" />
      </div>
      <div className="result-content">
        <span>{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.text}</p>

        <div className="result-verdict">
          <div>
            <span>지목 인물</span>
            <strong>{accused?.name}</strong>
          </div>
          <div>
            <span>추방 찬성</span>
            <strong>{result.votesFor} / 6</strong>
          </div>
          <div>
            <span>판정</span>
            <strong>{result.correctAccusation ? "정답" : "오답"}</strong>
          </div>
        </div>

        <div className="vote-dots">
          {Array.from({ length: 6 }, (_, index) => (
            <i key={index} className={index < result.votesFor ? "is-for" : ""} />
          ))}
        </div>

        <div className="result-actions">
          <button type="button" onClick={toggleNotebook}>사건 기록 검토</button>
          <button type="button" onClick={resetSession}>새 사건 시작</button>
        </div>

        <CaseDebrief sessionId={sessionId} />
      </div>
      <footer>
        <span>ARCADIA STATION // INCIDENT 72</span>
        <strong>사건 종결</strong>
      </footer>
    </section>
  );
}

export function GameUI() {
  const layer = useGameStore((state) => state.layer);
  const selectedId = useGameStore((state) => state.selectedId);
  const guideOpen = useSettingsStore((state) => state.guideOpen);
  const closeGuide = useSettingsStore((state) => state.closeGuide);
  const notebookGuideOpen = useSettingsStore((state) => state.notebookGuideOpen);
  const closeNotebookGuide = useSettingsStore((state) => state.closeNotebookGuide);
  const title = useMemo(
    () => (selectedId ? INVESTIGATION_OBJECTS[selectedId]?.title : null),
    [selectedId],
  );

  useEffect(() => {
    document.title = title ? `${title} // ARCADIA` : "ARCADIA // INCIDENT 72";
  }, [title]);

  return (
    <>
      {layer === "opening" ? (
        <OpeningOverlay />
      ) : (
        <>
          <MissionHud />
          <ScanEffect />
          {layer === "inspection" && <InspectionPanel />}
          {layer === "interrogation" && <InterrogationPanel />}
          {layer === "notebook" && <Notebook />}
          {layer === "dayReview" && <DayReview />}
          {layer === "trial" && <TrialScreen />}
          {layer === "result" && <ResultScreen />}
        </>
      )}
      {guideOpen && layer !== "opening" && (
        <GuideTour steps={PLAY_TOUR_STEPS} onClose={closeGuide} label="플레이 안내" />
      )}
      {/* 수첩 안내는 수첩이 실제로 열려 있을 때만 뜬다. 탭 위치를 짚어야 하기 때문이다. */}
      {notebookGuideOpen && layer === "notebook" && !guideOpen && (
        <GuideTour
          steps={NOTEBOOK_TOUR_STEPS}
          onClose={closeNotebookGuide}
          label="사건 수첩 안내"
        />
      )}
    </>
  );
}
