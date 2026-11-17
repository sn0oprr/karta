/**
 * Chkobba rules engine (authoritative on the server, also used by the client for move hints).
 *
 * Rules implemented (Tunisian Chkobba, see pagat.com "Scopa → Chkobba"):
 *  - 40-card deck; Queen = 8, Jack = 9, King = 10.
 *  - 2 players, or 4 players in two partnerships (partners sit opposite: seats 0&2 vs 1&3).
 *  - Play is anticlockwise: the next seat (seat + 1) is the player on the right. The deal passes to the right.
 *  - Each player receives 3 cards, 4 cards go face up on the table. If the initial table holds three or
 *    four cards of the same rank, the cards are gathered and redealt. When everyone has played their
 *    3 cards, 3 more are dealt to each player (no more table cards) until the stock is exhausted.
 *  - Capturing is compulsory. A played card captures one table card of the same rank; only if no card
 *    of the same rank is on the table may it capture a set of two or more cards whose values add up to
 *    its value. If several captures are possible the player chooses. Otherwise the card stays on the table.
 *  - Clearing the table is a "chkobba" (1 point) — except with the very last card of the hand.
 *  - At the end of the hand the cards left on the table go to the last player who captured (no chkobba).
 *  - Scoring per hand: Karta (most cards, 20–20 = nobody), Dinari (most diamonds, 5–5 = nobody),
 *    Bermila (most sevens; if tied, most sixes; if still tied, nobody), Sab'a el Haya (the 7 of diamonds),
 *    plus 1 per chkobba.
 *  - The game ends at the end of a hand in which a side reaches the target (default 21); the higher total
 *    wins, and a tie means another hand is played.
 */
import { type Card, makeDeck, shuffle } from './cards';
import { type Team, teamOf } from './teams';

export { type Team, teamOf };

export type SeatCount = 2 | 4;

export interface Move {
  cardId: string;
  /** Ids of the table cards captured by this move (empty = card is laid on the table). */
  capture: string[];
}

export interface ChkobbaOptions {
  numPlayers: SeatCount;
  targetScore: number;
  /** Seat of the first dealer. Defaults to a random seat. */
  firstDealer?: number;
  /** Uniform [0,1) random source used for shuffling. */
  rand: () => number;
}

export interface DealInfo {
  round: number;
  dealer: number;
  /** True for the first deal of a hand (table cards are dealt too). */
  initial: boolean;
  /** Seats in the order they received cards (one card at a time, 3 laps). */
  order: number[];
  /** Cards dealt to the table (initial deal only). */
  table: Card[];
  /** Cards dealt to each seat during this deal. */
  hands: Card[][];
  /** Number of redeals caused by three/four of a kind on the initial table. */
  redeals: number;
  deckCountAfter: number;
}

export interface PlayInfo {
  seat: number;
  card: Card;
  captured: Card[];
  chkobba: boolean;
  /** True when this was the very last card of the hand. */
  lastCardOfHand: boolean;
}

export interface TeamRoundStats {
  cards: number;
  diamonds: number;
  sevens: number;
  sixes: number;
  haya: boolean;
  chkobbas: number;
}

export interface RoundResult {
  round: number;
  stats: [TeamRoundStats, TeamRoundStats];
  /** Winner team of each category (null = tie, nobody scores). */
  karta: Team | null;
  dinari: Team | null;
  bermila: Team | null;
  haya: Team | null;
  /** Points scored this hand by each team. */
  points: [number, number];
  /** Cumulative totals after this hand. */
  totals: [number, number];
  /** Seat that took the cards left on the table at the end of the hand (null if none were left). */
  leftoverTo: number | null;
  leftover: Card[];
  /** Winning team if the game is over after this hand. */
  winner: Team | null;
}

export type Phase = 'playing' | 'roundOver' | 'gameOver';

