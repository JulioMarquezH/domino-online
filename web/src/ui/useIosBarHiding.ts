import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from './landscape';

/**
 * iPhone Safari can't hide its bars from code, but a swipe up on a scrollable page hides them
 * all (verified on iOS 26). On every screen we make the page a bit taller than the viewport and
 * let vertical swipes through, so one swipe gives the app the whole screen.
 * Returns true while Safari's bars are taking space (to show the hint).
 */
export function useIosBarHiding(): boolean {
  const enabled = isIOS() && !isStandalone();
  const [barsVisible, setBarsVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.add('ios-scroll');
    const check = () => {
      const short = Math.min(screen.width, screen.height);
      const long = Math.max(screen.width, screen.height);
      const landscape = innerWidth > innerHeight;
      // Landscape: the full height is the screen's short side. Portrait: Safari's bottom bar
      // and the address bar take well over 100 points when expanded.
      setBarsVisible(landscape ? innerHeight < short - 24 : innerHeight < long - 150);
    };
    check();
    window.addEventListener('resize', check);
    window.visualViewport?.addEventListener('resize', check);
    return () => {
      root.classList.remove('ios-scroll');
      window.removeEventListener('resize', check);
      window.visualViewport?.removeEventListener('resize', check);
    };
  }, [enabled]);

  return enabled && barsVisible;
}
