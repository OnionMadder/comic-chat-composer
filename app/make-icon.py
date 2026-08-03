"""Generate mComic '96's Android launcher icons from the app's own wordmark.

The icon is the wordmark itself, stacked for a square canvas: "mComic" with the
pink m and cyan Comic, and the lime '96 badge tucked under it at the same jaunty
tilt the header uses. Neon glow is a blurred copy of each layer underneath it,
which is what `text-shadow` does in the app's CSS.

Type is Comic Neue (OFL) — the face the app actually renders in. It ships as
woff2, which Pillow can't read, so this converts it to TTF on the fly into
`.iconfonts/` (gitignored). Requires `fonttools` + `brotli`.

Writes, for every density:
  ic_launcher.png             legacy square icon
  ic_launcher_round.png       legacy round icon
  ic_launcher_foreground.png  adaptive foreground (transparent, safe-zone aware)

Run from `app/`:  python make-icon.py
Then rebuild the APK — `npx cap sync android` does not regenerate these.
"""

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

VOID = (8, 8, 11, 255)
CYAN = (44, 255, 230, 255)
PINK = (255, 61, 154, 255)
LIME = (182, 255, 61, 255)
INK = (5, 5, 7, 255)

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

RES = os.path.join("android", "app", "src", "main", "res")
FONTDIR = ".iconfonts"
SS = 6  # supersample factor — the tilt and glow need the extra resolution


def ensure_font():
    """Comic Neue ships as woff2; Pillow needs TTF. Convert once into .iconfonts/."""
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


def draw(size, *, transparent, safe, content_frac=None):
    """Render the stacked wordmark at `size`. `safe` insets for the adaptive mask.

    `content_frac` overrides that choice outright, for the Play store icon —
    which is masked by Google rather than by the launcher and wants its own
    middle ground.
    """
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0) if transparent else VOID)

    # Adaptive icons get masked to arbitrary shapes, so keep content well inside;
    # legacy icons can breathe a little wider.
    content = S * (content_frac if content_frac is not None else (0.66 if safe else 0.80))
    cx, cy = S / 2, S / 2

    # --- size "mComic" to the content width -------------------------------
    word_m, word_rest = "m", "Comic"
    fs = int(content * 0.42)
    for _ in range(60):
        f = ImageFont.truetype(FONT_PATH, fs)
        w = f.getlength(word_m) + f.getlength(word_rest)
        if w <= content:
            break
        fs = int(fs * 0.94)
    font = ImageFont.truetype(FONT_PATH, fs)
    w_m = font.getlength(word_m)
    w_rest = font.getlength(word_rest)
    total = w_m + w_rest

    # Vertical: the wordmark sits above centre, the '96 badge below it.
    asc, desc = font.getmetrics()
    line_h = asc + desc
    top = cy - line_h * 0.78

    # --- the wordmark, each colour on its own layer so it can glow ---------
    lm = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(lm).text((cx - total / 2, top), word_m, font=font, fill=PINK)
    lc = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(lc).text((cx - total / 2 + w_m, top), word_rest, font=font, fill=CYAN)

    # --- the '96 badge: dark ink on lime, tilted like the header's ---------
    bfs = max(8, int(fs * 0.46))
    bfont = ImageFont.truetype(FONT_PATH, bfs)
    label = "'96"
    bb = bfont.getbbox(label)
    pad_x, pad_y = bfs * 0.30, bfs * 0.12
    bw = (bb[2] - bb[0]) + pad_x * 2
    bh = (bb[3] - bb[1]) + pad_y * 2
    badge = Image.new("RGBA", (int(bw), int(bh)), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    bd.rounded_rectangle((0, 0, bw - 1, bh - 1), radius=bh * 0.30, fill=LIME)
    bd.text((pad_x - bb[0], pad_y - bb[1]), label, font=bfont, fill=INK)
    badge = badge.rotate(4, expand=True, resample=Image.BICUBIC)

    lb = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lb.alpha_composite(badge, (int(cx - badge.width / 2), int(top + line_h * 0.92)))

    # --- compose: glow under, crisp on top --------------------------------
    # Two radii per layer — a tight bright halo hugging the letterforms and a
    # wider soft bloom, which is what reads as neon rather than as a drop shadow.
    for layer in (lm, lc, lb):
        img.alpha_composite(glow(layer, S * 0.045, passes=2))
    for layer in (lm, lc, lb):
        img.alpha_composite(glow(layer, S * 0.016, passes=3))
    for layer in (lm, lc, lb):
        img.alpha_composite(layer)

    return img.resize((size, size), Image.LANCZOS)


def rounded_mask(size, radius_frac):
    m = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        (0, 0, size * SS - 1, size * SS - 1), radius=int(size * SS * radius_frac), fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def circle_mask(size):
    m = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * SS - 1, size * SS - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


written = 0
for density, size in LEGACY.items():
    out = os.path.join(RES, f"mipmap-{density}")
    os.makedirs(out, exist_ok=True)

    base = draw(size, transparent=False, safe=False)

    square = base.copy()
    square.putalpha(rounded_mask(size, 0.18))
    square.save(os.path.join(out, "ic_launcher.png"))

    rnd = base.copy()
    rnd.putalpha(circle_mask(size))
    rnd.save(os.path.join(out, "ic_launcher_round.png"))

    draw(ADAPTIVE[density], transparent=True, safe=True).save(
        os.path.join(out, "ic_launcher_foreground.png")
    )
    written += 3

print(f"wrote {written} icon files across {len(LEGACY)} densities")

# --- the Play store icon --------------------------------------------------
# 512x512, and deliberately NOT given the rounded mask the legacy launcher icon
# gets: Google rounds it itself, and a pre-rounded source would be rounded twice
# and end up with pale corners. Full-bleed void square instead.
#
# Content sits at 0.74 rather than the launcher's 0.80 — Play's corner radius is
# heavier than the launcher's, and at 0.80 the `m` and the '96 badge run close
# enough to the corners to risk being clipped in the smaller placements.
os.makedirs("store", exist_ok=True)
store_icon = draw(512, transparent=False, safe=False, content_frac=0.74)
# Kept 32-bit (RGBA) but fully opaque, which is not the same as flattening to
# RGB. Play's app-icon spec asks for a 32-bit PNG, and a 24-bit file risks being
# rejected by the Console — but a listing icon with genuinely transparent pixels
# renders unpredictably against Play's own backgrounds. Compositing onto an
# opaque void satisfies both: every pixel has alpha 255, and the file is still
# 32-bit.
flat = Image.new("RGBA", store_icon.size, VOID)
flat.alpha_composite(store_icon)
flat.save(os.path.join("store", "icon-512.png"))
print("wrote store/icon-512.png (512x512, 32-bit, fully opaque)")
