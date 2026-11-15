import type { Server, Socket } from 'socket.io';
import { cardShort } from '../shared/cards';
import {
  ChkobbaGame,
  type DealInfo,
  type Move,
  type PlayInfo,
  type RoundResult,
  teamOf,
} from '../shared/chkobba';
import { botContext, chooseBotMove } from '../shared/bot';
import {
  AVATAR_COLORS,
  BOT_LEVELS,
  CHAT_MAX,
  type ChatMessage,
  type ClientToServer,
  EMOTES,
  type EmoteId,
  type GameEvent,
  type GameView,
  type PlayerInfo,
  type RoomPhase,
  type RoomSettings,
  type RoomView,
  type ServerToClient,
  TARGET_SCORES,
  TURN_TIMERS,
  seatCount,
} from '../shared/protocol';

export type IO = Server<ClientToServer, ServerToClient>;
export type Sock = Socket<ClientToServer, ServerToClient>;

export interface Member {
  id: string;
  name: string;
  color: number;
  bot: boolean;
  socket: Sock | null;
  connected: boolean;
  autopilot: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  chatTimes: number[];
  lastEmote: number;
}

type InternalEvent =
  | { kind: 'gameStart' }
  | { kind: 'deal'; deal: DealInfo }
  | { kind: 'play'; play: PlayInfo; auto: boolean }
  | { kind: 'roundEnd'; result: RoundResult };

export class RoomError extends Error {}

/** Timings (ms). Client animations are paced to roughly match these. */
export const TIMING = {
  gameStart: 400,
  dealInitialExtra: 400,
  twoPlayerExtra: 100,
  dealPerCard: 110,
  dealTablePerCard: 160,
  dealBase: 700,
  playLay: 900,
  playCapture: 1300,
  chkobbaBonus: 1700,
  roundEnd: 1800,
  botThinkMin: 650,
  botThinkMax: 1500,
  autopilotDelay: 1100,
  /** Disconnected seated players are auto-played after this grace period (in game). */
  autopilotGrace: 20_000,
  /** Disconnected members are removed from the lobby after this. */
  lobbyGrace: 45_000,
  hostGrace: 20_000,
  /** Results screen duration before the next hand starts automatically. */
  roundPause: 15_000,
  /** Delay before the next hand once everyone pressed "continue". */
  nextRoundDelay: 800,
  minDelay: 400,
  /** Results pause when only bots are seated (spectators watching). */
  botsOnlyPause: 7000,
};

const BOT_NAMES = [
  'Am Hamadi',
  'Khalti Zohra',
  'Si Lamine',
  'Hamma',
  'Baya',
  'Mongi',
  'Nefissa',
  'Chedly',
  'Monia',
  'Taoufik',
  'Fatma',
  'Sboui',
];

let chatSeq = 1;

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
      return TIMING.roundEnd;
  }
}

export interface RoomDeps {
  io: IO;
  rand: () => number;
  onEmpty: (room: Room) => void;
}

export class Room {
  readonly code: string;
  hostId: string;
  settings: RoomSettings;
  phase: RoomPhase = 'lobby';
  seats: (Member | null)[];
  spectators: Member[] = [];
  /** Humans in the room (seated or spectating), by id. */
  members = new Map<string, Member>();
  voice = new Map<string, { muted: boolean }>();
  game: ChkobbaGame | null = null;
  chat: ChatMessage[] = [];
  banned = new Set<string>();
  lastActivity = Date.now();
  createdAt = Date.now();

  private version = 0;
  private busyUntil = 0;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;
  private nextRoundAt: number | null = null;
  private ready = new Set<string>();
  private lastPlay: PlayInfo | null = null;
  private botNameIdx: number;
  private destroyed = false;

  constructor(
    code: string,
    hostId: string,
    settings: RoomSettings,
    private readonly deps: RoomDeps,
  ) {
    this.code = code;
    this.hostId = hostId;
    this.settings = settings;
    this.seats = Array.from({ length: seatCount(settings.mode) }, () => null);
    this.botNameIdx = Math.floor(deps.rand() * BOT_NAMES.length);
  }

  // ───────────────────────────── membership ─────────────────────────────

