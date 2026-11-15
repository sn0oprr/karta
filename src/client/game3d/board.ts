/**
 * Board controller: turns room snapshots and game events into a living 3D table.
 */
import * as THREE from 'three';
import { type Card, parseCard } from '../../shared/cards';
import { type Move, captureOptions } from '../../shared/chkobba';
import { AVATAR_COLORS, type GameEvent, type PlayerInfo, type RoomMessage, type RoomView } from '../../shared/protocol';
import { Avatar, buildChair } from './avatar';
import { CARD_H, CARD_T, CardObject, CardStack } from './cardMesh';
import { Confetti, Shockwave } from './fx';
import {
  TABLE_SLOTS,
  avatarPosition,
  deckPosition,
  heldCardTransform,
  myHandTransform,
  pilePosition,
  rimAngle,
  viewDir,
  viewRight,
  viewYaw,
} from './layout';
import type { Stage } from './stage';
import { FELT_RADIUS, TABLE_RADIUS } from './table';
import { animator, ease, flatQuat, moveObject, standQuat, wait } from './tween';

export interface BoardCallbacks {
  /** The local player wants to play a move. Resolve false if the server refused it. */
  onPlay: (move: Move) => Promise<boolean>;
  /** Several captures are possible: show a chooser; return the chosen option index or null. */
  chooseCapture: (card: Card, options: Card[][]) => Promise<number | null>;
  onChkobba: (seat: number) => void;
  onRoundEnd: (room: RoomView) => void;
  /** Called after each processed message with the room as currently displayed. */
  onDisplayed: (room: RoomView) => void;
  sfx: (name: SfxName) => void;
  onInvalid: (reason: string) => void;
}

export type SfxName = 'deal' | 'lay' | 'capture' | 'chkobba' | 'flip' | 'hover' | 'select' | 'myTurn' | 'shuffle' | 'sweep';

type CameraMode = 'menu' | 'seat';

