/**
 * Café orders: an express on its saucer, a glass of tea with pine nuts, a Coke with a straw,
 * and a chicha standing on the floor beside the table. Each prop has a part that travels to the
 * drinker's mouth (the cup, glass or bottle; for the chicha, the mouthpiece at the end of its hose).
 */
import * as THREE from 'three';
import type { DrinkId } from '../../shared/protocol';
import type { Avatar } from './avatar';
import type { Smoke } from './fx';
import { addOutline, toon } from './materials';
import { animator, ease, wait } from './tween';

/** Scale of the table drinks and of the chicha (which stands on the floor). */
export const CUP_SCALE = 1.15;
export const CHICHA_SCALE = 1.25;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

function stripes(a: string, b: string, n: number, diagonal: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = b;
  const w = 64 / n;
  for (let i = -1; i < n + 1; i++) {
    ctx.beginPath();
    const x = i * w;
    if (diagonal) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w / 2, 0);
      ctx.lineTo(x + w / 2 + 16, 32);
      ctx.lineTo(x + 16, 32);
    } else {
      ctx.rect(x, 0, w / 2, 32);
    }
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Red label with a white ribbon (a generic cola, no logo). */
function labelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d7262e';
  ctx.fillRect(0, 0, 128, 32);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 0; x <= 128; x += 2) {
    const y = 16 + Math.sin((x / 128) * Math.PI * 4) * 7;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function lathe(points: [number, number][], segments = 24): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  );
}

export class DrinkProp {
  readonly root = new THREE.Group();
  /** The part that travels to the mouth. */
  readonly lift = new THREE.Group();
  /** Invisible, generous click target. */
  readonly hit: THREE.Mesh;
  /** The point that touches the lips, in `lift` space. */
  readonly lip = new THREE.Vector3();
  /** How far the cup tips toward the drinker at the mouth (radians). */
  tilt = 1;
  /** Base scale of `root`. */
  readonly baseScale: number;
  /** A sip is being played (the lifted part is animated). */
  busy = false;
  /** Chicha: the world point its mouthpiece rests at (the smoker's left hand). */
  restAnchor: ((out: THREE.Vector3) => THREE.Vector3 | null) | null = null;

  private steamAt: THREE.Vector3 | null = null;
  private nextAmbient = Math.random() * 1.5;
  private hover = 0;
  private hoverTarget = 0;
  // Chicha parts.
  private hose: THREE.Mesh | null = null;
  private hoseMat: THREE.Material | null = null;
  private hosePort = new THREE.Vector3();
  private hoseEnd = new THREE.Vector3(1e9, 0, 0);
  private coals: THREE.MeshBasicMaterial[] = [];
  private bubbles: THREE.Mesh[] = [];
  private draw = 0;
  private drawTarget = 0;
  private bowlTop = new THREE.Vector3();

