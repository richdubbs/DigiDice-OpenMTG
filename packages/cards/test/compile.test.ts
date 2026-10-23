import { describe, expect, it } from 'vitest';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { OracleCard } from '@openmtg/engine';
import { getTokens, loadFixtureCards } from '../../engine/test/fixtures';
import { CardCompileError, compileCards, compileCardsSafe, compileResolvedDeck } from '../src/compile';
import { CardDatabase } from '../src/database';
import { cacheFiles, defaultCacheDir } from '../src/paths';
import { card } from './helpers';
import { SLOW, slowTitle } from '../../engine/test/slow';

const fixtureDb = () => CardDatabase.fromCards(Object.values(loadFixtureCards()), { tokens: getTokens('Soldier') });

describe('compileResolvedDeck', () => {
  it('compiles each distinct card once and expands the deck lists by count', async () => {
    const db = fixtureDb();
    const deck = await db.resolveDecklist('4 Lightning Bolt\n20 Mountain\n1 Fire // Ice\n\n2 Counterspell\n1 Lightning Bolt');
    const compiled = compileResolvedDeck(deck);
    expect(compiled.defs.map((d) => d.name)).toEqual(['Lightning Bolt', 'Mountain', 'Fire // Ice', 'Counterspell']);
    expect(compiled.main).toHaveLength(4 + 20 + 1);
    expect(compiled.main.filter((n) => n === 'Lightning Bolt')).toHaveLength(4);
    expect(compiled.sideboard).toEqual(['Counterspell', 'Counterspell', 'Lightning Bolt']); // after the blank line
    expect(compiled.defs.find((d) => d.name === 'Fire // Ice')?.faces).toHaveLength(2);
  });

  it('M6-4 (m6 design E18, CR 712.8g): with the index lookup, the meld result of every meld card in the deck is compiled too, once', async () => {
    const db = fixtureDb();
    const deck = await db.resolveDecklist(['2 Bruna, the Fading Light', '2 Gisela, the Broken Blade', '1 Graf Rats', '4 Plains'].join('\n'));
    expect(compileResolvedDeck(deck).defs.map((d) => d.name)).not.toContain('Brisela, Voice of Nightmares'); // without the lookup: as before
    const compiled = compileResolvedDeck(deck, undefined, (n) => db.lookup(n));
    const names = compiled.defs.map((d) => d.name);
    expect(names.filter((n) => n === 'Brisela, Voice of Nightmares')).toHaveLength(1);
    expect(names).toContain('Chittering Host'); // Graf Rats' result: in the fixture index
    expect(compiled.main).not.toContain('Brisela, Voice of Nightmares'); // a definition only, never a card of the deck
    expect(compiled.defs.find((d) => d.name === 'Brisela, Voice of Nightmares')?.meld).toEqual({ isResult: true });
  });

  it('skips unknown cards (they are listed in deck.unknown)', async () => {
    const deck = await fixtureDb().resolveDecklist('2 Lightning Bolt\n2 Not A Card');
    expect(deck.unknown).toHaveLength(1);
    expect(compileResolvedDeck(deck).main).toEqual(['Lightning Bolt', 'Lightning Bolt']);
  });
});

