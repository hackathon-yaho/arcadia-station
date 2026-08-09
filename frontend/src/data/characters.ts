import { SUSPECTS } from "./investigation";

/*
 * 인물이 어떻게 보이는가.
 *
 * `SUSPECTS`는 서버 판정에 쓰는 최소 정보(이름·직책·색)만 갖고 있다. 2D로 오면서 화면에
 * 얼굴이 뜨기 시작했으므로 초상과 표시용 정보를 여기 모은다. 사건 로직은 여전히 `SUSPECTS`와
 * 서버 응답을 기준으로 돌고, 이 파일은 "어떻게 보이는가"만 책임진다.
 *
 * 쓰이는 곳이 둘이다. 심문·재판 창은 초상 그림(`portrait`)을 그대로 띄우고, 정거장 화면은
 * 초상을 보고 옮겨 적은 미니어처 설계(`build`)로 인물을 그린다.
 */

/**
 * 머리 모양.
 *
 * 정거장 화면에서 인물은 머리가 스물몇 픽셀이다. 그 크기에서 사람을 가르는 건 이목구비가
 * 아니라 머리 실루엣이다 — 틀어 올린 쪽인지, 어깨까지 쏟아지는지, 귀 밑에서 잘렸는지.
 */
export type HairStyle =
  | "crop" /** 짧고 뻗친 머리 */
  | "bun" /** 정수리에 틀어 올린 머리 */
  | "long" /** 어깨 아래까지 쏟아지는 긴 곱슬 */
  | "bob" /** 귀 밑에서 잘린 단발 */
  | "swept"; /** 뒤로 넘긴 반백 */

/** 옷에 붙은 표식. 하나하나가 일러스트에서 그 사람을 알아보게 하는 것들이다. */
export type Mark =
  | "collar" /** 색이 다른 옷깃 */
  | "tie" /** 넥타이 */
  | "badge" /** 가슴의 신분증 */
  | "armband" /** 소매의 완장 줄 */
  | "epaulette" /** 어깨의 계급장 */
  | "harness"; /** 가슴을 가로지르는 멜빵·스트랩 */

/**
 * 손에 든 것. 실루엣을 가장 크게 바꾸는 요소라 인물마다 하나까지만 준다.
 *
 * 몸 옆으로 뻗는 것만 남겼다. 보안담당관의 초상에는 어깨에 걸친 총이 있지만, 그건 목
 * 높이를 가로지르는 수평 막대라 이 크기에서는 총이 아니라 목에 꽂힌 막대로 보였다.
 * 낮춰 걸면 몸통에 가려 아무것도 안 보인다. 이 축척에서 살아남지 못하는 소품이다.
 */
export type Handheld = "wrench" | "clipboard";

/** 서 있는 자세. 걸을 때는 무시하고 팔을 흔든다. */
export type Pose = "hip" | "raised";

/** 눈매. 일러스트의 인상을 한 단어로 줄인 것이다. */
export type EyeShape =
  | "sharp" /** 날 선 눈. 바깥 끝이 올라간다. */
  | "narrow" /** 가늘게 뜬 눈 */
  | "soft" /** 크고 둥근 눈 */
  | "weary"; /** 반쯤 감긴 지친 눈. 바깥 끝이 내려간다. */

/** 앞머리가 이마를 덮는 모양. */
export type Bangs =
  | "swept" /** 한쪽으로 넘긴 앞머리 */
  | "parted" /** 가운데가 갈라져 이마 한가운데로 내려온 앞머리 */
  | "curtain" /** 가르마를 타고 양옆으로 흘러내리는 긴 앞머리 */
  | "blunt" /** 일자로 자른 앞머리 */
  | "back"; /** 뒤로 넘겨 이마가 드러난 머리 */

