import { create } from "zustand";
import { persist } from "zustand/middleware";

type SettingsState = {
  open: boolean;
  /** 플레이 안내 오버레이 표시 여부. 저장하지 않는다. */
  guideOpen: boolean;
  /** 안내를 한 번이라도 닫았는지. 첫 플레이에만 자동으로 띄우기 위해 저장한다. */
  guideSeen: boolean;
  /** 수첩 탭 안내 표시 여부. 저장하지 않는다. */
  notebookGuideOpen: boolean;
  /** 수첩 안내를 한 번이라도 닫았는지. 수첩을 처음 열 때만 자동으로 띄운다. */
  notebookGuideSeen: boolean;
  masterVolume: number;
  audioEnabled: boolean;
  reducedMotion: boolean;
  subtitles: boolean;
  setOpen: (open: boolean) => void;
  setGuideOpen: (open: boolean) => void;
  closeGuide: () => void;
  setNotebookGuideOpen: (open: boolean) => void;
  closeNotebookGuide: () => void;
  setMasterVolume: (value: number) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setReducedMotion: (enabled: boolean) => void;
  setSubtitles: (enabled: boolean) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      open: false,
      guideOpen: false,
      guideSeen: false,
      notebookGuideOpen: false,
      notebookGuideSeen: false,
      masterVolume: 0.42,
      audioEnabled: true,
      reducedMotion: false,
      subtitles: true,
      setOpen: (open) => set({ open }),
      setGuideOpen: (guideOpen) => set({ guideOpen }),
      closeGuide: () => set({ guideOpen: false, guideSeen: true }),
      setNotebookGuideOpen: (notebookGuideOpen) => set({ notebookGuideOpen }),
      closeNotebookGuide: () => set({ notebookGuideOpen: false, notebookGuideSeen: true }),
      setMasterVolume: (masterVolume) => set({ masterVolume }),
      setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setSubtitles: (subtitles) => set({ subtitles }),
    }),
    {
      name: "arcadia-station-settings-v1",
      partialize: ({
        open: _open,
        guideOpen: _guideOpen,
        notebookGuideOpen: _notebookGuideOpen,
        ...settings
      }) => settings,
      version: 2,
      migrate: (persistedState) => {
        // v0~v1은 그래픽 품질과 마우스 감도를 저장했다. 2D에는 렌더 품질 단계도 시점 회전도
        // 없어서 그 값들은 아무 데도 쓰이지 않는다. 저장 데이터에서 떼어 낸다.
        const {
          graphicsQuality: _quality,
          graphicsQualityChosen: _chosen,
          mouseSensitivity: _sensitivity,
          ...settings
        } = persistedState as Partial<SettingsState> & {
          graphicsQuality?: unknown;
          graphicsQualityChosen?: unknown;
          mouseSensitivity?: unknown;
        };
        return settings as SettingsState;
      },
    },
  ),
);
