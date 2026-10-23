/**
 * The two WP20 INTERFACE CHANGEs, pinned:
 *
 *  1. parser/holes/object.ts (WP6): the `Recipient` hole reads the plural of "any target" ("one or two targets", "any number of targets", "up to three
 *     targets", "two targets", "X targets", "one, two, or three targets") as ONE target spec of kind `anyTarget` with a variable number of targets
 *     (CR 115.4, 601.2c). Divided damage needs it (CR 601.2d: Fire // Ice, Fireball); a template build cannot make a target marker itself.
 *  2. model/cap-walk.ts (WP1): an activated mana ability whose effect is not plain `addMana` steps with `units` needs `feature:mana.steps`, which no table
 *     advertises. rules/mana.ts resolves mana abilities natively (CR 605.3b) and reads `units` only, so a pain land's "This land deals 1 damage to you." or
 *     a `dynamic` production would be skipped (the source tapped for nothing). Such an ability degrades to a manual mana ability instead.
 *     FAST2 T7 INTERFACE CHANGE: since WP31 rules/mana.ts runs a `dynamic` addMana through the interpreter's handler at once (effects/mana-ability.ts), so a
 *     mana ability that is only such a step (anyColor, anyOneColor, chosen, ofType) runs natively; other steps, `sameAsSpent` and, after "Sacrifice ~",
 *     a step that reads the source (the source is gone when the amount is read) still need feature:mana.steps.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import { parseCard } from '../../../src/parser/parse';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';
import { classifyAbility } from '../../../src/model/classify';
import { canonicalJson } from '../../../src/parser/holes';
import { ENV, full } from '../chart/env';
import { NEIGHBORS, WP20, options } from './support';

const target = (min: unknown, max: unknown, text: string) => ({ ref: 'target', id: '', $target: { kind: 'anyTarget', min, max, text } });

describe('INTERFACE CHANGE 1, Recipient (CR 115.4, 601.2c): the plural of "any target" is one spec with a variable number of targets', () => {
  const cases: [string, unknown, unknown][] = [
    ['one or two targets', 1, 2],
    ['one, two, or three targets', 1, 3],
    ['any number of targets', 0, 'any'],
    ['one or more targets', 1, 'any'],
    ['up to three targets', 0, 3],
    ['two targets', 2, 2],
    ['X targets', { q: 'X' }, { q: 'X' }],
  ];
  for (const [text, min, max] of cases) {
    it(`"${text}" -> anyTarget min ${JSON.stringify(min)} max ${JSON.stringify(max)}`, () => {
      expect(full('Recipient', text, ENV).map((a) => canonicalJson(a.value))).toEqual([canonicalJson(target(min, max, text))]);
    });
  }
  it('"targets" alone, "one targets", "up to one targets" and "zzzblorp targets" are not recipients (a single target is "any target")', () => {
    for (const text of ['targets', 'one targets', 'up to one targets', 'zzzblorp targets']) expect(full('Recipient', text, ENV), text).toEqual([]);
  });
  it('"any target" is unchanged', () => {
    expect(full('Recipient', 'any target', ENV).map((a) => canonicalJson(a.value))).toEqual([canonicalJson(target(1, 1, 'any target'))]);
  });
});

const parsedAbilities = (name: string, typeLine: string, text: string): AbilityDef[] =>
  parseCard({ name, layout: 'normal', type_line: typeLine, oracle_text: text } as OracleCard, options(NEIGHBORS)).faces[0]!.abilities;

describe('INTERFACE CHANGE 2, capabilities (CR 605.3b): a mana ability the native path cannot run exactly is never automated', () => {
  it('a pain land: "{Q}: Add {W} or {U}." alone needs nothing; CMD5: with "This land deals 1 damage to you." it runs through the resolver (full); another rider needs feature:mana.steps and classifies manual', () => {
    const [plain] = parsedAbilities('Example Flats', 'Land', '{Q}: Add {W} or {U}.');
    expect(missingCapabilities(plain!, ENGINE_CAPABILITIES)).toEqual([]);
    expect(classifyAbility(plain!, ENGINE_CAPABILITIES).level).toBe('full');
    // CMD5 (CR 605.3b, 120.3): the source's fixed damage to its controller is run by the mana-ability resolver (effects/mana-ability.ts runs every step)
    const [pain] = parsedAbilities('Example Flats', 'Land', '{T}: Add {W} or {U}. This land deals 1 damage to you.');
    expect(pain).toMatchObject({ kind: 'activated', isMana: true, cost: { tap: true } });
    expect(missingCapabilities(pain!, ENGINE_CAPABILITIES)).toEqual([]);
    expect(classifyAbility(pain!, ENGINE_CAPABILITIES).level).toBe('full');
    // W3 integration: since WP23's review (lower/ability.ts) the parser itself already makes a mana ability with another instruction a manual mana ability
    // with its cost kept; the capability walk still refuses the same program when it is written by hand (an LLM entry, a pack)
    const [rider] = parsedAbilities('Example Grove', 'Land', '{T}: Add {R} or {G}. Each opponent gains 1 life.');
    expect(rider).toMatchObject({ kind: 'manual', mana: true, cost: { tap: true } });
    expect(classifyAbility(rider!, ENGINE_CAPABILITIES).level).toBe('manual');
    const written: AbilityDef = { kind: 'activated', text: '{T}: Add {W}. This land deals 1 damage to you.', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [
      { op: 'addMana', who: { ref: 'you' }, units: [['W']] }, { op: 'damage', source: { ref: 'self' }, to: { ref: 'you' }, amount: 1 },
    ] } } as AbilityDef;
    expect(missingCapabilities(written, ENGINE_CAPABILITIES)).toEqual([]);
    // after "Sacrifice ~" as a cost the source is gone before the resolver deals its damage: never a guess from a moved object
    const sacrificed = { ...written, cost: { tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] } } as AbilityDef;
    expect(missingCapabilities(sacrificed, ENGINE_CAPABILITIES)).toEqual(['feature:mana.steps']);
    expect(classifyAbility(sacrificed, ENGINE_CAPABILITIES).level).toBe('manual');
    // std-ry7 (CR 605.1a, 605.3b, 121.1): a fixed draw by its controller is run by the resolver too (model/cap-walk.ts#nativeManaEffect); this pin expected
    // feature:mana.steps for it before; another player's draw still needs it
    const drawn: AbilityDef = { ...written, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['W']] }, { op: 'draw', who: { ref: 'you' }, count: 1 }] } } as AbilityDef;
    expect(missingCapabilities(drawn, ENGINE_CAPABILITIES)).toEqual([]);
    const theirs: AbilityDef = { ...written, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['W']] }, { op: 'draw', who: { ref: 'each', who: 'opponent' }, count: 1 }] } } as AbilityDef;
    expect(missingCapabilities(theirs, ENGINE_CAPABILITIES)).toEqual(['feature:mana.steps']);
  });

  it('FAST2 T7 (CR 605.3b): a `dynamic` production alone in a mana ability runs natively (the WP31 resolver); after "Sacrifice ~" only one that reads nothing of the source runs; sameAsSpent needs feature:mana.steps', () => {
    const dyn = { op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'anyOneColor', count: 4 } } as const;
    const ability: AbilityDef = { kind: 'activated', text: '{T}: Add four mana of any one color.', cost: { tap: true }, isMana: true, effect: { targets: [], steps: [dyn] } };
    const spell: AbilityDef = { kind: 'spell', text: 'Add four mana of any one color.', effect: { targets: [], steps: [dyn] } };
    expect(missingCapabilities(ability, ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(spell, ENGINE_CAPABILITIES)).toEqual([]);
    const sacrifice = { tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] };
    expect(missingCapabilities({ ...ability, cost: sacrifice } as AbilityDef, ENGINE_CAPABILITIES)).toEqual([]); // four of one color: nothing of the source is read
    const power: AbilityDef = { ...ability, cost: sacrifice, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'ofType', type: 'G', count: { q: 'stat', stat: 'power', of: { ref: 'self' } } } }] } } as AbilityDef;
    expect(missingCapabilities(power, ENGINE_CAPABILITIES)).toEqual(['feature:mana.steps']); // its power, read after it is sacrificed
    const spent: AbilityDef = { ...ability, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'sameAsSpent' } }] } } as AbilityDef;
    expect(missingCapabilities(spent, ENGINE_CAPABILITIES)).toEqual(['feature:mana.steps']);
  });

  it('a restricted mana ability (units plus a spending restriction) still runs natively: no feature:mana.steps', () => {
    const [a] = parsedAbilities('Example Grotto', 'Land', '{T}: Add {C}{C}. Spend this mana only to cast a creature spell.');
    expect(missingCapabilities(a!, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('therefore no WP20 template builds a `dynamic` production: "N mana in any combination of colors" is N units (CR 106.1a)', () => {
    expect(WP20.filter((t) => JSON.stringify(t.build).includes('"dynamic"')).map((t) => t.id)).toEqual([]);
  });
});
