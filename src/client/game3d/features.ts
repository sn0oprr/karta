/**
 * Face and hair pieces for the crew (real friends, drawn after their portraits): beards that
 * wrap the jaw, curly or cropped hair, rectangular glasses and shades, a toothy grin and sleepy
 * eyelids.
 *
 * Head space: the skull is a sphere of radius SKULL, squashed to SQUASH in y and z, facing −Z.
 * The face group sits at z = FACE_Z inside the head.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutline, toon } from './materials';

const SKULL = 1.18;
const SQUASH = 0.96;
const FACE_Z = -1;
/** Sphere-coordinate angle (around Y) of the middle of the face. */
const FRONT = Math.PI * 1.5;
const INK = '#1d1b2e';

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Small seeded random generator, so every copy of a character gets the same curls. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function basic(color: THREE.ColorRepresentation, opts: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

/** Merges geometries (all indexed, with position, normal and uv) and frees the parts. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

// ─────────────────────────────── beards ───────────────────────────────

export interface Beard {
  color: string;
  /** full: cheeks, jaw and chin; short: the same, trimmed close; goatee: the chin only. */
  style: 'full' | 'short' | 'goatee';
  /** Thickness (1 = normal). */
  size?: number;
}

/** A beard shell around the jaw, open around the mouth: up to the sideburns, under the lower lip. */
export function beard(b: Beard): THREE.Mesh {
  const k = b.size ?? 1;
  const goatee = b.style === 'goatee';
  const short = b.style === 'short';
  const P = Math.PI;
  const reach = goatee ? 0.34 : 1.32; // half-width around the head (radians)
  const gap = goatee ? 0 : 0.3; // half-width of the opening around the mouth
  const chinTop = P * 0.695; // just under the lower lip
  const cheekTop = goatee ? chinTop : P * (0.57 - 0.025 * (k - 1));
  const burnTop = goatee ? chinTop : P * 0.41; // sideburns, up to the hair
  const chinBottom = P * (goatee ? 0.83 : 0.9);
  const sideBottom = P * (goatee ? 0.8 : 0.68);
  const thick = (short ? 0.045 : goatee ? 0.05 : 0.11) * k;
  const chin = (short ? 0.03 : goatee ? 0.07 : 0.13) * k;
  const W = 32;
  const H = 12;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= W; i++) {
    const phi = FRONT - reach + (2 * reach * i) / W;
    const a = Math.abs(phi - FRONT);
    const top =
      chinTop + (cheekTop - chinTop) * smoothstep(gap, gap + 0.32, a) + (burnTop - cheekTop) * smoothstep(reach * 0.6, reach, a);
    const bottom = chinBottom + (sideBottom - chinBottom) * smoothstep(0, reach, a);
    for (let j = 0; j <= H; j++) {
      const t = j / H;
      const theta = top + (bottom - top) * t;
      // Thin at the top edge (it blends into the cheeks), fuller toward the chin.
      const r =
        SKULL + 0.014 + thick * (0.2 + 0.8 * smoothstep(0, 0.35, t)) + chin * (1 - a / reach) ** 2 * smoothstep(0.2, 0.85, t);
      const s = Math.sin(theta);
      pos.push(-r * Math.cos(phi) * s, r * Math.cos(theta) * SQUASH, r * Math.sin(phi) * s * SQUASH);
      uv.push(i / W, 1 - t);
    }
  }
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      const a = i * (H + 1) + j;
      const b2 = a + H + 1;
      index.push(a, a + 1, b2, b2, a + 1, b2 + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, toon(b.color, { side: THREE.DoubleSide }));
  mesh.castShadow = true;
  addOutline(mesh, 0.025);
  return mesh;
}

// ─────────────────────────────── hair ───────────────────────────────

export interface Curly {
  /** Curl radius. */
  size: number;
  /** Extra height on top of the head. */
  lift: number;
  /** Height of the hairline at the forehead, on the unit sphere (0.55 low … 0.75 receding). */
  front: number;
}

