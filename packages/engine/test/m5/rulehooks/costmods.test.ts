/**
 * WP16, design 9.5: cost modifiers (CR 601.2f, 118.7-118.9). Thalia (an increase from another permanent), affinity (CR 702.41a, a self reduction from the
 * keyword library), Fireball (a self increase that reads the announced targets), Death-Rattle Oni (a self reduction that reads the history), the order of
 * CR 601.2f, generic-only reductions and the {0} floor. Through the real castCheck, legalActions and cast action.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, ENGINE_CAPABILITIES, missingCapabilities, type CardDef, type CostModDef, type GameState, type ManaSymbol, type ObjectId } from '../../../src/index';
import { castCheck, modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { makeHistoryEntry, objectFacts } from '../../../src/rules/history';
import { getChars } from '../../../src/rules/characteristics';
import { applicableCostMods, costModsFor, modifyMana, type CostModHit } from '../../../src/statics/costmods';
import { castAuto, find, legal, put, reject, scenario, tweak } from '../helpers';
import {
  DEATH_RATTLE_ONI, ENCHANTMENT, FIREBALL, FROGMITE, ORNITHOPTER, SORCERY, THALIA, THALIA_COST, THOUGHTCAST, VANILLA, staticOf, withRuleEffect,
} from './fixtures';

const mana = (s: string): ManaSymbol[] => [...s.matchAll(/\{([^}]+)\}/g)].map((m) => {
  const b = m[1]!;
  if (/^\d+$/.test(b)) return { kind: 'generic', amount: Number(b) };
  if (b === 'C') return { kind: 'colorless' };
  return { kind: 'colored', color: b as 'W' | 'U' | 'B' | 'R' | 'G' };
});
const text = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : x.kind === 'colorless' ? '{C}' : `{${x.kind}}`)).join('') || '{0}';
const tappedLands = (s: GameState, p = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.tapped && s.defs[s.objects[id]!.defId]!.faces[0]!.types.includes('Land')).length;

function board(defs: CardDef[], p1: { battlefield?: string[]; hand?: string[] }, p2: { battlefield?: string[]; hand?: string[] } = {}): GameState {
  return scenario(['Island', 'Swamp', 'Mountain', 'Plains', 'Forest'], { defs, p1: { battlefield: p1.battlefield ?? [], hand: p1.hand ?? [] }, p2: { battlefield: p2.battlefield ?? [], hand: p2.hand ?? [] } });
}

/** The total mana cost castCheck would charge for the card in hand (base cost at X = 0, CR 601.2f). */
function costOf(s: GameState, name: string, player = 'p1'): string {
  const id = find(s, name, 'hand', player);
  const def = s.defs[s.objects[id]!.defId]!;
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? text(m.plan.mana) : `denied: ${m.denial.message}`;
}

describe('CR 601.2f: Thalia, Guardian of Thraben ("Noncreature spells cost {1} more to cast.", applies.spells, caster any)', () => {
  it('a noncreature spell costs {1} more for both players; a creature spell does not', () => {
    const s = board([THALIA, SORCERY('Test Sorcery'), VANILLA('Test Bears')], { battlefield: ['Thalia, Guardian of Thraben'], hand: ['Test Sorcery', 'Test Bears'] }, { hand: ['Test Sorcery'] });
    expect(costOf(s, 'Test Sorcery')).toBe('{2}{U}');
    expect(costOf(s, 'Test Sorcery', 'p2')).toBe('{2}{U}');
    expect(costOf(s, 'Test Bears')).toBe('{1}{G}');
    expect(applicableCostMods(s, find(s, 'Test Sorcery', 'hand'), 'p1')).toEqual([THALIA_COST]);
  });

  it('castCheck and legalActions use the modified cost: two lands are not enough, three are, and casting taps three', () => {
    const two = board([THALIA, SORCERY('Test Sorcery')], { battlefield: ['Thalia, Guardian of Thraben', 'Island', 'Island'], hand: ['Test Sorcery'] });
    expect(legal(two, 'p1', 'cast')).toEqual([]);
    expect(reject(two, { type: 'cast', player: 'p1', card: find(two, 'Test Sorcery', 'hand') }).message).toBeTruthy();
    const three = board([THALIA, SORCERY('Test Sorcery')], { battlefield: ['Thalia, Guardian of Thraben', 'Island', 'Island', 'Island'], hand: ['Test Sorcery'] });
    expect(legal(three, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Test Sorcery']);
    expect(tappedLands(castAuto(three, 'Test Sorcery'))).toBe(3);
  });

  it('CR 611.3a, 613.1f: in a layered state the modifier is re-derived; Thalia losing all abilities stops it', () => {
    const anthem = ENCHANTMENT('Test Anthem', [staticOf('Creatures you control get +1/+1.', [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }])]);
    const s = board([THALIA, anthem, SORCERY('Test Sorcery')], { battlefield: ['Thalia, Guardian of Thraben', 'Test Anthem'], hand: ['Test Sorcery'] });
    expect(getChars(s, find(s, 'Thalia, Guardian of Thraben', 'battlefield')).power).toBe('3');
    expect(costOf(s, 'Test Sorcery')).toBe('{2}{U}');
    const thalia = find(s, 'Thalia, Guardian of Thraben', 'battlefield');
    const lost = withRuleEffect(s, { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: thalia, zone: 'battlefield' }] }, mods: [{ layer: 6, removeAll: true }] } as never);
    expect(costOf(lost, 'Test Sorcery')).toBe('{1}{U}');
  });
});

