import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Ball, type Pt3, type Rect, type SeatFitInput, fitSeatView, overlapArea, polygonRectOverlap } from '../src/client/game3d/viewFit';
import { TABLE_EXTENT, tableEdgePoints } from '../src/client/game3d/table';

// A 2v2 table as the board describes it: card area, opponents' heads, the far part of the square table.
const CARDS: Pt3[] = [
  { x: -4.85, y: 0, z: -3.92 },
  { x: 4.85, y: 0, z: -3.92 },
  { x: 4.85, y: 0, z: 3.92 },
  { x: -4.85, y: 0, z: 3.92 },
];
const head = (x: number, z: number): Ball => ({ center: { x, y: 2.46, z }, radius: 1.21 });
const HEADS = [head(7.09, 0), head(0, -7.09), head(-7.09, 0)];
const EDGE: Pt3[] = tableEdgePoints(24).filter((p) => p.z < 0.25 * TABLE_EXTENT);

function input(width: number, height: number, hud: Rect[], hand: Rect | null): SeatFitInput {
  const portrait = width / height < 0.8;
  return {
    width,
    height,
    cards: CARDS,
    heads: HEADS,
    edge: EDGE,
    hud,
    hand,
    pitch: portrait ? [28, 48, 40] : [20, 40, 30],
    fov: portrait ? [38, 62, 50] : [28, 50, 40],
    targetZ: [-0.4 * TABLE_EXTENT, 0.7 * TABLE_EXTENT, 0],
  };
}

/** Projects with a real three.js camera placed as the board would place it. */
function camera(inp: SeatFitInput) {
  const v = fitSeatView(inp);
  const cam = new THREE.PerspectiveCamera(v.fov, inp.width / inp.height, 0.1, 400);
  cam.position.set(0, Math.sin(v.pitch) * v.distance, v.targetZ + Math.cos(v.pitch) * v.distance);
  cam.lookAt(0, 0, v.targetZ);
  cam.updateMatrixWorld(true);
  const px = (p: Pt3) => {
    const q = new THREE.Vector3(p.x, p.y, p.z).project(cam);
    return { x: (q.x * 0.5 + 0.5) * inp.width, y: (0.5 - q.y * 0.5) * inp.height };
  };
  const headRect = (b: Ball): Rect => {
    const c = px(b.center);
    const depth = -new THREE.Vector3(b.center.x, b.center.y, b.center.z).applyMatrix4(cam.matrixWorldInverse).z;
    const r = (b.radius / (depth * Math.tan(THREE.MathUtils.degToRad(v.fov / 2)))) * 0.5 * inp.height;
    return { left: c.x - r, top: c.y - r, right: c.x + r, bottom: c.y + r };
  };
  return { view: v, px, headRect };
}

function expectFramed(inp: SeatFitInput) {
  const { view, px, headRect } = camera(inp);
  expect(view.relaxed).toBe(0);
  const poly = inp.cards.map(px);
  for (const p of poly) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(inp.width);
  }
  // The far side of the table, corners included, on screen.
  for (const e of inp.edge) {
    const p = px(e);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(inp.width);
    expect(p.y).toBeGreaterThanOrEqual(0);
  }
  // Table cards clear of the HUD and the hand.
  for (const r of [...inp.hud, ...(inp.hand ? [inp.hand] : [])]) expect(polygonRectOverlap(poly, r)).toBe(0);
  // Every face on screen and clear of the HUD (hair may be trimmed at the top).
  for (const b of inp.heads) {
    const r = headRect(b);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(inp.width);
    expect(r.bottom).toBeLessThanOrEqual(inp.height);
    expect((r.top + r.bottom) / 2).toBeGreaterThan(0);
    for (const k of inp.hud) expect(overlapArea({ ...r, top: r.top + (r.bottom - r.top) * 0.2 }, k)).toBe(0);
  }
  return view;
}

describe('seat camera fit', () => {
  it('shows both side opponents on a portrait phone', () => {
    const W = 390;
    const H = 844;
    const hud = [
      { left: 10, top: 10, right: 215, bottom: 68 },
      { left: W - 95, top: 10, right: W - 10, bottom: 50 },
      { left: 12, top: H * 0.8 - 42, right: 154, bottom: H * 0.8 },
      { left: W - 54, top: H * 0.8 - 42, right: W - 12, bottom: H * 0.8 },
      { left: 162, top: H * 0.8 - 42, right: W - 62, bottom: H * 0.8 },
    ];
    const view = expectFramed(input(W, H, hud, { left: 25, top: 702, right: 365, bottom: H }));
    expect(view.area).toBeGreaterThan(20000);
  });

  it('keeps the cards above the hand on a short landscape phone', () => {
    const W = 740;
    const H = 260;
    const hud = [
      { left: 8, top: 6, right: 190, bottom: 40 },
      { left: W - 80, top: 6, right: W - 8, bottom: 38 },
      { left: 8, top: H - 48, right: 140, bottom: H - 8 },
      { left: W - 48, top: H - 48, right: W - 8, bottom: H - 8 },
      { left: 460, top: H - 48, right: W - 56, bottom: H - 8 },
    ];
    const view = expectFramed(input(W, H, hud, { left: 293, top: 223, right: 447, bottom: H }));
    expect(view.area).toBeGreaterThan(15000);
  });

  it('shows the far head whole on a desktop, where that costs the cards little', () => {
    const W = 1440;
    const H = 860;
    const hud = [
      { left: 10, top: 10, right: 420, bottom: 68 },
      { left: W - 190, top: 10, right: W - 10, bottom: 50 },
      { left: 12, top: H - 60, right: 172, bottom: H - 12 },
      { left: W - 60, top: H - 60, right: W - 12, bottom: H - 12 },
      { left: 485, top: H * 0.71 - 44, right: 955, bottom: H * 0.71 },
    ];
    const inp = input(W, H, hud, { left: 490, top: 670, right: 950, bottom: H });
    expectFramed(inp);
    const { headRect } = camera(inp);
    for (const b of inp.heads) expect(headRect(b).top).toBeGreaterThanOrEqual(0);
  });

  it('still answers when nothing can fit', () => {
    const view = fitSeatView(input(120, 90, [{ left: 0, top: 0, right: 120, bottom: 80 }], { left: 0, top: 40, right: 120, bottom: 90 }));
    expect(view.relaxed).toBeGreaterThan(0);
    expect(Number.isFinite(view.distance)).toBe(true);
    expect(Number.isFinite(view.pitch)).toBe(true);
  });
});
