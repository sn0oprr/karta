/**
 * Belote rules engine (authoritative on the server; the client and the bots use its helpers too).
 *
 * Tunisian Belote — "belote coinchée tunisienne", the café game: an auction for the contract, no turned card.
 * Rules as settled by Tunisian players (github.com/othmansouhayl/belote, regles.md and QUESTIONS.md):
 *  - 32 cards (7 to Ace in four suits); 4 players in two partnerships, partners sitting opposite (seats 0 & 2
 *    against 1 & 3). Play goes anticlockwise (seat + 1 is the player on the right); the deal passes to the right.
 *  - The dealer gives 8 cards to everyone, in two lots of 4, starting on their right.
 *  - Auction, starting on the dealer's right: bid a number of points from 90 to 160 (steps of 10) with a trump
 *    suit, or Kabbout (كبوط: take all eight tricks), above anything; each bid must beat the one before. You may
 *    pass and bid again later, or bid over your partner. A bid followed by three passes is the contract; if all
 *    four pass without a bid, the next dealer deals again.
 *  - An opponent of the team holding the contract may say "Contre" (×2). Then only the taking team speaks, each
 *    player once in turn: "Surcontre" (×4) ends the auction, and if both pass it ends contred.
 *  - The player on the dealer's right leads the first trick; a trick's winner leads the next.
 *  - You must follow suit; when trumps are led you must beat the best trump in the trick if you can. When you
 *    cannot follow suit you must trump, beating a trump already played if you can (else any trump) — unless
 *    your partner is winning the trick: then any card, except that a hand of nothing but trumps must still beat
 *    the best trump on the table if it can.
 *  - Trumps rank J 9 A 10 K Q 8 7 and score 20 14 11 10 4 3 0 0; the other suits rank A 10 K Q J 9 8 7 and
 *    score 11 10 4 3 2 0 0 0. With 10 for the last trick ("dix de der") a hand is worth 162.
 *  - Belote: the player holding the King and Queen of trumps says "Belote" and "Rebelote" as they play them:
 *    20 points, never multiplied. It is the only announcement (no tierce, cinquante, cent or carré).
 *  - Scoring: each team's trick points are rounded to the ten (units 5 to 9 up). The takers make their contract
 *    when their points (with their belote) reach the bid and beat the defence's. Then each team scores what it
 *    made; all eight tricks without having bid Kabbout make 250. A contred contract made scores a flat 320
 *    (surcontred 640; with all eight tricks 250 ×2 or ×4), plus 20 for a belote. A failed contract gives the
 *    defence 160 (×2, ×4), plus 20 for a belote whoever held it. Kabbout is worth 500 (×2, ×4) to the takers,
 *    or to the defence if it fails.
 *  - A Kabbout fails, and the hand stops, as soon as the defence wins a trick; any other contract stops as soon
 *    as the takers can no longer make it ("طيش").
 *  - The game ends after a hand in which a team reaches the target (1500 by default); the higher total wins,
 *    and a tie plays another hand.
 */
import { SUITS, type Suit, shuffle, suitSymbol } from './cards';
import { type Team, teamOf } from './teams';

export type BRank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

/** Ranks in sequence order: 7 8 9 10 J Q K A. */
export const BELOTE_RANKS: readonly BRank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export interface BCard {
  /**
   * Stable identifier, suit first: "HJ" (jack of hearts), "S10", "DA". Suit-first ids can never be mistaken
   * for Chkobba's rank-first ones ("8D" is the Chkobba queen of diamonds), so both decks share the card art.
   */
  id: string;
  suit: Suit;
  rank: BRank;
}

export const BELOTE_PLAYERS = 4;
export const BELOTE_TARGETS = [1000, 1500, 2000] as const;
export const MIN_BID = 90;
export const MAX_BID = 160;
export const BID_STEP = 10;
export const HAND_POINTS = 162;
export const LAST_TRICK_BONUS = 10;
export const BELOTE_POINTS = 20;
/** A failed contract, for the defence (×2 contred, ×4 surcontred). */
export const FAILED_POINTS = 160;
/** Kabbout, made or failed (×2, ×4). */
export const KABBOUT_POINTS = 500;
/** All eight tricks without having bid Kabbout. */
export const CAPOT_POINTS = 250;
/** Cards dealt to each player at a time. */
const DEAL_LOTS = [4, 4];

