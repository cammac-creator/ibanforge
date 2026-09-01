#!/usr/bin/env python3
"""Cut Midjourney boards into sprites.

Background removal: the plain backdrop is sampled from the four corners, every
border-connected pixel within tolerance becomes transparent (flood fill), so
background-colored pixels INSIDE a sprite survive. Then 8-connected components
above a minimum area become individual trimmed PNG sprites, and a numbered
contact sheet lets a human (or Claude reading the image) name each index.
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw
from collections import deque

SP = os.path.dirname(os.path.abspath(__file__))

def segment(name, tol=14, min_area=250, close_px=2):
    # tol is a DIRECT sum-of-channels distance: the MJ backdrops are flat
    # (measured p99 ≈ 3, max ≤ 11), so 14 removes the backdrop and spares
    # walls that sit only ~25 away.
    img = Image.open(f"{SP}/boards/{name}.png").convert("RGB")
    a = np.asarray(img).astype(np.int16)
    h, w, _ = a.shape
    frame = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3),
                            a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    bg = np.median(frame, axis=0)
    dist = np.abs(a - bg).sum(axis=2)
    bgish = dist <= tol

    # flood fill from borders over bg-ish pixels
    visited = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bgish[y, x] and not visited[y, x]:
                visited[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bgish[y, x] and not visited[y, x]:
                visited[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= ny < h and 0 <= nx < w and bgish[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True; dq.append((ny, nx))
    fg = ~visited

    # morphological closing of the foreground mask (bridge 1-2 px gaps so one
    # sprite doesn't split into shards)
    if close_px:
        m = fg.copy()
        for _ in range(close_px):
            m = m | np.roll(m,1,0) | np.roll(m,-1,0) | np.roll(m,1,1) | np.roll(m,-1,1)
        for _ in range(close_px):
            m = m & np.roll(m,1,0) & np.roll(m,-1,0) & np.roll(m,1,1) & np.roll(m,-1,1)
        comp_mask = m | fg
    else:
        comp_mask = fg

    # connected components (BFS, 8-conn) on comp_mask, but alpha uses fg only
    labels = np.zeros((h, w), dtype=np.int32)
    nlab = 0
    boxes = []
    for yy in range(h):
        row = comp_mask[yy]
        for xx in range(w):
            if row[xx] and labels[yy, xx] == 0:
                nlab += 1
                q = deque([(yy, xx)]); labels[yy, xx] = nlab
                x0 = x1 = xx; y0 = y1 = yy; area = 0
                while q:
                    y, x = q.popleft(); area += 1
                    if x < x0: x0 = x
                    if x > x1: x1 = x
                    if y < y0: y0 = y
                    if y > y1: y1 = y
                    for ny in (y-1, y, y+1):
                        for nx in (x-1, x, x+1):
                            if 0 <= ny < h and 0 <= nx < w and comp_mask[ny, nx] and labels[ny, nx] == 0:
                                labels[ny, nx] = nlab; q.append((ny, nx))
                boxes.append((area, x0, y0, x1, y1, nlab))

    boxes = [b for b in boxes if b[0] >= min_area]
    boxes.sort(key=lambda b: (b[2] // 200, b[1]))  # rough reading order

    rgba = np.dstack([np.asarray(img), np.where(fg, 255, 0).astype(np.uint8)])
    outdir = f"{SP}/sprites/{name}"
    os.makedirs(outdir, exist_ok=True)
    infos = []
    for i, (area, x0, y0, x1, y1, lab) in enumerate(boxes):
        pad = 2
        X0, Y0 = max(0, x0 - pad), max(0, y0 - pad)
        X1, Y1 = min(w, x1 + pad + 1), min(h, y1 + pad + 1)
        piece = rgba[Y0:Y1, X0:X1].copy()
        piece[..., 3] = np.where(labels[Y0:Y1, X0:X1] == lab, piece[..., 3], 0)
        Image.fromarray(piece).save(f"{outdir}/{i:02d}.png")
        infos.append((i, X0, Y0, X1 - X0, Y1 - Y0, area))

    # contact sheet
    cols = 6
    cell = 190
    rows = (len(infos) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, max(1, rows) * cell + 20), (70, 90, 70))
    d = ImageDraw.Draw(sheet)
    for i, X0, Y0, cw, ch, area in infos:
        cx, cy = (i % cols) * cell, (i // cols) * cell
        p = Image.open(f"{outdir}/{i:02d}.png")
        scale = min((cell - 30) / p.width, (cell - 30) / p.height, 1.0)
        p2 = p.resize((max(1, int(p.width * scale)), max(1, int(p.height * scale))), Image.NEAREST)
        sheet.paste(p2, (cx + 12, cy + 24), p2)
        d.text((cx + 8, cy + 4), f"#{i} {cw}x{ch}", fill=(255, 230, 140))
    sheet.save(f"{SP}/sheets/{name}-contact.png")
    print(f"{name}: {len(infos)} sprites -> sprites/{name}/ ; sheet: sheets/{name}-contact.png")
    for i, X0, Y0, cw, ch, area in infos:
        print(f"  #{i:02d} at({X0},{Y0}) {cw}x{ch} area={area}")

if __name__ == "__main__":
    for n in sys.argv[1:]:
        segment(n)
