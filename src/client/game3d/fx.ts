import * as THREE from 'three';

const CONFETTI_COLORS = ['#ff4d6d', '#ffd23f', '#3bceac', '#4d96ff', '#ff8fab', '#ffffff', '#f77f00'];

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

/** Instanced confetti burst. */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private dummy = new THREE.Object3D();
  private cursor = 0;

  constructor(scene: THREE.Scene, count = 420) {
    const geo = new THREE.PlaneGeometry(0.22, 0.12);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      color.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]!);
      this.mesh.setColorAt(i, color);
      this.particles.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
      });
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  burst(origin: THREE.Vector3, amount = 160, power = 1) {
    for (let k = 0; k < amount; k++) {
      const p = this.particles[this.cursor]!;
      this.cursor = (this.cursor + 1) % this.particles.length;
      p.alive = true;
      p.pos.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const up = 5 + Math.random() * 7;
      const out = 1.5 + Math.random() * 4.5;
      p.vel.set(Math.cos(a) * out * power, up * power, Math.sin(a) * out * power);
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      p.life = 0;
      p.maxLife = 2.2 + Math.random() * 1.3;
      p.size = 0.7 + Math.random() * 0.8;
    }
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      if (!p.alive) continue;
      any = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.vel.y -= 13 * dt;
      p.vel.multiplyScalar(Math.pow(0.35, dt));
      // Flutter.
      p.vel.x += Math.sin(p.life * 9 + i) * 2.5 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      const fade = Math.min(1, (p.maxLife - p.life) * 2);
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.copy(p.rot);
      this.dummy.scale.setScalar(p.size * fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Soft expanding ring on the table (e.g. where a chkobba happened). */
export class Shockwave {
  private mesh: THREE.Mesh;
  private t = 1;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 64),
      new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  fire(at: THREE.Vector3) {
    this.mesh.position.copy(at).setY(0.05);
    this.t = 0;
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / 0.9);
    const s = 0.5 + this.t * 6;
    this.mesh.scale.setScalar(s);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - this.t) * 0.8;
    if (this.t >= 1) this.mesh.visible = false;
  }
}

let puffTexture: THREE.CanvasTexture | null = null;

/** Soft round puff used for smoke and steam (shared by every particle). */
function smokeTexture(): THREE.CanvasTexture {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(c);
  puffTexture.colorSpace = THREE.SRGBColorSpace;
  return puffTexture;
}

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  alpha: number;
  sway: number;
}

interface Ring {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

/** Chicha smoke (exhaled puffs and the odd smoke ring) and the steam over hot drinks. */
export class Smoke {
  private puffs: Puff[] = [];
  private rings: Ring[] = [];
  private cursor = 0;
  private ringCursor = 0;
  private tmpQ = new THREE.Quaternion();

  constructor(parent: THREE.Object3D, count = 90) {
    const tex = smokeTexture();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: '#ffffff' });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.raycast = () => {};
      parent.add(sprite);
      this.puffs.push({ sprite, mat, vel: new THREE.Vector3(), life: 1, maxLife: 1, size0: 1, size1: 1, alpha: 0, sway: 0 });
    }
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.085, 8, 28),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }),
      );
      mesh.visible = false;
      mesh.raycast = () => {};
      parent.add(mesh);
      this.rings.push({ mesh, vel: new THREE.Vector3(), life: 1 });
    }
  }

  /** One soft particle. */
  emit(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    o: { size?: [number, number]; life?: number; alpha?: number; color?: THREE.ColorRepresentation } = {},
  ) {
    const p = this.puffs[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.puffs.length;
    p.sprite.position.copy(pos);
    p.vel.copy(vel);
    p.life = 0;
    p.maxLife = o.life ?? 2.4;
    [p.size0, p.size1] = o.size ?? [0.4, 1.8];
    p.alpha = o.alpha ?? 0.6;
    p.sway = Math.random() * Math.PI * 2;
    p.mat.color.set(o.color ?? '#ffffff');
    p.mat.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
    p.sprite.scale.setScalar(p.size0);
  }

  /** A cloud breathed out from `from`, drifting along `dir`. */
  exhale(from: THREE.Vector3, dir: THREE.Vector3, amount = 9, ring = false) {
    const d = dir.clone().normalize();
    for (let i = 0; i < amount; i++) {
      const spread = new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.35, (Math.random() - 0.5) * 0.5);
      const speed = 1.3 + Math.random() * 1.1 - i * 0.06;
      const v = d.clone().multiplyScalar(speed).add(spread).add(new THREE.Vector3(0, 0.45, 0));
      this.emit(from.clone().addScaledVector(d, i * 0.05), v, {
        size: [0.35 + Math.random() * 0.2, 1.7 + Math.random() * 1.1],
        life: 2.2 + Math.random() * 1.2,
        alpha: 0.55 + Math.random() * 0.2,
        color: '#f4f1ff',
      });
    }
    if (ring) {
      const r = this.rings[this.ringCursor]!;
      this.ringCursor = (this.ringCursor + 1) % this.rings.length;
      r.mesh.position.copy(from).addScaledVector(d, 0.3);
      r.vel.copy(d).multiplyScalar(1.15).add(new THREE.Vector3(0, 0.35, 0));
      r.mesh.quaternion.copy(this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.vel.clone().normalize()));
      r.life = 0;
      r.mesh.visible = true;
    }
  }

  /** A faint wisp of steam rising from a hot glass. */
  steam(from: THREE.Vector3, scale = 1) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.55 + Math.random() * 0.25, (Math.random() - 0.5) * 0.12);
    this.emit(from, v, { size: [0.18 * scale, 0.75 * scale], life: 1.7 + Math.random() * 0.6, alpha: 0.32 });
  }

  update(dt: number) {
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.vel.multiplyScalar(Math.pow(0.45, dt));
      p.vel.y += 0.22 * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.position.x += Math.sin(p.life * 2.2 + p.sway) * 0.12 * dt;
      p.sprite.scale.setScalar(p.size0 + (p.size1 - p.size0) * (1 - Math.pow(1 - t, 2)));
      // Quick fade-in, slow fade-out.
      p.mat.opacity = p.alpha * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life += dt / 2.6;
      if (r.life >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.vel.multiplyScalar(Math.pow(0.6, dt));
      r.mesh.position.addScaledVector(r.vel, dt);
      r.mesh.scale.setScalar(0.6 + r.life * 1.9);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, r.life * 6) * (1 - r.life);
    }
  }
}
