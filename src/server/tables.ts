/**
 * The games a room can run, behind one interface. The room handles seats, turns, timers and broadcasting; a
 * table game applies (and validates) actions, decides for bots, and shows each viewer what they may see.
 */
import { botContext, chooseBotMove } from '../shared/bot';
import { SUITS, type Suit, cardShort, suitSymbol } from '../shared/cards';
import { ChkobbaGame, type DealInfo, type Move, type PlayInfo, type RoundResult } from '../shared/chkobba';
import {
  BeloteGame,
  type BeloteDealInfo,
  type BelotePlayInfo,
  type BeloteRoundResult,
  type BeloteTakeInfo,
  type BeloteTrickInfo,
  type BidInfo,
  type DeclarationsResult,
  declarationName,
  illegalReason,
  publicDeclaration,
} from '../shared/belote';
import { beloteBotContext, chooseBeloteBid, chooseBeloteCard } from '../shared/beloteBot';
import type { BeloteView, BotLevelSetting, ChkobbaView, GameEvent, GameKind, GameView, RoomSettings } from '../shared/protocol';
import type { Team } from '../shared/teams';
import { RoomError } from './errors';
import { TIMING } from './timing';

export type InternalEvent =
  | { kind: 'gameStart' }
  | { kind: 'deal'; deal: DealInfo }
  | { kind: 'play'; play: PlayInfo; auto: boolean }
  | { kind: 'roundEnd'; result: RoundResult }
  | { kind: 'beloteDeal'; deal: BeloteDealInfo }
  | { kind: 'beloteBid'; bid: BidInfo; auto: boolean }
  | { kind: 'beloteTake'; take: BeloteTakeInfo }
  | { kind: 'belotePlay'; play: BelotePlayInfo; auto: boolean }
  | { kind: 'beloteTrick'; trick: BeloteTrickInfo; declarations: DeclarationsResult | null }
  | { kind: 'beloteEnd'; result: BeloteRoundResult };

/** What a player does: play a card, or (Belote) bid. Payloads are untrusted until the table checks them. */
export type Action = { type: 'play'; move: unknown } | { type: 'bid'; suit: unknown };

export interface HandEnd {
  round: number;
  points: [number, number];
  totals: [number, number];
  winner: Team | null;
}

export interface Outcome {
  events: InternalEvent[];
  /** Lines for the table chat. */
  messages: string[];
  /** Present when the action finished a hand. */
  handEnd?: HandEnd;
}

/** Who the table plays for: a bot, an away player (autopilot), or a player whose time ran out. */
export type AutoReason = 'bot' | 'autopilot' | 'timeout';

export interface Names {
  seat: (seat: number) => string;
  team: (team: Team) => string;
}

export interface TableGame {
  readonly kind: GameKind;
  readonly round: number;
  /** The seat the table waits for. */
  readonly turn: number;
  /** Deals the first or the next hand. */
  startRound(): InternalEvent[];
  /** Applies a player's action. Throws RoomError when it is not allowed. */
  act(seat: number, action: Action, auto: boolean, names: Names): Outcome;
  /** What the table does for a bot, an away player or a player out of time. */
  autoAction(seat: number, level: BotLevelSetting, rand: () => number, reason: AutoReason): Action;
  /** Something always allowed, should the bot fail. */
  fallbackAction(seat: number): Action;
  /** The game as `seat` sees it (null: a spectator); the room fills in its timers. */
  view(seat: number | null): GameView;
}

export function createTable(settings: RoomSettings, seats: number, rand: () => number): TableGame {
  return settings.game === 'belote' ? new BeloteTable(settings, rand) : new ChkobbaTable(settings, seats, rand);
}

// ───────────────────────────── Chkobba ─────────────────────────────

class ChkobbaTable implements TableGame {
  readonly kind = 'chkobba';
  readonly game: ChkobbaGame;
  private lastPlay: PlayInfo | null = null;

  constructor(settings: RoomSettings, seats: number, rand: () => number) {
    this.game = new ChkobbaGame({ numPlayers: seats === 4 ? 4 : 2, targetScore: settings.targetScore, rand });
  }

