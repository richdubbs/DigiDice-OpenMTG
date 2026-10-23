/**
 * WP20 golden cards (design 15.2 WP20, section 13): Lightning Bolt, Fireball, Fire // Ice, Jace Beleren, Fact or Fiction, Llanowar Elves and Cavern of
 * Souls, plus Rabid Bite (the subject-led damage of section 13.1). Each is parsed with the bootstrap templates, the WP20 templates and the test-only
 * neighbors of ./support.ts, and the abilities WP20 and the bootstrap set produce must be EXACTLY the JSON of design section 13 (read from the design
 * document). The abilities that the test-only neighbors produce (Fireball's cost modifier and Cavern's "choose a creature type", WP22; Ice's "tap", WP21)
 * are compared by their effects only: their stored fields (`zone`, the display text of a two-line spell) are their owners' business.
 *
 * Two representation equivalences decided by the hole grammars (WP6), not by the templates, are normalized before comparing: a player target with
 * `players: {who: 'any'}` is the same spec as one without `players`, and an object target with `filter: {}` the same as one without a filter (CR 115.1:
 * no restriction either way). Binding names are compared up to renaming (`alphaRename`).
 *
 * Fixture cards run offline. Cards that are not in the fixture (Fact or Fiction, Cavern of Souls, Rabid Bite, and the cards that verify the piles
 * templates) are read from the local Oracle index and skipped when it is absent (design 6.10: verbatim Oracle text stays in `.cache/`).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse } from '../../../src/parser/types';
import { parseCard } from '../../../src/parser/parse';
import { validateAbility } from '../../../src/model/validate';
import { lintCard } from '../../../src/model/lint-card';
import { getCard } from '../../fixtures';
import { EXAMPLES } from '../model/examples';
import { NEIGHBORS, WP20, alphaRename, automated, bare, localIndex, options } from './support';

const opts = options(NEIGHBORS);
const WP20_IDS = new Set(WP20.map((t) => t.id));
const expected = (name: string): AbilityDef[][] => EXAMPLES.find((e) => e.name === name)!.faces.map((f) => f.abilities);

/** The representation equivalences of the file comment. */
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (k === 'players' && o['kind'] === 'player' && JSON.stringify(x) === '{"who":"any"}') continue;
    if (k === 'filter' && o['kind'] === 'object' && 'min' in o && JSON.stringify(x) === '{}') continue;
    out[k] = normalize(x);
  }
  return out;
}
const same = (v: unknown): unknown => alphaRename(normalize(bare(v as AbilityDef[])));

/**
 * Parse `card` and compare with section 13. `neighbor` lists, per face, the indices of the abilities produced by a test-only neighbor template: those are
 * compared by their effects (`effects` of a static ability, `effect.steps` of a spell).
 */
function check(card: OracleCard, name: string, neighbor: number[][] = []): FaceParse[] {
  const faces = parseCard(card, opts).faces;
  const want = expected(name);
  expect(faces).toHaveLength(want.length);
  faces.forEach((f, i) => {
    expect(f.abilities, `${name} face ${i}`).toHaveLength(want[i]!.length);
    f.abilities.forEach((a, k) => {
      const w = want[i]![k]!;
      if ((neighbor[i] ?? []).includes(k)) {
        const pick = (x: AbilityDef): unknown => ('effects' in x ? x.effects : 'effect' in x ? x.effect : x);
        expect(same([pick(a)]), `${name} face ${i} ability ${k} (neighbor)`).toEqual(same([pick(w)]));
      } else expect(same([a]), `${name} face ${i} ability ${k}`).toEqual(same([w]));
    });
    expect(automated(f.abilities), name).toBe(true);
    expect(f.gate.every((g) => g.ok), `${name}: ${f.gate.map((g) => `${g.rendered} / ${g.expected}`).join(' ; ')}`).toBe(true);
    expect(f.diagnostics.filter((d) => d.level === 'manual'), name).toEqual([]);
    for (const a of f.abilities) expect(validateAbility(a).filter((x) => x.severity === 'error'), name).toEqual([]);
  });
  return faces;
}

const usedWp20 = (faces: FaceParse[]): string[] => [...new Set(faces.flatMap((f) => f.templatesUsed).filter((id) => WP20_IDS.has(id)))].sort();

describe('WP20 golden cards from the fixture (design section 13)', () => {
  it('CR 115.4, 120.3: Lightning Bolt (bootstrap eff.damage; unchanged by the WP20 templates)', () => {
    expect(usedWp20(check(getCard('Lightning Bolt'), 'Lightning Bolt'))).toEqual([]);
  });

  it('CR 107.1a, 601.2c, 608.2b: Fireball: X damage divided evenly, rounded down, among any number of targets (eff.damage.evenly.down)', () => {
    expect(usedWp20(check(getCard('Fireball'), 'Fireball', [[0]]))).toEqual(['eff.damage.evenly.down']);
  });

  it('CR 601.2d, 709: Fire // Ice: 2 damage divided as you choose among one or two targets; Ice taps (WP21, faked) and draws (bootstrap)', () => {
    const faces = check(getCard('Fire // Ice'), 'Fire // Ice', [[], [0]]);
    expect(usedWp20(faces)).toEqual(['eff.damage.divided']);
    // the divided target spec: one spec, one or two targets, the total announced (CR 601.2d)
    expect((faces[0]!.abilities[0] as { effect: { targets: unknown[] } }).effect.targets).toEqual([{ id: 't0', kind: 'anyTarget', min: 1, max: 2, text: 'one or two targets', divide: { what: 'damage', total: 2 } }]);
  });

  it('CR 606, 701.17a: Jace Beleren: three loyalty abilities, the -10 mills twenty cards (eff.mill)', () => {
    expect(usedWp20(check(getCard('Jace Beleren'), 'Jace Beleren'))).toEqual(['eff.mill']);
  });

  it('CR 605.1a, 106.1: Llanowar Elves: {T}: Add {G} (the bootstrap mana template; no WP20 template competes with it)', () => {
    expect(usedWp20(check(getCard('Llanowar Elves'), 'Llanowar Elves'))).toEqual([]);
  });
});

