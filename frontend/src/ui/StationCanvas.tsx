import { useEffect, useRef } from "react";
import {
  DOORS,
  MAP_CREW,
  MAP_OBJECTS,
  PLATES,
  PROPS,
  ROOMS,
  SPAWN,
  WALLS,
  zoneColor,
  type Box,
  type Prop,
} from "../data/stationMap";
import { INVESTIGATION_OBJECTS, REQUIRED_SCENE_IDS } from "../data/investigation";
import { characterFor } from "../data/characters";
import {
  axesFrom,
  facingFrom,
  focusAt,
  moveBy,
  roomAt,
  type Vec2,
} from "../domain/movement";
import {
  FIGURE_HEIGHT,
  TILT,
  drawFigure,
  drawProp,
  propHeight,
  type FigureState,
  type View,
} from "./miniatures";
import { useGameStore } from "../store/gameStore";
import { useSettingsStore } from "../store/settingsStore";

/**
 * 정거장 탑다운 화면.
 *
 * 3D의 `ArcadiaScene`·`PlayerController`·`InteractionController`가 하던 일을 한곳에서 한다.
 * 이동과 조준 규칙은 `domain/movement`에 있고 여기서는 그리기와 입력만 맡는다.
 *
 * 상태는 매 프레임 `getState()`로 읽는다. 스토어를 구독하면 초점이 바뀔 때마다 리렌더가 나서
 * 캔버스 루프와 React 렌더가 서로를 밀어낸다.
 */

/** 화면 세로에 담을 월드 단위. 작을수록 확대된다. */
const VIEW_HEIGHT = 17;

/**
 * 플레이어 주변이 밝은 반경(m).
 *
 * 넓게 잡으면 방 하나가 통째로 균일한 중간 톤이 되어 명암이 사라진다. 일러스트는 화면의
 * 38.9%가 순검정이고 그 대비가 화면을 회화로 만든다. 방보다 좁게 잡아야 같은 방 안에서도
 * 빛과 어둠이 갈린다.
 */
const LAMP_RADIUS = 8.4;

const REQUIRED = new Set<string>(REQUIRED_SCENE_IDS);

/** 벽 높이(m). 세워 올려야 정거장이 도면이 아니라 모형으로 보인다. */
const WALL_HEIGHT = 1.1;

/** `outer`가 `inner`를 통째로 품는지. */
const contains = (outer: Box, inner: Box) =>
  Math.abs(outer.x - inner.x) + inner.w / 2 <= outer.w / 2 &&
  Math.abs(outer.z - inner.z) + inner.d / 2 <= outer.d / 2;

/**
 * 앞뒤 순서를 미리 정해 둔 집기.
 *
 * 집기를 세워 올리면 겹칠 때 누가 앞인지가 생긴다. 아래쪽(z가 큰 쪽)에 있는 것이 앞이므로
 * 바닥 자국의 아래 모서리로 정렬한다. 자리는 고정이라 프레임마다 다시 정렬할 이유가 없다.
 *
 * 다만 큰 물건 위에 작은 물건이 얹힌 경우 — 책상 위의 단말, 허브 단 위의 코어 기둥 — 는
 * 큰 쪽의 앞 모서리가 더 가까워서 그대로 두면 받침이 얹힌 것을 덮어 버린다. 얹힌 쪽은
 * 받침의 순서를 물려받아 바로 뒤에 그린다.
 */
const SORTED_PROPS = PROPS.map((prop) => {
  const holder = PROPS.filter((other) => other !== prop && contains(other, prop)).sort(
    (x, y) => x.w * x.d - y.w * y.d,
  )[0];
  return { prop, depth: holder ? holder.z + holder.d / 2 + 0.001 : prop.z + prop.d / 2 };
}).sort((a, b) => a.depth - b.depth);

/**
 * 조사 지점이 얹혀 있는 집기.
 *
 * 표식과 이름표를 그 물건의 키만큼 띄우기 위해 필요하다. 지점을 품는 상자가 여럿이면
 * (책상 위의 단말처럼) 가장 작은 것이 그 지점의 정체다.
 */