/** Curly hair: a dome (so no scalp shows) under a cloud of curls, taller on top with `lift`. */
export function curlyHair(color: string, c: Curly, seed: number): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color);
  // The dome tilts back: its rim follows the hairline at the front and the nape at the back.
  const tilt = 0.5;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKULL + 0.03, 28, 14, 0, Math.PI * 2, 0, Math.acos(c.front) + tilt), mat);
  dome.rotation.x = tilt;
  dome.scale.set(1.02, SQUASH + c.lift * 0.75, SQUASH * 1.02);
  dome.castShadow = true;
  g.add(dome);

  const rand = seeded(seed);
  const parts: THREE.BufferGeometry[] = [];
  const shell = SKULL + c.size * 0.4;
  const n = Math.round(((4 * shell * shell) / (c.size * c.size)) * 0.95);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const ring = Math.sqrt(1 - y * y);
    const x = Math.cos(i * golden) * ring;
    const z = Math.sin(i * golden) * ring;
    // Hairline: high at the forehead, above the ears at the sides, down to the nape at the back.
    const front = Math.max(0, -z);
    const back = Math.max(0, z);
    if (y < 0.26 + (c.front + c.size * 0.35 - 0.26) * front ** 1.5 - 0.5 * back) continue;
    const r = shell + c.lift * Math.max(0, y) ** 1.6;
    const curl = new THREE.SphereGeometry(c.size * (0.8 + rand() * 0.4), 7, 5);
    curl.translate(x * r, y * r * SQUASH, z * r * SQUASH);
    parts.push(curl);
  }
  const curls = new THREE.Mesh(merge(parts), mat);
  curls.castShadow = true;
  addOutline(curls, 0.018);
  g.add(curls);
  return g;
}

export interface Crop {
  /** Height of the hairline at the forehead, on the unit sphere. */
  front: number;
  /** Extra height on top. */
  volume: number;
  /** Size of a wave swept up over the forehead (0 = none). */
  wave?: number;
}

/** Short hair hugging the skull, with tousled strands along the hairline (and maybe a wave). */
export function cropHair(color: string, c: Crop, seed: number): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color, { side: THREE.DoubleSide });
  // Like the curly dome: tilted back, so the rim runs from the hairline down to the nape.
  const tilt = 0.45;
  const theta = Math.acos(c.front);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKULL + 0.07, 32, 16, 0, Math.PI * 2, 0, theta + tilt), mat);
  dome.rotation.x = tilt;
  dome.scale.set(1.02, SQUASH + c.volume, SQUASH * 1.02);
  dome.castShadow = true;
  addOutline(dome, 0.03);
  g.add(dome);
  const rand = seeded(seed);
  const parts: THREE.BufferGeometry[] = [];
  const r = SKULL + 0.07;
  for (let i = 0; i < 11; i++) {
    const a = -1.15 + (2.3 * i) / 10;
    const t = theta - 0.1 + Math.abs(a) * 0.1;
    const tuft = new THREE.SphereGeometry(0.15 + rand() * 0.05, 10, 8);
    tuft.scale(1.35, 0.7, 0.9);
    tuft.rotateZ((rand() - 0.5) * 0.9);
    tuft.translate(Math.sin(a) * Math.sin(t) * r, Math.cos(t) * r * (SQUASH + c.volume * 0.9), -Math.cos(a) * Math.sin(t) * r * SQUASH);
    parts.push(tuft);
  }
  if (c.wave) {
    const wave = new THREE.SphereGeometry(0.46 * c.wave, 18, 12);
    wave.scale(1.6, 0.72, 1.05);
    wave.rotateX(-0.45);
    wave.rotateZ(-0.12);
    wave.translate(0.08, Math.cos(theta - 0.35) * r * (SQUASH + c.volume) + 0.05, -Math.sin(theta - 0.35) * r * SQUASH + 0.1);
    parts.push(wave);
  }
  const tufts = new THREE.Mesh(merge(parts), toon(color));
  tufts.castShadow = true;
  addOutline(tufts, 0.022);
  g.add(tufts);
  return g;
}

