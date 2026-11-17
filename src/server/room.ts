import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS,
  BOT_LEVELS,
  CHAT_MAX,
  type CharacterId,
  type ChatMessage,
  type ClientToServer,
  DRINKS,
  type DrinkId,
  EMOTES,
  type EmoteId,
  GAME_INFO,
  type GameView,
  type PlayerInfo,
  type RoomPhase,
  type RoomSettings,
  type RoomView,
  type ServerToClient,
  SKIN_TONES,
  TURN_TIMERS,
  VOICE_MAX,
  isGameKind,
  seatCount,
} from '../shared/protocol';
import { type Team, teamOf } from '../shared/teams';
import { RoomError } from './errors';
import { type Action, type AutoReason, type InternalEvent, type Outcome, type TableGame, createTable, eventDuration, personalizeEvent } from './tables';
import { TIMING } from './timing';

export { RoomError, TIMING };

export type IO = Server<ClientToServer, ServerToClient>;
export type Sock = Socket<ClientToServer, ServerToClient>;

/** What a player chose about themselves: name, shirt colour, character, skin tone and drink. */
export interface MemberProfile {
  name: string;
  color: number;
  character: CharacterId;
  skin: number;
  drink: DrinkId;
}

export interface Member extends MemberProfile {
  id: string;
  bot: boolean;
  socket: Sock | null;
  connected: boolean;
  autopilot: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  chatTimes: number[];
  lastEmote: number;
  lastSip: number;
}

/** Sipping pace (kept apart from TIMING, which tests shrink to make games fast). */
export const SIP_TIMING = {
  /** Minimum gap between two sips of the same player (the client animation is longer). */
  cooldown: 1200,
  /** How often the room considers letting a bot sip its drink. */
  botTick: 9000,
  /** Chance that one of the bots sips on a tick. */
  botChance: 0.45,
};

/** Bots, with the characters that suit their names. */
const BOTS: { name: string; looks: CharacterId[] }[] = [
  { name: 'Am Hamadi', looks: ['hajj'] },
  { name: 'Khalti Zohra', looks: ['hajja'] },
  { name: 'Si Lamine', looks: ['patron', 'wled'] },
  { name: 'Hamma', looks: ['wled', 'sportif'] },
  { name: 'Baya', looks: ['lella', 'nejma', 'taleba'] },
  { name: 'Mongi', looks: ['patron', 'hajj'] },
  { name: 'Nefissa', looks: ['lella', 'taleba'] },
  { name: 'Chedly', looks: ['wled', 'sportif', 'patron'] },
  { name: 'Monia', looks: ['nejma', 'lella'] },
  { name: 'Taoufik', looks: ['wled', 'patron'] },
  { name: 'Fatma', looks: ['hajja', 'lella'] },
  { name: 'Sboui', looks: ['sportif', 'wled'] },
];

let chatSeq = 1;

