/**
 * Belote rules engine (authoritative on the server; the client and the bots use its helpers too).
 *
 * Classic Belote, the French game played in Tunisian cafés (see pagat.com "Belote"):
 *  - 32 cards (7 to Ace in four suits); 4 players in two partnerships, partners sitting opposite
 *    (seats 0 & 2 against 1 & 3). Play goes anticlockwise (seat + 1 is the player on the right) and the
 *    deal passes to the right.
 *  - The dealer gives 3 then 2 cards to each player, starting on their right, and turns the next card up.
 *  - Bidding, first round: starting on the dealer's right, each player may take the turned card's suit as
 *    trumps, or pass. Second round (everybody passed): each may name one of the other suits, or pass. If all
 *    four pass again, the next dealer deals new cards.
 *  - The taker picks up the turned card, then the dealer gives 2 more cards to the taker and 3 to everyone
 *    else: 8 cards each. The player on the dealer's right leads the first trick; a trick's winner leads next.
 *  - You must follow suit; when trumps are led you must beat the best trump in the trick if you can. When
 *    you cannot follow suit: if your partner is winning the trick you may play anything; otherwise you must
 *    trump, beating any trump already played if you can (if you cannot, any trump will do).
 *  - Trumps rank J 9 A 10 K Q 8 7 and score 20 14 11 10 4 3 0 0; the other suits rank A 10 K Q J 9 8 7 and
 *    score 11 10 4 3 2 0 0 0. With 10 for the last trick ("dix de der") a hand is worth 162.
 *  - Belote: whoever holds the King and Queen of trumps says "Belote" and "Rebelote" as they play them: 20.
 *  - Announcements (a table option): runs of 3 (tierce, 20), 4 (cinquante, 50) or 5+ (cent, 100) cards of a
 *    suit, and four of a kind (carré: jacks 200, nines 150, aces, tens, kings or queens 100), declared with
 *    each player's first card. Only the team with the best announcement scores, all of theirs.
 *  - The takers must score more than the defenders, belote and announcements included. Then both teams score
 *    what they made. If not ("dedans"), the defenders score 162 plus every announcement. On a tie ("litige")
 *    the defenders score theirs and the takers' points wait for whoever wins the next hand. A team taking all
 *    eight tricks (capot) makes 250 instead of 162. Belote always stays with the team that holds it.
 *  - The game ends after a hand in which a team reaches the target (501 by default); the higher total wins,
 *    and a tie plays another hand.
 */
import { SUITS, type Suit, shuffle, suitSymbol } from './cards';
import { type Team, teamOf } from './teams';

export type BRank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

/** Ranks in sequence order, as runs are counted: 7 8 9 10 J Q K A. */
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
export const BELOTE_TARGETS = [501, 701, 1001] as const;
export const HAND_POINTS = 162;
export const CAPOT_POINTS = 250;
export const BELOTE_POINTS = 20;
export const LAST_TRICK_BONUS = 10;

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
const SEQ_INDEX: Readonly<Record<BRank, number>> = { '7': 0, '8': 1, '9': 2, '10': 3, J: 4, Q: 5, K: 6, A: 7 };

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
  // Partner winning: no obligation to trump.
  if (teamOf(trickWinner(trick, trump).seat) === teamOf(seat)) return [...hand];
  const over = trumps.filter((c) => cardStrength(c, trump) > topTrump);
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

// ───────────────────────────── announcements ─────────────────────────────

export type DeclKind = 'tierce' | 'cinquante' | 'cent' | 'carre';

export interface Declaration {
  seat: number;
  kind: DeclKind;
  /** Top card of a run, or the rank of a carré. */
  rank: BRank;
  /** Suit of a run (null for a carré). */
  suit: Suit | null;
  /** Number of cards: 3–8 for a run, 4 for a carré. */
  length: number;
  points: number;
  cards: BCard[];
}

