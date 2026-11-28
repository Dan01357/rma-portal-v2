import { useState, useEffect } from 'react';

const MD_MEDIA_QUERY = '(min-width: 768px)';

/**
 * Matches Tailwind's `md` breakpoint (`>= 768px`).
 * Used to mount either the Desktop table view or the Mobile card view (not both simultaneously),
 * keeping DOM lightweight and avoiding duplicate text nodes across hidden responsive containers.
 */
export function useIsDesktopMd() {
  const [isDesktopMd, setIsDesktopMd] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true;
    }
    return window.matchMedia(MD_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(MD_MEDIA_QUERY);
    const update = (e) => setIsDesktopMd(e ? e.matches : mql.matches);
    setIsDesktopMd(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, []);

  return isDesktopMd;
}
