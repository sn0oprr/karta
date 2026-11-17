import { describe, expect, it } from 'vitest';
import { type Suit, seededRandom } from '../src/shared/cards';
import { type AuctionAction, type BCard, BeloteGame, type TrickPlay, parseBeloteCard } from '../src/shared/belote';
import { type BeloteBotContext, type BotLevel, beloteBotContext, chooseBeloteCall, chooseBeloteCard } from '../src/shared/beloteBot';
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

/** A playing position for `seat`: the taker bid 90 in `trump`, the trick so far is given, nothing else known. */
function position(o: { seat: number; hand: string; trump: Suit; taker: number; trick?: string }): BeloteBotContext {
  const t = trick(o.trick ?? '');
  const counts = [0, 1, 2, 3].map((s) => (s === o.seat ? cards(o.hand).length : 8 - (t.some((p) => p.seat === s) ? 1 : 0)));
  const contract = { seat: o.taker, value: 90, suit: o.trump };
  return {
    seat: o.seat,
    dealer: 3,
    phase: 'playing',
    hand: cards(o.hand),
    auction: [{ seat: o.taker, call: { type: 'bid', value: 90, suit: o.trump } }],
    contract,
    coinche: 1,
    trump: o.trump,
    taker: o.taker,
    trick: t,
    tricks: [],
    handCounts: counts,
    belote: null,
    scores: [0, 0],
    targetScore: 1500,
  };
}

/** An auction position for `seat` (the dealer is seat 3, so seat 0 speaks first). */
function auction(seat: number, hand: string, calls: AuctionAction[] = []): BeloteBotContext {
  const g = new BeloteGame({ targetScore: 1500, rand: seededRandom(1), firstDealer: 3 });
  g.startRound();
  for (const a of calls) g.call(a.seat, a.call);
  expect(g.turn).toBe(seat);
  return { ...beloteBotContext(g, seat), hand: cards(hand) };
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
      g.call(seat, chooseBeloteCall(ctx, player === 'random' ? 'normal' : player, rand));
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
    for (let attempt = 0; attempt < 12; attempt++) {
      const g = new BeloteGame({ targetScore: 1500, rand: seededRandom(100 + attempt), firstDealer: attempt % 4 });
      g.startRound();
      while (g.phase === 'bidding') g.call(g.turn, chooseBeloteCall(beloteBotContext(g, g.turn), 'normal', rand));
      for (let i = 0; i < 6 && g.phase === 'playing'; i++) g.play(g.turn, chooseBeloteCard(beloteBotContext(g, g.turn), 'normal', rand));
      for (let seat = 0; seat < 4; seat++) {
        const json = JSON.stringify(beloteBotContext(g, seat));
        for (let other = 0; other < 4; other++) {
          if (other === seat) continue;
          for (const card of g.hands[other]!) expect(json).not.toContain(`"${card.id}"`);
        }
      }
    }
  });

  it('does not alias the engine state', () => {
    const g = new BeloteGame({ targetScore: 1500, rand: seededRandom(3), firstDealer: 3 });
    g.startRound();
    g.call(0, { type: 'bid', value: 90, suit: 'H' });
    const ctx = beloteBotContext(g, 1);
    ctx.hand.pop();
    ctx.auction.push({ seat: 1, call: { type: 'pass' } });
    ctx.contract!.value = 160;
    expect(g.hands[1]).toHaveLength(8);
    expect(g.auction).toHaveLength(1);
    expect(g.contract!.value).toBe(90);
  });
});

