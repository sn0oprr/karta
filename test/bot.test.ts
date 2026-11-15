import { describe, expect, it } from 'vitest';
import { type Card, makeDeck, parseCard, seededRandom, shuffle } from '../src/shared/cards';
import { ChkobbaGame, type Move, legalMovesFor, teamOf } from '../src/shared/chkobba';
import { type BotContext, type BotLevel, botContext, chooseBotMove } from '../src/shared/bot';

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
const cards = (list: string): Card[] => list.split(' ').filter(Boolean).map(parseCard);
const key = (m: Move) => `${m.cardId}:${[...m.capture].sort().join('+')}`;
const isLegal = (ctx: BotContext, m: Move) => legalMovesFor(ctx.hand, ctx.table).some((x) => key(x) === key(m));

/** Seat 0 of a 2-player hand in progress: every card not in hand, on the table or captured is unseen. */
function position(hand: string, table: string, extra: Partial<BotContext> = {}): BotContext {
  const h = cards(hand);
  const t = cards(table);
  const used = new Set([...h, ...t].map((c) => c.id));
  const unseen = makeDeck().filter((c) => !used.has(c.id));
  return {
    seat: 0,
    numPlayers: 2,
    hand: h,
    table: t,
    unseen,
    deckCount: unseen.length - 3,
    handCounts: [h.length, 3],
    teamPiles: [[], []],
    chkobbas: [0, 0],
    scores: [0, 0],
    targetScore: 21,
    lastCapturer: null,
    ...extra,
  };
}

/** Any context the server could plausibly (or implausibly) hand over — including inconsistent ones. */
function randomContext(rand: () => number): BotContext {
  const numPlayers = rand() < 0.5 ? 2 : 4;
  const deck = shuffle(makeDeck(), rand);
  const hand = deck.splice(0, 1 + Math.floor(rand() * 3));
  const table = deck.splice(0, Math.floor(rand() * 10));
  const captured = deck.splice(0, Math.floor(rand() * deck.length));
  const seat = Math.floor(rand() * numPlayers);
  const handCounts = Array.from({ length: numPlayers }, (_, s) => (s === seat ? hand.length : Math.floor(rand() * 4)));
  const hidden = handCounts.reduce((sum, n, s) => sum + (s === seat ? 0 : n), 0);
  const deckCount = rand() < 0.5 ? Math.max(0, deck.length - hidden) : Math.floor(rand() * 30);
  const split = Math.floor(rand() * (captured.length + 1));
  const unseen = rand() < 0.1 ? [...deck, ...hand] : deck; // sometimes duplicated cards
  return {
    seat,
    numPlayers,
    hand,
    table,
    unseen,
    deckCount,
    handCounts,
    teamPiles: [captured.slice(0, split), captured.slice(split)],
    chkobbas: [Math.floor(rand() * 3), Math.floor(rand() * 3)],
    scores: [Math.floor(rand() * 21), Math.floor(rand() * 21)],
    targetScore: 21,
    lastCapturer: rand() < 0.2 ? null : Math.floor(rand() * numPlayers),
  };
}

type Player = BotLevel | 'random';

/** Plays one hand; players[t] plays for team t. Returns the points scored by each team. */
function playHand(numPlayers: 2 | 4, players: [Player, Player], dealSeed: number, botSeed: number, dealer: number) {
  const g = new ChkobbaGame({ numPlayers, targetScore: 1e9, rand: seededRandom(dealSeed), firstDealer: dealer });
  const rand = seededRandom(botSeed);
  g.startRound();
  for (;;) {
    const seat = g.turn;
    const player = players[teamOf(seat)];
    let move: Move;
    if (player === 'random') {
      const moves = g.legalMoves(seat);
      move = moves[Math.floor(rand() * moves.length)]!;
    } else move = chooseBotMove(botContext(g, seat), player, rand);
    const out = g.play(seat, move);
    if (out.round) return out.round.points;
  }
}

