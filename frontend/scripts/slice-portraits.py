"""인물 시트 한 장을 초상 7장으로 자른다.

`art/_sheet.png`(1536x1024)에서 인물별 3:4 영역을 잘라
`public/assets/characters/<id>.webp`로 내보낸다. 결과 7장은 리포에 커밋하므로
이 스크립트는 시트가 바뀔 때만 다시 돌리면 된다. 그래서 npm 의존성으로 넣지 않고
Pillow만 있으면 도는 일회성 도구로 둔다.

원본 시트는 `art/`에 둔다. `public/` 아래에 두면 Vite가 3MB짜리 원본을 그대로
`dist/`에 복사한다. 배포에 나가는 것은 잘린 7장뿐이어야 한다.

    py -3 scripts/slice-portraits.py

배경은 지우지 않는다. 인물이 어두워서 깨끗한 매트를 뽑을 수 없고, 시트의 따뜻한
그라디언트가 오히려 정거장의 차가운 UI와 인물을 분리해 준다. 대신 가장자리만
아주 얇게 페더링해서 옆 인물이 몇 픽셀 딸려 들어오는 것을 지운다. 실제 비네팅은
화면 쪽 CSS가 맡는다.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "art" / "_sheet.png"
OUT_DIR = ROOT / "public" / "assets" / "characters"

# 출력 규격. 3:4 세로. 원본 인물이 대략 345x460이라 확대는 최소로만 건다.
OUT_SIZE = (384, 512)

# WebP 손실 압축. 같은 그림이 PNG로는 350KB, 여기서는 25KB 안쪽이다.
# 3D 런타임을 덜어낸 자리를 이미지로 도로 채우면 의미가 없다.
WEBP_QUALITY = 88

# 가장자리 페더 폭(출력 픽셀). 옆 인물 잔상만 지우는 용도라 얇게 둔다.
FEATHER = 14

# 시트에서 읽은 인물별 영역. (left, top, right, bottom), 모두 3:4.
# ID는 SUSPECTS[].id와 같다. 매핑 테이블을 따로 두지 않기 위해서다.
BOXES = {
    "player": (123, 18, 468, 478),
    "maya": (476, 18, 821, 478),
    "junho": (822, 18, 1167, 478),
    "sophia": (1170, 18, 1515, 478),
    "kasim": (148, 512, 515, 1002),
    "yuna": (530, 512, 897, 1002),
    "ross": (945, 512, 1312, 1002),
}


def feather_alpha(size: tuple[int, int], width: int) -> Image.Image:
    """좌·우·상 세 변만 투명으로 떨어지는 알파. 아래는 화면 밖으로 흘려야 해서 남긴다."""
    w, h = size
    mask = Image.new("L", size, 255)
    px = mask.load()
    for i in range(width):
        level = round(255 * (i + 1) / (width + 1))
        for y in range(h):
            px[i, y] = min(px[i, y], level)
            px[w - 1 - i, y] = min(px[w - 1 - i, y], level)
        for x in range(w):
            px[x, i] = min(px[x, i], level)
    return mask


def main() -> None:
    if not SHEET.exists():
        raise SystemExit(f"시트를 찾지 못했습니다: {SHEET}")

    sheet = Image.open(SHEET).convert("RGB")
    mask = feather_alpha(OUT_SIZE, FEATHER)
    total = [0.0]

    for name, box in BOXES.items():
        left, top, right, bottom = box
        ratio = (right - left) / (bottom - top)
        if abs(ratio - 0.75) > 0.01:
            raise SystemExit(f"{name}: 3:4가 아닙니다 (ratio={ratio:.3f})")

        portrait = sheet.crop(box).resize(OUT_SIZE, Image.LANCZOS).convert("RGBA")
        portrait.putalpha(mask)

        target = OUT_DIR / f"{name}.webp"
        portrait.save(target, "WEBP", quality=WEBP_QUALITY, method=6)
        size_kb = target.stat().st_size / 1024
        total[0] += size_kb
        print(f"{name:<7} {box} -> {target.name} ({size_kb:.0f} KB)")

    print(f"{'total':<7} {total[0]:.0f} KB")


if __name__ == "__main__":
    main()
