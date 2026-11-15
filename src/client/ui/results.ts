import type { Card } from '../../shared/cards';
import type { RoundResult, Team } from '../../shared/chkobba';
import type { RoomView } from '../../shared/protocol';
import { cardCanvas } from '../game3d/cardMesh';
import { sfx } from '../sfx';
import { h, modal, type ModalHandle } from './dom';
import { teamNames } from './hud';

export function miniCard(card: Card | string, w = 44): HTMLCanvasElement {
  const id = typeof card === 'string' ? card : card.id;
  const src = cardCanvas(id);
  const c = document.createElement('canvas');
  const scale = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * scale);
  c.height = Math.round(w * 1.5 * scale);
  c.className = 'mini-card';
  c.style.width = `${w}px`;
  c.style.height = `${w * 1.5}px`;
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function sideLabel(room: RoomView, team: number): string {
  if (room.seats.length === 2) return room.seats[team]?.name ?? (team === 0 ? 'A' : 'B');
  return teamNames(room, team);
}

export interface ResultsActions {
  continue: () => void;
  rematch: () => void;
  toLobby: () => void;
  leave: () => void;
}

export class ResultsView {
  private handle: ModalHandle | null = null;
  private shownFor = '';
  private countdownEl: HTMLElement | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private room: RoomView | null = null;
  private clockOffset = 0;

