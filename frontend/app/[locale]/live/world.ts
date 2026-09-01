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
const REGISTRY_X0 = 540;
const REGISTRY_STEP = 64;
export const LANE_X = 600;
export const LANE_DOOR_Y = 134;

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
  geo('gate', 'house0', 80, 176, 80, 116, [80, 198], [80, 192]),
  geo('scribe', 'desk', 200, 172, 66, 54, [200, 198], [200, 192]),
  geo('cutter', 'desk', 306, 172, 66, 54, [306, 198], [306, 192]),
  geo('library', 'house-big', 430, 168, 100, 146, [430, 198], [430, 192]),
  ...REGISTRY_CCS.map((cc, i) =>
    geo(`reg-${cc}`, REGISTRY_SPRITES[i], REGISTRY_X0 + i * REGISTRY_STEP, 118, 62, 116,
      [REGISTRY_X0 + i * REGISTRY_STEP, LANE_DOOR_Y], [LANE_X, 192], cc),
  ),
  geo('warehouse', 'cart', 62, 84, 76, 60, [104, 84], [104, 84]),
  geo('six', 'house3', 852, 326, 76, 116, [852, 348], [852, 342]),
  geo('court', 'house-big', 716, 322, 100, 146, [716, 348], [716, 342]),
  geo('classifier', 'house2', 582, 326, 76, 116, [582, 348], [582, 342]),
  geo('border', 'checkpoint', 438, 344, 100, 100, [438, 352], [438, 342]),
  geo('tower', 'tower', 190, 326, 70, 176, [202, 344], [202, 342]),
  geo('forge', 'furnace', 410, 482, 130, 130, [410, 504], [410, 498]),
  geo('archive', 'desk', 246, 480, 80, 56, [246, 504], [246, 498]),
  geo('vigil', 'vigil-post', 900, 468, 60, 64, [900, 494], [900, 498]),
];
export const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/** Ambience décor: lantern posts along the streets. */
export const LANTERNS: [number, number][] = [[128, 452], [528, 208], [704, 368], [655, 150]];
/** Chimneys glued onto roofs (x, base, smoke source). */
export const CHIMNEYS: [number, number][] = [[455, 96], [733, 212]];
/** Where ember particles rise. */
export const EMBER_ZONES: [number, number][] = [[410, 480], [222, 488], [190, 176]];
/** Halo lights: x, y, radius, strength, flicker phase. */
export const HALOS: [number, number, number, number][] = [
  [196, 172, 46, 0.55],   // tower flame
  [410, 452, 64, 0.6],    // forge
  [128, 424, 34, 0.45], [528, 180, 34, 0.45], [704, 340, 34, 0.45], [655, 122, 34, 0.45],
  [900, 442, 26, 0.4],    // vigil
  [222, 484, 26, 0.4],    // archive brazier
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
  // checkered 180°-rotated tiling breaks the visible repetition of the tile
  const g = img.ground;
  for (let j = 0; j * 256 < H; j++) {
    for (let i = 0; i * 256 < W; i++) {
      if ((i + j) % 2 === 0) {
        ctx.drawImage(g, i * 256, j * 256);
      } else {
        ctx.save();
        ctx.translate(i * 256 + 128, j * 256 + 128);
        ctx.rotate(Math.PI);
        ctx.drawImage(g, -128, -128);
        ctx.restore();
      }
    }
  }
  // warm-lit streets
  for (const [x, y, w, h] of ROAD_BANDS) {
    ctx.fillStyle = 'rgba(255,208,130,0.14)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,208,130,0.10)';
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
  }

}

/** Fixed scenery, merged with actors each frame and sorted by base line. */
export interface Placed { sprite: string; cx: number; base: number; scale?: number }
export const SCENERY: Placed[] = [
  ...STATIONS.filter((s) => s.sprite).map((s) => ({ sprite: s.sprite!, cx: s.cx, base: s.base })),
  { sprite: 'anvil', cx: 458, base: 486 },
  { sprite: 'embers', cx: 382, base: 496 },
  { sprite: 'ember-line', cx: 222, base: 492 },
  ...LANTERNS.map(([x, y]) => ({ sprite: 'lantern', cx: x, base: y })),
  ...CHIMNEYS.map(([x, y]) => ({ sprite: 'chimney', cx: x, base: y })),
];

/** Station signs, high on the walls — nothing ever passes in front of them,
 * so one draw after the scenery/actor pass is safe. */
export function drawSigns(ctx: Ctx, img: WorldImages) {
  drawSprite(ctx, img, 'coin-sign', 80, 100);             // toll gate
  drawSprite(ctx, img, 'ingot', 430, 62, { scale: 0.9 }); // library lintel
  ctx.fillStyle = '#C0392B';                               // Swiss badge (SIX)
  ctx.fillRect(846, 232, 12, 10);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(851, 234, 2, 6);
  ctx.fillRect(848, 236, 8, 2);
}

/** Peripheral night vignette, prerendered once at world size. */
export function paintVignette(ctx: Ctx) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.44, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, 'rgba(8,8,14,0)');
  g.addColorStop(1, 'rgba(8,8,14,0.42)');
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
