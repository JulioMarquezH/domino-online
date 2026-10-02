import { NAME_MAX_LENGTH, cleanPlayerName } from '@domino/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { enterTournament, useTournament } from '../net/tournament';
import { getClientState, leaveRoom } from '../net/client';
import { navigate } from '../net/router';
import { Loading } from './RoomRoute';
import { TournamentPage } from './tournament/TournamentPage';

export function TournamentRoute({ id }: { id: string }) {
  const { status, view, you } = useTournament();
  const here = status.kind !== 'idle' && status.id === id;

  useEffect(() => {
    // Never keep a room "open" behind a tournament page (e.g. after the browser's back button).
    if (getClientState().status.kind === 'in') leaveRoom();
    void enterTournament(id);
  }, [id]);

  if (!here || status.kind === 'loading') return <Loading text="Abriendo el torneo…" />;
  if (status.kind === 'needName') {
    return <NamePrompt id={id} error={status.error} retryAt={status.retryAt} />;
  }
  if (status.kind === 'error') return <TournamentError code={status.code} />;
  if (!view || !you) return <Loading text="Abriendo el torneo…" />;
  return <TournamentPage view={view} you={you} />;
}

function NamePrompt({
  id,
  error,
  retryAt,
}: {
  id: string;
  error: 'NAME_UNKNOWN' | 'NAME_INVALID' | 'RATE_LIMITED' | null;
  retryAt: number | null;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const clean = cleanPlayerName(name);
  const waitMs = error === 'RATE_LIMITED' && retryAt !== null ? Math.max(0, retryAt - now) : 0;

  useEffect(() => {
    if (waitMs <= 0) return;
    const t = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(t);
  }, [waitMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean || waitMs > 0) return;
    setBusy(true);
    await enterTournament(id, clean);
    setBusy(false);
  };
  return (
    <div className="screen center-screen">
      <form className="card narrow-card" onSubmit={submit}>
        <p className="eyebrow">Torneo privado</p>
        <h1 className="title">¿Quién eres?</h1>
        <p className="muted">Escribe tu nombre tal como lo anotaron al crear el torneo.</p>
        <label className="field">
          <span>Tu nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH + 5}
            autoFocus
            autoComplete="off"
            autoCapitalize="words"
            placeholder="Tu nombre en el torneo"
          />
        </label>
        {error === 'NAME_UNKNOWN' && (
          <p className="form-error" role="alert">
            Ese nombre no está en este torneo
          </p>
        )}
        {error === 'NAME_INVALID' && (
          <p className="form-error" role="alert">
            El nombre debe tener entre 1 y 20 caracteres.
          </p>
        )}
        {waitMs > 0 && (
          <p className="form-error" role="alert">
            Demasiados intentos. Espera{' '}
            {Math.ceil(waitMs / 1000 / 60) > 1
              ? `${Math.ceil(waitMs / 60000)} minutos`
              : 'un momento'}{' '}
            y vuelve a probar.
          </p>
        )}
        <button type="submit" className="btn primary" disabled={!clean || busy || waitMs > 0}>
          {busy ? 'Entrando…' : 'Entrar al torneo'}
        </button>
        <button type="button" className="btn ghost small" onClick={() => navigate('/')}>
          Volver al inicio
        </button>
      </form>
    </div>
  );
}

function TournamentError({ code }: { code: 'NOT_FOUND' | 'RATE_LIMITED' | 'FAILED' }) {
  const text =
    code === 'NOT_FOUND'
      ? {
          title: 'El torneo no existe',
          body: 'Revisa el enlace o pídele uno nuevo a quien lo creó.',
        }
      : {
          title: 'Algo salió mal',
          body: 'No pudimos abrir el torneo. Inténtalo de nuevo en un momento.',
        };
  return (
    <div className="screen center-screen">
      <div className="card narrow-card error-card">
        <h1 className="title">{text.title}</h1>
        <p className="muted">{text.body}</p>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => navigate('/')}>
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
