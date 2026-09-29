import type { PublicPlayer } from '@domino/shared';

export function voiceStatusText(
  player: PublicPlayer,
  isSelf: boolean,
  conn: string | undefined,
  selfMic: string,
): string {
  if (player.isBot) return 'Juega la IA';
  if (!player.connected) return 'Reconectando…';
  if (isSelf) {
    if (selfMic === 'pending') return 'Activando micrófono…';
    if (selfMic === 'off') return 'Solo escucha';
    if (selfMic === 'muted') return 'Silenciado';
    return 'Micrófono abierto';
  }
  if (conn === 'failed') return 'Sin conexión de voz';
  if (conn !== 'connected') return 'Conectando voz…';
  if (player.mic === 'off') return 'Solo escucha';
  if (player.mic === 'muted') return 'Silenciado';
  return 'En la llamada';
}
