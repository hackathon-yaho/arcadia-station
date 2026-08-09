import { useRef } from "react";
import { useGameStore } from "../store/gameStore";

function emitMovement(code: string, pressed: boolean) {
  window.dispatchEvent(
    new CustomEvent("arcadia:move", { detail: { code, pressed } }),
  );
}

export function MobileControls() {
  const layer = useGameStore((state) => state.layer);
  const focusedId = useGameStore((state) => state.focusedId);
  const openInspection = useGameStore((state) => state.openInspection);
  const activateScan = useGameStore((state) => state.activateScan);
  const toggleNotebook = useGameStore((state) => state.toggleNotebook);

  if (layer !== "playing") return null;

  const bindMove = (code: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      emitMovement(code, true);
    },
    onPointerUp: () => emitMovement(code, false),
    onPointerCancel: () => emitMovement(code, false),
    onLostPointerCapture: () => emitMovement(code, false),
  });

  return (
    <div className="mobile-controls" aria-label="터치 게임 조작">
      <div className="mobile-movement" aria-label="이동">
        <button type="button" aria-label="앞으로 이동" {...bindMove("KeyW")}>▲</button>
        <button type="button" aria-label="왼쪽 이동" {...bindMove("KeyA")}>◀</button>
        <button type="button" aria-label="뒤로 이동" {...bindMove("KeyS")}>▼</button>
        <button type="button" aria-label="오른쪽 이동" {...bindMove("KeyD")}>▶</button>
      </div>

      {/* 탑다운에는 시점이 없다. 3D의 드래그 영역이 있던 자리는 비워 둔다. */}

      <div className="mobile-actions">
        <button type="button" onClick={activateScan}>SCAN</button>
        <button
          type="button"
          disabled={!focusedId}
          onClick={() => focusedId && openInspection(focusedId)}
        >
          조사
        </button>
        <button type="button" onClick={toggleNotebook}>수첩</button>
      </div>
    </div>
  );
}
