import * as THREE from 'three';
import { teamOf } from '../../shared/chkobba';
import { AVATAR_COLORS, EMOTES, type RoomView } from '../../shared/protocol';
import type { Board } from '../game3d/board';
import type { Stage } from '../game3d/stage';
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
}

const SVGNS = 'http://www.w3.org/2000/svg';

/** Name tags floating above each player's avatar, with speaking/timer/emote indicators. */
export class SeatTags {
  readonly el = h('div', { class: 'tags' });
  private tags: Tag[] = [];
  private myBubbleHost = h('div', { class: 'tag', style: { left: '50%', top: '60%' } });
  private room: RoomView | null = null;
  private clockOffset = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  levels = new Map<string, number>();
  voiceMembers = new Map<string, boolean>();

  constructor(
    private readonly stage: Stage,
    private readonly board: Board,
  ) {
    this.el.appendChild(this.myBubbleHost);
    stage.onFrame(() => this.frame());
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
    return { el, pill, nameEl, icons, dot, flag, timer, timerCircle: fg, bubble: null, bubbleTimer: null, thinking };
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
    }
  }

  /** Shows a speech bubble over a player (or over the hand for the local player). */
  bubble(playerId: string, text: string) {
    const room = this.room;
    if (!room) return;
    const seat = room.seats.findIndex((p) => p?.id === playerId);
    let host: HTMLElement;
    let tag: Tag | null = null;
    if (seat >= 0 && seat !== room.you.seat) {
      tag = this.tags[seat] ?? null;
      if (!tag) return;
      host = tag.el;
      if (tag.bubble) tag.bubble.remove();
      if (tag.bubbleTimer) clearTimeout(tag.bubbleTimer);
    } else if (playerId === room.you.id) {
      host = this.myBubbleHost;
      host.replaceChildren();
    } else return; // spectators' emotes only show in chat
    const b = h('div', { class: 'bubble' }, text);
    host.prepend(b);
    const timer = setTimeout(() => {
      b.classList.add('out');
      setTimeout(() => b.remove(), 300);
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

  private hudRects: DOMRect[] = [];
  private hudBottom = 60;
  private hudCheckedAt = 0;

  private overlapsHud(cx: number, bottom: number, w: number, hgt: number): boolean {
    const now = performance.now();
    if (now - this.hudCheckedAt > 500) {
      this.hudCheckedAt = now;
      this.hudRects = [...document.querySelectorAll<HTMLElement>('.hud-left, .hud-right')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.getBoundingClientRect());
      this.hudBottom = Math.max(0, ...this.hudRects.map((r) => r.bottom));
    }
    const left = cx - w / 2;
    const right = cx + w / 2;
    const top = bottom - hgt;
    return this.hudRects.some((r) => left < r.right + 6 && right > r.left - 6 && top < r.bottom + 4 && bottom > r.top);
  }

  private frame() {
    const room = this.room;
    if (!room) return;
    for (let s = 0; s < this.tags.length; s++) {
      const tag = this.tags[s]!;
      if (tag.el.style.display === 'none') continue;
      const anchor = this.board.seatAnchor(s, this.tmp);
      if (!anchor) {
        tag.el.style.visibility = 'hidden';
        continue;
      }
      let p2 = this.stage.project(anchor, this.tmp2);
      if (p2.z > 1) {
        tag.el.style.visibility = 'hidden';
        continue;
      }
      tag.el.style.visibility = '';
      let x = Math.max(70, Math.min(this.stage.width - 70, p2.x));
      let y = Math.max(46, p2.y);
      // If the tag would sit under the top HUD, drop it onto the player's chest instead.
      if (this.overlapsHud(x, y, tag.el.offsetWidth || 150, tag.el.offsetHeight || 40) && this.board.seatAnchor(s, this.tmp, true)) {
        p2 = this.stage.project(this.tmp, this.tmp2);
        x = Math.max(70, Math.min(this.stage.width - 70, p2.x));
        y = Math.max(this.hudBottom + 44, p2.y);
      }
      tag.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      tag.el.style.left = '0';
      tag.el.style.top = '0';
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
  }

  get offset() {
    return this.clockOffset;
  }
}
