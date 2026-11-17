import { describe, expect, it } from 'vitest';
import { isCardId, seededRandom } from '../src/shared/cards';
import {
  type BCard,
  BeloteGame,
  type Declaration,
  type TrickPlay,
  cardPoints,
  compareDeclarations,
  findDeclarations,
  illegalReason,
  isBeloteCardId,
  legalCards,
  makeBeloteDeck,
  parseBeloteCard,
  resolveDeclarations,
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
    expect(isBeloteCardId('7D')).toBe(false);
    expect(isBeloteCardId('D6')).toBe(false);
  });

  it('is worth 152 card points whatever the trump suit', () => {
    for (const trump of ['D', 'H', 'C', 'S'] as const) {
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
    // A higher card of another suit is a discard.
    expect(trickWinner(trick('0:S7 1:DA 2:CA 3:S8'), 'H').seat).toBe(3);
    // In a plain suit the jack ranks below the queen; in trumps above everything.
    expect(trickWinner(trick('0:SJ 1:SQ'), 'H').seat).toBe(1);
    expect(trickWinner(trick('0:SJ 1:SQ'), 'S').seat).toBe(0);
  });
});

describe('legalCards', () => {
  const legal = (hand: string, t: string, trump: 'D' | 'H' | 'C' | 'S', seat: number) => ids(legalCards(cards(hand), trick(t), trump, seat));

  it('lets the leader play anything', () => {
    expect(legal('SA H7 D9', '', 'H', 0)).toEqual(['D9', 'H7', 'SA']);
  });

  it('forces following suit', () => {
    expect(legal('SA S7 H7 D9', '1:SK', 'H', 2)).toEqual(['S7', 'SA']);
  });

  it('forces a higher trump on a trump lead when possible, else any trump', () => {
    expect(legal('HJ H7 HA SA', '0:H9', 'H', 1)).toEqual(['HJ']);
    expect(legal('H7 H8 SA', '0:H9', 'H', 1)).toEqual(['H7', 'H8']);
    // Even when the partner is winning.
    expect(legal('HJ H7 SA', '0:H9 1:H8', 'H', 2)).toEqual(['HJ']);
  });

  it('frees a player whose partner is winning from trumping', () => {
    expect(legal('H7 DA C8', '0:SA 1:S7', 'H', 2)).toEqual(['C8', 'DA', 'H7']);
    // The partner trumped: still free (no obligation to overtrump the partner).
    expect(legal('H9 DA', '1:S7 2:H8 3:SK', 'H', 0)).toEqual(['DA', 'H9']);
  });

  it('forces trumping an opponent, overtrumping when a trump is already in, else undertrumping', () => {
    expect(legal('H7 HJ DA', '1:SA', 'H', 2)).toEqual(['H7', 'HJ']);
    expect(legal('H7 HJ DA', '1:SA 2:S7 3:HA', 'H', 0)).toEqual(['HJ']);
    expect(legal('H7 H8 DA', '1:SA 2:S7 3:HA', 'H', 0)).toEqual(['H7', 'H8']);
  });

  it('allows anything without the suit led and without trumps', () => {
    expect(legal('DA C8', '1:SA', 'H', 2)).toEqual(['C8', 'DA']);
  });

  it('explains illegal cards', () => {
    expect(illegalReason(cards('SA S7 DA'), trick('1:SK'), 'H', 2, c('DA'))).toBe('You must follow suit (♠)');
    expect(illegalReason(cards('H7 HJ DA'), trick('1:SA'), 'H', 2, c('DA'))).toBe('You must trump (♥)');
    expect(illegalReason(cards('H7 HJ DA'), trick('1:SA 2:S7 3:HA'), 'H', 0, c('H7'))).toBe('You must play a higher trump');
    expect(illegalReason(cards('HJ H7'), trick('0:H9'), 'H', 1, c('H7'))).toBe('You must play a higher trump');
    expect(illegalReason(cards('SA S7'), trick('1:SK'), 'H', 2, c('S7'))).toBeNull();
  });
});

describe('sortBeloteHand', () => {
  it('puts trumps first, alternates colours and orders by strength', () => {
    const sorted = sortBeloteHand(cards('S7 HJ H9 C10 DA SA HQ D7'), 'H').map((x) => x.id);
    expect(sorted).toEqual(['HJ', 'H9', 'HQ', 'C10', 'DA', 'D7', 'SA', 'S7']);
  });
});

