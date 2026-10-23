/**
 * FAST2 T7 lowering and capability changes, pinned (each an INTERFACE CHANGE of a shared file):
 *   - parser/lower/static-anaphora.ts: a plain "it" in a one-sentence static ability is the one object the sentence names (design 6.4, CR 611.3a);
 *   - model/cap-walk.ts#nativeManaEffect and parser/lower/ability.ts#onlyAddMana: a mana ability whose only step is an `addMana` decided as it resolves runs
 *     natively since WP31 (CR 605.3b); after "Sacrifice ~" only a production that reads nothing of the source does.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { resolveStaticIt } from '../../../src/parser/lower/static-anaphora';
import { ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model/capabilities';

const it_ = { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', text: 'it' } };
const thatCreature = { ref: 'bound', name: '', $anaphor: { sort: 'object', number: 'singular', head: 'creature', text: 'that creature' } };
const grant = (affects: unknown) => ({ s: 'continuous', affects, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'flying' }] }] });
const attacking = (object: unknown) => ({ cond: 'matches', object, filter: { attacking: true } });

describe('design 6.4, CR 611.3a: "it" in a static ability (lower/static-anaphora.ts)', () => {
  it('the one object the sentence names: "~ has flying as long as it\'s attacking"', () => {
    const v = { kind: 'static', condition: attacking(it_), effects: [grant({ ref: 'self' })] };
    expect(resolveStaticIt(v)).toEqual({ kind: 'static', condition: attacking({ ref: 'self' }), effects: [grant({ ref: 'self' })] });
  });
  it('"As long as enchanted creature is red, it ...": the enchanted creature', () => {
    const v = { kind: 'static', condition: { cond: 'matches', object: { ref: 'attachedTo' }, filter: { colors: ['R'] } }, effects: [grant(it_)] };
    expect((resolveStaticIt(v) as { effects: { affects: unknown }[] }).effects[0]!.affects).toEqual({ ref: 'attachedTo' });
  });
  it('two candidates, a group, or a pronoun with a head noun: no unique antecedent, the sentence stays manual (null)', () => {
    expect(resolveStaticIt({ kind: 'static', condition: attacking({ ref: 'attachedTo' }), effects: [grant({ ref: 'self' }), grant(it_)] })).toBeNull();
    expect(resolveStaticIt({ kind: 'static', condition: attacking(it_), effects: [grant({ ref: 'each', filter: { types: ['Creature'] } })] })).toBeNull();
    expect(resolveStaticIt({ kind: 'static', condition: attacking(thatCreature), effects: [grant({ ref: 'self' })] })).toBeNull();
    expect(resolveStaticIt({ kind: 'static', condition: attacking({ ref: 'target', id: 't0' }), effects: [grant(it_)] })).toBeNull();
  });
  it('a pronoun inside a granted quoted ability is that ability\'s own (CR 113.7): never resolved here', () => {
    const quoted = { kind: 'triggered', trigger: { on: [] }, effect: { targets: [], steps: [{ op: 'tap', what: it_ }] } };
    expect(resolveStaticIt({ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [quoted] }] })).toBeNull();
  });
});

describe('CR 605.3b: mana abilities decided as they resolve (model/cap-walk.ts)', () => {
  const ability = (dynamic: unknown, cost: unknown = { tap: true }): AbilityDef =>
    ({ kind: 'activated', text: '', cost, isMana: true, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, dynamic }] } }) as AbilityDef;
  const sacrifice = { tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] };
  const forEach = { kind: 'ofType', type: 'G', count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } };

  it('chosen color, any one color, {G} for each, an amount equal to its power: nothing missing', () => {
    expect(missingCapabilities(ability({ kind: 'chosen', link: 'color', count: 1 }), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(ability({ kind: 'anyOneColor', count: 3 }), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(ability(forEach), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(ability({ kind: 'ofType', type: 'G', count: { q: 'stat', stat: 'power', of: { ref: 'self' } } }), ENGINE_CAPABILITIES)).toEqual([]);
  });
  it('after "Sacrifice ~": a fixed amount of any one color runs; a count, a chosen color or a variable amount does not (the source is gone)', () => {
    expect(missingCapabilities(ability({ kind: 'anyOneColor', count: 3 }, sacrifice), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(ability(forEach, sacrifice), ENGINE_CAPABILITIES)).toEqual(['feature:mana.steps']);
    expect(missingCapabilities(ability({ kind: 'chosen', link: 'color', count: 1 }, sacrifice), ENGINE_CAPABILITIES)).toEqual(['feature:mana.steps']);
    expect(missingCapabilities(ability({ kind: 'anyOneColor', count: { q: 'X' } }, sacrifice), ENGINE_CAPABILITIES)).toEqual(['feature:mana.steps']);
  });
  it('FAST5X E5: a mana cost is paid natively (CR 605.3a), an {X} in it is still feature:mana.cost (CR 107.3a)', () => {
    expect(missingCapabilities(ability({ kind: 'anyOneColor', count: 2 }, { tap: true, mana: [{ kind: 'generic', amount: 1 }] }), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(ability({ kind: 'anyOneColor', count: 2 }, { tap: true, mana: [{ kind: 'variable' }] }), ENGINE_CAPABILITIES)).toEqual(['feature:mana.cost']);
  });
});
