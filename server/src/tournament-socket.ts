import {
  isLetter,
  isRecord,
  type RTCIceServerConfig,
  type SignalPayload,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type TournamentCreated,
  type TournamentEntered,
  type TournamentExport,
} from '@domino/shared';
import type { Server, Socket } from 'socket.io';
import type { TournamentVoice } from './tournament-voice';
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

const MAX_SIGNAL = 20_000;

export interface TournamentVoiceDeps {
  io: DominoServer;
  voice: TournamentVoice;
  iceServersFor: (id: string) => RTCIceServerConfig[];
}

export function attachTournamentHandlers(
  socket: DominoSocket,
  service: TournamentService,
  ctx: ClientCtx,
  deps: TournamentVoiceDeps,
): void {
  const { io, voice } = deps;
  const announce = (id: string | null) => {
    if (id) io.to(tournamentChannel(id)).emit('tvoice:members', { id, members: voice.members(id) });
  };
  const leaveCall = () => announce(voice.leave(socket.id));

  const unsubscribe = () => {
    const id = socket.data.tournamentId;
    if (id) void socket.leave(tournamentChannel(id));
    socket.data.tournamentId = null;
    leaveCall();
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
    if (!res.ok) {
      reply(res);
      return;
    }
    if (!res.id) {
      reply({ ok: false, code: 'NOT_FOUND' });
      return;
    }
    if (socket.data.tournamentId !== res.id) unsubscribe();
    socket.data.tournamentId = res.id;
    void socket.join(tournamentChannel(res.id));
    // Into the tournament's call; another device of the same player drops out of it.
    const replaced = voice.join(res.id, res.you.letter, socket.id);
    if (replaced) io.to(replaced).emit('tvoice:members', { id: res.id, members: [] });
    reply({
      ok: true,
      id: res.id,
      token: res.token,
      you: res.you,
      view: res.view,
      iceServers: deps.iceServersFor(`${res.id}:${res.you.letter}`),
    });
    announce(res.id);
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

  socket.on('tvoice:mic', (p) => {
    if (!isRecord(p) || (p.mic !== 'on' && p.mic !== 'muted' && p.mic !== 'off')) return;
    announce(voice.setMic(socket.id, p.mic));
  });

  // Signaling relay inside one tournament's call, only to the target's current session.
  socket.on('tvoice:signal', (p) => {
    const id = socket.data.tournamentId;
    if (!id || !isRecord(p) || !isLetter(p.to) || typeof p.toSession !== 'string') return;
    if (!isRecord(p.data) || JSON.stringify(p.data).length > MAX_SIGNAL) return;
    const from = voice.letterOf(id, socket.id);
    const target = voice.route(id, p.to, p.toSession);
    if (!from || !target) return;
    io.to(target).emit('tvoice:signal', {
      from,
      fromSession: socket.id,
      data: p.data as SignalPayload,
    });
  });

  socket.on('disconnect', () => {
    service.forgetSocket(socket.id);
    leaveCall();
  });
}
