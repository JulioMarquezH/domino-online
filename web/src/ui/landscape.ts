type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

export function canLockLandscape(): boolean {
  const o = screen.orientation as LockableOrientation | undefined;
  return (
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof o?.lock === 'function'
  );
}

/** Fullscreen + landscape lock where supported (Android Chrome). Must run inside a gesture. */
export async function tryLandscape(): Promise<void> {
  if (!canLockLandscape() || !matchMedia('(pointer: coarse)').matches) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    await (screen.orientation as LockableOrientation).lock?.('landscape');
  } catch {
    // iOS and desktop: the rotate overlay covers it.
  }
}
