/**
 * Screen-space helpers and the seat-camera search: find the view that shows the table cards as
 * large as possible while every opponent's face stays on screen and nothing hides under the HUD.
 * Pure math (no three.js objects) so it is cheap to run on every resize and easy to test.
 */

/** Axis-aligned box in CSS pixels (viewport coordinates, y down). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Pt2 {
  x: number;
  y: number;
}

export interface Pt3 {
  x: number;
  y: number;
  z: number;
}

export function inflate(r: Rect, m: number): Rect {
  return { left: r.left - m, top: r.top - m, right: r.right + m, bottom: r.bottom + m };
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function polygonArea(poly: Pt2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Area of a convex polygon inside a box (the polygon clipped against each side of the box). */
export function polygonRectOverlap(poly: Pt2[], r: Rect): number {
  let pts = poly;
  const clip = (inside: (p: Pt2) => number) => {
    const out: Pt2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) out.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    pts = out;
  };
  clip((p) => p.x - r.left);
  if (pts.length) clip((p) => r.right - p.x);
  if (pts.length) clip((p) => p.y - r.top);
  if (pts.length) clip((p) => r.bottom - p.y);
  return pts.length >= 3 ? polygonArea(pts) : 0;
}

// ───────────────────────────── seat camera ─────────────────────────────

export interface SeatFitInput {
  /** Viewport size in CSS px. */
  width: number;
  height: number;
  /** Corners of the area table cards can occupy (a convex outline on the felt). */
  cards: Pt3[];
  /** Each opponent's head, as a ball around it (hair and hats included). */
  heads: Ball[];
  /** Part of the table outline that must stay on screen (its far side). */
  edge: Pt3[];
  /** Screen boxes covered by the HUD. */
  hud: Rect[];
  /** Screen box of the local hand (null for spectators). */
  hand: Rect | null;
  /** Camera pitch range and sweet spot, in degrees above the horizon. */
  pitch: [min: number, max: number, preferred: number];
  /** Vertical field of view range and sweet spot, in degrees. */
  fov: [min: number, max: number, preferred: number];
  /**
   * Range for the point the camera looks at (on the table's centre line, toward the near seat);
   * the preferred value only breaks ties, e.g. when the screen's width alone sets the size.
   */
  targetZ: [min: number, max: number, preferred: number];
  /**
   * Part of a head's ball, on the side nearer a screen edge, that may go off screen: the back of
   * the hair of the players sitting left and right, who face the table. Narrow screens use it to
   * come closer. Defaults to 0.
   */
  sideTrim?: number;
}

export interface Ball {
  center: Pt3;
  radius: number;
}

export interface SeatView {
  /** Radians above the horizon. */
  pitch: number;
  /** Degrees. */
  fov: number;
  targetZ: number;
  distance: number;
  /** On-screen area of the card area (px²). */
  area: number;
  /** How many constraints had to be dropped to find a view (0 = none). */
  relaxed: number;
}

/** Projects world points for a camera at yaw 0 looking down at (0, 0, targetZ). */
class Probe {
  private cy = 0;
  private cz = 0;
  private sp = 0;
  private cp = 0;
  private kx = 0;
  private ky = 0;

  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {}

  set(pitch: number, fovDeg: number, targetZ: number, dist: number) {
    this.sp = Math.sin(pitch);
    this.cp = Math.cos(pitch);
    this.cy = this.sp * dist;
    this.cz = targetZ + this.cp * dist;
    this.ky = 1 / Math.tan((fovDeg * Math.PI) / 360);
    this.kx = this.ky / (this.w / this.h);
  }

  /** CSS px into `out`; false when the point is behind (or too close to) the camera. */
  project(p: Pt3, out: Pt2): boolean {
    const dy = p.y - this.cy;
    const dz = p.z - this.cz;
    const depth = -dy * this.sp - dz * this.cp;
    if (depth < 0.5) return false;
    const yc = dy * this.cp - dz * this.sp;
    out.x = ((p.x * this.kx) / depth) * 0.5 * this.w + 0.5 * this.w;
    out.y = 0.5 * this.h - ((yc * this.ky) / depth) * 0.5 * this.h;
    return true;
  }

