/**
 * The deckbuilder's Advanced search (AdvancedSearch.tsx): hidden behind its button, writes Scryfall syntax, sends it as the `scry` parameter, shows the
 * server's message for a query it cannot run, and carries a cheat sheet whose every example the server can parse. No network: a fake local server.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SearchResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseScryfall } from '../../server/src/scryfall-search';
import { NavProvider } from '../src/app/nav';
import { DecksProvider } from '../src/decks/context';
import { DeckbuilderScreen } from '../src/decks/DeckbuilderScreen';
import { appendTerms, builderTerms, EMPTY_BUILDER, looksLikeScryfall, SYNTAX_EXAMPLES, termValue } from '../src/decks/scryfallBuilder';
import { EMPTY_FILTERS, searchQuery } from '../src/decks/searchQuery';
import { formatOption } from '../src/decks/formats';
import { MemoryDeckStore } from '../src/decks/store';
import { byName, deckFixture, fakeServer, type FakeServer } from './decks-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const page = (cards: string[]): SearchResponse => ({ cards: cards.map((n) => byName.get(n)!), page: 1, pageSize: 20, total: cards.length });
const searchCalls = (m: ReturnType<typeof fakeServer>) => m.mock.calls.map(([u]) => new URL(String(u), 'http://x')).filter((u) => u.pathname === '/api/cards/search');

function renderBuilder(server: FakeServer = {}) {
  const fetchMock = fakeServer(server);
  render(
    <DecksProvider store={new MemoryDeckStore([deckFixture()])}>
      <NavProvider>
        <DeckbuilderScreen deckId="deck-1" validateDelayMs={0} autoSearch={false} />
      </NavProvider>
    </DecksProvider>,
  );
  return fetchMock;
}
const searchRegion = () => screen.getByRole('region', { name: 'Card search' });

describe('Scryfall query terms (the builder form)', () => {
  it('writes terms in Scryfall syntax, quoting values with spaces', () => {
    expect(builderTerms(EMPTY_BUILDER)).toEqual([]);
    expect(
      builderTerms({ ...EMPTY_BUILDER, name: 'bolt', oracle: 'draw a card', type: 'legendary creature', keyword: 'flying', colors: 'rg', colorsOp: '>=', identity: 'esper', mv: '3', mvOp: '<=', power: '4', powerOp: '>', format: 'modern', produces: 'g', is: 'commander' }),
    ).toEqual(['name:bolt', 'o:"draw a card"', 't:"legendary creature"', 'kw:flying', 'c>=rg', 'id:esper', 'mv<=3', 'pow>4', 'f:modern', 'produces:g', 'is:commander']);
    expect(termValue('a "b" c')).toBe('"a b c"');
    expect(termValue('{2}{R}')).toBe('{2}{R}');
  });

  it('adds terms after what is already typed', () => {
    expect(appendTerms('', ['t:elf'])).toBe('t:elf');
    expect(appendTerms('c:g ', ['t:elf', 'mv<=2'])).toBe('c:g t:elf mv<=2');
    expect(appendTerms('c:g', [])).toBe('c:g');
  });

  it('every term the form can write, and every cheat-sheet example, is a query the server reads', () => {
    const everything = builderTerms({
      ...EMPTY_BUILDER, name: 'a b', oracle: 'x y', type: 'elf', keyword: 'flying', colors: 'izzet', identity: 'wub', mv: '2', power: '1', toughness: '1', format: 'pioneer', set: 'Dominaria United', produces: 'wu', is: 'frenchvanilla',
    });
    expect(everything).toContain('s:"Dominaria United"');
    for (const q of [...everything, everything.join(' '), ...SYNTAX_EXAMPLES.map((e) => e.query)]) {
      const r = parseScryfall(q);
      expect(typeof r === 'string' ? `${q}: ${r}` : 'ok', q).toBe('ok');
    }
  });

  it('the search query carries the Scryfall text next to the other filters, trimmed, and omits it when empty', () => {
    const f = formatOption('modern');
    expect(searchQuery(EMPTY_FILTERS, f, 1)).not.toHaveProperty('scry');
    expect(searchQuery({ ...EMPTY_FILTERS, q: 'bolt', scry: '  t:instant  ' }, f, 2)).toMatchObject({ q: 'bolt', scry: 't:instant', page: 2 });
    expect(searchQuery({ ...EMPTY_FILTERS, scry: '   ' }, f, 1)).not.toHaveProperty('scry');
  });

  it('the main search box sends Scryfall syntax as scry (ANDed with the Advanced search), and other text as a name / rules-text search', () => {
    const f = formatOption('modern');
    expect(searchQuery({ ...EMPTY_FILTERS, q: ' t:creature ' }, f, 1)).toEqual({ scry: 't:creature', format: 'modern', page: 1 });
    expect(searchQuery({ ...EMPTY_FILTERS, q: 'goblin s:dmu', scry: 'c:r or c:g' }, f, 1)).toMatchObject({ scry: '(goblin s:dmu) (c:r or c:g)' });
    expect(searchQuery({ ...EMPTY_FILTERS, q: 'Circle of Protection: Red' }, f, 1)).toMatchObject({ q: 'Circle of Protection: Red' });
    for (const q of ['t:creature', '-s:dmu', 'mv<=2', 'pow>tou', 'goblin (o:draw)', '!"Lightning Bolt"', 'r:rare', 'SET:dmu']) expect(looksLikeScryfall(q), q).toBe(true);
    for (const q of ['bolt', 'deals 3 damage', 'Protection: Red', 'Fire // Ice', 'Ach! Hans, Run!', '']) expect(looksLikeScryfall(q), q).toBe(false);
  });
});

describe('Advanced search in the deckbuilder', () => {
  it('is behind an Advanced search button: the plain search keeps working, and the panel opens with the box, the form, the cheat sheet and the guide link', async () => {
    const fetchMock = renderBuilder({ search: () => page(['Lightning Bolt']) });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    const drawer = s.querySelector('#deck-advanced-drawer') as HTMLElement;
    expect(drawer.hidden).toBe(true);
    // The plain box still searches by name, with no scry parameter.
    fireEvent.change(within(s).getByLabelText('Name or rules text'), { target: { value: 'bolt' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Search' }));
    await within(s).findByRole('list', { name: 'Search results' });
    expect(Object.fromEntries(searchCalls(fetchMock)[0]!.searchParams)).toEqual({ q: 'bolt', format: 'modern', page: '1' });

    const toggle = within(s).getByRole('button', { name: 'Advanced search' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.hidden).toBe(false);
    expect(within(drawer).getByLabelText('Scryfall syntax')).toBeTruthy();
    const link = within(drawer).getByRole('link', { name: 'Scryfall syntax guide' });
    expect(link.getAttribute('href')).toBe('https://scryfall.com/docs/syntax');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(within(drawer).getByText('Syntax cheat sheet')).toBeTruthy();
    expect(within(drawer).getByText(/Not available .*: block, rarity, artist, flavor text, year or date, prices and tags/)).toBeTruthy();
    // Opening the Filters drawer closes this one.
    fireEvent.click(within(s).getByRole('button', { name: 'Filters' }));
    expect(drawer.hidden).toBe(true);
  });

  it('the main search box takes Scryfall syntax: t:creature s:dmu goes out as scry, with the color toggles and format', async () => {
    const fetchMock = renderBuilder({ search: () => page(['Lightning Bolt']) });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    fireEvent.change(within(s).getByLabelText('Name or rules text'), { target: { value: 't:creature s:dmu' } });
    fireEvent.click(within(s).getByLabelText('Green'));
    fireEvent.click(within(s).getByRole('button', { name: 'Search' }));
    await within(s).findByRole('list', { name: 'Search results' });
    expect(Object.fromEntries(searchCalls(fetchMock)[0]!.searchParams)).toEqual({ scry: 't:creature s:dmu', colors: 'G', format: 'modern', page: '1' });
  });

  it('the Set field suggests every set (asked once, when first used) and writes s:<code>', async () => {
    const sets = [
      { code: 'dmu', name: 'Dominaria United', type: 'expansion', released: '2022-09-09', cards: 281 },
      { code: 'lea', name: 'Limited Edition Alpha', type: 'core', released: '1993-08-05', cards: 295 },
    ];
    const fetchMock = renderBuilder({ search: () => page(['Lightning Bolt']), sets });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    fireEvent.click(within(s).getByRole('button', { name: 'Advanced search' }));
    const field = within(s).getByLabelText('Set (builder)') as HTMLInputElement;
    const setCalls = () => fetchMock.mock.calls.filter(([u]) => new URL(String(u), 'http://x').pathname === '/api/sets').length;
    expect(setCalls()).toBe(0);
    fireEvent.focus(field);
    fireEvent.focus(field);
    const list = s.querySelector(`#${field.getAttribute('list')}`) as HTMLDataListElement;
    await waitFor(() => expect(list.querySelectorAll('option')).toHaveLength(2));
    expect(setCalls()).toBe(1);
    expect([...list.querySelectorAll('option')].map((o) => `${o.value} ${o.textContent}`)).toEqual(['dmu Dominaria United (2022)', 'lea Limited Edition Alpha (1993)']);
    fireEvent.change(field, { target: { value: 'dmu' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Add to search' }));
    expect((within(s).getByLabelText('Scryfall syntax') as HTMLInputElement).value).toBe('s:dmu');
  });

  it('sends what is typed as the scry parameter, ANDed with the other filters, and the Search button runs it', async () => {
    const fetchMock = renderBuilder({ search: () => page(['Lightning Bolt', 'Ancient Grudge']) });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    fireEvent.click(within(s).getByRole('button', { name: 'Advanced search' }));
    fireEvent.change(within(s).getByLabelText('Scryfall syntax'), { target: { value: 't:instant c:r mv<=2' } });
    // The button says an advanced search is set, even when the drawer is closed.
    expect(within(s).getByTitle('An advanced search is set').textContent).toBe('on');
    fireEvent.click(within(s).getByRole('button', { name: 'Search' }));
    await within(s).findByRole('list', { name: 'Search results' });
    expect(Object.fromEntries(searchCalls(fetchMock)[0]!.searchParams)).toEqual({ scry: 't:instant c:r mv<=2', format: 'modern', page: '1' });
    expect(within(s).getByText('2 cards')).toBeTruthy();
  });

  it('the form adds Scryfall terms to the box; an example fills it; Clear empties it', async () => {
    renderBuilder({ search: () => page(['Lightning Bolt']) });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    fireEvent.click(within(s).getByRole('button', { name: 'Advanced search' }));
    const box = within(s).getByLabelText('Scryfall syntax') as HTMLInputElement;
    const add = within(s).getByRole('button', { name: 'Add to search' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'c:g' } });
    fireEvent.change(within(s).getByLabelText('Type line contains (builder)'), { target: { value: 'creature' } });
    fireEvent.change(within(s).getByLabelText('Mana value comparison (builder)'), { target: { value: '<=' } });
    fireEvent.change(within(s).getByLabelText('Mana value (builder)'), { target: { value: '3' } });
    fireEvent.change(within(s).getByLabelText('Colors comparison (builder)'), { target: { value: '>=' } });
    fireEvent.change(within(s).getByLabelText('Colors (builder)'), { target: { value: 'rg' } });
    fireEvent.change(within(s).getByLabelText('Only this format (builder)'), { target: { value: 'pioneer' } });
    expect(within(s).getByText('t:creature c>=rg mv<=3 f:pioneer')).toBeTruthy();
    fireEvent.click(add);
    expect(box.value).toBe('c:g t:creature c>=rg mv<=3 f:pioneer');
    // The form is empty again.
    expect(add.disabled).toBe(true);
    expect((within(s).getByLabelText('Type line contains (builder)') as HTMLInputElement).value).toBe('');

    fireEvent.click(within(s).getByRole('button', { name: 'id<=esper' }));
    expect(box.value).toBe('id<=esper');
    fireEvent.click(within(s).getByRole('button', { name: 'Clear advanced search' }));
    expect(box.value).toBe('');
    expect(within(s).queryByTitle('An advanced search is set')).toBeNull();
  });

  it("shows the server's message for a keyword it cannot answer, naming it, without the error sound or an outage message", async () => {
    const message = '"r:" (rarity) is not supported: the local card index has one entry per Oracle card and keeps no printing data';
    const fetchMock = renderBuilder({ searchError: (p) => (p.get('scry')?.includes('r:') ? message : null), search: () => page(['Lightning Bolt']) });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    fireEvent.click(within(s).getByRole('button', { name: 'Advanced search' }));
    fireEvent.change(within(s).getByLabelText('Scryfall syntax'), { target: { value: 't:creature r:rare' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Search' }));
    const alert = await within(s).findByRole('alert');
    expect(alert.textContent).toBe(`This search can't run: ${message}`);
    expect(alert.textContent).not.toMatch(/Search failed/);
    // Also under the box, where the player is typing.
    expect(within(s.querySelector('#deck-advanced-drawer') as HTMLElement).getByText(message)).toBeTruthy();
    expect(searchCalls(fetchMock)).toHaveLength(1);
    // Correcting the query clears the message.
    fireEvent.change(within(s).getByLabelText('Scryfall syntax'), { target: { value: 't:creature' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(within(s).queryByRole('alert')).toBeNull());
  });
});
