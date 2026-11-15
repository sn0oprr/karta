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
