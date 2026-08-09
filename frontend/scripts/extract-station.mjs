/**
 * `StationWorld.tsx`에서 2D 평면도에 필요한 값을 뽑아 `src/data/stationMap.ts`를 만든다.
 *
 *     node scripts/extract-station.mjs [StationWorld.tsx 경로]
 *
 * 정거장 배치는 3D 장면 파일이 유일한 출처였다. 벽만 57개에 집기까지 백 개 가까이 되므로
 * 손으로 베끼면 반드시 어긋난다.
 *
 * 정규식으로 읽으려다 실패했다. 좌표가 `<group>` 중첩과 `.map()` 안에 숨어 있고
 * `15 + zOffset` 같은 식도 섞여 있어서, 텍스트로는 위치가 원점으로 뭉개진다.
 * 그래서 JSX를 실제로 평가한다. 컴포넌트를 데이터 트리로 만든 뒤 걸어 다니며
 * 변환을 합성하므로 `.map()`이든 변수든 계산식이든 JS가 알아서 풀어 준다.
 * `RoomShell`이 계산해 만드는 벽도 컴포넌트를 그대로 호출해 얻는다.
 *
 * 2D 전환이 끝나면서 `src/game/`은 삭제됐다. 이 스크립트를 다시 돌리려면 그 파일이
 * 남아 있는 커밋에서 꺼내 경로로 넘긴다.
 *
 *     git show <ref>:frontend/src/game/world/StationWorld.tsx > /tmp/StationWorld.tsx
 *     node scripts/extract-station.mjs /tmp/StationWorld.tsx
 *
 * 그 이후의 배치 수정은 `src/data/stationMap.ts`를 직접 고친다.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { transformWithOxc } from "vite";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const SOURCE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "src/game/world/StationWorld.tsx");
const TARGET = path.join(ROOT, "src/data/stationMap.ts");

/* ── 3D 장면을 데이터 트리로 평가한다 ────────────────────────────────────
   컴포넌트를 실제로 호출하되, three나 브라우저에 손을 뻗는 것은 전부 아무 일도
   하지 않는 껍데기로 바꾼다. 우리가 필요한 건 좌표뿐이다. */

/** JSX 한 조각. 이 스크립트에서 트리는 오직 이 모양이다. */
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });

const noop = () => {};
const nothing = new Proxy(function () {}, {
  get: (_target, key) => (key === Symbol.toPrimitive ? () => 0 : nothing),
  apply: () => nothing,
  construct: () => nothing,
});

/** 캔버스 텍스처를 만드는 코드가 있다. 그리는 시늉만 하고 아무것도 남기지 않는다. */
const fakeDocument = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => nothing,
  }),
};

const source = await readFile(SOURCE, "utf8");
const { code } = await transformWithOxc(source, "StationWorld.tsx", {
  jsx: { runtime: "classic", pragma: "h", pragmaFrag: "F" },
});

// import는 껍데기로 대체하고, 모듈 안의 함수들을 밖으로 꺼낸다.
const body = code
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "")
  .replace(/^export\s+/gm, "");

const EXPOSED = [
  "StationWorld", "StaticBox", "FloorPlate", "PropBox", "PropColumn",
  "InteractiveGroup", "CrewMember", "DoorFrame", "ZoneSign", "RoomShell",
];

const stubs = {
  h,
  F: "fragment",
  createInstances: () => [({ children }) => h("group", null, children), nothing],
  RoundedBox: "RoundedBox",
  useFrame: noop,
  CuboidCollider: "CuboidCollider",
  CylinderCollider: "CylinderCollider",
  RigidBody: ({ children, ...props }) => h("group", props, children),
  useEffect: noop,
  useLayoutEffect: noop,
  useMemo: (factory) => factory(),
  useRef: () => ({ current: null }),
  AdditiveBlending: 2,
  CanvasTexture: class { constructor() { return nothing; } },
  Color: class { constructor() { return nothing; } },
  DoubleSide: 2,
  Group: class {},
  LinearFilter: 1006,
  SRGBColorSpace: "srgb",
  useGameStore: () => false,
  document: fakeDocument,
};

const factory = new Function(
  ...Object.keys(stubs),
  `${body}\nreturn { ${EXPOSED.join(", ")} };`,
);
const world = factory(...Object.values(stubs));

/* ── 트리를 걸으며 변환을 합성한다 ──────────────────────────────────────
   three의 rotation.y는 +X를 -Z로 보낸다. 평면에서 같은 규약을 쓴다. */

