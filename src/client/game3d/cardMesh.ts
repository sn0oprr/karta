import * as THREE from 'three';
import { parseCard } from '../../shared/cards';
import { CARD_ASPECT, CARD_CORNER, makeCardCanvas } from './cardArt';
import { makeCanvas } from './materials';

export const CARD_W = 1.2;
export const CARD_H = CARD_W / CARD_ASPECT;
export const CARD_T = 0.016;

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Card geometry with three material groups: 0 = front (+Z), 1 = back (−Z), 2 = edge. */
function buildCardGeometry(w: number, h: number, r: number, t: number): THREE.BufferGeometry {
  const shape = roundedRectShape(w, h, r);
  const outline = shape.getPoints(5);
  // Drop the duplicated closing point if present.
  if (outline.length > 1 && outline[0]!.distanceTo(outline[outline.length - 1]!) < 1e-6) outline.pop();
  const tris = THREE.ShapeUtils.triangulateShape(outline, []);
  // Make every triangle counter-clockwise (front-facing towards +Z).
  for (const tri of tris) {
    const [a, b, c] = [outline[tri[0]!]!, outline[tri[1]!]!, outline[tri[2]!]!];
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) {
      const tmp = tri[1]!;
      tri[1] = tri[2]!;
      tri[2] = tmp;
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const groups: { start: number; count: number; mat: number }[] = [];

  // Front.
  let base = 0;
  let start = indices.length;
  for (const p of outline) {
    positions.push(p.x, p.y, t / 2);
    normals.push(0, 0, 1);
    uvs.push((p.x + w / 2) / w, (p.y + h / 2) / h);
  }
  for (const [a, b, c] of tris) indices.push(base + a!, base + b!, base + c!);
  groups.push({ start, count: indices.length - start, mat: 0 });

  // Back (mirrored so it reads correctly when the card is turned over).
  base = positions.length / 3;
  start = indices.length;
  for (const p of outline) {
    positions.push(p.x, p.y, -t / 2);
    normals.push(0, 0, -1);
    uvs.push(1 - (p.x + w / 2) / w, (p.y + h / 2) / h);
  }
  for (const [a, b, c] of tris) indices.push(base + a!, base + c!, base + b!);
  groups.push({ start, count: indices.length - start, mat: 1 });

  // Edge strip.
  base = positions.length / 3;
  start = indices.length;
  const n = outline.length;
  let perimeter = 0;
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    perimeter += outline[i]!.distanceTo(outline[(i + 1) % n]!);
    cum.push(perimeter);
  }
  for (let i = 0; i <= n; i++) {
    const p = outline[i % n]!;
    const prev = outline[(i - 1 + n) % n]!;
    const next = outline[(i + 1) % n]!;
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    // Outward normal for a counter-clockwise outline.
    const nx = ty / len;
    const ny = -tx / len;
    const u = cum[i]! / perimeter;
    positions.push(p.x, p.y, t / 2, p.x, p.y, -t / 2);
    normals.push(nx, ny, 0, nx, ny, 0);
    uvs.push(u, 1, u, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  groups.push({ start, count: indices.length - start, mat: 2 });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  for (const g of groups) geo.addGroup(g.start, g.count, g.mat);
  geo.computeBoundingSphere();
  return geo;
}

let cardGeometry: THREE.BufferGeometry | null = null;
export function getCardGeometry(): THREE.BufferGeometry {
  if (!cardGeometry) cardGeometry = buildCardGeometry(CARD_W, CARD_H, CARD_CORNER * CARD_W, CARD_T);
  return cardGeometry;
}

// ─────────────────────────────── materials ───────────────────────────────

let maxAnisotropy = 8;
export function setMaxAnisotropy(n: number) {
  maxAnisotropy = Math.max(1, n);
}

const TEX_WIDTH = 320;
const faceMaterials = new Map<string, THREE.MeshStandardMaterial>();
let backMaterial: THREE.MeshStandardMaterial | null = null;
let edgeMaterial: THREE.MeshStandardMaterial | null = null;
const textureCanvases = new Map<string, HTMLCanvasElement>();

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** The (cached) canvas used for a card face — also handy for DOM previews. */
export function cardCanvas(id: string | 'back'): HTMLCanvasElement {
  let c = textureCanvases.get(id);
  if (!c) {
    c = makeCardCanvas(id === 'back' ? 'back' : parseCard(id), TEX_WIDTH);
    textureCanvases.set(id, c);
  }
  return c;
}

export function faceMaterial(id: string): THREE.MeshStandardMaterial {
  let m = faceMaterials.get(id);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: makeTexture(cardCanvas(id)), roughness: 0.62, metalness: 0 });
    faceMaterials.set(id, m);
  }
  return m;
}

export function getBackMaterial(): THREE.MeshStandardMaterial {
  if (!backMaterial) {
    backMaterial = new THREE.MeshStandardMaterial({ map: makeTexture(cardCanvas('back')), roughness: 0.55, metalness: 0 });
  }
  return backMaterial;
}

function edgeTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(8, 64);
  ctx.fillStyle = '#f3ead6';
  ctx.fillRect(0, 0, 8, 64);
  ctx.fillStyle = '#c9bca3';
  for (let y = 0; y < 64; y += 8) ctx.fillRect(0, y, 8, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function getEdgeMaterial(): THREE.MeshStandardMaterial {
  if (!edgeMaterial) edgeMaterial = new THREE.MeshStandardMaterial({ color: '#f1e7d3', roughness: 0.8 });
  return edgeMaterial;
}

/** Creates every face texture ahead of time and uploads it to the GPU (avoids hitches mid-game). */
export function prewarmCardTextures(renderer: THREE.WebGLRenderer, ids: string[]) {
  const mats = [getBackMaterial(), ...ids.map((id) => faceMaterial(id))];
  for (const m of mats) if (m.map) renderer.initTexture(m.map);
}

// ─────────────────────────────── glow ───────────────────────────────

let glowTexture: THREE.CanvasTexture | null = null;
/** Extra halo size around the card (world units). */
const GLOW_MARGIN = 0.42;
const GLOW_W = CARD_W + GLOW_MARGIN * 2;
const GLOW_H = CARD_H + GLOW_MARGIN * 2;

function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const pxPerUnit = 140;
  const W = Math.round(GLOW_W * pxPerUnit);
  const H = Math.round(GLOW_H * pxPerUnit);
  const [c, ctx] = makeCanvas(W, H);
  const cw = CARD_W * pxPerUnit;
  const ch = CARD_H * pxPerUnit;
  const x = (W - cw) / 2;
  const y = (H - ch) / 2;
  const r = CARD_CORNER * CARD_W * pxPerUnit;
  // A soft halo hugging the card outline (shadowBlur works in every browser, unlike ctx.filter).
  ctx.shadowColor = 'rgba(255,255,255,1)';
  ctx.fillStyle = 'white';
  const grow = 9;
  for (const blur of [40, 26, 14]) {
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.roundRect(x - grow, y - grow, cw + grow * 2, ch + grow * 2, r + grow);
    ctx.fill();
  }
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

// ─────────────────────────────── objects ───────────────────────────────

export class CardObject {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly glow: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  cardId: string | null = null;
  /** Free-form tag used by the board (e.g. "hand", "table", "pile"). */
  role = '';

  constructor(cardId: string | null = null) {
    this.mesh = new THREE.Mesh(getCardGeometry(), [getBackMaterial(), getBackMaterial(), getEdgeMaterial()]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.card = this;
    this.root.add(this.mesh);

    this.glowMat = new THREE.MeshBasicMaterial({
      map: getGlowTexture(),
      color: '#ffc928',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(GLOW_W, GLOW_H), this.glowMat);
    this.glow.position.z = -CARD_T / 2 - 0.003;
    this.glow.visible = false;
    this.glow.raycast = () => {};
    this.glow.renderOrder = 2;
    this.root.add(this.glow);
    this.setFace(cardId);
  }

  setFace(id: string | null) {
    this.cardId = id;
    const mats = this.mesh.material as THREE.Material[];
    mats[0] = id ? faceMaterial(id) : getBackMaterial();
  }

  /** Shows a coloured halo behind the card (opacity 0 hides it). */
  setGlow(opacity: number, color?: THREE.ColorRepresentation) {
    if (color !== undefined) this.glowMat.color.set(color);
    this.glowMat.opacity = opacity;
    this.glow.visible = opacity > 0.01;
  }

  get glowOpacity() {
    return this.glowMat.opacity;
  }

  /** Puts the halo on the front side (for face-down cards, so it sits underneath them). */
  glowOnFront(front: boolean) {
    this.glow.position.z = front ? CARD_T / 2 + 0.003 : -CARD_T / 2 - 0.003;
  }

  setShadows(cast: boolean) {
    this.mesh.castShadow = cast;
  }

  dispose() {
    this.root.removeFromParent();
    this.glowMat.dispose();
    (this.glow.geometry as THREE.BufferGeometry).dispose();
  }
}

/** A stack of face-down cards (captured pile or stock) drawn as one stretched card. */
export class CardStack {
  readonly root = new THREE.Group();
  private mesh: THREE.Mesh;
  private edgeMat: THREE.MeshStandardMaterial;
  count = 0;

  constructor() {
    this.edgeMat = new THREE.MeshStandardMaterial({ map: edgeTexture(), roughness: 0.85 });
    this.mesh = new THREE.Mesh(getCardGeometry(), [getBackMaterial(), getBackMaterial(), this.edgeMat]);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.rotation.x = -Math.PI / 2;
    this.root.add(this.mesh);
    this.setCount(0);
  }

  /** Height of the stack's top surface above its base. */
  heightFor(count: number): number {
    return Math.max(1, count) * CARD_T * 0.95;
  }

  setCount(count: number) {
    this.count = count;
    this.root.visible = count > 0;
    const h = this.heightFor(count);
    this.mesh.scale.set(1, 1, h / CARD_T);
    this.mesh.position.y = h / 2;
    const map = this.edgeMat.map;
    if (map) map.repeat.set(1, Math.max(1, count / 4));
  }

  get topY(): number {
    return this.root.position.y + this.heightFor(this.count);
  }
}