const ID_RE = /^([DHCS])(7|8|9|10|J|Q|K|A)$/;

export function beloteCardId(rank: BRank, suit: Suit): string {
  return `${suit}${rank}`;
}

export function isBeloteCardId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function parseBeloteCard(id: string): BCard {
  const m = ID_RE.exec(id);
  if (!m) throw new Error(`Invalid Belote card id: ${id}`);
  return { id, suit: m[1] as Suit, rank: m[2] as BRank };
}

export function makeBeloteCard(rank: BRank, suit: Suit): BCard {
  return { id: beloteCardId(rank, suit), suit, rank };
}

/** A fresh, ordered 32-card deck. */
export function makeBeloteDeck(): BCard[] {
  const deck: BCard[] = [];
  for (const suit of SUITS) for (const rank of BELOTE_RANKS) deck.push(makeBeloteCard(rank, suit));
  return deck;
}

/** Compact label such as "J♥" or "10♠". */
export function beloteCardShort(card: BCard): string {
  return `${card.rank}${suitSymbol(card.suit)}`;
}

// ───────────────────────────── values ─────────────────────────────

const TRUMP_POINTS: Readonly<Record<BRank, number>> = { J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0 };
const PLAIN_POINTS: Readonly<Record<BRank, number>> = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
/** Strength within a suit, 0 (weakest) to 7. */
const TRUMP_ORDER: Readonly<Record<BRank, number>> = { '7': 0, '8': 1, Q: 2, K: 3, '10': 4, A: 5, '9': 6, J: 7 };
const PLAIN_ORDER: Readonly<Record<BRank, number>> = { '7': 0, '8': 1, '9': 2, J: 3, Q: 4, K: 5, '10': 6, A: 7 };

export function cardPoints(card: BCard, trump: Suit | null): number {
  return card.suit === trump ? TRUMP_POINTS[card.rank] : PLAIN_POINTS[card.rank];
}

/** Strength of a card within its own suit (0–7): trump order for trumps, A 10 K Q J 9 8 7 otherwise. */
export function cardStrength(card: BCard, trump: Suit | null): number {
  return card.suit === trump ? TRUMP_ORDER[card.rank] : PLAIN_ORDER[card.rank];
}

/** Does `card` beat `best`, the card currently winning a trick? */
export function beats(card: BCard, best: BCard, trump: Suit): boolean {
  if (card.suit === best.suit) return cardStrength(card, trump) > cardStrength(best, trump);
  return card.suit === trump;
}

/** Trick points rounded to the ten, as Tunisian tables count them: units 0–4 down, 5–9 up. */
export function roundTen(points: number): number {
  return Math.floor((points + 5) / 10) * 10;
}

export interface TrickPlay {
  seat: number;
  card: BCard;
}

/** The play winning a (non-empty) trick so far: the best trump, else the best card of the suit led. */
export function trickWinner(trick: readonly TrickPlay[], trump: Suit): TrickPlay {
  let best = trick[0]!;
  for (let i = 1; i < trick.length; i++) if (beats(trick[i]!.card, best.card, trump)) best = trick[i]!;
  return best;
}

/** The cards `seat` may play from `hand` on the trick so far. */
export function legalCards(hand: readonly BCard[], trick: readonly TrickPlay[], trump: Suit, seat: number): BCard[] {
  if (trick.length === 0) return [...hand];
  const led = trick[0]!.card.suit;
  let topTrump = -1;
  for (const p of trick) if (p.card.suit === trump) topTrump = Math.max(topTrump, cardStrength(p.card, trump));
  const follow = hand.filter((c) => c.suit === led);
  if (follow.length > 0) {
    if (led !== trump) return follow;
    const over = follow.filter((c) => cardStrength(c, trump) > topTrump);
    return over.length > 0 ? over : follow;
  }
  const trumps = hand.filter((c) => c.suit === trump);
  if (trumps.length === 0) return [...hand];
  const over = trumps.filter((c) => cardStrength(c, trump) > topTrump);
  if (teamOf(trickWinner(trick, trump).seat) === teamOf(seat)) {
    // The partner is winning: any card — but with nothing but trumps left, beat the best one if you can.
    return trumps.length === hand.length && over.length > 0 ? over : [...hand];
  }
  return over.length > 0 ? over : trumps;
}

