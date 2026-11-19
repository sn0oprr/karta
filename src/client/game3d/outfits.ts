/**
 * Clothes for the crew: a puffer jacket or vest, a hoodie, a polo with a crossbody bag, sweaters,
 * a T-shirt, a leafy holiday shirt, a sports jersey, or no shirt at all. Patterns are painted on the torso capsule's UVs (u = 0.75 is the
 * chest and grows toward the avatar's left; v runs from the bottom pole up to the neck), then a few
 * 3D pieces finish the silhouette: collars, a hood, quilted puffs, a watch.
 */
import * as THREE from 'three';
import { merge, seeded, shades } from './features';
import { addOutline, canvasTexture, makeCanvas, toon } from './materials';

/** The torso capsule (body space): radius, length of the straight part, and centre height. */
export const TORSO = { r: 1.05, h: 1.5, y: -0.55 } as const;

export function torsoScale(build: number): THREE.Vector3 {
  return new THREE.Vector3(1.08 * build, 1, 0.82 * (0.85 + 0.15 * build));
}

export type Outfit =
  | { kind: 'tee'; color: string }
  | { kind: 'sweater'; color: string; neck: 'crew' | 'turtle' }
  | { kind: 'hoodie'; color: string; inner: string }
  | { kind: 'polo'; color: string; band: string; strap: string }
  | { kind: 'puffer'; color: string; inner: string }
  | { kind: 'vest'; color: string; stripes: readonly [string, string]; sleeves: string }
  | { kind: 'hawaiian'; color: string; print: string }
  | { kind: 'jersey'; color: string; panel: string; mark: string }
  | { kind: 'bare' };

export interface BodyParts {
  body: THREE.Group;
  /** Upper-arm capsules: left, then right (their local −Y points to the hand). */
  arms: THREE.Mesh[];
  build: number;
  /** A fresh skin material. */
  skin: () => THREE.MeshToonMaterial;
}

export interface Dressed {
  torso: THREE.Material;
  sleeves: THREE.Material;
  /** Adds the 3D pieces (collars, hood, quilting…) once the body is built. */
  finish(parts: BodyParts): void;
}

// ─────────────────────────────── painting on the torso ───────────────────────────────

const TW = 512;
const TH = 384;
const HALF = TORSO.h / 2;
const CAP = (Math.PI / 2) * TORSO.r;
const TOTAL = 2 * CAP + TORSO.h;

/** Radius of the torso's cross-section at a body-space height (before the build scale). */
function girth(y: number): number {
  const d = Math.abs(y - TORSO.y) - HALF;
  return d <= 0 ? TORSO.r : Math.sqrt(Math.max(0, TORSO.r * TORSO.r - d * d));
}

/** Canvas y of a body-space height. */
function py(y: number): number {
  const ly = y - TORSO.y;
  let arc: number;
  if (ly < -HALF) arc = Math.acos(Math.min(1, (-HALF - ly) / TORSO.r)) * TORSO.r;
  else if (ly <= HALF) arc = CAP + ly + HALF;
  else arc = CAP + TORSO.h + Math.asin(Math.min(1, (ly - HALF) / TORSO.r)) * TORSO.r;
  return (1 - arc / TOTAL) * TH;
}

/** Canvas x of an angle around the torso: 0 at the chest, positive toward the avatar's left. */
function px(a: number): number {
  return ((((0.75 + a / (2 * Math.PI)) % 1) + 1) % 1) * TW;
}

function tone(color: string, k: number): string {
  const c = new THREE.Color(color).lerp(new THREE.Color(k < 0 ? '#000000' : '#ffffff'), Math.abs(k));
  return `#${c.getHexString()}`;
}

function isDark(color: string): boolean {
  const c = new THREE.Color(color);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 < 0.08;
}

function painted(draw: (ctx: CanvasRenderingContext2D) => void): THREE.MeshToonMaterial {
  const [canvas, ctx] = makeCanvas(TW, TH);
  draw(ctx);
  return toon('#ffffff', { map: canvasTexture(canvas, { anisotropy: 4 }) });
}

/** Draws three times, a full turn apart, so shapes crossing the seam (the left side) wrap around. */
function wrapped(ctx: CanvasRenderingContext2D, draw: () => void) {
  for (const dx of [-TW, 0, TW]) {
    ctx.save();
    ctx.translate(dx, 0);
    draw();
    ctx.restore();
  }
}

