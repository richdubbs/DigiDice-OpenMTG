/**
 * Live format checks for the deckbuilder (docs/design/decks-and-formats.md "Live checks"): the deck is sent to POST /api/decks/validate shortly after
 * each change; an older answer never replaces a newer one. While a new check runs, the previous answer stays available (`previous`), so the problems on
 * screen do not vanish and come back on every click (rows would jump under the pointer).
 */
import { useEffect, useRef, useState } from 'react';
import type { ValidateResponse } from '@openmtg/server/api';
import { sfx } from '../audio/sfx';
import { describeApiError, type DecksApi } from './context';
import type { Deck } from './model';

export type ValidationState =
  | { status: 'idle' }
  | { status: 'checking'; previous?: ValidateResponse }
  | { status: 'done'; result: ValidateResponse }
  | { status: 'error'; message: string };

/** The answer to show now: the current one, or the previous one while re-checking. */
export function shownResult(state: ValidationState): ValidateResponse | undefined {
  return state.status === 'done' ? state.result : state.status === 'checking' ? state.previous : undefined;
}

/** Wait this long after the last change before asking (typing counts quickly add up). */
export const VALIDATE_DELAY_MS = 300;

export function useValidation(api: DecksApi, deck: Deck | null, delayMs = VALIDATE_DELAY_MS): ValidationState {
  const [state, setState] = useState<ValidationState>({ status: 'idle' });
  const last = useRef<{ format: string; result: ValidateResponse } | undefined>(undefined);
  // Only the card lists and the format matter; renaming or editing notes does not re-validate.
  const key = deck ? JSON.stringify([deck.format, deck.main, deck.sideboard, deck.commander, deck.companion]) : '';
  const format = deck?.format;

  useEffect(() => {
    if (!deck) return;
    const ctrl = new AbortController();
    // An answer for another format would show the wrong format's problems.
    const previous = last.current && last.current.format === format ? last.current.result : undefined;
    setState(previous ? { status: 'checking', previous } : { status: 'checking' });
    const timer = setTimeout(() => {
      api.validate(deck, deck.format, ctrl.signal).then(
        (result) => {
          if (ctrl.signal.aborted) return;
          last.current = { format: deck.format, result };
          setState({ status: 'done', result });
        },
        (err: unknown) => {
          if (ctrl.signal.aborted) return;
          last.current = undefined;
          setState({ status: 'error', message: describeApiError(err) });
        },
      );
    }, delayMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // `deck` is captured through `key`.
  }, [api, key, delayMs]);

  return state;
}

/**
 * The format check's sound: deck.legal or deck.illegal when a check finishes with a different answer than the last one (the deck just became legal, or a
 * change broke it, or another format judges it differently). The first answer after the deck opens is silent (opening a deck is not news), and so is a
 * re-check that agrees with the last answer: otherwise every card added to a deck that is still short of 60 would say "illegal". "Not fully checked"
 * (warnings) counts as not legal. A check that could not be done sounds ui.error, once until a check succeeds again.
 */
export function useValidationSound(state: ValidationState): void {
  const last = useRef<'legal' | 'problems' | 'error' | null>(null);
  useEffect(() => {
    if (state.status === 'done') {
      const now = state.result.status === 'legal' ? 'legal' : 'problems';
      if ((last.current === 'legal' || last.current === 'problems') && last.current !== now) sfx(now === 'legal' ? 'deck.legal' : 'deck.illegal');
      last.current = now;
    } else if (state.status === 'error') {
      if (last.current !== 'error') sfx('ui.error');
      last.current = 'error';
    }
  }, [state]);
}
