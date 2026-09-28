import { useSyncExternalStore } from 'react';

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };
type IOSNavigator = Navigator & { standalone?: boolean };

export const isTouch = () => matchMedia('(pointer: coarse)').matches;

export const isIOS = () =>
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Launched from the home screen: there is no browser bar to hide. */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
  (navigator as IOSNavigator).standalone === true;

/** The Fullscreen API works for pages (Android Chrome, desktop). iPhone Safari lacks it. */
export const canFullscreen = () =>
  typeof document.documentElement.requestFullscreen === 'function' &&
  document.fullscreenEnabled !== false;

export function canLockLandscape(): boolean {
  const o = screen.orientation as LockableOrientation | undefined;
  return canFullscreen() && typeof o?.lock === 'function';
}

/** Fullscreen + landscape lock. Must run inside a click / pointerup / touchend handler. */
export async function enterFullscreen(): Promise<void> {
  if (!canFullscreen()) return;
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    await (screen.orientation as LockableOrientation).lock?.('landscape');
  } catch {
    // Not allowed right now; the button stays available.
  }
}

let autoTried = false;

/**
 * On a phone, the first tap in the game hides the browser bars (Android). Only once per load:
 * if the player leaves fullscreen on purpose we don't fight them (the button remains).
 * Call it from pointerup/click: pointerdown does not count as a user activation on touch.
 */
export function autoFullscreen(): void {
  if (autoTried || !isTouch() || isStandalone() || !canFullscreen()) return;
  autoTried = true;
  void enterFullscreen();
}

function subscribeFullscreen(fn: () => void) {
  document.addEventListener('fullscreenchange', fn);
  return () => document.removeEventListener('fullscreenchange', fn);
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null);
}
