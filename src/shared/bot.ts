/**
 * Computer opponent ("bot") for Chkobba.
 *
 * The bot only reasons with what its seat may know (see `botContext`): its own hand, the table, the cards
 * captured so far (public), the hand sizes and the multiset of cards it cannot see (stock + other hands).
 *
 * Position value — `handValue()` — is the expected point difference (bot's team minus the other team) at the
 * end of the hand. Captured cards and chkobbas are counted exactly; each card not captured yet is assumed to
 * go to either side with probability ½, which turns karta (21+ cards), dinari (6+ diamonds) and bermila
 * (3+ sevens, 2–2 → sixes) into probabilities. A card is therefore worth what it changes in the outcome: the
 * 7♦ about 1.7 points, a seven ~0.5, a diamond ~0.3, a plain card ~0.1 early in the hand — and a diamond is
 * worth nothing once a side holds six of them.
 *
 * Hidden hands are handled with an order statistic: a player whose h cards are a uniform random subset of the
 * N unseen cards plays their best card, and with the unseen cards sorted by that player's preference the i-th
 * one is the best card held with probability C(N−i, h−1) / C(N, h). This is exact over all possible hands, so
 * risks (chkobba threats, exposing the 7♦…) are weighted by how likely the opponent holds the right card.
 *
 * Levels:
 *  - easy: greedy on the immediate capture with noise, and now and then a random move.
 *  - normal: two plies — each legal move is scored by the position after the next (opponent) player's best
 *    reply, averaged over their possible hands. Chkobba on the last card and the leftovers going to the last
 *    capturer are applied whenever the hand ends within that horizon.
 *  - hard: deeper search. 2 players: five plies (bot, opponent, bot, opponent, bot) with the bot's own hand
 *    known and the opponent's drawn from the unseen cards, bounded by a work budget (falls back to three
 *    plies). Last deal (empty stock): alpha-beta to the end of the hand — exact with 2 players (the opponent's
 *    hand is known by elimination), averaged over the possible deals of the hidden hands with 4 players.
 *
 * Cost per decision (average): easy/normal ~0.01–0.02 ms; hard ~0.7 ms with 2 players, ~0.2 ms with 4. Hard's
 * searches run on a deterministic work budget, which keeps its worst case at a few ms.
 */
import type { Card, Suit } from './cards';
import type { ChkobbaGame, Move } from './chkobba';
import { legalMovesFor, teamOf } from './chkobba';

export type BotLevel = 'easy' | 'normal' | 'hard';

export interface BotContext {
  seat: number;
  numPlayers: 2 | 4;
  hand: Card[];
  table: Card[];
  /** Cards the bot cannot see: the stock plus other players' hands. */
  unseen: Card[];
  deckCount: number;
  /** Cards in hand, per seat. */
  handCounts: number[];
  /** Captured cards so far this hand, per team (public knowledge). */
  teamPiles: [Card[], Card[]];
  /** Chkobbas this hand, per team. */
  chkobbas: [number, number];
  /** Game totals before this hand. */
  scores: [number, number];
  targetScore: number;
  lastCapturer: number | null;
}

/** Builds the bot's view of the game for `seat`, using only information that seat is entitled to. */
export function botContext(game: ChkobbaGame, seat: number): BotContext {
  // Sorted, so that nothing can be read from the order (stock order, which hand a card is in…).
  const unseen = game.unseenBy(seat).sort(compareCards);
  return {
    seat,
    numPlayers: game.numPlayers,
    hand: [...(game.hands[seat] ?? [])],
    table: [...game.table],
    unseen,
    deckCount: game.deck.length,
    handCounts: game.hands.map((h) => h.length),
    teamPiles: [game.teamCards(0), game.teamCards(1)],
    chkobbas: [game.teamChkobbas(0), game.teamChkobbas(1)],
    scores: [game.scores[0], game.scores[1]],
    targetScore: game.targetScore,
    lastCapturer: game.lastCapturer,
  };
}

/**
 * Picks the bot's move: always one of the `legalMovesFor(ctx.hand, ctx.table)` objects.
 * Throws only when the hand is empty (there is no move at all).
 */
export function chooseBotMove(ctx: BotContext, level: BotLevel = 'normal', rand: () => number = Math.random): Move {
  const moves = legalMovesFor(ctx.hand, ctx.table);
  if (moves.length === 0) throw new Error('chooseBotMove: the bot has no card to play');
  if (moves.length === 1) return moves[0]!;
  let index = 0;
  try {
    index = pickMove(ctx, moves, level, rand);
  } catch {
    // Defensive: an inconsistent context must never stop the game.
    index = 0;
  }
  return moves[index] ?? moves[0]!;
}