function pickProfile(p: MemberProfile): MemberProfile {
  return { name: p.name, color: p.color, character: p.character, skin: p.skin, drink: p.drink };
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
  game: TableGame | null = null;
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
  private botNameIdx: number;
  private sipTicker: ReturnType<typeof setInterval>;
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
    this.botNameIdx = Math.floor(deps.rand() * BOTS.length);
    this.sipTicker = setInterval(() => this.botSip(), SIP_TIMING.botTick);
    this.sipTicker.unref?.();
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
  join(id: string, profile: MemberProfile, socket: Sock, spectate: boolean): Member {
    if (this.banned.has(id)) throw new RoomError('You were removed from this room.');
    this.touch();
    let member = this.members.get(id);
    if (member) {
      // Reconnection or second tab: the newest socket wins.
      if (member.socket && member.socket.id !== socket.id) {
        member.socket.emit('left', { reason: 'elsewhere' });
        void member.socket.leave(this.code);
      }
      // A new connection often arrives before the old one is known to be dead (a phone switching
      // networks or coming back from the background). Its voice links are gone with it: drop the old
      // voice entry so the others close their stale connections now; the client rejoins voice itself.
      if (member.socket?.id !== socket.id) this.voice.delete(id);
      member.socket = socket;
      Object.assign(member, pickProfile(profile));
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
      if (this.game && (this.phase === 'playing' || this.phase === 'roundOver') && !this.actionTimer) this.scheduleTurn();
      else if (this.game && this.seatOf(id) === this.game.turn && this.phase === 'playing') this.scheduleTurn();
    } else {
      member = {
        id,
        ...pickProfile(profile),
        bot: false,
        socket,
        connected: true,
        autopilot: false,
        disconnectTimer: null,
        chatTimes: [],
        lastEmote: 0,
        lastSip: 0,
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
      if (this.game && (this.phase === 'playing' || this.phase === 'roundOver') && !this.actionTimer) this.scheduleTurn();
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
        if (this.phase === 'playing' && this.game?.turn === this.seatOf(id)) this.scheduleTurn();
        this.broadcast();
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

  updateProfile(id: string, profile: MemberProfile) {
    const m = this.members.get(id);
    if (!m) return;
    Object.assign(m, pickProfile(profile));
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
    if (patch.game !== undefined && patch.game !== next.game) {
      if (!isGameKind(patch.game)) throw new RoomError('Unknown game.');
      // Each game has its own targets and table sizes.
      next.game = patch.game;
      next.targetScore = GAME_INFO[next.game].defaultTarget;
      if (!GAME_INFO[next.game].modes.includes(next.mode)) next.mode = GAME_INFO[next.game].modes[0]!;
    }
    const info = GAME_INFO[next.game];
    if (patch.mode !== undefined) {
      if (patch.mode !== '1v1' && patch.mode !== '2v2') throw new RoomError('Invalid mode.');
      if (!info.modes.includes(patch.mode)) throw new RoomError(`${info.name} is played 2 vs 2.`);
      next.mode = patch.mode;
    }
    if (patch.targetScore !== undefined) {
      if (!info.targets.includes(patch.targetScore)) throw new RoomError('Invalid target.');
      next.targetScore = patch.targetScore;
    }
    if (patch.announcements !== undefined) {
      if (typeof patch.announcements !== 'boolean') throw new RoomError('Invalid setting.');
      next.announcements = patch.announcements;
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
    const rand = this.deps.rand;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
    const persona = BOTS[this.botNameIdx++ % BOTS.length]!;
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
      id: `bot-${this.code}-${Math.floor(rand() * 1e9).toString(36)}`,
      name: persona.name,
      color,
      character: pick(persona.looks),
      skin: Math.floor(rand() * SKIN_TONES.length),
      drink: pick(DRINKS).id,
      bot: true,
      socket: null,
      connected: true,
      autopilot: false,
      disconnectTimer: null,
      chatTimes: [],
      lastEmote: 0,
      lastSip: 0,
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
    this.game = createTable(this.settings, this.seats.length, this.deps.rand);
    this.phase = 'playing';
    this.ready.clear();
    this.nextRoundAt = null;
    this.busyUntil = Date.now();
    const events = this.game.startRound();
    this.system(`New game of ${GAME_INFO[this.game.kind].name} — first to ${this.settings.targetScore} points. Yalla!`);
    this.advance([{ kind: 'gameStart' }, ...events]);
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

  /** A player plays a card. */
  play(id: string, move: unknown) {
    this.act(id, { type: 'play', move });
  }

  /** Belote: a player takes with a trump suit, or passes (null). */
  bid(id: string, suit: unknown) {
    this.act(id, { type: 'bid', suit });
  }

  private act(id: string, action: Action) {
    const game = this.game;
    if (!game || this.phase !== 'playing') throw new RoomError('No hand in progress.');
    const seat = this.seats.findIndex((s) => s?.id === id);
    if (seat < 0) throw new RoomError('You are not seated.');
    if (game.turn !== seat) throw new RoomError('Not your turn.');
    this.apply(game.act(seat, action, false, this.names));
  }

  private readonly names = {
    seat: (seat: number) => this.seats[seat]?.name ?? '?',
    team: (team: Team) => this.teamLabel(team),
  };

  /** Moves the table on after an action the game has applied. */
  private apply(out: Outcome) {
    this.clearActionTimer();
    this.turnDeadline = null;
    this.touch();
    for (const line of out.messages) this.system(line);
    if (out.handEnd) this.onRoundEnd(out.handEnd);
    this.advance(out.events);
    if (this.phase === 'roundOver') this.maybeStartNextRound();
  }

  private onRoundEnd(result: { round: number; points: [number, number]; totals: [number, number]; winner: Team | null }) {
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
    this.busyUntil = Math.max(this.busyUntil, Date.now());
    this.advance(this.game.startRound());
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
      if (this.connectedHumans().length === 0) return;
      this.nextRoundAt = Math.max(now, this.busyUntil) + TIMING.roundPause;
      this.actionTimer = setTimeout(() => this.startNextRound(), this.nextRoundAt - now);
      return;
    }
    if (this.phase !== 'playing') return;
    const seat = game.turn;
    const member = this.seats[seat];
    if (!member) return;
    // Nobody is watching: pause until someone (re)connects instead of letting bots play alone.
    if (this.connectedHumans().length === 0) return;
    const startAt = Math.max(now, this.busyUntil);
    if (member.bot) {
      const think = TIMING.botThinkMin + this.deps.rand() * (TIMING.botThinkMax - TIMING.botThinkMin);
      this.actionTimer = setTimeout(() => this.autoMove(seat, 'bot'), startAt - now + think);
    } else if (member.autopilot) {
      this.actionTimer = setTimeout(() => this.autoMove(seat, 'autopilot'), startAt - now + TIMING.autopilotDelay);
    } else if (this.settings.turnSeconds > 0) {
      this.turnDeadline = startAt + this.settings.turnSeconds * 1000;
      this.actionTimer = setTimeout(() => {
        const m = this.seats[seat];
        if (m && !m.bot) this.system(`⏰ Time's up for ${m.name}.`);
        this.autoMove(seat, 'timeout');
      }, this.turnDeadline - now);
    }
  }

  private autoMove(seat: number, reason: AutoReason) {
    this.actionTimer = null;
    const game = this.game;
    if (!game || this.phase !== 'playing' || game.turn !== seat || this.destroyed) return;
    const auto = reason !== 'bot';
    let out: Outcome;
    try {
      out = game.act(seat, game.autoAction(seat, this.settings.botLevel, this.deps.rand, reason), auto, this.names);
    } catch (err) {
      console.error(`[room ${this.code}] bot error`, err);
      out = game.act(seat, game.fallbackAction(seat), auto, this.names);
    }
    this.apply(out);
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

  /** A seated player sips their drink: everyone else sees and hears it (the sipper already animated it). */
  sip(id: string) {
    const member = this.members.get(id);
    if (!member?.socket || this.seatOf(id) === null) return;
    const now = Date.now();
    if (now - member.lastSip < SIP_TIMING.cooldown) return;
    member.lastSip = now;
    member.socket.to(this.code).emit('sip', { from: id });
  }

  /** Now and then a bot enjoys its drink too, so the table feels alive. */
  private botSip() {
    if (this.destroyed || this.connectedHumans().length === 0) return;
    const bots = this.seats.filter((s): s is Member => !!s?.bot);
    if (bots.length === 0 || this.deps.rand() > SIP_TIMING.botChance) return;
    const bot = bots[Math.floor(this.deps.rand() * bots.length)]!;
    bot.lastSip = Date.now();
    this.deps.io.to(this.code).emit('sip', { from: bot.id });
  }

  voiceJoin(id: string, muted: boolean) {
    if (!this.members.has(id)) throw new RoomError('Not in this room.');
    if (!this.voice.has(id) && this.voice.size >= VOICE_MAX) throw new RoomError(`Voice chat is full (${VOICE_MAX} people).`);
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

  /**
   * Moves the table on after `events`: paces their animations, arms what comes next
   * (bot move, turn deadline, next hand), then broadcasts. Arming first is what puts
   * the new `turnDeadline` / `nextRoundAt` in the view the clients receive.
   */
  private advance(events: InternalEvent[]) {
    const n = this.seats.length;
    const now = Date.now();
    let busy = Math.max(now, this.busyUntil);
    for (const ev of events) busy += eventDuration(ev, n);
    this.busyUntil = busy;
    this.scheduleTurn();
    this.broadcast(events);
  }

  broadcast(events: InternalEvent[] = []) {
    if (this.destroyed) return;
    this.version++;
    for (const m of this.members.values()) {
      if (!m.socket || !m.connected) continue;
      const seat = this.seatOf(m.id);
      m.socket.emit('room', { room: this.viewFor(m.id), events: events.map((e) => personalizeEvent(e, seat)) });
    }
  }

  private playerInfo(m: Member): PlayerInfo {
    return {
      id: m.id,
      name: m.name,
      color: m.color,
      character: m.character,
      skin: m.skin,
      drink: m.drink,
      bot: m.bot,
      connected: m.connected,
      autopilot: m.autopilot,
    };
  }

  viewFor(viewerId: string): RoomView {
    const seat = this.seatOf(viewerId);
    const g = this.game;
    let game: GameView | null = null;
    if (g) {
      game = {
        ...g.view(seat),
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
    clearInterval(this.sipTicker);
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
