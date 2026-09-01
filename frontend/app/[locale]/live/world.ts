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

/* ---------- geometry ---------- */

export const REGISTRY_CCS = ['DE', 'AT', 'BE', 'BG', 'NL', 'FI'] as const;
const REGISTRY_SPRITES = ['house0', 'house1', 'house2', 'house3', 'house4', 'house1'];
const REGISTRY_X0 = 560;
const REGISTRY_STEP = 68;
export const LANE_X = 600;
export const LANE_DOOR_Y = 136;

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
}

function geo(
  id: string, sprite: string | null, cx: number, base: number,
  bw: number, bh: number, door: [number, number], anchor: [number, number], cc?: string,
): StationGeo {
  return { id, sprite, cx, base, bx: cx - bw / 2, by: base - bh, bw, bh, door, anchor, cc };
}

export const STATIONS: StationGeo[] = [
  geo('gate', 'gate', 80, 180, 84, 116, [80, 200], [80, 192]),
  geo('scribe', 'stall-red', 204, 178, 64, 74, [204, 200], [204, 192]),
  geo('cutter', 'stall-teal', 318, 178, 62, 70, [318, 200], [318, 192]),
  geo('library', 'library', 472, 172, 172, 136, [472, 200], [472, 192]),
  ...REGISTRY_CCS.map((cc, i) =>
    geo(`reg-${cc}`, REGISTRY_SPRITES[i], REGISTRY_X0 + i * REGISTRY_STEP, 118, 62, 116,
      [REGISTRY_X0 + i * REGISTRY_STEP, LANE_DOOR_Y], [LANE_X, 192], cc),
  ),
  geo('warehouse', 'warehouse', 70, 96, 132, 108, [112, 98], [112, 76]),
  geo('six', 'house3', 852, 326, 76, 116, [852, 348], [852, 342]),
  geo('court', 'house-big', 716, 322, 100, 146, [716, 348], [716, 342]),
  geo('classifier', 'house2', 582, 326, 76, 116, [582, 348], [582, 342]),
  geo('border', 'fence', 438, 348, 104, 46, [438, 352], [438, 342]),
  geo('tower', 'tower', 176, 330, 102, 170, [202, 344], [202, 342]),
  geo('forge', 'forge', 410, 486, 152, 126, [410, 506], [410, 498]),
  geo('archive', 'desk-day', 246, 482, 70, 50, [246, 504], [246, 498]),
  geo('vigil', 'vigil-booth', 900, 474, 56, 60, [900, 496], [900, 498]),
];
export const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/** Where smoke rises (forge chimney is painted into the day sprite). */
export const CHIMNEYS: [number, number][] = [[462, 386]];
/** Where ember particles rise (forge hearth, braziers). */
export const EMBER_ZONES: [number, number][] = [[392, 470], [224, 488], [196, 176]];
/** Halo lights, daylight-discreet: x, y, radius, strength. */
export const HALOS: [number, number, number, number][] = [
  [196, 170, 32, 0.4],    // tower brazier
  [392, 456, 44, 0.5],    // forge hearth
  [224, 484, 20, 0.35],   // archive brazier
];

const ROAD_BANDS: [number, number, number, number][] = [
  [-4, 180, 968, 24],   // top street
  [920, 180, 24, 174],  // east bend
  [190, 330, 754, 24],  // middle street
  [190, 330, 24, 192],  // west bend
  [190, 486, 774, 24],  // bottom street
  [588, 122, 24, 82],   // registry lane
  [-4, 64, 908, 24],    // caravan road
];

/* ---------- static background: ground + streets only ---------- */
/* Buildings and décor are NOT baked here: anything that moves (couriers on
 * the caravan road, the hero in the registry lane) must interleave with them
 * in one painter's-order pass, so the scenery list below is drawn per frame. */

export function paintGround(ctx: Ctx, img: WorldImages) {
  // checkered 180°-rotated tiling breaks the visible repetition of the tile;
  // the step follows the tile's real size (day tile: 160px)
  // plain tiling: the day tile is organic enough that straight repetition
  // reads softer than a checkered rotation (whose gradient made a patchwork)
  const g = img.ground;
  const T = g.width;
  for (let j = 0; j * T < H; j++) {
    for (let i = 0; i * T < W; i++) {
      ctx.drawImage(g, i * T, j * T);
    }
  }
  // worn-earth streets on the pale cobbles (daylight)
  for (const [x, y, w, h] of ROAD_BANDS) {
    ctx.fillStyle = 'rgba(128,100,70,0.26)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(96,74,50,0.18)';
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
  }

}

/** Fixed scenery, merged with actors each frame and sorted by base line. */
export interface Placed { sprite: string; cx: number; base: number; scale?: number }
export const SCENERY: Placed[] = [
  ...STATIONS.filter((s) => s.sprite).map((s) => ({ sprite: s.sprite!, cx: s.cx, base: s.base })),
  { sprite: 'signpost', cx: 478, base: 336 },   // border post sign
  { sprite: 'ember-line', cx: 224, base: 494 }, // archive brazier
  { sprite: 'cart', cx: 148, base: 92 },        // parked caravan cart
  // greenery
  { sprite: 'tree1', cx: 32, base: 150 }, { sprite: 'tree2', cx: 930, base: 420 },
  { sprite: 'tree1', cx: 62, base: 392 }, { sprite: 'grove', cx: 300, base: 292 },
  { sprite: 'tree2', cx: 935, base: 244 }, { sprite: 'tree1', cx: 390, base: 86 },
  { sprite: 'planter-red', cx: 508, base: 180 }, { sprite: 'topiary', cx: 268, base: 192 },
  { sprite: 'pot-yellow', cx: 148, base: 198 }, { sprite: 'planter2', cx: 660, base: 350 },
  { sprite: 'ivy', cx: 428, base: 176 },
  { sprite: 'tuft1', cx: 240, base: 220 }, { sprite: 'tuft2', cx: 500, base: 260 },
  { sprite: 'tufts2', cx: 640, base: 240 }, { sprite: 'tuft1', cx: 60, base: 300 },
  { sprite: 'tuft2', cx: 890, base: 380 }, { sprite: 'tufts2', cx: 340, base: 440 },
  // village life props
  { sprite: 'well', cx: 120, base: 470 },
  { sprite: 'barrel-group', cx: 150, base: 110 }, { sprite: 'sacks', cx: 186, base: 96 },
  { sprite: 'barrel-cart', cx: 484, base: 496 }, { sprite: 'wheelbarrow', cx: 540, base: 500 },
  { sprite: 'hay', cx: 58, base: 506 }, { sprite: 'fence', cx: 292, base: 340 },
  { sprite: 'rocks', cx: 352, base: 244 }, { sprite: 'rock-big', cx: 925, base: 522 },
];

/** Station signs drawn after the scenery/actor pass (nothing crosses them). */
export function drawSigns(ctx: Ctx, img: WorldImages) {
  void img;
  // Swiss cross badge on the SIX house banner
  ctx.fillStyle = '#C0392B';
  ctx.fillRect(845, 246, 13, 11);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(850, 248, 3, 7);
  ctx.fillRect(848, 250, 7, 3);
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
