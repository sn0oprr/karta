import { teamOf } from '../../shared/chkobba';
import type { RoomView } from '../../shared/protocol';
import type { Rect } from '../game3d/viewFit';
import { sfx } from '../sfx';
import { copyText, h, toast } from './dom';

export interface HudActions {
  leave: () => void;
  rules: () => void;
  toggleChat: () => void;
  toggleEmotes: () => void;
  toggleCafe: () => void;
  toggleVoice: () => void;
  toggleMic: () => void;
  rotateView: (step: number) => void;
  takeSeat: (seat: number) => void;
}

export function teamNames(room: RoomView, team: number): string {
  return room.seats
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => teamOf(i) === team)
    .sort((a, b) => (a.i === room.you.seat ? -1 : b.i === room.you.seat ? 1 : 0))
    .map(({ p, i }) => (i === room.you.seat ? 'You' : (p?.name ?? '—')))
    .join(' & ');
}

/** In-game heads-up display: scoreboard, turn banner, buttons. */
/** The stylesheet's phone layouts: a narrow screen, or a short one held sideways. */
const COMPACT = '(max-width: 720px), (max-height: 500px) and (orientation: landscape)';

export class Hud {
  readonly el: HTMLElement;
  private scoreA = h('div', { class: 'pts' }, '0');
  private scoreB = h('div', { class: 'pts' }, '0');
  private namesA = h('div', { class: 'names' });
  private namesB = h('div', { class: 'names' });
  private mid = h('div', { class: 'score-mid' });
  private banner = h('div', { class: 'turn-banner hidden-soft' });
  /** Fixed place reserved for the banner, so the camera keeps the cards out of it whatever it says. */
  private bannerSlot = h('div', { class: 'banner-slot' }, this.banner);
  /** Measures what the banner may say, to check it fits in its slot. */
  private bannerProbe = h('div', { class: 'turn-banner banner-probe', 'aria-hidden': 'true' });
  /** Everything the banner can say in this game, in its short (phone) wording. */
  private bannerTexts: string[] = [];
  private bannerFitKey = '';
  private top: HTMLElement;
  private bottom: HTMLElement;
  private seated = false;
  private codeChip = h('button', { class: 'chip code-chip', title: 'Copy invite link' });
  private chatBtn: HTMLButtonElement;
  private chatCount = h('span', { class: 'counter-dot hidden' }, '0');
  private cafeBtn: HTMLButtonElement;
  private voiceBtn: HTMLButtonElement;
  private micBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private spectatorBar = h('div', { class: 'spectator-bar hidden' });
  private lastScores: [number, number] = [0, 0];
  private seatMenuOpen = false;
  private lastTurnKey = '';
  private code = '';

  constructor(private readonly actions: HudActions) {
    setInterval(() => this.tickCountdown(), 250);
    this.codeChip.addEventListener('click', async () => {
      if (await copyText(`${location.origin}/room/${this.code}`)) toast('Invite link copied!');
    });
    this.soundBtn = h(
      'button',
      {
        class: 'btn ghost icon-btn small',
        title: 'Sound effects',
        onclick: () => {
          sfx.unlock();
          sfx.setMuted(!sfx.muted);
          this.soundBtn.textContent = sfx.muted ? '🔇' : '🔊';
        },
      },
      sfx.muted ? '🔇' : '🔊',
    );
    const top = h(
      'div',
      { class: 'hud-top' },
      h(
        'div',
        { class: 'hud-left' },
        h('button', { class: 'btn coral icon-btn small', title: 'Leave table', onclick: () => actions.leave() }, '⟵'),
        h(
          'div',
          { class: 'scoreboard' },
          h('div', { class: 'score-team a' }, this.scoreA, this.namesA),
          this.mid,
          h('div', { class: 'score-team b' }, this.scoreB, this.namesB),
        ),
      ),
      h(
        'div',
        { class: 'hud-right' },
        this.codeChip,
        this.soundBtn,
        h('button', { class: 'btn ghost icon-btn small', title: 'How to play', onclick: () => actions.rules() }, '?'),
      ),
    );
    this.chatBtn = h('button', { class: 'btn ghost icon-btn', title: 'Chat', onclick: () => actions.toggleChat() }, '💬', this.chatCount);
    this.cafeBtn = h(
      'button',
      { class: 'btn ghost icon-btn cafe-btn', title: 'Café: your order and your character', onclick: () => actions.toggleCafe() },
      '☕',
    );
    this.voiceBtn = h('button', { class: 'btn teal icon-btn voice-btn', title: 'Join voice chat', onclick: () => actions.toggleVoice() }, '🎧');
    this.micBtn = h('button', { class: 'btn icon-btn hidden', title: 'Microphone (hold V to talk)', onclick: () => actions.toggleMic() }, '🎙️');
    const bottom = h(
      'div',
      { class: 'hud-bottom' },
      h(
        'div',
        { class: 'dock' },
        this.chatBtn,
        h('button', { class: 'btn ghost icon-btn', title: 'Reactions', onclick: () => actions.toggleEmotes() }, '😄'),
        this.cafeBtn,
      ),
      h('div', { class: 'dock' }, this.micBtn, this.voiceBtn),
    );
    this.top = top;
    this.bottom = bottom;
    this.el = h('div', { class: 'hud' }, top, this.bannerSlot, bottom, this.spectatorBar, this.bannerProbe);
    window.addEventListener('resize', () => this.fitBanner());
    void document.fonts?.ready.then(() => {
      this.bannerFitKey = '';
      this.fitBanner();
    });
  }

