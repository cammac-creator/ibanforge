#!/usr/bin/env python3
"""Build the village atlas from the cut Midjourney sprites.

Outputs (scratchpad):
  out/atlas.png + out/atlas.json   — packed sprites, LANCZOS-scaled to game size
  out/ground.png                   — brightened seamless ground tile (256px)
  sheets/ground-variants.png       — exposure candidates for review
  sheets/village-preview.png       — full composed layout preview for review
"""
import json, os
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

SP = os.path.dirname(os.path.abspath(__file__))
OUT = f"{SP}/out"
os.makedirs(OUT, exist_ok=True)

L = Image.LANCZOS

# name -> (path, target_height)
RECIPE = {
    'house0': ('sprites/houses/house0.png', 110),
    'house1': ('sprites/houses/house1.png', 110),
    'house2': ('sprites/houses/house2.png', 110),
    'house3': ('sprites/houses/house3.png', 110),
    'house4': ('sprites/houses/house4.png', 110),
    'house-big': ('sprites/houses/house1.png', 140),   # library / court base
    'tower': ('sprites/tower/00.png', 170),
    'checkpoint': ('sprites/tower/01.png', 96),
    'desk': ('sprites/tower/02.png', 48),
    'coin': ('sprites/props/00.png', 26),
    'coin-sign': ('sprites/props/00.png', 34),
    'ingot': ('sprites/props/01.png', 26),
    'seal-x': ('sprites/props/02.png', 30),
    'cart': ('sprites/props/08.png', 68),
    'spark': ('sprites/fx/00.png', 44),
    'smoke': ('sprites/fx/01.png', 40),
    'chimney': ('sprites/fx/02.png', 54),
    'anvil': ('sprites/fx/04.png', 26),
    'flame-s': ('sprites/fx/05.png', 16),
    'flame-ball': ('sprites/fx/06.png', 22),
    'embers': ('sprites/fx/13.png', 56),
    'furnace': ('sprites/fx/16.png', 120),
    'lantern': ('sprites/fx/18.png', 56),
    'ember-line': ('sprites/fx/19.png', 30),
    'hero-front': ('sprites/hero/00.png', 46),
    'hero-back': ('sprites/hero/01.png', 46),
    'hero-side': ('sprites/hero/02.png', 46),
    'cour-a-front': ('sprites/courier-a/00.png', 42),
    'cour-a-back': ('sprites/courier-a/01.png', 42),
    'cour-a-side': ('sprites/courier-a/02.png', 42),
    'cour-b-front': ('sprites/courier-b/00.png', 42),
    'cour-b-back': ('sprites/courier-b/01.png', 42),
    'cour-b-side': ('sprites/courier-b/02.png', 42),
    'cour-c-front': ('sprites/courier-c/00.png', 42),
    'cour-c-back': ('sprites/courier-c/02.png', 42),
    'cour-c-side': ('sprites/courier-c/04.png', 42),
    'clerk0': ('sprites/hero/05.png', 30),
    'clerk1': ('sprites/hero/06.png', 30),
    'clerk2': ('sprites/courier-a/04.png', 30),
    'clerk3': ('sprites/courier-b/05.png', 30),
    'clerk4': ('sprites/courier-c/06.png', 30),
    'clerk5': ('sprites/courier-c/07.png', 30),
    'vigil-post': ('sprites/tower/01.png', 58),
}


def scaled(name):
    path, th = RECIPE[name]
    img = Image.open(f"{SP}/{path}").convert('RGBA')
    tw = max(1, round(img.width * th / img.height))
    return img.resize((tw, th), L)


