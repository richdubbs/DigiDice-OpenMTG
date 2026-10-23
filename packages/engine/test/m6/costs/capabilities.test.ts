/**
 * M6-5a (m6 design 3.8, 7, D12; push package K1): the capabilities this package registers, the walker names it splits, and the forms it keeps unregistered
 * so that nothing the cast path does not read can look automated (design 5.2: a capability exists because its table entry exists).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { CAST_STATIC_KINDS } from '../../../src/actions/cast-kinds';
import { storableKind } from '../../../src/effects/handlers/lasting';
import { FEATURES } from '../../../src/effects/propose';
import { keywordRegistry } from '../../../src/keywords/registry';
import { expansionNeeds } from '../../../src/keywords/needs';
import { capabilitiesOf, ENGINE_CAPABILITIES } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { synthetic } from './support';

const data = (name: string) => keywordRegistry.get(name)!;

describe('M6-5a capabilities (m6 design 7)', () => {
  it('static:additionalCost and static:alternativeCost come from CAST_STATIC_KINDS (actions/cast-kinds.ts); feature:replace.cause from effects/propose.ts', () => {
    expect(Object.keys(CAST_STATIC_KINDS).sort()).toEqual(['additionalCost', 'alternativeCost', 'castWith' /* FAST5X E2 */]);
    expect(ENGINE_CAPABILITIES.has('static:additionalCost')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('static:alternativeCost')).toBe(true);
    expect(FEATURES).toContain('replace.cause');
    expect(ENGINE_CAPABILITIES.has('feature:replace.cause')).toBe(true);
  });

  it('CR 118.8, 118.9: CAST_STATIC_KINDS has the contract type of m6 design section 2 (keyed by the kind names, not any string; FAST5X E2 added castWith)', () => {
    expectTypeOf(CAST_STATIC_KINDS).toEqualTypeOf<Readonly<Record<'additionalCost' | 'alternativeCost' | 'castWith', true>>>();
  });

  it('the keyword capabilities follow by themselves (keywordCapabilities): kicker, multikicker, entwine, buyback, evoke; escape since M6-5 (keywords/data/escape.json)', () => {
    for (const k of ['kicker', 'multikicker', 'entwine', 'buyback', 'evoke', 'escape']) expect(ENGINE_CAPABILITIES.has(`keyword:${k}`), k).toBe(true);
  });

  it('CR 702.27a: buyback\'s "as it resolves" replacement needs feature:replace.cause (was feature:event.cause, m6 design D12)', () => {
    expect(expansionNeeds(data('buyback'))).toEqual(expect.arrayContaining(['static:additionalCost', 'static:replace', 'body:modify', 'cond:wasCast', 'feature:replace.cause']));
    expect(expansionNeeds(data('buyback'))).not.toContain('feature:ev.cause');
    expect(expansionNeeds(data('buyback'))).not.toContain('feature:event.cause');
  });

  it('m6 design D12: a trigger pattern with a cause needs feature:ev.cause, which nothing registers (the trigger matcher does not compare the cause)', () => {
    const trigger: AbilityDef = {
      kind: 'triggered', text: 'When ~ is put into a graveyard from the stack as it resolves, draw a card.',
      trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, from: 'stack', to: 'graveyard', cause: 'resolve' }] },
      effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
    } as AbilityDef;
    expect(capabilitiesOf(trigger)).toContain('feature:ev.cause');
    expect(capabilitiesOf(trigger)).not.toContain('feature:replace.cause');
    expect(ENGINE_CAPABILITIES.has('feature:ev.cause')).toBe(false);
    const replacement: AbilityDef = {
      kind: 'static', text: 'x', zone: ['stack'],
      effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'stack', to: 'graveyard', cause: 'resolve' }, body: { b: 'modify', destination: { zone: 'hand' } } }],
    } as AbilityDef;
    expect(capabilitiesOf(replacement)).toContain('feature:replace.cause');
    expect(capabilitiesOf(replacement)).not.toContain('feature:ev.cause');
  });
});