  seatOf(id: string): number | null {
    const i = this.seats.findIndex((m) => m?.id === id);
    return i < 0 ? null : i;
  }

  get humans(): Member[] {
    return [...this.members.values()];
  }

  connectedHumans(): Member[] {
    return this.humans.filter((m) => m.connected);
  }

  /** Adds (or re-attaches) a human. Returns the member. */
  join(id: string, profile: { name: string; color: number }, socket: Sock, spectate: boolean): Member {
    if (this.banned.has(id)) throw new RoomError('You were removed from this room.');
    this.touch();
    let member = this.members.get(id);
    if (member) {
      // Reconnection or second tab: the newest socket wins.
      if (member.socket && member.socket.id !== socket.id) {
        member.socket.emit('left', { reason: 'elsewhere' });
        void member.socket.leave(this.code);
      }
      member.socket = socket;
      member.name = profile.name;
      member.color = profile.color;
      const wasAway = !member.connected;
      member.connected = true;
      if (member.disconnectTimer) clearTimeout(member.disconnectTimer);
      member.disconnectTimer = null;
      if (member.autopilot) {
        member.autopilot = false;
        this.system(`${member.name} is back.`);
      } else if (wasAway) {
        this.system(`${member.name} reconnected.`);
      }
      if (this.game && this.seatOf(id) === this.game.turn && this.phase === 'playing') this.scheduleTurn();
    } else {
      member = {
        id,
        name: profile.name,
        color: profile.color,
        bot: false,
        socket,
        connected: true,
        autopilot: false,
        disconnectTimer: null,
        chatTimes: [],
        lastEmote: 0,
      };
      this.members.set(id, member);
      const free = this.seats.findIndex((s) => s === null);
      if (!spectate && this.phase === 'lobby' && free >= 0) {
        this.seats[free] = member;
        this.ensureDistinctColor(member);
      } else {
        this.spectators.push(member);
      }
      this.system(`${member.name} joined${this.seatOf(id) === null ? ' as a spectator' : ''}.`);
    }
    if (!this.members.has(this.hostId)) this.hostId = id;
    void socket.join(this.code);
    socket.emit('chatHistory', this.chat.slice(-40));
    this.broadcast();
    return member;
  }

  private ensureDistinctColor(member: Member) {
    const used = new Set(this.seats.filter((s) => s && s !== member).map((s) => s!.color));
    if (!used.has(member.color)) return;
    for (let i = 0; i < AVATAR_COLORS.length; i++) {
      if (!used.has(i)) {
        member.color = i;
        return;
      }
    }
  }

  /** Socket disconnected (tab closed, network…): keep the seat for a while. */
  disconnect(id: string, socketId: string) {
    const member = this.members.get(id);
    if (!member || member.socket?.id !== socketId) return;
    member.connected = false;
    member.socket = null;
    this.voice.delete(id);
    const seat = this.seatOf(id);
    const inGame = this.game !== null && this.phase !== 'lobby';
    if (seat !== null && inGame) {
      member.disconnectTimer = setTimeout(() => {
        member.disconnectTimer = null;
        if (member.connected || this.destroyed) return;
        member.autopilot = true;
        this.system(`${member.name} is away — playing on autopilot.`);
        this.broadcast();
        if (this.phase === 'playing' && this.game?.turn === this.seatOf(id)) this.scheduleTurn();
        if (this.phase === 'roundOver') this.maybeStartNextRound();
      }, TIMING.autopilotGrace);
    } else {
      member.disconnectTimer = setTimeout(
        () => {
          member.disconnectTimer = null;
          if (!member.connected && !this.destroyed) this.removeMember(id, 'left');
        },
        seat !== null ? TIMING.lobbyGrace : 15_000,
      );
    }
    if (id === this.hostId) this.scheduleHostTransfer();
    if (this.phase === 'roundOver') this.maybeStartNextRound();
    this.broadcast();
    this.checkEmpty();
  }