def build_atlas():
    sprites = {n: scaled(n) for n in RECIPE}
    order = sorted(sprites, key=lambda n: -sprites[n].height)
    W = 1024
    x = y = row_h = 0
    pos = {}
    for n in order:
        s = sprites[n]
        if x + s.width + 2 > W:
            x = 0
            y += row_h + 2
            row_h = 0
        pos[n] = (x, y)
        row_h = max(row_h, s.height)
        x += s.width + 2
    H = y + row_h + 2
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    meta = {}
    for n, s in sprites.items():
        px, py = pos[n]
        atlas.paste(s, (px, py))
        meta[n] = {'x': px, 'y': py, 'w': s.width, 'h': s.height}
    atlas.save(f"{OUT}/atlas.png", optimize=True)
    with open(f"{OUT}/atlas.json", 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    kb = os.path.getsize(f"{OUT}/atlas.png") // 1024
    print(f"atlas: {W}x{H}, {len(meta)} sprites, {kb} KB")
    return sprites


def build_ground():
    g = Image.open(f"{SP}/boards/ground.png").convert('RGB').resize((256, 256), L)
    variants = []
    for bright, sat in [(1.0, 1.0), (1.35, 1.05), (1.7, 1.1)]:
        v = ImageEnhance.Brightness(g).enhance(bright)
        v = ImageEnhance.Color(v).enhance(sat)
        variants.append((bright, v))
    sheet = Image.new('RGB', (3 * 532 + 40, 552), (30, 30, 34))
    d = ImageDraw.Draw(sheet)
    for i, (b, v) in enumerate(variants):
        tiled = Image.new('RGB', (512, 512))
        for ty in (0, 256):
            for tx in (0, 256):
                tiled.paste(v, (tx, ty))
        sheet.paste(tiled, (20 + i * 532, 30))
        d.text((20 + i * 532, 8), f"brightness x{b}", fill=(255, 230, 140))
    sheet.save(f"{SP}/sheets/ground-variants.png")
    # default pick: middle variant (reviewed after)
    variants[1][1].save(f"{OUT}/ground.png", optimize=True)
    print("ground variants sheet + default x1.35 saved")


# Layout of the 960x540 world — (sprite, anchor_x, base_y) with base = feet line.
LAYOUT = [
    ('house0', 80, 176, 'PÉAGE x402'),
    ('desk', 200, 172, 'SCRIBE'),
    ('desk', 306, 172, 'DÉCOUPEUR'),
    ('house-big', 430, 168, 'BIBLIOTHÈQUE'),
    ('house0', 540, 118, 'DE'),
    ('house1', 604, 118, 'AT'),
    ('house2', 668, 118, 'BE'),
    ('house3', 732, 118, 'BG'),
    ('house4', 796, 118, 'NL'),
    ('house1', 860, 118, 'FI'),
    ('house4', 916, 90, ''),                  # warehouse stand-in NE
    ('cart', 856, 100, 'CARAVANE'),
    ('house3', 852, 326, 'SIX'),
    ('house-big', 716, 322, 'TRIBUNAL'),
    ('house2', 582, 326, 'CLASSIF.'),
    ('checkpoint', 438, 344, 'FRONTIÈRE'),
    ('tower', 170, 326, 'TOUR'),
    ('furnace', 410, 482, 'FORGE'),
    ('anvil', 462, 486, ''),
    ('embers', 376, 496, ''),
    ('desk', 246, 480, 'ARCHIVISTE'),
    ('ember-line', 222, 492, ''),
    ('vigil-post', 900, 468, 'VIGIE'),
    ('lantern', 128, 452, ''),
    ('lantern', 528, 208, ''),
    ('lantern', 704, 368, ''),
    ('lantern', 630, 146, ''),
    ('chimney', 455, 86, ''),
    ('chimney', 733, 196, ''),
]

ROADS = [  # x0,y0,x1,y1 (thick strips)
    (0, 180, 944, 204), (920, 180, 944, 354), (190, 330, 944, 354),
    (190, 330, 214, 510), (190, 486, 960, 510), (588, 118, 612, 204),
    (0, 64, 900, 88),
]


def build_preview(sprites):
    ground = Image.open(f"{OUT}/ground.png")
    ground180 = ground.rotate(180)
    world = Image.new('RGB', (960, 540))
    for j, ty in enumerate(range(0, 540, 256)):
        for i, tx in enumerate(range(0, 960, 256)):
            world.paste(ground180 if (i + j) % 2 else ground, (tx, ty))
    # roads: warm lightening overlay
    ov = Image.new('RGBA', world.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for x0, y0, x1, y1 in ROADS:
        od.rectangle([x0, y0, x1, y1], fill=(255, 214, 140, 42))
    world = Image.alpha_composite(world.convert('RGBA'), ov)
    d = ImageDraw.Draw(world)
    order = sorted(LAYOUT, key=lambda l: l[2])
    for name, ax, base, label in order:
        s = sprites[name]
        world.paste(s, (ax - s.width // 2, base - s.height), s)
    # a few actors for scale
    for n, ax, base in [('hero-side', 254, 200), ('cour-b-side', 640, 352),
                        ('clerk0', 110, 470), ('clerk3', 152, 486), ('clerk4', 96, 500),
                        ('cour-a-front', 480, 204)]:
        s = sprites[n]
        world.paste(s, (ax - s.width // 2, base - s.height), s)
    for name, ax, base, label in order:
        if label:
            d.text((ax - 3 * len(label), base + 4), label, fill=(255, 240, 200))
    world.convert('RGB').save(f"{SP}/sheets/village-preview.png")
    print("village preview saved")


sprites = build_atlas()
# ground v3 (amber-desaturated) already written to out/ground.png — not rebuilt here
build_preview(sprites)