  get round() {
    return this.game.round;
  }

  get turn() {
    return this.game.turn;
  }

  startRound(): InternalEvent[] {
    this.lastPlay = null;
    return [{ kind: 'deal', deal: this.game.startRound() }];
  }

  act(seat: number, action: Action, auto: boolean, names: Names): Outcome {
    if (action.type !== 'play') throw new RoomError('There is no bidding in Chkobba.');
    const move = action.move as Partial<Move> | null;
    if (
      !move ||
      typeof move.cardId !== 'string' ||
      !Array.isArray(move.capture) ||
      move.capture.length > 20 ||
      !move.capture.every((x) => typeof x === 'string')
    ) {
      throw new RoomError('Invalid move.');
    }
    const clean: Move = { cardId: move.cardId, capture: [...move.capture] };
    if (!this.game.isLegal(seat, clean)) throw new RoomError('That move is not allowed.');
    const out = this.game.play(seat, clean);
    this.lastPlay = out.play;
    const events: InternalEvent[] = [{ kind: 'play', play: out.play, auto }];
    const messages: string[] = [];
    if (out.play.chkobba) messages.push(`🔥 ${names.seat(seat)} made a CHKOBBA with ${cardShort(out.play.card)}!`);
    if (out.deal) events.push({ kind: 'deal', deal: out.deal });
    if (!out.round) return { events, messages };
    events.push({ kind: 'roundEnd', result: out.round });
    const r = out.round;
    return { events, messages, handEnd: { round: r.round, points: r.points, totals: r.totals, winner: r.winner } };
  }

  autoAction(seat: number, level: BotLevelSetting, rand: () => number, reason: AutoReason): Action {
    return { type: 'play', move: chooseBotMove(botContext(this.game, seat), reason === 'bot' ? level : 'normal', rand) };
  }

  fallbackAction(seat: number): Action {
    return { type: 'play', move: this.game.legalMoves(seat)[0]! };
  }

  view(seat: number | null): ChkobbaView {
    const g = this.game;
    return {
      kind: 'chkobba',
      round: g.round,
      dealer: g.dealer,
      turn: g.turn,
      deckCount: g.deck.length,
      table: g.table,
      handCounts: g.hands.map((h) => h.length),
      myHand: seat === null ? null : g.hands[seat]!,
      pileCounts: g.piles.map((p) => p.length),
      chkobbaCards: g.chkobbaCards,
      scores: g.scores,
      lastCapturer: g.lastCapturer,
      lastPlay: this.lastPlay,
      lastRound: g.lastRound,
      winner: g.winner,
      turnDeadline: null,
      ready: [],
      nextRoundAt: null,
    };
  }
}

// ───────────────────────────── Belote ─────────────────────────────

function isSuit(v: unknown): v is Suit {
  return SUITS.includes(v as Suit);
}

class BeloteTable implements TableGame {
  readonly kind = 'belote';
  readonly game: BeloteGame;

  constructor(settings: RoomSettings, rand: () => number) {
    this.game = new BeloteGame({ targetScore: settings.targetScore, announcements: settings.announcements, rand });
  }

  get round() {
    return this.game.round;
  }

  get turn() {
    return this.game.turn;
  }

  startRound(): InternalEvent[] {
    return [{ kind: 'beloteDeal', deal: this.game.startRound() }];
  }

