import { describe, expect, it } from "vitest";
import {
  DOORS,
  MAP_CREW,
  MAP_OBJECTS,
  PROPS,
  ROOMS,
  SPAWN,
  STATION_BOUNDS,
  WALLS,
  zoneColor,
} from "./stationMap";
import { INVESTIGATION_OBJECTS } from "./investigation";
import { CHARACTERS, characterIdFromNpc } from "./characters";
import { PLAYER_RADIUS, REACH, blockedAt, hasStandingSpotNear, onFloorAt } from "../domain/movement";
import { propHeight } from "../ui/miniatures";

/**
 * `stationMap.ts`는 3D 장면에서 뽑아낸 생성물이다. 추출기가 조용히 어긋나면 벽이 사라지거나
 * 조사 지점이 방 밖에 놓이는데, 그건 화면을 열어 봐야만 드러난다. 여기서 미리 막는다.
 */
describe("정거장 평면도", () => {
  it("3D 장면과 같은 규모를 유지한다", () => {
    expect(WALLS.length).toBeGreaterThan(40);
    expect(PROPS.length).toBeGreaterThan(30);
    expect(ROOMS).toHaveLength(9);
    expect(MAP_OBJECTS).toHaveLength(16);
    expect(MAP_CREW).toHaveLength(5);
    expect(DOORS.length).toBeGreaterThan(0);
  });

  it("모든 좌표가 유한하고 크기가 양수다", () => {
    for (const wall of WALLS) {
      expect(Number.isFinite(wall.x) && Number.isFinite(wall.z)).toBe(true);
      expect(wall.w).toBeGreaterThan(0);
      expect(wall.d).toBeGreaterThan(0);
    }
    for (const crew of MAP_CREW) expect(Number.isFinite(crew.facing)).toBe(true);
  });

  it("조사 지점과 승무원이 정거장 범위 안에 있다", () => {
    const inside = (x: number, z: number) =>
      x >= STATION_BOUNDS.minX && x <= STATION_BOUNDS.maxX &&
      z >= STATION_BOUNDS.minZ && z <= STATION_BOUNDS.maxZ;
    for (const object of MAP_OBJECTS) {
      expect(inside(object.x, object.z), `${object.id}이 범위 밖입니다`).toBe(true);
    }
    for (const crew of MAP_CREW) {
      expect(inside(crew.x, crew.z), `${crew.id}이 범위 밖입니다`).toBe(true);
    }
  });

  it("평면도의 조사 지점이 게임 데이터와 1:1로 맞는다", () => {
    const mapped = new Set(MAP_OBJECTS.map((object) => object.id));
    const expected = Object.values(INVESTIGATION_OBJECTS)
      .filter((object) => object.kind !== "PERSON")
      .map((object) => object.id);
    expect([...mapped].sort()).toEqual([...expected].sort());
  });

  /**
   * 조사 지점은 눈에 보이는 물건 위에 있어야 한다.
   *
   * 화면은 지점을 품는 집기를 찾아 그 물건의 키만큼 표식을 띄운다. 품는 집기가 없으면
   * 표식만 허공에 떠서 "여기 뭔가 있는데 아무것도 안 보인다"가 되고, 그건 조사 지점이
   * 아니라 버그로 보인다.
   */
  it("모든 조사 지점이 집기 위에 있다", () => {
    for (const object of MAP_OBJECTS) {
      const holder = PROPS.some(
        (prop) =>
          Math.abs(object.x - prop.x) <= prop.w / 2 + 0.1 &&
          Math.abs(object.z - prop.z) <= prop.d / 2 + 0.1,
      );
      expect(holder, `${object.id}을 담은 집기가 없습니다`).toBe(true);
    }
  });

  it("모든 집기가 그릴 수 있는 종류를 갖는다", () => {
    for (const prop of PROPS) {
      expect(propHeight(prop.kind), `${prop.kind}의 높이가 없습니다`).toBeGreaterThan(0);
    }
  });

  it("평면도의 승무원이 용의자 로스터와 맞는다", () => {
    for (const crew of MAP_CREW) {
      expect(INVESTIGATION_OBJECTS[crew.id]?.kind).toBe("PERSON");
      const character = CHARACTERS[characterIdFromNpc(crew.id)];
      expect(character, `${crew.id}의 인물 정보가 없습니다`).toBeDefined();
      expect(character.kind).toBe("SUSPECT");
    }
  });

  it("구역 색이 모두 실제 색으로 풀린다", () => {
    for (const room of ROOMS) expect(zoneColor(room.accent)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("플레이어 시작 지점이 벽에 박혀 있지 않다", () => {
    expect(blockedAt(SPAWN.x, SPAWN.z, PLAYER_RADIUS)).toBe(false);
  });

  // 집기도 몸을 막는다. 배치를 잘못 고치면 단서 하나가 책상에 갇혀 영영 못 얻게 되는데,
  // 그건 사건이 풀리지 않는다는 뜻이라 화면을 열기 전에 잡아야 한다.
  it("모든 조사 지점을 사정거리 안에서 조사할 수 있다", () => {
    for (const object of MAP_OBJECTS) {
      expect(
        hasStandingSpotNear(object.x, object.z),
        `${object.id}에 닿을 자리가 없습니다`,
      ).toBe(true);
    }
  });

  it("모든 승무원에게 말을 걸 수 있다", () => {
    for (const crew of MAP_CREW) {
      expect(
        hasStandingSpotNear(crew.x, crew.z),
        `${crew.id}에게 닿을 자리가 없습니다`,
      ).toBe(true);
    }
  });

  /**
   * 옆에 빈자리가 있는 것과 거기까지 걸어갈 수 있는 것은 다르다. 문 하나가 집기로 막히면
   * 방 전체가 섬이 되는데, 그 방의 단서 없이는 사건이 풀리지 않는다. 시작 지점에서
   * 실제로 번져 나가 확인한다.
   */
  describe("시작 지점에서 걸어서 닿는 범위", () => {
    const STEP = 0.25;
    const key = (x: number, z: number) => `${x},${z}`;
    const snap = (value: number) => Math.round(value / STEP) * STEP;

    const walkable = new Set<string>();
    const queue: Array<[number, number]> = [[snap(SPAWN.x), snap(SPAWN.z)]];
    walkable.add(key(queue[0][0], queue[0][1]));
    while (queue.length > 0) {
      const [x, z] = queue.pop()!;
      for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
        const nx = Math.round((x + dx) * 100) / 100;
        const nz = Math.round((z + dz) * 100) / 100;
        if (
          nx < STATION_BOUNDS.minX || nx > STATION_BOUNDS.maxX ||
          nz < STATION_BOUNDS.minZ || nz > STATION_BOUNDS.maxZ
        ) continue;
        const id = key(nx, nz);
        if (walkable.has(id) || blockedAt(nx, nz, PLAYER_RADIUS)) continue;
        // 칸 사이 중간점도 본다. 바닥판이 0.1m 떠 있는 자리가 있는데, 0.25m 격자만
        // 밟으면 그 틈을 건너뛰어 "갈 수 있다"고 잘못 읽는다. 실제 이동은 연속이다.
        if (blockedAt((x + nx) / 2, (z + nz) / 2, PLAYER_RADIUS)) continue;
        walkable.add(id);
        queue.push([nx, nz]);
      }
    }

    /** 이 지점 사정거리 안에 "걸어서 갈 수 있는" 자리가 있는지. */
    const canReach = (x: number, z: number) => {
      for (let dx = -REACH; dx <= REACH; dx += STEP) {
        for (let dz = -REACH; dz <= REACH; dz += STEP) {
          if (Math.hypot(dx, dz) > REACH) continue;
          if (walkable.has(key(snap(x + dx), snap(z + dz)))) return true;
        }
      }
      return false;
    };

    /**
     * 3D의 바닥 콜라이더는 정거장보다 훨씬 넓게 깔려 있어서, 벽 틈으로 빠져나가면 아무것도
     * 없는 공간을 계속 걸을 수 있었다. 실제로 부사령관실은 그 바깥 공간을 통해서만 들어갈 수
     * 있었다. 걸을 수 있는 자리가 곧 정거장 안이어야 한다.
     */
    it("정거장 밖으로 걸어 나갈 수 없다", () => {
      const escaped = [...walkable]
        .map((cell) => cell.split(",").map(Number))
        .filter(([x, z]) => !onFloorAt(x, z));
      expect(escaped.length, `바닥 없는 칸 ${escaped.length}개: ${JSON.stringify(escaped.slice(0, 3))}`).toBe(0);
    });

    it("정거장이 하나로 이어져 있다", () => {
      // 방 아홉 개에 모두 발을 들일 수 있으면 섬이 없다는 뜻이다.
      // 중심점이 아니라 "방 안 아무 데나"를 본다. 허브는 한가운데에 기둥이 서 있어서
      // 중심점만 보면 못 들어가는 방으로 잘못 읽힌다.
      for (const room of ROOMS) {
        const entered = [...walkable].some((cell) => {
          const [x, z] = cell.split(",").map(Number);
          return Math.abs(x - room.x) <= room.w / 2 && Math.abs(z - room.z) <= room.d / 2;
        });
        expect(entered, `${room.code} 안으로 들어갈 수 없습니다`).toBe(true);
      }
    });

    it("모든 조사 지점까지 걸어갈 수 있다", () => {
      for (const object of MAP_OBJECTS) {
        expect(canReach(object.x, object.z), `${object.id}까지 갈 수 없습니다`).toBe(true);
      }
    });

    it("모든 승무원에게 걸어갈 수 있다", () => {
      for (const crew of MAP_CREW) {
        expect(canReach(crew.x, crew.z), `${crew.id}에게 갈 수 없습니다`).toBe(true);
      }
    });
  });
});
