#!/usr/bin/env python3
"""Draw a mock screenshot of Mooring for the README (SVG; render to PNG with cairosvg).

A made-up session, not a capture: three repos in the sidebar, a split view comparing a
Claude Code tab with a Codex tab. Colours are the app's Mocha theme.

    python3 docs/brand/build_mock.py      # writes docs/brand/mooring-mock.svg
"""
import os
from html import escape

from build_brand import M_PATH

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mooring-mock.svg")

C = dict(crust="#11111b", mantle="#181825", base="#1e1e2e", surface="#313244", overlay="#6c7086",
         text="#cdd6f4", sub="#a6adc8", dim="#7f849c", blue="#89b4fa", red="#f38ba8", green="#a6e3a1",
         yellow="#f9e2af", mauve="#cba6f7", teal="#94e2d5", peach="#fab387", pink="#f5c2e7")
UI = "Ubuntu, 'Segoe UI', sans-serif"
MONO = "'DejaVu Sans Mono', monospace"  # has ● ✓ ◐ ▌
W, H = 1440, 860
SIDE = 272

out = []
add = out.append


def paint(attr, color):
    """attr="#rrggbbaa" as attr + attr-opacity: not every SVG renderer reads 8-digit hex."""
    if color.startswith("#") and len(color) == 9:
        return f'{attr}="{color[:7]}" {attr}-opacity="{int(color[7:], 16) / 255:.3f}"'
    return f'{attr}="{color}"'


def text(x, y, s, size=13, fill=C["text"], weight=400, family=UI, anchor="start", opacity=1):
    add(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
        f'{paint("fill", fill)} text-anchor="{anchor}" opacity="{opacity}" xml:space="preserve">{escape(s)}</text>')


def rect(x, y, w, h, fill, r=0, stroke=None, width=1):
    line = f' {paint("stroke", stroke)} stroke-width="{width}"' if stroke else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" {paint("fill", fill)}{line}/>')


# ---- window frame ------------------------------------------------------------------------------
rect(0, 0, W, H, C["crust"], 12)
add(f'<g transform="translate(14 10) scale(0.07)"><path d="{M_PATH}" fill="none" stroke="{C["teal"]}" '
    'stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></g>')
text(42, 27, "[WSL] api-gateway · Refactor auth middleware — Mooring", 12, C["sub"])
# minimise, maximise, close, drawn (the UI font has no glyphs for them)
add(f'<g fill="none" stroke="{C["sub"]}" stroke-width="1.2"><path d="M{W - 126} 22h10"/>'
    f'<rect x="{W - 81}" y="17" width="10" height="10" rx="1.5"/><path d="M{W - 37} 17l10 10M{W - 27} 17l-10 10"/></g>')

# ---- sidebar -------------------------------------------------------------------------------------
y0 = 52


def icon_btn(x, y, d):
    add(f'<g transform="translate({x} {y})" fill="none" stroke="{C["sub"]}" stroke-width="1.75" '
        f'stroke-linecap="round" stroke-linejoin="round">{d}</g>')


icon_btn(18, y0 + 4, '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>')
icon_btn(50, y0 + 4, '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="9" r=".6" fill="#a6adc8"/><circle cx="14" cy="8" r=".6" fill="#a6adc8"/>')
icon_btn(82, y0 + 4, '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M7 16h10"/>')
text(186, y0 + 21, "+ WSL", 12, C["sub"], 600)
text(234, y0 + 21, "+ PS", 12, C["sub"], 600)

TABS = [  # group, (title, sub, monogram, colour, shell, status)
    ("Pinned", None, [("Refactor auth middleware", "WSL · api-gateway", "AG", C["blue"], "wsl", "active-working")]),
    ("api-gateway", C["blue"], [("Rate-limit tests", "WSL · api-gateway", "AG", C["mauve"], "wsl", "needs"),
                                ("Review PR #482", "WSL · api-gateway", "AG", C["blue"], "wsl", "idle")]),
    ("web-app", C["green"], [("Dark mode for settings", "WSL · web-app", "WA", C["green"], "wsl", "working"),
                             ("Codex: compare approach", "WSL · web-app", "WA", C["green"], "wsl", "paired")]),
    ("infra", C["peach"], [("Terraform plan drift", "PowerShell · infra", "IN", C["peach"], "ps", "idle")]),
]
y = y0 + 52
for group, color, rows in TABS:
    if color:
        rect(26, y - 6, 12, 4, color, 2)
    else:
        add(f'<g transform="translate(23 {y - 13}) scale(0.6)" fill="none" stroke="{C["dim"]}" stroke-width="2" '
            'stroke-linecap="round"><path d="M12 17v5"/><path d="M9 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8M15 10.76V7"/>'
            '<path d="M5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76"/></g>')
    text(46, y, group, 11, C["sub"], 600)
    text(SIDE - 22, y, str(len(rows)), 11, C["dim"], anchor="end")
    if group == "api-gateway":
        rect(SIDE - 92, y - 12, 62, 16, C["yellow"], 8)
        text(SIDE - 61, y, "1 needs you", 9.5, C["crust"], 700, anchor="middle")
    y += 14
    for title, sub, mono, col, shell, status in rows:
        active = status.startswith("active")
        if active:
            rect(10, y, SIDE - 20, 44, "#cdd6f414", 10)
        if status == "paired":
            rect(10, y, SIDE - 20, 44, "none", 10, "#cdd6f430")
        ax, ay = 18, y + 7
        rect(ax, ay, 30, 30, col if active else col + "33", 9, None if active else col + "70")
        text(ax + 15, ay + 19.5, mono, 11, C["crust"] if active else col, 700, anchor="middle")
        if status.endswith("working"):  # the light running round the avatar
            add(f'<rect x="{ax - 3}" y="{ay - 3}" width="36" height="36" rx="12" fill="none" stroke="{col}" '
                f'stroke-width="2" stroke-dasharray="40 104" stroke-linecap="round"/>')
        if status == "needs":
            add(f'<circle cx="{ax + 30}" cy="{ay}" r="5" fill="{C["yellow"]}" stroke="{C["crust"]}" stroke-width="2"/>')
        add(f'<circle cx="{ax + 29}" cy="{ay + 29}" r="5" fill="{C["peach"] if shell == "wsl" else C["blue"]}" '
            f'stroke="{C["crust"]}" stroke-width="2"/>')
        text(58, y + 20, title, 13, C["text"], 500)
        text(58, y + 35, sub, 11, C["dim"])
        y += 48
    y += 18

