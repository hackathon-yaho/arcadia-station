// 정거장 배치의 단일 출처.
//
// 최초 생성: `node scripts/extract-station.mjs`가 3D 장면(src/game/world/StationWorld.tsx)을
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

/**
 * 집기가 무엇인지.
 *
 * 3D에서 뽑아낸 건 충돌 상자뿐이라 책상도 시신도 크레이트도 전부 같은 사각형이었다.
 * 화면에서는 그게 전부 같은 회색 판으로 보인다. 정거장을 도면이 아니라 장소로 보이게
 * 하려면 그리는 쪽이 "이건 책상, 저건 시신"을 알아야 하므로 상자마다 종류를 붙인다.
 *
 * 크기와 자리는 3D 그대로 두고 종류만 더한다. 몸이 막히는 범위는 달라지지 않는다.
 */
export type PropKind =
  | "dais" /** 허브 중앙 단 */
  | "core" /** 허브 코어 기둥 */
  | "desk" /** 집무 책상 */
  | "terminal" /** 책상 위 단말 */
  | "panel" /** 벽에 붙은 패널·현황판 */
  | "body" /** 쓰러진 사람 */
  | "scanner" /** 이동식 스캔 장비 */
  | "bed" /** 의료 베드 */
  | "cabinet" /** 보관함 */
  | "machine" /** 기계 유닛 */
  | "crate" /** 화물 상자 */
  | "console" /** 조작 콘솔 */
  | "server" /** 서버 랙 */
  | "airlock" /** 에어록 해치 */
  | "table" /** 원형 식탁 */
  | "chair" /** 의자 */
  | "counter" /** 배식대 */
  | "column"; /** 기둥·통로 문설주 */

/** 몸이 통과하지 못하는 집기 한 점. */
export type Prop = Box & { kind: PropKind };

/** 조사 지점. id는 `INVESTIGATION_OBJECTS`의 키와 같다. */
export type MapObject = { id: string; x: number; z: number };

/**
 * 승무원 배치. facing은 3D의 rotation.y로, 방향은 (sin, cos)이다.
 *
 * 생김새는 여기 없다. 인물이 어떻게 생겼는지는 초상에서 나오는 일이라 `characters.ts`의
 * `build`가 갖고 있고, 이 파일은 "누가 어디에 서 있는가"만 안다. `accent`는 구역 색이라
 * 이름표에 쓴다.
 */