// ---------------------------------------------------------------------------------------------------------
// Tuning (measured with self-play)
// ---------------------------------------------------------------------------------------------------------

/** Laying a card costs this share of what capturing it would be worth (good cards are kept for captures). */
const LAY_KEEP = 0.2;
/** easy: probability of a uniformly random move, and the amplitude of the noise added to move scores. */
const EASY_RANDOM = 0.2;
const EASY_NOISE = 0.35;
/** hard, 2 players, while the stock lasts: lookahead depth (plies, the bot's move included). */
const HARD_DEPTH = 5;
/** hard, last deal with 4 players: enumerate the deals of the hidden hands when there are this few… */
const ENDGAME_ENUMERATE = 64;
/** …otherwise sample this many, and search this many plies after the bot's move (full depth when enumerating). */
const ENDGAME_WORLDS = 8;
const ENDGAME_DEPTH = 5;
/**
 * Work budgets of the hard searches, in units of search nodes + card kinds evaluated + capture subsets
 * enumerated (~0.09 µs per unit in the lookahead, ~0.14 µs in the endgame search). Over budget, hard falls
 * back to a cheaper search, so a decision stays within a few ms even on freak tables. In real games the
 * five-ply lookahead fits in 99% of positions and the endgame search in 99.9%.
 */
const LOOK_BUDGET = 32000;
const FALLBACK_BUDGET = 16000;
const SEARCH_BUDGET = 30000;

// ---------------------------------------------------------------------------------------------------------
// Cards as small integers: code = (rank - 1) * 4 + suit, diamonds = 0.
// ---------------------------------------------------------------------------------------------------------

const SUIT_INDEX: Record<Suit, number> = { D: 0, H: 1, C: 2, S: 3 };
const HAYA = 24; // 7♦

function codeOf(card: Card): number {
  return (card.rank - 1) * 4 + SUIT_INDEX[card.suit];
}

function rankOf(code: number): number {
  return (code >> 2) + 1;
}

function compareCards(a: Card, b: Card): number {
  return SUIT_INDEX[a.suit] - SUIT_INDEX[b.suit] || a.rank - b.rank;
}

/** Interchangeable cards (same rank, same diamond-ness) share a kind: rank * 2, + 1 for the diamond. */
function kindOf(code: number): number {
  return (rankOf(code) << 1) | ((code & 3) === 0 ? 1 : 0);
}

/** A representative card of a kind. */
function kindCard(kind: number): number {
  return ((kind >> 1) - 1) * 4 + (kind & 1 ? 0 : 1);
}

function kindCounts(pool: readonly number[]): number[] {
  const count = new Array<number>(22).fill(0);
  for (const c of pool) count[kindOf(c)]!++;
  return count;
}

// ---------------------------------------------------------------------------------------------------------
// Hand value model
// ---------------------------------------------------------------------------------------------------------

/** Per-team counters, 6 slots per team (team * 6 + slot). */
type Stats = number[];
const CARDS = 0;
const DIAMONDS = 1;
const SEVENS = 2;
const SIXES = 3;
const HAYA_SLOT = 4;
const CHK = 5;

function addCard(st: Stats, team: number, code: number, d: number): void {
  const o = team * 6;
  st[o + CARDS]! += d;
  if ((code & 3) === 0) st[o + DIAMONDS]! += d;
  const r = (code >> 2) + 1;
  if (r === 7) {
    st[o + SEVENS]! += d;
    if (code === HAYA) st[o + HAYA_SLOT]! += d;
  } else if (r === 6) st[o + SIXES]! += d;
}

