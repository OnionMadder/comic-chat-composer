#!/usr/bin/env python3
"""
Generate crude placeholder art for a character, in the shape the importer wants.

The point is to unblock: a cast member can exist, be posed, be framed by the
camera and hold a balloon before anyone has drawn anything, and real art later
drops into the same filenames with no manifest change. The drawings are
deliberately simple — silhouette, one eye, a mouth that changes with the
emotion — because their job is to be structurally correct, not good.

Output goes straight into `import-character.py`'s input format: black ink on an
opaque white fill, transparent surround, with the magenta neck marker and cyan
face marker in place, drawn at 2x so the importer's normalisation is exercised.

Usage:
    python tools/placeholder-character.py bass  <out-dir>
    python tools/placeholder-character.py horse <out-dir>
"""

import argparse
import os

from PIL import Image, ImageDraw

INK = (0, 0, 0, 255)
FILL = (255, 255, 255, 255)
CLEAR = (255, 255, 255, 0)
MARK_ATTACH = (255, 0, 255, 255)
MARK_TAIL = (0, 255, 255, 255)

SCALE = 2                      # drawn at 2x; the importer normalises down
HEAD_W, HEAD_H = 160 * SCALE, 112 * SCALE
BODY_W, BODY_H = 150 * SCALE, 345 * SCALE
LINE = 3 * SCALE

EMOTION_CODES = ["neu", "hap", "laf", "coy", "sad", "ang", "sho"]


def canvas(w, h):
    img = Image.new("RGBA", (w, h), CLEAR)
    return img, ImageDraw.Draw(img)


def shape(draw, pts, width=LINE):
    """A filled white silhouette with a black outline — the house style."""
    draw.polygon(pts, fill=FILL)
    draw.line(list(pts) + [pts[0]], fill=INK, width=width, joint="curve")


def mark(img, xy, colour):
    img.putpixel((int(xy[0]), int(xy[1])), colour)


# ---- heads ---------------------------------------------------------------

def bass_head(code):
    """A largemouth bass, facing left: blunt snout, enormous jaw, one flat eye."""
    img, d = canvas(HEAD_W, HEAD_H)
    w, h = HEAD_W, HEAD_H
    # Head mass: broad at the gill (right), tapering to the snout (left).
    shape(d, [(w * 0.06, h * 0.44), (w * 0.20, h * 0.20), (w * 0.48, h * 0.10),
              (w * 0.80, h * 0.14), (w * 0.95, h * 0.40), (w * 0.93, h * 0.74),
              (w * 0.70, h * 0.90), (w * 0.36, h * 0.88), (w * 0.10, h * 0.68)])
    # The jaw — the defining feature. Drops open as the emotion escalates.
    gape = {"neu": 0.06, "hap": 0.12, "laf": 0.26, "coy": 0.05,
            "sad": 0.09, "ang": 0.20, "sho": 0.30}[code]
    jaw_y = h * (0.60 + gape)
    d.line([(w * 0.07, h * 0.56), (w * 0.30, h * 0.62), (w * 0.52, h * 0.60)],
           fill=INK, width=LINE)
    d.line([(w * 0.07, h * 0.56), (w * 0.26, jaw_y), (w * 0.50, h * 0.62)],
           fill=INK, width=LINE)
    # Gill plate.
    d.arc([w * 0.62, h * 0.22, w * 0.92, h * 0.82], 250, 110, fill=INK, width=LINE)
    # Eye: a fish's eye is a fixed disc, so the emotion reads from the lid.
    ex, ey, er = w * 0.42, h * 0.36, h * 0.13
    d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=FILL, outline=INK, width=LINE)
    pr = er * 0.45
    d.ellipse([ex - pr, ey - pr, ex + pr, ey + pr], fill=INK)
    if code in ("coy", "bored", "sad"):
        d.rectangle([ex - er, ey - er, ex + er, ey - er * 0.1], fill=FILL)
        d.line([(ex - er, ey - er * 0.1), (ex + er, ey - er * 0.1)], fill=INK, width=LINE)
    if code == "ang":
        d.line([(ex - er * 1.2, ey - er * 1.5), (ex + er * 1.1, ey - er * 0.5)],
               fill=INK, width=LINE + 2)
    if code == "sho":
        d.line([(ex - er * 1.2, ey - er * 0.6), (ex + er * 1.1, ey - er * 1.6)],
               fill=INK, width=LINE + 2)
    mark(img, (w * 0.72, h * 0.93), MARK_ATTACH)
    mark(img, (w * 0.40, h * 0.42), MARK_TAIL)
    return img


