#!/usr/bin/env python3
"""Rebuild the /live village atlas: drop frames, add new pre-cut sprites,
repack. The atlas IS the source of truth for existing art (the original cut
sprites live outside the repo), so this reads the packed frames back, merges
in the new ones and writes a fresh atlas.png + atlas.json.

Usage:
  python3 scripts/village-atlas/rebuild-atlas.py \
      --remove house0,house1 --add /path/to/sprites-dir [--preview out.png]

Every PNG in --add becomes a frame named after its file (sans extension),
already at world size — no scaling happens here. Run from the repo root.
"""
import argparse
import json
import os

from PIL import Image, ImageDraw

VILLAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       '..', '..', 'frontend', 'public', 'village')
ATLAS_W = 1400
PAD = 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--remove', default='', help='comma-separated frame names')
    ap.add_argument('--add', default='', help='directory of world-size PNGs')
    ap.add_argument('--preview', default='', help='optional contact-sheet path')
    args = ap.parse_args()

    atlas = Image.open(os.path.join(VILLAGE, 'atlas.png')).convert('RGBA')
    with open(os.path.join(VILLAGE, 'atlas.json')) as f:
        meta = json.load(f)

    sprites = {}
    removed = {n.strip() for n in args.remove.split(',') if n.strip()}
    for name, fr in meta.items():
        if name in removed:
            continue
        sprites[name] = atlas.crop((fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h']))
    missing = removed - set(meta)
    if missing:
        raise SystemExit(f'--remove names not in atlas: {sorted(missing)}')

    if args.add:
        for f in sorted(os.listdir(args.add)):
            if f.endswith('.png'):
                sprites[os.path.splitext(f)[0]] = Image.open(os.path.join(args.add, f)).convert('RGBA')

    order = sorted(sprites, key=lambda n: -sprites[n].height)
    x = y = row_h = 0
    pos = {}
    for n in order:
        s = sprites[n]
        if x + s.width + PAD > ATLAS_W:
            x = 0
            y += row_h + PAD
            row_h = 0
        pos[n] = (x, y)
        row_h = max(row_h, s.height)
        x += s.width + PAD
    height = y + row_h + PAD

    out = Image.new('RGBA', (ATLAS_W, height), (0, 0, 0, 0))
    new_meta = {}
    for n, s in sprites.items():
        px, py = pos[n]
        out.paste(s, (px, py))
        new_meta[n] = {'x': px, 'y': py, 'w': s.width, 'h': s.height}
    out.save(os.path.join(VILLAGE, 'atlas.png'), optimize=True)
    with open(os.path.join(VILLAGE, 'atlas.json'), 'w') as f:
        json.dump(new_meta, f, separators=(',', ':'))
    kb = os.path.getsize(os.path.join(VILLAGE, 'atlas.png')) // 1024
    print(f'atlas: {ATLAS_W}x{height}, {len(new_meta)} frames, {kb} KB '
          f'(-{len(removed)} removed, +{len([1 for _ in os.listdir(args.add) if _.endswith(".png")]) if args.add else 0} added)')

    if args.preview:
        sheet = Image.new('RGB', (ATLAS_W, height + 16), (196, 178, 148))
        sheet.paste(out, (0, 16), out)
        d = ImageDraw.Draw(sheet)
        for n, fr in new_meta.items():
            d.text((fr['x'] + 1, fr['y'] + 2), n[:14], fill=(60, 40, 20))
        sheet.save(args.preview)
        print(f'preview: {args.preview}')


main()
