import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/dm-sans/wght.css';
import './styles/base.css';
import './styles/screens.css';
import './styles/table.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installGestureUnlock } from './audio/context';
import { getClientState } from './net/client';
import { voice } from './voice/voice';

installGestureUnlock(() => voice.unlock());

// iOS Safari ignores user-scalable=no; block pinch-zoom and double-tap zoom in rooms.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

if (import.meta.env.DEV) {
  // Debug hooks for local end-to-end checks.
  Object.assign(window, { __domino: { voice, state: getClientState } });
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
