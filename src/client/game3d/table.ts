import * as THREE from 'three';
import { FLOOR_Y } from './environment';
import { addOutline, canvasTexture, makeCanvas, toon, toonMesh } from './materials';

export const TABLE_RADIUS = 5.4;
export const FELT_RADIUS = 4.95;

/** Deep "Sidi Bou Said" blue felt with a fine geometric ring near the edge. */
function feltTexture(): THREE.CanvasTexture {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const grad = ctx.createRadialGradient(cx, cx, S * 0.05, cx, cx, S * 0.5);
  grad.addColorStop(0, '#2a74c2');
  grad.addColorStop(0.7, '#1f5ea8');
  grad.addColorStop(1, '#174a88');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  // Subtle felt noise.
  const img = ctx.getImageData(0, 0, S, S);
  let seed = 3;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const n = ((seed / 2147483647) - 0.5) * 10;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);

  // Ornamental ring: two thin lines and a band of 8-pointed stars.
  const R = S * 0.5;
  ctx.strokeStyle = 'rgba(255, 244, 222, 0.55)';
  ctx.lineWidth = 3;
  for (const f of [0.86, 0.955]) {
    ctx.beginPath();
    ctx.arc(cx, cx, R * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  const starR = R * 0.907;
  const count = 28;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = cx + Math.cos(a) * starR;
    const y = cx + Math.sin(a) * starR;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = i % 2 ? 'rgba(255, 213, 120, 0.75)' : 'rgba(255, 244, 222, 0.6)';
    eightStar(ctx, 0, 0, 13, 9);
    ctx.fill();
    ctx.restore();
    // Small dots in between.
    const a2 = a + Math.PI / count;
    ctx.fillStyle = 'rgba(255, 244, 222, 0.45)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a2) * starR, cx + Math.sin(a2) * starR, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Faint central rosette.
  ctx.save();
  ctx.translate(cx, cx);
  ctx.strokeStyle = 'rgba(255, 244, 222, 0.08)';
  ctx.lineWidth = 6;
  for (let i = 0; i < 2; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-R * 0.32, -R * 0.32, R * 0.64, R * 0.64);
  }
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.47, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  return canvasTexture(c, { anisotropy: 8 });
}

function eightStar(ctx: CanvasRenderingContext2D, x: number, y: number, rOuter: number, rInner: number) {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (i / 16) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
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

export class Table {
  readonly group = new THREE.Group();
  readonly felt: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    // Wooden top with a raised rim.
    const rimShape = new THREE.Shape();
    rimShape.absarc(0, 0, TABLE_RADIUS, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, FELT_RADIUS, 0, Math.PI * 2, true);
    rimShape.holes.push(hole);
    const rimGeo = new THREE.ExtrudeGeometry(rimShape, {
      depth: 0.45,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.12,
      bevelSegments: 3,
      curveSegments: 96,
    });
    const wood = toon('#9a5f37');
    const rim = new THREE.Mesh(rimGeo, wood);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.35;
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.group.add(rim);

    // Inlay line on the rim.
    const inlay = new THREE.Mesh(new THREE.TorusGeometry((TABLE_RADIUS + FELT_RADIUS) / 2, 0.035, 6, 128), toon('#f1d27a'));
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = 0.23;
    this.group.add(inlay);

    this.felt = new THREE.Mesh(
      new THREE.CircleGeometry(FELT_RADIUS + 0.02, 96),
      new THREE.MeshLambertMaterial({ map: feltTexture() }),
    );
    this.felt.rotation.x = -Math.PI / 2;
    this.felt.position.y = 0;
    this.felt.receiveShadow = true;
    this.felt.name = 'felt';
    this.group.add(this.felt);

    // Apron + pedestal + base.
    const apron = toonMesh(new THREE.CylinderGeometry(TABLE_RADIUS - 0.25, TABLE_RADIUS - 0.6, 0.6, 64), '#87502c', {
      outline: 0.05,
    });
    apron.position.y = -0.7;
    this.group.add(apron);
    const pedestalPts = [
      [0, -0.95],
      [1.1, -0.95],
      [0.55, -1.6],
      [0.45, -3.2],
      [0.7, -4.4],
      [2.2, -5.05],
      [2.3, -5.6],
      [0, -5.6],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const pedestal = toonMesh(new THREE.LatheGeometry(pedestalPts, 32), '#7a4526', { outline: 0.05 });
    pedestal.position.y = FLOOR_Y + 5.6 - 0.0;
    this.group.add(pedestal);

    // A teapot for the table (each player's own order stands in front of them).
    const pot = teapot();
    pot.position.set(Math.cos(-Math.PI * 0.62) * 4.05, 0, Math.sin(-Math.PI * 0.62) * 4.05);
    pot.rotation.y = 0.6;
    pot.scale.setScalar(0.62);
    this.group.add(pot);

    scene.add(this.group);
  }
}
