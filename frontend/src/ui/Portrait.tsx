import { useState } from "react";
import { characterFor } from "../data/characters";

/**
 * 인물 초상.
 *
 * 인물당 그림은 한 장뿐이라 표정을 늘릴 수 없다. 대신 상태에 따라 색과 테두리를 바꿔
 * "지금 이 사람이 어떤 처지인가"를 표시한다. 추가 아트워크 없이 CSS만 쓴다.
 *
 * `id`는 인물 ID(`MAYA`)와 현장 오브젝트 ID(`NPC_MAYA`)를 모두 받는다. 심문은 후자를,
 * 재판과 수첩은 전자를 들고 있어서 부르는 쪽마다 변환하면 반드시 한 군데를 빠뜨린다.
 */
export type PortraitState =
  | "idle"
  /** 지금 말하고 있다. */
  | "speaking"
  /** 증거를 들이민 직후. */
  | "pressed"
  /** 배제가 확정됐다. */
  | "excluded"
  /** 범인으로 확정됐다. */
  | "culprit";

export function Portrait({
  id,
  state = "idle",
  className = "",
  rim = true,
}: {
  id: string;
  state?: PortraitState;
  className?: string;
  /** 인물 색 림라이트. 작은 원형 아바타에서는 뭉개지므로 끈다. */
  rim?: boolean;
}) {
  const character = characterFor(id);
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`portrait portrait--${state} ${className}`.trim()}
      style={{ "--who": character.accent } as React.CSSProperties}
      data-character={character.id}
    >
      {/* 초상을 못 받아도 화면이 비지 않게 이니셜을 깔아 둔다. */}
      <span className="portrait-fallback" aria-hidden="true">
        {character.name.slice(0, 1)}
      </span>
      {!failed && character.portrait && (
        <img
          src={character.portrait}
          alt={character.name}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {rim && <span className="portrait-rim" aria-hidden="true" />}
    </div>
  );
}
