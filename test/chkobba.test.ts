import { describe, expect, it } from 'vitest';
import { type Card, makeDeck, parseCard, seededRandom } from '../src/shared/cards';
import { ChkobbaGame, captureOptions, legalMovesFor, scoreHand, teamOf } from '../src/shared/chkobba';

const c = (id: string): Card => parseCard(id);
const ids = (cards: Card[][]) => cards.map((g) => g.map((x) => x.id).sort().join('+')).sort();

describe('deck', () => {
  it('has 40 unique cards without 8/9/10 face values', () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map((d) => d.id)).size).toBe(40);
    expect(deck.filter((d) => d.suit === 'D')).toHaveLength(10);
    expect(deck.filter((d) => d.rank === 7)).toHaveLength(4);
  });
});

describe('captureOptions', () => {
  it('prefers a same-rank card over any sum', () => {
    const opts = captureOptions(c('5H'), [c('5D'), c('2C'), c('3S')]);
    expect(ids(opts)).toEqual(['5D']);
  });

  it('offers each same-rank card separately', () => {
    const opts = captureOptions(c('5H'), [c('5D'), c('5S'), c('1C'), c('4S')]);
    expect(ids(opts)).toEqual(['5D', '5S']);
  });

  it('finds every sum combination of two or more cards', () => {
    const opts = captureOptions(c('7H'), [c('1D'), c('2C'), c('3S'), c('4D')]);
    expect(ids(opts)).toEqual(['1D+2C+4D', '3S+4D']);
  });

  it('treats figures by their Chkobba value (Q=8, J=9, K=10)', () => {
    expect(ids(captureOptions(c('10H'), [c('6D'), c('4C')]))).toEqual(['4C+6D']);
    expect(ids(captureOptions(c('9H'), [c('8D'), c('1C')]))).toEqual(['1C+8D']);
  });

  it('returns nothing when the card cannot capture', () => {
    expect(captureOptions(c('2H'), [c('5D'), c('7C')])).toEqual([]);
    expect(captureOptions(c('2H'), [])).toEqual([]);
  });

  it('never offers a single card of a different rank', () => {
    const opts = captureOptions(c('6H'), [c('3D'), c('3C'), c('6S')]);
    expect(ids(opts)).toEqual(['6S']);
  });
});

describe('legalMovesFor', () => {
  it('forces a capture for cards that can capture and lays down the others', () => {
    const moves = legalMovesFor([c('3H'), c('9C')], [c('1D'), c('2S'), c('5C')]);
    const byCard = (id: string) => moves.filter((m) => m.cardId === id).map((m) => [...m.capture].sort().join('+'));
    expect(byCard('3H')).toEqual(['1D+2S']);
    expect(byCard('9C')).toEqual(['', ]);
  });
});

describe('scoreHand', () => {
  const pile = (list: string) => list.split(' ').filter(Boolean).map(c);

  it('awards karta, dinari, bermila (sevens), haya and chkobbas', () => {
    const all = makeDeck();
    // Team 0: all diamonds, three sevens (incl. 7D) and 15 other cards → 25 cards.
    const t0 = all.filter((x) => x.suit === 'D' || (x.rank === 7 && x.suit !== 'S'));
    const rest = all.filter((x) => !t0.includes(x));
    const t0Full = [...t0, ...rest.slice(0, 13)];
    const t1 = rest.slice(13);
    expect(t0Full.length + t1.length).toBe(40);
    const r = scoreHand([t0Full, t1], [2, 1]);
    expect(r.karta).toBe(0);
    expect(r.dinari).toBe(0);
    expect(r.haya).toBe(0);
    expect(r.bermila).toBe(0);
    expect(r.points).toEqual([4 + 2, 1]);
  });

  it('gives no karta on 20–20 and no dinari on 5–5', () => {
    const all = makeDeck();
    const diamonds = all.filter((x) => x.suit === 'D');
    const others = all.filter((x) => x.suit !== 'D');
    const t0 = [...diamonds.slice(0, 5), ...others.slice(0, 15)];
    const t1 = [...diamonds.slice(5), ...others.slice(15)];
    const r = scoreHand([t0, t1], [0, 0]);
    expect(r.karta).toBeNull();
    expect(r.dinari).toBeNull();
  });

  it('breaks a 2–2 tie in sevens with sixes, and gives nothing on 2–2 sixes', () => {
    const a = pile('7D 7H 6C 6S 6D');
    const b = pile('7C 7S 6H');
    expect(scoreHand([a, b], [0, 0]).bermila).toBe(0);
    const a2 = pile('7D 7H 6C 6S');
    const b2 = pile('7C 7S 6H 6D');
    expect(scoreHand([a2, b2], [0, 0]).bermila).toBeNull();
  });
});

