/**
 * The games a room can run, behind one interface. The room handles seats, turns, timers and broadcasting; a
 * table game applies (and validates) actions, decides for bots, and shows each viewer what they may see.
 */
import { botContext, chooseBotMove } from '../shared/bot';
import { cardShort } from '../shared/cards';
import { ChkobbaGame, type DealInfo, type Move, type PlayInfo, type RoundResult } from '../shared/chkobba';
import {
  type AuctionAction,
  type AuctionCall,
  BeloteGame,
  type BeloteDealInfo,
  type BelotePlayInfo,
  type BeloteRoundResult,
  type BeloteTrickInfo,
  type ContractInfo,
  contractLabel,
  illegalReason,
  parseCall,
} from '../shared/belote';
import { beloteBotContext, chooseBeloteCall, chooseBeloteCard } from '../shared/beloteBot';
import type { BeloteView, BotLevelSetting, ChkobbaView, GameEvent, GameKind, GameView, RoomSettings } from '../shared/protocol';
import { type Team, teamOf } from '../shared/teams';
import { RoomError } from './errors';
import { TIMING } from './timing';

export type InternalEvent =
  | { kind: 'gameStart' }
  | { kind: 'deal'; deal: DealInfo }
  | { kind: 'play'; play: PlayInfo; auto: boolean }
  | { kind: 'roundEnd'; result: RoundResult }
  | { kind: 'beloteDeal'; deal: BeloteDealInfo }
  | { kind: 'beloteBid'; action: AuctionAction; auto: boolean }
  | { kind: 'beloteContract'; info: ContractInfo }
  | { kind: 'belotePlay'; play: BelotePlayInfo; auto: boolean }
  | { kind: 'beloteTrick'; trick: BeloteTrickInfo }
  | { kind: 'beloteEnd'; result: BeloteRoundResult };

/** What a player does: play a card, or (Belote) make a call in the auction. Untrusted until the table checks it. */
export type Action = { type: 'play'; move: unknown } | { type: 'bid'; call: unknown };

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

const PASS: AuctionCall = { type: 'pass' };

/** Why a call (`raw`, parsed as `call`) is refused; the seat is the one to speak. */
function callError(g: BeloteGame, seat: number, raw: unknown, call: AuctionCall | null): string {
  const o = g.options(seat);
  if (g.coinche > 1) return 'After a contre, the takers may only surcontre or pass.';
  const type = call?.type ?? (raw as { type?: unknown } | null)?.type;
  switch (type) {
    case 'contre':
      return g.contract ? 'Only the other team can say contre.' : 'There is no bid to contre yet.';
    case 'surcontre':
      return 'Surcontre answers a contre.';
    case 'bid':
      if (o.minBid !== null) return `Bid at least ${o.minBid}, or pass.`;
      return o.kabbout ? 'Only Kabbout is higher now.' : 'Nothing is higher than Kabbout.';
    default:
      return 'That is not a call.';
  }
}

/** The contract as the chat tells it. */
function contractText(info: ContractInfo): string {
  return `${contractLabel(info.contract)}${info.coinche === 4 ? ' — surcontré ×4' : info.coinche === 2 ? ' — contré ×2' : ''}`;
}

/** The chat line for a hand that did not simply go as bid (null: nothing special). */
function handMessage(r: BeloteRoundResult, names: Names): string | null {
  const takers = teamOf(r.contract.seat);
  const defence = takers === 0 ? 1 : 0;
  const taker = names.seat(r.contract.seat);
  if (r.contract.value === 'kabbout') {
    return r.outcome === 'made'
      ? `🎉 Kabbout! ${names.team(takers)} took every trick: +${r.points[takers]}.`
      : `💥 Kabbout lost — ${names.team(defence)} score ${r.points[defence]}.`;
  }
  if (r.outcome === 'failed') {
    const how = r.early ? `can no longer make ${r.contract.value}, the cards are thrown in` : `missed ${r.contract.value}`;
    return `💥 Chute! ${taker} ${how}: ${names.team(defence)} score ${r.points[defence]}.`;
  }
  if (r.capot === takers) return `🎉 Capot! ${names.team(takers)} took every trick: +${r.points[takers]}.`;
  return null;
}

class BeloteTable implements TableGame {
  readonly kind = 'belote';
  readonly game: BeloteGame;

