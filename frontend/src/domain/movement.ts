import {
  MAP_CREW,
  MAP_OBJECTS,
  PLATES,
  PROPS,
  ROOMS,
  WALLS,
  type Box,
  type Room,
} from "../data/stationMap";

/**
 * 탑다운 이동 규칙.
 *
 * 3D에서는 Rapier가 캡슐을 밀어 주고 카메라 방향으로 입력을 회전시켰다. 2D에서는 시점 회전이
 * 없어서 입력이 곧 월드 방향이고, 충돌은 원과 축 정렬 사각형 하나로 끝난다. 값은 3D와 맞춰
 * 두었으므로 걷는 거리감이 달라지지 않는다.
 *
 * 렌더러에서 떼어 둔 이유는 이 규칙이 화면 없이 검증 가능해야 하기 때문이다. 문이 막히거나
 * 조사 지점에 닿지 못하는 사고는 눈으로 찾으면 늦다.
 */

/** 걷기 속도(m/s). 3D `PlayerController`의 `moveSpeed`와 같다. */
export const PLAYER_SPEED = 5;

/** 몸통 반지름(m). 3D `CapsuleCollider`의 반지름과 같다. */
export const PLAYER_RADIUS = 0.34;

/**
 * 조사·심문이 가능한 거리(m).
 *
 * 3D는 조준선을 2.8m까지 쐈지만 그건 바라보는 방향으로만 닿았다. 탑다운은 사방으로 닿으므로
 * 조금 좁혀야 옆방 오브젝트가 딸려 잡히지 않는다.
 */
export const REACH = 2.4;

export type Vec2 = { x: number; z: number };

export type Focus = {
  id: string;
  kind: "OBJECT" | "PERSON";
  x: number;
  z: number;
  distance: number;
};

/**
 * 몸이 통과하지 못하는 것들.
 *
 * 3D에서는 벽과 집기가 모두 물리 콜라이더였다. 책상을 뚫고 지나가면 방이 그림으로만 남고
 * 공간감이 사라지므로 2D에서도 같이 막는다.
 */
const SOLIDS: Box[] = [...WALLS, ...PROPS];

/** 승무원의 몸 반지름(m). 3D `CrewMember`가 세우던 기둥 콜라이더와 같다. */
const CREW_RADIUS = 0.42;

/** 정거장 바닥. 방과 복도를 합친 것이 곧 걸어 다닐 수 있는 범위다. */
const FLOORS: Box[] = [...ROOMS, ...PLATES];

/**
 * 발밑에 정거장 바닥이 있는지.
 *
 * 3D에서는 바닥 콜라이더 하나가 정거장보다 훨씬 넓게 깔려 있어서, 벽 틈으로 빠져나가면
 * 아무것도 없는 공간을 계속 걸을 수 있었다. 1인칭에서는 사방이 어두워 눈치채기 어려웠지만
 * 위에서 내려다보면 정거장 밖을 떠다니는 게 그대로 보인다. 바닥이 곧 경계다.
 */
export function onFloorAt(x: number, z: number): boolean {
  return FLOORS.some(
    (floor) =>
      Math.abs(x - floor.x) <= floor.w / 2 && Math.abs(z - floor.z) <= floor.d / 2,
  );
}

/** 이 자리에 반지름 `r`인 몸이 설 수 있는지. 바닥 밖이거나 벽·집기·사람에 겹치면 `true`. */
export function blockedAt(x: number, z: number, r = PLAYER_RADIUS): boolean {
  if (!onFloorAt(x, z)) return true;
  for (const solid of SOLIDS) {
    if (
      x + r > solid.x - solid.w / 2 &&
      x - r < solid.x + solid.w / 2 &&
      z + r > solid.z - solid.d / 2 &&
      z - r < solid.z + solid.d / 2
    ) {
      return true;
    }
  }
  // 사람도 통과하지 못한다. 겹쳐 서면 말을 거는 게 아니라 밟고 지나가는 것처럼 보인다.
  for (const crew of MAP_CREW) {
    if (Math.hypot(crew.x - x, crew.z - z) < CREW_RADIUS + r) return true;
  }
  return false;
}

