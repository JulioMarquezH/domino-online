import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from './landscape';

/**
 * iPhone Safari can't hide its bars from code, but a swipe up on a scrollable page hides them
 * all (verified on iOS 26). During the game we make the page a bit taller than the screen
 * and let vertical swipes through, so one swipe gives the table the whole screen.
 */
export function useIosBarHiding(): boolean {
  const enabled = isIOS() && !isStandalone();
  const [barsVisible, setBarsVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.add('ios-scroll');
    const check = () => {
      // In landscape the full height equals the screen's short side.
      const full = Math.min(screen.width, screen.height);
      const landscape = innerWidth > innerHeight;
      setBarsVisible(landscape && innerHeight < full - 24);
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
