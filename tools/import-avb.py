#!/usr/bin/env python3
"""
Import Microsoft Comic Chat `.avb` avatars into this project's JSON-manifest +
PNG-sprite format.

Comic Chat's art is MIT-licensed (microsoft/comic-chat) but ships in the binary
`.avb` "Avatar Binary" container. This tool decodes it — the format was
reverse-engineered from the repo's own `avatario.cpp`/`avatar.h` loader, not
guessed — and emits the same manifest shape the hand-drawn `nib` character uses,
so the composer and renderer consume real Comic Chat characters unchanged.

Each `.avb` holds, per pose, three bitmaps: foreground art, a transparency mask,
and an aura (halo) mask. Faces carry an emotion index and a neck crosshair
(xCX,yCX) plus a face centre (faceX,faceY); torsos carry a gesture index and the
crosshair where the head attaches. Those map directly onto our manifest's
`attach`, `tailAnchor` and `headAttach`.

Usage:
    python tools/import-avb.py <path-to-comicart/avatars> <out-dir> [names...]

Requires Pillow. This is a one-time asset-generation tool; the committed PNGs
and manifests are the deliverable, so contributors rarely need to re-run it.
"""

import json
import os
import struct
import sys
import io
import zlib

try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.exit("This tool needs Pillow and numpy:  pip install Pillow numpy")

# Luminance below this is treated as ink (the black linework).
INK_THRESHOLD = 110

# Emotion/gesture index -> name, from avatar.h's emStrings / EM_* enum.
EMOTION = {
    1: "happy", 2: "coy", 3: "bored", 4: "scared", 5: "sad", 6: "angry",
    7: "shout", 8: "laugh", 9: "neutral",
    10: "wave", 11: "point-other", 12: "point-self", 13: "double-point",
    14: "shrug", 15: "walk-3qr", 16: "walk-side", 17: "walk-3qf",
}

# Chunk keys, from avatario.h (v1.0) and avbfile.h (v2.5).
AK_NAME, AK_FLAGS, AK_ICON, AK_NFACES, AK_NTORSOS, AK_START, AK_END, AK_STYLE, AK_NBODIES = \
    1, 2, 3, 4, 5, 6, 7, 8, 9
# v2.5 record variants: same payloads but each record ends in six format bytes
# instead of sixteen padding bytes.
AK_NFACES2, AK_NTORSOS2, AK_NBODIES2 = 10, 11, 12
# v2.5 keys >= 256 are followed by a 2-byte payload size, so unknown ones can
# be skipped (avbfile.h documents this as the forward-compatibility scheme).
AK_ICON_NEW, AK_COLORPALETTE, AK_OFFSET_ADJUSTMENT = 256, 257, 263

# v2.5 image storage (avbfile.h: AVATARIMAGEFORMAT / AVATARIMAGEPALETTE).
AIF_DIB, AIF_LZDEFLATE = 0, 1
(AIP_NOPALETTE, AIP_GLOBALPALETTE, AIP_LOCALPALETTE,
 AIP_MONOCHROME, AIP_MASKEDMONO, AIP_DUALMASK) = range(6)

# Our seven manifest emotion codes <- Comic Chat emotion names (with fallbacks).
EMOTION_TO_CODE = [
    ("neu", ["neutral"]),
    ("hap", ["happy"]),
    ("laf", ["laugh"]),
    ("coy", ["coy"]),
    ("sad", ["sad"]),
    ("ang", ["angry"]),
    ("sho", ["shout", "scared"]),
]

# Our body keys <- Comic Chat torso names. Torsos carry more than gestures:
# the originals ship emotional body language (an angry stance, a laughing
# slump, a scared cower) under the same enum as the gestures, and the client
# picks the torso by the message's emotion when no gesture fires. Import all
# of them — expression-keyed bodies use our expression names.
BODY_FROM = {
    # Gestures.
    "neutral": "neutral", "wave": "wave",
    "point-self": "point-self", "point-other": "point-other",
    "double-point": "point-other",
    # Emotional torsos.
    "happy": "happy", "sad": "sad", "angry": "angry", "laugh": "laughing",
    "shout": "shouting", "coy": "coy", "bored": "bored", "scared": "scared",
}