describe('ChkobbaGame', () => {
  it('deals 3 cards each and 4 on the table, never three of a kind on the table', () => {
    for (let seed = 1; seed < 300; seed++) {
      const g = new ChkobbaGame({ numPlayers: 4, targetScore: 21, rand: seededRandom(seed), firstDealer: 0 });
      const deal = g.startRound();
      expect(deal.dealer).toBe(0);
      expect(g.turn).toBe(1);
      expect(g.hands.every((h) => h.length === 3)).toBe(true);
      expect(g.table).toHaveLength(4);
      expect(g.deck).toHaveLength(40 - 12 - 4);
      const counts = new Map<number, number>();
      for (const x of g.table) counts.set(x.rank, (counts.get(x.rank) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThan(3);
      expect(deal.table.map((x) => x.id)).toEqual(g.table.map((x) => x.id));
    }
  });

  it('pairs partners opposite each other', () => {
    expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1]);
  });

  it('rejects illegal moves and out-of-turn play', () => {
    const g = new ChkobbaGame({ numPlayers: 2, targetScore: 21, rand: seededRandom(7), firstDealer: 0 });
    g.startRound();
    g.table = [c('5D'), c('2C'), c('3S')];
    g.hands[1] = [c('5H'), c('4C'), c('1S')];
    expect(() => g.play(0, { cardId: g.hands[0]![0]!.id, capture: [] })).toThrow(/turn/);
    expect(() => g.play(1, { cardId: '5H', capture: ['2C', '3S'] })).toThrow(/Illegal/);
    expect(() => g.play(1, { cardId: '5H', capture: [] })).toThrow(/Illegal/);
    const out = g.play(1, { cardId: '5H', capture: ['5D'] });
    expect(out.play.captured.map((x) => x.id)).toEqual(['5D']);
    expect(out.play.chkobba).toBe(false);
    expect(g.turn).toBe(0);
  });

  it('rejects capture lists with duplicates or malformed payloads', () => {
    const g = new ChkobbaGame({ numPlayers: 2, targetScore: 21, rand: seededRandom(21), firstDealer: 0 });
    g.startRound();
    g.table = [c('3S'), c('7D')];
    g.hands[1] = [c('10H'), c('1C'), c('2C')];
    g.turn = 1;
    expect(g.isLegal(1, { cardId: '10H', capture: ['7D', '7D'] })).toBe(false);
    expect(g.isLegal(1, { cardId: '10H', capture: '7D' as unknown as string[] })).toBe(false);
    expect(g.isLegal(1, null as unknown as { cardId: string; capture: string[] })).toBe(false);
    expect(() => g.play(1, { cardId: '10H', capture: ['7D', '7D'] })).toThrow(/Illegal/);
    expect(g.isLegal(1, { cardId: '10H', capture: ['7D', '3S'] })).toBe(true);
  });

  it('scores a chkobba when the table is swept', () => {
    const g = new ChkobbaGame({ numPlayers: 2, targetScore: 21, rand: seededRandom(3), firstDealer: 0 });
    g.startRound();
    g.table = [c('3D'), c('4C')];
    g.hands[1] = [c('7S'), c('1C'), c('2C')];
    const out = g.play(1, { cardId: '7S', capture: ['3D', '4C'] });
    expect(out.play.chkobba).toBe(true);
    expect(g.chkobbaCards[1]!.map((x) => x.id)).toEqual(['7S']);
  });

  it('does not count a sweep with the last card of the hand, and gives leftovers to the last capturer', () => {
    const g = new ChkobbaGame({ numPlayers: 2, targetScore: 21, rand: seededRandom(11), firstDealer: 0 });
    g.startRound();
    // Fast-forward to the final two cards of the hand.
    g.deck = [];
    g.table = [c('2D'), c('9C')];
    g.hands = [[c('5S')], [c('2H')]];
    g.piles = [[], []];
    g.turn = 1;
    const first = g.play(1, { cardId: '2H', capture: ['2D'] });
    expect(first.play.chkobba).toBe(false);
    expect(g.lastCapturer).toBe(1);
    // Seat 0 lays the 5 (no capture possible); hand ends, the 9 and 5 go to seat 1.
    const last = g.play(0, { cardId: '5S', capture: [] });
    expect(last.play.lastCardOfHand).toBe(true);
    expect(last.round).toBeDefined();
    expect(last.round!.leftoverTo).toBe(1);
    expect(last.round!.leftover.map((x) => x.id).sort()).toEqual(['5S', '9C']);
    expect(g.table).toHaveLength(0);

    const g2 = new ChkobbaGame({ numPlayers: 2, targetScore: 21, rand: seededRandom(12), firstDealer: 0 });
    g2.startRound();
    g2.deck = [];
    g2.table = [c('4D'), c('3C')];
    g2.hands = [[c('7S')], []];
    g2.piles = [[], []];
    g2.turn = 0;
    const sweep = g2.play(0, { cardId: '7S', capture: ['3C', '4D'] });
    expect(sweep.play.lastCardOfHand).toBe(true);
    expect(sweep.play.chkobba).toBe(false);
    expect(sweep.round!.stats[0].chkobbas).toBe(0);
  });

  it('plays full random games to completion while conserving all 40 cards', () => {
    for (const numPlayers of [2, 4] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const rand = seededRandom(seed * 97 + numPlayers);
        const g = new ChkobbaGame({ numPlayers, targetScore: 21, rand, firstDealer: seed % numPlayers });
        let hands = 0;
        while (g.phase !== 'gameOver') {
          const deal = g.startRound();
          hands++;
          let deals = 1;
          expect(deal.initial).toBe(true);
          expect(g.turn).toBe((g.dealer + 1) % numPlayers);
          for (;;) {
            const moves = g.legalMoves(g.turn);
            expect(moves.length).toBeGreaterThan(0);
            const move = moves[Math.floor(rand() * moves.length)]!;
            const out = g.play(g.turn, move);
            const inPlay =
              g.deck.length +
              g.table.length +
              g.hands.reduce((n, h) => n + h.length, 0) +
              g.piles.reduce((n, p) => n + p.length, 0);
            expect(inPlay).toBe(40);
            if (out.deal) {
              deals++;
              expect(out.deal.initial).toBe(false);
              expect(g.turn).toBe((g.dealer + 1) % numPlayers);
            }
            if (out.round) {
              const r = out.round;
              expect(deals).toBe(numPlayers === 2 ? 6 : 3);
              expect(r.stats[0].cards + r.stats[1].cards).toBe(40);
              expect(r.stats[0].diamonds + r.stats[1].diamonds).toBe(10);
              const cat = [r.karta, r.dinari, r.bermila, r.haya].filter((t) => t !== null).length;
              expect(r.points[0] + r.points[1]).toBe(cat + r.stats[0].chkobbas + r.stats[1].chkobbas);
              expect(r.haya).not.toBeNull();
              break;
            }
          }
          expect(hands).toBeLessThan(60);
        }
        expect(g.winner).not.toBeNull();
        const [a, b] = g.scores;
        expect(Math.max(a, b)).toBeGreaterThanOrEqual(21);
        expect(a).not.toBe(b);
        expect(g.scores[g.winner!]).toBe(Math.max(a, b));
        expect(() => g.startRound()).toThrow();
      }
    }
  });

  it('rotates the dealer to the right every hand', () => {
    const g = new ChkobbaGame({ numPlayers: 4, targetScore: 99, rand: seededRandom(5), firstDealer: 2 });
    const dealers: number[] = [];
    for (let i = 0; i < 5; i++) {
      dealers.push(g.startRound().dealer);
      while (g.phase === 'playing') g.play(g.turn, g.legalMoves(g.turn)[0]!);
    }
    expect(dealers).toEqual([2, 3, 0, 1, 2]);
  });
});
