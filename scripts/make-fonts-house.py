#!/usr/bin/env python3
"""Builds the two house faces from locally licensed sources.

Delight and Basis Grotesque Mono Pro are commercial fonts. They are NOT in
this repository and must never be committed to it: the licences cover using
them, not redistributing them, and this repo is public. Both output files are
listed in .gitignore.

    python3 scripts/make-fonts-house.py

Everything still works without them. styles.css lists Inter Tight and
JetBrains Mono after the house faces, and both of those are SIL Open Font
License 1.1 and committed. If the house woff2 files are absent the @font-face
rules simply fail and the stack falls through to the open ones, so a fresh
clone renders correctly and only this machine's deploy carries the real type.

Because the house files are not in git, a Netlify build triggered by a GitHub
push will not contain them. Deploy from this machine instead:

    netlify deploy --prod

Sources are read from ~/Library/Fonts by default. Pass a directory to override:

    python3 scripts/make-fonts-house.py /path/to/fonts
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "fonts"
DEFAULT_SOURCE = Path.home() / "Library" / "Fonts"

SOURCES = [
    {
        "name": "Delight",
        "file": "Delight-VF.ttf",
        "out": "delight-regular.woff2",
        # Variable, wght 100-900. Pinned to 400 because hierarchy in this app
        # comes from size and never from weight.
        "instance": "wght=400",
    },
    {
        "name": "Basis Grotesque Mono Pro",
        "file": "BasisGrotesqueMonoPro-Regular.ttf",
        "out": "basismono-regular.woff2",
        "instance": None,
    },
]

# Latin, plus the exact non-ASCII characters the interface uses: degree,
# middle dot, em dash, curly apostrophe, ellipsis, right arrow, minus sign.
# Delight has no glyph for the right arrow (U+2192); the one place that draws
# one falls through to the system font for that single character, which is
# invisible in practice.
UNICODES = "U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+2190-2193,U+2212,U+2215"


def build(source: dict, src_dir: Path, work: Path) -> bool:
    raw = src_dir / source["file"]
    if not raw.exists():
        print(f"  {source['out']:<28} missing    {raw}")
        return False

    to_subset = raw
    if source["instance"]:
        to_subset = work / (source["out"] + ".static.ttf")
        subprocess.run(
            [sys.executable, "-m", "fontTools.varLib.instancer",
             str(raw), source["instance"], "-o", str(to_subset)],
            check=True, capture_output=True,
        )

    subprocess.run(
        [sys.executable, "-m", "fontTools.subset", str(to_subset),
         f"--unicodes={UNICODES}",
         "--layout-features=kern,liga,calt,tnum",
         "--flavor=woff2",
         "--desubroutinize",
         f"--output-file={FONTS / source['out']}"],
        check=True, capture_output=True,
    )

    size = (FONTS / source["out"]).stat().st_size
    print(f"  {source['out']:<28} {size / 1024:6.1f} KB  {source['name']}")
    return True


def main() -> None:
    src_dir = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else DEFAULT_SOURCE
    FONTS.mkdir(exist_ok=True)
    work = FONTS / ".build"
    work.mkdir(exist_ok=True)
    print(f"Building house fonts from {src_dir}:")
    built = 0
    try:
        for source in SOURCES:
            if build(source, src_dir, work):
                built += 1
    finally:
        for leftover in work.glob("*"):
            leftover.unlink()
        work.rmdir()

    if built == len(SOURCES):
        print("Done. Licensed files, gitignored. Deploy with `netlify deploy --prod`.")
    else:
        print("Some sources were missing. The app falls back to Inter Tight "
              "and JetBrains Mono wherever a house face is absent.")


if __name__ == "__main__":
    main()
