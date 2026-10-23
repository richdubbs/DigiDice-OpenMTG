"""Generate the DigiDice card back (SVG) for OpenMTG, and its mana-color sleeves. Circuit-board theme matching the DigiDice chip logo.

Usage: python -I make_cardback.py <logo_png> <out_dir>             card-back.svg (self-contained, logo embedded) and digidice-mark-transparent.png
       python -I make_cardback.py <logo_png> <out_dir> --sleeves  the 31 mana-color sleeves (every color and every combination) in <out_dir>/sleeves/,
                                                                   plus sleeves.json, the list the client reads
Design has 180-degree rotational symmetry like a real card back. The sleeves keep the layout and recolor it: one color is the classic two-tone (the color
and a lighter shade); in a combination every trace, pin and die takes the color of its direction from the center (a color wheel over half a turn, so the
symmetry holds), and the frame and border blend between them. The logo is recolored the same way (its blue part to the first color). No mana symbols:
the brand rules forbid combining DigiDice marks with Wizards' symbols (docs/design/branding.md).
"""
import base64, colorsys, io, json, math, os, random, sys
from PIL import Image

LOGO, OUT = sys.argv[1], sys.argv[2]
SLEEVES = '--sleeves' in sys.argv[3:]
W, H = 745, 1040
CX, CY = W / 2, H / 2
BLUE, BLUE_DEEP, MAGENTA, WHITE = '#1FB8FF', '#0098F0', '#F500F5', '#E8E8F0'

# Logo: turn the black background into transparency (alpha = brightness), so it sits on any dark color.
im = Image.open(LOGO).convert('RGB')
mark = Image.new('RGBA', im.size)
px = []
for r, g, b in im.getdata():
    a = max(r, g, b)
    px.append((0, 0, 0, 0) if a == 0 else (min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a), a))
mark.putdata(px)

def png_b64(img):
    buf = io.BytesIO(); img.save(buf, 'PNG')
    return base64.b64encode(buf.getvalue()).decode()

def rot(p):  # 180-degree rotation about the card center
    return (W - p[0], H - p[1])

def mirror(p):
    return (W - p[0], p[1])

def path(points):
    return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in points)

# --- Traces for the top-left quadrant (x < CX, y < CY); mirrored left->right, then rotated for the bottom half.
LOGO_SIZE = 360
LX0, LY0 = CX - LOGO_SIZE / 2, CY - LOGO_SIZE / 2   # logo image top-left
BI = 0.1 * LOGO_SIZE                                 # the logo's magenta border sits 10% inside the image
top = LY0 + BI                                       # traces start on the logo's border, like chip pins
left = LX0 + BI
traces_q = [
    # (points, color, pad) ; pad: 'ring' | 'dot' | 'via' | None
    ([(CX - 30, top), (CX - 30, top - 85), (CX - 70, top - 125), (CX - 70, 160)], BLUE, 'ring'),
    ([(CX - 70, top), (CX - 70, top - 50), (CX - 120, top - 100), (CX - 178, top - 100)], BLUE, 'dot'),
    ([(CX - 110, top), (CX - 110, top - 25), (CX - 145, top - 60), (CX - 235, top - 60), (CX - 258, top - 83)], MAGENTA, 'ring'),
    ([(left, CY - 110), (left - 55, CY - 110), (left - 100, CY - 155), (left - 100, 255), (left - 130, 225)], BLUE, 'ring'),
    ([(left, CY - 70), (left - 75, CY - 70), (left - 120, CY - 115), (left - 120, 335)], BLUE, 'dot'),
    ([(left, CY - 30), (left - 40, CY - 30), (left - 70, CY), (left - 112, CY)], MAGENTA, 'dot'),
    ([(CX - 30, 160), (CX - 30, 112)], BLUE, 'via'),
    ([(CX - 178, top - 100), (CX - 178, 190), (CX - 208, 160)], BLUE, 'via'),
]
# A trace that continues another one (the via after a dot pad) takes that trace's color in a sleeve.
CONTINUES = {7: 1}
traces = []
for i, (pts, col, pad) in enumerate(traces_q):
    for f in (lambda p: p, mirror):
        q = [f(p) for p in pts]
        anchor = f(traces_q[CONTINUES.get(i, i)][0][0])   # where the trace (or the one it continues) leaves the logo
        traces.append((q, col, pad, anchor, i))
        traces.append(([rot(p) for p in q], col, pad, rot(anchor), i))

