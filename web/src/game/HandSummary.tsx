import type { RoomView } from '@domino/shared';
import { useState } from 'react';
import { actions } from '../net/client';
import { derive } from './derive';
import { HandBreakdown } from './HandBreakdown';
import { verdictOf } from './verdict';

export function HandSummary({ view, onHide }: { view: RoomView; onHide: () => void }) {
  const d = derive(view);
  const r = view.handResult;
  const g = view.game;
  const [sent, setSent] = useState(false);
  if (!r || !g) return null;
  const v = verdictOf(r, d);
  const imReady = sent || view.ready.includes(view.youId);
  const us = d.myTeam ?? 0;
  const them = us === 0 ? 1 : 0;
  const waiting = view.players.filter((p) => !p.isBot && !view.ready.includes(p.id));
  return (
    <div className="overlay summary-overlay">
      <div className="card overlay-card summary-card" role="dialog" aria-label="Fin de la mano">
        <div className="summary-top">
          <p className="eyebrow">
            Mano {g.handNumber} · {v.kicker}
          </p>
          <button type="button" className="btn ghost small hide-summary" onClick={onHide}>
            Ver mesa
          </button>
        </div>
        <div className="verdict">
          <h2
            className={`title verdict-title ${v.winner === null ? 'tie' : `team-text-${v.winner}`}`}
          >
            {v.title}
          </h2>
          <span className={`points-pill ${v.winner === null ? 'tie' : `team-${v.winner}`}`}>
            {v.points}
          </span>
        </div>
        <p className="verdict-explain">{v.explain}</p>
        <HandBreakdown result={r} d={d} />
        <div className="summary-foot">
          <div className="summary-score">
            <span className={`team-text-${us}`}>
              {d.teamLabel(us)} {g.scores[us]}
            </span>
            <span className="sep">—</span>
            <span className={`team-text-${them}`}>
              {d.teamLabel(them)} {g.scores[them]}
            </span>
            <span className="muted"> · a {g.target}</span>
          </div>
          <div className="summary-actions">
            <button
              type="button"
              className="btn primary"
              disabled={imReady}
              onClick={() => {
                setSent(true);
                void actions.ready();
              }}
            >
              {imReady ? 'Listo ✓' : 'Continuar'}
            </button>
            <span className="muted small">
              {waiting.length === 0
                ? 'Empezando…'
                : `Esperando a ${waiting.map((p) => (p.id === view.youId ? 'ti' : p.name)).join(', ')}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
