/**
 * The village world: geometry, palette and procedural sprites.
 *
 * Pure module — no React, no DOM globals at import time. Everything here draws
 * into a 480×270 logical world rendered at 2× into a 960×540 canvas.
 *
 * Sprites are deliberate placeholders drawn in the validated palette; the
 * Midjourney boards keep the same silhouettes and will replace them sheet by
 * sheet without touching the engine.
 */

import { SPINE } from '@/lib/village/roads';

export const W = 480;
export const H = 270;
export const SCALE = 2;

export const P = {
  ground: '#FDF6DC', ground2: '#F8EECB', grass: '#E8E0A8',
  road: '#EFDFAE', roadEdge: '#D9C382',
  wall: '#EAD9B0', wall2: '#DFC894', timber: '#8A6B44',
  roof: '#3F3F46', roof2: '#27272A', roofHi: '#52525B',
  stone: '#C8BFAA', stone2: '#AFA48C',
  win: '#F59E0B', winHi: '#FBBF24', fire: '#F59E0B', fireHi: '#FDE68A',
  ink: '#27272A',
  heroCloak: '#FBBF24', heroCloak2: '#D97706', heroEye: '#FFF7CC',
  ok: '#3F9D5A', bad: '#C24034',
  smoke: 'rgba(120,113,104,.55)',
} as const;

export const BANNERS = ['#E0A93E', '#4C6FAE', '#3E7A5A', '#8C3B3B', '#31456E', '#B0653C'];

/** Registry-house order along the lane; index = banner color + x slot. */
export const REGISTRY_CCS = ['DE', 'AT', 'BE', 'BG', 'NL', 'FI'] as const;

export interface StationGeo {
  id: string;
  x: number; y: number; w: number; h: number;
  /** Where an actor stands when visiting. */
  door: [number, number];
  /** Curved-path anchor on the main road spine (see roadRoute). */
  anchor: [number, number];
  cc?: string;
  flag?: number;
}

export const STATIONS: StationGeo[] = [
  { id: 'gate', x: 18, y: 52, w: 36, h: 34, door: [38, 90], anchor: [38, 90] },
  { id: 'scribe', x: 84, y: 60, w: 28, h: 26, door: [98, 90], anchor: [98, 90] },
  { id: 'cutter', x: 140, y: 66, w: 30, h: 20, door: [155, 90], anchor: [155, 90] },
  { id: 'library', x: 194, y: 46, w: 46, h: 40, door: [217, 90], anchor: [217, 90] },
  ...REGISTRY_CCS.map((cc, i) => ({
    id: `reg-${cc}`, cc, flag: i,
    x: 258 + i * 30, y: 30, w: 20, h: 28,
    door: [268 + i * 30, 62] as [number, number],
    anchor: [300, 90] as [number, number],
  })),
  { id: 'six', x: 404, y: 128, w: 30, h: 24, door: [419, 156], anchor: [419, 156] },
  { id: 'court', x: 336, y: 122, w: 34, h: 30, door: [353, 156], anchor: [353, 156] },
  { id: 'classifier', x: 272, y: 128, w: 32, h: 24, door: [288, 156], anchor: [288, 156] },
  { id: 'border', x: 206, y: 130, w: 30, h: 22, door: [221, 156], anchor: [221, 156] },
  { id: 'tower', x: 132, y: 96, w: 22, h: 58, door: [143, 158], anchor: [143, 156] },
  { id: 'forge', x: 168, y: 192, w: 60, h: 44, door: [198, 240], anchor: [198, 240] },
  { id: 'archive', x: 106, y: 204, w: 26, h: 26, door: [119, 234], anchor: [119, 240] },
  { id: 'warehouse', x: 432, y: 10, w: 38, h: 28, door: [451, 42], anchor: [451, 42] },
  { id: 'vigil', x: 446, y: 180, w: 18, h: 34, door: [455, 218], anchor: [455, 218] },
];
export const stationById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/* ---------- drawing primitives ---------- */
export type Ctx = CanvasRenderingContext2D;
export const px = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h);
};

