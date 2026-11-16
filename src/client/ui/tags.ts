import { teamOf } from '../../shared/chkobba';
import { AVATAR_COLORS, EMOTES, type RoomView } from '../../shared/protocol';
import type { Board } from '../game3d/board';
import type { Stage } from '../game3d/stage';
import { type Pt2, type Rect, overlapArea, polygonRectOverlap } from '../game3d/viewFit';
import { h } from './dom';

interface Tag {
  el: HTMLElement;
  pill: HTMLElement;
  nameEl: HTMLElement;
  icons: HTMLElement;
  dot: HTMLElement;
  flag: HTMLElement;
  timer: SVGSVGElement;
  timerCircle: SVGCircleElement;
  bubble: HTMLElement | null;
  bubbleTimer: ReturnType<typeof setTimeout> | null;
  thinking: HTMLElement;
  spot: Spot;
}

/** Where a floating label sits: its measured size, the spot it chose and where it is drawn. */
interface Spot {
  w: number;
  h: number;
  dirty: boolean;
  choice: number;
  x: number;
  y: number;
  shown: boolean;
}

/** A place a label could go, with how far it is from its home spot (px) and a style cost. */
interface Candidate {
  x: number;
  y: number;
  away: number;
  cost: number;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const GAP = 4;
const EDGE = 4;

const newSpot = (): Spot => ({ w: 0, h: 0, dirty: true, choice: -1, x: 0, y: 0, shown: false });

/** Name tags floating by each player's avatar, with speaking/timer/emote indicators. */
export class SeatTags {
  readonly el = h('div', { class: 'tags' });
  private tags: Tag[] = [];
  private myBubbleHost = h('div', { class: 'tag my-bubble' });
  private mySpot = newSpot();
  private room: RoomView | null = null;
  private clockOffset = 0;
  private measuredAt = 0;
  private lastFrame = performance.now();
  levels = new Map<string, number>();
  voiceMembers = new Map<string, boolean>();

  constructor(
    private readonly stage: Stage,
    private readonly board: Board,
  ) {
    this.el.appendChild(this.myBubbleHost);
    stage.onFrame(() => this.frame());
    stage.onResize(() => {
      for (const t of this.tags) t.spot.dirty = true;
      this.mySpot.dirty = true;
    });
  }

  private makeTag(): Tag {
    const dot = h('span', { class: 'mini-dot' });
    const flag = h('span', { class: 'team-flag hidden' });
    const nameEl = h('span', { class: 'nm' });
    const icons = h('span', { class: 'icons' });
    const timer = document.createElementNS(SVGNS, 'svg');
    timer.setAttribute('viewBox', '0 0 24 24');
    timer.classList.add('timer-ring');
    const bg = document.createElementNS(SVGNS, 'circle');
    bg.setAttribute('cx', '12');
    bg.setAttribute('cy', '12');
    bg.setAttribute('r', '9');
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'rgba(29,27,46,.15)');
    bg.setAttribute('stroke-width', '4');
    const fg = document.createElementNS(SVGNS, 'circle');
    fg.setAttribute('cx', '12');
    fg.setAttribute('cy', '12');
    fg.setAttribute('r', '9');
    fg.setAttribute('fill', 'none');
    fg.setAttribute('stroke', '#d7263d');
    fg.setAttribute('stroke-width', '4');
    fg.setAttribute('stroke-linecap', 'round');
    fg.setAttribute('transform', 'rotate(-90 12 12)');
    fg.setAttribute('stroke-dasharray', `${2 * Math.PI * 9}`);
    timer.append(bg, fg);
    timer.style.display = 'none';
    const thinking = h('span', { class: 'thinking hidden' }, h('i'), h('i'), h('i'));
    const pill = h('div', { class: 'tag-pill' }, dot, flag, nameEl, thinking, icons, timer);
    const el = h('div', { class: 'tag' }, pill);
    this.el.appendChild(el);
    return {
      el,
      pill,
      nameEl,
      icons,
      dot,
      flag,
      timer,
      timerCircle: fg,
      bubble: null,
      bubbleTimer: null,
      thinking,
      spot: newSpot(),
    };
  }