/**
 * An announcement as the table hears it when it is made: what it is and what it is worth (a carré's rank is
 * said with it). Its cards are only shown if it counts, after the first trick.
 */
export interface PublicDeclaration {
  seat: number;
  kind: DeclKind;
  points: number;
  /** The rank of a carré (null for a run). */
  rank: BRank | null;
}

export function publicDeclaration(d: Declaration): PublicDeclaration {
  return { seat: d.seat, kind: d.kind, points: d.points, rank: d.kind === 'carre' ? d.rank : null };
}

const CARRE_POINTS: Readonly<Partial<Record<BRank, number>>> = { J: 200, '9': 150, A: 100, '10': 100, K: 100, Q: 100 };
/** Among carrés worth the same: aces, then tens, kings and queens. */
const CARRE_ORDER: Readonly<Record<BRank, number>> = { '7': 0, '8': 1, Q: 2, K: 3, '10': 4, A: 5, '9': 6, J: 7 };

export function declarationName(d: { kind: DeclKind; rank: BRank | null }): string {
  if (d.kind !== 'carre') return d.kind === 'tierce' ? 'Tierce' : d.kind === 'cinquante' ? 'Cinquante' : 'Cent';
  const names: Record<BRank, string> = { J: 'jacks', '9': 'nines', A: 'aces', '10': 'tens', K: 'kings', Q: 'queens', '8': 'eights', '7': 'sevens' };
  return d.rank ? `Carré of ${names[d.rank]}` : 'Carré';
}

/** Every announcement in a hand: four of a kind (J, 9, A, 10, K, Q) and runs of 3+ cards of a suit. */
export function findDeclarations(hand: readonly BCard[], seat: number): Declaration[] {
  const out: Declaration[] = [];
  for (const rank of ['J', '9', 'A', '10', 'K', 'Q'] as const) {
    const four = hand.filter((c) => c.rank === rank);
    if (four.length === 4) out.push({ seat, kind: 'carre', rank, suit: null, length: 4, points: CARRE_POINTS[rank]!, cards: four });
  }
  for (const suit of SUITS) {
    const cards = hand.filter((c) => c.suit === suit).sort((a, b) => SEQ_INDEX[a.rank] - SEQ_INDEX[b.rank]);
    let start = 0;
    for (let i = 1; i <= cards.length; i++) {
      if (i < cards.length && SEQ_INDEX[cards[i]!.rank] === SEQ_INDEX[cards[i - 1]!.rank] + 1) continue;
      const len = i - start;
      if (len >= 3) {
        const kind: DeclKind = len >= 5 ? 'cent' : len === 4 ? 'cinquante' : 'tierce';
        const points = len >= 5 ? 100 : len === 4 ? 50 : 20;
        out.push({ seat, kind, rank: cards[i - 1]!.rank, suit, length: len, points, cards: cards.slice(start, i) });
      }
      start = i;
    }
  }
  return out.sort((a, b) => compareDeclarations(b, a, null));
}

/**
 * Orders announcements (> 0 when `a` is the better one): more points; at equal points a carré beats a run;
 * then the longer run, the higher top card (the higher carré), and a run in trumps beats one in another suit.
 */
export function compareDeclarations(a: Declaration, b: Declaration, trump: Suit | null): number {
  if (a.points !== b.points) return a.points - b.points;
  const carre = (a.kind === 'carre' ? 1 : 0) - (b.kind === 'carre' ? 1 : 0);
  if (carre !== 0) return carre;
  if (a.kind === 'carre') return CARRE_ORDER[a.rank] - CARRE_ORDER[b.rank];
  if (a.length !== b.length) return a.length - b.length;
  const high = SEQ_INDEX[a.rank] - SEQ_INDEX[b.rank];
  if (high !== 0) return high;
  return (a.suit === trump ? 1 : 0) - (b.suit === trump ? 1 : 0);
}

