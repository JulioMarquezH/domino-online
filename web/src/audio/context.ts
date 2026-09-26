/**
 * One shared AudioContext for sound effects and voice level meters. Browsers only let it
 * run after a user gesture, so we create/resume it on the first tap and on every later one
 * while it is suspended (iOS suspends it when the app goes to the background).
 */
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    ctx.addEventListener('statechange', () => listeners.forEach((l) => l()));
  } catch {
    ctx = null;
  }
  return ctx;
}

export function isAudioRunning(): boolean {
  return ctx?.state === 'running';
}

export function onAudioStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call from inside a user gesture handler. */
export function unlockAudio(): void {
  const c = getAudioContext();
  if (c && c.state !== 'running') void c.resume().catch(() => undefined);
  listeners.forEach((l) => l());
}

let installed = false;
export function installGestureUnlock(extra?: () => void): void {
  if (installed) return;
  installed = true;
  const handler = () => {
    unlockAudio();
    extra?.();
  };
  window.addEventListener('pointerdown', handler, { capture: true, passive: true });
  window.addEventListener('keydown', handler, { capture: true, passive: true });
}
