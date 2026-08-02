#!/usr/bin/env python3
"""Generate Recoil's icon set and share image from the brand mark.

Source of truth is brand/mark.svg — one path, one fill. This
script recolours it to the app's brand green and rasterises it at every size the
web and iOS ask for. Rerun it whenever the mark or the colour changes:

    python3 scripts/make-icons.py

Rasterising is done by flattening the path's cubic beziers and filling the
polygon at 8x, then downsampling. That avoids a native SVG library while giving
exact geometry and clean alpha.
"""
import io
import os
import re
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_SVG = os.path.join(ROOT, "brand", "mark.svg")
ICONS = os.path.join(ROOT, "icons")
FONTS = os.path.join(ROOT, "fonts")

BRAND = (198, 242, 78, 255)   # #c6f24e — the one green, everywhere
BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)
BRAND_HEX = "#c6f24e"
SS = 8            # supersample factor
BEZIER_STEPS = 24  # segments per curve; the mark is ~1000 units tall


def load_font(filename, size):
    """The share image is set in the same two faces the app uses.

    Those ship as woff2, which Pillow cannot open, so unpack to TrueType in
    memory rather than keeping a second copy of each font in the repo.
    """
    from fontTools.ttLib import TTFont

    ttf = io.BytesIO()
    TTFont(os.path.join(FONTS, filename), fontNumber=0).save(ttf)
    ttf.seek(0)
    return ImageFont.truetype(ttf, size)


def parse_path(d):
    """Flatten an M/C/c/Z path into a list of polygons. No other commands."""
    tokens = re.findall(r"[MCcZz]|-?\d*\.?\d+(?:e-?\d+)?", d)
    polys, pts = [], []
    i, cur, start, cmd = 0, (0.0, 0.0), (0.0, 0.0), None

    def num():
        nonlocal i
        v = float(tokens[i]); i += 1
        return v

    while i < len(tokens):
        t = tokens[i]
        if t in "MCcZz":
            cmd = t; i += 1
            if cmd in "Zz":
                if pts:
                    polys.append(pts); pts = []
                cur = start
                continue
        if cmd == "M":
            cur = (num(), num()); start = cur
            if pts:
                polys.append(pts)
            pts = [cur]
            cmd = "L"  # implicit lineto for repeated pairs
        elif cmd == "L":
            cur = (num(), num()); pts.append(cur)
        elif cmd in "Cc":
            rel = cmd == "c"
            x1, y1, x2, y2, x, y = (num() for _ in range(6))
            if rel:
                x1 += cur[0]; y1 += cur[1]
                x2 += cur[0]; y2 += cur[1]
                x += cur[0]; y += cur[1]
            p0 = cur
            for s in range(1, BEZIER_STEPS + 1):
                u = s / BEZIER_STEPS
                m = 1 - u
                pts.append((
                    m**3 * p0[0] + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u**3 * x,
                    m**3 * p0[1] + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u**3 * y,
                ))
            cur = (x, y)
        else:
            raise ValueError(f"unsupported path command: {t}")
    if pts:
        polys.append(pts)
    return polys


def load_mark():
    svg = open(SRC_SVG).read()
    d = re.search(r"<path[^>]*\sd=\"([^\"]+)\"", svg).group(1)
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
    return parse_path(d), vb


POLYS, VIEWBOX = load_mark()


def centroid(polys):
    """Area centre of mass, via the shoelace formula.

    The mark is a figure on a diagonal: its weight sits low and left while one
    arm reaches high and right, so the two candidate centres disagree. Centring
    the box alone ignores where the mark's mass actually is; centring the mass
    alone pushed the figure 32px low and 34px left on the 512 icon, which read
    as a mistake rather than as an optical correction. BIAS blends the two.
    """
    A = cx = cy = 0.0
    for poly in polys:
        n = len(poly)
        for i in range(n):
            x0, y0 = poly[i]
            x1, y1 = poly[(i + 1) % n]
            cross = x0 * y1 - x1 * y0
            A += cross
            cx += (x0 + x1) * cross
            cy += (y0 + y1) * cross
    A *= 0.5
    return cx / (6 * A), cy / (6 * A)


# 0 sits the mark on its centre of mass, 1 on its bounding box. 0.8 leaves a
# slight downward bias, which keeps some of the mass correction while reading
# as centred: 54px above against 48px below on the 512 icon.
BIAS = 0.8

# The mark's share of the tile, and a shift as a fraction of the canvas, with
# negative being left and up. Both set by eye against every size at once, not
# solved for: the horizontal is deliberately off centre, because the figure
# reaches up and to the right and sitting it dead centre leaves the left
# looking heavier than it is.
FILL = 0.755
NUDGE = (-0.016, -0.004)

_CX_MASS, _CY_MASS = centroid(POLYS)
_XS = [x for poly in POLYS for x, _ in poly]
_YS = [y for poly in POLYS for _, y in poly]
_CX_BOX = (min(_XS) + max(_XS)) / 2
_CY_BOX = (min(_YS) + max(_YS)) / 2

