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
}

export async function loadWorldImages(base = '/village'): Promise<WorldImages> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  const [atlas, ground, metaRes] = await Promise.all([
    load(`${base}/atlas.png`),
    load(`${base}/ground.png`),
    fetch(`${base}/atlas.json`),
  ]);
  const meta = (await metaRes.json()) as AtlasMeta;
  return { atlas, meta, ground };
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
 * Rebalanced 01/09/2026 on the operator's report: the first row sat shoulder
 * to shoulder while the last one gaped. The registry row now spaces by each
 * house's REAL width (the day board's four houses differ), the library gives
 * the row room, and the bottom street gains a lived-in cluster (well, casks,
 * tree, hay) between the forge and the vigil. Coordinates were tuned on the
 * pipeline's layout-preview.png, not in the browser. */

export const REGISTRY_CCS = ['DE', 'AT', 'BE', 'BG', 'NL', 'FI'] as const;
/** Day-board houses by true width; NL and FI reuse a face mirrored, which the
 * fantasy banner glyphs absorb (nothing readable to mirror). */
const REGISTRY_LANE: { sprite: string; cx: number; w: number; flip?: boolean }[] = [
  { sprite: 'house0', cx: 564, w: 95 },
  { sprite: 'house1', cx: 643, w: 52 },
  { sprite: 'house2', cx: 715, w: 80 },
  { sprite: 'house3', cx: 790, w: 59 },
  { sprite: 'house1', cx: 852, w: 52, flip: true },
  { sprite: 'house3', cx: 914, w: 59, flip: true },
];
const REGISTRY_BASE = 120;
const REGISTRY_DOOR_Y = 138;

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
  geo('scribe', 'stall-red', 196, 180, 64, 74, [196, 200], [196, 192]),
  geo('cutter', 'stall-teal', 306, 180, 62, 70, [306, 200], [306, 192]),
  geo('library', 'library', 414, 176, 176, 126, [414, 200], [414, 192], { scale: 0.92 }),
  ...REGISTRY_LANE.map((h, i) =>
    geo(`reg-${REGISTRY_CCS[i]}`, h.sprite, h.cx, REGISTRY_BASE, h.w, 100,
      [h.cx, REGISTRY_DOOR_Y], [h.cx, 192], { cc: REGISTRY_CCS[i], flip: h.flip }),
  ),
  geo('warehouse', 'warehouse', 84, 106, 132, 104, [120, 98], [120, 76]),
  geo('classifier', 'house1', 604, 334, 60, 112, [604, 352], [604, 342], { scale: 1.12 }),
  geo('court', 'house-big', 744, 338, 120, 150, [744, 352], [744, 342]),
  geo('six', 'house3', 884, 334, 68, 112, [884, 352], [884, 342], { flip: true, scale: 1.12 }),
  geo('border', 'fence', 430, 350, 104, 46, [430, 352], [430, 342]),
  geo('tower', 'tower', 170, 332, 74, 170, [188, 344], [188, 342]),
  geo('forge', 'forge', 430, 488, 152, 126, [430, 506], [430, 498]),
  geo('archive', 'desk-day', 250, 484, 70, 50, [250, 504], [250, 498]),
  geo('vigil', 'vigil-booth', 906, 476, 56, 60, [906, 496], [906, 498]),
];
export const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/** Where smoke rises (forge chimney is painted into the day sprite). */
export const CHIMNEYS: [number, number][] = [[482, 390]];
/** Where ember particles rise (forge hearth, braziers). */
export const EMBER_ZONES: [number, number][] = [[412, 472], [228, 490], [170, 172]];
/** Halo lights, daylight-discreet: x, y, radius, strength. */
export const HALOS: [number, number, number, number][] = [
  [170, 166, 30, 0.4],    // tower brazier
  [412, 458, 44, 0.5],    // forge hearth
  [228, 486, 20, 0.35],   // archive brazier
];

const ROAD_BANDS: [number, number, number, number][] = [
  [-4, 180, 968, 24],   // top street
  [920, 180, 24, 174],  // east bend
  [190, 330, 754, 24],  // middle street
  [190, 330, 24, 192],  // west bend
  [190, 486, 774, 24],  // bottom street
  [-4, 64, 908, 24],    // caravan road
  // one little path per registry door: the shared vertical lane died with the
  // fixed-step row — the gaps between real-width houses are too narrow to
  // walk, so the hero now climbs to each door from the street below.
  ...REGISTRY_LANE.map((h): [number, number, number, number] => [h.cx - 5, 134, 10, 50]),
];

