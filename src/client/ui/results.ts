import { suitName, suitSymbol } from '../../shared/cards';
import type { RoundResult, Team } from '../../shared/chkobba';
import { type BeloteRoundResult, declarationName } from '../../shared/belote';
import type { RoomView } from '../../shared/protocol';
import { teamOf } from '../../shared/teams';
import { sfx } from '../sfx';
import { h, modal, type ModalHandle } from './dom';
import { teamNames } from './hud';
import { miniCard } from './miniCard';

export { miniCard };

function sideLabel(room: RoomView, team: number): string {
  if (room.seats.length === 2) return room.seats[team]?.name ?? (team === 0 ? 'A' : 'B');
  return teamNames(room, team);
}

function seatName(room: RoomView, seat: number): string {
  return seat === room.you.seat ? 'You' : (room.seats[seat]?.name ?? '?');
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
      this.open(room);
    }
    this.refreshReady();
  }

  private open(room: RoomView) {
    const g = room.game!;
    const r = g.lastRound!;
    const over = room.phase === 'gameOver';
    const my = room.you.seat;
    const myTeam: Team | null = my === null ? null : teamOf(my);
    const isHost = room.hostId === room.you.id;

    const content = h('div');
    if (over && r.winner !== null) {
      const won = myTeam === r.winner;
      const title = myTeam === null ? `${sideLabel(room, r.winner)} win${room.seats.length === 2 ? 's' : ''}!` : won ? 'Mabrouk! You win! 🏆' : 'Hard luck — next time!';
      content.append(
        h('div', { class: 'winner-title' }, title),
        h('div', { class: 'muted', style: 'text-align:center;margin-bottom:8px' }, `Final score ${r.totals[0]} – ${r.totals[1]}`),
      );
      sfx.play(won || myTeam === null ? 'win' : 'lose');
    } else if (g.kind === 'belote' && g.lastRound) {
      const b = g.lastRound;
      content.append(
        h('h2', null, `Hand ${r.round} — ${seatName(room, b.taker)} took `, h('span', { class: `suit-${b.trump}` }, suitSymbol(b.trump))),
      );
    } else content.append(h('h2', null, `Hand ${r.round} — results`));

    if (g.kind === 'belote' && g.lastRound) content.append(...this.beloteBody(room, g.lastRound));
    else if (g.kind === 'chkobba' && g.lastRound) content.append(...this.chkobbaBody(room, g.lastRound));

    content.append(
      h(
        'div',
        { class: 'totals' },
        h('div', { class: 't a' }, h('div', { class: 'n' }, String(r.totals[0])), h('div', { class: 'plus' }, `+${r.points[0]}`)),
        h('div', { class: 'vs' }, `of ${room.settings.targetScore}`),
        h('div', { class: 't b' }, h('div', { class: 'n' }, String(r.totals[1])), h('div', { class: 'plus' }, `+${r.points[1]}`)),
      ),
    );
    if (g.kind === 'chkobba' && g.lastRound && g.lastRound.leftoverTo !== null && g.lastRound.leftover.length) {
      const c = g.lastRound;
      content.append(
        h(
          'div',
          { class: 'muted', style: 'text-align:center' },
          `${seatName(room, c.leftoverTo!)} took ${c.leftover.length > 1 ? `the last ${c.leftover.length} cards` : 'the last card'} left on the table.`,
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

  /** Rows are revealed one after the other. */
  private rows() {
    let delay = 0;
    return (cat: string, sub: string, cells: HTMLElement[]) => {
      const tr = h('tr', null, h('td', null, h('div', { class: 'cat' }, cat, h('small', null, sub))), ...cells);
      for (const td of Array.from(tr.children) as HTMLElement[]) td.style.animationDelay = `${delay}ms`;
      delay += 140;
      return tr;
    };
  }

  private table(room: RoomView, rows: HTMLElement[]): HTMLElement {
    return h(
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
      h('tbody', null, ...rows),
    );
  }

  private chkobbaBody(room: RoomView, r: RoundResult): HTMLElement[] {
    const winCell = (t: Team | null, team: Team, content: (string | HTMLElement)[]) =>
      h('td', { class: t === team ? 'win' : '' }, h('span', { class: 'cell' }, ...content, t === team ? h('span', { class: 'point' }, '+1') : null));
    const row = this.rows();
    const s = r.stats;
    const haya = (t: Team) => (s[t].haya ? [miniCard('7D', 26)] : ['—']);
    return [
      this.table(room, [
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
      ]),
    ];
  }

  private beloteBody(room: RoomView, r: BeloteRoundResult): HTMLElement[] {
    const row = this.rows();
    const takers = teamOf(r.taker);
    const cell = (text: string, win = false) => h('td', { class: win ? 'win' : '' }, text);
    const cards = (t: Team) => {
      const tricks = `${r.tricks[t]} trick${r.tricks[t] === 1 ? '' : 's'}`;
      return h('td', { class: r.capot === t ? 'win' : '' }, h('span', { class: 'cell stack' }, String(r.cardPoints[t]), h('small', { class: 'cell-sub' }, r.capot === t ? 'capot!' : tricks)));
    };
    const decl = r.declarations;
    const declCell = (t: Team) => {
      if (decl.team !== t) return cell('—');
      const names = decl.counted.map((d) => declarationName(d));
      return h('td', { class: 'win' }, h('span', { class: 'cell stack' }, String(decl.points[t]), h('small', { class: 'cell-sub' }, names.join(', '))));
    };
    const rows = [
      row('Cards', `trick points · 10 for the last`, [cards(0), cards(1)]),
      row('Belote', 'king & queen of trumps', [cell(r.belote === 0 ? '20' : '—', r.belote === 0), cell(r.belote === 1 ? '20' : '—', r.belote === 1)]),
    ];
    if (room.settings.announcements || decl.team !== null) rows.push(row('Announcements', 'the best ones count', [declCell(0), declCell(1)]));
    rows.push(row('Made', `takers need more than half`, [cell(String(r.made[0]), r.made[0] > r.made[1]), cell(String(r.made[1]), r.made[1] > r.made[0])]));

    const verdict = h('div', { class: `verdict ${r.outcome}` });
    const sym = suitSymbol(r.trump);
    const taker = seatName(room, r.taker);
    const defenders = sideLabel(room, takers === 0 ? 1 : 0);
    if (r.outcome === 'made') {
      verdict.append(r.capot === takers ? `🎉 Capot! ${taker} took ${sym} and every trick.` : `✓ ${taker} took ${sym} and made it: ${r.made[takers]} to ${r.made[1 - takers]}.`);
    } else if (r.outcome === 'dedans') {
      verdict.append(`💥 Dedans! ${taker} took ${sym} (${suitName(r.trump).toLowerCase()}) but made only ${r.made[takers]}: ${defenders} score ${r.capot !== null ? 250 : 162}${decl.team !== null ? ' + announcements' : ''}.`);
    } else verdict.append(`⚖️ Litige — ${r.made[takers]} each. ${r.reserveOut} points wait for whoever wins the next hand.`);
    if (r.reserveIn > 0 && r.reserveTo !== null) verdict.append(h('div', { class: 'muted' }, `+${r.reserveIn} held over from the litige go to ${sideLabel(room, r.reserveTo)}.`));
    return [this.table(room, rows), verdict];
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