/** Why `card` may not be played (for the player), or null when it may. */
export function illegalReason(hand: readonly BCard[], trick: readonly TrickPlay[], trump: Suit, seat: number, card: BCard): string | null {
  if (legalCards(hand, trick, trump, seat).some((c) => c.id === card.id)) return null;
  if (!hand.some((c) => c.id === card.id)) return 'That card is not in your hand';
  const led = trick[0]!.card.suit;
  if (card.suit === trump && (led === trump || !hand.some((c) => c.suit === led))) return 'You must play a higher trump';
  if (hand.some((c) => c.suit === led)) return `You must follow suit (${suitSymbol(led)})`;
  return `You must trump (${suitSymbol(trump)})`;
}

/** Display order: suits alternating colours, trumps first, strongest card first within each suit. */
export function sortBeloteHand(cards: readonly BCard[], trump: Suit | null): BCard[] {
  const cycle: Suit[] = ['S', 'H', 'C', 'D'];
  const start = trump ? cycle.indexOf(trump) : 0;
  const rank = (s: Suit) => (cycle.indexOf(s) - start + 4) % 4;
  return [...cards].sort((a, b) => rank(a.suit) - rank(b.suit) || cardStrength(b, trump) - cardStrength(a, trump));
}

// ───────────────────────────── auction ─────────────────────────────

/** A bid: points from 90 to 160, or Kabbout (all eight tricks). */
export type ContractValue = number | 'kabbout';

export interface Contract {
  seat: number;
  value: ContractValue;
  suit: Suit;
}

export type AuctionCall = { type: 'bid'; value: ContractValue; suit: Suit } | { type: 'pass' } | { type: 'contre' } | { type: 'surcontre' };

export interface AuctionAction {
  seat: number;
  call: AuctionCall;
}

/** ×1, ×2 after a contre, ×4 after a surcontre. */
export type Coinche = 1 | 2 | 4;

/** Every bid there is, lowest first. */
export const BID_VALUES: readonly ContractValue[] = [90, 100, 110, 120, 130, 140, 150, 160, 'kabbout'];

export function isBidValue(v: unknown): v is ContractValue {
  return BID_VALUES.includes(v as ContractValue);
}

/** Orders bids: Kabbout above 160. */
export function bidRank(v: ContractValue): number {
  return v === 'kabbout' ? MAX_BID + BID_STEP : v;
}

export function contractLabel(c: { value: ContractValue; suit: Suit }): string {
  return `${c.value === 'kabbout' ? 'Kabbout' : c.value} ${suitSymbol(c.suit)}`;
}

/** What a call sounds like at the table. */
export function callLabel(call: AuctionCall): string {
  switch (call.type) {
    case 'bid':
      return contractLabel(call);
    case 'pass':
      return 'Pass';
    case 'contre':
      return 'Contre!';
    case 'surcontre':
      return 'Surcontre!';
  }
}

/** What the seat to speak may say, given the contract so far and its doubling. */
export interface AuctionOptions {
  /** Lowest number it may bid (null: no number left, or no more bids after a contre). */
  minBid: number | null;
  kabbout: boolean;
  contre: boolean;
  surcontre: boolean;
}

export function auctionOptions(state: { contract: Contract | null; coinche: Coinche }, seat: number): AuctionOptions {
  const { contract, coinche } = state;
  // After a contre, only the taking team speaks: surcontre or pass.
  if (coinche > 1) return { minBid: null, kabbout: false, contre: false, surcontre: coinche === 2 && !!contract && teamOf(contract.seat) === teamOf(seat) };
  const current = contract ? bidRank(contract.value) : MIN_BID - BID_STEP;
  return {
    minBid: current + BID_STEP <= MAX_BID ? current + BID_STEP : null,
    kabbout: contract?.value !== 'kabbout',
    contre: !!contract && teamOf(contract.seat) !== teamOf(seat),
    surcontre: false,
  };
}