function house(c: Ctx, s: StationGeo) {
  const { x, y, w, h, flag = 0 } = s;
  px(c, x, y + 10, w, h - 10, P.wall); px(c, x, y + 10, w, 2, P.wall2);
  px(c, x - 1, y + 4, w + 2, 7, P.roof); px(c, x + 1, y + 2, w - 2, 3, P.roof2); px(c, x + 1, y + 4, w - 2, 1, P.roofHi);
  px(c, x + 3, y + 14, 4, 5, P.win); px(c, x + w - 7, y + 14, 4, 5, P.win);
  px(c, x + (w >> 1) - 3, y + h - 9, 6, 9, P.timber);
  px(c, x + (w >> 1) - 2, y - 4, 1, 8, P.timber);
  px(c, x + (w >> 1) - 1, y - 4, 6, 9, BANNERS[flag % BANNERS.length]);
  px(c, x + (w >> 1) - 1, y - 4, 6, 1, 'rgba(255,255,255,.35)');
}

function bigHall(c: Ctx, s: StationGeo, o: { win?: number; chimney?: boolean; anvil?: boolean; book?: boolean; scales?: boolean }) {
  const { x, y, w, h } = s;
  px(c, x, y + 8, w, h - 8, P.wall); px(c, x, y + 8, w, 2, P.wall2);
  px(c, x - 2, y, w + 4, 10, P.roof); px(c, x, y - 2, w, 4, P.roof2);
  const n = o.win ?? 2;
  for (let i = 0; i < n; i++) px(c, x + 5 + i * (n > 1 ? ((w - 10) / (n - 1)) | 0 : 0), y + 14, 5, 7, P.win);
  px(c, x + (w >> 1) - 4, y + h - 11, 8, 11, P.timber);
  if (o.chimney) { px(c, x + w - 10, y - 10, 6, 12, P.stone2); px(c, x + w - 9, y - 11, 4, 2, P.ink); }
  if (o.anvil) { px(c, x + 8, y + h - 6, 10, 3, P.ink); px(c, x + 11, y + h - 9, 4, 3, P.ink); }
  if (o.book) { px(c, x + (w >> 1) - 5, y + 3, 10, 5, '#FFFBEB'); px(c, x + (w >> 1) - 1, y + 3, 1, 5, P.timber); }
  if (o.scales) { px(c, x + (w >> 1) - 1, y + 1, 2, 6, P.ink); px(c, x + (w >> 1) - 6, y + 3, 4, 2, P.ink); px(c, x + (w >> 1) + 3, y + 3, 4, 2, P.ink); }
}

function hut(c: Ctx, s: StationGeo, sign?: 'quill' | 'knife') {
  const { x, y, w, h } = s;
  px(c, x, y + 7, w, h - 7, P.wall2); px(c, x - 1, y + 1, w + 2, 8, P.roof);
  px(c, x + 3, y + 11, 4, 5, P.win); px(c, x + w - 8, y + h - 9, 5, 9, P.timber);
  if (sign === 'quill') { px(c, x + w - 3, y - 3, 6, 6, '#FFFBEB'); px(c, x + w - 1, y - 2, 1, 4, P.timber); }
  if (sign === 'knife') { px(c, x + 2, y + 2, 8, 2, P.stone2); px(c, x + 2, y + 1, 3, 4, P.ink); }
}

function towerDraw(c: Ctx, s: StationGeo) {
  const { x, y, w, h } = s;
  px(c, x + 2, y + 10, w - 4, h - 10, P.stone); px(c, x + 2, y + 10, w - 4, 2, P.stone2);
  px(c, x, y + 6, w, 6, P.stone2);
  for (let i = 0; i < 3; i++) px(c, x + 1 + i * 7, y + 3, 4, 4, P.stone2);
  px(c, x + 7, y + h - 12, 7, 12, P.ink); px(c, x + 7, y + 26, 7, 6, P.win);
}

