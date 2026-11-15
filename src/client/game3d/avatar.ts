/**
 * Cartoon players: round heads, rosy cheeks and a red Tunisian chechia.
 */
import * as THREE from 'three';
import { addOutline, toon } from './materials';
import { animator, ease } from './tween';

const SKIN = ['#f6c9a0', '#e8b088', '#d39a6a', '#b97a4f', '#8d5a3a'];
const HAIR = ['#2b1b14', '#4a2c1d', '#1b1b22', '#6b4a2b'];

export type Look = {
  skin: string;
  hair: string;
  hat: 'chechia' | 'chechiaTilted' | 'bun' | 'curls';
  mustache: boolean;
  glasses: boolean;
};

export function lookFromId(id: string): Look {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pick = <T,>(arr: readonly T[], salt: number) => arr[Math.abs((h >>> salt) ^ (h >>> 3)) % arr.length]!;
  const hat = pick(['chechia', 'chechiaTilted', 'bun', 'curls', 'chechia'] as const, 5);
  return {
    skin: pick(SKIN, 9),
    hair: pick(HAIR, 13),
    hat,
    mustache: (hat === 'chechia' || hat === 'chechiaTilted') && ((h >>> 17) & 1) === 1,
    glasses: ((h >>> 21) & 7) === 0,
  };
}

const OUT = 0.035;

function sphere(r: number, color: THREE.ColorRepresentation, seg = 24, outline = OUT): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), toon(color));
  m.castShadow = true;
  if (outline > 0) addOutline(m, outline);
  return m;
}

/** A blue café chair (shared by avatars and empty seats). */
export function buildChair(): THREE.Group {
  const chair = new THREE.Group();
  const mat = toon('#2f6fc4');
  const back = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.4, 0.3), mat);
  back.position.set(0, -1.1, 0.95);
  back.castShadow = true;
  addOutline(back, 0.03);
  const slatMat = toon('#f3efe6');
  for (const x of [-0.75, 0, 0.75]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.4, 0.32), slatMat);
    slat.position.set(x, -1.05, 0.96);
    chair.add(slat);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.35, 2.6), mat);
  seat.position.set(0, -3.0, -0.2);
  seat.castShadow = true;
  addOutline(seat, 0.03);
  chair.add(back, seat);
  for (const [x, z] of [
    [-1.3, -1.3],
    [1.3, -1.3],
    [-1.3, 0.9],
    [1.3, 0.9],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 6), mat);
    leg.position.set(x, -4.3, z);
    leg.castShadow = true;
    chair.add(leg);
  }
  return chair;
}

export class Avatar {
  readonly root = new THREE.Group();
  /** Where held cards are attached (in front of the chest). */
  readonly handAnchor = new THREE.Group();
  private body: THREE.Group;
  private head: THREE.Group;
  private mouth: THREE.Mesh;
  private smile: THREE.Mesh;
  private eyes: THREE.Group[] = [];
  private armL: THREE.Group;
  private armR: THREE.Group;
  private shirtMat: THREE.MeshToonMaterial;
  private allMats: THREE.Material[] = [];
  private blinkAt = 0;
  private talk = 0;
  private talkTarget = 0;
  private headYaw = 0;
  private headYawTarget = 0;
  private bobPhase = Math.random() * Math.PI * 2;
  private hop = 0;
  private armsUp = 0;
  private faded = false;
  readonly look: Look;

