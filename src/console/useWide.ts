import { useEffect, useState } from 'react';

/** True when the screen is at least this wide. */
export function useWide(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}
