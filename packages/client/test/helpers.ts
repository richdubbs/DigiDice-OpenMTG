/** Client test helpers: a tiny two-player game (synthetic Forest and a vanilla 2/2) and a fetch stub. */
import { compileCard, type GameConfig } from '@openmtg/engine';
import { vi } from 'vitest';

export function smallConfig(seed = 'client-seed', extra: Partial<GameConfig> = {}): GameConfig {
  const forest = compileCard({ name: 'Forest', layout: 'normal', type_line: 'Basic Land — Forest', oracle_text: '' });
  const bear = compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' });
  const deck = [...Array<string>(20).fill('Forest'), ...Array<string>(20).fill('Test Bear')];
  return {
    seed,
    players: [
      { name: 'Alice', deck, stops: { fullControl: true } },
      { name: 'Bob', deck, stops: { fullControl: true } },
    ],
    defs: [forest, bear],
    ...extra,
  };
}

/** Replace fetch with a stub answering by URL path; returns the mock for call assertions. */
export function stubFetch(answer: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status, body } = answer(String(input), init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
