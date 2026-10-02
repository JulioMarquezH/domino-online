import {
  LETTERS,
  NAME_MAX_LENGTH,
  TOURNAMENT_PLAYERS,
  validateTournamentNames,
  type LetterAssignment,
} from '@domino/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { createTournament } from '../net/tournament';
import { navigate, tournamentPath, tournamentUrl } from '../net/router';
import { useCopied } from '../ui/hooks';
import { CheckIcon, LinkIcon } from '../ui/icons';

type Step =
  | { kind: 'names' }
  | { kind: 'confirm'; names: string[] }
  | { kind: 'reveal'; id: string; players: LetterAssignment[] };

export function TournamentCreate() {
  const [step, setStep] = useState<Step>({ kind: 'names' });
  return (
    <div className="screen center-screen tournament-create">
      {step.kind === 'names' && (
        <NamesStep onNext={(names) => setStep({ kind: 'confirm', names })} />
      )}
      {step.kind === 'confirm' && (
        <ConfirmStep
          names={step.names}
          onBack={() => setStep({ kind: 'names' })}
          onCreated={(id, players) => setStep({ kind: 'reveal', id, players })}
        />
      )}
      {step.kind === 'reveal' && <RevealStep id={step.id} players={step.players} />}
    </div>
  );
}

function NamesStep({ onNext }: { onNext: (names: string[]) => void }) {
  const [names, setNames] = useState<string[]>(() => Array(TOURNAMENT_PLAYERS).fill(''));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const check = validateTournamentNames(names);
    if (check.ok) return onNext(check.names);
    if (check.code === 'NAME_INVALID') {
      setError(
        `El nombre del jugador ${check.index + 1} debe tener entre 1 y ${NAME_MAX_LENGTH} caracteres.`,
      );
    } else if (check.code === 'NAME_DUPLICATE') {
      setError(
        `El jugador ${check.index + 1} repite un nombre (sin importar mayúsculas ni tildes).`,
      );
    } else {
      setError('Escribe los nombres de los cuatro jugadores.');
    }
  };

  return (
    <form className="card narrow-card" onSubmit={submit}>
      <p className="eyebrow">Torneo privado</p>
      <h1 className="title">Los cuatro jugadores</h1>
      <p className="muted">
        Doce partidos, cuatro jornadas. Escribe los nombres tal como cada quien los usará para
        entrar.
      </p>
      {names.map((n, i) => (
        <label className="field" key={i}>
          <span>Jugador {i + 1}</span>
          <input
            value={n}
            onChange={(e) => {
              setNames(names.map((x, j) => (j === i ? e.target.value : x)));
              setError(null);
            }}
            maxLength={NAME_MAX_LENGTH + 5}
            autoFocus={i === 0}
            autoComplete="off"
            autoCapitalize="words"
            placeholder={['Ana', 'Beto', 'Caro', 'Dani'][i]}
            enterKeyHint={i === TOURNAMENT_PLAYERS - 1 ? 'go' : 'next'}
          />
        </label>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary">
        Continuar
      </button>
      <button type="button" className="btn ghost small" onClick={() => navigate('/')}>
        Cancelar
      </button>
    </form>
  );
}

function ConfirmStep({
  names,
  onBack,
  onCreated,
}: {
  names: string[];
  onBack: () => void;
  onCreated: (id: string, players: LetterAssignment[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await createTournament(names);
    if (res.ok) return onCreated(res.id, res.players);
    setBusy(false);
    setError(
      res.code === 'RATE_LIMITED'
        ? 'Has creado muchos torneos seguidos. Espera un rato y vuelve a intentarlo.'
        : 'No pudimos crear el torneo. Revisa tu conexión e inténtalo de nuevo.',
    );
  };

  return (
    <div className="card narrow-card" role="group" aria-label="Confirmar nombres">
      <p className="eyebrow">Confirma</p>
      <h1 className="title">¿Están bien escritos?</h1>
      <ul className="confirm-names">
        {names.map((n, i) => (
          <li key={i}>
            <span className="muted small">Jugador {i + 1}</span>
            <strong>{n}</strong>
          </li>
        ))}
      </ul>
      <p className="notice-lock">Estos nombres no se pueden cambiar después.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn primary" onClick={create} disabled={busy}>
        {busy ? 'Creando…' : 'Crear torneo'}
      </button>
      <button type="button" className="btn ghost small" onClick={onBack} disabled={busy}>
        Corregir nombres
      </button>
    </div>
  );
}

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The server already drew the letters; this only reveals them one by one. */
function RevealStep({ id, players }: { id: string; players: LetterAssignment[] }) {
  const [revealed, setRevealed] = useState(() => (prefersReducedMotion() ? players.length : 0));
  const [spin, setSpin] = useState(0);
  const [linkCopied, copyLink] = useCopied();
  const done = revealed >= players.length;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), 1100);
    return () => clearTimeout(t);
  }, [revealed, done]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setSpin((s) => s + 1), 90);
    return () => clearInterval(t);
  }, [done]);

  const url = tournamentUrl(id);
  return (
    <div className="card narrow-card reveal-card">
      <p className="eyebrow">El sorteo de letras</p>
      <h1 className="title">{done ? 'Letras asignadas' : 'Sorteando…'}</h1>
      <ul className="reveal-list" aria-live="polite">
        {players.map((p, i) => {
          const shown = i < revealed;
          const letter = shown ? p.letter : LETTERS[(spin + i) % LETTERS.length];
          return (
            <li
              key={p.letter}
              className={shown ? 'is-revealed' : 'is-spinning'}
              data-letter={shown ? p.letter : ''}
            >
              <span className="reveal-name">{p.name}</span>
              <span className="letter-badge big">{letter}</span>
            </li>
          );
        })}
      </ul>
      {done && (
        <div className="reveal-share">
          <p className="muted">
            Las letras ya no cambian. Comparte este enlace: cada quien entra escribiendo su nombre.
          </p>
          <p className="t-id big" aria-label="Código del torneo">
            {id}
          </p>
          <div className="row">
            <button type="button" className="btn secondary" onClick={() => copyLink(url)}>
              {linkCopied ? <CheckIcon size={18} /> : <LinkIcon size={18} />}
              {linkCopied ? 'Enlace copiado' : 'Copiar enlace'}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate(tournamentPath(id))}
            >
              Entrar al torneo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