/** Checks an untrusted call's shape (not whether it is allowed now); returns a clean copy. */
export function parseCall(raw: unknown): AuctionCall | null {
  const c = raw as Partial<{ type: unknown; value: unknown; suit: unknown }> | null;
  if (!c || typeof c !== 'object') return null;
  if (c.type === 'pass' || c.type === 'contre' || c.type === 'surcontre') return { type: c.type };
  if (c.type === 'bid' && isBidValue(c.value) && SUITS.includes(c.suit as Suit)) return { type: 'bid', value: c.value, suit: c.suit as Suit };
  return null;
}

// ───────────────────────────── game ─────────────────────────────

export type BelotePhase = 'bidding' | 'playing' | 'roundOver' | 'gameOver';

export interface BeloteOptions {
  targetScore: number;
  /** Seat of the first dealer. Defaults to a random seat. */
  firstDealer?: number;
  /** Uniform [0,1) random source used for shuffling. */
  rand: () => number;
}

export interface BeloteDealInfo {
  round: number;
  dealer: number;
  /** Seats in the order they received cards (lots of 4). */
  order: number[];
  /** Cards dealt to each seat (8 each). */
  hands: BCard[][];
  /** How many times everybody passed before this deal, in this hand. */
  redeals: number;
}

export interface ContractInfo {
  contract: Contract;
  coinche: Coinche;
  coincheBy: number | null;
}

export interface AuctionOutcome {
  action: AuctionAction;
  /** Present when the call closed the auction: the hand is played for this contract. */
  contract?: ContractInfo;
  /** Present when everybody passed: the next dealer deals again. */
  redeal?: BeloteDealInfo;
}

export interface BelotePlayInfo {
  seat: number;
  card: BCard;
  /** Said with the King or Queen of trumps by the player holding both. */
  belote: 'belote' | 'rebelote' | null;
}

export interface BeloteTrickInfo {
  /** 0 to 7. */
  index: number;
  plays: TrickPlay[];
  winner: number;
  /** Card points in the trick, the last trick's 10 included. */
  points: number;
  last: boolean;
}

export interface HandScoreInput {
  contract: Contract;
  coinche: Coinche;
  /** The tricks played (their points include the 10 for the last one). */
  tricks: readonly Pick<BeloteTrickInfo, 'winner' | 'points'>[];
  /** Seat holding both the King and Queen of trumps (null: nobody did). */
  beloteHolder: number | null;
  /** The hand stopped early: the contract was out of reach. */
  early?: boolean;
}

export interface HandScore {
  contract: Contract;
  coinche: Coinche;
  /** Tricks won per team. */
  tricks: [number, number];
  /** Trick points per team, the last trick's 10 included. */
  cardPoints: [number, number];
  /** The same, rounded to the ten. */
  rounded: [number, number];
  /** Team holding the King and Queen of trumps. */
  belote: Team | null;
  /** What each team made: rounded points plus its belote. */
  made: [number, number];
  /** A team that took all eight tricks. */
  capot: Team | null;
  outcome: 'made' | 'failed';
  /** The hand stopped before the last trick because the takers could no longer make it. */
  early: boolean;
  /** Points scored this hand by each team. */
  points: [number, number];
}

export interface BeloteRoundResult extends HandScore {
  round: number;
  /** Cumulative totals after this hand. */
  totals: [number, number];
  /** Winning team if the game is over after this hand. */
  winner: Team | null;
}

export interface BelotePlayOutcome {
  play: BelotePlayInfo;
  /** Present when the card completed a trick. */
  trick?: BeloteTrickInfo;
  /** Present when the hand is over (after the last trick, or early). */
  round?: BeloteRoundResult;
}