const DECK_YAW = -0.12;
const AVATAR_SCALE = 0.88;
const HELD_SCALE = 0.62;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

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
  private handGroup = new THREE.Group();
  private myHand: CardObject[] = [];
  private held: CardObject[][] = [];
  private tableCards = new Map<string, CardObject>();
  private slotOf = new Map<string, number>();
  private piles: CardStack[] = [];
  private markers: CardObject[][] = [];
  private deck = new CardStack();
  private turnArc: THREE.Mesh;
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

    const arcMat = new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.9, toneMapped: false });
    this.turnArc = new THREE.Mesh(new THREE.TorusGeometry(TABLE_RADIUS - 0.18, 0.09, 8, 48, Math.PI / 3.2), arcMat);
    this.turnArc.rotation.x = Math.PI / 2;
    this.turnArc.position.y = 0.3;
    this.turnArc.visible = false;
    this.group.add(this.turnArc);

    this.confetti = new Confetti(stage.scene);
    this.shockwave = new Shockwave(stage.scene);

    stage.onFrame((dt, t) => this.update(dt, t));
    stage.onResize(() => {
      this.layoutHand(false);
      if (this.cameraMode === 'seat') this.setCamera('seat', true);
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
      const av = new Avatar(`menu-guest-${s * 7 + 3}`, AVATAR_COLORS[palette[s]!]!);
      av.root.position.copy(avatarPosition(s, n));
      av.root.rotation.y = viewYaw(s, n);
      av.root.scale.setScalar(AVATAR_SCALE);
      av.lookAt(new THREE.Vector3(0, 0, 0));
      this.group.add(av.root);
      this.avatars[s] = av;
      this.avatarKeys[s] = `menu-${s}`;
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
    });
    this.deck.root.position.copy(deckPosition(1, n));
    this.deck.root.rotation.y = DECK_YAW;
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
   * World position for a seat's DOM name tag: above the head, or beside it when `side` is set
   * (used when the head-top spot would collide with the HUD). Null for the local player.
   */
  seatAnchor(seat: number, out = new THREE.Vector3(), side = false): THREE.Vector3 | null {
    if (!this.room || seat >= this.n) return null;
    const v = this.viewOf(seat);
    if (seat === this.mySeat) return null;
    out.copy(avatarPosition(v, this.n));
    if (!side) return out.setY(5.75);
    return out.addScaledVector(viewRight(v, this.n), -2.6).setY(3.4);
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
      const key = player ? `${player.id}` : null;
      let av = this.avatars[s] ?? null;
      if (!visible || this.avatarKeys[s] !== key) {
        if (av) {
          av.root.removeFromParent();
          av = null;
        }
        this.avatars[s] = null;
        this.avatarKeys[s] = null;
        if (this.held[s]) {
          for (const c of this.held[s]!) this.release(c);
          this.held[s] = [];
        }
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
          av = new Avatar(player.id, AVATAR_COLORS[player.color] ?? AVATAR_COLORS[0]);
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

  // ═══════════════════════════════ cards ═══════════════════════════════

  private take(id: string | null): CardObject {
    const c = this.pool.pop() ?? new CardObject();
    c.setFace(id);
    c.setGlow(0);
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
    this.deck.setCount(0);
    this.turnArc.visible = false;
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
    return { pos: s.pos.clone().setY(CARD_T / 2 + 0.018), quat: flatQuat(s.yaw, true) };
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
      this.showDecorativeDeck();
      return;
    }

    // My hand.
    const handIds = g.myHand?.map((c) => c.id) ?? [];
    for (const c of [...this.myHand]) {
      if (!c.cardId || !handIds.includes(c.cardId)) {
        this.myHand.splice(this.myHand.indexOf(c), 1);
        this.release(c);
      }
    }
    for (const id of handIds) {
      if (!this.myHand.some((c) => c.cardId === id)) {
        const c = this.take(id);
        c.role = 'hand';
        c.setShadows(false);
        this.handGroup.add(c.root);
        this.myHand.push(c);
      }
    }
    this.myHand.sort((a, b) => handIds.indexOf(a.cardId!) - handIds.indexOf(b.cardId!));
    this.layoutHand(false);

    // Opponents' held cards.
    for (let s = 0; s < this.n; s++) {
      if (!this.held[s]) this.held[s] = [];
      const list = this.held[s]!;
      const av = this.avatars[s];
      const want = s === this.mySeat || !av ? 0 : (g.handCounts[s] ?? 0);
      while (list.length > want) this.release(list.pop()!);
      while (list.length < want && av) {
        const c = this.take(null);
        c.role = 'held';
        av.handAnchor.add(c.root);
        list.push(c);
      }
      this.layoutHeld(s, false);
    }

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
      c.root.scale.setScalar(1);
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
    this.deck.root.rotation.y = DECK_YAW;
    this.deck.setCount(g.deckCount);
    void relayout;
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
      this.turnArc.visible = false;
    } else {
      const v = this.viewOf(g.turn);
      this.turnArc.visible = true;
      const a = rimAngle(v, this.n);
      this.turnArc.rotation.z = -a - Math.PI / 6.4;
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
    }
  }

  private async animateGameStart() {
    // Fly whatever is on the table back into a neat pile before the first deal.
    await this.gatherEverything(new THREE.Vector3(0, 0, 0));
  }

  private async gatherEverything(to: THREE.Vector3) {
    const flying: Promise<void>[] = [];
    const all: CardObject[] = [...this.tableCards.values(), ...this.markers.flat()];
    this.tableCards.clear();
    this.slotOf.clear();
    this.markers = Array.from({ length: this.n }, () => []);
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
    const deckYaw = DECK_YAW;
    if (ev.initial) {
      // New hand: collect the previous one into the stock.
      await this.gatherEverything(deckPos);
      for (const c of this.myHand) this.release(c);
      this.myHand = [];
      for (const list of this.held) for (const c of list ?? []) this.release(c);
      this.held = Array.from({ length: n }, () => []);
      this.deck.root.position.copy(deckPos);
      this.deck.root.rotation.y = deckYaw;
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
      c.root.quaternion.copy(flatQuat(deckYaw, false));
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
      c.root.quaternion.copy(flatQuat(deckYaw, false));
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
  private pullFromHand(seat: number, card: Card): CardObject {
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
        scale: 1,
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
      scale: 1,
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
        return moveObject(obj.root, { position: t.pos, quaternion: t.quat, duration: 480, delay: i * 70, arc: 1.0 }).then(() => {
          pile.setCount(pile.count + 1);
          pile.root.position.y = this.pileBaseY(this.markers[seat]?.length ?? 0);
        });
      }
      return moveObject(obj.root, {
        position: pilePos.clone().setY(pile.topY + 0.05 + i * 0.01),
        quaternion: flatQuat(pileYaw, false),
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

  // ═══════════════════════════════ camera ═══════════════════════════════

  private setCamera(mode: CameraMode, instant = false) {
    const cam = this.stage.camera;
    this.camFrom.pos.copy(cam.position);
    this.camFrom.target.copy(this.camTarget);
    this.camFrom.fov = cam.fov;
    this.cameraMode = mode;
    if (mode === 'seat') this.fitSeatCamera();
    this.camBlend = instant ? 1 : 0;
    if (instant) this.applyCamera(1);
  }

  /** Finds a camera distance that keeps the table, the opponents and the HUD-safe areas in view. */
  private fitSeatCamera() {
    const aspect = this.stage.width / Math.max(1, this.stage.height);
    const portrait = aspect < 0.8;
    const square = !portrait && aspect < 1.25;
    const spectating = this.mySeat === null;
    const fov = portrait ? 54 : square ? 44 : 38;
    // Spectators look from higher up, over the near player's head.
    const pitch = THREE.MathUtils.degToRad((portrait ? 66 : square ? 60 : 57) + (spectating ? 9 : 0));
    const target = new THREE.Vector3(0, 0, portrait ? 1.3 : 0.55);
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    // [point, minNdcY, maxNdcY, maxAbsNdcX]
    const pts: [THREE.Vector3, number, number, number][] = [];
    const R = FELT_RADIUS;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
      if (p.z > 2.5) continue; // the near rim may hide behind the hand
      pts.push([p, -1, 0.8, portrait ? 0.99 : 0.96]);
    }
    for (let s = 1; s < this.n; s++) {
      const head = avatarPosition(s, this.n).setY(4.3);
      const side = Math.abs(head.x) > 3;
      // Side opponents may be cut a little on narrow screens; the far one may reach the top edge.
      pts.push([head, -1, side ? 0.8 : 0.93, portrait && side ? 1.4 : 0.97]);
    }
    if (spectating) pts.push([new THREE.Vector3(0, 0, FELT_RADIUS), -0.7, 1, 1]);
    else pts.push([new THREE.Vector3(0, 0, 2.3), portrait ? -0.36 : -0.42, 1, 1]);
    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 400);
    const fits = (dist: number) => {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      for (const [p, minY, maxY, maxX] of pts) {
        tmpV2.copy(p).project(cam);
        if (tmpV2.z > 1 || tmpV2.y < minY || tmpV2.y > maxY || Math.abs(tmpV2.x) > maxX) return false;
      }
      return true;
    };
    let lo = 4;
    let hi = 90;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    this.camPos.copy(target).addScaledVector(dir, hi);
    this.camTarget.copy(target);
    this.camFov = fov;
  }

  private applyCamera(t: number) {
    const cam = this.stage.camera;
    const k = ease.inOutCubic(Math.min(1, t));
    cam.position.lerpVectors(this.camFrom.pos, this.camPos, k);
    tmpV.lerpVectors(this.camFrom.target, this.camTarget, k);
    cam.fov = this.camFrom.fov + (this.camFov - this.camFrom.fov) * k;
    cam.updateProjectionMatrix();
    cam.lookAt(tmpV);
  }

  // ═══════════════════════════════ frame ═══════════════════════════════

  private update(dt: number, time: number) {
    if (this.cameraMode === 'menu') {
      this.menuCheer += dt;
      if (this.menuCheer > 6 && !this.room) {
        this.menuCheer = 0;
        const s = Math.floor(Math.random() * 4);
        if (Math.random() < 0.5) this.avatars[s]?.celebrate();
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
    this.confetti.update(dt);
    this.shockwave.update(dt);

    // Turn arc pulse.
    if (this.turnArc.visible) {
      const m = this.turnArc.material as THREE.MeshBasicMaterial;
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
      !this.pending &&
      !this.choosing &&
      !this.isAnimating
    );
  }

  private refreshInteractivity() {
    const active = this.canAct();
    for (const c of this.myHand) {
      if (c === this.selected) continue;
      c.setGlow(active ? 0.5 : 0, '#ffe27a');
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
    });
    el.addEventListener('pointerdown', (e) => {
      updatePointer(e);
      void this.handleClick();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = ['1', '2', '3'].indexOf(e.key);
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
    this.stage.renderer.domElement.style.cursor = hit && hit.role === 'hand' && this.canAct() ? 'pointer' : 'default';
  }

  private setHovered(c: CardObject | null) {
    if (this.hovered === c) return;
    const prev = this.hovered;
    this.hovered = c;
    if (prev && prev !== this.selected) this.handLift.set(prev, 0);
    if (c && c !== this.selected) {
      this.handLift.set(c, 0.6);
      this.cb.sfx('hover');
    }
    this.layoutHand(true, 160);
    if (!this.selected) this.showPreview(c);
  }

  private showPreview(c: CardObject | null) {
    for (const id of this.previewIds) this.tableCards.get(id)?.setGlow(0);
    this.previewIds.clear();
    if (!c || !c.cardId || !this.room?.game) return;
    const opts = captureOptions(parseCard(c.cardId), this.room.game.table);
    if (opts.length === 1) for (const x of opts[0]!) this.previewIds.add(x.id);
    else if (opts.length > 1) for (const o of opts) for (const x of o) this.previewIds.add(x.id);
    for (const id of this.previewIds) this.tableCards.get(id)?.setGlow(0.85, opts.length === 1 ? '#ffc928' : '#7fe0ff');
  }

  private select(c: CardObject) {
    if (!this.canAct()) {
      if (this.room?.phase === 'playing' && this.mySeat !== null && !this.isAnimating) this.cb.onInvalid('Wait for your turn');
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
      if (this.selected) this.clearSelection();
      return;
    }
    if (hit.role === 'hand') {
      const touch = this.lastPointerType !== 'mouse';
      if (touch && this.selected !== hit) {
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
    if (!c.cardId || !this.room?.game) return;
    if (!this.canAct()) {
      this.select(c);
      return;
    }
    const card = parseCard(c.cardId);
    const options = captureOptions(card, this.room.game.table);
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
    this.pending = true;
    this.handLift.set(c, 1.3);
    this.layoutHand(true, 150);
    this.refreshInteractivity();
    const ok = await this.cb.onPlay({ cardId: card.id, capture });
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
