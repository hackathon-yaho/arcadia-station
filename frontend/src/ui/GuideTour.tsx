import { useCallback, useEffect, useLayoutEffect, useState } from "react";

type Placement = "top" | "bottom" | "left" | "right" | "center";

export type TourStep = {
  title: string;
  body: string;
  /** 짚어 줄 화면 요소. 없으면 화면 가운데에 설명만 띄운다. */
  target?: string;
  placement?: Placement;
};

/**
 * 처음 플레이하는 사람에게 실제 화면 요소를 하나씩 짚어 주는 단계별 안내.
 *
 * 각 단계는 `data-tour` 속성으로 HUD 요소를 찾는다. 클래스명 대신 전용 속성을 쓰는 이유는
 * 스타일을 바꿔도 안내가 따라 깨지지 않게 하려는 것이다.
 */
export const PLAY_TOUR_STEPS: TourStep[] = [
  {
    title: "목표 패널 — 지금 할 일은 여기에",
    body:
      "현재 목표와 필수 기록 진행도가 항상 이 패널에 표시됩니다. 무엇을 해야 할지 막히면 여기를 먼저 확인하세요.",
    target: '[data-tour="objective"]',
    placement: "right",
  },
  {
    title: "이동 — 정거장을 직접 걷는다",
    body:
      "W A S D 또는 방향키로 걷습니다. 화면은 항상 당신을 따라오고, 지나온 구역은 지도에 희미하게 남습니다.",
    placement: "center",
  },
  {
    title: "조사 — 다가가서 E",
    body:
      "조사할 수 있는 자리에는 마름모 표식이 떠 있습니다. 가까이 가면 화면 아래에 이름이 뜨고, 그때 E를 누르면 조사하거나 말을 겁니다. 붉은 표식이 1일차 필수 기록입니다.",
    target: '[data-tour="prompt"]',
    placement: "top",
  },
  {
    title: "조사 스캔 — 무엇을 조사할지 모를 때",
    body:
      "Q를 누르면 아직 조사하지 않은 표식이 3초간 크게 맥동합니다. 사건마다 단서 배치가 달라 아무것도 나오지 않는 오브젝트도 있습니다.",
    target: '[data-tour="scan"]',
    placement: "top",
  },
  {
    title: "용의자 심문",
    body:
      "각 구역에 흩어진 승무원에게 E로 말을 겁니다. 준비된 질문을 고르거나 직접 질문을 입력할 수 있고, 확보한 증거를 제시하면 진술이 바뀝니다. 1일차에는 최소 3명을 심문해야 합니다.",
    placement: "center",
  },
  {
    title: "사건 수첩 — 모은 것을 정리한다",
    body:
      "TAB으로 수첩을 엽니다. 증거·타임라인·용의자·수사 보조(기록 검색)·사건 재구성 다섯 탭이 있습니다.",
    target: '[data-tour="notebook"]',
    placement: "top",
  },
  {
    title: "사건 재구성과 재판",
    body:
      "수첩의 사건 재구성에서 범인을 지목하고 준비·실행·기회·동기를 각각 서로 다른 증거로 연결합니다. 나머지 용의자를 배제할 근거까지 갖추면 재판을 열 수 있습니다. 정답은 직접 확보한 기록으로만 인정됩니다.",
    placement: "center",
  },
  {
    title: "다시 보기와 설정",
    body:
      "이 안내는 ? 키나 안내 버튼으로 언제든 다시 볼 수 있습니다. ESC를 누르면 설정이 열립니다.",
    target: '[data-tour="system"]',
    placement: "left",
  },
];

/**
 * 수첩을 처음 열었을 때 탭 다섯 개의 쓰임을 한 번만 짚어 주는 안내.
 *
 * 플레이 안내(`PLAY_TOUR_STEPS`)는 수첩을 "TAB으로 연다"까지만 알려 준다. 정작 수첩 안에서
 * 무엇을 어디서 하는지는 탭 이름만으로 알기 어려워서, 실제로 열었을 때 한 번 더 짚어 준다.
 */
export const NOTEBOOK_TOUR_STEPS: TourStep[] = [
  {
    title: "증거 — 확보한 기록이 모이는 곳",
    body:
      "조사와 기록 검색으로 얻은 증거가 카드로 쌓입니다. 각 카드에는 어느 구역의 무엇에서 나왔는지가 함께 적혀 있습니다.",
    target: '[data-tour="notebook-tab-evidence"]',
    placement: "right",
  },
  {
    title: "타임라인 — 사건 당일의 흐름",
    body:
      "사망 전후에 무슨 일이 있었는지 시간순으로 봅니다. 증거의 시각과 여기 적힌 시각을 맞춰 보면 모순이 드러납니다.",
    target: '[data-tour="notebook-tab-timeline"]',
    placement: "right",
  },
  {
    title: "용의자 — 누구를 심문했는지",
    body:
      "승무원 명단과 진술 확보 여부를 확인합니다. 아직 심문하지 않은 사람이 누구인지 여기서 알 수 있습니다.",
    target: '[data-tour="notebook-tab-suspects"]',
    placement: "right",
  },
  {
    title: "수사 보조 — 기록을 검색한다",
    body:
      "현장에서 직접 찾을 수 없는 기록은 여기서 질문해 찾습니다. 검색으로만 열리는 증거가 있으니 막히면 들러 보세요.",
    target: '[data-tour="notebook-tab-assistant"]',
    placement: "right",
  },
  {
    title: "사건 재구성 — 마지막에 여는 탭",
    body:
      "2일차 조사까지 마치면 열립니다. 범인을 지목하고 준비·실행·기회·동기를 각각 다른 증거로 연결한 뒤 재판을 시작합니다.",
    target: '[data-tour="notebook-tab-theory"]',
    placement: "right",
  },
  {
    title: "진행도 — 1일차에 필요한 만큼 모았는지",
    body:
      "1일차를 넘기려면 필수 기록을 모두 확보하고 승무원 3명 이상을 심문해야 합니다. 남은 양이 여기에 표시됩니다.",
    target: '[data-tour="notebook-progress"]',
    placement: "bottom",
  },
];