// ─────────────────────────────── glasses ───────────────────────────────

/** Dark round sunglasses (the café boss wears them; a pair also hangs on a polo shirt). */
export function shades(): THREE.Group {
  const g = new THREE.Group();
  const lensMat = basic('#15151f');
  const shineMat = basic('#ffffff', { transparent: true, opacity: 0.7 });
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.06, 20), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.scale.set(1.18, 1, 0.82);
    lens.position.set(s * 0.41, 0, 0);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), shineMat);
    shine.scale.set(1.6, 0.8, 0.4);
    shine.position.set(s * 0.41 - 0.09, 0.07, -0.04);
    g.add(lens, shine);
  }
  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), lensMat);
  bridge.rotation.z = Math.PI / 2;
  bridge.position.set(0, 0.06, 0);
  g.add(bridge);
  return g;
}

export type GlassesKind = 'rect' | 'wayfarer' | 'wire';

/** Outline of one lens (the right one; mirrored for the left), centred on the eye. */
function lensOutline(kind: 'rect' | 'wayfarer'): THREE.Vector2[] {
  const s = new THREE.Shape();
  if (kind === 'rect') {
    const w = 0.27;
    const h = 0.19;
    const r = 0.1;
    s.moveTo(-w + r, -h);
    s.lineTo(w - r, -h);
    s.quadraticCurveTo(w, -h, w, -h + r);
    s.lineTo(w, h - r);
    s.quadraticCurveTo(w, h, w - r, h);
    s.lineTo(-w + r, h);
    s.quadraticCurveTo(-w, h, -w, h - r);
    s.lineTo(-w, -h + r);
    s.quadraticCurveTo(-w, -h, -w + r, -h);
  } else {
    // Flat top, wider than the rounded bottom; the outer corner (+x) sits highest.
    s.moveTo(-0.28, 0.19);
    s.lineTo(0.34, 0.22);
    s.lineTo(0.33, 0.0);
    s.quadraticCurveTo(0.31, -0.22, 0.09, -0.22);
    s.lineTo(-0.11, -0.21);
    s.quadraticCurveTo(-0.28, -0.19, -0.28, 0.0);
    s.lineTo(-0.28, 0.19);
  }
  return s.getPoints(6);
}

/** `pts` shrunk toward their centre, as the inside edge of a frame `inset` thick. */
function inset(pts: THREE.Vector2[], by: number): THREE.Vector2[] {
  const box = new THREE.Box2().setFromPoints(pts);
  const c = box.getCenter(new THREE.Vector2());
  const size = box.getSize(new THREE.Vector2());
  const kx = 1 - (2 * by) / size.x;
  const ky = 1 - (2 * by) / size.y;
  return pts.map((p) => new THREE.Vector2(c.x + (p.x - c.x) * kx, c.y + (p.y - c.y) * ky));
}

/**
 * Rectangular glasses, wayfarer shades, or thin round wire frames, with temples back to the ears.
 * Goes in the face group, centred between the eyes (at y 0.15, z −0.3: in front of the pupils).
 */