# Whole-figure pose key <- Comic Chat emotion/gesture name. Covers both the
# expression names and the gesture names, since a figure pose bakes in both.
# Walking poses have no place in a static comic and are dropped.
FIGURE_KEY = {
    "neutral": "neutral", "happy": "happy", "sad": "sad", "angry": "angry",
    "laugh": "laughing", "shout": "shouting", "coy": "coy",
    "bored": "bored", "scared": "scared",
    "wave": "wave", "point-self": "point-self", "point-other": "point-other",
    "double-point": "point-other", "shrug": "shrug",
}


def parse_avb(data):
    p = [6]  # skip magic(2) avType(2) version(2); we re-read below

    def r16(signed=False):
        v = struct.unpack_from("<h" if signed else "<H", data, p[0])[0]
        p[0] += 2
        return v

    def r32():
        v = struct.unpack_from("<I", data, p[0])[0]
        p[0] += 4
        return v

    magic, av_type, version = struct.unpack_from("<HHH", data, 0)
    assert magic in (0x81, 0x8181), f"bad magic 0x{magic:x}"
    v2 = magic == 0x8181

    av = {"type": av_type, "name": None, "faces": [], "torsos": [], "bodies": [],
          "images": {}, "global_pal": None}
    # AK_OFFSET_ADJUSTMENT shifts every image offset read after it (avbfile.cpp
    # ADJUST_OFFSET — applied only to non-zero offsets).
    adj = [0]

    def read_records(n, kind, fmt6=False):
        recs = []
        for _ in range(n):
            fg, tr, au = r32(), r32(), r32()
            if adj[0]:
                fg = fg + adj[0] if fg else 0
                tr = tr + adj[0] if tr else 0
                au = au + adj[0] if au else 0
            m = r16()
            intensity = data[p[0]]; p[0] += 1
            rec = {"fg": fg, "tr": tr, "au": au,
                   "emotion": m, "name": EMOTION.get(m, f"?{m}"),
                   "intensity": intensity}
            if kind == "face":
                rec["xCX"], rec["yCX"] = r16(True), r16(True)
                r16(True); r16(True)  # delta_xCX, delta_yCX (unused here)
                rec["faceX"], rec["faceY"] = r16() & 0xFF, r16() & 0xFF
            elif kind == "torso":
                rec["xCX"], rec["yCX"] = r16(True), r16(True)
            else:  # simple whole-body
                rec["faceX"], rec["faceY"] = r16() & 0xFF, r16() & 0xFF
            if fmt6:
                # byImageFormat/byMaskFormat/byAuraFormat + the three palette types.
                rec["formats"] = tuple(data[p[0]:p[0] + 6]); p[0] += 6
            else:
                p[0] += 16  # trailing padding
            recs.append(rec)
        return recs

    while True:
        key = r16()
        size = r16() if key >= AK_ICON_NEW else None
        if key == AK_NAME:
            s = bytearray()
            while data[p[0]] != 0:
                s.append(data[p[0]]); p[0] += 1
            p[0] += 1
            av["name"] = s.decode("latin1")
        elif key == AK_STYLE:
            av["style"] = r16()
        elif key == AK_FLAGS:
            av["flags"] = r16()
        elif key == AK_ICON:
            av["icon"] = r32()
        elif key in (AK_NFACES, AK_NFACES2):
            av["faces"] = read_records(r16(), "face", fmt6=key == AK_NFACES2)
        elif key in (AK_NTORSOS, AK_NTORSOS2):
            av["torsos"] = read_records(r16(), "torso", fmt6=key == AK_NTORSOS2)
        elif key in (AK_NBODIES, AK_NBODIES2):
            av["bodies"] = read_records(r16(), "body", fmt6=key == AK_NBODIES2)
        elif key == AK_OFFSET_ADJUSTMENT:
            adj[0] += struct.unpack_from("<i", data, p[0])[0]; p[0] += 4
        elif key == AK_COLORPALETTE:
            n = r16()
            av["global_pal"] = [tuple(data[p[0] + 3 * i:p[0] + 3 * i + 3]) for i in range(n)]
            p[0] += 3 * n
        elif key == AK_START:
            break
        elif size is not None:
            p[0] += size  # unknown v2.5 record (copyright, URLs, …) — skippable
        else:
            raise ValueError(f"unknown chunk key {key} at offset {p[0] - 2}")

    if v2:
        _decode_v2_images(data, av)
    return av


