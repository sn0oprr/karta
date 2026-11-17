/**
 * Computer players for Belote.
 *
 * A bot only reasons with what its seat may know (see `beloteBotContext`): its own hand, the turned card and
 * the bids, every card played so far, the hand sizes, what was announced, and what follows from the rules — a
 * player who did not follow suit has none left; one who did not trump an opponent's trick has no trumps; one
 * who played a lower trump when obliged to go higher has no higher trump.
 *
 * Bidding (every level): the hand, with the turned card, is valued for each suit it may take — the jack and
 * nine of trumps, trump length, belote, side aces and guarded tens, voids to trump with — and the best suit is
 * taken when its value clears a threshold measured with self-play.
 *
 * Card play works on a compact model (cards as bits of a 32-bit mask):
 *  - normal: card-play heuristics. Takers draw trumps with the master trump; everybody cashes master cards
 *    the opponents cannot trump; a player "charges" points onto a trick their partner surely wins; an
 *    opponent's trick is won as cheaply as possible, with a card no later opponent can beat; otherwise the
 *    cheapest card goes (never a ten whose ace is still out, never a trump without need).
 *  - easy: the same, but now and then a random legal card, and looser bidding.
 *  - hard: Monte Carlo. Hands for the other players are dealt at random, consistent with everything known;
 *    each legal card is played out to the end of the hand with the normal heuristics for all four players,
 *    and the card with the best average hand score (contract rules applied) is played.
 *
 * Cost per decision: easy/normal ~5 µs; hard ~5–15 ms early in a hand, less as it goes (a work budget caps it).
 */
import { SUITS, type Suit } from './cards';
import {
  BELOTE_RANKS,
  type BCard,
  type BRank,
  type BeloteGame,
  type BidInfo,
  type DeclarationsResult,
  type PublicDeclaration,
  type TrickPlay,
  makeBeloteCard,
  publicDeclaration,
} from './belote';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface BeloteBotContext {
  seat: number;
  dealer: number;
  phase: 'bidding' | 'playing';
  hand: BCard[];
  bidRound: 1 | 2;
  /** The card turned up for the bidding; once taken, everybody knows the taker holds it until played. */
  upCard: BCard | null;
  bids: BidInfo[];
  trump: Suit | null;
  taker: number | null;
  /** The trick in progress, in play order. */
  trick: TrickPlay[];
  /** Completed tricks of this hand. */
  tricks: { plays: TrickPlay[]; winner: number }[];
  handCounts: number[];
  /** The seat that said "Belote", and how many of the two cards it has played. */
  belote: { seat: number; stage: number } | null;
  /** Announcements made so far, as the table heard them (their cards are not shown). */
  declared: PublicDeclaration[];
  /** The bot's own announcements this hand (made with its first card). */
  ownDeclarations: PublicDeclaration[];
  /** Which announcements count, once the first trick is over (their cards are shown). */
  declResult: DeclarationsResult | null;
  scores: [number, number];
  targetScore: number;
}

