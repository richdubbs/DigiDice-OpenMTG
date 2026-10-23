/** A time that moves while something counts down on screen: the clocks, the rope, the ready check. */
import { useEffect, useState } from 'react';

/**
 * `Date.now()`, redrawn every `everyMs` while `active` (and once when it turns active). The server sends the clocks only when one starts or stops, so the
 * page counts down by itself from the moment a clock arrived (hosted/clocks.ts).
 */
export function useNow(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}
