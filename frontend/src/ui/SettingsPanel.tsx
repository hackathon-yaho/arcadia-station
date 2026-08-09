import { useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";

export function SettingsPanel() {
  const settings = useSettingsStore();

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
  }, [settings.reducedMotion]);

  if (!settings.open) return null;

  return (
    <section className="settings-shell" role="dialog" aria-modal="true" aria-label="게임 설정">
      <button
        className="overlay-scrim"
        type="button"
        aria-label="설정 닫기"
        onClick={() => settings.setOpen(false)}
      />
      <div className="settings-panel">
        <header>
          <div>
            <span>SYSTEM // LOCAL CONFIG</span>
            <h2>접근 및 표시 설정</h2>
          </div>
          <button type="button" onClick={() => settings.setOpen(false)}>닫기 <kbd>ESC</kbd></button>
        </header>

        <label className="range-setting">
          <span>전체 음량 <strong>{Math.round(settings.masterVolume * 100)}%</strong></span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.masterVolume}
            onChange={(event) => settings.setMasterVolume(Number(event.target.value))}
          />
        </label>

        <div className="toggle-list">
          <Toggle
            label="정거장 환경음"
            detail="저주파 기계음과 전력 계통 앰비언스"
            checked={settings.audioEnabled}
            onChange={settings.setAudioEnabled}
          />
          <Toggle
            label="모션 감소"
            detail="스캔·화면 전환·환경 입자 움직임 최소화"
            checked={settings.reducedMotion}
            onChange={settings.setReducedMotion}
          />
          <Toggle
            label="고대비 대사"
            detail="심문 텍스트에 자막 배경과 강조선을 표시"
            checked={settings.subtitles}
            onChange={settings.setSubtitles}
          />
        </div>
      </div>
    </section>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-setting">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}