const PROP_UNDER = new Map<string, Prop>(
  MAP_OBJECTS.flatMap((object) => {
    const holder = PROPS.filter(
      (prop) =>
        Math.abs(object.x - prop.x) <= prop.w / 2 + 0.1 &&
        Math.abs(object.z - prop.z) <= prop.d / 2 + 0.1,
    ).sort((a, b) => a.w * a.d - b.w * b.d)[0];
    return holder ? [[object.id, holder] as const] : [];
  }),
);

/** 바닥 바탕색. 구역 색은 여기에 섞어 쓴다. */
const FLOOR_BASE = [0x28, 0x22, 0x1c] as const;

const channels = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * 구역 색을 바닥 바탕에 섞은 불투명색.
 *
 * 색 계산은 화면 크기와 무관하므로 한 번만 하고 캐시한다. 프레임마다 스무 번씩 문자열을
 * 자르고 붙일 이유가 없다.
 */
const floorTints = new Map<string, string>();
function mixWithFloor(accent: string, amount: number): string {
  const key = `${accent}:${amount}`;
  const cached = floorTints.get(key);
  if (cached) return cached;
  const [r, g, b] = channels(zoneColor(accent));
  const mixed = `rgb(${[r, g, b]
    .map((value, index) => Math.round(FLOOR_BASE[index] + (value - FLOOR_BASE[index]) * amount))
    .join(",")})`;
  floorTints.set(key, mixed);
  return mixed;
}

