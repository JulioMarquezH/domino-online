import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { RTCIceServerConfig, Rng } from '@domino/shared';
import { iceServersFor } from './config';
import type { Clock, Timings } from './room';
import { RoomManager } from './rooms';
import { attachSocketHandlers, createBroadcaster, type DominoServer } from './socket';
import { createStaticHandler } from './static';

export interface AppOptions {
  iceServers: RTCIceServerConfig[];
  turn?: { urls: string[]; secret: string } | null;
  webDist?: string | null;
  timings?: Partial<Timings>;
  clock?: Clock;
  rng?: Rng;
}

export interface App {
  http: HttpServer;
  io: DominoServer;
  rooms: RoomManager;
  close(): Promise<void>;
}

export function createApp(options: AppOptions): App {
  const serveStatic = options.webDist ? createStaticHandler(options.webDist) : null;
  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (serveStatic) {
      void serveStatic(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  let io: DominoServer | null = null;
  const rooms = new RoomManager({
    clock: options.clock,
    timings: options.timings,
    rng: options.rng,
    onChange: createBroadcaster(() => io as DominoServer),
  });
  io = new Server(http, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  }) as DominoServer;
  attachSocketHandlers(io, rooms, (id) =>
    iceServersFor({ iceServers: options.iceServers, turn: options.turn ?? null }, id),
  );

  return {
    http,
    io,
    rooms,
    close: async () => {
      rooms.dispose();
      await io.close();
    },
  };
}
