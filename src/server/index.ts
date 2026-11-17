import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServer, IceServerConfig, ServerToClient } from '../shared/protocol';
import { RoomManager } from './manager';

/** How long TURN credentials handed to a client stay valid. Each (re)connection gets fresh ones. */
const TURN_TTL_SECONDS = 24 * 3600;

/**
 * Time-limited TURN credentials for coturn's `use-auth-secret` mode (the "TURN REST API"): the
 * username is the expiry time, the password an HMAC of it, so nothing permanent reaches browsers.
 */
export function turnCredentials(secret: string, user: string, ttlSeconds = TURN_TTL_SECONDS, now = Date.now()) {
  const username = `${Math.floor(now / 1000) + ttlSeconds}:${user}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') };
}

/** The ICE servers (STUN, TURN) to give one player, from the environment. */
export function iceServersFromEnv(env: NodeJS.ProcessEnv = process.env): (userId: string) => IceServerConfig[] {
  if (env.ICE_SERVERS_JSON) {
    try {
      const parsed = JSON.parse(env.ICE_SERVERS_JSON) as IceServerConfig[];
      if (Array.isArray(parsed)) return () => parsed;
    } catch {
      console.warn('[karta] ICE_SERVERS_JSON is not valid JSON, ignoring it');
    }
  }
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const stun = list(env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302');
  const base: IceServerConfig[] = stun.length ? [{ urls: stun }] : [];
  const turn = list(env.TURN_URLS);
  if (!turn.length) return () => base;
  const secret = env.TURN_SECRET;
  if (secret) return (userId) => [...base, { urls: turn, ...turnCredentials(secret, userId) }];
  const fixed = [...base, { urls: turn, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  return () => fixed;
}

export interface KartaServer {
  http: HttpServer;
  io: Server<ClientToServer, ServerToClient>;
  manager: RoomManager;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: { port?: number; staticDir?: string | null } = {}): Promise<KartaServer> {
  const app = express();
  app.disable('x-powered-by');
  const http = createHttpServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 256_000,
  });
  const manager = new RoomManager(io, { iceServers: iceServersFromEnv() });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ...manager.stats() });
  });
  app.get('/api/room/:code', (req, res) => {
    const room = manager.rooms.get(String(req.params.code).toUpperCase());
    if (!room) {
      res.status(404).json({ ok: false });
      return;
    }
    res.json({
      ok: true,
      code: room.code,
      game: room.settings.game,
      mode: room.settings.mode,
      phase: room.phase,
      players: room.seats.filter(Boolean).length,
      seats: room.seats.length,
    });
  });

  const staticDir = opts.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    // Single-page app: /room/ABCDE and friends all serve index.html.
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const port = await new Promise<number>((resolve) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0));
    });
  });

  return {
    http,
    io,
    manager,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        manager.stop();
        io.close(() => resolve());
      }),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = process.env.STATIC_DIR ?? path.resolve(here, '../client');
  const port = Number(process.env.PORT ?? 3000);
  startServer({ port, staticDir: process.env.NODE_ENV === 'production' || existsSync(staticDir) ? staticDir : null })
    .then((s) => {
      console.log(`[karta] listening on http://localhost:${s.port}`);
      const shutdown = () => {
        console.log('[karta] shutting down');
        void s.close().then(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