/**
 * 얼굴.
 *
 * 처음에는 초상에서 얼굴만 동그랗게 오려 머리에 얹었다. 붓질이 살아 있는 회화 조각이
 * 도형으로 짠 몸통 위에 앉으니, 사람 하나가 두 개의 다른 그림으로 갈라져 보였다. 머리만
 * 다른 화집에서 오려 붙인 것 같았다.
 *
 * 지금은 몸과 같은 어법으로 — 면과 선 몇 개로 — 그린다. 일러스트에서 가져오는 건 픽셀이
 * 아니라 인상이다. 눈매가 날 섰는지 반쯤 감겼는지, 눈썹이 미간으로 몰렸는지, 앞머리가
 * 이마를 덮는지 넘겨졌는지. 스물몇 픽셀에서 남는 건 어차피 그것뿐이다.
 */
export type FaceLook = {
  eyes: EyeShape;
  /** 눈썹 기울기(rad). 양수면 미간 쪽이 내려간 사나운 인상. */
  brow: number;
  bangs: Bangs;
  /** 입꼬리. 음수면 내려간 입. */
  mouth: number;
};

/**
 * 정거장 화면에 세울 미니어처의 생김새.
 *
 * 전부 일러스트를 보고 옮긴 값이다. 예전에는 인물마다 제복 색 하나만 달라서, 얼굴을
 * 가리면 다섯 명이 같은 인형이었다. 색·기장·표식·소품을 나눠 두면 멀리서 실루엣만 봐도
 * 누가 어느 방에 서 있는지 안다.
 */
export type Build = {
  hair: HairStyle;
  hairColor: string;
  face: FaceLook;
  /** 겉옷. 몸통의 바탕색이다. */
  coat: string;
  /** 겉옷 안으로 보이는 옷. 가슴 가운데 쐐기로 뜬다. */
  inner: string;
  /** 옷깃·완장·넥타이에 쓰는 강조색. */
  trim: string;
  /** 하의. */
  legs: string;
  /** 맨살. 장갑 없는 손과 드러난 허리에 쓴다. */
  skin: string;
  /** 겉옷이 짧아 허리가 드러나는지. */
  midriff?: boolean;
  /** 실험복처럼 앞이 열려 양옆으로 늘어지는지. */
  lapels?: boolean;
  marks: Mark[];
  holds?: Handheld;
  pose?: Pose;
};

export type Character = {
  id: string;
  name: string;
  role: string;
  /**
   * 용의자만 재판과 배제 논증에 오른다. 피해자와 플레이어가 그 목록에 섞이면
   * 서버가 모르는 ID를 제출하게 되므로 종류를 명시적으로 갈라 둔다.
   */
  kind: "SUSPECT" | "VICTIM" | "PLAYER";
  /** 심문·재판·수첩에 쓰는 초상. `scripts/slice-portraits.py`가 만든다. */
  portrait: string;
  accent: string;
  /** 정거장 화면에 세울 미니어처. 초상을 보고 옮겼다. */
  build: Build;
};

const portrait = (file: string) => `/assets/characters/${file}.webp`;

/**
 * 인물별 미니어처. 초상 한 장씩 보고 옮겼다.
 *
 * 옮길 때 기준은 "화면에서 스물몇 픽셀로 줄여도 남는 것"이다. 소피아의 흰 실험복과 쏟아지는
 * 머리, 유나의 짧은 재킷과 드러난 허리, 준호의 렌치, 마야의 매서운 눈매 — 이런 큰 덩어리는
 * 살아남고, 단추나 봉제선은 살아남지 않는다.
 */
