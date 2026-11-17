import * as THREE from 'three';
import { CARD_H, CARD_W } from './cardMesh';
import { FLOOR_Y } from './environment';

export const SEAT_RADIUS = 7.0;
export const AVATAR_Y = 0.35;

/** Direction from the table centre towards a view position (0 = south/near, then anticlockwise). */
export function viewDir(view: number, n: number): THREE.Vector3 {
  const a = (view * 2 * Math.PI) / n;
  return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
}

/** Yaw that makes an object's −Z axis face the table centre from `view`. */
export function viewYaw(view: number, n: number): number {
  return (view * 2 * Math.PI) / n;
}

/** The right-hand direction of a player sitting at `view` and facing the centre. */
export function viewRight(view: number, n: number): THREE.Vector3 {
  const d = viewDir(view, n);
  return new THREE.Vector3(d.z, 0, -d.x);
}

export function avatarPosition(view: number, n: number): THREE.Vector3 {
  return viewDir(view, n).multiplyScalar(SEAT_RADIUS).setY(AVATAR_Y);
}

/** Captured pile: on the table in front of the player, to their right. */
export function pilePosition(view: number, n: number): THREE.Vector3 {
  return viewDir(view, n)
    .multiplyScalar(n === 2 ? 3.45 : 3.75)
    .add(viewRight(view, n).multiplyScalar(n === 2 ? 2.9 : 2.05));
}

/** Stock: on the dealer's left. */
export function deckPosition(view: number, n: number): THREE.Vector3 {
  return viewDir(view, n)
    .multiplyScalar(n === 2 ? 3.45 : 3.75)
    .add(viewRight(view, n).multiplyScalar(n === 2 ? -2.9 : -2.05));
}

/** A point `r` from the centre, `angle` radians from the player's direction toward their left. */
function frontLeft(view: number, n: number, r: number, angle: number): THREE.Vector3 {
  return viewDir(view, n)
    .multiplyScalar(r * Math.cos(angle))
    .add(viewRight(view, n).multiplyScalar(-r * Math.sin(angle)));
}

/**
 * A player's cup or glass: on the table, front-left of their seat, between their stock spot and
 * the next player's pile (with 4 players, each corner of the table belongs to one player).
 */
export function drinkPosition(view: number, n: number): THREE.Vector3 {
  return n === 2 ? frontLeft(view, n, 4.3, 1.12) : frontLeft(view, n, 5.2, Math.PI / 4);
}

/** A chicha stands on the floor just outside the table's corner, front-left of its smoker. */
export function chichaPosition(view: number, n: number): THREE.Vector3 {
  return frontLeft(view, n, 6.2 * Math.SQRT2, Math.PI / 4).setY(FLOOR_Y);
}

// ───────────────────────────── table slots ─────────────────────────────

export interface Slot {
  pos: THREE.Vector3;
  yaw: number;
}

const COL = CARD_W * 1.18;
const ROW = CARD_H * 1.12;

/** Fixed slots for table cards, ordered from the centre outwards. */
export const TABLE_SLOTS: Slot[] = (() => {
  const raw: { x: number; z: number }[] = [];
  // Two main rows of five, offset by half a card, then overflow positions.
  for (const z of [-0.5 * ROW, 0.5 * ROW]) for (let c = -2; c <= 2; c++) raw.push({ x: c * COL + (z < 0 ? -0.25 : 0.25), z });
  for (const z of [-1.5 * ROW, 1.5 * ROW]) for (const c of [-1, 0, 1]) raw.push({ x: c * COL, z: z * 0.97 });
  for (const x of [-3 * COL, 3 * COL]) raw.push({ x: x * 0.98, z: 0 });
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  return raw
    .map((p) => ({ p, d: Math.hypot(p.x * 0.8, p.z) + p.x * 0.001 }))
    .sort((a, b) => a.d - b.d)
    .map(({ p }) => ({ pos: new THREE.Vector3(p.x + rnd() * 0.08, 0, p.z + rnd() * 0.08), yaw: rnd() * 0.12 }));
})();

// ───────────────────────────── hands ─────────────────────────────

// ───────────────────────────── Belote tricks ─────────────────────────────

/**
 * Where a seat's card lies in the trick: a cross in the middle of the table, each card in front of its
 * player and upright for the camera (near and far cards closer to the centre than the side ones).
 */
export function trickSlot(view: number, n: number): Slot {
  const d = viewDir(view, n);
  const r = Math.abs(d.z) > 0.5 ? 1.05 : 1.42;
  return { pos: d.multiplyScalar(r), yaw: [-0.07, 0.1, 0.05, -0.11][view % 4]! };
}

/** The trump token, on the table at the taker's front left, between the trick and their stock spot. */
export function trumpTokenPosition(view: number, n: number): THREE.Vector3 {
  return viewDir(view, n).multiplyScalar(2.25).add(viewRight(view, n).multiplyScalar(-2.0));
}