describe('every card compiles (contract C1, design 12.1): an unknown mana symbol makes the card manual and names the symbol', () => {
  // WP18: the engine's compile pipeline never throws. A mana cost with a symbol CR 107.4 does not define ({D}, {L}, {C/P}: 2026 mechanics) gives the face
  // no mana cost and a manual ability that names the symbol, so the card is in the deck, playable by hand, and the player sees why.
  const bad = card('Boulder Jockey', { mana_cost: '{2}{R}{D}', type_line: 'Creature — Goblin' });
  const worse = card('Odd // Card', { layout: 'transform', mana_cost: '{L}', type_line: 'Creature — Odd', card_faces: [{ name: 'Odd', mana_cost: '{L}' }, { name: 'Card' }] });

  it('compileCards keeps every card; the ones with unknown symbols are manual and list the symbol in requiresEngine', () => {
    const defs = compileCards([card('Fine Card'), bad, worse, bad]);
    expect(defs.map((d) => d.name)).toEqual(['Fine Card', 'Boulder Jockey', 'Odd // Card']);
    const jockey = defs[1]!;
    expect(jockey.automation.level).toBe('manual');
    expect(jockey.automation.requiresEngine).toContain('mana:{D}');
    expect(jockey.faces[0]!.manaCost).toBeNull();
    expect(jockey.faces[0]!.abilities.some((a) => a.kind === 'manual' && /Unknown mana symbol \{D\}/.test(a.reason))).toBe(true);
    expect(defs[2]!.automation.requiresEngine).toContain('mana:{L}');
  });

  it('compileCardsSafe has no failures for them (CardCompileError is left for a compiler that throws)', () => {
    const r = compileCardsSafe([card('Fine Card'), bad, card('Fine Card')]);
    expect(r.defs.map((d) => d.name)).toEqual(['Fine Card', 'Boulder Jockey']);
    expect(r.failures).toEqual([]);
    const throwing = compileCardsSafe([card('Fine Card')], () => { throw new Error('boom'); });
    expect(throwing.failures).toEqual([{ name: 'Fine Card', message: 'boom' }]);
    expect(() => compileCards([card('Fine Card')], () => { throw new Error('boom'); })).toThrow(CardCompileError);
  });

  it('compileResolvedDeck includes the card', async () => {
    const db = CardDatabase.fromCards([bad, card('Fine Card')]);
    const deck = await db.resolveDecklist('4 Boulder Jockey\n4 Fine Card');
    expect(compileResolvedDeck(deck).main.filter((n) => n === 'Boulder Jockey')).toHaveLength(4);
  });
});

async function readJsonl(file: string): Promise<OracleCard[]> {
  const out: OracleCard[] = [];
  for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) if (line.trim()) out.push(JSON.parse(line) as OracleCard);
  return out;
}

// Runs only when a local card cache exists (npm run cards -- refresh); needs no network.
const files = cacheFiles(defaultCacheDir());
// QT: about 150 s; a slow suite (npm run test:all)
describe.skipIf(!SLOW || !existsSync(files.cards) || !existsSync(files.tokens))(slowTitle('the whole local card index compiles (real data)'), () => {
  it('every card and token compiles (contract C1: the compile pipeline never throws)', async () => {
    const all = [...(await readJsonl(files.cards)), ...(await readJsonl(files.tokens))];
    expect(all.length).toBeGreaterThan(1000);
    // W3b: compiled in chunks with a yield between them: the whole template set takes over a minute here, and one synchronous call that long starves the
    // test worker's RPC (vitest reports "Timeout calling onTaskUpdate" and fails the run although every test passed)
    const defs: ReturnType<typeof compileCardsSafe>['defs'] = [];
    const failures: ReturnType<typeof compileCardsSafe>['failures'] = [];
    for (let i = 0; i < all.length; i += 1000) {
      const r = compileCardsSafe(all.slice(i, i + 1000));
      defs.push(...r.defs);
      failures.push(...r.failures);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(failures).toEqual([]);
    expect(defs.length).toBeGreaterThanOrEqual(new Set(all.map((c) => c.name)).size);
    // Known engine limitation (STATUS.md): {D}, {L} and {C/P} (2026 mechanics) are not in the engine's mana parser yet: those cards are manual and say why.
    const unknownSymbols = defs.filter((d) => (d.automation.requiresEngine ?? []).some((c) => c.startsWith('mana:')));
    expect(unknownSymbols.length).toBeLessThanOrEqual(5);
    for (const d of unknownSymbols) expect(d.automation.level, d.name).toBe('manual');
  }, 600_000); // WP18: the template parser reads the whole index (about 40 s alone at WP18, about 75 s with the whole template set, more under a parallel run)
});
