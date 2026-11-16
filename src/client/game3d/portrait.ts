/**
 * A small second renderer for the café menu: character portraits, drink pictures, and a live
 * preview of "you" (your character, skin, shirt and order) that sips when you tap it.
 */
import * as THREE from 'three';
import { AVATAR_COLORS, type CharacterId, type DrinkId, isCrew } from '../../shared/protocol';
import { CREW_PORTRAITS } from '../crewPortraits';
import { Avatar } from './avatar';
import { DrinkProp, avatarDrinker, performSip } from './drinks';
import { FLOOR_Y } from './environment';
import { Smoke } from './fx';
import { toon } from './materials';

/** Square render size in pixels (portraits are copied out at THUMB). */
const SIZE = 288;
const THUMB = 128;

export interface Persona {
  character: CharacterId;
  skin: number;
  color: number;
  drink: DrinkId;
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight('#d7ecff', '#f2c89b', 1.55));
  const sun = new THREE.DirectionalLight('#fff0d9', 2.4);
  sun.position.set(-6, 10, -9);
  const fill = new THREE.DirectionalLight('#ffd7f0', 0.5);
  fill.position.set(8, 4, -4);
  scene.add(sun, fill);
}

export class PortraitStudio {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private failed = false;
  private camera = new THREE.PerspectiveCamera(24, 1, 0.1, 200);
  private thumbScene = new THREE.Scene();
  private liveScene = new THREE.Scene();
  private liveCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private copy = document.createElement('canvas');
  private urls = new Map<string, string>();
  private smoke: Smoke;
  private persona: Persona | null = null;
  private avatar: Avatar | null = null;
  private drink: DrinkProp | null = null;
  private avatarKey = '';
  private nextIdleSip = 5;
  private sipping = false;
  /** Plays a sip sound (resolves with its length in seconds once it starts). */
  sound: ((drink: DrinkId) => Promise<number>) | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cafe-canvas';
    this.canvas.width = this.canvas.height = SIZE;
    this.copy.width = this.copy.height = THUMB;
    addLights(this.thumbScene);
    addLights(this.liveScene);
    this.smoke = new Smoke(this.liveScene, 40);
    // A little café table in front of you.
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.2, 40), toon('#1f5ea8'));
    top.position.set(-0.9, -0.1, -3.4);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.12, 8, 48), toon('#9a5f37'));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(-0.9, -0.02, -3.4);
    this.liveScene.add(top, rim);
    this.liveCamera.position.set(-3.6, 4.4, -11.2);
    this.liveCamera.lookAt(-0.9, 1.55, -0.6);
  }

  private gl(): THREE.WebGLRenderer | null {
    if (this.renderer || this.failed) return this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(SIZE, SIZE, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NeutralToneMapping;
      this.renderer.toneMappingExposure = 1.05;
    } catch {
      this.failed = true;
    }
    return this.renderer;
  }

  /** Renders `obj` framed by `frame` and returns it as an image URL (null without WebGL). */
  private snapshot(obj: THREE.Object3D, frame: (cam: THREE.PerspectiveCamera) => void): string | null {
    const r = this.gl();
    if (!r) return null;
    this.thumbScene.add(obj);
    frame(this.camera);
    this.camera.updateProjectionMatrix();
    r.render(this.thumbScene, this.camera);
    const ctx = this.copy.getContext('2d')!;
    ctx.clearRect(0, 0, THUMB, THUMB);
    ctx.drawImage(this.canvas, 0, 0, THUMB, THUMB);
    this.thumbScene.remove(obj);
    // Put the live preview back before the browser shows the canvas.
    if (this.visible()) this.renderLive();
    return this.copy.toDataURL('image/png');
  }

  /** Head-and-shoulders portrait of a character (the crew have their own pictures). */
  characterURL(character: CharacterId, skin: number, color: number): string | null {
    if (isCrew(character)) return CREW_PORTRAITS[character];
    const key = `c|${character}|${skin}|${color}`;
    const hit = this.urls.get(key);
    if (hit) return hit;
    const av = new Avatar({ character, skin, color: AVATAR_COLORS[color] ?? AVATAR_COLORS[0], chair: false });
    av.root.rotation.y = 0.32;
    av.update(0, 0);
    const url = this.snapshot(av.root, (cam) => {
      cam.fov = 24;
      cam.position.set(1.3, 2.75, -8.2);
      cam.lookAt(0, 2.35, 0);
    });
    av.dispose();
    if (url) this.urls.set(key, url);
    return url;
  }

  /** Picture of a drink for the café menu. */
  drinkURL(id: DrinkId): string | null {
    const key = `d|${id}`;
    const hit = this.urls.get(key);
    if (hit) return hit;
    const prop = new DrinkProp(id);
    prop.root.rotation.y = -0.5;
    prop.root.updateMatrixWorld(true);
    // Frame the visible parts (the click target is bigger than the drink).
    prop.hit.removeFromParent();
    const box = new THREE.Box3().setFromObject(prop.root);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const url = this.snapshot(prop.root, (cam) => {
      cam.fov = 24;
      const dist = (Math.max(size.x, size.y, size.z) * 0.52) / Math.tan(THREE.MathUtils.degToRad(12));
      cam.position.set(centre.x, centre.y + dist * 0.36, centre.z - dist);
      cam.lookAt(centre);
    });
    prop.root.add(prop.hit);
    prop.dispose();
    if (url) this.urls.set(key, url);
    return url;
  }

  // ─────────────────────────────── live preview ───────────────────────────────

  /** Shows `p` in the live preview; a new order is tasted right away (with its sound). */
  setPersona(p: Persona) {
    const prev = this.persona;
    this.persona = { ...p };
    const key = `${p.character}|${p.skin}`;
    if (key !== this.avatarKey || !this.avatar) {
      this.avatar?.root.removeFromParent();
      this.avatar?.dispose();
      this.avatar = new Avatar({ character: p.character, skin: p.skin, color: AVATAR_COLORS[p.color] ?? AVATAR_COLORS[0] });
      this.avatar.root.position.y = 0.35;
      this.avatar.root.rotation.y = 0.12;
      this.avatarKey = key;
      this.liveScene.add(this.avatar.root);
    }
    this.avatar.setColor(AVATAR_COLORS[p.color] ?? AVATAR_COLORS[0]);
    if (!this.drink || this.drink.kind !== p.drink) {
      this.drink?.dispose();
      const d = new DrinkProp(p.drink);
      if (p.drink === 'chicha') {
        d.root.position.set(-3.0, FLOOR_Y, -1.2);
        d.root.rotation.y = 1.0;
        d.restAnchor = (out) => this.avatar?.leftHand.getWorldPosition(out) ?? null;
      } else {
        d.root.position.set(-1.7, 0, -2.75);
        d.root.rotation.y = 0.5;
      }
      this.liveScene.add(d.root);
      this.drink = d;
      if (prev && prev.drink !== p.drink) void this.sip(true);
    }
  }

  private visible(): boolean {
    return this.canvas.isConnected && this.canvas.offsetParent !== null;
  }

  /** Sip from the preview (with sound when the player asked for it). */
  async sip(withSound: boolean) {
    const prop = this.drink;
    const av = this.avatar;
    if (!prop || !av || this.sipping || prop.busy) return;
    this.sipping = true;
    this.nextIdleSip = 7 + Math.random() * 5;
    try {
      await performSip({
        prop,
        drinker: avatarDrinker(av),
        smoke: this.smoke,
        sound: () => (withSound && this.sound ? this.sound(prop.kind) : Promise.resolve(1.3)),
        alive: () => this.drink === prop && this.avatar === av,
      });
    } finally {
      this.sipping = false;
    }
  }

  private renderLive() {
    const r = this.gl();
    if (r) r.render(this.liveScene, this.liveCamera);
  }

  /** Called every frame by the main loop: animates and draws the preview while it is on screen. */
  frame(dt: number, time: number) {
    if (!this.persona || !this.visible()) return;
    this.avatar?.update(dt, time);
    this.drink?.update(dt, time, this.smoke);
    this.smoke.update(dt);
    this.nextIdleSip -= dt;
    if (this.nextIdleSip <= 0) void this.sip(false);
    this.renderLive();
  }
}