function line(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/** A sprig of leaves fanning out from a stem (holiday shirt print). */
function sprig(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, turn: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.scale(size, size);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  line(ctx, [
    [0, 22],
    [0, -6],
  ]);
  for (const [a, len, base] of [
    [0, 30, -4],
    [-0.75, 26, 2],
    [0.75, 26, 2],
    [-1.3, 20, 12],
    [1.3, 20, 12],
  ] as const) {
    ctx.save();
    ctx.translate(0, base);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(7, -len * 0.55, 0, -len);
    ctx.quadraticCurveTo(-7, -len * 0.55, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Short sleeves: the shirt at the shoulder, bare arm below (v = 1 is the shoulder end). */
function shortSleeves(color: string, skin: string, print?: string): THREE.MeshToonMaterial {
  const [canvas, ctx] = makeCanvas(32, 128);
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 32, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 32, 56);
  if (print) {
    for (const [x, y, turn] of [
      [6, 18, 0.4],
      [18, 38, -0.5],
      [27, 14, 2.6],
    ] as const) {
      sprig(ctx, x, y, 0.3, turn, print);
    }
  }
  ctx.fillStyle = tone(color, -0.3);
  ctx.fillRect(0, 52, 32, 5);
  return toon('#ffffff', { map: canvasTexture(canvas) });
}

// ─────────────────────────────── 3D pieces ───────────────────────────────

/** A torus lying flat around the body (open at the front by `gap` radians, ends capped). */
function flatRing(r: number, tube: number, gap = 0, centre = Math.PI * 1.5, radial = 8): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ring = new THREE.TorusGeometry(r, tube, radial, 30, Math.PI * 2 - gap);
  ring.rotateZ(centre + gap / 2);
  ring.rotateX(Math.PI / 2);
  parts.push(ring);
  if (gap > 0) {
    for (const a of [centre + gap / 2, centre - gap / 2]) {
      const end = new THREE.SphereGeometry(tube, 10, 8);
      end.translate(r * Math.cos(a), 0, r * Math.sin(a));
      parts.push(end);
    }
  }
  return merge(parts);
}

/** Front of the torso (z) at a body-space height. */
function chestZ(y: number, build: number): number {
  return -girth(y) * torsoScale(build).z;
}

function addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, outline = 0.022): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  if (outline > 0) addOutline(mesh, outline);
  parent.add(mesh);
  return mesh;
}

/** A collar, cuff or roll around the neck, following the torso's oval. */
function neckRing(p: BodyParts, mat: THREE.Material, y: number, r: number, tube: number, gap = 0, squash = 1): THREE.Mesh {
  const s = torsoScale(p.build);
  const mesh = addMesh(p.body, flatRing(r, tube, gap), mat);
  mesh.position.y = y;
  mesh.scale.set(s.x * 0.95, squash, s.z * 1.12);
  return mesh;
}

/** Rings around both forearms (cuffs) or along the sleeves (puffs). */
function armRings(p: BodyParts, mat: THREE.Material, at: number[], tube: number) {
  for (const arm of p.arms) {
    const parts = at.map((y) => {
      const ring = flatRing(0.3, tube);
      ring.translate(0, y, 0);
      return ring;
    });
    addMesh(arm, merge(parts), mat, 0.02);
  }
}

const PUFFS = [-1.62, -1.29, -0.96, -0.63, -0.3, 0.03, 0.36, 0.67];

/** Quilted puffs all around the torso, open at the front. */
function puffs(p: BodyParts, mat: THREE.Material, gap: number) {
  const parts = PUFFS.map((y) => {
    const ring = flatRing(girth(y) - 0.03, y > 0.3 ? 0.15 : 0.18, gap);
    ring.translate(0, y, 0);
    return ring;
  });
  addMesh(p.body, merge(parts), mat).scale.copy(torsoScale(p.build));
  // A tall, puffy collar, open at the throat.
  neckRing(p, mat, 1.02, 0.6, 0.2, gap + 0.15, 1.15);
}