describe('CR 702.41a: affinity for artifacts (the keyword library\'s self reduction, applies.self)', () => {
  it('Frogmite costs {1} less for each artifact its caster controls, down to {0} (CR 601.2f: never below {0}); the opponent\'s artifacts do not count', () => {
    const three = board([FROGMITE, ORNITHOPTER], { battlefield: ['Ornithopter', 'Ornithopter', 'Ornithopter'], hand: ['Frogmite'] }, { battlefield: ['Ornithopter', 'Ornithopter'] });
    expect(costOf(three, 'Frogmite')).toBe('{1}');
    const six = board([FROGMITE, ORNITHOPTER], { battlefield: Array(6).fill('Ornithopter') as string[], hand: ['Frogmite'] });
    expect(costOf(six, 'Frogmite')).toBe('{0}');
    expect(legal(six, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Frogmite']); // castable with no land at all
    const cast = castAuto(six, 'Frogmite');
    expect(cast.zones.stack).toHaveLength(1);
  });

  it('a self modifier applies to its own spell only', () => {
    const s = board([FROGMITE, ORNITHOPTER, SORCERY('Test Sorcery')], { battlefield: ['Ornithopter'], hand: ['Frogmite', 'Test Sorcery'] });
    expect(costOf(s, 'Test Sorcery')).toBe('{1}{U}');
    expect(costModsFor(s, find(s, 'Test Sorcery', 'hand'), 'p1')).toEqual([]);
  });
});

describe('CR 601.2f: increases before reductions; the order is not the printed or timestamp order', () => {
  it('Thoughtcast ({4}{U}, affinity) with five artifacts and Thalia costs {U}, not {1}{U}; casting taps only the Island', () => {
    const s = board([THALIA, THOUGHTCAST, ORNITHOPTER], { battlefield: ['Thalia, Guardian of Thraben', ...Array(5).fill('Ornithopter') as string[], 'Island'], hand: ['Thoughtcast'] });
    expect(costOf(s, 'Thoughtcast')).toBe('{U}'); // 4 + 1 - 5 = 0 generic; reducing first would give max(0, 4 - 5) + 1 = {1}
    expect(tappedLands(castAuto(s, 'Thoughtcast'))).toBe(1);
  });
});

describe('CR 118.7a-d: what a reduction can reduce', () => {
  const hit = (change: CostModDef['change']): CostModHit => ({
    def: { s: 'costMod', applies: { self: true, caster: 'you' }, change }, source: null, controller: 'p1', name: 'Test', text: 'test',
    cx: { s: scenario([]), all: new Map(), source: null, controller: 'p1' },
  });
  const apply = (cost: string, ...changes: CostModDef['change'][]): string => {
    const r = modifyMana(mana(cost), changes.map(hit));
    return 'mana' in r ? text(r.mana) : 'unknown';
  };

  it('CR 118.7a: a generic reduction affects only the generic component ({U}{U} stays {U}{U}; {3}{U} minus 5 is {U})', () => {
    expect(apply('{U}{U}', { kind: 'reduce', generic: 2 })).toBe('{U}{U}');
    expect(apply('{3}{U}', { kind: 'reduce', generic: 5 })).toBe('{U}');
  });

  it('CR 118.7b-d: a colored or colorless reduction without that mana in the cost reduces the generic component instead', () => {
    expect(apply('{2}{U}', { kind: 'reduce', mana: mana('{U}') })).toBe('{2}');
    expect(apply('{2}{G}', { kind: 'reduce', mana: mana('{U}') })).toBe('{1}{G}');
    expect(apply('{1}{U}', { kind: 'reduce', mana: mana('{U}{U}') })).toBe('{0}');
    expect(apply('{2}{C}', { kind: 'reduce', mana: mana('{C}{C}') })).toBe('{1}');
  });

  it('CR 601.2f, 118.7: the result is never below {0}, and an increase is applied before any reduction whatever their order in the list', () => {
    expect(apply('{1}', { kind: 'reduce', generic: 3 })).toBe('{0}');
    expect(apply('{2}', { kind: 'reduce', generic: 2 }, { kind: 'increase', generic: 1 })).toBe('{1}');
    expect(apply('{U}', { kind: 'increase', mana: mana('{1}{B}') })).toBe('{1}{U}{B}');
  });

  it('CR 601.2f (last sentences): a cost set outright is applied after the increases and reductions', () => {
    expect(apply('{5}{U}', { kind: 'reduce', generic: 1 }, { kind: 'set', generic: 3 })).toBe('{3}');
  });
});

describe('CR 601.2c, 601.2f: Fireball\'s self increase reads the targets announced before the total cost', () => {
  it('two targets: {1} more; one or no target: nothing more', () => {
    const s = board([FIREBALL], { battlefield: ['Mountain'], hand: ['Fireball'] });
    const id = find(s, 'Fireball', 'hand');
    const onStack = (targets: number): { s: GameState; id: ObjectId } => {
      const t = tweak(s, (x) => {
        const o = x.objects[id]!;
        x.zones.hand.p1 = x.zones.hand.p1!.filter((y) => y !== id);
        o.zone = 'stack';
        x.zones.stack.push(id);
        o.stack = { kind: 'spell', face: 0, targets: [Array.from({ length: targets }, (_, i) => ({ kind: 'player' as const, id: i === 0 ? 'p2' : 'p1' }))], costsPaid: {}, castFrom: 'hand' } as never;
      });
      return { s: t, id };
    };
    for (const [n, want] of [[0, '{1}{R}'], [1, '{1}{R}'], [2, '{2}{R}'], [3, '{3}{R}']] as const) {
      const { s: t } = onStack(n);
      const m = modifiedPlan(t, 'p1', id, { ...emptyPlan(), mana: mana('{1}{R}') });
      expect('plan' in m && text(m.plan.mana), `${n} targets`).toBe(want);
    }
  });
});

describe('CR 601.2f, 603.10: Death-Rattle Oni\'s reduction counts the creatures that died this turn (the history, design 3.4)', () => {
  it('no death: {4}{B}{B}; two deaths: {B}{B}; three deaths: still {B}{B} (generic only, CR 118.7a)', () => {
    const base = board([DEATH_RATTLE_ONI, VANILLA('Test Bears')], { battlefield: ['Test Bears', 'Test Bears', 'Test Bears'], hand: ['Death-Rattle Oni'] });
    expect(costOf(base, 'Death-Rattle Oni')).toBe('{4}{B}{B}');
    const died = (n: number): GameState => tweak(base, (t) => {
      const bears = t.zones.battlefield.filter((id) => t.objects[id]!.defId === 'Test Bears').slice(0, n);
      for (const id of bears) {
        const facts = { ...objectFacts(getChars(t, id), t.objects[id]!), from: 'battlefield', to: 'graveyard' };
        t.history.push(makeHistoryEntry(t, { ev: 'zoneChange', subject: id, facts }));
      }
    });
    expect(costOf(died(2), 'Death-Rattle Oni')).toBe('{B}{B}');
    expect(costOf(died(3), 'Death-Rattle Oni')).toBe('{B}{B}');
    const two = tweak(died(2), (t) => { for (let i = 0; i < 2; i++) put(t, 'p1', 'battlefield', 'Swamp'); });
    expect(legal(two, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Death-Rattle Oni']);
  });
});

describe('design 1.1.4: a cost the engine can\'t work out is never guessed', () => {
  it('a modifier whose amount can\'t be evaluated here makes castCheck refuse the spell with CR 601.2f', () => {
    const odd = ENCHANTMENT('Test Odd Tax', [staticOf('Spells cost {X} more, where X is ...', [{ s: 'costMod', applies: { spells: { zone: 'stack' }, caster: 'any' }, change: { kind: 'increase', generic: { q: 'eventAmount' } } }])]);
    const s = board([odd, SORCERY('Test Sorcery')], { battlefield: ['Test Odd Tax', 'Island', 'Island', 'Island', 'Island'], hand: ['Test Sorcery'] });
    const d = castCheck(s, 'p1', find(s, 'Test Sorcery', 'hand'));
    expect('denial' in d && d.denial.rules).toEqual(['CR 601.2f']);
    expect(legal(s, 'p1', 'cast')).toEqual([]);
  });

  it('a modifier of activation costs never changes a spell, and its capability is not advertised (actions/activate.ts has no cost-modifier step)', () => {
    const tax: CostModDef = { s: 'costMod', applies: { abilities: { kind: 'activated' }, caster: 'any' }, change: { kind: 'increase', generic: 1 } };
    const s = board([ENCHANTMENT('Test Ability Tax', [staticOf('Activated abilities cost {1} more to activate.', [tax])]), SORCERY('Test Sorcery')], { battlefield: ['Test Ability Tax'], hand: ['Test Sorcery'] });
    expect(costOf(s, 'Test Sorcery')).toBe('{1}{U}');
    const ability = staticOf('Activated abilities cost {1} more to activate.', [tax]);
    expect(capabilitiesOf(ability)).toContain('feature:costMod.abilities');
    expect(missingCapabilities(ability, ENGINE_CAPABILITIES)).toEqual(['feature:costMod.abilities']);
  });
});