  constructor(readonly kind: DrinkId) {
    this.root.add(this.lift);
    this.baseScale = kind === 'chicha' ? CHICHA_SCALE : CUP_SCALE;
    this.root.scale.setScalar(this.baseScale);
    switch (kind) {
      case 'express':
        this.buildExpress();
        break;
      case 'tea':
        this.buildTea();
        break;
      case 'coke':
        this.buildCoke();
        break;
      case 'chicha':
        this.buildChicha();
        break;
    }
    const chicha = kind === 'chicha';
    this.hit = new THREE.Mesh(
      new THREE.CylinderGeometry(chicha ? 1.25 : 0.7, chicha ? 1.25 : 0.7, chicha ? 6.4 : kind === 'coke' ? 2.3 : 1.5, 12),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hit.position.y = chicha ? 3.2 : kind === 'coke' ? 1.1 : 0.7;
    this.hit.userData.drink = this;
    this.root.add(this.hit);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.hit && o.name !== 'outline') o.castShadow = true;
    });
  }

  // ─────────────────────────────── builders ───────────────────────────────

  private buildExpress() {
    const china = toon('#fbf8f1');
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.06, 28), china);
    saucer.position.y = 0.03;
    addOutline(saucer, 0.02);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.022, 6, 32), toon('#2f7fd6'));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.065;
    this.root.add(saucer, rim);

    const cup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.21, 0.44, 24, 1, true), toon('#fbf8f1', { side: THREE.DoubleSide }));
    body.position.y = 0.28;
    addOutline(body, 0.02);
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 20), china);
    bottom.position.y = 0.075;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.287, 0.272, 0.06, 24, 1, true), toon('#2f7fd6'));
    band.position.y = 0.4;
    const crema = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.02, 24), toon('#c0864b'));
    crema.position.y = 0.45;
    const heart = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 16), toon('#7a4423'));
    heart.position.y = 0.462;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 8, 14, Math.PI * 1.25), china);
    handle.rotation.z = -Math.PI * 0.625;
    handle.position.set(0.33, 0.29, 0);
    cup.add(body, bottom, band, crema, heart, handle);
    this.lift.add(cup);
    this.lip.set(0, 0.5, 0.29);
    this.tilt = 1.05;
    this.steamAt = new THREE.Vector3(0, 0.55, 0);
  }

  private buildTea() {
    const glassMat = new THREE.MeshPhongMaterial({
      color: '#e8f6ff',
      transparent: true,
      opacity: 0.36,
      shininess: 90,
      specular: '#ffffff',
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.23, 0.82, 20, 1, true), glassMat);
    glass.position.y = 0.41;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.06, 20), glassMat);
    base.position.y = 0.03;
    const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.225, 0.6, 20), toon('#b5501a'));
    tea.position.y = 0.36;
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.268, 0.268, 0.04, 20), toon('#f0c27e'));
    foam.position.y = 0.67;
    this.lift.add(glass, base, tea, foam);
    // Tay bel bondok: pine nuts floating on top.
    const nutMat = toon('#f6e6bd');
    for (let i = 0; i < 8; i++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), nutMat);
      const a = i * 2.4 + 0.3;
      const r = 0.06 + ((i * 37) % 10) / 70;
      nut.scale.set(1, 0.55, 1.9);
      nut.position.set(Math.cos(a) * r, 0.695, Math.sin(a) * r);
      nut.rotation.y = a * 1.7;
      this.lift.add(nut);
    }
    this.lip.set(0, 0.82, 0.28);
    this.tilt = 1.0;
    this.steamAt = new THREE.Vector3(0, 0.85, 0);
  }

  private buildCoke() {
    const glass = new THREE.MeshPhongMaterial({ color: '#4a1f12', shininess: 90, specular: '#ffffff' });
    const bottle = new THREE.Mesh(
      lathe([
        [0, 0],
        [0.2, 0],
        [0.24, 0.04],
        [0.25, 0.2],
        [0.21, 0.42],
        [0.245, 0.62],
        [0.25, 0.8],
        [0.2, 0.98],
        [0.12, 1.22],
        [0.1, 1.38],
        [0.12, 1.42],
        [0.12, 1.48],
        [0, 1.48],
      ]),
      glass,
    );
    addOutline(bottle, 0.02);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.258, 0.258, 0.2, 24, 1, true), toon('#ffffff', { map: labelTexture() }));
    label.position.y = 0.71;
    const shine = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.5, 3, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 }));
    shine.position.set(-0.13, 0.3, -0.19);
    const strawTex = stripes('#ffffff', '#e63946', 4, false);
    strawTex.repeat.set(8, 1);
    const straw = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0.9, 0),
          new THREE.Vector3(0, 1.6, 0),
          new THREE.Vector3(0, 1.88, 0.03),
          new THREE.Vector3(0, 2.0, 0.16),
          new THREE.Vector3(0, 2.04, 0.34),
        ]),
        24,
        0.035,
        6,
      ),
      toon('#ffffff', { map: strawTex }),
    );
    this.lift.add(bottle, label, shine, straw);
    this.lip.set(0, 2.04, 0.36);
    this.tilt = 0.3;
  }

  private buildChicha() {
    const gold = toon('#e8b54a');
    // Glass base: you see the water bubble through it.
    const vase = new THREE.Mesh(
      lathe(
        [
          [0, 0],
          [0.62, 0],
          [0.7, 0.06],
          [0.98, 0.42],
          [1.06, 0.85],
          [0.98, 1.3],
          [0.72, 1.72],
          [0.42, 2.02],
          [0.3, 2.22],
          [0.36, 2.32],
          [0, 2.32],
        ],
        28,
      ),
      toon('#1fae9b', { transparent: true, opacity: 0.62, depthWrite: false }),
    );
    addOutline(vase, 0.03);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.66, 0.9, 24), toon('#9fe3ef', { transparent: true, opacity: 0.55, depthWrite: false }));
    water.position.y = 0.5;
    const shine = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.8, 3, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 }));
    shine.position.set(-0.55, 0.95, -0.72);
    shine.rotation.z = 0.15;
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.06, 6, 28), gold);
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.04;
    this.root.add(vase, water, shine, baseRing);
    const bubbleMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06 + (i % 3) * 0.025, 8, 6), bubbleMat);
      b.visible = false;
      b.userData.phase = i / 6;
      b.userData.x = Math.cos(i * 2.1) * 0.35;
      b.userData.z = Math.sin(i * 2.1) * 0.35;
      this.bubbles.push(b);
      this.root.add(b);
    }

    // Brass stem with its knobs, the hose port, the tray, the clay bowl and the coals.
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.1, 12), gold);
    stem.position.y = 3.8;
    addOutline(stem, 0.025);
    const knob1 = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), gold);
    knob1.position.y = 2.55;
    knob1.scale.y = 0.8;
    addOutline(knob1, 0.025);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 18), gold);
    disc.position.y = 3.45;
    const knob2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), gold);
    knob2.position.y = 4.35;
    addOutline(knob2, 0.025);
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.45, 10), gold);
    port.rotation.x = Math.PI / 2;
    port.position.set(0, 3.05, 0.26);
    this.hosePort.set(0, 3.05, 0.48);
    const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.54, 0.07, 28), gold);
    tray.position.y = 5.02;
    addOutline(tray, 0.025);
    const bowl = new THREE.Mesh(
      lathe([
        [0.1, 0],
        [0.24, 0.05],
        [0.36, 0.32],
        [0.44, 0.55],
        [0.46, 0.62],
        [0, 0.62],
      ]),
      toon('#c8693f'),
    );
    bowl.position.y = 5.1;
    addOutline(bowl, 0.025);
    const foil = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.03, 20), toon('#d5dbe2'));
    foil.position.y = 5.73;
    this.root.add(stem, knob1, disc, knob2, port, tray, bowl, foil);
    this.bowlTop.set(0, 5.95, 0);
    for (const [x, z, yaw] of [
      [-0.16, 0.06, 0.4],
      [0.15, 0.1, 1.1],
      [0.0, -0.17, 2.0],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({ color: '#4a1a0e', toneMapped: false });
      this.coals.push(mat);
      const coal = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.2), mat);
      coal.position.set(x, 5.82, z);
      coal.rotation.y = yaw;
      this.root.add(coal);
    }

    // The mouthpiece (it travels to the smoker's lips); the hose follows it.
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 0.6, 10), gold);
    tip.rotation.x = Math.PI / 2;
    addOutline(tip, 0.02);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 6, 12), gold);
    collar.position.z = -0.12;
    this.lift.add(tip, collar);
    this.lip.set(0, 0, 0.32);
    // Tip angled up into the mouth, so the hose hangs down from it.
    this.tilt = -0.55;
    const tex = stripes('#1f62b5', '#f3efe6', 3, true);
    tex.repeat.set(26, 1);
    this.hoseMat = toon('#ffffff', { map: tex });
  }

  // ─────────────────────────────── motion ───────────────────────────────

  /** World transform of the lifted part when it is not in use. */
  restTransform(outP: THREE.Vector3, outQ: THREE.Quaternion) {
    this.root.updateMatrixWorld();
    if (this.kind !== 'chicha') {
      outP.setFromMatrixPosition(this.root.matrixWorld);
      this.root.getWorldQuaternion(outQ);
      return;
    }
    const anchored = this.restAnchor?.(outP);
    if (!anchored) outP.set(0.9, 3.4, 1.0).applyMatrix4(this.root.matrixWorld);
    // Tip up, pointing away from the chicha.
    this.root.getWorldPosition(tmpV2);
    tmpE.set(-1.0, Math.atan2(outP.x - tmpV2.x, outP.z - tmpV2.z), 0, 'YXZ');
    outQ.setFromEuler(tmpE);
  }

  /** World transform of the lifted part at the drinker's lips. */
  aimTransform(mouth: THREE.Vector3, head: THREE.Vector3, outP: THREE.Vector3, outQ: THREE.Quaternion) {
    // Local +Z faces the drinker, then the cup tips toward them.
    tmpE.set(this.tilt, Math.atan2(head.x - mouth.x, head.z - mouth.z), 0, 'YXZ');
    outQ.setFromEuler(tmpE);
    tmpV.copy(this.lip).multiplyScalar(this.root.scale.x).applyQuaternion(outQ);
    outP.copy(mouth).sub(tmpV);
  }

  setLiftWorld(p: THREE.Vector3, q: THREE.Quaternion) {
    this.root.updateMatrixWorld();
    tmpM.copy(this.root.matrixWorld).invert();
    this.lift.position.copy(p).applyMatrix4(tmpM);
    this.root.getWorldQuaternion(tmpQ).invert();
    this.lift.quaternion.copy(tmpQ.multiply(q));
  }

  /** Chicha: the smoker draws (bubbles in the vase, glowing coals). */
  setDrawing(on: boolean) {
    this.drawTarget = on ? 1 : 0;
  }

  /** Mouse over the local player's drink. */
  setHover(on: boolean) {
    this.hoverTarget = on ? 1 : 0;
  }

  /** Where smoke comes out of the bowl, or steam rises from a hot drink (world space). */
  private ambientOrigin(out: THREE.Vector3): THREE.Vector3 | null {
    if (this.kind === 'chicha') return out.copy(this.bowlTop).applyMatrix4(this.root.matrixWorld);
    if (!this.steamAt) return null;
    return out.copy(this.steamAt).applyMatrix4(this.lift.matrixWorld);
  }

  update(dt: number, time: number, smoke: Smoke | null) {
    this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 12);
    const wobble = this.hover > 0.01 ? 1 + this.hover * (0.07 + Math.sin(time * 9) * 0.025) : 1;
    if (!animator.isRunning(this.root)) this.root.scale.setScalar(this.baseScale * wobble);
    this.root.updateMatrixWorld();

    // Steam over the express and the tea; a lazy wisp over the chicha's coals.
    this.nextAmbient -= dt;
    if (smoke && this.nextAmbient <= 0) {
      const chicha = this.kind === 'chicha';
      this.nextAmbient = chicha ? 1.6 + Math.random() * 2.4 : 0.5 + Math.random() * 0.5;
      const at = this.ambientOrigin(tmpV2);
      if (at) smoke.steam(at, chicha ? 1.3 : this.root.scale.x);
    }
    if (this.kind !== 'chicha') return;

    if (!this.busy) {
      this.restTransform(tmpV, tmpQ);
      this.setLiftWorld(tmpV, tmpQ);
    }
    this.draw += (this.drawTarget - this.draw) * Math.min(1, dt * 5);
    // Embers smoulder, and flare up while the smoker draws.
    const glow = Math.min(1, 0.3 + Math.sin(time * 2.3 + this.bowlTop.x) * 0.08 + this.draw * 0.75);
    for (const [i, m] of this.coals.entries()) {
      // Red embers, turning orange-yellow on a draw (linear colour, not tone-mapped).
      m.color.setRGB(0.75 + glow * 0.25, 0.06 + glow * glow * (0.5 + (i % 2) * 0.1), 0.01 + glow * glow * 0.06);
    }
    for (const b of this.bubbles) {
      b.visible = this.draw > 0.15;
      if (!b.visible) continue;
      const t = (time * 1.6 + (b.userData.phase as number)) % 1;
      b.position.set((b.userData.x as number) * (1 - t * 0.5), 0.15 + t * 0.85, (b.userData.z as number) * (1 - t * 0.5));
      b.scale.setScalar(0.6 + t * 0.8);
    }
    this.updateHose();
  }

  /** Rebuilds the hose when its end (the mouthpiece) moved. */
  private updateHose() {
    if (!this.hoseMat) return;
    this.lift.updateMatrix();
    // Back of the mouthpiece, in root space.
    const end = tmpV.set(0, 0, -0.3).applyMatrix4(this.lift.matrix);
    if (end.distanceToSquared(this.hoseEnd) < 0.0004) return;
    this.hoseEnd.copy(end);
    const back = tmpV2.set(0, 0, -1).applyQuaternion(this.lift.quaternion).normalize();
    const port = this.hosePort;
    const span = port.distanceTo(end);
    const p1 = port.clone().add(new THREE.Vector3(0, -0.7, 0.75));
    // Leaving the mouthpiece, the hose drops and heads back toward the chicha (never across the table).
    const toPort = port.clone().sub(end).setY(0).normalize();
    const p3 = end
      .clone()
      .addScaledVector(back, 0.3)
      .addScaledVector(toPort, Math.min(0.9, span * 0.15))
      .add(new THREE.Vector3(0, -Math.min(1.3, span * 0.22), 0));
    const p2 = p1.clone().lerp(p3, 0.5);
    p2.y = Math.min(p1.y, p3.y) - Math.min(2.2, span * 0.28);
    const curve = new THREE.CatmullRomCurve3([port.clone(), p1, p2, p3, end.clone()]);
    const geo = new THREE.TubeGeometry(curve, 56, 0.075, 7, false);
    if (this.hose) {
      this.hose.geometry.dispose();
      this.hose.geometry = geo;
    } else {
      this.hose = new THREE.Mesh(geo, this.hoseMat);
      this.hose.castShadow = true;
      this.hose.raycast = () => {};
      this.root.add(this.hose);
    }
  }

  dispose() {
    this.root.removeFromParent();
    const mats = new Set<THREE.Material>();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.name !== 'outline') o.geometry.dispose();
      const m = o.material as THREE.Material;
      if (!(m instanceof THREE.ShaderMaterial)) mats.add(m);
    });
    for (const m of mats) {
      (m as THREE.MeshToonMaterial).map?.dispose();
      m.dispose();
    }
  }
}