function gateDraw(c: Ctx, s: StationGeo) {
  const { x, y, w, h } = s;
  px(c, x, y + 6, 10, h - 6, P.stone); px(c, x + w - 10, y + 6, 10, h - 6, P.stone);
  px(c, x, y + 2, 10, 6, P.stone2); px(c, x + w - 10, y + 2, 10, 6, P.stone2);
  px(c, x + 8, y + 12, w - 16, 7, P.stone2); px(c, x + 10, y + 19, w - 20, 15, '#F3E7BC');
  px(c, x + 2, y + 16, 3, 4, P.win); px(c, x + w - 5, y + 16, 3, 4, P.win);
  px(c, x + (w >> 1) - 3, y + 6, 7, 7, P.winHi); px(c, x + (w >> 1) - 1, y + 8, 3, 3, P.win);
}

function boothDraw(c: Ctx, s: StationGeo) {
  const { x, y, w, h } = s;
  px(c, x, y + 6, w, h - 6, P.wall); px(c, x - 1, y, w + 2, 8, '#8C3B3B'); px(c, x - 1, y, w + 2, 2, '#A34747');
  px(c, x + 4, y + 11, w - 8, 6, P.win);
  px(c, x + w - 9, y + 2, 7, 5, '#C24034'); px(c, x + w - 7, y + 3, 3, 1, '#FFF'); px(c, x + w - 6, y + 2, 1, 3, '#FFF');
}

function wareDraw(c: Ctx, s: StationGeo) {
  const { x, y, w, h } = s;
  px(c, x, y + 8, w, h - 8, '#D8C08A'); px(c, x - 2, y, w + 4, 10, P.roof);
  px(c, x + 6, y + 12, 8, 10, P.timber); px(c, x + w - 14, y + 12, 8, 10, P.timber);
}

function vigilDraw(c: Ctx, s: StationGeo) {
  const { x, y, w, h } = s;
  px(c, x + 3, y + 8, w - 6, h - 8, P.stone2); px(c, x, y + 4, w, 6, P.roof);
  px(c, x + 6, y + 14, 5, 5, P.winHi);
}

function well(c: Ctx, x: number, y: number) {
  px(c, x, y, 14, 8, P.stone); px(c, x + 2, y + 2, 10, 4, '#6E9BB5');
  px(c, x - 1, y - 6, 2, 8, P.timber); px(c, x + 13, y - 6, 2, 8, P.timber); px(c, x - 1, y - 7, 16, 2, P.roof);
}
function tree(c: Ctx, x: number, y: number) {
  px(c, x + 3, y + 8, 3, 5, P.timber); px(c, x, y, 9, 9, '#B9C46F');
  px(c, x + 2, y - 3, 5, 5, '#C9D385'); px(c, x + 2, y + 2, 2, 2, '#DDE4A4');
}
export function brazier(c: Ctx, x: number, y: number, lit: boolean) {
  px(c, x, y, 8, 3, P.ink); px(c, x + 1, y - 2, 6, 2, P.ink);
  if (lit) { px(c, x + 2, y - 5, 4, 3, P.fire); px(c, x + 3, y - 7, 2, 2, P.fireHi); }
}
export function cartDraw(c: Ctx, x: number, y: number) {
  px(c, x, y - 6, 18, 7, '#8A6B44'); px(c, x + 1, y - 9, 16, 4, '#A9885B');
  px(c, x + 2, y + 1, 4, 4, P.ink); px(c, x + 12, y + 1, 4, 4, P.ink);
  px(c, x + 18, y - 4, 6, 3, '#C9A15E'); px(c, x + 23, y - 6, 2, 2, '#8A6B44');
}

function drawRoadSeg(c: Ctx, a: [number, number], b: [number, number], w: number) {
  const x1 = Math.min(a[0], b[0]), y1 = Math.min(a[1], b[1]);
  const ww = Math.abs(b[0] - a[0]), hh = Math.abs(b[1] - a[1]);
  if (ww) {
    px(c, x1 - w / 2, y1 - w / 2, ww + w, w, P.road);
    px(c, x1 - w / 2, y1 - w / 2, ww + w, 1, P.roadEdge); px(c, x1 - w / 2, y1 + w / 2 - 1, ww + w, 1, P.roadEdge);
  } else {
    px(c, x1 - w / 2, y1 - w / 2, w, hh + w, P.road);
    px(c, x1 - w / 2, y1 - w / 2, 1, hh + w, P.roadEdge); px(c, x1 + w / 2 - 1, y1 - w / 2, 1, hh + w, P.roadEdge);
  }
}

