import { describe, expect, it } from 'vitest';
import { SUITS, type Suit, isCardId, seededRandom } from '../src/shared/cards';
import {
  type AuctionCall,
  type BCard,
  BeloteGame,
  type Contract,
  type TrickPlay,
  auctionOptions,
  callLabel,
  cardPoints,
  illegalReason,
  isBeloteCardId,
  legalCards,
  makeBeloteDeck,
  parseBeloteCard,
  parseCall,
  roundTen,
  scoreBeloteHand,
  sortBeloteHand,
  trickWinner,
} from '../src/shared/belote';
import { teamOf } from '../src/shared/teams';

const c = (id: string): BCard => parseBeloteCard(id);
const cards = (list: string): BCard[] => list.split(' ').filter(Boolean).map(c);
const ids = (list: readonly BCard[]) => list.map((x) => x.id).sort();
/** A trick so far: "seat:card" entries in play order. */
const trick = (list: string): TrickPlay[] =>
  list
    .split(' ')
    .filter(Boolean)
    .map((e) => {
      const [seat, id] = e.split(':');
      return { seat: Number(seat), card: c(id!) };
    });
const bid = (value: number | 'kabbout', suit: Suit): AuctionCall => ({ type: 'bid', value, suit });
const PASS: AuctionCall = { type: 'pass' };

describe('deck', () => {
  it('has 32 unique cards, 7 to Ace in each suit, with ids no Chkobba card uses', () => {
    const deck = makeBeloteDeck();
    expect(deck).toHaveLength(32);
    expect(new Set(deck.map((d) => d.id)).size).toBe(32);
    for (const d of deck) {
      expect(isBeloteCardId(d.id)).toBe(true);
      expect(isCardId(d.id)).toBe(false);
      expect(parseBeloteCard(d.id)).toEqual(d);
    }
  });

  it('is worth 152 card points whatever the trump suit', () => {
    for (const trump of SUITS) {
      const deck = makeBeloteDeck();
      expect(deck.reduce((s, x) => s + cardPoints(x, trump), 0)).toBe(152);
      expect(deck.filter((x) => x.suit === trump).reduce((s, x) => s + cardPoints(x, trump), 0)).toBe(62);
    }
  });
});

describe('tricks', () => {
  it('goes to the best trump, else to the best card of the suit led', () => {
    expect(trickWinner(trick('0:SA 1:S10 2:SK 3:S7'), 'H').seat).toBe(0);
    expect(trickWinner(trick('0:S10 1:SA 2:H7 3:SK'), 'H').seat).toBe(2);
    expect(trickWinner(trick('0:H8 1:HJ 2:H9 3:HA'), 'H').seat).toBe(1);
    expect(trickWinner(trick('0:S7 1:DA 2:CA 3:S8'), 'H').seat).toBe(3);
    expect(trickWinner(trick('0:SJ 1:SQ'), 'H').seat).toBe(1);
    expect(trickWinner(trick('0:SJ 1:SQ'), 'S').seat).toBe(0);
  });
});