/** Who is drinking: an avatar, or the local player looking through the camera. */
export interface Drinker {
  avatar: Avatar | null;
  /** World point the cup's rim (or the mouthpiece) goes to. */
  mouth(out: THREE.Vector3): THREE.Vector3;
  /** World point the cup faces while drinking (the drinker's head). */
  head(out: THREE.Vector3): THREE.Vector3;
  /** Where exhaled smoke starts and where it drifts to. */
  breath(origin: THREE.Vector3, dir: THREE.Vector3): void;
}

/** An avatar drinking: the cup goes to its lips, the smoke comes out of its mouth. */
export function avatarDrinker(av: Avatar): Drinker {
  const head = new THREE.Vector3();
  return {
    avatar: av,
    mouth: (out) => av.mouthAnchor.getWorldPosition(out),
    head: (out) => av.headCenter(out),
    breath: (origin, dir) => {
      av.mouthAnchor.getWorldPosition(origin);
      av.headCenter(head);
      dir.subVectors(origin, head).setY(0).normalize().add(UP.clone().multiplyScalar(0.3));
      origin.addScaledVector(dir, 0.15);
    },
  };
}

export interface SipOptions {
  prop: DrinkProp;
  drinker: Drinker;
  smoke: Smoke | null;
  /** Starts the sip sound; resolves with its length in seconds once it plays. */
  sound: () => Promise<number>;
  /** False once the prop was replaced or removed: stop quietly. */
  alive: () => boolean;
}

