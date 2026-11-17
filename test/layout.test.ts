import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W } from '../src/client/game3d/cardMesh';
import { heldCardTransform, myHandRect, myHandTransform, trickSlot } from '../src/client/game3d/layout';

const VIEWS = [
  { name: 'desktop', width: 1440, height: 900, fov: 40 },
  { name: 'phone', width: 390, height: 844, fov: 50 },
  { name: 'phone on its side', width: 844, height: 390, fov: 40 },
  { name: 'tablet', width: 1024, height: 1366, fov: 50 },
];

function hand(count: number, view: { width: number; height: number; fov: number }) {
  return Array.from({ length: count }, (_, i) => myHandTransform(i, count, view, { pos: new THREE.Vector3(), rot: new THREE.Euler(), scale: 1 }));
}

describe('the local hand', () => {
  for (const view of VIEWS) {
    it(`fans Belote's eight cards inside the screen, every corner index showing (${view.name})`, () => {
      const t = hand(8, view);
      const width = CARD_W * t[0]!.scale;
      for (let i = 1; i < 8; i++) {
        const step = t[i]!.pos.x - t[i - 1]!.pos.x;
        // They overlap, yet at least a third of each card (its corner index) shows…
        expect(step).toBeLessThan(width);
        expect(step / width).toBeGreaterThanOrEqual(0.33 - 1e-9);
        // …each card lying on the one to its left.
        expect(t[i]!.pos.z).toBeGreaterThan(t[i - 1]!.pos.z);
      }
      const r = myHandRect(8, view);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(view.width);
    });
  }

  it('keeps a phone on its side as wide as a hand of three, so the turn banner still fits right of it', () => {
    const view = VIEWS[2]!;
    const r8 = myHandRect(8, view);
    const r3 = myHandRect(3, view);
    expect(r8.right - r8.left).toBeLessThanOrEqual((r3.right - r3.left) * 1.08);
  });

  it('leaves the three-card hand as it was (cards side by side)', () => {
    for (const view of VIEWS) {
      const t = hand(3, view);
      expect((t[1]!.pos.x - t[0]!.pos.x) / (CARD_W * t[0]!.scale)).toBeCloseTo(1.04, 6);
    }
  });

  it('holds an opponent’s eight cards in a tighter fan than three', () => {
    const out = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
    const span = (n: number) => {
      const a = heldCardTransform(0, n, out).pos.x;
      return Math.abs(heldCardTransform(n - 1, n, out).pos.x - a);
    };
    expect(span(8)).toBeLessThan(span(3) * 1.6);
  });
});

describe('the Belote trick', () => {
  it('lays the four cards in a cross without overlaps', () => {
    // Axis-aligned boxes around each (slightly turned) card.
    const boxes = [0, 1, 2, 3].map((v) => {
      const s = trickSlot(v, 4);
      const c = Math.abs(Math.cos(s.yaw));
      const n = Math.abs(Math.sin(s.yaw));
      const hx = (CARD_W / 2) * c + (CARD_H / 2) * n;
      const hz = (CARD_W / 2) * n + (CARD_H / 2) * c;
      return { x0: s.pos.x - hx, x1: s.pos.x + hx, z0: s.pos.z - hz, z1: s.pos.z + hz };
    });
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.z1, b.z1) > Math.max(a.z0, b.z0);
        expect(overlap, `cards ${i} and ${j}`).toBe(false);
      }
    }
  });
});