/** Applies the Tunisian scale to a hand: whether the contract is made, and what each team scores. */
export function scoreBeloteHand(input: HandScoreInput): HandScore {
  const { contract, coinche, beloteHolder } = input;
  const early = !!input.early;
  const takers = teamOf(contract.seat);
  const defence: Team = takers === 0 ? 1 : 0;
  const tricks: [number, number] = [0, 0];
  const cardPoints: [number, number] = [0, 0];
  for (const t of input.tricks) {
    tricks[teamOf(t.winner)] += 1;
    cardPoints[teamOf(t.winner)] += t.points;
  }
  const complete = !early && input.tricks.length === 8;
  const capot: Team | null = complete && tricks[1] === 0 ? 0 : complete && tricks[0] === 0 ? 1 : null;
  const rounded: [number, number] = [roundTen(cardPoints[0]), roundTen(cardPoints[1])];
  const belote: Team | null = beloteHolder === null ? null : teamOf(beloteHolder);
  const bel: [number, number] = [belote === 0 ? BELOTE_POINTS : 0, belote === 1 ? BELOTE_POINTS : 0];
  const made: [number, number] = [rounded[0] + bel[0], rounded[1] + bel[1]];
  const value = contract.value;
  const kabbout = value === 'kabbout';
  const success = value === 'kabbout' ? capot === takers : !early && made[takers] >= value && made[takers] > made[defence];

  // Belote: never multiplied; it goes with the hand on a failure or a contred success, else stays put.
  const anyBelote = belote === null ? 0 : BELOTE_POINTS;
  const points: [number, number] = [0, 0];
  if (!success) {
    points[defence] = (kabbout ? KABBOUT_POINTS : FAILED_POINTS) * coinche + anyBelote;
  } else if (coinche > 1) {
    points[takers] = (kabbout ? KABBOUT_POINTS : capot === takers ? CAPOT_POINTS : FAILED_POINTS) * coinche + anyBelote;
  } else if (kabbout || capot === takers) {
    points[takers] = (kabbout ? KABBOUT_POINTS : CAPOT_POINTS) + bel[takers];
    points[defence] = bel[defence];
  } else {
    points[takers] = made[takers];
    points[defence] = made[defence];
  }
  return { contract, coinche, tricks, cardPoints, rounded, belote, made, capot, outcome: success ? 'made' : 'failed', early, points };
}

export class BeloteGame {
  readonly numPlayers = BELOTE_PLAYERS;
  readonly targetScore: number;
  private readonly rand: () => number;

  hands: BCard[][] = emptySeats();
  phase: BelotePhase = 'bidding';
  /** Number of the current hand (a redeal does not count as a hand). */
  round = 0;
  dealer: number;
  turn = 0;
  /** Calls of the current deal, in order. */
  auction: AuctionAction[] = [];
  /** The best bid so far, and once the auction is over, the contract. */
  contract: Contract | null = null;
  coinche: Coinche = 1;
  coincheBy: number | null = null;
  /** Times everybody passed in the current hand. */
  redeals = 0;
  trump: Suit | null = null;
  taker: number | null = null;
  /** Leader of the trick in progress. */
  leader = 0;
  trick: TrickPlay[] = [];
  /** Completed tricks of the current hand (public). */
  tricks: BeloteTrickInfo[] = [];
  /** Cards won by each seat in the current hand. */
  piles: BCard[][] = emptySeats();
  /** Seat holding both the King and Queen of trumps (private until they play them). */
  beloteHolder: number | null = null;
  /** How many of those two cards have been played (0–2). */
  beloteStage = 0;
  scores: [number, number] = [0, 0];
  lastRound: BeloteRoundResult | null = null;
  winner: Team | null = null;
  /** Passes in a row since the last bid. */
  private passes = 0;
  /** After a contre: the takers still to answer (surcontre or pass), in turn. */
  private answering: number[] = [];

  constructor(opts: BeloteOptions) {
    this.targetScore = opts.targetScore;
    this.rand = opts.rand;
    const first = opts.firstDealer ?? Math.floor(this.rand() * BELOTE_PLAYERS);
    // deal() advances the dealer, so start one seat "before" the requested first dealer.
    this.dealer = (first - 1 + BELOTE_PLAYERS) % BELOTE_PLAYERS;
  }

  nextSeat(seat: number): number {
    return (seat + 1) % BELOTE_PLAYERS;
  }

  /** Starts a new hand: the deal passes to the right and everyone gets 8 cards. */
  startRound(): BeloteDealInfo {
    if (this.phase === 'gameOver') throw new Error('The game is over');
    if (this.round > 0 && this.phase !== 'roundOver') throw new Error('The current hand is not finished');
    this.round += 1;
    this.redeals = 0;
    return this.deal();
  }

