import { describe, expect, it } from 'vitest';
import { type Suit, seededRandom } from '../src/shared/cards';
import { type BCard, BeloteGame, type TrickPlay, legalCards, parseBeloteCard } from '../src/shared/belote';
import {
  type BeloteBotContext,
  type BotLevel,
  beloteBotContext,
  bidValue,
  chooseBeloteBid,
  chooseBeloteCard,
} from '../src/shared/beloteBot';
import { teamOf } from '../src/shared/teams';

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
const cards = (list: string): BCard[] => list.split(' ').filter(Boolean).map(parseBeloteCard);
const trick = (list: string): TrickPlay[] =>
  list
    .split(' ')
    .filter(Boolean)
    .map((e) => {
      const [seat, id] = e.split(':');
      return { seat: Number(seat), card: parseBeloteCard(id!) };
    });

/** A playing position for `seat` (trumps, taker and the trick so far given; nothing else known). */
function position(o: { seat: number; hand: string; trump: Suit; taker: number; trick?: string; upCard?: string }): BeloteBotContext {
  const t = trick(o.trick ?? '');
  const counts = [0, 1, 2, 3].map((s) => (s === o.seat ? cards(o.hand).length : 8 - (t.some((p) => p.seat === s) ? 1 : 0)));
  return {
    seat: o.seat,
    dealer: 3,
    phase: 'playing',
    hand: cards(o.hand),
    bidRound: 1,
    upCard: o.upCard ? parseBeloteCard(o.upCard) : null,
    bids: [],
    trump: o.trump,
    taker: o.taker,
    trick: t,
    tricks: [],
    handCounts: counts,
    belote: null,
    declared: [],
    ownDeclarations: [],
    declResult: null,
    scores: [0, 0],
    targetScore: 501,
  };
}

type Player = BotLevel | 'random';

/** Plays one hand (bots bid at their level, 'random' bids like normal); returns the points of each team. */
function playHand(players: [Player, Player], dealSeed: number, botSeed: number, dealer: number): [number, number] {
  const g = new BeloteGame({ targetScore: 1e9, rand: seededRandom(dealSeed), firstDealer: dealer });
  const rand = seededRandom(botSeed);
  g.startRound();
  for (;;) {
    const seat = g.turn;
    const player = players[teamOf(seat)];
    const ctx = beloteBotContext(g, seat);
    if (g.phase === 'bidding') {
      g.bid(seat, chooseBeloteBid(ctx, player === 'random' ? 'normal' : player, rand));
      continue;
    }
    let id: string;
    if (player === 'random') {
      const legal = g.legalCards(seat);
      id = legal[Math.floor(rand() * legal.length)]!.id;
    } else id = chooseBeloteCard(ctx, player, rand);
    const out = g.play(seat, id);
    if (out.round) return out.round.points;
  }
}

/** Duplicate match: every deal is played twice with the sides swapped. Average points per hand. */
function duel(a: Player, b: Player, deals: number, seed: number) {
  let ptsA = 0;
  let ptsB = 0;
  for (let d = 0; d < deals; d++) {
    const dealSeed = seed * 100003 + d * 7919;
    const r1 = playHand([a, b], dealSeed, dealSeed + 1, d % 4);
    const r2 = playHand([b, a], dealSeed, dealSeed + 2, d % 4);
    ptsA += r1[0] + r2[1];
    ptsB += r1[1] + r2[0];
  }
  return { a: ptsA / (2 * deals), b: ptsB / (2 * deals) };
}

