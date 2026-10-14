import type { LetterAssignment, PublicPlayer, TournamentView } from '@domino/shared';
import { callId, useTournament } from '../../net/tournament';
import { Avatar } from '../../ui/Avatar';
import { MicNotice } from '../../ui/MicNotice';
import { PeerVoiceControl, SelfMicButton } from '../../ui/VoiceControls';
import { useVoice } from '../../voice/useVoice';

/**
 * The tournament's voice call, on this page and on the tables of its matches. Each person's
 * volume is yours alone and stays as you left it (it is remembered by name).
 */
export function TournamentCall({ view, you }: { view: TournamentView; you: LetterAssignment }) {
  const { call } = useTournament();
  const v = useVoice();
  const inCall = new Map(call.map((m) => [m.letter, m]));

  const asPlayer = (p: LetterAssignment): PublicPlayer => {
    const m = inCall.get(p.letter);
    return {
      id: callId(p.letter),
      name: p.name,
      isBot: false,
      seat: null,
      connected: Boolean(m),
      isHost: false,
      mic: m?.mic ?? 'off',
      voiceSession: m?.session ?? null,
      tileCount: 0,
      letter: p.letter,
    };
  };

  return (
    <section className="card t-call" aria-labelledby="t-call-title">
      <div className="t-call-head">
        <h2 id="t-call-title">Llamada</h2>
        <SelfMicButton compact />
      </div>
      <MicNotice />
      <ul className="t-call-list">
        {view.players.map((p) => {
          const player = asPlayer(p);
          const self = p.letter === you.letter;
          const conn = v.peers[player.id]?.conn;
          const status = self
            ? v.mic === 'muted'
              ? 'Silenciado'
              : v.mic === 'off'
                ? 'Solo escucha'
                : 'Tú'
            : !player.connected
              ? 'No está en el torneo'
              : conn === 'failed'
                ? 'Sin conexión de voz'
                : conn === 'connected'
                  ? player.mic === 'muted'
                    ? 'Silenciado'
                    : 'En la llamada'
                  : 'Conectando…';
          return (
            <li key={p.letter} className={`t-call-row ${player.connected ? '' : 'away'}`}>
              <Avatar player={player} team={null} isSelf={self} size="sm" />
              <span className="t-call-name">
                {p.name}
                <small>{status}</small>
              </span>
              {!self && player.connected && <PeerVoiceControl player={player} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
