/**
 * Cartoon players: round heads, rosy cheeks, and eight café characters to choose from
 * (an old man in a red chechia, the café boss, a grandma in her headscarf…).
 */
import * as THREE from 'three';
import { type CharacterId, SKIN_TONES } from '../../shared/protocol';
import { addOutline, toon } from './materials';
import { animator, ease } from './tween';

type HairStyle = 'chechia' | 'quiff' | 'bald' | 'cap' | 'bun' | 'scarf' | 'curls' | 'long';

interface Look {
  hair: string;
  brow: string;
  /** Brow thickness (1 = normal). */
  browSize: number;
  style: HairStyle;
  mustache: null | { color: string; shape: 'droopy' | 'handlebar' };
  stubble: boolean;
  glasses: null | 'round' | 'big' | 'shades';
  shadesOnHead: boolean;
  earrings: null | 'gold' | 'hoop' | 'stud';
  flower: boolean;
  lashes: boolean;
  necklace: boolean;
  lips: string;
  /** Cap / headscarf colour. */
  accent: string;
  /** Torso width (1 = normal). */
  build: number;
}

const BASE: Look = {
  hair: '#2b1b14',
  brow: '#2b1b14',
  browSize: 1,
  style: 'quiff',
  mustache: null,
  stubble: false,
  glasses: null,
  shadesOnHead: false,
  earrings: null,
  flower: false,
  lashes: false,
  necklace: false,
  lips: '#5a1f1f',
  accent: '#d7263d',
  build: 1,
};

export const LOOKS: Record<CharacterId, Look> = {
  hajj: {
    ...BASE,
    hair: '#d9d4cb',
    brow: '#f6f3ec',
    browSize: 1.6,
    style: 'chechia',
    mustache: { color: '#f6f3ec', shape: 'droopy' },
    glasses: 'round',
    build: 1.05,
  },
  wled: { ...BASE, hair: '#1b1b22', brow: '#1b1b22', style: 'quiff', stubble: true },
  patron: {
    ...BASE,
    hair: '#3a2a20',
    brow: '#1b1b22',
    browSize: 1.35,
    style: 'bald',
    mustache: { color: '#1b1b22', shape: 'handlebar' },
    glasses: 'shades',
    build: 1.2,
  },
  sportif: { ...BASE, hair: '#3a2516', brow: '#3a2516', style: 'cap', earrings: 'stud', accent: '#e63946', build: 0.96 },
  lella: {
    ...BASE,
    style: 'bun',
    browSize: 0.8,
    flower: true,
    earrings: 'gold',
    lashes: true,
    necklace: true,
    lips: '#c2185b',
    build: 0.94,
  },
  hajja: {
    ...BASE,
    hair: '#8a8580',
    brow: '#7d7670',
    browSize: 0.9,
    style: 'scarf',
    glasses: 'round',
    lashes: true,
    lips: '#a33a3a',
    accent: '#7b3fa0',
    build: 1.0,
  },
  taleba: {
    ...BASE,
    hair: '#4a2c1d',
    brow: '#3a2216',
    browSize: 0.85,
    style: 'curls',
    glasses: 'big',
    earrings: 'stud',
    lashes: true,
    lips: '#b5485d',
    build: 0.93,
  },
  nejma: {
    ...BASE,
    hair: '#6b3e26',
    brow: '#4a2c1d',
    browSize: 0.8,
    style: 'long',
    shadesOnHead: true,
    earrings: 'hoop',
    lashes: true,
    necklace: true,
    lips: '#e0245e',
    build: 0.93,
  },
};

const OUT = 0.035;
const GOLD = '#f2c14e';

function sphere(r: number, color: THREE.ColorRepresentation, seg = 24, outline = OUT): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), toon(color));
  m.castShadow = true;
  if (outline > 0) addOutline(m, outline);
  return m;
}

function basic(color: THREE.ColorRepresentation, opts: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
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

/** Polka-dot fabric for the grandma's headscarf. */
function scarfTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 64);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 3 === 0 ? '#ffd23f' : '#fff6e6';
      ctx.beginPath();
      ctx.arc(x * 16 + (y % 2 ? 8 : 0) + 4, y * 16 + 8, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 3);
  return tex;
}

export interface AvatarStyle {
  character: CharacterId;
  /** Index into SKIN_TONES. */
  skin: number;
  /** Shirt colour. */
  color: string;
  /** Sit on a café chair (portraits leave it out). */
  chair?: boolean;
}

