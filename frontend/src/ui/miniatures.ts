import { characterFor, type Build, type EyeShape } from "../data/characters";
import type { Box, Prop, PropKind } from "../data/stationMap";

/**
 * 미니어처 렌더러.
 *
 * 정거장의 집기와 사람을 "위에서 조금 기울여 내려다본 모형"으로 그린다.
 *
 * 그전에는 충돌 상자를 그대로 바닥에 눕혀 칠했다. 그러면 책상도 크레이트도 시신도 전부
 * 같은 회색 판이라 화면이 장소가 아니라 도면으로 읽힌다. 여기서는 바닥 자국을 위로 세워
 * 윗면과 앞면을 만들고, 그 위에 그 물건다운 것 — 서랍선, 화면 빛, 통풍구, 손잡이 — 을
 * 얹는다. 물건마다 실루엣이 달라지면 방 안에서 무엇을 보고 있는지가 눈으로 바로 온다.
 *
 * 높이는 진짜 3D가 아니라 세로로만 늘린 가짜다. 카메라가 정확히 수직이 아니라 살짝
 * 기울어 있다고 치고, 높이 1m를 바닥 1m의 `TILT`배로 환산해 화면 위쪽으로 세운다.
 * 물건이 앞뒤로 겹칠 때 어느 쪽이 앞인지는 부르는 쪽에서 z로 정렬해 정한다.
 */

/** 높이 1m가 화면에서 차지하는 세로 길이. 바닥 1m를 1로 본다. */
export const TILT = 0.5;

/** 빛이 오는 쪽. 벽 그림자가 오른쪽 아래로 지는 것과 방향을 맞춘다. */
const LIGHT = -Math.PI * 0.75;

/** 화면 좌표로 옮기는 법. 매 프레임 바뀌는 값이라 객체 하나를 돌려 쓴다. */
export type View = {
  ctx: CanvasRenderingContext2D;
  /** 바닥 1m가 몇 픽셀인지. */
  scale: number;
  toX: (x: number) => number;
  toZ: (z: number) => number;
};

/**
 * 재질.
 *
 * 인물 일러스트가 세피아 한 통에 담겨 있어서 물건도 같은 통 안에 있어야 한다. 색으로
 * 종류를 가르면 화면이 알록달록해지므로, 밝기와 온도만 조금씩 달리하고 종류는 모양으로
 * 가른다.
 */
type Material = { top: string; front: string; rim: string };

const STEEL: Material = { top: "#3a332a", front: "#221d18", rim: "rgba(228,214,190,.3)" };
const PAINT: Material = { top: "#463b30", front: "#2a221b", rim: "rgba(228,214,190,.32)" };
const CRATE: Material = { top: "#4b3d2b", front: "#2d2418", rim: "rgba(233,206,158,.34)" };
const CLOTH: Material = { top: "#4a443a", front: "#292420", rim: "rgba(224,211,189,.24)" };
const DARK: Material = { top: "#2a241e", front: "#171310", rim: "rgba(216,199,173,.2)" };

/** 켜져 있는 화면. 정거장에서 유일하게 차가운 빛이라 조금만 써야 눈에 든다. */
const SCREEN = "rgba(138,206,186,";
/** 경고등·계기판의 따뜻한 빛. */
const AMBER = "rgba(222,166,86,";

/** 단말이 얹히는 책상 높이(m). */
const TERMINAL_BASE = 0.7;
/** 패널이 붙는 벽 높이(m). */
const PANEL_BASE = 0.35;

/**
 * 물건이 바닥에서 솟은 총 높이(m).
 *
 * 조사 표식과 이름표를 얼마나 띄울지가 여기서 나오므로, 받침 위에 얹힌 것(책상 위 단말,
 * 벽에 붙은 패널)은 받침 높이까지 포함한 꼭대기여야 한다. 덩어리 자체의 두께가 아니다.
 */
export function propHeight(kind: PropKind): number {
  switch (kind) {
    case "dais":
      return 0.34;
    case "core":
      return 2.9;
    case "desk":
      return 0.76;
    case "terminal":
      return TERMINAL_BASE + 0.5;
    case "panel":
      return PANEL_BASE + 1.15;
    case "body":
      return 0.3;
    case "scanner":
      return 1.35;
    case "bed":
      return 0.58;
    case "cabinet":
      return 1.75;
    case "machine":
      return 1.5;
    case "crate":
      return 1.05;
    case "console":
      return 0.95;
    case "server":
      return 1.85;
    case "airlock":
      return 2.15;
    case "table":
      return 0.74;
    case "chair":
      return 0.48;
    case "counter":
      return 1.02;
    case "column":
      return 2.3;
  }
}

/* ── 기본 덩어리 ─────────────────────────────────────────────────────── */

/**
 * 세워 올린 상자 하나의 화면 좌표.
 *
 * 윗면은 바닥 자국을 통째로 위로 민 것이고, 앞면은 그 사이를 잇는 띠다. 둘을 합치면
 * 실루엣이 정확히 사각형 하나라서 테두리는 `strokeRect` 한 번으로 끝난다.
 */
type Slab = {
  l: number;
  w: number;
  d: number;
  /** 이 덩어리의 높이(px). */
  up: number;
  /** 윗면 위쪽 모서리. */
  topY: number;
  /** 앞면 위쪽 모서리 = 윗면 아래쪽 모서리. */
  frontY: number;
  /** 앞면 아래쪽 모서리. 바닥에 닿는 자리다. */
  footY: number;
};

function slab(v: View, box: Box, h: number, base = 0): Slab {
  const l = v.toX(box.x - box.w / 2);
  const w = box.w * v.scale;
  const d = box.d * v.scale;
  const up = h * TILT * v.scale;
  const footY = v.toZ(box.z + box.d / 2) - base * TILT * v.scale;
  return { l, w, d, up, topY: footY - d - up, frontY: footY - up, footY };
}

/**
 * 바닥에 지는 그림자. 물건이 바닥에 놓여 있다는 유일한 단서라 높이에 비례해 밀어 둔다.
 *
 * 둥근 물건은 사각 그림자를 깔면 실루엣보다 그림자가 커서 그림자가 곧 물건으로 보인다.
 * 특히 누워 있는 사람은 각진 그림자 하나로 다시 상자가 되어 버린다.
 */
function castShadow(v: View, box: Box, h: number, round = false): void {
  const { ctx } = v;
  const off = Math.max(1.5, h * TILT * v.scale * 0.3);
  const w = box.w * v.scale;
  const d = box.d * v.scale;
  if (round) {
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.5);
    grad.addColorStop(0, "rgba(6,5,4,.5)");
    grad.addColorStop(0.62, "rgba(6,5,4,.3)");
    grad.addColorStop(1, "rgba(6,5,4,0)");
    ctx.save();
    ctx.translate(v.toX(box.x) + off * 0.5, v.toZ(box.z) + off * 0.4);
    ctx.scale(w, d);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const l = v.toX(box.x - box.w / 2);
  const t = v.toZ(box.z - box.d / 2);
  ctx.fillStyle = "rgba(6,5,4,.34)";
  ctx.fillRect(l - off * 0.2 + off, t - off * 0.2 + off * 0.7, w + off * 0.4, d + off * 0.4);
  ctx.fillStyle = "rgba(6,5,4,.4)";
  ctx.fillRect(l + off * 0.6, t + off * 0.45, w, d);
}

