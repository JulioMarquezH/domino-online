import { useEffect, useSyncExternalStore } from 'react';
import { isAudioRunning, onAudioStateChange, unlockAudio } from './audio/context';
import { useClient } from './net/client';
import { useRoute } from './net/router';
import { Home } from './screens/Home';
import { RoomRoute } from './screens/RoomRoute';
import { TournamentCreate } from './screens/TournamentCreate';
import { TournamentRoute } from './screens/TournamentRoute';
import { SwipeHint } from './ui/SwipeHint';
import { TileDefs } from './ui/Tile';
import { useIosBarHiding } from './ui/useIosBarHiding';
import { useVoice } from './voice/useVoice';
import { voice } from './voice/voice';

export function App() {
  const route = useRoute();
  const { connected, status } = useClient();
  const inRoom = status.kind === 'in';
  const showSwipeHint = useIosBarHiding();

  useEffect(() => {
    document.documentElement.classList.toggle('in-room', route.name === 'room');
  }, [route.name]);

  return (
    <>
      <TileDefs />
      {route.name === 'home' && <Home />}
      {route.name === 'room' && <RoomRoute roomId={route.roomId} />}
      {route.name === 'torneo-nuevo' && <TournamentCreate />}
      {route.name === 'torneo' && <TournamentRoute id={route.id} />}
      {inRoom && !connected && (
        <div className="conn-banner" role="status">
          Reconectando…
        </div>
      )}
      {inRoom && <AudioUnlock />}
      {showSwipeHint && <SwipeHint />}
    </>
  );
}

/** Browsers block audio until a gesture: after a reload we ask for one tap. */
function AudioUnlock() {
  const v = useVoice();
  const running = useSyncExternalStore(onAudioStateChange, isAudioRunning);
  if (running && !v.audioBlocked) return null;
  return (
    <button
      type="button"
      className="audio-unlock"
      onClick={() => {
        unlockAudio();
        voice.unlock();
      }}
    >
      Toca para activar el audio
    </button>
  );
}