  /** Explicit leave (or kick / timeout). */
  removeMember(id: string, reason: 'left' | 'kicked') {
    const member = this.members.get(id);
    if (!member) return;
    if (member.disconnectTimer) clearTimeout(member.disconnectTimer);
    this.members.delete(id);
    this.voice.delete(id);
    this.spectators = this.spectators.filter((m) => m.id !== id);
    this.ready.delete(id);
    const seat = this.seatOf(id);
    if (seat !== null) {
      if (this.game && this.phase !== 'lobby') {
        // Keep the game going: a bot takes over the seat.
        this.seats[seat] = this.makeBot(member.color);
        this.system(`${member.name} left — ${this.seats[seat]!.name} takes the seat.`);
        if (this.phase === 'playing' && this.game.turn === seat) this.scheduleTurn();
      } else {
        this.seats[seat] = null;
        this.system(`${member.name} left.`);
      }
    } else {
      this.system(`${member.name} ${reason === 'kicked' ? 'was removed' : 'left'}.`);
    }
    if (member.socket) {
      member.socket.emit('left', { reason });
      void member.socket.leave(this.code);
      member.socket = null;
    }
    if (id === this.hostId) this.transferHost();
    if (this.phase === 'roundOver') this.maybeStartNextRound();
    this.broadcast();
    this.checkEmpty();
  }

  private scheduleHostTransfer() {
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = setTimeout(() => {
      this.hostTimer = null;
      const host = this.members.get(this.hostId);
      if (!host || !host.connected) {
        this.transferHost();
        this.broadcast();
      }
    }, TIMING.hostGrace);
  }

  private transferHost() {
    const candidates = this.connectedHumans().filter((m) => m.id !== this.hostId);
    const seated = candidates.find((m) => this.seatOf(m.id) !== null);
    const next = seated ?? candidates[0];
    if (next) {
      this.hostId = next.id;
      this.system(`${next.name} is now the host.`);
    }
  }

  private checkEmpty() {
    if (this.connectedHumans().length === 0) this.deps.onEmpty(this);
  }

  updateProfile(id: string, profile: { name: string; color: number }) {
    const m = this.members.get(id);
    if (!m) return;
    m.name = profile.name;
    m.color = profile.color;
    if (this.seatOf(id) !== null) this.ensureDistinctColor(m);
    this.broadcast();
  }

  // ─────────────────────────────── lobby ────────────────────────────────

  private requireHost(id: string) {
    if (id !== this.hostId) throw new RoomError('Only the host can do that.');
  }

  private requireLobby() {
    if (this.phase !== 'lobby') throw new RoomError('The game has already started.');
  }