export function StationCanvas({ onReady }: { onReady: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const player: Vec2 = { x: SPAWN.x, z: SPAWN.z };
    let facing = Math.PI;
    // 걸음 위상. 다리가 엇갈리고 몸이 뜨는 리듬이 여기서 나온다.
    let gait = 0;
    let walking = false;
    const pressed = new Set<string>();
    const visited = new Set<string>();
    let raf = 0;
    let last = performance.now();

    // 화면 밖 어둠은 별도 캔버스에 그린 뒤 한 번에 덮는다. 지나온 방을 구멍처럼 뚫어야
    // 해서 destination-out 합성이 필요하고, 그걸 본 캔버스에 직접 쓰면 아래 그림이 지워진다.
    const shade = document.createElement("canvas");
    const shadeCtx = shade.getContext("2d");

    // 필름 그레인. 인물 일러스트는 붓질이 살아 있는데 캔버스는 벡터라 유독 매끈해서,
    // 둘을 나란히 두면 인물만 붙여 놓은 것처럼 보인다. 한 번 만들어 두고 계속 쓴다.
    const grain = document.createElement("canvas");
    grain.width = 128;
    grain.height = 128;
    const grainCtx = grain.getContext("2d");
    if (grainCtx) {
      const noise = grainCtx.createImageData(128, 128);
      for (let i = 0; i < noise.data.length; i += 4) {
        const value = 150 + Math.random() * 80;
        noise.data[i] = value;
        noise.data[i + 1] = value * 0.94;
        noise.data[i + 2] = value * 0.86;
        noise.data[i + 3] = 255;
      }
      grainCtx.putImageData(noise, 0, 0);
    }
    const grainPattern = ctx.createPattern(grain, "repeat");

    let width = 0;
    let height = 0;
    let scale = 1;
    let dpr = 1;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      shade.width = canvas.width;
      shade.height = canvas.height;
      scale = height / VIEW_HEIGHT;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const toScreenX = (x: number) => (x - player.x) * scale + width / 2;
    const toScreenZ = (z: number) => (z - player.z) * scale + height / 2;

    // 미니어처 렌더러에 넘길 좌표계. 매 프레임 `scale`만 갱신해 쓴다.
    const view: View = { ctx, scale, toX: toScreenX, toZ: toScreenZ };

    /** 세워 올린 물건이 화면에 걸치는지. 정거장 절반은 늘 화면 밖이라 미리 걸러 낸다. */
    const onScreen = (box: Box, h: number) =>
      toScreenX(box.x + box.w / 2) > -8 &&
      toScreenX(box.x - box.w / 2) < width + 8 &&
      toScreenZ(box.z + box.d / 2) > -8 &&
      toScreenZ(box.z - box.d / 2) - h * TILT * scale < height + 8;

    /* ── 입력 ─────────────────────────────────────────────────────────── */
    const press = (event: KeyboardEvent) => pressed.add(event.code);
    const release = (event: KeyboardEvent) => pressed.delete(event.code);
    const clear = () => pressed.clear();
    // 터치 조작은 `MobileControls`가 같은 코드로 이벤트를 쏜다.
    const virtualMove = (event: Event) => {
      const { code, pressed: down } = (event as CustomEvent<{ code: string; pressed: boolean }>).detail;
      if (down) pressed.add(code);
      else pressed.delete(code);
    };
    window.addEventListener("keydown", press);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", clear);
    window.addEventListener("arcadia:move", virtualMove);

    /**
     * 지금 손이 닿는 대상의 이름과 자리.
     *
     * 이름표를 하나만 띄우기 위해 쓴다. `height`는 그 대상이 바닥에서 얼마나 솟아 있는지로,
     * 이름표를 머리 위나 물건 위에 걸어야 실루엣을 가리지 않는다.
     */
    const focusTarget = (id: string) => {
      const crew = MAP_CREW.find((item) => item.id === id);
      if (crew) {
        const person = characterFor(crew.id);
        const interviewed = useGameStore.getState().interviewedIds.includes(crew.id);
        return {
          x: crew.x,
          z: crew.z,
          height: FIGURE_HEIGHT,
          name: interviewed ? `${person.name} · 진술 확보` : person.name,
          color: zoneColor(crew.accent),
        };
      }
      const object = MAP_OBJECTS.find((item) => item.id === id);
      if (!object) return null;
      const holder = PROP_UNDER.get(object.id);
      return {
        x: object.x,
        z: object.z,
        height: holder ? propHeight(holder.kind) : 0.8,
        name: INVESTIGATION_OBJECTS[object.id]?.title ?? object.id,
        color: "#e0d3bd",
      };
    };

    /**
     * 이름표.
     *
     * 예전에는 알약 모양 상자를 근처 대상마다 띄웠다. 화면에 대여섯 개가 동시에 떠 있으면
     * 정거장이 아니라 안내판을 보게 되고, 둥근 상자 자체가 화면을 아기자기하게 만든다.
     * 지금은 손이 닿는 대상 하나에만, 상자 없이 인출선 한 줄로 붙인다.
     */
    const drawLabel = (x: number, z: number, height: number, text: string, color: string) => {
      const px = toScreenX(x);
      const pz = toScreenZ(z) - height * TILT * scale;
      const lift = scale * 0.75;
      ctx.strokeStyle = "rgba(216,199,173,.34)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, pz - scale * 0.14);
      ctx.lineTo(px, pz - lift);
      ctx.stroke();

      ctx.font = `500 ${Math.round(scale * 0.36)}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const pad = scale * 0.22;
      const w = ctx.measureText(text).width;
      // 글자 뒤만 살짝 눌러 둔다. 바닥 도장 위에서도 읽히되 상자로는 보이지 않게.
      ctx.fillStyle = "rgba(10,8,6,.72)";
      ctx.fillRect(px - w / 2 - pad, pz - lift - scale * 0.42, w + pad * 2, scale * 0.52);
      ctx.fillStyle = color;
      ctx.fillText(text, px, pz - lift);
    };

    /* ── 한 프레임 ────────────────────────────────────────────────────── */
    const step = (deltaSeconds: number) => {
      const state = useGameStore.getState();
      const settings = useSettingsStore.getState();
      // 안내나 설정이 열려 있으면 손을 떼도 계속 걷는 일이 없도록 입력을 버린다.
      const frozen = state.layer !== "playing" || settings.guideOpen || settings.open;
      if (frozen) {
        pressed.clear();
        walking = false;
        if (state.focusedId !== null) state.setFocused(null);
        return;
      }

      const axes = axesFrom(pressed);
      walking = axes.x !== 0 || axes.z !== 0;
      if (walking) {
        const next = moveBy(player, axes.x, axes.z, deltaSeconds);
        player.x = next.x;
        player.z = next.z;
        facing = facingFrom(axes.x, axes.z, facing);
        // 걷는 동안에만 위상이 돈다. 멈추면 그 자리에서 멎어야 다음 걸음이 자연스럽다.
        gait += deltaSeconds * 11;
        state.markMoved();
      }

      const here = roomAt(player);
      if (here) visited.add(here.id);

      const focus = focusAt(player);
      if ((focus?.id ?? null) !== state.focusedId) state.setFocused(focus?.id ?? null);
    };

    const draw = (now: number) => {
      const { discoveredIds, scanUntil, focusedId } = useGameStore.getState();
      const discovered = new Set(discoveredIds);
      const scanning = scanUntil > now;

      view.scale = scale;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0a0806";
      ctx.fillRect(0, 0, width, height);


      /*
       * 정거장 선체.
       *
       * 방과 방 사이에는 벽 두 장 사이의 빈 구간이 남는다. 그 자리를 우주와 같은 검정으로
       * 두면 벽이 두 겹으로 서 있고 사이가 뚫린 것처럼 보인다. 실제로는 구조물이 차 있는
       * 자리다. 바닥과 벽을 넉넉히 부풀려 한 덩어리로 칠하면 그 틈이 메워지고, 동시에
       * 정거장의 윤곽이 우주를 배경으로 또렷하게 선다.
       *
       * 모두 불투명이라 사각형이 겹쳐도 색이 진해지지 않고 하나로 합쳐진다.
       */
      const hullParts = [...ROOMS, ...PLATES, ...WALLS];
      const hullPad = 1.15 * scale;
      const hullFill = (pad: number, color: string) => {
        ctx.fillStyle = color;
        for (const part of hullParts) {
          ctx.fillRect(
            toScreenX(part.x - part.w / 2) - pad,
            toScreenZ(part.z - part.d / 2) - pad,
            part.w * scale + pad * 2,
            part.d * scale + pad * 2,
          );
        }
      };
      hullFill(hullPad + Math.max(2, scale * 0.14), "#0b0907");
      hullFill(hullPad, "#171310");

      // 바닥. 구역 색을 옅게 깔고 가장자리에 도장선을 넣어 "칠해진 구역"으로 보이게 한다.
      //
      // 반투명으로 덮지 않고 미리 섞은 불투명색으로 칠한다. 이웃한 방의 바닥판은 3D에서부터
      // 한 뼘씩 겹쳐 있어서, 반투명으로 칠하면 그 띠만 두 번 물들어 없는 경계선이 생긴다.
      const plate = (x: number, z: number, w: number, d: number, accent: string, painted: boolean) => {
        const left = toScreenX(x - w / 2);
        const top = toScreenZ(z - d / 2);
        ctx.fillStyle = mixWithFloor(accent, 0.06);
        ctx.fillRect(left, top, w * scale, d * scale);
        if (painted) {
          // 방을 사각형으로 두르면 게임 UI가 된다. 실제 시설 바닥처럼 모서리만 짧게 긋는다.
          const inset = scale * 0.5;
          const arm = Math.min(scale * 1.6, w * scale * 0.22, d * scale * 0.22);
          ctx.strokeStyle = mixWithFloor(accent, 0.26);
          ctx.lineWidth = Math.max(1, scale * 0.055);
          ctx.beginPath();
          for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            const cx = left + inset + sx * (w * scale - inset * 2);
            const cz = top + inset + sz * (d * scale - inset * 2);
            const dx = sx ? -arm : arm;
            const dz = sz ? -arm : arm;
            ctx.moveTo(cx, cz + dz);
            ctx.lineTo(cx, cz);
            ctx.lineTo(cx + dx, cz);
          }
          ctx.stroke();
        }
      };
      for (const room of ROOMS) plate(room.x, room.z, room.w, room.d, room.accent, true);
      for (const pad of PLATES) plate(pad.x, pad.z, pad.w, pad.d, pad.accent, false);

      // 바닥 격자
      ctx.strokeStyle = "rgba(216,199,173,.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const fromX = Math.floor(player.x - width / 2 / scale);
      const toX = Math.ceil(player.x + width / 2 / scale);
      const fromZ = Math.floor(player.z - height / 2 / scale);
      const toZ = Math.ceil(player.z + height / 2 / scale);
      for (let x = fromX - (fromX % 2); x <= toX; x += 2) {
        ctx.moveTo(toScreenX(x), 0);
        ctx.lineTo(toScreenX(x), height);
      }
      for (let z = fromZ - (fromZ % 2); z <= toZ; z += 2) {
        ctx.moveTo(0, toScreenZ(z));
        ctx.lineTo(width, toScreenZ(z));
      }
      ctx.stroke();

      // 구역 코드를 바닥에 크게 찍는다. 실제 시설 바닥 도장처럼 위치를 알려 준다.
      ctx.save();
      ctx.globalAlpha = 0.09;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 ${Math.round(scale * 0.9)}px "IBM Plex Mono", monospace`;
      for (const room of ROOMS) {
        ctx.fillStyle = zoneColor(room.accent);
        ctx.fillText(room.code, toScreenX(room.x), toScreenZ(room.z + room.d / 2 - 1.1));
      }
      ctx.restore();

      // 문턱
      for (const door of DOORS) {
        ctx.strokeStyle = zoneColor(door.accent);
        ctx.lineWidth = Math.max(2, scale * 0.1);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        if (door.vertical) {
          ctx.moveTo(toScreenX(door.x), toScreenZ(door.z - 1.7));
          ctx.lineTo(toScreenX(door.x), toScreenZ(door.z + 1.7));
        } else {
          ctx.moveTo(toScreenX(door.x - 1.7), toScreenZ(door.z));
          ctx.lineTo(toScreenX(door.x + 1.7), toScreenZ(door.z));
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /*
       * 벽.
       *
       * 정거장의 벽은 사각형 57장이지만 눈에는 이어진 한 덩어리로 보여야 한다. 사각형마다
       * 테두리와 하이라이트를 그리면 이어진 벽 한가운데에 이음매가 생겨 구조가 흩어진다.
       * 그래서 종류별로 나눠 칠한다. 모두 불투명이라 겹쳐도 색이 진해지지 않고 하나로 합쳐진다.
       *
       *   1. 바닥 그림자   2. 윗면   3. 이쪽을 향한 벽면   4. 위쪽 모서리 하이라이트
       *
       * 집기와 같은 기울기로 세워 올린다. 벽만 바닥에 눕혀 두면 방 안의 물건은 모형인데
       * 방 자체는 도면이라 두 어법이 한 화면에서 싸운다.
       */
      const wallRect = (wall: (typeof WALLS)[number], grow = 0, dz = 0) =>
        [
          toScreenX(wall.x - wall.w / 2) - grow,
          toScreenZ(wall.z - wall.d / 2) - grow + dz,
          wall.w * scale + grow * 2,
          wall.d * scale + grow * 2,
        ] as const;

      const wallLift = WALL_HEIGHT * TILT * scale;
      const drop = Math.max(2, scale * 0.16);
      ctx.fillStyle = "#080605";
      for (const wall of WALLS) {
        const [x, y, w, d] = wallRect(wall, 1, drop);
        ctx.fillRect(x, y, w, d);
      }
      ctx.fillStyle = "#3d342b";
      for (const wall of WALLS) {
        const [x, y, w, d] = wallRect(wall, 0, -wallLift);
        ctx.fillRect(x, y, w, d);
      }
      ctx.fillStyle = "#241e18";
      for (const wall of WALLS) {
        const [x, y, w, d] = wallRect(wall);
        ctx.fillRect(x, y + d - wallLift, w, wallLift);
      }
      // 하이라이트는 위쪽 모서리에만 얹고, 다른 벽에 가려진 구간은 건너뛴다.
      // 이 확인을 빼면 벽이 만나는 모서리마다 밝은 토막이 남아 벽이 토막 나 보인다.
      const capHeight = Math.max(1.5, scale * 0.1);
      ctx.fillStyle = "rgba(216,199,173,.3)";
      for (const wall of WALLS) {
        const edgeZ = wall.z - wall.d / 2 + capHeight / scale / 2;
        const hidden = WALLS.some(
          (other) =>
            other !== wall &&
            Math.abs(wall.x - other.x) < other.w / 2 - 0.05 &&
            Math.abs(edgeZ - other.z) < other.d / 2 - 0.05,
        );
        if (hidden) continue;
        const [x, y, w] = wallRect(wall, 0, -wallLift);
        ctx.fillRect(x, y, w, capHeight);
      }

      /*
       * 집기와 사람.
       *
       * 둘을 한 줄에 세워 z 순서대로 그린다. 따로 그리면 사람이 늘 책상 앞이거나 늘 책상
       * 뒤라서, 방을 가로질러도 공간이 아니라 겹쳐 놓은 두 장의 그림으로 보인다.
       */
      const figures: FigureState[] = MAP_CREW.map((crew) => {
        const distance = Math.hypot(crew.x - player.x, crew.z - player.z);
        return {
          x: crew.x,
          z: crew.z,
          // 가까이 가면 이쪽을 돌아본다. 멀면 3D에 배치된 방향 그대로 서 있다.
          angle: distance < 6 ? Math.atan2(player.x - crew.x, player.z - crew.z) : crew.facing,
          characterId: crew.id,
          // 서 있는 사람도 아주 조금은 움직인다. 사람마다 위상을 어긋내야 인형 진열이 아니다.
          gait: now / 1100 + crew.x,
          moving: false,
          highlighted: focusedId === crew.id,
        };
      });
      figures.push({
        x: player.x,
        z: player.z,
        angle: facing,
        characterId: "PLAYER",
        gait,
        moving: walking,
        highlighted: false,
      });
      figures.sort((a, b) => a.z - b.z);

      let nextFigure = 0;
      const figuresUpTo = (depth: number) => {
        while (nextFigure < figures.length && figures[nextFigure].z <= depth) {
          drawFigure(view, figures[nextFigure]);
          nextFigure += 1;
        }
      };
      for (const { prop, depth } of SORTED_PROPS) {
        figuresUpTo(depth);
        if (onScreen(prop, propHeight(prop.kind))) drawProp(view, prop);
      }
      figuresUpTo(Infinity);

      /*
       * 조사 지점 표식.
       *
       * 맥동하는 마름모는 "여기 눌러요"라고 외치는 모바일 게임의 어법이라, 회화적인 인물
       * 일러스트와 같은 화면에 놓이면 화면 전체가 장난감이 된다. 대신 카메라 초점 마크처럼
       * 네 귀퉁이만 짧게 긋는다. 표식이 물건을 가리키지 않고 물건 주위를 비워 둔다.
       *
       * 물건이 세워지면서 표식도 그 실루엣을 감싸야 한다. 바닥 자국만 두르면 정작 눈이 가는
       * 몸통은 표식 밖에 남는다.
       */
      const bracket = (
        px: number,
        py: number,
        halfX: number,
        halfY: number,
        color: string,
        weight: number,
      ) => {
        const arm = Math.min(halfX, halfY) * 0.45;
        ctx.strokeStyle = color;
        ctx.lineWidth = weight;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          ctx.moveTo(px + sx * halfX, py + sy * (halfY - arm));
          ctx.lineTo(px + sx * halfX, py + sy * halfY);
          ctx.lineTo(px + sx * (halfX - arm), py + sy * halfY);
        }
        ctx.stroke();
      };

      for (const object of MAP_OBJECTS) {
        const found = discovered.has(object.id);
        const color = found
          ? "rgba(150,138,122,.42)"
          : REQUIRED.has(object.id)
            ? "#b8563f"
            : "rgba(214,199,175,.85)";
        const holder = PROP_UNDER.get(object.id);
        const lift = (holder ? propHeight(holder.kind) : 0.8) * TILT * scale;
        const px = toScreenX(object.x);
        const py = toScreenZ(object.z) - lift / 2;
        // 스캔 중에만 숨을 쉰다. 평소에는 가만히 있어야 화면이 조용하다.
        const breath = scanning ? (Math.sin(now / 260 + object.x) + 1) / 2 : 0;
        const grow = 1 + breath * 0.35;
        const halfX =
          Math.max(scale * 0.5, ((holder?.w ?? 0.7) / 2) * scale + scale * 0.24) * grow;
        const halfY =
          Math.max(scale * 0.5, ((holder?.d ?? 0.7) / 2) * scale + lift / 2 + scale * 0.24) * grow;
        if (scanning && !found) {
          ctx.globalAlpha = 0.35 + breath * 0.4;
          bracket(px, py, halfX * 1.45, halfY * 1.45, color, Math.max(1, scale * 0.05));
          ctx.globalAlpha = 1;
        }
        bracket(px, py, halfX, halfY, color, Math.max(1.2, scale * (found ? 0.045 : 0.06)));
        if (!found) {
          // 점 하나. 물건 바로 위에 떠서 아직 손대지 않았다는 표시가 된다.
          ctx.fillStyle = color;
          ctx.fillRect(px - scale * 0.05, py - halfY - scale * 0.22, scale * 0.1, scale * 0.1);
        }
      }

      // 이름은 지금 손이 닿는 하나만. 인물까지 다 그린 뒤라야 플레이어 뒤로 숨지 않는다.
      const focused = focusedId ? focusTarget(focusedId) : null;
      if (focused) drawLabel(focused.x, focused.z, focused.height, focused.name, focused.color);

      // 조명. 지나온 방은 희미하게 남고 지금 서 있는 자리만 환하다.
      if (shadeCtx) {
        shadeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        shadeCtx.globalCompositeOperation = "source-over";
        shadeCtx.fillStyle = "rgba(6,5,4,.95)";
        shadeCtx.fillRect(0, 0, width, height);
        shadeCtx.globalCompositeOperation = "destination-out";
        for (const room of ROOMS) {
          if (!visited.has(room.id)) continue;
          shadeCtx.fillStyle = "rgba(0,0,0,.26)";
          shadeCtx.fillRect(
            toScreenX(room.x - room.w / 2),
            toScreenZ(room.z - room.d / 2),
            room.w * scale,
            room.d * scale,
          );
        }
        const lamp = shadeCtx.createRadialGradient(
          width / 2, height / 2, scale * 1.5,
          width / 2, height / 2, scale * LAMP_RADIUS,
        );
        // 가운데는 완전히 뚫고 바깥으로 갈수록 급하게 닫는다. 완만하게 떨어뜨리면
        // 방 하나가 통째로 반쯤 밝아져서 명암이 사라진다.
        lamp.addColorStop(0, "rgba(0,0,0,1)");
        lamp.addColorStop(0.38, "rgba(0,0,0,.94)");
        lamp.addColorStop(0.72, "rgba(0,0,0,.46)");
        lamp.addColorStop(1, "rgba(0,0,0,0)");
        shadeCtx.fillStyle = lamp;
        shadeCtx.fillRect(0, 0, width, height);
        shadeCtx.globalCompositeOperation = "source-over";
        ctx.drawImage(shade, 0, 0, width, height);
      }

      const vignette = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.32,
        width / 2, height / 2, Math.max(width, height) * 0.72,
      );
      vignette.addColorStop(0, "rgba(10,8,6,0)");
      vignette.addColorStop(1, "rgba(10,8,6,.72)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      if (grainPattern) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light";
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = grainPattern;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    };

    const frame = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      step(delta);
      draw(now);
      if (import.meta.env.DEV) {
        canvas.dataset.playerPosition = `${player.x.toFixed(2)},${player.z.toFixed(2)}`;
      }
      if (!readyRef.current) {
        readyRef.current = true;
        onReady();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("keydown", press);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", clear);
      window.removeEventListener("arcadia:move", virtualMove);
    };
  }, [onReady]);

  return <canvas className="station-canvas" ref={canvasRef} aria-hidden="true" />;
}
