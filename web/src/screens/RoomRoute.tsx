import { NAME_MAX_LENGTH, sanitizeName } from '@domino/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { unlockAudio } from '../audio/context';
import { joinRoom, resetStatus, useClient, type RoomErrorCode } from '../net/client';
import { navigate } from '../net/router';
import { storage } from '../net/storage';
import { DrawScreen } from '../game/DrawScreen';
import { PauseOverlay } from '../game/PauseOverlay';
import { Table } from '../game/Table';
import { RotateOverlay } from '../ui/RotateOverlay';
import { Lobby } from './Lobby';

export function RoomRoute({ roomId }: { roomId: string }) {
  const { status, view } = useClient();
  const here = status.kind !== 'idle' && status.roomId === roomId;

  useEffect(() => {
    if (!here) void joinRoom(roomId);
    // Only when the route's room changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (!here || status.kind === 'joining') {
    return <Loading text="Entrando a la sala…" />;
  }
  if (status.kind === 'needName') return <NamePrompt roomId={roomId} error={status.error} />;
  if (status.kind === 'error') return <RoomError code={status.code} />;
  if (!view) return <Loading text="Entrando a la sala…" />;

  const inGame = view.phase !== 'lobby';
  return (
    <>
      {view.phase === 'lobby' && <Lobby view={view} />}
      {view.phase === 'draw' && <DrawScreen view={view} />}
      {(view.phase === 'playing' || view.phase === 'handEnd' || view.phase === 'matchEnd') && (
        <Table view={view} />
      )}
      {inGame && view.pause.length > 0 && <PauseOverlay view={view} />}
      {inGame && <RotateOverlay />}
    </>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <div className="screen center-screen">
      <div className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="muted">{text}</p>
    </div>
  );
}

function NamePrompt({
  roomId,
  error,
}: {
  roomId: string;
  error: 'NAME_TAKEN' | 'NAME_INVALID' | null;
}) {
  const [name, setName] = useState(storage.getName());
  const [busy, setBusy] = useState(false);
  const clean = sanitizeName(name);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (!clean) return;
    setBusy(true);
    await joinRoom(roomId, clean);
    setBusy(false);
  };
  return (
    <div className="screen center-screen">
      <form className="card narrow-card" onSubmit={submit}>
        <p className="eyebrow">Te invitaron a la sala {roomId}</p>
        <h1 className="title">¿Cómo te llamas?</h1>
        <label className="field">
          <span>Tu nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoFocus
            autoComplete="nickname"
            placeholder="Tu nombre en la mesa"
          />
        </label>
        {error === 'NAME_TAKEN' && (
          <p className="form-error" role="alert">
            Ya hay alguien con ese nombre en la sala. Elige otro.
          </p>
        )}
        {error === 'NAME_INVALID' && (
          <p className="form-error" role="alert">
            El nombre debe tener entre 1 y 20 caracteres.
          </p>
        )}
        <button type="submit" className="btn primary" disabled={!clean || busy}>
          {busy ? 'Entrando…' : 'Entrar a la sala'}
        </button>
      </form>
    </div>
  );
}

const ERRORS: Record<RoomErrorCode, { title: string; text: string }> = {
  NOT_FOUND: {
    title: 'La sala no existe',
    text: 'Revisa el código o pide un enlace nuevo a quien te invitó.',
  },
  GONE: {
    title: 'La sala ya no existe',
    text: 'Se cerró o el servidor se reinició. Crea una sala nueva para seguir jugando.',
  },
  FULL: {
    title: 'Sala llena',
    text: 'Ya hay cuatro jugadores en esta mesa.',
  },
  REPLACED: {
    title: 'Abriste la sala en otra pestaña',
    text: 'Sigue jugando desde la otra ventana o vuelve a entrar aquí.',
  },
};

function RoomError({ code }: { code: RoomErrorCode }) {
  const e = ERRORS[code];
  return (
    <div className="screen center-screen">
      <div className="card narrow-card error-card">
        <h1 className="title">{e.title}</h1>
        <p className="muted">{e.text}</p>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              resetStatus();
              navigate('/');
            }}
          >
            Volver al inicio
          </button>
          {code === 'REPLACED' && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                const m = /\/sala\/([^/]+)/.exec(window.location.pathname);
                if (m?.[1]) void joinRoom(m[1]);
              }}
            >
              Usar esta ventana
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