/** Paints the full static background into an offscreen canvas. */
export function paintBackground(bgc: Ctx) {
  px(bgc, 0, 0, W, H, P.ground);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) { const x = (rnd() * W) | 0, y = (rnd() * H) | 0; px(bgc, x, y, 2, 1, rnd() < 0.5 ? P.grass : P.ground2); }
  for (let i = 0; i < 26; i++) { const x = (rnd() * W) | 0, y = (rnd() * H) | 0; px(bgc, x, y, 6, 4, P.ground2); }
  for (let i = 0; i < SPINE.length - 1; i++) drawRoadSeg(bgc, SPINE[i], SPINE[i + 1], 12);
  drawRoadSeg(bgc, [300, 90], [300, 62], 8);   // registry lane
  drawRoadSeg(bgc, [-20, 44], [430, 44], 8);   // caravan road
  // village square
  px(bgc, 16, 196, 64, 52, P.road); px(bgc, 16, 196, 64, 1, P.roadEdge); px(bgc, 16, 247, 64, 1, P.roadEdge);
  well(bgc, 38, 214);
  tree(bgc, 6, 170); tree(bgc, 300, 196); tree(bgc, 360, 210); tree(bgc, 64, 116); tree(bgc, 238, 6); tree(bgc, 120, 20);
  const S = stationById;
  gateDraw(bgc, S.gate); hut(bgc, S.scribe, 'quill'); hut(bgc, S.cutter, 'knife');
  bigHall(bgc, S.library, { win: 3, book: true });
  STATIONS.filter((s) => s.flag !== undefined).forEach((s) => house(bgc, s));
  boothDraw(bgc, S.six); bigHall(bgc, S.court, { win: 2, scales: true }); hut(bgc, S.classifier);
  hut(bgc, S.border); px(bgc, 232, 146, 2, 10, P.timber); px(bgc, 226, 146, 14, 2, '#C24034');
  towerDraw(bgc, S.tower); bigHall(bgc, S.forge, { win: 3, chimney: true, anvil: true });
  hut(bgc, S.archive); wareDraw(bgc, S.warehouse); vigilDraw(bgc, S.vigil);
  px(bgc, 470, 232, 10, 16, P.roadEdge);
}

/* ---------- actors ---------- */
export interface Actor {
  x: number; y: number; dir: 1 | -1;
  c1: string; c2: string;
  eyes?: boolean; satchel?: boolean; lantern?: boolean; scroll?: boolean;
  moving?: boolean; hidden?: boolean;
}

export function drawActor(c: Ctx, a: Actor, t: number, reduced: boolean) {
  if (a.hidden) return;
  const bob = reduced ? 0 : a.moving ? Math.floor(t / 140) % 2 : 0;
  const { x } = a; const yy = a.y - 12 - bob;
  px(c, x - 3, yy + 8, 2, 4, '#4A3B28'); px(c, x + 1, yy + 8, 2, 4, '#4A3B28');
  px(c, x - 4, yy + 2, 8, 7, a.c1); px(c, x - 4, yy + 7, 8, 2, a.c2);
  px(c, x - 3, yy - 2, 6, 5, a.c1); px(c, x - 2, yy - 3, 4, 2, a.c1);
  if (a.eyes) {
    const g = Math.floor(t / 900) % 2 ? P.heroEye : '#FDE68A';
    px(c, x - 2, yy, 5, 2, '#3A2A10'); px(c, x - 2, yy - 1, 1, 1, g); px(c, x + 1, yy - 1, 1, 1, g);
  } else {
    px(c, x - 2, yy - 1, 4, 2, '#57402A');
  }
  if (a.satchel) px(c, x + (a.dir < 0 ? -6 : 4), yy + 4, 3, 3, '#7C5A36');
  if (a.lantern) px(c, x + (a.dir < 0 ? -6 : 5), yy + 5, 2, 3, P.winHi);
  if (a.scroll) px(c, x - 1, yy + 4, 4, 2, '#FFFBEB');
}