describe('announcements', () => {
  it('finds runs and carrés', () => {
    const d = findDeclarations(cards('H8 H9 H10 SJ DJ CJ HJ SA'), 0);
    expect(d.map((x) => [x.kind, x.rank, x.suit, x.points])).toEqual([
      ['carre', 'J', null, 200],
      ['cinquante', 'J', 'H', 50],
    ]);
    const run = findDeclarations(cards('S10 SJ SQ SK SA D7 D8 D9'), 2);
    expect(run.map((x) => [x.kind, x.length, x.points])).toEqual([
      ['cent', 5, 100],
      ['tierce', 3, 20],
    ]);
    // Four 8s or 7s are not a carré.
    expect(findDeclarations(cards('S8 D8 H8 C8 S7 D7 H7 C7'), 1)).toEqual([]);
  });

  it('ranks announcements: points, carré over run, length, height, then trumps', () => {
    const one = (hand: string, seat = 0): Declaration => findDeclarations(cards(hand), seat)[0]!;
    expect(compareDeclarations(one('S9 SJ S10'), one('D7 D8 D9 D10'), 'H')).toBeLessThan(0);
    expect(compareDeclarations(one('SA DA HA CA'), one('S10 SJ SQ SK SA'), 'H')).toBeGreaterThan(0);
    expect(compareDeclarations(one('SQ SK SA'), one('D8 D9 D10'), 'H')).toBeGreaterThan(0);
    expect(compareDeclarations(one('S8 S9 S10'), one('H8 H9 H10'), 'H')).toBeLessThan(0);
    expect(compareDeclarations(one('S8 S9 S10'), one('D8 D9 D10'), 'H')).toBe(0);
  });

  it('only counts the announcements of the team with the best one', () => {
    const per = [findDeclarations(cards('S7 S8 S9'), 0), findDeclarations(cards('D9 D10 DJ DQ'), 1), findDeclarations(cards('C7 C8 C9'), 2), []];
    const r = resolveDeclarations(per, 'H');
    expect(r.team).toBe(1);
    expect(r.points).toEqual([0, 50]);
    // Team 0 wins with its better run and also scores its partner's tierce.
    const per2 = [findDeclarations(cards('SQ SK SA'), 0), findDeclarations(cards('D9 D10 DJ'), 1), findDeclarations(cards('C7 C8 C9'), 2), []];
    expect(resolveDeclarations(per2, 'H')).toMatchObject({ team: 0, points: [40, 0] });
    // Equal best runs in plain suits: nobody scores.
    const per3 = [findDeclarations(cards('S8 S9 S10'), 0), findDeclarations(cards('D8 D9 D10'), 1), [], []];
    expect(resolveDeclarations(per3, 'H')).toMatchObject({ team: null, points: [0, 0] });
  });
});

describe('scoreBeloteHand', () => {
  const none = { team: null, points: [0, 0] as [number, number], counted: [] };
  /** Eight tricks: `wins` lists each trick's winning seat, points spread to reach the given card totals. */
  const tricks = (winners: number[], points: number[]) => winners.map((winner, i) => ({ winner, points: points[i]! }));

  it('scores both teams when the takers make more', () => {
    const r = scoreBeloteHand({ taker: 0, tricks: tricks([0, 1, 0, 1, 0, 2, 3, 0], [20, 10, 30, 15, 25, 20, 12, 30]), belote: 1, declarations: none, reserve: 0 });
    expect(r.cardPoints).toEqual([125, 37]);
    expect(r.made).toEqual([125, 57]);
    expect(r.outcome).toBe('made');
    expect(r.points).toEqual([125, 57]);
  });

  it('gives the defenders 162 plus every announcement when the takers fall (belote stays)', () => {
    const decl = { team: 0 as const, points: [50, 0] as [number, number], counted: [] };
    const r = scoreBeloteHand({ taker: 0, tricks: tricks([1, 1, 0, 1, 1, 3, 2, 3], [30, 25, 10, 20, 25, 20, 2, 30]), belote: 0, declarations: decl, reserve: 0 });
    expect(r.cardPoints).toEqual([12, 150]);
    expect(r.made).toEqual([82, 150]);
    expect(r.outcome).toBe('dedans');
    expect(r.points).toEqual([20, 162 + 50]);
  });

  it('scores a capot 250 (and 250 + announcements for a defenders’ capot)', () => {
    const all0 = tricks([0, 2, 0, 2, 0, 2, 0, 2], [20, 20, 20, 20, 20, 20, 21, 21]);
    expect(scoreBeloteHand({ taker: 2, tricks: all0, belote: 0, declarations: none, reserve: 0 })).toMatchObject({
      capot: 0,
      cardPoints: [250, 0],
      outcome: 'made',
      points: [270, 0],
    });
    const decl = { team: 1 as const, points: [0, 20] as [number, number], counted: [] };
    const all1 = tricks([1, 3, 1, 3, 1, 3, 1, 3], [20, 20, 20, 20, 20, 20, 21, 21]);
    expect(scoreBeloteHand({ taker: 0, tricks: all1, belote: null, declarations: decl, reserve: 0 })).toMatchObject({
      capot: 1,
      outcome: 'dedans',
      points: [0, 270],
    });
  });

  it('holds the takers’ points over on a tie, for the winner of the next hand', () => {
    const r = scoreBeloteHand({ taker: 1, tricks: tricks([0, 1, 0, 1, 0, 1, 0, 1], [20, 20, 20, 20, 20, 20, 21, 21]), belote: null, declarations: none, reserve: 0 });
    expect(r.made).toEqual([81, 81]);
    expect(r.outcome).toBe('litige');
    expect(r.points).toEqual([81, 0]);
    expect(r.reserveOut).toBe(81);
    const next = scoreBeloteHand({ taker: 1, tricks: tricks([1, 1, 1, 1, 0, 1, 1, 1], [20, 20, 20, 20, 20, 20, 21, 21]), belote: null, declarations: none, reserve: 81 });
    expect(next).toMatchObject({ outcome: 'made', reserveIn: 81, reserveTo: 1, points: [20, 142 + 81] });
    const fell = scoreBeloteHand({ taker: 1, tricks: tricks([0, 0, 0, 0, 1, 0, 0, 0], [20, 20, 20, 20, 20, 20, 21, 21]), belote: null, declarations: none, reserve: 81 });
    expect(fell).toMatchObject({ outcome: 'dedans', reserveTo: 0, points: [162 + 81, 0] });
  });
});