  act(seat: number, action: Action, auto: boolean, names: Names): Outcome {
    const g = this.game;
    if (action.type === 'bid') {
      if (g.phase !== 'bidding') throw new RoomError('The bidding is over.');
      const suit = action.suit === null ? null : isSuit(action.suit) ? action.suit : undefined;
      if (suit === undefined || !g.isLegalBid(seat, suit)) {
        throw new RoomError(g.bidRound === 1 ? 'Take the turned card’s suit, or pass.' : 'Name another suit, or pass.');
      }
      const out = g.bid(seat, suit);
      const events: InternalEvent[] = [{ kind: 'beloteBid', bid: out.bid, auto }];
      const messages: string[] = [];
      if (out.take) {
        events.push({ kind: 'beloteTake', take: out.take });
        messages.push(`🃏 ${names.seat(seat)} takes ${suitSymbol(out.take.trump)}${out.bid.round === 2 ? ' in the second round' : ''}.`);
      }
      if (out.redeal) {
        events.push({ kind: 'beloteDeal', deal: out.redeal });
        messages.push('Everybody passed — new deal.');
      }
      return { events, messages };
    }

    if (g.phase !== 'playing') throw new RoomError(g.phase === 'bidding' ? 'Take or pass first.' : 'No trick in progress.');
    const move = action.move as { cardId?: unknown } | null;
    if (!move || typeof move.cardId !== 'string') throw new RoomError('Invalid move.');
    if (!g.isLegalCard(seat, move.cardId)) {
      const hand = g.hands[seat]!;
      const card = hand.find((c) => c.id === move.cardId);
      throw new RoomError(card ? (illegalReason(hand, g.trick, g.trump!, seat, card) ?? 'That card is not allowed.') : 'That card is not in your hand.');
    }
    const out = g.play(seat, move.cardId);
    const events: InternalEvent[] = [{ kind: 'belotePlay', play: out.play, auto }];
    const messages: string[] = [];
    if (out.trick) events.push({ kind: 'beloteTrick', trick: out.trick, declarations: out.declarations ?? null });
    const d = out.declarations;
    if (d && d.team !== null) {
      const list = d.counted.map((x) => declarationName(x)).join(', ');
      messages.push(`📣 ${names.team(d.team)}: ${list} — +${d.points[d.team]} in announcements.`);
    }
    if (!out.round) return { events, messages };
    const r = out.round;
    events.push({ kind: 'beloteEnd', result: r });
    if (r.capot !== null) messages.push(`🎉 Capot! ${names.team(r.capot)} took every trick.`);
    if (r.outcome === 'dedans') messages.push(`💥 Dedans! ${names.seat(r.taker)} needed more than half the points.`);
    if (r.outcome === 'litige') messages.push(`⚖️ Litige: ${r.reserveOut} points wait for the winner of the next hand.`);
    if (r.reserveIn > 0 && r.reserveTo !== null) messages.push(`${names.team(r.reserveTo)} also win the ${r.reserveIn} points of the litige.`);
    return { events, messages, handEnd: { round: r.round, points: r.points, totals: r.totals, winner: r.winner } };
  }

  autoAction(seat: number, level: BotLevelSetting, rand: () => number, reason: AutoReason): Action {
    const g = this.game;
    const ctx = beloteBotContext(g, seat);
    const lvl = reason === 'bot' ? level : 'normal';
    // Nobody takes a contract on a player's behalf just because their time ran out.
    if (g.phase === 'bidding') return { type: 'bid', suit: reason === 'timeout' ? null : chooseBeloteBid(ctx, lvl, rand) };
    return { type: 'play', move: { cardId: chooseBeloteCard(ctx, lvl, rand) } };
  }

  fallbackAction(seat: number): Action {
    const g = this.game;
    return g.phase === 'bidding' ? { type: 'bid', suit: null } : { type: 'play', move: { cardId: g.legalCards(seat)[0]!.id } };
  }

  view(seat: number | null): BeloteView {
    const g = this.game;
    const last = g.tricks[g.tricks.length - 1];
    const firstTrick = g.tricks.length > 0 ? g.tricks[0]!.plays : g.trick;
    return {
      kind: 'belote',
      round: g.round,
      dealer: g.dealer,
      turn: g.turn,
      handCounts: g.hands.map((h) => h.length),
      pileCounts: g.piles.map((p) => p.length),
      scores: g.scores,
      winner: g.winner,
      turnDeadline: null,
      ready: [],
      nextRoundAt: null,
      stage: g.phase === 'bidding' ? 'bidding' : g.phase === 'playing' ? 'playing' : 'done',
      bidRound: g.bidRound,
      upCard: g.upCard,
      stockCount: g.stock.length,
      bids: g.bids,
      trump: g.trump,
      taker: g.taker,
      myHand: seat === null ? null : g.hands[seat]!,
      trick: g.trick,
      lastTrick: last ? { plays: last.plays, winner: last.winner } : null,
      tricksWon: [0, 1, 2, 3].map((s) => g.tricks.filter((t) => t.winner === s).length),
      belote: g.beloteSaid,
      declared: firstTrick.flatMap((p) => (g.declarations[p.seat] ?? []).map(publicDeclaration)),
      declResult: g.declResult,
      reserve: g.reserve,
      announcements: g.announcements,
      lastRound: g.lastRound,
    };
  }
}