/** Everywhere a Belote card lies in the middle of the table (the trick and the turned card), with a margin. */
export const BELOTE_CARD_EXTENT = { x: 1.42 + CARD_W / 2 + 0.15, z: 1.05 + CARD_H / 2 + 0.15 };

/** Fanned layout for N cards held by an opponent (in the avatar's hand-anchor space). */
export function heldCardTransform(i: number, count: number, out: { pos: THREE.Vector3; rot: THREE.Euler }) {
  // Three cards fan wide; a bigger hand (Belote's eight) is held tighter.
  const many = count > 3;
  const spread = many ? Math.max(0.2, 1.45 / (count - 1)) : 0.5;
  const turn = many ? 0.62 / (count - 1) : 0.16;
  const mid = (count - 1) / 2;
  const k = i - mid;
  out.pos.set(k * spread * 0.95, -Math.abs(k) * (many ? 0.035 : 0.06), -i * 0.012);
  out.rot.set(-0.25, 0, -k * turn, 'YXZ');
  return out;
}

/** Layout of the local player's hand in camera space. */
export function myHandTransform(
  i: number,
  count: number,
  view: { width: number; height: number; fov: number },
  out: { pos: THREE.Vector3; rot: THREE.Euler; scale: number },
) {
  const aspect = view.width / view.height;
  const dist = 9;
  const halfH = Math.tan(THREE.MathUtils.degToRad(view.fov / 2)) * dist;
  const halfW = halfH * aspect;
  // Card size relative to the screen: fill a comfortable part of the bottom area.
  const portrait = aspect < 1;
  // Short landscape (a phone on its side): taller cards sunk lower, so their corners (rank and
  // suit) read clearly while the table keeps most of the little height there is.
  // (Same test as the stylesheet's `(max-height: 500px) and (orientation: landscape)`.)
  const short = view.width > view.height && view.height <= 500;
  const cardScreenH = portrait ? 0.19 : short ? 0.28 : 0.25;
  /** Part of each card above the screen's bottom edge. */
  const shown = short ? 0.52 : 0.9;
  let scale = (cardScreenH * halfH * 2) / CARD_H;
  const maxW = halfW * 2 * (portrait ? 0.86 : 0.42);
  let sp: number;
  if (count <= 3) {
    const spacing = CARD_W * scale * 1.04;
    if (spacing * Math.max(count, 3) > maxW) scale *= maxW / (spacing * Math.max(count, 3));
    sp = CARD_W * scale * 1.04;
  } else {
    // A bigger hand (Belote's eight) overlaps like a hand of real cards, every card showing at least its
    // corner index; only if even that is too wide do the cards shrink. On a phone held sideways the hand
    // keeps to the width of three cards (the turn banner sits right of it).
    const room = short ? Math.min(maxW, halfH * 2 * 0.6) : maxW;
    const w = CARD_W * scale;
    let step = (room / w - 1) / (count - 1);
    if (step < HAND_MIN_STEP) {
      scale *= room / (w * (1 + HAND_MIN_STEP * (count - 1)));
      step = HAND_MIN_STEP;
    }
    sp = CARD_W * scale * Math.min(1.04, step);
  }
  const many = count > 3;
  const mid = (count - 1) / 2;
  const k = i - mid;
  const y = -halfH + CARD_H * scale * (shown - 0.5) - Math.abs(k) * (many ? 0.025 : 0.06) * scale;
  out.pos.set(k * sp, y, -dist + i * 0.01);
  out.rot.set(0.08, 0, -k * (many ? 0.028 : 0.045), 'YXZ');
  out.scale = scale;
  return out;
}

/** Overlapping hand cards show at least this share of their width (the corner index fits in it). */
const HAND_MIN_STEP = 0.33;

/** Screen box (CSS px) covered by a hand of `count` cards laid out by `myHandTransform`. */
export function myHandRect(count: number, view: { width: number; height: number; fov: number }) {
  const t = { pos: new THREE.Vector3(), rot: new THREE.Euler(), scale: 1 };
  const v = new THREE.Vector3();
  const tanH = Math.tan(THREE.MathUtils.degToRad(view.fov / 2));
  const aspect = view.width / view.height;
  const r = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let i = 0; i < count; i++) {
    myHandTransform(i, count, view, t);
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      v.set((cx * CARD_W) / 2, (cy * CARD_H) / 2, 0).multiplyScalar(t.scale).applyEuler(t.rot).add(t.pos);
      const x = (v.x / (-v.z * tanH * aspect)) * 0.5 * view.width + view.width / 2;
      const y = view.height / 2 - (v.y / (-v.z * tanH)) * 0.5 * view.height;
      r.left = Math.min(r.left, x);
      r.right = Math.max(r.right, x);
      r.top = Math.min(r.top, y);
      r.bottom = Math.min(Math.max(r.bottom, y), view.height);
    }
  }
  return r;
}
