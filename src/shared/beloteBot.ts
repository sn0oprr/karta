/**
 * Computer players for Tunisian Belote.
 *
 * A bot only reasons with what its seat may know (see `beloteBotContext`): its own hand, the auction, every
 * card played so far, the hand sizes, and what follows from the rules — a player who did not follow suit has
 * none left; one who did not trump an opponent's trick has no trumps; one who played a lower trump when obliged
 * to go higher has no higher trump. The auction tells about hands too (see `readAuction`).
 *
 * Auction: the bot plays the hand out in simulation, over deals of the cards it cannot see — once for each suit
 * it could take, and once for the contract it would let stand by passing — and scores each outcome with the
 * Tunisian scale. The deals are drawn to fit the auction: a bid shows a hand worth about 100 in its suit, a
 * pass when free to bid a weaker one. It bids the lowest value that wins the auction, in the suit worth most,
 * when it makes it in most deals and that beats passing on average (a made contract scores the points actually
 * made, so bidding higher than needed only adds risk); it calls Kabbout when it takes every trick in most
 * deals, says "contre" when the opponents' contract nearly always fails, and "surcontre" when its own nearly
 * always succeeds.
 *
 * Card play works on a compact model (cards as bits of a 32-bit mask):
 *  - normal: card-play heuristics. Takers draw trumps with the master trump; everybody cashes master cards
 *    the opponents cannot trump; a player "charges" points onto a trick their partner surely wins; an
 *    opponent's trick is won as cheaply as possible, with a card no later opponent can beat; otherwise the
 *    cheapest card goes (never a ten whose ace is still out, never a trump without need).
 *  - easy: the same, but now and then a random legal card; a noisier auction that never doubles.
 *  - hard: Monte Carlo. Hands for the other players are dealt at random, consistent with everything known;
 *    each legal card is played out to the end of the hand with the normal heuristics for all four players,
 *    and the card with the best average hand score (Tunisian scale, contract and doubling applied) is played.
 *
 * Cost per decision: a call ~1–6 ms on average (up to ~25 ms); a card ~10 µs at easy and normal, ~2 ms on
 * average at hard (up to ~30 ms).
 */
import { SUITS, type Suit } from './cards';
import {
  BELOTE_RANKS,
  type AuctionAction,
  type AuctionCall,
  type AuctionOptions,
  type BCard,
  type BRank,
  type BeloteGame,
  type Coinche,
  type Contract,
  type ContractValue,
  type TrickPlay,
  auctionOptions,
  makeBeloteCard,
  roundTen,
} from './belote';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface BeloteBotContext {
  seat: number;
  dealer: number;
  phase: 'bidding' | 'playing';
  hand: BCard[];
  /** The calls so far (the whole auction, once it is over). */
  auction: AuctionAction[];
  /** The best bid so far, or the contract. */
  contract: Contract | null;
  coinche: Coinche;
  trump: Suit | null;
  taker: number | null;
  /** The trick in progress, in play order. */
  trick: TrickPlay[];
  /** Completed tricks of this hand. */
  tricks: { plays: TrickPlay[]; winner: number }[];
  handCounts: number[];
  /** The seat that said "Belote", and how many of the two cards it has played. */
  belote: { seat: number; stage: number } | null;
  scores: [number, number];
  targetScore: number;
}

