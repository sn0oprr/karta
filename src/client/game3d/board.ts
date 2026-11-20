/**
 * Board controller: turns room snapshots and game events into a living 3D table.
 */
import * as THREE from 'three';
import { type Card, type Suit, parseCard } from '../../shared/cards';
import { captureOptions } from '../../shared/chkobba';
import {
  type AuctionAction,
  type BeloteRoundResult,
  type Coinche,
  type Contract,
  illegalReason,
  legalCards,
  parseBeloteCard,
  sortBeloteHand,
} from '../../shared/belote';
import {
  AVATAR_COLORS,
  type BeloteContractEvent,
  type BeloteDealEvent,
  type BelotePlayEvent,
  type BeloteTrickEvent,
  type BeloteView,
  type CharacterId,
  type DrinkId,
  type GameEvent,
  type GameKind,
  type PlayerInfo,
  type PlayRequest,
  type RoomMessage,
  type RoomView,
} from '../../shared/protocol';
import { Avatar, buildChair } from './avatar';
import { CARD_H, CARD_T, CARD_W, CardObject, CardStack } from './cardMesh';
import { DrinkProp, type Drinker, avatarDrinker, performSip } from './drinks';
import { Confetti, Shockwave, Smoke } from './fx';
import {
  BELOTE_CARD_EXTENT,
  HAND_DEPTH,
  TABLE_CARD_SCALE,
  TABLE_SLOTS,
  avatarPosition,
  chichaPosition,
  deckPosition,
  deckYaw,
  drinkPosition,
  heldCardTransform,
  myHandRect,
  myHandTransform,
  pilePosition,
  trickSlot,
  trumpTokenPosition,
  viewDir,
  viewRight,
  viewYaw,
} from './layout';
import type { Stage } from './stage';
import { FELT_HALF, FRAME_HALF, FRAME_MID, FRAME_TOP, TABLE_EXTENT, tableEdgePoints } from './table';
import { TrumpToken } from './trumpToken';
import { animator, ease, flatQuat, moveObject, standQuat, wait } from './tween';
import { type Ball, type Pt2, type Pt3, type Rect, fitSeatView, seatViewRanges } from './viewFit';

export interface BoardCallbacks {
  /** The local player wants to play a card. Resolve false if the server refused it. */
  onPlay: (move: PlayRequest) => Promise<boolean>;
  /** Several captures are possible: show a chooser; return the chosen option index or null. */
  chooseCapture: (card: Card, options: Card[][]) => Promise<number | null>;
  onChkobba: (seat: number) => void;
  onRoundEnd: (room: RoomView) => void;
  /** Called after each processed message with the room as currently displayed. */
  onDisplayed: (room: RoomView) => void;
  sfx: (name: SfxName) => void;
  onInvalid: (reason: string) => void;
  /** The local player sipped their drink (tell the table). */
  onSip: () => void;
  /** Plays one sip of `drink` (pan −1…1); resolves with its length in seconds once it starts. */
  drinkSound: (drink: DrinkId, pan: number) => Promise<number>;
  /** Belote: a call in the auction (bid, pass, contre or surcontre). */
  onBid: (action: AuctionAction) => void;
  /** Belote: the auction is over. */
  onContract: (contract: Contract, coinche: Coinche) => void;
  /** Belote: "Belote!" or "Rebelote!" with the King or Queen of trumps. */
  onBelote: (seat: number, word: 'belote' | 'rebelote') => void;
  /** Belote: everybody passed; the cards are dealt again. */
  onRedeal: () => void;
  /** Belote: the last trick is in (the results follow). */
  onBeloteEnd: (result: BeloteRoundResult) => void;
}

/** The home screen's regulars: who they are and what they drink. */
const MENU_GUESTS: { character: CharacterId; skin: number; drink: DrinkId }[] = [
  { character: 'hajj', skin: 1, drink: 'chicha' },
  { character: 'nejma', skin: 3, drink: 'boga' },
  { character: 'wled', skin: 2, drink: 'tea' },
  { character: 'hajja', skin: 0, drink: 'express' },
];

export type SfxName = 'deal' | 'lay' | 'capture' | 'chkobba' | 'flip' | 'hover' | 'select' | 'myTurn' | 'shuffle' | 'sweep';

type CameraMode = 'menu' | 'seat';

const AVATAR_SCALE = 0.88;
const HELD_SCALE = 0.62;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/**
 * Everywhere a Chkobba table card can lie: the outline around every slot's card (a little margin
 * included). The slots make a cross, wide in the middle and narrow toward the near and far rows, so
 * the outline is much narrower than its bounding box where it comes closest to the camera.
 */