describe('beloteBotContext', () => {
  it('exposes only what the seat may know', () => {
    const rand = seededRandom(11);
    for (let attempt = 0; attempt < 20; attempt++) {
      const g = new BeloteGame({ targetScore: 501, rand: seededRandom(100 + attempt), firstDealer: attempt % 4 });
      g.startRound();
      while (g.phase === 'bidding') g.bid(g.turn, chooseBeloteBid(beloteBotContext(g, g.turn), 'normal', rand));
      for (let i = 0; i < 6; i++) g.play(g.turn, chooseBeloteCard(beloteBotContext(g, g.turn), 'normal', rand));
      const shown = new Set((g.declResult?.counted ?? []).flatMap((d) => d.cards.map((c) => c.id)));
      for (let seat = 0; seat < 4; seat++) {
        const json = JSON.stringify(beloteBotContext(g, seat));
        for (let other = 0; other < 4; other++) {
          if (other === seat) continue;
          for (const card of g.hands[other]!) {
            if (card.id === g.upCard?.id && other === g.taker) continue;
            if (shown.has(card.id)) continue;
            expect(json).not.toContain(`"${card.id}"`);
          }
        }
      }
    }
  });

  it('does not alias the engine state', () => {
    const g = new BeloteGame({ targetScore: 501, rand: seededRandom(3), firstDealer: 0 });
    g.startRound();
    g.bid(1, g.turned!.suit);
    const ctx = beloteBotContext(g, 1);
    ctx.hand.pop();
    ctx.trick.push({ seat: 0, card: parseBeloteCard('SA') });
    expect(g.hands[1]).toHaveLength(8);
    expect(g.trick).toHaveLength(0);
  });
});

describe('bidding', () => {
  it('values trumps, belote and side aces', () => {
    expect(bidValue(cards('HJ H9 HA SA D7 C8'), 'H')).toBeGreaterThan(bidValue(cards('H7 H8 HQ SA D7 C8'), 'H'));
    expect(bidValue(cards('S7 S8 SA D7 C8 C9'), 'H')).toBe(-99);
  });

  it('takes a strong hand and passes a weak one', () => {
    const ctx = (hand: string, up: string, round: 1 | 2 = 1): BeloteBotContext => ({
      ...position({ seat: 1, hand, trump: 'H', taker: 0 }),
      phase: 'bidding',
      trump: null,
      taker: null,
      bidRound: round,
      upCard: parseBeloteCard(up),
    });
    expect(chooseBeloteBid(ctx('HJ H9 SA D7 C8', 'HA'), 'normal')).toBe('H');
    expect(chooseBeloteBid(ctx('H7 S8 D9 C8 C10', 'HQ'), 'normal')).toBeNull();
    // Second round: the best other suit, never the turned one.
    expect(chooseBeloteBid(ctx('SJ S9 SA D7 C8', 'H7', 2), 'normal')).toBe('S');
    expect(chooseBeloteBid(ctx('HJ H9 HA D7 C8', 'H7', 2), 'normal')).toBeNull();
  });

  it('always bids legally in full games, at every level', () => {
    for (const level of LEVELS) {
      const rand = seededRandom(7);
      for (let seed = 1; seed <= 25; seed++) {
        const g = new BeloteGame({ targetScore: 501, rand: seededRandom(seed), firstDealer: seed % 4 });
        g.startRound();
        while (g.phase === 'bidding') {
          const bid = chooseBeloteBid(beloteBotContext(g, g.turn), level, rand);
          expect(g.isLegalBid(g.turn, bid)).toBe(true);
          g.bid(g.turn, bid);
        }
      }
    }
  });
});