const index = localIndex();
const fromIndex = (name: string): OracleCard => {
  const c = index!.find((x) => x.name === name);
  if (!c) throw new Error(`${name} is not in the local index`);
  return c;
};

describe.skipIf(!index)('WP20 golden cards from the local Oracle index (skipped without .cache/scryfall)', () => {
  it('CR 700.3, 701.20a: Fact or Fiction: reveal, an opponent separates into two piles, one pile to hand and the other to the graveyard', () => {
    expect(usedWp20(check(fromIndex('Fact or Fiction'), 'Fact or Fiction'))).toEqual(['eff.piles', 'eff.piles.handgrave', 'eff.reveal.top']);
  });

  it('CR 106.6, 607.2d: Cavern of Souls: {C}, and one mana of any color whose spending restriction is structured (design D8)', () => {
    const faces = check(fromIndex('Cavern of Souls'), 'Cavern of Souls', [[0]]);
    expect(usedWp20(faces)).toEqual(['eff.mana.C', 'eff.mana.any', 'rid.mana.chosentype.uncounterable']);
    // the link "type" has its producer on the same card (CR 607.2d): the card-level lint finds both ends
    expect(lintCard(faces.map((f) => ({ abilities: f.abilities as AbilityDef[] }))).filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('CR 120.3, 608.2h: Rabid Bite: the source of the damage is a target, not the spell (design D4)', () => {
    expect(usedWp20(check(fromIndex('Rabid Bite'), 'Rabid Bite'))).toEqual(['eff.damage.equal']);
  });
});

/** The program of Fact or Fiction with `n` cards revealed. */
const pilesProgram = (n: number): unknown => ({
  targets: [],
  steps: [
    { op: 'reveal', who: { ref: 'you' }, what: { ref: 'topCards', player: { ref: 'you' }, count: n }, as: 'cards' },
    { op: 'piles', cards: { ref: 'bound', name: 'cards' }, separator: { ref: 'anOpponent' }, chooser: { ref: 'you' }, chosen: 'keep', other: 'rest' },
    { op: 'move', what: { ref: 'bound', name: 'keep' }, to: { zone: 'hand' } },
    { op: 'move', what: { ref: 'bound', name: 'rest' }, to: { zone: 'graveyard' } },
  ],
});

/**
 * Design 6.9: a template with fewer than 20 corpus matches is experimental until it has 20 reviewed matches or three independently verified golden cards.
 * The piles cards below (Sphinx of Uthuun, Jace, Architect of Thought, with Fact or Fiction above) are checked against this package's own `pilesProgram`,
 * not against design-authored JSON, and Jace only for its first two steps: they are regression checks, not independent verification (review fix), so
 * eff.piles stays experimental until three independently verified golden JSONs exist (WP25's golden corpus). eff.piles.handgrave (three index
 * matches, Fact or Fiction and Sphinx of Uthuun among them) stays experimental too: the T3 review reverted its promotion for want of that evidence.
 */
describe.skipIf(!index)('WP20 the piles golden cards (design 6.9)', () => {
  it('CR 700.3: Sphinx of Uthuun: its enters trigger (bootstrap) reveals five cards and splits them like Fact or Fiction', () => {
    const f = parseCard(fromIndex('Sphinx of Uthuun'), opts).faces[0]!;
    const t = f.abilities.find((a) => a.kind === 'triggered')!;
    expect(automated([t])).toBe(true);
    expect(same([t])).toEqual(same([{ kind: 'triggered', text: t.text, trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: pilesProgram(5) } as unknown as AbilityDef]));
  });

  it('CR 700.3: Jace, Architect of Thought -2: the piles are made automatically; "the other on the bottom of your library" is a manual step after them', () => {
    const f = parseCard(fromIndex('Jace, Architect of Thought'), opts).faces[0]!;
    const minus2 = f.abilities.find((a) => a.text.startsWith('-2'))! as { effect: { steps: unknown[] } };
    const steps = same(minus2.effect.steps) as unknown[];
    expect(steps.slice(0, 2)).toEqual((same((pilesProgram(3) as { steps: unknown[] }).steps) as unknown[]).slice(0, 2));
    expect(steps[2]).toMatchObject({ op: 'manual' });
    expect(steps).toHaveLength(3);
  });
});
