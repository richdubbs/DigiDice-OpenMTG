/**
 * WP16 and design 5.2: a rule hook is a capability only when its call-site consults the statics provider; the cards of 15.2 WP16 classify as automated
 * through the walker; what is not wired stays a missing capability. Also the contracts other modules rely on (the flag of actions/cast.ts, the fingerprint of
 * rules/characteristics.ts) and the cost of the common case (behavior neutrality, design 15.1.8).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, legalActions, missingCapabilities, type AbilityDef, type RuleAction } from '../../../src/index';
import { FLAG_CANT_BE_COUNTERED } from '../../../src/actions/cast';
import { FINGERPRINTED } from '../../../src/rules/characteristics';
import { hookpoints, gameOf } from '../../../src/rules/hookpoints';
import { CANT_BE_COUNTERED_FLAG, RULE_HOOK_ACTIONS, UNWIRED_RULE_ACTIONS } from '../../../src/statics/hooks';
import { LAYER_INPUTS, RULE_CONTEXT_STATS, ruleContext, ruleSourcesPresent } from '../../../src/statics/rule-sources';
import { find, scenario } from '../helpers';
import { DEATH_RATTLE_ONI, ENCHANTMENT, FIREBALL, FROGMITE, MANA_VAULT, PACIFISM, PLATINUM_ANGEL, SELF, SORCERY, THALIA, cant, staticOf } from './fixtures';

/** Every RuleAction of types/ability.ts (the union is closed; a new one must be placed in one of the two tables). */
const ALL_ACTIONS: RuleAction[] = [
  'attack', 'block', 'beBlocked', 'beBlockedBy', 'attackPlayer', 'cast', 'activate', 'playLand', 'draw', 'gainLife', 'loseLife', 'lose', 'win', 'untap', 'untapDuringUntapStep', 'tap',
  'beTapped', 'transform', 'search', 'sacrifice', 'discard', 'beTargeted', 'beCountered', 'beDestroyed', 'beRegenerated', 'beSacrificed', 'beExiled', 'beAttached', 'beEnchanted',
  'beEquipped', 'dealDamage', 'receiveDamage', 'preventDamage', 'enter', 'leave', 'gainAbility', 'haveCountersPut', 'payLife', 'castFromZone', 'spendMana',
];

const statics = (def: { faces: { abilities: AbilityDef[] }[] }): AbilityDef[] => def.faces[0]!.abilities.filter((a) => a.kind === 'static');

describe('design 5.2, 9.4: RULE_HOOK_ACTIONS is the capability set of the rule hooks', () => {
  it('every key is in ENGINE_CAPABILITIES (the builder reads the table)', () => {
    for (const k of Object.keys(RULE_HOOK_ACTIONS)) expect(ENGINE_CAPABILITIES.has(k), k).toBe(true);
  });

  it('every RuleAction is either wired (rule:<action> registered) or listed as unwired with its owner, never both', () => {
    for (const a of ALL_ACTIONS) {
      const wired = Object.hasOwn(RULE_HOOK_ACTIONS, `rule:${a}`);
      const unwired = Object.hasOwn(UNWIRED_RULE_ACTIONS, a);
      expect(wired !== unwired, a).toBe(true);
      expect(ENGINE_CAPABILITIES.has(`rule:${a}`), a).toBe(wired);
    }
  });

  // R1 (M6-7a) advertised `restrict:mustIfAble` (the combat requirements); its pins moved to test/m6/combat/requirements-cards.test.ts.
  // r4-fxz wired `permit:activate` (activate as though it had haste, CR 302.6; statics/hooks.ts#activatesAsThoughHaste): pinned in test/cloud/r4-fxz/
  it('limits and unwired permissions and rule modifications are not advertised', () => {
    for (const c of ['feature:restrict.max', 'permit:cast', 'permit:play', 'permit:spendMana', 'rulemod:startingLife', 'feature:costMod.abilities']) {
      expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
    }
  });
});

