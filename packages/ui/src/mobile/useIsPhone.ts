import { useEffect, useState } from 'react';

/**
 * True on a phone-sized screen.
 *
 * 768px is where the desktop dashboard stops fitting: its sidebar alone is
 * 280px and the header's right-hand controls sit past x=850, so below this the
 * layout is not cramped, it is cut off. Measured on a 390px viewport, three
 * header buttons and three run-profile buttons were entirely off-screen.
 */
const PHONE_QUERY = '(max-width: 768px)';

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => {
    try {
      return window.matchMedia(PHONE_QUERY).matches;
    } catch {
      // jsdom and older browsers without matchMedia: assume desktop.
      return false;
    }
  });

  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia(PHONE_QUERY);
    } catch {
      return;
    }
    const handler = (event: MediaQueryListEvent) => setIsPhone(event.matches);
    // Rotating the phone changes the answer, so this has to stay live.
    media.addEventListener('change', handler);
    setIsPhone(media.matches);
    return () => media.removeEventListener('change', handler);
  }, []);

  return isPhone;
}
