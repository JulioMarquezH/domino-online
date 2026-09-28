import {
  handPips,
  parseTile,
  seatsOfTeam,
  type HandResultView,
  type Seat,
  type Team,
} from '@domino/shared';
import { TileFace } from '../ui/Tile';
import type { Derived } from './derive';

/** Both pairs side by side: each player's tiles, and each pair's total. */
export function HandBreakdown({ result, d }: { result: HandResultView; d: Derived }) {
  const teams: Team[] = d.myTeam === 1 ? [1, 0] : [0, 1];
  const seatsFor = (t: Team): Seat[] => {
    const seats = seatsOfTeam(t);
    return d.mySeat !== null && seats.includes(d.mySeat)
      ? [d.mySeat, ...seats.filter((s) => s !== d.mySeat)]
      : seats;
  };
  const [a, b] = teams as [Team, Team];
  const pa = result.teamPips[a];
  const pb = result.teamPips[b];
  const isTranque = result.kind !== 'domino';

  const panel = (t: Team) => {
    const state = result.winnerTeam === null ? 'tie' : result.winnerTeam === t ? 'winner' : 'loser';
    return (
      <section className={`team-panel team-${t} ${state}`} key={t}>
        <header>
          <span className="team-name">{d.teamLabel(t)}</span>
          {state === 'winner' && <span className="win-badge">Gana</span>}
        </header>
        <ul>
          {seatsFor(t).map((seat) => {
            const hand = result.hands[seat] ?? [];
            return (
              <li key={seat}>
                <span className="bd-name">{seat === d.mySeat ? 'Tú' : d.nameAt(seat)}</span>
                <span className="bd-tiles">
                  {hand.length === 0 ? (
                    <em>sin fichas</em>
                  ) : (
                    hand.map((tile) => {
                      const [hi, lo] = parseTile(tile);
                      return (
                        <span key={tile} className="reveal-tile">
                          <TileFace top={hi} bottom={lo} />
                        </span>
                      );
                    })
                  )}
                </span>
                <span className="bd-pips">{handPips(hand)}</span>
              </li>
            );
          })}
        </ul>
        <footer>
          <span>
            {state === 'loser' && result.winnerTeam !== null
              ? result.winnerTeam === d.myTeam
                ? 'Lo anotamos nosotros'
                : 'Lo anotan ellos'
              : 'Total en fichas'}
          </span>
          <strong>{result.teamPips[t]}</strong>
        </footer>
      </section>
    );
  };

  return (
    <div className={`breakdown ${isTranque ? 'is-tranque' : ''}`}>
      {panel(a)}
      <div className="bd-vs" aria-hidden={!isTranque}>
        {isTranque ? (
          <>
            <span>{pa}</span>
            <span className="bd-sign">{pa < pb ? '<' : pa > pb ? '>' : '='}</span>
            <span>{pb}</span>
          </>
        ) : (
          <span className="bd-sign">vs</span>
        )}
      </div>
      {panel(b)}
    </div>
  );
}
