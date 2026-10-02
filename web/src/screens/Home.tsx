import {
  NAME_MAX_LENGTH,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  isValidRoomId,
  sanitizeName,
} from '@domino/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { unlockAudio } from '../audio/context';
import { createRoom } from '../net/client';
import { navigate, roomPath, tournamentPath } from '../net/router';
import { storage, type KnownTournament } from '../net/storage';
import { refreshKnownTournaments } from '../net/tournament';
import { TrophyIcon } from '../ui/icons';
import { TileFace } from '../ui/Tile';

const ALLOWED = new RegExp(`[^${ROOM_ID_ALPHABET}]`, 'g');

export function Home() {
  const [name, setName] = useState(storage.getName());
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanName = sanitizeName(name);

  const onCreate = async () => {
    unlockAudio();
    if (!cleanName) {
      setError('Escribe tu nombre (máximo 20 caracteres).');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createRoom(cleanName);
    setBusy(false);
    if (res.ok) navigate(roomPath(res.roomId));
    else setError('No pudimos crear la sala. Revisa tu conexión e inténtalo de nuevo.');
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (!cleanName) {
      setError('Escribe tu nombre (máximo 20 caracteres).');
      return;
    }
    if (!isValidRoomId(code)) {
      setError(`El código de la sala tiene ${ROOM_ID_LENGTH} caracteres.`);
      return;
    }
    storage.setName(cleanName);
    navigate(roomPath(code));
  };

  return (
    <div className="screen home">
      <div className="home-hero" aria-hidden="true">
        <div className="hero-tile t1">
          <TileFace top={6} bottom={6} />
        </div>
        <div className="hero-tile t2">
          <TileFace top={5} bottom={3} />
        </div>
        <div className="hero-tile t3">
          <TileFace top={2} bottom={4} />
        </div>
      </div>
      <main className="home-card">
        <div className="home-intro">
          <p className="eyebrow">Salas privadas · voz en vivo</p>
          <h1 className="brand">
            Dominó<span>.</span>
          </h1>
          <p className="tagline">Partidas en pareja con los tuyos, como en la mesa de siempre.</p>
        </div>
        <div className="home-form">
          <label className="field">
            <span>Tu nombre</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value.slice(0, NAME_MAX_LENGTH + 5));
                setError(null);
              }}
              maxLength={NAME_MAX_LENGTH}
              placeholder="¿Cómo te llaman en la mesa?"
              autoComplete="nickname"
              enterKeyHint="go"
            />
          </label>

          {!joining ? (
            <div className="home-actions">
              <button type="button" className="btn primary" onClick={onCreate} disabled={busy}>
                {busy ? 'Creando…' : 'Crear sala'}
              </button>
              <button type="button" className="btn secondary" onClick={() => setJoining(true)}>
                Unirse
              </button>
            </div>
          ) : (
            <form className="join-form" onSubmit={onJoin}>
              <label className="field">
                <span>Código de la sala</span>
                <input
                  className="code-input"
                  value={code}
                  onChange={(e) => {
                    setCode(
                      e.target.value.toUpperCase().replace(ALLOWED, '').slice(0, ROOM_ID_LENGTH),
                    );
                    setError(null);
                  }}
                  placeholder="ABC234"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  autoFocus
                />
              </label>
              <div className="home-actions">
                <button type="submit" className="btn primary">
                  Entrar
                </button>
                <button type="button" className="btn ghost" onClick={() => setJoining(false)}>
                  Volver
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!joining && (
            <button
              type="button"
              className="btn secondary tournament-btn"
              onClick={() => navigate('/torneo/nuevo')}
            >
              <TrophyIcon size={20} /> Torneo
            </button>
          )}
          <KnownTournaments />
        </div>
      </main>
    </div>
  );
}

/** "Tus torneos": the IDs this device opened, checked against the server (dead ones vanish). */
function KnownTournaments() {
  const [list, setList] = useState<KnownTournament[]>(() => storage.getKnownTournaments());
  const [progress, setProgress] = useState<Record<string, { status: string; played: number }>>({});

  useEffect(() => {
    let alive = true;
    void refreshKnownTournaments().then((items) => {
      if (!alive) return;
      setList(storage.getKnownTournaments());
      setProgress(Object.fromEntries(items.map((i) => [i.id, i])));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (list.length === 0) return null;
  return (
    <section className="known-tournaments" aria-labelledby="known-title">
      <h2 id="known-title" className="eyebrow">
        Tus torneos
      </h2>
      <ul>
        {list.map((t) => {
          const p = progress[t.id];
          return (
            <li key={t.id}>
              <button
                type="button"
                className="known-item"
                onClick={() => navigate(tournamentPath(t.id))}
                data-tournament={t.id}
              >
                <span className="known-label">{t.label || t.id}</span>
                <span className="muted small">
                  {t.you ? `Juegas como ${t.you}` : 'Aún no has entrado'}
                  {p ? ` · ${p.status === 'finished' ? 'Terminado' : `${p.played}/12`}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
