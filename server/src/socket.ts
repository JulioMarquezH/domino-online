import {
  isSeat,
  isTarget,
  isTileId,
  isValidRoomId,
  normalizeRoomId,
  sanitizeName,
  type Ack,
  type ClientToServerEvents,
  type JoinOk,
  type RTCIceServerConfig,
  type ServerToClientEvents,
  type SignalPayload,
} from '@domino/shared';
import type { Server, Socket } from 'socket.io';
import { isValidToken, type Result, type Room } from './room';
import type { RoomManager } from './rooms';

interface SocketData {
  roomId: string | null;
  playerId: string | null;
}

export type DominoServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type DominoSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const MAX_SDP = 20_000;

function safeAck<T extends object>(ack: unknown): (r: Ack<T>) => void {
  return typeof ack === 'function' ? (ack as (r: Ack<T>) => void) : () => undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Sends every connected player their own view of the room (coalesced per tick). */
export function createBroadcaster(getIo: () => DominoServer) {
  const pending = new Set<Room>();
  return (room: Room) => {
    if (pending.has(room)) return;
    pending.add(room);
    queueMicrotask(() => {
      pending.delete(room);
      const io = getIo();
      for (const p of room.players) {
        if (p.socketId) io.to(p.socketId).emit('state', room.viewFor(p.id));
      }
    });
  };
}

export function attachSocketHandlers(
  io: DominoServer,
  manager: RoomManager,
  iceServersFor: (playerId: string) => RTCIceServerConfig[],
): void {
  io.on('connection', (socket: DominoSocket) => {
    socket.data.roomId = null;
    socket.data.playerId = null;

    const current = (): { room: Room; playerId: string } | null => {
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId) return null;
      const room = manager.get(roomId);
      const player = room?.getPlayer(playerId);
      if (!room || !player || player.socketId !== socket.id) return null;
      return { room, playerId };
    };

    const leaveCurrent = () => {
      const s = current();
      if (s) s.room.leave(s.playerId, socket.id);
      socket.data.roomId = null;
      socket.data.playerId = null;
    };

    const resync = () => {
      const s = current();
      if (s) socket.emit('state', s.room.viewFor(s.playerId));
    };

    /** Runs a room action for the caller; on rejection the client gets a fresh state. */
    const handle = (ack: unknown, fn: (room: Room, playerId: string) => Result) => {
      const reply = safeAck(ack);
      const s = current();
      if (!s) {
        reply({ ok: false, code: 'NOT_IN_ROOM' });
        return;
      }
      const result = fn(s.room, s.playerId);
      if (!result.ok) resync();
      reply(result.ok ? { ok: true } : { ok: false, code: result.code });
    };

    const enter = (
      room: Room,
      req: { name: string | null; token: string | null },
      reply: (r: Ack<JoinOk>) => void,
    ) => {
      const previous = current();
      if (previous && previous.room !== room) leaveCurrent();
      const result = room.join(req, socket.id);
      if (!result.ok) {
        reply({ ok: false, code: result.code });
        return;
      }
      const { player, previousSocketId } = result;
      if (previousSocketId && previousSocketId !== socket.id) {
        const old = io.sockets.sockets.get(previousSocketId);
        if (old) {
          old.data.roomId = null;
          old.data.playerId = null;
          old.emit('room:closed', { reason: 'replaced' });
        }
      }
      socket.data.roomId = room.id;
      socket.data.playerId = player.id;
      reply({
        ok: true,
        roomId: room.id,
        playerId: player.id,
        token: player.token,
        iceServers: iceServersFor(player.id),
      });
    };

    socket.on('room:create', (p, ack) => {
      const reply = safeAck<JoinOk>(ack);
      const name = sanitizeName(isRecord(p) ? p.name : null);
      if (!name) {
        reply({ ok: false, code: 'NAME_INVALID' });
        return;
      }
      const room = manager.create();
      enter(room, { name, token: null }, reply);
    });

    socket.on('room:join', (p, ack) => {
      const reply = safeAck<JoinOk>(ack);
      if (!isRecord(p) || typeof p.roomId !== 'string') {
        reply({ ok: false, code: 'NOT_FOUND' });
        return;
      }
      const roomId = normalizeRoomId(p.roomId);
      const room = isValidRoomId(roomId) ? manager.get(roomId) : undefined;
      if (!room) {
        reply({ ok: false, code: 'NOT_FOUND' });
        return;
      }
      const token = isValidToken(p.token) ? p.token : null;
      const name = typeof p.name === 'string' ? p.name : null;
      enter(room, { name, token }, reply);
    });

    socket.on('room:leave', () => leaveCurrent());

    socket.on('lobby:target', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) && isTarget(p.target)
          ? room.setTarget(id, p.target)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('lobby:mode', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) && (p.mode === 'sortear' || p.mode === 'manual')
          ? room.setTeamMode(id, p.mode)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('lobby:sit', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) && (p.seat === null || isSeat(p.seat))
          ? room.sit(id, p.seat)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('lobby:start', (ack) => handle(ack, (room, id) => room.start(id)));

    socket.on('draw:pick', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) && typeof p.position === 'number'
          ? room.pick(id, p.position)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('game:play', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) &&
        isTileId(p.tile) &&
        (p.end === 'left' || p.end === 'right') &&
        typeof p.v === 'number'
          ? room.play(id, p.tile, p.end, p.v)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('game:pass', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) && typeof p.v === 'number'
          ? room.pass(id, p.v)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('hand:ready', (ack) => handle(ack, (room, id) => room.markReady(id)));

    socket.on('pause:decide', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) &&
        typeof p.playerId === 'string' &&
        (p.decision === 'wait' || p.decision === 'end' || p.decision === 'replace')
          ? room.decide(id, p.playerId, p.decision)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('match:rematch', (p, ack) =>
      handle(ack, (room, id) =>
        isRecord(p) && typeof p.keepTeams === 'boolean'
          ? room.rematch(id, p.keepTeams)
          : { ok: false, code: 'INVALID' },
      ),
    );

    socket.on('voice:mic', (p) => {
      const s = current();
      if (s && isRecord(p) && (p.mic === 'on' || p.mic === 'muted' || p.mic === 'off')) {
        s.room.setMic(s.playerId, p.mic);
      }
    });

    // WebRTC signaling relay: only between players of the same room, to their current session.
    socket.on('rtc:signal', (p) => {
      const s = current();
      if (!s || !isRecord(p) || typeof p.to !== 'string' || typeof p.toSession !== 'string') return;
      const data = p.data;
      if (!isRecord(data)) return;
      if (JSON.stringify(data).length > MAX_SDP) return;
      const target = s.room.getPlayer(p.to);
      if (!target || target.socketId === null || target.socketId !== p.toSession) return;
      io.to(target.socketId).emit('rtc:signal', {
        from: s.playerId,
        fromSession: socket.id,
        data: data as SignalPayload,
      });
    });

    socket.on('disconnect', () => {
      const s = current();
      if (s) s.room.detach(s.playerId, socket.id);
    });
  });
}