export interface PlayOutcome {
  play: PlayInfo;
  /** Present when the play emptied every hand and the stock still had cards. */
  deal?: DealInfo;
  /** Present when the play ended the hand. */
  round?: RoundResult;
}

const HAND_SIZE = 3;
const INITIAL_TABLE = 4;

/**
 * All captures a card can make on the given table.
 * Returns [] when the card cannot capture (it will be laid on the table).
 * Same-rank captures take priority over sum captures.
 */
export function captureOptions(card: Card, table: readonly Card[]): Card[][] {
  const same = table.filter((c) => c.rank === card.rank);
  if (same.length > 0) return same.map((c) => [c]);

  const target = card.rank;
  const sorted = [...table].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const results: Card[][] = [];
  const pick: Card[] = [];
  const dfs = (start: number, remaining: number) => {
    if (remaining === 0) {
      if (pick.length >= 2) results.push([...pick]);
      return;
    }
    for (let i = start; i < sorted.length; i++) {
      const c = sorted[i]!;
      if (c.rank > remaining) break;
      pick.push(c);
      dfs(i + 1, remaining - c.rank);
      pick.pop();
    }
  };
  dfs(0, target);
  return results;
}

/** Every legal move for a hand against a table. */
export function legalMovesFor(hand: readonly Card[], table: readonly Card[]): Move[] {
  const moves: Move[] = [];
  for (const card of hand) {
    const opts = captureOptions(card, table);
    if (opts.length === 0) moves.push({ cardId: card.id, capture: [] });
    else for (const opt of opts) moves.push({ cardId: card.id, capture: opt.map((c) => c.id) });
  }
  return moves;
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (!Array.isArray(b) || a.length !== b.length) return false;
  const s = new Set(a);
  // Both sides must be duplicate-free, otherwise ['7D','7D'] would "match" ['3S','7D'].
  if (s.size !== a.length || new Set(b).size !== b.length) return false;
  return b.every((id) => s.has(id));
}

export function computeTeamStats(cards: readonly Card[], chkobbas: number): TeamRoundStats {
  let diamonds = 0;
  let sevens = 0;
  let sixes = 0;
  let haya = false;
  for (const c of cards) {
    if (c.suit === 'D') diamonds++;
    if (c.rank === 7) sevens++;
    if (c.rank === 6) sixes++;
    if (c.rank === 7 && c.suit === 'D') haya = true;
  }
  return { cards: cards.length, diamonds, sevens, sixes, haya, chkobbas };
}

function majority(a: number, b: number): Team | null {
  if (a > b) return 0;
  if (b > a) return 1;
  return null;
}

/** Scores a finished hand from each team's captured cards and chkobba counts. */
export function scoreHand(
  teamCards: [readonly Card[], readonly Card[]],
  chkobbas: [number, number],
): Pick<RoundResult, 'stats' | 'karta' | 'dinari' | 'bermila' | 'haya' | 'points'> {
  const stats: [TeamRoundStats, TeamRoundStats] = [
    computeTeamStats(teamCards[0], chkobbas[0]),
    computeTeamStats(teamCards[1], chkobbas[1]),
  ];
  const karta = majority(stats[0].cards, stats[1].cards);
  const dinari = majority(stats[0].diamonds, stats[1].diamonds);
  let bermila = majority(stats[0].sevens, stats[1].sevens);
  if (bermila === null) bermila = majority(stats[0].sixes, stats[1].sixes);
  const haya: Team | null = stats[0].haya ? 0 : stats[1].haya ? 1 : null;
  const points: [number, number] = [stats[0].chkobbas, stats[1].chkobbas];
  for (const t of [karta, dinari, bermila, haya]) if (t !== null) points[t] += 1;
  return { stats, karta, dinari, bermila, haya, points };
}

export class ChkobbaGame {
  readonly numPlayers: SeatCount;
  readonly targetScore: number;
  private readonly rand: () => number;