  constructor(settings: RoomSettings, rand: () => number) {
    this.game = new BeloteGame({ targetScore: settings.targetScore, rand });
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
      const call = parseCall(action.call);
      if (!call || !g.isLegalCall(seat, call)) throw new RoomError(callError(g, seat, action.call, call));
      const out = g.call(seat, call);
      const events: InternalEvent[] = [{ kind: 'beloteBid', action: out.action, auto }];
      const messages: string[] = [];
      if (out.contract) {
        events.push({ kind: 'beloteContract', info: out.contract });
        messages.push(`🃏 ${names.seat(out.contract.contract.seat)} plays ${contractText(out.contract)}.`);
      }
      if (out.redeal) {
        events.push({ kind: 'beloteDeal', deal: out.redeal });
        messages.push('Everybody passed — new deal.');
      }
      return { events, messages };
    }

    if (g.phase !== 'playing') throw new RoomError(g.phase === 'bidding' ? 'The auction is not over yet.' : 'No trick in progress.');
    const move = action.move as { cardId?: unknown } | null;
    if (!move || typeof move.cardId !== 'string') throw new RoomError('Invalid move.');
    if (!g.isLegalCard(seat, move.cardId)) {
      const hand = g.hands[seat]!;
      const card = hand.find((c) => c.id === move.cardId);
      throw new RoomError(card ? (illegalReason(hand, g.trick, g.trump!, seat, card) ?? 'That card is not allowed.') : 'That card is not in your hand.');
    }
    const out = g.play(seat, move.cardId);
    const events: InternalEvent[] = [{ kind: 'belotePlay', play: out.play, auto }];
    if (out.trick) events.push({ kind: 'beloteTrick', trick: out.trick });
    if (!out.round) return { events, messages: [] };
    const r = out.round;
    events.push({ kind: 'beloteEnd', result: r });
    const line = handMessage(r, names);
    return { events, messages: line ? [line] : [], handEnd: { round: r.round, points: r.points, totals: r.totals, winner: r.winner } };
  }

  autoAction(seat: number, level: BotLevelSetting, rand: () => number, reason: AutoReason): Action {
    const g = this.game;
    const ctx = beloteBotContext(g, seat);
    const lvl = reason === 'bot' ? level : 'normal';
    // Nobody bids on a player's behalf just because their time ran out.
    if (g.phase === 'bidding') return { type: 'bid', call: reason === 'timeout' ? PASS : chooseBeloteCall(ctx, lvl, rand) };
    return { type: 'play', move: { cardId: chooseBeloteCard(ctx, lvl, rand) } };
  }

  fallbackAction(seat: number): Action {
    const g = this.game;
    return g.phase === 'bidding' ? { type: 'bid', call: PASS } : { type: 'play', move: { cardId: g.legalCards(seat)[0]!.id } };
  }

  view(seat: number | null): BeloteView {
    const g = this.game;
    const last = g.tricks[g.tricks.length - 1];
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
      auction: g.auction,
      contract: g.contract,
      coinche: g.coinche,
      coincheBy: g.coincheBy,
      trump: g.trump,
      taker: g.taker,
      myHand: seat === null ? null : g.hands[seat]!,
      trick: g.trick,
      lastTrick: last ? { plays: last.plays, winner: last.winner } : null,
      tricksWon: [0, 1, 2, 3].map((s) => g.tricks.filter((t) => t.winner === s).length),
      belote: g.beloteSaid,
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
      // The previous hand is gathered first, then the 32 cards go out 4 at a time.
      return TIMING.dealBase + TIMING.dealInitialExtra + (ev.deal.order.length / 4) * TIMING.beloteDealLot;
    case 'beloteBid':
      return ev.action.call.type === 'pass' ? TIMING.belotePass : TIMING.beloteBid;
    case 'beloteContract':
      return TIMING.beloteContract;
    case 'belotePlay':
      return TIMING.belotePlay;
    case 'beloteTrick':
      return TIMING.beloteTrick;
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
        redeals: d.redeals,
      };
    }
    case 'beloteBid':
      return { kind: 'beloteBid', action: ev.action, auto: ev.auto };
    case 'beloteContract':
      return { kind: 'beloteContract', contract: ev.info.contract, coinche: ev.info.coinche, coincheBy: ev.info.coincheBy };
    case 'belotePlay': {
      const p = ev.play;
      return { kind: 'belotePlay', seat: p.seat, card: p.card, belote: p.belote, auto: ev.auto };
    }
    case 'beloteTrick':
      return { kind: 'beloteTrick', trick: ev.trick };
    case 'beloteEnd':
      return { kind: 'beloteEnd', result: ev.result };
  }
}
