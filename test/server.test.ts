import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { legalMovesFor } from '../src/shared/chkobba';
import { legalCards } from '../src/shared/belote';
import { SUITS } from '../src/shared/cards';
import { DEFAULT_SETTINGS } from '../src/shared/protocol';
import {
  type ChatMessage,
  type ChkobbaView,
  type GameView,
  type ClientToServer,
  type GameEvent,
  type RoomView,
  type ServerToClient,
  type Welcome,
  isCharacter,
  isCrew,
  isDrink,
  isSkin,
} from '../src/shared/protocol';
import { type KartaServer, startServer } from '../src/server/index';
import { SIP_TIMING, TIMING } from '../src/server/room';
import { createTable } from '../src/server/tables';
import { seededRandom } from '../src/shared/cards';

type ClientSocket = Socket<ServerToClient, ClientToServer>;

class TestClient {
  socket: ClientSocket;
  room: RoomView | null = null;
  events: GameEvent[] = [];
  chats: ChatMessage[] = [];
  emotes: { from: string; id: string }[] = [];
  sips: string[] = [];
  signals: { from: string; data: unknown }[] = [];
  left: string | null = null;
  welcome: Welcome | null = null;
  private listeners = new Set<() => void>();

  constructor(url: string, readonly secret: string, readonly name: string, look: Record<string, unknown> = {}) {
    this.socket = ioClient(url, {
      auth: { secret, name, color: 1, ...look },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    this.socket.on('sip', (p) => {
      this.sips.push(p.from);
      this.notify();
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
const client = (secret: string, name: string, look?: Record<string, unknown>) => {
  const c = new TestClient(url, secret.padEnd(24, 'x'), name, look);
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

/** What changes whenever someone acts. */
function stateKey(g: GameView | null | undefined): string {
  if (!g) return '';
  return JSON.stringify(g.kind === 'chkobba' ? g.table : [g.trick, g.bids.length, g.stage, g.round, g.tricksWon]) + g.turn;
}

/** Plays a random legal action for `actor`, whatever the game. */
async function randomAction(actor: TestClient) {
  const g = actor.room!.game!;
  const seat = actor.room!.you.seat!;
  const before = actor.events.length;
  if (g.kind === 'belote') {
    if (g.stage === 'bidding') {
      const up = g.upCard!.suit;
      const options = g.bidRound === 1 ? [up] : SUITS.filter((x) => x !== up);
      const suit = Math.random() < 0.35 ? options[Math.floor(Math.random() * options.length)]! : null;
      expect(await actor.call('bid', { suit })).toEqual({ ok: true });
    } else {
      const legal = legalCards(g.myHand!, g.trick, g.trump!, seat);
      expect(legal.length).toBeGreaterThan(0);
      expect(await actor.call('play', { cardId: legal[Math.floor(Math.random() * legal.length)]!.id })).toEqual({ ok: true });
    }
  } else {
    const moves = legalMovesFor(g.myHand!, g.table);
    expect(moves.length).toBeGreaterThan(0);
    const move = moves[Math.floor(Math.random() * moves.length)]!;
    expect(await actor.call('play', move)).toEqual({ ok: true });
  }
  await actor.waitFor(() => actor.events.length > before, 4000, 'action event');
}

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
      const before = stateKey(view.game);
      await players[0]!.waitFor(() => stateKey(players[0]!.room!.game) !== before || players[0]!.room!.phase !== 'playing', 4000, 'bot move');
      continue;
    }
    await randomAction(actor);
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
    // Back within the grace period, so nobody plays for Eve meanwhile (the shrunk test timings would let the
    // autopilot race her reconnection).
    const grace = TIMING.autopilotGrace;
    TIMING.autopilotGrace = 10_000;
    onTestFinished(() => {
      TIMING.autopilotGrace = grace;
    });
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

  it('drops a member from voice when they come back on a new connection, so the others start fresh', async () => {
    const a = client('rami-secret', 'Rami');
    const code = (await a.call<{ ok: boolean; code: string }>('create', {})).code;
    const b = client('sara-secret', 'Sara');
    await b.call('join', { code });
    await a.waitFor(() => a.room?.seats[1]);
    expect(await a.call('voice:join', { muted: false })).toEqual({ ok: true });
    expect(await b.call('voice:join', { muted: false })).toEqual({ ok: true });
    await a.waitFor(() => a.room!.voice.length === 2, 4000, 'voice list');

    // Sara's phone switches networks: a new connection re-attaches before the old one is known to be dead.
    const b2 = client('sara-secret', 'Sara');
    expect(await b2.call('join', { code })).toMatchObject({ ok: true });
    await a.waitFor(() => a.room!.voice.length === 1, 4000, 'stale voice entry dropped');
    expect(b2.room!.voice.map((v) => v.id)).toEqual([a.room!.you.id]);

    expect(await b2.call('voice:join', { muted: false })).toEqual({ ok: true });
    await a.waitFor(() => a.room!.voice.length === 2, 4000, 'voice rejoined');
    // Joining the same table again on the same connection keeps the voice session.
    expect(await b2.call('join', { code })).toMatchObject({ ok: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(a.room!.voice).toHaveLength(2);
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

  it('sends the turn deadline with each human turn, and the next-hand time with the results', async () => {
    const a = client('rosa-secret', 'Rosa');
    const code = (await a.call<{ ok: boolean; code: string }>('create', { settings: { turnSeconds: 15 } })).code;
    const b = client('sami-secret', 'Sami');
    await b.call('join', { code });
    await a.waitFor(() => a.room?.seats[1], 4000, 'both seated');
    // Keep every view: with the test timings the results screen only lasts a moment.
    const views: RoomView[] = [];
    a.socket.on('room', (m) => views.push(m.room));
    expect(await a.call('start')).toEqual({ ok: true });

    // The first turn comes with its deadline, for the player to move and for the opponent.
    for (const c of [a, b]) {
      const view = await c.waitFor(() => c.room?.phase === 'playing' && c.room, 4000, 'deal');
      expect(view.game!.turnDeadline).toBeGreaterThan(view.serverTime + 14_000);
      expect(view.game!.turnDeadline).toBeLessThanOrEqual(view.serverTime + 16_000);
    }

    // Once the first player moves, the other one gets a deadline of their own.
    const first = a.room!.game!;
    const mover = first.turn === a.room!.you.seat ? a : b;
    const g = mover.room!.game as ChkobbaView;
    expect(await mover.call('play', legalMovesFor(g.myHand!, g.table)[0])).toEqual({ ok: true });
    const next = await a.waitFor(() => a.room!.game!.turn !== first.turn && a.room, 4000, 'next turn');
    expect(next.game!.turnDeadline).toBeGreaterThan(first.turnDeadline!);

    // The results screen counts down to the next hand.
    await playUntil([a, b], () => views.some((v) => v.phase !== 'playing'));
    const results = views.find((v) => v.phase === 'roundOver')!;
    expect(results.game!.nextRoundAt).toBeGreaterThan(results.serverTime);
  }, 60_000);

  it('shares characters and drinks, and relays sips to the rest of the table', async () => {
    const a = client('lina-secret', 'Lina', { character: 'hajj', skin: 2, drink: 'chicha' });
    const b = client('omar-secret', 'Omar'); // an older client: no look in the handshake
    const spec = client('pia-secret', 'Pia', { character: 'nejma', skin: 1, drink: 'tea' });
    const code = (await a.call<{ ok: boolean; code: string }>('create', {})).code;
    expect(await b.call('join', { code })).toMatchObject({ ok: true });
    expect(await spec.call('join', { code, spectate: true })).toMatchObject({ ok: true });
    await a.waitFor(() => a.room?.seats[1] && a.room.spectators.length === 1, 4000, 'everyone in');
    const aId = a.room!.you.id;
    const bId = b.room!.you.id;
    const specId = spec.room!.you.id;

    expect(a.room!.seats[0]).toMatchObject({ character: 'hajj', skin: 2, drink: 'chicha' });
    expect(a.room!.spectators[0]).toMatchObject({ character: 'nejma', skin: 1, drink: 'tea' });
    // Without a look, players still get a valid one.
    const omar = a.room!.seats[1]!;
    expect(isCharacter(omar.character) && isSkin(omar.skin) && isDrink(omar.drink)).toBe(true);

    // Profile changes reach the table; invalid fields are ignored.
    let version = a.room!.version;
    b.socket.emit('profile', { name: 'Omar', color: 1, character: 'nejma', skin: 4, drink: 'coke' });
    await a.waitFor(() => a.room!.version > version, 4000, 'new order');
    expect(a.room!.seats[1]).toMatchObject({ character: 'nejma', skin: 4, drink: 'coke' });
    version = a.room!.version;
    b.socket.emit('profile', { name: 'Omar', character: 'dragon', skin: 99, drink: 'whisky', color: -3 } as never);
    await a.waitFor(() => a.room!.version > version, 4000, 'profile broadcast');
    expect(a.room!.seats[1]).toMatchObject({ character: 'nejma', skin: 4, drink: 'coke' });
    // One of the crew, with their name.
    version = a.room!.version;
    b.socket.emit('profile', { name: 'Gratos', color: 1, character: 'gratos', skin: 4, drink: 'coke' });
    await a.waitFor(() => a.room!.version > version, 4000, 'crew look');
    expect(a.room!.seats[1]).toMatchObject({ name: 'Gratos', character: 'gratos' });

    // A sip reaches everyone else, not the sipper; a second sip right away is dropped.
    a.socket.emit('sip');
    a.socket.emit('sip');
    a.socket.emit('chat', { text: 'after the sips' });
    await b.waitFor(() => b.chats.find((m) => m.text === 'after the sips'), 4000, 'chat after sips');
    await spec.waitFor(() => spec.chats.find((m) => m.text === 'after the sips'), 4000, 'spectator chat');
    expect(b.sips.filter((id) => id === aId)).toHaveLength(1);
    expect(spec.sips.filter((id) => id === aId)).toHaveLength(1);
    expect(a.sips).not.toContain(aId);

    // Spectators have no seat at the table, so no drink to sip.
    spec.socket.emit('sip');
    spec.socket.emit('chat', { text: 'watching' });
    await a.waitFor(() => a.chats.find((m) => m.text === 'watching'), 4000, 'spectator chat');
    expect(a.sips).not.toContain(specId);

    b.socket.emit('sip');
    await a.waitFor(() => a.sips.includes(bId), 4000, 'sip from Omar');
  });

  it('lets bots sip their drinks now and then', async () => {
    const saved = { ...SIP_TIMING };
    SIP_TIMING.botTick = 30;
    SIP_TIMING.botChance = 1;
    try {
      const host = client('quinn-secret', 'Quinn');
      await host.call('create', {});
      await host.waitFor(() => host.room, 4000, 'room');
      expect(await host.call('addBot', { seat: 1 })).toEqual({ ok: true });
      const bot = await host.waitFor(() => host.room!.seats[1], 4000, 'bot seated');
      expect(isCharacter(bot.character) && isSkin(bot.skin) && isDrink(bot.drink)).toBe(true);
      expect(isCrew(bot.character)).toBe(false);
      await host.waitFor(() => host.sips.includes(bot.id), 4000, 'bot sip');
    } finally {
      Object.assign(SIP_TIMING, saved);
    }
  });
  it('switches a table to Belote: 2 vs 2, its own targets, announcements on or off', async () => {
    const host = client('belo-secret', 'Belo');
    await host.call('create', { settings: { game: 'belote' } });
    await host.waitFor(() => host.room?.settings.game === 'belote' && host.room.seats.length === 4, 4000, 'belote room');
    expect(host.room!.settings).toMatchObject({ game: 'belote', mode: '2v2', targetScore: 501, announcements: true });
    expect((await host.call('settings', { mode: '1v1' })).ok).toBe(false);
    expect((await host.call('settings', { targetScore: 21 })).ok).toBe(false);
    expect(await host.call('settings', { targetScore: 1001, announcements: false })).toEqual({ ok: true });
    await host.waitFor(() => host.room!.settings.targetScore === 1001 && !host.room!.settings.announcements, 4000, 'settings');
    // Back to Chkobba: its own default target, and the table keeps its four seats.
    expect(await host.call('settings', { game: 'chkobba' })).toEqual({ ok: true });
    await host.waitFor(() => host.room!.settings.game === 'chkobba', 4000, 'chkobba');
    expect(host.room!.settings).toMatchObject({ mode: '2v2', targetScore: 21 });
    expect((await host.call('settings', { game: 'poker' })).ok).toBe(false);
  });

  it('plays a Belote game to the end with two players and two bots, keeping hands private', async () => {
    const a = client('bel-a-secret', 'Amira');
    const b = client('bel-b-secret', 'Bilel');
    const spec = client('bel-s-secret', 'Sana');
    const code = (await a.call<{ ok: boolean; code: string }>('create', { settings: { game: 'belote' } })).code;
    expect(await b.call('join', { code })).toMatchObject({ ok: true });
    await a.waitFor(() => a.room?.seats[1], 4000, 'Bilel seated');
    for (const seat of [2, 3]) expect(await a.call('addBot', { seat })).toEqual({ ok: true });
    expect(await spec.call('join', { code, spectate: true })).toMatchObject({ ok: true });
    await a.waitFor(() => a.room!.seats.every(Boolean) && a.room!.spectators.length === 1, 4000, 'table full');
    expect(await a.call('start')).toEqual({ ok: true });

    const belote = (c: TestClient) => (c.room?.game?.kind === 'belote' ? c.room.game : null);
    const dealt = await a.waitFor(() => belote(a)?.myHand?.length === 5 && belote(a), 4000, 'deal');
    await b.waitFor(() => belote(b)?.myHand?.length === 5, 4000, 'deal for Bilel');
    await spec.waitFor(() => belote(spec), 4000, 'spectator view');
    expect(dealt.stage).toBe('bidding');
    expect(dealt.stockCount).toBe(11);
    expect(dealt.upCard).not.toBeNull();
    expect(belote(spec)!.myHand).toBeNull();
    // Hands are private: nobody else sees Amira's cards.
    const others = JSON.stringify(b.room) + JSON.stringify(b.events) + JSON.stringify(spec.room) + JSON.stringify(spec.events);
    for (const card of dealt.myHand!) expect(others).not.toContain(`"id":"${card.id}"`);

    // Out of turn, or a card during the bidding: refused.
    const g = belote(a)!;
    const waiting = g.turn === a.room!.you.seat ? b : g.turn === b.room!.you.seat ? a : a;
    if (g.turn !== waiting.room!.you.seat) expect((await waiting.call('bid', { suit: null })).ok).toBe(false);
    expect((await a.call('play', { cardId: dealt.myHand![0]!.id })).ok).toBe(false);

    // Play on; once, try a card the rules forbid.
    let refused = '';
    for (let step = 0; step < 3000 && a.room!.phase !== 'gameOver'; step++) {
      const version = a.room!.version;
      for (const p of [a, b]) await p.waitFor(() => p.room!.version >= version, 4000, 'sync');
      const view = a.room!;
      if (view.phase === 'roundOver') {
        const round = view.game!.round;
        for (const p of [a, b]) p.socket.emit('continue');
        await a.waitFor(() => a.room!.phase !== 'roundOver' || a.room!.game!.round !== round, 4000, 'next hand');
        continue;
      }
      if (view.phase !== 'playing') break;
      const actor = [a, b].find((p) => p.room!.you.seat === view.game!.turn);
      if (!actor) {
        const before = stateKey(view.game);
        await a.waitFor(() => stateKey(a.room!.game) !== before || a.room!.phase !== 'playing', 4000, 'bot move');
        continue;
      }
      const mine = belote(actor)!;
      if (!refused && mine.stage === 'playing' && mine.trick.length > 0) {
        const legal = new Set(legalCards(mine.myHand!, mine.trick, mine.trump!, actor.room!.you.seat!).map((c) => c.id));
        const bad = mine.myHand!.find((c) => !legal.has(c.id));
        if (bad) {
          const res = await actor.call<{ ok: boolean; error?: string }>('play', { cardId: bad.id });
          expect(res.ok).toBe(false);
          refused = res.error ?? '';
        }
      }
      await randomAction(actor);
    }
    expect(a.room!.phase).toBe('gameOver');
    expect(refused).toMatch(/must/);
    const fin = belote(a)!;
    expect(fin.winner).not.toBeNull();
    expect(Math.max(...fin.scores)).toBeGreaterThanOrEqual(501);
    expect(fin.lastRound).not.toBeNull();
    await spec.waitFor(() => spec.room?.phase === 'gameOver', 4000, 'spectator sees the end');
    // Spectators never get cards of their own; every event kind of a Belote hand went by.
    const kinds = new Set(spec.events.map((e) => e.kind));
    for (const k of ['beloteDeal', 'beloteBid', 'beloteTake', 'belotePlay', 'beloteTrick', 'beloteEnd']) expect(kinds.has(k as never)).toBe(true);
    for (const e of spec.events) if (e.kind === 'beloteDeal' || e.kind === 'beloteTake') expect(e.myCards).toBeNull();
  }, 60_000);

  it('passes for a Belote player whose time runs out in the bidding, and plays for them in the tricks', () => {
    const table = createTable({ ...DEFAULT_SETTINGS, game: 'belote', mode: '2v2', targetScore: 501 }, 4, seededRandom(4));
    table.startRound();
    const seat = table.turn;
    expect(table.autoAction(seat, 'normal', seededRandom(1), 'timeout')).toEqual({ type: 'bid', suit: null });
    const names = { seat: () => 'x', team: () => 'y' };
    // Bots bid at their level; someone takes eventually (or the cards are dealt again).
    for (let i = 0; i < 40 && table.view(null).kind === 'belote' && (table.view(null) as { stage: string }).stage === 'bidding'; i++) {
      table.act(table.turn, table.autoAction(table.turn, 'normal', seededRandom(i), 'bot'), true, names);
    }
    const view = table.view(table.turn);
    expect(view.kind === 'belote' && view.stage).toBe('playing');
    const auto = table.autoAction(table.turn, 'normal', seededRandom(2), 'timeout');
    expect(auto.type).toBe('play');
    expect(() => table.act(table.turn, auto, true, names)).not.toThrow();
  });
});
