import { createHash, getRandomValues } from 'node:crypto';
import {
  AVATAR_COLORS,
  type CharacterId,
  DEFAULT_SETTINGS,
  DRINKS,
  type DrinkId,
  type HandshakeAuth,
  NAME_MAX,
  REGULARS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RoomSettings,
  SKIN_TONES,
  type Welcome,
  drinkFrom,
  isCharacter,
  isRoomCode,
  isSkin,
  normalizeRoomCode,
} from '../shared/protocol';
import { type IO, type MemberProfile, Room, RoomError, type Sock } from './room';

export function secureRandom(): number {
  const buf = new Uint32Array(1);
  getRandomValues(buf);
  return buf[0]! / 4294967296;
}

export function idFromSecret(secret: string): string {
  return createHash('sha256').update(`karta:${secret}`).digest('base64url').slice(0, 16);
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  const name = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return name || 'Player';
}

/** Look for clients that do not send one (older builds): stable per player, varied across players, never one of the crew. */
export function defaultLook(id: string): { character: CharacterId; skin: number; drink: DrinkId } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  return {
    character: REGULARS[h % REGULARS.length]!.id,
    skin: (h >>> 8) % SKIN_TONES.length,
    drink: DRINKS[(h >>> 16) % DRINKS.length]!.id,
  };
}

/** Applies the valid fields of an untrusted profile payload; anything missing or invalid keeps its current value. */
export function applyProfile(current: MemberProfile, raw: unknown): MemberProfile {
  const p = (raw ?? {}) as Partial<Record<keyof MemberProfile, unknown>>;
  const color = Number(p.color);
  return {
    name: p.name === undefined ? current.name : sanitizeName(p.name),
    color: Number.isInteger(color) && color >= 0 && color < AVATAR_COLORS.length ? color : current.color,
    character: isCharacter(p.character) ? p.character : current.character,
    skin: isSkin(p.skin) ? p.skin : current.skin,
    drink: drinkFrom(p.drink) ?? current.drink,
  };
}

interface SocketData {
  id: string;
  profile: MemberProfile;
  room: string | null;
  createdRooms: number[];
}