/** Plays one legal action for whoever is to act (bids taken with probability `takeRate`). */
function randomStep(game: BeloteGame, rand: () => number, takeRate = 0.3) {
  const seat = game.turn;
  if (game.phase === 'bidding') {
    const options = (['D', 'H', 'C', 'S'] as const).filter((s) => game.isLegalBid(seat, s));
    const suit = rand() < takeRate && options.length ? options[Math.floor(rand() * options.length)]! : null;
    return game.bid(seat, suit);
  }
  const legal = game.legalCards(seat);
  return game.play(seat, legal[Math.floor(rand() * legal.length)]!.id);
}

describe('BeloteGame', () => {
  it('deals 3 then 2 cards each from the dealer’s right and turns one up', () => {
    const game = new BeloteGame({ targetScore: 501, firstDealer: 2, rand: seededRandom(1) });
    const deal = game.startRound();
    expect(deal.dealer).toBe(2);
    expect(deal.order).toEqual([3, 3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 0, 0, 1, 1, 2, 2]);
    expect(game.hands.every((h) => h.length === 5)).toBe(true);
    expect(game.stock).toHaveLength(11);
    expect(deal.stockAfter).toBe(11);
    expect(game.turned).toEqual(deal.turned);
    expect(game.turn).toBe(3);
    expect(game.phase).toBe('bidding');
    const all = [...game.hands.flat(), ...game.stock, game.turned!].map((x) => x.id);
    expect(new Set(all).size).toBe(32);
  });

  it('gives the taker the turned card plus 2, the others 3, and lets the dealer’s right lead', () => {
    const game = new BeloteGame({ targetScore: 501, firstDealer: 0, rand: seededRandom(2) });
    const deal = game.startRound();
    expect(game.isLegalBid(1, deal.turned.suit)).toBe(true);
    const other = (['D', 'H', 'C', 'S'] as const).find((s) => s !== deal.turned.suit)!;
    expect(game.isLegalBid(1, other)).toBe(false);
    expect(game.isLegalBid(2, null)).toBe(false);
    expect(game.bid(1, null).take).toBeUndefined();
    const out = game.bid(2, deal.turned.suit);
    expect(out.take).toBeDefined();
    const take = out.take!;
    expect(take.taker).toBe(2);
    expect(take.order).toEqual([1, 1, 1, 2, 2, 3, 3, 3, 0, 0, 0]);
    expect(take.hands.map((h) => h.length)).toEqual([3, 3, 2, 3]);
    expect(game.hands.every((h) => h.length === 8)).toBe(true);
    expect(game.hands[2]!.map((x) => x.id)).toContain(deal.turned.id);
    expect(game.trump).toBe(deal.turned.suit);
    expect(game.phase).toBe('playing');
    expect(game.turn).toBe(1);
    expect(game.stock).toHaveLength(0);
  });

  it('opens a second round for the other suits, and redeals when everybody passes twice', () => {
    const game = new BeloteGame({ targetScore: 501, firstDealer: 3, rand: seededRandom(3) });
    const deal = game.startRound();
    for (const s of [0, 1, 2, 3]) game.bid(s, null);
    expect(game.bidRound).toBe(2);
    expect(game.turn).toBe(0);
    expect(game.isLegalBid(0, deal.turned.suit)).toBe(false);
    for (const s of [0, 1, 2]) game.bid(s, null);
    const out = game.bid(3, null);
    expect(out.redeal).toBeDefined();
    expect(out.redeal!.dealer).toBe(0);
    expect(out.redeal!.redeals).toBe(1);
    expect(game.round).toBe(1);
    expect(game.bidRound).toBe(1);
    expect(game.turn).toBe(1);
    // Second round take with another suit.
    for (const s of [1, 2, 3, 0]) game.bid(s, null);
    const suit = (['D', 'H', 'C', 'S'] as const).find((s) => s !== game.turned!.suit)!;
    const take = game.bid(1, suit).take!;
    expect(take.trump).toBe(suit);
    expect(game.hands[1]!.map((x) => x.id)).toContain(take.turned.id);
  });

  it('announces belote and rebelote with the trump king and queen of their holder', () => {
    const rand = seededRandom(4);
    for (let attempt = 0; attempt < 400; attempt++) {
      const game = new BeloteGame({ targetScore: 501, rand });
      game.startRound();
      game.bid(game.turn, game.turned!.suit);
      if (game.beloteHolder === null) continue;
      const said: string[] = [];
      while (game.phase === 'playing') {
        const out = randomStep(game, rand);
        if ('play' in out && out.play.belote) {
          expect(out.play.seat).toBe(game.beloteHolder);
          said.push(out.play.belote);
        }
      }
      expect(said).toEqual(['belote', 'rebelote']);
      expect(game.lastRound!.belote).toBe(teamOf(game.beloteHolder));
      return;
    }
    throw new Error('no deal with belote found');
  });

  it('declares announcements with the first card and settles them after the first trick', () => {
    const rand = seededRandom(5);
    for (let attempt = 0; attempt < 400; attempt++) {
      const game = new BeloteGame({ targetScore: 501, rand });
      game.startRound();
      game.bid(game.turn, game.turned!.suit);
      if (game.declarations.every((d) => d.length === 0)) continue;
      const shown: Declaration[] = [];
      let settled = null;
      for (let i = 0; i < 4; i++) {
        const out = randomStep(game, rand);
        if ('play' in out) {
          shown.push(...out.play.declarations);
          if (out.declarations) settled = out.declarations;
        }
      }
      expect(shown).toEqual(game.declarations.flat());
      expect(settled).not.toBeNull();
      expect(game.declResult).toEqual(settled);
      // No more declarations after the first trick.
      const out = randomStep(game, rand);
      expect('play' in out && out.play.declarations).toEqual([]);
      return;
    }
    throw new Error('no deal with announcements found');
  });

  it('plays whole games to the target with every card accounted for', () => {
    for (let g = 0; g < 30; g++) {
      const rand = seededRandom(100 + g);
      const game = new BeloteGame({ targetScore: 501, announcements: g % 2 === 0, rand });
      game.startRound();
      let total: [number, number] = [0, 0];
      for (let steps = 0; steps < 20000 && game.phase !== 'gameOver'; steps++) {
        if (game.phase === 'roundOver') {
          game.startRound();
          continue;
        }
        const out = randomStep(game, rand);
        if ('trick' in out && out.trick) {
          expect(out.trick.plays).toHaveLength(4);
          expect(game.piles.flat().length).toBe((out.trick.index + 1) * 4);
        }
        if ('round' in out && out.round) {
          const r = out.round;
          expect(game.piles.flat()).toHaveLength(32);
          expect(game.hands.every((h) => h.length === 0)).toBe(true);
          if (r.capot === null) expect(r.cardPoints[0] + r.cardPoints[1]).toBe(162);
          total = [total[0] + r.points[0], total[1] + r.points[1]];
          expect(r.totals).toEqual(total);
        }
      }
      expect(game.phase).toBe('gameOver');
      expect(game.winner).not.toBeNull();
      expect(Math.max(...game.scores)).toBeGreaterThanOrEqual(501);
      expect(game.scores[game.winner!]).toBeGreaterThan(game.scores[1 - game.winner!]!);
    }
  });

  it('rejects out-of-turn and illegal actions', () => {
    const game = new BeloteGame({ targetScore: 501, firstDealer: 0, rand: seededRandom(6) });
    game.startRound();
    expect(() => game.bid(2, null)).toThrow();
    expect(() => game.play(1, game.hands[1]![0]!.id)).toThrow();
    game.bid(1, game.turned!.suit);
    expect(() => game.bid(2, null)).toThrow();
    expect(() => game.play(2, game.hands[2]![0]!.id)).toThrow();
    expect(() => game.play(1, 'XX')).toThrow();
    const lead = game.hands[1]![0]!;
    game.play(1, lead.id);
    const hand = game.hands[2]!;
    const illegal = hand.find((x) => !game.isLegalCard(2, x.id));
    if (illegal) expect(() => game.play(2, illegal.id)).toThrow();
  });
});
