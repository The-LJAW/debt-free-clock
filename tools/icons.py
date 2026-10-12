"""Draw the Debt-Free Clock app icons: a ring of LEDs on the dark dot-matrix board,
three quarters lit green (paid) and one quarter red (still owed). Writes icons/*.png.
Run from the repo root: python3 tools/icons.py   (needs Pillow)"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

BOARD = (12, 17, 14); GREEN = (95, 224, 148); RED = (255, 91, 77)
DOTS, PAID = 28, 0.75
root = Path(__file__).resolve().parent.parent

def ring_points(cx, cy, radius, n=DOTS, paid=PAID):
    """Clockwise from 12 o'clock; the last quarter (ending back at the top) is red."""
    for i in range(n):
        a = -math.pi / 2 + i * 2 * math.pi / n
        yield cx + radius * math.cos(a), cy + radius * math.sin(a), (GREEN if i < n * paid else RED)

def icon(size, ring=0.32):
    S = size * 4                                   # draw large, scale down for smooth dots
    cell = S / 15
    im = Image.new('RGB', (S, S), BOARD)
    d = ImageDraw.Draw(im, 'RGBA')
    for r in range(15):
        for c in range(15):
            cx, cy, R = (c + .5) * cell, (r + .5) * cell, cell * .16
            d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(243, 241, 231, 26))
    pts = list(ring_points(S / 2, S / 2, S * ring))
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    for x, y, col in pts:
        R = cell * .55; gd.ellipse([x - R, y - R, x + R, y + R], fill=col + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(cell * .45))
    im.paste(glow, (0, 0), glow)
    d = ImageDraw.Draw(im, 'RGBA')
    for x, y, col in pts:
        R = cell * .36; d.ellipse([x - R, y - R, x + R, y + R], fill=col)
    return im.resize((size, size), Image.LANCZOS)

if __name__ == '__main__':
    out = root / 'icons'; out.mkdir(exist_ok=True)
    icon(192).save(out / 'icon-192.png', optimize=True)
    icon(512).save(out / 'icon-512.png', optimize=True)
    icon(512, ring=0.27).save(out / 'icon-maskable-512.png', optimize=True)   # stays inside any mask shape
    icon(180).save(out / 'apple-touch-icon.png', optimize=True)
    print('wrote', ', '.join(p.name for p in sorted(out.glob('*.png'))))