export interface ManagerOptions {
  /** ICE servers for voice chat, or a function giving each player theirs (per-user TURN credentials). */
  iceServers: Welcome['iceServers'] | ((userId: string) => Welcome['iceServers']);
  /** How long a room with nobody connected survives (ms). */
  emptyRoomTtl?: number;
  rand?: () => number;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly emptyTtl: number;
  private readonly rand: () => number;
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly io: IO,
    private readonly opts: ManagerOptions,
  ) {
    this.emptyTtl = opts.emptyRoomTtl ?? 10 * 60_000;
    this.rand = opts.rand ?? secureRandom;
    this.sweepTimer = setInterval(() => this.sweep(), 30_000);
    this.sweepTimer.unref?.();
    io.use((socket, next) => {
      const auth = (socket.handshake.auth ?? {}) as Partial<HandshakeAuth>;
      if (typeof auth.secret !== 'string' || auth.secret.length < 16 || auth.secret.length > 128) {
        next(new Error('bad-auth'));
        return;
      }
      const id = idFromSecret(auth.secret);
      const data: SocketData = {
        id,
        profile: applyProfile({ name: 'Player', color: 0, ...defaultLook(id) }, auth),
        room: null,
        createdRooms: [],
      };
      socket.data = data;
      next();
    });
    io.on('connection', (socket) => this.onConnection(socket));
  }

  stop() {
    clearInterval(this.sweepTimer);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.connectedHumans().length;
    return { rooms: this.rooms.size, players };
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(this.rand() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate a room code');
  }

  private sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.connectedHumans().length === 0 && now - room.lastActivity > this.emptyTtl) {
        room.destroy();
        this.rooms.delete(room.code);
      }
    }
  }

  private onEmpty = (room: Room) => {
    // Rooms are kept for a while so people can come back via the link; the sweeper deletes them later.
    room.lastActivity = Date.now();
  };

  private onConnection(socket: Sock) {
    const data = socket.data as SocketData;
    const ice = this.opts.iceServers;
    socket.emit('welcome', { id: data.id, iceServers: typeof ice === 'function' ? ice(data.id) : ice });

    const currentRoom = (): Room | null => (data.room ? (this.rooms.get(data.room) ?? null) : null);
    const leaveCurrent = () => {
      const room = currentRoom();
      if (room) room.removeMember(data.id, 'left');
      data.room = null;
    };
    const guard =
      <A extends unknown[]>(fn: (room: Room, ...args: A) => void) =>
      (...args: A) => {
        const room = currentRoom();
        const ack = args[args.length - 1];
        const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : null;
        if (!room) {
          reply?.({ ok: false, error: 'You are not in a room.' });
          return;
        }
        try {
          fn(room, ...args);
          reply?.({ ok: true });
        } catch (err) {
          if (err instanceof RoomError) reply?.({ ok: false, error: err.message });
          else {
            console.error('[karta] handler error', err);
            reply?.({ ok: false, error: 'Something went wrong.' });
          }
        }
      };

    socket.on('profile', (p) => {
      data.profile = applyProfile(data.profile, p);
      currentRoom()?.updateProfile(data.id, data.profile);
    });

    socket.on('create', (p, ack) => {
      if (typeof ack !== 'function') return;
      const now = Date.now();
      data.createdRooms = data.createdRooms.filter((t) => now - t < 60_000);
      if (data.createdRooms.length >= 6) {
        ack({ ok: false, error: 'Too many rooms created, wait a minute.' });
        return;
      }
      data.createdRooms.push(now);
      leaveCurrent();
      const settings: RoomSettings = { ...DEFAULT_SETTINGS };
      const code = this.newCode();
      const room = new Room(code, data.id, settings, {
        io: this.io,
        rand: this.rand,
        onEmpty: this.onEmpty,
      });
      this.rooms.set(code, room);
      try {
        if (p?.settings) room.setSettings(data.id, p.settings);
      } catch {
        /* ignore invalid initial settings */
      }
      data.room = code;
      room.join(data.id, data.profile, socket, false);
      ack({ ok: true, code });
    });

    socket.on('join', (p, ack) => {
      if (typeof ack !== 'function') return;
      const code = normalizeRoomCode(String(p?.code ?? ''));
      if (!isRoomCode(code)) {
        ack({ ok: false, error: 'That room code does not look right.' });
        return;
      }
      const room = this.rooms.get(code);
      if (!room) {
        ack({ ok: false, error: 'Room not found — it may have expired.' });
        return;
      }
      if (data.room && data.room !== code) leaveCurrent();
      try {
        room.join(data.id, data.profile, socket, !!p?.spectate);
        data.room = code;
        ack({ ok: true, code });
      } catch (err) {
        ack({ ok: false, error: err instanceof RoomError ? err.message : 'Could not join.' });
      }
    });

    socket.on('leave', () => leaveCurrent());

    socket.on('sit', guard((room, p: { seat: number }) => room.sit(data.id, Number(p?.seat))));
    socket.on('stand', guard((room) => room.stand(data.id)));
    socket.on('settings', guard((room, p) => room.setSettings(data.id, p ?? {})));
    socket.on('addBot', guard((room, p: { seat: number }) => room.addBot(data.id, Number(p?.seat))));
    socket.on('removeBot', guard((room, p: { seat: number }) => room.removeBot(data.id, Number(p?.seat))));
    socket.on('kick', guard((room, p: { playerId: string }) => room.kick(data.id, String(p?.playerId))));
    socket.on('start', guard((room) => room.start(data.id)));
    socket.on('play', guard((room, move) => room.play(data.id, move)));
    socket.on('bid', guard((room, call: unknown) => room.bid(data.id, call)));
    socket.on('continue', () => currentRoom()?.continueRound(data.id));
    socket.on('rematch', guard((room) => room.rematch(data.id)));
    socket.on('toLobby', guard((room) => room.toLobby(data.id)));
    socket.on('chat', (p) => currentRoom()?.sendChat(data.id, p?.text));
    socket.on('emote', (p) => currentRoom()?.emote(data.id, p?.id));
    socket.on('sip', () => currentRoom()?.sip(data.id));
    socket.on('voice:join', guard((room, p: { muted: boolean }) => room.voiceJoin(data.id, !!p?.muted)));
    socket.on('voice:leave', () => currentRoom()?.voiceLeave(data.id));
    socket.on('voice:mute', (p) => currentRoom()?.voiceMute(data.id, !!p?.muted));
    socket.on('voice:signal', (p) => currentRoom()?.voiceSignal(data.id, p?.to, p?.data));

    socket.on('disconnect', () => {
      currentRoom()?.disconnect(data.id, socket.id);
    });
  }
}