export interface DeclarationsResult {
  /** The team whose announcements count (null: none, or two equal best ones). */
  team: Team | null;
  points: [number, number];
  /** The announcements that count (all of that team's). */
  counted: Declaration[];
}

/** After the first trick: only the team with the best announcement scores, and it scores all of them. */
export function resolveDeclarations(perSeat: readonly (readonly Declaration[])[], trump: Suit): DeclarationsResult {
  const best: (Declaration | null)[] = [null, null];
  for (const list of perSeat) {
    for (const d of list) {
      const t = teamOf(d.seat);
      if (!best[t] || compareDeclarations(d, best[t]!, trump) > 0) best[t] = d;
    }
  }
  let team: Team | null = null;
  if (best[0] && best[1]) {
    const cmp = compareDeclarations(best[0], best[1], trump);
    team = cmp > 0 ? 0 : cmp < 0 ? 1 : null;
  } else if (best[0]) team = 0;
  else if (best[1]) team = 1;
  const points: [number, number] = [0, 0];
  const counted: Declaration[] = [];
  if (team !== null) {
    for (const list of perSeat) {
      for (const d of list) {
        if (teamOf(d.seat) !== team) continue;
        counted.push(d);
        points[team] += d.points;
      }
    }
  }
  return { team, points, counted };
}

// ───────────────────────────── game ─────────────────────────────

export type BelotePhase = 'bidding' | 'playing' | 'roundOver' | 'gameOver';

export interface BeloteOptions {
  targetScore: number;
  /** Count tierces, cinquantes, cents and carrés (default true). */
  announcements?: boolean;
  /** Seat of the first dealer. Defaults to a random seat. */
  firstDealer?: number;
  /** Uniform [0,1) random source used for shuffling. */
  rand: () => number;
}

export interface BidInfo {
  seat: number;
  round: 1 | 2;
  /** The trump suit taken, or null for a pass. */
  suit: Suit | null;
}

export interface BeloteDealInfo {
  round: number;
  dealer: number;
  /** Seats in the order they received cards: 3 each, then 2 each. */
  order: number[];
  /** Cards dealt to each seat (5 each). */
  hands: BCard[][];
  /** The card turned face up. */
  turned: BCard;
  /** Face-down cards left after the turn-up (11). */
  stockAfter: number;
  /** How many times everybody passed twice before this deal, in this hand. */
  redeals: number;
}

export interface BeloteTakeInfo {
  taker: number;
  trump: Suit;
  /** The turned card, now in the taker's hand. */
  turned: BCard;
  /** Seats in the order they receive the remaining cards (2 for the taker, 3 for the others). */
  order: number[];
  /** Cards dealt to each seat in this distribution (the turned card not included). */
  hands: BCard[][];
}

export interface BelotePlayInfo {
  seat: number;
  card: BCard;
  /** Said with the King or Queen of trumps by the player holding both. */
  belote: 'belote' | 'rebelote' | null;
  /** Announcements declared with this card (a player's first card of the hand). */
  declarations: Declaration[];
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

export interface BeloteRoundResult {
  round: number;
  taker: number;
  trump: Suit;
  tricks: [number, number];
  /** Card points per team, the 10 for the last trick included (250 for a capot, 0 for the other team). */
  cardPoints: [number, number];
  lastTrick: number;
  capot: Team | null;
  /** Team holding the King and Queen of trumps (20 points). */
  belote: Team | null;
  declarations: DeclarationsResult;
  /** What each team made: cards + belote + announcements. */
  made: [number, number];
  outcome: 'made' | 'dedans' | 'litige';
  /** Points scored this hand by each team (contract and held-over points applied). */
  points: [number, number];
  /** Points held over from an earlier litige, won this hand by `reserveTo`. */
  reserveIn: number;
  reserveTo: Team | null;
  /** Points held over by this hand's litige, for the winner of the next hand. */
  reserveOut: number;
  /** Cumulative totals after this hand. */
  totals: [number, number];
  /** Winning team if the game is over after this hand. */
  winner: Team | null;
}

export interface BidOutcome {
  bid: BidInfo;
  /** Present when the bid took the contract: the rest of the cards are dealt. */
  take?: BeloteTakeInfo;
  /** Present when everybody passed twice: the next dealer deals again. */
  redeal?: BeloteDealInfo;
}

export interface BelotePlayOutcome {
  play: BelotePlayInfo;
  /** Present when the card completed a trick. */
  trick?: BeloteTrickInfo;
  /** Present after the first trick (with announcements on): which team's announcements count. */
  declarations?: DeclarationsResult;
  /** Present when the card ended the hand. */
  round?: BeloteRoundResult;
}

export class BeloteGame {
  readonly numPlayers = BELOTE_PLAYERS;
  readonly targetScore: number;
  readonly announcements: boolean;
  private readonly rand: () => number;

