import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { legalMovesFor } from '../src/shared/chkobba';
import type {
  ChatMessage,
  ClientToServer,
  GameEvent,
  RoomView,
  ServerToClient,
  Welcome,
} from '../src/shared/protocol';
import { type KartaServer, startServer } from '../src/server/index';
import { TIMING } from '../src/server/room';

type ClientSocket = Socket<ServerToClient, ClientToServer>;

class TestClient {
  socket: ClientSocket;
  room: RoomView | null = null;
  events: GameEvent[] = [];
  chats: ChatMessage[] = [];
  emotes: { from: string; id: string }[] = [];
  signals: { from: string; data: unknown }[] = [];
  left: string | null = null;
  welcome: Welcome | null = null;
  private listeners = new Set<() => void>();

  constructor(url: string, readonly secret: string, readonly name: string) {
    this.socket = ioClient(url, {
      auth: { secret, name, color: 1 },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    this.socket.on('welcome', (w) => {
      this.welcome = w;
      this.notify();
    });
    this.socket.on('room', (m) => {
      this.room = m.room;
      this.events.push(...m.events);
      this.notify();
    });
    this.socket.on('chat', (m) => {
      this.chats.push(m);
      this.notify();
    });
    this.socket.on('emote', (e) => {
      this.emotes.push(e);
      this.notify();
    });
    this.socket.on('voice:signal', (s) => {
      this.signals.push(s);
      this.notify();
    });
    this.socket.on('left', (p) => {
      this.left = p.reason;
      this.notify();
    });
  }

  private notify() {
    for (const l of [...this.listeners]) l();
  }

  waitFor<T>(check: () => T | null | undefined | false, timeout = 4000, label = 'condition'): Promise<T> {
    return new Promise((resolve, reject) => {
      const tryIt = () => {
        const v = check();
        if (v) {
          cleanup();
          resolve(v);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${label} (${this.name})`));
      }, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(tryIt);
      };
      this.listeners.add(tryIt);
      tryIt();
    });
  }

  call<R = { ok: boolean; error?: string }>(event: string, payload?: unknown): Promise<R> {
    return new Promise((resolve) => {
      const s = this.socket as unknown as { emit: (...a: unknown[]) => void };
      if (payload === undefined) s.emit(event, resolve);
      else s.emit(event, payload, resolve);
    });
  }

  close() {
    this.socket.close();
  }
}

let server: KartaServer;
let url: string;
const clients: TestClient[] = [];
const client = (secret: string, name: string) => {
  const c = new TestClient(url, secret.padEnd(24, 'x'), name);
  clients.push(c);
  return c;
};

beforeAll(async () => {
  // Speed the pacing up for tests.
  for (const k of Object.keys(TIMING) as (keyof typeof TIMING)[]) TIMING[k] = 1;
  TIMING.roundPause = 50;
  server = await startServer({ port: 0, staticDir: null });
  url = `http://localhost:${server.port}`;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

async function playUntil(players: TestClient[], stop: () => boolean, maxSteps = 2000) {
  for (let step = 0; step < maxSteps && !stop(); step++) {
    // Everyone must have seen the same broadcast before deciding who acts.
    const version = players[0]!.room!.version;
    for (const p of players) await p.waitFor(() => p.room!.version >= version, 4000, 'sync');
    const view = players[0]!.room!;
    if (view.phase === 'roundOver') {
      const round = view.game!.round;
      for (const p of players) p.socket.emit('continue');
      await players[0]!.waitFor(() => players[0]!.room!.phase !== 'roundOver' || players[0]!.room!.game!.round !== round, 4000, 'next hand');
      continue;
    }
    if (view.phase !== 'playing') return;
    const turn = view.game!.turn;
    const actor = players.find((p) => p.room!.you.seat === turn);
    if (!actor) {
      // A bot (or autopilot) is to move: wait for the state to change.
      const before = JSON.stringify(view.game!.table) + view.game!.turn;
      await players[0]!.waitFor(
        () => JSON.stringify(players[0]!.room!.game?.table) + players[0]!.room!.game?.turn !== before || players[0]!.room!.phase !== 'playing',
        4000,
        'bot move',
      );
      continue;
    }
    const g = actor.room!.game!;
    const moves = legalMovesFor(g.myHand!, g.table);
    expect(moves.length).toBeGreaterThan(0);
    const move = moves[Math.floor(Math.random() * moves.length)]!;
    const before = actor.events.length;
    const res = await actor.call('play', move);
    expect(res).toEqual({ ok: true });
    await actor.waitFor(() => actor.events.length > before, 4000, 'play event');
  }
}

describe('server', () => {
  it('creates a room, seats players, plays a full 1v1 game with a spectator watching', async () => {
    const a = client('alice-secret', 'Alice');
    const b = client('bob-secret', 'Bob');
    const spec = client('carol-secret', 'Carol');
    await a.waitFor(() => a.welcome, 4000, 'welcome');
    expect(a.welcome!.iceServers.length).toBeGreaterThan(0);

    const created = await a.call<{ ok: boolean; code: string }>('create', { settings: { mode: '1v1', targetScore: 11 } });
    expect(created.ok).toBe(true);
    const code = created.code;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    await a.waitFor(() => a.room?.code === code);
    expect(a.room!.hostId).toBe(a.welcome!.id);
    expect(a.room!.you.seat).toBe(0);
    expect(a.room!.settings.targetScore).toBe(11);

    expect(await b.call('join', { code: code.toLowerCase() })).toMatchObject({ ok: true });
    await b.waitFor(() => b.room?.you.seat === 1);
    expect(await spec.call('join', { code, spectate: true })).toMatchObject({ ok: true });
    await spec.waitFor(() => spec.room?.spectators.length === 1);
    expect(spec.room!.you.seat).toBeNull();

    // Only the host can start, and a full table is required.
    expect((await b.call('start')).ok).toBe(false);
    expect(await a.call('start')).toEqual({ ok: true });
    await a.waitFor(() => a.room?.phase === 'playing' && a.room.game?.myHand?.length === 3, 4000, 'deal');
    await b.waitFor(() => b.room?.game?.myHand?.length === 3);
    await spec.waitFor(() => spec.room?.game);
    expect(spec.room!.game!.myHand).toBeNull();
    const specDeal = spec.events.find((e) => e.kind === 'deal');
    expect(specDeal && specDeal.kind === 'deal' && specDeal.myCards).toBeNull();
    const aDeal = a.events.find((e) => e.kind === 'deal');
    expect(aDeal && aDeal.kind === 'deal' && aDeal.myCards?.length).toBe(3);
    // Hands are private.
    const bJson = JSON.stringify(b.room) + JSON.stringify(b.events) + JSON.stringify(spec.room) + JSON.stringify(spec.events);
    for (const card of a.room!.game!.myHand!) expect(bJson).not.toContain(`"id":"${card.id}"`);
    expect(b.room!.game!.handCounts[0]).toBe(3);

    // Spectators cannot play; players cannot play out of turn.
    const g = a.room!.game!;
    expect((await spec.call('play', { cardId: '1D', capture: [] })).ok).toBe(false);
    const notTurn = g.turn === 0 ? b : a;
    const nt = notTurn.room!.game!;
    expect((await notTurn.call('play', { cardId: nt.myHand![0]!.id, capture: [] })).ok).toBe(false);

    // Chat and emotes reach everyone.
    a.socket.emit('chat', { text: '  Yalla   bina!  ' });
    await spec.waitFor(() => spec.chats.find((m) => m.text === 'Yalla bina!'), 4000, 'chat');
    b.socket.emit('emote', { id: 'sahha' });
    await a.waitFor(() => a.emotes.find((e) => e.id === 'sahha'), 4000, 'emote');

    await playUntil([a, b], () => a.room!.phase === 'gameOver');
    expect(a.room!.phase).toBe('gameOver');
    const fin = a.room!.game!;
    expect(fin.winner).not.toBeNull();
    expect(Math.max(...fin.scores)).toBeGreaterThanOrEqual(11);
    await spec.waitFor(() => spec.room?.phase === 'gameOver', 4000, 'spectator sees game over');

    // Rematch restarts with the same seats.
    expect(await a.call('rematch')).toEqual({ ok: true });
    await a.waitFor(() => a.room?.phase === 'playing' && a.room.game?.round === 1 && a.room.game.scores[0] === 0);
    expect(await a.call('toLobby')).toEqual({ ok: true });
    await b.waitFor(() => b.room?.phase === 'lobby');
  }, 60_000);

  it('restores a seat and hand after reconnecting', async () => {
    const a = client('dora-secret', 'Dora');
    const created = await a.call<{ ok: boolean; code: string }>('create', {});
    const code = created.code;
    const b1 = client('eve-secret', 'Eve');
    await b1.call('join', { code });
    await b1.waitFor(() => b1.room?.you.seat === 1);
    await a.call('start');
    await b1.waitFor(() => b1.room?.game?.myHand?.length === 3);
    const hand = b1.room!.game!.myHand!.map((c) => c.id).sort();
    b1.close();
    await a.waitFor(() => a.room!.seats[1] && !a.room!.seats[1].connected, 4000, 'disconnect seen');

    const b2 = client('eve-secret', 'Eve');
    expect(await b2.call('join', { code })).toMatchObject({ ok: true });
    await b2.waitFor(() => b2.room?.game?.myHand);
    expect(b2.room!.you.seat).toBe(1);
    expect(b2.room!.game!.myHand!.map((c) => c.id).sort()).toEqual(hand);
    await a.waitFor(() => a.room!.seats[1]?.connected, 4000, 'reconnect seen');
  });

  it('relays voice signaling only between voice members of the same room', async () => {
    const a = client('fred-secret', 'Fred');
    const code = (await a.call<{ ok: boolean; code: string }>('create', {})).code;
    const b = client('gina-secret', 'Gina');
    await b.call('join', { code });
    await a.waitFor(() => a.room?.seats[1]);
    const aId = a.room!.you.id;
    const bId = b.room!.you.id;

    a.socket.emit('voice:signal', { to: bId, data: { sdp: 'nope' } });
    expect(await a.call('voice:join', { muted: false })).toEqual({ ok: true });
    expect(await b.call('voice:join', { muted: true })).toEqual({ ok: true });
    await a.waitFor(() => a.room!.voice.length === 2, 4000, 'voice list');
    expect(a.room!.voice.find((v) => v.id === bId)?.muted).toBe(true);

    a.socket.emit('voice:signal', { to: bId, data: { sdp: 'offer' } });
    const sig = await b.waitFor(() => b.signals.find((s) => (s.data as { sdp: string }).sdp === 'offer'), 4000, 'signal');
    expect(sig.from).toBe(aId);
    expect(b.signals.some((s) => (s.data as { sdp: string }).sdp === 'nope')).toBe(false);

    b.socket.emit('voice:mute', { muted: false });
    await a.waitFor(() => a.room!.voice.find((v) => v.id === bId)?.muted === false, 4000, 'unmute');
    b.socket.emit('voice:leave');
    await a.waitFor(() => a.room!.voice.length === 1, 4000, 'voice leave');
  });

  it('lets the host fill seats with bots, and bots play a 2v2 game', async () => {
    const host = client('hana-secret', 'Hana');
    const code = (await host.call<{ ok: boolean; code: string }>('create', { settings: { mode: '2v2', targetScore: 11 } })).code;
    await host.waitFor(() => host.room?.seats.length === 4);
    for (const seat of [1, 2, 3]) expect(await host.call('addBot', { seat })).toEqual({ ok: true });
    await host.waitFor(() => host.room!.seats.every((s) => s));
    expect(host.room!.seats.filter((s) => s?.bot)).toHaveLength(3);
    const watcher = client('ivan-secret', 'Ivan');
    await watcher.call('join', { code });
    await watcher.waitFor(() => watcher.room?.you && watcher.room.spectators.length === 1);
    expect(await host.call('start')).toEqual({ ok: true });
    await playUntil([host, watcher].filter((c) => c === host), () => host.room!.phase === 'gameOver' || (host.room!.game?.round ?? 0) >= 2, 5000);
    expect((host.room!.game?.round ?? 0) >= 2 || host.room!.phase === 'gameOver').toBe(true);
    expect(watcher.room!.game!.myHand).toBeNull();
  }, 60_000);

  it('handles kick, seat changes, settings and bad input', async () => {
    const host = client('jade-secret', 'Jade');
    const code = (await host.call<{ ok: boolean; code: string }>('create', {})).code;
    const p = client('kim-secret', 'Kim');
    await p.call('join', { code });
    await p.waitFor(() => p.room?.you.seat === 1);

    expect((await p.call('settings', { mode: '2v2' })).ok).toBe(false);
    expect(await host.call('settings', { mode: '2v2', turnSeconds: 30 })).toEqual({ ok: true });
    await p.waitFor(() => p.room!.seats.length === 4 && p.room!.settings.turnSeconds === 30);
    expect((await host.call('settings', { targetScore: 99 })).ok).toBe(false);
    expect(await p.call('sit', { seat: 2 })).toEqual({ ok: true });
    await host.waitFor(() => host.room!.seats[2]?.name === 'Kim');
    expect((await p.call('sit', { seat: 0 })).ok).toBe(false);
    expect(await host.call('settings', { mode: '1v1' })).toEqual({ ok: true });
    await p.waitFor(() => p.room!.seats.length === 2);
    // Kim was on seat 2: shrinking keeps humans seated.
    expect(p.room!.you.seat).not.toBeNull();

    expect((await p.call('join', { code: 'ZZ' })).ok).toBe(false);
    expect((await p.call('join', { code: 'QQQQQ' })).ok).toBe(false);

    expect(await host.call('kick', { playerId: p.room!.you.id })).toEqual({ ok: true });
    await p.waitFor(() => p.left === 'kicked', 4000, 'kicked');
    expect((await p.call('join', { code })).ok).toBe(false);
  });
});
