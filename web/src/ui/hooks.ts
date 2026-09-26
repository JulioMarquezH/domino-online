import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useClient } from '../net/client';

// A shared 4 Hz clock for countdowns, exposed as an external store.
let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(fn: () => void): () => void {
  clockListeners.add(fn);
  if (!clockTimer) {
    clockNow = performance.now();
    clockTimer = setInterval(() => {
      clockNow = performance.now();
      clockListeners.forEach((l) => l());
    }, 250);
  }
  return () => {
    clockListeners.delete(fn);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Counts down from a server-provided "ms remaining" (relative to when the view arrived). */
export function useCountdown(remainingMs: number | null): number | null {
  const { receivedAt } = useClient();
  const now = useSyncExternalStore(subscribeClock, () => clockNow);
  if (remainingMs === null) return null;
  return Math.max(0, Math.min(remainingMs, receivedAt + remainingMs - now));
}

export function useElementSize<T extends HTMLElement>(): [
  RefObject<T | null>,
  { w: number; h: number },
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Copies text to the clipboard with a fallback for older mobile browsers. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    copied,
    (text: string) => {
      void copyText(text).then((ok) => {
        if (!ok) return;
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1800);
      });
    },
  ];
}