export class Avatar {
  readonly root = new THREE.Group();
  /** Where held cards are attached (in front of the chest). */
  readonly handAnchor = new THREE.Group();
  /** Just in front of the lips: where a cup's rim or the chicha's mouthpiece goes. */
  readonly mouthAnchor = new THREE.Object3D();
  /** The left hand (it holds the chicha's hose). */
  readonly leftHand: THREE.Object3D;
  readonly character: CharacterId;
  private body: THREE.Group;
  private head: THREE.Group;
  private mouth: THREE.Mesh;
  private smile: THREE.Mesh;
  private eyes: THREE.Group[] = [];
  private cheeks: THREE.Mesh[] = [];
  private armL: THREE.Group;
  private armR: THREE.Group;
  private shirtMat: THREE.MeshToonMaterial;
  private skinMats: THREE.MeshToonMaterial[] = [];
  private allMats: THREE.Material[] = [];
  /** The avatar's own meshes (not the cards it may be holding). */
  private ownMeshes: THREE.Mesh[] = [];
  private blinkAt = 0;
  private talk = 0;
  private talkTarget = 0;
  private headYaw = 0;
  private headYawTarget = 0;
  private bobPhase = Math.random() * Math.PI * 2;
  private hop = 0;
  private armsUp = 0;
  private sip = 0;
  private sipTarget = 0;
  private puff = 0;
  private puffTarget = 0;
  private faded = false;

