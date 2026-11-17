import { SUITS, type Suit, isRed, suitName, suitSymbol } from '../../shared/cards';
import type { RoomView } from '../../shared/protocol';
import type { BRank } from '../../shared/belote';
import { sfx } from '../sfx';
import { h } from './dom';
import { miniCard } from './miniCard';

const RANK_NAMES: Record<BRank, string> = { '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten', J: 'jack', Q: 'queen', K: 'king', A: 'ace' };

/**
 * Belote bidding for the local player: take the turned card's suit as trumps (or, in the second round,
 * name another suit), or pass. Shown whenever it is their turn to bid, so it comes back after a reload.
 */
export class BidPanel {
  readonly el = h('div', { class: 'panel bid-panel hidden' });
  private shownFor = '';
  private busy = false;

  constructor(private readonly send: (suit: Suit | null) => Promise<boolean>) {}

  /** `ready`: it is the local player's turn to bid and the table has finished animating. */
  sync(room: RoomView | null, ready: boolean) {
    const g = room?.game;
    if (!room || !g || g.kind !== 'belote' || !ready || g.stage !== 'bidding' || !g.upCard || g.turn !== room.you.seat) {
      this.el.classList.add('hidden');
      this.shownFor = '';
      return;
    }
    const key = `${g.round}:${g.dealer}:${g.bidRound}:${g.bids.length}:${g.upCard.id}`;
    if (key === this.shownFor) return;
    this.shownFor = key;
    this.busy = false;
    const up = g.upCard;

    const choose = async (suit: Suit | null, btn: HTMLButtonElement) => {
      if (this.busy) return;
      this.busy = true;
      sfx.play(suit ? 'select' : 'click');
      btn.classList.add('chosen');
      const ok = await this.send(suit);
      if (ok) this.el.classList.add('hidden');
      else {
        this.busy = false;
        btn.classList.remove('chosen');
      }
    };
    const suitButton = (suit: Suit, label: string) => {
      const btn: HTMLButtonElement = h(
        'button',
        { class: `btn bid-take ${isRed(suit) ? 'red' : 'black'}`, title: `${suitName(suit)} as trumps`, onclick: () => void choose(suit, btn) },
        h('span', { class: 'sym' }, suitSymbol(suit)),
        label,
      );
      return btn;
    };
    const pass: HTMLButtonElement = h('button', { class: 'btn ghost bid-pass', onclick: () => void choose(null, pass) }, 'Pass');

    if (g.bidRound === 1) {
      this.el.replaceChildren(
        h('div', { class: 'bid-title' }, `Take the ${suitSymbol(up.suit)}?`),
        h('div', { class: 'bid-card' }, miniCard(up.id, 54)),
        h('div', { class: 'bid-sub' }, `${suitName(up.suit)} would be trumps, and the ${RANK_NAMES[up.rank]} is yours.`),
        h('div', { class: 'bid-actions' }, suitButton(up.suit, 'Take'), pass),
      );
    } else {
      this.el.replaceChildren(
        h('div', { class: 'bid-title' }, 'Second round'),
        h('div', { class: 'bid-sub' }, `Name the trumps (not ${suitSymbol(up.suit)}) and the ${RANK_NAMES[up.rank]} is yours — or pass.`),
        h('div', { class: 'bid-actions suits' }, ...SUITS.filter((s) => s !== up.suit).map((s) => suitButton(s, '')), pass),
      );
    }
    this.el.classList.remove('hidden');
  }
}
