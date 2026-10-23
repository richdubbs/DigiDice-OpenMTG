"""Spectrograms of the rendered sound effects (docs/design/sound.md "Checks").

    python scripts/sound/spectrogram.py .cache/sound            every <id>.wav there (variant 0), plus one contact sheet per group
    python scripts/sound/spectrogram.py .cache/sound ui.click   only these

Each PNG shows, top to bottom: the sound's id and key measurements, its envelope (dB, the left/right peak per column), and a log-frequency
spectrogram (30 Hz - 20 kHz, dB colour scale, D notes marked) with a time axis in milliseconds. Needs numpy and Pillow.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FMIN, FMAX = 30.0, 20000.0
ROWS = 220
DB_FLOOR = -96.0


def read_wav(path):
    with open(path, 'rb') as f:
        data = f.read()
    sr = int.from_bytes(data[24:28], 'little')
    pcm = np.frombuffer(data[44:], dtype='<i2').astype(np.float64) / 32767.0
    return sr, pcm[0::2], pcm[1::2]


def colormap(v):
    """0..1 -> RGB, a dark-blue-magenta-white ramp (close to the brand colours)."""
    stops = np.array([
        [0.00, 2, 2, 10],
        [0.25, 10, 30, 90],
        [0.45, 20, 120, 220],
        [0.62, 200, 40, 220],
        [0.80, 255, 140, 120],
        [1.00, 255, 255, 235],
    ])
    out = np.zeros(v.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(v, stops[:, 0], stops[:, c + 1])
    return out.astype(np.uint8)


def spectrogram(mono, sr, width):
    n = len(mono)
    size = 2048 if sr >= 32000 else 1024
    hop = max(1, n // width)
    win = np.hanning(size)
    pad = np.concatenate([np.zeros(size // 2), mono, np.zeros(size)])
    cols = []
    for c in range(width):
        s = c * hop
        frame = pad[s:s + size]
        if len(frame) < size:
            frame = np.concatenate([frame, np.zeros(size - len(frame))])
        spec = np.abs(np.fft.rfft(frame * win)) ** 2
        cols.append(spec)
    spec = np.array(cols).T  # bins x cols
    freqs = np.fft.rfftfreq(size, 1.0 / sr)
    edges = np.geomspace(FMIN, min(FMAX, sr / 2), ROWS + 1)
    img = np.zeros((ROWS, width))
    for r in range(ROWS):
        lo, hi = edges[r], edges[r + 1]
        sel = (freqs >= lo) & (freqs < hi)
        if sel.any():
            img[r] = spec[sel].max(axis=0)
        else:
            k = int(np.argmin(np.abs(freqs - (lo + hi) / 2)))
            img[r] = spec[k]
    ref = (np.sum(win) ** 2) / 4
    db = 10 * np.log10(img / ref + 1e-14)
    v = np.clip((db - DB_FLOOR) / -DB_FLOOR, 0, 1)
    return colormap(v[::-1]), edges


def draw_sound(path, meta, width=760):
    sr, l, r = read_wav(path)
    mono = (l + r) / 2
    dur = len(mono) / sr
    spec, edges = spectrogram(mono, sr, width)
    font = ImageFont.load_default()
    head, env_h, axis_h, left = 46, 60, 16, 46
    h = head + env_h + ROWS + axis_h
    im = Image.new('RGB', (width + left + 4, h), (8, 10, 20))
    d = ImageDraw.Draw(im)
    a = meta.get('analysis', {}) if meta else {}
    sid = meta.get('id', os.path.basename(path)) if meta else os.path.basename(path)
    line1 = f"{sid}   {dur * 1000:.0f} ms (audible {a.get('audible', 0) * 1000:.0f})   {a.get('lufs100', '?')} LUFS100 (small speakers -{a.get('smallSpeakerLossDb', '?')} dB)   peak {a.get('peakDb', '?')} dB   attack {a.get('attackMs', '?')} ms"
    line2 = f"centroid {a.get('centroid', '?')} Hz   flatness {a.get('flatness', '?')}   stereo corr {a.get('stereoCorrelation', '?')}   crest {a.get('crestDb', '?')} dB   chroma: {a.get('chroma', '')}"
    line3 = 'pitch: ' + (meta.get('pitchText', '') if meta else '')
    d.text((4, 3), line1, fill=(230, 235, 255), font=font)
    d.text((4, 17), line2, fill=(170, 200, 230), font=font)
    d.text((4, 31), line3[:150], fill=(170, 200, 230), font=font)
    # Envelope: per column, peak dB of each channel.
    hop = max(1, len(mono) // width)
    y0 = head
    for db_line in (0, -20, -40, -60):
        y = y0 + int((-db_line / 60) * (env_h - 4))
        d.line([(left, y), (left + width, y)], fill=(30, 36, 60))
        d.text((4, y - 6), f'{db_line}dB', fill=(110, 120, 150), font=font)
    for c in range(width):
        s = c * hop
        seg_l = np.abs(l[s:s + hop])
        seg_r = np.abs(r[s:s + hop])
        for seg, col in ((seg_l, (31, 184, 255)), (seg_r, (245, 0, 245))):
            if len(seg) == 0:
                continue
            pk = 20 * np.log10(seg.max() + 1e-9)
            yy = y0 + int(min(1, max(0, -pk / 60)) * (env_h - 4))
            d.point((left + c, yy), fill=col)
    # Spectrogram.
    im.paste(Image.fromarray(spec), (left, head + env_h))
    for f, label in ((50, '50'), (100, '100'), (200, '200'), (500, '500'), (1000, '1k'), (2000, '2k'), (5000, '5k'), (10000, '10k')):
        if f < edges[0] or f > edges[-1]:
            continue
        row = ROWS - 1 - int(np.searchsorted(edges, f) - 1)
        y = head + env_h + row
        d.line([(left - 4, y), (left - 1, y)], fill=(200, 200, 220))
        d.text((4, y - 6), label, fill=(160, 170, 200), font=font)
    # D notes (the key) as faint ticks on the right edge.
    for octave in range(1, 9):
        f = 440 * 2 ** ((12 * (octave + 1) + 2 - 69) / 12)
        if edges[0] <= f <= edges[-1]:
            row = ROWS - 1 - int(np.searchsorted(edges, f) - 1)
            d.line([(left + width, head + env_h + row), (left + width + 3, head + env_h + row)], fill=(255, 210, 90))
    # Time axis.
    ya = head + env_h + ROWS
    step_ms = 50 if dur <= 0.6 else 100 if dur <= 1.5 else 250 if dur <= 4 else 1000
    t = 0
    while t <= dur * 1000:
        x = left + int((t / 1000) / dur * width)
        d.line([(x, ya), (x, ya + 3)], fill=(200, 200, 220))
        d.text((x + 2, ya + 3), f'{t}', fill=(160, 170, 200), font=font)
        t += step_ms
    return im


def contact_sheet(images, cols=3):
    if not images:
        return None
    w = max(im.width for im in images)
    h = max(im.height for im in images)
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new('RGB', (w * cols, h * rows), (0, 0, 0))
    for k, im in enumerate(images):
        sheet.paste(im, ((k % cols) * w, (k // cols) * h))
    return sheet


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else '.cache/sound'
    only = set(sys.argv[2:])
    out = os.path.join(folder, 'png')
    os.makedirs(out, exist_ok=True)
    by_group = {}
    for name in sorted(os.listdir(folder)):
        if not name.endswith('.wav') or re.search(r'\.v\d+\.wav$', name):
            continue
        sid = name[:-4]
        if only and sid not in only:
            continue
        meta_path = os.path.join(folder, sid + '.json')
        meta = json.load(open(meta_path, encoding='utf-8')) if os.path.exists(meta_path) else None
        im = draw_sound(os.path.join(folder, name), meta)
        im.save(os.path.join(out, sid + '.png'))
        by_group.setdefault((meta or {}).get('group', 'other'), []).append(im.resize((im.width // 2, im.height // 2)))
    if not only:
        for g, ims in by_group.items():
            sheet = contact_sheet(ims)
            if sheet:
                sheet.save(os.path.join(out, f'sheet-{g}.png'))
    print(f'spectrograms -> {out}')


if __name__ == '__main__':
    main()