  sit(id: string, seat: number) {
    const member = this.members.get(id);
    if (!member) throw new RoomError('Not in this room.');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seats.length) throw new RoomError('Invalid seat.');
    const occupant = this.seats[seat];
    const current = this.seatOf(id);
    if (current === seat) return;
    if (this.phase === 'lobby') {
      if (occupant) throw new RoomError('That seat is taken.');
      if (current !== null) this.seats[current] = null;
      else this.spectators = this.spectators.filter((m) => m.id !== id);
      this.seats[seat] = member;
      this.ensureDistinctColor(member);
    } else {
      // Mid-game: a spectator may take over a bot or an away player's seat.
      if (current !== null) throw new RoomError('You already have a seat.');
      if (!occupant) throw new RoomError('Invalid seat.');
      const takeable = occupant.bot || !occupant.connected || occupant.autopilot;
      if (!takeable) throw new RoomError('That seat is taken.');
      this.spectators = this.spectators.filter((m) => m.id !== id);
      if (!occupant.bot) {
        if (occupant.disconnectTimer) clearTimeout(occupant.disconnectTimer);
        occupant.disconnectTimer = null;
        occupant.autopilot = false;
        if (occupant.connected) this.spectators.push(occupant);
        else this.members.delete(occupant.id);
      }
      this.seats[seat] = member;
      this.system(`${member.name} takes over ${occupant.name}'s seat.`);
      if (this.phase === 'playing' && this.game?.turn === seat) this.scheduleTurn();
    }
    this.broadcast();
  }

  stand(id: string) {
    this.requireLobby();
    const member = this.members.get(id);
    const seat = this.seatOf(id);
    if (!member || seat === null) return;
    this.seats[seat] = null;
    this.spectators.push(member);
    this.broadcast();
  }

  setSettings(id: string, patch: Partial<RoomSettings>) {
    this.requireHost(id);
    this.requireLobby();
    const next = { ...this.settings };
    if (patch.mode !== undefined) {
      if (patch.mode !== '1v1' && patch.mode !== '2v2') throw new RoomError('Invalid mode.');
      next.mode = patch.mode;
    }
    if (patch.targetScore !== undefined) {
      if (!TARGET_SCORES.includes(patch.targetScore)) throw new RoomError('Invalid target.');
      next.targetScore = patch.targetScore;
    }
    if (patch.turnSeconds !== undefined) {
      if (!TURN_TIMERS.includes(patch.turnSeconds)) throw new RoomError('Invalid timer.');
      next.turnSeconds = patch.turnSeconds;
    }
    if (patch.botLevel !== undefined) {
      if (!BOT_LEVELS.includes(patch.botLevel)) throw new RoomError('Invalid bot level.');
      next.botLevel = patch.botLevel;
    }
    if (next.mode !== this.settings.mode) {
      const n = seatCount(next.mode);
      if (n > this.seats.length) {
        while (this.seats.length < n) this.seats.push(null);
      } else {
        // Shrinking: keep humans seated where possible, move extras to spectators.
        const occupants = this.seats.filter((s): s is Member => s !== null);
        const humans = occupants.filter((m) => !m.bot);
        const bots = occupants.filter((m) => m.bot);
        const keep = [...humans, ...bots].slice(0, n);
        for (const m of humans) if (!keep.includes(m)) this.spectators.push(m);
        this.seats = Array.from({ length: n }, (_, i) => keep[i] ?? null);
      }
    }
    this.settings = next;
    this.broadcast();
  }

  private makeBot(preferredColor?: number): Member {
    const name = BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length]!;
    const used = new Set(this.seats.filter(Boolean).map((s) => s!.color));
    let color = preferredColor ?? 0;
    if (preferredColor === undefined || used.has(color)) {
      for (let i = 0; i < AVATAR_COLORS.length; i++) {
        const c = (i + this.botNameIdx * 3) % AVATAR_COLORS.length;
        if (!used.has(c)) {
          color = c;
          break;
        }
      }
    }
    return {
      id: `bot-${this.code}-${Math.floor(this.deps.rand() * 1e9).toString(36)}`,
      name,
      color,
      bot: true,
      socket: null,
      connected: true,
      autopilot: false,
      disconnectTimer: null,
      chatTimes: [],
      lastEmote: 0,
    };
  }

  addBot(id: string, seat: number) {
    this.requireHost(id);
    this.requireLobby();
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seats.length) throw new RoomError('Invalid seat.');
    if (this.seats[seat]) throw new RoomError('That seat is taken.');
    this.seats[seat] = this.makeBot();
    this.broadcast();
  }

  removeBot(id: string, seat: number) {
    this.requireHost(id);
    this.requireLobby();
    if (!this.seats[seat]?.bot) throw new RoomError('No bot there.');
    this.seats[seat] = null;
    this.broadcast();
  }

  kick(id: string, targetId: string) {
    this.requireHost(id);
    if (targetId === id) throw new RoomError('You cannot remove yourself.');
    const seatIdx = this.seats.findIndex((s) => s?.id === targetId);
    if (seatIdx >= 0 && this.seats[seatIdx]!.bot) {
      if (this.phase !== 'lobby') throw new RoomError('Bots cannot be removed during a game.');
      this.seats[seatIdx] = null;
      this.broadcast();
      return;
    }
    if (!this.members.has(targetId)) throw new RoomError('No such player.');
    this.banned.add(targetId);
    this.removeMember(targetId, 'kicked');
  }

  // ──────────────────────────────── game ────────────────────────────────

  start(id: string) {
    this.requireHost(id);
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') throw new RoomError('The game is already running.');
    if (this.seats.some((s) => s === null)) throw new RoomError('Fill every seat (invite friends or add bots).');
    this.startGame();
  }

  private startGame() {
    this.clearActionTimer();
    this.game = new ChkobbaGame({
      numPlayers: this.seats.length as 2 | 4,
      targetScore: this.settings.targetScore,
      rand: this.deps.rand,
    });
    this.phase = 'playing';
    this.lastPlay = null;
    this.ready.clear();
    this.nextRoundAt = null;
    this.busyUntil = Date.now();
    const deal = this.game.startRound();
    this.system(`New game — first to ${this.settings.targetScore} points. Yalla!`);
    this.emitEvents([{ kind: 'gameStart' }, { kind: 'deal', deal }]);
    this.scheduleTurn();
  }

  rematch(id: string) {
    this.requireHost(id);
    if (this.phase !== 'gameOver') throw new RoomError('The game is not over.');
    if (this.seats.some((s) => s === null)) throw new RoomError('Fill every seat first.');
    this.startGame();
  }

  toLobby(id: string) {
    this.requireHost(id);
    if (this.phase === 'lobby') return;
    this.clearActionTimer();
    this.game = null;
    this.phase = 'lobby';
    this.turnDeadline = null;
    this.nextRoundAt = null;
    this.ready.clear();
    // Seats of players who disconnected are released in the lobby.
    for (let i = 0; i < this.seats.length; i++) {
      const m = this.seats[i];
      if (m && !m.bot && !m.connected) {
        if (m.disconnectTimer) clearTimeout(m.disconnectTimer);
        m.disconnectTimer = null;
        this.seats[i] = null;
        this.members.delete(m.id);
      } else if (m) m.autopilot = false;
    }
    this.broadcast();
  }

  play(id: string, move: Move, auto = false) {
    const game = this.game;
    if (!game || this.phase !== 'playing') throw new RoomError('No hand in progress.');
    const seat = this.seats.findIndex((s) => s?.id === id);
    if (seat < 0) throw new RoomError('You are not seated.');
    if (game.turn !== seat) throw new RoomError('Not your turn.');
    if (
      !move ||
      typeof move.cardId !== 'string' ||
      !Array.isArray(move.capture) ||
      move.capture.length > 20 ||
      !move.capture.every((x) => typeof x === 'string')
    ) {
      throw new RoomError('Invalid move.');
    }
    if (!game.isLegal(seat, move)) throw new RoomError('That move is not allowed.');
    this.applyMove(seat, move, auto);
  }

  private applyMove(seat: number, move: Move, auto: boolean) {
    const game = this.game!;
    this.clearActionTimer();
    this.turnDeadline = null;
    this.touch();
    const out = game.play(seat, move);
    this.lastPlay = out.play;
    const events: InternalEvent[] = [{ kind: 'play', play: out.play, auto }];
    const who = this.seats[seat]!;
    if (out.play.chkobba) this.system(`🔥 ${who.name} made a CHKOBBA with ${cardShort(out.play.card)}!`);
    if (out.deal) events.push({ kind: 'deal', deal: out.deal });
    if (out.round) {
      events.push({ kind: 'roundEnd', result: out.round });
      this.onRoundEnd(out.round);
    }
    this.emitEvents(events);
    this.scheduleTurn();
    if (this.phase === 'roundOver') this.maybeStartNextRound();
  }

  private onRoundEnd(result: RoundResult) {
    this.ready.clear();
    const teamName = (t: number) => this.teamLabel(t);
    if (result.winner !== null) {
      this.phase = 'gameOver';
      this.nextRoundAt = null;
      this.system(`🏆 ${teamName(result.winner)} win${this.seats.length === 2 ? 's' : ''} ${result.totals[0]}–${result.totals[1]}!`);
    } else {
      this.phase = 'roundOver';
      this.system(`Hand ${result.round}: +${result.points[0]} / +${result.points[1]} → ${result.totals[0]}–${result.totals[1]}`);
    }
  }

  teamLabel(team: number): string {
    const names = this.seats.filter((_, i) => teamOf(i) === team).map((s) => s?.name ?? '?');
    return names.join(' & ');
  }

  continueRound(id: string) {
    if (this.phase !== 'roundOver') return;
    if (!this.members.has(id)) return;
    this.ready.add(id);
    this.broadcast();
    this.maybeStartNextRound();
  }

  private maybeStartNextRound() {
    if (this.phase !== 'roundOver') return;
    const needed = this.seats.filter((s): s is Member => !!s && !s.bot && s.connected && !s.autopilot);
    if (!needed.every((m) => this.ready.has(m.id))) return;
    // Nobody seated needs to confirm (bots only): leave spectators a moment to read the results.
    const at =
      needed.length === 0
        ? Math.max(Date.now() + TIMING.minDelay, this.busyUntil + TIMING.botsOnlyPause)
        : Math.max(Date.now() + TIMING.minDelay, this.busyUntil + TIMING.nextRoundDelay);
    if (this.nextRoundAt !== null && this.nextRoundAt <= at) return;
    this.clearActionTimer();
    this.nextRoundAt = at;
    this.actionTimer = setTimeout(() => this.startNextRound(), at - Date.now());
    this.broadcast();
  }

  private startNextRound() {
    if (!this.game || this.phase !== 'roundOver') return;
    this.clearActionTimer();
    this.phase = 'playing';
    this.ready.clear();
    this.nextRoundAt = null;
    this.lastPlay = null;
    this.busyUntil = Math.max(this.busyUntil, Date.now());
    const deal = this.game.startRound();
    this.emitEvents([{ kind: 'deal', deal }]);
    this.scheduleTurn();
  }

  private clearActionTimer() {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.actionTimer = null;
  }

  /** Arms whatever must happen next: a bot move, an autopilot move, a turn timeout, or the next hand. */
  private scheduleTurn() {
    this.clearActionTimer();
    this.turnDeadline = null;
    const game = this.game;
    if (!game || this.destroyed) return;
    const now = Date.now();
    if (this.phase === 'roundOver') {
      this.nextRoundAt = Math.max(now, this.busyUntil) + TIMING.roundPause;
      this.actionTimer = setTimeout(() => this.startNextRound(), this.nextRoundAt - now);
      return;
    }
    if (this.phase !== 'playing') return;
    const seat = game.turn;
    const member = this.seats[seat];
    if (!member) return;
    const startAt = Math.max(now, this.busyUntil);
    if (member.bot) {
      const think = TIMING.botThinkMin + this.deps.rand() * (TIMING.botThinkMax - TIMING.botThinkMin);
      this.actionTimer = setTimeout(() => this.autoMove(seat, false), startAt - now + think);
    } else if (member.autopilot) {
      this.actionTimer = setTimeout(() => this.autoMove(seat, true), startAt - now + TIMING.autopilotDelay);
    } else if (this.settings.turnSeconds > 0) {
      this.turnDeadline = startAt + this.settings.turnSeconds * 1000;
      this.actionTimer = setTimeout(() => {
        const m = this.seats[seat];
        if (m && !m.bot) this.system(`⏰ Time's up for ${m.name}.`);
        this.autoMove(seat, true);
      }, this.turnDeadline - now);
    }
  }

  private autoMove(seat: number, auto: boolean) {
    this.actionTimer = null;
    const game = this.game;
    if (!game || this.phase !== 'playing' || game.turn !== seat || this.destroyed) return;
    const level = this.seats[seat]?.bot ? this.settings.botLevel : 'normal';
    let move: Move;
    try {
      move = chooseBotMove(botContext(game, seat), level, this.deps.rand);
      if (!game.isLegal(seat, move)) throw new Error('bot produced an illegal move');
    } catch (err) {
      console.error(`[room ${this.code}] bot error`, err);
      move = game.legalMoves(seat)[0]!;
    }
    this.applyMove(seat, move, auto);
  }

  // ─────────────────────────────── social ───────────────────────────────

  system(text: string) {
    this.pushChat({ id: chatSeq++, from: null, name: '', color: 0, text, ts: Date.now(), system: true });
  }

  sendChat(id: string, rawText: unknown) {
    const member = this.members.get(id);
    if (!member || typeof rawText !== 'string') return;
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return;
    const now = Date.now();
    member.chatTimes = member.chatTimes.filter((t) => now - t < 8000);
    if (member.chatTimes.length >= 6) return;
    member.chatTimes.push(now);
    this.pushChat({ id: chatSeq++, from: id, name: member.name, color: member.color, text, ts: now, system: false });
  }

  private pushChat(msg: ChatMessage) {
    this.chat.push(msg);
    if (this.chat.length > 80) this.chat.splice(0, this.chat.length - 80);
    this.deps.io.to(this.code).emit('chat', msg);
  }

  emote(id: string, emoteId: unknown) {
    const member = this.members.get(id);
    if (!member || !EMOTES.some((e) => e.id === emoteId)) return;
    const now = Date.now();
    if (now - member.lastEmote < 1200) return;
    member.lastEmote = now;
    this.deps.io.to(this.code).emit('emote', { from: id, id: emoteId as EmoteId });
  }

  voiceJoin(id: string, muted: boolean) {
    if (!this.members.has(id)) throw new RoomError('Not in this room.');
    if (!this.voice.has(id) && this.voice.size >= 12) throw new RoomError('Voice chat is full (12 people).');
    this.voice.set(id, { muted: !!muted });
    this.broadcast();
  }

  voiceLeave(id: string) {
    if (this.voice.delete(id)) this.broadcast();
  }

  voiceMute(id: string, muted: boolean) {
    const v = this.voice.get(id);
    if (!v) return;
    v.muted = !!muted;
    this.broadcast();
  }

  voiceSignal(from: string, to: unknown, data: unknown) {
    if (typeof to !== 'string' || !this.voice.has(from) || !this.voice.has(to)) return;
    const target = this.members.get(to);
    if (!target?.socket) return;
    let size = 0;
    try {
      size = JSON.stringify(data ?? null).length;
    } catch {
      return;
    }
    if (size > 64_000) return;
    target.socket.emit('voice:signal', { from, data });
  }

  // ───────────────────────────── broadcasting ───────────────────────────

  private touch() {
    this.lastActivity = Date.now();
  }

  private emitEvents(events: InternalEvent[]) {
    const n = this.seats.length;
    const now = Date.now();
    let busy = Math.max(now, this.busyUntil);
    for (const ev of events) busy += eventDuration(ev, n);
    this.busyUntil = busy;
    this.broadcast(events);
  }

  broadcast(events: InternalEvent[] = []) {
    if (this.destroyed) return;
    this.version++;
    for (const m of this.members.values()) {
      if (!m.socket || !m.connected) continue;
      m.socket.emit('room', { room: this.viewFor(m.id), events: events.map((e) => this.personalize(e, m.id)) });
    }
  }

  private personalize(ev: InternalEvent, viewerId: string): GameEvent {
    switch (ev.kind) {
      case 'deal': {
        const seat = this.seatOf(viewerId);
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
      case 'gameStart':
        return { kind: 'gameStart' };
    }
  }

  private playerInfo(m: Member): PlayerInfo {
    return { id: m.id, name: m.name, color: m.color, bot: m.bot, connected: m.connected, autopilot: m.autopilot };
  }

  viewFor(viewerId: string): RoomView {
    const seat = this.seatOf(viewerId);
    const g = this.game;
    let game: GameView | null = null;
    if (g) {
      game = {
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
        turnDeadline: this.turnDeadline,
        ready: [...this.ready],
        nextRoundAt: this.phase === 'roundOver' ? this.nextRoundAt : null,
      };
    }
    return {
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      phase: this.phase,
      seats: this.seats.map((m) => (m ? this.playerInfo(m) : null)),
      spectators: this.spectators.map((m) => this.playerInfo(m)),
      voice: [...this.voice.entries()].map(([id, v]) => ({ id, muted: v.muted })),
      game,
      you: { id: viewerId, seat },
      serverTime: Date.now(),
      version: this.version,
    };
  }

  destroy() {
    this.destroyed = true;
    this.clearActionTimer();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    for (const m of this.members.values()) {
      if (m.disconnectTimer) clearTimeout(m.disconnectTimer);
      if (m.socket) {
        m.socket.emit('left', { reason: 'closed' });
        void m.socket.leave(this.code);
      }
    }
    this.members.clear();
  }
}