  /** Screen box around a ball, or null when it is behind the camera. */
  ballRect(b: Ball, tmp: Pt2): Rect | null {
    if (!this.project(b.center, tmp)) return null;
    const depth = -(b.center.y - this.cy) * this.sp - (b.center.z - this.cz) * this.cp;
    // A ball off the view axis projects a little wider than its radius: allow a bit for that.
    const r = ((b.radius * 1.06 * this.ky) / depth) * 0.5 * this.h;
    return { left: tmp.x - r, top: tmp.y - r, right: tmp.x + r, bottom: tmp.y + r };
  }
}

/** Gaps (px) kept between the screen's edges, the HUD or the hand and what the camera frames. */
const EDGE_MARGIN = 4;
const CARD_MARGIN = 5;
/** Part of a head's ball (from the top) that may go off screen or under the HUD. */
const HAIR_TRIM = 0.14;
/**
 * Showing every head whole is worth this much of the cards' on-screen area (about 8% of their
 * size): it wins on desktops and most phones, not on the shortest landscape screens.
 */
const WHOLE_HEAD_PRICE = 0.85;

/**
 * Searches pitch, field of view, target and distance for the view where the card area is largest
 * on screen, subject to: the card area clear of the HUD and the hand; every head on screen and
 * clear of the HUD (whole, unless trimming the top of the hair buys clearly bigger cards); the far
 * side of the table on screen. Constraints are dropped one by one if no view satisfies them all,
 * so there is always an answer.
 */