def horse_head(code):
    """A Clydesdale, facing left: long muzzle, heavy jaw, ears, a fall of mane."""
    img, d = canvas(HEAD_W, HEAD_H)
    w, h = HEAD_W, HEAD_H
    shape(d, [(w * 0.04, h * 0.52), (w * 0.10, h * 0.34), (w * 0.34, h * 0.26),
              (w * 0.58, h * 0.14), (w * 0.86, h * 0.16), (w * 0.96, h * 0.46),
              (w * 0.88, h * 0.80), (w * 0.56, h * 0.88), (w * 0.26, h * 0.78),
              (w * 0.06, h * 0.66)])
    # Ears — the fastest emotional read on a horse, so they move with the code.
    back = code in ("ang", "sho")
    for dx in (0.0, 0.14):
        bx = w * (0.60 + dx)
        tip = (bx + (w * 0.10 if back else w * 0.02), h * (0.24 if back else -0.02))
        shape(d, [(bx, h * 0.20), (bx + w * 0.09, h * 0.22), tip], width=LINE)
    # Mane down the back of the neck.
    for i in range(4):
        y = h * (0.22 + i * 0.16)
        d.line([(w * 0.90, y), (w * 0.99, y + h * 0.06)], fill=INK, width=LINE)
    # Muzzle: nostril and mouth.
    d.ellipse([w * 0.09, h * 0.44, w * 0.16, h * 0.53], fill=INK)
    gape = {"neu": 0.0, "hap": 0.05, "laf": 0.14, "coy": 0.0,
            "sad": 0.02, "ang": 0.08, "sho": 0.18}[code]
    d.line([(w * 0.05, h * 0.62), (w * 0.22, h * (0.64 + gape)), (w * 0.34, h * 0.62)],
           fill=INK, width=LINE)
    if code in ("laf", "sho"):
        # Teeth — a horse's laugh is all upper lip.
        d.rectangle([w * 0.09, h * 0.58, w * 0.28, h * 0.64], fill=FILL, outline=INK, width=2)
    ex, ey, er = w * 0.52, h * 0.40, h * 0.09
    d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=INK)
    if code in ("coy", "sad"):
        d.rectangle([ex - er * 1.2, ey - er * 1.2, ex + er * 1.2, ey], fill=FILL)
        d.line([(ex - er * 1.2, ey), (ex + er * 1.2, ey)], fill=INK, width=LINE)
    if code == "ang":
        d.line([(ex - er * 1.4, ey - er * 1.9), (ex + er * 1.3, ey - er * 0.7)],
               fill=INK, width=LINE + 2)
    mark(img, (w * 0.80, h * 0.92), MARK_ATTACH)
    mark(img, (w * 0.46, h * 0.44), MARK_TAIL)
    return img


# ---- bodies --------------------------------------------------------------

# Arm poses as (shoulder-relative elbow, hand) in fractions of the body box.
ARMS = {
    "neutral":     [(-0.30, 0.42, -0.34, 0.62), (0.30, 0.42, 0.34, 0.62)],
    "wave":        [(-0.30, 0.42, -0.34, 0.62), (0.38, 0.20, 0.44, 0.02)],
    "point-other": [(-0.30, 0.42, -0.34, 0.62), (0.42, 0.30, 0.62, 0.26)],
    "point-self":  [(-0.30, 0.42, -0.34, 0.62), (0.22, 0.34, 0.04, 0.30)],
    "shrug":       [(-0.40, 0.30, -0.46, 0.18), (0.40, 0.30, 0.46, 0.18)],
    "angry":       [(-0.34, 0.36, -0.20, 0.44), (0.34, 0.36, 0.20, 0.44)],
    "bored":       [(-0.28, 0.44, -0.30, 0.66), (0.28, 0.44, 0.30, 0.66)],
}


def body(key):
    """A torso in a court blazer. Deliberately generic — torsos are shared art."""
    img, d = canvas(BODY_W, BODY_H)
    w, h = BODY_W, BODY_H
    cx = w * 0.5
    slump = 0.03 if key == "bored" else 0.0

    # Torso: shoulders to hem.
    shape(d, [(cx - w * 0.30, h * (0.10 + slump)), (cx + w * 0.30, h * (0.10 + slump)),
              (cx + w * 0.34, h * 0.52), (cx + w * 0.30, h * 0.60),
              (cx - w * 0.30, h * 0.60), (cx - w * 0.34, h * 0.52)])
    # Legs.
    for s in (-1, 1):
        shape(d, [(cx + s * w * 0.06, h * 0.58), (cx + s * w * 0.28, h * 0.58),
                  (cx + s * w * 0.26, h * 0.99), (cx + s * w * 0.08, h * 0.99)])
    # Lapels, so the silhouette reads as a suit at panel scale.
    d.line([(cx, h * (0.11 + slump)), (cx, h * 0.58)], fill=INK, width=LINE)
    d.line([(cx - w * 0.16, h * (0.11 + slump)), (cx, h * 0.30)], fill=INK, width=LINE)
    d.line([(cx + w * 0.16, h * (0.11 + slump)), (cx, h * 0.30)], fill=INK, width=LINE)

    for (ex, ey, hx, hy) in ARMS.get(key, ARMS["neutral"]):
        sx = cx + (w * 0.28 if ex > 0 else -w * 0.28)
        sy = h * (0.16 + slump)
        d.line([(sx, sy), (cx + w * ex, h * ey), (cx + w * hx, h * hy)],
               fill=INK, width=LINE * 3, joint="curve")
        d.line([(sx, sy), (cx + w * ex, h * ey), (cx + w * hx, h * hy)],
               fill=FILL, width=LINE)
        d.ellipse([cx + w * hx - w * 0.05, h * hy - w * 0.05,
                   cx + w * hx + w * 0.05, h * hy + w * 0.05],
                  fill=FILL, outline=INK, width=LINE)

    mark(img, (cx, h * (0.105 + slump)), MARK_ATTACH)
    return img


BUILDERS = {"bass": bass_head, "horse": horse_head}


def main():
    ap = argparse.ArgumentParser(description="Generate placeholder character art.")
    ap.add_argument("kind", choices=sorted(BUILDERS), help="which animal")
    ap.add_argument("out", help="output directory (feed this to import-character.py)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    head = BUILDERS[args.kind]
    for code in EMOTION_CODES:
        head(code).save(os.path.join(args.out, f"head-{code}.png"))
    for key in ARMS:
        body(key).save(os.path.join(args.out, f"body-{key}-0.png"))
    print(f"{args.kind}: {len(EMOTION_CODES)} heads, {len(ARMS)} bodies -> {args.out}")


if __name__ == "__main__":
    main()
