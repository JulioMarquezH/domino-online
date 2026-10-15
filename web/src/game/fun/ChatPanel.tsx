import { CHAT_MAX_LENGTH, REACTIONS, type PublicPlayer } from '@domino/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { sendChat, sendReaction, setChatOpen, useFun } from '../../net/fun';

/** In-game chat drawer: messages, quick reactions and a line to write. */
export function ChatPanel({ players, youId }: { players: PublicPlayer[]; youId: string }) {
  const { chat, open } = useFun();
  const [text, setText] = useState('');
  const [slow, setSlow] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, open]);

  if (!open) return null;
  const nameOf = (id: string) =>
    id === youId ? 'Tú' : (players.find((p) => p.id === id)?.name ?? '—');

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const res = await sendChat(t);
    if (res.ok) setText('');
    else if (res.code === 'SLOW_DOWN') {
      setSlow(true);
      setTimeout(() => setSlow(false), 2500);
    }
  };

  return (
    <aside className="chat-panel" aria-label="Chat de la partida">
      <header>
        <strong>Chat</strong>
        <button type="button" className="btn ghost small" onClick={() => setChatOpen(false)}>
          Cerrar
        </button>
      </header>
      <ul ref={list} className="chat-list">
        {chat.length === 0 && <li className="chat-empty">Nadie ha escrito todavía.</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.from === youId ? 'mine' : ''}>
            <strong>{nameOf(m.from)}</strong> {m.text}
          </li>
        ))}
      </ul>
      <div className="chat-reactions" role="group" aria-label="Reacciones">
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => void sendReaction(r)}
            aria-label={`Reacción ${r}`}
          >
            {r}
          </button>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={slow ? 'Más despacio…' : 'Escribe algo…'}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button type="submit" className="btn primary small" disabled={!text.trim()}>
          Enviar
        </button>
      </form>
    </aside>
  );
}