  /** Face-down cards still to deal (11 during the bidding). */
  stock: BCard[] = [];
  hands: BCard[][] = emptySeats();
  /** The card turned up for the bidding (null once someone took it). */
  turned: BCard | null = null;
  /** The card turned up in this deal: after the take everybody knows the taker holds it until it is played. */
  upCard: BCard | null = null;
  phase: BelotePhase = 'bidding';
  /** Number of the current hand (a redeal does not count as a hand). */
  round = 0;
  dealer: number;
  turn = 0;
  bidRound: 1 | 2 = 1;
  /** Bids of the current deal, in order. */
  bids: BidInfo[] = [];
  /** Times everybody passed twice in the current hand. */
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
  /** Each seat's announcements this hand (private until their first card). */
  declarations: Declaration[][] = emptySeats();
  /** Which announcements count, once the first trick is over. */
  declResult: DeclarationsResult | null = null;
  scores: [number, number] = [0, 0];
  /** Points held over by a litige, for the winner of the next hand. */
  reserve = 0;
  lastRound: BeloteRoundResult | null = null;
  winner: Team | null = null;

  constructor(opts: BeloteOptions) {
    this.targetScore = opts.targetScore;
    this.announcements = opts.announcements ?? true;
    this.rand = opts.rand;
    const first = opts.firstDealer ?? Math.floor(this.rand() * BELOTE_PLAYERS);
    // deal() advances the dealer, so start one seat "before" the requested first dealer.
    this.dealer = (first - 1 + BELOTE_PLAYERS) % BELOTE_PLAYERS;
  }

  nextSeat(seat: number): number {
    return (seat + 1) % BELOTE_PLAYERS;
  }

  /** Starts a new hand: the deal passes to the right, and 5 cards each are dealt with one turned up. */
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
    this.declarations = emptySeats();
    this.declResult = null;
    this.trump = null;
    this.taker = null;
    this.trick = [];
    this.tricks = [];
    this.bids = [];
    this.bidRound = 1;
    this.beloteHolder = null;
    this.beloteStage = 0;
    const deck = shuffle(makeBeloteDeck(), this.rand);
    const order: number[] = [];
    for (const lap of [3, 2]) {
      for (let i = 1; i <= BELOTE_PLAYERS; i++) {
        const seat = (this.dealer + i) % BELOTE_PLAYERS;
        for (let k = 0; k < lap; k++) {
          this.hands[seat]!.push(deck.pop()!);
          order.push(seat);
        }
      }
    }
    this.turned = deck.pop()!;
    this.upCard = this.turned;
    this.stock = deck;
    this.phase = 'bidding';
    this.turn = this.nextSeat(this.dealer);
    this.leader = this.turn;
    return {
      round: this.round,
      dealer: this.dealer,
      order,
      hands: this.hands.map((h) => [...h]),
      turned: this.turned,
      stockAfter: this.stock.length,
      redeals: this.redeals,
    };
  }