const rotate = (x, z, angle) => {
  if (!angle) return [x, z];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, -x * s + z * c];
};

const round = (value) => Number(value.toFixed(3));

/** 회전한 사각형을 감싸는 축 정렬 사각형. 90도 회전이면 가로세로가 정확히 뒤바뀐다. */
const axisAlignedSize = (w, d, angle) => {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return [round(w * c + d * s), round(w * s + d * c)];
};

const walls = [];
const plates = [];
const props = [];
const objects = [];
const crew = [];
const doors = [];
const signs = [];

const tuple = (value, fallback = [0, 0, 0]) =>
  Array.isArray(value) && value.length === 3 ? value : fallback;

function walk(node, parent) {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, parent);
    return;
  }
  const { type, props: p = {}, children = [] } = node;

  // 이 노드가 만드는 새 좌표계.
  //
  // 아래 switch에서 직접 읽는 컴포넌트에만 쓴다. 그 밖의 컴포넌트는 자기 `position`을
  // 자기가 반환하는 `<group>`에 다시 붙이므로, 여기서 미리 적용하면 좌표가 두 번 더해진다.
  // 그래서 문 하나가 방 두 개 건너에 찍혔었다.
  const [px, , pz] = tuple(p.position);
  const [, ry] = tuple(p.rotation);
  const [dx, dz] = rotate(px, pz, parent.angle);
  const here = { x: parent.x + dx, z: parent.z + dz, angle: parent.angle + (ry || 0) };

  const emitBox = (w, d, offset) => {
    const [ox, , oz] = tuple(offset);
    const [rx, rz] = rotate(ox, oz, here.angle);
    const [aw, ad] = axisAlignedSize(w, d, here.angle);
    return { x: round(here.x + rx), z: round(here.z + rz), w: aw, d: ad };
  };

  switch (type) {
    case world.StaticBox: {
      const [w, , d] = tuple(p.scale, [1, 1, 1]);
      walls.push(emitBox(w, d, [0, 0, 0]));
      return; // 내부는 볼 필요 없다
    }
    case world.FloorPlate: {
      const [w, d] = Array.isArray(p.size) ? p.size : [1, 1];
      plates.push({ ...emitBox(w, d, [0, 0, 0]), accent: p.accent ?? "stone" });
      return;
    }
    case world.PropBox: {
      const [w, , d] = tuple(p.size, [1, 1, 1]);
      props.push(emitBox(w, d, p.position ? [0, 0, 0] : [0, 0, 0]));
      return;
    }
    case world.PropColumn: {
      const r = typeof p.radius === "number" ? p.radius : 0.5;
      props.push(emitBox(r * 2, r * 2, [0, 0, 0]));
      return;
    }
    case world.InteractiveGroup: {
      if (typeof p.id === "string") {
        const [mx, , mz] = tuple(p.markerPosition, [0, 1.4, 0]);
        const [rx, rz] = rotate(mx, mz, here.angle);
        objects.push({ id: p.id, x: round(here.x + rx), z: round(here.z + rz) });
      }
      break; // 안쪽 집기(solid)도 계속 걷는다
    }
    case world.CrewMember: {
      crew.push({
        id: p.id,
        x: round(here.x),
        z: round(here.z),
        facing: round(here.angle),
        accent: p.accent ?? "mint",
        uniform: p.uniform ?? "#4b4b48",
        skin: p.skin ?? "#aa806d",
      });
      return; // 인물 자체는 집기가 아니다
    }
    case world.DoorFrame: {
      // 회전한 문은 세로로 놓인다. 문턱 선을 그릴 때 방향이 필요하다.
      const vertical = Math.abs(Math.sin(here.angle)) > 0.5;
      doors.push({ x: round(here.x), z: round(here.z), vertical, accent: p.accent ?? "stone" });
      return;
    }
    case world.ZoneSign: {
      if (typeof p.code === "string") {
        signs.push({ code: p.code, name: p.name ?? "", accent: p.accent ?? "stone", x: round(here.x), z: round(here.z) });
      }
      return;
    }
    default:
      break;
  }

  // 컴포넌트면 실제로 렌더해서 그 결과를 걷는다. RoomShell의 벽이 여기서 나온다.
  // 좌표계는 `parent` 그대로 넘긴다. 컴포넌트가 자기 position을 자기 JSX에서 다시 붙이므로
  // 여기서 `here`를 넘기면 같은 이동이 두 번 들어간다.
  if (typeof type === "function") {
    walk(type({ ...p, children }), parent);
    return;
  }
  // 여기부터는 host 요소(group·mesh)다. 자기 좌표계를 아이들에게 물려준다.
  for (const child of children) walk(child, here);
}

