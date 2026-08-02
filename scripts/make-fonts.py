#!/usr/bin/env python3
"""Regenerates everything in fonts/ from the upstream Google Fonts sources.

Both families are SIL Open Font License 1.1, so the built files can ship in
this repo. Run this instead of hand-dropping a font file in, or the next
person has no way to reproduce what is being served.

    pip install "fonttools[woff]" brotli
    python3 scripts/make-fonts.py

The upstream files are variable fonts covering hundreds of glyphs. Serving
those whole would cost about 770 KB on a phone, so each one is pinned to
weight 400 and cut down to the characters this app actually draws.
"""

import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "fonts"

# Raw sources. github.com/google/fonts is the canonical distribution for both.
SOURCES = [
    {
        "name": "Inter Tight",
        "out": "intertight-regular.woff2",
        "ttf": "https://github.com/google/fonts/raw/main/ofl/intertight/InterTight%5Bwght%5D.ttf",
        "ofl": "https://github.com/google/fonts/raw/main/ofl/intertight/OFL.txt",
        "ofl_out": "OFL-InterTight.txt",
    },
    {
        "name": "JetBrains Mono",
        "out": "jetbrainsmono-regular.woff2",
        "ttf": "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
        "ofl": "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/OFL.txt",
        "ofl_out": "OFL-JetBrainsMono.txt",
    },
]

# Latin, plus the exact non-ASCII characters the interface uses: degree,
# middle dot, em dash, curly apostrophe, ellipsis, right arrow, minus sign.
# Widen this if you add a character and it renders in the fallback font.
UNICODES = "U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+2190-2193,U+2212,U+2215"


def fetch(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "recoil-make-fonts"})
    with urllib.request.urlopen(req, timeout=120) as response:
        dest.write_bytes(response.read())


def build(source: dict, work: Path) -> None:
    raw = work / (source["out"] + ".ttf")
    fetch(source["ttf"], raw)

    # Pin the variable axis to 400. Everything in this app is one weight;
    # hierarchy comes from size.
    static = work / (source["out"] + ".static.ttf")
    subprocess.run(
        [sys.executable, "-m", "fontTools.varLib.instancer",
         str(raw), "wght=400", "-o", str(static)],
        check=True, capture_output=True,
    )

    subprocess.run(
        [sys.executable, "-m", "fontTools.subset", str(static),
         f"--unicodes={UNICODES}",
         "--layout-features=kern,liga,calt,tnum",
         "--flavor=woff2",
         "--desubroutinize",
         f"--output-file={FONTS / source['out']}"],
        check=True, capture_output=True,
    )

    fetch(source["ofl"], FONTS / source["ofl_out"])

    size = (FONTS / source["out"]).stat().st_size
    print(f"  {source['out']:<32} {size / 1024:6.1f} KB   {source['name']}")


def main() -> None:
    FONTS.mkdir(exist_ok=True)
    work = FONTS / ".build"
    work.mkdir(exist_ok=True)
    print("Building fonts:")
    try:
        for source in SOURCES:
            build(source, work)
    finally:
        for leftover in work.glob("*"):
            leftover.unlink()
        work.rmdir()
    print("Done. Both families are SIL Open Font License 1.1.")


if __name__ == "__main__":
    main()
