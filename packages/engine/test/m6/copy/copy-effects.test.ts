/**
 * M6-2 (m6 design 3.3, 5 "M6-2"): copy effects, layer 1a (CR 707, 613.2a), end to end on the game path. Real fixture cards compiled by the default compiler;
 * where a card's wording has no template yet, a card with hand-built JSON of the same behavior (`equivalent`, validated by the schema and the lint).
 */
import { describe, expect, it } from 'vitest';
import {
  compileCard, ENGINE_CAPABILITIES, getChars, legalActions, missingCapabilities, viewFor, type AbilityDef, type CardDef, type CopyExcept, type GameState, type ObjectFilter, type OracleCard,
} from '../../../src/index';
import { matchesFilter as matchesAt, NO_ENV } from '../../../src/rules/filter';
import { equivalent } from '../../m5/cr-examples/helpers';
import { act, tweak } from '../../m5/helpers';
import { answer, cast, drive, find, gamePath, looks, pass, pick, resolveAll, resolveTop, scenario, target } from './support';

const islands = (n: number): string[] => Array(n).fill('Island') as string[];

/** Does the object match the filter (rules/filter.ts, as p1)? */
const matchesFilter = (s: GameState, id: string, f: ObjectFilter): boolean => matchesAt(s, s.objects[id]!, f, { you: 'p1', env: NO_ENV });

/** "You may have ~ enter as a copy of <of>[, except ...]" as hand-built JSON (the shape rep.enters.copy builds, with the M6 fields). */
function entersCopy(text: string, of: ObjectFilter, except?: CopyExcept[], additional?: { if?: ObjectFilter; counters: { kind: string; count: number }[] }[]): AbilityDef {
  return {
    kind: 'static', text, zone: ['stack', 'battlefield'],
    effects: [{
      s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' },
      body: { b: 'enters', copy: { of, optional: true, ...(except ? { except } : {}), ...(additional ? { additional } : {}) } },
    }],
  } as AbilityDef;
}

/** A synthetic card compiled by the default compiler from invented text (design 6.10: never Wizards text). */
const synthetic = (name: string, typeLine: string, manaCost: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: typeLine, mana_cost: manaCost, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);

/** The one ability a synthetic sentence compiles to. */
const abilityOf = (text: string, typeLine = 'Creature — Illusion'): AbilityDef => synthetic('Test Ability Source', typeLine, '{1}', text, ['1', '1']).faces[0]!.abilities[0]!;

/** Cast Clone (or another copy card) from p1's hand and let it resolve, choosing `of` to copy. */
function castCopy(s: GameState, name: string, of: string | null): GameState {
  s = resolveTop(cast(s, name));
  return drive(s, [pick(...(of ? [of] : []))]);
}