# ---- content card: header + split view ------------------------------------------------------------
cx, cy, cw, ch = SIDE, 44, W - SIDE - 8, H - 52
rect(cx, cy, cw, ch, C["mantle"], 14, "#cdd6f418")
rect(cx, cy, cw, 34, "#89b4fa0d", 14)
add(f'<line x1="{cx}" y1="{cy + 34}" x2="{cx + cw}" y2="{cy + 34}" stroke="{C["blue"]}" stroke-opacity=".55"/>')
rect(cx + 10, cy + 7, 90, 20, C["blue"], 6)
text(cx + 55, cy + 21, "api-gateway", 11, C["crust"], 700, anchor="middle")
text(cx + 112, cy + 22, "Refactor auth middleware", 12.5, C["text"], 500)
text(cx + 290, cy + 22, "WSL", 10, C["dim"], 700)
text(cx + cw - 150, cy + 22, "~/code/api-gateway", 11, C["dim"], anchor="end")
for i, d in enumerate(('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
                       '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>',
                       '<rect width="18" height="18" x="3" y="3" rx="2"/>')):
    add(f'<g transform="translate({cx + cw - 110 + i * 32} {cy + 9}) scale(0.68)" fill="none" stroke="{C["sub"]}" '
        f'stroke-width="2" stroke-linecap="round">{d}</g>')

top = cy + 35
half = (cw - 8) // 2
panes = [
    (cx, C["blue"], "api-gateway", "Refactor auth middleware", True, [
        ("dim", "› Split the auth middleware so token checks run before rate limiting."),
        ("", ""),
        ("text", "● I'll move token validation into its own layer and keep the"),
        ("text", "  rate limiter keyed by the verified subject."),
        ("", ""),
        ("green", "  ✓ Read src/middleware/auth.ts"),
        ("green", "  ✓ Edit src/middleware/auth.ts  (+42 −18)"),
        ("green", "  ✓ Edit src/server.ts  (+6 −3)"),
        ("yellow", "  ◐ Running npm test -- auth …"),
        ("", ""),
        ("dim", "  PASS  test/auth.spec.ts (14 tests)"),
        ("dim", "  PASS  test/ratelimit.spec.ts (9 tests)"),
        ("", ""),
        ("mauve", "◐ Verifying edge cases for expired tokens…"),
    ]),
    (cx + half + 8, C["green"], "web-app", "Codex: compare approach", False, [
        ("dim", "› Same task, your way: where would you put the token check?"),
        ("", ""),
        ("text", "codex  I'd keep one middleware but short-circuit early:"),
        ("", ""),
        ("blue", "  export const auth = (req, res, next) => {"),
        ("blue", "    const token = readBearer(req)"),
        ("blue", "    if (!token) return res.status(401).end()"),
        ("blue", "    req.subject = verify(token)"),
        ("blue", "    next()"),
        ("blue", "  }"),
        ("", ""),
        ("text", "Trade-off: one hop fewer, but the limiter can't see"),
        ("text", "anonymous traffic separately."),
        ("", ""),
        ("dim", "› ▌"),
    ]),
]
for px, col, repo, title, focused, lines in panes:
    pw = half if px == cx else cw - half - 8
    rect(px, top, pw, ch - 35, "#1b1b29")
    if focused:
        add(f'<rect x="{px + .5}" y="{top + .5}" width="{pw - 1}" height="{ch - 36}" fill="none" stroke="{col}" stroke-opacity=".55"/>')
    rect(px + 12, top + 10, len(repo) * 7.2 + 16, 20, col if focused else col + "2e", 6)
    text(px + 20, top + 24, repo, 11, C["crust"] if focused else col, 700)
    text(px + 26 + len(repo) * 7.2 + 8, top + 24, title, 12, C["text"] if focused else C["sub"])
    ty = top + 58
    for kind, s in lines:
        if s:
            text(px + 16, ty, s, 14, C.get(kind, C["text"]) if kind else C["text"], family=MONO)
        ty += 21
    # the status bar Claude Code draws at the bottom
    text(px + 16, top + ch - 58, "Opus · high effort · ctx 18%" if focused else "gpt-5 · medium", 12, C["teal"], family=MONO, opacity=.85)
# divider between the halves
rect(cx + half + 3, top + (ch - 35) / 2 - 24, 2, 48, C["overlay"], 1)
# scroll handle
rect(cx + half - 12, top + 260, 8, 44, "#cdd6f42e", 4)

svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">{"".join(out)}</svg>\n'
with open(OUT, "w") as f:
    f.write(svg)
print("wrote", OUT)