/** A wristwatch on the arm (the face sits on top of the wrist). */
export function addWatch(arm: THREE.Mesh, kind: 'gold' | 'smart') {
  const g = new THREE.Group();
  const gold = kind === 'gold';
  const strap = toon(gold ? '#e2b13c' : '#1f1e24');
  g.add(new THREE.Mesh(flatRing(0.31, 0.055), strap));
  const face = new THREE.Mesh(gold ? new THREE.CylinderGeometry(0.15, 0.15, 0.07, 20) : new THREE.BoxGeometry(0.24, 0.07, 0.28), strap);
  face.rotation.x = Math.PI / 2;
  face.position.z = -0.33;
  addOutline(face, 0.015);
  const dial = new THREE.Mesh(
    gold ? new THREE.CylinderGeometry(0.11, 0.11, 0.075, 20) : new THREE.BoxGeometry(0.19, 0.075, 0.22),
    new THREE.MeshBasicMaterial({ color: gold ? '#2a2733' : '#25324a' }),
  );
  dial.rotation.x = Math.PI / 2;
  dial.position.z = -0.34;
  g.add(face, dial);
  g.position.y = -0.62;
  arm.add(g);
}

// ─────────────────────────────── the outfits ───────────────────────────────

export function dress(outfit: Outfit, skin: string): Dressed {
  switch (outfit.kind) {
    case 'tee':
      return {
        torso: toon(outfit.color),
        sleeves: shortSleeves(outfit.color, skin),
        finish: (p) => void neckRing(p, toon(tone(outfit.color, -0.25)), 1.0, 0.6, 0.09),
      };
    case 'sweater': {
      const rib = isDark(outfit.color) ? tone(outfit.color, 0.04) : tone(outfit.color, -0.08);
      return {
        torso: painted((ctx) => {
          ctx.fillStyle = outfit.color;
          ctx.fillRect(0, 0, TW, TH);
          ctx.fillStyle = rib;
          for (let x = 0; x < TW; x += 10) ctx.fillRect(x, 0, 3, TH);
        }),
        sleeves: toon(outfit.color),
        finish: (p) => {
          const mat = toon(outfit.color);
          if (outfit.neck === 'turtle') {
            // A folded tube up to the chin.
            const s = torsoScale(p.build);
            const tube = addMesh(p.body, new THREE.CylinderGeometry(0.55, 0.62, 0.5, 26, 1, true), mat, 0);
            tube.position.y = 1.12;
            tube.scale.set(s.x * 0.92, 1, s.z * 1.1);
            neckRing(p, mat, 0.97, 0.68, 0.14);
            neckRing(p, mat, 1.18, 0.63, 0.13);
          } else neckRing(p, mat, 1.0, 0.6, 0.11);
        },
      };
    }
    case 'hoodie':
      return {
        torso: painted((ctx) => {
          ctx.fillStyle = outfit.color;
          ctx.fillRect(0, 0, TW, TH);
          // Unzipped: the T-shirt shows down the front, wider at the neck.
          const open: [number, number][] = [
            [px(-0.45), 0],
            [px(0.45), 0],
            [px(0.27), py(0.3)],
            [px(0.25), TH],
            [px(-0.25), TH],
            [px(-0.27), py(0.3)],
          ];
          ctx.fillStyle = outfit.inner;
          fillPoly(ctx, open);
          ctx.strokeStyle = tone(outfit.color, -0.3);
          ctx.lineWidth = 5;
          line(ctx, [open[0]!, open[5]!, open[4]!]);
          line(ctx, [open[1]!, open[2]!, open[3]!]);
          // Pocket and ribbed hem.
          ctx.strokeStyle = tone(outfit.color, -0.2);
          ctx.lineWidth = 3;
          line(ctx, [
            [px(-0.75), py(-0.95)],
            [px(-0.6), py(-1.6)],
            [px(0.6), py(-1.6)],
            [px(0.75), py(-0.95)],
          ]);
        }),
        sleeves: toon(outfit.color),
        finish: (p) => {
          const mat = toon(outfit.color);
          // The hood, bunched up behind the neck.
          const arc = Math.PI * 1.2;
          const s = torsoScale(p.build);
          const hood = addMesh(p.body, flatRing(0.64, 0.25, Math.PI * 2 - arc), mat);
          hood.position.set(0, 1.0, 0.12);
          hood.scale.set(s.x * 0.98, 0.8, s.z * 1.15);
          // Drawstrings.
          const cord = toon('#f2f0ec');
          for (const side of [-1, 1]) {
            const string = addMesh(p.body, new THREE.CapsuleGeometry(0.035, 0.42, 3, 6), cord, 0.012);
            string.position.set(side * 0.22, 0.6, chestZ(0.6, p.build) - 0.05);
            string.rotation.x = -0.25;
          }
        },
      };
    case 'polo':
      return {
        torso: painted((ctx) => {
          ctx.fillStyle = outfit.color;
          ctx.fillRect(0, 0, TW, TH);
          // A wide band across the belly.
          ctx.fillStyle = outfit.band;
          ctx.fillRect(0, py(-0.2), TW, py(-0.95) - py(-0.2));
          // Placket and buttons.
          const x0 = px(0);
          ctx.strokeStyle = tone(outfit.color, -0.2);
          ctx.lineWidth = 2;
          ctx.strokeRect(x0 - 9, py(1.25), 18, py(0.42) - py(1.25));
          ctx.fillStyle = tone(outfit.color, -0.3);
          for (const y of [0.85, 0.6]) {
            ctx.beginPath();
            ctx.arc(x0, py(y), 3, 0, Math.PI * 2);
            ctx.fill();
          }
          // A little tree on the chest.
          ctx.fillStyle = outfit.band;
          const tx = px(0.42);
          const ty = py(0.55);
          for (const [dx, dy] of [
            [0, -5],
            [-4, -1],
            [4, -1],
            [0, 1],
          ] as const) {
            ctx.beginPath();
            ctx.arc(tx + dx, ty + dy, 3.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillRect(tx - 1, ty + 2, 2, 5);
          // Crossbody bag: the strap runs from the left shoulder to the right hip, front and back.
          ctx.strokeStyle = outfit.strap;
          ctx.lineWidth = 20;
          const front: [number, number][] = [
            [px(1.3), py(1.12)],
            [px(-0.9), py(-1.15)],
          ];
          const back: [number, number][] = [
            [px(1.85), py(1.12)],
            [px(-2.25), py(-1.15)],
          ];
          wrapped(ctx, () => {
            line(ctx, front);
            line(ctx, back);
          });
          ctx.strokeStyle = tone(outfit.strap, 0.25);
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          for (const off of [-7, 7]) {
            line(
              ctx,
              front.map(([x, y]): [number, number] => [x + off, y]),
            );
          }
          ctx.setLineDash([]);
          // The bag itself, at the right hip.
          ctx.fillStyle = outfit.strap;
          ctx.beginPath();
          ctx.roundRect(px(-0.85) - 36, py(-1.08), 72, 44, 10);
          ctx.fill();
          ctx.strokeStyle = tone(outfit.strap, 0.3);
          ctx.lineWidth = 2;
          line(ctx, [
            [px(-0.85) - 28, py(-1.08) + 10],
            [px(-0.85) + 28, py(-1.08) + 10],
          ]);
        }),
        sleeves: shortSleeves(outfit.color, skin),
        finish: (p) => {
          const mat = toon(outfit.color);
          neckRing(p, mat, 1.06, 0.6, 0.085, 0.55);
          // Collar points, lying on the chest.
          for (const side of [-1, 1]) {
            const point = addMesh(p.body, new THREE.CapsuleGeometry(0.06, 0.2, 4, 8), mat, 0.015);
            point.scale.set(1, 1, 0.45);
            point.position.set(side * 0.15, 0.9, chestZ(0.9, p.build) - 0.03);
            point.rotation.set(-0.5, 0, side * 0.55);
          }
          // Sunglasses hooked on the placket.
          const glasses = shades();
          glasses.scale.setScalar(0.5);
          glasses.position.set(0.05, 0.5, chestZ(0.5, p.build) - 0.07);
          glasses.rotation.set(-0.25, 0, 0.18);
          p.body.add(glasses);
        },
      };
    case 'puffer':
    case 'vest': {
      const vest = outfit.kind === 'vest';
      const gap = vest ? 1.1 : 0.5;
      return {
        torso: painted((ctx) => {
          if (outfit.kind === 'vest') {
            // A striped football shirt with black shoulders and a black V-neck.
            const [a, b] = outfit.stripes;
            const w = 0.55;
            ctx.fillStyle = a;
            ctx.fillRect(0, 0, TW, TH);
            ctx.fillStyle = b;
            wrapped(ctx, () => {
              for (let k = -6; k <= 6; k += 2) ctx.fillRect(px(k * w - w / 2), 0, px(w / 2) - px(-w / 2), TH);
            });
            ctx.fillStyle = outfit.sleeves;
            ctx.fillRect(0, 0, TW, py(1.02));
            ctx.strokeStyle = outfit.sleeves;
            ctx.lineWidth = 12;
            line(ctx, [
              [px(-0.36), py(1.02)],
              [px(0), py(0.62)],
              [px(0.36), py(1.02)],
            ]);
          } else {
            ctx.fillStyle = outfit.color;
            ctx.fillRect(0, 0, TW, TH);
            // Stitching between the puffs.
            ctx.fillStyle = tone(outfit.color, -0.35);
            for (let i = 1; i < PUFFS.length; i++) ctx.fillRect(0, py((PUFFS[i - 1]! + PUFFS[i]!) / 2) - 1.5, TW, 3);
            // Open zip: the T-shirt underneath.
            ctx.fillStyle = outfit.inner;
            ctx.fillRect(px(-gap / 2 - 0.05), 0, px(gap / 2 + 0.05) - px(-gap / 2 - 0.05), TH);
            ctx.strokeStyle = '#b8bcc8';
            ctx.lineWidth = 3;
            ctx.setLineDash([3, 3]);
            line(ctx, [
              [px(gap / 2 + 0.03), 0],
              [px(gap / 2 + 0.03), TH],
            ]);
            ctx.setLineDash([]);
          }
        }),
        sleeves: outfit.kind === 'vest' ? shortSleeves(outfit.sleeves, skin) : toon(outfit.color),
        finish: (p) => {
          const mat = toon(outfit.color);
          puffs(p, mat, gap);
          if (!vest) armRings(p, mat, [-0.55, -0.1, 0.35], 0.12);
        },
      };
    }
    case 'hawaiian':
      return {
        torso: painted((ctx) => {
          ctx.fillStyle = outfit.color;
          ctx.fillRect(0, 0, TW, TH);
          // Leaves all over, turned every which way.
          const rand = seeded(11);
          wrapped(ctx, () => {
            for (let row = 0; row < 5; row++) {
              for (let col = 0; col < 8; col++) {
                const x = ((col + (row % 2) * 0.5 + (rand() - 0.5) * 0.3) / 8) * TW;
                const y = py(0.85 - row * 0.62 + (rand() - 0.5) * 0.15);
                sprig(ctx, x, y, 0.62 + rand() * 0.2, (rand() - 0.5) * 2.4, outfit.print);
              }
            }
          });
          // Open at the neck, buttoned below.
          ctx.fillStyle = skin;
          fillPoly(ctx, [
            [px(-0.34), 0],
            [px(0.34), 0],
            [px(0), py(0.5)],
          ]);
          ctx.strokeStyle = tone(outfit.color, -0.3);
          ctx.lineWidth = 3;
          line(ctx, [
            [px(0), py(0.5)],
            [px(0), TH],
          ]);
          ctx.fillStyle = tone(outfit.color, -0.4);
          for (const y of [0.2, -0.3, -0.8]) {
            ctx.beginPath();
            ctx.arc(px(0) + 7, py(y), 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }),
        sleeves: shortSleeves(outfit.color, skin, outfit.print),
        finish: (p) => {
          const mat = toon(outfit.color);
          neckRing(p, mat, 1.03, 0.62, 0.09, 0.9);
          // A camp collar: two wide flaps lying open on the chest.
          for (const side of [-1, 1]) {
            const flap = addMesh(p.body, new THREE.SphereGeometry(0.3, 14, 10), mat, 0.018);
            flap.scale.set(1.15, 0.6, 0.3);
            flap.position.set(side * 0.42, 0.84, chestZ(0.84, p.build) + 0.06);
            flap.rotation.set(-0.55, side * 0.35, side * 0.6);
          }
        },
      };
    case 'jersey':
      return {
        torso: painted((ctx) => {
          ctx.fillStyle = outfit.color;
          ctx.fillRect(0, 0, TW, TH);
          ctx.fillStyle = outfit.panel;
          // A dark slanted panel across the chest, and a dark yoke over the shoulder blades.
          fillPoly(ctx, [
            [px(-0.95), py(0.1)],
            [px(-0.2), py(0.85)],
            [px(0.95), py(0.85)],
            [px(0.95), py(0.2)],
            [px(0.2), py(-0.55)],
            [px(-0.95), py(-0.55)],
          ]);
          ctx.fillRect(px(Math.PI - 1.15), py(1.05), px(Math.PI + 1.15) - px(Math.PI - 1.15), py(0.5) - py(1.05));
          // The badge: a white slanted bar.
          ctx.fillStyle = outfit.mark;
          fillPoly(ctx, [
            [px(-0.48), py(-0.22)],
            [px(0.1), py(-0.22)],
            [px(0.48), py(0.42)],
            [px(-0.1), py(0.42)],
          ]);
        }),
        sleeves: shortSleeves(outfit.color, skin),
        finish: (p) => void neckRing(p, toon(tone(outfit.color, -0.2)), 1.0, 0.6, 0.09),
      };
    case 'bare':
      return {
        torso: painted((ctx) => {
          ctx.fillStyle = skin;
          ctx.fillRect(0, 0, TW, TH);
          ctx.strokeStyle = tone(skin, -0.32);
          ctx.lineCap = 'round';
          ctx.lineWidth = 3;
          // Breastbone, under the pecs, the six-pack and the obliques.
          line(ctx, [
            [px(0), py(0.55)],
            [px(0), py(-0.95)],
          ]);
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(px(s * 0.03), py(0.08));
            ctx.quadraticCurveTo(px(s * 0.45), py(-0.08), px(s * 0.8), py(0.4));
            ctx.stroke();
            for (const y of [-0.15, -0.47, -0.79]) {
              ctx.beginPath();
              ctx.moveTo(px(s * 0.04), py(y));
              ctx.quadraticCurveTo(px(s * 0.2), py(y - 0.05), px(s * 0.36), py(y + 0.04));
              ctx.stroke();
            }
            ctx.beginPath();
            ctx.moveTo(px(s * 0.42), py(0.0));
            ctx.quadraticCurveTo(px(s * 0.5), py(-0.6), px(s * 0.3), py(-1.25));
            ctx.stroke();
          }
          ctx.fillStyle = tone(skin, -0.4);
          ctx.beginPath();
          ctx.ellipse(px(0), py(-1.08), 3.5, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          // A little chest hair.
          ctx.strokeStyle = 'rgba(58, 38, 32, 0.35)';
          ctx.lineWidth = 1.2;
          for (let i = 0; i < 40; i++) {
            const x = px((((i * 37) % 40) / 40 - 0.5) * 0.7);
            const y = py(0.2 + ((i * 13) % 17) / 40);
            line(ctx, [
              [x, y],
              [x + 2, y - 4],
            ]);
          }
        }),
        sleeves: toon(skin),
        finish: (p) => {
          const s = torsoScale(p.build);
          const pecZ = chestZ(0.42, p.build) + 0.2;
          for (const side of [-1, 1]) {
            const pec = addMesh(p.body, new THREE.SphereGeometry(0.47, 20, 14), p.skin(), 0.02);
            pec.scale.set(1.25, 0.8, 0.62);
            pec.position.set(side * 0.44, 0.42, pecZ);
            const nipple = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), new THREE.MeshBasicMaterial({ color: '#c96a5e', side: THREE.DoubleSide }));
            nipple.position.set(side * 0.5, 0.34, pecZ - 0.29);
            p.body.add(nipple);
            const shoulder = addMesh(p.body, new THREE.SphereGeometry(0.43, 18, 12), p.skin(), 0.025);
            shoulder.position.set(side * 1.08 * p.build, 0.66, -0.06);
          }
          const neck = addMesh(p.body, new THREE.CylinderGeometry(0.42, 0.52, 0.6, 18), p.skin(), 0);
          neck.position.y = 1.1;
          neck.scale.set(s.x / 1.08, 1, 1);
        },
      };
  }
}
