import { useEffect, useState } from 'react';

export interface Announcement {
  id: number;
  text: string;
  tone: string;
}

/** Short centered announcements: "Pedro pasó", "¡Tranque!", "¡Dominó Ana!". */
export function Announcer({ message }: { message: Announcement | null }) {
  const [hiddenId, setHiddenId] = useState<number | null>(null);
  const id = message?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    const t = setTimeout(() => setHiddenId(id), 1900);
    return () => clearTimeout(t);
  }, [id]);
  if (!message || message.id === hiddenId) return null;
  return (
    <div
      key={message.id}
      className={`announce tone-${message.tone}`}
      role="status"
      aria-live="polite"
    >
      {message.text}
    </div>
  );
}
