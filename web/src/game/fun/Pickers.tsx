import { REACTIONS, THROWABLES, type PublicPlayer } from '@domino/shared';
import { sendReaction, throwAt } from '../../net/fun';
import { THROW_ITEMS } from './items';

/** "Lanzar": the things you can throw at someone. */
export function ThrowPicker({ target, onDone }: { target: PublicPlayer; onDone: () => void }) {
  return (
    <div className="throw-picker" role="group" aria-label={`Lanzarle algo a ${target.name}`}>
      <span className="picker-title">Lanzar</span>
      <div className="picker-row">
        {THROWABLES.map((t) => (
          <button
            key={t}
            type="button"
            title={THROW_ITEMS[t].label}
            aria-label={`${THROW_ITEMS[t].label} a ${target.name}`}
            onClick={() => {
              void throwAt(target.id, t);
              onDone();
            }}
          >
            {THROW_ITEMS[t].emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReactionPicker({ onDone }: { onDone: () => void }) {
  return (
    <div className="throw-picker" role="group" aria-label="Reacciones">
      <span className="picker-title">Reaccionar</span>
      <div className="picker-row">
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-label={`Reacción ${r}`}
            onClick={() => {
              void sendReaction(r);
              onDone();
            }}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
