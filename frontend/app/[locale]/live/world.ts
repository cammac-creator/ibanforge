/**
 * The village world, art scale: geometry and the atlas renderer.
 *
 * Every visible thing is a cut-out of Claude-Alain's Midjourney boards packed
 * into /village/atlas.png (LANCZOS-scaled at build time, see the scratchpad
 * build-atlas.py recipe). This module knows geometry and drawing; it holds no
 * React and no strings.
 *
 * World: 960×540 logical, rendered at ×2 into a 1920×1080 canvas.
 */

import { SPINE } from '@/lib/village/roads';

export const W = 960;
export const H = 540;
export const SCALE = 2;

export type Ctx = CanvasRenderingContext2D;

export interface AtlasFrame { x: number; y: number; w: number; h: number }
export type AtlasMeta = Record<string, AtlasFrame>;

export interface WorldImages {
  atlas: HTMLImageElement;
  meta: AtlasMeta;
  ground: HTMLImageElement;
  grass: HTMLImageElement;
}

export async function loadWorldImages(base = '/village'): Promise<WorldImages> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  const [atlas, ground, grass, metaRes] = await Promise.all([
    load(`${base}/atlas.png`),
    load(`${base}/ground.png`),
    load(`${base}/grass.png`),
    fetch(`${base}/atlas.json`),
  ]);
  const meta = (await metaRes.json()) as AtlasMeta;
  return { atlas, meta, ground, grass };
}

/** Draw a sprite by name, anchored bottom-center at (cx, baseY). */
export function drawSprite(
  ctx: Ctx, img: WorldImages, name: string, cx: number, baseY: number,
  opts: { flip?: boolean; alpha?: number; scale?: number; dy?: number } = {},
) {
  const f = img.meta[name];
  if (!f) return;
  const s = opts.scale ?? 1;
  const w = f.w * s, h = f.h * s;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  ctx.translate(cx, baseY + (opts.dy ?? 0));
  if (opts.flip) ctx.scale(-1, 1);
  ctx.drawImage(img.atlas, f.x, f.y, f.w, f.h, -w / 2, -h, w, h);
  ctx.restore();
}

/* ---------- geometry ----------
 *
 * Reflowed 01/09/2026 evening (operator's row plan): the pipeline now reads
 * as three full streets. Top street = the entry formalities (gate, scribe,
 * cutter, library) plus a market square where the registry lane used to
 * stand. Middle street = the registry lane itself with the SIX counter,
 * court and classifier — every door opens straight onto the street, so the
 * per-door climb paths died. Bottom street = the border barrier ACROSS the
 * road, the watchtower, the forge and the vigil. The tower is drawn at 0.82
 * so its top stays south of the middle street and never masks a door. */

export const REGISTRY_CCS = ['DE', 'AT', 'BE', 'BG', 'NL', 'FI'] as const;
/** The bespoke national houses (01/09 boards): Fachwerk DE, alpine chalet AT,
 * step-gabled BE, revival BG, canal house NL, red-ochre cottage FI. These
 * isometric cuts run wide, so the lane is a close shingle. v7 door-scale
 * pass: heights re-cut so the six DOORS match each other, and the overlaps
 * are budgeted per joint (wide over blind walls, slim where a banner hangs)
 * with bases ordered so no banner ever hides behind a neighbour. */
const REGISTRY_LANE: { sprite: string; cx: number; w: number; h: number; base: number }[] = [
  { sprite: 'reg-de', cx: 573, w: 74, h: 76, base: 334 },
  { sprite: 'reg-at', cx: 624, w: 87, h: 66, base: 338 },
  { sprite: 'reg-be', cx: 694, w: 70, h: 82, base: 336 },
  { sprite: 'reg-bg', cx: 742, w: 86, h: 71, base: 339 },
  { sprite: 'reg-nl', cx: 797, w: 84, h: 108, base: 341 },
  { sprite: 'reg-fi', cx: 860, w: 103, h: 72, base: 343 },
];

export interface StationGeo {
  id: string;
  sprite: string | null;
  /** bottom-center anchor of the main sprite */
  cx: number;
  base: number;
  /** hover bbox */
  bx: number; by: number; bw: number; bh: number;
  door: [number, number];
  anchor: [number, number];
  cc?: string;
  flip?: boolean;
  scale?: number;
}

function geo(
  id: string, sprite: string | null, cx: number, base: number,
  bw: number, bh: number, door: [number, number], anchor: [number, number],
  extra: { cc?: string; flip?: boolean; scale?: number } = {},
): StationGeo {
  return { id, sprite, cx, base, bx: cx - bw / 2, by: base - bh, bw, bh, door, anchor, ...extra };
}

