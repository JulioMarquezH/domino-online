import type { Throwable } from '@domino/shared';

/** What can be thrown at the table and what it does there. */
export const THROW_ITEMS: Record<Throwable, { emoji: string; label: string; does: string }> = {
  tomato: { emoji: '🍅', label: 'Tomate', does: 'Mancha la mesa' },
  egg: { emoji: '🥚', label: 'Huevo', does: 'Un huevo frito en la mesa' },
  bomb: { emoji: '💣', label: 'Bomba', does: 'Las fichas salen volando' },
  tornado: { emoji: '🌪️', label: 'Tornado', does: 'Las fichas dan vueltas' },
  quake: { emoji: '🫨', label: 'Terremoto', does: 'Tiembla toda la mesa' },
};
