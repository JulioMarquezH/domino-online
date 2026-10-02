import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { TOURNAMENT_TARGET, type RTCIceServerConfig, type Rng, type Target } from '@domino/shared';
import { iceServersFor } from './config';
import { openDatabase, type Db } from './db/database';
import { TournamentStore } from './db/store';
import { cryptoRng } from './ids';
import type { Clock, Timings } from './room';
import { RoomManager } from './rooms';
import { attachSocketHandlers, createBroadcaster, type DominoServer } from './socket';
import { createStaticHandler } from './static';
import { tournamentChannel } from './tournament-socket';
import { TournamentService, type TournamentLimits } from './tournaments';

export interface AppOptions {
  iceServers: RTCIceServerConfig[];
  turn?: { urls: string[]; secret: string } | null;
  webDist?: string | null;
  timings?: Partial<Timings>;
  clock?: Clock;
  rng?: Rng;
  /** SQLite file for tournaments. `:memory:` (the default) is for tests only. */
  databasePath?: string;
  /**
   * Tournament match target. Defaults to the server constant (100); tests inject a smaller one
   * here. It is never read from client input.
   */
  tournamentTarget?: number;
  /** Trust X-Forwarded-For (only behind Caddy on the same host). */
  trustProxy?: boolean;
  limits?: Partial<TournamentLimits>;
}

export interface App {
  http: HttpServer;
  io: DominoServer;
  rooms: RoomManager;
  db: Db;
  store: TournamentStore;
  tournaments: TournamentService;
  close(): Promise<void>;
}

export function createApp(options: AppOptions): App {
  const serveStatic = options.webDist ? createStaticHandler(options.webDist) : null;
  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.url === '/_stats' && !isLocalRequest(req)) {
      res.writeHead(404).end(); // never reachable through Caddy
      return;
    }
    if (req.url === '/_stats') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          rooms: rooms.size,
          tournamentRooms: tournaments.liveRoomCount,
          sockets: io?.engine.clientsCount ?? 0,
        }),
      );
      return;
    }
    if (serveStatic) {
      void serveStatic(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  let io: DominoServer | null = null;
  const db = openDatabase(options.databasePath ?? ':memory:');
  const store = new TournamentStore(db, {
    now: () => new Date(options.clock?.now() ?? Date.now()).toISOString(),
    rng: options.rng ?? cryptoRng,
  });
  const tournaments: TournamentService = new TournamentService({
    store,
    getRooms: () => rooms,
    emit: (id, view) => io?.to(tournamentChannel(id)).emit('tournament:state', view),
    rng: options.rng ?? cryptoRng,
    target: (options.tournamentTarget ?? TOURNAMENT_TARGET) as Target,
    limits: options.limits,
  });
  const rooms: RoomManager = new RoomManager({
    clock: options.clock,
    timings: options.timings,
    rng: options.rng,
    onChange: createBroadcaster(() => io as DominoServer),
    onRemoved: (room) => tournaments.roomRemoved(room),
  });
  io = new Server(http, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  }) as DominoServer;
  attachSocketHandlers(
    io,
    rooms,
    (id) => iceServersFor({ iceServers: options.iceServers, turn: options.turn ?? null }, id),
    tournaments,
    { trustProxy: options.trustProxy ?? false },
  );

  return {
    http,
    io,
    rooms,
    db,
    store,
    tournaments,
    close: async () => {
      // Rooms first: a finished tournament match still waiting for its write gets a last try.
      rooms.dispose();
      await io.close();
      db.close();
    },
  };
}

/** Internal endpoints answer only to requests made from inside the container, never via Caddy. */
function isLocalRequest(req: import('node:http').IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  return loopback && req.headers['x-forwarded-for'] === undefined;
}