/* ---------- static background: ground + streets only ---------- */
/* Buildings and décor are NOT baked here: anything that moves (couriers on
 * the caravan road, the hero in the registry lane) must interleave with them
 * in one painter's-order pass, so the scenery list below is drawn per frame. */

export function paintGround(ctx: Ctx, img: WorldImages) {
  // The tile is pre-flattened at build time (local stone-joint contrast
  // halved, saturation down, wider 208px period): the operator's report was
  // that the ground SHOUTED and confused the eye. The checkered 180° rotation
  // is back on top of that — on the calmed tile it breaks the period without
  // re-creating the old patchwork. Step follows the tile's real size.
  const g = img.ground;
  const T = g.width;
  for (let j = 0; j * T < H; j++) {
    for (let i = 0; i * T < W; i++) {
      if ((i + j) % 2 === 1) {
        ctx.save();
        ctx.translate(i * T + T / 2, j * T + T / 2);
        ctx.rotate(Math.PI);
        ctx.drawImage(g, -T / 2, -T / 2);
        ctx.restore();
      } else {
        ctx.drawImage(g, i * T, j * T);
      }
    }
  }
  // worn-earth streets on the pale cobbles (daylight)
  for (const [x, y, w, h] of ROAD_BANDS) {
    ctx.fillStyle = 'rgba(134,104,72,0.28)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(96,74,50,0.18)';
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
  }

}

/** Fixed scenery, merged with actors each frame and sorted by base line. */
export interface Placed { sprite: string; cx: number; base: number; scale?: number; flip?: boolean; id?: string }
export const SCENERY: Placed[] = [
  ...STATIONS.filter((s) => s.sprite).map((s) => ({
    sprite: s.sprite!, cx: s.cx, base: s.base, scale: s.scale, flip: s.flip, id: s.id,
  })),
  { sprite: 'signpost', cx: 470, base: 338 },   // border post sign
  { sprite: 'ember-line', cx: 228, base: 496 }, // archive brazier
  { sprite: 'cart', cx: 172, base: 96 },        // parked caravan cart
  // greenery
  { sprite: 'tree1', cx: 34, base: 152 }, { sprite: 'tree2', cx: 790, base: 486 },
  { sprite: 'tree1', cx: 62, base: 394 }, { sprite: 'grove', cx: 300, base: 296 },
  { sprite: 'tree2', cx: 938, base: 246 }, { sprite: 'tree1', cx: 386, base: 88 },
  { sprite: 'planter-red', cx: 502, base: 184 }, { sprite: 'topiary', cx: 262, base: 194 },
  { sprite: 'pot-yellow', cx: 148, base: 200 }, { sprite: 'planter2', cx: 668, base: 352 },
  { sprite: 'ivy', cx: 366, base: 178 },
  { sprite: 'tuft1', cx: 240, base: 222 }, { sprite: 'tuft2', cx: 500, base: 262 },
  { sprite: 'tufts2', cx: 640, base: 242 }, { sprite: 'tuft1', cx: 60, base: 302 },
  { sprite: 'tuft2', cx: 866, base: 384 }, { sprite: 'tufts2', cx: 340, base: 442 },
  // village life props — the bottom street's lived-in cluster fills what used
  // to be the map's one empty quarter (operator's report, 01/09)
  { sprite: 'well', cx: 640, base: 478 },
  { sprite: 'barrel-group', cx: 712, base: 470 }, { sprite: 'sacks', cx: 214, base: 90 },
  { sprite: 'barrel-cart', cx: 500, base: 498 }, { sprite: 'wheelbarrow', cx: 548, base: 502 },
  { sprite: 'hay', cx: 860, base: 500 }, { sprite: 'fence', cx: 296, base: 328 },
  { sprite: 'rocks', cx: 352, base: 246 }, { sprite: 'rock-big', cx: 925, base: 522 },
];

/** Station signs drawn after the scenery/actor pass (nothing crosses them). */
export function drawSigns(ctx: Ctx, img: WorldImages) {
  void img;
  // Swiss cross badge on the SIX house banner (mirrored red day-house: the
  // banner sits right of centre once flipped; position derived from the
  // station rather than retyped so a layout move cannot strand it)
  const six = stationById['six'];
  const bx = Math.round(six.cx + 8), by = Math.round(six.base - 57);
  ctx.fillStyle = '#C0392B';
  ctx.fillRect(bx, by, 13, 11);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(bx + 5, by + 2, 3, 7);
  ctx.fillRect(bx + 3, by + 4, 7, 3);
}

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
  ctx.ellipse(a.x, a.y + 1.5, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawSprite(ctx, img, name, a.x, a.y, {
    flip: (a.face ?? 'down') === 'side' && a.dir < 0,
    dy: -bob,
  });
}

export { SPINE };