describe('legalCards', () => {
  const legal = (hand: string, t: string, trump: Suit, seat: number) => ids(legalCards(cards(hand), trick(t), trump, seat));

  it('lets the leader play anything and forces following suit', () => {
    expect(legal('SA H7 D9', '', 'H', 0)).toEqual(['D9', 'H7', 'SA']);
    expect(legal('SA S7 H7 D9', '1:SK', 'H', 2)).toEqual(['S7', 'SA']);
  });

  it('forces a higher trump on a trump lead when possible (even over the partner), else any trump', () => {
    expect(legal('HJ H7 HA SA', '0:H9', 'H', 1)).toEqual(['HJ']);
    expect(legal('H7 H8 SA', '0:H9', 'H', 1)).toEqual(['H7', 'H8']);
    expect(legal('HJ H7 SA', '0:H9 1:H8', 'H', 2)).toEqual(['HJ']);
  });

  it('frees a player whose partner is winning, unless they hold nothing but trumps', () => {
    expect(legal('H7 DA C8', '0:SA 1:S7', 'H', 2)).toEqual(['C8', 'DA', 'H7']);
    expect(legal('H9 DA', '1:S7 2:H8 3:SK', 'H', 0)).toEqual(['DA', 'H9']);
    // Only trumps: beat the best trump on the table, even the partner's…
    expect(legal('H9 H7', '1:S7 2:H8 3:SK', 'H', 0)).toEqual(['H9']);
    // …and when none is higher, any trump.
    expect(legal('H7 HQ', '1:S7 2:H9 3:SK', 'H', 0)).toEqual(['H7', 'HQ']);
    expect(legal('H7 HQ', '0:SA 1:S7', 'H', 2)).toEqual(['H7', 'HQ']);
  });

  it('forces trumping an opponent, overtrumping a trump already in, else undertrumping', () => {
    expect(legal('H7 HJ DA', '1:SA', 'H', 2)).toEqual(['H7', 'HJ']);
    expect(legal('H7 HJ DA', '1:SA 2:S7 3:HA', 'H', 0)).toEqual(['HJ']);
    expect(legal('H7 H8 DA', '1:SA 2:S7 3:HA', 'H', 0)).toEqual(['H7', 'H8']);
    expect(legal('DA C8', '1:SA', 'H', 2)).toEqual(['C8', 'DA']);
  });

  it('explains illegal cards', () => {
    expect(illegalReason(cards('SA S7 DA'), trick('1:SK'), 'H', 2, c('DA'))).toBe('You must follow suit (♠)');
    expect(illegalReason(cards('H7 HJ DA'), trick('1:SA'), 'H', 2, c('DA'))).toBe('You must trump (♥)');
    expect(illegalReason(cards('H7 HJ DA'), trick('1:SA 2:S7 3:HA'), 'H', 0, c('H7'))).toBe('You must play a higher trump');
    expect(illegalReason(cards('H9 H7'), trick('1:S7 2:H8 3:SK'), 'H', 0, c('H7'))).toBe('You must play a higher trump');
    expect(illegalReason(cards('SA S7'), trick('1:SK'), 'H', 2, c('S7'))).toBeNull();
  });
});

describe('sortBeloteHand', () => {
  it('puts trumps first, alternates colours and orders by strength', () => {
    expect(sortBeloteHand(cards('S7 HJ H9 C10 DA SA HQ D7'), 'H').map((x) => x.id)).toEqual(['HJ', 'H9', 'HQ', 'C10', 'DA', 'D7', 'SA', 'S7']);
  });
});

describe('roundTen', () => {
  it('rounds trick points to the ten, 5 and up going up', () => {
    expect([0, 4, 5, 84, 85, 86, 88, 94, 96, 162].map(roundTen)).toEqual([0, 0, 10, 80, 90, 90, 90, 90, 100, 160]);
    // "Casse": 96/66 and 87/75 both round up (170 in all); 88/74 is "صحيحة" (160).
    expect(roundTen(96) + roundTen(66)).toBe(170);
    expect(roundTen(87) + roundTen(75)).toBe(170);
    expect(roundTen(88) + roundTen(74)).toBe(160);
  });
});