CX = _CX_MASS + (_CX_BOX - _CX_MASS) * BIAS
CY = _CY_MASS + (_CY_BOX - _CY_MASS) * BIAS

# Half-extents measured from that centre, so the mark still fits the canvas
# once it has been shifted.
_REACH = max(
    max(abs(x - CX) for x in _XS),
    max(abs(y - CY) for y in _YS),
)


def draw_mark(size, bg=(0, 0, 0, 0), fg=BRAND, fill=FILL, radius=None, nudge=NUDGE):
    """Render the mark. `fill` is its share of the canvas, `nudge` shifts it."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg[3]:
        if radius:
            d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius * S, fill=bg)
        else:
            d.rectangle([0, 0, S, S], fill=bg)

    scale = (S * fill / 2) / _REACH
    ox, oy = nudge
    for poly in POLYS:
        d.polygon(
            [(S / 2 + ox * S + (x - CX) * scale, S / 2 + oy * S + (y - CY) * scale) for x, y in poly],
            fill=fg)
    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = os.path.join(ICONS, name)
    img.save(path, "PNG", optimize=True)
    print(f"  {name:26s} {img.size[0]}x{img.size[1]}  {os.path.getsize(path):,}B")


def main():
    os.makedirs(ICONS, exist_ok=True)
    print("icons/")
    # Green mark on a black tile: reads on any home screen, light or dark.
    save(draw_mark(32, bg=BLACK), "favicon-32.png")
    save(draw_mark(512, bg=BLACK), "favicon.png")
    save(draw_mark(180, bg=BLACK), "apple-touch-icon.png")
    save(draw_mark(192, bg=BLACK), "icon-192.png")
    save(draw_mark(512, bg=BLACK), "icon-512.png")
    # Maskable: platforms crop to a circle, so keep the mark well inside it.
    save(draw_mark(512, bg=BLACK, fill=0.62), "icon-512-maskable.png")

    # Share card.
    W, H, K = 1200, 630, 2
    og = Image.new("RGBA", (W * K, H * K), BLACK)
    d = ImageDraw.Draw(og)
    sans = load_font("intertight-regular.woff2", 128 * K)
    mono = load_font("jetbrainsmono-regular.woff2", 25 * K)

    # No nudge here. NUDGE positions the mark inside a tile; this mark floats on
    # a wide canvas and is placed by the composite offset below instead. It also
    # fills its own box exactly, so any shift would crop a limb off.
    mark = draw_mark(330 * K, fill=1.0, nudge=(0, 0))
    og.alpha_composite(mark, (int(760 * K), int(150 * K)))

    wb = d.textbbox((0, 0), "Recoil", font=sans)
    d.text((92 * K - wb[0], 300 * K - wb[1]), "Recoil", font=sans, fill=WHITE)
    bottom = 300 * K + (wb[3] - wb[1])
    d.line([(94 * K, bottom + 44 * K), (680 * K, bottom + 44 * K)], fill=(255, 255, 255, 40), width=2)
    tag = "YOUR WHOOP HISTORY, READ PROPERLY"
    tb = d.textbbox((0, 0), tag, font=mono)
    d.text((94 * K - tb[0], bottom + 74 * K - tb[1]), tag, font=mono, fill=BRAND)
    og.resize((W, H), Image.LANCZOS).convert("RGB").save(os.path.join(ICONS, "og-image.png"), "PNG", optimize=True)
    print(f"  {'og-image.png':26s} {W}x{H}  {os.path.getsize(os.path.join(ICONS, 'og-image.png')):,}B")

    # Favicon SVG: the original geometry, recoloured, transparent.
    #
    # Deliberately no prefers-color-scheme rule. An SVG loaded through <img>
    # evaluates that query against an isolated context, not the page, and
    # resolves it as light — so a dark-mode override renders the wrong colour
    # everywhere, including inside a dark app. One green, no conditions.
    svg = open(SRC_SVG).read()
    svg = re.sub(r"fill:\s*#[0-9a-fA-F]+", f"fill: {BRAND_HEX}", svg)
    # Square viewBox carrying the same FILL and NUDGE as the PNGs, so the mark
    # sits identically whichever file a browser picks for the same slot. Solving
    # the PNG mapping for the box gives width = 2 * reach / fill, and an origin
    # pulled back by half of that plus the nudge.
    _vw = 2 * _REACH / FILL
    _vx = CX - _vw / 2 - NUDGE[0] * _vw
    _vy = CY - _vw / 2 - NUDGE[1] * _vw
    svg = re.sub(
        r'viewBox="[^"]+"',
        f'viewBox="{_vx:.2f} {_vy:.2f} {_vw:.2f} {_vw:.2f}"',
        svg, count=1)
    open(os.path.join(ICONS, "favicon.svg"), "w").write(svg)
    print(f"  {'favicon.svg':26s} {os.path.getsize(os.path.join(ICONS, 'favicon.svg')):,}B")


if __name__ == "__main__":
    if not os.path.exists(SRC_SVG):
        sys.exit(f"missing {SRC_SVG}")
    main()
