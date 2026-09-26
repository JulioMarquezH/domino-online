import { useVoice } from '../voice/useVoice';

/** Explains a missing/blocked microphone. The game still works and you still hear others. */
export function MicNotice() {
  const v = useVoice();
  if (v.mic !== 'off' || !v.micIssue) return null;
  const text =
    v.micIssue === 'denied'
      ? 'No diste permiso al micrófono. Puedes jugar y escuchar a los demás; para hablar, permite el micrófono en el navegador y recarga.'
      : v.micIssue === 'insecure'
        ? 'El micrófono necesita una conexión segura (HTTPS). Puedes jugar y escuchar a los demás.'
        : 'No encontramos un micrófono. Puedes jugar y escuchar a los demás.';
  return (
    <p className="notice" role="status">
      {text}
    </p>
  );
}