export const STATIONS: StationGeo[] = [
  geo('gate', 'gate', 80, 182, 84, 116, [80, 200], [80, 192]),
  // the stalls breathe: unglued from the gate, wider apart (operator, 01/09)
  geo('scribe', 'stall-red', 210, 180, 64, 74, [210, 200], [210, 192]),
  geo('cutter', 'stall-teal', 330, 180, 62, 70, [330, 200], [330, 192]),
  // the library moved east onto the old market square, by the well
  geo('library', 'library', 655, 176, 176, 126, [655, 200], [655, 192], { scale: 0.92 }),
  ...REGISTRY_LANE.map((h, i) =>
    geo(`reg-${REGISTRY_CCS[i]}`, h.sprite, h.cx, h.base, h.w, h.h,
      [h.cx, 350], [h.cx, 342], { cc: REGISTRY_CCS[i] }),
  ),
  geo('warehouse', 'warehouse', 84, 106, 132, 104, [120, 98], [120, 76]),
  // the three counters wear their bespoke boards too: sorting office with
  // pigeonholes, columned courthouse, Swiss chalet with its painted flag —
  // re-cut on the door scale (v7), the classifier pushed west to breathe
  geo('classifier', 'classifier-b', 236, 334, 110, 84, [236, 352], [236, 342]),
  geo('court', 'court-b', 358, 337, 128, 99, [358, 352], [358, 342]),
  geo('six', 'six-b', 470, 340, 128, 124, [470, 352], [470, 342]),
  // the barrier sits ACROSS the bottom street: the hero passes through it
  geo('border', 'fence', 280, 506, 104, 46, [280, 498], [280, 498]),
  geo('tower', 'tower', 380, 496, 64, 140, [380, 504], [380, 498], { scale: 0.82 }),
  geo('forge', 'forge', 560, 488, 152, 126, [560, 506], [560, 498]),
  geo('archive', 'archive-b', 140, 486, 91, 72, [140, 502], [140, 498]),
  geo('vigil', 'vigil-booth', 906, 476, 56, 60, [906, 496], [906, 498]),
];
export const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/** Where smoke rises (forge chimney is painted into the day sprite). */
export const CHIMNEYS: [number, number][] = [[612, 390]];
/** Where ember particles rise (forge hearth, braziers). The archive brazier
 * is painted into the vault sprite, by its door. */
export const EMBER_ZONES: [number, number][] = [[542, 472], [133, 480], [380, 368]];
/** Halo lights, daylight-discreet: x, y, radius, strength. */
export const HALOS: [number, number, number, number][] = [
  [380, 366, 24, 0.4],    // tower brazier
  [542, 458, 44, 0.5],    // forge hearth
  [133, 478, 20, 0.35],   // archive brazier
];

const ROAD_BANDS: [number, number, number, number][] = [
  [-4, 180, 968, 24],   // top street
  [920, 180, 24, 174],  // east bend
  [190, 330, 754, 24],  // middle street
  [190, 330, 24, 192],  // west bend
  [128, 486, 836, 24],  // bottom street (reaches west to the archivist's desk)
  [-4, 64, 908, 24],    // caravan road
];

/* ---------- static background: ground + streets only ---------- */
/* Buildings and décor are NOT baked here: anything that moves (couriers on
 * the caravan road, the hero in the registry lane) must interleave with them
 * in one painter's-order pass, so the scenery list below is drawn per frame. */

export function paintGround(ctx: Ctx, img: WorldImages) {
  // v7 ground, the SNES idiom: calm grass everywhere, cobbles ONLY on the
  // streets. The previous all-stone tiling read as noise however much the
  // tile was flattened (« toujours un peu brouillon », operator 01/09); the
  // pale stone tile survives as street paving clipped to the road bands, so
  // the eye separates walkable paths from ground at a glance.
  const g = img.grass;
  const T = g.width;
  for (let j = 0; j * T < H; j++) {
    for (let i = 0; i * T < W; i++) ctx.drawImage(g, i * T, j * T);
  }
  const s = img.ground;
  const S = s.width;
  ctx.save();
  ctx.beginPath();
  for (const [x, y, w, h] of ROAD_BANDS) ctx.rect(x, y, w, h);
  ctx.clip();
  for (let j = 0; j * S < H; j++) {
    for (let i = 0; i * S < W; i++) ctx.drawImage(s, i * S, j * S);
  }
  ctx.restore();
  // a soft dark seam so the paving sits IN the grass instead of on it
  ctx.fillStyle = 'rgba(96,84,52,0.20)';
  for (const [x, y, w, h] of ROAD_BANDS) {
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillRect(x + w - 2, y, 2, h);
  }
}

