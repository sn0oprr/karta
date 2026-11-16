import * as THREE from 'three';
import { FLOOR_Y } from './environment';
import { addOutline, canvasTexture, makeCanvas, outlineMaterial, toon, toonMesh } from './materials';

/** Half the side of the green felt (the playing surface), as seen inside the frame. */
export const FELT_HALF = 5.0;
/** Half the side of the wooden frame around the felt. */
export const FRAME_HALF = 5.6;
/** Middle of the frame's width (the turn indicator lies along it). */
export const FRAME_MID = (FELT_HALF + FRAME_HALF) / 2;
/** Height of the frame's top above the felt. */
export const FRAME_TOP = 0.22;
/** The frame's boards: thickness below their rounded top edges, bevel, and outer corner rounding. */
const BOARD_DEPTH = 0.45;
const BEVEL = 0.1;
const CORNER_R = 0.5;

/** Distance from the table centre to the playing surface's edge straight in front of a seat. */
export const TABLE_EXTENT = FELT_HALF;

/**
 * Points along the outer edge of the playing surface (y = 0), used to frame the camera.
 * Whatever shape the table has, these trace its outline: here the square's sides, corners included.
 */
export function tableEdgePoints(count = 32): THREE.Vector3[] {
  const perSide = Math.max(1, Math.round(count / 4));
  const F = FELT_HALF;
  const pts: THREE.Vector3[] = [];
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < perSide; i++) {
      // Walk each side from one corner towards the next (anticlockwise seen from above).
      const t = -F + (2 * F * i) / perSide;
      const [x, z] = side === 0 ? [t, F] : side === 1 ? [F, -t] : side === 2 ? [-t, -F] : [-F, t];
      pts.push(new THREE.Vector3(x, 0, z));
    }
  }
  return pts;
}

// ───────────────────────────── textures ─────────────────────────────

/** Seeded noise so the table looks the same for everyone. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

/** Warm cartoon wood: a few wavy grain lines and the odd knot. Tiles in both directions. */
function woodTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#a7683c';
  ctx.fillRect(0, 0, S, S);
  const rnd = rng(29);
  const waves = (y0: number, amp: number, k1: number, k2: number, ph: number) => (x: number) =>
    y0 + Math.sin((x / S) * Math.PI * 2 * k1 + ph) * amp + Math.sin((x / S) * Math.PI * 2 * k2 + ph * 2.3) * amp * 0.4;
  const stroke = (f: (x: number) => number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    // Drawn three times, one texture height apart, so the grain tiles vertically.
    for (const dy of [-S, 0, S]) {
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        if (x === 0) ctx.moveTo(x, f(x) + dy);
        else ctx.lineTo(x, f(x) + dy);
      }
      ctx.stroke();
    }
  };
  // Broad lighter streaks first, then the darker grain lines on top.
  for (let i = 0; i < 6; i++) {
    stroke(waves((i + rnd()) * (S / 6), 6 + rnd() * 8, 1, 3, rnd() * 6), 'rgba(196, 132, 80, 0.45)', 14 + rnd() * 12);
  }
  for (let i = 0; i < 16; i++) {
    const dark = i % 3 === 0;
    stroke(
      waves((i + rnd() * 0.6) * (S / 16), 3 + rnd() * 7, 1 + Math.floor(rnd() * 2), 2 + Math.floor(rnd() * 3), rnd() * 6),
      dark ? 'rgba(96, 50, 24, 0.85)' : 'rgba(122, 68, 34, 0.6)',
      dark ? 4.5 : 2.5,
    );
  }
  // Knots.
  for (const [x, y] of [
    [140, 120],
    [390, 330],
  ] as const) {
    for (let r = 3; r >= 0; r--) {
      ctx.beginPath();
      ctx.ellipse(x, y, 7 + r * 7, 3 + r * 3, 0, 0, Math.PI * 2);
      ctx.strokeStyle = r === 0 ? 'rgba(90, 46, 22, 0.9)' : 'rgba(110, 60, 30, 0.45)';
      ctx.lineWidth = r === 0 ? 5 : 2;
      ctx.stroke();
    }
  }
  return canvasTexture(c, { repeat: [1 / 11.5, 0.3] });
}