export function glasses(kind: GlassesKind, frame: string, tint?: string): THREE.Group {
  const g = new THREE.Group();
  const frameMat = basic(frame);
  const dark = kind === 'wayfarer';
  const lensMat = dark
    ? basic('#121218', { side: THREE.DoubleSide })
    : tint
      ? basic(tint, { transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
      : null;
  let outer = 0.66;
  for (const s of [-1, 1]) {
    const side = new THREE.Group();
    side.position.x = s * 0.41;
    // Each lens turns a little to follow the face.
    side.rotation.y = -s * 0.16;
    if (kind === 'wire') {
      side.add(new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.024, 6, 28), frameMat));
      if (lensMat) {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.235, 28), lensMat);
        lens.position.z = 0.01;
        side.add(lens);
      }
      outer = 0.64;
    } else {
      const edge = lensOutline(kind);
      const hole = inset(edge, dark ? 0.045 : 0.065);
      const shape = new THREE.Shape(edge);
      shape.holes.push(new THREE.Path(hole));
      const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }), frameMat);
      side.add(rim);
      if (lensMat) {
        const lens = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(hole)), lensMat);
        lens.position.z = 0.02;
        side.add(lens);
      }
      if (dark) {
        // A streak of light across the lens.
        const shine = new THREE.Mesh(
          new THREE.PlaneGeometry(0.07, 0.3),
          basic('#ffffff', { transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
        );
        shine.position.set(0.12, 0.02, 0.012);
        shine.rotation.z = -0.6;
        side.add(shine);
      }
      outer = kind === 'rect' ? 0.68 : 0.74;
      side.scale.x = s; // mirror the left lens
    }
    g.add(side);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.2, kind === 'wire' ? 0.03 : 0.05, 0.035), frameMat);
  bridge.position.set(0, kind === 'wayfarer' ? 0.11 : 0.05, 0.02);
  g.add(bridge);
  for (const s of [-1, 1]) {
    const from = new THREE.Vector3(s * outer, 0.08, 0.04);
    const to = new THREE.Vector3(s * 1.2, 0.03, 1.06);
    const temple = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, from.distanceTo(to)), frameMat);
    temple.position.copy(from).add(to).multiplyScalar(0.5);
    temple.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), to.clone().sub(from).normalize());
    g.add(temple);
  }
  return g;
}

// ─────────────────────────────── grin & eyelids ───────────────────────────────

/** Bends a flat face-space shape onto the skull, lifted a little off the skin. */
function hug(geo: THREE.BufferGeometry, lift: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const ry = SKULL * SQUASH;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const k = Math.max(0, 1 - (x / SKULL) ** 2 - (y / ry) ** 2);
    p.setZ(i, -ry * Math.sqrt(k) - lift - FACE_Z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}

/** A wide-open smile with teeth (shown instead of the closed smile while quiet). */
export function grin(): THREE.Group {
  const g = new THREE.Group();
  const top = -0.39;
  const w = 0.3;
  const depth = 0.25;
  const mouth = (grow: number) => {
    const s = new THREE.Shape();
    const t = top + grow * 0.6;
    s.moveTo(-(w + grow), t);
    s.lineTo(w + grow, t);
    s.absellipse(0, t, w + grow, depth + grow * 1.6, 0, Math.PI, true);
    return s;
  };
  const layer = (shape: THREE.Shape, color: string, lift: number) => {
    const geo = new THREE.ShapeGeometry(shape, 14);
    hug(geo, lift);
    g.add(new THREE.Mesh(geo, basic(color, { side: THREE.DoubleSide })));
  };
  layer(mouth(0.03), INK, 0.006);
  layer(mouth(0), '#7c1f2c', 0.012);
  const teeth = new THREE.Shape();
  teeth.moveTo(-w + 0.03, top - 0.005);
  teeth.lineTo(w - 0.03, top - 0.005);
  teeth.quadraticCurveTo(w - 0.04, top - 0.1, w - 0.1, top - 0.1);
  teeth.lineTo(-w + 0.1, top - 0.1);
  teeth.quadraticCurveTo(-w + 0.04, top - 0.1, -w + 0.03, top - 0.005);
  layer(teeth, '#ffffff', 0.018);
  const tongue = new THREE.Shape();
  tongue.absellipse(0, top - depth + 0.065, 0.12, 0.05, 0, Math.PI * 2, false);
  layer(tongue, '#e86f78', 0.018);
  return g;
}

/** A heavy upper eyelid for half-closed, unimpressed eyes (goes inside an eye group). */
export function sleepyLid(skin: THREE.Material, side: number): THREE.Group {
  const g = new THREE.Group();
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), skin);
  lid.scale.set(0.98, 1.2, 0.95);
  const line = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.3, 3, 8), basic(INK));
  line.rotation.z = Math.PI / 2;
  line.scale.set(1, 1, 0.6);
  line.position.z = -0.18;
  g.add(lid, line);
  g.position.y = -0.04;
  g.rotation.z = -side * 0.08;
  return g;
}