  constructor(id: string, color: string) {
    this.look = lookFromId(id);
    const L = this.look;
    this.shirtMat = toon(color);

    // Chair (blue café chair).
    this.root.add(buildChair());

    // Body.
    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 1.5, 8, 20), this.shirtMat);
    torso.position.y = -0.55;
    torso.scale.set(1.08, 1, 0.82);
    torso.castShadow = true;
    addOutline(torso, OUT);
    this.body.add(torso);
    // Collar / vest stripe for some variety.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 20), toon('#ffffff'));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.92;
    collar.scale.set(1.1, 0.9, 1);
    this.body.add(collar);
    this.root.add(this.body);

    // Arms reaching forward to hold the cards.
    const makeArm = (side: number) => {
      const arm = new THREE.Group();
      arm.position.set(side * 1.08, 0.55, -0.1);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 6, 12), this.shirtMat);
      upper.position.set(0, -0.2, -0.6);
      upper.rotation.x = Math.PI / 2.6;
      upper.castShadow = true;
      addOutline(upper, 0.03);
      arm.add(upper);
      const hand = sphere(0.33, L.skin, 14, 0.03);
      hand.position.set(-side * 0.25, -0.55, -1.35);
      arm.add(hand);
      this.body.add(arm);
      return arm;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    this.handAnchor.position.set(0, 0.25, -1.75);
    this.body.add(this.handAnchor);

    // Head.
    this.head = new THREE.Group();
    this.head.position.y = 2.25;
    const skull = sphere(1.18, L.skin, 32);
    skull.scale.set(1, 0.96, 0.96);
    this.head.add(skull);
    const ears = [-1, 1].map((s) => {
      const ear = sphere(0.26, L.skin, 12, 0.025);
      ear.position.set(s * 1.13, -0.05, 0.05);
      ear.scale.set(0.6, 1, 0.9);
      return ear;
    });
    this.head.add(...ears);

    const face = new THREE.Group();
    face.position.z = -1.0;
    this.head.add(face);
    // Eyes.
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.4, 0.15, -0.08);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), toon('#ffffff'));
      white.scale.set(0.9, 1.15, 0.5);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshBasicMaterial({ color: '#1d1b2e' }));
      pupil.position.set(0, -0.02, -0.08);
      pupil.scale.set(1, 1.15, 0.5);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      shine.position.set(s * -0.04 + 0.04, 0.05, -0.15);
      eye.add(white, pupil, shine);
      face.add(eye);
      this.eyes.push(eye);
      // Brows.
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 8), new THREE.MeshBasicMaterial({ color: L.hair }));
      brow.rotation.z = Math.PI / 2 + s * 0.15;
      brow.position.set(s * 0.42, 0.48, -0.05);
      face.add(brow);
    }
    // Cheeks.
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 8),
        new THREE.MeshBasicMaterial({ color: '#ff8f8f', transparent: true, opacity: 0.55 }),
      );
      cheek.scale.set(1.2, 0.7, 0.3);
      cheek.position.set(s * 0.68, -0.18, 0.12);
      face.add(cheek);
    }
    // Nose.
    const nose = sphere(0.17, L.skin, 12, 0.02);
    nose.position.set(0, -0.08, -0.2);
    nose.scale.set(1, 0.9, 1.1);
    face.add(nose);
    // Mouth: a smile arc when quiet, an open mouth when talking.
    this.smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.045, 6, 16, Math.PI),
      new THREE.MeshBasicMaterial({ color: '#5a1f1f' }),
    );
    this.smile.rotation.z = Math.PI;
    this.smile.position.set(0, -0.36, -0.02);
    face.add(this.smile);
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshBasicMaterial({ color: '#5a1f1f' }));
    this.mouth.position.set(0, -0.45, 0.02);
    this.mouth.scale.set(1.1, 0.05, 0.4);
    this.mouth.visible = false;
    face.add(this.mouth);
    if (L.mustache) {
      const mMat = new THREE.MeshBasicMaterial({ color: L.hair });
      for (const s of [-1, 1]) {
        const half = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 4, 8), mMat);
        half.rotation.z = Math.PI / 2 + s * 0.35;
        half.position.set(s * 0.2, -0.25, -0.1);
        face.add(half);
      }
    }
    if (L.glasses) {
      const gMat = new THREE.MeshBasicMaterial({ color: '#1d1b2e' });
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 6, 20), gMat);
        ring.position.set(s * 0.4, 0.15, -0.22);
        face.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), gMat);
      bridge.rotation.z = Math.PI / 2;
      bridge.position.set(0, 0.2, -0.24);
      face.add(bridge);
    }

    // Hair and headwear.
    if (L.hat === 'chechia' || L.hat === 'chechiaTilted') {
      const hat = new THREE.Group();
      const felt = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.75, 28), toon('#d7263d'));
      felt.castShadow = true;
      addOutline(felt, 0.03);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.78, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#d7263d'));
      top.scale.y = 0.18;
      top.position.y = 0.37;
      hat.add(felt, top);
      const tassel = new THREE.Group();
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), new THREE.MeshBasicMaterial({ color: '#1d1b2e' }));
      cord.position.set(0.3, 0.32, 0);
      cord.rotation.z = -1.1;
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), new THREE.MeshBasicMaterial({ color: '#1d1b2e' }));
      tuft.position.set(0.55, 0.05, 0);
      tassel.add(cord, tuft);
      tassel.position.y = 0.35;
      hat.add(tassel);
      hat.position.set(0, 0.95, 0.05);
      if (L.hat === 'chechiaTilted') hat.rotation.z = 0.22;
      this.head.add(hat);
      // A bit of hair under the cap.
      const hair = sphere(1.05, L.hair, 20, 0);
      hair.scale.set(1.05, 0.5, 1.02);
      hair.position.set(0, 0.48, 0.15);
      this.head.add(hair);
    } else if (L.hat === 'bun') {
      const hair = sphere(1.22, L.hair, 28, OUT);
      hair.scale.set(1.0, 0.75, 1.0);
      hair.position.set(0, 0.42, 0.12);
      this.head.add(hair);
      const bun = sphere(0.5, L.hair, 16, OUT);
      bun.position.set(0, 1.25, 0.45);
      this.head.add(bun);
      // Jasmine flower behind the ear.
      const flower = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), toon('#ffffff'));
        const a = (i / 5) * Math.PI * 2;
        petal.position.set(Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0);
        petal.scale.set(1, 1, 0.4);
        flower.add(petal);
      }
      const heart = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toon('#ffd54a'));
      flower.add(heart);
      flower.position.set(-1.05, 0.45, -0.25);
      flower.rotation.y = Math.PI / 2.4;
      this.head.add(flower);
      // Earrings.
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), toon('#f2c14e'));
        ring.position.set(s * 1.13, -0.4, 0.02);
        ring.rotation.y = Math.PI / 2;
        this.head.add(ring);
      }
    } else {
      const hair = sphere(1.24, L.hair, 28, OUT);
      hair.scale.set(1.02, 0.7, 1.02);
      hair.position.set(0, 0.5, 0.15);
      this.head.add(hair);
      for (let i = 0; i < 7; i++) {
        const curl = sphere(0.36, L.hair, 12, 0);
        const a = (i / 6) * Math.PI - Math.PI;
        curl.position.set(Math.cos(a) * 0.95, 0.85 + Math.sin(-a) * 0.15, Math.sin(a) * 0.5 + 0.1);
        this.head.add(curl);
      }
    }

    this.root.add(this.head);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name !== 'outline') {
        const m = o.material as THREE.Material;
        if (!this.allMats.includes(m)) this.allMats.push(m);
      }
    });
    this.blinkAt = performance.now() + 1500 + Math.random() * 3000;
  }

  setColor(color: string) {
    this.shirtMat.color.set(color);
  }

  /** Mouth opening driven by voice level (0..1). */
  setTalking(level: number) {
    this.talkTarget = Math.min(1, level);
  }

  /** Turn the head toward a world point. */
  lookAt(worldTarget: THREE.Vector3 | null) {
    if (!worldTarget) {
      this.headYawTarget = 0;
      return;
    }
    const local = this.root.worldToLocal(worldTarget.clone());
    // Forward is −Z in avatar space.
    this.headYawTarget = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -0.7, 0.7);
  }

  celebrate() {
    void animator.run({
      duration: 900,
      ease: ease.linear,
      update: (t) => {
        this.hop = Math.sin(t * Math.PI * 2) * (1 - t) * 0.9;
        this.hop = Math.abs(this.hop);
        this.armsUp = Math.sin(t * Math.PI);
      },
    });
  }

  nod() {
    void animator.run({
      duration: 500,
      ease: ease.linear,
      update: (t) => {
        this.hop = Math.sin(t * Math.PI) * 0.25;
      },
    });
  }

  /** Dims the avatar (away / empty seat preview). */
  setFaded(faded: boolean) {
    if (faded === this.faded) return;
    this.faded = faded;
    for (const m of this.allMats) {
      m.transparent = faded;
      (m as THREE.MeshToonMaterial).opacity = faded ? 0.45 : 1;
      m.needsUpdate = true;
    }
  }

  update(dt: number, time: number) {
    // Breathing & idle sway.
    const breathe = Math.sin(time * 1.7 + this.bobPhase);
    this.body.scale.y = 1 + breathe * 0.012;
    this.body.position.y = this.hop;
    this.head.position.y = 2.25 + breathe * 0.04 + this.hop;
    this.headYaw += (this.headYawTarget - this.headYaw) * Math.min(1, dt * 4);
    this.head.rotation.y = this.headYaw + Math.sin(time * 0.6 + this.bobPhase) * 0.05;
    this.head.rotation.z = Math.sin(time * 0.9 + this.bobPhase) * 0.03;

    // Blink.
    const now = performance.now();
    let eyeScale = 1;
    if (now > this.blinkAt) {
      const k = (now - this.blinkAt) / 140;
      eyeScale = k < 1 ? Math.abs(1 - k * 2) * 0.9 + 0.1 : 1;
      if (k >= 1) this.blinkAt = now + 2200 + Math.random() * 3500;
    }
    for (const e of this.eyes) e.scale.y = eyeScale;

    // Talking mouth.
    this.talk += (this.talkTarget - this.talk) * Math.min(1, dt * 18);
    const open = this.talk > 0.04;
    this.mouth.visible = open;
    this.smile.visible = !open;
    this.mouth.scale.y = 0.08 + this.talk * 0.75;
    if (open) this.head.rotation.x = -this.talk * 0.06;
    else this.head.rotation.x = 0;

    // Arms.
    const up = this.armsUp;
    this.armL.rotation.x = -up * 1.9;
    this.armR.rotation.x = -up * 1.9;
    this.armL.rotation.z = up * 0.4;
    this.armR.rotation.z = -up * 0.4;
  }
}
