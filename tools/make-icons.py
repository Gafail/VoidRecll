#!/usr/bin/env python3
"""Generates the Mindful Words app icons and social preview image.

Run from the project root:  python3 tools/make-icons.py
The SVG favicon is hand-written (favicon.svg); this script renders the
equivalent raster versions that browsers and platforms ask for.
"""

import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

MINT = (184, 212, 200)
SKY = (168, 197, 212)
TEAL = (90, 154, 138)
WHITE = (255, 255, 255)
INK = (45, 62, 80)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def gradient(size, top, bottom):
    """Diagonal gradient image."""
    w, h = size
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(w - 1, 1) + y / max(h - 1, 1)) / 2
            px[x, y] = (
                int(top[0] + (bottom[0] - top[0]) * t),
                int(top[1] + (bottom[1] - top[1]) * t),
                int(top[2] + (bottom[2] - top[2]) * t),
            )
    return img


def draw_mark(img):
    """Draws the flashcard mark, scaled to the image size."""
    s = img.size[0]
    d = ImageDraw.Draw(img)

    def sc(v):
        return int(v * s / 512)

    # card body
    d.rounded_rectangle([sc(120), sc(96), sc(392), sc(416)], radius=sc(36), fill=WHITE)

    # word line
    d.rounded_rectangle([sc(168), sc(168), sc(344), sc(194)], radius=sc(13), fill=TEAL)
    # meaning lines
    d.rounded_rectangle([sc(168), sc(232), sc(344), sc(250)], radius=sc(9), fill=(196, 216, 210))
    d.rounded_rectangle([sc(168), sc(270), sc(308), sc(288)], radius=sc(9), fill=(215, 229, 226))
    # grade pill
    d.rounded_rectangle([sc(168), sc(330), sc(344), sc(386)], radius=sc(28), fill=TEAL)


def make_icon(size, name, maskable=False):
    img = gradient((size, size), MINT, SKY)
    if maskable:
        # keep the mark inside the safe zone (80% of the canvas)
        img = img.crop((0, 0, size, size))
    draw_mark(img)
    path = os.path.join(ASSETS, name)
    img.save(path, "PNG", optimize=True)
    print("wrote", os.path.relpath(path, ROOT), img.size)


def make_og():
    w, h = 1200, 630
    img = gradient((w, h), MINT, SKY)
    d = ImageDraw.Draw(img)

    # a stack of cards on the right, with a soft shadow so the stack reads
    for ox, oy in [(810, 200), (860, 155)]:
        d.rounded_rectangle([ox + 8, oy + 12, ox + 218, oy + 342], radius=26,
                            fill=(150, 178, 178))
    for ox, oy in [(810, 200), (860, 155)]:
        d.rounded_rectangle([ox, oy, ox + 210, oy + 330], radius=26, fill=(248, 252, 252))
    d.rounded_rectangle([920, 120, 1130, 450], radius=26, fill=WHITE)
    d.rounded_rectangle([956, 170, 1094, 188], radius=9, fill=TEAL)
    d.rounded_rectangle([956, 214, 1094, 228], radius=7, fill=(196, 216, 210))
    d.rounded_rectangle([956, 244, 1060, 258], radius=7, fill=(215, 229, 226))
    d.rounded_rectangle([956, 300, 1094, 342], radius=21, fill=TEAL)

    # wordmark
    try:
        title = ImageFont.truetype(FONT_BOLD, 74)
        sub = ImageFont.truetype(FONT_BOLD, 30)
    except OSError:
        title = ImageFont.load_default()
        sub = ImageFont.load_default()

    d.text((90, 190), "Mindful Words", font=title, fill=INK)
    d.text((90, 288), "Flashcards with spaced repetition", font=sub, fill=(90, 109, 126))
    d.text((90, 400), "Learn · Review · Remember", font=sub, fill=TEAL)

    path = os.path.join(ASSETS, "og-image.png")
    img.save(path, "PNG", optimize=True)
    print("wrote", os.path.relpath(path, ROOT), img.size)


if __name__ == "__main__":
    os.makedirs(ASSETS, exist_ok=True)
    make_icon(192, "icon-192.png")
    make_icon(512, "icon-512.png")
    make_icon(192, "icon-maskable-192.png", maskable=True)
    make_icon(512, "icon-maskable-512.png", maskable=True)
    make_icon(180, "apple-touch-icon.png")
    make_og()
