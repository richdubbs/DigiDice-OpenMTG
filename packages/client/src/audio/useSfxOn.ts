/** React binding for a sound tied to something appearing on screen (an error box, a notice): explicit, at the place the state lives. */
import { useEffect, useRef } from 'react';
import type { SoundId } from './catalog';
import { sfx } from './sfx';

/**
 * Plays `id` each time `key` turns into a new non-empty value (an error message appears or changes). Re-renders with the same key, an empty key, and
 * StrictMode's second run of the effect stay silent; a component mounted with a key set plays at once (an error box that just appeared).
 */
export function useSfxOn(id: SoundId | null, key: unknown): void {
  const last = useRef<unknown>(undefined);
  useEffect(() => {
    const empty = key === null || key === undefined || key === false || key === '';
    if (empty) {
      last.current = undefined;
      return;
    }
    if (Object.is(last.current, key)) return;
    last.current = key;
    if (id) sfx(id);
  }, [id, key]);
}