  private deal(): BeloteDealInfo {
    this.dealer = this.nextSeat(this.dealer);
    this.hands = emptySeats();
    this.piles = emptySeats();
    this.auction = [];
    this.contract = null;
    this.coinche = 1;
    this.coincheBy = null;
    this.passes = 0;
    this.answering = [];
    this.trump = null;
    this.taker = null;
    this.trick = [];
    this.tricks = [];
    this.beloteHolder = null;
    this.beloteStage = 0;
    const deck = shuffle(makeBeloteDeck(), this.rand);
    const order: number[] = [];
    for (const lot of DEAL_LOTS) {
      for (let i = 1; i <= BELOTE_PLAYERS; i++) {
        const seat = (this.dealer + i) % BELOTE_PLAYERS;
        for (let k = 0; k < lot; k++) {
          this.hands[seat]!.push(deck.pop()!);
          order.push(seat);
        }
      }
    }
    this.phase = 'bidding';
    this.turn = this.nextSeat(this.dealer);
    this.leader = this.turn;
    return { round: this.round, dealer: this.dealer, order, hands: this.hands.map((h) => [...h]), redeals: this.redeals };
  }

  /** What `seat` may say now (meaningful when it is their turn in the auction). */
  options(seat: number): AuctionOptions {
    return auctionOptions(this, seat);
  }

  isLegalCall(seat: number, call: AuctionCall): boolean {
    if (this.phase !== 'bidding' || seat !== this.turn) return false;
    const o = this.options(seat);
    switch (call.type) {
      case 'pass':
        return true;
      case 'contre':
        return o.contre;
      case 'surcontre':
        return o.surcontre;
      case 'bid':
        if (!SUITS.includes(call.suit)) return false;
        if (call.value === 'kabbout') return o.kabbout;
        return o.minBid !== null && isBidValue(call.value) && call.value >= o.minBid;
    }
  }

  /** A call in the auction. Throws on illegal calls. */
  call(seat: number, raw: AuctionCall): AuctionOutcome {
    if (this.phase !== 'bidding') throw new Error('No auction in progress');
    if (seat !== this.turn) throw new Error('Not your turn');
    const call = parseCall(raw);
    if (!call || !this.isLegalCall(seat, call)) throw new Error('Illegal call');
    const action: AuctionAction = { seat, call };
    this.auction.push(action);
    switch (call.type) {
      case 'bid':
        this.contract = { seat, value: call.value, suit: call.suit };
        this.passes = 0;
        this.turn = this.nextSeat(seat);
        return { action };
      case 'contre': {
        this.coinche = 2;
        this.coincheBy = seat;
        const takers = teamOf(this.contract!.seat);
        this.answering = [1, 2, 3].map((k) => (seat + k) % BELOTE_PLAYERS).filter((s) => teamOf(s) === takers);
        this.turn = this.answering[0]!;
        return { action };
      }
      case 'surcontre':
        this.coinche = 4;
        return { action, contract: this.closeAuction() };
      case 'pass':
        if (this.coinche === 2) {
          this.answering.shift();
          if (this.answering.length === 0) return { action, contract: this.closeAuction() };
          this.turn = this.answering[0]!;
          return { action };
        }
        this.passes += 1;
        if (this.contract && this.passes >= BELOTE_PLAYERS - 1) return { action, contract: this.closeAuction() };
        if (!this.contract && this.passes >= BELOTE_PLAYERS) {
          // Nobody wants it: the next dealer deals again.
          this.redeals += 1;
          return { action, redeal: this.deal() };
        }
        this.turn = this.nextSeat(seat);
        return { action };
    }
  }

  private closeAuction(): ContractInfo {
    const contract = this.contract!;
    this.trump = contract.suit;
    this.taker = contract.seat;
    for (let s = 0; s < BELOTE_PLAYERS; s++) {
      const h = this.hands[s]!;
      if (h.some((c) => c.suit === contract.suit && c.rank === 'K') && h.some((c) => c.suit === contract.suit && c.rank === 'Q')) this.beloteHolder = s;
    }
    this.phase = 'playing';
    this.turn = this.nextSeat(this.dealer);
    this.leader = this.turn;
    return { contract: { ...contract }, coinche: this.coinche, coincheBy: this.coincheBy };
  }

