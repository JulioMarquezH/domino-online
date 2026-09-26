import type { PublicPlayer } from '@domino/shared';
import { useVoice } from '../voice/useVoice';
import { voice } from '../voice/voice';
import { MicIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon } from './icons';

export function SelfMicButton({ compact = false }: { compact?: boolean }) {
  const v = useVoice();
  const unavailable = v.mic === 'off' || v.mic === 'pending';
  const muted = v.mic === 'muted';
  const label =
    v.mic === 'pending'
      ? 'Activando micrófono…'
      : v.mic === 'off'
        ? v.micIssue === 'denied'
          ? 'Micrófono bloqueado'
          : 'Sin micrófono'
        : muted
          ? 'Activar micrófono'
          : 'Silenciar micrófono';
  return (
    <button
      type="button"
      className={`icon-btn mic-btn ${muted || unavailable ? 'is-off' : 'is-on'} ${compact ? 'compact' : ''}`}
      onClick={() => voice.toggleMute()}
      disabled={unavailable}
      aria-pressed={!muted && !unavailable}
      aria-label={label}
      title={label}
    >
      {muted || unavailable ? <MicOffIcon /> : <MicIcon />}
      {!compact && <span>{label}</span>}
    </button>
  );
}

/** Local-only controls for hearing a remote player. */
export function PeerVoiceControl({ player }: { player: PublicPlayer }) {
  const v = useVoice();
  const pref = v.peers[player.id] ?? { volume: 1, muted: false, conn: 'connecting' as const };
  return (
    <div className="peer-voice">
      <button
        type="button"
        className={`icon-btn compact ${pref.muted ? 'is-off' : ''}`}
        onClick={() => voice.togglePeerMute(player.id)}
        aria-label={
          pref.muted ? `Volver a escuchar a ${player.name}` : `Silenciar a ${player.name}`
        }
        title={pref.muted ? 'Escuchar' : 'Silenciar'}
      >
        {pref.muted ? <SpeakerOffIcon size={18} /> : <SpeakerIcon size={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(pref.volume * 100)}
        onChange={(e) => voice.setVolume(player.id, Number(e.target.value) / 100)}
        aria-label={`Volumen de ${player.name}`}
        disabled={pref.muted}
      />
    </div>
  );
}