/** Duplicate match: every deal is played twice with the sides swapped. Average points per hand. */
function duel(numPlayers: 2 | 4, a: Player, b: Player, deals: number, seed: number) {
  let ptsA = 0;
  let ptsB = 0;
  for (let d = 0; d < deals; d++) {
    const dealSeed = seed * 100003 + d * 7919;
    const dealer = d % numPlayers;
    const r1 = playHand(numPlayers, [a, b], dealSeed, dealSeed + 1, dealer);
    const r2 = playHand(numPlayers, [b, a], dealSeed, dealSeed + 2, dealer);
    ptsA += r1[0] + r2[1];
    ptsB += r1[1] + r2[0];
  }
  return { a: ptsA / (2 * deals), b: ptsB / (2 * deals) };
}

function cloneGame(g: ChkobbaGame): ChkobbaGame {
  const c = Object.assign(Object.create(ChkobbaGame.prototype) as ChkobbaGame, g);
  c.deck = [...g.deck];
  c.table = [...g.table];
  c.hands = g.hands.map((h) => [...h]);
  c.piles = g.piles.map((p) => [...p]);
  c.chkobbaCards = g.chkobbaCards.map((p) => [...p]);
  c.scores = [g.scores[0], g.scores[1]];
  c.playedThisHand = [...g.playedThisHand];
  return c;
}

