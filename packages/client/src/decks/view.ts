/**
 * Which view of the deckbuilder a deck opens in. The app's routes carry only the deck id (app/nav.tsx), so the deck library says here whether a click
 * means "look at this deck" (the Arena-style Deck Details) or "build it"; the deckbuilder reads the request when it opens. Read, never cleared: opening
 * the same deck again sets it again.
 */
export type BuilderView = 'build' | 'details';

const requested = new Map<string, BuilderView>();

export function requestView(deckId: string, view: BuilderView): void {
  requested.set(deckId, view);
}

export function requestedView(deckId: string | undefined): BuilderView {
  return (deckId !== undefined ? requested.get(deckId) : undefined) ?? 'build';
}