/** 윗면·앞면·테두리를 한 번에. 미니어처의 기본 문법이라 거의 모든 물건이 여기서 시작한다. */
function fill(v: View, s: Slab, mat: Material): void {
  const { ctx } = v;
  ctx.fillStyle = mat.front;
  ctx.fillRect(s.l, s.frontY, s.w, s.up);
  // 바닥에 닿는 쪽을 눌러 둔다. 이게 없으면 물건이 바닥 위에 떠 보인다.
  const contact = Math.max(1, s.up * 0.24);
  ctx.fillStyle = "rgba(8,6,5,.5)";
  ctx.fillRect(s.l, s.footY - contact, s.w, contact);
  ctx.fillStyle = mat.top;
  ctx.fillRect(s.l, s.topY, s.w, s.d);
  ctx.fillStyle = mat.rim;
  ctx.fillRect(s.l, s.topY, s.w, Math.max(1, v.scale * 0.045));
  // 칠한 모형처럼 가장자리를 한 줄 어둡게 두른다. 바닥 도장 위에서도 물건이 떨어져 보인다.
  ctx.strokeStyle = "rgba(9,7,5,.8)";
  ctx.lineWidth = 1;
  ctx.strokeRect(s.l + 0.5, s.topY + 0.5, s.w - 1, s.d + s.up - 1);
}

/** 둥근 물건. 식탁·의자·코어 기둥처럼 각지지 않은 것에 쓴다. */
function cylinder(
  v: View,
  box: Box,
  h: number,
  mat: Material,
  base = 0,
): { cx: number; cy: number; rx: number; ry: number; up: number } {
  const { ctx } = v;
  const cx = v.toX(box.x);
  const cy = v.toZ(box.z) - base * TILT * v.scale;
  const rx = (box.w / 2) * v.scale;
  const ry = (box.d / 2) * v.scale;
  const up = h * TILT * v.scale;

  ctx.beginPath();
  ctx.moveTo(cx + rx, cy - up);
  ctx.lineTo(cx + rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - rx, cy - up);
  ctx.closePath();
  ctx.fillStyle = mat.front;
  ctx.fill();
  ctx.strokeStyle = "rgba(9,7,5,.8)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cx, cy - up, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = mat.top;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy - up, rx * 0.94, ry * 0.94, 0, LIGHT - 1, LIGHT + 1);
  ctx.strokeStyle = mat.rim;
  ctx.lineWidth = Math.max(1, v.scale * 0.045);
  ctx.stroke();

  return { cx, cy, rx, ry, up };
}

/** 윗면에 얹는 판. 책상 상판이나 매트리스처럼 "면 위의 면"을 만든다. */
function tray(v: View, s: Slab, inset: number, color: string): void {
  const pad = inset * v.scale;
  v.ctx.fillStyle = color;
  v.ctx.fillRect(s.l + pad, s.topY + pad, s.w - pad * 2, s.d - pad * 2);
}

/** 앞면에 긋는 가로줄. 서랍선·통풍구·랙 슬롯이 전부 이것이다. */
function slats(v: View, s: Slab, count: number, color: string, inset = 0.12): void {
  const { ctx } = v;
  const pad = inset * v.scale;
  const usable = s.up - pad * 2;
  if (usable <= 0) return;
  ctx.fillStyle = color;
  const thickness = Math.max(1, v.scale * 0.03);
  for (let i = 0; i < count; i += 1) {
    const y = s.frontY + pad + ((i + 0.5) / count) * usable;
    ctx.fillRect(s.l + pad, y, s.w - pad * 2, thickness);
  }
}

/** 켜져 있는 화면. 상자 앞면이나 윗면에 붙는다. */
function glow(
  v: View,
  x: number,
  y: number,
  w: number,
  h: number,
  tint: string,
  strength = 0.5,
): void {
  const { ctx } = v;
  if (w <= 1 || h <= 1) return;
  ctx.fillStyle = `${tint}${strength * 0.42})`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = `${tint}${strength})`;
  ctx.fillRect(x, y, w, Math.max(1, h * 0.16));
  // 주사선. 두 줄이면 "글자가 떠 있다"까지 읽히고 그 이상은 무늬가 된다.
  ctx.fillStyle = `${tint}${strength * 0.75})`;
  const line = Math.max(1, h * 0.09);
  ctx.fillRect(x + w * 0.12, y + h * 0.42, w * 0.62, line);
  ctx.fillRect(x + w * 0.12, y + h * 0.66, w * 0.4, line);
}

/** 작은 표시등 한 점. */
function lamp(v: View, x: number, y: number, tint: string, strength = 0.85): void {
  const r = Math.max(1, v.scale * 0.045);
  v.ctx.fillStyle = `${tint}${strength})`;
  v.ctx.beginPath();
  v.ctx.arc(x, y, r, 0, Math.PI * 2);
  v.ctx.fill();
}

/* ── 물건 ────────────────────────────────────────────────────────────── */

/** 바닥 자국이 사각형이 아닌 것들. 그림자를 둥글게 깔아야 실루엣과 어긋나지 않는다. */
const ROUND: ReadonlySet<PropKind> = new Set<PropKind>(["core", "table", "chair", "body"]);

/**
 * 집기 한 점.
 *
 * 종류마다 기본 덩어리를 세운 뒤 그 물건을 그 물건이게 하는 것만 몇 획 얹는다. 여기서
 * 디테일을 늘리면 화면이 정보로 꽉 차서 정작 조사 지점이 묻히므로, 하나에 두세 획으로 끝낸다.
 */