/** Exact point difference (team minus the other) of the rest of the hand with perfect play by both sides. */
function perfectDiff(g: ChkobbaGame, team: number): number {
  const seat = g.turn;
  const mine = teamOf(seat) === team;
  let best = mine ? -Infinity : Infinity;
  for (const m of g.legalMoves(seat)) {
    const v = diffAfter(g, m, team);
    best = mine ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}
function diffAfter(g: ChkobbaGame, m: Move, team: number): number {
  const c = cloneGame(g);
  const out = c.play(c.turn, m);
  return out.round ? out.round.points[team]! - out.round.points[1 - team]! : perfectDiff(c, team);
}

describe('botContext', () => {
  it('exposes only what the seat may know', () => {
    const g = new ChkobbaGame({ numPlayers: 4, targetScore: 21, rand: seededRandom(5), firstDealer: 0 });
    g.startRound();
    const rand = seededRandom(9);
    for (let i = 0; i < 7; i++) g.play(g.turn, chooseBotMove(botContext(g, g.turn), 'normal', rand));
    for (let seat = 0; seat < 4; seat++) {
      const ctx = botContext(g, seat);
      expect(ctx.seat).toBe(seat);
      expect(ctx.numPlayers).toBe(4);
      expect(ctx.hand.map((c) => c.id)).toEqual(g.hands[seat]!.map((c) => c.id));
      expect(ctx.table.map((c) => c.id)).toEqual(g.table.map((c) => c.id));
      expect(ctx.deckCount).toBe(g.deck.length);
      expect(ctx.handCounts).toEqual(g.hands.map((h) => h.length));
      expect(ctx.teamPiles.map((p) => p.length)).toEqual([g.teamCards(0).length, g.teamCards(1).length]);
      expect(ctx.chkobbas).toEqual([g.teamChkobbas(0), g.teamChkobbas(1)]);
      expect(ctx.lastCapturer).toBe(g.lastCapturer);
      // Unseen = stock + the other hands, as a set, in a canonical order that reveals nothing.
      const expected = g.unseenBy(seat).map((c) => c.id);
      expect([...ctx.unseen.map((c) => c.id)].sort()).toEqual([...expected].sort());
      const order = 'DHCS';
      const sortedIds = [...ctx.unseen]
        .sort((x, y) => order.indexOf(x.suit) - order.indexOf(y.suit) || x.rank - y.rank)
        .map((c) => c.id);
      expect(ctx.unseen.map((c) => c.id)).toEqual(sortedIds);
      const own = new Set([...ctx.hand, ...ctx.table, ...ctx.teamPiles[0], ...ctx.teamPiles[1]].map((c) => c.id));
      expect(ctx.unseen.some((c) => own.has(c.id))).toBe(false);
      expect(own.size + ctx.unseen.length).toBe(40);
    }
  });

  it('does not alias the engine state', () => {
    const g = new ChkobbaGame({ numPlayers: 2, targetScore: 21, rand: seededRandom(3), firstDealer: 0 });
    g.startRound();
    const ctx = botContext(g, g.turn);
    ctx.hand.pop();
    ctx.table.pop();
    ctx.handCounts[0] = 99;
    ctx.scores[0] = 99;
    expect(g.hands[g.turn]).toHaveLength(3);
    expect(g.table).toHaveLength(4);
    expect(g.scores).toEqual([0, 0]);
  });
});

describe('chooseBotMove', () => {
  it('always returns a legal move in full games (2 and 4 players, every level)', () => {
    for (const numPlayers of [2, 4] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const g = new ChkobbaGame({ numPlayers, targetScore: 1e9, rand: seededRandom(seed * 31 + numPlayers), firstDealer: seed % numPlayers });
        const rand = seededRandom(seed);
        g.startRound();
        while (g.phase === 'playing') {
          const ctx = botContext(g, g.turn);
          const level = LEVELS[(g.turn + seed) % 3]!;
          const move = chooseBotMove(ctx, level, rand);
          expect(isLegal(ctx, move)).toBe(true);
          expect(() => g.play(g.turn, move)).not.toThrow();
        }
      }
    }
  });

  it('always returns a legal move in arbitrary, even inconsistent, positions', () => {
    const rand = seededRandom(2024);
    for (let i = 0; i < 400; i++) {
      const ctx = randomContext(rand);
      for (const level of LEVELS) expect(isLegal(ctx, chooseBotMove(ctx, level, rand))).toBe(true);
    }
    // Garbage numbers must not break it either.
    const odd = position('5S 9C', '2D 3H 4C', { handCounts: [Number.NaN, -4], deckCount: Number.NaN, chkobbas: [-1, 2.5] });
    for (const level of LEVELS) expect(isLegal(odd, chooseBotMove(odd, level, seededRandom(1)))).toBe(true);
  });

  it('throws when there is no card to play', () => {
    expect(() => chooseBotMove(position('', '2D 3H'))).toThrow();
  });

  it('is deterministic for a given random source and leaves the context untouched', () => {
    const ctx = position('7S 2C 10H', '5D 2H 1S', { deckCount: 24 });
    const before = JSON.stringify(ctx);
    for (const level of LEVELS) {
      const a = chooseBotMove(ctx, level, seededRandom(42));
      const b = chooseBotMove(ctx, level, seededRandom(42));
      expect(key(a)).toBe(key(b));
    }
    expect(JSON.stringify(ctx)).toBe(before);
  });

  describe.each(['normal', 'hard'] as const)('%s tactics', (level) => {
    const pick = (ctx: BotContext) => key(chooseBotMove(ctx, level, seededRandom(1)));

    it('captures the 7♦', () => {
      expect(pick(position('7S 2C 10H', '7D 5H 9C'))).toBe('7S:7D');
    });

    it('sweeps the table for a chkobba', () => {
      expect(pick(position('7S 2C 9H', '3D 4C'))).toBe('7S:3D+4C');
    });

    it('does not lay a card that leaves the table sweepable', () => {
      // 2 next to the 5 would let any 7 sweep; the King leaves a table worth 15.
      expect(pick(position('10H 2C', '5S'))).toBe('10H:');
    });

    it('keeps the 7♦ out of reach', () => {
      // 7♦ next to the 3 would hand a King (or any 7) the 7♦. (With a King in hand instead of the 9,
      // hard may lay the 7♦ on purpose: if it survives, the King sweeps 3 + 7♦.)
      expect(pick(position('7D 9C', '3S'))).toBe('9C:');
    });

    it('prefers the capture with the most diamonds', () => {
      expect(pick(position('8S 1C 10C', '5D 3D 5C 3C'))).toBe('8S:3D+5D');
    });

    it('plays for the leftovers at the end of the hand', () => {
      // Last card each, the opponent holds the 3♣. Taking 3+4 leaves the 3♣ nothing to capture, so the
      // 2♦ 5♣ 3♣ left on the table come to us as last capturer; taking 2+5 would let the 3♣ capture last.
      const known = ['7S', '2D', '5C', '3H', '4S', '3C'];
      const rest = makeDeck().filter((c) => !known.includes(c.id));
      const ctx = position('7S', '2D 5C 3H 4S', {
        unseen: cards('3C'),
        deckCount: 0,
        handCounts: [1, 1],
        teamPiles: [rest.slice(0, 17), rest.slice(17)],
        lastCapturer: 1,
      });
      expect(pick(ctx)).toBe('7S:3H+4S');
    });
  });

  it('hard plays the last deal of a 2-player hand perfectly', () => {
    // Once the stock is empty a 2-player hand has perfect information (the opponent holds exactly the unseen
    // cards), so every choice can be checked against an exhaustive search through the engine itself — which
    // also covers the last-card rule (no chkobba) and the leftovers going to the last capturer.
    let checked = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const g = new ChkobbaGame({ numPlayers: 2, targetScore: 1e9, rand: seededRandom(seed * 13), firstDealer: seed % 2 });
      const rand = seededRandom(seed);
      g.startRound();
      while (g.phase === 'playing') {
        const ctx = botContext(g, g.turn);
        if (g.deck.length === 0 && legalMovesFor(ctx.hand, ctx.table).length > 1) {
          const team = teamOf(g.turn);
          const move = chooseBotMove(ctx, 'hard', rand);
          expect(diffAfter(g, move, team)).toBeCloseTo(perfectDiff(g, team), 9);
          checked++;
          g.play(g.turn, move);
        } else g.play(g.turn, chooseBotMove(ctx, 'normal', rand));
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('strength (average points per hand, duplicate deals)', () => {
  it('normal clearly beats a random player (2 players)', () => {
    const r = duel(2, 'normal', 'random', 150, 1);
    expect(r.a - r.b).toBeGreaterThan(1.2); // measured: 3.1 vs 1.3 per hand
  });

  it('normal clearly beats a random player (4 players)', () => {
    const r = duel(4, 'normal', 'random', 100, 2);
    expect(r.a - r.b).toBeGreaterThan(1.2); // measured: 3.2 vs 1.2 per hand
  });

  it('easy is weaker than normal but better than random', () => {
    const vsRandom = duel(2, 'easy', 'random', 100, 3);
    const vsNormal = duel(2, 'easy', 'normal', 100, 4);
    expect(vsRandom.a - vsRandom.b).toBeGreaterThan(0.5); // measured: +1.25
    expect(vsNormal.a - vsNormal.b).toBeLessThan(-0.4); // measured: −1.0
  });

  it('hard is at least as good as normal (2 players)', { timeout: 30000 }, () => {
    const r = duel(2, 'hard', 'normal', 100, 5);
    expect(r.a).toBeGreaterThan(r.b); // measured: 2.6 vs 1.9 per hand
  });

  it('hard is at least as good as normal (4 players)', { timeout: 30000 }, () => {
    const r = duel(4, 'hard', 'normal', 100, 6);
    expect(r.a).toBeGreaterThan(r.b); // measured: 2.4 vs 2.05 per hand
  });

  it('decides quickly', { timeout: 30000 }, () => {
    const rand = seededRandom(77);
    for (const level of LEVELS) {
      let total = 0;
      let n = 0;
      for (let seed = 1; seed <= 20; seed++) {
        for (const numPlayers of [2, 4] as const) {
          const g = new ChkobbaGame({ numPlayers, targetScore: 1e9, rand: seededRandom(seed), firstDealer: 0 });
          g.startRound();
          while (g.phase === 'playing') {
            const ctx = botContext(g, g.turn);
            const t0 = performance.now();
            const move = chooseBotMove(ctx, level, rand);
            total += performance.now() - t0;
            n++;
            g.play(g.turn, move);
          }
        }
      }
      expect(total / n).toBeLessThan(5); // measured: easy/normal ~0.01 ms, hard ~0.5 ms on average
    }
  });
});