describe('the cards of design 15.2 WP16 need no capability the engine lacks (they would classify as automated)', () => {
  it.each([
    ['Thalia, Guardian of Thraben', THALIA], ['Platinum Angel', PLATINUM_ANGEL], ['Pacifism', PACIFISM], ['Mana Vault', MANA_VAULT], ['Death-Rattle Oni', DEATH_RATTLE_ONI], ['Fireball', FIREBALL],
  ])('%s: its static abilities', (_name, def) => {
    for (const a of statics(def)) expect(missingCapabilities(a, ENGINE_CAPABILITIES), a.text).toEqual([]);
  });

  it('affinity (CR 702.41) is advertised: its expansion is a self cost modifier the engine applies', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:affinity')).toBe(true);
    expect(missingCapabilities(FROGMITE.faces[0]!.abilities[0]!, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('an unwired action and a limit stay missing, so such a card is never falsely automated', () => {
    expect(missingCapabilities(staticOf("~ can't be tapped.", [cant(SELF, 'beTapped')]), ENGINE_CAPABILITIES)).toEqual(['rule:beTapped']); // WP31: still unwired
    // R1 (M6-7a): a creature's own combat requirement is automated. M6-7 advertised the ones that name another creature (feature:require.other.*); that pin
    // moved to test/m6/combat/requirements-cards.test.ts.
    expect(missingCapabilities(staticOf('This creature attacks each combat if able.', [{ s: 'restrict', subject: SELF, mode: 'mustIfAble', action: 'attack' }]), ENGINE_CAPABILITIES)).toEqual([]);
    // FAST4 T24: a limit on casting spells (no `other`) is counted (feature:restrict.max.cast, CR 601.2i); a limit of another action stays missing. Since
    // p2-player-rules-1 a limit of a kind of spell is counted too, field by field (feature:restrict.max.cast.other.<field>, statics/hooks.ts#CAST_KIND_LIMIT_FIELDS)
    expect(missingCapabilities(staticOf("You can't cast more than one spell each turn.", [cant({ ref: 'you' }, 'cast', { max: 1 })]), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(staticOf("You can't cast more than one noncreature spell each turn.", [cant({ ref: 'you' }, 'cast', { max: 1, other: { notTypes: ['Creature'] } })]), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(staticOf("You can't play more than one land each turn.", [cant({ ref: 'you' }, 'playLand', { max: 1 })]), ENGINE_CAPABILITIES)).toEqual(['feature:restrict.max']);
  });
});

describe('contracts with other modules', () => {
  it('the uncounterable flag is the one actions/cast.ts writes (CR 106.6)', () => {
    expect(CANT_BE_COUNTERED_FLAG).toBe(FLAG_CANT_BE_COUNTERED);
  });

  it('the rule-effect cache keys on exactly what the layer system reads (rules/characteristics.ts FINGERPRINTED)', () => {
    expect([...LAYER_INPUTS]).toEqual([...FINGERPRINTED]);
  });
});

describe('design 15.1.8: milestone 3/4 games do not pay for rule hooks', () => {
  it('a game whose definitions have no rule effect has no rule sources; legalActions builds no rule context', () => {
    const s = scenario(['Grizzly Bears', 'Lightning Bolt', 'Mountain', 'Serra Angel', 'Llanowar Elves'], { p1: { battlefield: ['Mountain', 'Llanowar Elves', 'Serra Angel'], hand: ['Lightning Bolt', 'Grizzly Bears'] } });
    expect(ruleSourcesPresent(s)).toBe(false);
    expect(ruleContext(s)).toBeNull();
    const before = RULE_CONTEXT_STATS.built;
    legalActions(s, 'p1');
    expect(RULE_CONTEXT_STATS.built).toBe(before);
  });

  it('CR 113.6, 604.5: a card whose rule ability functions only on the stack (affinity, a casting restriction) is not a source from the hand or the library', () => {
    const s = scenario(['Island'], { defs: [FROGMITE, SORCERY('Test Sorcery')], p1: { battlefield: ['Island'], hand: ['Frogmite', 'Test Sorcery'] } });
    expect(ruleSourcesPresent(s)).toBe(false);
    expect(ruleContext(s)).toBeNull();
    const withThalia = scenario(['Island'], { defs: [THALIA], p1: { battlefield: ['Thalia, Guardian of Thraben'] } });
    expect(ruleSourcesPresent(withThalia)).toBe(true);
  });

  it('a layered state with rule sources is computed once per distinct state (the cache), and again after it changes', () => {
    const anthem = ENCHANTMENT('Test Anthem', [staticOf('Creatures you control get +1/+1.', [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }])]);
    const s = scenario(['Island'], { defs: [THALIA, anthem, SORCERY('Test Sorcery')], p1: { battlefield: ['Thalia, Guardian of Thraben', 'Test Anthem', 'Island'], hand: ['Test Sorcery'] } });
    const card = find(s, 'Test Sorcery', 'hand');
    hookpoints.canCast(gameOf(s), card, 'p1', 0, {});
    const [built, hits] = [RULE_CONTEXT_STATS.built, RULE_CONTEXT_STATS.cacheHits];
    for (let i = 0; i < 5; i++) hookpoints.canCast(gameOf(s), card, 'p1', 0, {});
    expect(RULE_CONTEXT_STATS.built).toBe(built);
    expect(RULE_CONTEXT_STATS.cacheHits).toBeGreaterThanOrEqual(hits + 5);
    // edited in place: the fingerprint changes (review 2026-10-26: a counter, which the layers read; tapping the Island no longer counts, since nothing on this
    // board reads whether a permanent is tapped: statics/layer-reads.ts)
    s.objects[find(s, 'Thalia, Guardian of Thraben', 'battlefield')]!.counters['+1/+1'] = 1;
    hookpoints.canCast(gameOf(s), card, 'p1', 0, {});
    expect(RULE_CONTEXT_STATS.built).toBe(built + 1);
  });
});