// ───────────────────────────── events ─────────────────────────────

/** How long the clients take to animate an event (the room paces the table with it). */
export function eventDuration(ev: InternalEvent, numPlayers: number): number {
  switch (ev.kind) {
    case 'gameStart':
      return TIMING.gameStart;
    case 'deal':
      return (
        TIMING.dealBase +
        ev.deal.order.length * TIMING.dealPerCard +
        ev.deal.table.length * TIMING.dealTablePerCard +
        (ev.deal.initial ? TIMING.dealInitialExtra : 0)
      );
    case 'play':
      return (
        (ev.play.captured.length > 0 ? TIMING.playCapture : TIMING.playLay) +
        (ev.play.chkobba ? TIMING.chkobbaBonus : 0) +
        (numPlayers === 4 ? 0 : TIMING.twoPlayerExtra)
      );
    case 'roundEnd':
    case 'beloteEnd':
      return TIMING.roundEnd;
    case 'beloteDeal':
      // The previous hand is gathered first, then 20 cards are dealt and one turned up.
      return TIMING.dealBase + TIMING.dealInitialExtra + ev.deal.order.length * TIMING.dealPerCard + TIMING.beloteTurnUp;
    case 'beloteBid':
      return ev.bid.suit ? TIMING.beloteTake : TIMING.belotePass;
    case 'beloteTake':
      return TIMING.beloteTurnUp + ev.take.order.length * TIMING.dealPerCard + TIMING.dealBase / 2;
    case 'belotePlay':
      return TIMING.belotePlay;
    case 'beloteTrick':
      return TIMING.beloteTrick + (ev.declarations?.team != null ? TIMING.beloteDeclarations : 0);
  }
}

/** An event as `seat` sees it (null: a spectator): only their own new cards. */
export function personalizeEvent(ev: InternalEvent, seat: number | null): GameEvent {
  switch (ev.kind) {
    case 'gameStart':
      return { kind: 'gameStart' };
    case 'deal': {
      const d = ev.deal;
      return {
        kind: 'deal',
        round: d.round,
        dealer: d.dealer,
        initial: d.initial,
        order: d.order,
        table: d.table,
        myCards: seat === null ? null : d.hands[seat]!,
        redeals: d.redeals,
        deckCountAfter: d.deckCountAfter,
      };
    }
    case 'play':
      return { kind: 'play', play: ev.play, auto: ev.auto };
    case 'roundEnd':
      return { kind: 'roundEnd', result: ev.result };
    case 'beloteDeal': {
      const d = ev.deal;
      return {
        kind: 'beloteDeal',
        round: d.round,
        dealer: d.dealer,
        order: d.order,
        myCards: seat === null ? null : d.hands[seat]!,
        turned: d.turned,
        stockAfter: d.stockAfter,
        redeals: d.redeals,
      };
    }
    case 'beloteBid':
      return { kind: 'beloteBid', bid: ev.bid, auto: ev.auto };
    case 'beloteTake': {
      const t = ev.take;
      return { kind: 'beloteTake', taker: t.taker, trump: t.trump, turned: t.turned, order: t.order, myCards: seat === null ? null : t.hands[seat]! };
    }
    case 'belotePlay': {
      const p = ev.play;
      return { kind: 'belotePlay', seat: p.seat, card: p.card, belote: p.belote, declared: p.declarations.map(publicDeclaration), auto: ev.auto };
    }
    case 'beloteTrick':
      return { kind: 'beloteTrick', trick: ev.trick, declResult: ev.declarations };
    case 'beloteEnd':
      return { kind: 'beloteEnd', result: ev.result };
  }
}
