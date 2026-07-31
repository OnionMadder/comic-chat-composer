#!/usr/bin/env python3
"""
Trace a character's raster sprites into vector ones, in place.

The problem this solves: a sprite is only ever as sharp as its pixels, and the
§6.2 camera closes in. Comic Chat never looked soft because its ~345px sprites
were always being *downscaled* into ~200px panels — it never upscaled. Art that
starts smaller than its largest close-up has no such luxury, and when no
higher-resolution original exists, the way out is to stop being raster at all.

Line art of this kind — a dark outline, a flat fill, thin interior detail — is
the case tracing handles best. A traced sprite is crisp at any zoom, usually
*smaller* than the PNG it replaces, and needs no change anywhere else: the
manifest's `src` is opaque to the composer, `load-assets.ts` already inlines
`.svg` sprites, and the trace keeps the original's pixel coordinate system, so
every `tailAnchor`, `headAttach` and `bounds` in the manifest stays valid.

Two layers per sprite, drawn in order:

  1. the **fill** — the opaque silhouette, flooded with the art's paper colour,
     so a busy backdrop cannot show through the character;
  2. the **ink** — everything dark enough to be linework, including the interior
     folds and the holes inside closed shapes.

Contours come from OpenCV and are simplified with Douglas-Peucker at sub-pixel
tolerance. An earlier version smoothed the result through Catmull-Rom into cubic
Béziers, on the theory that a polygon which looks fine at 1x would show facets
at 3x. Measured against the source masks, that was simply wrong: smoothing cost
fidelity at every tolerance (ink IoU 0.965 -> 0.929), because the spline
overshoots on an unevenly-spaced polygon and thin 2px fold lines shred into
spikes. At a fine enough tolerance the polygon *is* the curve, so the tracer
emits polylines and the smoothing is gone.

Usage:
    python tools/vectorize-character.py assets/mcomic-court/characters/bumpkin
    python tools/vectorize-character.py assets/mcomic-court/characters/*  --keep-png
"""

import argparse
import glob
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

# Douglas-Peucker tolerance, in source pixels. Swept against the mComic Court
# art, measuring the traced result back against the source masks: 0.2 and 0.4
# are within 0.001 IoU of each other (0.965 / 0.964) while 0.4 carries ~10%
# fewer points, and fidelity falls off a cliff past 0.6 (0.928) as the thin
# interior fold lines start collapsing. Deviation of 0.4px is a third of a pixel
# at the 3x close-up this exists to serve — invisible.
EPSILON = 0.4

# Contours smaller than this (in px^2) are export speckle, not art — the source
# sprites carry ~190 such fragments each, left over from antialiasing.
MIN_AREA = 9.0

