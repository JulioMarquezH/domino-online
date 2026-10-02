import { MAX_PLAYERS, teamOf, type Letter, type RoomView } from '@domino/shared';
import { useState } from 'react';
import { derive } from '../game/derive';
import { actions, exitRoom } from '../net/client';
import { DoorIcon } from '../ui/icons';
import { MicNotice } from '../ui/MicNotice';
import { SelfMicButton } from '../ui/VoiceControls';
import { PlayerRow } from './Lobby';

/** The waiting room of a tournament match: fixed players, fixed pairs, nothing to configure. */
export function TournamentLobby({ view }: { view: RoomView }) {
  const info = view.tournament;
  const d = derive(view);
  const isHost = d.me?.isHost ?? false;
  const [busy, setBusy] = useState(false);
  if (!info) return null;
  const here = new Set(view.players.filter((p) => p.connected).map((p) => p.letter));
  const missing = info.roster.filter((r) => !here.has(r.letter));
  const canStart = missing.length === 0 && view.players.length === MAX_PLAYERS;
  const pair = (team: 0 | 1) => info.roster.filter((r) => teamOf(r.seat) === team);

  const start = async () => {
    setBusy(true);
    await actions.start();
    setBusy(false);
  };

  return (
    <div className="screen lobby tournament-lobby">
      <header className="lobby-head">
        <button type="button" className="btn ghost small" onClick={exitRoom}>
          <DoorIcon size={18} /> Torneo
        </button>
        <div className="room-code">
          <span className="eyebrow">Torneo · Jornada {info.jornada}</span>
          <span className="t-match-title">Partido {info.number} de 12</span>
        </div>
        <span />
      </header>

      <MicNotice />

      <main className="lobby-grid">
        <section className="card players-card" aria-labelledby="players-title">
          <div className="players-head">
            <h2 id="players-title">
              Jugadores <span className="count">{view.players.length}/4</span>
            </h2>
            <SelfMicButton />
          </div>
          <ul className="player-list">
            {view.players.map((p) => (
              <PlayerRow
                key={p.id}
                player={p}
                isSelf={p.id === view.youId}
                manual
                canRemove={false}
              />
            ))}
            {missing
              .filter((r) => !view.players.some((p) => p.letter === r.letter))
              .map((r) => (
                <li key={r.letter} className="player-row empty">
                  <span className="avatar avatar-md team-none ghost-avatar" />
                  <span className="muted empty-text">
                    Esperando a {r.name} <span className="letter-badge">{r.letter}</span>
                  </span>
                </li>
              ))}
          </ul>
        </section>

        <section className="card settings-card" aria-labelledby="settings-title">
          <h2 id="settings-title">Partido</h2>
          <div className="setting">
            <span className="setting-label">Meta</span>
            <strong className="fixed-target">{view.target}</strong>
          </div>
          {([0, 1] as const).map((team) => (
            <div key={team} className={`pair-card team-${team}`}>
              <span className="seat-team">Pareja {team + 1}</span>
              <strong>
                {pair(team)
                  .map((r) => r.name)
                  .join(' + ')}
              </strong>
              <span className="pair-letters">
                {pair(team).map((r) => (
                  <span key={r.letter} className="letter-badge">
                    {r.letter as Letter}
                  </span>
                ))}
              </span>
            </div>
          ))}
          <p className="setting-help">
            Las parejas ya están fijadas. Cada jugador levanta una ficha: la más alta sale. El
            resultado se guarda solo al terminar.
          </p>
          <div className="start-row">
            {isHost ? (
              <button
                type="button"
                className="btn primary big"
                disabled={!canStart || busy}
                onClick={start}
              >
                Empezar
              </button>
            ) : (
              <p className="muted waiting-host">
                Esperando a que {d.host?.name ?? 'el anfitrión'} empiece…
              </p>
            )}
            <p className={`hint ${canStart ? 'ok' : ''}`}>
              {canStart
                ? 'Todo listo.'
                : `Faltan ${missing.length} ${missing.length === 1 ? 'jugador' : 'jugadores'}. Cada uno entra desde su torneo con “Jugar”.`}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
