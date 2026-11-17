import { SUITS, type Suit, isRed, suitName, suitSymbol } from '../../shared/cards';
import { type AuctionCall, BID_STEP, type ContractValue, MAX_BID, auctionOptions, contractLabel } from '../../shared/belote';
import type { RoomView } from '../../shared/protocol';
import { teamOf } from '../../shared/teams';
import { sfx } from '../sfx';
import { h } from './dom';

const valueText = (v: ContractValue) => (v === 'kabbout' ? 'Kabbout' : String(v));

/**
 * The Belote auction for the local player: choose a value (90 to 160, or Kabbout) and click the trump suit to
 * bid it; or pass; or say contre to the other team's bid; or, after a contre on their own team's bid, answer
 * surcontre. Shown whenever it is their turn to speak, so it comes back after a reload.
 */
export class BidPanel {
  readonly el = h('div', { class: 'panel bid-panel hidden' });
  private shownFor = '';
  private busy = false;

  constructor(private readonly send: (call: AuctionCall) => Promise<boolean>) {}

  /** `ready`: it is the local player's turn to speak and the table has finished animating. */
  sync(room: RoomView | null, ready: boolean) {
    const g = room?.game;
    const seat = room?.you.seat ?? null;
    if (!room || !g || g.kind !== 'belote' || !ready || g.stage !== 'bidding' || seat === null || g.turn !== seat) {
      this.el.classList.add('hidden');
      this.shownFor = '';
      return;
    }
    const key = `${g.round}:${g.dealer}:${g.auction.length}`;
    if (key === this.shownFor) return;
    this.shownFor = key;
    this.busy = false;
    const o = auctionOptions(g, seat);
    const contract = g.contract;
    const name = (s: number) => (teamOf(s) === teamOf(seat) ? 'your partner' : (room.seats[s]?.name ?? '?'));

    const choose = async (call: AuctionCall, btn: HTMLButtonElement) => {
      if (this.busy) return;
      this.busy = true;
      sfx.play(call.type === 'pass' ? 'click' : 'select');
      btn.classList.add('chosen');
      const ok = await this.send(call);
      if (ok) this.el.classList.add('hidden');
      else {
        this.busy = false;
        btn.classList.remove('chosen');
      }
    };
    const pass: HTMLButtonElement = h('button', { class: 'btn ghost bid-pass', onclick: () => void choose({ type: 'pass' }, pass) }, 'Pass');

    // After a contre: surcontre (×4) or pass.
    if (o.surcontre && contract) {
      const sur: HTMLButtonElement = h('button', { class: 'btn coral bid-surcontre', onclick: () => void choose({ type: 'surcontre' }, sur) }, 'Surcontre ×4');
      this.el.replaceChildren(
        h('div', { class: 'bid-title' }, 'Contré!'),
        h('div', { class: 'bid-sub' }, `${g.coincheBy === null ? 'They' : name(g.coincheBy)} doubled ${contractLabel(contract)}. Double again?`),
        h('div', { class: 'bid-actions' }, sur, pass),
      );
      this.el.classList.remove('hidden');
      return;
    }

    // The values this player may bid: from the minimum up to 160, then Kabbout.
    const values: ContractValue[] = [];
    if (o.minBid !== null) for (let v = o.minBid; v <= MAX_BID; v += BID_STEP) values.push(v);
    if (o.kabbout) values.push('kabbout');
    let index = 0;
    const valueEl = h('div', { class: 'bid-value' });
    const down: HTMLButtonElement = h('button', { class: 'btn small ghost bid-step', title: 'Lower', onclick: () => step(-1) }, '−');
    const up: HTMLButtonElement = h('button', { class: 'btn small ghost bid-step', title: 'Higher', onclick: () => step(1) }, '+');
    const suitButtons = SUITS.map((suit: Suit) => {
      const btn: HTMLButtonElement = h(
        'button',
        { class: `btn bid-suit ${isRed(suit) ? 'red' : 'black'}`, onclick: () => void choose({ type: 'bid', value: values[index]!, suit }, btn) },
        suitSymbol(suit),
      );
      return { suit, btn };
    });
    const refresh = () => {
      const v = values[index]!;
      valueEl.textContent = valueText(v);
      valueEl.classList.toggle('kabbout', v === 'kabbout');
      down.disabled = index === 0;
      up.disabled = index === values.length - 1;
      for (const { suit, btn } of suitButtons) btn.title = `Bid ${valueText(v)} with ${suitName(suit).toLowerCase()} as trumps`;
    };
    const step = (d: number) => {
      const next = Math.max(0, Math.min(values.length - 1, index + d));
      if (next === index) return;
      index = next;
      sfx.play('hover');
      refresh();
    };

    const sub = contract ? `Best bid: ${contractLabel(contract)} (${name(contract.seat)})` : 'Nobody has bid yet: 90 or more, or pass.';
    const children: HTMLElement[] = [h('div', { class: 'bid-title' }, 'Your bid'), h('div', { class: 'bid-sub' }, sub)];
    if (values.length > 0) {
      refresh();
      children.push(h('div', { class: 'bid-stepper' }, down, valueEl, up), h('div', { class: 'bid-actions suits' }, ...suitButtons.map((b) => b.btn)));
    }
    const row: HTMLElement[] = [];
    if (o.contre) {
      const contre: HTMLButtonElement = h('button', { class: 'btn coral bid-contre', title: 'Double their contract', onclick: () => void choose({ type: 'contre' }, contre) }, 'Contre ×2');
      row.push(contre);
    }
    row.push(pass);
    children.push(h('div', { class: 'bid-actions' }, ...row));
    this.el.replaceChildren(...children);
    this.el.classList.remove('hidden');
  }
}
