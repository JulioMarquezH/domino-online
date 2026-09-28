import {
  NAME_MAX_LENGTH,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  isValidRoomId,
  sanitizeName,
} from '@domino/shared';
import { useState, type FormEvent } from 'react';
import { unlockAudio } from '../audio/context';
import { createRoom } from '../net/client';
import { navigate, roomPath } from '../net/router';
import { storage } from '../net/storage';
import { InstallSteps } from '../ui/FullscreenButton';
import { isIOS, isStandalone } from '../ui/landscape';
import { TileFace } from '../ui/Tile';

const ALLOWED = new RegExp(`[^${ROOM_ID_ALPHABET}]`, 'g');

export function Home() {
  const [name, setName] = useState(storage.getName());
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanName = sanitizeName(name);
  const [showTip, setShowTip] = useState(
    () => isIOS() && !isStandalone() && !storage.getFlag('ios-tip'),
  );

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
        <p className="eyebrow">Salas privadas · voz en vivo</p>
        <h1 className="brand">
          Dominó<span>.</span>
        </h1>
        <p className="tagline">Partidas en pareja con los tuyos, como en la mesa de siempre.</p>

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
        {showTip && (
          <div className="install-tip">
            <InstallSteps />
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                storage.setFlag('ios-tip');
                setShowTip(false);
              }}
            >
              Entendido
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