/** Path of a card suit pip of `size` centred on the origin, pointing up (−y). */
function pipPath(ctx: CanvasRenderingContext2D, suit: 'hearts' | 'diamonds' | 'clubs' | 'spades', size: number) {
  const s = size / 2;
  ctx.beginPath();
  switch (suit) {
    case 'diamonds':
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.25, -s * 0.25, s * 0.72, 0);
      ctx.quadraticCurveTo(s * 0.25, s * 0.25, 0, s);
      ctx.quadraticCurveTo(-s * 0.25, s * 0.25, -s * 0.72, 0);
      ctx.quadraticCurveTo(-s * 0.25, -s * 0.25, 0, -s);
      break;
    case 'hearts':
      ctx.moveTo(0, s * 0.95);
      ctx.bezierCurveTo(-s * 0.35, s * 0.55, -s, s * 0.15, -s, -s * 0.35);
      ctx.bezierCurveTo(-s, -s * 0.95, -s * 0.2, -s * 1.05, 0, -s * 0.5);
      ctx.bezierCurveTo(s * 0.2, -s * 1.05, s, -s * 0.95, s, -s * 0.35);
      ctx.bezierCurveTo(s, s * 0.15, s * 0.35, s * 0.55, 0, s * 0.95);
      break;
    case 'spades':
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.35, -s * 0.55, s, -s * 0.2, s, s * 0.22);
      ctx.bezierCurveTo(s, s * 0.7, s * 0.3, s * 0.75, s * 0.08, s * 0.38);
      ctx.lineTo(s * 0.3, s);
      ctx.lineTo(-s * 0.3, s);
      ctx.lineTo(-s * 0.08, s * 0.38);
      ctx.bezierCurveTo(-s * 0.3, s * 0.75, -s, s * 0.7, -s, s * 0.22);
      ctx.bezierCurveTo(-s, -s * 0.2, -s * 0.35, -s * 0.55, 0, -s);
      break;
    case 'clubs': {
      const r = s * 0.42;
      ctx.arc(0, -s * 0.5, r, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.48 + r, s * 0.12);
      ctx.arc(-s * 0.48, s * 0.12, r, 0, Math.PI * 2);
      ctx.moveTo(s * 0.48 + r, s * 0.12);
      ctx.arc(s * 0.48, s * 0.12, r, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.1, -s * 0.3);
      ctx.lineTo(s * 0.1, -s * 0.3);
      ctx.lineTo(s * 0.3, s);
      ctx.lineTo(-s * 0.3, s);
      ctx.closePath();
      break;
    }
  }
}

/**
 * The green "tapis": soft felt with a cream border line, a suit pip in each corner and a faint
 * star in the middle. `half` is the half-size of the plane it covers (a little under the frame).
 */
function feltTexture(half: number): THREE.CanvasTexture {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const px = S / (2 * half);
  // Work in table units, centred on the table.
  ctx.translate(S / 2, S / 2);
  ctx.scale(px, px);

  const grad = ctx.createRadialGradient(0, 0, 0.4, 0, 0, half * 1.35);
  grad.addColorStop(0, '#36a865');
  grad.addColorStop(0.6, '#2b9456');
  grad.addColorStop(1, '#1f7843');
  ctx.fillStyle = grad;
  ctx.fillRect(-half, -half, half * 2, half * 2);

  // Faint khatem (eight-pointed star) and a ring in the middle; the cards cover most of it.
  ctx.strokeStyle = 'rgba(255, 246, 220, 0.09)';
  ctx.lineWidth = 0.07;
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 4);
    ctx.strokeRect(-1.55, -1.55, 3.1, 3.1);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 2.55, 0, Math.PI * 2);
  ctx.stroke();

  // Border: a cream line inset from the frame with notched corners, a fine gold one inside it.
  const F = FELT_HALF;
  const notchedRect = (inset: number, notch: number) => {
    const e = F - inset;
    ctx.beginPath();
    ctx.moveTo(-e + notch, -e);
    ctx.lineTo(e - notch, -e);
    ctx.arc(e, -e, notch, Math.PI, Math.PI / 2, true);
    ctx.lineTo(e, e - notch);
    ctx.arc(e, e, notch, -Math.PI / 2, Math.PI, true);
    ctx.lineTo(-e + notch, e);
    ctx.arc(-e, e, notch, 0, -Math.PI / 2, true);
    ctx.lineTo(-e, -e + notch);
    ctx.arc(-e, -e, notch, Math.PI / 2, 0, true);
    ctx.closePath();
  };
  notchedRect(0.36, 0.78);
  ctx.strokeStyle = 'rgba(255, 240, 205, 0.78)';
  ctx.lineWidth = 0.065;
  ctx.stroke();
  notchedRect(0.5, 0.92);
  ctx.strokeStyle = 'rgba(244, 202, 104, 0.5)';
  ctx.lineWidth = 0.03;
  ctx.stroke();

  // A suit pip in each corner notch, upright for the near seat (where the camera always is).
  const suits = ['hearts', 'clubs', 'diamonds', 'spades'] as const;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  corners.forEach(([sx, sz], i) => {
    const suit = suits[i]!;
    const red = suit === 'hearts' || suit === 'diamonds';
    const d = F - 0.58;
    ctx.save();
    ctx.translate(sx * d, sz * d);
    pipPath(ctx, suit, 0.46);
    // Cream outline behind the fill, so overlapping lobes don't show seams.
    ctx.lineWidth = 0.07;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 240, 205, 0.9)';
    ctx.stroke();
    ctx.fillStyle = red ? '#e0483f' : '#16402a';
    ctx.fill();
    ctx.restore();
  });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Felt noise.
  const img = ctx.getImageData(0, 0, S, S);
  const rnd = rng(3);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 12;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);

  // Soft shadow along the frame's inner edge.
  ctx.translate(S / 2, S / 2);
  ctx.scale(px, px);
  for (let side = 0; side < 4; side++) {
    ctx.save();
    ctx.rotate((side * Math.PI) / 2);
    const g = ctx.createLinearGradient(0, F, 0, F - 0.32);
    g.addColorStop(0, 'rgba(10, 40, 22, 0.45)');
    g.addColorStop(1, 'rgba(10, 40, 22, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-half, F - 0.32, half * 2, half);
    ctx.restore();
  }
  return canvasTexture(c, { anisotropy: 8 });
}

