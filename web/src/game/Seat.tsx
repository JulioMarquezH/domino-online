import { teamOf, type PublicPlayer, type ScreenPosition } from '@domino/shared';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { TileBack } from '../ui/Tile';
import { PeerVoiceControl } from '../ui/VoiceControls';

interface Props {
  player: PublicPlayer;
  position: Exclude<ScreenPosition, 'bottom'>;
  isTurn: boolean;
  isPartner: boolean;
  dealKey: number;
  passedAt: number | null;
}

/** An opponent or your partner around the table: avatar, name, team and face-down tiles. */
export function Seat({ player, position, isTurn, isPartner, dealKey, passedAt }: Props) {
  const [open, setOpen] = useState(false);
  const [bubbleDone, setBubbleDone] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const team = player.seat !== null ? teamOf(player.seat) : null;
  const bubble = passedAt !== null && passedAt !== bubbleDone;

  useEffect(() => {
    if (passedAt === null) return;
    const t = setTimeout(() => setBubbleDone(passedAt), 1600);
    return () => clearTimeout(t);
  }, [passedAt]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div
      ref={ref}
      className={`seat-slot pos-${position} ${isTurn ? 'is-turn' : ''} ${player.connected ? '' : 'offline'}`}
      data-seat-name={player.name}
    >
      <div className="seat-id">
        <Avatar
          player={player}
          team={team}
          isSelf={false}
          active={isTurn}
          onClick={player.isBot ? undefined : () => setOpen((o) => !o)}
        />
        <div className="seat-text">
          <span className="seat-name">{player.name}</span>
          <span className={`seat-role team-text-${team ?? 'none'}`}>
            {isPartner ? 'Pareja' : 'Rival'}
            {player.isBot && ' · IA'}
            {isTurn && <span className="turn-dots" aria-label="está jugando" />}
          </span>
        </div>
        {bubble && (
          <span key={passedAt} className="pass-bubble">
            Pasó
          </span>
        )}
      </div>
      <div className="seat-tiles" aria-label={`${player.tileCount} fichas`}>
        {Array.from({ length: player.tileCount }, (_, i) => (
          <span
            key={`${dealKey}:${i}`}
            className="mini-tile"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <TileBack />
          </span>
        ))}
      </div>
      {open && (
        <div className="voice-pop" role="dialog" aria-label={`Audio de ${player.name}`}>
          <span className="voice-pop-title">{player.name}</span>
          <PeerVoiceControl player={player} />
        </div>
      )}
    </div>
  );
}
