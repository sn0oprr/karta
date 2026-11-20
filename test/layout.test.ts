import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W } from '../src/client/game3d/cardMesh';
import {
  TABLE_CARD_SCALE,
  TABLE_SLOTS,
  deckPosition,
  deckYaw,
  drinkPosition,
  heldCardTransform,
  myHandRect,
  myHandTransform,
  pilePosition,
  trickSlot,
  viewYaw,
} from '../src/client/game3d/layout';
import { FELT_HALF } from '../src/client/game3d/table';

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

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Axis-aligned box around a card lying flat at `pos`, turned by `yaw`, drawn `scale` times its size. */
function cardBox(pos: { x: number; z: number }, yaw: number, scale: number): Box {
  const c = Math.abs(Math.cos(yaw));
  const n = Math.abs(Math.sin(yaw));
  const hx = ((CARD_W / 2) * c + (CARD_H / 2) * n) * scale;
  const hz = ((CARD_W / 2) * n + (CARD_H / 2) * c) * scale;
  return { x0: pos.x - hx, x1: pos.x + hx, z0: pos.z - hz, z1: pos.z + hz };
}

function overlaps(a: Box, b: Box): boolean {
  return Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.z1, b.z1) > Math.max(a.z0, b.z0);
}

/** Every player's pile and stock around a table of `n` (any of them may deal). */
function stacks(n: number): Box[] {
  return Array.from({ length: n }, (_, v) => [
    cardBox(pilePosition(v, n), viewYaw(v, n) + 0.12, 1),
    cardBox(deckPosition(v, n), deckYaw(v, n), 1),
  ]).flat();
}

describe('the Chkobba table', () => {
  const cards = TABLE_SLOTS.map((s) => ({ box: cardBox(s.pos, s.yaw, TABLE_CARD_SCALE), layer: s.pos.y }));

  it('draws table cards bigger than the cards in hands and piles', () => {
    expect(TABLE_CARD_SCALE).toBeGreaterThanOrEqual(1.4);
  });

  it('keeps every table card on the felt', () => {
    for (const { box } of cards) expect(Math.max(-box.x0, box.x1, -box.z0, box.z1)).toBeLessThan(FELT_HALF);
  });

  it('lays the first eight cards side by side', () => {
    const first = cards.slice(0, 8);
    expect(first.every((c) => c.layer === 0)).toBe(true);
    for (let i = 0; i < first.length; i++) {
      for (let j = i + 1; j < first.length; j++) expect(overlaps(first[i]!.box, first[j]!.box), `slots ${i} and ${j}`).toBe(false);
    }
  });

  it('keeps clear of every pile and stock, with two or four players', () => {
    for (const n of [2, 4]) {
      for (const [i, { box }] of cards.entries()) {
        for (const s of stacks(n)) expect(overlaps(box, s), `slot ${i} with ${n} players`).toBe(false);
      }
    }
  });

  it('keeps piles and stocks off the drinks', () => {
    for (const n of [2, 4]) {
      for (let v = 0; v < n; v++) {
        // The widest table drink is the express on its saucer.
        const d = drinkPosition(v, n);
        const saucer: Box = { x0: d.x - 0.6, x1: d.x + 0.6, z0: d.z - 0.6, z1: d.z + 0.6 };
        for (const s of stacks(n)) expect(overlaps(saucer, s), `drink ${v} with ${n} players`).toBe(false);
      }
    }
  });

  it('leaves every card an index in sight on a full table', () => {
    // The indices sit in the top-left and bottom-right corners, as the local player reads the card.
    const iw = CARD_W * TABLE_CARD_SCALE * 0.22;
    const ih = CARD_H * TABLE_CARD_SCALE * 0.18;
    for (const [i, { box, layer }] of cards.entries()) {
      const corners: Box[] = [
        { x0: box.x0, x1: box.x0 + iw, z0: box.z0, z1: box.z0 + ih },
        { x0: box.x1 - iw, x1: box.x1, z0: box.z1 - ih, z1: box.z1 },
      ];
      const above = cards.filter((c) => c.layer > layer).map((c) => c.box);
      const seen = corners.some((corner) => above.every((b) => !overlaps(corner, b)));
      expect(seen, `slot ${i}`).toBe(true);
    }
  });
});

describe('the Belote trick', () => {
  const boxes = [0, 1, 2, 3].map((v) => {
    const s = trickSlot(v, 4);
    return cardBox(s.pos, s.yaw, TABLE_CARD_SCALE);
  });

  it('lays the four cards in a cross without overlaps', () => {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) expect(overlaps(boxes[i]!, boxes[j]!), `cards ${i} and ${j}`).toBe(false);
    }
  });

  it('keeps clear of the piles and the stock', () => {
    for (const [i, b] of boxes.entries()) for (const s of stacks(4)) expect(overlaps(b, s), `card ${i}`).toBe(false);
  });
});