export function drawProp(v: View, prop: Prop): void {
  const { ctx } = v;
  const h = propHeight(prop.kind);
  castShadow(v, prop, h, ROUND.has(prop.kind));

  switch (prop.kind) {
    /**
     * 허브 한가운데의 낮은 단. 위에 코어 기둥이 선다.
     *
     * 윗면을 사각형으로 두르면 정거장 한복판에 액자가 놓인 것처럼 보인다. 대신 안쪽 판을
     * 한 단 낮추고 네 귀퉁이에 볼트만 박는다 — 실제 설비 단이 그렇게 생겼다.
     */
    case "dais": {
      const s = slab(v, prop, h);
      fill(v, s, STEEL);
      tray(v, s, 0.42, "#332c24");
      ctx.fillStyle = "rgba(224,211,189,.14)";
      for (const sx of [0.14, 0.86]) {
        for (const sz of [0.14, 0.86]) {
          ctx.beginPath();
          ctx.arc(s.l + s.w * sx, s.topY + s.d * sz, Math.max(1.5, v.scale * 0.07), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    /** 정거장 계통이 지나는 기둥. 허브에서 가장 높아 방의 중심을 잡는다. */
    case "core": {
      const c = cylinder(v, prop, h, STEEL);
      const band = Math.max(1.5, v.scale * 0.07);
      for (const at of [0.24, 0.46, 0.68, 0.9]) {
        const y = c.cy - c.up * at;
        ctx.fillStyle = "rgba(8,6,5,.7)";
        ctx.fillRect(c.cx - c.rx, y - band, c.rx * 2, band);
        ctx.fillStyle = `${AMBER}.34)`;
        ctx.fillRect(c.cx - c.rx, y, c.rx * 2, band);
      }
      ctx.fillStyle = `${AMBER}.4)`;
      ctx.beginPath();
      ctx.ellipse(c.cx, c.cy - c.up, c.rx * 0.42, c.ry * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    /** 집무 책상. 상판과 서랍이 보이면 방이 사무실로 읽힌다. */
    case "desk": {
      const s = slab(v, prop, h);
      fill(v, s, PAINT);
      tray(v, s, 0.1, "#4e4234");
      slats(v, s, 2, "rgba(12,9,7,.6)", 0.18);
      // 서랍 손잡이
      ctx.fillStyle = "rgba(224,211,189,.24)";
      ctx.fillRect(s.l + s.w * 0.16, s.frontY + s.up * 0.34, s.w * 0.1, Math.max(1, v.scale * 0.04));
      ctx.fillRect(s.l + s.w * 0.16, s.frontY + s.up * 0.68, s.w * 0.1, Math.max(1, v.scale * 0.04));
      break;
    }

    /** 책상 위 단말. 얇은 상자라 앞면이 곧 화면이다. */
    case "terminal": {
      const s = slab(v, prop, h - TERMINAL_BASE, TERMINAL_BASE);
      fill(v, s, DARK);
      glow(v, s.l + 2, s.frontY + 2, s.w - 4, s.up - 3, SCREEN, 0.6);
      break;
    }

    /**
     * 벽 패널·현황판.
     *
     * 가로로 붙은 것과 세로로 붙은 것이 섞여 있다. 세로 패널은 앞면이 손톱만 해서 표시등을
     * 윗면 띠에 세로로 세워야 보인다.
     */
    case "panel": {
      const s = slab(v, prop, h - PANEL_BASE, PANEL_BASE);
      fill(v, s, DARK);
      const upright = prop.d > prop.w;
      if (upright) {
        for (let i = 0; i < 4; i += 1) {
          const y = s.topY + s.d * ((i + 0.5) / 4);
          lamp(v, s.l + s.w / 2, y, i === 1 ? AMBER : SCREEN, 0.6);
        }
      } else {
        glow(v, s.l + 2, s.frontY + 2, s.w - 4, s.up * 0.62, SCREEN, 0.45);
        for (let i = 0; i < 3; i += 1) {
          lamp(v, s.l + s.w * (0.24 + i * 0.26), s.footY - s.up * 0.18, i === 0 ? AMBER : SCREEN, 0.7);
        }
      }
      break;
    }

    /**
     * 쓰러진 사람.
     *
     * 이것만은 상자로 세우지 않는다. 누워 있는 것을 세우면 서 있는 것이 되고, 사령관실에서
     * 제일 먼저 보이는 것이 상자가 되어 버린다. 머리·어깨·다리를 낮게 눕히고, 오른손만
     * 환경 제어 패널 쪽(-x)으로 뻗는다. 사건 기록에 그렇게 적혀 있다.
     */
    case "body": {
      const u = v.scale;
      ctx.save();
      ctx.translate(v.toX(prop.x), v.toZ(prop.z));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      /**
       * 팔다리는 굵은 선 한 줄로 긋는다. 다각형으로 짜면 이 크기에서는 어차피 뭉개지고,
       * 둥근 끝이 있는 선 쪽이 사람의 마디처럼 보인다. 같은 선을 두 번 긋되 처음은 굵고
       * 검게 — 칠한 모형의 검은 선이 사람 모양을 바닥에서 떼어 낸다.
       */
      const stroke = (
        segments: readonly (readonly [number, number, number, number])[],
        weight: number,
        color: string,
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = weight;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of segments) {
          ctx.moveTo(u * x1, u * y1);
          ctx.lineTo(u * x2, u * y2);
        }
        ctx.stroke();
      };

      const legs = [
        [0.12, -0.1, 0.62, -0.17],
        [0.62, -0.17, 0.94, -0.05],
        [0.12, 0.12, 0.6, 0.2],
        [0.6, 0.2, 0.92, 0.13],
      ] as const;
      // 오른손은 환경 제어 패널 쪽(-x)으로 뻗어 있다. 사건 기록에 그렇게 적혀 있다.
      const arms = [
        [-0.34, -0.14, -0.72, -0.28],
        [-0.72, -0.28, -0.98, -0.22],
        [-0.3, 0.18, 0.1, 0.3],
      ] as const;
      const torso = [[-0.36, 0.0, 0.14, 0.01]] as const;

      const line = Math.max(2, u * 0.02);
      stroke(legs, u * 0.2 + line, "#0a0806");
      stroke(arms, u * 0.15 + line, "#0a0806");
      stroke(torso, u * 0.5 + line, "#0a0806");
      stroke(legs, u * 0.2, "#241d16");
      stroke(arms, u * 0.15, "#241d16");
      stroke(torso, u * 0.5, "#332b22");

      // 머리
      ctx.beginPath();
      ctx.ellipse(-u * 0.58, -u * 0.02, u * 0.21, u * 0.19, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#3a2c22";
      ctx.fill();
      ctx.strokeStyle = "#0a0806";
      ctx.lineWidth = line;
      ctx.stroke();

      // 사령관 제복의 붉은 깃. 어둠 속에서 이 한 줄이 누구인지를 말한다.
      ctx.strokeStyle = "rgba(190,84,63,.5)";
      ctx.lineWidth = Math.max(1, u * 0.06);
      ctx.beginPath();
      ctx.moveTo(-u * 0.42, -u * 0.16);
      ctx.lineTo(-u * 0.38, u * 0.16);
      ctx.stroke();
      // 빛이 닿는 쪽 어깨선.
      ctx.strokeStyle = "rgba(198,182,156,.22)";
      ctx.lineWidth = Math.max(1, u * 0.05);
      ctx.beginPath();
      ctx.moveTo(-u * 0.34, -u * 0.24);
      ctx.quadraticCurveTo(u * 0.02, -u * 0.27, u * 0.16, -u * 0.2);
      ctx.stroke();
      ctx.restore();
      break;
    }

    /** 현장 스캔 장비. 몸통 위에 렌즈가 달린 짧은 마스트가 선다. */
    case "scanner": {
      const s = slab(v, prop, 0.85);
      fill(v, s, STEEL);
      slats(v, s, 3, "rgba(12,9,7,.5)", 0.16);
      const mast = cylinder(
        v,
        { x: prop.x, z: prop.z, w: prop.w * 0.4, d: prop.d * 0.4 },
        h - 0.85,
        DARK,
        0.85,
      );
      ctx.fillStyle = `${SCREEN}.5)`;
      ctx.beginPath();
      ctx.ellipse(mast.cx, mast.cy - mast.up, mast.rx * 0.5, mast.ry * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    /** 의료 베드. 매트리스와 베개가 보이면 방이 병실이 된다. */
    case "bed": {
      const s = slab(v, prop, h);
      fill(v, s, STEEL);
      tray(v, s, 0.1, "#524a3f");
      ctx.fillStyle = "#6a6153";
      ctx.fillRect(s.l + v.scale * 0.14, s.topY + v.scale * 0.14, s.w * 0.2, s.d - v.scale * 0.28);
      ctx.strokeStyle = "rgba(12,9,7,.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.l + s.w * 0.62, s.topY + v.scale * 0.12);
      ctx.lineTo(s.l + s.w * 0.62, s.topY + s.d - v.scale * 0.12);
      ctx.stroke();
      break;
    }

    /** 약품 보관함. 여닫이 두 짝과 손잡이, 그리고 의무실 표식. */
    case "cabinet": {
      const s = slab(v, prop, h);
      fill(v, s, PAINT);
      ctx.fillStyle = "rgba(12,9,7,.6)";
      ctx.fillRect(s.l + s.w / 2 - 0.5, s.frontY, 1, s.up);
      ctx.fillStyle = "rgba(224,211,189,.26)";
      for (const side of [-1, 1]) {
        ctx.fillRect(
          s.l + s.w / 2 + side * s.w * 0.06 - (side > 0 ? 0 : v.scale * 0.1),
          s.frontY + s.up * 0.44,
          v.scale * 0.1,
          Math.max(1, v.scale * 0.04),
        );
      }
      // 십자 표식. 방 밖에서도 여기가 약품함이라는 걸 알린다.
      const arm = Math.min(s.w, s.up) * 0.2;
      ctx.fillStyle = `${SCREEN}.34)`;
      ctx.fillRect(s.l + s.w * 0.24 - arm / 2, s.frontY + s.up * 0.26 - arm / 6, arm, arm / 3);
      ctx.fillRect(s.l + s.w * 0.24 - arm / 6, s.frontY + s.up * 0.26 - arm / 2, arm / 3, arm);
      break;
    }

    /** 기계 유닛. 통풍구와 윗면 배관으로 "돌아가는 것"임을 알린다. */
    case "machine": {
      const s = slab(v, prop, h);
      fill(v, s, STEEL);
      slats(v, s, 4, "rgba(10,8,6,.55)", 0.14);
      tray(v, s, 0.16, "#453d32");
      ctx.fillStyle = "#2c261f";
      ctx.fillRect(s.l + s.w * 0.2, s.topY + s.d * 0.3, s.w * 0.6, Math.max(2, v.scale * 0.12));
      lamp(v, s.l + s.w * 0.84, s.frontY + s.up * 0.2, AMBER, 0.6);
      break;
    }

    /** 화물 상자. 대각 보강대와 모서리 쇠가 상자를 상자로 만든다. */
    case "crate": {
      const s = slab(v, prop, h);
      fill(v, s, CRATE);
      ctx.strokeStyle = "rgba(12,9,7,.5)";
      ctx.lineWidth = Math.max(1, v.scale * 0.045);
      ctx.beginPath();
      ctx.moveTo(s.l + 2, s.frontY + 2);
      ctx.lineTo(s.l + s.w - 2, s.footY - 2);
      ctx.moveTo(s.l + s.w - 2, s.frontY + 2);
      ctx.lineTo(s.l + 2, s.footY - 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(228,204,160,.14)";
      ctx.fillRect(s.l, s.topY + s.d * 0.46, s.w, Math.max(1, v.scale * 0.05));
      break;
    }

    /** 조작 콘솔. 윗면이 비스듬한 화면이라 빛이 위로 샌다. */
    case "console": {
      const s = slab(v, prop, h);
      fill(v, s, PAINT);
      glow(v, s.l + v.scale * 0.1, s.topY + v.scale * 0.08, s.w - v.scale * 0.2, s.d * 0.6, SCREEN, 0.42);
      ctx.fillStyle = "rgba(20,16,12,.6)";
      ctx.fillRect(s.l + v.scale * 0.1, s.topY + s.d * 0.72, s.w - v.scale * 0.2, s.d * 0.2);
      lamp(v, s.l + s.w * 0.86, s.frontY + s.up * 0.35, AMBER, 0.55);
      break;
    }

    /** 서버 랙. 앞면 가득 슬롯이 쌓이고 왼쪽 줄만 불이 들어온다. */
    case "server": {
      const s = slab(v, prop, h);
      fill(v, s, DARK);
      const rows = 6;
      for (let i = 0; i < rows; i += 1) {
        const y = s.frontY + s.up * ((i + 0.5) / rows);
        ctx.fillStyle = "rgba(6,5,4,.6)";
        ctx.fillRect(s.l + v.scale * 0.12, y, s.w - v.scale * 0.24, Math.max(1, s.up / rows * 0.42));
        lamp(v, s.l + v.scale * 0.26, y + s.up / rows * 0.2, i % 3 === 0 ? AMBER : SCREEN, 0.55);
      }
      break;
    }

    /** 에어록 해치. 두 짝 문과 둥근 창, 바닥의 경고 띠. */
    case "airlock": {
      const s = slab(v, prop, h);
      fill(v, s, STEEL);
      ctx.fillStyle = "rgba(10,8,6,.7)";
      ctx.fillRect(s.l + s.w / 2 - 1, s.frontY, 2, s.up);
      ctx.fillStyle = "rgba(12,9,7,.55)";
      ctx.fillRect(s.l + v.scale * 0.1, s.frontY + s.up * 0.08, s.w - v.scale * 0.2, s.up * 0.84);
      // 창
      const r = Math.min(s.w * 0.1, s.up * 0.26);
      ctx.beginPath();
      ctx.arc(s.l + s.w / 2, s.frontY + s.up * 0.4, r, 0, Math.PI * 2);
      ctx.fillStyle = "#0a0c10";
      ctx.fill();
      ctx.strokeStyle = "rgba(224,211,189,.28)";
      ctx.lineWidth = Math.max(1, v.scale * 0.05);
      ctx.stroke();
      // 경고 띠
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.l, s.footY - s.up * 0.16, s.w, s.up * 0.16);
      ctx.clip();
      ctx.strokeStyle = `${AMBER}.2)`;
      ctx.lineWidth = Math.max(2, v.scale * 0.1);
      ctx.beginPath();
      for (let x = -s.up; x < s.w + s.up; x += v.scale * 0.34) {
        ctx.moveTo(s.l + x, s.footY);
        ctx.lineTo(s.l + x + s.up * 0.16, s.footY - s.up * 0.16);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }

    /** 식당 탁자. 상판 테두리만 한 줄. */
    case "table": {
      cylinder(v, { ...prop, w: prop.w * 0.3, d: prop.d * 0.3 }, h - 0.06, DARK);
      const c = cylinder(v, prop, 0.06, PAINT, h - 0.06);
      ctx.beginPath();
      ctx.ellipse(c.cx, c.cy - c.up, c.rx * 0.72, c.ry * 0.72, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(12,9,7,.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }

    /** 의자. 기둥 위에 앉는 판 하나. */
    case "chair": {
      cylinder(v, { ...prop, w: prop.w * 0.34, d: prop.d * 0.34 }, h - 0.08, DARK);
      cylinder(v, prop, 0.08, CLOTH, h - 0.08);
      break;
    }

    /** 배식대. 윗면에 온장고 뚜껑 두 개, 앞면에 쟁반 레일. */
    case "counter": {
      const s = slab(v, prop, h);
      fill(v, s, PAINT);
      tray(v, s, 0.09, "#4f4437");
      for (const at of [0.3, 0.66]) {
        ctx.beginPath();
        ctx.ellipse(
          s.l + s.w * at,
          s.topY + s.d * 0.5,
          s.w * 0.13,
          s.d * 0.28,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = "#5d5344";
        ctx.fill();
        ctx.strokeStyle = "rgba(12,9,7,.45)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(224,211,189,.2)";
      ctx.fillRect(s.l, s.frontY + s.up * 0.3, s.w, Math.max(1, v.scale * 0.05));
      break;
    }

    /** 기둥·문설주. 방을 가르는 구조물이라 높고 좁다. */
    case "column": {
      const s = slab(v, prop, h);
      fill(v, s, STEEL);
      ctx.fillStyle = "rgba(224,211,189,.12)";
      ctx.fillRect(s.l, s.frontY, Math.max(1, v.scale * 0.04), s.up);
      break;
    }
  }
}

/* ── 사람 ────────────────────────────────────────────────────────────── */

export type FigureState = {
  x: number;
  z: number;
  /** 바라보는 각도. 3D와 같은 규약이라 방향은 (sin, cos)다. */
  angle: number;
  /** 누구인지. 초상과 미니어처 생김새를 모두 이 ID로 찾는다. */
  characterId: string;
  /** 걷거나 숨 쉬는 위상(rad). */
  gait: number;
  moving: boolean;
  highlighted: boolean;
};

/**
 * 사람의 비례.
 *
 * 실제 사람은 1.7m라 이 기울기에서는 0.85u밖에 안 된다. 그 크기로는 얼굴이 열 몇 픽셀이라
 * 누구인지 알아볼 수 없고, 화면 안에서 사람이 집기보다 작아진다. 그래서 머리를 키우고 키를
 * 1.2u까지 올렸다 — 축소 모형이나 말판이 원래 그렇게 생겼다. 정확한 축척을 버리는 대신
 * 얼굴이 보이고, 사람이 화면의 주인공 자리를 되찾는다.
 */
const HIP = 0.3;
const SHOULDER = 0.72;
const HEAD_R = 0.29;
const HEAD_Y = SHOULDER + HEAD_R * 0.94;

/** 칠한 모형의 검은 선. 이게 없으면 인물이 바닥 무늬에 녹는다. */
const INK = "rgba(9,7,5,.9)";

/**
 * 어둠 쪽으로 기운 같은 색.
 *
 * 소매는 겉옷의 그늘진 면이지 다른 옷이 아니다. 어두운 색 하나를 정해 두고 모두에게 썼더니
 * 소피아만 흰 실험복에 검은 팔이 붙어 다른 사람 팔을 빌린 것처럼 보였다.
 */
const shaded = new Map<string, string>();
function darken(hex: string, amount: number): string {
  const key = `${hex}:${amount}`;
  const cached = shaded.get(key);
  if (cached) return cached;
  const mixed = `rgb(${[1, 3, 5]
    .map((at) => Math.round(parseInt(hex.slice(at, at + 2), 16) * (1 - amount)))
    .join(",")})`;
  shaded.set(key, mixed);
  return mixed;
}

/**
 * 눈매별 생김새.
 *
 * `ry`는 눈꺼풀이 얼마나 덮였는지, `tilt`는 바깥 끝이 올라갔는지 내려갔는지다. 스물몇
 * 픽셀에서 인상을 만드는 건 이 둘뿐이라 나머지는 모두에게 같다.
 */
const EYES: Record<EyeShape, { ry: number; tilt: number }> = {
  sharp: { ry: 0.1, tilt: 0.24 },
  narrow: { ry: 0.072, tilt: 0.16 },
  soft: { ry: 0.135, tilt: 0.02 },
  weary: { ry: 0.085, tilt: -0.15 },
};

/**
 * 눈·눈썹·코·입.
 *
 * 얼굴 한복판에 몰아넣고 크게 그린다. 실제 사람 비례로 배치하면 이 크기에서는 이목구비가
 * 서로 붙어 얼룩 하나가 된다. 쯔꾸르 인물이 눈을 크게 그리는 건 귀여워서가 아니라 그
 * 크기에서 그것 말고는 표정이 남지 않기 때문이다.
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  build: Build,
  cx: number,
  cy: number,
  hr: number,
): void {
  const look = build.face;
  const eye = EYES[look.eyes];
  const brow = darken(build.hairColor, 0.1);

  for (const side of [-1, 1]) {
    const ex = cx + side * hr * 0.35;
    const ey = cy + hr * 0.12;

    /*
     * 눈썹.
     *
     * 안쪽 끝을 내리면 찌푸린 얼굴이 된다. 굵게 그었더니 기울기가 0에 가까운 사람까지
     * 전부 노려보는 얼굴이 됐다 — 이 크기에서는 선 굵기 자체가 표정이라, 가늘게 긋고
     * 기울기로만 인상을 가른다.
     */
    ctx.beginPath();
    ctx.moveTo(ex - side * hr * 0.17, ey - hr * (0.36 - look.brow * 0.7));
    ctx.lineTo(ex + side * hr * 0.17, ey - hr * (0.4 + look.brow * 0.3));
    ctx.strokeStyle = brow;
    ctx.lineWidth = Math.max(1, hr * 0.065);
    ctx.lineCap = "round";
    ctx.stroke();

    // 눈.
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(-side * eye.tilt);
    ctx.beginPath();
    ctx.ellipse(0, 0, hr * 0.16, hr * eye.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#140f0b";
    ctx.fill();
    // 눈빛 한 점. 이게 없으면 눈이 구멍으로 보인다. 빛이 오는 왼쪽 위에 찍어야 두 눈이
    // 같은 곳을 본다 — 안쪽에 하나씩 찍었더니 눈이 서로를 향해 몰렸다.
    ctx.beginPath();
    ctx.arc(-hr * 0.05, -hr * eye.ry * 0.3, Math.max(0.7, hr * 0.045), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(232,220,196,.75)";
    ctx.fill();
    ctx.restore();
  }

  // 코. 그늘 한 점이면 충분하다.
  ctx.fillStyle = "rgba(30,16,10,.26)";
  ctx.fillRect(cx - hr * 0.03, cy + hr * 0.34, hr * 0.06, Math.max(1, hr * 0.1));

  // 입.
  ctx.beginPath();
  ctx.moveTo(cx - hr * 0.12, cy + hr * 0.58);
  ctx.quadraticCurveTo(cx, cy + hr * (0.58 + look.mouth * 1.4), cx + hr * 0.12, cy + hr * 0.58);
  ctx.strokeStyle = "rgba(52,28,20,.42)";
  ctx.lineWidth = Math.max(1, hr * 0.055);
  ctx.stroke();
}

/**
 * 앞머리.
 *
 * 얼굴 원에 갇힌 채로 이마를 얼마나, 어떤 모양으로 덮는지만 정한다. 원 밖으로 나가는
 * 실루엣은 이미 머리 뭉치가 맡고 있다.
 *
 * 아래 모서리는 눈보다 위에서 끝나야 한다. 일러스트에서는 머리카락이 눈을 덮고 지나가지만,
 * 스물몇 픽셀에서 그렇게 하면 눈두덩을 가로지르는 검은 띠가 되어 복면을 쓴 것처럼 보인다.
 */
function drawBangs(
  ctx: CanvasRenderingContext2D,
  build: Build,
  cx: number,
  cy: number,
  hr: number,
): void {
  const top = cy - hr * 1.15;
  ctx.beginPath();
  switch (build.face.bangs) {
    case "swept":
      // 한쪽으로 넘긴 앞머리. 아래 모서리가 비스듬히 흐른다.
      ctx.moveTo(cx - hr, top);
      ctx.lineTo(cx + hr, top);
      ctx.lineTo(cx + hr, cy - hr * 0.66);
      ctx.quadraticCurveTo(cx + hr * 0.1, cy - hr * 0.3, cx - hr, cy - hr * 0.46);
      break;
    case "parted":
      // 가운데가 갈라져 이마 한복판으로 뾰족하게 내려온다.
      ctx.moveTo(cx - hr, top);
      ctx.lineTo(cx + hr, top);
      ctx.lineTo(cx + hr, cy - hr * 0.5);
      ctx.quadraticCurveTo(cx + hr * 0.4, cy - hr * 0.66, cx, cy - hr * 0.22);
      ctx.quadraticCurveTo(cx - hr * 0.4, cy - hr * 0.66, cx - hr, cy - hr * 0.5);
      break;
    case "curtain":
      // 가르마를 타고 얼굴 양옆으로 흘러내린다.
      ctx.moveTo(cx - hr, top);
      ctx.lineTo(cx + hr, top);
      ctx.lineTo(cx + hr, cy + hr);
      ctx.lineTo(cx + hr * 0.52, cy + hr);
      ctx.lineTo(cx + hr * 0.6, cy - hr * 0.5);
      ctx.quadraticCurveTo(cx, cy - hr * 0.26, cx - hr * 0.6, cy - hr * 0.5);
      ctx.lineTo(cx - hr * 0.52, cy + hr);
      ctx.lineTo(cx - hr, cy + hr);
      break;
    case "blunt":
      // 일자로 자른 앞머리에 귀 옆으로 내려오는 옆머리.
      ctx.moveTo(cx - hr, top);
      ctx.lineTo(cx + hr, top);
      ctx.lineTo(cx + hr, cy + hr * 0.7);
      ctx.lineTo(cx + hr * 0.62, cy + hr * 0.7);
      ctx.lineTo(cx + hr * 0.68, cy - hr * 0.42);
      ctx.lineTo(cx - hr * 0.68, cy - hr * 0.42);
      ctx.lineTo(cx - hr * 0.62, cy + hr * 0.7);
      ctx.lineTo(cx - hr, cy + hr * 0.7);
      break;
    case "back":
      // 뒤로 넘겨 이마가 드러난다. 머리선만 남는다.
      ctx.moveTo(cx - hr, top);
      ctx.lineTo(cx + hr, top);
      ctx.lineTo(cx + hr, cy - hr * 0.62);
      ctx.quadraticCurveTo(cx, cy - hr * 0.9, cx - hr, cy - hr * 0.62);
      break;
  }
  ctx.closePath();
  ctx.fillStyle = build.hairColor;
  ctx.fill();
  // 머리카락이 이마에 드리우는 그늘.
  ctx.strokeStyle = "rgba(10,7,5,.5)";
  ctx.lineWidth = Math.max(1, hr * 0.09);
  ctx.stroke();
}

/**
 * 정거장을 걸어 다니는 사람.
 *
 * 위에서 눌러 본 덩어리가 아니라 바닥에 세워 둔 작은 인형으로 그린다. 다리 두 짝이 바닥을
 * 딛고, 그 위에 제복 몸통이 서고, 맨 위에 일러스트에서 오려 온 얼굴이 얹힌다. 걸으면
 * 다리가 엇갈리고 몸이 한 번씩 뜬다 — 이 두 가지가 없으면 아무리 잘 그려도 미끄러지는
 * 그림으로 보인다.
 *
 * 생김새는 전부 `characters.ts`의 `build`에서 온다. 예전에는 제복 색 하나만 갈아 끼워서
 * 얼굴을 가리면 다섯 명이 같은 인형이었다. 지금은 머리 실루엣·겉옷 기장·표식·손에 든 것이
 * 사람마다 다르므로, 멀리서 형체만 봐도 누가 어느 방에 서 있는지 안다.
 *
 * 얼굴은 어느 쪽을 보든 계속 보여 준다. 등을 돌릴 때 뒤통수로 바꿔 봤더니, 정거장을
 * 위로 걸어 올라가는 내내 — 그러니까 절반쯤은 — 아무도 얼굴이 없었다. 누가 누구인지가
 * 걷는 방향에 따라 켜졌다 꺼지는 셈이라, 정확한 것보다 계속 보이는 쪽이 낫다.
 * 방향은 머리를 바라보는 쪽으로 조금 밀고 초상을 그쪽으로 밀어 잘라서 알린다.
 */
export function drawFigure(v: View, f: FigureState): void {
  const { ctx } = v;
  const u = v.scale;
  const px = v.toX(f.x);
  const pz = v.toZ(f.z);
  const dirX = Math.sin(f.angle);
  const person = characterFor(f.characterId);
  const build = person.build;

  // 걸을 때는 크게, 서 있을 때는 숨 쉬는 만큼만.
  const swing = f.moving ? Math.sin(f.gait) : 0;
  const bob = f.moving ? Math.abs(Math.cos(f.gait)) * u * 0.04 : Math.sin(f.gait) * u * 0.008;
  // 자세는 서 있을 때만 잡는다. 걸으면서 허리에 손을 얹고 있으면 팔이 얼어붙어 보인다.
  const pose = f.moving ? undefined : build.pose;

  /*
   * 그늘에 들어간 살빛.
   *
   * 정거장은 등 하나에 의지해 어둡고, 벽도 바닥도 옷도 모두 그 어둠에 잠겨 있다. 살빛만
   * 제 밝기로 칠하면 얼굴과 손이 어둠 위에 뜬 밝은 점이 되어, 사람이 장면 안에 서 있는
   * 게 아니라 장면 위에 붙어 있는 것처럼 보인다. 빛은 아래 그러데이션이 되돌려 준다.
   */
  const skin = darken(build.skin, 0.24);

  /* 바닥 그림자. 발밑에 눌러앉아야 인형이 바닥에 선다. */
  const cast = ctx.createRadialGradient(px, pz, 0, px, pz, u * 0.6);
  cast.addColorStop(0, "rgba(0,0,0,.6)");
  cast.addColorStop(0.55, "rgba(0,0,0,.28)");
  cast.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = cast;
  ctx.save();
  ctx.translate(px, pz);
  ctx.scale(1, 0.42);
  ctx.beginPath();
  ctx.arc(0, 0, u * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(px, pz - bob);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const ink = Math.max(1.5, u * 0.045);
  const outline = () => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = ink;
    ctx.stroke();
  };
  /** 점을 이어 몸의 한 부분을 만든다. 좌표는 키(u) 기준이고 위쪽이 양수다. */
  const part = (points: readonly (readonly [number, number])[], color: string) => {
    ctx.beginPath();
    ctx.moveTo(u * points[0][0], -u * points[0][1]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(u * x, -u * y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    outline();
  };
  /** 팔다리처럼 굵기가 일정한 마디. 둥근 끝이 있어야 관절로 보인다. */
  const limb = (
    points: readonly (readonly [number, number])[],
    weight: number,
    color: string,
  ) => {
    ctx.beginPath();
    ctx.moveTo(u * points[0][0], -u * points[0][1]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(u * x, -u * y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = u * weight + ink;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = u * weight;
    ctx.stroke();
  };

  /* 다리. 걸으면 앞뒤로 엇갈린다. */
  const foot = (-bob / u) * 0.6;
  for (const side of [-1, 1]) {
    const step = swing * side * 0.1;
    part(
      [
        [side * 0.19, HIP],
        [side * 0.2 + step, foot],
        [side * 0.07 + step, foot],
        [side * 0.06, HIP],
      ],
      build.legs,
    );
  }

  /*
   * 드러난 허리. 짧은 재킷은 이 살이 보여야 짧아 보인다.
   *
   * 살빛을 그대로 칠하면 배에 밝은 판을 붙인 꼴이 된다. 어차피 옷 그늘에 들어간 자리라
   * 한 번 눌러 둬야 몸으로 읽힌다.
   */
  if (build.midriff) {
    part(
      [
        [-0.13, HIP + 0.2],
        [0.13, HIP + 0.2],
        [0.15, HIP - 0.02],
        [-0.15, HIP - 0.02],
      ],
      darken(build.skin, 0.46),
    );
    // 재킷 자락이 드리우는 그늘. 이게 없으면 배가 옷 위에 얹힌 판처럼 보인다.
    ctx.fillStyle = "rgba(8,6,5,.45)";
    ctx.fillRect(-u * 0.13, -u * (HIP + 0.2), u * 0.26, Math.max(1, u * 0.05));
  }

  /*
   * 몸통.
   *
   * 옷자락이 어디서 끝나는지가 실루엣의 전부다. 실험복은 허리 아래로 늘어지고, 짧은 재킷은
   * 배꼽에서 끊기고, 나머지는 허리에서 만난다.
   */
  const hem = build.midriff ? HIP + 0.2 : build.lapels ? HIP - 0.16 : HIP - 0.04;
  const waist = build.lapels ? 0.28 : 0.21;
  part(
    [
      [-waist, hem],
      [-0.31, SHOULDER - 0.08],
      [-0.17, SHOULDER + 0.05],
      [0.17, SHOULDER + 0.05],
      [0.31, SHOULDER - 0.08],
      [waist, hem],
    ],
    build.coat,
  );

  /* 빛이 걸리는 왼쪽 위 모서리만 밝힌다. 평면으로 두면 종이 인형이 된다. */
  ctx.save();
  ctx.clip();
  const lit = ctx.createLinearGradient(
    Math.cos(LIGHT) * u * 0.4,
    -u * SHOULDER + Math.sin(LIGHT) * u * 0.4,
    -Math.cos(LIGHT) * u * 0.4,
    -u * hem - Math.sin(LIGHT) * u * 0.4,
  );
  lit.addColorStop(0, "rgba(255,246,228,.3)");
  lit.addColorStop(0.55, "rgba(0,0,0,0)");
  lit.addColorStop(1, "rgba(0,0,0,.35)");
  ctx.fillStyle = lit;
  ctx.fillRect(-u, -u * 1.2, u * 2, u * 1.4);
  ctx.restore();

  /*
   * 안에 보이는 옷.
   *
   * 실험복은 앞이 활짝 열려 있어 어두운 상의가 가슴 한복판을 세로로 가르고, 재킷은 목 밑에서
   * 쐐기만 보인다. 이 한 조각이 검은 덩어리를 "옷 입은 사람"으로 만든다.
   */
  if (build.lapels) {
    part(
      [
        [-0.11, SHOULDER + 0.04],
        [0.11, SHOULDER + 0.04],
        [0.1, hem + 0.04],
        [-0.1, hem + 0.04],
      ],
      build.inner,
    );
  } else if (build.inner !== build.coat) {
    part(
      [
        [-0.1, SHOULDER + 0.03],
        [0.1, SHOULDER + 0.03],
        [0, SHOULDER - 0.26],
      ],
      build.inner,
    );
  }

  const marks = new Set(build.marks);

  /*
   * 가슴을 가로지르는 멜빵·스트랩.
   *
   * 옷자락에서 끝나야 한다. 허리까지 내리 그었더니 짧은 재킷을 입은 유나만 드러난 배 위로
   * 끈 두 줄이 지나가서, 살과 끈이 엉킨 밝은 V자가 됐다.
   */
  if (marks.has("harness")) {
    limb([[-0.19, SHOULDER + 0.01], [-0.08, hem + 0.03]], 0.045, "#1b1611");
    limb([[0.19, SHOULDER + 0.01], [0.08, hem + 0.03]], 0.045, "#1b1611");
  }
  /* 넥타이. */
  if (marks.has("tie")) {
    part(
      [
        [-0.045, SHOULDER - 0.02],
        [0.045, SHOULDER - 0.02],
        [0.03, SHOULDER - 0.32],
        [-0.03, SHOULDER - 0.32],
      ],
      build.trim,
    );
  }
  /* 색이 다른 옷깃. */
  if (marks.has("collar")) {
    ctx.strokeStyle = build.trim;
    ctx.lineWidth = Math.max(1, u * 0.06);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(-u * 0.15, -u * (SHOULDER + 0.02));
    ctx.lineTo(0, -u * (SHOULDER - 0.12));
    ctx.lineTo(u * 0.15, -u * (SHOULDER + 0.02));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  /* 어깨의 계급장. */
  if (marks.has("epaulette")) {
    ctx.fillStyle = build.trim;
    for (const side of [-1, 1]) {
      ctx.fillRect(
        side * u * 0.28 - u * 0.05,
        -u * (SHOULDER + 0.02),
        u * 0.1,
        Math.max(1.5, u * 0.06),
      );
    }
  }
  /* 가슴의 신분증. 정거장 사람은 하나같이 이걸 달고 있다. */
  if (marks.has("badge")) {
    ctx.fillStyle = "rgba(214,204,182,.7)";
    ctx.fillRect(u * 0.1, -u * (SHOULDER - 0.14), u * 0.075, u * 0.1);
  }

  /* 허리띠. */
  const beltY = build.midriff ? HIP - 0.05 : HIP + 0.02;
  ctx.fillStyle = "rgba(8,6,5,.8)";
  ctx.fillRect(
    -u * 0.24,
    -u * (beltY + 0.05),
    u * 0.48,
    Math.max(1.5, u * (build.midriff ? 0.08 : 0.055)),
  );
  ctx.fillStyle = "rgba(196,178,148,.4)";
  ctx.fillRect(-u * 0.05, -u * (beltY + 0.055), u * 0.1, Math.max(1.5, u * 0.065));

  /*
   * 팔.
   *
   * 걸을 때는 다리와 반대로 흔들리고, 서 있을 때는 그 사람의 버릇대로 멈춘다 — 마야는
   * 허리에 손을 얹고, 카심은 손을 얼굴로 올린다. 초상에서 제일 먼저 눈에 들어오는 자세다.
   */
  const sleeve = darken(build.coat, 0.34);
  for (const side of [-1, 1]) {
    const onHip = pose === "hip" && side === 1;
    const raised = pose === "raised" && side === -1;
    const step = -swing * side * 0.07;
    const arm: readonly (readonly [number, number])[] = onHip
      ? [[side * 0.28, SHOULDER - 0.05], [side * 0.44, SHOULDER - 0.28], [side * 0.24, HIP + 0.06]]
      : raised
        ? [[side * 0.28, SHOULDER - 0.05], [side * 0.36, SHOULDER + 0.14], [side * 0.16, SHOULDER + 0.26]]
        : [[side * 0.29, SHOULDER - 0.05], [side * 0.31, HIP + 0.02 + step]];
    limb(arm, 0.11, sleeve);
    // 손. 소매 끝에 살빛 점 하나. 검은 선을 둘러야 물방울이 아니라 손으로 읽힌다.
    const hand = arm[arm.length - 1];
    ctx.beginPath();
    ctx.arc(u * hand[0], -u * hand[1], u * 0.048, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    outline();

    /*
     * 소매의 완장.
     *
     * 팔 좌표에서 바로 뽑아 그린다. 고정 자리에 두었더니 카심처럼 팔을 든 사람은 완장만
     * 허공에 남았다. 자세가 바뀌어도 완장은 팔에 붙어 있어야 한다.
     */
    if (marks.has("armband") && side === (pose === "raised" ? 1 : -1)) {
      const [ax, ay] = arm[0];
      const [bx, by] = arm[1];
      const at = 0.42;
      const cx = ax + (bx - ax) * at;
      const cy = ay + (by - ay) * at;
      ctx.save();
      ctx.lineCap = "butt";
      ctx.strokeStyle = build.trim;
      ctx.lineWidth = Math.max(1.5, u * 0.08);
      ctx.beginPath();
      ctx.moveTo(u * (cx - 0.05), -u * cy);
      ctx.lineTo(u * (cx + 0.05), -u * cy);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* 손에 든 것. 실루엣을 가장 크게 바꾸므로 몸 앞에 온다. */
  if (build.holds === "wrench") {
    limb([[0.3, HIP + 0.18], [0.4, SHOULDER + 0.2]], 0.06, "#6d675c");
    limb([[0.365, SHOULDER + 0.2], [0.45, SHOULDER + 0.24]], 0.05, "#837c6e");
  } else if (build.holds === "clipboard") {
    part(
      [
        [-0.26, HIP + 0.28],
        [0.14, HIP + 0.32],
        [0.11, HIP + 0.02],
        [-0.29, HIP - 0.02],
      ],
      "#241d17",
    );
    ctx.fillStyle = "rgba(206,196,176,.5)";
    ctx.fillRect(-u * 0.22, -u * (HIP + 0.24), u * 0.28, u * 0.14);
  }

  /* ── 머리 ──────────────────────────────────────────────────────────── */
  const hr = u * HEAD_R;
  const hx = dirX * u * 0.09;
  const hy = -u * HEAD_Y;

  /*
   * 머리카락.
   *
   * 전부 얼굴보다 먼저 그린다. 초상을 잘라 온 얼굴에는 이미 그 사람의 머리가 들어 있으므로,
   * 여기서 할 일은 얼굴을 덮는 게 아니라 원 밖으로 삐져나오는 실루엣을 만드는 것뿐이다.
   * 앞에 덮어 봤더니 얼굴이 머리 뭉치에 뚫린 구멍처럼 보였다.
   *
   * 이 실루엣 하나가 멀리서 사람을 가른다 — 정수리에 얹은 쪽, 어깨로 쏟아지는 곱슬,
   * 귀 밑에서 잘린 단발, 뻗친 짧은 머리, 뒤로 넘긴 반백.
   */
  const strand = (cx: number, cy: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = build.hairColor;
    ctx.fill();
    outline();
  };

  switch (build.hair) {
    case "long":
      // 어깨를 덮는 긴 곱슬.
      //
      // 한 덩어리로 그렸더니 머리가 아니라 등에 두른 망토가 됐다. 뒤통수 뭉치 하나에
      // 양옆으로 흘러내리는 가닥 둘을 더해야 "쏟아지는 머리"로 읽힌다.
      strand(hx - hr * 0.82, hy + hr * 0.66, hr * 0.46, hr * 0.86);
      strand(hx + hr * 0.82, hy + hr * 0.66, hr * 0.46, hr * 0.86);
      strand(hx, hy + hr * 0.18, hr * 1.08, hr * 1.16);
      break;
    case "bob":
      // 귀 밑에서 잘린 단발.
      strand(hx, hy + hr * 0.2, hr * 1.16, hr * 1.2);
      break;
    case "swept":
      // 뒤로 넘긴 반백. 한쪽으로만 부풀어 있다.
      strand(hx + hr * 0.08, hy - hr * 0.16, hr * 1.08, hr * 1.04);
      break;
    case "bun":
      strand(hx, hy - hr * 0.1, hr * 1.05, hr * 1.05);
      strand(hx - hr * 0.22, hy - hr * 1.16, hr * 0.38, hr * 0.36);
      break;
    case "crop": {
      strand(hx, hy - hr * 0.14, hr * 1.08, hr * 1.06);
      // 뻗친 가닥. 정수리 밖으로 삐친 이 조각들이 "짧고 헝클어진 머리"를 만든다.
      for (const [at, len] of [[-0.66, 0.34], [-0.36, 0.52], [-0.06, 0.3], [0.24, 0.2]] as const) {
        const a = Math.PI * (1.5 + at * 0.5);
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(a - 0.2) * hr, hy + Math.sin(a - 0.2) * hr);
        ctx.lineTo(hx + Math.cos(a) * hr * (1.1 + len * 0.5), hy + Math.sin(a) * hr * (1.1 + len * 0.5));
        ctx.lineTo(hx + Math.cos(a + 0.2) * hr, hy + Math.sin(a + 0.2) * hr);
        ctx.closePath();
        ctx.fillStyle = build.hairColor;
        ctx.fill();
        outline();
      }
      break;
    }
  }

  /*
   * 얼굴.
   *
   * 초상에서 오려 오지 않고 몸과 같은 어법으로 그린다. 회화 조각을 도형 위에 얹으면 사람
   * 하나가 두 개의 다른 그림으로 갈라지고, 그 이음매는 아무리 어둡게 눌러도 사라지지 않았다.
   *
   * 이목구비는 바라보는 쪽으로 조금 쏠린다. 얼굴 판을 통째로 미는 것보다 눈코입만 옮기는
   * 편이 고개를 돌린 것처럼 보인다 — 쯔꾸르 인물이 네 방향을 그렇게 만든다.
   */
  const gaze = dirX * hr * 0.16;
  const ear = hr * 0.13;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + side * hr * 0.86, hy + hr * 0.14, ear, ear * 1.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = darken(build.skin, 0.42);
    ctx.fill();
    outline();
  }

  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 0.9, hr, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  // 빛은 왼쪽 위에서 온다. 얼굴이 공처럼 둥글어 보이려면 반대쪽이 죽어야 한다.
  ctx.save();
  ctx.clip();
  const cheek = ctx.createLinearGradient(
    hx + Math.cos(LIGHT) * hr,
    hy + Math.sin(LIGHT) * hr,
    hx - Math.cos(LIGHT) * hr,
    hy - Math.sin(LIGHT) * hr,
  );
  cheek.addColorStop(0, "rgba(255,244,224,.22)");
  cheek.addColorStop(0.45, "rgba(0,0,0,0)");
  cheek.addColorStop(1, "rgba(24,14,9,.42)");
  ctx.fillStyle = cheek;
  ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
  ctx.restore();

  drawFace(ctx, build, hx + gaze, hy, hr);

  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 0.9, hr, 0, 0, Math.PI * 2);
  outline();

  /* 앞머리. 얼굴 위에 얹혀야 일러스트처럼 눈두덩에 그늘이 진다. */
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 0.9, hr, 0, 0, Math.PI * 2);
  ctx.clip();
  drawBangs(ctx, build, hx, hy, hr);
  ctx.restore();

  // 빛이 걸리는 쪽 머리에만 윤기를 준다.
  //
  // 밝고 두껍게 그었더니 일곱 명이 똑같은 은색 머리띠를 두른 꼴이 됐다. 빛은 머리 색을
  // 밝히는 것이지 그 위에 다른 물건을 얹는 게 아니라, 가늘고 옅게 스치기만 한다.
  ctx.beginPath();
  ctx.arc(hx, hy, hr * 1.01, LIGHT - 0.6, LIGHT + 0.3);
  ctx.strokeStyle = "rgba(232,216,186,.16)";
  ctx.lineWidth = Math.max(1, u * 0.028);
  ctx.stroke();

  ctx.restore();

  if (f.highlighted) {
    // 초점은 원이 아니라 바닥에 깔리는 빛으로 알린다.
    const pool = ctx.createRadialGradient(px, pz, u * 0.3, px, pz, u * 1.5);
    pool.addColorStop(0, "rgba(216,199,173,.18)");
    pool.addColorStop(1, "rgba(216,199,173,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(px - u * 1.6, pz - u * 1.6, u * 3.2, u * 3.2);
  }
}

/** 인물이 화면에서 차지하는 높이(m). 이름표를 얼마나 띄울지 정하는 데 쓴다. */
export const FIGURE_HEIGHT = (HEAD_Y + HEAD_R * 1.6) / TILT;

