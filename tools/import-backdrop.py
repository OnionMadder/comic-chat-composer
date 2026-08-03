#!/usr/bin/env python3
"""
Import hand-drawn backdrop art into a backdrop set.

`import-bgb.py` decodes Microsoft's `.bgb` backdrops; this is the intake for
art nobody has encoded yet — the same role `import-character.py` plays for the
cast.

Backdrops are cheap to get wrong in one specific way: `load-assets.ts` inlines
each one as a base64 data URI **into every panel that uses it**, so a 1.5MB PNG
becomes 1.5MB of payload per panel. The original decoded backdrops are 350px
and 25-60KB apiece, which is the bar to keep in view.

Two things decide the target size:

  * the camera. A backdrop is drawn *through* the §6.2 camera transform, so it
    magnifies with the scene. At `maxZoom` 2.2 a 400px panel can ask for 880px
    of backdrop, and anything beyond that is pixels nobody will ever see;
  * the art. This idiom is dense black-and-white linework, so the alpha channel
    is dead weight and the colour channels are usually three copies of the same
    grey. Both are dropped when the image turns out not to need them.

Usage:
    python tools/import-backdrop.py <src.png|src-dir> assets/comic-court/backdrops
    python tools/import-backdrop.py art/ out/ --size 1200      # bigger panels
"""

import argparse
import os
import sys

import numpy as np
from PIL import Image

# `maxZoom` (2.2) x a 400px panel = 880px. 900 covers the tightest close-up the
# camera can ask for, with nothing spare.
DEFAULT_SIZE = 900

# Per-channel spread below which an image is really greyscale wearing three
# channels. Measured at the 99.9th percentile rather than the maximum: the
# Comic Court backdrops sit at a spread of 3-4 across virtually every pixel but
# carry a scattering of stray coloured ones that drag the maximum to 14, and
# judging by the outlier would have kept three channels for no reason.
GREY_TOLERANCE = 10

# A backdrop fills its panel, so it has no business being transparent. Art
# exported from a canvas often carries one soft edge row or column — the source
# backdrops each have exactly 1081 such pixels, one column of a 1081px image —
# and that is not a reason to keep an alpha channel.
TRANSPARENT_FRACTION = 0.005


def is_greyscale(rgb):
    """Whether the colour channels carry anything the grey channel would not."""
    a = rgb.astype(np.int16)
    spread = np.abs(a - a.mean(axis=2, keepdims=True))
    return float(np.percentile(spread, 99.9)) <= GREY_TOLERANCE


def has_transparency(rgba):
    """Whether enough of the image is see-through for the alpha to be meant."""
    if rgba.shape[2] != 4:
        return False
    return float((rgba[:, :, 3] < 250).mean()) > TRANSPARENT_FRACTION


def convert(src, out_dir, size, force_colour, crop_top=0.0):
    img = Image.open(src)

    # Trimming the top magnifies what is left, because the renderer scales the
    # backdrop to cover the panel and bottom-aligns it (`xMidYMax slice`).
    # Cropping the *top* specifically is what preserves the floor at the bottom
    # — the surface the cast stands on — while giving it a larger share of the
    # frame. A plate whose floor is only a narrow strip needs a few percent.
    if crop_top > 0:
        w, h = img.size
        img = img.crop((0, round(h * crop_top), w, h))

    arr = np.array(img.convert("RGBA"))
    keep_alpha = has_transparency(arr)
    grey = not force_colour and is_greyscale(arr[:, :, :3])

    w, h = img.size
    scale = min(1.0, size / max(w, h))
    if scale < 1.0:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    if keep_alpha:
        img = img.convert("LA" if grey else "RGBA")
    else:
        img = img.convert("L" if grey else "RGB")

    os.makedirs(out_dir, exist_ok=True)
    name = os.path.splitext(os.path.basename(src))[0] + ".png"
    dest = os.path.join(out_dir, name)
    img.save(dest, "PNG", optimize=True)

    before = os.path.getsize(src)
    after = os.path.getsize(dest)
    notes = []
    if crop_top > 0:
        notes.append(f"top {crop_top * 100:.0f}% cropped")
    if scale < 1.0:
        notes.append(f"{w}x{h} -> {img.size[0]}x{img.size[1]}")
    if grey:
        notes.append("greyscale")
    if not keep_alpha:
        notes.append("opaque")
    print(
        f"  {name:16} {before // 1024:5}KB -> {after // 1024:4}KB "
        f"({(after - before) / before * 100:+.0f}%)"
        + (f"  [{', '.join(notes)}]" if notes else "")
    )
    return before, after


def main():
    ap = argparse.ArgumentParser(description="Import backdrop art into a backdrop set.")
    ap.add_argument("src", help="a PNG, or a directory of them")
    ap.add_argument("out", help="output backdrop directory")
    ap.add_argument("--size", type=int, default=DEFAULT_SIZE,
                    help=f"longest edge, in pixels (default {DEFAULT_SIZE})")
    ap.add_argument("--colour", action="store_true",
                    help="keep the colour channels even if the art looks grey")
    ap.add_argument("--crop-top", type=float, default=0.0, metavar="PERCENT",
                    help="trim this %% off the top, magnifying the rest and giving "
                         "the floor a larger share of the frame")
    args = ap.parse_args()

    if os.path.isdir(args.src):
        sources = sorted(
            os.path.join(args.src, f)
            for f in os.listdir(args.src)
            if f.lower().endswith((".png", ".jpg", ".jpeg"))
        )
    else:
        sources = [args.src]
    if not sources:
        print(f"no images found in {args.src}", file=sys.stderr)
        sys.exit(1)

    print(f"{len(sources)} backdrop(s) -> {args.out}")
    crop = max(0.0, min(50.0, args.crop_top)) / 100.0
    totals = [convert(s, args.out, args.size, args.colour, crop) for s in sources]
    before = sum(b for b, _ in totals)
    after = sum(a for _, a in totals)
    print(f"  total {before // 1024}KB -> {after // 1024}KB "
          f"({(after - before) / before * 100:+.0f}%)")


if __name__ == "__main__":
    main()