# --- Chip frame (octagon, like the logo's chip outline)
M_OUT = 20          # magenta outer border inset
M_CHIP = 46         # blue chip frame inset
CH = 54             # chamfer
def octagon(inset, ch):
    x0, y0, x1, y1 = inset, inset, W - inset, H - inset
    return [(x0 + ch, y0), (x1 - ch, y0), (x1, y0 + ch), (x1, y1 - ch), (x1 - ch, y1), (x0 + ch, y1), (x0, y1 - ch), (x0, y0 + ch)]
chip = octagon(M_CHIP, CH)

# Pins through the chip frame: left side upper, and (rotated) right side lower - like the logo.
pins = []
for i, y in enumerate((300, 330, 360)):
    p = [(M_CHIP + 6, y), (M_CHIP - 10, y), (M_CHIP - 16, y + (6 if i == 2 else -6 if i == 0 else 0))]
    pins.append([(M_CHIP + 40, y), (M_CHIP, y), (M_OUT + 6, y)])
pins += [[rot(p) for p in pin] for pin in pins]

# --- Die-face chips in the corners (pip pads). TL/BR show six, TR/BL show five.
def die(cx, cy, n, size=86):
    s = size / 2
    ch = 14
    body = [(cx - s + ch, cy - s), (cx + s - ch, cy - s), (cx + s, cy - s + ch), (cx + s, cy + s - ch), (cx + s - ch, cy + s), (cx - s + ch, cy + s), (cx - s, cy + s - ch), (cx - s, cy - s + ch)]
    d = s * 0.52
    layouts = {
        5: [(-d, -d), (d, -d), (0, 0), (-d, d), (d, d)],
        6: [(-d, -d), (d, -d), (-d, 0), (d, 0), (-d, d), (d, d)],
    }
    return body, [(cx + dx, cy + dy) for dx, dy in layouts[n]]
dice = [die(150, 150, 6), die(W - 150, 150, 5), die(W - 150, H - 150, 6), die(150, H - 150, 5)]

# --- Colors
def rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))

def hexc(c):
    return '#' + ''.join(f'{round(max(0.0, min(1.0, x)) * 255):02X}' for x in c)

def mix(a, b, t):  # plain sRGB mix, for the dark background tints
    return hexc(tuple(x + (y - x) * t for x, y in zip(rgb(a), rgb(b))))

def _lin(x): return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
def _gam(x): return 12.92 * x if x <= 0.0031308 else 1.055 * max(x, 0) ** (1 / 2.4) - 0.055

def oklab(h):
    r, g, b = (_lin(x) for x in rgb(h))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)

def from_oklab(L, a, b):
    l, m, s = ((L + 0.3963377774 * a + 0.2158037573 * b) ** 3, (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, (L - 0.0894841775 * a - 1.2914855480 * b) ** 3)
    return hexc((_gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), _gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
                 _gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)))

def blend(a, b, t):  # perceptual mix, so red into green does not pass through mud
    return from_oklab(*(x + (y - x) * t for x, y in zip(oklab(a), oklab(b))))

def neon(hue_deg, sat):
    """A neon color: full brightness, strongly saturated (never pale, so never white)."""
    return hexc(colorsys.hsv_to_rgb(hue_deg / 360, sat, 1.0))

def shade(h, keep):
    """`h` at full brightness with `keep` of its saturation: a lighter shade that stays clearly colored (never white)."""
    hue, sat, _v = colorsys.rgb_to_hsv(*rgb(h))
    return hexc(colorsys.hsv_to_rgb(hue, sat * keep, 1.0))