/** The bot's view of the game for `seat`: only what that seat is entitled to know. */
export function beloteBotContext(game: BeloteGame, seat: number): BeloteBotContext {
  return {
    seat,
    dealer: game.dealer,
    phase: game.phase === 'bidding' ? 'bidding' : 'playing',
    hand: [...(game.hands[seat] ?? [])],
    auction: game.auction.map((a) => ({ seat: a.seat, call: { ...a.call } })),
    contract: game.contract ? { ...game.contract } : null,
    coinche: game.coinche,
    trump: game.trump,
    taker: game.taker,
    trick: [...game.trick],
    tricks: game.tricks.map((t) => ({ plays: [...t.plays], winner: t.winner })),
    handCounts: game.hands.map((h) => h.length),
    belote: game.beloteSaid,
    scores: [game.scores[0], game.scores[1]],
    targetScore: game.targetScore,
  };
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
    const over = above(trumps, T, this.topTrump());
    // Partner winning: any card, unless only trumps are left (then beat the best one if possible).
    if ((this.tSeat[this.winnerIndex()]! & 1) === (seat & 1)) return trumps === hand ? over || hand : hand;
    return over || trumps;
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
// Scoring a simulated hand with the Tunisian scale
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const JACK = 4;
const NINE = 2;

interface HandResult {
  /** What each team made: trick points rounded to the ten, plus its belote. */
  made: [number, number];
  /** The team that took all eight tricks (−1: none). */
  capot: number;
}

function handResult(sim: Sim, beloteTeam: number): HandResult {
  return {
    made: [roundTen(sim.pts[0]!) + (beloteTeam === 0 ? 20 : 0), roundTen(sim.pts[1]!) + (beloteTeam === 1 ? 20 : 0)],
    capot: sim.won[0] === 8 ? 0 : sim.won[1] === 8 ? 1 : -1,
  };
}

function succeeds(r: HandResult, takers: number, value: ContractValue): boolean {
  if (value === 'kabbout') return r.capot === takers;
  return r.made[takers]! >= value && r.made[takers]! > r.made[takers ^ 1]!;
}

/** Hand score of team `us` minus the other's, for a contract (see scoreBeloteHand: same scale). */
function contractScore(r: HandResult, takers: number, value: ContractValue, coinche: number, beloteTeam: number, us: number): number {
  const defence = takers ^ 1;
  const kabbout = value === 'kabbout';
  const anyBelote = beloteTeam >= 0 ? 20 : 0;
  const pts = [0, 0];
  if (!succeeds(r, takers, value)) pts[defence] = (kabbout ? 500 : 160) * coinche + anyBelote;
  else if (coinche > 1) pts[takers] = (kabbout ? 500 : r.capot === takers ? 250 : 160) * coinche + anyBelote;
  else if (kabbout || r.capot === takers) {
    pts[takers] = (kabbout ? 500 : 250) + (beloteTeam === takers ? 20 : 0);
    pts[defence] = beloteTeam === defence ? 20 : 0;
  } else {
    pts[takers] = r.made[takers]!;
    pts[defence] = r.made[defence]!;
  }
  return pts[us]! - pts[us ^ 1]!;
}

/** Team of the seat holding the King and Queen of trump `T` in a deal (−1: nobody). */
function beloteOf(hands: readonly number[], T: number): number {
  const pair = (1 << (T * 8 + KING)) | (1 << (T * 8 + QUEEN));
  for (let s = 0; s < 4; s++) if ((hands[s]! & pair) === pair) return s & 1;
  return -1;
}

/** Plays a whole hand out with the heuristics for everybody. */
function playOut(hands: readonly number[], T: number, taker: number, leader: number): Sim {
  const sim = new Sim(T, taker);
  sim.hands = hands.slice();
  sim.turn = leader;
  while (sim.done < 8) sim.apply(sim.turn, heuristic(sim, sim.turn));
  return sim;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Reading the auction
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Trump weights of `handStrength`, by rank index (7 8 9 10 J Q K A). */
const STRENGTH_TRUMP = [4.5, 4.5, 18, 8, 27, 3, 3.5, 11];

/**
 * What a team can expect to make (trick points rounded, plus belote) when it takes with trump `T` holding this
 * 8-card hand: a least-squares fit over 160 000 simulated deals played out by the heuristics. The partner's
 * cards make the real figure spread widely (±31), but on average the estimate is right — enough to read what
 * a bid, or a pass, says about a hand.
 */
function handStrength(h: number, T: number): number {
  let v = 50;
  let trumps = 0;
  for (let r = 0; r < 8; r++) {
    if ((h >>> (T * 8 + r)) & 1) {
      v += STRENGTH_TRUMP[r]!;
      trumps++;
    }
  }
  if ((h >>> (T * 8 + KING)) & 1 && (h >>> (T * 8 + QUEEN)) & 1) v += 22;
  v += 6 * Math.max(0, trumps - 2);
  for (let s = 0; s < 4; s++) {
    if (s === T) continue;
    const m = (h >>> (s * 8)) & 0xff;
    if (m === 0) v += 6;
    if ((m >> ACE) & 1) v += 9;
    if ((m >> TEN) & 1) v += 2.5;
  }
  return v;
}

/**
 * What the auction says about the other players' hands, as a likelihood: a bidder's hand is probably worth about
 * `AUCTION_READING.bid` in the suit of its last bid (`kabbout` for a Kabbout); a player who passed when free to
 * bid `minBid` probably holds less than `pass + passStep × (minBid − 90)` in every suit. Simulated deals are
 * weighted by how well they agree (a logistic curve `scale` wide). Measured on the bots' own bidding: bids,
 * opening or competing, come from hands worth 100–115; passes from hands worth less than 105–125.
 */
export const AUCTION_READING = { bid: 100, kabbout: 150, pass: 104, passStep: 0.3, scale: 8 };

interface AuctionReading {
  /** Each bidder's last bid: the strength its hand probably has in that suit. */
  bids: { seat: number; suit: number; center: number }[];
  /** Each seat that declined to bid: the strength its hand probably stays under, in any suit (Infinity: none). */
  passCenter: number[];
}

function readAuction(ctx: BeloteBotContext): AuctionReading {
  const R = AUCTION_READING;
  const last = new Map<number, { suit: number; center: number }>();
  const passCenter = [Infinity, Infinity, Infinity, Infinity];
  let holder = -1;
  let value = 0;
  for (const a of ctx.auction) {
    if (a.call.type === 'contre') break; // what follows only accepts or raises the doubling
    if (a.call.type === 'bid') {
      holder = a.seat;
      value = a.call.value === 'kabbout' ? 170 : a.call.value;
      if (a.seat !== ctx.seat) last.set(a.seat, { suit: SUIT_INDEX[a.call.suit], center: a.call.value === 'kabbout' ? R.kabbout : R.bid });
    } else if (a.call.type === 'pass' && a.seat !== ctx.seat && value < 170 && (holder < 0 || (holder & 1) !== (a.seat & 1))) {
      // Passing when free to bid says the hand is weak; passing over the partner's bid, or a Kabbout, says little.
      const minBid = holder < 0 ? 90 : value + 10;
      passCenter[a.seat] = Math.min(passCenter[a.seat]!, R.pass + R.passStep * (minBid - 90));
    }
  }
  return { bids: [...last].map(([seat, b]) => ({ seat, ...b })), passCenter };
}

/** How likely the auction was with these (original, 8-card) hands, up to a constant. */
function readingWeight(hands: readonly number[], reading: AuctionReading): number {
  const k = AUCTION_READING.scale;
  let w = 1;
  for (const b of reading.bids) w /= 1 + Math.exp((b.center - handStrength(hands[b.seat]!, b.suit)) / k);
  for (let s = 0; s < 4; s++) {
    const c = reading.passCenter[s]!;
    if (c === Infinity) continue;
    let best = 0;
    for (let T = 0; T < 4; T++) best = Math.max(best, handStrength(hands[s]!, T));
    w /= 1 + Math.exp((best - c) / k);
  }
  return w;
}

/** Picks `n` of the candidates, each with a chance proportional to its weight (systematic resampling). */
function resample<T>(items: readonly T[], weights: readonly number[], n: number, rand: () => number): T[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items.slice(0, n);
  const out: T[] = [];
  const step = total / n;
  let u = rand() * step;
  let acc = 0;
  for (let i = 0; i < items.length && out.length < n; i++) {
    acc += weights[i]!;
    while (u < acc && out.length < n) {
      out.push(items[i]!);
      u += step;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Auction
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Deals simulated per auction decision. */
const AUCTION_WORLDS: Readonly<Record<BotLevel, number>> = { easy: 8, normal: 24, hard: 48 };

/**
 * Auction judgement, measured with self-play (duplicate deals, see test/beloteBot.test.ts). Exported so that
 * experiments can try other values; the game never changes them.
 */
export const AUCTION_TUNING = {
  /** A bid must beat passing by this much on average (hand points). */
  margin: 10,
  /** Overbidding the partner's contract must beat letting it stand by this much. */
  partnerMargin: 30,
  /** Only contracts made in at least this share of the deals are bid: a bid is a promise, not a sacrifice. */
  minSuccess: 0.6,
  /** Kabbout only when every trick is taken in at least this share of the deals. */
  kabbout: 0.7,
  /** Contre only when the opponents' contract is made in at most this share of the deals. */
  contre: 0.1,
  /** Surcontre when our contract is made in at least this share. */
  surcontre: 0.8,
  /** Easy bots misjudge each option by up to this much. */
  easyNoise: 35,
};
const EASY_RANDOM_CARD = 0.25;

/** A deal of the cards the bot cannot see, before any card is played; bidders usually get their suit's jack or nine. */
function auctionDeal(me: number, mine: number, hints: readonly { seat: number; suit: number }[], rand: () => number): number[] {
  const hands = [0, 0, 0, 0];
  hands[me] = mine;
  const room = [8, 8, 8, 8];
  room[me] = 0;
  let pool = ~mine;
  for (const h of hints) {
    if (rand() >= 0.8) continue;
    for (const r of [JACK, NINE]) {
      const bit = 1 << (h.suit * 8 + r);
      if (pool & bit && room[h.seat]! > 0) {
        hands[h.seat]! |= bit;
        pool &= ~bit;
        room[h.seat]!--;
        break;
      }
    }
  }
  const rest: number[] = [];
  for (let m = pool; m !== 0; m &= m - 1) rest.push(lowCode(m));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    const t = rest[i]!;
    rest[i] = rest[j]!;
    rest[j] = t;
  }
  let k = 0;
  for (let s = 0; s < 4; s++) while (room[s]! > 0) {
    hands[s]! |= 1 << rest[k++]!;
    room[s]!--;
  }
  return hands;
}

/** `n` deals of the hidden cards, drawn in proportion to how well they agree with the auction. */
function auctionWorlds(me: number, mine: number, reading: AuctionReading, n: number, rand: () => number): number[][] {
  const deals: number[][] = [];
  const weights: number[] = [];
  for (let i = 0; i < n * 4; i++) {
    const hands = auctionDeal(me, mine, reading.bids, rand);
    deals.push(hands);
    weights.push(readingWeight(hands, reading));
  }
  return resample(deals, weights, n, rand);
}

/** The bot's call: always one allowed by `auctionOptions` (passing when in doubt). */
export function chooseBeloteCall(ctx: BeloteBotContext, level: BotLevel = 'normal', rand: () => number = Math.random): AuctionCall {
  const pass: AuctionCall = { type: 'pass' };
  try {
    return auctionChoice(ctx, auctionOptions(ctx, ctx.seat), level, rand) ?? pass;
  } catch {
    // Defensive: an inconsistent context must never stop the game.
    return pass;
  }
}

function auctionChoice(ctx: BeloteBotContext, o: AuctionOptions, level: BotLevel, rand: () => number): AuctionCall | null {
  const tune = AUCTION_TUNING;
  const me = ctx.seat;
  const us = me & 1;
  const contract = ctx.contract;
  const W = AUCTION_WORLDS[level];
  const leader = (ctx.dealer + 1) & 3;
  const reading = readAuction(ctx);
  const mine = maskOf(ctx.hand);
  const worlds = auctionWorlds(me, mine, reading, W, rand);
  const noise = () => (level === 'easy' ? (rand() - 0.5) * 2 * tune.easyNoise : 0);

  // Answering a contre: surcontre when our contract is made in nearly every deal.
  if (o.surcontre && contract) {
    if (level === 'easy') return null;
    const T = SUIT_INDEX[contract.suit];
    let made = 0;
    for (const hands of worlds) if (succeeds(handResult(playOut(hands, T, contract.seat, leader), beloteOf(hands, T)), contract.seat & 1, contract.value)) made++;
    return made / W >= tune.surcontre ? { type: 'surcontre' } : null;
  }

  // Passing lets the best bid stand (or keeps the auction open: worth nothing yet).
  let passValue = 0;
  let contreValue = -Infinity;
  if (contract) {
    const T = SUIT_INDEX[contract.suit];
    const takers = contract.seat & 1;
    let single = 0;
    let double = 0;
    let made = 0;
    for (const hands of worlds) {
      const bt = beloteOf(hands, T);
      const r = handResult(playOut(hands, T, contract.seat, leader), bt);
      single += contractScore(r, takers, contract.value, 1, bt, us);
      double += contractScore(r, takers, contract.value, 2, bt, us);
      if (succeeds(r, takers, contract.value)) made++;
    }
    passValue = single / W;
    if (takers === us) passValue += tune.partnerMargin;
    else if (o.contre && level !== 'easy' && made / W <= tune.contre) contreValue = double / W;
  }

  let choice: AuctionCall | null = null;
  let best = passValue;
  if (contreValue > best) {
    best = contreValue;
    choice = { type: 'contre' };
  }
  // Taking: the lowest value that wins the auction, in each suit; or Kabbout.
  for (const suit of SUITS) {
    const T = SUIT_INDEX[suit];
    let atMin = 0;
    let madeMin = 0;
    let atKabbout = 0;
    let capots = 0;
    for (const hands of worlds) {
      const bt = beloteOf(hands, T);
      const r = handResult(playOut(hands, T, me, leader), bt);
      if (o.minBid !== null) {
        atMin += contractScore(r, us, o.minBid, 1, bt, us);
        if (succeeds(r, us, o.minBid)) madeMin++;
      }
      atKabbout += contractScore(r, us, 'kabbout', 1, bt, us);
      if (r.capot === us) capots++;
    }
    if (o.minBid !== null && madeMin / W >= tune.minSuccess) {
      const v = atMin / W + noise() - tune.margin;
      if (v > best) {
        best = v;
        choice = { type: 'bid', value: o.minBid, suit };
      }
    }
    if (o.kabbout && capots / W >= tune.kabbout) {
      const v = atKabbout / W + noise() - tune.margin;
      if (v > best) {
        best = v;
        choice = { type: 'bid', value: 'kabbout', suit };
      }
    }
  }
  return choice;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Hard: Monte Carlo over the hidden hands
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Deals sampled per card decision, and the work budget (playout steps) that caps a decision's cost. */
const WORLDS = 40;
const WORK_BUDGET = 60000;

interface Knowledge {
  /** Cards known to be in each seat's hand. */
  known: number[];
  /** Highest trump strength each seat may still hold (7 = no limit). */
  maxTrump: number[];
  /** Cards a seat probably holds (bids): tried first, when allowed. */
  likely: { seat: number; cards: number[] }[];
  /** What the auction said, and the cards each seat has played (to rebuild the hands it was dealt). */
  reading: AuctionReading;
  playedBy: number[];
}

/** What the rules, the belote and the bids reveal about the hidden hands. */
function knowledge(ctx: BeloteBotContext, sim: Sim): Knowledge {
  const T = sim.trump;
  const known = [0, 0, 0, 0];
  const maxTrump = [7, 7, 7, 7];
  const unplayed = ~sim.played;
  if (ctx.belote && ctx.belote.stage === 1) known[ctx.belote.seat]! |= ((1 << (T * 8 + KING)) | (1 << (T * 8 + QUEEN))) & unplayed;
  // A lower trump played when going higher was required (a trump lead, or trumping an opponent's trick, or
  // a hand of nothing but trumps on the partner's trick): no higher trump left.
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
  const reading = readAuction(ctx);
  const likely = reading.bids.map((b) => ({ seat: b.seat, cards: [b.suit * 8 + JACK, b.suit * 8 + NINE] }));
  const playedBy = [0, 0, 0, 0];
  for (const plays of [...ctx.tricks.map((x) => x.plays), ctx.trick]) for (const p of plays) playedBy[p.seat]! |= 1 << codeOf(p.card);
  return { known, maxTrump, likely, reading, playedBy };
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
  const allowed = (s: number, c: number) => {
    if (strict >= 1 && (sim.voids[s]! >> (c >> 3)) & 1) return false;
    if (strict >= 2 && c >> 3 === T && STR[T * 32 + c]! > info.maxTrump[s]!) return false;
    return true;
  };
  // Bidders probably hold their suit's jack or nine.
  for (const h of info.likely) {
    if (h.seat === me || rand() >= 0.75) continue;
    for (const c of h.cards) {
      if (pool & (1 << c) && room[h.seat]! > 0 && allowed(h.seat, c)) {
        hands[h.seat]! |= 1 << c;
        pool &= ~(1 << c);
        room[h.seat]!--;
        break;
      }
    }
  }
  const cards: number[] = [];
  for (let m = pool; m !== 0; m &= m - 1) cards.push(lowCode(m));
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

/** Team holding belote in a world (−1: nobody). */
function beloteTeam(ctx: BeloteBotContext, sim: Sim, hands: readonly number[]): number {
  if (ctx.belote) return ctx.belote.seat & 1;
  const T = sim.trump;
  const pair = (1 << (T * 8 + KING)) | (1 << (T * 8 + QUEEN));
  // One of them already played without a word: nobody held both.
  if (sim.played & pair) return -1;
  return beloteOf(hands, T);
}

function hardCard(ctx: BeloteBotContext, sim: Sim, legal: number, rand: () => number): number {
  const contract = ctx.contract!;
  const moves: number[] = [];
  for (let m = legal; m !== 0; m &= m - 1) moves.push(lowCode(m));
  const info = knowledge(ctx, sim);
  const us = ctx.seat & 1;
  const takers = contract.seat & 1;
  const totals = new Array<number>(moves.length).fill(0);
  const perWorld = moves.length * (32 - bitCount(sim.played));
  const n = Math.max(1, Math.min(WORLDS, Math.floor(WORK_BUDGET / perWorld)));
  // Deals consistent with the play so far, drawn in proportion to how well they agree with the auction.
  const candidates: number[][] = [];
  const weights: number[] = [];
  for (let i = 0; i < n * 3; i++) {
    const hands = sampleWorld(ctx, sim, info, rand);
    if (!hands) continue;
    candidates.push(hands);
    weights.push(readingWeight(hands.map((h, seat) => h | info.playedBy[seat]!), info.reading));
  }
  const worlds = resample(candidates, weights, n, rand);
  for (const hands of worlds) {
    const bt = beloteTeam(ctx, sim, hands);
    for (let i = 0; i < moves.length; i++) {
      const s = sim.clone();
      s.hands = hands.slice();
      s.apply(ctx.seat, moves[i]!);
      while (s.done < 8) s.apply(s.turn, heuristic(s, s.turn));
      totals[i]! += contractScore(handResult(s, bt), takers, contract.value, ctx.coinche, bt, us);
    }
  }
  if (worlds.length === 0) return heuristic(sim, ctx.seat);
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
  if (!ctx.trump || !ctx.contract) throw new Error('chooseBeloteCard: no contract yet');
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
