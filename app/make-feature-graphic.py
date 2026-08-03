"""Generate mComic '96's Play Store feature graphic (1024x500).

Same construction as make-icon.py — the app's own wordmark, pink `m`, cyan
`Comic`, tilted lime `'96` badge, neon glow as a blurred under-layer — but laid
out horizontally for the banner, with the tagline under it.

Two constraints drive the layout:

- **Play crops this image.** It is shown at full width in some surfaces and
  cropped toward the centre in others, so every piece of type sits inside a
  centred safe box (`SAFE_W`/`SAFE_H`). The decorative balloons are deliberately
  the only things out in the crop zone — losing them costs nothing.
- **No alpha.** Play wants a 24-bit PNG or a JPEG, so the canvas is flattened
  onto the void before saving. A feature graphic with transparency is rejected.

Type is Comic Neue (OFL), reusing the TTF that make-icon.py converts out of the
woff2 into `.iconfonts/` (gitignored). Requires `fonttools` + `brotli` + Pillow.

Run from `app/`:  python make-feature-graphic.py
Writes: store/feature-graphic.png
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

VOID = (8, 8, 11, 255)
CYAN = (44, 255, 230, 255)
PINK = (255, 61, 154, 255)
LIME = (182, 255, 61, 255)
INK = (5, 5, 7, 255)
MUTED = (139, 135, 166, 255)
TEXT = (242, 240, 255, 255)

W, H = 1024, 500
SS = 3  # supersample — the tilt, the glow and the balloon strokes need it

# Play crops toward the centre. Nothing that must survive goes outside this.
# 0.72 rather than something wider: at 0.78 the `m` and the `'96` badge sat only
# a hair inside the box, so any crop at all would have bitten the wordmark.
SAFE_W, SAFE_H = 0.72, 0.80

FONTDIR = ".iconfonts"
OUTDIR = "store"

TAGLINE = "Type a conversation. Get a comic."
STUDIO = "Onion Madder"


def ensure_font():
    """Comic Neue ships as woff2; Pillow needs TTF. Shared with make-icon.py."""
    out = os.path.join(FONTDIR, "ComicNeue-700.ttf")
    if os.path.exists(out):
        return out
    from fontTools.ttLib import TTFont

    os.makedirs(FONTDIR, exist_ok=True)
    src = "node_modules/@fontsource/comic-neue/files/comic-neue-latin-700-normal.woff2"
    f = TTFont(src)
    f.flavor = None
    f.save(out)
    return out


FONT_PATH = ensure_font()


def glow(layer, radius, passes=2):
    """A blurred copy of `layer`, the raster equivalent of CSS text-shadow."""
    g = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    for _ in range(passes):
        g.alpha_composite(layer.filter(ImageFilter.GaussianBlur(radius)))
    return g


def bloom(size, centre, radius, color, peak):
    """A soft radial wash — depth behind the type without adding any detail.

    Drawn as a stack of widening translucent ellipses rather than a real
    gradient, then blurred flat; at this radius the banding is well under one
    level by the time it is blurred.
    """
    S_W, S_H = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 24
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(peak * (1 - i / steps) ** 2)
        d.ellipse(
            (centre[0] - r, centre[1] - r, centre[0] + r, centre[1] + r),
            fill=(*color[:3], a),
        )
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.25))


def balloon(size, box, color, width, tail_dx):
    """An empty neon speech balloon outline — the app's subject, drawn as decor.

    Deliberately wordless: this is a motif, not a screenshot, and a balloon with
    invented dialogue in it would be pretending to show the product.
    """
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=(y1 - y0) * 0.34, outline=color, width=width)
    # A short straight tail off the bottom edge, angled like the renderer's.
    tx = x0 + (x1 - x0) * 0.30
    ty = y1 - width // 2
    d.line([(tx, ty), (tx + tail_dx, ty + (y1 - y0) * 0.30)], fill=color, width=width)
    return layer


def build():
    S = (W * SS, H * SS)
    cx, cy = S[0] / 2, S[1] / 2
    img = Image.new("RGBA", S, VOID)

    # --- background: two low blooms that give the black some depth ----------
    img.alpha_composite(bloom(S, (S[0] * 0.18, S[1] * 0.20), S[0] * 0.42, CYAN, 30))
    img.alpha_composite(bloom(S, (S[0] * 0.86, S[1] * 0.88), S[0] * 0.40, PINK, 26))

    # --- decorative balloons, out in the crop zone on purpose ---------------
    bw = int(2 * SS)
    deco = Image.new("RGBA", S, (0, 0, 0, 0))
    deco.alpha_composite(
        balloon(S, (S[0] * 0.03, S[1] * 0.16, S[0] * 0.20, S[1] * 0.38), (*CYAN[:3], 70), bw, S[0] * 0.02)
    )
    deco.alpha_composite(
        balloon(S, (S[0] * 0.81, S[1] * 0.60, S[0] * 0.97, S[1] * 0.82), (*PINK[:3], 70), bw, -S[0] * 0.02)
    )
    img.alpha_composite(glow(deco, S[0] * 0.006, passes=1))
    img.alpha_composite(deco)

    # --- size the wordmark to the safe box ----------------------------------
    safe_w = S[0] * SAFE_W
    word_m, word_rest, label = "m", "Comic", "'96"

    fs = int(S[1] * 0.42)
    for _ in range(80):
        f = ImageFont.truetype(FONT_PATH, fs)
        bfont = ImageFont.truetype(FONT_PATH, max(8, int(fs * 0.42)))
        bb = bfont.getbbox(label)
        badge_w = (bb[2] - bb[0]) + max(8, int(fs * 0.42)) * 0.60
        total = f.getlength(word_m) + f.getlength(word_rest) + badge_w + fs * 0.16
        if total <= safe_w:
            break
        fs = int(fs * 0.95)

    font = ImageFont.truetype(FONT_PATH, fs)
    w_m = font.getlength(word_m)
    w_rest = font.getlength(word_rest)

    bfs = max(8, int(fs * 0.42))
    bfont = ImageFont.truetype(FONT_PATH, bfs)
    bb = bfont.getbbox(label)
    pad_x, pad_y = bfs * 0.30, bfs * 0.12
    bdg_w = (bb[2] - bb[0]) + pad_x * 2
    bdg_h = (bb[3] - bb[1]) + pad_y * 2
    gap = fs * 0.16

    total = w_m + w_rest + gap + bdg_w
    left = cx - total / 2

    asc, desc = font.getmetrics()
    line_h = asc + desc
    # The wordmark sits above centre; the tagline takes the space below it.
    top = cy - line_h * 0.72

    # --- the wordmark, each colour on its own layer so it can glow ----------
    lm = Image.new("RGBA", S, (0, 0, 0, 0))
    ImageDraw.Draw(lm).text((left, top), word_m, font=font, fill=PINK)
    lc = Image.new("RGBA", S, (0, 0, 0, 0))
    ImageDraw.Draw(lc).text((left + w_m, top), word_rest, font=font, fill=CYAN)

    badge = Image.new("RGBA", (int(bdg_w), int(bdg_h)), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    bd.rounded_rectangle((0, 0, bdg_w - 1, bdg_h - 1), radius=bdg_h * 0.30, fill=LIME)
    bd.text((pad_x - bb[0], pad_y - bb[1]), label, font=bfont, fill=INK)
    badge = badge.rotate(4, expand=True, resample=Image.BICUBIC)

    lb = Image.new("RGBA", S, (0, 0, 0, 0))
    # Badge rides on the wordmark's x-height, the way the header sets it.
    lb.alpha_composite(badge, (int(left + w_m + w_rest + gap), int(top + asc - bdg_h * 1.02)))

    for layer in (lm, lc, lb):
        img.alpha_composite(glow(layer, S[1] * 0.055, passes=2))
    for layer in (lm, lc, lb):
        img.alpha_composite(glow(layer, S[1] * 0.018, passes=3))
    for layer in (lm, lc, lb):
        img.alpha_composite(layer)

    # --- tagline + studio ---------------------------------------------------
    tfs = max(10, int(fs * 0.24))
    tfont = ImageFont.truetype(FONT_PATH, tfs)
    tw = tfont.getlength(TAGLINE)
    ty = top + line_h * 1.02
    tl = Image.new("RGBA", S, (0, 0, 0, 0))
    ImageDraw.Draw(tl).text((cx - tw / 2, ty), TAGLINE, font=tfont, fill=TEXT)
    img.alpha_composite(glow(tl, S[1] * 0.012, passes=1))
    img.alpha_composite(tl)

    sfs = max(9, int(fs * 0.15))
    sfont = ImageFont.truetype(FONT_PATH, sfs)
    sw = sfont.getlength(STUDIO)
    sy = cy + S[1] * (SAFE_H / 2) - sfs * 1.4
    ImageDraw.Draw(img).text((cx - sw / 2, sy), STUDIO, font=sfont, fill=MUTED)

    out = img.resize((W, H), Image.LANCZOS)
    # Play rejects alpha: flatten onto the void and save 24-bit.
    flat = Image.new("RGB", (W, H), VOID[:3])
    flat.paste(out, (0, 0), out)
    return flat


os.makedirs(OUTDIR, exist_ok=True)
path = os.path.join(OUTDIR, "feature-graphic.png")
build().save(path)
print(f"wrote {path} ({W}x{H}, 24-bit, no alpha)")