describe('capabilities (m6 design 7): the copy capabilities are table entries', () => {
  it('layer:1a, body:enters.copy, op:copy.except and op:copy.permanentSpell are capabilities; Clone is a full card', () => {
    for (const c of ['layer:1a', 'body:enters.copy', 'op:copy.except', 'op:copy.permanentSpell']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    // fail closed: a static ability's copy effect (CR 707.2c) and the "as enters" P/T records (CR 613.2a) are not run
    for (const c of ['feature:copy.static', 'feature:copy.asEntersPT']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
    const clone = gamePath('Clone');
    expect(clone.automation.level).toBe('full');
    expect(missingCapabilities(clone.faces[0]!.abilities[0]!, ENGINE_CAPABILITIES)).toEqual([]);
  });
});

describe('CR 707.5: "enters as a copy" (Clone)', () => {
  const board = (): GameState => scenario(['Clone', 'Grizzly Bears', 'Mulldrifter', 'Island'], {
    p1: { hand: ['Clone'], battlefield: islands(5), library: islands(6) }, p2: { battlefield: ['Grizzly Bears', 'Mulldrifter'] },
  });

  it('CR 707.5, 614.12a: the choice is made as Clone would enter, among the creatures on the battlefield, and "you may" allows none', () => {
    const s = resolveTop(cast(board(), 'Clone'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0, max: 1, rules: expect.arrayContaining(['CR 707.5', 'CR 614.12a']) });
    expect((s.pending as { options: string[] }).options.sort()).toEqual([find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Mulldrifter', 'battlefield')].sort());
    const none = drive(s, [pick()]);
    expect(none.zones.graveyard.p1!.map((id) => none.defs[none.objects[id]!.defId]!.name)).toContain('Clone'); // a 0/0 Clone dies (CR 704.5f)
  });

  it('CR 707.2, 707.5: Clone copying Grizzly Bears is a 2/2 green Bear named Grizzly Bears, and a copy (isCopy filter)', () => {
    let s = board();
    s = castCopy(s, 'Clone', find(s, 'Grizzly Bears', 'battlefield'));
    const clone = find(s, 'Clone', 'battlefield');
    expect(looks(s, clone)).toEqual({ name: 'Grizzly Bears', pt: [2, 2], types: ['Creature'], subtypes: ['Bear'], colors: ['G'] });
    expect(getChars(s, clone).manaValue).toBe(2);
    expect(matchesFilter(s, clone, { isCopy: true })).toBe(true);
    expect(matchesFilter(s, find(s, 'Grizzly Bears', 'battlefield'), { isCopy: true })).toBe(false);
    expect(s.log.some((l) => l.text === 'Clone enters as a copy of Grizzly Bears.')).toBe(true);
  });

  it('CR 707.2, 603.6a: Clone copying Mulldrifter has its enters trigger (a copied ability, key c:<effect>:0:<i>) and draws two', () => {
    let s = board();
    const before = s.zones.hand.p1!.length;
    s = castCopy(s, 'Clone', find(s, 'Mulldrifter', 'battlefield'));
    const clone = find(s, 'Clone', 'battlefield');
    const keys = getChars(s, clone).abilities.map((a) => a.key);
    expect(keys.every((k) => k.startsWith('c:'))).toBe(true);
    expect(getChars(s, clone).abilities.every((a) => a.origin === 'copied')).toBe(true);
    s = resolveAll(s);
    expect(s.zones.hand.p1!.length).toBe(before - 1 + 2); // Clone left the hand, the copied trigger drew two
    expect(looks(s, clone).pt).toEqual([2, 2]);
    expect(getChars(s, clone).keywords.map((k) => k.keyword)).toContain('flying');
  });

  it('CR 707.2b, 707.2: later changes to the original never change the copy; counters and status are not copied', () => {
    let s = scenario(['Clone', 'Grizzly Bears', 'Giant Growth', 'Island', 'Forest'], {
      p1: { hand: ['Clone', 'Giant Growth'], battlefield: [...islands(4), 'Forest'] }, p2: { battlefield: [{ name: 'Grizzly Bears', tapped: true, counters: { '+1/+1': 2 } }] },
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = castCopy(s, 'Clone', bears);
    const clone = find(s, 'Clone', 'battlefield');
    expect(looks(s, clone).pt).toEqual([2, 2]); // CR 707.2: not the counters
    expect(s.objects[clone]!.tapped).toBe(false); // nor the tapped status
    s = resolveTop(cast(s, 'Giant Growth', [target(bears)]));
    expect(looks(s, bears).pt).toEqual([7, 7]);
    expect(looks(s, clone).pt).toEqual([2, 2]); // CR 707.2b
  });

  it('CR 707.2, 400.7d: Clone copying a kicked Kavu Titan gets neither the counters nor the kicked status (no counters, no trample)', () => {
    let s = scenario(['Clone', 'Kavu Titan', 'Island', 'Forest'], { p1: { hand: ['Clone', 'Kavu Titan'], battlefield: [...islands(4), ...Array(5).fill('Forest') as string[]] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Kavu Titan', 'hand') }), [{ kind: 'yesNo', yes: true }]);
    s = resolveAll(s);
    const titan = find(s, 'Kavu Titan', 'battlefield');
    expect(looks(s, titan).pt).toEqual([5, 5]);
    s = castCopy(s, 'Clone', titan);
    const clone = find(s, 'Clone', 'battlefield');
    s = resolveAll(s);
    expect(looks(s, clone).pt).toEqual([2, 2]);
    expect(getChars(s, clone).keywords.map((k) => k.keyword)).not.toContain('trample');
  });

  it('CR 707.10f: a copy of a creature spell becomes a token as it resolves (a synthetic "Copy target creature spell.")', () => {
    const copier = synthetic('Test Mirror Spell', 'Instant', '{U}', 'Copy target creature spell.');
    expect(copier.automation.level).toBe('full');
    let s = scenario(['Grizzly Bears', 'Island', 'Forest'], { p1: { hand: ['Grizzly Bears', 'Test Mirror Spell'], battlefield: ['Island', 'Forest', 'Forest'] }, defs: [copier] });
    s = cast(s, 'Grizzly Bears');
    const spell = s.zones.stack[0]!;
    s = cast(s, 'Test Mirror Spell', [target(spell)]);
    s = resolveAll(s);
    const bears = s.zones.battlefield.filter((id) => getChars(s, id).name === 'Grizzly Bears');
    expect(bears).toHaveLength(2);
    expect(bears.map((id) => s.objects[id]!.kind).sort()).toEqual(['card', 'token']);
    expect(s.log.some((l) => /becomes a token as it resolves/.test(l.text))).toBe(true);
  });
});

describe('CR 707.9: copy exceptions (hand-built JSON of the printed behavior)', () => {
  it('CR 707.5, 707.9b, 707.9e: Spark Double copying a planeswalker enters with printed loyalty + 1 and isn\'t legendary (Jace Beleren: 4 loyalty)', () => {
    const spark = equivalent({ name: 'Spark Double', type_line: 'Creature — Illusion', mana_cost: '{3}{U}', power: '2', toughness: '2' }, [entersCopy(
      'You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it\'s a creature, it enters with an additional loyalty counter on it if it\'s a planeswalker, and it isn\'t legendary.',
      { anyOf: [{ types: ['Creature'] }, { types: ['Planeswalker'] }], controller: 'you' },
      [{ layer: 4, supertypes: { remove: ['Legendary'] } }],
      [{ if: { types: ['Creature'] }, counters: [{ kind: '+1/+1', count: 1 }] }, { if: { types: ['Planeswalker'] }, counters: [{ kind: 'loyalty', count: 1 }] }],
    )]);
    let s = scenario(['Jace Beleren', 'Grizzly Bears', 'Island'], { p1: { hand: ['Spark Double', 'Spark Double'], battlefield: [...islands(8), { name: 'Jace Beleren', counters: { loyalty: 3 } }, 'Grizzly Bears'] }, defs: [spark] });
    const jace = find(s, 'Jace Beleren', 'battlefield');
    s = castCopy(s, 'Spark Double', jace);
    const pw = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Spark Double')!;
    expect(getChars(s, pw).name).toBe('Jace Beleren');
    expect(s.objects[pw]!.counters.loyalty).toBe(4); // CR 306.5b printed 3, CR 707.9e one more
    expect(getChars(s, pw).supertypes).not.toContain('Legendary'); // no legend rule (CR 704.5j)
    expect(s.zones.battlefield).toContain(jace);
    s = castCopy(s, 'Spark Double', find(s, 'Grizzly Bears', 'battlefield'));
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Spark Double' && id !== pw)!;
    expect(looks(s, bear).pt).toEqual([3, 3]); // the creature gets the +1/+1 counter, not a loyalty counter
    expect(s.objects[bear]!.counters.loyalty).toBeUndefined();
  });

  it('CR 707.9a-b: Phantasmal Image is an Illusion in addition to its other types and has the sacrifice trigger (a layer 4 effect sees the Illusion)', () => {
    const image = equivalent({ name: 'Phantasmal Image', type_line: 'Creature — Illusion', mana_cost: '{1}{U}', power: '0', toughness: '0' }, [entersCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it\'s an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."',
      { types: ['Creature'] },
      [{ layer: 4, subtypes: { add: ['Illusion'] } }, { layer: 6, add: [abilityOf('When this creature becomes the target of a spell or ability, sacrifice it.')] }],
    )]);
    let s = scenario(['Grizzly Bears', 'Shock', 'Island', 'Mountain'], { p1: { hand: ['Phantasmal Image', 'Shock'], battlefield: [...islands(2), 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [image] });
    s = castCopy(s, 'Phantasmal Image', find(s, 'Grizzly Bears', 'battlefield'));
    const img = find(s, 'Phantasmal Image', 'battlefield');
    expect(looks(s, img)).toMatchObject({ name: 'Grizzly Bears', subtypes: ['Bear', 'Illusion'], pt: [2, 2] });
    expect(matchesFilter(s, img, { subtypes: ['Illusion'] })).toBe(true);
    expect(getChars(s, img).abilities.some((a) => a.def.kind === 'triggered' && a.origin === 'copied')).toBe(true);
    s = cast(s, 'Shock', [target(img)]);
    s = resolveTop(s); // the trigger resolves first: it is sacrificed
    expect(s.zones.battlefield).not.toContain(img);
  });

  it('CR 707.9d: Quicksilver Gargantuan copying a creature with a P/T-defining ability is 7/7 (the CDA is not copied; Tarmogoyf\'s CDA has no template yet)', () => {
    const qg = equivalent({ name: 'Quicksilver Gargantuan', type_line: 'Creature — Shapeshifter', mana_cost: '{5}{U}{U}', power: '7', toughness: '7' }, [entersCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it\'s 7/7.', { types: ['Creature'] }, [{ layer: '7b', power: 7, toughness: 7 }],
    )]);
    const goyfLike = synthetic('Test Goyf', 'Creature — Lhurgoyf', '{1}{G}', 'This creature\'s power and toughness are each equal to the number of cards in your hand.', ['*', '*']);
    let s = scenario(['Island'], { p1: { hand: ['Quicksilver Gargantuan'], battlefield: islands(7) }, p2: { battlefield: ['Test Goyf'], hand: islands(3) }, defs: [qg, goyfLike] });
    const goyf = find(s, 'Test Goyf', 'battlefield');
    expect(looks(s, goyf).pt).toEqual([3, 3]); // three cards in its controller's hand
    s = castCopy(s, 'Quicksilver Gargantuan', goyf);
    const copy = find(s, 'Quicksilver Gargantuan', 'battlefield');
    expect(looks(s, copy)).toMatchObject({ name: 'Test Goyf', pt: [7, 7] });
    expect(getChars(s, copy).abilities).toHaveLength(0); // the CDA was dropped (CR 707.9d)
  });

  it('CR 707.3 example 1, 707.9c: Vesuvan Doppelganger copying Runeclaw Bear stays blue; a Clone of it is a blue Bear named Runeclaw Bear', () => {
    const vesuvan = equivalent({ name: 'Vesuvan Doppelganger', type_line: 'Creature — Shapeshifter', mana_cost: '{3}{U}{U}', power: '0', toughness: '0', colors: ['U'] }, [entersCopy(
      'You may have this creature enter as a copy of any creature on the battlefield, except it doesn\'t copy that creature\'s color.', { types: ['Creature'] }, [{ retain: ['colors'] }],
    )]);
    let s = scenario(['Clone', 'Runeclaw Bear', 'Island'], { p1: { hand: ['Vesuvan Doppelganger', 'Clone'], battlefield: islands(9) }, p2: { battlefield: ['Runeclaw Bear'] }, defs: [vesuvan] });
    s = castCopy(s, 'Vesuvan Doppelganger', find(s, 'Runeclaw Bear', 'battlefield'));
    const v = find(s, 'Vesuvan Doppelganger', 'battlefield');
    expect(looks(s, v)).toEqual({ name: 'Runeclaw Bear', pt: [2, 2], types: ['Creature'], subtypes: ['Bear'], colors: ['U'] });
    s = castCopy(s, 'Clone', v);
    expect(looks(s, find(s, 'Clone', 'battlefield'))).toEqual({ name: 'Runeclaw Bear', pt: [2, 2], types: ['Creature'], subtypes: ['Bear'], colors: ['U'] }); // CR 707.3
  });

  it('CR 707.9f, 707.9e: Moritte copying a land gets no counters and no changeling; copying a creature it does (judged on the copy without the exception)', () => {
    const changeling = abilityOf('Changeling', 'Creature — Shapeshifter');
    const moritte = equivalent({ name: 'Moritte of the Frost', type_line: 'Legendary Snow Creature — Shapeshifter', mana_cost: '{2}{G}{U}{U}', power: '0', toughness: '0' }, [entersCopy(
      'You may have Moritte enter as a copy of a permanent you control, except it\'s legendary and snow in addition to its other types and, if it\'s a creature, it enters with two additional +1/+1 counters on it and has changeling.',
      { types: ['Artifact', 'Creature', 'Enchantment', 'Land', 'Planeswalker', 'Battle'], controller: 'you' },
      [{ layer: 4, supertypes: { add: ['Legendary', 'Snow'] } }, { if: { types: ['Creature'] }, then: [{ layer: 6, add: [changeling] }] }],
      [{ if: { types: ['Creature'] }, counters: [{ kind: '+1/+1', count: 2 }] }],
    )]);
    let s = scenario(['Grizzly Bears', 'Forest', 'Island'], { p1: { hand: ['Moritte of the Frost', 'Moritte of the Frost'], battlefield: [...islands(10), 'Forest', 'Grizzly Bears'] }, defs: [moritte] });
    s = castCopy(s, 'Moritte of the Frost', find(s, 'Forest', 'battlefield'));
    const land = find(s, 'Moritte of the Frost', 'battlefield');
    expect(looks(s, land)).toMatchObject({ name: 'Forest', types: ['Land'], subtypes: ['Forest'] });
    expect(getChars(s, land).supertypes.sort()).toEqual(['Basic', 'Legendary', 'Snow']);
    expect(s.objects[land]!.counters['+1/+1']).toBeUndefined();
    expect(getChars(s, land).keywords.map((k) => k.keyword)).not.toContain('changeling');
    s = castCopy(s, 'Moritte of the Frost', find(s, 'Grizzly Bears', 'battlefield'));
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Moritte of the Frost' && id !== land);
    // the legend rule: two legendary permanents with different names (Forest, Grizzly Bears) stay
    expect(bear).toBeDefined();
    expect(looks(s, bear!).pt).toEqual([4, 4]);
    expect(getChars(s, bear!).subtypes).toContain('Elf'); // changeling: every creature type (CR 702.73a)
  });
});

describe('CR 707.4: "becomes a copy" (an effect step with a 1a copyOf; the snapshot hook)', () => {
  /** "Target creature becomes a copy of another target creature until end of turn." as hand-built JSON (a Cytoshape-style spell). */
  const shape = (): CardDef => equivalent({ name: 'Test Shapeshift', type_line: 'Instant', mana_cost: '{1}{U}' }, [{
    kind: 'spell', text: 'Target creature becomes a copy of another target creature until end of turn.',
    effect: {
      targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'] }, text: 'target creature', min: 1, max: 1 }, { id: 't2', kind: 'object', filter: { types: ['Creature'] }, text: 'another target creature', distinctFrom: ['t1'], min: 1, max: 1 }],
      steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't1' }, mods: [{ layer: '1a', copyOf: { ref: 'target', id: 't2' } }] }] }],
    },
  } as AbilityDef]);

  it('CR 707.4: Giant Growth still applies after the creature becomes a copy; no enters or leaves trigger; until end of turn', () => {
    let s = scenario(['Grizzly Bears', 'Mulldrifter', 'Giant Growth', 'Island', 'Forest'], {
      p1: { hand: ['Giant Growth', 'Test Shapeshift'], battlefield: ['Grizzly Bears', 'Island', 'Island', 'Forest'], library: islands(5) }, p2: { battlefield: ['Mulldrifter'] }, defs: [shape()],
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const drifter = find(s, 'Mulldrifter', 'battlefield');
    s = resolveTop(cast(s, 'Giant Growth', [target(bears)]));
    const hand = s.zones.hand.p1!.length;
    s = resolveTop(cast(s, 'Test Shapeshift', [target(bears), target(drifter)]));
    expect(s.zones.stack).toHaveLength(0); // no enters trigger of the copied Mulldrifter (CR 707.4)
    expect(s.zones.hand.p1!.length).toBe(hand - 1);
    expect(looks(s, bears)).toMatchObject({ name: 'Mulldrifter', pt: [5, 5] }); // 2/2 Mulldrifter + Giant Growth (CR 707.4 example)
    expect(s.log.some((l) => l.text === 'Grizzly Bears becomes a copy of Mulldrifter.' || /becomes a copy of Mulldrifter/.test(l.text))).toBe(true);
    // CR 514.2: until end of turn
    while (s.turn.number === 1) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    expect(looks(s, bears)).toMatchObject({ name: 'Grizzly Bears', pt: [2, 2] });
  });

  it('CR 613.7, 707.4: of two copy effects the later one wins; a Clone of a creature that became a copy copies the copiable values (CR 707.3)', () => {
    let s = scenario(['Clone', 'Grizzly Bears', 'Mulldrifter', 'Runeclaw Bear', 'Island', 'Forest'], {
      p1: { hand: ['Test Shapeshift', 'Test Shapeshift', 'Clone'], battlefield: ['Grizzly Bears', ...islands(8)], library: islands(5) }, p2: { battlefield: ['Mulldrifter', 'Runeclaw Bear'] }, defs: [shape()],
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = resolveTop(cast(s, 'Test Shapeshift', [target(bears), target(find(s, 'Mulldrifter', 'battlefield'))]));
    s = resolveTop(cast(s, 'Test Shapeshift', [target(bears), target(find(s, 'Runeclaw Bear', 'battlefield'))]));
    expect(looks(s, bears).name).toBe('Runeclaw Bear');
    s = castCopy(s, 'Clone', bears);
    expect(looks(s, find(s, 'Clone', 'battlefield'))).toMatchObject({ name: 'Runeclaw Bear', pt: [2, 2] });
  });
});

describe('token copies (CR 707.2, 111.4, 707.9b)', () => {
  it('CR 707.3, 111.4: a token copy of a Clone that copied Grizzly Bears is a Grizzly Bears token (the copiable values, not Clone)', () => {
    const maker = synthetic('Test Duplicate', 'Sorcery', '{U}', 'Create a token that\'s a copy of target creature.');
    let s = scenario(['Clone', 'Grizzly Bears', 'Island'], { p1: { hand: ['Clone', 'Test Duplicate'], battlefield: islands(6) }, p2: { battlefield: ['Grizzly Bears'] }, defs: [maker] });
    s = castCopy(s, 'Clone', find(s, 'Grizzly Bears', 'battlefield'));
    s = resolveTop(cast(s, 'Test Duplicate', [target(find(s, 'Clone', 'battlefield'))]));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(looks(s, token)).toEqual({ name: 'Grizzly Bears', pt: [2, 2], types: ['Creature'], subtypes: ['Bear'], colors: ['G'] });
  });

  it('CR 707.9b (op:copy.except): "create a token that\'s a copy of target creature, except it\'s 1/1 and an artifact in addition"', () => {
    const maker = equivalent({ name: 'Test Small Copy', type_line: 'Sorcery', mana_cost: '{U}' }, [{
      kind: 'spell', text: 'Create a token that\'s a copy of target creature, except it\'s 1/1 and it\'s an artifact in addition to its other types.',
      effect: {
        targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'] }, text: 'target creature', min: 1, max: 1 }],
        steps: [{ op: 'copy', what: { ref: 'target', id: 't1' }, result: 'token', who: { ref: 'you' }, except: [{ layer: '7b', power: 1, toughness: 1 }, { layer: 4, types: { add: ['Artifact'] } }] }],
      },
    } as AbilityDef]);
    let s = scenario(['Mulldrifter', 'Island'], { p1: { hand: ['Test Small Copy'], battlefield: islands(2), library: islands(5) }, p2: { battlefield: ['Mulldrifter'] }, defs: [maker] });
    s = resolveTop(cast(s, 'Test Small Copy', [target(find(s, 'Mulldrifter', 'battlefield'))]));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(looks(s, token)).toMatchObject({ name: 'Mulldrifter', pt: [1, 1] });
    expect(looks(s, token).types.sort()).toEqual(['Artifact', 'Creature']);
    expect(s.zones.stack).toHaveLength(1); // the copied enters trigger (CR 707.2: the token has the copied rules text)
  });
});

describe('CR 712.8e, 707.8: copying a transformed double-faced permanent', () => {
  it('Clone copying Insectile Aberration is a 3/2 flying Insectile Aberration with mana value 0 and no back face', () => {
    let s = scenario(['Clone', 'Delver of Secrets // Insectile Aberration', 'Island'], {
      p1: { hand: ['Clone'], battlefield: islands(4) }, p2: { battlefield: [{ name: 'Delver of Secrets // Insectile Aberration', face: 1 }] },
    });
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'battlefield');
    expect(looks(s, delver).name).toBe('Insectile Aberration');
    s = castCopy(s, 'Clone', delver);
    const clone = find(s, 'Clone', 'battlefield');
    expect(looks(s, clone)).toMatchObject({ name: 'Insectile Aberration', pt: [3, 2] });
    expect(getChars(s, clone).manaValue).toBe(0); // CR 712.8e
    expect(getChars(s, clone).keywords.map((k) => k.keyword)).toContain('flying');
    // CR 707.8: it is not double-faced; it can't transform (its own card is Clone)
    expect(s.defs[s.objects[clone]!.defId]!.faces).toHaveLength(1);
  });
});

describe('CR 305.7: a land that is a copy of a land under Blood Moon', () => {
  const mimic = (): CardDef => equivalent({ name: 'Test Mimic Land', type_line: 'Land', mana_cost: '' }, [entersCopy('You may have this land enter as a copy of any land on the battlefield.', { types: ['Land'] })]);
  // Blood Moon's sentence has no template yet: its behavior as hand-built JSON (layer 4, CR 305.7)
  const moon = (): CardDef => equivalent({ name: 'Test Moon', type_line: 'Enchantment', mana_cost: '{2}{R}', colors: ['R'] }, [{
    kind: 'static', text: 'Nonbasic lands are Mountains.',
    effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Land'], notSupertypes: ['Basic'] } }, mods: [{ layer: 4, subtypes: { set: ['Mountain'] } }] }],
  } as AbilityDef]);

  it('a land that already is a copy of Karplusan Forest loses its copied rules text when Blood Moon arrives and has only "{T}: Add {R}"', () => {
    let s = scenario(['Karplusan Forest', 'Mountain'], { p1: { hand: ['Test Mimic Land', 'Test Moon'], battlefield: ['Karplusan Forest', 'Mountain', 'Mountain', 'Mountain'] }, defs: [mimic(), moon()] });
    s = drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Mimic Land', 'hand') }), [pick(find(s, 'Karplusan Forest', 'battlefield'))]);
    const land = find(s, 'Test Mimic Land', 'battlefield');
    expect(looks(s, land).name).toBe('Karplusan Forest');
    expect(getChars(s, land).abilities.some((a) => a.origin === 'copied')).toBe(true);
    s = resolveTop(cast(s, 'Test Moon'));
    expect(looks(s, land)).toMatchObject({ name: 'Karplusan Forest', subtypes: ['Mountain'] });
    expect(getChars(s, land).abilities.map((a) => a.key)).toEqual(['r:basic:R']);
  });

  it('CR 614.12, 305.7: under Blood Moon such a land enters as a Mountain without copying (its replacement ability is gone as it would enter)', () => {
    let s = scenario(['Gaea\'s Cradle', 'Forest'], { p1: { hand: ['Test Mimic Land'], battlefield: ['Gaea\'s Cradle'] }, p2: { battlefield: ['Test Moon'] }, defs: [mimic(), moon()] });
    s = drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Mimic Land', 'hand') }));
    expect(s.pending?.kind).toBe('priority');
    const mountain = find(s, 'Test Mimic Land', 'battlefield');
    expect(looks(s, mountain)).toMatchObject({ name: 'Test Mimic Land', subtypes: ['Mountain'] });
  });
});

describe('CR 113.7a: a copied activated ability with a sacrifice cost resolves after its source is gone', () => {
  it('Clone copying a "Sacrifice this creature: it deals 2 damage to any target" creature: the ability carries its definition on the stack', () => {
    const bomber = synthetic('Test Bomber', 'Creature — Goblin', '{R}', 'Sacrifice this creature: It deals 2 damage to any target.', ['1', '1']);
    let s = scenario(['Clone', 'Island'], { p1: { hand: ['Clone'], battlefield: islands(4) }, p2: { battlefield: ['Test Bomber'] }, defs: [bomber] });
    s = castCopy(s, 'Clone', find(s, 'Test Bomber', 'battlefield'));
    const clone = find(s, 'Clone', 'battlefield');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === clone)!;
    expect(la).toBeDefined();
    s = drive(act(s, la.action), [target('p2')]);
    expect(s.zones.battlefield).not.toContain(clone);
    s = resolveTop(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
  });
});

describe('views (m6 design 3.4, R39): the definition a snapshot names reaches every viewer', () => {
  it('after the original left, viewFor still carries the copied definition and the copy looks the same to both players', () => {
    let s = scenario(['Clone', 'Mulldrifter', 'Lightning Bolt', 'Island', 'Mountain'], {
      p1: { hand: ['Clone', 'Lightning Bolt'], battlefield: [...islands(4), 'Mountain'], library: islands(5) }, p2: { battlefield: ['Mulldrifter'] },
    });
    const drifter = find(s, 'Mulldrifter', 'battlefield');
    s = castCopy(s, 'Clone', drifter);
    s = resolveAll(s);
    s = resolveTop(cast(s, 'Lightning Bolt', [target(drifter)]));
    expect(s.zones.battlefield).not.toContain(drifter);
    const clone = find(s, 'Clone', 'battlefield');
    for (const viewer of ['p1', 'p2'] as const) {
      const v = viewFor(s, viewer);
      expect(v.defs['Mulldrifter'], viewer).toBeDefined();
      expect(getChars(v as unknown as GameState, clone).name, viewer).toBe('Mulldrifter');
    }
  });
});


describe('templates of zz-m6/copy.json: token copies with one exception (CR 707.9b), compiled by the default compiler', () => {
  const tokenOf = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
  const run = (text: string, of: string, owner: 'p1' | 'p2' = 'p1'): GameState => {
    const spell = synthetic('Test Copier', 'Sorcery', '{U}', text);
    expect(spell.automation.level, text).toBe('full');
    let s = scenario([of, 'Island'], { p1: { hand: ['Test Copier'], battlefield: ['Island', 'Island', ...(owner === 'p1' ? [of] : [])] }, p2: { battlefield: owner === 'p2' ? [of] : [] }, defs: [spell] });
    s = resolveTop(cast(s, 'Test Copier', [target(find(s, of, 'battlefield'))]));
    return s;
  };

  it('eff.m6.copy.token.notLegendary: a token copy of Thalia isn\'t legendary, so both stay (CR 704.5j)', () => {
    const s = run('Create a token that\'s a copy of target creature you control, except it isn\'t legendary.', 'Thalia, Guardian of Thraben');
    const token = tokenOf(s);
    expect(getChars(s, token).name).toBe('Thalia, Guardian of Thraben');
    expect(getChars(s, token).supertypes).not.toContain('Legendary');
    expect(s.zones.battlefield).toContain(find(s, 'Thalia, Guardian of Thraben', 'battlefield'));
  });

  it('eff.m6.copy.token.artifact: an artifact in addition to its other types', () => {
    const s = run('Create a token that\'s a copy of target creature you control, except it\'s an artifact in addition to its other types.', 'Grizzly Bears');
    expect(looks(s, tokenOf(s))).toMatchObject({ name: 'Grizzly Bears', pt: [2, 2], subtypes: ['Bear'] });
    expect(looks(s, tokenOf(s)).types.sort()).toEqual(['Artifact', 'Creature']);
  });

  it('eff.m6.copy.token.haste: the token has haste (part of its copiable values, CR 707.9b)', () => {
    const s = run('Create a token that\'s a copy of target creature, except it has haste.', 'Hill Giant', 'p2');
    const token = tokenOf(s);
    expect(s.objects[token]!.controller).toBe('p1');
    expect(getChars(s, token).keywords.map((k) => k.keyword)).toEqual(['haste']);
    expect(s.defs[s.objects[token]!.defId]!.faces[0]!.abilities.map((a) => a.text)).toEqual(['Haste']);
  });

  it('eff.m6.copy.token.oneOne: a 1/1 Serra Angel token with flying and vigilance', () => {
    const s = run('Create a token that\'s a copy of target creature, except it\'s 1/1.', 'Serra Angel', 'p2');
    expect(looks(s, tokenOf(s))).toMatchObject({ name: 'Serra Angel', pt: [1, 1] });
    expect(getChars(s, tokenOf(s)).keywords.map((k) => k.keyword).sort()).toEqual(['flying', 'vigilance']);
  });
});

describe('CR 707.10f: "copy that spell" of a cast trigger that sees an artifact spell (op:copy.permanentSpell)', () => {
  it('casting Bonesplitter under "Whenever you cast an artifact spell, copy that spell": a Bonesplitter token and the card', () => {
    const echo = synthetic('Test Artifact Echo', 'Enchantment', '{2}{U}', 'Whenever you cast an artifact spell, copy that spell.');
    expect(echo.automation.level).toBe('full');
    let s = scenario(['Bonesplitter', 'Island'], { p1: { hand: ['Bonesplitter'], battlefield: ['Island', 'Test Artifact Echo'] }, defs: [echo] });
    s = resolveAll(cast(s, 'Bonesplitter'));
    const splitters = s.zones.battlefield.filter((id) => getChars(s, id).name === 'Bonesplitter');
    expect(splitters.map((id) => s.objects[id]!.kind).sort()).toEqual(['card', 'token']);
  });
});

describe('fail closed: what the engine can\'t copy exactly is not offered, and the players are told (never silently wrong)', () => {
  it('CR 303.4f: an enchantment that may enter as a copy of an enchantment is not offered an Aura (it would have to be attached as it enters)', () => {
    const copier = synthetic('Test Copy Ench', 'Enchantment', '{2}{U}', 'You may have this enchantment enter as a copy of any enchantment on the battlefield.');
    expect(copier.automation.level).toBe('full');
    let s = scenario(['Pacifism', 'Grizzly Bears', 'Island', 'Plains'], { p1: { hand: ['Test Copy Ench', 'Pacifism'], battlefield: ['Island', 'Island', 'Island', 'Plains', 'Plains'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [copier] });
    s = resolveTop(cast(s, 'Pacifism', [target(find(s, 'Grizzly Bears', 'battlefield'))]));
    s = resolveTop(cast(s, 'Test Copy Ench'));
    expect(s.pending?.kind).toBe('priority'); // no choice: nothing to offer
    expect(s.log.some((l) => l.level === 'manual' && /can't be copied by the engine yet/.test(l.text))).toBe(true);
    expect(getChars(s, find(s, 'Test Copy Ench', 'battlefield')).name).toBe('Test Copy Ench');
  });
});

describe('CR 707.7, m6 design E20: the links of copied abilities live in the copy effect\'s namespace', () => {
  it('a copy effect\'s abilities read and write their links under <effect id>#<link>; a token copy\'s definition keeps the bare ids (a new object, CR 400.7)', async () => {
    const { copiedAbilities, namespacedAbility } = await import('../../../src/statics/abilities');
    const { fromFace } = await import('../../../src/rules/base-chars');
    const hunter = gamePath('Fiend Hunter');
    const links = (v: unknown): string[] => JSON.stringify(v).match(/"link":"[^"]+"/g) ?? [];
    const bare = copiedAbilities('e1', fromFace(hunter.faces[0]!, 0), [], null);
    const spaced = copiedAbilities('e7', fromFace(hunter.faces[0]!, 0), [], 'e7');
    expect(links(bare.map((a) => a.def)).length).toBeGreaterThan(0);
    expect(links(bare.map((a) => a.def)).every((l) => !l.includes('#'))).toBe(true);
    expect(links(spaced.map((a) => a.def)).every((l) => l.startsWith('"link":"e7#'))).toBe(true);
    expect(spaced.map((a) => a.key).every((k) => k.startsWith('c:e7:0:'))).toBe(true);
    // pure and memoized per (definition, namespace) for frozen data
    const def = Object.freeze(hunter.faces[0]!.abilities[0]!);
    expect(namespacedAbility(def, 'e9')).toBe(namespacedAbility(def, 'e9'));
  });
});

describe('CR 707.7, 607.2a: a Clone that copied Fiend Hunter returns the card its own copied ability exiled', () => {
  it('the copied enters and leaves abilities are linked to each other (in the copy effect\'s namespace)', () => {
    let s = scenario(['Clone', 'Fiend Hunter', 'Grizzly Bears', 'Lightning Bolt', 'Island', 'Mountain'], {
      p1: { hand: ['Clone', 'Lightning Bolt'], battlefield: [...islands(4), 'Mountain'] }, p2: { battlefield: ['Fiend Hunter', 'Grizzly Bears'] },
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = castCopy(s, 'Clone', find(s, 'Fiend Hunter', 'battlefield'));
    const clone = find(s, 'Clone', 'battlefield');
    s = drive(s, [target(bears)]); // the copied enters trigger targets as it is put on the stack (CR 603.3d)
    s = resolveAll(s, [{ kind: 'yesNo', yes: true }]);
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Grizzly Bears');
    const keys = Object.keys(s.objects[clone]!.links ?? {});
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => /^e\d+#/.test(k))).toBe(true);
    s = resolveAll(cast(s, 'Lightning Bolt', [target(clone)]));
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Grizzly Bears')).toBe(true);
  });
});

describe('CR 707.3 (the Tomoya example), 710.1b-c: a flipped permanent that becomes a copy of an unflipped flip card', () => {
  it('flipped Tomoya the Revealer becoming a copy of Nezumi Shortfang is Stabwhisker the Odious, a 3/3 black creature (its own flip status applies)', () => {
    const shape = equivalent({ name: 'Test Shapeshift', type_line: 'Instant', mana_cost: '{1}{U}' }, [{
      kind: 'spell', text: 'Target creature becomes a copy of another target creature.',
      effect: {
        targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'] }, text: 'target creature', min: 1, max: 1 }, { id: 't2', kind: 'object', filter: { types: ['Creature'] }, text: 'another target creature', distinctFrom: ['t1'], min: 1, max: 1 }],
        steps: [{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't1' }, mods: [{ layer: '1a', copyOf: { ref: 'target', id: 't2' } }] }] }],
      },
    } as AbilityDef]);
    const jushi = 'Jushi Apprentice // Tomoya the Revealer';
    const nezumi = 'Nezumi Shortfang // Stabwhisker the Odious';
    let s = scenario([jushi, nezumi, 'Island'], { p1: { hand: ['Test Shapeshift'], battlefield: [jushi, 'Island', 'Island'] }, p2: { battlefield: [nezumi] }, defs: [shape] });
    const tomoya = find(s, jushi, 'battlefield');
    s = tweak(s, (x) => { x.objects[tomoya]!.flipped = true; });
    expect(looks(s, tomoya).name).toBe('Tomoya the Revealer');
    s = resolveTop(cast(s, 'Test Shapeshift', [target(tomoya), target(find(s, nezumi, 'battlefield'))]));
    expect(looks(s, tomoya)).toMatchObject({ name: 'Stabwhisker the Odious', pt: [3, 3], colors: ['B'] });
    // the copy keeps the copied normal half's mana cost (CR 710.1c, 707.3)
    expect(getChars(s, tomoya).manaValue).toBe(2);
  });
});

describe('CR 707.8a: a token copy of a double-faced card in a graveyard has both faces', () => {
  it('a token that is a copy of a Delver of Secrets card is a double-faced token, front face up', () => {
    const reanimate = equivalent({ name: 'Test Echo Grave', type_line: 'Sorcery', mana_cost: '{U}' }, [{
      kind: 'spell', text: 'Create a token that\'s a copy of target creature card in a graveyard.',
      effect: {
        targets: [{ id: 't1', kind: 'object', filter: { types: ['Creature'], zone: 'graveyard', isCard: true }, text: 'target creature card in a graveyard', min: 1, max: 1 }],
        steps: [{ op: 'copy', what: { ref: 'target', id: 't1' }, result: 'token', who: { ref: 'you' } }],
      },
    } as AbilityDef]);
    const delver = 'Delver of Secrets // Insectile Aberration';
    let s = scenario([delver, 'Island'], { p1: { hand: ['Test Echo Grave'], battlefield: ['Island'], graveyard: [delver] }, defs: [reanimate] });
    s = resolveTop(cast(s, 'Test Echo Grave', [target(find(s, delver, 'graveyard'))]));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(s.defs[s.objects[token]!.defId]!.faces.map((f) => f.name)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
    expect(looks(s, token)).toMatchObject({ name: 'Delver of Secrets', pt: [1, 1] });
  });
});

describe('CR 614.12, 616.1c, 616.1f: once the copy effect is applied, the replacement effects that apply as it enters are the copied object\'s', () => {
  it('Clone copying a creature that "enters with two +1/+1 counters" enters with them (a 3/3), the copied replacement applying', () => {
    const counted = synthetic('Test Counted', 'Creature — Hydra', '{1}{G}', 'This creature enters with two +1/+1 counters on it.', ['1', '1']);
    expect(counted.automation.level).toBe('full');
    let s = scenario(['Clone', 'Island'], { p1: { hand: ['Clone'], battlefield: islands(4) }, p2: { battlefield: ['Test Counted'] }, defs: [counted] });
    s = castCopy(s, 'Clone', find(s, 'Test Counted', 'battlefield'));
    const clone = find(s, 'Clone', 'battlefield');
    expect(s.objects[clone]!.counters['+1/+1']).toBe(2);
    expect(looks(s, clone)).toMatchObject({ name: 'Test Counted', pt: [3, 3] });
  });

  it('a copy card\'s own "enters tapped" does not apply once it enters as a copy (it no longer has that ability; the CR 616.1f Rusted Sentinel example)', () => {
    const tappedClone = equivalent({ name: 'Test Sleepy Clone', type_line: 'Creature — Shapeshifter', mana_cost: '{3}{U}', power: '2', toughness: '2' }, [
      entersCopy('You may have this creature enter as a copy of any creature on the battlefield.', { types: ['Creature'] }),
      abilityOf('This creature enters tapped.'),
    ]);
    let s = scenario(['Grizzly Bears', 'Island'], { p1: { hand: ['Test Sleepy Clone'], battlefield: islands(4) }, p2: { battlefield: ['Grizzly Bears'] }, defs: [tappedClone] });
    s = castCopy(s, 'Test Sleepy Clone', find(s, 'Grizzly Bears', 'battlefield'));
    const copy = find(s, 'Test Sleepy Clone', 'battlefield');
    expect(looks(s, copy)).toMatchObject({ name: 'Grizzly Bears', pt: [2, 2] });
    expect(s.objects[copy]!.tapped).toBe(false);
  });

  it('the same card entering as itself (no copy chosen) still enters tapped', () => {
    const tappedClone = equivalent({ name: 'Test Sleepy Clone', type_line: 'Creature — Shapeshifter', mana_cost: '{3}{U}', power: '2', toughness: '2' }, [
      entersCopy('You may have this creature enter as a copy of any creature on the battlefield.', { types: ['Creature'] }),
      abilityOf('This creature enters tapped.'),
    ]);
    let s = scenario(['Grizzly Bears', 'Island'], { p1: { hand: ['Test Sleepy Clone'], battlefield: islands(4) }, p2: { battlefield: ['Grizzly Bears'] }, defs: [tappedClone] });
    s = castCopy(s, 'Test Sleepy Clone', null);
    expect(s.objects[find(s, 'Test Sleepy Clone', 'battlefield')]!.tapped).toBe(true);
  });
});

describe('CR 707.9d: a token copy with an exception that sets a characteristic drops the copied CDA that defines it', () => {
  it('eff.m6.copy.token.oneOne: a token copy of a creature whose P/T is defined by a CDA, "except it\'s 1/1", is 1/1', () => {
    const goyfLike = synthetic('Test Goyf', 'Creature — Lhurgoyf', '{1}{G}', 'This creature\'s power and toughness are each equal to the number of cards in your hand.', ['*', '*']);
    const spell = synthetic('Test Copier', 'Sorcery', '{U}', 'Create a token that\'s a copy of target creature, except it\'s 1/1.');
    expect(spell.automation.level).toBe('full');
    let s = scenario(['Island'], { p1: { hand: ['Test Copier', 'Island', 'Island'], battlefield: islands(2) }, p2: { battlefield: ['Test Goyf'], hand: islands(3) }, defs: [goyfLike, spell] });
    expect(looks(s, find(s, 'Test Goyf', 'battlefield')).pt).toEqual([3, 3]);
    s = resolveTop(cast(s, 'Test Copier', [target(find(s, 'Test Goyf', 'battlefield'))]));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token, 'the token').toBeDefined();
    expect(looks(s, token)).toMatchObject({ name: 'Test Goyf', pt: [1, 1] });
    expect(getChars(s, token).abilities).toHaveLength(0); // the CDA was not copied (CR 707.9d)
  });
});