/** Fixed scenery, merged with actors each frame and sorted by base line. */
export interface Placed { sprite: string; cx: number; base: number; scale?: number; flip?: boolean; id?: string }
export const SCENERY: Placed[] = [
  ...STATIONS.filter((s) => s.sprite).map((s) => ({
    sprite: s.sprite!, cx: s.cx, base: s.base, scale: s.scale, flip: s.flip, id: s.id,
  })),
  { sprite: 'signpost', cx: 322, base: 496 },   // border post sign, by the barrier
  { sprite: 'cart', cx: 172, base: 96 },        // parked caravan cart
  // greenery
  { sprite: 'tree1', cx: 34, base: 152 }, { sprite: 'tree2', cx: 790, base: 486 },
  { sprite: 'tree1', cx: 62, base: 394 }, { sprite: 'tree1', cx: 430, base: 158 },
  { sprite: 'tree2', cx: 938, base: 246 }, { sprite: 'tree1', cx: 386, base: 88 },
  { sprite: 'planter-red', cx: 502, base: 184 }, { sprite: 'topiary', cx: 262, base: 194 },
  { sprite: 'pot-yellow', cx: 148, base: 200 }, { sprite: 'ivy', cx: 605, base: 178 },
  { sprite: 'tuft1', cx: 150, base: 258 }, { sprite: 'tuft2', cx: 505, base: 395 },
  { sprite: 'tufts2', cx: 600, base: 440 }, { sprite: 'tuft1', cx: 60, base: 302 },
  { sprite: 'tuft2', cx: 866, base: 384 }, { sprite: 'tufts2', cx: 340, base: 442 },
  // the market corner slid east when the library claimed the square's centre
  // (operator's arrow, 01/09): well and tools now cluster right of it
  { sprite: 'grove', cx: 500, base: 164 }, { sprite: 'well', cx: 805, base: 174 },
  { sprite: 'planter2', cx: 745, base: 180 }, { sprite: 'wheelbarrow', cx: 862, base: 176 },
  { sprite: 'fence', cx: 905, base: 148 }, { sprite: 'rocks', cx: 120, base: 300 },
  // village life props on the bottom street
  { sprite: 'barrel-group', cx: 712, base: 470 }, { sprite: 'sacks', cx: 214, base: 90 },
  { sprite: 'barrel-cart', cx: 438, base: 478 },
  { sprite: 'hay', cx: 860, base: 500 }, { sprite: 'rock-big', cx: 925, base: 522 },
];

/* The hand-painted Swiss cross badge died with the generic SIX house: the
 * bespoke clearing-house board carries its own painted flag. */

/** Peripheral night vignette, prerendered once at world size. */
export function paintVignette(ctx: Ctx) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.56, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(30,24,14,0)');
  g.addColorStop(1, 'rgba(30,24,14,0.10)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- actors ---------- */

export type ActorKind =
  | 'hero' | 'cour-a' | 'cour-b' | 'cour-c'
  | 'clerk0' | 'clerk1' | 'clerk2' | 'clerk3' | 'clerk4' | 'clerk5';

export interface Actor {
  x: number; y: number; dir: 1 | -1;
  kind: ActorKind;
  /** last movement axis, for sprite facing */
  face?: 'side' | 'up' | 'down';
  moving?: boolean; hidden?: boolean;
}

/** Characters draw at 0.75: measured against the boards' doors the old size
 * towered over every doorway; at 30px the hero matches the SNES convention
 * (door ≈ hero) and the buildings regain their standing. */
export const ACTOR_SCALE = 0.75;

export function drawActor(ctx: Ctx, img: WorldImages, a: Actor, t: number, reduced: boolean) {
  if (a.hidden) return;
  const bob = reduced ? 0 : a.moving ? (Math.floor(t / 130) % 2) : (Math.floor(t / 900) % 2) * 0.5;
  let name: string;
  if (a.kind.startsWith('clerk')) {
    name = a.kind;
  } else {
    const face = a.face ?? 'down';
    const suffix = face === 'side' ? 'side' : face === 'up' ? 'back' : 'front';
    name = `${a.kind}-${suffix}`;
  }
  // soft contact shadow first, sprite on top
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#0A0A12';
  ctx.beginPath();
  ctx.ellipse(a.x, a.y + 1.5, 7, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawSprite(ctx, img, name, a.x, a.y, {
    flip: (a.face ?? 'down') === 'side' && a.dir < 0,
    dy: -bob,
    scale: ACTOR_SCALE,
  });
}

export { SPINE };