  /**
   * On phones the banner sits between the docks (or right of the hand on a phone held sideways).
   * When what it may say does not fit there (voice chat's second button, a turn timer's countdown,
   * a long name), it gets a row of its own instead, for the whole game so the camera framing stays.
   */
  private fitBanner() {
    const key = `${window.innerWidth}x${window.innerHeight}|${this.el.classList.contains('voice-on')}|${this.bannerTexts.join('|')}`;
    if (key === this.bannerFitKey) return;
    if (!this.bannerTexts.length) {
      // Spectating: no banner.
      this.bannerFitKey = key;
      this.el.classList.remove('banner-row');
      return;
    }
    let need = 0;
    for (const t of this.bannerTexts) {
      this.bannerProbe.textContent = t;
      need = Math.max(need, this.bannerProbe.offsetWidth);
    }
    if (need === 0) return; // not on screen yet
    this.bannerFitKey = key;
    this.el.style.setProperty('--banner-need', `${Math.ceil(need) + 4}px`);
    this.el.classList.remove('banner-row');
    // (A slot squeezed to nothing measures 0 wide.)
    this.el.classList.toggle('banner-row', this.bannerSlot.getBoundingClientRect().width < need);
  }

  /** Screen boxes the HUD covers, which the 3D view keeps the table cards and faces out of. */
  overlayRects(): Rect[] {
    const els = [
      ...this.top.querySelectorAll<HTMLElement>('.hud-left, .hud-right'),
      ...this.bottom.querySelectorAll<HTMLElement>('.dock'),
      this.spectatorBar,
      ...(this.seated ? [this.bannerSlot] : []),
    ];
    const out: Rect[] = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return out;
  }

  private bannerText = '';
  private deadline: number | null = null;

  private tickCountdown() {
    if (this.deadline === null) return;
    const left = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    this.banner.textContent = `${this.bannerText}  ⏱ ${left}s`;
    this.banner.classList.toggle('urgent', left <= 5);
  }

  /** The café button shows what you are drinking. */
  setDrink(icon: string) {
    this.cafeBtn.textContent = icon;
  }

  setUnread(n: number) {
    this.chatCount.textContent = String(n);
    this.chatCount.classList.toggle('hidden', n === 0);
  }

  setMicLevel(level: number) {
    this.micBtn.style.boxShadow = level > 0.06 ? `0 5px 0 var(--ink), 0 0 0 ${Math.round(3 + level * 9)}px rgba(63,185,80,.55)` : '';
  }

  setVoice(joined: boolean, muted: boolean, hasMic: boolean) {
    this.voiceBtn.textContent = joined ? '📞' : '🎧';
    this.voiceBtn.title = joined ? 'Voice chat (connected)' : 'Join voice chat';
    this.voiceBtn.classList.toggle('teal', !joined);
    this.micBtn.classList.toggle('hidden', !joined);
    this.el.classList.toggle('voice-on', joined);
    this.fitBanner();
    this.micBtn.classList.toggle('mic-on', joined && !muted);
    this.micBtn.classList.toggle('mic-off', joined && muted);
    this.micBtn.textContent = !hasMic ? '🚫' : muted ? '🔇' : '🎙️';
  }

