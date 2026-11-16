import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, HandshakeAuth, Profile, ServerToClient, Welcome } from '../shared/protocol';
import { profile } from './identity';

function publicProfile(): Profile {
  return { name: profile.name, color: profile.color, character: profile.character, skin: profile.skin, drink: profile.drink };
}

export type ClientSocket = Socket<ServerToClient, ClientToServer>;
export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export class Net {
  readonly socket: ClientSocket;
  welcome: Welcome | null = null;
  private welcomeWaiters: ((w: Welcome) => void)[] = [];

  constructor() {
    const auth: HandshakeAuth = { secret: profile.secret, ...publicProfile() };
    this.socket = io({
      auth,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
    });
    this.socket.on('welcome', (w) => {
      this.welcome = w;
      for (const f of this.welcomeWaiters.splice(0)) f(w);
    });
  }

  get id(): string | null {
    return this.welcome?.id ?? null;
  }

  ready(): Promise<Welcome> {
    if (this.welcome && this.socket.connected) return Promise.resolve(this.welcome);
    return new Promise((resolve) => this.welcomeWaiters.push(resolve));
  }

  /** Emits an event with an acknowledgement, with a timeout. */
  call<T = object>(event: keyof ClientToServer, payload?: unknown, timeoutMs = 8000): Promise<AckResult<T>> {
    return new Promise((resolve) => {
      const s = this.socket as unknown as {
        timeout: (ms: number) => { emit: (...args: unknown[]) => void };
      };
      const done = (err: unknown, res?: AckResult<T>) => {
        if (err) resolve({ ok: false, error: this.socket.connected ? 'The server did not answer.' : 'You are offline.' });
        else resolve(res ?? { ok: false, error: 'No answer.' });
      };
      if (payload === undefined) s.timeout(timeoutMs).emit(event, done);
      else s.timeout(timeoutMs).emit(event, payload, done);
    });
  }

  /** Sends the local profile (name, colour, character, skin, drink) and keeps it for reconnections. */
  updateProfile() {
    const p = publicProfile();
    Object.assign(this.socket.auth as Record<string, unknown>, p);
    this.socket.emit('profile', p);
  }
}