const CHKOBBA_AREA: Pt3[] = (() => {
  const hw = (CARD_W * TABLE_CARD_SCALE) / 2 + 0.08;
  const hh = (CARD_H * TABLE_CARD_SCALE) / 2 + 0.08;
  const pts: Pt2[] = [];
  for (const s of TABLE_SLOTS) {
    const c = Math.cos(s.yaw);
    const n = Math.sin(s.yaw);
    for (const [dx, dz] of [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const) {
      pts.push({ x: s.pos.x + dx * c + dz * n, y: s.pos.z - dx * n + dz * c });
    }
  }
  return convexHull(pts).map((p) => ({ x: p.x, y: 0, z: p.y }));
})();

/** Convex hull of points (Andrew's monotone chain), anticlockwise, without collinear points. */
function convexHull(points: Pt2[]): Pt2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt2, a: Pt2, b: Pt2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Where Belote's cards lie on the table: the trick in the middle. */
const BELOTE_AREA: Pt3[] = [
  { x: -BELOTE_CARD_EXTENT.x, y: 0, z: -BELOTE_CARD_EXTENT.z },
  { x: BELOTE_CARD_EXTENT.x, y: 0, z: -BELOTE_CARD_EXTENT.z },
  { x: BELOTE_CARD_EXTENT.x, y: 0, z: BELOTE_CARD_EXTENT.z },
  { x: -BELOTE_CARD_EXTENT.x, y: 0, z: BELOTE_CARD_EXTENT.z },
];

/** Belote deals 4 cards at a time: delay between two lots, and between the cards of a lot (ms). */
const LOT_STEP = 230;
const LOT_CARD_STEP = 35;

/** A ball around a seated avatar's head (ears, hair and hats included; buns and curls stick out back). */
function headBall(view: number, n: number): Ball {
  const c = avatarPosition(view, n).addScaledVector(viewDir(view, n), 0.1 * AVATAR_SCALE);
  return { center: { x: c.x, y: c.y + 2.4 * AVATAR_SCALE, z: c.z }, radius: 1.38 * AVATAR_SCALE };
}

export class Board {
  private stage: Stage;
  private cb: BoardCallbacks;
  readonly group = new THREE.Group();

  // ── view ──
  private n = 2;
  private mySeat: number | null = null;
  /** Seat displayed at the bottom (near the camera). */
  private baseSeat = 0;
  private room: RoomView | null = null;
  private spectatorSeat = 0;

  // ── objects ──
  private avatars: (Avatar | null)[] = [];
  private avatarKeys: (string | null)[] = [];
  private chairs: (THREE.Group | null)[] = [];
  /** Each seat's order (cup on the table, or a chicha beside it). */
  private drinks: (DrinkProp | null)[] = [];
  private drinkKeys: (string | null)[] = [];
  private smoke: Smoke;
  private drinkHovered = false;
  private handGroup = new THREE.Group();
  private myHand: CardObject[] = [];
  private held: CardObject[][] = [];
  private tableCards = new Map<string, CardObject>();
  private slotOf = new Map<string, number>();
  private piles: CardStack[] = [];
  private markers: CardObject[][] = [];
  private deck = new CardStack();
  private turnBar: THREE.Mesh;
  // ── belote ──
  /** The trick in progress, in play order. */
  private trickObjs: { seat: number; obj: CardObject }[] = [];
  private trumpToken = new TrumpToken();
  private confetti: Confetti;
  private shockwave: Shockwave;
  private pool: CardObject[] = [];

  // ── processing ──
  private queue: RoomMessage[] = [];
  private processing = false;
  private animating = false;

  // ── input ──
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private hovered: CardObject | null = null;
  private selected: CardObject | null = null;
  private pending = false;
  private choosing = false;
  private lastPointerType = 'mouse';
  private handLift = new Map<CardObject, number>();
  private previewIds = new Set<string>();

  // ── camera ──
  private cameraMode: CameraMode = 'menu';
  private camPos = new THREE.Vector3(0, 9, 19);
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camFov = 40;
  private camBlend = 1;
  private camFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  private menuAngle = 0.3;

  constructor(stage: Stage, cb: BoardCallbacks) {
    this.stage = stage;
    this.cb = cb;
    stage.scene.add(this.group);
    stage.camera.add(this.handGroup);
    this.group.add(this.deck.root);

    // A glowing bar lying along the frame on the side of the player whose turn it is.
    const barMat = new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.9, toneMapped: false });
    this.turnBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, FELT_HALF * 1.3, 4, 12), barMat);
    this.turnBar.visible = false;
    this.group.add(this.turnBar);
    this.group.add(this.trumpToken.root);

    this.confetti = new Confetti(stage.scene);
    this.shockwave = new Shockwave(stage.scene);
    this.smoke = new Smoke(stage.scene);

    stage.onFrame((dt, t) => this.update(dt, t));
    stage.onResize(() => {
      if (this.cameraMode === 'seat') this.setCamera('seat', true);
      this.layoutHand(false);
    });
    // The HUD changed shape (the scoreboard appeared, fonts loaded…): glide to a new framing.
    stage.onLayout(() => {
      if (this.cameraMode === 'seat') this.setCamera('seat');
    });
    this.setupInput();
    this.showDecorativeDeck();
  }

  // ═══════════════════════════════ public API ═══════════════════════════════

  push(msg: RoomMessage) {
    this.queue.push(msg);
    if (!this.processing) void this.processQueue();
  }

  /** Home screen: slow orbit around a table where four friends are mid-game. */
  showMenu() {
    this.room = null;
    this.queue = [];
    this.clearAll();
    this.syncAvatars(null);
    this.syncDrinks(null);
    this.setupMenuScene();
    this.setCamera('menu');
  }

  private setupMenuScene() {
    const n = 4;
    this.n = n;
    this.baseSeat = 0;
    this.mySeat = null;
    const palette = [0, 5, 2, 3];
    for (let s = 0; s < n; s++) {
      const guest = MENU_GUESTS[s]!;
      const av = new Avatar({ character: guest.character, skin: guest.skin, color: AVATAR_COLORS[palette[s]!]! });
      av.root.position.copy(avatarPosition(s, n));
      av.root.rotation.y = viewYaw(s, n);
      av.root.scale.setScalar(AVATAR_SCALE);
      av.lookAt(new THREE.Vector3(0, 0, 0));
      this.group.add(av.root);
      this.avatars[s] = av;
      this.avatarKeys[s] = `menu-${s}`;
      this.placeDrink(s, guest.drink, `menu-${s}`, false);
      this.held[s] = [];
      for (let i = 0; i < 3; i++) {
        const c = this.take(null);
        c.role = 'held';
        av.handAnchor.add(c.root);
        this.held[s]!.push(c);
      }
      this.layoutHeld(s, false);
    }
    ['7D', '10H', '3C', '1S', '9D'].forEach((id, i) => {
      const c = this.take(id);
      c.role = 'table';
      this.group.add(c.root);
      this.tableCards.set(id, c);
      this.slotOf.set(id, i);
      const t = this.tableTransform(i);
      c.root.position.copy(t.pos);
      c.root.quaternion.copy(t.quat);
      c.root.scale.setScalar(t.scale);
    });
    this.deck.root.position.copy(deckPosition(1, n));
    this.deck.root.rotation.y = deckYaw(1, n);
    this.deck.setCount(16);
    for (let s = 0; s < n; s++) {
      this.piles[s] ??= (() => {
        const p = new CardStack();
        this.group.add(p.root);
        return p;
      })();
      this.piles[s]!.root.position.copy(pilePosition(s, n));
      this.piles[s]!.root.rotation.y = viewYaw(s, n) + 0.12;
      this.piles[s]!.setCount([5, 9, 3, 7][s]!);
    }
    this.menuCheer = 0;
  }

  private menuCheer = 0;

  /** Spectators can rotate around the table. */
  rotateSpectatorView(step: number) {
    if (this.mySeat !== null || !this.room) return;
    this.spectatorSeat = (this.spectatorSeat + step + this.n) % this.n;
    this.applyRoom(this.room, true);
  }

  get isAnimating() {
    return this.animating || this.processing;
  }

  /**
   * Screen box (CSS px) around a seat's head, which its DOM name tag is placed around. Null for
   * the local player, or when the head is behind the camera.
   */
  seatHeadRect(seat: number): Rect | null {
    if (!this.room || seat >= this.n || seat === this.mySeat) return null;
    const cam = this.stage.camera;
    const { center, radius } = headBall(this.viewOf(seat), this.n);
    const depth = -tmpV.set(center.x, center.y, center.z).applyMatrix4(cam.matrixWorldInverse).z;
    const p = this.stage.project(tmpV2.set(center.x, center.y, center.z), tmpV2);
    if (p.z > 1 || depth <= 0) return null;
    const r = (radius / (depth * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))) * 0.5 * this.stage.height;
    return { left: p.x - r, top: p.y - r, right: p.x + r, bottom: p.y + r };
  }

  avatarFor(seat: number): Avatar | null {
    return this.avatars[seat] ?? null;
  }

  /** Mouth animation from voice levels. */
  setTalking(seat: number, level: number) {
    this.avatars[seat]?.setTalking(level);
  }

  emote(seat: number) {
    this.avatars[seat]?.nod();
  }

  /** Another player at the table sips their drink (the server relays it). */
  sip(seat: number) {
    if (seat !== this.mySeat) void this.playSip(seat, true);
  }

  /** The local player sips: animate right away and tell the others. */
  private sipMine() {
    const seat = this.mySeat;
    const prop = seat === null ? null : this.drinks[seat];
    if (seat === null || !prop || prop.busy) return;
    this.cb.onSip();
    void this.playSip(seat, true);
  }

  private async playSip(seat: number, withSound: boolean) {
    const prop = this.drinks[seat];
    if (!prop || prop.busy || document.hidden) return;
    const firstPerson = seat === this.mySeat;
    const av = firstPerson ? null : (this.avatars[seat] ?? null);
    if (!firstPerson && !av) return;
    const pan = this.panFor(seat);
    await performSip({
      prop,
      drinker: av ? avatarDrinker(av) : this.firstPersonDrinker(prop),
      smoke: this.smoke,
      sound: () => (withSound ? this.cb.drinkSound(prop.kind, pan) : Promise.resolve(1.3)),
      alive: () => this.drinks[seat] === prop && (av ? this.avatars[seat] === av : this.mySeat === seat),
    });
  }

  /**
   * The local player, seen through the camera: a cup rises toward the screen; the chicha's
   * mouthpiece goes to the (unseen) mouth just behind the cards, and the smoke rolls out over the table.
   */
  private firstPersonDrinker(prop: DrinkProp): Drinker {
    const cam = this.stage.camera;
    const restP = new THREE.Vector3();
    const restQ = new THREE.Quaternion();
    const myMouth = (out: THREE.Vector3) => {
      const v = this.viewOf(this.mySeat ?? 0);
      return out.copy(avatarPosition(v, this.n)).addScaledVector(viewDir(v, this.n), -0.4).setY(1.2);
    };
    return {
      avatar: null,
      mouth: (out) => {
        if (prop.kind === 'chicha') return myMouth(out);
        prop.restTransform(restP, restQ);
        return out.lerpVectors(restP, cam.position, 0.46);
      },
      head: (out) => out.copy(cam.position),
      breath: (origin, dir) => {
        const v = this.viewOf(this.mySeat ?? 0);
        myMouth(origin).setY(1.8);
        dir.copy(viewDir(v, this.n)).multiplyScalar(-1).add(new THREE.Vector3(0, 0.3, 0));
      },
    };
  }

  /** Stereo position of a seat, from where it is on screen. */
  private panFor(seat: number): number {
    if (seat === this.mySeat || !this.room) return 0;
    const p = this.stage.project(avatarPosition(this.viewOf(seat), this.n), tmpV2);
    return THREE.MathUtils.clamp((p.x / Math.max(1, this.stage.width)) * 2 - 1, -1, 1) * 0.7;
  }

  // ═══════════════════════════════ processing ═══════════════════════════════

  private async processQueue() {
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const msg = this.queue.shift()!;
        const skip = this.queue.length >= 4 || document.hidden;
        const prev = this.room;
        if (msg.events.length > 0 && prev && !skip) {
          this.animating = true;
          this.clearSelection();
          for (const ev of msg.events) {
            try {
              await this.animateEvent(ev);
            } catch (err) {
              console.error('animation error', err);
            }
          }
          this.animating = false;
        }
        this.applyRoom(msg.room, false);
        this.cb.onDisplayed(msg.room);
        if (msg.events.some((e) => e.kind === 'roundEnd')) this.cb.onRoundEnd(msg.room);
      }
    } finally {
      this.processing = false;
      this.animating = false;
    }
    this.refreshInteractivity();
  }

  private viewOf(seat: number): number {
    return (seat - this.baseSeat + this.n) % this.n;
  }

  /** Snap the scene to the given room state. */
  private applyRoom(room: RoomView, force: boolean) {
    const n = room.seats.length;
    const mySeat = room.you.seat;
    const base = mySeat ?? Math.min(this.spectatorSeat, n - 1);
    const layoutChanged = force || n !== this.n || mySeat !== this.mySeat || base !== this.baseSeat || !this.room;
    this.n = n;
    this.mySeat = mySeat;
    this.baseSeat = base;
    this.room = room;
    if (layoutChanged) this.layoutStatic();
    this.syncAvatars(room);
    this.syncDrinks(room);
    this.syncCards(room, layoutChanged);
    this.syncTurn(room);
    if (this.cameraMode !== 'seat') this.setCamera('seat');
    else if (layoutChanged) this.setCamera('seat', true);
  }

  private layoutStatic() {
    // Piles & markers per seat.
    while (this.piles.length < this.n) {
      const p = new CardStack();
      this.group.add(p.root);
      this.piles.push(p);
    }
    for (let s = 0; s < this.piles.length; s++) {
      const pile = this.piles[s]!;
      if (s >= this.n) {
        pile.setCount(0);
        continue;
      }
      const v = this.viewOf(s);
      pile.root.position.copy(pilePosition(v, this.n));
      pile.root.rotation.y = viewYaw(v, this.n) + 0.12;
    }
    for (let s = 0; s < this.markers.length; s++) for (const m of this.markers[s]!) this.release(m);
    this.markers = Array.from({ length: this.n }, () => []);
  }

  // ═══════════════════════════════ avatars ═══════════════════════════════

  private syncAvatars(room: RoomView | null) {
    const n = room ? room.seats.length : 0;
    for (let s = 0; s < Math.max(n, this.avatars.length); s++) {
      const player: PlayerInfo | null = room && s < n ? (room.seats[s] ?? null) : null;
      const visible = !!player && s !== room!.you.seat;
      // A new character or skin tone means a new avatar.
      const key = player ? `${player.id}|${player.character}|${player.skin}` : null;
      let av = this.avatars[s] ?? null;
      if (!visible || this.avatarKeys[s] !== key) {
        if (this.held[s]) {
          for (const c of this.held[s]!) this.release(c);
          this.held[s] = [];
        }
        if (av) {
          av.root.removeFromParent();
          av.dispose();
          av = null;
        }
        this.avatars[s] = null;
        this.avatarKeys[s] = null;
      }
      // Empty seats show an empty chair waiting for a friend.
      const wantChair = !!room && s < n && !player && s !== room.you.seat;
      if (wantChair && !this.chairs[s]) {
        const chair = buildChair();
        chair.scale.setScalar(AVATAR_SCALE);
        this.group.add(chair);
        this.chairs[s] = chair;
      } else if (!wantChair && this.chairs[s]) {
        this.chairs[s]!.removeFromParent();
        this.chairs[s] = null;
      }
      if (wantChair) {
        const v = this.viewOf(s);
        this.chairs[s]!.position.copy(avatarPosition(v, n));
        this.chairs[s]!.rotation.y = viewYaw(v, n);
      }
      if (visible && player) {
        if (!av) {
          av = new Avatar({ character: player.character, skin: player.skin, color: AVATAR_COLORS[player.color] ?? AVATAR_COLORS[0] });
          this.avatars[s] = av;
          this.avatarKeys[s] = key;
          this.group.add(av.root);
        }
        av.setColor(AVATAR_COLORS[player.color] ?? AVATAR_COLORS[0]);
        av.setFaded(!player.connected);
        const v = this.viewOf(s);
        av.root.position.copy(avatarPosition(v, n));
        av.root.rotation.y = viewYaw(v, n);
        av.root.scale.setScalar(AVATAR_SCALE);
      }
    }
    this.avatars.length = Math.max(n, 0);
    for (let s = n; s < this.chairs.length; s++) this.chairs[s]?.removeFromParent();
    this.chairs.length = Math.max(n, 0);
  }

  // ═══════════════════════════════ drinks ═══════════════════════════════

  /** Everyone seated has their order in front of them (the local player's too). */
  private syncDrinks(room: RoomView | null) {
    const n = room ? room.seats.length : 0;
    for (let s = 0; s < Math.max(n, this.drinks.length); s++) {
      const player = room && s < n ? (room.seats[s] ?? null) : null;
      const key = player ? `${player.id}|${player.drink}` : null;
      if (this.drinkKeys[s] !== key) {
        // Same player, new order: the new drink is served with a little pop.
        const reorder = !!player && !!this.drinkKeys[s]?.startsWith(`${player.id}|`);
        this.drinks[s]?.dispose();
        this.drinks[s] = null;
        this.drinkKeys[s] = null;
        // A new drink under the mouse gets its hover look on the next frame.
        if (s === this.mySeat) this.drinkHovered = false;
        if (player) this.placeDrink(s, player.drink, key!, reorder);
      } else if (this.drinks[s]) this.positionDrink(s);
    }
    this.drinks.length = n;
    this.drinkKeys.length = n;
    if (!this.myDrink()) this.drinkHovered = false;
  }

  private placeDrink(seat: number, kind: DrinkId, key: string, served: boolean) {
    const prop = new DrinkProp(kind);
    if (kind === 'chicha') {
      // The smoker holds the hose; the local player's rests by their cards.
      prop.restAnchor = (out) => {
        const av = this.avatars[seat];
        if (av) return av.leftHand.getWorldPosition(out);
        if (seat !== this.mySeat) return null;
        const v = this.viewOf(seat);
        return out
          .copy(avatarPosition(v, this.n))
          .addScaledVector(viewDir(v, this.n), -1.5)
          .addScaledVector(viewRight(v, this.n), -1.25)
          .setY(0.7);
      };
    }
    this.drinks[seat] = prop;
    this.drinkKeys[seat] = key;
    this.group.add(prop.root);
    this.positionDrink(seat);
    if (served) {
      prop.root.scale.setScalar(0.01);
      void animator.run({
        duration: 420,
        ease: ease.outBack,
        owner: prop.root,
        update: (t) => prop.root.scale.setScalar(Math.max(0.01, prop.baseScale * t)),
      });
    }
  }

  private positionDrink(seat: number) {
    const prop = this.drinks[seat];
    if (!prop) return;
    const v = this.viewOf(seat);
    const seatPos = avatarPosition(v, this.n);
    const pos = prop.kind === 'chicha' ? chichaPosition(v, this.n) : drinkPosition(v, this.n);
    prop.root.position.copy(pos);
    // Local +Z faces the drinker (the chicha's hose port, the cup's handle side).
    prop.root.rotation.y = Math.atan2(seatPos.x - pos.x, seatPos.z - pos.z);
  }

  private myDrink(): DrinkProp | null {
    return this.mySeat === null ? null : (this.drinks[this.mySeat] ?? null);
  }

  private pointerOnMyDrink(): boolean {
    const prop = this.myDrink();
    if (!prop) return false;
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    return this.raycaster.intersectObject(prop.hit, false).length > 0;
  }

  // ═══════════════════════════════ cards ═══════════════════════════════

  private take(id: string | null): CardObject {
    const c = this.pool.pop() ?? new CardObject();
    c.setFace(id);
    c.setGlow(0);
    c.setDim(false);
    c.glowOnFront(false);
    c.root.scale.setScalar(1);
    c.root.visible = true;
    c.setShadows(true);
    c.role = '';
    return c;
  }

  private release(c: CardObject) {
    animator.cancel(c.root);
    c.root.removeFromParent();
    c.setGlow(0);
    this.handLift.delete(c);
    if (this.hovered === c) this.hovered = null;
    if (this.selected === c) this.selected = null;
    this.pool.push(c);
  }

  private clearAll() {
    for (const c of this.myHand) this.release(c);
    this.myHand = [];
    for (const list of this.held) for (const c of list ?? []) this.release(c);
    this.held = [];
    for (const c of this.tableCards.values()) this.release(c);
    this.tableCards.clear();
    this.slotOf.clear();
    for (const p of this.piles) p.setCount(0);
    for (const list of this.markers) for (const c of list) this.release(c);
    this.markers = [];
    this.clearBeloteTable();
    this.deck.setCount(0);
    this.turnBar.visible = false;
  }

  private showDecorativeDeck() {
    this.deck.root.position.set(0, 0, 0);
    this.deck.root.rotation.y = 0.3;
    this.deck.setCount(40);
  }

  private freeSlot(): number {
    const used = new Set(this.slotOf.values());
    for (let i = 0; i < TABLE_SLOTS.length; i++) if (!used.has(i)) return i;
    return TABLE_SLOTS.length - 1;
  }

  private tableTransform(slot: number) {
    const s = TABLE_SLOTS[Math.min(slot, TABLE_SLOTS.length - 1)]!;
    const y = s.pos.y + (CARD_T * TABLE_CARD_SCALE) / 2 + 0.018;
    return { pos: s.pos.clone().setY(y), quat: flatQuat(s.yaw, true), scale: TABLE_CARD_SCALE };
  }

  private syncCards(room: RoomView, relayout: boolean) {
    const g = room.game;
    if (!g || room.phase === 'lobby') {
      for (const c of this.myHand) this.release(c);
      this.myHand = [];
      for (const list of this.held) for (const c of list ?? []) this.release(c);
      this.held = [];
      for (const c of this.tableCards.values()) this.release(c);
      this.tableCards.clear();
      this.slotOf.clear();
      for (const p of this.piles) p.setCount(0);
      for (const list of this.markers) for (const c of list) this.release(c);
      this.markers = Array.from({ length: this.n }, () => []);
      this.clearBeloteTable();
      this.showDecorativeDeck();
      return;
    }
    if (g.kind === 'belote') {
      this.clearChkobbaTable();
      this.syncBelote(g);
      return;
    }
    this.clearBeloteTable();

    this.syncMyHand(g.myHand?.map((c) => c.id) ?? []);
    this.syncHeld(g.handCounts);

    // Table.
    const tableIds = new Set(g.table.map((c) => c.id));
    for (const [id, c] of [...this.tableCards]) {
      if (!tableIds.has(id)) {
        this.release(c);
        this.tableCards.delete(id);
        this.slotOf.delete(id);
      }
    }
    for (const card of g.table) {
      let c = this.tableCards.get(card.id);
      if (!c) {
        c = this.take(card.id);
        c.role = 'table';
        this.group.add(c.root);
        this.tableCards.set(card.id, c);
        if (!this.slotOf.has(card.id)) this.slotOf.set(card.id, this.freeSlot());
      }
      const t = this.tableTransform(this.slotOf.get(card.id)!);
      if (c.root.parent !== this.group) this.group.attach(c.root);
      c.root.position.copy(t.pos);
      c.root.quaternion.copy(t.quat);
      c.root.scale.setScalar(t.scale);
    }

    // Piles and chkobba markers.
    for (let s = 0; s < this.n; s++) {
      this.piles[s]!.setCount(g.pileCounts[s] ?? 0);
      this.piles[s]!.root.position.y = this.pileBaseY((g.chkobbaCards[s] ?? []).length);
      const want = g.chkobbaCards[s] ?? [];
      const list = this.markers[s] ?? (this.markers[s] = []);
      while (list.length > want.length) this.release(list.pop()!);
      for (let i = 0; i < want.length; i++) {
        let m = list[i];
        if (!m) {
          m = this.take(want[i]!.id);
          m.role = 'marker';
          this.group.add(m.root);
          list.push(m);
        }
        m.setFace(want[i]!.id);
        const t = this.markerTransform(s, i);
        m.root.position.copy(t.pos);
        m.root.quaternion.copy(t.quat);
      }
    }

    // Stock.
    const dv = this.viewOf(g.dealer);
    this.deck.root.position.copy(deckPosition(dv, this.n));
    this.deck.root.rotation.y = deckYaw(dv, this.n);
    this.deck.setCount(g.deckCount);
    void relayout;
  }

  /** Shows the local player's hand: `ids` in display order. */
  private syncMyHand(ids: string[]) {
    for (const c of [...this.myHand]) {
      if (!c.cardId || !ids.includes(c.cardId)) {
        this.myHand.splice(this.myHand.indexOf(c), 1);
        this.release(c);
      }
    }
    for (const id of ids) {
      if (!this.myHand.some((c) => c.cardId === id)) {
        const c = this.take(id);
        c.role = 'hand';
        c.setShadows(false);
        this.handGroup.add(c.root);
        this.myHand.push(c);
      }
    }
    this.myHand.sort((a, b) => ids.indexOf(a.cardId!) - ids.indexOf(b.cardId!));
    this.layoutHand(false);
  }

  /** Opponents hold as many face-down cards as they have. */
  private syncHeld(counts: number[]) {
    for (let s = 0; s < this.n; s++) {
      if (!this.held[s]) this.held[s] = [];
      const list = this.held[s]!;
      const av = this.avatars[s];
      const want = s === this.mySeat || !av ? 0 : (counts[s] ?? 0);
      while (list.length > want) this.release(list.pop()!);
      while (list.length < want && av) {
        const c = this.take(null);
        c.role = 'held';
        av.handAnchor.add(c.root);
        list.push(c);
      }
      this.layoutHeld(s, false);
    }
  }

  /** Piles sit on top of their chkobba markers (face-up cards slid crosswise underneath). */
  private pileBaseY(markers: number): number {
    return markers > 0 ? markers * (CARD_T + 0.003) + 0.004 : 0;
  }

  private markerTransform(seat: number, i: number) {
    const v = this.viewOf(seat);
    const pile = pilePosition(v, this.n);
    const yaw = viewYaw(v, this.n) + Math.PI / 2 + 0.1 + i * 0.12;
    const out = viewDir(v, this.n).multiplyScalar(-0.15 - i * 0.12);
    return { pos: pile.clone().add(out).setY(CARD_T / 2 + 0.004 + i * (CARD_T + 0.003)), quat: flatQuat(yaw, true) };
  }

  private handTransform(i: number, count: number) {
    return myHandTransform(i, count, { width: this.stage.width, height: this.stage.height, fov: this.camFov }, {
      pos: new THREE.Vector3(),
      rot: new THREE.Euler(),
      scale: 1,
    });
  }

  private layoutHand(animate: boolean, duration = 300) {
    const count = this.myHand.length;
    this.myHand.forEach((c, i) => {
      const t = this.handTransform(i, count);
      const lift = this.handLift.get(c) ?? 0;
      const pos = t.pos.clone();
      pos.y += lift * t.scale * 0.32;
      pos.z += lift * 0.4;
      const quat = new THREE.Quaternion().setFromEuler(t.rot);
      const scale = t.scale * (1 + lift * 0.06);
      if (animate) void moveObject(c.root, { position: pos, quaternion: quat, scale, duration, ease: ease.outCubic });
      else {
        animator.cancel(c.root);
        c.root.position.copy(pos);
        c.root.quaternion.copy(quat);
        c.root.scale.setScalar(scale);
      }
    });
  }

  private layoutHeld(seat: number, animate: boolean) {
    const list = this.held[seat] ?? [];
    const tmp = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
    list.forEach((c, i) => {
      heldCardTransform(i, list.length, tmp);
      const q = new THREE.Quaternion().setFromEuler(tmp.rot);
      if (animate) void moveObject(c.root, { position: tmp.pos.clone(), quaternion: q, scale: HELD_SCALE, duration: 250 });
      else {
        c.root.position.copy(tmp.pos);
        c.root.quaternion.copy(q);
        c.root.scale.setScalar(HELD_SCALE);
      }
    });
  }

  // ═══════════════════════════════ turn indicator ═══════════════════════════════

  private syncTurn(room: RoomView) {
    const g = room.game;
    if (!g || room.phase !== 'playing') {
      this.turnBar.visible = false;
    } else {
      const v = this.viewOf(g.turn);
      this.turnBar.visible = true;
      this.turnBar.position.copy(viewDir(v, this.n)).multiplyScalar(FRAME_MID).setY(FRAME_TOP + 0.05);
      // The capsule's axis (y) laid flat along the player's side of the frame.
      this.turnBar.rotation.set(0, viewYaw(v, this.n), Math.PI / 2);
      // Avatars look at the player whose turn it is.
      const target = avatarPosition(v, this.n).setY(2.5);
      for (let s = 0; s < this.n; s++) {
        const av = this.avatars[s];
        if (!av) continue;
        if (s === g.turn) av.lookAt(new THREE.Vector3(0, 0, 0));
        else av.lookAt(target);
      }
    }
    this.refreshInteractivity();
  }

  // ═══════════════════════════════ animations ═══════════════════════════════

  private async animateEvent(ev: GameEvent) {
    switch (ev.kind) {
      case 'gameStart':
        await this.animateGameStart();
        break;
      case 'deal':
        await this.animateDeal(ev);
        break;
      case 'play':
        await this.animatePlay(ev.play.seat, ev.play.card, ev.play.captured, ev.play.chkobba);
        break;
      case 'roundEnd':
        await this.animateRoundEnd(ev.result.leftoverTo, ev.result.leftover);
        break;
      case 'beloteDeal':
        await this.animateBeloteDeal(ev);
        break;
      case 'beloteBid': {
        const pass = ev.action.call.type === 'pass';
        this.cb.onBid(ev.action);
        if (!pass) this.avatars[ev.action.seat]?.nod();
        await wait(pass ? 220 : 420);
        break;
      }
      case 'beloteContract':
        await this.animateBeloteContract(ev);
        break;
      case 'belotePlay':
        await this.animateBelotePlay(ev);
        break;
      case 'beloteTrick':
        await this.animateBeloteTrick(ev);
        break;
      case 'beloteEnd':
        await this.animateBeloteEnd(ev.result);
        break;
    }
  }

  private async animateGameStart() {
    // Fly whatever is on the table back into a neat pile before the first deal.
    await this.gatherEverything(new THREE.Vector3(0, 0, 0));
  }

  /** Flies the cards on the table (and with `hands`, the cards in everybody's hands) into a pile at `to`. */
  private async gatherEverything(to: THREE.Vector3, hands = false) {
    const flying: Promise<void>[] = [];
    const all: CardObject[] = [...this.tableCards.values(), ...this.markers.flat(), ...this.trickObjs.map((t) => t.obj)];
    this.tableCards.clear();
    this.slotOf.clear();
    this.markers = Array.from({ length: this.n }, () => []);
    this.trickObjs = [];
    this.trumpToken.setSuit(null);
    if (hands) {
      for (const c of this.myHand) {
        this.handLift.delete(c);
        c.setShadows(true);
        c.setDim(false);
        all.push(c);
      }
      this.myHand = [];
      for (const list of this.held) all.push(...(list ?? []));
      this.held = Array.from({ length: this.n }, () => []);
    }
    let i = 0;
    for (const c of all) {
      this.group.attach(c.root);
      flying.push(
        moveObject(c.root, {
          position: to.clone().setY(0.3),
          quaternion: flatQuat(0, false),
          duration: 380,
          delay: i++ * 25,
          arc: 0.8,
        }).then(() => this.release(c)),
      );
    }
    let anyPile = false;
    for (const p of this.piles) {
      if (p.count > 0) {
        anyPile = true;
        const startPos = p.root.position.clone();
        flying.push(
          moveObject(p.root, { position: to.clone(), duration: 420, arc: 1.2 }).then(() => {
            p.setCount(0);
            p.root.position.copy(startPos);
          }),
        );
      }
    }
    if (all.length || anyPile) this.cb.sfx('shuffle');
    await Promise.all(flying);
  }

  private async animateDeal(ev: Extract<GameEvent, { kind: 'deal' }>) {
    const n = this.n;
    const dv = this.viewOf(ev.dealer);
    const deckPos = deckPosition(dv, n);
    const stockYaw = deckYaw(dv, n);
    if (ev.initial) {
      // New hand: collect the previous one into the stock.
      await this.gatherEverything(deckPos);
      for (const c of this.myHand) this.release(c);
      this.myHand = [];
      for (const list of this.held) for (const c of list ?? []) this.release(c);
      this.held = Array.from({ length: n }, () => []);
      this.deck.root.position.copy(deckPos);
      this.deck.root.rotation.y = stockYaw;
      this.deck.setCount(40);
      if (ev.redeals > 0) await wait(150);
    }
    const total = ev.order.length + ev.table.length;
    let remaining = ev.deckCountAfter + total;
    this.deck.setCount(remaining);
    const myCards = [...(ev.myCards ?? [])];
    const flights: Promise<void>[] = [];
    let delay = 0;
    const step = 110;

    for (const seat of ev.order) {
      const isMe = seat === this.mySeat;
      const id = isMe ? (myCards.shift()?.id ?? null) : null;
      const c = this.take(null);
      c.root.position.copy(deckPos).setY(this.deck.topY + 0.02);
      c.root.quaternion.copy(flatQuat(stockYaw, false));
      this.group.add(c.root);
      const d = delay;
      delay += step;
      const flight = (async () => {
        await wait(d);
        remaining -= 1;
        this.deck.setCount(remaining);
        this.cb.sfx('deal');
        if (isMe) {
          c.setFace(id);
          c.role = 'hand';
          c.setShadows(false);
          this.myHand.push(c);
          const idx = this.myHand.length - 1;
          const t = this.handTransform(idx, Math.max(3, this.myHand.length));
          // Fly to the hand's world position, then re-parent into camera space.
          const world = t.pos.clone();
          this.handGroup.updateMatrixWorld(true);
          this.handGroup.localToWorld(world);
          const qWorld = new THREE.Quaternion().setFromEuler(t.rot);
          this.stage.camera.getWorldQuaternion(tmpQ);
          qWorld.premultiply(tmpQ);
          await moveObject(c.root, {
            position: world,
            quaternion: qWorld,
            via: standQuat(0, 0.6),
            scale: t.scale,
            duration: 430,
            arc: 1.6,
            ease: ease.outCubic,
          });
          this.handGroup.attach(c.root);
        } else {
          const av = this.avatars[seat];
          if (!av) {
            this.release(c);
            return;
          }
          if (!this.held[seat]) this.held[seat] = [];
          const list = this.held[seat]!;
          list.push(c);
          c.role = 'held';
          const tmp = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
          heldCardTransform(list.length - 1, Math.max(3, list.length), tmp);
          av.handAnchor.updateMatrixWorld(true);
          const world = av.handAnchor.localToWorld(tmp.pos.clone());
          const q = new THREE.Quaternion().setFromEuler(tmp.rot);
          av.handAnchor.getWorldQuaternion(tmpQ);
          q.premultiply(tmpQ);
          await moveObject(c.root, { position: world, quaternion: q, scale: HELD_SCALE, duration: 420, arc: 1.4, ease: ease.outCubic });
          av.handAnchor.attach(c.root);
        }
      })();
      flights.push(flight);
    }

    const freeSlots: number[] = [];
    for (const card of ev.table) {
      const slot = this.freeSlotExcluding(freeSlots);
      freeSlots.push(slot);
      const c = this.take(card.id);
      c.role = 'table';
      c.root.position.copy(deckPos).setY(this.deck.topY + 0.02);
      c.root.quaternion.copy(flatQuat(stockYaw, false));
      this.group.add(c.root);
      this.tableCards.set(card.id, c);
      this.slotOf.set(card.id, slot);
      const d = delay + 120;
      delay += 160;
      const t = this.tableTransform(slot);
      flights.push(
        (async () => {
          await wait(d);
          remaining -= 1;
          this.deck.setCount(remaining);
          this.cb.sfx('flip');
          await moveObject(c.root, {
            position: t.pos,
            quaternion: t.quat,
            via: standQuat(0, 0.35),
            scale: t.scale,
            duration: 480,
            arc: 1.5,
            ease: ease.outCubic,
          });
        })(),
      );
    }
    await Promise.all(flights);
    this.deck.setCount(ev.deckCountAfter);
    this.layoutHand(true, 200);
    for (let s = 0; s < n; s++) this.layoutHeld(s, true);
    await wait(120);
  }

  private freeSlotExcluding(extra: number[]): number {
    const used = new Set([...this.slotOf.values(), ...extra]);
    for (let i = 0; i < TABLE_SLOTS.length; i++) if (!used.has(i)) return i;
    return TABLE_SLOTS.length - 1;
  }

  /** Detaches the object that represents `card` in `seat`'s hand. */
  private pullFromHand(seat: number, card: { id: string }): CardObject {
    if (seat === this.mySeat) {
      const idx = this.myHand.findIndex((c) => c.cardId === card.id);
      if (idx >= 0) {
        const c = this.myHand.splice(idx, 1)[0]!;
        this.handLift.delete(c);
        this.group.attach(c.root);
        c.setShadows(true);
        this.layoutHand(true, 250);
        return c;
      }
    }
    const list = this.held[seat];
    if (list && list.length > 0) {
      const c = list.splice(Math.floor(list.length / 2), 1)[0]!;
      this.group.attach(c.root);
      c.setFace(card.id);
      this.layoutHeld(seat, true);
      return c;
    }
    // Fallback: appear from the player's position.
    const c = this.take(card.id);
    const v = this.viewOf(seat);
    c.root.position.copy(avatarPosition(v, this.n)).setY(1.5);
    c.root.quaternion.copy(standQuat(viewYaw(v, this.n) + Math.PI, 0.3));
    this.group.add(c.root);
    return c;
  }

  private async animatePlay(seat: number, card: Card, captured: Card[], chkobba: boolean) {
    const c = this.pullFromHand(seat, card);
    c.role = 'table';
    c.setGlow(0);
    const v = this.viewOf(seat);
    if (captured.length === 0) {
      const slot = this.freeSlot();
      this.slotOf.set(card.id, slot);
      this.tableCards.set(card.id, c);
      const t = this.tableTransform(slot);
      this.cb.sfx('flip');
      await moveObject(c.root, {
        position: t.pos.clone().setY(0.25),
        quaternion: t.quat,
        via: standQuat(0, 0.9),
        scale: t.scale,
        duration: 520,
        arc: 1.6,
        ease: ease.inOutCubic,
      });
      this.cb.sfx('lay');
      await moveObject(c.root, { position: t.pos, duration: 160, ease: ease.outBounce });
      await wait(140);
      return;
    }

    // Capture: hover over the targets, then sweep everything to the pile.
    const targets = captured.map((x) => this.tableCards.get(x.id)).filter((x): x is CardObject => !!x);
    const centre = new THREE.Vector3();
    for (const t of targets) centre.add(t.root.position);
    if (targets.length) centre.divideScalar(targets.length);
    centre.y = 0.38;
    this.cb.sfx('flip');
    await moveObject(c.root, {
      position: centre.clone().add(tmpV.set(0.18, 0, 0.22)),
      quaternion: flatQuat(0.22, true),
      via: standQuat(0, 0.9),
      scale: TABLE_CARD_SCALE,
      duration: 480,
      arc: 1.6,
    });
    for (const t of targets) t.setGlow(1, '#ffc928');
    c.setGlow(1, '#ffc928');
    this.cb.sfx('capture');
    await wait(260);

    if (chkobba) {
      this.cb.sfx('chkobba');
      this.cb.onChkobba(seat);
      this.stage.shake(0.35);
      this.shockwave.fire(centre);
      this.confetti.burst(centre.clone().setY(1), 200, 1);
      this.avatars[seat]?.celebrate();
      await wait(1500);
    }

    // Remove the captured cards from the table bookkeeping.
    for (const x of captured) {
      this.tableCards.delete(x.id);
      this.slotOf.delete(x.id);
    }
    const pile = this.piles[seat]!;
    const pilePos = pilePosition(v, this.n);
    const pileYaw = viewYaw(v, this.n) + 0.12;
    const all = [...targets, c];
    this.cb.sfx('sweep');
    const flights = all.map((obj, i) => {
      const isMarker = chkobba && obj === c;
      obj.setGlow(0);
      if (isMarker) {
        const list = this.markers[seat] ?? (this.markers[seat] = []);
        const t = this.markerTransform(seat, list.length);
        list.push(obj);
        obj.role = 'marker';
        return moveObject(obj.root, { position: t.pos, quaternion: t.quat, scale: 1, duration: 480, delay: i * 70, arc: 1.0 }).then(() => {
          pile.setCount(pile.count + 1);
          pile.root.position.y = this.pileBaseY(this.markers[seat]?.length ?? 0);
        });
      }
      return moveObject(obj.root, {
        position: pilePos.clone().setY(pile.topY + 0.05 + i * 0.01),
        quaternion: flatQuat(pileYaw, false),
        scale: 1,
        duration: 430,
        delay: i * 70,
        arc: 1.1,
        ease: ease.inOutCubic,
      }).then(() => {
        pile.setCount(pile.count + 1);
        this.release(obj);
      });
    });
    await Promise.all(flights);
    await wait(80);
  }

  private async animateRoundEnd(to: number | null, leftover: Card[]) {
    if (to === null || leftover.length === 0) {
      await wait(400);
      return;
    }
    const v = this.viewOf(to);
    const pile = this.piles[to]!;
    const pilePos = pilePosition(v, this.n);
    const pileYaw = viewYaw(v, this.n) + 0.12;
    this.cb.sfx('sweep');
    const flights = leftover.map((card, i) => {
      const obj = this.tableCards.get(card.id);
      if (!obj) return Promise.resolve();
      this.tableCards.delete(card.id);
      this.slotOf.delete(card.id);
      obj.setGlow(0.7, '#9be7ff');
      return moveObject(obj.root, {
        position: pilePos.clone().setY(pile.topY + 0.05),
        quaternion: flatQuat(pileYaw, false),
        scale: 1,
        duration: 520,
        delay: 200 + i * 90,
        arc: 1.3,
      }).then(() => {
        pile.setCount(pile.count + 1);
        this.release(obj);
      });
    });
    await Promise.all(flights);
    await wait(500);
  }

  // ═══════════════════════════════ belote ═══════════════════════════════

  private get kind(): GameKind {
    return this.room?.game?.kind ?? this.room?.settings.game ?? 'chkobba';
  }

  private clearBeloteTable() {
    for (const t of this.trickObjs) this.release(t.obj);
    this.trickObjs = [];
    this.trumpToken.setSuit(null);
  }

  private clearChkobbaTable() {
    for (const c of this.tableCards.values()) this.release(c);
    this.tableCards.clear();
    this.slotOf.clear();
    for (const list of this.markers) for (const c of list) this.release(c);
    this.markers = Array.from({ length: this.n }, () => []);
  }

  private syncBelote(g: BeloteView) {
    this.syncMyHand(sortBeloteHand(g.myHand ?? [], g.trump).map((c) => c.id));
    this.syncHeld(g.handCounts);

    // The trick in progress.
    const ids = g.trick.map((p) => p.card.id);
    for (const t of [...this.trickObjs]) {
      if (!ids.includes(t.obj.cardId ?? '')) {
        this.trickObjs.splice(this.trickObjs.indexOf(t), 1);
        this.release(t.obj);
      }
    }
    g.trick.forEach((p, i) => {
      let t = this.trickObjs.find((x) => x.obj.cardId === p.card.id);
      if (!t) {
        const obj = this.take(p.card.id);
        obj.role = 'trick';
        this.group.add(obj.root);
        t = { seat: p.seat, obj };
        this.trickObjs.push(t);
      }
      if (t.obj.root.parent !== this.group) this.group.attach(t.obj.root);
      const tr = this.trickTransform(p.seat, i);
      t.obj.root.position.copy(tr.pos);
      t.obj.root.quaternion.copy(tr.quat);
      t.obj.root.scale.setScalar(tr.scale);
      t.obj.setGlow(0);
    });
    this.trickObjs.sort((a, b) => ids.indexOf(a.obj.cardId!) - ids.indexOf(b.obj.cardId!));

    // Won tricks and the trump token; every card is dealt, so there is no stock.
    for (let s = 0; s < this.n; s++) {
      this.piles[s]!.setCount(g.pileCounts[s] ?? 0);
      this.piles[s]!.root.position.y = 0;
    }
    this.deck.root.position.copy(deckPosition(this.viewOf(g.dealer), this.n));
    this.deck.root.rotation.y = deckYaw(this.viewOf(g.dealer), this.n);
    this.deck.setCount(0);
    this.placeTrumpToken(g.trump, g.taker);
  }

  private trickTransform(seat: number, order: number) {
    const s = trickSlot(this.viewOf(seat), this.n);
    const y = (CARD_T * TABLE_CARD_SCALE) / 2 + 0.018 + order * 0.006;
    return { pos: s.pos.clone().setY(y), quat: flatQuat(s.yaw, true), scale: TABLE_CARD_SCALE };
  }

  private placeTrumpToken(trump: Suit | null, taker: number | null) {
    if (!trump || taker === null) {
      this.trumpToken.setSuit(null);
      return;
    }
    this.trumpToken.setSuit(trump);
    this.trumpToken.root.position.copy(trumpTokenPosition(this.viewOf(taker), this.n));
    // The suit reads upright from the camera.
    this.trumpToken.root.rotation.y = -Math.PI / 2;
  }

  /** Sorts the local hand for display (trumps first once known), gliding the cards to their places. */
  private async sortHand(trump: Suit | null) {
    if (this.myHand.length === 0) return;
    const ids = sortBeloteHand(
      this.myHand.map((c) => parseBeloteCard(c.cardId!)),
      trump,
    ).map((c) => c.id);
    this.myHand.sort((a, b) => ids.indexOf(a.cardId!) - ids.indexOf(b.cardId!));
    this.layoutHand(true, 280);
    await wait(300);
  }

  /**
   * Deals cards from the deck at `deckPos` to the seats in `order`, 4 at a time; the local player's (`mine`,
   * in order) turn face up as they reach the hand, laid out for `handSize` cards.
   */
  private async dealCards(deckPos: THREE.Vector3, order: number[], mine: string[], handSize: number) {
    let remaining = this.deck.count;
    const queue = [...mine];
    const flights = order.map((seat, i) => {
      const isMe = seat === this.mySeat;
      const id = isMe ? (queue.shift() ?? null) : null;
      return (async () => {
        await wait(Math.floor(i / 4) * LOT_STEP + (i % 4) * LOT_CARD_STEP);
        remaining -= 1;
        this.deck.setCount(Math.max(0, remaining));
        const c = this.take(null);
        c.root.position.copy(deckPos).setY(this.deck.topY + 0.02);
        c.root.quaternion.copy(flatQuat(this.deck.root.rotation.y, false));
        this.group.add(c.root);
        this.cb.sfx('deal');
        if (isMe) {
          c.setFace(id);
          c.role = 'hand';
          c.setShadows(false);
          this.myHand.push(c);
          const t = this.handTransform(this.myHand.length - 1, Math.max(handSize, this.myHand.length));
          // Fly to the hand's world position, then re-parent into camera space.
          const world = t.pos.clone();
          this.handGroup.updateMatrixWorld(true);
          this.handGroup.localToWorld(world);
          const qWorld = new THREE.Quaternion().setFromEuler(t.rot);
          this.stage.camera.getWorldQuaternion(tmpQ);
          qWorld.premultiply(tmpQ);
          await moveObject(c.root, { position: world, quaternion: qWorld, via: standQuat(0, 0.6), scale: t.scale, duration: 400, arc: 1.5, ease: ease.outCubic });
          this.handGroup.attach(c.root);
          return;
        }
        const av = this.avatars[seat];
        if (!av) {
          this.release(c);
          return;
        }
        const list = this.held[seat] ?? (this.held[seat] = []);
        list.push(c);
        c.role = 'held';
        const tmp = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
        heldCardTransform(list.length - 1, Math.max(handSize, list.length), tmp);
        av.handAnchor.updateMatrixWorld(true);
        const world = av.handAnchor.localToWorld(tmp.pos.clone());
        const q = new THREE.Quaternion().setFromEuler(tmp.rot);
        av.handAnchor.getWorldQuaternion(tmpQ);
        q.premultiply(tmpQ);
        await moveObject(c.root, { position: world, quaternion: q, scale: HELD_SCALE, duration: 400, arc: 1.3, ease: ease.outCubic });
        av.handAnchor.attach(c.root);
      })();
    });
    await Promise.all(flights);
    this.layoutHand(true, 200);
    for (let s = 0; s < this.n; s++) this.layoutHeld(s, true);
  }

  /** 8 cards each, in two lots of 4. */
  private async animateBeloteDeal(ev: BeloteDealEvent) {
    const deckPos = deckPosition(this.viewOf(ev.dealer), this.n);
    const stockYaw = deckYaw(this.viewOf(ev.dealer), this.n);
    // Everything goes back to the deck first: the last hand's tricks (and cards still held, when a hand
    // stopped early), or after a redeal everybody's cards.
    await this.gatherEverything(deckPos, true);
    if (ev.redeals > 0) this.cb.onRedeal();
    this.deck.root.position.copy(deckPos);
    this.deck.root.rotation.y = stockYaw;
    this.deck.setCount(ev.order.length);
    await this.dealCards(deckPos, ev.order, (ev.myCards ?? []).map((c) => c.id), 8);
    this.deck.setCount(0);
    await this.sortHand(null);
  }

  /** The auction is over: the trump token pops up in front of the taker, and the hand is sorted trumps first. */
  private async animateBeloteContract(ev: BeloteContractEvent) {
    const { contract } = ev;
    this.cb.onContract(contract, ev.coinche);
    this.placeTrumpToken(contract.suit, contract.seat);
    const token = this.trumpToken.root;
    token.scale.setScalar(0.01);
    this.cb.sfx('select');
    void animator.run({ duration: 420, ease: ease.outBack, owner: token, update: (k) => token.scale.setScalar(Math.max(0.01, k)) });
    this.avatars[contract.seat]?.nod();
    await wait(320);
    await this.sortHand(contract.suit);
  }

  private async animateBelotePlay(ev: BelotePlayEvent) {
    const c = this.pullFromHand(ev.seat, ev.card);
    c.role = 'trick';
    c.setGlow(0);
    c.setDim(false);
    const order = this.trickObjs.length;
    this.trickObjs.push({ seat: ev.seat, obj: c });
    const t = this.trickTransform(ev.seat, order);
    this.cb.sfx('flip');
    await moveObject(c.root, {
      position: t.pos.clone().setY(0.25),
      quaternion: t.quat,
      via: standQuat(0, 0.9),
      scale: t.scale,
      duration: 440,
      arc: 1.4,
      ease: ease.inOutCubic,
    });
    this.cb.sfx('lay');
    await moveObject(c.root, { position: t.pos, duration: 140, ease: ease.outBounce });
    if (ev.belote) {
      this.cb.onBelote(ev.seat, ev.belote);
      this.cb.sfx('capture');
    }
  }

  /** The best card of the trick lights up, then the four cards go to the winner's pile. */
  private async animateBeloteTrick(ev: BeloteTrickEvent) {
    const { trick } = ev;
    await wait(220);
    const win = this.trickObjs.find((t) => t.seat === trick.winner)?.obj;
    if (win) {
      win.setGlow(1, '#ffc928');
      void moveObject(win.root, { position: win.root.position.clone().setY(win.root.position.y + 0.12), duration: 160, ease: ease.outCubic });
    }
    this.cb.sfx('capture');
    this.avatars[trick.winner]?.nod();
    await wait(480);

    const v = this.viewOf(trick.winner);
    const pile = this.piles[trick.winner]!;
    const pilePos = pilePosition(v, this.n);
    const pileYaw = viewYaw(v, this.n) + 0.12;
    const objs = this.trickObjs;
    this.trickObjs = [];
    this.cb.sfx('sweep');
    await Promise.all(
      objs.map(({ obj }, i) => {
        obj.setGlow(0);
        return moveObject(obj.root, {
          position: pilePos.clone().setY(pile.topY + 0.05 + i * 0.01),
          quaternion: flatQuat(pileYaw, false),
          scale: 1,
          duration: 400,
          delay: i * 55,
          arc: 1.0,
          ease: ease.inOutCubic,
        }).then(() => {
          pile.setCount(pile.count + 1);
          this.release(obj);
        });
      }),
    );
  }

  private async animateBeloteEnd(result: BeloteRoundResult) {
    this.cb.onBeloteEnd(result);
    const takers = result.contract.seat % 2;
    if (result.outcome === 'made' && result.capot === takers) {
      // Capot, or a Kabbout made.
      this.cb.sfx('chkobba');
      this.stage.shake(0.3);
      this.confetti.burst(new THREE.Vector3(0, 1, 0), 220, 1);
      for (let s = 0; s < this.n; s++) if (s % 2 === takers) this.avatars[s]?.celebrate();
      await wait(1500);
    } else if (result.outcome !== 'made') {
      for (let s = 0; s < this.n; s++) if (s % 2 !== takers) this.avatars[s]?.nod();
      await wait(1300);
    } else await wait(350);
  }

  // ═══════════════════════════════ camera ═══════════════════════════════

  private setCamera(mode: CameraMode, instant = false) {
    const cam = this.stage.camera;
    this.camFrom.pos.copy(cam.position);
    this.camFrom.target.copy(this.camTarget);
    this.camFrom.fov = cam.fov;
    this.cameraMode = mode;
    const prevFov = this.camFov;
    if (mode === 'seat') this.fitSeatCamera();
    this.camBlend = instant ? 1 : 0;
    if (instant) this.applyCamera(1);
    // The hand lives in camera space, sized for the camera's field of view.
    if (mode === 'seat' && Math.abs(this.camFov - prevFov) > 0.01) this.layoutHand(!instant);
  }

  /**
   * Searches pitch, field of view, aim and distance for the view that shows the table cards
   * biggest while every opponent's face stays on screen, the far side of the table shows, and
   * neither the cards nor the faces hide under the HUD or the hand. The near part of the table may
   * be cut by the screen edges or hidden by the hand.
   */
  private fitSeatCamera() {
    const W = Math.max(1, this.stage.width);
    const H = Math.max(1, this.stage.height);
    const spectating = this.mySeat === null;
    const heads: Ball[] = [];
    for (let v = spectating ? 0 : 1; v < this.n; v++) heads.push(headBall(v, this.n));
    const view = fitSeatView({
      width: W,
      height: H,
      cards: this.cardArea(),
      heads,
      edge: tableEdgePoints(24).filter((p) => p.z < 0.25 * TABLE_EXTENT),
      hud: this.stage.overlay,
      hand: spectating ? null : this.handRect(),
      // The hand's cards lean back a little: keep some room behind them.
      handClear: spectating ? undefined : { point: { x: 0, y: FRAME_TOP, z: FRAME_HALF }, depth: HAND_DEPTH + 0.6 },
      ...seatViewRanges(W / H, !spectating, TABLE_EXTENT),
    });
    const dir = new THREE.Vector3(0, Math.sin(view.pitch), Math.cos(view.pitch));
    this.camTarget.set(0, 0, view.targetZ);
    this.camPos.copy(this.camTarget).addScaledVector(dir, view.distance);
    this.camFov = view.fov;
  }

  /** Screen box of the local hand as dealt (three cards, eight in Belote); it does not depend on the field of view. */
  private handRect(): Rect {
    return myHandRect(this.kind === 'belote' ? 8 : 3, { width: this.stage.width, height: this.stage.height, fov: this.camFov });
  }

  /** Where the game's cards lie on the table, which the camera shows as big as it can. */
  private cardArea(): Pt3[] {
    return this.kind === 'belote' ? BELOTE_AREA : CHKOBBA_AREA;
  }

  /** The table-card area on screen (CSS px), for name tags to keep clear of; null on the home screen. */
  cardAreaOnScreen(): Pt2[] | null {
    if (!this.room || this.cameraMode !== 'seat') return null;
    return this.cardArea().map((p) => {
      const s = this.stage.project(tmpV2.set(p.x, p.y, p.z), tmpV2);
      return { x: s.x, y: s.y };
    });
  }

  /** The local hand's screen box, or null when not seated. */
  handOnScreen(): Rect | null {
    if (!this.room || this.mySeat === null) return null;
    return myHandRect(Math.max(1, this.myHand.length), { width: this.stage.width, height: this.stage.height, fov: this.camFov });
  }

  private applyCamera(t: number) {
    const cam = this.stage.camera;
    const k = ease.inOutCubic(Math.min(1, t));
    cam.position.lerpVectors(this.camFrom.pos, this.camPos, k);
    tmpV.lerpVectors(this.camFrom.target, this.camTarget, k);
    cam.fov = this.camFrom.fov + (this.camFov - this.camFrom.fov) * k;
    cam.updateProjectionMatrix();
    cam.lookAt(tmpV);
    // The hand is laid out for the field of view being blended to: scale it to the current one so
    // it keeps its size on screen meanwhile (cards near the camera's axis scale with tan(fov / 2)).
    const s = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(this.camFov / 2));
    this.handGroup.scale.set(s, s, 1);
  }

  // ═══════════════════════════════ frame ═══════════════════════════════

  private update(dt: number, time: number) {
    if (this.cameraMode === 'menu') {
      this.menuCheer += dt;
      if (this.menuCheer > 6 && !this.room) {
        this.menuCheer = 0;
        const s = Math.floor(Math.random() * 4);
        const r = Math.random();
        if (r < 0.45) void this.playSip(s, false);
        else if (r < 0.75) this.avatars[s]?.celebrate();
        else this.avatars[s]?.nod();
      }
      this.menuAngle += dt * 0.06;
      const r = 20;
      this.camPos.set(Math.sin(this.menuAngle) * r, 7.5, Math.cos(this.menuAngle) * r);
      this.camTarget.set(0, 0.5, 0);
      this.camFov = this.stage.width / this.stage.height < 0.8 ? 58 : 40;
    }
    if (this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt / 1.4);
      this.applyCamera(this.camBlend);
    } else this.applyCamera(1);

    for (const av of this.avatars) av?.update(dt, time);
    for (const d of this.drinks) d?.update(dt, time, this.smoke);
    this.confetti.update(dt);
    this.shockwave.update(dt);
    this.smoke.update(dt);

    // Turn bar pulse.
    if (this.turnBar.visible) {
      const m = this.turnBar.material as THREE.MeshBasicMaterial;
      m.opacity = 0.55 + Math.sin(time * 4) * 0.35;
    }
    // Gentle pulse on capture previews.
    const pulse = 0.72 + Math.sin(time * 6) * 0.25;
    for (const id of this.previewIds) this.tableCards.get(id)?.setGlow(pulse);
    if (this.pointerInside) this.updateHover();
  }

  // ═══════════════════════════════ input ═══════════════════════════════

  private canAct(): boolean {
    const r = this.room;
    return (
      !!r &&
      !!r.game &&
      r.phase === 'playing' &&
      this.mySeat !== null &&
      r.game.turn === this.mySeat &&
      (r.game.kind !== 'belote' || r.game.stage === 'playing') &&
      !this.pending &&
      !this.choosing &&
      !this.isAnimating
    );
  }

  /** Belote: is it the local player's turn to speak in the auction (and the table done animating)? */
  get bidReady(): boolean {
    const r = this.room;
    const g = r?.game;
    return !!g && g.kind === 'belote' && r!.phase === 'playing' && g.stage === 'bidding' && this.mySeat !== null && g.turn === this.mySeat && !this.isAnimating;
  }

  /** Belote: the cards the local player may play now (null outside their turn in the tricks). */
  private beloteLegal(): Set<string> | null {
    const g = this.room?.game;
    if (!g || g.kind !== 'belote' || g.stage !== 'playing' || !g.trump || this.mySeat === null || !g.myHand) return null;
    return new Set(legalCards(g.myHand, g.trick, g.trump, this.mySeat).map((c) => c.id));
  }

  private refreshInteractivity() {
    const active = this.canAct();
    const legal = active ? this.beloteLegal() : null;
    for (const c of this.myHand) {
      const ok = !legal || legal.has(c.cardId ?? '');
      c.setDim(active && !ok);
      if (c === this.selected) continue;
      c.setGlow(active && ok ? 0.5 : 0, '#ffe27a');
    }
  }

  private setupInput() {
    const el = this.stage.renderer.domElement;
    const updatePointer = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.lastPointerType = e.pointerType;
    };
    el.addEventListener('pointermove', (e) => {
      updatePointer(e);
      this.pointerInside = e.pointerType === 'mouse';
    });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.setHovered(null);
      if (this.drinkHovered) {
        this.drinkHovered = false;
        this.myDrink()?.setHover(false);
      }
    });
    el.addEventListener('pointerdown', (e) => {
      updatePointer(e);
      void this.handleClick();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 'd' || e.key === 'D') && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        this.sipMine();
        return;
      }
      const idx = ['1', '2', '3', '4', '5', '6', '7', '8'].indexOf(e.key);
      if (idx >= 0 && this.myHand[idx]) {
        if (this.selected === this.myHand[idx]) void this.tryPlay(this.myHand[idx]!);
        else this.select(this.myHand[idx]!);
      } else if (e.key === 'Enter' && this.selected) void this.tryPlay(this.selected);
      else if (e.key === 'Escape') this.clearSelection();
    });
  }

  private pick(): CardObject | null {
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const meshes = [...this.myHand.map((c) => c.mesh), ...[...this.tableCards.values()].map((c) => c.mesh)];
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      const card = h.object.userData.card as CardObject | undefined;
      if (card) return card;
    }
    return null;
  }

  private updateHover() {
    const hit = this.pick();
    this.setHovered(hit && hit.role === 'hand' ? hit : null);
    const onDrink = !hit && this.pointerOnMyDrink();
    if (onDrink !== this.drinkHovered) {
      this.drinkHovered = onDrink;
      this.myDrink()?.setHover(onDrink);
    }
    this.stage.renderer.domElement.style.cursor = onDrink || (hit && hit.role === 'hand' && !hit.dimmed && this.canAct()) ? 'pointer' : 'default';
  }

  private setHovered(c: CardObject | null) {
    if (this.hovered === c) return;
    const prev = this.hovered;
    this.hovered = c;
    if (prev && prev !== this.selected) this.handLift.set(prev, 0);
    // Shaded cards (not allowed now) stay put.
    if (c && c !== this.selected && !c.dimmed) {
      this.handLift.set(c, 0.6);
      this.cb.sfx('hover');
    }
    this.layoutHand(true, 160);
    if (!this.selected) this.showPreview(c);
  }

  private showPreview(c: CardObject | null) {
    for (const id of this.previewIds) this.tableCards.get(id)?.setGlow(0);
    this.previewIds.clear();
    if (!c || !c.cardId || this.room?.game?.kind !== 'chkobba') return;
    const opts = captureOptions(parseCard(c.cardId), this.room.game.table);
    if (opts.length === 1) for (const x of opts[0]!) this.previewIds.add(x.id);
    else if (opts.length > 1) for (const o of opts) for (const x of o) this.previewIds.add(x.id);
    for (const id of this.previewIds) this.tableCards.get(id)?.setGlow(0.85, opts.length === 1 ? '#ffc928' : '#7fe0ff');
  }

  private select(c: CardObject) {
    if (!this.canAct()) {
      const g = this.room?.game;
      if (this.room?.phase === 'playing' && this.mySeat !== null && !this.isAnimating) {
        if (g?.kind === 'belote' && g.stage === 'bidding') this.cb.onInvalid(g.turn === this.mySeat ? 'Bid or pass first' : 'The auction is on');
        else this.cb.onInvalid('Wait for your turn');
      }
      return;
    }
    if (this.selected && this.selected !== c) this.handLift.set(this.selected, 0);
    this.selected = c;
    this.handLift.set(c, 1);
    c.setGlow(1, '#ffc928');
    this.cb.sfx('select');
    this.layoutHand(true, 180);
    this.showPreview(c);
  }

  private clearSelection() {
    if (this.selected) this.handLift.set(this.selected, 0);
    this.selected = null;
    this.showPreview(this.hovered);
    this.layoutHand(true, 180);
    this.refreshInteractivity();
  }

  private async handleClick() {
    if (this.choosing) return;
    const hit = this.pick();
    if (!hit) {
      // Tap your own drink to take a sip.
      if (this.pointerOnMyDrink()) this.sipMine();
      else if (this.selected) this.clearSelection();
      return;
    }
    if (hit.role === 'hand') {
      const touch = this.lastPointerType !== 'mouse';
      // A shaded card says why it cannot be played rather than being selected.
      if (touch && this.selected !== hit && !hit.dimmed) {
        this.select(hit);
        return;
      }
      await this.tryPlay(hit);
      return;
    }
    if (hit.role === 'table' && this.selected) {
      // Clicking a highlighted table card plays the selected card with an option that contains it.
      await this.tryPlay(this.selected, hit.cardId ?? undefined);
    }
  }

  private async tryPlay(c: CardObject, prefer?: string) {
    const g = this.room?.game;
    if (!c.cardId || !g) return;
    if (!this.canAct()) {
      this.select(c);
      return;
    }
    if (g.kind === 'belote') {
      const card = parseBeloteCard(c.cardId);
      const reason = illegalReason(g.myHand ?? [], g.trick, g.trump!, this.mySeat!, card);
      if (reason) {
        this.cb.onInvalid(reason);
        // A little dip: not that one.
        this.handLift.set(c, -0.35);
        this.layoutHand(true, 120);
        setTimeout(() => {
          if (c !== this.selected) this.handLift.set(c, this.hovered === c ? 0.6 : 0);
          this.layoutHand(true, 180);
        }, 220);
        return;
      }
      await this.send(c, { cardId: card.id });
      return;
    }
    const card = parseCard(c.cardId);
    const options = captureOptions(card, g.table);
    let capture: string[] = [];
    if (options.length === 1) capture = options[0]!.map((x) => x.id);
    else if (options.length > 1) {
      const containing = prefer ? options.filter((o) => o.some((x) => x.id === prefer)) : options;
      if (containing.length === 1) capture = containing[0]!.map((x) => x.id);
      else {
        this.select(c);
        this.choosing = true;
        let idx: number | null = null;
        try {
          idx = await this.cb.chooseCapture(card, containing.length ? containing : options);
        } finally {
          this.choosing = false;
        }
        if (idx === null) {
          this.clearSelection();
          return;
        }
        capture = (containing.length ? containing : options)[idx]!.map((x) => x.id);
      }
    }
    await this.send(c, { cardId: card.id, capture });
  }

  /** Sends the local player's card; it stays raised until the server answers. */
  private async send(c: CardObject, move: PlayRequest) {
    this.pending = true;
    this.handLift.set(c, 1.3);
    this.layoutHand(true, 150);
    this.refreshInteractivity();
    const ok = await this.cb.onPlay(move);
    this.pending = false;
    this.selected = null;
    for (const id of this.previewIds) this.tableCards.get(id)?.setGlow(0);
    this.previewIds.clear();
    if (!ok) {
      this.handLift.set(c, 0);
      this.layoutHand(true, 200);
    }
    this.refreshInteractivity();
  }

  /** End of the game: confetti everywhere and the winners jump for joy. */
  celebrateWinner(room: RoomView) {
    const winner = room.game?.winner;
    if (winner === null || winner === undefined) return;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        const a = Math.random() * Math.PI * 2;
        this.confetti.burst(new THREE.Vector3(Math.cos(a) * 2.5, 1, Math.sin(a) * 2.5), 120, 1.1);
      }, i * 350);
    }
    for (let s = 0; s < this.n; s++) if (s % 2 === winner) this.avatars[s]?.celebrate();
    this.stage.shake(0.2);
  }

  /** Highlights a capture option (used by the DOM chooser on hover). */
  highlightOption(ids: string[] | null) {
    for (const id of this.previewIds) this.tableCards.get(id)?.setGlow(0);
    this.previewIds.clear();
    if (!ids) return;
    for (const id of ids) {
      this.previewIds.add(id);
      this.tableCards.get(id)?.setGlow(1, '#ffc928');
    }
  }

  /** Is it the local player's turn right now (and not animating)? */
  get myTurnReady(): boolean {
    return this.canAct();
  }

  get cardHeight() {
    return CARD_H;
  }
}