  isLegalBid(seat: number, suit: Suit | null): boolean {
    if (this.phase !== 'bidding' || seat !== this.turn || !this.turned) return false;
    if (suit === null) return true;
    if (!SUITS.includes(suit)) return false;
    return this.bidRound === 1 ? suit === this.turned.suit : suit !== this.turned.suit;
  }

  /** A bid: the trump suit to take, or null to pass. Throws on illegal bids. */
  bid(seat: number, suit: Suit | null): BidOutcome {
    if (this.phase !== 'bidding') throw new Error('No bidding in progress');
    if (seat !== this.turn) throw new Error('Not your turn');
    if (!this.isLegalBid(seat, suit)) throw new Error('Illegal bid');
    const bid: BidInfo = { seat, round: this.bidRound, suit };
    this.bids.push(bid);
    if (suit !== null) return { bid, take: this.take(seat, suit) };
    const passes = this.bids.filter((b) => b.round === this.bidRound).length;
    if (passes < BELOTE_PLAYERS) {
      this.turn = this.nextSeat(seat);
      return { bid };
    }
    if (this.bidRound === 1) {
      this.bidRound = 2;
      this.turn = this.nextSeat(this.dealer);
      return { bid };
    }
    // Nobody wants it: the next dealer deals new cards.
    this.redeals += 1;
    return { bid, redeal: this.deal() };
  }

  private take(seat: number, suit: Suit): BeloteTakeInfo {
    const turned = this.turned!;
    this.taker = seat;
    this.trump = suit;
    this.turned = null;
    this.hands[seat]!.push(turned);
    const order: number[] = [];
    const dealt: BCard[][] = emptySeats();
    for (let i = 1; i <= BELOTE_PLAYERS; i++) {
      const s = (this.dealer + i) % BELOTE_PLAYERS;
      for (let k = 0; k < (s === seat ? 2 : 3); k++) {
        const card = this.stock.pop();
        if (!card) throw new Error('Stock exhausted while dealing');
        this.hands[s]!.push(card);
        dealt[s]!.push(card);
        order.push(s);
      }
    }
    for (let s = 0; s < BELOTE_PLAYERS; s++) {
      const h = this.hands[s]!;
      if (h.some((c) => c.suit === suit && c.rank === 'K') && h.some((c) => c.suit === suit && c.rank === 'Q')) this.beloteHolder = s;
    }
    this.declarations = this.announcements ? this.hands.map((h, s) => findDeclarations(h, s)) : emptySeats();
    this.phase = 'playing';
    this.turn = this.nextSeat(this.dealer);
    this.leader = this.turn;
    return { taker: seat, trump: suit, turned, order, hands: dealt };
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
    const declarations = this.tricks.length === 0 ? [...this.declarations[seat]!] : [];
    this.trick.push({ seat, card });
    const out: BelotePlayOutcome = { play: { seat, card, belote, declarations } };
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
    if (trick.index === 0 && this.announcements) {
      this.declResult = resolveDeclarations(this.declarations, trump);
      out.declarations = this.declResult;
    }
    if (last) out.round = this.finishRound();
    return out;
  }

  private finishRound(): BeloteRoundResult {
    const scored = scoreBeloteHand({
      taker: this.taker!,
      tricks: this.tricks,
      belote: this.beloteHolder === null ? null : teamOf(this.beloteHolder),
      declarations: this.declResult ?? { team: null, points: [0, 0], counted: [] },
      reserve: this.reserve,
    });
    // A litige adds to the held-over points; any other outcome hands them out.
    this.reserve = scored.outcome === 'litige' ? this.reserve + scored.reserveOut : 0;
    this.scores = [this.scores[0] + scored.points[0], this.scores[1] + scored.points[1]];
    const [a, b] = this.scores;
    let winner: Team | null = null;
    if ((a >= this.targetScore || b >= this.targetScore) && a !== b) winner = a > b ? 0 : 1;
    this.winner = winner;
    this.phase = winner === null ? 'roundOver' : 'gameOver';
    const result: BeloteRoundResult = {
      round: this.round,
      trump: this.trump!,
      lastTrick: this.tricks[this.tricks.length - 1]!.winner,
      ...scored,
      totals: [a, b],
      winner,
    };
    this.lastRound = result;
    return result;
  }

