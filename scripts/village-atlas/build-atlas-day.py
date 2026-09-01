#!/usr/bin/env python3
"""Day-mode atlas: the daylight boards + night houses graded to fit.
Outputs out/atlas-day.png/json, out/ground-day.png, sheets/village-day-preview.png
"""
import json, os
import numpy as np
from PIL import Image, ImageEnhance, ImageDraw

SP = os.path.dirname(os.path.abspath(__file__))
OUT = f"{SP}/out"
L = Image.LANCZOS

DAY = {  # daylight cut-outs, used as painted
    'library': ('sprites/d-library/00.png', 132),
    'forge': ('sprites/d-forge/00.png', 120),
    'gate': ('sprites/d-gate/00.png', 112),
    'tower': ('sprites/d-tower/tower-solo.png', 165),
    'desk-day': ('sprites/d-tower/desk-day.png', 44),
    'stall-red': ('sprites/d-stalls/stall-red.png', 70),
    'stall-teal': ('sprites/d-stalls/stall-teal.png', 66),
    'warehouse': ('sprites/d-warehouse/00.png', 104),
    'barrel-group': ('sprites/d-props1/00.png', 46),
    'signpost': ('sprites/d-props1/signpost.png', 52),
    'hay': ('sprites/d-props1/04.png', 42),
    'barrel-cart': ('sprites/d-props1/05.png', 46),
    'rocks': ('sprites/d-props1/06.png', 34),
    'sacks': ('sprites/d-props2/01.png', 34),
    'fence': ('sprites/d-props2/02.png', 40),
    'well': ('sprites/d-props2/03.png', 54),
    'wheelbarrow': ('sprites/d-props2/05.png', 36),
    'rock-big': ('sprites/d-props2/06.png', 38),
    'tree1': ('sprites/d-green1/01.png', 92),
    'tree2': ('sprites/d-green2/tree-tall.png', 96),
    'grove': ('sprites/d-green2/00.png', 76),
    'ivy': ('sprites/d-green1/02.png', 46),
    'planter-red': ('sprites/d-green1/03.png', 30),
    'hangbasket': ('sprites/d-green1/04.png', 44),
    'pot-yellow': ('sprites/d-green1/06.png', 42),
    'tuft1': ('sprites/d-green1/07.png', 22),
    'tuft2': ('sprites/d-green1/08.png', 20),
    'planter2': ('sprites/d-green2/02.png', 44),
    'topiary': ('sprites/d-green2/03.png', 40),
    'tufts2': ('sprites/d-green2/05.png', 24),
    'vigil-booth': ('sprites/d-gate/vigil-booth.png', 56),
}
NIGHT_GRADED = {  # night houses lifted toward the daylight key
    'house0': ('sprites/houses/house0.png', 110),
    'house1': ('sprites/houses/house1.png', 110),
    'house2': ('sprites/houses/house2.png', 110),
    'house3': ('sprites/houses/house3.png', 110),
    'house4': ('sprites/houses/house4.png', 110),
    'house-big': ('sprites/houses/house1.png', 140),
}
KEEP = {  # untouched existing sprites (characters, props, fx)
    'coin': ('sprites/props/00.png', 26),
    'coin-sign': ('sprites/props/00.png', 34),
    'ingot': ('sprites/props/01.png', 26),
    'seal-x': ('sprites/props/02.png', 30),
    'cart': ('sprites/props/08.png', 68),
    'spark': ('sprites/fx/00.png', 44),
    'smoke': ('sprites/fx/01.png', 40),
    'flame-ball': ('sprites/fx/06.png', 22),
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
}


def load_scaled(path, th):
    img = Image.open(f"{SP}/{path}").convert('RGBA')
    tw = max(1, round(img.width * th / img.height))
    return img.resize((tw, th), L)


