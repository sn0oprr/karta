import { teamOf } from '../../shared/chkobba';
import type { RoomView } from '../../shared/protocol';
import { sfx } from '../sfx';
import { copyText, h, toast } from './dom';

export interface HudActions {
  leave: () => void;
  rules: () => void;
  toggleChat: () => void;
  toggleEmotes: () => void;
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
export class Hud {
  readonly el: HTMLElement;
  private scoreA = h('div', { class: 'pts' }, '0');
  private scoreB = h('div', { class: 'pts' }, '0');
  private namesA = h('div', { class: 'names' });
  private namesB = h('div', { class: 'names' });
  private mid = h('div', { class: 'score-mid' });
  private banner = h('div', { class: 'turn-banner hidden-soft' });
  private codeChip = h('button', { class: 'chip code-chip', title: 'Copy invite link' });
  private chatBtn: HTMLButtonElement;
  private chatCount = h('span', { class: 'counter-dot hidden' }, '0');
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
      ),
      h('div', { class: 'dock' }, this.micBtn, this.voiceBtn),
    );
    this.el = h('div', { class: 'hud' }, top, this.banner, bottom, this.spectatorBar);
  }

  private bannerText = '';
  private deadline: number | null = null;

  private tickCountdown() {
    if (this.deadline === null) return;
    const left = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    this.banner.textContent = `${this.bannerText}  ⏱ ${left}s`;
    this.banner.classList.toggle('urgent', left <= 5);
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
      const narrow = window.innerWidth < 720;
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
