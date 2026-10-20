#!/usr/bin/env python3
"""Build the Mooring brand files (SVG) from one set of measurements.

The mark: an M drawn as one mooring line that loops once where it dips. Everything is monoline
with round caps; the wordmark is constructed from the same stroke, so no font is involved.

    python3 docs/brand/build_brand.py        # writes docs/brand/*.svg
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))

TEAL = "#94E2D5"       # on dark (Catppuccin Mocha teal)
TEAL_DEEP = "#179299"  # on light (Catppuccin Latte teal)
INK = "#1E1E2E"        # tile / dark background (Mocha base)
TEXT_DARK = "#CDD6F4"  # wordmark on dark
TEXT_LIGHT = "#1E1E2E" # wordmark on light

W = 26  # stroke width of the mark, in the 256 grid

# The M: stems 52..204, diagonals at 45°, crossing above a loop of radius 28 that dips just
# below the baseline (optical overshoot for the round form).
M_PATH = "M52 204 V64 L152 164 A28 28 0 1 1 104 164 L204 64 V204"
# 16 px cut: heavier line, the loop's counter dropped (it would close up anyway).
M_SMALL = '<path d="M48 210 V60 L148 160 M108 160 L208 60 V210" fill="none" stroke="{c}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/><circle cx="128" cy="182" r="40" fill="{c}"/>'


def mark(color, width=W):
    return f'<path d="{M_PATH}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
            f'<title>{title}</title>{body}</svg>\n')


# ---- wordmark "mooring": stroke-centre geometry, x-height 109..187 (ink 96..200) ----------------
R = 39          # bowl / arch radius
TOP, BASE = 109, 187
MID = (TOP + BASE) / 2
GAP = 28        # ink gap between letters


def letters():
    """(path data, advance) per letter, each drawn from x = 0."""
    arch = lambda x: f"M{x} {BASE} V{MID} A{R} {R} 0 0 1 {x + 2 * R} {MID} V{BASE}"
    m = (f"M0 {TOP} V{BASE} " + arch(0) + " " + arch(2 * R).replace(f"M{2 * R} {BASE} V{MID} ", f"M{2 * R} {MID} "), 4 * R)
    o = (f"M{R} {MID - R} A{R} {R} 0 1 1 {R - 0.01} {MID - R} Z", 2 * R)
    r = (f"M0 {TOP} V{BASE} M0 {MID} A{R} {R} 0 0 1 {R} {TOP}", R)
    i = (f"M0 {TOP} V{BASE}", 0)
    n = (f"M0 {TOP} V{BASE} " + arch(0).replace(f"M0 {BASE} V{MID} ", f"M0 {MID} "), 2 * R)
    g = (f"M{R} {MID - R} A{R} {R} 0 1 1 {R - 0.01} {MID - R} Z M{2 * R} {TOP} V{BASE + 22} "
         f"A{R} {R} 0 0 1 {R} {BASE + 22 + R} L{R - 12} {BASE + 22 + R}", 2 * R)
    return [("m", m), ("o", o), ("o", o), ("r", r), ("i", i), ("n", n), ("g", g)]


def wordmark(color, x0=0):
    parts, x = [], x0
    for ch, (d, adv) in letters():
        parts.append(f'<path transform="translate({x} 0)" d="{d}" fill="none" stroke="{color}" '
                     f'stroke-width="{W}" stroke-linecap="round" stroke-linejoin="round"/>')
        if ch == "i":  # the tittle: a round dot one stroke wide above the x-height
            parts.append(f'<circle cx="{x}" cy="{TOP - 40}" r="{W * 0.62:.1f}" fill="{color}"/>')
        x += adv + W + GAP
    return "".join(parts), x - GAP - W  # width of the ink run (stroke centres)


def main():
    files = {}
    files["mooring-symbol.svg"] = svg(256, 256, mark("#000"), "Mooring")
    files["mooring-symbol-teal.svg"] = svg(256, 256, mark(TEAL), "Mooring")
    files["mooring-symbol-deep.svg"] = svg(256, 256, mark(TEAL_DEEP), "Mooring")
    files["mooring-symbol-white.svg"] = svg(256, 256, mark("#FFF"), "Mooring")
    files["mooring-symbol-small.svg"] = svg(256, 256, M_SMALL.format(c="#000"), "Mooring (16 px)")

    # app icon: the mark on a rounded Mocha tile, inset so it reads at taskbar sizes
    tile = f'<rect width="256" height="256" rx="56" fill="{INK}"/>'
    files["mooring-app-icon.svg"] = svg(256, 256, tile + f'<g transform="translate(36 28) scale(0.72)">{mark(TEAL, 30)}</g>', "Mooring")
    files["mooring-app-icon-small.svg"] = svg(256, 256, tile + f'<g transform="translate(28 26) scale(0.78)">{M_SMALL.format(c=TEAL)}</g>', "Mooring")

    # wordmark and horizontal lockups (symbol height 256, wordmark x-height ~ 0.4 of it)
    for name, sym, word in (("dark", TEAL, TEXT_DARK), ("light", TEAL_DEEP, TEXT_LIGHT)):
        body, width = wordmark(word)
        scale = 0.78
        wx = 256 + 56
        lock = (mark(sym) + f'<g transform="translate({wx} {30}) scale({scale})">{body}</g>')
        total = int(wx + (width + W) * scale + 24)
        files[f"mooring-lockup-{name}.svg"] = svg(total, 256, lock, "Mooring")
    body, width = wordmark("#000", W)
    files["mooring-wordmark.svg"] = svg(int(width + 2 * W), 280, body, "mooring")

    # README header: lockup on the app's dark base, with the one-line promise
    body, width = wordmark(TEXT_DARK)
    left = (1280 - (188 + (width + W) * 0.58)) / 2  # centre symbol + gap + wordmark
    banner = (f'<rect width="1280" height="360" rx="28" fill="{INK}"/>'
              f'<g transform="translate({left - 24:.0f} 52) scale(0.62)">{mark(TEAL)}</g>'
              f'<g transform="translate({left + 188:.0f} 54) scale(0.58)">{body}</g>'
              f'<text x="{left + 192:.0f}" y="262" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="30" '
              f'fill="#A6ADC8">Your terminals and their agents, moored overnight.</text>')
    files["mooring-readme-header.svg"] = svg(1280, 360, banner, "Mooring")

    for fname, text in files.items():
        with open(os.path.join(OUT, fname), "w") as f:
            f.write(text)
        print("wrote", fname)


if __name__ == "__main__":
    main()