  deck: Card[] = [];
  table: Card[] = [];
  hands: Card[][];
  /** Cards captured by each seat during the current hand. */
  piles: Card[][];
  /** Cards that made a chkobba, per seat (they are also in `piles`). */
  chkobbaCards: Card[][];
  scores: [number, number] = [0, 0];
  dealer: number;
  turn: number;
  round = 0;
  lastCapturer: number | null = null;
  phase: Phase = 'playing';
  lastRound: RoundResult | null = null;
  winner: Team | null = null;
  /** Every card played this hand, in order (public knowledge). */
  playedThisHand: PlayInfo[] = [];

  constructor(opts: ChkobbaOptions) {
    if (opts.numPlayers !== 2 && opts.numPlayers !== 4) throw new Error('Chkobba is played by 2 or 4 players');
    this.numPlayers = opts.numPlayers;
    this.targetScore = opts.targetScore;
    this.rand = opts.rand;
    this.hands = this.emptyPerSeat();
    this.piles = this.emptyPerSeat();
    this.chkobbaCards = this.emptyPerSeat();
    const first = opts.firstDealer ?? Math.floor(this.rand() * this.numPlayers);
    // startRound() advances the dealer, so start one seat "before" the requested first dealer.
    this.dealer = (first - 1 + this.numPlayers) % this.numPlayers;
    this.turn = 0;
  }

  private emptyPerSeat(): Card[][] {
    return Array.from({ length: this.numPlayers }, () => []);
  }

  nextSeat(seat: number): number {
    return (seat + 1) % this.numPlayers;
  }

  teamCards(team: Team): Card[] {
    const out: Card[] = [];
    for (let s = 0; s < this.numPlayers; s++) if (teamOf(s) === team) out.push(...this.piles[s]!);
    return out;
  }

  teamChkobbas(team: Team): number {
    let n = 0;
    for (let s = 0; s < this.numPlayers; s++) if (teamOf(s) === team) n += this.chkobbaCards[s]!.length;
    return n;
  }

  /** Starts a new hand: rotates the dealer, shuffles and performs the initial deal. */
  startRound(): DealInfo {
    if (this.phase === 'gameOver') throw new Error('The game is over');
    if (this.round > 0 && this.phase !== 'roundOver') throw new Error('The current hand is not finished');
    this.round += 1;
    this.dealer = this.nextSeat(this.dealer);
    this.hands = this.emptyPerSeat();
    this.piles = this.emptyPerSeat();
    this.chkobbaCards = this.emptyPerSeat();
    this.lastCapturer = null;
    this.playedThisHand = [];
    this.phase = 'playing';

    let redeals = 0;
    const handCards = this.numPlayers * HAND_SIZE;
    for (;;) {
      this.deck = shuffle(makeDeck(), this.rand);
      // Cards are popped from the end: first the hands, then the four table cards.
      const end = this.deck.length - handCards;
      const table = this.deck.slice(end - INITIAL_TABLE, end);
      const counts = new Map<number, number>();
      for (const c of table) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
      if (Math.max(...counts.values()) >= 3 && redeals < 50) {
        redeals++;
        continue;
      }
      break;
    }
    const deal = this.dealHands(true);
    deal.redeals = redeals;
    this.turn = this.nextSeat(this.dealer);
    return deal;
  }

  private dealHands(initial: boolean): DealInfo {
    const order: number[] = [];
    const hands: Card[][] = this.emptyPerSeat();
    for (let lap = 0; lap < HAND_SIZE; lap++) {
      for (let i = 1; i <= this.numPlayers; i++) {
        const seat = (this.dealer + i) % this.numPlayers;
        const card = this.deck.pop();
        if (!card) throw new Error('Deck exhausted while dealing');
        hands[seat]!.push(card);
        this.hands[seat]!.push(card);
        order.push(seat);
      }
    }
    const table: Card[] = [];
    if (initial) {
      for (let i = 0; i < INITIAL_TABLE; i++) {
        const card = this.deck.pop();
        if (!card) throw new Error('Deck exhausted while dealing');
        table.push(card);
      }
      this.table = [...table];
    }
    return {
      round: this.round,
      dealer: this.dealer,
      initial,
      order,
      table,
      hands,
      redeals: 0,
      deckCountAfter: this.deck.length,
    };
  }