def masks(path):
    """Silhouette and ink masks, plus the art's own ink and paper colours."""
    rgba = np.array(Image.open(path).convert("RGBA"))
    alpha = rgba[:, :, 3]
    solid = (alpha >= 128).astype(np.uint8)
    if not solid.any():
        return None

    # int32, not uint16: 255 * 587 is 149685, which wraps in 16 bits and makes
    # white compute as luma 58. Every threshold downstream then reads the paper
    # as ink.
    luma = (
        rgba[:, :, 0].astype(np.int32) * 299
        + rgba[:, :, 1].astype(np.int32) * 587
        + rgba[:, :, 2].astype(np.int32) * 114
    ) // 1000

    # Split ink from paper by Otsu, computed over the opaque pixels only — the
    # transparent surround would otherwise drag the threshold around.
    inside = luma[solid > 0].astype(np.uint8)
    level, _ = cv2.threshold(inside, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ink = ((luma < level) & (solid > 0)).astype(np.uint8)

    # Take the art's real colours rather than assuming black on white, so a
    # green-black outline stays green-black.
    def median_colour(mask):
        px = rgba[:, :, :3][mask > 0]
        return tuple(int(v) for v in np.median(px, axis=0)) if len(px) else (0, 0, 0)

    paper_mask = ((solid > 0) & (ink == 0)).astype(np.uint8)
    return {
        "solid": solid,
        "ink": ink,
        "ink_colour": median_colour(ink),
        "paper_colour": median_colour(paper_mask) if paper_mask.any() else (255, 255, 255),
        "size": (rgba.shape[1], rgba.shape[0]),
    }


def polyline(points):
    """
    A closed polygon through `points`, as an SVG path `d`.

    Straight segments, deliberately: see the note on smoothing at the top.
    """
    if len(points) < 3:
        return ""
    head = f"M{points[0][0]:.1f} {points[0][1]:.1f}"
    rest = "".join(f"L{x:.1f} {y:.1f}" for x, y in points[1:])
    return f"{head}{rest}Z"


def trace(mask):
    """
    Trace a binary mask into one SVG path `d`, holes included.

    RETR_CCOMP gives a two-level hierarchy — outers and the holes directly
    inside them — and both go into the same path, which the even-odd fill rule
    then punches through correctly.
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    parts = []
    for contour in contours:
        if cv2.contourArea(contour) < MIN_AREA:
            continue
        simplified = cv2.approxPolyDP(contour, EPSILON, True)
        points = [(float(p[0][0]), float(p[0][1])) for p in simplified]
        if len(points) < 3:
            continue
        parts.append(polyline(points))
    return "".join(parts)


def hex_of(rgb):
    return "#%02x%02x%02x" % rgb


def vectorize(path):
    """Trace one PNG; returns SVG markup, or None if the sprite is empty."""
    m = masks(path)
    if m is None:
        return None
    w, h = m["size"]
    fill = trace(m["solid"])
    ink = trace(m["ink"])
    if not fill and not ink:
        return None

    # `shape-rendering:geometricPrecision` keeps the browser from snapping the
    # outline to the pixel grid, which is what would reintroduce the jaggies.
    body = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" shape-rendering="geometricPrecision">'
    ]
    if fill:
        body.append(f'<path d="{fill}" fill="{hex_of(m["paper_colour"])}" fill-rule="evenodd"/>')
    if ink:
        body.append(f'<path d="{ink}" fill="{hex_of(m["ink_colour"])}" fill-rule="evenodd"/>')
    body.append("</svg>")
    return "".join(body)


def convert(char_dir, keep_png):
    manifest_path = os.path.join(char_dir, "character.json")
    if not os.path.exists(manifest_path):
        print(f"{char_dir}: no character.json — skipped", file=sys.stderr)
        return False

    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    renamed, before, after = {}, 0, 0
    for png in sorted(glob.glob(os.path.join(char_dir, "*.png"))):
        svg = vectorize(png)
        if svg is None:
            print(f"  {os.path.basename(png)}: empty — skipped", file=sys.stderr)
            continue
        out = png[:-4] + ".svg"
        with open(out, "w", encoding="utf-8") as f:
            f.write(svg)
        before += os.path.getsize(png)
        after += os.path.getsize(out)
        renamed[os.path.basename(png)] = os.path.basename(out)
        if not keep_png:
            os.remove(png)

    if not renamed:
        return False

    # Point every `src` at its traced twin. Anchors and bounds are untouched:
    # the trace preserves the source's pixel coordinates exactly.
    def repoint(node):
        if isinstance(node, dict):
            if isinstance(node.get("src"), str) and node["src"] in renamed:
                node["src"] = renamed[node["src"]]
            for v in node.values():
                repoint(v)
        elif isinstance(node, list):
            for v in node:
                repoint(v)

    repoint(manifest)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    delta = (after - before) / before * 100 if before else 0
    print(
        f"{os.path.basename(char_dir)}: {len(renamed)} sprites traced, "
        f"{before // 1024}KB -> {after // 1024}KB ({delta:+.0f}%)"
    )
    return True


def main():
    ap = argparse.ArgumentParser(description="Trace a character's sprites to SVG, in place.")
    ap.add_argument("dirs", nargs="+", help="character directories (each with a character.json)")
    ap.add_argument("--keep-png", action="store_true", help="leave the source PNGs in place")
    args = ap.parse_args()

    ok = sum(convert(d, args.keep_png) for d in args.dirs)
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
