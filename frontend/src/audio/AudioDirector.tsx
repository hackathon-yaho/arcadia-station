import { useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";

let activeMaster: GainNode | null = null;

export function AudioDirector() {
  const enabled = useSettingsStore((state) => state.audioEnabled);
  const volume = useSettingsStore((state) => state.masterVolume);

  useEffect(() => {
    if (!enabled) return;

    let context: AudioContext | null = null;
    let master: GainNode | null = null;
    let hum: OscillatorNode | null = null;
    let overtone: OscillatorNode | null = null;
    let lfo: OscillatorNode | null = null;

    const start = () => {
      if (context) {
        void context.resume();
        return;
      }

      context = new AudioContext();
      master = context.createGain();
      master.gain.value = volume * 0.055;
      master.connect(context.destination);
      activeMaster = master;

      hum = context.createOscillator();
      hum.type = "sine";
      hum.frequency.value = 48;
      hum.connect(master);

      overtone = context.createOscillator();
      overtone.type = "triangle";
      overtone.frequency.value = 96.4;
      const overtoneGain = context.createGain();
      overtoneGain.gain.value = 0.22;
      overtone.connect(overtoneGain).connect(master);

      lfo = context.createOscillator();
      lfo.frequency.value = 0.075;
      const modulation = context.createGain();
      modulation.gain.value = 4.5;
      lfo.connect(modulation).connect(hum.frequency);

      hum.start();
      overtone.start();
      lfo.start();
    };

    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      hum?.stop();
      overtone?.stop();
      lfo?.stop();
      activeMaster = null;
      void context?.close();
    };
  }, [enabled]);

  useEffect(() => {
    if (activeMaster) {
      activeMaster.gain.setTargetAtTime(volume * 0.055, activeMaster.context.currentTime, 0.08);
    }
  }, [volume]);

  return null;
}