  constructor(style: AvatarStyle) {
    this.character = style.character;
    const L = LOOKS[style.character] ?? LOOKS.wled;
    const skin = SKIN_TONES[style.skin] ?? SKIN_TONES[0];
    const skinMat = () => {
      const m = toon(skin);
      this.skinMats.push(m);
      return m;
    };
    const skinSphere = (r: number, seg: number, outline: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), skinMat());
      m.castShadow = true;
      if (outline > 0) addOutline(m, outline);
      return m;
    };
    this.shirtMat = toon(style.color);

    if (style.chair !== false) this.root.add(buildChair());

    // Body.
    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 1.5, 8, 20), this.shirtMat);
    torso.position.y = -0.55;
    torso.scale.set(1.08 * L.build, 1, 0.82 * (0.85 + 0.15 * L.build));
    torso.castShadow = true;
    addOutline(torso, OUT);
    this.body.add(torso);
    if (L.necklace) {
      const necklace = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 8, 28), toon(GOLD));
      necklace.rotation.x = Math.PI / 2 - 0.25;
      necklace.position.set(0, 0.86, -0.1);
      necklace.scale.set(1.1, 1, 1);
      this.body.add(necklace);
      const pendant = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), toon(GOLD));
      pendant.position.set(0, 0.62, -0.64);
      this.body.add(pendant);
    } else if (L.style !== 'scarf') {
      // Shirt collar.
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 20), toon('#ffffff'));
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.92;
      collar.scale.set(1.1, 0.9, 1);
      this.body.add(collar);
    }
    this.root.add(this.body);

    // Arms reaching forward to hold the cards.
    const hands: THREE.Mesh[] = [];
    const makeArm = (side: number) => {
      const arm = new THREE.Group();
      arm.position.set(side * 1.08 * L.build, 0.55, -0.1);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 6, 12), this.shirtMat);
      upper.position.set(0, -0.2, -0.6);
      upper.rotation.x = Math.PI / 2.6;
      upper.castShadow = true;
      addOutline(upper, 0.03);
      arm.add(upper);
      const hand = skinSphere(0.33, 14, 0.03);
      hand.position.set(-side * 0.25, -0.55, -1.35);
      arm.add(hand);
      hands.push(hand);
      this.body.add(arm);
      return arm;
    };
    this.armL = makeArm(-1);
    this.armR = makeArm(1);
    this.leftHand = hands[0]!;

    this.handAnchor.position.set(0, 0.25, -1.75);
    this.body.add(this.handAnchor);

    // Head.
    this.head = new THREE.Group();
    this.head.position.y = 2.25;
    const skull = skinSphere(1.18, 32, OUT);
    skull.scale.set(1, 0.96, 0.96);
    this.head.add(skull);
    for (const s of [-1, 1]) {
      const ear = skinSphere(0.26, 12, 0.025);
      ear.position.set(s * 1.13, -0.05, 0.05);
      ear.scale.set(0.6, 1, 0.9);
      this.head.add(ear);
    }

    const face = new THREE.Group();
    face.position.z = -1.0;
    this.head.add(face);
    this.mouthAnchor.position.set(0, -0.42, -0.2);
    face.add(this.mouthAnchor);

    // Eyes, lashes and brows.
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.4, 0.15, -0.08);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), toon('#ffffff'));
      white.scale.set(0.9, 1.15, 0.5);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), basic('#1d1b2e'));
      pupil.position.set(0, -0.02, -0.08);
      pupil.scale.set(1, 1.15, 0.5);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), basic('#ffffff'));
      shine.position.set(s * -0.04 + 0.04, 0.05, -0.15);
      eye.add(white, pupil, shine);
      if (L.lashes) {
        const lashMat = basic('#1d1b2e');
        for (const [dx, dy, tilt] of [
          [0.13, 0.17, Math.PI / 4],
          [0.04, 0.23, Math.PI / 9],
        ] as const) {
          const lash = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.09, 3, 6), lashMat);
          lash.position.set(s * dx, dy, -0.06);
          lash.rotation.z = -s * tilt;
          eye.add(lash);
        }
      }
      face.add(eye);
      this.eyes.push(eye);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.05 * L.browSize, 0.22 * Math.sqrt(L.browSize), 4, 8), basic(L.brow));
      brow.rotation.z = Math.PI / 2 + s * 0.15;
      brow.position.set(s * 0.42, 0.48 + (L.browSize - 1) * 0.04, -0.05);
      face.add(brow);
    }
    // Cheeks.
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), basic('#ff8f8f', { transparent: true, opacity: 0.55 }));
      cheek.scale.set(1.2, 0.7, 0.3);
      cheek.position.set(s * 0.68, -0.18, 0.12);
      face.add(cheek);
      this.cheeks.push(cheek);
    }
    // Nose.
    const nose = skinSphere(0.17, 12, 0.02);
    nose.position.set(0, -0.08, -0.2);
    nose.scale.set(1, 0.9, 1.1);
    face.add(nose);
    // Mouth: a smile arc when quiet, an open mouth when talking (or blowing smoke).
    this.smile = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 6, 16, Math.PI), basic(L.lips));
    this.smile.rotation.z = Math.PI;
    this.smile.position.set(0, -0.36, -0.02);
    face.add(this.smile);
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), basic('#5a1f1f'));
    this.mouth.position.set(0, -0.45, 0.02);
    this.mouth.scale.set(1.1, 0.05, 0.4);
    this.mouth.visible = false;
    face.add(this.mouth);

    if (L.stubble) {
      // Two days without a razor: a soft shadow over the jaw.
      const stubble = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 28, 14, Math.PI * 1.5 - 1.15, 2.3, Math.PI * 0.56, Math.PI * 0.33),
        basic(L.hair, { transparent: true, opacity: 0.26, depthWrite: false }),
      );
      stubble.scale.set(1, 0.96, 0.96);
      this.head.add(stubble);
    }
    if (L.mustache) this.addMustache(face, L.mustache.color, L.mustache.shape);
    if (L.glasses === 'round' || L.glasses === 'big') {
      const big = L.glasses === 'big';
      const gMat = basic(big ? '#7a2e1f' : '#1d1b2e');
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(big ? 0.29 : 0.25, big ? 0.05 : 0.035, 6, 20), gMat);
        ring.position.set(s * 0.4, 0.15, -0.22);
        face.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), gMat);
      bridge.rotation.z = Math.PI / 2;
      bridge.position.set(0, 0.2, -0.24);
      face.add(bridge);
    } else if (L.glasses === 'shades') {
      const shades = this.shades();
      shades.position.set(0, 0.16, -0.22);
      face.add(shades);
    }

    this.addHair(L);
    this.addEarrings(L);

    this.root.add(this.head);
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      this.ownMeshes.push(o);
      if (o.name !== 'outline') {
        const m = o.material as THREE.Material;
        if (!this.allMats.includes(m)) this.allMats.push(m);
      }
    });
    this.blinkAt = performance.now() + 1500 + Math.random() * 3000;
  }

  private addMustache(face: THREE.Group, color: string, shape: 'droopy' | 'handlebar') {
    const mat = basic(color);
    const handlebar = shape === 'handlebar';
    for (const s of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.CapsuleGeometry(handlebar ? 0.1 : 0.12, handlebar ? 0.4 : 0.36, 4, 10), mat);
      // Handlebar ends curl up, the old man's droop.
      half.rotation.z = Math.PI / 2 + s * (handlebar ? 0.28 : -0.45);
      half.position.set(s * (handlebar ? 0.25 : 0.22), handlebar ? -0.24 : -0.27, -0.12);
      face.add(half);
      if (handlebar) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat);
        tip.position.set(s * 0.5, -0.1, -0.08);
        face.add(tip);
      }
    }
    const middle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), mat);
    middle.scale.set(1.3, 0.75, 0.8);
    middle.position.set(0, -0.22, -0.16);
    face.add(middle);
  }

  private shades(): THREE.Group {
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

  private addHair(L: Look) {
    const head = this.head;
    switch (L.style) {
      case 'chechia': {
        const hat = new THREE.Group();
        const felt = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.75, 28), toon('#d7263d'));
        felt.castShadow = true;
        addOutline(felt, 0.03);
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.78, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon('#d7263d'));
        top.scale.y = 0.18;
        top.position.y = 0.37;
        hat.add(felt, top);
        const tassel = new THREE.Group();
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), basic('#1d1b2e'));
        cord.position.set(0.3, 0.32, 0);
        cord.rotation.z = -1.1;
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 8), basic('#1d1b2e'));
        tuft.position.set(0.55, 0.05, 0);
        tassel.add(cord, tuft);
        tassel.position.y = 0.35;
        hat.add(tassel);
        hat.position.set(0, 0.95, 0.05);
        hat.rotation.z = 0.08;
        head.add(hat);
        // A bit of grey hair under the cap.
        const hair = sphere(1.05, L.hair, 20, 0);
        hair.scale.set(1.05, 0.5, 1.02);
        hair.position.set(0, 0.48, 0.15);
        head.add(hair);
        break;
      }
      case 'quiff': {
        const hair = sphere(1.21, L.hair, 28, OUT);
        hair.scale.set(1.02, 0.62, 1.0);
        hair.position.set(0, 0.5, 0.12);
        head.add(hair);
        const quiff = sphere(0.52, L.hair, 18, OUT);
        quiff.scale.set(1.55, 0.8, 1.05);
        quiff.position.set(0.1, 1.02, -0.6);
        quiff.rotation.set(-0.35, 0, -0.15);
        head.add(quiff);
        break;
      }
      case 'bald': {
        // A horseshoe of hair around the back, and a shiny top.
        const fringe = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.2, 8, 28, Math.PI * 1.25), toon(L.hair));
        fringe.rotation.set(Math.PI / 2, 0, Math.PI / 2 - Math.PI * 0.625);
        fringe.scale.z = 1.5;
        fringe.position.y = 0.02;
        addOutline(fringe, 0.025);
        head.add(fringe);
        const shine = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), basic('#ffffff', { transparent: true, opacity: 0.5 }));
        shine.scale.set(1.5, 0.3, 0.9);
        shine.position.set(-0.3, 1.04, -0.36);
        shine.rotation.set(0.35, 0, 0.3);
        head.add(shine);
        break;
      }
      case 'cap': {
        const hair = sphere(1.2, L.hair, 24, 0);
        hair.scale.set(1.01, 0.6, 1.0);
        hair.position.set(0, 0.45, 0.12);
        head.add(hair);
        const capMat = toon(L.accent);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(1.26, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
        crown.scale.set(1, 0.78, 1.02);
        crown.position.set(0, 0.56, 0.06);
        crown.castShadow = true;
        addOutline(crown, 0.03);
        head.add(crown);
        // Worn backwards: the peak sticks out behind.
        const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.07, 24, 1, false, -Math.PI / 2, Math.PI), capMat);
        peak.position.set(0, 0.6, 0.86);
        peak.rotation.x = 0.18;
        addOutline(peak, 0.025);
        head.add(peak);
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), toon('#ffffff'));
        button.position.set(0, 1.55, 0.06);
        head.add(button);
        // Hair peeking out of the strap opening at the front.
        const tuft = sphere(0.24, L.hair, 12, 0.02);
        tuft.scale.set(1.5, 0.7, 0.7);
        tuft.position.set(0, 0.72, -1.1);
        head.add(tuft);
        break;
      }
      case 'bun': {
        const hair = sphere(1.22, L.hair, 28, OUT);
        hair.scale.set(1.0, 0.75, 1.0);
        hair.position.set(0, 0.42, 0.12);
        head.add(hair);
        const bun = sphere(0.5, L.hair, 16, OUT);
        bun.position.set(0, 1.25, 0.45);
        head.add(bun);
        break;
      }
      case 'scarf': {
        const mat = toon('#ffffff', { map: scarfTexture(L.accent), side: THREE.DoubleSide });
        const w = 0.72; // half-width of the face opening (radians around the head)
        const front = Math.PI * 1.5; // the face looks down −Z
        const pieces = [
          // Back and sides, from the crown down under the jaw.
          new THREE.SphereGeometry(1.31, 36, 22, front + w - Math.PI * 2, Math.PI * 2 - 2 * w, 0, Math.PI * 0.86),
          // Over the forehead.
          new THREE.SphereGeometry(1.31, 16, 8, front - w, 2 * w, 0, Math.PI * 0.3),
          // Under the chin.
          new THREE.SphereGeometry(1.31, 16, 6, front - w, 2 * w, Math.PI * 0.79, Math.PI * 0.07),
        ];
        for (const geo of pieces) {
          const m = new THREE.Mesh(geo, mat);
          m.scale.set(1.02, 1, 1);
          m.castShadow = true;
          addOutline(m, 0.03);
          head.add(m);
        }
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat);
        knot.position.set(0.55, -1.0, -0.62);
        addOutline(knot, 0.025);
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.45, 4, 10), mat);
        tail.position.set(0.68, -1.38, -0.5);
        tail.rotation.z = 0.35;
        addOutline(tail, 0.025);
        head.add(knot, tail);
        break;
      }
      case 'curls': {
        const hair = sphere(1.27, L.hair, 28, OUT);
        hair.scale.set(1.08, 0.78, 1.08);
        hair.position.set(0, 0.5, 0.18);
        head.add(hair);
        // A cloud of curls all around, leaving the face free.
        const rings: [number, number, number][] = [
          [0.15, 9, 0.62],
          [0.62, 7, 0.0],
          [1.1, 4, 0.4],
        ];
        for (const [elev, count, offset] of rings) {
          for (let i = 0; i < count; i++) {
            const a = offset + (i / count) * Math.PI * 2;
            // Skip the front of the lowest ring (that is where the face is).
            if (elev < 0.3 && Math.cos(a) < -0.45) continue;
            const curl = sphere(0.36 + (i % 2) * 0.05, L.hair, 12, 0.025);
            curl.position.set(Math.sin(a) * Math.cos(elev) * 1.22, 0.55 + Math.sin(elev) * 0.95, 0.18 + Math.cos(a) * Math.cos(elev) * 1.22);
            head.add(curl);
          }
        }
        break;
      }
      case 'long': {
        const hair = sphere(1.24, L.hair, 28, OUT);
        hair.scale.set(1.03, 0.74, 1.03);
        hair.position.set(0, 0.45, 0.12);
        head.add(hair);
        const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.98, 1.4, 8, 18), toon(L.hair));
        back.scale.set(1.12, 1, 0.62);
        back.position.set(0, -0.55, 0.45);
        back.castShadow = true;
        addOutline(back, OUT);
        head.add(back);
        for (const s of [-1, 1]) {
          const strand = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 1.2, 6, 12), toon(L.hair));
          strand.position.set(s * 1.02, -0.42, -0.2);
          strand.rotation.z = s * 0.08;
          addOutline(strand, 0.025);
          head.add(strand);
        }
        const bangs = sphere(0.62, L.hair, 18, 0.025);
        bangs.scale.set(1.7, 0.55, 0.85);
        bangs.position.set(-0.28, 0.84, -0.82);
        bangs.rotation.z = 0.32;
        head.add(bangs);
        break;
      }
    }
    if (L.shadesOnHead) {
      const shades = this.shades();
      shades.position.set(0, 1.14, -0.98);
      shades.rotation.x = 0.85;
      head.add(shades);
    }
    if (L.flower) {
      // Jasmine behind the ear.
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
      head.add(flower);
    }
  }

  private addEarrings(L: Look) {
    if (!L.earrings) return;
    for (const s of [-1, 1]) {
      let ring: THREE.Mesh;
      if (L.earrings === 'stud') {
        ring = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), toon(GOLD));
        ring.position.set(s * 1.17, -0.27, 0.02);
      } else {
        const hoop = L.earrings === 'hoop';
        ring = new THREE.Mesh(new THREE.TorusGeometry(hoop ? 0.17 : 0.1, hoop ? 0.032 : 0.03, 6, hoop ? 18 : 12), toon(GOLD));
        ring.position.set(s * (hoop ? 1.15 : 1.13), hoop ? -0.5 : -0.4, 0.02);
        ring.rotation.y = Math.PI / 2;
      }
      this.head.add(ring);
    }
  }

  setColor(color: string) {
    this.shirtMat.color.set(color);
  }

  /** Mouth opening driven by voice level (0..1). */
  setTalking(level: number) {
    this.talkTarget = Math.min(1, level);
  }

  /** Raises the left hand to the lips (cup or chicha hose) and closes the eyes with delight. */
  setSipping(on: boolean) {
    this.sipTarget = on ? 1 : 0;
  }

  /** Round "o" mouth while blowing out chicha smoke. */
  setBlowing(on: boolean) {
    this.puffTarget = on ? 1 : 0;
  }

  /** Centre of the head, in world space. */
  headCenter(out = new THREE.Vector3()): THREE.Vector3 {
    return this.head.getWorldPosition(out);
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
      // Remember each material's own look (cheeks and stubble are see-through already).
      const base = m.userData as { transparent?: boolean; opacity?: number };
      base.transparent ??= m.transparent;
      base.opacity ??= m.opacity;
      m.transparent = faded || base.transparent;
      m.opacity = faded ? Math.min(base.opacity, 0.45) : base.opacity;
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
    this.sip += (this.sipTarget - this.sip) * Math.min(1, dt * 7);
    this.puff += (this.puffTarget - this.puff) * Math.min(1, dt * 10);
    const sip = this.sip;
    // While drinking, look at the cup rather than at the table.
    this.head.rotation.y = this.headYaw * (1 - sip) + Math.sin(time * 0.6 + this.bobPhase) * 0.05;
    this.head.rotation.z = Math.sin(time * 0.9 + this.bobPhase) * 0.03;

    // Blink (and close the eyes with delight while sipping).
    const now = performance.now();
    let eyeScale = 1;
    if (now > this.blinkAt) {
      const k = (now - this.blinkAt) / 140;
      eyeScale = k < 1 ? Math.abs(1 - k * 2) * 0.9 + 0.1 : 1;
      if (k >= 1) this.blinkAt = now + 2200 + Math.random() * 3500;
    }
    eyeScale = Math.min(eyeScale, 1 - sip * 0.85);
    for (const e of this.eyes) e.scale.y = eyeScale;
    for (const c of this.cheeks) c.scale.set(1.2 + sip * 0.25, 0.7 + sip * 0.2, 0.3);

    // Talking (or smoke-blowing) mouth.
    this.talk += (this.talkTarget - this.talk) * Math.min(1, dt * 18);
    const blow = this.puff;
    const open = this.talk > 0.04 || blow > 0.05;
    this.mouth.visible = open;
    this.smile.visible = !open;
    if (blow > 0.05) this.mouth.scale.set(0.55 + blow * 0.05, 0.12 + blow * 0.45, 0.4);
    else this.mouth.scale.set(1.1, 0.08 + this.talk * 0.75, 0.4);
    // Head tips back a little to drink.
    this.head.rotation.x = (open && blow < 0.05 ? -this.talk * 0.06 : 0) + sip * 0.18;

    // Arms: cheering raises both, sipping brings the left hand to the mouth.
    const up = this.armsUp;
    // (Sipping angles bring the hand just under the cup, in front of the chin.)
    this.armL.rotation.x = -up * 1.9 + sip * 1.1;
    this.armR.rotation.x = -up * 1.9;
    this.armL.rotation.z = up * 0.4;
    this.armR.rotation.z = -up * 0.4;
    this.armL.rotation.y = -sip * 0.28;
  }

  /** Frees GPU resources (shared outline materials are kept). */
  dispose() {
    const mats = new Set<THREE.Material>();
    for (const o of this.ownMeshes) {
      o.geometry.dispose();
      const m = o.material as THREE.Material;
      if (!(m instanceof THREE.ShaderMaterial)) mats.add(m);
    }
    for (const m of mats) {
      (m as THREE.MeshToonMaterial).map?.dispose();
      m.dispose();
    }
  }
}