// ───────────────────────────── meshes ─────────────────────────────

/** The geometry with its vertices welded and normals smoothed, for an unbroken outline on hard edges. */
function smoothed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  const src = geometry.index ? [...geometry.index.array] : [...Array(pos.count).keys()];
  const welded = new Map<string, number>();
  const verts: number[] = [];
  const index = src.map((i) => {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let j = welded.get(key);
    if (j === undefined) {
      j = verts.length / 3;
      welded.set(key, j);
      verts.push(x, y, z);
    }
    return j;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Ink outline hull that stays closed around boxy shapes (see `smoothed`). */
function addInk(mesh: THREE.Mesh, thickness: number, hullGeometry = smoothed(mesh.geometry)): THREE.Mesh {
  const hull = new THREE.Mesh(hullGeometry, outlineMaterial(thickness));
  hull.name = 'outline';
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}

/**
 * One side of the frame: a board mitred at 45° into the corners (each corner's rounding shared with
 * the neighbouring board). Built for the near side (+z); the caller turns it to the others.
 */
function frameBoard(): THREE.ExtrudeGeometry {
  // The bevel grows the shape outwards and into the hole, so the outline is drawn inside by it.
  const outer = FRAME_HALF - BEVEL;
  const inner = FELT_HALF + BEVEL;
  const r = CORNER_R;
  const shape = new THREE.Shape();
  shape.moveTo(-inner, -inner);
  shape.absarc(-outer + r, -outer + r, r, (Math.PI * 5) / 4, (Math.PI * 3) / 2, false);
  shape.absarc(outer - r, -outer + r, r, (Math.PI * 3) / 2, (Math.PI * 7) / 4, false);
  shape.lineTo(inner, -inner);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: BOARD_DEPTH,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 3,
    curveSegments: 10,
  });
}

/** A turned café-table leg hanging down from y = 0, `height` tall. */
function legGeometry(height: number): THREE.LatheGeometry {
  // Profile from the foot up: a lathe faces outwards only when its points climb.
  const pts = [
    [0, -height],
    [0.27, -height],
    [0.3, -height + 0.12],
    [0.27, -height + 0.42],
    [0.2, -height + 0.6],
    [0.24, -3.2],
    [0.32, -2.55],
    [0.24, -1.9],
    [0.27, -1.0],
    [0.36, -0.82],
    [0.3, -0.66],
    [0.4, -0.55],
    [0.4, 0],
    [0, 0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 20);
}

function teapot(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#d9c58f', metalness: 0.85, roughness: 0.28 });
  const pts = [
    [0, 0],
    [0.55, 0],
    [0.62, 0.08],
    [0.78, 0.45],
    [0.72, 0.8],
    [0.42, 1.05],
    [0.35, 1.2],
    [0.42, 1.28],
    [0.3, 1.38],
    [0.14, 1.5],
    [0.07, 1.62],
    [0, 1.66],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), metal);
  body.castShadow = true;
  g.add(body);
  addOutline(body, 0.025);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.9, 10), metal);
  spout.position.set(0.82, 0.75, 0);
  spout.rotation.z = -0.9;
  spout.castShadow = true;
  g.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 16, Math.PI * 1.2), metal);
  handle.position.set(-0.7, 0.62, 0);
  handle.rotation.z = Math.PI * 0.4;
  g.add(handle);
  return g;
}