  legalMoves(seat: number): Move[] {
    if (this.phase !== 'playing' || seat !== this.turn) return [];
    return legalMovesFor(this.hands[seat]!, this.table);
  }

  isLegal(seat: number, move: Move): boolean {
    if (!move || typeof move.cardId !== 'string' || !Array.isArray(move.capture)) return false;
    return this.legalMoves(seat).some((m) => m.cardId === move.cardId && sameIdSet(m.capture, move.capture));
  }

  /** Applies a move. Throws on illegal moves. */
  play(seat: number, move: Move): PlayOutcome {
    if (this.phase !== 'playing') throw new Error('No hand in progress');
    if (seat !== this.turn) throw new Error('Not your turn');
    if (!this.isLegal(seat, move)) throw new Error('Illegal move');

    const hand = this.hands[seat]!;
    const handIdx = hand.findIndex((c) => c.id === move.cardId);
    const card = hand.splice(handIdx, 1)[0]!;
    const captureSet = new Set(move.capture);
    const captured = this.table.filter((c) => captureSet.has(c.id));

    const handsEmpty = this.hands.every((h) => h.length === 0);
    const lastCardOfHand = handsEmpty && this.deck.length === 0;

    let chkobba = false;
    if (captured.length > 0) {
      this.table = this.table.filter((c) => !captureSet.has(c.id));
      this.piles[seat]!.push(card, ...captured);
      this.lastCapturer = seat;
      if (this.table.length === 0 && !lastCardOfHand) {
        chkobba = true;
        this.chkobbaCards[seat]!.push(card);
      }
    } else {
      this.table.push(card);
    }

    const play: PlayInfo = { seat, card, captured, chkobba, lastCardOfHand };
    this.playedThisHand.push(play);
    const outcome: PlayOutcome = { play };

    if (!handsEmpty) {
      this.turn = this.nextSeat(seat);
      return outcome;
    }
    if (this.deck.length > 0) {
      outcome.deal = this.dealHands(false);
      // Play continues anticlockwise; after a full lap the next player is again the dealer's right.
      this.turn = this.nextSeat(seat);
      return outcome;
    }
    outcome.round = this.finishRound();
    return outcome;
  }

  private finishRound(): RoundResult {
    const leftover = [...this.table];
    let leftoverTo: number | null = null;
    if (leftover.length > 0 && this.lastCapturer !== null) {
      leftoverTo = this.lastCapturer;
      this.piles[leftoverTo]!.push(...leftover);
      this.table = [];
    }
    const scored = scoreHand(
      [this.teamCards(0), this.teamCards(1)],
      [this.teamChkobbas(0), this.teamChkobbas(1)],
    );
    this.scores = [this.scores[0] + scored.points[0], this.scores[1] + scored.points[1]];
    let winner: Team | null = null;
    const [a, b] = this.scores;
    if ((a >= this.targetScore || b >= this.targetScore) && a !== b) winner = a > b ? 0 : 1;
    this.winner = winner;
    this.phase = winner === null ? 'roundOver' : 'gameOver';
    const result: RoundResult = {
      round: this.round,
      ...scored,
      totals: [a, b],
      leftoverTo,
      leftover,
      winner,
    };
    this.lastRound = result;
    return result;
  }

  /** Cards not visible to `seat`: still in the stock or in other players' hands. */
  unseenBy(seat: number): Card[] {
    const out: Card[] = [...this.deck];
    for (let s = 0; s < this.numPlayers; s++) if (s !== seat) out.push(...this.hands[s]!);
    return out;
  }
}
