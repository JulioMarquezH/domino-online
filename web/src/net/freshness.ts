/**
 * After a deploy, phones keep running the old code: the socket reconnects by itself but the page
 * never reloads, and an old client next to new ones breaks things (e.g. the voice call). So on
 * every reconnection and whenever the page comes back to the foreground we ask the server which
 * build it serves and reload if it is a different one. Seats, hands and the tournament identity
 * are all recovered from the device's tokens after the reload.
 */
declare const __BUILD_ID__: string;

const OWN = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
let reloading = false;

export async function reloadIfStale(): Promise<void> {
  if (OWN === 'dev' || reloading || import.meta.env.DEV) return;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: string };
    if (build && build !== OWN) {
      reloading = true;
      window.location.reload();
    }
  } catch {
    // offline: try again on the next reconnection
  }
}

export function watchForNewVersion(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reloadIfStale();
  });
}