export function fitSeatView(input: SeatFitInput): SeatView {
  const { width: W, height: H } = input;
  const probe = new Probe(W, H);
  const blockers = [...input.hud, ...(input.hand ? [input.hand] : [])];
  const cardBlockers = blockers.map((r) => inflate(r, CARD_MARGIN));
  const headBlockers = blockers.map((r) => inflate(r, 2));
  const poly: Pt2[] = input.cards.map(() => ({ x: 0, y: 0 }));
  const tmp: Pt2 = { x: 0, y: 0 };
  const sideTrim = input.sideTrim ?? 0;

  /**
   * relax: 0 = all constraints, 1 = heads may touch the HUD, 2 = heads may be cut, 3 = cards only.
   * trim: part of each head's ball (from the top: hair and hats) that may go off screen or under the HUD.
   */
  const fits = (relax: number, trim: number): boolean => {
    for (let i = 0; i < input.cards.length; i++) {
      const p = poly[i]!;
      if (!probe.project(input.cards[i]!, p)) return false;
      if (p.x < EDGE_MARGIN || p.x > W - EDGE_MARGIN || p.y < EDGE_MARGIN || p.y > H - EDGE_MARGIN) return false;
    }
    for (const r of relax >= 3 ? cardBlockers.slice(input.hud.length) : cardBlockers) {
      if (polygonRectOverlap(poly, r) > 0) return false;
    }
    if (relax >= 3) return true;
    for (const head of input.heads) {
      const box = probe.ballRect(head, tmp);
      if (!box) return false;
      if (relax >= 2) {
        // At least the middle of the face on screen.
        if (tmp.x < 0 || tmp.x > W || tmp.y < 0 || tmp.y > H) return false;
        continue;
      }
      box.top += (box.bottom - box.top) * trim;
      const cut = (box.right - box.left) * sideTrim;
      if (tmp.x < W / 2) box.left += cut;
      else box.right -= cut;
      if (box.left < EDGE_MARGIN || box.right > W - EDGE_MARGIN || box.top < EDGE_MARGIN || box.bottom > H - EDGE_MARGIN) return false;
      if (relax < 1) for (const k of headBlockers) if (overlapArea(box, k) > 0) return false;
    }
    for (const e of input.edge) {
      if (!probe.project(e, tmp)) return false;
      if (tmp.x < 0 || tmp.x > W || tmp.y < 0 || tmp.y > H) return false;
    }
    return true;
  };

  const [pMin, pMax, pPref] = input.pitch;
  const [fMin, fMax, fPref] = input.fov;
  const [zMin, zMax, zPref] = input.targetZ;
  const rad = Math.PI / 180;
  const FAR = 160;

  /** Closest feasible distance for one pitch/fov/target, and the card area's size there. */
  const evaluate = (pitchDeg: number, fov: number, tz: number, relax: number, trim: number) => {
    const pitch = pitchDeg * rad;
    probe.set(pitch, fov, tz, FAR);
    if (!fits(relax, trim)) return null;
    let lo = 2;
    let hi = FAR;
    for (let i = 0; i < 20 && hi - lo > 0.02; i++) {
      const mid = (lo + hi) / 2;
      probe.set(pitch, fov, tz, mid);
      if (fits(relax, trim)) hi = mid;
      else lo = mid;
    }
    probe.set(pitch, fov, tz, hi);
    fits(relax, trim);
    // Prefer the sweet spots a little: a near top-down view or a fisheye look would win on area alone.
    const dp = (pitchDeg - pPref) / 25;
    const df = (fov - fPref) / 25;
    const dz = (tz - zPref) / (zMax - zMin || 1);
    const area = polygonArea(poly);
    const score = area * (1 - 0.5 * dp * dp) * (1 - 0.35 * df * df) * (1 - 0.03 * dz * dz);
    return { pitch, fov, targetZ: tz, distance: hi, score, area };
  };

  const steps = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));

  type Found = NonNullable<ReturnType<typeof evaluate>>;
  /** The best view under one set of constraints, or null if none satisfies them. */
  const search = (relax: number, trim: number): Found | null => {
    let best: Found | null = null;
    const consider = (p: number, f: number, z: number) => {
      if (p < pMin || p > pMax || f < fMin || f > fMax || z < zMin || z > zMax) return;
      const r = evaluate(p, f, z, relax, trim);
      if (r && (!best || r.score > best.score)) best = r;
    };
    // Coarse grid, then a finer one around the best.
    const ps = steps(pMin, pMax, 6);
    const fs = steps(fMin, fMax, 4);
    const zs = steps(zMin, zMax, 7);
    for (const p of ps) for (const f of fs) for (const z of zs) consider(p, f, z);
    if (!best) return null;
    const dP = (pMax - pMin) / 10;
    const dF = (fMax - fMin) / 6;
    const dZ = (zMax - zMin) / 12;
    for (let pass = 0; pass < 2; pass++) {
      const b: Found = best;
      const k = pass === 0 ? 1 : 0.5;
      const bp = b.pitch / rad;
      for (const p of [bp - dP * k, bp, bp + dP * k])
        for (const f of [b.fov - dF * k, b.fov, b.fov + dF * k])
          for (const z of [b.targetZ - dZ * k, b.targetZ, b.targetZ + dZ * k]) consider(p, f, z);
    }
    return best;
  };
  const result = (r: Found, relaxed: number): SeatView => ({
    pitch: r.pitch,
    fov: r.fov,
    targetZ: r.targetZ,
    distance: r.distance,
    area: r.area,
    relaxed,
  });

  // Whole heads, unless trimming the top of the hair (or a hat) buys clearly bigger cards.
  const trimmed = search(0, HAIR_TRIM);
  if (trimmed) {
    const whole = search(0, 0);
    return result(whole && whole.area >= trimmed.area * WHOLE_HEAD_PRICE ? whole : trimmed, 0);
  }
  for (let relax = 1; relax <= 3; relax++) {
    const r = search(relax, HAIR_TRIM);
    if (r) return result(r, relax);
  }
  // Nothing fits at all (a tiny window): a plain overview.
  return { pitch: pPref * rad, fov: fPref, targetZ: zPref, distance: 30, area: 0, relaxed: 4 };
}