walk(world.StationWorld({}), { x: 0, z: 0, angle: 0 });

const expectEarly = (ok, message) => { if (!ok) throw new Error(`추출 검증 실패: ${message}`); };

/* ── 3D 원본의 구멍 메우기 ───────────────────────────────────────────────
   1인칭에서는 눈에 띄지 않던 배치 오류가 탑다운으로 오면서 드러났다. 두 가지다.

   하나. 부사령관실로 들어가는 유일한 통로가 바닥이 없는 구간이다. 지휘부 복도 내부는
   x 6.65~11.35인데 부사령관실 남쪽 벽이 x 9.0~11.2를 막고 있어서, 열린 곳은 x 7.5~9.0뿐이다.
   그런데 그 폭은 사령관실(x≤7.5)과 부사령관실(x≥9) 사이의 빈 구간이라 바닥이 깔려 있지 않다.
   즉 정거장 밖 검은 공간을 통해야만 부사령관실에 갈 수 있었다.

   둘. 사령관실과 부사령관실을 잇는 지휘부 직통 통로도 같은 빈 구간을 지난다. 이 통로는
   `CO_XO_PASSAGE` 단서가 가리키는 사건의 핵심 동선이라 반드시 걸어서 지날 수 있어야 한다.

   좌표를 바꾸는 것이므로 3D 원본과 어긋난다. 그래서 값을 조용히 고치지 않고 여기 모아
   이유와 함께 남긴다. */

const near = (value, target) => Math.abs(value - target) < 0.01;

// 부사령관실 남쪽 벽에서 복도를 막던 구간을 걷어낸다.
const blocking = walls.findIndex(
  (w) => near(w.x, 10.1) && near(w.z, -18) && near(w.w, 2.2),
);
expectEarly(blocking >= 0, "부사령관실 남쪽 벽에서 복도를 막던 구간을 찾지 못했습니다");
walls.splice(blocking, 1);

// 대신 바깥으로 뚫려 있던 x 7.5~9.0을 막는다. 이제 복도는 x 9~15로 들어간다.
walls.push({ x: 8.25, z: -18, w: 1.5, d: 0.4 });

/*
 * 지휘부 복도 두 개가 방 바닥에서 0.1m 떠 있다.
 *
 * 3D에서는 바닥 콜라이더가 정거장 전체에 하나로 깔려 있어 이 틈이 아무 문제도 아니었다.
 * 바닥이 곧 경계가 된 2D에서는 방으로 들어가는 길이 끊긴다. 폭이 0.1m뿐이라 격자로
 * 훑는 검사도 건너뛰기 쉬우니, 여기서 아예 닿게 붙인다.
 */
for (const [x, z, label] of [[9, -13.4, "지휘부"], [0, -13.4, "사령관실"]]) {
  const corridor = plates.find((p) => near(p.x, x) && near(p.z, z));
  expectEarly(Boolean(corridor), `${label} 복도 바닥판을 찾지 못했습니다`);
  corridor.z = z - 0.1;
  corridor.d += 0.2;
}

// 지휘부 직통 통로에 바닥을 깐다. 사령관실 동쪽 벽의 틈(z -25.9~-20.9)과 폭을 맞춘다.
plates.push({ x: 8.25, z: -23.4, w: 1.5, d: 5, accent: "alert" });

/* ── 구역 이름 붙이기 ────────────────────────────────────────────────────
   방마다 문 위에 안내 표지가 붙어 있으니 표지가 앉은 바닥판이 그 방이다.

   함정이 하나 있다. 중앙 허브에는 다른 구역을 가리키는 길안내 표지가 여러 개 서 있어서
   ("CO · 01 사령관실" 같은), 순진하게 매칭하면 사령관실 이름이 허브에 붙고 진짜
   사령관실은 이름을 잃는다. 허브는 표지를 가장 많이 품은 바닥판으로 먼저 골라내
   매칭에서 빼 둔다. 길안내 노드라는 성질 자체로 구별되므로 좌표를 적어 둘 필요가 없다. */