describe('chooseBeloteCall', () => {
  const call = (ctx: BeloteBotContext, level: BotLevel = 'normal') => chooseBeloteCall(ctx, level, seededRandom(5));

  it('opens with a good hand in its best suit, and passes a poor one', () => {
    expect(call(auction(0, 'SJ S9 SA S10 D7 D8 C7 H8'))).toMatchObject({ type: 'bid', value: 90, suit: 'S' });
    expect(call(auction(0, 'S7 S8 D9 D8 C7 C8 H7 HQ'))).toEqual({ type: 'pass' });
  });

  it('calls Kabbout when it takes every trick', () => {
    expect(call(auction(0, 'HJ H9 HA H10 HK HQ SA DA'))).toEqual({ type: 'bid', value: 'kabbout', suit: 'H' });
  });

  it('says contre against a contract its hand defeats', () => {
    const ctx = auction(1, 'HJ H9 HA S7 D8 C7 C8 D7', [{ seat: 0, call: { type: 'bid', value: 160, suit: 'H' } }]);
    expect(call(ctx)).toEqual({ type: 'contre' });
    // Easy bots never double.
    expect(call(ctx, 'easy').type).not.toBe('contre');
  });

  it('answers a contre with surcontre when its side surely makes it', () => {
    const ctx = auction(2, 'HJ H9 HA H10 HK HQ SA DA', [
      { seat: 0, call: { type: 'bid', value: 90, suit: 'H' } },
      { seat: 1, call: { type: 'contre' } },
    ]);
    expect(call(ctx)).toEqual({ type: 'surcontre' });
  });

  it('lets its partner’s contract stand with an ordinary hand', () => {
    const ctx = auction(2, 'S7 D9 D8 C7 C8 H7 HQ CK', [
      { seat: 0, call: { type: 'bid', value: 90, suit: 'S' } },
      { seat: 1, call: { type: 'pass' } },
    ]);
    expect(call(ctx)).toEqual({ type: 'pass' });
  });

  it('always calls legally in full auctions, at every level', () => {
    for (const level of LEVELS) {
      const rand = seededRandom(7);
      for (let seed = 1; seed <= (level === 'hard' ? 8 : 20); seed++) {
        const g = new BeloteGame({ targetScore: 1500, rand: seededRandom(seed), firstDealer: seed % 4 });
        g.startRound();
        while (g.phase === 'bidding') {
          const c = chooseBeloteCall(beloteBotContext(g, g.turn), level, rand);
          expect(g.isLegalCall(g.turn, c)).toBe(true);
          g.call(g.turn, c);
        }
      }
    }
  });
});

describe('chooseBeloteCard', () => {
  it('always plays a legal card in full games, at every level', () => {
    for (const level of LEVELS) {
      const rand = seededRandom(level.length);
      for (let seed = 1; seed <= (level === 'hard' ? 4 : 15); seed++) {
        const g = new BeloteGame({ targetScore: 1e9, rand: seededRandom(seed * 17), firstDealer: seed % 4 });
        g.startRound();
        for (let hand = 0; hand < 2; ) {
          if (g.phase === 'roundOver') g.startRound();
          if (g.phase === 'bidding') {
            g.call(g.turn, chooseBeloteCall(beloteBotContext(g, g.turn), 'normal', rand));
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
    const g = new BeloteGame({ targetScore: 1500, rand: seededRandom(8), firstDealer: 3 });
    g.startRound();
    g.call(0, { type: 'bid', value: 90, suit: 'H' });
    for (const s of [1, 2, 3]) g.call(s, { type: 'pass' });
    g.play(0, g.legalCards(0)[0]!.id);
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
  it('normal clearly beats random card play', { timeout: 60000 }, () => {
    const r = duel('normal', 'random', 80, 1);
    expect(r.a - r.b).toBeGreaterThan(40); // measured: 138 vs 64 per hand
  });

  it('easy is weaker than normal', { timeout: 60000 }, () => {
    const r = duel('easy', 'normal', 100, 2);
    expect(r.a).toBeLessThan(r.b); // measured: 79 vs 106 per hand
  });

  it('hard is at least as good as normal', { timeout: 120000 }, () => {
    const r = duel('hard', 'normal', 60, 3);
    expect(r.a).toBeGreaterThan(r.b); // measured: 101 vs 78 per hand (111 vs 81 over 300 deals)
  });

  it('decides quickly', { timeout: 60000 }, () => {
    const rand = seededRandom(77);
    for (const level of LEVELS) {
      const time = { call: { total: 0, worst: 0, n: 0 }, card: { total: 0, worst: 0, n: 0 } };
      const timed = <T>(kind: 'call' | 'card', f: () => T): T => {
        const t0 = performance.now();
        const v = f();
        const dt = performance.now() - t0;
        time[kind].total += dt;
        time[kind].worst = Math.max(time[kind].worst, dt);
        time[kind].n++;
        return v;
      };
      for (let seed = 1; seed <= 6; seed++) {
        const g = new BeloteGame({ targetScore: 1e9, rand: seededRandom(seed), firstDealer: seed % 4 });
        g.startRound();
        while (g.phase === 'bidding') g.call(g.turn, timed('call', () => chooseBeloteCall(beloteBotContext(g, g.turn), level, rand)));
        while (g.phase === 'playing') g.play(g.turn, timed('card', () => chooseBeloteCard(beloteBotContext(g, g.turn), level, rand)));
      }
      for (const kind of ['call', 'card'] as const) {
        expect(time[kind].total / time[kind].n).toBeLessThan(40);
        expect(time[kind].worst).toBeLessThan(400);
      }
    }
  });
});
