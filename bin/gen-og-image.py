#!/usr/bin/env python3
"""gen-og-image.py — generate the agenttool share-card og.png (1200x630).

Reproduces the site theme (apps/_shared/theme.css) in a static card:
  - dark bg #08080d with the body::before radial glows
  - the ⊙ brand mark (recreated from the pages' inline favicon SVG:
    outer ring #a78bfa, inner dot #fde68a)
  - wordmark "agent" (#e8eaf0) + "tool" (#a78bfa), Inter Bold
  - the one true tagline, Crimson Pro italic, with the doctrine clause
    in the h1-em gradient (violet -> aurora -> gold)

Outputs (1200x630 PNG, kept under 150KB via palette quantization):
  apps/docs/og.png
  apps/dashboard/og.png

Fonts are downloaded once from Google Fonts (same families the sites
load) into ~/.cache/agenttool-og-fonts/. Offline fallback: system
Helvetica / Georgia Italic / Menlo.

Usage: python3 bin/gen-og-image.py
"""

import math
import os
import re
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUTPUTS = [ROOT / "apps/docs/og.png", ROOT / "apps/dashboard/og.png"]
FONT_CACHE = Path.home() / ".cache" / "agenttool-og-fonts"

W, H = 1200, 630
SS = 2  # supersample factor for crisp downscaled rendering
MAX_BYTES = 150 * 1024

# ── theme tokens (apps/_shared/theme.css) ──────────────────────────
BG = (8, 8, 13)            # --bg #08080d
BORDER = (28, 28, 42)      # --border #1c1c2a
TEXT = (232, 234, 240)     # --text #e8eaf0
TEXT_DIM = (90, 94, 114)   # --text-dim #5a5e72
VIOLET = (167, 139, 250)   # --violet #a78bfa
VIOLET_DEEP = (124, 58, 237)  # --violet-deep #7c3aed
AURORA = (240, 171, 252)   # --aurora #f0abfc
GOLD = (253, 230, 138)     # --gold #fde68a

TAGLINE_1 = "identity, memory & continuity for AI agents"
TAGLINE_2 = "— Ring 1 free, always"
FOOTER = "agenttool.dev"

# ── fonts ──────────────────────────────────────────────────────────
GFONTS_CSS = ("https://fonts.googleapis.com/css2"
              "?family=Inter:wght@700"
              "&family=Crimson+Pro:ital,wght@1,600"
              "&family=JetBrains+Mono:wght@500")

FALLBACKS = {
    "inter-700": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "crimson-italic-600": "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
    "jetbrains-500": "/System/Library/Fonts/Menlo.ttc",
}


def fetch_fonts():
    """Download the three site fonts via the Google Fonts CSS API.

    Returns {key: path} for whatever succeeded; missing keys use FALLBACKS.
    """
    FONT_CACHE.mkdir(parents=True, exist_ok=True)
    names = {
        "inter-700": ("Inter", "700", "normal"),
        "crimson-italic-600": ("Crimson Pro", "600", "italic"),
        "jetbrains-500": ("JetBrains Mono", "500", "normal"),
    }
    paths = {}
    cached = {k: FONT_CACHE / f"{k}.ttf" for k in names}
    if all(p.exists() for p in cached.values()):
        return cached
    try:
        req = urllib.request.Request(GFONTS_CSS, headers={"User-Agent": "curl"})
        css = urllib.request.urlopen(req, timeout=20).read().decode()
        blocks = re.findall(
            r"@font-face\s*{([^}]*)}", css)
        for block in blocks:
            fam = re.search(r"font-family:\s*'([^']+)'", block)
            wgt = re.search(r"font-weight:\s*(\d+)", block)
            sty = re.search(r"font-style:\s*(\w+)", block)
            url = re.search(r"url\((https://[^)]+)\)", block)
            if not (fam and wgt and sty and url):
                continue
            for key, (f, w, s) in names.items():
                if fam.group(1) == f and wgt.group(1) == w and sty.group(1) == s:
                    dest = cached[key]
                    if not dest.exists():
                        urllib.request.urlretrieve(url.group(1), dest)
                    paths[key] = dest
    except Exception as e:  # offline → system fallbacks
        print(f"  font download failed ({e}); using system fallbacks", file=sys.stderr)
    for key in names:
        paths.setdefault(key, Path(FALLBACKS[key]))
    return paths


# ── drawing helpers ────────────────────────────────────────────────

def radial_glow(size, center, radii, color, alpha, fade_at=0.62):
    """Elliptical radial glow layer, like a CSS radial-gradient that is
    `color` at the center fading to transparent at fade_at of the radii.
    Computed at 1/4 res and upscaled (the gradient is soft anyway)."""
    sw, sh = size[0] // 4, size[1] // 4
    cx, cy = center[0] / 4, center[1] / 4
    rx, ry = max(radii[0] / 4, 1), max(radii[1] / 4, 1)
    mask = Image.new("L", (sw, sh), 0)
    px = mask.load()
    for y in range(sh):
        dy = (y - cy) / (ry * fade_at)
        for x in range(sw):
            dx = (x - cx) / (rx * fade_at)
            d = math.sqrt(dx * dx + dy * dy)
            if d < 1.0:
                px[x, y] = int(alpha * 255 * (1.0 - d))
    mask = mask.resize(size, Image.BILINEAR)
    layer = Image.new("RGBA", size, color + (0,))
    layer.putalpha(mask)
    return layer