const BUILDS: Record<string, Build> = {
  // 흰 셔츠에 검은 멜빵, 짙은 붉은 넥타이. 정거장에서 유일하게 밝은 상의라 멀리서도 갈린다.
  // 헝클어진 앞머리 아래로 날 선 눈, 살짝 찌푸린 눈썹.
  PLAYER: {
    hair: "crop",
    hairColor: "#221913",
    face: { eyes: "sharp", brow: 0.16, bangs: "swept", mouth: -0.1 },
    coat: "#bdb6a5",
    inner: "#bdb6a5",
    trim: "#6f2f27",
    legs: "#221f1b",
    skin: "#b98f77",
    marks: ["harness", "tie", "badge"],
  },
  // 검은 가죽 재킷에 붉은 옷깃, 안에 흰 셔츠. 한 손을 허리에 얹고 서 있다.
  // 내리깐 매서운 눈에 미간으로 몰린 눈썹. 앞머리는 쪽으로 넘겨 이마가 반쯤 드러난다.
  MAYA: {
    hair: "bun",
    hairColor: "#3b2c1e",
    face: { eyes: "narrow", brow: 0.26, bangs: "swept", mouth: -0.16 },
    coat: "#17130f",
    inner: "#b4ae9f",
    trim: "#9c3b2c",
    legs: "#26221d",
    skin: "#aa806d",
    marks: ["collar"],
    pose: "hip",
  },
  // 정비복에 붉은 어깨줄, 목에 회색 속옷. 큰 렌치를 들고 있다.
  // 이마를 다 덮는 헝클어진 앞머리, 그 아래 순하고 지친 눈.
  JUNHO: {
    hair: "crop",
    hairColor: "#120e0b",
    face: { eyes: "soft", brow: 0.04, bangs: "parted", mouth: -0.04 },
    coat: "#1e1a15",
    inner: "#8b877c",
    trim: "#93382a",
    legs: "#232019",
    skin: "#b58a73",
    marks: ["armband", "badge"],
    holds: "wrench",
  },
  // 흰 실험복이 활짝 열려 있고 안은 어두운 상의. 긴 곱슬머리가 어깨를 덮는다.
  // 가르마를 타고 얼굴 양옆으로 흘러내리는 긴 앞머리, 반쯤 감긴 피곤한 눈.
  SOPHIA: {
    hair: "long",
    hairColor: "#372a1e",
    face: { eyes: "weary", brow: -0.06, bangs: "curtain", mouth: 0 },
    coat: "#aca699",
    inner: "#221c18",
    trim: "#8a8073",
    legs: "#2a2621",
    skin: "#a77962",
    lapels: true,
    marks: ["badge"],
    holds: "clipboard",
  },
  // 검은 재킷에 회색 셔츠와 붉은 넥타이, 왼팔에 붉은 완장. 한 손을 얼굴로 올리고 있다.
  // 한쪽 눈을 덮고 넘어간 앞머리, 가늘게 뜬 눈.
  KASIM: {
    hair: "crop",
    hairColor: "#100d0a",
    face: { eyes: "narrow", brow: 0.18, bangs: "swept", mouth: -0.08 },
    coat: "#16130f",
    inner: "#87827a",
    trim: "#8e3527",
    legs: "#201d19",
    skin: "#8d6858",
    marks: ["tie", "armband", "badge"],
    pose: "raised",
  },
  // 배꼽까지 오는 짧은 재킷, 가슴을 가로지르는 스트랩, 골반에 걸친 넓은 벨트.
  // 일자로 자른 단발 앞머리, 무심하게 내려앉은 눈과 낮은 눈썹.
  YUNA: {
    hair: "bob",
    hairColor: "#14100c",
    face: { eyes: "narrow", brow: 0.02, bangs: "blunt", mouth: -0.06 },
    coat: "#1a1611",
    inner: "#15120e",
    trim: "#8f382c",
    legs: "#26221c",
    skin: "#b68572",
    midriff: true,
    marks: ["harness", "badge"],
  },
  // 지휘관 외투에 계급장과 선 옷깃. 머리는 반백이고, 목에 두른 건 붉은 깃이 아니라
  // 밝은 셔츠 깃이라 강조색은 어깨의 놋빛 계급장에만 쓴다.
  // 머리를 뒤로 넘겨 이마가 드러나고, 나이 든 눈이 무겁게 내려앉아 있다.
  ROSS: {
    hair: "swept",
    hairColor: "#9a927e",
    face: { eyes: "weary", brow: 0.2, bangs: "back", mouth: -0.12 },
    coat: "#251e17",
    inner: "#8a857a",
    trim: "#a8905c",
    legs: "#1e1a15",
    skin: "#b08a70",
    marks: ["epaulette"],
  },
};