/** BINOM[n][k] = P(X = k) for X ~ Binomial(n, ½). */
const BINOM: number[][] = [];
for (let n = 0; n <= 4; n++) {
  const row = [1];
  for (let k = 1; k <= n; k++) row.push((row[k - 1]! * (n - k + 1)) / k);
  BINOM.push(row.map((x) => x / 2 ** n));
}
function pEq(n: number, k: number): number {
  return k < 0 || k > n ? 0 : BINOM[n]![k]!;
}
function pGe(n: number, k: number): number {
  if (k <= 0) return 1;
  let s = 0;
  for (let i = k; i <= n; i++) s += BINOM[n]![i]!;
  return s;
}
function pLe(n: number, k: number): number {
  return 1 - pGe(n, k + 1);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
function phi(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const y = 1 - poly * Math.exp((-z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Expected points (us − them) of a majority category over `total` cards (a side needs more than half): we
 * hold a, they hold b, and the n cards left split around ½ with variance `spread` × n / 4. This smooth curve
 * played slightly better in self-play than the exact binomial (spread 1).
 */
function majorityTable(total: number, spread: number): Float64Array {
  const half = total / 2;
  const T = new Float64Array((total + 1) * (total + 1));
  for (let a = 0; a <= total; a++)
    for (let b = 0; a + b <= total; b++) {
      const n = total - a - b;
      let v = a > half ? 1 : a < half ? -1 : 0;
      if (n > 0) {
        const sd = Math.sqrt((spread * n) / 4);
        const mean = a + n / 2;
        v = 1 - phi((half + 0.5 - mean) / sd) - phi((half - 0.5 - mean) / sd);
      }
      T[a * (total + 1) + b] = v;
    }
  return T;
}
const KARTA = majorityTable(40, 2);
const DINARI = majorityTable(10, 1.5);

/** Bermila (most sevens, then most sixes): exact binomial over the sevens and sixes not captured yet. */
const BERMILA = new Float64Array(625);
for (let sa = 0; sa <= 4; sa++)
  for (let sb = 0; sa + sb <= 4; sb++)
    for (let xa = 0; xa <= 4; xa++)
      for (let xb = 0; xa + xb <= 4; xb++) {
        const ns = 4 - sa - sb;
        const nx = 4 - xa - xb;
        const sixes = pGe(nx, 3 - xa) - pLe(nx, 1 - xa);
        BERMILA[((sa * 5 + sb) * 5 + xa) * 5 + xb] = pGe(ns, 3 - sa) - pLe(ns, 1 - sa) + pEq(ns, 2 - sa) * sixes;
      }

/** Expected point difference (team `us` minus the other team) at the end of the hand. */
function handValue(st: Stats, us: number): number {
  const o = us * 6;
  const p = 6 - o;
  return (
    st[o + CHK]! -
    st[p + CHK]! +
    st[o + HAYA_SLOT]! -
    st[p + HAYA_SLOT]! +
    KARTA[st[o + CARDS]! * 41 + st[p + CARDS]!]! +
    DINARI[st[o + DIAMONDS]! * 11 + st[p + DIAMONDS]!]! +
    BERMILA[((st[o + SEVENS]! * 5 + st[p + SEVENS]!) * 5 + st[o + SIXES]!) * 5 + st[p + SIXES]!]!
  );
}

// ---------------------------------------------------------------------------------------------------------
// Captures and plays on integer tables
// ---------------------------------------------------------------------------------------------------------

/** Work counter of the current search (a deterministic time bound, see LOOK_BUDGET). */
let work = 0;
let workLimit = Infinity;
const OVER_BUDGET = new Error('bot search over budget');

/** Counts a search node; aborts the search (only at a node boundary) once over budget. */
function step(units: number): void {
  work += units;
  if (work > workLimit) throw OVER_BUDGET;
}

/** Runs `search` with a work budget; null if it ran over. */
function withBudget<T>(budget: number, search: () => T): T | null {
  work = 0;
  workLimit = budget;
  try {
    return search();
  } catch (e) {
    if (e === OVER_BUDGET) return null;
    throw e;
  } finally {
    workLimit = Infinity;
  }
}

/**
 * Capture options on `table` for every rank r = 1..10, as bit masks over table positions (same rules as
 * `captureOptions`: a same-rank card if there is one, otherwise any set of 2+ cards adding up to r).
 */
function captureTable(table: readonly number[]): number[][] {
  const res: number[][] = [[], [], [], [], [], [], [], [], [], [], []];
  const n = table.length;
  let present = 0;
  for (let i = 0; i < n; i++) {
    const r = rankOf(table[i]!);
    res[r]!.push(1 << i);
    present |= 1 << r;
  }
  if (n < 2) return res;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => table[a]! - table[b]!);
  const ranks = order.map((i) => rankOf(table[i]!));
  let steps = 0;
  const dfs = (start: number, sum: number, mask: number, count: number): void => {
    for (let k = start; k < n; k++) {
      const s2 = sum + ranks[k]!;
      if (s2 > 10) break;
      steps++;
      const m2 = mask | (1 << order[k]!);
      if (count >= 1 && !(present & (1 << s2))) res[s2]!.push(m2);
      dfs(k + 1, s2, m2, count + 1);
    }
  };
  dfs(0, 0, 0, 0);
  work += steps;
  return res;
}

interface Played {
  st: Stats;
  table: number[];
  lastCap: number;
}

/**
 * Plays `card` for `seat` on copies of st/table, capturing the table cards in `mask` (0 = lay it).
 * `last`: the very last card of the hand (no chkobba; the table then goes to the last capturer).
 */
function playOn(st: Stats, table: readonly number[], seat: number, card: number, mask: number, last: boolean, lastCap: number): Played {
  const s = st.slice();
  const team = seat & 1;
  let t: number[];
  if (mask !== 0) {
    t = [];
    addCard(s, team, card, 1);
    for (let j = 0; j < table.length; j++) {
      if (mask & (1 << j)) addCard(s, team, table[j]!, 1);
      else t.push(table[j]!);
    }
    if (t.length === 0 && !last) s[team * 6 + CHK]! += 1;
    lastCap = seat;
  } else t = [...table, card];
  if (last && lastCap >= 0) {
    for (const c of t) addCard(s, lastCap & 1, c, 1);
    t = [];
  }
  return { st: s, table: t, lastCap };
}

// ---------------------------------------------------------------------------------------------------------
// The bot's view
// ---------------------------------------------------------------------------------------------------------

interface Position {
  n: number;
  seat: number;
  us: number;
  st: Stats;
  table: number[];
  hand: number[];
  unseen: number[];
  deck: number;
  /** Hand sizes per seat (the bot's own entry is its real hand size). */
  counts: number[];
  /** Seat of the last capturer, -1 if nobody captured yet. */
  lastCap: number;
}

interface RootMove {
  /** Index into the legal move list. */
  index: number;
  card: number;
  captured: number[];
}

function int(x: unknown, lo: number, hi: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.floor(x))) : lo;
}

/** Converts the context to integer form; duplicated or malformed cards are ignored. */
function buildPosition(ctx: BotContext): Position {
  const n = ctx.numPlayers === 4 ? 4 : 2;
  const seen = new Set<number>();
  const take = (cards: readonly Card[] | undefined): number[] => {
    const out: number[] = [];
    for (const card of cards ?? []) {
      const code = codeOf(card);
      if (!(code >= 0 && code < 40) || seen.has(code)) continue;
      seen.add(code);
      out.push(code);
    }
    return out;
  };
  const hand = take(ctx.hand);
  const table = take(ctx.table);
  const st: Stats = new Array<number>(12).fill(0);
  for (const team of [0, 1]) for (const code of take(ctx.teamPiles?.[team])) addCard(st, team, code, 1);
  st[CHK] = int(ctx.chkobbas?.[0], 0, 99);
  st[6 + CHK] = int(ctx.chkobbas?.[1], 0, 99);
  const unseen = take(ctx.unseen);
  const seat = int(ctx.seat, 0, n - 1);
  const counts: number[] = [];
  for (let s = 0; s < n; s++) counts.push(int(ctx.handCounts?.[s], 0, 3));
  counts[seat] = hand.length;
  const lastCap = ctx.lastCapturer ?? -1;
  return {
    n,
    seat,
    us: teamOf(seat),
    st,
    table,
    hand,
    unseen,
    deck: int(ctx.deckCount, 0, 40),
    counts,
    lastCap: lastCap >= 0 && lastCap < n ? lastCap : -1,
  };
}

const ID_RE = /^(10|[1-9])([DHCS])$/;
function idCode(id: string): number {
  const m = ID_RE.exec(id);
  if (!m) throw new Error(`bad card id ${id}`);
  return (Number(m[1]) - 1) * 4 + SUIT_INDEX[m[2] as Suit];
}

/** The legal moves, keeping one of each set of interchangeable moves (e.g. laying the 4♥ or the 4♣). */
function rootMoves(moves: readonly Move[]): RootMove[] {
  const seen = new Set<string>();
  const out: RootMove[] = [];
  moves.forEach((m, index) => {
    const card = idCode(m.cardId);
    const captured = m.capture.map(idCode);
    const key = `${kindOf(card)}:${captured
      .map(kindOf)
      .sort((a, b) => a - b)
      .join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ index, card, captured });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Move choice
// ---------------------------------------------------------------------------------------------------------

function pickMove(ctx: BotContext, moves: readonly Move[], level: BotLevel, rand: () => number): number {
  const pos = buildPosition(ctx);
  const roots = rootMoves(moves);
  if (roots.length === 1) return roots[0]!.index;
  if (level === 'easy') return easyPick(pos, roots, rand);
  let scores: number[] | null = null;
  if (level === 'hard') {
    if (pos.deck === 0) scores = endgameScores(pos, roots, rand);
    else if (pos.n === 2) scores = lookScores(pos, roots, HARD_DEPTH, LOOK_BUDGET) ?? lookScores(pos, roots, 3, FALLBACK_BUDGET);
  }
  return bestOf(roots, scores ?? normalScores(pos, roots), rand);
}

/** Index (into the legal moves) of the best-scored move; exact ties are broken at random. */
function bestOf(moves: readonly RootMove[], scores: readonly number[], rand: () => number): number {
  let best = -Infinity;
  for (const s of scores) if (s > best) best = s;
  const top: number[] = [];
  for (let i = 0; i < moves.length; i++) if (scores[i]! >= best - 1e-9) top.push(i);
  if (top.length === 0) return moves[0]!.index;
  return moves[top[Math.floor(rand() * top.length) % top.length]!]!.index;
}

interface AfterMove extends Played {
  /** Cards left in all hands after the move. */
  handTotal: number;
  /** The move ended the hand (the leftovers are already given to the last capturer). */
  final: boolean;
}

function applyRoot(pos: Position, m: RootMove): AfterMove {
  let handTotal = -1;
  for (const c of pos.counts) handTotal += c;
  const final = pos.deck === 0 && handTotal <= 0;
  let mask = 0;
  pos.table.forEach((c, j) => {
    if (m.captured.includes(c)) mask |= 1 << j;
  });
  const played = playOn(pos.st, pos.table, pos.seat, m.card, mask, final, pos.lastCap);
  return { ...played, handTotal: Math.max(0, handTotal), final };
}

/** What capturing `code` would be worth to us now. */
function captureWorth(pos: Position, code: number): number {
  const base = handValue(pos.st, pos.us);
  addCard(pos.st, pos.us, code, 1);
  const v = handValue(pos.st, pos.us);
  addCard(pos.st, pos.us, code, -1);
  return v - base;
}

/** easy: immediate gain only (no thought for the reply), with noise and the odd random move. */
function easyPick(pos: Position, moves: readonly RootMove[], rand: () => number): number {
  if (rand() < EASY_RANDOM) return moves[Math.floor(rand() * moves.length) % moves.length]!.index;
  const base = handValue(pos.st, pos.us);
  const scores = moves.map((m) => {
    let s = handValue(applyRoot(pos, m).st, pos.us) - base;
    if (m.captured.length === 0) s -= 0.3 * captureWorth(pos, m.card);
    return s + (rand() - 0.5) * 2 * EASY_NOISE;
  });
  return bestOf(moves, scores, rand);
}

/** normal: value after our move and the next player's best reply, averaged over the hands they can hold. */
function normalScores(pos: Position, moves: readonly RootMove[]): number[] {
  const count = kindCounts(pos.unseen);
  const next = (pos.seat + 1) % pos.n;
  return moves.map((m) => {
    const after = applyRoot(pos, m);
    let score: number;
    if (after.final) score = handValue(after.st, pos.us);
    else {
      // After the last card of a deal everybody gets 3 new cards.
      const h = after.handTotal === 0 ? 3 : pos.counts[next]!;
      const lastReply = pos.deck === 0 && after.handTotal === 1;
      score = replyValue(pos.us, after.st, after.table, count, pos.unseen.length, h, next & 1, lastReply, after.lastCap);
    }
    if (m.captured.length === 0) score -= LAY_KEEP * captureWorth(pos, m.card);
    return score;
  });
}

/** E[value of the best of h cards drawn from the N in `count`], with `kinds` sorted best-first. */
function expectBest(kinds: readonly number[], count: readonly number[], value: readonly number[], N: number, h: number): number {
  if (h > N) h = N;
  // P(the i-th card in preference order is the best one held) = C(N-i, h-1) / C(N, h), i = 1..N.
  let w = h / N;
  let i = 0;
  let ev = 0;
  for (const kind of kinds) {
    const v = value[kind]!;
    for (let m = count[kind]!; m > 0; m--, i++) {
      ev += w * v;
      if (i + 1 < N) w = (w * (N - i - h)) / (N - i - 1);
    }
    if (w <= 0) break;
  }
  return ev;
}

/**
 * Expected value (for team `us`) after a player of team `team`, whose h cards are a uniformly random subset
 * of the pool (`count` per kind, N cards), makes the reply that is best for their team on `table`.
 * `last`: the reply is the last card of the hand.
 */
function replyValue(
  us: number,
  st: Stats,
  table: readonly number[],
  count: readonly number[],
  N: number,
  h: number,
  team: number,
  last: boolean,
  lastCap: number,
): number {
  const base = handValue(st, us);
  if (h <= 0 || N <= 0) return base;
  const opponent = team !== us;
  const caps = captureTable(table);
  const all = (1 << table.length) - 1;
  const kinds: number[] = [];
  const value = new Array<number>(22).fill(0);
  for (let kind = 2; kind < 22; kind++) {
    if (count[kind] === 0) continue;
    kinds.push(kind);
    const card = kindCard(kind);
    const masks = caps[kind >> 1]!;
    if (masks.length === 0) {
      if (last && lastCap >= 0) {
        // The laid card ends the hand: the table, with it, goes to the last capturer.
        const t = lastCap & 1;
        addCard(st, t, card, 1);
        for (const c of table) addCard(st, t, c, 1);
        value[kind] = handValue(st, us);
        addCard(st, t, card, -1);
        for (const c of table) addCard(st, t, c, -1);
      } else value[kind] = base;
      continue;
    }
    let best = opponent ? Infinity : -Infinity;
    work += masks.length;
    for (const mask of masks) {
      // The captured cards go to `team`; on the last card of the hand the rest of the table follows them.
      const taken = last ? all : mask;
      const chk = !last && mask === all;
      addCard(st, team, card, 1);
      for (let j = 0; j < table.length; j++) if (taken & (1 << j)) addCard(st, team, table[j]!, 1);
      if (chk) st[team * 6 + CHK]! += 1;
      const v = handValue(st, us);
      if (chk) st[team * 6 + CHK]! -= 1;
      addCard(st, team, card, -1);
      for (let j = 0; j < table.length; j++) if (taken & (1 << j)) addCard(st, team, table[j]!, -1);
      if (opponent ? v < best : v > best) best = v;
    }
    value[kind] = best;
  }
  work += kinds.length;
  kinds.sort(opponent ? (a, b) => value[a]! - value[b]! : (a, b) => value[b]! - value[a]!);
  return expectBest(kinds, count, value, N, h);
}

// ---------------------------------------------------------------------------------------------------------
// hard, while the stock lasts: analytic lookahead. The bot's own plies are searched with its known hand;
// every other player's hand is a random draw from the unseen cards (order statistic over card kinds).
// ---------------------------------------------------------------------------------------------------------

interface Ply {
  seat: number;
  team: number;
  /** The bot's own ply with its known hand (false for its plies after a new deal). */
  known: boolean;
  /** Hand size at that ply. */
  h: number;
  /** Last card of the hand. */
  last: boolean;
}

/** The plies that follow the bot's move (at most `depth`). */
function plySequence(pos: Position, depth: number): Ply[] {
  const n = pos.n;
  const counts = pos.counts.slice();
  counts[pos.seat]!--;
  let total = 0;
  for (const c of counts) total += c;
  let deck = pos.deck;
  let known = true;
  let seat = pos.seat;
  const out: Ply[] = [];
  for (let guard = 0; out.length < depth && guard < 64; guard++) {
    if (total <= 0) {
      if (deck <= 0) break;
      for (let s = 0; s < n; s++) counts[s] = 3;
      total = 3 * n;
      deck = Math.max(0, deck - 3 * n);
      known = false;
    }
    seat = (seat + 1) % n;
    const h = counts[seat]!;
    if (h <= 0) continue;
    counts[seat] = h - 1;
    total--;
    out.push({ seat, team: seat & 1, known: known && seat === pos.seat, h, last: deck === 0 && total === 0 });
  }
  return out;
}

class Lookahead {
  constructor(
    readonly us: number,
    readonly plies: readonly Ply[],
    readonly count: number[],
    public N: number,
  ) {}

  value(st: Stats, table: number[], lastCap: number, level: number, hand: readonly number[]): number {
    step(1 + (table.length >> 2));
    const plies = this.plies;
    if (level >= plies.length) return handValue(st, this.us);
    const p = plies[level]!;
    if (!p.known && level === plies.length - 1) return replyValue(this.us, st, table, this.count, this.N, p.h, p.team, p.last, lastCap);
    const caps = captureTable(table);
    if (p.known) {
      let best = -Infinity;
      let tried = 0;
      for (let i = 0; i < hand.length; i++) {
        const card = hand[i]!;
        const bit = 1 << kindOf(card);
        if (tried & bit) continue;
        tried |= bit;
        const rest = hand.filter((_, j) => j !== i);
        const masks = caps[rankOf(card)]!;
        for (let k = 0; k < Math.max(1, masks.length); k++) {
          const nx = playOn(st, table, p.seat, card, masks[k] ?? 0, p.last, lastCap);
          const v = this.value(nx.st, nx.table, nx.lastCap, level + 1, rest);
          if (v > best) best = v;
        }
      }
      return best === -Infinity ? handValue(st, this.us) : best;
    }
    const maxi = p.team === this.us;
    const count = this.count;
    const kinds: number[] = [];
    const value = new Array<number>(22).fill(0);
    for (let kind = 2; kind < 22; kind++) {
      if (count[kind] === 0) continue;
      kinds.push(kind);
      const card = kindCard(kind);
      count[kind]!--;
      this.N--;
      const masks = caps[kind >> 1]!;
      let best = maxi ? -Infinity : Infinity;
      for (let k = 0; k < Math.max(1, masks.length); k++) {
        const nx = playOn(st, table, p.seat, card, masks[k] ?? 0, p.last, lastCap);
        const v = this.value(nx.st, nx.table, nx.lastCap, level + 1, hand);
        if (maxi ? v > best : v < best) best = v;
      }
      count[kind]!++;
      this.N++;
      value[kind] = best;
    }
    if (kinds.length === 0) return handValue(st, this.us);
    kinds.sort(maxi ? (a, b) => value[b]! - value[a]! : (a, b) => value[a]! - value[b]!);
    return expectBest(kinds, count, value, this.N, p.h);
  }
}

/**
 * Scores of the root moves with the analytic lookahead over `depth` plies (the bot's move included),
 * or null if that runs over the work budget.
 */
function lookScores(pos: Position, moves: readonly RootMove[], depth: number, budget: number): number[] | null {
  const look = new Lookahead(pos.us, plySequence(pos, depth - 1), kindCounts(pos.unseen), pos.unseen.length);
  return withBudget(budget, () =>
    moves.map((m) => {
      const after = applyRoot(pos, m);
      const rest = pos.hand.filter((c) => c !== m.card);
      let score = after.final ? handValue(after.st, pos.us) : look.value(after.st, after.table, after.lastCap, 0, rest);
      if (m.captured.length === 0) score -= LAY_KEEP * captureWorth(pos, m.card);
      return score;
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------
// hard, last deal (empty stock): alpha-beta to the end of the hand over deals of the hidden hands.
// ---------------------------------------------------------------------------------------------------------

/** One deal of the hidden cards, searched with every hand known. Only used once the stock is empty. */
class World {
  hands: number[][];
  handTotal = 0;

  constructor(
    readonly n: number,
    readonly us: number,
    public st: Stats,
    public table: number[],
    public lastCap: number,
  ) {
    this.hands = Array.from({ length: n }, () => []);
  }

  /** Value with `seat` to play and `depth` plies left; team `us` maximizes. */
  search(seat: number, depth: number, alpha: number, beta: number): number {
    step(1 + (this.table.length >> 2));
    if (this.handTotal === 0) return this.handOver();
    if (depth <= 0) return handValue(this.st, this.us);
    const hand = this.hands[seat]!;
    const next = (seat + 1) % this.n;
    if (hand.length === 0) return this.search(next, depth, alpha, beta);
    const team = seat & 1;
    const maxi = team === this.us;
    const st = this.st;
    const table = this.table;
    const caps = captureTable(table);
    const last = this.handTotal === 1;
    let best = maxi ? -Infinity : Infinity;
    let tried = 0;
    for (let i = 0; i < hand.length && alpha < beta; i++) {
      const card = hand[i]!;
      const bit = 1 << kindOf(card);
      if (tried & bit) continue;
      tried |= bit;
      const masks = caps[rankOf(card)]!;
      hand.splice(i, 1);
      this.handTotal--;
      const prevLast = this.lastCap;
      for (let k = 0; k < Math.max(1, masks.length) && alpha < beta; k++) {
        const mask = masks[k] ?? 0;
        let v: number;
        if (mask === 0) {
          this.table = [...table, card];
          v = this.search(next, depth - 1, alpha, beta);
        } else {
          const rest: number[] = [];
          addCard(st, team, card, 1);
          for (let j = 0; j < table.length; j++) {
            if (mask & (1 << j)) addCard(st, team, table[j]!, 1);
            else rest.push(table[j]!);
          }
          const chk = rest.length === 0 && !last;
          if (chk) st[team * 6 + CHK]! += 1;
          this.table = rest;
          this.lastCap = seat;
          v = this.search(next, depth - 1, alpha, beta);
          this.lastCap = prevLast;
          if (chk) st[team * 6 + CHK]! -= 1;
          addCard(st, team, card, -1);
          for (let j = 0; j < table.length; j++) if (mask & (1 << j)) addCard(st, team, table[j]!, -1);
        }
        this.table = table;
        if (maxi ? v > best : v < best) best = v;
        if (maxi) alpha = Math.max(alpha, v);
        else beta = Math.min(beta, v);
      }
      this.handTotal++;
      hand.splice(i, 0, card);
    }
    return best;
  }

  /** The hand is over: the cards left on the table go to the last capturer. */
  handOver(): number {
    const st = this.st;
    if (this.table.length === 0 || this.lastCap < 0) return handValue(st, this.us);
    const t = this.lastCap & 1;
    for (const c of this.table) addCard(st, t, c, 1);
    const v = handValue(st, this.us);
    for (const c of this.table) addCard(st, t, c, -1);
    return v;
  }
}

/** Every way to deal `cards` into hands of the given sizes. */
function allDeals(cards: readonly number[], sizes: readonly number[]): number[][][] {
  const out: number[][][] = [];
  const cur: number[][] = sizes.map(() => []);
  const rec = (i: number): void => {
    if (i === cards.length) {
      out.push(cur.map((h) => h.slice()));
      return;
    }
    for (let s = 0; s < sizes.length; s++) {
      if (cur[s]!.length >= sizes[s]!) continue;
      cur[s]!.push(cards[i]!);
      rec(i + 1);
      cur[s]!.pop();
    }
  };
  rec(0);
  return out;
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

/** Average over deals of the alpha-beta value of each root move; null if not even one deal fits the budget. */
function endgameScores(pos: Position, moves: readonly RootMove[], rand: () => number): number[] | null {
  const others: number[] = [];
  for (let s = 0; s < pos.n; s++) if (s !== pos.seat) others.push(s);
  const sizes = others.map((s) => pos.counts[s]!);
  const hidden = sizes.reduce((a, b) => a + b, 0);
  let after = -1;
  for (const c of pos.counts) after += c;

  // Deals of the hidden cards to search: all of them when there are few (just one with 2 players), else a
  // random sample searched to a limited depth.
  let ways = 1;
  for (let k = hidden, s = 0; s < sizes.length; s++) for (let j = 0; j < sizes[s]!; j++, k--) ways = (ways * k) / (j + 1);
  let deals: number[][][];
  let depth = after;
  if (hidden === pos.unseen.length && ways <= ENDGAME_ENUMERATE) deals = shuffled(allDeals(pos.unseen, sizes), rand);
  else {
    deals = [];
    for (let w = 0; w < ENDGAME_WORLDS; w++) {
      const pool = shuffled(pos.unseen.slice(), rand);
      let k = 0;
      deals.push(
        sizes.map((size) => {
          const hand = pool.slice(k, k + size);
          k += size;
          return hand;
        }),
      );
    }
    depth = Math.min(after, ENDGAME_DEPTH);
  }

  const sums = new Array<number>(moves.length).fill(0);
  let done = 0;
  withBudget(SEARCH_BUDGET, () => {
    for (const deal of deals) {
      const world = new World(pos.n, pos.us, pos.st, pos.table, pos.lastCap);
      others.forEach((s, i) => (world.hands[s] = deal[i]!.slice()));
      const values = moves.map((m) => {
        const a = applyRoot(pos, m);
        world.st = a.st;
        world.table = a.table;
        world.lastCap = a.lastCap;
        world.hands[pos.seat] = pos.hand.filter((c) => c !== m.card);
        world.handTotal = 0;
        for (const h of world.hands) world.handTotal += h.length;
        return world.search((pos.seat + 1) % pos.n, depth, -Infinity, Infinity);
      });
      // Only whole deals count (a deal cut short by the budget is dropped).
      values.forEach((v, i) => (sums[i]! += v));
      done++;
    }
  });
  return done > 0 ? sums.map((s) => s / done) : null;
}