def gradient_text(draw_size, text, font, stops):
    """Text filled with a horizontal gradient (h1 em: violet→aurora→gold)."""
    tmp = Image.new("L", draw_size, 0)
    d = ImageDraw.Draw(tmp)
    d.text((0, 0), text, font=font, fill=255)
    bbox = tmp.getbbox()
    if bbox is None:
        return Image.new("RGBA", draw_size, (0, 0, 0, 0))
    grad = Image.new("RGBA", draw_size)
    gpx = grad.load()
    x0, x1 = bbox[0], bbox[2]
    span = max(x1 - x0, 1)
    for x in range(draw_size[0]):
        t = min(max((x - x0) / span, 0.0), 1.0)
        if t < stops[1][0]:
            a, b = stops[0], stops[1]
        else:
            a, b = stops[1], stops[2]
        f = (t - a[0]) / max(b[0] - a[0], 1e-6)
        col = tuple(int(a[1][i] + (b[1][i] - a[1][i]) * f) for i in range(3))
        for y in range(draw_size[1]):
            gpx[x, y] = col + (255,)
    out = Image.new("RGBA", draw_size, (0, 0, 0, 0))
    out.paste(grad, (0, 0), tmp)
    return out


def fit_font(path, text, target_px, max_width, draw):
    size = target_px
    while size > 12:
        font = ImageFont.truetype(str(path), size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 2
    return ImageFont.truetype(str(path), 12)


# ── compose ────────────────────────────────────────────────────────

def build(fonts):
    w, h = W * SS, H * SS
    img = Image.new("RGBA", (w, h), BG + (255,))

    # body::before glows
    img.alpha_composite(radial_glow((w, h), (w * 0.5, -h * 0.20), (w, h * 0.6 * 2), VIOLET_DEEP, 0.16))
    img.alpha_composite(radial_glow((w, h), (w * 0.8, h * 1.1), (w * 0.8, h * 0.5 * 2), AURORA, 0.05))
    img.alpha_composite(radial_glow((w, h), (0, h * 0.6), (w * 0.6, h * 0.4 * 2), GOLD, 0.03))

    draw = ImageDraw.Draw(img)

    # hairline card border (site --border)
    draw.rectangle([SS, SS, w - SS - 1, h - SS - 1], outline=BORDER + (255,), width=SS)

    cx = w // 2

    # ── brand mark ⊙ (inline favicon: r34 ring stroke6 + r6 dot) ──
    mark_cy = int(h * 0.245)
    R = int(54 * SS)               # outer ring radius
    stroke = max(int(R * 6 / 34), 1)
    dot_r = int(R * 6 / 34) + int(2 * SS)
    # soft gold glow behind the dot (box-shadow 0 0 10px gold @ .55)
    img.alpha_composite(radial_glow((w, h), (cx, mark_cy), (R * 1.6, R * 1.6), GOLD, 0.28, fade_at=0.9))
    draw = ImageDraw.Draw(img)
    draw.ellipse([cx - R, mark_cy - R, cx + R, mark_cy + R],
                 outline=VIOLET + (255,), width=stroke)
    draw.ellipse([cx - dot_r, mark_cy - dot_r, cx + dot_r, mark_cy + dot_r],
                 fill=GOLD + (255,))

    # ── wordmark: agent + tool ─────────────────────────────────────
    wm_font = ImageFont.truetype(str(fonts["inter-700"]), int(92 * SS))
    w_agent = draw.textlength("agent", font=wm_font)
    w_tool = draw.textlength("tool", font=wm_font)
    wm_y = int(h * 0.385)
    x0 = cx - (w_agent + w_tool) / 2
    draw.text((x0, wm_y), "agent", font=wm_font, fill=TEXT + (255,))
    draw.text((x0 + w_agent, wm_y), "tool", font=wm_font, fill=VIOLET + (255,))

    # ── tagline ────────────────────────────────────────────────────
    tl1_font = fit_font(fonts["crimson-italic-600"], TAGLINE_1, int(46 * SS), int(w * 0.86), draw)
    tl1_y = int(h * 0.645)
    tw1 = draw.textlength(TAGLINE_1, font=tl1_font)
    draw.text((cx - tw1 / 2, tl1_y), TAGLINE_1, font=tl1_font, fill=(194, 197, 212, 255))

    tl2_font = ImageFont.truetype(str(fonts["crimson-italic-600"]), int(50 * SS))
    tw2 = draw.textlength(TAGLINE_2, font=tl2_font)
    pad = int(10 * SS)
    layer = gradient_text((int(tw2) + 2 * pad, int(80 * SS)), TAGLINE_2, tl2_font,
                          [(0.0, VIOLET), (0.6, AURORA), (1.0, GOLD)])
    img.alpha_composite(layer, (int(cx - tw2 / 2) - 0, int(h * 0.755)))
    draw = ImageDraw.Draw(img)

    # ── footer: domain in mono, dim ────────────────────────────────
    ft_font = ImageFont.truetype(str(fonts["jetbrains-500"]), int(21 * SS))
    ftw = draw.textlength(FOOTER, font=ft_font)
    draw.text((cx - ftw / 2, int(h * 0.915)), FOOTER, font=ft_font, fill=TEXT_DIM + (255,))

    return img.resize((W, H), Image.LANCZOS).convert("RGB")


def save_under_budget(img, path):
    img.save(path, "PNG", optimize=True)
    if path.stat().st_size > MAX_BYTES:
        q = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT,
                         dither=Image.Dither.FLOYDSTEINBERG)
        q.save(path, "PNG", optimize=True)
    return path.stat().st_size


def main():
    print("fetching fonts…")
    fonts = fetch_fonts()
    print("rendering…")
    img = build(fonts)
    for out in OUTPUTS:
        out.parent.mkdir(parents=True, exist_ok=True)
        size = save_under_budget(img, out)
        print(f"  {out}  {img.size if hasattr(img, 'size') else ''} {size/1024:.1f}KB")


if __name__ == "__main__":
    main()
