/**
 * What the deck library shows on each deck box besides what is stored: its colors (from the cards' data) and whether the format check passes. Both come
 * from the local server, one deck after another, so the library appears at once and fills in; a failed lookup just leaves that box without the extra
 * (the library never claims a deck is legal without an answer).
 */
import { useEffect, useRef, useState } from 'react';
import type { Color } from '@openmtg/engine';
import type { CardSummary } from '@openmtg/server/api';
import type { DecksApi } from './context';
import { deckColors } from './look';
import { sectionCount, type Deck } from './model';

export type Validity =
  | { kind: 'checking' }
  | { kind: 'empty' }
  | { kind: 'legal' }
  | { kind: 'illegal'; problems: number }
  | { kind: 'unchecked'; warnings: number }
  | { kind: 'unknown' };

export interface DeckInfo {
  /** Null until the cards' data has arrived. */
  colors: Color[] | null;
  validity: Validity;
  /** The deck's cover card, once its data has arrived (null: no cover, or the lookup failed: the box shows the card back). */
  cover: CardSummary | null;
}

const PARALLEL = 4;

export function useDeckInfo(api: DecksApi, decks: Deck[] | null): ReadonlyMap<string, DeckInfo> {
  const [info, setInfo] = useState<ReadonlyMap<string, DeckInfo>>(new Map());
  // Card data and answers are kept for the life of the screen; a deck is asked about again only when it changed.
  const cards = useRef(new Map<string, CardSummary | null>());
  const done = useRef(new Map<string, string>());
  const key = decks ? decks.map((d) => `${d.id}@${d.updatedAt}`).join('|') : '';

  useEffect(() => {
    if (!decks) return;
    let alive = true;
    const put = (id: string, patch: Partial<DeckInfo>) =>
      alive && setInfo((m) => new Map(m).set(id, { colors: null, validity: { kind: 'checking' }, cover: null, ...m.get(id), ...patch }));

    const lookup = async (names: string[]) => {
      const todo = names.filter((n) => !cards.current.has(n));
      const queue = [...todo];
      const worker = async () => {
        for (let n = queue.shift(); alive && n !== undefined; n = queue.shift()) {
          try {
            cards.current.set(n, (await api.card(n)).card);
          } catch {
            cards.current.set(n, null);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    };

    void (async () => {
      for (const d of decks) {
        if (!alive) return;
        const stamp = `${d.updatedAt}`;
        if (done.current.get(d.id) === stamp) continue;
        if (d.cover) {
          // Shown as soon as it arrives, before the slower format check and color lookups.
          await lookup([d.cover]);
          if (!alive) return;
          put(d.id, { cover: cards.current.get(d.cover) ?? null });
        }
        if (sectionCount(d, 'main') + sectionCount(d, 'commander') === 0) {
          put(d.id, { colors: [], validity: { kind: 'empty' } });
          done.current.set(d.id, stamp);
          continue;
        }
        put(d.id, { validity: { kind: 'checking' } });
        try {
          const res = await api.validate(d, d.format);
          const problems = res.problems.filter((p) => p.severity !== 'note').length;
          put(d.id, { validity: res.status === 'legal' ? { kind: 'legal' } : res.status === 'illegal' ? { kind: 'illegal', problems } : { kind: 'unchecked', warnings: problems } });
        } catch {
          put(d.id, { validity: { kind: 'unknown' } });
        }
        await lookup([...new Set([...d.main, ...d.commander].map((e) => e.name))]);
        if (!alive) return;
        const known = new Map<string, CardSummary>();
        for (const [n, c] of cards.current) if (c) known.set(n, c);
        put(d.id, { colors: deckColors(d, known) });
        done.current.set(d.id, stamp);
      }
    })();
    return () => {
      alive = false;
    };
    // `decks` is captured through `key`.
  }, [api, key]);

  return info;
}