export type MapCrew = {
  id: string;
  x: number;
  z: number;
  facing: number;
  accent: string;
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

/** 플레이어 시작 지점. 3D `PlayerController`의 스폰과 같다. */
export const SPAWN = { x: 0, z: 6 } as const;

/** 정거장 전체 범위. 미니맵의 viewBox를 잡는 데 쓴다. */
export const STATION_BOUNDS = {"minX":-27.2,"maxX":19.7,"minZ":-28.7,"maxZ":23.2} as const;

export const WALLS: Box[] = [{"x":-11.5,"z":-7.7,"w":0.4,"d":2.6},{"x":-11.5,"z":0,"w":0.4,"d":6},{"x":-11.5,"z":7.7,"w":0.4,"d":2.6},{"x":11.5,"z":2.5,"w":0.4,"d":13},{"x":-9.85,"z":9,"w":3.3,"d":0.4},{"x":-3.25,"z":9,"w":3.1,"d":0.4},{"x":3.25,"z":9,"w":3.1,"d":0.4},{"x":9.85,"z":9,"w":3.3,"d":0.4},{"x":-7.03,"z":-9,"w":8.95,"d":0.4},{"x":4.52,"z":-9,"w":3.95,"d":0.4},{"x":-2.55,"z":-13.5,"w":0.3,"d":9},{"x":2.55,"z":-13.5,"w":0.3,"d":9},{"x":-7.5,"z":-23.25,"w":0.4,"d":10.5},{"x":0,"z":-28.5,"w":15,"d":0.4},{"x":-5.1,"z":-18,"w":4.8,"d":0.4},{"x":5.1,"z":-18,"w":4.8,"d":0.4},{"x":7.5,"z":-27.2,"w":0.4,"d":2.6},{"x":7.5,"z":-19.55,"w":0.4,"d":2.7},{"x":6.5,"z":-13.5,"w":0.3,"d":9},{"x":11.5,"z":-13.5,"w":0.3,"d":9},{"x":19,"z":-23.25,"w":0.4,"d":10.5},{"x":14,"z":-28.5,"w":10,"d":0.4},{"x":17,"z":-18,"w":4,"d":0.4},{"x":7.5,"z":-27.2,"w":0.4,"d":2.6},{"x":7.5,"z":-19.55,"w":0.4,"d":2.7},{"x":-19,"z":-8.9,"w":10,"d":0.4},{"x":-19,"z":-0.5,"w":10,"d":0.4},{"x":-24,"z":-4.7,"w":0.4,"d":8.4},{"x":-14,"z":-7.65,"w":0.4,"d":2.5},{"x":-14,"z":-1.75,"w":0.4,"d":2.5},{"x":-20.5,"z":0,"w":13,"d":0.4},{"x":-20.5,"z":9.4,"w":13,"d":0.4},{"x":-27,"z":4.7,"w":0.4,"d":9.4},{"x":-14,"z":1.5,"w":0.4,"d":3},{"x":-14,"z":7.9,"w":0.4,"d":3},{"x":-9.1,"z":11,"w":1.8,"d":0.4},{"x":-3.9,"z":11,"w":1.8,"d":0.4},{"x":-6.5,"z":19,"w":7,"d":0.4},{"x":-10,"z":15,"w":0.4,"d":8},{"x":-3,"z":15,"w":0.4,"d":8},{"x":-3.1,"z":11,"w":2.8,"d":0.4},{"x":3.1,"z":11,"w":2.8,"d":0.4},{"x":0,"z":23,"w":9,"d":0.4},{"x":-4.5,"z":17,"w":0.4,"d":12},{"x":4.5,"z":17,"w":0.4,"d":12},{"x":4.4,"z":11,"w":1.8,"d":0.4},{"x":9.6,"z":11,"w":1.8,"d":0.4},{"x":7,"z":19,"w":7,"d":0.4},{"x":3.5,"z":15,"w":0.4,"d":8},{"x":10.5,"z":12.15,"w":0.4,"d":2.3},{"x":10.5,"z":17.85,"w":0.4,"d":2.3},{"x":15,"z":9,"w":9,"d":0.4},{"x":15,"z":21,"w":9,"d":0.4},{"x":10.5,"z":11.15,"w":0.4,"d":4.3},{"x":10.5,"z":18.85,"w":0.4,"d":4.3},{"x":19.5,"z":15,"w":0.4,"d":12},{"x":8.25,"z":-18,"w":1.5,"d":0.4}];

/**
 * 책상·크레이트·기둥 같은 집기. 3D에서도 몸이 통과하지 못했으므로 여기서도 막는다.
 *
 * 자리와 크기는 추출기가 뽑은 값 그대로다. `kind`만 사람이 손으로 붙였다 — 방의 용도와
 * 상자의 비례를 보고 무엇이었는지 되짚은 결과이며, 조사 지점과 겹치는 상자는 그 단서가
 * 무엇인지가 곧 종류다.
 */
export const PROPS: Prop[] = [
  // HB · 중앙 허브
  { x: 0, z: 0.2, w: 4.7, d: 4.7, kind: "dais" },
  { x: 0, z: 0.2, w: 1.6, d: 1.6, kind: "core" },
  { x: 0.67, z: 0.2, w: 0.9, d: 0.18, kind: "panel" }, // HB_MAINTENANCE
  // CO · 사령관실
  { x: 0, z: -25.5, w: 5.2, d: 1.65, kind: "desk" },
  { x: 0.65, z: -25.55, w: 2.15, d: 0.12, kind: "terminal" }, // CO_TERMINAL
  { x: 2.2, z: -22.1, w: 2.1, d: 1, kind: "body" }, // CO_BODY
  { x: -1.9, z: -18.18, w: 0.74, d: 0.18, kind: "panel" }, // CO_DOOR_LOG
  { x: -7.2, z: -23.4, w: 0.24, d: 2.6, kind: "panel" }, // CO_ENV_PANEL
  { x: 5.25, z: -25.7, w: 1.64, d: 1.64, kind: "scanner" }, // CO_SCANNER
  { x: 7.32, z: -23.4, w: 0.12, d: 2.5, kind: "column" }, // CO_XO_PASSAGE
  // XO · 부사령관 집무실
  { x: 14.4, z: -24.8, w: 4.25, d: 1.45, kind: "desk" },
  { x: 18.76, z: -23.5, w: 0.16, d: 3.6, kind: "panel" }, // XO_RESOURCE_BOARD
  // MD · 의무실
  { x: -21.6, z: -6.4, w: 2.3, d: 1.05, kind: "bed" },
  { x: -17.8, z: -6.4, w: 2.3, d: 1.05, kind: "bed" },
  { x: -22.7, z: -2.7, w: 2.2, d: 0.52, kind: "cabinet" }, // MD_MEDICAL_STORAGE
  { x: -16, z: -2.65, w: 1.8, d: 1.8, kind: "console" }, // MD_MEDICAL_TERMINAL
  // EN · 엔지니어링
  { x: -24.2, z: 4.5, w: 2.04, d: 2.04, kind: "machine" },
  { x: -20.5, z: 4.5, w: 2.04, d: 2.04, kind: "machine" },
  { x: -16.8, z: 4.5, w: 2.04, d: 2.04, kind: "machine" },
  { x: -24, z: 8.1, w: 1.28, d: 1.28, kind: "crate" },
  { x: -22.4, z: 8.1, w: 1.28, d: 1.28, kind: "crate" },
  { x: -20.8, z: 8.1, w: 1.28, d: 1.28, kind: "crate" },
  { x: -16.7, z: 7.75, w: 3.2, d: 1.1, kind: "machine" }, // EN_LIFE_SUPPORT
  // CM · 통신실
  { x: -8.8, z: 17.85, w: 1.55, d: 0.65, kind: "console" },
  { x: -6.5, z: 17.85, w: 1.55, d: 0.65, kind: "console" },
  { x: -4.2, z: 17.85, w: 1.55, d: 0.65, kind: "console" },
  { x: -6.5, z: 13.7, w: 4.7, d: 1.25, kind: "server" }, // CM_SECURITY_ARCHIVE
  // CG · 화물·도킹
  { x: 0, z: 22.75, w: 5.5, d: 0.42, kind: "airlock" }, // CG_AIRLOCK_LOG
  { x: -2.8, z: 14.2, w: 1.55, d: 1.45, kind: "crate" },
  { x: -2.5, z: 17, w: 1.55, d: 1.45, kind: "crate" },
  { x: -2.4, z: 17, w: 1.55, d: 1.45, kind: "crate" }, // CG_CARGO_MANIFEST
  { x: -1.8, z: 19.5, w: 1.55, d: 1.45, kind: "crate" },
  // CMN · 식당·라운지
  { x: 3.25, z: 14, w: 0.34, d: 0.5, kind: "column" },
  { x: 6.1, z: 14.05, w: 2.1, d: 2.1, kind: "table" },
  { x: 4.72, z: 14.05, w: 0.76, d: 0.76, kind: "chair" },
  { x: 7.48, z: 14.05, w: 0.76, d: 0.76, kind: "chair" },
  { x: 6.1, z: 16.15, w: 2.1, d: 2.1, kind: "table" },
  { x: 4.72, z: 16.15, w: 0.76, d: 0.76, kind: "chair" },
  { x: 7.48, z: 16.15, w: 0.76, d: 0.76, kind: "chair" },
  { x: 8.6, z: 17.6, w: 2.6, d: 0.6, kind: "counter" }, // CMN_FOOD_STATION
  // QT · 승무원 숙소
  { x: 10.72, z: 13.4, w: 0.18, d: 0.84, kind: "panel" }, // QT_ACCESS_BUFFER
];

export const ROOMS: Room[] = [{"id":"HB","code":"HB · 00","name":"중앙 허브","accent":"#899593","x":0,"z":0,"w":23,"d":18},{"id":"CO","code":"CO · COMMAND","name":"사령관실","accent":"#d65a43","x":0,"z":-23.25,"w":15,"d":10.5},{"id":"EN","code":"EN · 03","name":"엔지니어링","accent":"#e19b54","x":-20.5,"z":4.7,"w":13,"d":9.4},{"id":"CG","code":"CG · 05","name":"화물·도킹","accent":"#da7aa4","x":0,"z":17,"w":9,"d":12},{"id":"QT","code":"QT · 07","name":"승무원 숙소","accent":"#858b87","x":15,"z":15,"w":9,"d":12},{"id":"XO","code":"XO · COMMAND","name":"부사령관 집무실","accent":"#bcb6a9","x":14,"z":-23.25,"w":10,"d":10.5},{"id":"MD","code":"MD · 02","name":"의무실","accent":"#72cbb9","x":-19,"z":-4.7,"w":10,"d":8.4},{"id":"CM","code":"CM · 04","name":"통신실","accent":"#9188e8","x":-6.5,"z":15,"w":7,"d":8},{"id":"CMN","code":"CMN · 06","name":"식당·라운지","accent":"#aaa89f","x":7,"z":15,"w":7,"d":8}];

export const PLATES: Plate[] = [{"x":0,"z":-13.5,"w":5.1,"d":9.2,"accent":"#d65a43"},{"x":9,"z":-13.5,"w":5,"d":9.2,"accent":"#bcb6a9"},{"x":-12.75,"z":-4.7,"w":2.5,"d":3.4,"accent":"#72cbb9"},{"x":-12.75,"z":4.7,"w":2.5,"d":3.4,"accent":"#e19b54"},{"x":-6.5,"z":10,"w":3.4,"d":2,"accent":"#9188e8"},{"x":0,"z":10,"w":3.4,"d":2,"accent":"#da7aa4"},{"x":6.5,"z":10,"w":3.4,"d":2,"accent":"#aaa89f"},{"x":11.25,"z":15,"w":1.5,"d":3.4,"accent":"#858b87"},{"x":8.25,"z":-23.4,"w":1.5,"d":5,"accent":"alert"}];

export const MAP_OBJECTS: MapObject[] = [{"id":"HB_MAINTENANCE","x":0.67,"z":0.2},{"id":"CO_TERMINAL","x":0.65,"z":-25.55},{"id":"CO_BODY","x":2.2,"z":-22.1},{"id":"CO_DOOR_LOG","x":-1.9,"z":-18.18},{"id":"CO_ENV_PANEL","x":-7.2,"z":-23.4},{"id":"CO_SCANNER","x":5.25,"z":-25.7},{"id":"CO_XO_PASSAGE","x":7.32,"z":-23.4},{"id":"XO_RESOURCE_BOARD","x":18.76,"z":-23.5},{"id":"MD_MEDICAL_STORAGE","x":-22.7,"z":-2.7},{"id":"MD_MEDICAL_TERMINAL","x":-16,"z":-2.65},{"id":"EN_LIFE_SUPPORT","x":-16.7,"z":7.75},{"id":"CM_SECURITY_ARCHIVE","x":-6.5,"z":13.7},{"id":"CG_AIRLOCK_LOG","x":0,"z":22.75},{"id":"CG_CARGO_MANIFEST","x":-2.4,"z":17},{"id":"CMN_FOOD_STATION","x":8.6,"z":17.6},{"id":"QT_ACCESS_BUFFER","x":10.72,"z":13.4}];

export const MAP_CREW: MapCrew[] = [
  { id: "NPC_MAYA", x: 15.3, z: -21.6, facing: -2.55, accent: "#d65a43" },
  { id: "NPC_SOPHIA", x: -19.2, z: -3.2, facing: 2.7, accent: "#72cbb9" },
  { id: "NPC_JUNHO", x: -18.3, z: 7.2, facing: -2.7, accent: "#e19b54" },
  { id: "NPC_KASIM", x: -6.5, z: 12.5, facing: 3.142, accent: "#9188e8" },
  { id: "NPC_YUNA", x: 2.9, z: 19.2, facing: -0.45, accent: "#da7aa4" },
];

export const DOORS: Door[] = [{"x":0,"z":-8.9,"vertical":false,"accent":"#d65a43"},{"x":-11.28,"z":-4.7,"vertical":true,"accent":"#72cbb9"},{"x":-11.28,"z":4.7,"vertical":true,"accent":"#e19b54"},{"x":-6.5,"z":8.78,"vertical":false,"accent":"#9188e8"},{"x":0,"z":8.78,"vertical":false,"accent":"#da7aa4"},{"x":6.5,"z":8.78,"vertical":false,"accent":"#aaa89f"},{"x":0,"z":-18.05,"vertical":false,"accent":"#d65a43"},{"x":7.42,"z":-23.4,"vertical":true,"accent":"#d65a43"},{"x":9,"z":-18.05,"vertical":false,"accent":"#bcb6a9"},{"x":7.58,"z":-23.4,"vertical":true,"accent":"#d65a43"},{"x":-14.06,"z":-4.7,"vertical":true,"accent":"#72cbb9"},{"x":-14.06,"z":4.7,"vertical":true,"accent":"#e19b54"},{"x":-6.5,"z":11.06,"vertical":false,"accent":"#9188e8"},{"x":0,"z":11.06,"vertical":false,"accent":"#da7aa4"},{"x":0,"z":22.75,"vertical":false,"accent":"#da7aa4"},{"x":7,"z":11.06,"vertical":false,"accent":"#aaa89f"},{"x":10.56,"z":15,"vertical":true,"accent":"#858b87"},{"x":12.9,"z":9.3,"vertical":false,"accent":"#d65a43"},{"x":15,"z":9.3,"vertical":false,"accent":"#858b87"},{"x":17.1,"z":9.3,"vertical":false,"accent":"#858b87"},{"x":12.9,"z":20.7,"vertical":false,"accent":"#858b87"},{"x":15,"z":20.7,"vertical":false,"accent":"#858b87"},{"x":17.1,"z":20.7,"vertical":false,"accent":"#72cbb9"}];
