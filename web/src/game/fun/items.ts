import type { Throwable } from '@domino/shared';

/** What can be thrown, how it looks flying and what it leaves when it lands. */
export const THROW_ITEMS: Record<Throwable, { emoji: string; impact: string; label: string }> = {
  tomato: { emoji: '🍅', impact: '💦', label: 'Tomate' },
  egg: { emoji: '🥚', impact: '🍳', label: 'Huevo' },
  bomb: { emoji: '💣', impact: '💥', label: 'Bomba' },
  chancla: { emoji: '🩴', impact: '💫', label: 'Chancla' },
  rose: { emoji: '🌹', impact: '🌸', label: 'Rosa' },
  kiss: { emoji: '💋', impact: '💕', label: 'Beso' },
};