const contains = (plate, point, margin = 0.6) =>
  Math.abs(point.x - plate.x) <= plate.w / 2 + margin &&
  Math.abs(point.z - plate.z) <= plate.d / 2 + margin;

const signCounts = plates.map((plate) => signs.filter((sign) => contains(plate, sign)).length);
const hubIndex = signCounts.indexOf(Math.max(...signCounts));
expectEarly(signCounts[hubIndex] >= 2, "길안내 표지가 모인 중앙 허브를 찾지 못했습니다");

const rooms = [{
  id: "HB",
  code: "HB · 00",
  // 허브만은 자기를 가리키는 표지가 없다. 다른 구역을 안내하는 쪽이라서다.
  name: "중앙 허브",
  accent: plates[hubIndex].accent,
  x: plates[hubIndex].x,
  z: plates[hubIndex].z,
  w: plates[hubIndex].w,
  d: plates[hubIndex].d,
}];
const used = new Set([hubIndex]);

/*
 * 한 구역을 가리키는 표지가 여러 개다. 허브의 길안내판과 그 방 문 위의 표지가 같은 코드를
 * 쓴다. 앞의 것을 먼저 집으면 방이 아니라 좁은 연결 통로를 방으로 착각한다.
 * 그래서 표지 하나씩 처리하지 않고, 같은 구역의 (표지 × 바닥판) 짝을 전부 늘어놓은 뒤
 * 가장 넓은 바닥판을 고른다. 방은 언제나 그 앞 통로보다 넓다.
 */
const byZone = new Map();
for (const sign of signs) {
  const id = sign.code.split(" ")[0];
  if (id === "HB") continue;
  for (const [index, plate] of plates.entries()) {
    if (index === hubIndex || !contains(plate, sign)) continue;
    const candidate = { id, sign, plate, index, area: plate.w * plate.d };
    const best = byZone.get(id);
    if (!best || candidate.area > best.area) byZone.set(id, candidate);
  }
}

// 넓은 구역부터 자리를 잡는다. 좁은 쪽이 먼저 큰 바닥판을 물어 가지 않게 한다.
for (const pick of [...byZone.values()].sort((a, b) => b.area - a.area)) {
  if (used.has(pick.index)) continue;
  used.add(pick.index);
  rooms.push({
    id: pick.id,
    code: pick.sign.code,
    name: pick.sign.name,
    accent: pick.plate.accent,
    x: pick.plate.x,
    z: pick.plate.z,
    w: pick.plate.w,
    d: pick.plate.d,
  });
}
const anonymousPlates = plates.filter((_, index) => !used.has(index));

/* ── 겹치는 집기 정리 ────────────────────────────────────────────────────
   같은 소품이 콜라이더와 시각 요소로 두 번 잡히는 경우가 있다. 완전히 포개진 것만 접는다. */
const dedupedProps = props.filter((prop, index) =>
  !props.some((other, otherIndex) =>
    otherIndex < index &&
    Math.abs(other.x - prop.x) < 0.05 && Math.abs(other.z - prop.z) < 0.05 &&
    Math.abs(other.w - prop.w) < 0.05 && Math.abs(other.d - prop.d) < 0.05));

/* ── 검증 ────────────────────────────────────────────────────────────── */
const expect = expectEarly;
expect(walls.length > 40, `벽이 ${walls.length}개뿐입니다`);
expect(rooms.length === 9, `구역이 ${rooms.length}개입니다 (9개 예상)`);
expect(objects.length === 16, `오브젝트가 ${objects.length}개입니다 (16개 예상)`);
expect(crew.length === 5, `승무원이 ${crew.length}명입니다 (5명 예상)`);
expect(dedupedProps.length > 30, `집기가 ${dedupedProps.length}개뿐입니다`);
for (const item of [...walls, ...dedupedProps, ...objects, ...crew]) {
  expect(
    Number.isFinite(item.x) && Number.isFinite(item.z),
    `좌표가 NaN입니다: ${JSON.stringify(item)}`,
  );
}
for (const room of rooms) expect(room.id && room.name, `이름 없는 구역: ${JSON.stringify(room)}`);
// 두 구역이 같은 바닥판을 집으면 표지를 잘못 짚었다는 뜻이다. 허브의 길안내 표지에 한 번 당했다.
// (이웃한 방의 바닥판끼리 한 뼘 겹치는 건 3D 원본이 원래 그렇다. 그건 문제가 아니다.)
const footprints = new Set();
for (const room of rooms) {
  const key = `${room.x},${room.z},${room.w},${room.d}`;
  expect(!footprints.has(key), `${room.code}가 다른 구역과 같은 바닥판을 씁니다`);
  footprints.add(key);
}