def grade_day(img):
    """Night houses → daylight neighbours: the blue-night stone is HUE-SHIFTED
    to warm beige (not merely brightened — proven to wash out otherwise),
    banners keep their color, then a cream shadow-lift."""
    a = img.getchannel('A')
    hsv = np.asarray(img.convert('RGB').convert('HSV')).astype(np.float32)
    Hh, S, V = hsv[..., 0].copy(), hsv[..., 1].copy(), hsv[..., 2].copy()
    # blue/indigo walls (PIL hue ~130..200) → warm stone
    blue = (Hh > 128) & (Hh < 205)
    Hh[blue] = 24
    S[blue] = S[blue] * 0.42
    V[blue] = np.clip(V[blue] * 1.35 + 26, 0, 255)
    # near-black desaturated roofs → pale slate (banners are saturated, spared)
    dark = (V < 118) & (S < 95) & ~blue
    Hh[dark] = 22
    S[dark] = np.minimum(S[dark], 40)
    V[dark] = np.clip(V[dark] * 1.5 + 58, 0, 255)
    x = np.asarray(
        Image.fromarray(np.dstack([Hh, S, V]).astype(np.uint8), 'HSV').convert('RGB')
    ).astype(np.float32)
    v = x.max(axis=2, keepdims=True)
    cream = np.array([182, 170, 150], dtype=np.float32)
    l = np.clip((150 - v) / 150, 0, 1) * 0.30
    x = x + (cream - x) * l
    out = Image.fromarray(np.clip(x, 0, 255).astype(np.uint8))
    out = ImageEnhance.Brightness(out).enhance(1.22)
    out = ImageEnhance.Color(out).enhance(1.05)
    out = out.convert('RGBA')
    out.putalpha(a)
    return out