  /** The belote announcement so far (public once the first of the two cards is played). */
  get beloteSaid(): { seat: number; stage: number } | null {
    return this.beloteHolder !== null && this.beloteStage > 0 ? { seat: this.beloteHolder, stage: this.beloteStage } : null;
  }
}

export interface HandScoreInput {
  taker: number;
  /** The hand's eight tricks (their points include the 10 for the last one). */
  tricks: readonly Pick<BeloteTrickInfo, 'winner' | 'points'>[];
  /** Team holding the King and Queen of trumps. */
  belote: Team | null;
  declarations: DeclarationsResult;
  /** Points held over by an earlier litige. */
  reserve: number;
}

export type HandScore = Pick<
  BeloteRoundResult,
  'taker' | 'tricks' | 'cardPoints' | 'capot' | 'belote' | 'declarations' | 'made' | 'outcome' | 'points' | 'reserveIn' | 'reserveTo' | 'reserveOut'
>;

/** Applies the contract to a finished hand: what each team scores, and what is held over. */
export function scoreBeloteHand(input: HandScoreInput): HandScore {
  const { taker, belote, declarations, reserve } = input;
  const takers = teamOf(taker);
  const defenders: Team = takers === 0 ? 1 : 0;
  const tricks: [number, number] = [0, 0];
  const cardPoints: [number, number] = [0, 0];
  for (const t of input.tricks) {
    tricks[teamOf(t.winner)] += 1;
    cardPoints[teamOf(t.winner)] += t.points;
  }
  const capot: Team | null = tricks[1] === 0 && tricks[0] > 0 ? 0 : tricks[0] === 0 && tricks[1] > 0 ? 1 : null;
  if (capot !== null) {
    cardPoints[capot] = CAPOT_POINTS;
    cardPoints[capot === 0 ? 1 : 0] = 0;
  }
  const belotePts: [number, number] = [0, 0];
  if (belote !== null) belotePts[belote] = BELOTE_POINTS;
  const made: [number, number] = [
    cardPoints[0] + belotePts[0] + declarations.points[0],
    cardPoints[1] + belotePts[1] + declarations.points[1],
  ];

  const points: [number, number] = [0, 0];
  let outcome: BeloteRoundResult['outcome'];
  let reserveOut = 0;
  if (made[takers] > made[defenders]) {
    outcome = 'made';
    points[0] = made[0];
    points[1] = made[1];
  } else if (made[takers] < made[defenders]) {
    outcome = 'dedans';
    const cards = capot === defenders ? CAPOT_POINTS : HAND_POINTS;
    points[defenders] = cards + declarations.points[0] + declarations.points[1] + belotePts[defenders];
    points[takers] = belotePts[takers];
  } else {
    outcome = 'litige';
    points[defenders] = made[defenders];
    points[takers] = belotePts[takers];
    reserveOut = made[takers] - belotePts[takers];
  }
  // Points held over by an earlier litige go to whoever wins this hand (another litige keeps them waiting).
  let reserveIn = 0;
  let reserveTo: Team | null = null;
  if (outcome !== 'litige' && reserve > 0) {
    reserveIn = reserve;
    reserveTo = outcome === 'made' ? takers : defenders;
    points[reserveTo] += reserve;
  }
  return { taker, tricks, cardPoints, capot, belote, declarations, made, outcome, points, reserveIn, reserveTo, reserveOut };
}

function emptySeats<T>(): T[][] {
  return Array.from({ length: BELOTE_PLAYERS }, () => []);
}
