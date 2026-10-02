import { standingsText, type LetterAssignment, type TournamentView } from '@domino/shared';
import { useState } from 'react';
import { unlockAudio } from '../../audio/context';
import { navigate, roomPath, tournamentUrl } from '../../net/router';
import { exportTournament, leaveTournament, playNext } from '../../net/tournament';
import { copyText, useCopied } from '../../ui/hooks';
import { CheckIcon, DoorIcon, DownloadIcon, LinkIcon, TableIcon, TrophyIcon } from '../../ui/icons';
import { downloadJson, nameOf } from './format';
import { History } from './History';
import { Schedule } from './Schedule';
import { Standings } from './Standings';

export function TournamentPage({ view, you }: { view: TournamentView; you: LetterAssignment }) {
  const [linkCopied, copyLink] = useCopied();
  const [tableCopied, setTableCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const finished = view.status === 'finished';

  const onPlay = async () => {
    unlockAudio();
    setBusy(true);
    setError(null);
    const res = await playNext();
    setBusy(false);
    if (res.ok) navigate(roomPath(res.roomId));
    else if (res.code === 'FINISHED') setError('El torneo ya terminó.');
    else setError('No pudimos abrir la sala. Revisa tu conexión e inténtalo de nuevo.');
  };

  const onCopyTable = async () => {
    const ok = await copyText(standingsText(view.standings, view.played));
    setTableCopied(ok);
    if (ok) setTimeout(() => setTableCopied(false), 1800);
  };

  const onExport = async () => {
    setExporting(true);
    const data = await exportTournament();
    setExporting(false);
    if (!data) {
      setError('No pudimos descargar el respaldo. Inténtalo de nuevo.');
      return;
    }
    downloadJson(`torneo-${view.id}-${new Date().toISOString().slice(0, 10)}.json`, data);
  };

  return (
    <div className="screen tournament">
      <header className="t-head">
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            leaveTournament();
            navigate('/');
          }}
        >
          <DoorIcon size={18} /> Inicio
        </button>
        <div className="t-title">
          <span className="eyebrow">Torneo</span>
          <span className="t-id" aria-label={`Código del torneo ${view.id}`}>
            {view.id}
          </span>
        </div>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => copyLink(tournamentUrl(view.id))}
        >
          {linkCopied ? <CheckIcon size={18} /> : <LinkIcon size={18} />}
          {linkCopied ? 'Enlace copiado' : 'Copiar enlace'}
        </button>
      </header>

      <p className="t-you">
        Juegas como{' '}
        <strong>
          {you.name} <span className="letter-badge">{you.letter}</span>
        </strong>
        <span className="muted">
          {' '}
          · a {view.target} puntos · {view.played} de 12 partidos
        </span>
      </p>

      {finished && <ChampionBanner view={view} />}

      <main className="t-grid">
        <section className="card t-standings" aria-labelledby="t-standings-title">
          <h2 id="t-standings-title">Tabla</h2>
          <Standings rows={view.standings} youLetter={you.letter} />
          <div className="t-actions">
            <button type="button" className="btn secondary small" onClick={onCopyTable}>
              {tableCopied ? <CheckIcon size={18} /> : <TableIcon size={18} />}
              {tableCopied ? 'Tabla copiada' : 'Copiar tabla'}
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={onExport}
              disabled={exporting}
            >
              <DownloadIcon size={18} /> {exporting ? 'Preparando…' : 'Descargar respaldo'}
            </button>
          </div>
        </section>

        <section className="card t-schedule" aria-labelledby="t-schedule-title">
          <h2 id="t-schedule-title">{finished ? 'Calendario' : 'Partidos'}</h2>
          <Schedule view={view} busy={busy} onPlay={onPlay} />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="card t-history" aria-labelledby="t-history-title">
          <h2 id="t-history-title">Historial</h2>
          <History view={view} />
        </section>
      </main>
    </div>
  );
}

function ChampionBanner({ view }: { view: TournamentView }) {
  const names = view.champions.map((l) => nameOf(view.players, l));
  const tied = names.length > 1;
  return (
    <div className="champion-banner" role="status">
      <TrophyIcon size={34} />
      <div>
        <p className="eyebrow">{tied ? 'Campeones empatados' : 'Campeón del torneo'}</p>
        <p className="champion-names">{tied ? names.join(' · ') : names[0]}</p>
      </div>
    </div>
  );
}