describe('M6-5a: the cast path reads PRINTED costs only, so other cost statics stay manual (model/cap-walk.ts castStaticForms)', () => {
  const alt = { s: 'alternativeCost', cost: { mana: [{ kind: 'generic', amount: 1 }] }, name: 'alternative' };

  it('a printed additional or alternative cost needs nothing beyond static:<kind>', () => {
    const printed = { kind: 'static', text: 'x', zone: ['stack'], effects: [alt] } as unknown as AbilityDef;
    expect(capabilitiesOf(printed).filter((c) => c.startsWith('feature:castCost'))).toEqual([]);
  });

  it('CR 611.2: stored by a resolving spell (an effect step) it needs feature:castCost.lasting, and the effect handler does not store it', () => {
    const spell = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [alt] }] } } as unknown as AbilityDef;
    expect(capabilitiesOf(spell)).toContain('feature:castCost.lasting');
    expect(ENGINE_CAPABILITIES.has('feature:castCost.lasting')).toBe(false);
    for (const s of Object.keys(CAST_STATIC_KINDS)) expect(storableKind(s), s).toBe(false);
  });

  it('CR 613.1f: granted by a layer 6 effect (a static or a cast-cost keyword) it needs feature:castCost.granted', () => {
    const grantStatic = {
      kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Instant'] } }, mods: [{ layer: 6, add: [{ kind: 'static', text: 'y', effects: [alt] }] }] }],
    } as unknown as AbilityDef;
    expect(capabilitiesOf(grantStatic)).toContain('feature:castCost.granted');
    for (const keyword of ['kicker', 'buyback', 'evoke', 'entwine', 'flashback']) {
      const grantKeyword = {
        kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Instant'] } }, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword, text: keyword, cost: { mana: [{ kind: 'generic', amount: 2 }] } }] }] }],
      } as unknown as AbilityDef;
      expect(capabilitiesOf(grantKeyword), keyword).toContain('feature:castCost.granted');
    }
    expect(ENGINE_CAPABILITIES.has('feature:castCost.granted')).toBe(true); // M6-12: actions/cast.ts#withGrantedCosts (test/m6/m6-12/granted-cast-cost.test.ts)
    // a printed keyword is not a grant
    expect(capabilitiesOf({ kind: 'keyword', keyword: 'kicker', text: 'Kicker {2}', cost: { mana: [{ kind: 'generic', amount: 2 }] } } as unknown as AbilityDef)).toEqual(['keyword:kicker']);
  });

  /**
   * G10 exception of K1 (whole index: Flashback, Dralnu, Lich Lord, Recoup, The Fugitive Doctor): a granted flashback was never offered by the cast path
   * (castOptionsOf reads printed faces only), so the granted keyword was manual with this reason instead of looking automated. M6-12 reads granted costs; a
   * granted flashback whose cost is given by the next sentence ("The flashback cost is equal to its mana cost.") has no cost to offer and stays manual
   * (feature:keyword.missing.cost, never registered).
   */
  it('CR 702.34a, 613.1f: a compiled "target card in your graveyard gains flashback" with no cost keeps the granted flashback manual (feature:keyword.missing.cost)', () => {
    // FAST5 T56 reads "The flashback cost is equal to its mana cost" (the flag costIsManaCost, feature:keyword.flashback.costIsManaCost): that card is full; a grant with no cost is not
    expect(synthetic('Test Recall Cost', 'Sorcery', '{1}{U}', 'Target instant card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.\nDraw a card.').automation.level).toBe('full');
    const def = synthetic('Test Recall', 'Sorcery', '{1}{U}', 'Target instant card in your graveyard gains flashback until end of turn.\nDraw a card.');
    expect(def.automation.level).not.toBe('full');
    const spans = (def.automation.faces ?? []).flatMap((f) => f.abilities.flatMap((a) => a.manual));
    expect(spans).toContainEqual(expect.objectContaining({ text: 'flashback', reason: 'needs-engine: feature:keyword.missing.cost' }));
  });

  it('CR 118.9, 601.2b: an alternative cost\'s "If ..." is read at announcement, before X: it needs the announcement forms', () => {
    const readable = { kind: 'static', text: 'x', zone: ['stack'], effects: [{ ...alt, when: { cond: 'turnOf', whose: 'opponent' } }] } as unknown as AbilityDef;
    expect(capabilitiesOf(readable)).toContain('feature:announce.cond.turnOf');
    // cloud std-tdm: the history of this turn with no reference is read at announcement (feature:announce.happened.turn); last turn's is not
    const history = { kind: 'static', text: 'x', zone: ['stack'], effects: [{ ...alt, when: { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' } }] } as unknown as AbilityDef;
    expect(capabilitiesOf(history)).toContain('feature:announce.cond.happened');
    expect(ENGINE_CAPABILITIES.has('feature:announce.cond.happened')).toBe(false);
  });
});