/** Lift the drink to the lips, sip (or draw on the chicha) while the sound plays, put it back. */
export async function performSip(o: SipOptions): Promise<void> {
  const { prop, drinker } = o;
  const av = drinker.avatar;
  const restP = new THREE.Vector3();
  const restQ = new THREE.Quaternion();
  const aimP = new THREE.Vector3();
  const aimQ = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const mouth = new THREE.Vector3();
  const head = new THREE.Vector3();
  const pose = (t: number) => {
    if (!o.alive()) return;
    prop.restTransform(restP, restQ);
    prop.aimTransform(drinker.mouth(mouth), drinker.head(head), aimP, aimQ);
    p.lerpVectors(restP, aimP, t).addScaledVector(UP, Math.sin(Math.PI * t) * 0.35);
    q.slerpQuaternions(restQ, aimQ, t);
    prop.setLiftWorld(p, q);
  };
  prop.busy = true;
  try {
    av?.setSipping(true);
    await animator.run({ duration: 520, ease: ease.inOutCubic, owner: prop.lift, update: pose });
    if (!o.alive()) return;
    prop.setDrawing(true);
    const secs = await o.sound();
    await animator.run({ duration: Math.max(700, secs * 1000), ease: ease.linear, owner: prop.lift, update: () => pose(1) });
    prop.setDrawing(false);
    av?.setSipping(false);
    if (prop.kind === 'chicha' && o.smoke && o.alive()) {
      // Breathe the smoke out while the hose goes back down: a big cloud, sometimes a ring.
      const from = new THREE.Vector3();
      const dir = new THREE.Vector3();
      drinker.breath(from, dir);
      av?.setBlowing(true);
      o.smoke.exhale(from, dir, 10, Math.random() < 0.6);
      void wait(450).then(() => {
        if (!o.alive()) return;
        drinker.breath(from, dir);
        o.smoke?.exhale(from, dir, 5, false);
      });
      void wait(1000).then(() => av?.setBlowing(false));
    }
    await animator.run({ duration: 520, ease: ease.inOutCubic, owner: prop.lift, update: (t) => pose(1 - t) });
  } finally {
    av?.setSipping(false);
    prop.setDrawing(false);
    prop.busy = false;
  }
}
