import { formatAvg, formatPts, type StandingRow } from '@domino/shared';

export function Standings({ rows, youLetter }: { rows: StandingRow[]; youLetter: string | null }) {
  return (
    <div className="table-scroll">
      <table className="standings">
        <caption className="sr-only">Tabla de posiciones</caption>
        <thead>
          <tr>
            <th scope="col" className="col-rank">
              #
            </th>
            <th scope="col" className="col-name">
              Jugador
            </th>
            <th scope="col" title="Partidos jugados">
              PJ
            </th>
            <th scope="col" title="Partidos ganados">
              PG
            </th>
            <th scope="col" title="Zapateros ganados">
              Zap
            </th>
            <th scope="col" className="col-secondary" title="Zapateros recibidos">
              ZapR
            </th>
            <th scope="col" title="Puntos">
              Pts
            </th>
            <th scope="col" title="Puntos por partido jugado">
              Avg
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.letter}
              className={r.letter === youLetter ? 'is-you' : ''}
              data-letter={r.letter}
            >
              <td className="col-rank">{r.rank}</td>
              <th scope="row" className="col-name">
                <span className="letter-badge">{r.letter}</span>
                <span className="name-text">{r.name}</span>
                {r.letter === youLetter && <span className="tag">tú</span>}
              </th>
              <td>{r.pj}</td>
              <td>{r.pg}</td>
              <td>{r.zap}</td>
              <td className="col-secondary">{r.zapReceived}</td>
              <td className="pts">{formatPts(r.pts)}</td>
              <td>{formatAvg(r.avg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