  /** Updates scores / banner from the room as displayed on the board. */
  update(room: RoomView, opts: { myTurnReady: boolean; busy: boolean }) {
    this.code = room.code;
    this.codeChip.textContent = `# ${room.code}`;
    const g = room.game;
    const n = room.seats.length;
    const my = room.you.seat;
    this.seated = my !== null;
    const myTeam = my === null ? 0 : teamOf(my);
    const scores = g?.scores ?? [0, 0];
    const label = (t: number) => (n === 2 ? (t === my ? 'You' : (room.seats[t]?.name ?? '—')) : teamNames(room, t));
    this.namesA.textContent = label(0);
    this.namesB.textContent = label(1);
    void myTeam;
    for (const t of [0, 1] as const) {
      const el = t === 0 ? this.scoreA : this.scoreB;
      el.textContent = String(scores[t]);
      if (scores[t] !== this.lastScores[t]) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
    }
    this.lastScores = [scores[0], scores[1]];
    this.mid.replaceChildren(
      h('div', null, 'to'),
      h('div', { class: 'target' }, String(room.settings.targetScore)),
      ...(g ? [h('div', null, `hand ${g.round}`)] : []),
    );

    // Turn banner.
    let text = '';
    let mine = false;
    if (room.phase === 'playing' && g) {
      const p = room.seats[g.turn];
      const narrow = matchMedia(COMPACT).matches;
      if (g.turn === my) {
        mine = true;
        text = narrow ? 'Your turn!' : opts.myTurnReady ? 'Your turn — pick a card!' : 'Your turn…';
      } else if (p) text = narrow ? `${p.name}…` : p.bot ? `${p.name} is thinking…` : `${p.name}'s turn`;
      if (g.deckCount > 0 && mine && !narrow) text += `  ·  deck ${g.deckCount}`;
    }
    const key = `${text}|${mine}`;
    if (key !== this.lastTurnKey) {
      this.lastTurnKey = key;
      this.bannerText = text;
      this.banner.textContent = text;
      this.banner.classList.toggle('mine', mine);
      this.banner.classList.toggle('hidden-soft', !text);
    }
    this.deadline = mine && g?.turnDeadline ? g.turnDeadline + (Date.now() - room.serverTime) : null;
    this.tickCountdown();
    // The short wordings above (with the longest countdown), for checking where the banner fits.
    this.bannerTexts =
      my === null
        ? []
        : [
            `Your turn!${room.settings.turnSeconds > 0 ? `  ⏱ ${room.settings.turnSeconds}s` : ''}`,
            ...room.seats.flatMap((p, i) => (p && i !== my ? [`${p.name}…`] : [])),
          ];
    this.fitBanner();

    // Spectator controls.
    if (my === null && room.phase !== 'lobby') {
      this.banner.classList.add('hidden-soft');
      const takeable = room.seats
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p && (p.bot || !p.connected || p.autopilot));
      const menu = h(
        'div',
        { class: `panel seat-menu ${this.seatMenuOpen ? '' : 'hidden'}` },
        h('div', { class: 'label' }, 'Take over a seat'),
        ...takeable.map(({ p, i }) =>
          h(
            'button',
            {
              class: 'btn small ghost',
              onclick: () => {
                this.seatMenuOpen = false;
                this.actions.takeSeat(i);
              },
            },
            `${p!.bot ? '🤖' : '💤'} ${p!.name}`,
          ),
        ),
      );
      this.spectatorBar.replaceChildren(
        h('button', { class: 'btn small ghost icon-btn', title: 'Rotate view', onclick: () => this.actions.rotateView(-1) }, '⟲'),
        h('span', { class: 'chip' }, '👀 Spectating'),
        h('button', { class: 'btn small ghost icon-btn', title: 'Rotate view', onclick: () => this.actions.rotateView(1) }, '⟳'),
        ...(takeable.length
          ? [
              h(
                'button',
                {
                  class: 'btn small',
                  title: 'Play instead of a bot or an away player',
                  onclick: () => {
                    this.seatMenuOpen = !this.seatMenuOpen;
                    menu.classList.toggle('hidden', !this.seatMenuOpen);
                  },
                },
                '🪑 Take a seat',
              ),
            ]
          : []),
        menu,
      );
      this.spectatorBar.classList.remove('hidden');
    } else this.spectatorBar.classList.add('hidden');
    void opts.busy;
  }
}
