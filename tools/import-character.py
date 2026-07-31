#!/usr/bin/env python3
"""
Import hand-drawn character art into a Comic Chat character manifest.

`import-avb.py` decodes Microsoft's binary avatars, which carry explicit
crosshairs for every registration point. Hand-drawn art has none, so this tool
gets them one of two ways:

  * **Marker pixels** (preferred). The artist places a single pixel of a
    reserved colour on the sprite, and the importer reads it and paints it out:

        magenta #FF00FF  the neck join — a head's `attach`, a body's `headAttach`
        cyan    #00FFFF  the face centre — a head's `tailAnchor` (§5.4)

  * **Derivation** (fallback, when a marker is absent). The neck is taken from
    the horizontal centroid of the opaque pixels in a band near the torso's top
    — a centroid rather than the bounding box's centre, because an outstretched
    arm skews the box badly (Anna's `point-other` torso sits at 0.29 of its
    width, not 0.5). A head's join is bottom-centre, its face centre a little
    above and right of the middle.

Everything else is mechanical: art is quantised to the three values the art set
actually uses (black ink, opaque white fill, transparent surround), scaled so
the cast shares one figure height, trimmed to its ink, and measured.

Input is a directory of PNGs named the way the decoded assets are:

    head-{neu,hap,laf,coy,sad,ang,sho}.png     all seven required
    body-<key>-<n>.png                          `neutral` required; see BODY_KEYS

Usage:
    python tools/import-character.py <src-dir> <out-dir> --id bass --name "Larmouth Bass"
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

# Head sprite keys, mirroring EMOTION_CODES in src/manifest.ts.
EMOTION_CODES = ["neu", "hap", "laf", "coy", "sad", "ang", "sho"]

# Body sprite keys, mirroring BODY_KEYS in src/manifest.ts.
BODY_KEYS = [
    "neutral", "wave", "point-self", "point-other", "smile", "shrug",
    "happy", "sad", "angry", "laughing", "shouting", "coy", "scared", "bored",
]

# A whole-figure pose may be keyed by any gesture or expression — the same set
# a body may be keyed by, which already includes `neutral`.
FIGURE_KEYS = BODY_KEYS

# Names an artist reaches for that are not schema keys. `defeated` is the one
# the mComic Court cast uses: a slumped, narrowed stance, which is what `sad`
# means for a figure with no face to be sad with.
POSE_ALIASES = {
    "defeated": "sad",
    # `worried` and `cheerful` are how the mComic Court art names the anxious
    # and the falsely-pleasant stances; the schema calls them `scared` and
    # `happy`.
    "worried": "scared",
    "worry": "scared",
    "cheerful": "happy",
    "pleased": "happy",
    "beaten": "sad",
    "slumped": "sad",
    "mad": "angry",
    "point": "point-other",
    "pointing": "point-other",
    "waving": "wave",
    "idle": "neutral",
    "stand": "neutral",
}

# The decoded v1.0 art stands ~345px tall. A character is *not* normalised to
# it: the renderer scales every figure to the panel's `characterHeightFraction`
# (see `render-svg.ts`, `scale = characterHeight / bounds.height`), so sprite
# pixels buy **resolution and nothing else** — on-screen size is identical
# either way. Upscaling to a target therefore costs sharpness for no gain, and
# costs it twice over on a close-up, where the camera scales the sprite again.
#
# So art is left at its native resolution, and only reduced when it is large
# enough to bloat a bundle. A sprite wants to be at least as tall as the largest
# close-up it will appear in — for a 400px panel whose camera reaches ~1.7x,
# that is roughly 700px.
MAX_FIGURE_HEIGHT = 1400

MARKER_ATTACH = (255, 0, 255)   # magenta — neck join
MARKER_TAIL = (0, 255, 255)     # cyan — face centre

INK = (0, 0, 0, 255)
FILL = (255, 255, 255, 255)
CLEAR = (255, 255, 255, 0)


def find_markers(rgba):
    """
    Locate and erase the reserved marker pixels.

    Returns `(points, cleaned)` where `points` maps 'attach'/'tail' to (x, y)
    for whichever markers were present. Marked pixels are repainted to the
    local majority value so they leave no speck in the art.
    """
    a = np.array(rgba)
    points = {}
    for name, colour in (("attach", MARKER_ATTACH), ("tail", MARKER_TAIL)):
        # A marker must be *deliberate*: opaque, few, and clustered. Exported art
        # carries near-invisible alpha=1 stragglers from antialiasing, and some
        # of them land on exactly these RGB values — scattered right across the
        # image, so averaging them would put the anchor nowhere in particular.
        hit = (
            (a[:, :, 0] == colour[0])
            & (a[:, :, 1] == colour[1])
            & (a[:, :, 2] == colour[2])
            & (a[:, :, 3] >= 128)
        )
        ys, xs = np.nonzero(hit)
        if len(xs) == 0:
            continue
        spread = max(xs.max() - xs.min(), ys.max() - ys.min())
        limit = max(8, int(0.04 * max(a.shape[0], a.shape[1])))
        if len(xs) > 256 or spread > limit:
            print(f"  ignoring {len(xs)} stray {name} pixels spread over {spread}px "
                  f"— too diffuse to be a marker", file=sys.stderr)
            continue
        # Several pixels of the same marker (a brush dab) average to its centre.
        points[name] = (int(round(xs.mean())), int(round(ys.mean())))
        # Repaint to whatever surrounds the marker, so a marker placed just
        # outside the silhouette leaves transparency rather than a white speck
        # that would enlarge the trimmed bounding box.
        y0, y1 = max(0, ys.min() - 3), min(a.shape[0], ys.max() + 4)
        x0, x1 = max(0, xs.min() - 3), min(a.shape[1], xs.max() + 4)
        window = a[y0:y1, x0:x1].reshape(-1, 4)
        near = window[~np.all(window[:, :3] == colour, axis=1)]
        if len(near):
            vals, counts = np.unique(near, axis=0, return_counts=True)
            a[hit] = vals[counts.argmax()]
        else:
            a[hit] = CLEAR
    return points, Image.fromarray(a, "RGBA")


def quantize(rgba):
    """
    Force art to the three values the character set uses: black ink, opaque
    white fill, and a fully transparent surround.

    Hand-drawn and generated art arrives antialiased, which leaves soft alpha
    at the silhouette edge — that both looks wrong beside the original cast and
    frays the §6.1 halo, which is computed from the alpha channel.
    """
    # int32, not int16: 255 * 587 overflows 16 bits, which made white compute as
    # a negative luma and so classify as ink — inverting every fill it touched.
    a = np.array(rgba).astype(np.int32)
    opaque = a[:, :, 3] >= 128
    luma = (a[:, :, 0] * 299 + a[:, :, 1] * 587 + a[:, :, 2] * 114) // 1000
    ink = opaque & (luma < 128)

    out = np.zeros(a.shape, dtype=np.uint8)
    out[opaque] = FILL
    out[ink] = INK
    out[~opaque] = CLEAR
    return Image.fromarray(out, "RGBA")


def trim(img, points):
    """Crop to the opaque bounding box, shifting any anchors into the new frame."""
    bbox = img.getbbox()
    if not bbox:
        return img, points
    left, top = bbox[0], bbox[1]
    return img.crop(bbox), {k: (x - left, y - top) for k, (x, y) in points.items()}


def rescale(img, points, factor, do_quantize=True):
    """Scale sprite and anchors together. Re-quantised, since resampling blurs."""
    if abs(factor - 1.0) < 1e-3:
        return img, points
    w = max(1, int(round(img.size[0] * factor)))
    h = max(1, int(round(img.size[1] * factor)))
    scaled = img.resize((w, h), Image.LANCZOS)
    if do_quantize:
        scaled = quantize(scaled)
    return scaled, {k: (int(round(x * factor)), int(round(y * factor))) for k, (x, y) in points.items()}


def opaque_mask(img):
    return np.array(img)[:, :, 3] > 0


def _runs(row):
    """Contiguous opaque spans in a boolean row, as (start, end) pairs."""
    spans, start = [], None
    for i, v in enumerate(row):
        if v and start is None:
            start = i
        elif not v and start is not None:
            spans.append((start, i - 1))
            start = None
    if start is not None:
        spans.append((start, len(row) - 1))
    return spans


def derive_body_attach(img):
    """
    Where a head joins this torso, when no marker was supplied.

    Collapses a band across the top of the torso into its contiguous spans and
    takes the one nearest the torso's own centre of mass. A plain centroid of
    the band fails on a raised arm — a wave puts the hand above the neck, and
    every one of the decoded cast's worst cases is a `wave` torso — whereas the
    hand is a *separate* span, and the far one.

    Measured against the decoded cast this lands within ~3px for a typical
    torso but can be tens of pixels out on an awkward pose. Place a marker.
    """
    mask = opaque_mask(img)
    h, w = mask.shape
    band = max(1, int(h * 0.05))
    spans = _runs(mask[:band].any(axis=0))
    if not spans:
        return (w // 2, 0)
    mid = mask[int(h * 0.35):max(int(h * 0.6), int(h * 0.35) + 1)]
    ys, xs = np.nonzero(mid)
    ref = xs.mean() if len(xs) else w / 2
    span = min(spans, key=lambda s: abs((s[0] + s[1]) / 2 - ref))
    return (int(round((span[0] + span[1]) / 2)), max(0, int(h * 0.035)))


def derive_head_points(img):
    """
    A head's neck join and face centre, when no markers were supplied.

    The join is the widest span across the bottom band — the neck and jaw,
    rather than a centroid that an ear, a hat or long hair pulls sideways. This
    is the weakest of the derivations (~11% of head width against the decoded
    cast, and worse on asymmetric silhouettes); markers matter most here.
    """
    mask = opaque_mask(img)
    h, w = mask.shape
    band = max(1, int(h * 0.12))
    spans = _runs(mask[h - band:].any(axis=0))
    ax = int(round(sum(max(spans, key=lambda s: s[1] - s[0])) / 2)) if spans else w // 2
    return {"attach": (ax, max(0, h - max(1, band // 2))),
            "tail": (int(w * 0.55), int(h * 0.60))}


def load(path, do_quantize=True):
    """
    Read a sprite and pull its markers.

    Quantising is optional because art that was drawn with antialiasing and a
    coloured ink looks better left alone than hard-thresholded — the original
    cast is 1-bit, but the v2.5 avatars are full colour, so the renderer copes
    with either. Pass `do_quantize` only to match the v1.0 art exactly.
    """
    img = Image.open(path).convert("RGBA")
    points, img = find_markers(img)
    return (quantize(img) if do_quantize else img), points


def collect(src):
    """Group the source directory's PNGs into heads and bodies-by-key."""
    heads, bodies, problems = {}, {}, []
    for fn in sorted(os.listdir(src)):
        if not fn.lower().endswith(".png"):
            continue
        stem = fn[:-4]
        if stem.startswith("head-"):
            code = stem[5:]
            if code not in EMOTION_CODES:
                problems.append(f"{fn}: '{code}' is not one of {', '.join(EMOTION_CODES)}")
                continue
            heads[code] = fn
        elif stem.startswith("body-"):
            rest = stem[5:]
            # `body-point-other-0` -> key 'point-other'; a trailing -<n> is the
            # variant index, which the composer cycles.
            key, _, tail = rest.rpartition("-")
            if not key or not tail.isdigit():
                key, tail = rest, "0"
            if key not in BODY_KEYS:
                problems.append(f"{fn}: '{key}' is not a recognised body key")
                continue
            bodies.setdefault(key, []).append(fn)
        else:
            problems.append(f"{fn}: expected a name starting 'head-' or 'body-'")
    return heads, bodies, problems