  update(room: RoomView) {
    this.room = room;
    this.clockOffset = Date.now() - room.serverTime;
    this.voiceMembers = new Map(room.voice.map((v) => [v.id, v.muted]));
    const n = room.seats.length;
    while (this.tags.length < n) this.tags.push(this.makeTag());
    while (this.tags.length > n) this.tags.pop()!.el.remove();
    for (let s = 0; s < n; s++) {
      const tag = this.tags[s]!;
      const p = room.seats[s];
      if (!p || s === room.you.seat) {
        tag.el.style.display = 'none';
        continue;
      }
      const before = `${tag.el.style.display}|${tag.nameEl.textContent}|${tag.icons.textContent}`;
      tag.el.style.display = '';
      tag.nameEl.textContent = p.name;
      tag.dot.style.background = AVATAR_COLORS[p.color] ?? '#ccc';
      if (n === 4) {
        tag.flag.classList.remove('hidden');
        tag.flag.style.background = teamOf(s) === 0 ? 'var(--team-a)' : 'var(--team-b)';
      } else tag.flag.classList.add('hidden');
      const icons: string[] = [];
      if (p.bot) icons.push('🤖');
      if (!p.connected) icons.push(p.autopilot ? '💤' : '📶');
      const v = this.voiceMembers.get(p.id);
      if (v !== undefined) icons.push(v ? '🔇' : '🎙️');
      tag.icons.textContent = icons.join('');
      const g = room.game;
      const isTurn = !!g && room.phase === 'playing' && g.turn === s;
      tag.el.classList.toggle('turn', isTurn);
      tag.thinking.classList.toggle('hidden', !(isTurn && (p.bot || p.autopilot)));
      if (before !== `${tag.el.style.display}|${tag.nameEl.textContent}|${tag.icons.textContent}`) tag.spot.dirty = true;
    }
  }

  /** Shows a speech bubble over a player (or over the hand for the local player). */
  bubble(playerId: string, text: string) {
    const room = this.room;
    if (!room) return;
    const seat = room.seats.findIndex((p) => p?.id === playerId);
    let host: HTMLElement;
    let spot: Spot;
    let tag: Tag | null = null;
    if (seat >= 0 && seat !== room.you.seat) {
      tag = this.tags[seat] ?? null;
      if (!tag) return;
      host = tag.el;
      spot = tag.spot;
      if (tag.bubble) tag.bubble.remove();
      if (tag.bubbleTimer) clearTimeout(tag.bubbleTimer);
    } else if (playerId === room.you.id) {
      host = this.myBubbleHost;
      spot = this.mySpot;
      host.replaceChildren();
    } else return; // spectators' emotes only show in chat
    const b = h('div', { class: 'bubble' }, text);
    host.prepend(b);
    spot.dirty = true;
    const timer = setTimeout(() => {
      b.classList.add('out');
      setTimeout(() => {
        b.remove();
        spot.dirty = true;
      }, 300);
    }, 2600);
    if (tag) {
      tag.bubble = b;
      tag.bubbleTimer = timer;
    }
  }

  emoteText(id: string): string {
    const e = EMOTES.find((x) => x.id === id);
    return e ? `${e.icon} ${e.text}` : id;
  }

  private measure(el: HTMLElement, spot: Spot, force: boolean) {
    if (!spot.dirty && !force) return;
    spot.dirty = false;
    spot.w = el.offsetWidth;
    spot.h = el.offsetHeight;
  }

  /**
   * Scores a spot: covering table cards, the hand or the HUD costs most, then other labels, then
   * faces; straying from home costs a little, so labels stay by their player when they can.
   */
  private cost(r: Rect, away: number, style: number, avoid: Avoid): number {
    let s = style + away * 22;
    if (avoid.cards) s += 12 * polygonRectOverlap(avoid.cards, r);
    if (avoid.hand) s += 12 * overlapArea(r, avoid.hand);
    for (const k of avoid.hud) s += 9 * overlapArea(r, k);
    for (const k of avoid.labels) s += 7 * overlapArea(r, k);
    for (const k of avoid.heads) s += 4 * overlapArea(r, k);
    return s;
  }