  legalCards(seat: number): BCard[] {
    if (this.phase !== 'playing' || seat !== this.turn || !this.trump) return [];
    return legalCards(this.hands[seat]!, this.trick, this.trump, seat);
  }

  isLegalCard(seat: number, cardId: string): boolean {
    return this.legalCards(seat).some((c) => c.id === cardId);
  }

  /** Plays a card. Throws on illegal plays. */
  play(seat: number, cardId: string): BelotePlayOutcome {
    if (this.phase !== 'playing') throw new Error('No trick in progress');
    if (seat !== this.turn) throw new Error('Not your turn');
    if (!this.isLegalCard(seat, cardId)) throw new Error('Illegal card');
    const trump = this.trump!;
    const hand = this.hands[seat]!;
    const card = hand.splice(
      hand.findIndex((c) => c.id === cardId),
      1,
    )[0]!;
    let belote: BelotePlayInfo['belote'] = null;
    if (seat === this.beloteHolder && card.suit === trump && (card.rank === 'K' || card.rank === 'Q')) {
      this.beloteStage += 1;
      belote = this.beloteStage === 1 ? 'belote' : 'rebelote';
    }
    this.trick.push({ seat, card });
    const out: BelotePlayOutcome = { play: { seat, card, belote } };
    if (this.trick.length < BELOTE_PLAYERS) {
      this.turn = this.nextSeat(seat);
      return out;
    }

    const win = trickWinner(this.trick, trump);
    const last = this.tricks.length === 7;
    let points = last ? LAST_TRICK_BONUS : 0;
    for (const p of this.trick) points += cardPoints(p.card, trump);
    const trick: BeloteTrickInfo = { index: this.tricks.length, plays: this.trick, winner: win.seat, points, last };
    this.tricks.push(trick);
    this.piles[win.seat]!.push(...this.trick.map((p) => p.card));
    this.trick = [];
    this.turn = win.seat;
    this.leader = win.seat;
    out.trick = trick;
    if (last) out.round = this.finishRound(false);
    else if (this.contractLost()) out.round = this.finishRound(true);
    return out;
  }

  /**
   * Can the takers no longer make their contract, even winning every trick left (the last trick's 10 and their
   * belote counted)? Then the cards are thrown in. A Kabbout is lost with the first trick the defence wins.
   */
  contractLost(): boolean {
    const contract = this.contract;
    if (this.phase !== 'playing' || !contract) return false;
    const takers = teamOf(contract.seat);
    if (contract.value === 'kabbout') return this.tricks.some((t) => teamOf(t.winner) !== takers);
    const pts = [0, 0];
    for (const t of this.tricks) pts[teamOf(t.winner)]! += t.points;
    const best = roundTen(HAND_POINTS - pts[1 - takers]!);
    const theirs = roundTen(pts[1 - takers]!);
    const belote = this.beloteHolder === null ? -1 : teamOf(this.beloteHolder);
    const ours = best + (belote === takers ? BELOTE_POINTS : 0);
    return ours < contract.value || ours <= theirs + (belote === 1 - takers ? BELOTE_POINTS : 0);
  }

  private finishRound(early: boolean): BeloteRoundResult {
    const scored = scoreBeloteHand({ contract: this.contract!, coinche: this.coinche, tricks: this.tricks, beloteHolder: this.beloteHolder, early });
    this.scores = [this.scores[0] + scored.points[0], this.scores[1] + scored.points[1]];
    const [a, b] = this.scores;
    let winner: Team | null = null;
    if ((a >= this.targetScore || b >= this.targetScore) && a !== b) winner = a > b ? 0 : 1;
    this.winner = winner;
    this.phase = winner === null ? 'roundOver' : 'gameOver';
    const result: BeloteRoundResult = { round: this.round, ...scored, totals: [a, b], winner };
    this.lastRound = result;
    return result;
  }

  /** The belote said so far (public once the first of the two cards is played). */
  get beloteSaid(): { seat: number; stage: number } | null {
    return this.beloteHolder !== null && this.beloteStage > 0 ? { seat: this.beloteHolder, stage: this.beloteStage } : null;
  }
}

function emptySeats<T>(): T[][] {
  return Array.from({ length: BELOTE_PLAYERS }, () => []);
}