# --- SVG
def card_svg(t):
    """The card back for a theme: the classic back (BLUE/MAGENTA, exactly as before) or a sleeve (see sleeve_theme)."""
    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    o.append(f'<title>{t["title"]}</title>')
    bg0, bg1, bg2 = t['bg']
    halo0, halo1 = t['halo']
    o.append(f'''<defs>
  <radialGradient id="bg" cx="50%" cy="50%" r="70%">
    <stop offset="0" stop-color="{bg0}"/><stop offset="0.55" stop-color="{bg1}"/><stop offset="1" stop-color="{bg2}"/>
  </radialGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="{halo0}" stop-opacity="0.28"/><stop offset="0.6" stop-color="{halo1}" stop-opacity="0.08"/><stop offset="1" stop-color="{halo1}" stop-opacity="0"/>
  </radialGradient>
  <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
    <circle cx="13" cy="13" r="1.3" fill="{t['main']}" fill-opacity="0.16"/>
  </pattern>
  {NEON_GLOW if t.get('depth') else GLOW}
  <filter id="softglow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="card"><rect width="{W}" height="{H}" rx="38"/></clipPath>
</defs>''')
    o.append('<g clip-path="url(#card)">')
    depth = t.get('depth', False)
    if depth:  # a sleeve: plain black behind the circuit
        o.append(f'<rect width="{W}" height="{H}" fill="#000"/>')
    else:
        o.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
        o.append(f'<path d="{path(chip)} Z" fill="url(#dots)"/>')
        # faint concentric chip outlines for depth
        for k, op in ((22, 0.10), (40, 0.06)):
            o.append(f'<path d="{path(octagon(M_CHIP + k, CH))} Z" fill="none" stroke="{t["main"]}" stroke-opacity="{op}" stroke-width="1.5"/>')
        o.append(f'<ellipse cx="{CX}" cy="{CY}" rx="300" ry="300" fill="url(#halo)"/>')
    if depth:
        o.append(DEPTH_DEFS)
    # traces
    colored = [(pts, t['trace'](col, anchor), pad) for pts, col, pad, anchor, _i in traces]
    if depth:
        # the traces and pins stand off the board: a soft shadow down and to the right of each
        o.append(f'<g filter="url(#shadow)" fill="none" stroke="#000" stroke-opacity="0.8" stroke-linecap="round" stroke-linejoin="round" transform="translate({SHADOW[0]} {SHADOW[1]})">')
        for pts, col, pad in colored:
            o.append(f'<path d="{path(pts)}" stroke-width="5"/>')
        for pad_pts, col, pad in colored:
            if pad:
                x, y = pad_pts[-1]
                o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{8 if pad == "ring" else 6.5 if pad == "dot" else 5}" fill="#000" stroke="none"/>')
        for pin in pins:
            o.append(f'<path d="{path(pin)}" stroke-width="5.5"/>')
        o.append('</g>')
    o.append('<g filter="url(#glow)" fill="none" stroke-linecap="round" stroke-linejoin="round">')
    for pts, col, pad in colored:
        o.append(f'<path d="{path(pts)}" stroke="{col}" stroke-width="3.2"/>')
    o.append('</g>')
    if depth:  # each trace is a rounded wire: its underside in shade, a lit ridge toward the light (top left) in a brighter shade of its own color
        o.append('<g fill="none" stroke="#000" stroke-opacity="0.45" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" transform="translate(0.9 1.2)">')
        for pts, col, pad in colored:
            o.append(f'<path d="{path(pts)}"/>')
        o.append('</g>')
        o.append('<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9" transform="translate(-0.7 -0.9)">')
        for pts, col, pad in colored:
            o.append(f'<path d="{path(pts)}" stroke="{shade(col, 0.6)}" stroke-width="1.2"/>')
        o.append('</g>')
    hole = '#000' if depth else '#050B18'
    o.append('<g filter="url(#glow)">')
    for pts, col, pad in colored:
        x, y = pts[-1]
        if pad == 'ring':
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="{hole}" stroke="{col}" stroke-width="3"/><circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{col}"/>')
        elif pad == 'dot':
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6.5" fill="{col}"/>')
        elif pad == 'via':
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{hole}" stroke="{col}" stroke-width="2.5"/>')
    o.append('</g>')
    # pins (the two sets are a 180-degree pair, so they always share a color)
    pin_col = t['at'](pins[0][0])
    o.append(f'<g filter="url(#glow)" fill="none" stroke="{pin_col}" stroke-width="4" stroke-linecap="round">')
    for pin in pins:
        o.append(f'<path d="{path(pin)}"/>')
    o.append('</g>')
    o.append(f'<g filter="url(#glow)" fill="{pin_col}">')
    for pin in pins:
        x, y = pin[-1]
        o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6"/>')
    o.append('</g>')
    # dice chips
    for body, pips in dice:
        if depth:
            o.append(f'<path d="{path(body)} Z" fill="#000" fill-opacity="0.85" transform="translate(7 10)" filter="url(#shadow)"/>')
        o.append(f'<path d="{path(body)} Z" fill="{"url(#chipfill)" if depth else "#06101F"}" stroke="{t["at"](body[0])}" stroke-width="3" filter="url(#glow)"/>')
        if depth:
            cx, cy = (body[0][0] + body[1][0]) / 2, (body[2][1] + body[3][1]) / 2
            o.append(f'<path d="{path([(cx + (x - cx) * 0.9, cy + (y - cy) * 0.9) for x, y in body])} Z" fill="none" stroke="url(#bevel)" stroke-width="2.4"/>')
        for x, y in pips:
            if depth:
                o.append(f'<circle cx="{x + 2:.1f}" cy="{y + 3:.1f}" r="8" fill="#000" fill-opacity="0.7"/>')
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="{"url(#pip)" if depth else WHITE}" filter="url(#glow)"/>')
    # chip frame and outer border
    if depth:
        o.append(f'<path d="{path(chip)} Z" fill="none" stroke="#000" stroke-opacity="0.8" stroke-width="11" stroke-linejoin="round" transform="translate(5 7)" filter="url(#shadow)"/>')
    if t['frame'] is None:
        o.append(f'<path d="{path(chip)} Z" fill="none" stroke="{t["main"]}" stroke-width="8" stroke-linejoin="round" filter="url(#glow)"/>')
        o.append(f'<rect x="{M_OUT}" y="{M_OUT}" width="{W - 2 * M_OUT}" height="{H - 2 * M_OUT}" rx="30" fill="none" stroke="{t["accent"]}" stroke-width="2.5" filter="url(#glow)"/>')
    else:
        o += gradient_stroke(chip, t['frame'], 'fr', 8)
        o += gradient_stroke(rounded_rect(M_OUT, 30), t['border'], 'bd', 2.5)
    if depth:  # the frame is bevelled: a shaded edge away from the light, a lit edge toward it
        o.append(f'<path d="{path(chip)} Z" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="2" stroke-linejoin="round" transform="translate(1.6 2.1)"/>')
        o.append(f'<path d="{path(chip)} Z" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2" stroke-linejoin="round" transform="translate(-1.4 -1.8)"/>')
    # center logo: a dark plate exactly under the logo's chip border hides nothing but the halo
    plate_r = 0.06 * LOGO_SIZE
    plate = f'x="{left}" y="{top}" width="{LOGO_SIZE - 2 * BI}" height="{LOGO_SIZE - 2 * BI}" rx="{plate_r}"'
    if depth:  # the logo chip sits highest: the deepest shadow
        o.append(f'<rect {plate} fill="#000" fill-opacity="0.9" transform="translate(11 16)" filter="url(#deepshadow)"/>')
    o.append(f'<rect {plate} fill="{"url(#platefill)" if depth else "#02040A"}"/>')
    logo = t['logo']
    href = f'href="data:image/png;base64,{logo}" xlink:href="data:image/png;base64,{logo}"' if t['xlink'] else f'xlink:href="data:image/png;base64,{logo}"'
    o.append(f'<image x="{LX0}" y="{LY0}" width="{LOGO_SIZE}" height="{LOGO_SIZE}" {href} filter="url(#softglow)"/>')
    if depth:
        o.append(f'<rect {plate} fill="none" stroke="url(#rim)" stroke-width="3.4"/>')
    # chip label text along the top and (rotated) bottom edges
    label = t['label']
    o.append(f'<text x="{CX}" y="{M_CHIP + 30}" fill="{t["main"]}" fill-opacity="0.75" font-family="Consolas, Menlo, monospace" font-size="17" letter-spacing="4" text-anchor="middle">{label}</text>')
    o.append(f'<text x="{CX}" y="{M_CHIP + 30}" fill="{t["main"]}" fill-opacity="0.75" font-family="Consolas, Menlo, monospace" font-size="17" letter-spacing="4" text-anchor="middle" transform="rotate(180 {CX} {CY})">{label}</text>')
    if depth:  # the sleeve's rounded plastic edge
        o.append(f'<rect x="2" y="2" width="{W - 4}" height="{H - 4}" rx="36" fill="none" stroke="url(#edge)" stroke-width="6"/>')
    o.append('</g>')
    o.append('</svg>')
    return '\n'.join(o)

GLOW = '''<filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>'''
NEON_GLOW = '''<filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="a"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="w"/>
    <feComponentTransfer in="w" result="b"><feFuncA type="linear" slope="0.6"/></feComponentTransfer>
    <feMerge><feMergeNode in="b"/><feMergeNode in="a"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>'''

# Sleeves only (the classic card-back.svg stays flat): the light comes from the top left.
SHADOW = (3.5, 5)
DEPTH_DEFS = '''<defs>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.8"/></filter>
  <filter id="deepshadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
  <linearGradient id="chipfill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#132848"/><stop offset="1" stop-color="#03070F"/></linearGradient>
  <linearGradient id="platefill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08142A"/><stop offset="1" stop-color="#010309"/></linearGradient>
  <linearGradient id="bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.7"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.65"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient>
  <radialGradient id="pip" cx="0.36" cy="0.32" r="0.75"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#E8E8F0"/><stop offset="1" stop-color="#8A91A8"/></radialGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.42"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.06"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient>
</defs>'''

TRACER_SPEED = 240   # card units per second

def tracers_svg(t):
    """The sleeve's moving lights, drawn over the card back as their own picture: a short comet runs along each trace in the trace's color, from the
    logo out to its pad (two traces carry theirs back in), then rests before it runs again. They are kept apart from the card back so that only these few
    paths are drawn again on every frame (the card back with its glows stays a still picture), and so a page can leave them out (reduced motion)."""
    rnd = random.Random(f'tracers:{t["label"]}')
    timing = {}
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<title>{t["title"]}, moving lights</title>', '<g fill="none" stroke-linecap="round" stroke-linejoin="round">']
    for pts, col, pad, anchor, i in traces:
        if i in CONTINUES:
            continue   # runs on from the trace it continues
        follow = [k for k, v in CONTINUES.items() if v == i]
        if follow:
            pts = pts + next(q for q, _c, _p, _a, j in traces if j == follow[0] and math.dist(q[0], pts[-1]) < 1)[1:]
        pts = outside_dice(pts)   # a line that tucks under a die chip ends where the chip begins: the lights are drawn over everything
        length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        if length < 80:
            continue   # the short vias
        if i in INWARD:
            pts = pts[::-1]
        # A trace and its 180-degree twin run together, so the card back keeps its symmetry while it moves.
        side = (anchor[0] < CX) == (anchor[1] < CY)
        if (i, side) not in timing:
            period = rnd.uniform(3.2, 6.0)
            timing[(i, side)] = (period, rnd.uniform(0, period))
        o += comet(pts, length, t['trace'](col, anchor), *timing[(i, side)])
    o += ['</g>', '</svg>']
    return '\n'.join(o)

INWARD = (2, 4)

def outside_dice(pts, margin=6):
    """The polyline up to where it first enters a die chip (its box grown by `margin`)."""
    boxes = [(min(x for x, _ in body) - margin, min(y for _, y in body) - margin, max(x for x, _ in body) + margin, max(y for _, y in body) + margin) for body, _p in dice]
    inside = lambda q: any(x0 <= q[0] <= x1 and y0 <= q[1] <= y1 for x0, y0, x1, y1 in boxes)
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        if not inside(b):
            out.append(b)
            continue
        lo, hi = 0.0, 1.0   # the entry point, by halving
        for _ in range(30):
            mid = (lo + hi) / 2
            q = (a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)
            lo, hi = (lo, mid) if inside(q) else (mid, hi)
        out.append((a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo))
        break
    return out

def comet(pts, length, col, period, delay):
    """One comet, brighter than the line it runs on but in its own color (thicker, glowing, its core a shade lighter, never white): a long tail, a body, a halo round the head and a
    bright core, all sharing one leading edge."""
    tail = 90
    f = min((length + tail) / TRACER_SPEED / period, 0.95)
    out = []
    for dash, width, color, opacity in ((tail, 7, col, 0.4), (40, 5, col, 0.85), (26, 15, col, 0.35), (14, 3.4, shade(col, 0.8), 1)):
        # The leading edge runs from the trace's start (offset = dash) to past its end with the whole tail behind it (offset = dash - length - tail).
        a, b = dash + 9, dash - length - tail - 9   # a little past both ends, so no round cap shows while it rests
        out.append(f'<path d="{path(pts)}" stroke="{color}" stroke-opacity="{opacity}" stroke-width="{width}" stroke-dasharray="{dash} {length + 2 * tail:.0f}" stroke-dashoffset="{a}">'
                   f'<animate attributeName="stroke-dashoffset" values="{a};{b:.1f};{b:.1f}" keyTimes="0;{f:.3f};1" dur="{period:.2f}s" begin="{delay:.2f}s" repeatCount="indefinite"/></path>')
    return out

def rounded_rect(inset, r, steps=6):
    """The outer border as a closed polyline (corner arcs in `steps` pieces), for a stroke that changes color along its length."""
    x0, y0, x1, y1 = inset, inset, W - inset, H - inset
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for s in range(steps + 1):
            a = math.radians(a0 + 90 * s / steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def gradient_stroke(pts, color_at, gid, width):
    """A closed outline stroked piece by piece, each piece with a linear gradient sampled from color_at, so the color follows the direction around the card."""
    defs, segs = [], []
    for i, (p, q) in enumerate(zip(pts, pts[1:] + pts[:1])):
        n = max(2, math.ceil(math.dist(p, q) / 20) + 1)
        stops = ''.join(f'<stop offset="{j / (n - 1):.3f}" stop-color="{color_at((p[0] + (q[0] - p[0]) * j / (n - 1), p[1] + (q[1] - p[1]) * j / (n - 1)))}"/>'
                        for j in range(n))
        defs.append(f'<linearGradient id="{gid}{i}" gradientUnits="userSpaceOnUse" x1="{p[0]:.1f}" y1="{p[1]:.1f}" x2="{q[0]:.1f}" y2="{q[1]:.1f}">{stops}</linearGradient>')
        segs.append(f'<path d="{path([p, q])}" stroke="url(#{gid}{i})"/>')
    return ['<defs>', *defs, '</defs>', f'<g filter="url(#glow)" fill="none" stroke-width="{width}" stroke-linecap="round">', *segs, '</g>']

# --- Sleeves
# The five colors as neon on the dark board, at full brightness (hue, saturation): (name, color, a neighbouring neon for the one-color two-tone). White is a neon gold (white itself would vanish into the white pips and glare), black a neon violet.
MANA = {
    'W': ('White', neon(45, 0.62), neon(56, 0.55)),
    'U': ('Blue', neon(198, 0.9), neon(186, 0.8)),
    'B': ('Black', neon(272, 0.62), neon(255, 0.5)),
    'R': ('Red', neon(6, 0.82), neon(28, 0.85)),
    'G': ('Green', neon(145, 0.82), neon(90, 0.75)),
}
# Every color and combination, each in its usual written order (pairs, then three-color, four-color, all five).
COMBOS = ['W', 'U', 'B', 'R', 'G',
          'WU', 'UB', 'BR', 'RG', 'GW', 'WB', 'UR', 'BG', 'RW', 'GU',
          'WUB', 'UBR', 'BRG', 'RGW', 'GWU', 'WBG', 'URW', 'BGU', 'RWB', 'GUR',
          'WUBR', 'UBRG', 'BRGW', 'RGWU', 'GWUB',
          'WUBRG']

def direction(p):
    """Direction of a point from the card center in degrees modulo 180 (so a point and its 180-degree twin agree), measured on the card squashed to a
    square: 90 is straight up or down, 0 straight left or right, and the corners sit at 45 and 135."""
    return math.degrees(math.atan2((CY - p[1]) / (H / 2), (p[0] - CX) / (W / 2))) % 180

def sleeve_theme(code, logo_img):
    cols = [MANA[c][1] for c in code]
    k = len(cols)
    first = cols[0]
    accent = MANA[code][2] if k == 1 else cols[1]
    tint = hexc(tuple(sum(rgb(c)[i] for c in cols) / k for i in range(3)))
    t = {
        'title': f'DigiDice card back, {sleeve_name(code)} sleeve',
        'bg': (mix('#050810', tint, 0.16), mix('#03050C', tint, 0.07), '#010205'),
        'halo': (first, accent),
        'main': first,
        'accent': accent,
        'logo': png_b64(recolor(logo_img, first, accent)),
        'xlink': False,   # one copy of the logo (xlink:href, which every SVG renderer reads), not the classic's two
        'label': f'DIGIDICE · DD-{code} · 1D6',
        'depth': True,
    }
    if k == 1:
        t['trace'] = lambda col, anchor: first if col == BLUE else accent
        t['at'] = lambda p: first
        t['frame'] = None
        return t
    # Color wheel over half a turn: color i owns the directions around 90 - i * 180 / k (the first color straight up and down).
    centers = [(90 - i * 180 / k) % 180 for i in range(k)]
    half = 90 / k
    def dist(a, b):
        d = abs(a - b) % 180
        return min(d, 180 - d)
    def nearest(a):
        return sorted(range(k), key=lambda i: (dist(a, centers[i]), i))
    def at(p):  # hard: the color whose sector the point is in
        return cols[nearest(direction(p) + 0.01)[0]]
    def soft(shift):  # a color blend around the outline: each color holds the middle of its sector, then fades halfway into the next
        def color(p):
            a = (direction(p) + shift) % 180
            i, j = nearest(a)[:2]
            u = dist(a, centers[i]) / half
            return cols[i] if u <= 0.6 else blend(cols[i], cols[j], (u - 0.6) / 0.4 * 0.5)
        return color
    t['trace'] = lambda col, anchor: at(anchor)
    t['at'] = at
    t['frame'] = soft(0)
    t['border'] = soft(90)   # the thin border runs a quarter turn out of step with the frame, so each color edges the next
    return t

def recolor(img, first, accent):
    """The logo with its blue parts in `first` and its magenta border in `accent`; white stays white. Brightness and edge softness are kept."""
    f, a = rgb(first), rgb(accent)
    out = []
    for r, g, b, al in img.getdata():
        if al == 0:
            out.append((0, 0, 0, 0)); continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        tgt = a if 0.75 < h < 0.92 else f
        m = max(tgt)
        c = [v + (x / m * v - v) * s for x in tgt]
        out.append((*(round(x * 255) for x in c), al))
    res = Image.new('RGBA', img.size)
    res.putdata(out)
    return res

def sleeve_name(code):
    return 'All five colors' if len(code) == 5 else '-'.join(MANA[c][0] for c in code)

def classic_theme(logo_b64, sleeve):
    """The DigiDice card back's own colors. As a sleeve (the deck that has none) it gets the depth and the moving lights too; card-back.svg stays flat."""
    return {
        'title': 'DigiDice card back, classic sleeve' if sleeve else 'DigiDice card back',
        'bg': ('#0B1830', '#050B18', '#010205'),
        'halo': (BLUE, MAGENTA),
        'main': BLUE,
        'accent': MAGENTA,
        'trace': lambda col, anchor: col,
        'at': lambda p: BLUE,
        'frame': None,
        'logo': logo_b64,
        'xlink': not sleeve,
        'label': 'DIGIDICE · DD-06 · 1D6',
        'depth': sleeve,
    }

def write_sleeve(name, theme):
    files = {'file': f'sleeves/sleeve-{name}.svg', 'tracers': f'sleeves/sleeve-{name}-tracers.svg'}
    open(f'{OUT}/{files["file"]}', 'w', encoding='utf-8').write(card_svg(theme))
    open(f'{OUT}/{files["tracers"]}', 'w', encoding='utf-8').write(tracers_svg(theme))
    return files

if SLEEVES:
    small = mark.resize((480, 480), Image.LANCZOS)
    os.makedirs(f'{OUT}/sleeves', exist_ok=True)
    listing = [{'id': code.lower(), 'colors': list(code), 'name': sleeve_name(code), **write_sleeve(code.lower(), sleeve_theme(code, small))} for code in COMBOS]
    classic = write_sleeve('classic', classic_theme(png_b64(small), True))
    with open(f'{OUT}/sleeves/sleeves.json', 'w', encoding='utf-8') as fh:
        json.dump({'classic': classic, 'sleeves': listing}, fh, indent=2)
        fh.write('\n')
    print('ok', len(listing))
else:
    mark.save(f'{OUT}/digidice-mark-transparent.png')
    open(f'{OUT}/card-back.svg', 'w', encoding='utf-8').write(card_svg(classic_theme(png_b64(mark), False)))
    print('ok')