/** The bot's view of the game for `seat`: only what that seat is entitled to know. */
export function beloteBotContext(game: BeloteGame, seat: number): BeloteBotContext {
  // Players declare with their first card: those who played in the first trick have declared.
  const firstTrick = game.tricks.length > 0 ? game.tricks[0]!.plays : game.trick;
  const declared = firstTrick.flatMap((p) => (game.declarations[p.seat] ?? []).map(publicDeclaration));
  return {
    seat,
    dealer: game.dealer,
    phase: game.phase === 'bidding' ? 'bidding' : 'playing',
    hand: [...(game.hands[seat] ?? [])],
    bidRound: game.bidRound,
    upCard: game.upCard,
    bids: [...game.bids],
    trump: game.trump,
    taker: game.taker,
    trick: [...game.trick],
    tricks: game.tricks.map((t) => ({ plays: [...t.plays], winner: t.winner })),
    handCounts: game.hands.map((h) => h.length),
    belote: game.beloteSaid,
    declared,
    ownDeclarations: (game.declarations[seat] ?? []).map(publicDeclaration),
    declResult: game.declResult,
    scores: [game.scores[0], game.scores[1]],
    targetScore: game.targetScore,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Bidding
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What each trump is worth to the taker (bidding units, roughly tricks × 3). */
const TRUMP_BID: Readonly<Record<BRank, number>> = { J: 7, '9': 4.5, A: 2.5, '10': 2, K: 1, Q: 1, '8': 0.8, '7': 0.8 };

/**
 * Take when the hand is worth this much. Measured with self-play (normal bots, 8000 hands per point): against
 * a table bidding at 13, bidding at 10 gains 8 points a hand; against a table at 10, anything from 9 to 12 is
 * within ±2 points, so 10 is about an equilibrium — and it leaves about one redeal every 8 hands.
 */
export const BID_THRESHOLD = 10;
const EASY_BID_SHIFT = -1.5;
const EASY_BID_NOISE = 3;
const EASY_RANDOM_CARD = 0.25;

/** Value of `cards` (the hand and the turned card) with `trump` as trumps. */
export function bidValue(cards: readonly BCard[], trump: Suit): number {
  const trumps = cards.filter((c) => c.suit === trump);
  if (trumps.length === 0) return -99;
  const has = (rank: BRank) => trumps.some((c) => c.rank === rank);
  let v = 0;
  for (const c of trumps) v += TRUMP_BID[c.rank];
  if (has('J') && has('9')) v += 1.5;
  if (has('K') && has('Q')) v += 2;
  if (trumps.length === 1) v -= 3.5;
  else if (trumps.length === 2) v -= 1;
  else if (trumps.length >= 4) v += (trumps.length - 3) * 1.5;
  for (const s of SUITS) {
    if (s === trump) continue;
    const side = cards.filter((c) => c.suit === s);
    const ace = side.some((c) => c.rank === 'A');
    const ten = side.some((c) => c.rank === '10');
    if (ace) v += 2.5;
    if (ace && ten) v += 2;
    else if (ten && side.length >= 2) v += 0.5;
    if (side.length === 0 && trumps.length >= 2) v += 1;
  }
  return v;
}

/** The bot's bid: the trump suit to take, or null to pass. Always a legal bid. */
export function chooseBeloteBid(ctx: BeloteBotContext, level: BotLevel = 'normal', rand: () => number = Math.random): Suit | null {
  const up = ctx.upCard;
  if (!up) return null;
  const cards = [...ctx.hand, up];
  const threshold = BID_THRESHOLD + (level === 'easy' ? EASY_BID_SHIFT + (rand() - 0.5) * 2 * EASY_BID_NOISE : 0);
  if (ctx.bidRound === 1) return bidValue(cards, up.suit) >= threshold ? up.suit : null;
  let best: Suit | null = null;
  let bestValue = threshold;
  for (const s of SUITS) {
    if (s === up.suit) continue;
    const v = bidValue(cards, s);
    if (v >= bestValue) {
      best = s;
      bestValue = v;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Cards as bits: code = suit * 8 + rank, suits in SUITS order (D H C S), ranks 7 8 9 10 J Q K A.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const SUIT_INDEX: Readonly<Record<Suit, number>> = { D: 0, H: 1, C: 2, S: 3 };
const RANK_INDEX: Readonly<Record<BRank, number>> = { '7': 0, '8': 1, '9': 2, '10': 3, J: 4, Q: 5, K: 6, A: 7 };
const SUIT_MASK = [0, 1, 2, 3].map((s) => (0xff << (s * 8)) | 0);
const TRUMP_STRENGTH = [0, 1, 6, 4, 7, 2, 3, 5];
const PLAIN_STRENGTH = [0, 1, 2, 6, 3, 4, 5, 7];
const TRUMP_POINTS = [0, 0, 14, 10, 20, 3, 4, 11];
const PLAIN_POINTS = [0, 0, 0, 10, 2, 3, 4, 11];
const TEN = 3;
const QUEEN = 5;
const KING = 6;
const ACE = 7;

/** Indexed [trump * 32 + code]: strength within the suit, points, and the mask of stronger cards of the suit. */
const STR = new Int8Array(128);
const PTS = new Int8Array(128);
const HIGHER = new Int32Array(128);
for (let t = 0; t < 4; t++) {
  for (let code = 0; code < 32; code++) {
    const s = code >> 3;
    const strength = s === t ? TRUMP_STRENGTH : PLAIN_STRENGTH;
    STR[t * 32 + code] = strength[code & 7]!;
    PTS[t * 32 + code] = (s === t ? TRUMP_POINTS : PLAIN_POINTS)[code & 7]!;
    let higher = 0;
    for (let r = 0; r < 8; r++) if (strength[r]! > strength[code & 7]!) higher |= 1 << (s * 8 + r);
    HIGHER[t * 32 + code] = higher;
  }
}

const CARD_OF: BCard[] = [];
for (let code = 0; code < 32; code++) CARD_OF.push(makeBeloteCard(BELOTE_RANKS[code & 7]!, SUITS[code >> 3]!));

function codeOf(card: BCard): number {
  return SUIT_INDEX[card.suit] * 8 + RANK_INDEX[card.rank];
}

function maskOf(cards: readonly BCard[]): number {
  let m = 0;
  for (const c of cards) m |= 1 << codeOf(c);
  return m;
}

/** Code of the lowest set bit. */
function lowCode(m: number): number {
  return 31 - Math.clz32(m & -m);
}

function bitCount(m: number): number {
  let n = 0;
  for (; m !== 0; m &= m - 1) n++;
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Simulation state
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

class Sim {
  hands = [0, 0, 0, 0];
  /** Cards played this hand (completed tricks and the trick in progress). */
  played = 0;
  tSeat = [0, 0, 0, 0];
  tCode = [0, 0, 0, 0];
  tLen = 0;
  turn = 0;
  /** Suits each player is known to be out of (bit per suit). */
  voids = [0, 0, 0, 0];
  /** Card points won per team (the last trick's 10 included), tricks won per team, tricks completed. */
  pts = [0, 0];
  won = [0, 0];
  done = 0;

  constructor(
    readonly trump: number,
    readonly taker: number,
  ) {}

  clone(): Sim {
    const s = new Sim(this.trump, this.taker);
    s.hands = this.hands.slice();
    s.played = this.played;
    s.tSeat = this.tSeat.slice();
    s.tCode = this.tCode.slice();
    s.tLen = this.tLen;
    s.turn = this.turn;
    s.voids = this.voids.slice();
    s.pts = this.pts.slice();
    s.won = this.won.slice();
    s.done = this.done;
    return s;
  }

  beats(a: number, b: number): boolean {
    const sa = a >> 3;
    if (sa === b >> 3) return STR[this.trump * 32 + a]! > STR[this.trump * 32 + b]!;
    return sa === this.trump;
  }

  winnerIndex(): number {
    let best = 0;
    for (let i = 1; i < this.tLen; i++) if (this.beats(this.tCode[i]!, this.tCode[best]!)) best = i;
    return best;
  }

  /** Strongest trump in the trick so far (−1 if none). */
  topTrump(): number {
    let top = -1;
    for (let i = 0; i < this.tLen; i++) {
      const c = this.tCode[i]!;
      if (c >> 3 === this.trump) top = Math.max(top, STR[this.trump * 32 + c]!);
    }
    return top;
  }

  legal(seat: number): number {
    const hand = this.hands[seat]!;
    if (this.tLen === 0) return hand;
    const T = this.trump;
    const led = this.tCode[0]! >> 3;
    const follow = hand & SUIT_MASK[led]!;
    if (follow !== 0) return led === T ? above(follow, T, this.topTrump()) || follow : follow;
    const trumps = hand & SUIT_MASK[T]!;
    if (trumps === 0) return hand;
    if ((this.tSeat[this.winnerIndex()]! & 1) === (seat & 1)) return hand;
    return above(trumps, T, this.topTrump()) || trumps;
  }

  apply(seat: number, code: number) {
    const T = this.trump;
    if (this.tLen > 0) {
      const led = this.tCode[0]! >> 3;
      const s = code >> 3;
      if (s !== led) {
        this.voids[seat]! |= 1 << led;
        // A discard on an opponent's trick: no trumps either.
        if (led !== T && s !== T && (this.tSeat[this.winnerIndex()]! & 1) !== (seat & 1)) this.voids[seat]! |= 1 << T;
      }
    }
    const bit = 1 << code;
    this.hands[seat]! &= ~bit;
    this.played |= bit;
    this.tSeat[this.tLen] = seat;
    this.tCode[this.tLen] = code;
    this.tLen++;
    if (this.tLen < 4) {
      this.turn = (seat + 1) & 3;
      return;
    }
    const w = this.tSeat[this.winnerIndex()]!;
    let p = 0;
    for (let i = 0; i < 4; i++) p += PTS[T * 32 + this.tCode[i]!]!;
    this.done++;
    if (this.done === 8) p += 10;
    this.pts[w & 1]! += p;
    this.won[w & 1]! += 1;
    this.tLen = 0;
    this.turn = w;
  }
}

/** Cards of `mask` (trumps) stronger than trump strength `top`. */
function above(mask: number, trump: number, top: number): number {
  let out = 0;
  for (let m = mask; m !== 0; m &= m - 1) {
    const c = lowCode(m);
    if (STR[trump * 32 + c]! > top) out |= 1 << c;
  }
  return out;
}

/** Builds the model from the context: the bot's hand, the cards played, the trick and the known voids. */
function buildSim(ctx: BeloteBotContext): Sim {
  const T = SUIT_INDEX[ctx.trump!];
  const sim = new Sim(T, ctx.taker ?? 0);
  sim.hands[ctx.seat] = maskOf(ctx.hand);
  const replay = (plays: readonly TrickPlay[]) => {
    for (const p of plays) {
      // Others' cards are added to their hands just before being played, so the void inference runs.
      sim.hands[p.seat]! |= 1 << codeOf(p.card);
      sim.apply(p.seat, codeOf(p.card));
    }
  };
  for (const t of ctx.tricks) replay(t.plays);
  replay(ctx.trick);
  sim.hands[ctx.seat] = maskOf(ctx.hand);
  for (let s = 0; s < 4; s++) if (s !== ctx.seat) sim.hands[s] = 0;
  sim.turn = ctx.seat;
  return sim;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Heuristic play (normal level, and every player in the hard level's playouts)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function heuristic(sim: Sim, seat: number): number {
  const legal = sim.legal(seat);
  if ((legal & (legal - 1)) === 0) return lowCode(legal);
  return sim.tLen === 0 ? lead(sim, seat, legal) : follow(sim, seat, legal);
}

/** Could an opponent of `seat` trump suit `s` (out of it, or probably out, and not out of trumps)? */
function trumpable(sim: Sim, seat: number, s: number, unseen: number): boolean {
  const T = sim.trump;
  if ((unseen & SUIT_MASK[T]!) === 0) return false;
  const thin = bitCount(unseen & SUIT_MASK[s]!) <= 1;
  for (const o of [(seat + 1) & 3, (seat + 3) & 3]) {
    const v = sim.voids[o]!;
    if (!((v >> T) & 1) && (((v >> s) & 1) || thin)) return true;
  }
  return false;
}

function lead(sim: Sim, seat: number, legal: number): number {
  const T = sim.trump;
  const base = T * 32;
  const hand = sim.hands[seat]!;
  const unseen = ~sim.played & ~hand;
  const attack = (sim.taker & 1) === (seat & 1);
  const myTrumps = hand & SUIT_MASK[T]!;
  const o1 = (seat + 1) & 3;
  const o2 = (seat + 3) & 3;
  const oppTrumps = (unseen & SUIT_MASK[T]!) !== 0 && (!((sim.voids[o1]! >> T) & 1) || !((sim.voids[o2]! >> T) & 1));

  // Takers draw the opponents' trumps: with the master trump, or the taker with a long suit.
  if (attack && myTrumps !== 0 && oppTrumps) {
    const top = strongest(myTrumps, base);
    if ((HIGHER[base + top]! & unseen) === 0) return top;
    if (seat === sim.taker && bitCount(myTrumps) >= 3) return weakest(myTrumps, base);
  }

  // Cash a master card the opponents cannot trump.
  let best = -1;
  let bestScore = -Infinity;
  for (let s = 0; s < 4; s++) {
    if (s === T) continue;
    const mine = hand & SUIT_MASK[s]!;
    if (mine === 0) continue;
    const top = strongest(mine, base);
    if ((HIGHER[base + top]! & unseen) !== 0) continue;
    if (oppTrumps && trumpable(sim, seat, s, unseen)) continue;
    const score = PTS[base + top]! + bitCount(mine) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = top;
    }
  }
  if (best >= 0) return best;

  // Otherwise the cheapest lead.
  let pick = lowCode(legal);
  let pickCost = Infinity;
  for (let m = legal; m !== 0; m &= m - 1) {
    const c = lowCode(m);
    const s = c >> 3;
    let cost: number;
    if (s === T) cost = (attack ? 14 : 40) + STR[base + c]!;
    else {
      cost = PTS[base + c]! + STR[base + c]! * 0.3;
      // A ten led while its ace is out is a gift.
      if ((c & 7) === TEN && unseen & (1 << (s * 8 + ACE))) cost += 12;
      // Defenders shorten a suit to trump it later.
      if (!attack && myTrumps !== 0 && bitCount(hand & SUIT_MASK[s]!) === 1) cost -= 3;
    }
    if (cost < pickCost) {
      pickCost = cost;
      pick = c;
    }
  }
  return pick;
}

function follow(sim: Sim, seat: number, legal: number): number {
  const T = sim.trump;
  const base = T * 32;
  const hand = sim.hands[seat]!;
  const unseen = ~sim.played & ~hand;
  const us = seat & 1;
  const led = sim.tCode[0]! >> 3;
  const wi = sim.winnerIndex();
  const wCode = sim.tCode[wi]!;
  let trickPts = 0;
  for (let i = 0; i < sim.tLen; i++) trickPts += PTS[base + sim.tCode[i]!]!;
  const outTrumps = unseen & SUIT_MASK[T]!;
  const ledThin = bitCount(unseen & SUIT_MASK[led]!) <= 2;
  // Opponents still to play after this seat.
  const later: number[] = [];
  for (let k = 1; k <= 3 - sim.tLen; k++) {
    const p = (seat + k) & 3;
    if ((p & 1) !== us) later.push(p);
  }
  /** Could a later opponent beat `code` if it were winning the trick? */
  const beatable = (code: number): boolean => {
    const cs = code >> 3;
    for (const o of later) {
      const v = sim.voids[o]!;
      const mayTrump = led !== T && outTrumps !== 0 && !((v >> T) & 1) && (((v >> led) & 1) !== 0 || ledThin);
      if (cs === led) {
        if (!((v >> led) & 1) && (HIGHER[base + code]! & unseen) !== 0) return true;
        if (mayTrump) return true;
      } else if (cs === T && mayTrump && (HIGHER[base + code]! & unseen) !== 0) return true;
    }
    return false;
  };
  const master = (c: number) => (HIGHER[base + c]! & unseen) === 0;
  /** What throwing `c` away costs. */
  const discardCost = (c: number) => {
    let cost = PTS[base + c]!;
    if (c >> 3 === T) cost += 15 + STR[base + c]!;
    else if (master(c)) cost += 7;
    return cost;
  };

  if ((sim.tSeat[wi]! & 1) === us) {
    if (!beatable(wCode)) {
      // The partner wins it: charge points (not trumps, and rather not a master that wins on its own).
      let pick = lowCode(legal);
      let score = -Infinity;
      for (let m = legal; m !== 0; m &= m - 1) {
        const c = lowCode(m);
        const v = c >> 3 === T ? -20 - STR[base + c]! : PTS[base + c]! - (master(c) ? 6 : 0);
        if (v > score) {
          score = v;
          pick = c;
        }
      }
      return pick;
    }
    return argMin(legal, discardCost);
  }

  let winners = 0;
  for (let m = legal; m !== 0; m &= m - 1) {
    const c = lowCode(m);
    if (sim.beats(c, wCode)) winners |= 1 << c;
  }
  if (winners !== 0) {
    const cost = (c: number) => (c >> 3 === T ? 8 : 0) + STR[base + c]!;
    if (later.length === 0) return argMin(winners, cost);
    let safe = 0;
    for (let m = winners; m !== 0; m &= m - 1) {
      const c = lowCode(m);
      if (!beatable(c)) safe |= 1 << c;
    }
    if (safe !== 0) return argMin(safe, cost);
    if (trickPts >= 10) return argMin(winners, (c) => -cost(c));
  }
  return argMin(legal, discardCost);
}

function argMin(mask: number, cost: (c: number) => number): number {
  let pick = lowCode(mask);
  let best = Infinity;
  for (let m = mask; m !== 0; m &= m - 1) {
    const c = lowCode(m);
    const v = cost(c);
    if (v < best) {
      best = v;
      pick = c;
    }
  }
  return pick;
}

function strongest(mask: number, base: number): number {
  return argMin(mask, (c) => -STR[base + c]!);
}

function weakest(mask: number, base: number): number {
  return argMin(mask, (c) => STR[base + c]!);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Hard: Monte Carlo over the hidden hands
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Deals sampled per decision, and the work budget (playout steps) that caps a decision's cost. */
const WORLDS = 40;
const WORK_BUDGET = 60000;

interface Knowledge {
  /** Cards known to be in each seat's hand. */
  known: number[];
  /** Highest trump strength each seat may still hold (7 = no limit). */
  maxTrump: number[];
}

/** What the rules and the announcements reveal about the hidden hands. */
function knowledge(ctx: BeloteBotContext, sim: Sim): Knowledge {
  const T = sim.trump;
  const known = [0, 0, 0, 0];
  const maxTrump = [7, 7, 7, 7];
  const unplayed = ~sim.played;
  if (ctx.taker !== null && ctx.upCard) known[ctx.taker]! |= (1 << codeOf(ctx.upCard)) & unplayed;
  if (ctx.belote && ctx.belote.stage === 1) known[ctx.belote.seat]! |= ((1 << (T * 8 + KING)) | (1 << (T * 8 + QUEEN))) & unplayed;
  for (const d of ctx.declResult?.counted ?? []) known[d.seat]! |= maskOf(d.cards) & unplayed;
  // A lower trump played when going higher was required (a trump lead, or trumping an opponent's trick):
  // no higher trump left.
  for (const plays of [...ctx.tricks.map((x) => x.plays), ctx.trick]) {
    let top = -1;
    let winner = -1;
    let winCode = -1;
    const led = plays.length ? SUIT_INDEX[plays[0]!.card.suit] : -1;
    for (const p of plays) {
      const c = codeOf(p.card);
      if (c >> 3 === T) {
        const s = STR[T * 32 + c]!;
        const obliged = led === T || (winner >= 0 && (winner & 1) !== (p.seat & 1));
        if (top >= 0 && s < top && obliged) maxTrump[p.seat] = Math.min(maxTrump[p.seat]!, top);
        top = Math.max(top, s);
      }
      if (winCode < 0 || sim.beats(c, winCode)) {
        winner = p.seat;
        winCode = c;
      }
    }
  }
  known[ctx.seat] = 0;
  return { known, maxTrump };
}

/** Deals the hidden cards to the other seats, consistent with what is known; null if that failed. */
function sampleHands(ctx: BeloteBotContext, sim: Sim, info: Knowledge, rand: () => number, strict: number): number[] | null {
  const T = sim.trump;
  const me = ctx.seat;
  const hands = [0, 0, 0, 0];
  hands[me] = sim.hands[me]!;
  const room = [0, 0, 0, 0];
  let pool = ~sim.played & ~sim.hands[me]!;
  for (let s = 0; s < 4; s++) {
    if (s === me) continue;
    hands[s] = info.known[s]! & pool;
    room[s] = (ctx.handCounts[s] ?? 0) - bitCount(hands[s]!);
    if (room[s]! < 0) return null;
  }
  for (let s = 0; s < 4; s++) if (s !== me) pool &= ~hands[s]!;
  const cards: number[] = [];
  for (let m = pool; m !== 0; m &= m - 1) cards.push(lowCode(m));
  const allowed = (s: number, c: number) => {
    if (strict >= 1 && (sim.voids[s]! >> (c >> 3)) & 1) return false;
    if (strict >= 2 && c >> 3 === T && STR[T * 32 + c]! > info.maxTrump[s]!) return false;
    return true;
  };
  // Most constrained cards first.
  const options = cards.map((c) => {
    let n = 0;
    for (let s = 0; s < 4; s++) if (s !== me && allowed(s, c)) n++;
    return n + rand() * 0.5;
  });
  const order = cards.map((_, i) => i).sort((a, b) => options[a]! - options[b]!);
  for (const i of order) {
    const c = cards[i]!;
    let total = 0;
    for (let s = 0; s < 4; s++) if (s !== me && room[s]! > 0 && allowed(s, c)) total += room[s]!;
    if (total === 0) return null;
    let r = rand() * total;
    for (let s = 0; s < 4; s++) {
      if (s === me || room[s]! <= 0 || !allowed(s, c)) continue;
      r -= room[s]!;
      if (r < 0) {
        hands[s]! |= 1 << c;
        room[s]!--;
        break;
      }
    }
  }
  return room.every((n, s) => s === me || n === 0) ? hands : null;
}

function sampleWorld(ctx: BeloteBotContext, sim: Sim, info: Knowledge, rand: () => number): number[] | null {
  for (const strict of [2, 1, 0]) {
    for (let attempt = 0; attempt < (strict === 0 ? 1 : 6); attempt++) {
      const hands = sampleHands(ctx, sim, info, rand, strict);
      if (hands) return hands;
    }
  }
  return null;
}

/** Hand score difference (the bot's team minus the other) of a finished playout, contract rules applied. */
function evaluate(sim: Sim, us: number, belote: number, decl: [number, number]): number {
  const takers = sim.taker & 1;
  const defenders = takers ^ 1;
  const card = [sim.pts[0]!, sim.pts[1]!];
  let capot = -1;
  if (sim.won[0] === 8) capot = 0;
  else if (sim.won[1] === 8) capot = 1;
  if (capot >= 0) {
    card[capot] = 250;
    card[capot ^ 1] = 0;
  }
  const bel = [belote === 0 ? 20 : 0, belote === 1 ? 20 : 0];
  const made = [card[0]! + bel[0]! + decl[0], card[1]! + bel[1]! + decl[1]];
  const points = [0, 0];
  if (made[takers]! > made[defenders]!) {
    points[0] = made[0]!;
    points[1] = made[1]!;
  } else {
    points[defenders] = made[takers] === made[defenders] ? made[defenders]! : (capot === defenders ? 250 : 162) + decl[0] + decl[1] + bel[defenders]!;
    points[takers] = bel[takers]!;
  }
  return points[us]! - points[us ^ 1]!;
}

/** Team holding belote in a world (−1: nobody). */
function beloteTeam(ctx: BeloteBotContext, sim: Sim, hands: readonly number[]): number {
  if (ctx.belote) return ctx.belote.seat & 1;
  const T = sim.trump;
  const pair = (1 << (T * 8 + KING)) | (1 << (T * 8 + QUEEN));
  // One of them already played without a word: nobody held both.
  if (sim.played & pair) return -1;
  for (let s = 0; s < 4; s++) if ((hands[s]! & pair) === pair) return s & 1;
  return -1;
}

/** Announcement points that count, as far as the bot knows (before the first trick ends: a good guess). */
function declPoints(ctx: BeloteBotContext): [number, number] {
  if (ctx.declResult) return [ctx.declResult.points[0], ctx.declResult.points[1]];
  const best = [0, 0];
  const sum = [0, 0];
  const own = ctx.trick.some((p) => p.seat === ctx.seat) || ctx.tricks.length > 0 ? [] : ctx.ownDeclarations;
  for (const d of [...ctx.declared, ...own]) {
    best[d.seat & 1] = Math.max(best[d.seat & 1]!, d.points);
    sum[d.seat & 1]! += d.points;
  }
  if (best[0] === best[1]) return [0, 0];
  return best[0]! > best[1]! ? [sum[0]!, 0] : [0, sum[1]!];
}

function hardCard(ctx: BeloteBotContext, sim: Sim, legal: number, rand: () => number): number {
  const moves: number[] = [];
  for (let m = legal; m !== 0; m &= m - 1) moves.push(lowCode(m));
  const info = knowledge(ctx, sim);
  const us = ctx.seat & 1;
  const decl = declPoints(ctx);
  const totals = new Array<number>(moves.length).fill(0);
  let worlds = 0;
  let work = 0;
  const perWorld = moves.length * (32 - bitCount(sim.played));
  for (let w = 0; w < WORLDS && work + perWorld <= WORK_BUDGET; w++) {
    const hands = sampleWorld(ctx, sim, info, rand);
    if (!hands) continue;
    const belote = beloteTeam(ctx, sim, hands);
    for (let i = 0; i < moves.length; i++) {
      const s = sim.clone();
      s.hands = hands.slice();
      s.apply(ctx.seat, moves[i]!);
      while (s.done < 8) s.apply(s.turn, heuristic(s, s.turn));
      totals[i]! += evaluate(s, us, belote, decl);
    }
    work += perWorld;
    worlds++;
  }
  if (worlds === 0) return heuristic(sim, ctx.seat);
  let best = 0;
  for (let i = 1; i < moves.length; i++) if (totals[i]! > totals[best]! + 1e-9) best = i;
  // Exact ties: the heuristic's choice if it is among them, else the first.
  const top = totals[best]!;
  const h = heuristic(sim, ctx.seat);
  const hi = moves.indexOf(h);
  return hi >= 0 && totals[hi]! >= top - 1e-9 ? h : moves[best]!;
}

/** The bot's card: always one of the legal cards' ids. Throws only when the bot has no card at all. */
export function chooseBeloteCard(ctx: BeloteBotContext, level: BotLevel = 'normal', rand: () => number = Math.random): string {
  if (ctx.hand.length === 0) throw new Error('chooseBeloteCard: the bot has no card to play');
  if (!ctx.trump) throw new Error('chooseBeloteCard: no trump yet');
  const sim = buildSim(ctx);
  const legal = sim.legal(ctx.seat);
  if (legal === 0) return ctx.hand[0]!.id;
  if ((legal & (legal - 1)) === 0) return CARD_OF[lowCode(legal)]!.id;
  let code: number;
  try {
    if (level === 'easy' && rand() < EASY_RANDOM_CARD) {
      const options: number[] = [];
      for (let m = legal; m !== 0; m &= m - 1) options.push(lowCode(m));
      code = options[Math.floor(rand() * options.length) % options.length]!;
    } else if (level === 'hard') code = hardCard(ctx, sim, legal, rand);
    else code = heuristic(sim, ctx.seat);
  } catch {
    // Defensive: an inconsistent context must never stop the game.
    code = lowCode(legal);
  }
  if (!((legal >> code) & 1)) code = lowCode(legal);
  return CARD_OF[code]!.id;
}
