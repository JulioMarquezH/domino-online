import {
  canPass,
  fitsEnd,
  partnerOf,
  playableEnds,
  type End,
  type RoomView,
  type Seat as SeatNo,
  type TileId,
} from '@domino/shared';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sfx } from '../audio/sfx';
import { actions, leaveRoom } from '../net/client';
import { navigate } from '../net/router';
import { Avatar } from '../ui/Avatar';
import { DoorIcon, SpeakerIcon, SpeakerOffIcon } from '../ui/icons';
import { FullscreenButton } from '../ui/FullscreenButton';
import { autoFullscreen } from '../ui/landscape';
import { SelfMicButton } from '../ui/VoiceControls';
import { Announcer, type Announcement } from './Announcer';
import { Board } from './Board';
import { derive } from './derive';
import { Hand, type DropSpot } from './Hand';
import { HandSummary } from './HandSummary';
import { MatchEnd } from './MatchEnd';
import { Scoreboard } from './Scoreboard';
import { Seat } from './Seat';

export function Table({ view }: { view: RoomView }) {
  const d = derive(view);
  const g = view.game;
  const [selected, setSelected] = useState<TileId | null>(null);
  const [shake, setShake] = useState<{ tile: TileId; n: number } | null>(null);
  const [dragTile, setDragTile] = useState<TileId | null>(null);
  const [hoverEnd, setHoverEnd] = useState<End | null>(null);
  const [pending, setPending] = useState(false);
  // Events that were already there when we mounted (e.g. after a reload) are not announced.
  const [initialEventId] = useState(() => view.game?.lastEvent?.id ?? null);

  const mySeat = d.mySeat ?? 0;
  const paused = view.pause.length > 0;
  const myTurn = view.phase === 'playing' && g !== null && g.turn === mySeat && !paused;
  const hand = useMemo(() => g?.hand ?? [], [g?.hand]);
  const line = useMemo(() => g?.line ?? [], [g?.line]);
  const canPassNow = myTurn && canPass(hand, line);
  const selectedTile = selected && hand.includes(selected) ? selected : null;

  const ev = g?.lastEvent && g.lastEvent.id !== initialEventId ? g.lastEvent : null;
  const announcement = ((): Announcement | null => {
    if (!ev) return null;
    const who = (seat: SeatNo) => (seat === mySeat ? null : d.nameAt(seat));
    if (ev.type === 'pass') {
      const name = who(ev.seat);
      return { id: ev.id, text: name ? `${name} pasó` : 'Pasaste', tone: 'pass' };
    }
    if (ev.type === 'domino') {
      const name = who(ev.seat);
      return { id: ev.id, text: name ? `¡Dominó ${name}!` : '¡Dominó!', tone: 'domino' };
    }
    if (ev.type === 'tranque') return { id: ev.id, text: '¡Tranque!', tone: 'tranque' };
    return null;
  })();
  const passAt = (seat: SeatNo | null) =>
    ev?.type === 'pass' && seat !== null && ev.seat === seat ? ev.id : null;

  // ── sounds, only for things that happen while we watch ──
  const lineLen = useRef(line.length);
  const wasMyTurn = useRef(myTurn);
  const lastPass = useRef<number | null>(null);
  useEffect(() => {
    if (line.length > lineLen.current) sfx.tile();
    lineLen.current = line.length;
  }, [line.length]);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) {
      sfx.turn();
      navigator.vibrate?.([70, 50, 70]);
    }
    wasMyTurn.current = myTurn;
  }, [myTurn]);
  useEffect(() => {
    if (ev?.type === 'pass' && lastPass.current !== ev.id) {
      lastPass.current = ev.id;
      sfx.pass();
    }
  }, [ev]);

  if (!g) return null;

  const doShake = (tile: TileId) => {
    setSelected(null);
    setShake((s) => ({ tile, n: (s?.n ?? 0) + 1 }));
  };

  const attempt = async (tile: TileId, end: End) => {
    if (!myTurn || pending || !fitsEnd(tile, end, g.line)) {
      doShake(tile);
      return;
    }
    setPending(true);
    const res = await actions.play(tile, end, view.version);
    setPending(false);
    if (res.ok) setSelected(null);
    else doShake(tile);
  };

  /**
   * A tile dropped (or a selected tile tapped) anywhere on the table: play it on the end it
   * fits; if it fits both, on the end closest to the finger. A tile that fits nowhere shakes.
   */
  const playOnBoard = (tile: TileId, x: number | null, y: number | null) => {
    const ends = playableEnds(tile, g.line);
    if (ends.length === 0) {
      doShake(tile);
      return;
    }
    let end = ends[0] as End;
    if (ends.length > 1 && x !== null && y !== null) {
      let best = Infinity;
      document.querySelectorAll<HTMLElement>('[data-end-target]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const dist = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        const e = el.dataset.endTarget as End;
        if (ends.includes(e) && dist < best) {
          best = dist;
          end = e;
        }
      });
    }
    void attempt(tile, end);
  };

  const onDrop = (tile: TileId, spot: DropSpot) => {
    if (spot.kind === 'end') void attempt(tile, spot.end);
    else playOnBoard(tile, spot.x, spot.y);
  };

  const pass = async () => {
    if (!canPassNow || pending) return;
    setPending(true);
    await actions.pass(view.version);
    setPending(false);
  };

  const seatAt = (offset: 1 | 2 | 3) => d.bySeat.get(((mySeat + offset) % 4) as SeatNo);
  const right = seatAt(1);
  const top = seatAt(2);
  const left = seatAt(3);
  const partner = partnerOf(mySeat);
  const turnIs = (seat: SeatNo | null | undefined) =>
    view.phase === 'playing' && seat !== null && seat !== undefined && g.turn === seat;
  const turnPos = view.phase === 'playing' && !paused ? d.position(g.turn) : null;

  return (
    <div
      className={`screen table-screen felt game-screen ${myTurn ? 'is-my-turn' : ''} ${turnPos ? 'has-turn' : ''}`}
      onPointerUpCapture={autoFullscreen}
    >
      <div className="table-grid">
        <div className="cell c-top-left">
          <Scoreboard
            scores={g.scores}
            target={g.target}
            myTeam={d.myTeam}
            teamLabel={d.teamLabel}
            teamNames={d.teamNames}
            handNumber={g.handNumber}
          />
        </div>
        <div className="cell c-top">
          {top && (
            <Seat
              player={top}
              position="top"
              isTurn={turnIs(top.seat)}
              isPartner={top.seat === partner}
              dealKey={g.handNumber}
              passedAt={passAt(top.seat)}
            />
          )}
        </div>
        <div className="cell c-top-right">
          <TableControls />
        </div>
        <div className="cell c-left">
          {left && (
            <Seat
              player={left}
              position="left"
              isTurn={turnIs(left.seat)}
              isPartner={false}
              dealKey={g.handNumber}
              passedAt={passAt(left.seat)}
            />
          )}
        </div>
        <div className="cell c-center">
          <div className={`rail ${turnPos ? `turn-${turnPos}` : ''}`}>
            <Board
              line={g.line}
              origin={g.origin}
              showTargets={myTurn && (selectedTile !== null || dragTile !== null)}
              hoverEnd={hoverEnd}
              onTarget={(end) => {
                if (selectedTile) void attempt(selectedTile, end);
              }}
              onBoardTap={(x, y) => {
                if (selectedTile && myTurn) playOnBoard(selectedTile, x, y);
              }}
              positionOf={d.position}
            />
            <Announcer message={announcement} />
            {turnPos && (
              <div
                className={`turn-badge at-${turnPos} ${myTurn ? 'mine' : ''}`}
                aria-live="polite"
              >
                {myTurn ? (
                  '¡Te toca!'
                ) : (
                  <>
                    Juega <strong>{d.nameAt(g.turn)}</strong>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="cell c-right">
          {right && (
            <Seat
              player={right}
              position="right"
              isTurn={turnIs(right.seat)}
              isPartner={false}
              dealKey={g.handNumber}
              passedAt={passAt(right.seat)}
            />
          )}
        </div>
        <div className="cell c-bottom-left">
          <div className={`self-seat ${myTurn ? 'is-turn' : ''}`}>
            {d.me && <Avatar player={d.me} team={d.myTeam} isSelf active={myTurn} />}
            <span className="self-label">{myTurn ? 'Te toca' : 'Tú'}</span>
          </div>
        </div>
        <div className="cell c-bottom">
          <Hand
            tiles={hand}
            selected={selectedTile}
            shake={shake}
            dealKey={g.handNumber}
            myTurn={myTurn}
            onSelect={setSelected}
            onDrop={onDrop}
            onDragChange={(tile, hover) => {
              setDragTile(tile);
              setHoverEnd(hover);
              if (tile) setSelected(null);
            }}
          />
        </div>
        <div className="cell c-bottom-right">
          <button
            type="button"
            className="btn pass-btn"
            disabled={!canPassNow || pending}
            onClick={() => void pass()}
          >
            Pasar
          </button>
        </div>
      </div>
      {view.phase === 'handEnd' && <HandSummary view={view} />}
      {view.phase === 'matchEnd' && <MatchEnd view={view} />}
    </div>
  );
}

function TableControls() {
  const soundOn = useSyncExternalStore(sfx.subscribe, sfx.isEnabled);
  const [confirmLeave, setConfirmLeave] = useState(false);
  return (
    <div className="table-controls">
      <FullscreenButton />
      <SelfMicButton compact />
      <button
        type="button"
        className={`icon-btn compact ${soundOn ? '' : 'is-off'}`}
        onClick={() => sfx.setEnabled(!soundOn)}
        aria-pressed={soundOn}
        aria-label={soundOn ? 'Apagar sonidos' : 'Encender sonidos'}
        title={soundOn ? 'Sonidos encendidos' : 'Sonidos apagados'}
      >
        {soundOn ? <SpeakerIcon size={18} /> : <SpeakerOffIcon size={18} />}
      </button>
      {confirmLeave ? (
        <span className="leave-confirm">
          <button
            type="button"
            className="btn danger small"
            onClick={() => {
              leaveRoom();
              navigate('/');
            }}
          >
            Salir
          </button>
          <button type="button" className="btn ghost small" onClick={() => setConfirmLeave(false)}>
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="icon-btn compact"
          onClick={() => setConfirmLeave(true)}
          aria-label="Salir de la partida"
          title="Salir"
        >
          <DoorIcon size={18} />
        </button>
      )}
    </div>
  );
}
