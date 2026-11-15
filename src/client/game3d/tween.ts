/**
 * Tiny promise-based animation system driven by the render loop.
 */
import * as THREE from 'three';

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
} satisfies Record<string, Ease>;

interface Running {
  start: number;
  duration: number;
  ease: Ease;
  update: (t: number) => void;
  resolve: () => void;
  owner?: object;
  done: boolean;
}

class Animator {
  private items: Running[] = [];
  private now = 0;
  /** Global speed multiplier (e.g. 0 when skipping animations). */
  speed = 1;

  tick(nowMs: number) {
    this.now = nowMs;
    if (this.items.length === 0) return;
    const items = this.items;
    this.items = [];
    const keep: Running[] = [];
    for (const it of items) {
      if (it.done) continue;
      const raw = it.duration <= 0 ? 1 : (nowMs - it.start) / it.duration;
      if (raw < 0) {
        keep.push(it);
        continue;
      }
      const t = Math.min(1, raw);
      it.update(it.ease(t));
      if (t >= 1) {
        it.done = true;
        it.resolve();
      } else keep.push(it);
    }
    this.items.push(...keep);
  }

  /** Runs `update(easedT)` over `duration` ms after `delay` ms. */
  run(opts: { duration: number; delay?: number; ease?: Ease; owner?: object; update: (t: number) => void }): Promise<void> {
    if (opts.owner) this.cancel(opts.owner);
    const duration = opts.duration * (this.speed === 0 ? 0 : 1 / this.speed);
    const delay = (opts.delay ?? 0) * (this.speed === 0 ? 0 : 1 / this.speed);
    return new Promise((resolve) => {
      const item: Running = {
        start: performance.now() + delay,
        duration,
        ease: opts.ease ?? ease.inOutQuad,
        update: opts.update,
        resolve,
        owner: opts.owner,
        done: false,
      };
      if (duration <= 0 && delay <= 0) {
        item.update(1);
        resolve();
        return;
      }
      this.items.push(item);
    });
  }

  /** Stops animations owned by `owner` (they resolve immediately, without a final update). */
  cancel(owner: object) {
    for (const it of this.items) {
      if (it.owner === owner && !it.done) {
        it.done = true;
        it.resolve();
      }
    }
  }

  /** Is an animation owned by `owner` still running? */
  isRunning(owner: object): boolean {
    return this.items.some((it) => it.owner === owner && !it.done);
  }

  /** Finishes everything instantly. */
  finishAll() {
    const items = this.items;
    this.items = [];
    for (const it of items) {
      if (it.done) continue;
      it.done = true;
      it.update(1);
      it.resolve();
    }
  }

  wait(ms: number): Promise<void> {
    return this.run({ duration: ms, update: () => {} });
  }

  get time() {
    return this.now;
  }
}

export const animator = new Animator();

export function wait(ms: number) {
  return animator.wait(ms);
}

const tmpV = new THREE.Vector3();

export interface MoveOptions {
  position: THREE.Vector3;
  quaternion?: THREE.Quaternion;
  /** Intermediate orientation reached halfway (controls the direction of flips). */
  via?: THREE.Quaternion;
  scale?: number;
  duration: number;
  delay?: number;
  ease?: Ease;
  /** Height of the arc (world units) added at the middle of the path. */
  arc?: number;
  onUpdate?: (t: number) => void;
}

/** Moves an object along an arched path while rotating it. Cancels earlier moves of the same object. */
export function moveObject(obj: THREE.Object3D, o: MoveOptions): Promise<void> {
  const p0 = obj.position.clone();
  const p1 = o.position.clone();
  const q0 = obj.quaternion.clone();
  const q1 = o.quaternion?.clone();
  const via = o.via?.clone();
  const s0 = obj.scale.x;
  const s1 = o.scale ?? s0;
  const arc = o.arc ?? 0;
  // Quadratic bezier whose control point makes the path pass `arc` above the midpoint at t = .5.
  const ctrl = p0.clone().lerp(p1, 0.5);
  ctrl.y += arc * 2;
  return animator.run({
    duration: o.duration,
    delay: o.delay,
    ease: o.ease ?? ease.inOutCubic,
    owner: obj,
    update: (t) => {
      if (arc !== 0) {
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        tmpV.set(
          a * p0.x + b * ctrl.x + c * p1.x,
          a * p0.y + b * ctrl.y + c * p1.y,
          a * p0.z + b * ctrl.z + c * p1.z,
        );
        obj.position.copy(tmpV);
      } else {
        obj.position.lerpVectors(p0, p1, t);
      }
      if (q1) {
        if (via) {
          if (t < 0.5) obj.quaternion.slerpQuaternions(q0, via, t * 2);
          else obj.quaternion.slerpQuaternions(via, q1, (t - 0.5) * 2);
        } else obj.quaternion.slerpQuaternions(q0, q1, t);
      }
      if (s1 !== s0) obj.scale.setScalar(s0 + (s1 - s0) * t);
      o.onUpdate?.(t);
    },
  });
}

const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/** Orientation of a card lying flat on the table. */
export function flatQuat(yaw: number, faceUp: boolean, out = new THREE.Quaternion()): THREE.Quaternion {
  tmpEuler.set(faceUp ? -Math.PI / 2 : Math.PI / 2, yaw, 0, 'YXZ');
  return out.setFromEuler(tmpEuler);
}

/** Orientation of a card standing up, front facing direction `yaw` (0 = facing +Z), tilted back by `tilt`. */
export function standQuat(yaw: number, tilt = 0, roll = 0, out = new THREE.Quaternion()): THREE.Quaternion {
  tmpEuler.set(-tilt, yaw, roll, 'YXZ');
  return out.setFromEuler(tmpEuler);
}
