/**
 * The 40-card Tunisian pack: a French-suited deck without 8s, 9s and 10s.
 * In Chkobba the figures are worth: Queen (Dame) = 8, Jack (Valet) = 9, King (Roi) = 10.
 */

export type Suit = 'D' | 'H' | 'C' | 'S';
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const SUITS: readonly Suit[] = ['D', 'H', 'C', 'S'];
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface Card {
  /** Stable identifier, e.g. "7D" (seven of diamonds) or "10S" (king of spades). */
  id: string;
  suit: Suit;
  rank: Rank;
}

export const QUEEN: Rank = 8;
export const JACK: Rank = 9;
export const KING: Rank = 10;

export function cardId(rank: Rank, suit: Suit): string {
  return `${rank}${suit}`;
}

const CARD_ID_RE = /^(10|[1-9])([DHCS])$/;

export function isCardId(id: unknown): id is string {
  return typeof id === 'string' && CARD_ID_RE.test(id);
}

export function parseCard(id: string): Card {
  const m = CARD_ID_RE.exec(id);
  if (!m) throw new Error(`Invalid card id: ${id}`);
  return { id, rank: Number(m[1]) as Rank, suit: m[2] as Suit };
}

export function makeCard(rank: Rank, suit: Suit): Card {
  return { id: cardId(rank, suit), rank, suit };
}

/** A fresh, ordered 40-card deck. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(makeCard(rank, suit));
  return deck;
}

/** In-place Fisher–Yates shuffle using the provided uniform [0,1) generator. */
export function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Short label printed in the card corner. */
export function rankLabel(rank: Rank): string {
  switch (rank) {
    case 1:
      return 'A';
    case 8:
      return 'Q';
    case 9:
      return 'J';
    case 10:
      return 'K';
    default:
      return String(rank);
  }
}

export function rankName(rank: Rank): string {
  switch (rank) {
    case 1:
      return 'Ace';
    case 8:
      return 'Queen';
    case 9:
      return 'Jack';
    case 10:
      return 'King';
    default:
      return String(rank);
  }
}

export function suitName(suit: Suit): string {
  return { D: 'Diamonds', H: 'Hearts', C: 'Clubs', S: 'Spades' }[suit];
}

export function suitSymbol(suit: Suit): string {
  return { D: '♦', H: '♥', C: '♣', S: '♠' }[suit];
}

export function isRed(suit: Suit): boolean {
  return suit === 'D' || suit === 'H';
}

export function cardName(card: Card): string {
  return `${rankName(card.rank)} of ${suitName(card.suit)}`;
}

/** Compact human label such as "7♦" or "Q♠". */
export function cardShort(card: Card): string {
  return `${rankLabel(card.rank)}${suitSymbol(card.suit)}`;
}

/** Deterministic PRNG (mulberry32) — handy for tests, simulations and bots. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