/** The café table: a square wooden frame around a green felt, on four turned legs. */
export class Table {
  readonly group = new THREE.Group();
  readonly felt: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    // Frame: four mitred boards, each with the grain running along it.
    const wood = woodTexture();
    const boardGeo = frameBoard();
    const boardInk = smoothed(boardGeo);
    for (let side = 0; side < 4; side++) {
      const map = wood.clone();
      map.offset.set(side * 0.37, side * 0.13);
      map.needsUpdate = true;
      // Each board a slightly different shade, as if cut from different planks.
      const board = new THREE.Mesh(boardGeo, toon(['#ffffff', '#f3e9e2', '#fbf4ee', '#efe3da'][side]!, { map }));
      board.rotation.x = -Math.PI / 2;
      board.position.y = FRAME_TOP - BOARD_DEPTH - BEVEL;
      board.castShadow = true;
      board.receiveShadow = true;
      const pivot = new THREE.Group();
      pivot.rotation.y = (side * Math.PI) / 2;
      pivot.add(board);
      this.group.add(pivot);
      addInk(board, 0.05, boardInk);
    }
    // Mitre joints: a dark line across the flat top of each corner, from the felt to the rounding.
    const jointMat = new THREE.MeshBasicMaterial({ color: '#4a2412', transparent: true, opacity: 0.7 });
    const j0 = (FELT_HALF + BEVEL * 0.6) * Math.SQRT2;
    const j1 = (FRAME_HALF - BEVEL - CORNER_R) * Math.SQRT2 + CORNER_R;
    for (let side = 0; side < 4; side++) {
      const joint = new THREE.Mesh(new THREE.PlaneGeometry(0.035, j1 - j0), jointMat);
      const a = (side * Math.PI) / 2 + Math.PI / 4;
      const r = (j0 + j1) / 2;
      joint.position.set(Math.sin(a) * r, FRAME_TOP + 0.004, Math.cos(a) * r);
      joint.rotation.set(-Math.PI / 2, 0, a);
      this.group.add(joint);
    }

    // Felt, reaching a little under the frame.
    const half = FELT_HALF + 0.2;
    this.felt = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2),
      new THREE.MeshLambertMaterial({ map: feltTexture(half) }),
    );
    this.felt.rotation.x = -Math.PI / 2;
    this.felt.receiveShadow = true;
    this.felt.name = 'felt';
    this.group.add(this.felt);

    // Apron under the top, legs at the corners and low stretchers between them.
    const legWood = '#9c5c33';
    const apronY = FRAME_TOP - BOARD_DEPTH - BEVEL * 2;
    const apron = toonMesh(new THREE.BoxGeometry((FRAME_HALF - 0.35) * 2, 0.62, (FRAME_HALF - 0.35) * 2), '#935631');
    apron.position.y = apronY - 0.31;
    addInk(apron, 0.07);
    this.group.add(apron);
    const legTop = apronY - 0.05;
    const legH = legTop - FLOOR_Y;
    const legGeo = legGeometry(legH);
    const legInset = FRAME_HALF - 0.78;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const leg = toonMesh(legGeo, legWood, { outline: 0.04 });
      leg.position.set(sx * legInset, legTop, sz * legInset);
      this.group.add(leg);
    }
    const railGeo = new THREE.CylinderGeometry(0.12, 0.12, legInset * 2, 10);
    for (let side = 0; side < 4; side++) {
      const rail = toonMesh(railGeo, legWood, { outline: 0.035 });
      const a = (side * Math.PI) / 2;
      rail.position.set(Math.sin(a) * legInset, FLOOR_Y + 1.15, Math.cos(a) * legInset);
      rail.rotation.set(0, a, Math.PI / 2);
      this.group.add(rail);
    }

    // A teapot for the table (each player's own order stands in front of them), at the far edge
    // between that player's stock and pile.
    const pot = teapot();
    pot.position.set(-0.35, 0, -4.35);
    pot.rotation.y = 0.5;
    pot.scale.setScalar(0.62);
    this.group.add(pot);

    scene.add(this.group);
  }
}