/** 로스터에 없는 사람. 서버가 모르는 승무원을 보내와도 화면이 비지 않는다. */
const DEFAULT_BUILD: Build = {
  hair: "crop",
  hairColor: "#1d1610",
  face: { eyes: "soft", brow: 0.08, bangs: "parted", mouth: -0.05 },
  coat: "#221d18",
  inner: "#7f7a70",
  trim: "#8f8678",
  legs: "#221f1a",
  skin: "#a87f68",
  marks: ["badge"],
};

/** 용의자가 아닌 인물. 사건 로직이 아니라 화면에만 등장한다. */
const NON_SUSPECTS: Character[] = [
  {
    id: "PLAYER",
    name: "보안담당관",
    role: "정거장 보안",
    kind: "PLAYER",
    portrait: portrait("player"),
    accent: "#8ce0c8",
    build: BUILDS.PLAYER,
  },
  {
    id: "ROSS",
    name: "다니엘 로스",
    role: "사령관",
    kind: "VICTIM",
    portrait: portrait("ross"),
    accent: "#d65a43",
    build: BUILDS.ROSS,
  },
];

/** 용의자 초상. 파일명은 `SUSPECTS[].id`를 소문자로 바꾼 것과 같다. */
export const CHARACTERS: Record<string, Character> = Object.fromEntries(
  [
    ...SUSPECTS.map<Character>((suspect) => ({
      id: suspect.id,
      name: suspect.name,
      role: suspect.role,
      kind: "SUSPECT",
      portrait: portrait(suspect.id.toLowerCase()),
      accent: suspect.color,
      build: BUILDS[suspect.id] ?? DEFAULT_BUILD,
    })),
    ...NON_SUSPECTS,
  ].map((character) => [character.id, character]),
);

export const PLAYER = CHARACTERS.PLAYER;

/**
 * 3D 소품 ID를 인물 ID로 옮긴다.
 *
 * 현장에 서 있는 승무원은 `NPC_MAYA`처럼 조사 오브젝트 ID로 식별되지만, 서버 판정과 재판은
 * `MAYA`를 쓴다. 두 이름이 섞이면 초상이 뜨지 않거나 엉뚱한 사람이 뜬다.
 */
export function characterIdFromNpc(npcId: string): string {
  return npcId.startsWith("NPC_") ? npcId.slice(4) : npcId;
}

/**
 * 초상 경로. 인물 ID와 NPC 오브젝트 ID를 모두 받는다.
 *
 * 서버가 정적 로스터에 없는 인물을 돌려줄 수 있으므로 없으면 `null`을 준다. 부르는 쪽은
 * 이니셜 폴백으로 물러난다.
 */
export function portraitFor(id: string): string | null {
  return CHARACTERS[characterIdFromNpc(id)]?.portrait ?? null;
}

/** 화면에 쓸 인물 정보. 모르는 ID면 ID를 이름으로 삼아 화면이 비지 않게 한다. */
export function characterFor(id: string): Character {
  const key = characterIdFromNpc(id);
  return (
    CHARACTERS[key] ?? {
      id: key,
      name: key,
      role: "승무원",
      kind: "SUSPECT",
      portrait: "",
      accent: "#8f86e8",
      build: DEFAULT_BUILD,
    }
  );
}

/**
 * 초상을 미리 받아 둔다.
 *
 * 심문 창이 열리는 순간 회색 사각형이 보이지 않게 하기 위해서다. 정거장 화면은 더 이상
 * 이 그림을 쓰지 않으므로 — 인물을 직접 그린다 — 늦게 도착해도 걷는 화면은 멀쩡하다.
 */
const loaded = new Map<string, HTMLImageElement>();

export function preloadPortraits(): void {
  for (const character of Object.values(CHARACTERS)) {
    if (!character.portrait || loaded.has(character.id)) continue;
    const image = new Image();
    image.decoding = "async";
    image.src = character.portrait;
    loaded.set(character.id, image);
  }
}
