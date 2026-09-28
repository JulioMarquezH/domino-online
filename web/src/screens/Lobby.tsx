import {
  MAX_PLAYERS,
  TARGETS,
  teamOf,
  type PublicPlayer,
  type RoomView,
  type Seat,
} from '@domino/shared';
import { useState } from 'react';
import { actions, leaveRoom } from '../net/client';
import { navigate, roomUrl } from '../net/router';
import { derive } from '../game/derive';
import { Avatar } from '../ui/Avatar';
import { useCopied } from '../ui/hooks';
import { CheckIcon, DoorIcon, LinkIcon } from '../ui/icons';
import { MicNotice } from '../ui/MicNotice';
import { PeerVoiceControl, SelfMicButton } from '../ui/VoiceControls';
import { voiceStatusText } from '../voice/status';
import { useVoice } from '../voice/useVoice';

export function Lobby({ view }: { view: RoomView }) {
  const d = derive(view);
  const isHost = d.me?.isHost ?? false;
  const [copied, copy] = useCopied();
  const [busy, setBusy] = useState(false);
  const manual = view.teamMode === 'manual';
  const connected = view.players.filter((p) => p.connected).length;
  const missing = MAX_PLAYERS - connected;
  const unseated = view.players.filter((p) => p.seat === null).length;
  const canStart = missing === 0 && (!manual || unseated === 0);
  const hint =
    missing > 0
      ? `Faltan ${missing} ${missing === 1 ? 'jugador' : 'jugadores'}. Comparte el enlace.`
      : manual && unseated > 0
        ? 'Todos deben elegir asiento.'
        : 'Todo listo.';

  const start = async () => {
    setBusy(true);
    await actions.start();
    setBusy(false);
  };

  return (
    <div className="screen lobby">
      <header className="lobby-head">
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            leaveRoom();
            navigate('/');
          }}
        >
          <DoorIcon size={18} /> Salir
        </button>
        <div className="room-code" aria-label={`Código de la sala ${view.roomId}`}>
          <span className="eyebrow">Sala</span>
          <span className="code">
            {[...view.roomId].map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </span>
        </div>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => copy(roomUrl(view.roomId))}
        >
          {copied ? <CheckIcon size={18} /> : <LinkIcon size={18} />}
          {copied ? 'Enlace copiado' : 'Copiar enlace'}
        </button>
      </header>

      <MicNotice />

      <main className="lobby-grid">
        <section className="card players-card" aria-labelledby="players-title">
          <h2 id="players-title">
            Jugadores <span className="count">{view.players.length}/4</span>
          </h2>
          <ul className="player-list">
            {view.players.map((p) => (
              <PlayerRow key={p.id} player={p} isSelf={p.id === view.youId} manual={manual} />
            ))}
            {Array.from({ length: MAX_PLAYERS - view.players.length }, (_, i) => (
              <li key={`empty-${i}`} className="player-row empty">
                <span className="avatar avatar-md team-none ghost-avatar" />
                <span className="muted">Esperando jugador…</span>
              </li>
            ))}
          </ul>
          <div className="self-voice">
            <SelfMicButton />
          </div>
        </section>

        <section className="card settings-card" aria-labelledby="settings-title">
          <h2 id="settings-title">Partida</h2>
          <div className="setting">
            <span className="setting-label">Meta</span>
            <div className="segmented" role="radiogroup" aria-label="Meta de puntos">
              {TARGETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={view.target === t}
                  className={view.target === t ? 'on' : ''}
                  disabled={!isHost}
                  onClick={() => void actions.setTarget(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span className="setting-label">Parejas</span>
            <div className="segmented" role="radiogroup" aria-label="Cómo se forman las parejas">
              <button
                type="button"
                role="radio"
                aria-checked={!manual}
                className={!manual ? 'on' : ''}
                disabled={!isHost}
                onClick={() => void actions.setMode('sortear')}
              >
                Sortear
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={manual}
                className={manual ? 'on' : ''}
                disabled={!isHost}
                onClick={() => void actions.setMode('manual')}
              >
                Elegir asientos
              </button>
            </div>
          </div>
          <p className="setting-help">
            {manual
              ? 'Cada quien elige su silla. Las parejas se sientan frente a frente; el sorteo solo decide quién sale.'
              : 'Cada jugador levanta una ficha: las dos más altas juegan juntas y la más alta sale.'}
          </p>
          {manual && <SeatPicker view={view} />}
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
            <p className={`hint ${canStart ? 'ok' : ''}`}>{hint}</p>
          </div>
        </section>
      </main>
    </div>
  );
}

function PlayerRow({
  player,
  isSelf,
  manual,
}: {
  player: PublicPlayer;
  isSelf: boolean;
  manual: boolean;
}) {
  const v = useVoice();
  const team = manual && player.seat !== null ? teamOf(player.seat) : null;
  return (
    <li className={`player-row ${player.connected ? '' : 'offline'}`} data-player={player.name}>
      <Avatar player={player} team={team} isSelf={isSelf} />
      <div className="player-meta">
        <span className="player-name">
          <span className="name-text">{player.name}</span>
          {isSelf && <span className="tag">tú</span>}
          {player.isHost && <span className="tag tag-host">anfitrión</span>}
        </span>
        <span className="player-status">
          {voiceStatusText(player, isSelf, v.peers[player.id]?.conn, v.mic)}
        </span>
      </div>
      {!isSelf && player.connected && <PeerVoiceControl player={player} />}
    </li>
  );
}

const SEAT_POS: Record<Seat, string> = { 0: 'bottom', 1: 'right', 2: 'top', 3: 'left' };

function SeatPicker({ view }: { view: RoomView }) {
  const bySeat = new Map(view.players.filter((p) => p.seat !== null).map((p) => [p.seat, p]));
  const me = view.players.find((p) => p.id === view.youId);
  return (
    <div className="seat-picker" role="group" aria-label="Elige tu asiento">
      <div className="seat-table" aria-hidden="true" />
      {([0, 1, 2, 3] as Seat[]).map((seat) => {
        const who = bySeat.get(seat);
        const mine = who?.id === view.youId;
        return (
          <button
            key={seat}
            type="button"
            className={`seat seat-${SEAT_POS[seat]} team-${teamOf(seat)} ${who ? 'taken' : ''} ${mine ? 'mine' : ''}`}
            disabled={Boolean(who) && !mine}
            onClick={() => void actions.sit(mine ? null : seat)}
            aria-label={
              who
                ? `Asiento de ${who.name}${mine ? ' (tú, toca para levantarte)' : ''}`
                : `Sentarme aquí, pareja ${teamOf(seat) + 1}`
            }
          >
            <span className="seat-name">
              {who ? who.name : me?.seat === null ? 'Sentarme' : 'Libre'}
            </span>
            <span className="seat-team">Pareja {teamOf(seat) + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
