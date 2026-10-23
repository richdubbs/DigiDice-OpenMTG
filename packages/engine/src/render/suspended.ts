/**
 * p2-modal-1 (CR 702.62b; unverified cite): a suspended card is a card in exile that has suspend and a time counter on it. The parser states it as one filter
 * (parser/holes/object.ts#SUSPENDED_CARD, parser/holes/filter.ts "suspended card"); render/np.ts says it "suspended card", render/refs.ts "target permanent or suspended card".
 */
import type { ObjectFilter } from '../types/ability';

/** The filter of a suspended card, every field and nothing else (with "card", which the parser's head noun adds). */
export function isSuspendedCard(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join();
  return keys === 'counters,isCard,keyword,zone' && f.zone === 'exile' && f.isCard === true && f.keyword === 'suspend' && JSON.stringify(f.counters) === '{"kind":"time"}';
}
