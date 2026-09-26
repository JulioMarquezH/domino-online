import type { PauseEntry, RoomView } from '@domino/shared';
import { actions } from '../net/client';
import { roomUrl } from '../net/router';
import { useCopied, useCountdown } from '../ui/hooks';
import { derive, formatClock } from './derive';

export function PauseOverlay({ view }: { view: RoomView }) {
  const d = derive(view);
  const isHost = d.me?.isHost ?? false;
  return (
    <div className="overlay pause-overlay" role="alertdialog" aria-label="Juego en pausa">
      <div className="card overlay-card">
        <p className="eyebrow">Juego en pausa</p>
        {view.pause.map((p) => (
          <PauseRow
            key={`${p.playerId}:${p.expired}:${p.replaceable}`}
            entry={p}
            isHost={isHost}
            hostName={d.host?.name ?? 'el anfitrión'}
            roomId={view.roomId}
          />
        ))}
      </div>
    </div>
  );
}

function PauseRow({
  entry,
  isHost,
  hostName,
  roomId,
}: {
  entry: PauseEntry;
  isHost: boolean;
  hostName: string;
  roomId: string;
}) {
  const left = useCountdown(entry.expired ? null : entry.remainingMs);
  const [copied, copy] = useCopied();
  return (
    <div className="pause-row">
      <h2 className="title">{entry.name} se desconectó, esperando…</h2>
      {!entry.expired && left !== null && (
        <p className="countdown" aria-live="off">
          {formatClock(left)}
        </p>
      )}
      {entry.expired && entry.replaceable && (
        <div className="replace-box">
          <p>
            El próximo que entre con el código <strong>{roomId}</strong> ocupará su puesto, con sus
            fichas y su pareja.
          </p>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => copy(roomUrl(roomId))}
          >
            {copied ? 'Enlace copiado' : 'Copiar enlace'}
          </button>
        </div>
      )}
      {entry.expired &&
        (isHost ? (
          <div className="decide-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => void actions.decide(entry.playerId, 'wait')}
            >
              Esperar más
            </button>
            {!entry.replaceable && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => void actions.decide(entry.playerId, 'replace')}
              >
                Permitir reemplazo
              </button>
            )}
            <button
              type="button"
              className="btn danger"
              onClick={() => void actions.decide(entry.playerId, 'end')}
            >
              Terminar partida
            </button>
          </div>
        ) : (
          <p className="muted">
            {entry.replaceable ? 'Esperando un reemplazo…' : `${hostName} decide qué hacer.`}
          </p>
        ))}
    </div>
  );
}
