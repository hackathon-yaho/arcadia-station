import { useCallback, useEffect, useState } from "react";
import { GameUI } from "./ui/GameUI";
import { useGameStore } from "./store/gameStore";
import { AudioDirector } from "./audio/AudioDirector";
import { SettingsPanel } from "./ui/SettingsPanel";
import { MobileControls } from "./ui/MobileControls";
import { StationCanvas } from "./ui/StationCanvas";
import { useSettingsStore } from "./store/settingsStore";
import { INVESTIGATION_OBJECTS } from "./data/investigation";
import { preloadPortraits } from "./data/characters";

declare global {
  interface Window {
    __ARCADIA_QA__?: {
      toggleNotebook: () => string;
      setSettingsOpen: (open: boolean) => void;
      showScreen: (
        screen:
          | "dayReview"
          | "interrogation"
          | "evidence"
          | "theory"
          | "trial"
          | "review"
          | "result"
      ) => void;
    };
  }
}

export default function App() {
  const layer = useGameStore((state) => state.layer);
  const reducedMotion = useSettingsStore((state) => state.reducedMotion);
  const [sceneReady, setSceneReady] = useState(false);
  const handleSceneReady = useCallback(() => setSceneReady(true), []);

  useEffect(() => {
    if (layer === "opening") setSceneReady(false);
  }, [layer]);

  // 심문 창이 열리는 순간 초상이 비어 있지 않도록 미리 받아 둔다.
  useEffect(() => preloadPortraits(), []);

  // 안내는 HUD 요소를 하나씩 짚어 주므로 정거장이 실제로 떠 있을 때만 시작한다.
  useEffect(() => {
    if (!sceneReady || layer !== "playing") return;
    const settings = useSettingsStore.getState();
    if (!settings.guideSeen) settings.setGuideOpen(true);
  }, [layer, sceneReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useGameStore.getState();
      const settings = useSettingsStore.getState();

      // 안내가 열려 있으면 게임 조작을 받지 않는다. 단계 이동과 ESC는 GuideTour가 처리한다.
      if (settings.guideOpen || settings.notebookGuideOpen) {
        if (event.code === "Tab") event.preventDefault();
        return;
      }

      if (event.code === "Escape" && settings.open) {
        settings.setOpen(false);
        return;
      }

      if (event.code === "Tab" && state.layer !== "opening") {
        event.preventDefault();
        state.toggleNotebook();
      }

      if (
        event.code === "Escape" &&
        (state.layer === "inspection" ||
          state.layer === "interrogation" ||
          state.layer === "notebook" ||
          state.layer === "dayReview")
      ) {
        state.closeOverlay();
        return;
      }

      if (event.code === "Escape" && state.layer === "playing") {
        document.exitPointerLock?.();
        settings.setOpen(true);
        return;
      }

      if (state.layer !== "playing") return;

      // HUD의 안내 버튼에 표기한 단축키.
      if (event.key === "?") {
        settings.setGuideOpen(true);
        return;
      }

      if (event.code === "KeyE" && state.focusedId) {
        state.openInspection(state.focusedId);
      }

      if (event.code === "KeyQ" && !event.repeat) {
        state.activateScan();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__ARCADIA_QA__ = {
      toggleNotebook: () => {
        useGameStore.getState().toggleNotebook();
        return useGameStore.getState().layer;
      },
      setSettingsOpen: (open) => useSettingsStore.getState().setOpen(open),
      showScreen: (screen) => {
        // 물리 계층: 조사한 3D 오브젝트. 진행 게이트가 이걸 본다.
        const inspected = [
          "CO_BODY",
          "CO_DOOR_LOG",
          "CO_ENV_PANEL",
          "CO_TERMINAL",
          "EN_LIFE_SUPPORT",
          "CM_SECURITY_ARCHIVE",
          "CG_AIRLOCK_LOG",
          "MD_MEDICAL_TERMINAL",
        ];
        // 지식 계층: 서버가 해금해 준 단서. 수첩·이론·재판이 이걸 본다.
        // 문맥 필드도 함께 채운다. 비워 두면 QA 화면에서 연결·미해결 표시를 확인할 수 없다.
        const evidence = inspected.map((objectId, index) => ({
          clueId: `MOCK-${objectId}`,
          title: INVESTIGATION_OBJECTS[objectId]?.evidenceLabel ?? objectId,
          clueType: (["PHYSICAL", "DIGITAL", "OPPORTUNITY", "MOTIVE"] as const)[index % 4],
          playerText: INVESTIGATION_OBJECTS[objectId]?.detail ?? "",
          sourceObjectId: objectId,
          isCore: index % 2 === 0,
          revealedFacts: [
            {
              factId: `FACT-${objectId}`,
              statement: `${INVESTIGATION_OBJECTS[objectId]?.evidenceLabel ?? objectId}에 해당하는 기록이 남아 있다.`,
            },
          ],
          // 같은 종류끼리 이어 둔다. 네 종류를 돌려 쓰므로 카드마다 짝이 생긴다.
          linkedClueIds: inspected
            .filter((other, otherIndex) => other !== objectId && otherIndex % 4 === index % 4)
            .map((other) => `MOCK-${other}`),
          suspectEffects: [
            {
              characterId: ["MAYA", "JUNHO", "SOPHIA", "KASIM", "YUNA"][index % 5],
              effect: (["SUPPORTS", "EXCLUDES", "NEUTRAL"] as const)[index % 3],
            },
          ],
          hasPendingConnection: index % 4 === 0,
        }));
        const theory = {
          suspectId: "JUNHO",
          setup: "MOCK-CO_ENV_PANEL",
          trigger: "MOCK-EN_LIFE_SUPPORT",
          opportunity: "MOCK-CO_DOOR_LOG",
          motive: "MOCK-CO_TERMINAL",
          exclusions: {
            MAYA: "MOCK-CO_BODY",
            SOPHIA: "MOCK-MD_MEDICAL_TERMINAL",
            KASIM: "MOCK-CM_SECURITY_ARCHIVE",
            YUNA: "MOCK-CG_AIRLOCK_LOG",
          },
        };

        if (screen === "dayReview") {
          useGameStore.setState({ layer: "dayReview", discoveredIds: inspected, evidence });
        } else if (screen === "interrogation") {
          useGameStore.setState({
            layer: "interrogation",
            selectedId: "NPC_MAYA",
            // 심문 채널 조회는 세션이 있어야 시작된다. 저장된 상태에 의존하지 않도록 직접 세운다.
            sessionId: useGameStore.getState().sessionId ?? "LOCAL-QA",
            discoveredIds: inspected, evidence,
          });
        } else if (screen === "evidence") {
          useGameStore.setState({
            layer: "notebook",
            notebookTab: "evidence",
            discoveredIds: inspected, evidence,
            // 일부만 분류해 둔다. 분류된 카드와 미분류 카운터를 함께 확인하기 위해서다.
            evidenceTags: {
              "MOCK-CO_BODY": ["SETUP"],
              "MOCK-CO_DOOR_LOG": ["OPPORTUNITY", "EXCLUSION"],
              "MOCK-CO_TERMINAL": ["MOTIVE"],
            },
          });
        } else if (screen === "theory") {
          useGameStore.setState({
            layer: "notebook",
            notebookTab: "theory",
            phase: "DAY2",
            discoveredIds: inspected, evidence,
            theory,
          });
        } else if (screen === "review") {
          useGameStore.setState({
            layer: "trial",
            phase: "DAY2",
            discoveredIds: inspected, evidence, theory,
            judgementPending: true,
            verdictJudgement: {
              verdict: "PARTIAL",
              culpritCorrect: true,
              roleResults: {
                SETUP: "CORRECT",
                TRIGGER: "INCORRECT",
                OPPORTUNITY: "CORRECT",
                MOTIVE: "INCORRECT",
              },
              exclusionResults: { MAYA: "CORRECT", SOPHIA: "INSUFFICIENT" },
              remainingAttempts: 2,
              feedback: "범인은 맞지만 실행 트리거, 동기 증거를 다시 확인해야 합니다.",
              missingLogic: [
                {
                  code: "WEAK_ROLE_EVIDENCE",
                  role: "TRIGGER",
                  characterId: null,
                  message: "실행 트리거 증거가 부족합니다.",
                },
                {
                  code: "WEAK_ROLE_EVIDENCE",
                  role: "MOTIVE",
                  characterId: null,
                  message: "동기 증거가 부족합니다.",
                },
                {
                  code: "WEAK_EXCLUSION",
                  role: null,
                  characterId: "SOPHIA",
                  message: "SOPHIA를 배제할 근거가 부족합니다.",
                },
              ],
            },
          });
        } else if (screen === "trial") {
          useGameStore.setState({ layer: "trial", phase: "DAY2", discoveredIds: inspected, evidence, theory });
        } else {
          useGameStore.setState({
            layer: "result",
            phase: "DAY2",
            discoveredIds: inspected, evidence,
            theory,
            trialResult: {
              accusedId: "JUNHO",
              votesFor: 5,
              ending: "CULPRIT_EXPELLED",
              correctAccusation: true,
            },
          });
        }
      },
    };
    return () => {
      delete window.__ARCADIA_QA__;
    };
  }, []);

  return (
    <main className="game-shell">
      {layer !== "opening" && (
        <>
          <StationCanvas onReady={handleSceneReady} />
          {!sceneReady && <SceneBootScreen />}
          <div
            className={`scene-grade ${reducedMotion ? "is-reduced" : ""}`}
            aria-hidden="true"
          />
        </>
      )}
      <GameUI />
      <MobileControls />
      <AudioDirector />
      <SettingsPanel />
    </main>
  );
}

function SceneBootScreen() {
  return (
    <div className="scene-boot" role="status">
      <i />
      <span>STATION LAYOUT</span>
      <strong>아르카디아 배치도 복원 중</strong>
    </div>
  );
}