describe('auction', () => {
  const fresh = (dealer = 3, seed = 1) => {
    const g = new BeloteGame({ targetScore: 1500, firstDealer: dealer, rand: seededRandom(seed) });
    return { g, deal: g.startRound() };
  };

  it('deals 8 cards each, in two lots of 4 from the dealer’s right, and no card is turned up', () => {
    const { g, deal } = fresh(2);
    expect(deal.dealer).toBe(2);
    expect(deal.order).toEqual([3, 3, 3, 3, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(g.hands.every((h) => h.length === 8)).toBe(true);
    expect(new Set(g.hands.flat().map((x) => x.id)).size).toBe(32);
    expect(g.phase).toBe('bidding');
    expect(g.turn).toBe(3);
  });

  it('opens at 90 in steps of 10 up to 160, with Kabbout above everything', () => {
    const { g } = fresh();
    expect(g.isLegalCall(0, bid(80, 'H'))).toBe(false);
    expect(g.isLegalCall(0, bid(95, 'H'))).toBe(false);
    expect(g.isLegalCall(1, bid(90, 'H'))).toBe(false); // not their turn
    g.call(0, bid(90, 'H'));
    expect(g.isLegalCall(1, bid(90, 'S'))).toBe(false);
    g.call(1, bid(150, 'S'));
    g.call(2, bid(160, 'C'));
    expect(auctionOptions(g, 3)).toMatchObject({ minBid: null, kabbout: true, contre: true });
    expect(g.isLegalCall(3, bid(160, 'D'))).toBe(false);
    g.call(3, bid('kabbout', 'D'));
    expect(auctionOptions(g, 0)).toMatchObject({ minBid: null, kabbout: false, contre: true });
    expect(g.isLegalCall(0, bid('kabbout', 'H'))).toBe(false);
  });

  it('lets a player bid again after passing, and outbid their partner, even in the same suit', () => {
    const { g } = fresh();
    g.call(0, PASS);
    g.call(1, bid(90, 'H'));
    g.call(2, PASS);
    g.call(3, bid(100, 'H'));
    g.call(0, bid(110, 'S'));
    g.call(1, PASS);
    expect(g.isLegalCall(2, bid(120, 'S'))).toBe(true);
    g.call(2, bid(120, 'S'));
    expect(g.contract).toEqual({ seat: 2, value: 120, suit: 'S' });
  });

  it('closes after three passes: the player on the dealer’s right leads, and the belote holder is known', () => {
    const { g } = fresh();
    g.call(0, bid(100, 'D'));
    g.call(1, PASS);
    g.call(2, PASS);
    const out = g.call(3, PASS);
    expect(out.contract).toEqual({ contract: { seat: 0, value: 100, suit: 'D' }, coinche: 1, coincheBy: null });
    expect(g.phase).toBe('playing');
    expect(g.trump).toBe('D');
    expect(g.taker).toBe(0);
    expect(g.turn).toBe(0);
    const holder = g.hands.findIndex((h) => h.some((x) => x.id === 'DK') && h.some((x) => x.id === 'DQ'));
    expect(g.beloteHolder).toBe(holder < 0 ? null : holder);
  });

  it('redeals with the next dealer when all four pass', () => {
    const { g } = fresh(3);
    for (const s of [0, 1, 2]) expect(g.call(s, PASS).redeal).toBeUndefined();
    const out = g.call(3, PASS);
    expect(out.redeal).toBeDefined();
    expect(out.redeal!.dealer).toBe(0);
    expect(out.redeal!.redeals).toBe(1);
    expect(g.round).toBe(1);
    expect(g.turn).toBe(1);
    expect(g.auction).toEqual([]);
  });

  it('lets only an opponent say contre; then only the takers speak, each once', () => {
    const { g } = fresh();
    g.call(0, bid(110, 'H'));
    expect(g.isLegalCall(1, { type: 'surcontre' })).toBe(false);
    g.call(1, PASS);
    expect(g.isLegalCall(2, { type: 'contre' })).toBe(false); // the taker's partner
    g.call(2, PASS);
    g.call(3, { type: 'contre' });
    expect(g.coinche).toBe(2);
    expect(g.coincheBy).toBe(3);
    // The takers answer in turn: seat 0, then seat 2. No more bids.
    expect(g.turn).toBe(0);
    expect(auctionOptions(g, 0)).toEqual({ minBid: null, kabbout: false, contre: false, surcontre: true });
    expect(g.isLegalCall(0, bid(120, 'H'))).toBe(false);
    g.call(0, PASS);
    expect(g.turn).toBe(2);
    const out = g.call(2, PASS);
    expect(out.contract).toEqual({ contract: { seat: 0, value: 110, suit: 'H' }, coinche: 2, coincheBy: 3 });
  });

  it('ends the auction at once on a surcontre', () => {
    const { g } = fresh();
    g.call(0, bid(90, 'C'));
    g.call(1, { type: 'contre' });
    expect(g.turn).toBe(2);
    const out = g.call(2, { type: 'surcontre' });
    expect(out.contract?.coinche).toBe(4);
    expect(g.phase).toBe('playing');
  });

  it('rejects malformed calls', () => {
    expect(parseCall({ type: 'bid', value: 90 })).toBeNull();
    expect(parseCall({ type: 'bid', value: 85, suit: 'H' })).toBeNull();
    expect(parseCall({ type: 'bid', value: 'capot', suit: 'H' })).toBeNull();
    expect(parseCall({ type: 'shout' })).toBeNull();
    expect(parseCall(null)).toBeNull();
    expect(parseCall({ type: 'bid', value: 'kabbout', suit: 'S', extra: 1 })).toEqual({ type: 'bid', value: 'kabbout', suit: 'S' });
    expect(callLabel({ type: 'bid', value: 'kabbout', suit: 'S' })).toBe('Kabbout ♠');
    const { g } = fresh();
    expect(() => g.call(0, { type: 'contre' })).toThrow();
    expect(() => g.call(0, { type: 'bid', value: 100 } as never)).toThrow();
  });
});

describe('scoreBeloteHand (the Tunisian scale)', () => {
  const contract = (value: number | 'kabbout', seat = 0): Contract => ({ seat, value, suit: 'H' });
  /** Eight tricks with these winners and points (the last one's 10 included). */
  const tricks = (winners: number[], points: number[]) => winners.map((winner, i) => ({ winner, points: points[i]! }));
  const split = (t0: number, t1: number) => tricks([0, 1, 0, 1, 0, 1, 0, 1], [t0 - 30, t1 - 30, 10, 10, 10, 10, 10, 10]);

  it('gives each team its own points, rounded, when the contract is made', () => {
    const r = scoreBeloteHand({ contract: contract(90), coinche: 1, tricks: split(96, 66), beloteHolder: null });
    expect(r.cardPoints).toEqual([96, 66]);
    expect(r.rounded).toEqual([100, 70]);
    expect(r.outcome).toBe('made');
    expect(r.points).toEqual([100, 70]);
  });

  it('judges the contract on rounded points, the takers’ belote counting', () => {
    expect(scoreBeloteHand({ contract: contract(90), coinche: 1, tricks: split(86, 76), beloteHolder: null }).outcome).toBe('made');
    expect(scoreBeloteHand({ contract: contract(90), coinche: 1, tricks: split(84, 78), beloteHolder: null }).outcome).toBe('failed');
    const withBelote = scoreBeloteHand({ contract: contract(110), coinche: 1, tricks: split(92, 70), beloteHolder: 2 });
    expect(withBelote.made).toEqual([110, 70]);
    expect(withBelote.outcome).toBe('made');
    expect(withBelote.points).toEqual([110, 70]);
    // The defence's belote stays with the defence.
    expect(scoreBeloteHand({ contract: contract(100), coinche: 1, tricks: split(112, 50), beloteHolder: 1 }).points).toEqual([110, 70]);
  });

  it('fails without strictly more than the defence', () => {
    // 82/80 → 80/80 + the defence's belote: 80 against 100.
    const r = scoreBeloteHand({ contract: contract(90), coinche: 1, tricks: split(91, 71), beloteHolder: 3 });
    expect(r.made).toEqual([90, 90]);
    expect(r.outcome).toBe('failed');
  });

  it('gives the defence 160 for a failed contract, plus 20 for a belote whoever held it', () => {
    expect(scoreBeloteHand({ contract: contract(130), coinche: 1, tricks: split(100, 62), beloteHolder: null }).points).toEqual([0, 160]);
    expect(scoreBeloteHand({ contract: contract(130), coinche: 1, tricks: split(100, 62), beloteHolder: 0 }).points).toEqual([0, 180]);
  });

  it('multiplies by 2 on a contre and 4 on a surcontre, belote never multiplied', () => {
    expect(scoreBeloteHand({ contract: contract(100), coinche: 2, tricks: split(110, 52), beloteHolder: null }).points).toEqual([320, 0]);
    expect(scoreBeloteHand({ contract: contract(100), coinche: 4, tricks: split(110, 52), beloteHolder: 1 }).points).toEqual([660, 0]);
    expect(scoreBeloteHand({ contract: contract(140), coinche: 2, tricks: split(110, 52), beloteHolder: 0 }).points).toEqual([0, 340]);
    expect(scoreBeloteHand({ contract: contract(140), coinche: 4, tricks: split(110, 52), beloteHolder: null }).points).toEqual([0, 640]);
  });

  it('scores 250 for all eight tricks without Kabbout, and 500 for Kabbout made or failed', () => {
    const all = tricks([0, 2, 0, 2, 0, 2, 0, 2], [20, 20, 20, 20, 20, 20, 21, 21]);
    expect(scoreBeloteHand({ contract: contract(90), coinche: 1, tricks: all, beloteHolder: 0 })).toMatchObject({ capot: 0, outcome: 'made', points: [270, 0] });
    expect(scoreBeloteHand({ contract: contract('kabbout'), coinche: 1, tricks: all, beloteHolder: null })).toMatchObject({ outcome: 'made', points: [500, 0] });
    expect(scoreBeloteHand({ contract: contract('kabbout'), coinche: 2, tricks: all, beloteHolder: 1 }).points).toEqual([1020, 0]);
    const lost = scoreBeloteHand({ contract: contract('kabbout'), coinche: 1, tricks: [{ winner: 1, points: 15 }], beloteHolder: 0, early: true });
    expect(lost).toMatchObject({ outcome: 'failed', early: true, points: [0, 520] });
  });
});

/** Plays one legal action for whoever is to act (bids with probability `bidRate`). */
function randomStep(game: BeloteGame, rand: () => number, bidRate = 0.3) {
  const seat = game.turn;
  if (game.phase === 'bidding') {
    const o = game.options(seat);
    const calls: AuctionCall[] = [PASS];
    if (o.surcontre) calls.push({ type: 'surcontre' });
    if (o.contre && rand() < 0.1) calls.push({ type: 'contre' });
    if (o.minBid !== null && rand() < bidRate) calls.push(bid(Math.min(160, o.minBid + 10 * Math.floor(rand() * 2)), SUITS[Math.floor(rand() * 4)]!));
    if (o.kabbout && rand() < 0.01) calls.push(bid('kabbout', SUITS[Math.floor(rand() * 4)]!));
    return game.call(seat, calls[Math.floor(rand() * calls.length)]!);
  }
  const legal = game.legalCards(seat);
  return game.play(seat, legal[Math.floor(rand() * legal.length)]!.id);
}

/** Bids `value` in `suit` for the player on the dealer's right, and everyone else passes. */
function takeContract(game: BeloteGame, value: number | 'kabbout', suit: Suit) {
  const first = game.turn;
  game.call(first, bid(value, suit));
  for (let i = 1; i <= 3; i++) game.call((first + i) % 4, PASS);
}

describe('BeloteGame', () => {
  it('announces belote and rebelote with the trump king and queen of their holder', () => {
    const rand = seededRandom(4);
    for (let attempt = 0; attempt < 400; attempt++) {
      const game = new BeloteGame({ targetScore: 1500, rand });
      game.startRound();
      const suit = SUITS[attempt % 4]!;
      takeContract(game, 90, suit);
      if (game.beloteHolder === null) continue;
      const said: string[] = [];
      while (game.phase === 'playing') {
        const out = randomStep(game, rand);
        if ('play' in out && out.play.belote) {
          expect(out.play.seat).toBe(game.beloteHolder);
          said.push(out.play.belote);
        }
      }
      // (The hand may stop early, before both are played.)
      expect(['belote', 'rebelote'].slice(0, said.length)).toEqual(said);
      expect(game.lastRound!.belote).toBe(teamOf(game.beloteHolder));
      if (said.length === 2) return;
    }
    throw new Error('no full belote found');
  });

  it('stops a Kabbout as soon as the defence wins a trick', () => {
    const rand = seededRandom(7);
    for (let attempt = 0; attempt < 50; attempt++) {
      const game = new BeloteGame({ targetScore: 1500, rand });
      game.startRound();
      takeContract(game, 'kabbout', 'S');
      const takers = teamOf(game.taker!);
      let out;
      do out = randomStep(game, rand);
      while (!('round' in out && out.round));
      const r = out.round!;
      if (r.outcome === 'failed') {
        expect(r.early).toBe(true);
        expect(game.tricks.filter((t) => teamOf(t.winner) !== takers)).toHaveLength(1);
        expect(r.points[1 - takers]).toBe(500 + (r.belote !== null ? 20 : 0));
        return;
      }
    }
    throw new Error('no failed kabbout found');
  });

  it('stops a contract the takers can no longer make, and counts it failed', () => {
    const rand = seededRandom(9);
    let stopped = 0;
    for (let attempt = 0; attempt < 200 && stopped < 5; attempt++) {
      const game = new BeloteGame({ targetScore: 1e9, rand });
      game.startRound();
      takeContract(game, 150, SUITS[attempt % 4]!);
      let out;
      do out = randomStep(game, rand);
      while (!('round' in out && out.round));
      const r = out.round!;
      if (!r.early) continue;
      stopped++;
      expect(game.tricks.length).toBeLessThan(8);
      expect(r.outcome).toBe('failed');
      // At the moment it stopped, even every remaining trick could not have reached 150 and beaten the defence.
      const takers = teamOf(game.taker!);
      const theirs = r.cardPoints[1 - takers]!;
      const best = roundTen(162 - theirs) + (r.belote === takers ? 20 : 0);
      expect(best < 150 || best <= roundTen(theirs) + (r.belote === 1 - takers ? 20 : 0)).toBe(true);
    }
    expect(stopped).toBe(5);
  });

  it('plays whole games to the target with every card accounted for', () => {
    for (let g = 0; g < 30; g++) {
      const rand = seededRandom(100 + g);
      const game = new BeloteGame({ targetScore: 1500, rand });
      game.startRound();
      let total: [number, number] = [0, 0];
      for (let steps = 0; steps < 50000 && game.phase !== 'gameOver'; steps++) {
        if (game.phase === 'roundOver') {
          game.startRound();
          continue;
        }
        const out = randomStep(game, rand);
        if ('trick' in out && out.trick) expect(game.piles.flat().length).toBe((out.trick.index + 1) * 4);
        if ('round' in out && out.round) {
          const r = out.round;
          if (!r.early) {
            expect(game.piles.flat()).toHaveLength(32);
            expect(r.cardPoints[0] + r.cardPoints[1]).toBe(162);
          }
          total = [total[0] + r.points[0], total[1] + r.points[1]];
          expect(r.totals).toEqual(total);
        }
      }
      expect(game.phase).toBe('gameOver');
      expect(game.winner).not.toBeNull();
      expect(Math.max(...game.scores)).toBeGreaterThanOrEqual(1500);
      expect(game.scores[game.winner!]).toBeGreaterThan(game.scores[1 - game.winner!]!);
    }
  });

  it('rejects out-of-turn and illegal actions', () => {
    const game = new BeloteGame({ targetScore: 1500, firstDealer: 0, rand: seededRandom(6) });
    game.startRound();
    expect(() => game.call(2, PASS)).toThrow();
    expect(() => game.play(1, game.hands[1]![0]!.id)).toThrow();
    takeContract(game, 90, 'H');
    expect(() => game.call(2, PASS)).toThrow();
    expect(() => game.play(2, game.hands[2]![0]!.id)).toThrow();
    expect(() => game.play(1, 'XX')).toThrow();
    game.play(1, game.hands[1]![0]!.id);
    const illegal = game.hands[2]!.find((x) => !game.isLegalCard(2, x.id));
    if (illegal) expect(() => game.play(2, illegal.id)).toThrow();
  });
});