const bounds = walls.reduce(
  (acc, w) => ({
    minX: Math.min(acc.minX, w.x - w.w / 2), maxX: Math.max(acc.maxX, w.x + w.w / 2),
    minZ: Math.min(acc.minZ, w.z - w.d / 2), maxZ: Math.max(acc.maxZ, w.z + w.d / 2),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
);

const j = (value) => JSON.stringify(value);
const out = `// 정거장 배치의 단일 출처.
//
// 최초 생성: \`node scripts/extract-station.mjs\`가 3D 장면(src/game/world/StationWorld.tsx)을
// 평가해서 뽑았다. 그 장면은 2D 전환에서 삭제됐으므로 지금부터는 이 파일을 직접 고친다.
// 고칠 때 src/data/stationMap.test.ts가 규모와 도달 가능성을 지켜 준다.
//
// 좌표계는 3D와 같다. x는 오른쪽, z는 화면 아래쪽(3D의 +Z)이며 단위는 미터다.
// 사각형은 중심점과 크기로 적는다. 화면에 그릴 때 좌상단을 계산해서 쓴다.

/** 축에 정렬된 사각형. 벽과 집기가 같은 모양을 쓴다. */
export type Box = { x: number; z: number; w: number; d: number };

/** 이름이 붙은 구역. HUD의 "지금 어디" 표시와 바닥 색이 여기서 나온다. */
export type Room = Box & { id: string; code: string; name: string; accent: string };

/** 이름이 없는 바닥판. 복도와 방을 잇는 연결 통로다. */
export type Plate = Box & { accent: string };

/** 조사 지점. id는 \`INVESTIGATION_OBJECTS\`의 키와 같다. */
export type MapObject = { id: string; x: number; z: number };

/** 승무원 배치. facing은 3D의 rotation.y로, 방향은 (sin, cos)이다. */
export type MapCrew = {
  id: string;
  x: number;
  z: number;
  facing: number;
  accent: string;
  uniform: string;
  skin: string;
};

/** 출입구 문턱. 충돌에는 쓰지 않고 드나드는 자리를 바닥에 표시하는 용도다. */
export type Door = { x: number; z: number; vertical: boolean; accent: string };

/** 구역 색. 인물 일러스트의 세피아 팔레트에 맞춰 채도를 내렸다. */
export const ZONE_COLORS: Record<string, string> = {
  mint: "#7f9689",
  amber: "#b58a52",
  violet: "#82799c",
  magenta: "#a4737f",
  alert: "#a85040",
  bone: "#ada08c",
  stone: "#8a8175",
};

/** 이름이 색 이름이면 팔레트에서, 이미 색이면 그대로 돌려준다. */
export function zoneColor(accent: string): string {
  return accent.startsWith("#") ? accent : (ZONE_COLORS[accent] ?? ZONE_COLORS.stone);
}

/** 플레이어 시작 지점. 3D \`PlayerController\`의 스폰과 같다. */
export const SPAWN = { x: 0, z: 6 } as const;

/** 정거장 전체 범위. 미니맵의 viewBox를 잡는 데 쓴다. */
export const STATION_BOUNDS = ${j(bounds)} as const;

export const WALLS: Box[] = ${j(walls)};

/** 책상·크레이트·기둥 같은 집기. 3D에서도 몸이 통과하지 못했으므로 여기서도 막는다. */
export const PROPS: Box[] = ${j(dedupedProps)};

export const ROOMS: Room[] = ${j(rooms)};

export const PLATES: Plate[] = ${j(anonymousPlates)};

export const MAP_OBJECTS: MapObject[] = ${j(objects)};

export const MAP_CREW: MapCrew[] = ${j(crew)};

export const DOORS: Door[] = ${j(doors)};
`;

await writeFile(TARGET, out);
console.log(
  `stationMap.ts 생성: 벽 ${walls.length} · 집기 ${dedupedProps.length} · 구역 ${rooms.length} ` +
  `· 바닥판 ${anonymousPlates.length} · 오브젝트 ${objects.length} · 승무원 ${crew.length} · 문 ${doors.length}`,
);
console.log("구역:", rooms.map((room) => `${room.id} ${room.name}`).join(" / "));
console.log("범위", bounds);