const CARD_WIDTH = 344;
/** 카드 높이를 재지 않고 화면 안으로 넣기 위한 상한. CSS의 max-height와 같이 유지한다. */
const CARD_MAX_HEIGHT = 260;
const GAP = 14;
const EDGE = 16;

type CardPosition = {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

function cardPosition(rect: DOMRect | null, placement: Placement): CardPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = viewportWidth - CARD_WIDTH - EDGE;
  const maxTop = viewportHeight - CARD_MAX_HEIGHT - EDGE;

  if (!rect || placement === "center") {
    return {
      left: Math.max(EDGE, (viewportWidth - CARD_WIDTH) / 2),
      top: Math.max(EDGE, viewportHeight * 0.3),
    };
  }

  const centeredLeft = clamp(
    rect.left + rect.width / 2 - CARD_WIDTH / 2,
    EDGE,
    maxLeft,
  );

  switch (placement) {
    case "bottom":
      return { left: centeredLeft, top: clamp(rect.bottom + GAP, EDGE, maxTop) };
    case "top":
      return {
        left: centeredLeft,
        bottom: clamp(viewportHeight - rect.top + GAP, EDGE, viewportHeight - EDGE),
      };
    case "right":
      return {
        left: clamp(rect.right + GAP, EDGE, maxLeft),
        top: clamp(rect.top, EDGE, maxTop),
      };
    case "left":
    default:
      return {
        right: clamp(viewportWidth - rect.left + GAP, EDGE, viewportWidth - EDGE),
        top: clamp(rect.top, EDGE, maxTop),
      };
  }
}

export function GuideTour({
  steps,
  onClose,
  label = "플레이 안내",
}: {
  steps: TourStep[];
  onClose: () => void;
  label?: string;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const measure = useCallback(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    const element = document.querySelector(step.target);
    setRect(element ? element.getBoundingClientRect() : null);
  }, [step.target]);

  // 단계가 바뀌면 대상 위치를 다시 잡는다. 창 크기가 변할 때도 따라가야 한다.
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  const goNext = useCallback(() => {
    if (isLast) {
      onClose();
      return;
    }
    setIndex((current) => current + 1);
  }, [onClose, isLast]);

  const goBack = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        onClose();
        return;
      }
      if (event.code === "ArrowRight" || event.code === "Enter" || event.code === "Space") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, goBack, goNext]);

  const position = cardPosition(rect, step.placement ?? "center");
  // 대상만 남기고 주변을 덮는다. 사각형 네 장이라 잘라내기 없이도 강조가 된다.
  const scrims = rect
    ? [
        { key: "top", top: 0, left: 0, width: "100%", height: Math.max(0, rect.top) },
        {
          key: "bottom",
          top: rect.bottom,
          left: 0,
          width: "100%",
          height: Math.max(0, window.innerHeight - rect.bottom),
        },
        { key: "left", top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height },
        {
          key: "right",
          top: rect.top,
          left: rect.right,
          width: Math.max(0, window.innerWidth - rect.right),
          height: rect.height,
        },
      ]
    : [{ key: "all", top: 0, left: 0, width: "100%", height: "100%" }];

  return (
    <section
      className="tour-layer"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-tour-step={index + 1}
    >
      {scrims.map((scrim) => (
        <div
          key={scrim.key}
          className="tour-scrim"
          style={{
            top: scrim.top,
            left: scrim.left,
            width: scrim.width,
            height: scrim.height,
          }}
        />
      ))}

      {rect && (
        <div
          className="tour-highlight"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      )}

      <article className="tour-card" style={position}>
        <header>
          <span className="tour-count">
            {index + 1} / {steps.length}
          </span>
          <div className="tour-dots">
            {steps.map((tourStep, dotIndex) => (
              <i
                key={tourStep.title}
                className={dotIndex === index ? "is-current" : dotIndex < index ? "is-done" : ""}
              />
            ))}
          </div>
        </header>
        <h2>
          <em>{index + 1}</em>
          {step.title}
        </h2>
        <p>{step.body}</p>
        <footer>
          <button className="tour-skip" type="button" onClick={onClose}>
            건너뛰기
          </button>
          <div className="tour-nav">
            {index > 0 && (
              <button className="tour-back" type="button" onClick={goBack}>
                이전
              </button>
            )}
            <button className="tour-next" type="button" onClick={goNext}>
              {isLast ? "시작하기" : "다음"}
            </button>
          </div>
        </footer>
      </article>
    </section>
  );
}
