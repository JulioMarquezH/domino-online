import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'room'; roomId: string }
  | { name: 'torneo-nuevo' }
  | { name: 'torneo'; id: string };

function parse(pathname: string): Route {
  const m = /^\/sala\/([^/]+)\/?$/i.exec(pathname);
  if (m?.[1]) return { name: 'room', roomId: decodeURIComponent(m[1]).toUpperCase() };
  if (/^\/torneo\/nuevo\/?$/i.test(pathname)) return { name: 'torneo-nuevo' };
  const t = /^\/torneo\/([^/]+)\/?$/i.exec(pathname);
  if (t?.[1]) return { name: 'torneo', id: decodeURIComponent(t[1]).toUpperCase() };
  return { name: 'home' };
}

const listeners = new Set<() => void>();
let current = parse(window.location.pathname);

window.addEventListener('popstate', () => {
  current = parse(window.location.pathname);
  listeners.forEach((l) => l());
});

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  current = parse(path);
  listeners.forEach((l) => l());
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export const roomPath = (roomId: string) => `/sala/${roomId}`;
export const roomUrl = (roomId: string) => `${window.location.origin}${roomPath(roomId)}`;
export const tournamentPath = (id: string) => `/torneo/${id}`;
export const tournamentUrl = (id: string) => `${window.location.origin}${tournamentPath(id)}`;