/**
 * 이 지점을 조사할 수 있는 자리가 있는지.
 *
 * 조사 지점 자체는 설비 안이라 설 수 없는 게 정상이다. 문제는 집기가 사방을 둘러싸
 * 사정거리 안에 설 자리가 하나도 남지 않는 경우인데, 그러면 그 단서는 영영 못 얻는다.
 * 배치를 고칠 때 이 함수를 도는 테스트가 막아 준다.
 */
export function hasStandingSpotNear(x: number, z: number, reach = REACH): boolean {
  const rings = [0.6, 1.1, 1.6, 2.1];
  for (const radius of rings) {
    if (radius > reach) break;
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      if (!blockedAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)) return true;
    }
  }
  return false;
}

/**
 * 한 프레임의 이동.
 *
 * x와 z를 따로 밀어야 벽에 비스듬히 부딪혀도 멈추지 않고 미끄러진다. 한 번에 밀면 대각선
 * 이동 중 벽 하나만 닿아도 완전히 멈춰서 문 통과가 신경질적으로 느껴진다.
 */
export function moveBy(
  from: Vec2,
  axisX: number,
  axisZ: number,
  deltaSeconds: number,
): Vec2 {
  if (axisX === 0 && axisZ === 0) return from;
  const length = Math.hypot(axisX, axisZ);
  const dx = (axisX / length) * PLAYER_SPEED * deltaSeconds;
  const dz = (axisZ / length) * PLAYER_SPEED * deltaSeconds;
  let { x, z } = from;
  if (!blockedAt(x + dx, z)) x += dx;
  if (!blockedAt(x, z + dz)) z += dz;
  return { x, z };
}

/** 입력 방향이 바라보는 각도. 3D `rotation.y`와 같은 규약이라 방향은 (sin, cos)다. */
export function facingFrom(axisX: number, axisZ: number, previous: number): number {
  return axisX === 0 && axisZ === 0 ? previous : Math.atan2(axisX, axisZ);
}

/**
 * 지금 손이 닿는 대상 하나.
 *
 * 3D의 조준선을 대신한다. 여러 개가 사정거리에 들어오면 가장 가까운 것을 고른다.
 * 승무원과 오브젝트를 같은 거리로 겨루므로 사람 앞에 서면 사람이 잡힌다.
 */
export function focusAt(position: Vec2, reach = REACH): Focus | null {
  let best: Focus | null = null;
  const consider = (id: string, x: number, z: number, kind: Focus["kind"]) => {
    const distance = Math.hypot(x - position.x, z - position.z);
    if (distance <= reach && (best === null || distance < best.distance)) {
      best = { id, kind, x, z, distance };
    }
  };
  for (const object of MAP_OBJECTS) consider(object.id, object.x, object.z, "OBJECT");
  for (const crew of MAP_CREW) consider(crew.id, crew.x, crew.z, "PERSON");
  return best;
}

/** 지금 서 있는 구역. 복도처럼 이름 없는 자리에서는 `null`. */
export function roomAt(position: Vec2): Room | null {
  return (
    ROOMS.find(
      (room) =>
        Math.abs(position.x - room.x) <= room.w / 2 &&
        Math.abs(position.z - room.z) <= room.d / 2,
    ) ?? null
  );
}

/** 키 입력을 -1/0/1 축 두 개로. 방향키와 WASD를 모두 받는다. */
export function axesFrom(pressed: ReadonlySet<string>): { x: number; z: number } {
  const has = (...codes: string[]) => codes.some((code) => pressed.has(code));
  return {
    x: Number(has("KeyD", "ArrowRight")) - Number(has("KeyA", "ArrowLeft")),
    z: Number(has("KeyS", "ArrowDown")) - Number(has("KeyW", "ArrowUp")),
  };
}