def _read_v2_dib(data, off, fmt, ptype, global_pal):
    """
    Decode one v2.5 image resource at `off` -> (index array HxW, palette).

    Layout (avbfile.cpp CAvatarFileZlibImage::Read): an optional inline
    AK_COLORPALETTE record (for AIP_LOCALPALETTE), then the BITMAPINFOHEADER
    prefixed by its own size, then a zlib buffer ({u32 raw size, u32 compressed
    size, deflate bytes}) holding the usual bottom-up, 4-byte-aligned DIB rows.
    """
    p = off
    pal = global_pal if ptype == AIP_GLOBALPALETTE else None
    if ptype == AIP_LOCALPALETTE:
        tag, _sz = struct.unpack_from("<HH", data, p); p += 4
        if tag != AK_COLORPALETTE:
            raise ValueError(f"expected inline palette at offset {off}, got tag {tag}")
        (n,) = struct.unpack_from("<H", data, p); p += 2
        pal = [tuple(data[p + 3 * i:p + 3 * i + 3]) for i in range(n)]
        p += 3 * n
    (hdr_size,) = struct.unpack_from("<I", data, p)
    bih = data[p:p + hdr_size]; p += hdr_size
    width, height = struct.unpack_from("<ii", bih, 4)
    (bpp,) = struct.unpack_from("<H", bih, 14)
    stride = ((width * bpp + 31) // 32) * 4
    if fmt == AIF_LZDEFLATE:
        raw_size, comp_size = struct.unpack_from("<II", data, p); p += 8
        bits = zlib.decompress(data[p:p + comp_size])
    else:
        bits = data[p:p + stride * abs(height)]
    rows = np.frombuffer(bits, dtype=np.uint8)[:stride * abs(height)].reshape(abs(height), stride)
    if height > 0:
        rows = rows[::-1]  # DIB rows are stored bottom-up

    if bpp == 8:
        idx = rows[:, :width]
    elif bpp == 4:
        idx = np.stack([rows >> 4, rows & 0xF], axis=2).reshape(rows.shape[0], -1)[:, :width]
    elif bpp == 2:
        idx = np.stack([(rows >> 6) & 3, (rows >> 4) & 3, (rows >> 2) & 3, rows & 3],
                       axis=2).reshape(rows.shape[0], -1)[:, :width]
    elif bpp == 1:
        idx = np.unpackbits(rows, axis=1)[:, :width]
    else:
        raise ValueError(f"unsupported v2.5 bit depth {bpp}")
    return idx, pal


def _mono_l(active):
    """Boolean array -> L image in the v1.0 mask convention (dark = active)."""
    return Image.fromarray(np.where(active, 0, 255).astype("uint8"), "L")


def _decode_v2_images(data, av):
    """
    Decode every record's images eagerly and rewrite its fg/tr/au offsets to
    synthetic keys into av["images"], so the shared sprite pipeline stays
    offset-based. Handles the packed formats:

    - AIP_MASKEDMONO: one 2bpp image carries all three planes. Per 2-bit pair
      (avbfile.cpp ConvertMasksCommon): image bit = pair 11 after masking,
      mask bit = high bit (10, 11), aura bit = any non-zero pair.
    - AIP_DUALMASK: the mask slot's 2bpp image carries mask (bit 0) and aura
      (bit 1).
    """
    images = av["images"]
    cache = {}
    for rec in av["faces"] + av["torsos"] + av["bodies"]:
        fmts = rec.pop("formats", None)
        if fmts is None:
            continue
        orig = (rec["fg"], rec["tr"], rec["au"])
        if orig in cache:  # the C++ "ditto" case: repeated offsets share art
            rec["fg"], rec["tr"], rec["au"] = cache[orig]
            continue
        img_f, mask_f, aura_f, img_p, mask_p, aura_p = fmts
        fg = tr = au = None
        if rec["fg"]:
            idx, pal = _read_v2_dib(data, rec["fg"], img_f, img_p, av["global_pal"])
            if img_p == AIP_MASKEDMONO:
                ink = idx == 3
                fg = Image.fromarray(np.where(ink, 0, 255).astype("uint8"), "L").convert("RGB")
                tr = _mono_l(idx >= 2)
                au = _mono_l(idx != 0)
            elif pal is not None:
                lut = np.array(pal + [(0, 0, 0)] * (256 - len(pal)), dtype=np.uint8)
                fg = Image.fromarray(lut[idx], "RGB")
            else:
                fg = _mono_l(idx == 1).convert("RGB")
        if tr is None and rec["tr"]:
            idx, _ = _read_v2_dib(data, rec["tr"], mask_f, mask_p, av["global_pal"])
            if mask_p == AIP_DUALMASK:
                tr = _mono_l((idx & 1) != 0)
                au = _mono_l((idx & 2) != 0)
            else:
                tr = _mono_l(idx == 1)
        if au is None and rec["au"]:
            idx, _ = _read_v2_dib(data, rec["au"], aura_f, aura_p, av["global_pal"])
            au = _mono_l(idx == 1)
        keys = []
        for slot, img in (("fg", fg), ("tr", tr), ("au", au)):
            if img is None:
                keys.append(0)
                rec[slot] = 0
            else:
                key = f"v2:{len(images)}"
                images[key] = img
                keys.append(key)
                rec[slot] = key
        cache[orig] = tuple(keys)


def bmp_at(data, off, images=None):
    if images is not None and off in images:
        return images[off]
    if not isinstance(off, int) or not off or off + 6 > len(data) or data[off:off + 2] != b"BM":
        return None
    size = struct.unpack_from("<I", data, off + 2)[0]
    return Image.open(io.BytesIO(data[off:off + size]))


def _dilate4(b):
    o = b.copy()
    o[1:, :] |= b[:-1, :]
    o[:-1, :] |= b[1:, :]
    o[:, 1:] |= b[:, :-1]
    o[:, :-1] |= b[:, 1:]
    return o


def _trim_to_ink(art_rgb, aura_l, cap=12):
    """
    Trim a dilated aura silhouette back onto the ink outline.

    Comic Chat's aura mask is dilated a few pixels past the linework to draw the
    §6.1 halo, and the amount varies by character — so a fixed erosion leaves a
    ring on some and clips thin features on others. Instead, flood inward from
    the aura's boundary through *light* (non-ink) pixels, stopping at the ink:
    everything the flood reaches is the exterior fringe and is dropped, while the
    ink and any light region enclosed by it (a white shirt, an apron) is kept.
    The flood is capped so a gap in an outline can only leak a few pixels.
    """
    lum = np.asarray(art_rgb.convert("L"))
    aura = np.asarray(aura_l) < 128  # dark in the mask = opaque shape
    light = lum >= INK_THRESHOLD
    travel = aura & light  # light pixels inside the aura the flood can cross

    outside = ~aura
    boundary = np.zeros_like(aura)
    boundary[1:, :] |= outside[:-1, :]
    boundary[:-1, :] |= outside[1:, :]
    boundary[:, 1:] |= outside[:, :-1]
    boundary[:, :-1] |= outside[:, 1:]
    boundary[0, :] = boundary[-1, :] = boundary[:, 0] = boundary[:, -1] = True

    region = travel & boundary
    for _ in range(cap):
        nxt = _dilate4(region) & travel
        if nxt.sum() == region.sum():
            break
        region = nxt

    keep = aura & ~region
    return Image.fromarray(np.where(keep, 255, 0).astype("uint8"), "L")


def sprite_rgba(data, fg, tr, au, images=None):
    """
    Foreground art keyed to a silhouette.

    Heads carry an exact transparency mask (`tr`), which already hugs the ink.
    Torsos leave `tr` empty and only have the dilated aura (`au`); that is
    trimmed back onto the ink by {@link _trim_to_ink} so every sprite has a
    consistent tight edge with no white halo ring. (A uniform halo, if wanted
    later, belongs behind the whole assembled character, not baked per-part.)
    """
    art = bmp_at(data, fg, images)
    if art is None:
        return None
    art = art.convert("RGB")
    exact = bmp_at(data, tr, images)
    if exact is not None:
        alpha = exact.convert("L").resize(art.size).point(lambda v: 255 if v < 128 else 0)
    else:
        au_img = bmp_at(data, au, images)
        if au_img is None:
            return art.convert("RGBA")
        alpha = _trim_to_ink(art, au_img.convert("L").resize(art.size))
    out = art.convert("RGBA")
    out.putalpha(alpha)
    return out


def trim(img, anchors):
    """Crop to the opaque bounding box; shift anchors into the cropped frame."""
    bbox = img.getbbox()
    if not bbox:
        return img, anchors
    left, top, _, _ = bbox
    return img.crop(bbox), {k: (x - left, y - top) for k, (x, y) in anchors.items()}


def pick_first(recs, name):
    for r in recs:
        if r["name"] == name:
            return r
    return None


def convert_figure(data, av, cid, name, out):
    """
    Emit a whole-figure manifest for a `type == 1` avatar.

    These characters have no separable head: each pose in `av["bodies"]` is a
    complete standing figure with an expression or gesture baked in, plus a face
    crosshair the balloon tail aims at. We key each pose by its expression or
    gesture name and let the renderer pick the closest one; single-pose
    characters (Tux, Waf…) just always show their one figure.
    """
    figures = []
    seen = {}
    neutral_bounds = None
    neutral_face_y = None
    for rec in av["bodies"]:
        key = FIGURE_KEY.get(rec["name"])
        if key is None:
            continue  # walking / unmapped pose
        off = (rec["fg"], rec["tr"])
        if off in seen:
            # Shared art (ditto): alias it into this key rather than lose it.
            prior = seen[off]
            if any(f["key"] == key and f["src"] == prior["src"] for f in figures):
                continue
            figures.append({**prior, "key": key})
            continue
        img = sprite_rgba(data, rec["fg"], rec["tr"], rec["au"], av["images"])
        if img is None:
            continue
        anchors = {"tail": (rec["faceX"], rec["faceY"])}
        img, anchors = trim(img, anchors)
        idx = sum(1 for f in figures if f["key"] == key)
        fn = f"figure-{key}-{idx}.png"
        img.save(os.path.join(out, fn))
        entry = {
            "src": fn,
            "key": key,
            "tailAnchor": {"x": anchors["tail"][0], "y": anchors["tail"][1]},
            "bounds": {"x": 0, "y": 0, "width": img.size[0], "height": img.size[1]},
        }
        seen[off] = entry
        figures.append(entry)
        if key == "neutral" and neutral_bounds is None:
            neutral_bounds = img.size
            neutral_face_y = anchors["tail"][1]

    if not any(f["key"] == "neutral" for f in figures):
        print(f"  {cid}: no neutral figure — skipped")
        return None

    # Framing (§6.2): the face crosshair sits mid-head, so shoulders are a little
    # below it; the knees are roughly three-quarters down the whole figure.
    h = neutral_bounds[1]
    shoulder = min(0.42, max(0.12, neutral_face_y / h + 0.08))
    manifest = {
        "id": cid, "name": name,
        "figures": figures,
        "framing": {"shoulderFraction": round(shoulder, 3),
                    "kneeFraction": round(min(0.85, shoulder + 0.45), 3)},
    }
    with open(os.path.join(out, "character.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    poses = ", ".join(sorted({f["key"] for f in figures}))
    print(f"  {cid}: {name} — whole-figure, {len(figures)} poses [{poses}]")
    return cid


def convert(avb_path, out_root):
    data = open(avb_path, "rb").read()
    av = parse_avb(data)
    cid = os.path.splitext(os.path.basename(avb_path))[0]
    raw = (av["name"] or cid)
    # The internal name field can carry stray trailing bytes; keep printable
    # ASCII only and title-case it for display.
    name = "".join(c for c in raw if 32 <= ord(c) < 127).strip() or cid
    name = name.title()
    out = os.path.join(out_root, cid)
    os.makedirs(out, exist_ok=True)

    if av["type"] == 1:
        return convert_figure(data, av, cid, name, out)

    manifest = {"id": cid, "name": name, "heads": {}, "bodies": {}}

    # --- Heads, one per emotion code -------------------------------------
    head_dims = {}
    for code, names in EMOTION_TO_CODE:
        rec = next((pick_first(av["faces"], n) for n in names
                    if pick_first(av["faces"], n)), None)
        if rec is None:
            rec = pick_first(av["faces"], "neutral")
        img = sprite_rgba(data, rec["fg"], rec["tr"], rec["au"], av["images"])
        anchors = {"attach": (rec["xCX"], rec["yCX"]),
                   "tail": (rec["faceX"], rec["faceY"])}
        img, anchors = trim(img, anchors)
        fn = f"head-{code}.png"
        img.save(os.path.join(out, fn))
        head_dims[code] = img.size
        manifest["heads"][code] = {
            "src": fn,
            "attach": {"x": anchors["attach"][0], "y": anchors["attach"][1]},
            "tailAnchor": {"x": anchors["tail"][0], "y": anchors["tail"][1]},
        }

    # --- Bodies, grouped by body key (variants cycle) --------------------
    # Records can share art (the C++ "ditto" case): several intensities of one
    # emotion, or two different emotions drawn identically. Shared art is saved
    # once and *aliased* into every body key that references it — dropping the
    # later record entirely would lose whole keys (Kevin's neutral torso is a
    # ditto of an emotional one).
    seen_offsets = {}
    body_h_for_framing = None
    head_attach_y_for_framing = None
    for rec in av["torsos"]:
        g = BODY_FROM.get(rec["name"])
        if g is None:
            continue
        key = (rec["fg"], rec["tr"])
        entries = manifest["bodies"].setdefault(g, [])
        if key in seen_offsets:
            prior = seen_offsets[key]
            if any(e["src"] == prior["src"] for e in entries):
                continue  # an intensity variant within a key we already hold
            entries.append(dict(prior))
        else:
            img = sprite_rgba(data, rec["fg"], rec["tr"], rec["au"], av["images"])
            anchors = {"attach": (rec["xCX"], rec["yCX"])}
            img, anchors = trim(img, anchors)
            fn = f"body-{g}-{len(entries)}.png"
            img.save(os.path.join(out, fn))
            entry = {
                "src": fn,
                "headAttach": {"x": anchors["attach"][0], "y": anchors["attach"][1]},
                "bounds": {"x": 0, "y": 0, "width": img.size[0], "height": img.size[1]},
            }
            seen_offsets[key] = entry
            entries.append(entry)
        if g == "neutral" and body_h_for_framing is None:
            first = manifest["bodies"]["neutral"][0]
            body_h_for_framing = first["bounds"]["height"]
            head_attach_y_for_framing = first["headAttach"]["y"]

    if "neutral" not in manifest["bodies"]:
        print(f"  {cid}: no neutral torso — skipped")
        return None

    # --- Framing landmarks (§6.2) from real proportions ------------------
    # Head extends above the torso top by (head neck y - torso attach y); that
    # overhang plus the torso height is the full standing height, and the
    # shoulders sit at the torso top.
    neu_head = manifest["heads"]["neu"]
    overhang = max(1, neu_head["attach"]["y"] - head_attach_y_for_framing)
    total = overhang + body_h_for_framing
    manifest["framing"] = {
        "shoulderFraction": round(overhang / total, 3),
        "kneeFraction": round((overhang + 0.72 * body_h_for_framing) / total, 3),
    }

    with open(os.path.join(out, "character.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    n_heads = len(manifest["heads"])
    n_bodies = sum(len(v) for v in manifest["bodies"].values())
    print(f"  {cid}: {name} — {n_heads} heads, {n_bodies} bodies, "
          f"framing {manifest['framing']}")
    return cid


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, out_root = sys.argv[1], sys.argv[2]
    names = sys.argv[3:]
    files = ([os.path.join(src, f"{n}.avb") for n in names] if names
             else sorted(os.path.join(src, f) for f in os.listdir(src)
                         if f.endswith(".avb")))
    os.makedirs(out_root, exist_ok=True)
    done = []
    for path in files:
        if not os.path.exists(path):
            print(f"  missing: {path}"); continue
        try:
            cid = convert(path, out_root)
            if cid:
                done.append(cid)
        except Exception as e:
            print(f"  {os.path.basename(path)}: FAILED — {e}")
    print(f"\nconverted {len(done)} characters: {', '.join(done)}")


if __name__ == "__main__":
    main()
