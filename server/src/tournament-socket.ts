import {
  isRecord,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type TournamentCreated,
  type TournamentEntered,
  type TournamentExport,
} from '@domino/shared';
import type { Server, Socket } from 'socket.io';
import type { ClientCtx, TournamentService } from './tournaments';

export interface SocketData {
  roomId: string | null;
  playerId: string | null;
  /** Tournament this socket proved an identity in (and is subscribed to). */
  tournamentId: string | null;
}

export type DominoServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
export type DominoSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

function safeAck<T extends object = object>(ack: unknown): (r: Ack<T>) => void {
  return typeof ack === 'function' ? (ack as (r: Ack<T>) => void) : () => undefined;
}

export const tournamentChannel = (id: string) => `t:${id}`;

/** The client's address. Behind Caddy the real one is the last X-Forwarded-For entry. */
export function clientIp(socket: DominoSocket, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const last = raw?.split(',').at(-1)?.trim();
    if (last) return last;
  }
  return socket.handshake.address;
}

export function attachTournamentHandlers(
  socket: DominoSocket,
  service: TournamentService,
  ctx: ClientCtx,
): void {
  const unsubscribe = () => {
    const id = socket.data.tournamentId;
    if (id) void socket.leave(tournamentChannel(id));
    socket.data.tournamentId = null;
  };

  socket.on('tournament:create', (p, ack) => {
    const reply = safeAck<TournamentCreated>(ack);
    reply(service.create(isRecord(p) ? p.names : null, ctx));
  });

  socket.on('tournament:enter', (p, ack) => {
    const reply = safeAck<TournamentEntered>(ack);
    if (!isRecord(p)) {
      reply({ ok: false, code: 'NOT_FOUND' });
      return;
    }
    const res = service.enter({ id: p.id, name: p.name, token: p.token }, ctx);
    if (!res.ok || !res.id) {
      reply(res);
      return;
    }
    if (socket.data.tournamentId !== res.id) unsubscribe();
    socket.data.tournamentId = res.id;
    void socket.join(tournamentChannel(res.id));
    reply({ ok: true, id: res.id, token: res.token, you: res.you, view: res.view });
  });

  socket.on('tournament:list', (p, ack) => {
    safeAck(ack)(service.list(isRecord(p) ? p.ids : null, ctx));
  });

  socket.on('tournament:play', (ack) => {
    const reply = safeAck<{ roomId: string }>(ack);
    const id = socket.data.tournamentId;
    if (!id) {
      reply({ ok: false, code: 'NOT_AUTHENTICATED' });
      return;
    }
    reply(service.play(id));
  });

  socket.on('tournament:export', (ack) => {
    const reply = safeAck<{ data: TournamentExport }>(ack);
    const id = socket.data.tournamentId;
    const data = id ? service.export(id) : null;
    reply(data ? { ok: true, data } : { ok: false, code: id ? 'NOT_FOUND' : 'NOT_AUTHENTICATED' });
  });

  socket.on('tournament:leave', unsubscribe);

  socket.on('disconnect', () => service.forgetSocket(socket.id));
}
