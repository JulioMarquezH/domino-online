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
    let touching = false;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const short = Math.min(screen.width, screen.height);
      const long = Math.max(screen.width, screen.height);
      const landscape = innerWidth > innerHeight;
      // Landscape: the full height is the screen's short side. Portrait: Safari's bottom bar
      // and the address bar take well over 100 points when expanded.
      const visible = landscape ? innerHeight < short - 24 : innerHeight < long - 150;
      setBarsVisible(visible);
      // Safari only hides its bars while the page scrolls down. If they came back (a new
      // screen, a URL change) with the page already scrolled to the end, a swipe would do
      // nothing; jump back to the top (invisible: every screen is fixed) so it works again.
      if (visible && window.scrollY > 0 && !touching) window.scrollTo(0, 0);
    };
    // Never touch the scroll in the middle of a swipe; re-check once the page settles.
    const onTouchStart = () => {
      touching = true;
      if (settle) clearTimeout(settle);
    };
    const onTouchEnd = () => {
      touching = false;
      if (settle) clearTimeout(settle);
      settle = setTimeout(check, 600);
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    check();
    window.addEventListener('resize', check);
    window.visualViewport?.addEventListener('resize', check);
    return () => {
      if (settle) clearTimeout(settle);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      root.classList.remove('ios-scroll');
      window.removeEventListener('resize', check);
      window.visualViewport?.removeEventListener('resize', check);
    };
  }, [enabled]);

  return enabled && barsVisible;
}