describe('chooseBeloteCard', () => {
  it('always plays a legal card in full games, at every level', () => {
    for (const level of LEVELS) {
      const rand = seededRandom(level.length);
      for (let seed = 1; seed <= (level === 'hard' ? 6 : 25); seed++) {
        const g = new BeloteGame({ targetScore: 1e9, rand: seededRandom(seed * 17), firstDealer: seed % 4 });
        g.startRound();
        for (let hand = 0; hand < 3; ) {
          if (g.phase === 'roundOver') g.startRound();
          if (g.phase === 'bidding') {
            g.bid(g.turn, chooseBeloteBid(beloteBotContext(g, g.turn), level, rand));
            continue;
          }
          const id = chooseBeloteCard(beloteBotContext(g, g.turn), level, rand);
          expect(g.isLegalCard(g.turn, id)).toBe(true);
          if (g.play(g.turn, id).round) hand++;
        }
      }
    }
  });

  it('is deterministic for a given random source and leaves the context untouched', () => {
    const g = new BeloteGame({ targetScore: 501, rand: seededRandom(8), firstDealer: 0 });
    g.startRound();
    g.bid(1, g.turned!.suit);
    g.play(1, g.legalCards(1)[0]!.id);
    for (const level of LEVELS) {
      const ctx = beloteBotContext(g, g.turn);
      const before = JSON.stringify(ctx);
      expect(chooseBeloteCard(ctx, level, seededRandom(42))).toBe(chooseBeloteCard(ctx, level, seededRandom(42)));
      expect(JSON.stringify(ctx)).toBe(before);
    }
  });

  it('throws only when there is no card to play', () => {
    expect(() => chooseBeloteCard(position({ seat: 0, hand: '', trump: 'H', taker: 0 }))).toThrow();
  });

  for (const level of ['normal', 'hard'] as const) {
    describe(`plays sensibly (${level})`, () => {
      const pick = (ctx: BeloteBotContext) => chooseBeloteCard(ctx, level, seededRandom(1));

      it('charges the ten onto a trick its partner surely wins', () => {
        expect(pick(position({ seat: 2, hand: 'S10 S8 DA H7 C7 C8 D8', trump: 'H', taker: 0, trick: '0:SA 1:S7' }))).toBe('S10');
      });

      it('wins cheaply as the last player', () => {
        expect(pick(position({ seat: 3, hand: 'SA S10 D7 C7 C8 D8 D9', trump: 'H', taker: 0, trick: '0:SK 1:S7 2:S8' }))).toBe('S10');
      });

      if (level === 'normal') {
        // (Hard's playouts often prefer a small trump: everybody must climb, and the jack stays master.)
        it('draws trumps with the master jack as the taker', () => {
          expect(pick(position({ seat: 0, hand: 'HJ H7 H8 SA DK C8 C9 D7', trump: 'H', taker: 0 }))).toBe('HJ');
        });
      }

      it('does not lead a ten while its ace is out', () => {
        expect(pick(position({ seat: 1, hand: 'S10 S7 DK C9 C8 D7 D8 C7', trump: 'H', taker: 0 }))).not.toBe('S10');
      });

      it('keeps its points when it cannot win the trick', () => {
        expect(pick(position({ seat: 1, hand: 'S8 SK D10 C7 C8 D8 D9', trump: 'H', taker: 0, trick: '0:SA' }))).toBe('S8');
      });
    });
  }
});

describe('strength (average points per hand, duplicate deals)', () => {
  it('normal clearly beats random card play', () => {
    const r = duel('normal', 'random', 120, 1);
    expect(r.a - r.b).toBeGreaterThan(25); // measured: 116 vs 79 per hand
  });

  it('easy is weaker than normal', () => {
    const r = duel('easy', 'normal', 150, 2);
    expect(r.a).toBeLessThan(r.b); // measured: 90 vs 107 per hand
  });

  it('hard is at least as good as normal', { timeout: 60000 }, () => {
    const r = duel('hard', 'normal', 100, 3);
    expect(r.a).toBeGreaterThan(r.b); // measured: 109 vs 85 per hand (108 vs 89 over 400 deals)
  });

  it('decides quickly', { timeout: 60000 }, () => {
    const rand = seededRandom(77);
    for (const level of LEVELS) {
      let total = 0;
      let worst = 0;
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const g = new BeloteGame({ targetScore: 1e9, rand: seededRandom(seed), firstDealer: seed % 4 });
        g.startRound();
        while (g.phase === 'bidding') g.bid(g.turn, chooseBeloteBid(beloteBotContext(g, g.turn), 'normal', rand));
        while (g.phase === 'playing') {
          const ctx = beloteBotContext(g, g.turn);
          const t0 = performance.now();
          const id = chooseBeloteCard(ctx, level, rand);
          const dt = performance.now() - t0;
          total += dt;
          worst = Math.max(worst, dt);
          n++;
          expect(legalCards(g.hands[g.turn]!, g.trick, g.trump!, g.turn).some((c) => c.id === id)).toBe(true);
          g.play(g.turn, id);
        }
      }
      expect(total / n).toBeLessThan(10); // measured: easy/normal ~0.01 ms, hard ~1.5 ms on average
      expect(worst).toBeLessThan(250);
    }
  });
});
