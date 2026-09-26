import type { PublicPlayer, Team } from '@domino/shared';
import { useVoice } from '../voice/useVoice';
import { CrownIcon, MicOffIcon, NoVoiceIcon } from './icons';

interface Props {
  player: PublicPlayer;
  team: Team | null;
  isSelf: boolean;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  onClick?: () => void;
}

/** Initial-letter avatar with the speaking glow, host crown and voice status badges. */
export function Avatar({ player, team, isSelf, size = 'md', active = false, onClick }: Props) {
  const v = useVoice();
  const speaking = Boolean(v.speaking[player.id]) && player.connected;
  const peer = v.peers[player.id];
  const micOff = isSelf ? v.mic === 'off' || v.mic === 'muted' : player.mic !== 'on';
  const noVoice = !isSelf && player.connected && peer?.conn === 'failed';
  const initial = [...player.name.trim()][0]?.toLocaleUpperCase('es') ?? '?';
  const cls = [
    'avatar',
    `avatar-${size}`,
    team === null ? 'team-none' : `team-${team}`,
    speaking ? 'is-speaking' : '',
    active ? 'is-active' : '',
    player.connected ? '' : 'is-offline',
    onClick ? 'is-clickable' : '',
  ].join(' ');
  const label = `${player.name}${speaking ? ', hablando' : ''}${micOff ? ', micrófono apagado' : ''}${noVoice ? ', sin conexión de voz' : ''}`;
  const content = (
    <>
      <span className="avatar-letter">{initial}</span>
      {player.isHost && (
        <span className="avatar-badge badge-host" title="Anfitrión">
          <CrownIcon size={12} />
        </span>
      )}
      {noVoice ? (
        <span className="avatar-badge badge-mic badge-novoice" title="Sin conexión de voz">
          <NoVoiceIcon size={11} />
        </span>
      ) : (
        micOff && (
          <span
            className="avatar-badge badge-mic"
            title={
              player.mic === 'muted' || (isSelf && v.mic === 'muted')
                ? 'Silenciado'
                : 'Sin micrófono'
            }
          >
            <MicOffIcon size={11} />
          </span>
        )
      )}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-label={label}
      data-speaking={speaking}
    >
      {content}
    </button>
  ) : (
    <span className={cls} role="img" aria-label={label} data-speaking={speaking}>
      {content}
    </span>
  );
}
