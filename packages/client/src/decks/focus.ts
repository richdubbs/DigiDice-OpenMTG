/**
 * Where keyboard focus goes after a deck-list change removes or re-creates the focused button (otherwise it falls back to the page body, at the top of a
 * long page): the same button on a neighbouring row, the moved card in its new section, or the section heading when the section is empty.
 */
import type { DeckEntry, DeckSection } from './model';

export type Control = 'remove' | 'add' | 'move';

export type FocusRequest = { section: DeckSection; card: string; control: Control } | { section: DeckSection; heading: true };

/** After the row `name` disappears from `entries`: the next row's button, else the previous row's, else the heading. */
export function afterRemoval(section: DeckSection, entries: readonly DeckEntry[], name: string, control: Control): FocusRequest {
  const i = entries.findIndex((e) => e.name === name);
  const neighbour = entries[i + 1] ?? entries[i - 1];
  return neighbour && neighbour.name !== name ? { section, card: neighbour.name, control } : { section, heading: true };
}

/** Focus what the request names inside `root` (the deck lists); false when it is not on screen. */
export function applyFocus(root: HTMLElement | null, req: FocusRequest): boolean {
  const sectionEl = [...(root?.querySelectorAll<HTMLElement>('[data-section]') ?? [])].find((s) => s.dataset.section === req.section);
  if (!sectionEl) return false;
  let target: HTMLElement | null | undefined;
  if ('heading' in req) target = sectionEl.querySelector<HTMLElement>('h2');
  else {
    const row = [...sectionEl.querySelectorAll<HTMLElement>('[data-card]')].find((r) => r.dataset.card === req.card);
    target = row?.querySelector<HTMLElement>(`[data-control="${req.control}"]`);
  }
  if (!target) return false;
  target.focus();
  return true;
}