  constructor(private readonly actions: ResultsActions) {}

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.handle?.close();
    this.handle = null;
    this.shownFor = '';
  }

  get isOpen() {
    return !!this.handle;
  }

  /** Opens (or refreshes) the results for the current room state. */
  sync(room: RoomView, clockOffset: number) {
    this.room = room;
    this.clockOffset = clockOffset;
    const g = room.game;
    if (!g || !g.lastRound || (room.phase !== 'roundOver' && room.phase !== 'gameOver')) {
      if (this.handle) this.close();
      return;
    }
    const key = `${room.phase}:${g.lastRound.round}:${g.round}`;
    if (key !== this.shownFor) {
      this.close();
      this.shownFor = key;
      this.open(room, g.lastRound);
    }
    this.refreshReady();
  }

  private open(room: RoomView, r: RoundResult) {
    const over = room.phase === 'gameOver';
    const my = room.you.seat;
    const myTeam: Team | null = my === null ? null : ((my % 2) as Team);
    const isHost = room.hostId === room.you.id;

    const winCell = (t: Team | null, team: Team, content: (string | HTMLElement)[]) =>
      h('td', { class: t === team ? 'win' : '' }, h('span', { class: 'cell' }, ...content, t === team ? h('span', { class: 'point' }, '+1') : null));

    let delay = 0;
    const row = (cat: string, sub: string, cells: HTMLElement[]) => {
      const tr = h('tr', null, h('td', null, h('div', { class: 'cat' }, cat, h('small', null, sub))), ...cells);
      for (const td of Array.from(tr.children) as HTMLElement[]) td.style.animationDelay = `${delay}ms`;
      delay += 140;
      return tr;
    };

    const s = r.stats;
    const haya = (t: Team) => (s[t].haya ? [miniCard('7D', 26)] : ['—']);
    const table = h(
      'table',
      { class: 'results' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, ''),
          h('th', { style: { color: 'var(--team-a)' } }, sideLabel(room, 0)),
          h('th', { style: { color: 'var(--team-b)' } }, sideLabel(room, 1)),
        ),
      ),
      h(
        'tbody',
        null,
        row('Karta', 'most cards', [winCell(r.karta, 0, [String(s[0].cards)]), winCell(r.karta, 1, [String(s[1].cards)])]),
        row('Dinari', 'most diamonds ♦', [winCell(r.dinari, 0, [String(s[0].diamonds)]), winCell(r.dinari, 1, [String(s[1].diamonds)])]),
        row('Bermila', 'most 7s (then 6s)', [
          winCell(r.bermila, 0, [`${s[0].sevens}×7 · ${s[0].sixes}×6`]),
          winCell(r.bermila, 1, [`${s[1].sevens}×7 · ${s[1].sixes}×6`]),
        ]),
        row("Sab'a el Haya", 'the 7 of diamonds', [winCell(r.haya, 0, haya(0)), winCell(r.haya, 1, haya(1))]),
        row('Chkobba', 'table sweeps', [
          h('td', { class: s[0].chkobbas ? 'win' : '' }, String(s[0].chkobbas), s[0].chkobbas ? h('span', { class: 'point', style: 'margin-left:6px' }, `+${s[0].chkobbas}`) : null),
          h('td', { class: s[1].chkobbas ? 'win' : '' }, String(s[1].chkobbas), s[1].chkobbas ? h('span', { class: 'point', style: 'margin-left:6px' }, `+${s[1].chkobbas}`) : null),
        ]),
      ),
    );

    const totals = h(
      'div',
      { class: 'totals' },
      h('div', { class: 't a' }, h('div', { class: 'n' }, String(r.totals[0])), h('div', { class: 'plus' }, `+${r.points[0]}`)),
      h('div', { class: 'vs' }, `of ${room.settings.targetScore}`),
      h('div', { class: 't b' }, h('div', { class: 'n' }, String(r.totals[1])), h('div', { class: 'plus' }, `+${r.points[1]}`)),
    );

    const content = h('div');
    if (over && r.winner !== null) {
      const won = myTeam === r.winner;
      const title = myTeam === null ? `${sideLabel(room, r.winner)} win${room.seats.length === 2 ? 's' : ''}!` : won ? 'Mabrouk! You win! 🏆' : 'Hard luck — next time!';
      content.append(
        h('div', { class: 'winner-title' }, title),
        h('div', { class: 'muted', style: 'text-align:center;margin-bottom:8px' }, `Final score ${r.totals[0]} – ${r.totals[1]}`),
      );
      sfx.play(won || myTeam === null ? 'win' : 'lose');
    } else {
      content.append(h('h2', null, `Hand ${r.round} — results`));
    }
    content.append(table, totals);
    if (r.leftoverTo !== null && r.leftover.length) {
      content.append(
        h(
          'div',
          { class: 'muted', style: 'text-align:center' },
          `${r.leftoverTo === room.you.seat ? 'You' : (room.seats[r.leftoverTo]?.name ?? '?')} took ${
            r.leftover.length > 1 ? `the last ${r.leftover.length} cards` : 'the last card'
          } left on the table.`,
        ),
      );
    }

    const actions = h('div', { class: 'modal-actions' });
    if (over) {
      if (isHost) {
        actions.append(
          h('button', { class: 'btn big', onclick: () => this.actions.rematch() }, '🔁 Rematch'),
          h('button', { class: 'btn blue', onclick: () => this.actions.toLobby() }, 'Back to lobby'),
        );
      } else actions.append(h('div', { class: 'chip' }, 'Waiting for the host…'));
      actions.append(h('button', { class: 'btn coral', onclick: () => this.actions.leave() }, 'Leave'));
    } else if (my !== null) {
      this.continueBtn = h(
        'button',
        {
          class: 'btn big',
          onclick: () => {
            sfx.play('click');
            this.actions.continue();
            if (this.continueBtn) {
              this.continueBtn.disabled = true;
              this.continueBtn.textContent = 'Ready ✓';
            }
          },
        },
        'Next hand ▶',
      );
      actions.append(this.continueBtn);
    }
    content.append(actions);
    this.countdownEl = over ? null : h('div', { class: 'countdown' });
    if (this.countdownEl) content.append(this.countdownEl);

    this.handle = modal(content, { dismissable: false });
    if (!over) this.timer = setInterval(() => this.refreshReady(), 250);
  }

  private refreshReady() {
    const room = this.room;
    if (!room?.game || !this.countdownEl) return;
    const g = room.game;
    const waiting = room.seats
      .filter((p) => p && !p.bot && p.connected && !p.autopilot && !g.ready.includes(p.id))
      .map((p) => (p!.id === room.you.id ? 'you' : p!.name));
    let txt = '';
    if (g.nextRoundAt) {
      const left = Math.max(0, Math.ceil((g.nextRoundAt + this.clockOffset - Date.now()) / 1000));
      txt = `Next hand in ${left}s`;
    }
    if (waiting.length) txt += `${txt ? ' · ' : ''}waiting for ${waiting.join(', ')}`;
    this.countdownEl.textContent = txt;
    if (this.continueBtn && room.game.ready.includes(room.you.id)) {
      this.continueBtn.disabled = true;
      this.continueBtn.textContent = 'Ready ✓';
    }
  }
}