  /** Picks the cheapest candidate (keeping the current one unless another is clearly better). */
  private place(el: HTMLElement, spot: Spot, cands: Candidate[], avoid: Avoid, dt: number): Rect {
    const W = this.stage.width;
    const H = this.stage.height;
    let best = -1;
    let bestScore = Infinity;
    let bestX = 0;
    let bestY = 0;
    cands.forEach((c, i) => {
      // Keep inside the screen; being pushed back in costs like straying.
      const x = Math.max(EDGE, Math.min(W - EDGE - spot.w, c.x));
      const y = Math.max(EDGE, Math.min(H - EDGE - spot.h, c.y));
      const r = { left: x, top: y, right: x + spot.w, bottom: y + spot.h };
      let s = this.cost(r, c.away + Math.abs(x - c.x) + Math.abs(y - c.y), c.cost, avoid);
      if (i === spot.choice) s = s * 0.85 - 400;
      if (s < bestScore) {
        bestScore = s;
        best = i;
        bestX = x;
        bestY = y;
      }
    });
    spot.choice = best;
    // Glide between spots rather than jumping (but snap when appearing or after a big move).
    const far = Math.abs(bestX - spot.x) + Math.abs(bestY - spot.y) > 260;
    if (!spot.shown || far) {
      spot.x = bestX;
      spot.y = bestY;
    } else {
      const k = 1 - Math.exp(-dt * 14);
      spot.x += (bestX - spot.x) * k;
      spot.y += (bestY - spot.y) * k;
    }
    spot.shown = true;
    el.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px)`;
    return { left: spot.x, top: spot.y, right: spot.x + spot.w, bottom: spot.y + spot.h };
  }

  /** Spots around a head: above (home), beside, below, each also pushed further out. */
  private aroundHead(head: Rect, w: number, hgt: number): Candidate[] {
    const cx = (head.left + head.right) / 2;
    const cy = (head.top + head.bottom) / 2;
    const out: Candidate[] = [];
    for (let k = 0; k < 4; k++) {
      const dy = k * hgt * 0.75;
      const dx = k * w * 0.35;
      out.push({ x: cx - w / 2, y: head.top - hgt - GAP - dy, away: dy, cost: 0 });
      out.push({ x: head.right + GAP + dx, y: cy - hgt / 2, away: dx, cost: 250 });
      out.push({ x: head.left - GAP - w - dx, y: cy - hgt / 2, away: dx, cost: 250 });
      out.push({ x: head.right - w * 0.3 + dx, y: head.top - hgt - GAP - dy, away: dx + dy, cost: 150 });
      out.push({ x: head.left - w * 0.7 - dx, y: head.top - hgt - GAP - dy, away: dx + dy, cost: 150 });
      out.push({ x: cx - w / 2, y: head.bottom + GAP + dy, away: dy, cost: 600 });
    }
    return out;
  }

  /** Spots for the local player's own speech bubble: just above the hand, else beside it. */
  private aroundHand(hand: Rect | null, w: number, hgt: number): Candidate[] {
    const W = this.stage.width;
    const H = this.stage.height;
    const top = hand ? hand.top : H - 70;
    const out: Candidate[] = [];
    for (let k = 0; k < 4; k++) {
      const dy = k * hgt * 0.6;
      out.push({ x: W / 2 - w / 2, y: top - hgt - GAP - dy, away: dy, cost: 0 });
      if (hand) {
        out.push({ x: hand.left - w - GAP, y: H - hgt - 70 - dy, away: dy, cost: 200 });
        out.push({ x: hand.right + GAP, y: H - hgt - 70 - dy, away: dy, cost: 200 });
      }
    }
    return out;
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const room = this.room;
    if (!room) return;
    // Sizes only change with content; re-measure now and then anyway (fonts, CSS breakpoints).
    const remeasure = now - this.measuredAt > 500;
    if (remeasure) this.measuredAt = now;

    const heads = new Map<number, Rect>();
    for (let s = 0; s < this.tags.length; s++) {
      const head = this.tags[s]!.el.style.display === 'none' ? null : this.board.seatHeadRect(s);
      if (head) heads.set(s, head);
    }
    const avoid: Avoid = {
      cards: this.board.cardAreaOnScreen(),
      hand: this.board.handOnScreen(),
      hud: this.stage.overlay,
      labels: [],
      heads: [...heads.values()],
    };

    // Busiest first: the far player (often squeezed under the HUD), then the others.
    const order = [...heads.keys()].sort((a, b) => heads.get(a)!.top - heads.get(b)!.top);
    for (let s = 0; s < this.tags.length; s++) {
      if (!heads.has(s)) {
        const tag = this.tags[s]!;
        tag.el.style.visibility = 'hidden';
        tag.spot.shown = false;
      }
    }
    for (const s of order) {
      const tag = this.tags[s]!;
      const head = heads.get(s)!;
      tag.el.style.visibility = '';
      this.measure(tag.el, tag.spot, remeasure);
      const box = this.place(tag.el, tag.spot, this.aroundHead(head, tag.spot.w, tag.spot.h), avoid, dt);
      avoid.labels.push(box);

      const p = room.seats[s];
      const level = p ? (this.levels.get(p.id) ?? 0) : 0;
      tag.el.classList.toggle('speaking', level > 0.08);

      // Turn timer.
      const g = room.game;
      if (g && g.turnDeadline && g.turn === s && room.phase === 'playing') {
        const total = room.settings.turnSeconds * 1000;
        const left = g.turnDeadline + this.clockOffset - Date.now();
        const frac = Math.max(0, Math.min(1, left / total));
        tag.timer.style.display = '';
        const len = 2 * Math.PI * 9;
        tag.timerCircle.setAttribute('stroke-dashoffset', String(len * (1 - frac)));
        tag.timerCircle.setAttribute('stroke', frac < 0.25 ? '#d7263d' : '#2f7fd6');
      } else tag.timer.style.display = 'none';
    }

    // The local player's own speech bubble.
    if (this.myBubbleHost.childElementCount > 0) {
      this.measure(this.myBubbleHost, this.mySpot, remeasure);
      const s = this.mySpot;
      this.place(this.myBubbleHost, s, this.aroundHand(avoid.hand, s.w, s.h), avoid, dt);
    } else this.mySpot.shown = false;
  }

  get offset() {
    return this.clockOffset;
  }
}

interface Avoid {
  cards: Pt2[] | null;
  hand: Rect | null;
  hud: Rect[];
  labels: Rect[];
  heads: Rect[];
}