def scale_factor(height):
    """
    How much to resample a character by: never up, and down only when the art
    is big enough to bloat a bundle. See {@link MAX_FIGURE_HEIGHT}.
    """
    if not height or height <= MAX_FIGURE_HEIGHT:
        return 1.0
    return MAX_FIGURE_HEIGHT / height


def collect_figures(src):
    """
    Group a whole-figure character's PNGs by pose key.

    Filenames are the pose itself — `neutral.png`, `shrug.png`, `angry.png` —
    with an optional `-<n>` variant suffix, and {@link POSE_ALIASES} smoothing
    over the words an artist naturally reaches for.
    """
    figures, problems = {}, []
    for fn in sorted(os.listdir(src)):
        if not fn.lower().endswith(".png"):
            continue
        stem = fn[:-4]
        key, _, tail = stem.rpartition("-")
        if not key or not tail.isdigit():
            key = stem
        key = POSE_ALIASES.get(key.lower(), key.lower())
        if key not in FIGURE_KEYS:
            problems.append(f"{fn}: '{key}' is not a gesture or expression")
            continue
        figures.setdefault(key, []).append(fn)
    return figures, problems


def build_figures(src, out, cid, name, backdrops, headless, do_quantize, framing):
    """
    Import a whole-figure character — one sprite per pose, no separable head.

    This is the shape a *headless* cast needs: with no head there is nothing to
    composite, so the layered head×body matrix has nothing to offer and each
    drawing simply is the character in that pose. Emotion has to live entirely
    in the stance, which is the point.
    """
    figures, problems = collect_figures(src)
    if "neutral" not in figures:
        problems.append("missing neutral.png (a neutral pose is required)")
    if problems:
        print("Cannot import:\n  " + "\n  ".join(problems), file=sys.stderr)
        return None

    os.makedirs(out, exist_ok=True)

    probe, _ = load(os.path.join(src, figures["neutral"][0]), do_quantize)
    probe, _ = trim(probe, {})
    factor = scale_factor(probe.size[1])

    entries, guessed = [], []
    for key in FIGURE_KEYS:
        for fn in figures.get(key, []):
            img, points = load(os.path.join(src, fn), do_quantize)
            img, points = trim(img, points)
            img, points = rescale(img, points, factor, do_quantize)
            img.save(os.path.join(out, fn))
            # With no face, the balloon tail aims where a head would be: the
            # collar. That is the same landmark a torso's `headAttach` marks,
            # so the same derivation serves (§5.4).
            tail = points.get("tail", points.get("attach", derive_body_attach(img)))
            if "tail" not in points and "attach" not in points:
                guessed.append(f"{fn} (tail)")
            entries.append({
                "src": fn,
                "key": key,
                "tailAnchor": {"x": tail[0], "y": tail[1]},
                "bounds": {"x": 0, "y": 0, "width": img.size[0], "height": img.size[1]},
            })

    manifest = {"id": cid, "name": name, "figures": entries}
    if framing:
        manifest["framing"] = {"shoulderFraction": framing[0], "kneeFraction": framing[1]}
    elif headless:
        # A headless figure's topmost pixel is its collar, not a scalp, so the
        # §6.2 crop lines cannot be measured from a head. Put the tightest crop
        # at the upper torso — cropping at a true shoulder line would leave a
        # sliver of collar and nothing else.
        manifest["framing"] = {"shoulderFraction": 0.3, "kneeFraction": 0.72}
    if backdrops:
        manifest["backdropPreferences"] = backdrops

    with open(os.path.join(out, "character.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    keys = sorted({e["key"] for e in entries})
    print(f"{cid}: {len(entries)} figures across {len(keys)} poses "
          f"({', '.join(keys)}), scale x{factor:.3f}"
          + (f", framing {manifest['framing']}" if "framing" in manifest else ""))
    if guessed:
        print(f"  {len(guessed)} sprite(s) had no marker; the balloon tail was estimated:")
        for g in guessed:
            print(f"    {g}")
    return manifest


def build(src, out, cid, name, backdrops, do_quantize=False):
    heads, bodies, problems = collect(src)

    for code in EMOTION_CODES:
        if code not in heads:
            problems.append(f"missing head-{code}.png (all seven emotion codes are required)")
    if "neutral" not in bodies:
        problems.append("missing body-neutral-0.png (at least one neutral body is required)")
    if problems:
        print("Cannot import:\n  " + "\n  ".join(problems), file=sys.stderr)
        return None

    os.makedirs(out, exist_ok=True)

    # One scale factor for the whole character, taken from the neutral torso, so
    # heads and bodies stay in proportion with each other and with the cast.
    probe, _ = load(os.path.join(src, bodies["neutral"][0]), do_quantize)
    probe, _ = trim(probe, {})
    factor = scale_factor(probe.size[1])

    def emit(fn):
        img, points = load(os.path.join(src, fn), do_quantize)
        img, points = trim(img, points)
        img, points = rescale(img, points, factor, do_quantize)
        img.save(os.path.join(out, fn))
        return img, points

    manifest = {"id": cid, "name": name, "heads": {}, "bodies": {}}
    guessed = []

    for code in EMOTION_CODES:
        img, points = emit(heads[code])
        derived = derive_head_points(img)
        attach = points.get("attach", derived["attach"])
        tail = points.get("tail", derived["tail"])
        missing = [m for m in ("attach", "tail") if m not in points]
        if missing:
            guessed.append(f"{heads[code]} ({', '.join(missing)})")
        manifest["heads"][code] = {
            "src": heads[code],
            "attach": {"x": attach[0], "y": attach[1]},
            "tailAnchor": {"x": tail[0], "y": tail[1]},
        }

    for key in BODY_KEYS:
        for fn in bodies.get(key, []):
            img, points = emit(fn)
            attach = points.get("attach", derive_body_attach(img))
            if "attach" not in points:
                guessed.append(f"{fn} (attach)")
            manifest["bodies"].setdefault(key, []).append({
                "src": fn,
                "headAttach": {"x": attach[0], "y": attach[1]},
                "bounds": {"x": 0, "y": 0, "width": img.size[0], "height": img.size[1]},
            })

    # Framing (§6.2), by the same measure import-avb.py uses for layered
    # characters: the head's overhang above the torso against the whole figure.
    neu_head = manifest["heads"]["neu"]
    neu_body = manifest["bodies"]["neutral"][0]
    overhang = max(1, neu_head["attach"]["y"] - neu_body["headAttach"]["y"])
    total = overhang + neu_body["bounds"]["height"]
    manifest["framing"] = {
        "shoulderFraction": round(overhang / total, 3),
        "kneeFraction": round((overhang + 0.72 * neu_body["bounds"]["height"]) / total, 3),
    }
    if backdrops:
        manifest["backdropPreferences"] = backdrops

    with open(os.path.join(out, "character.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"{cid}: {len(manifest['heads'])} heads, "
          f"{sum(len(v) for v in manifest['bodies'].values())} bodies across "
          f"{len(manifest['bodies'])} keys, scale x{factor:.3f}, "
          f"framing {manifest['framing']}")
    if guessed:
        print(f"  {len(guessed)} sprite(s) had no marker; anchors were estimated "
              f"and may need a nudge. Mark these to be sure:")
        for g in guessed:
            print(f"    {g}")
    return manifest


def main():
    ap = argparse.ArgumentParser(description="Import hand-drawn art into a character manifest.")
    ap.add_argument("src", help="directory of head-*.png / body-*.png")
    ap.add_argument("out", help="output character directory")
    ap.add_argument("--id", required=True, help="character id, e.g. 'bass'")
    ap.add_argument("--name", required=True, help="display name, e.g. 'Larmouth Bass'")
    ap.add_argument("--backdrop", action="append", default=[],
                    help="preferred backdrop id (repeatable, best first)")
    ap.add_argument("--figures", action="store_true",
                    help="whole-figure character: one sprite per pose, no separable head")
    ap.add_argument("--headless", action="store_true",
                    help="with --figures: the figure has no head, so frame from the collar")
    ap.add_argument("--quantize", action="store_true",
                    help="hard-threshold to the v1.0 art's black/white/transparent palette")
    ap.add_argument("--framing", metavar="SHOULDER,KNEE",
                    help="override the §6.2 crop lines, e.g. 0.30,0.72")
    args = ap.parse_args()

    framing = None
    if args.framing:
        try:
            shoulder, knee = (float(v) for v in args.framing.split(","))
        except ValueError:
            ap.error("--framing wants two numbers, e.g. 0.30,0.72")
        if not 0 < shoulder < knee < 1:
            ap.error("--framing wants 0 < shoulder < knee < 1")
        framing = (shoulder, knee)

    if args.figures:
        ok = build_figures(args.src, args.out, args.id, args.name, args.backdrop,
                           args.headless, args.quantize, framing)
    else:
        if args.headless:
            ap.error("--headless applies to --figures characters")
        ok = build(args.src, args.out, args.id, args.name, args.backdrop)
    if ok is None:
        sys.exit(1)


if __name__ == "__main__":
    main()
