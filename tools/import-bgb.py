#!/usr/bin/env python3
"""
Import Microsoft Comic Chat `.bgb` backdrops into this project's PNG format.

Comic Chat's v2.5 backdrops ship as `.bgb` ("Background Bitmap") files in the
MIT-licensed microsoft/comic-chat repo (v2.5-beta-1/comicart and
v2.5-beta-1/artpack1). The format was read off the repo's own dib.cpp loader,
not guessed:

    - a tagged container (magic 0x8181) carrying name / copyright / URL strings;
    - a colour palette of `2**bpp` RGB triples (3 bytes each), immediately
      before the bitmap header;
    - a 40-byte BITMAPINFOHEADER (315x315 or larger, 4- or 8-bit, the on-disk
      biCompression is a nominal BI_RGB);
    - two DWORDs — uncompressed then compressed byte counts;
    - a zlib deflate stream (0x78 0xDA) of the raw, bottom-up, 4-byte-aligned
      indexed rows. (The v1.0 loader used RLE4; v2.5 switched to zlib.)

The 4-bit backdrops are the classic hatched black-and-white scenes (room,
field, pastoral); the 8-bit ones are the colour Art Pack scenes (space, den,
volcano, buckroom, clouds, yellow).

Usage:
    python tools/import-bgb.py <dir-of-.bgb-files> <out-dir>

Requires Pillow. One-time asset generation; the committed PNGs are the
deliverable.
"""

import struct
import sys
import zlib
import os

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow:  pip install Pillow")


def find_dib(data):
    """Locate the BITMAPINFOHEADER: biSize == 40 with sane dimensions."""
    for off in range(len(data) - 40):
        if struct.unpack_from("<I", data, off)[0] != 40:
            continue
        w, h = struct.unpack_from("<ii", data, off + 4)
        bpp = struct.unpack_from("<H", data, off + 14)[0]
        if 0 < w < 4000 and 0 < h < 4000 and bpp in (4, 8):
            return off
    raise ValueError("no BITMAPINFOHEADER found")


def decode_bgb(data):
    dib = find_dib(data)
    w, h = struct.unpack_from("<ii", data, dib + 4)
    bpp = struct.unpack_from("<H", data, dib + 14)[0]
    colors = struct.unpack_from("<I", data, dib + 32)[0] or (1 << bpp)
    _usize, csize = struct.unpack_from("<II", data, dib + 40)

    if data[dib + 48 : dib + 50] != b"\x78\xda":
        raise ValueError(f"expected zlib stream after header, got {data[dib+48:dib+50].hex()}")
    raw = zlib.decompress(data[dib + 48 : dib + 48 + csize])

    pal_off = dib - colors * 3
    palette = [tuple(data[pal_off + i * 3 : pal_off + i * 3 + 3]) for i in range(colors)]

    image = Image.new("RGB", (w, h))
    px = image.load()
    if bpp == 8:
        scan = (w + 3) & ~3  # rows padded to a 4-byte boundary
        for row in range(h):
            base = row * scan
            for x in range(w):
                px[x, h - 1 - row] = palette[raw[base + x]]  # DIB rows are bottom-up
    else:  # 4 bpp
        scan = (((w + 1) // 2) + 3) & ~3
        for row in range(h):
            base = row * scan
            for x in range(w):
                byte = raw[base + x // 2]
                idx = (byte >> 4) if x % 2 == 0 else (byte & 0xF)
                px[x, h - 1 - row] = palette[idx]
    return image


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    done = []
    for name in sorted(os.listdir(src)):
        if not name.lower().endswith(".bgb"):
            continue
        base = os.path.splitext(name)[0]
        try:
            image = decode_bgb(open(os.path.join(src, name), "rb").read())
            image.save(os.path.join(out, f"{base}.png"))
            done.append(f"{base} ({image.width}x{image.height})")
        except Exception as e:  # noqa: BLE001 — report and continue
            print(f"  {name}: FAILED — {e}")
    print(f"converted {len(done)} backdrops: {', '.join(done)}")


if __name__ == "__main__":
    main()
