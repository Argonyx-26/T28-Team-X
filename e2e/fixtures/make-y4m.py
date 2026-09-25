"""Builds the fake-camera fixture for the snap-mode browser test.

Chrome plays an uncompressed Y4M file as a webcam when launched with
    --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<abs path to pages.y4m>
and loops it. The file shows two notebook pages, each held steady for ~3 s, joined by ~0.5 s of a blurred,
shaky crossfade (a hand turning the page). The auto-capture must fire once per page and never during the turn.

Also writes page-roll-42.png: a page whose roll number belongs to nobody in the test class, imported through
"Use photos from the gallery" to exercise the unassigned tray.

Run with the backend's venv (it has Pillow):
    C:/dev/T28-Team-X/backend/.venv/Scripts/python e2e/fixtures/make-y4m.py
Pure Pillow, no numpy. Y4M at 640x480 (YUV 4:2:0), 10 fps: 70 frames x 460,800 bytes = ~32 MB.
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
W, H = 640, 480
FPS = 10
HOLD_S = 3.0  # each page steady
TURN_S = 0.5  # the blurred page turn
PAPER = (251, 247, 232)  # cream
INK = (28, 36, 84)  # dark blue ballpoint
RULE = (203, 214, 236)

PAGES = [
    ["Roll 3", "3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"],
    ["Roll 7", "2/3 + 1/6", "= 4/6 + 1/6", "= 5/6"],
]
UNASSIGNED = ["Roll 42", "1/2 + 1/3", "= 3/6 + 2/6", "= 5/6"]


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    # Segoe Print looks handwritten; fall back to whatever the box has
    for name in ("segoepr.ttf", "comic.ttf", "arial.ttf", "DejaVuSans.ttf"):
        for folder in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu"):
            path = Path(folder) / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def render_page(lines: list[str]) -> Image.Image:
    """A ruled notebook page with big dark handwriting, filling the frame like a phone held over a desk."""
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    for y in range(70, H, 88):
        d.line([(0, y), (W, y)], fill=RULE, width=2)
    d.line([(56, 0), (56, H)], fill=(238, 170, 160), width=3)
    big = font(58)
    small = font(44)
    d.text((72, 8), lines[0], font=small, fill=INK)
    for i, text in enumerate(lines[1:]):
        d.text((92, 84 + i * 88), text, font=big, fill=INK)
    return img


def jitter(img: Image.Image, rng: random.Random, px: int) -> Image.Image:
    """A hand is never perfectly still: shift by up to px pixels, padding with paper colour."""
    dx, dy = rng.randint(-px, px), rng.randint(-px, px)
    out = Image.new("RGB", (W, H), PAPER)
    out.paste(img, (dx, dy))
    return out


def turn_frames(a: Image.Image, b: Image.Image, n: int, rng: random.Random) -> list[Image.Image]:
    """The page turn: a heavy blur that peaks mid-way, a crossfade, and a big wobble."""
    frames = []
    for i in range(n):
        t = (i + 1) / (n + 1)
        peak = 1 - abs(2 * t - 1)  # 0 → 1 → 0
        mixed = Image.blend(a, b, t)
        wobbly = jitter(mixed, rng, int(6 + 30 * peak))
        frames.append(wobbly.filter(ImageFilter.GaussianBlur(radius=4 + 14 * peak)))
    return frames


def to_yuv420(img: Image.Image) -> bytes:
    y, cb, cr = img.convert("YCbCr").split()
    half = (W // 2, H // 2)
    return y.tobytes() + cb.resize(half, Image.BILINEAR).tobytes() + cr.resize(half, Image.BILINEAR).tobytes()


def main() -> None:
    rng = random.Random(7)
    pages = [render_page(p) for p in PAGES]
    frames: list[Image.Image] = []
    hold, turn = int(HOLD_S * FPS), int(TURN_S * FPS)
    for i, page in enumerate(pages):
        frames += [jitter(page, rng, 1) for _ in range(hold)]
        frames += turn_frames(page, pages[(i + 1) % len(pages)], turn, rng)

    out = HERE / "pages.y4m"
    with out.open("wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n".encode())
        for frame in frames:
            f.write(b"FRAME\n")
            f.write(to_yuv420(frame))
    size_mb = out.stat().st_size / 1e6
    print(f"wrote {out.name}: {len(frames)} frames at {W}x{H}, {size_mb:.1f} MB")
    assert size_mb < 40, "the fixture must stay under 40 MB: lower W/H or HOLD_S"

    render_page(UNASSIGNED).save(HERE / "page-roll-42.png", optimize=True)
    for i, page in enumerate(pages):
        page.save(HERE / f"page-{i + 1}.png", optimize=True)
    print("wrote page-1.png, page-2.png, page-roll-42.png")


if __name__ == "__main__":
    main()