def build():
    sprites = {}
    for n, (p, th) in DAY.items():
        sprites[n] = load_scaled(p, th)
    for n, (p, th) in NIGHT_GRADED.items():
        sprites[n] = grade_day(load_scaled(p, th))
    for n, (p, th) in KEEP.items():
        sprites[n] = load_scaled(p, th)
    order = sorted(sprites, key=lambda n: -sprites[n].height)
    W = 1400
    x = y = row_h = 0
    pos = {}
    for n in order:
        s = sprites[n]
        if x + s.width + 2 > W:
            x = 0; y += row_h + 2; row_h = 0
        pos[n] = (x, y); row_h = max(row_h, s.height); x += s.width + 2
    H = y + row_h + 2
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    meta = {}
    for n, s in sprites.items():
        px, py = pos[n]
        atlas.paste(s, (px, py))
        meta[n] = {'x': px, 'y': py, 'w': s.width, 'h': s.height}
    atlas.save(f"{OUT}/atlas-day.png", optimize=True)
    with open(f"{OUT}/atlas-day.json", 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print(f"atlas-day: {W}x{H}, {len(meta)} sprites, {os.path.getsize(OUT+'/atlas-day.png')//1024} KB")
    return sprites


def build_ground():
    g = Image.open(f"{SP}/boards/d-ground-clean.png").convert('RGB')
    a = np.asarray(g).astype(np.float32)
    # belt-and-braces: soften any remaining grey-blue shadow rectangle
    y0, y1, x0, x1 = int(1024*0.42), int(1024*0.66), int(1024*0.28), int(1024*0.60)
    region = a[y0:y1, x0:x1]
    patch = a[(y0+433) % 1024:(y0+433) % 1024 + (y1-y0), (x0+389) % 1024:(x0+389) % 1024 + (x1-x0)]
    if patch.shape == region.shape:
        blue = (region[..., 2] - region[..., 0] > 2) & (region.max(axis=2) < 190)
        m = blue.astype(np.float32)
        for _ in range(5):
            m = (m + np.roll(m,1,0)+np.roll(m,-1,0)+np.roll(m,1,1)+np.roll(m,-1,1))/5
        a[y0:y1, x0:x1] = region*(1-m[...,None]) + patch*m[...,None]
    # level the tile's internal gradient (its shaded edges draw a visible grid
    # when tiled): normalize row/column mean luminance toward the global mean
    lum = a.mean(axis=2)
    rows = lum.mean(axis=1, keepdims=True); cols = lum.mean(axis=0, keepdims=True)
    target = lum.mean()
    a = a * (target / rows)[..., None].clip(0.85, 1.18) * (target / cols)[..., None].clip(0.85, 1.18)
    img = Image.fromarray(np.clip(a,0,255).astype(np.uint8)).resize((160, 160), L)
    img.save(f"{OUT}/ground-day.png", optimize=True)
    print('ground-day saved')
    return img


LAYOUT = [
    ('warehouse', 70, 96, 'ENTREPÔT'),
    ('gate', 80, 180, 'PÉAGE'),
    ('stall-red', 204, 178, 'SCRIBE'),
    ('stall-teal', 318, 178, 'DÉCOUPEUR'),
    ('library', 472, 172, 'BIBLIOTHÈQUE'),
    ('house0', 560, 118, 'DE'), ('house1', 628, 118, 'AT'), ('house2', 696, 118, 'BE'),
    ('house3', 764, 118, 'BG'), ('house4', 832, 118, 'NL'), ('house1', 900, 118, 'FI'),
    ('house3', 852, 326, 'SIX'), ('house-big', 716, 322, 'TRIBUNAL'), ('house2', 582, 326, 'CLASSIF'),
    ('fence', 438, 348, 'FRONTIÈRE'), ('signpost', 478, 336, ''),
    ('tower', 176, 330, 'TOUR'),
    ('forge', 410, 486, 'FORGE'),
    ('desk-day', 246, 482, 'ARCHIVISTE'), ('ember-line', 224, 494, ''),
    ('vigil-booth', 900, 474, 'VIGIE'),
    ('cart', 148, 92, ''),
    # décor / verdure
    ('tree1', 32, 150, ''), ('tree2', 930, 420, ''), ('tree1', 62, 392, ''),
    ('grove', 300, 292, ''), ('tree2', 935, 244, ''), ('tree1', 390, 86, ''),
    ('rocks', 352, 244, ''), ('rock-big', 925, 522, ''),
    ('well', 120, 470, ''),
    ('barrel-group', 150, 110, ''), ('sacks', 186, 96, ''),
    ('barrel-cart', 484, 496, ''), ('wheelbarrow', 540, 500, ''),
    ('hay', 58, 506, ''),
    ('planter-red', 508, 180, ''), ('topiary', 268, 192, ''), ('pot-yellow', 148, 198, ''),
    ('planter2', 660, 350, ''),
    ('fence', 292, 340, ''),
    ('tuft1', 240, 220, ''), ('tuft2', 500, 260, ''), ('tufts2', 640, 240, ''),
    ('tuft1', 60, 300, ''), ('tuft2', 890, 380, ''), ('tufts2', 340, 440, ''),
    ('ivy', 428, 176, ''),
]

ROADS = [
    (-4, 180, 968, 24), (920, 180, 24, 174), (190, 330, 754, 24),
    (190, 330, 24, 192), (190, 486, 774, 24), (588, 122, 24, 82), (-4, 64, 908, 24),
]


def preview(sprites, ground):
    world = Image.new('RGB', (960, 540))
    g180 = ground.rotate(180)
    for j, ty in enumerate(range(0, 540, 160)):
        for i, tx in enumerate(range(0, 960, 160)):
            world.paste(g180 if (i + j) % 2 else ground, (tx, ty))
    ov = Image.new('RGBA', world.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for x, y, w, h in ROADS:
        od.rectangle([x, y, x + w, y + h], fill=(126, 104, 80, 60))
    world = Image.alpha_composite(world.convert('RGBA'), ov)
    d = ImageDraw.Draw(world)
    order = sorted(LAYOUT, key=lambda l: l[2])
    for name, ax, base, label in order:
        s = sprites[name]
        world.paste(s, (ax - s.width // 2, base - s.height), s)
    for n, ax, base in [('hero-side', 254, 200), ('cour-b-side', 640, 352),
                        ('clerk0', 108, 452), ('clerk3', 152, 486), ('clerk4', 96, 500)]:
        s = sprites[n]
        world.paste(s, (ax - s.width // 2, base - s.height), s)
    for name, ax, base, label in order:
        if label:
            d.rectangle([ax - 4*len(label) - 4, base + 2, ax + 4*len(label) + 4, base + 15],
                        fill=(255, 247, 224), outline=(120, 84, 40))
            d.text((ax - 4*len(label), base + 3), label, fill=(70, 46, 16))
    world.convert('RGB').save(f"{SP}/sheets/village-day-preview.png")
    print('day preview saved')


s = build()
g = build_ground()
preview(s, g)
