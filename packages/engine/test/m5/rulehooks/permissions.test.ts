/**
 * WP16, design 9.4: the wired `PermissionDef.action` and `RuleModDef.rule` rows (CR 609.4, 305.2, 402.2), the contract of `staticEffectsFor` (design 5.3) and
 * `cantHappen`, the "can't" check WP11's `forbidden` uses (CR 614.17).
 */
import { describe, expect, it } from 'vitest';
import { attackCandidates, type CardDef, type GameState } from '../../../src/index';
import { castCheck } from '../../../src/actions/cast';
import { landCheck, landsAllowed } from '../../../src/actions/land';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { cantHappen, maxHandSize, staticEffectsFor } from '../../../src/statics/hooks';
import { act, advanceTo, find, legal, passUntil, scenario, tweak } from '../helpers';
import { EACH_PLAYER, ENCHANTMENT, ORNITHOPTER, PACIFISM, SELF, SORCERY, VANILLA, YOU, cant, kw, permit, putAttached, ruleMod, staticOf, withRuleEffect } from './fixtures';

const g = (s: GameState) => gameOf(s);
const LANDS = ['Forest', 'Forest', 'Island', 'Island'];
const board = (defs: CardDef[], p1: { battlefield?: string[]; hand?: string[] } = {}, p2: { battlefield?: string[] } = {}): GameState =>
  scenario(['Forest', 'Island'], { defs, p1: { battlefield: [...LANDS, ...(p1.battlefield ?? [])], hand: p1.hand ?? [] }, p2: { battlefield: p2.battlefield ?? [] } });

describe('CR 601.3b, 702.8a: "You may cast creature spells as though they had flash." (permit:haveFlash through hookpoints.castsAsInstant)', () => {
  const leyline = ENCHANTMENT('Test Leyline', [staticOf('You may cast creature spells as though they had flash.', [permit(YOU, 'haveFlash', { of: { types: ['Creature'] } })])]);
  const bears = VANILLA('Test Bears');

  it('a creature can be cast in the beginning of combat step only with the permission; a sorcery still can\'t', () => {
    const plain = advanceTo(board([bears], { hand: ['Test Bears'] }), 1, 'beginCombat');
    expect('denial' in castCheck(plain, 'p1', find(plain, 'Test Bears', 'hand'))).toBe(true);
    const s = advanceTo(board([leyline, bears, SORCERY('Test Sorcery')], { battlefield: ['Test Leyline'], hand: ['Test Bears', 'Test Sorcery'] }), 1, 'beginCombat');
    expect(legal(s, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Test Bears']);
  });

  it('the permission is its controller\'s only (who: you)', () => {
    const s = advanceTo(scenario(['Forest'], { defs: [leyline, bears], p1: { battlefield: ['Test Leyline'] }, p2: { battlefield: ['Forest', 'Forest'], hand: ['Test Bears'] } }), 1, 'beginCombat');
    expect('denial' in castCheck(s, 'p2', find(s, 'Test Bears', 'hand', 'p2'))).toBe(true);
  });
});

describe('CR 609.4, 702.3b: "can attack as though it didn\'t have defender" (permit:attackAsThoughNoDefender through hookpoints.permits)', () => {
  const wall = VANILLA('Test Wall', ['0', '4'], [kw('defender', { text: 'Defender' })]);
  const walker = VANILLA('Test Walking Wall', ['0', '4'], [kw('defender', { text: 'Defender' }), staticOf("This creature can attack as though it didn't have defender.", [permit(YOU, 'attackAsThoughNoDefender')])]);

  it('the wall with the permission may attack, the plain wall may not', () => {
    const s = board([wall, walker], { battlefield: ['Test Wall', 'Test Walking Wall'] });
    const ids = attackCandidates(s, 'p1').map((c) => c.id);
    expect(ids).toContain(find(s, 'Test Walking Wall', 'battlefield'));
    expect(ids).not.toContain(find(s, 'Test Wall', 'battlefield'));
  });

  it('CR 101.2: a permission does not override a "can\'t attack" effect (Pacifism on it)', () => {
    const base = board([walker, PACIFISM], { battlefield: ['Test Walking Wall'] });
    const s = putAttached(base, 'Pacifism', find(base, 'Test Walking Wall', 'battlefield'));
    expect(attackCandidates(s, 'p1').map((c) => c.id)).not.toContain(find(s, 'Test Walking Wall', 'battlefield'));
  });
});

describe('CR 609.4, 702.9b: "can block as though it had flying" (permit:blockAsThough)', () => {
  const spider = VANILLA('Test Jumper', ['2', '2'], [staticOf('This creature can block as though it had flying.', [permit(YOU, 'blockAsThough', { asThough: 'as though it had flying' })])]);
  const bears = VANILLA('Test Bears');

  it('it may block a flyer; an ordinary creature may not; the permission waives only flying', () => {
    const s = board([spider, bears, ORNITHOPTER], { battlefield: ['Ornithopter'] }, { battlefield: ['Test Jumper', 'Test Bears'] });
    const thopter = find(s, 'Ornithopter', 'battlefield');
    expect(hookpoints.canBlock(g(s), find(s, 'Test Jumper', 'battlefield'), thopter)).toBeNull();
    expect(hookpoints.canBlock(g(s), find(s, 'Test Bears', 'battlefield'), thopter)?.rules).toContain('CR 702.9b');
  });
});

describe('CR 305.2: additional land plays (rulemod:landPlays, permit:playLand through actions/land.ts#landsAllowed)', () => {
  const azusa = VANILLA('Test Azusa', ['0', '3'], [staticOf('You may play two additional lands on each of your turns.', [ruleMod('landPlays', { player: YOU, value: 2 })])]);

  it('a static rule modification adds two land plays for its controller only', () => {
    const s = board([azusa], { battlefield: ['Test Azusa'], hand: ['Forest', 'Forest', 'Forest', 'Forest'] });
    expect([landsAllowed(s, 'p1'), landsAllowed(s, 'p2')]).toEqual([3, 1]);
    let t = s;
    for (let i = 0; i < 3; i++) t = act(t, { type: 'playLand', player: 'p1', card: find(t, 'Forest', 'hand') });
    expect(legal(t, 'p1', 'playLand')).toEqual([]);
    const d = landCheck(t, 'p1', find(t, 'Forest', 'hand'));
    expect('denial' in d && d.denial.rules).toContain('CR 305.2');
  });

  it('a resolved permission ("You may play an additional land this turn.") ends with the turn (CR 514.2)', () => {
    const s = withRuleEffect(board([], { hand: ['Forest', 'Forest'] }), permit({ ref: 'fixed', players: ['p1'] }, 'playLand'));
    expect(landsAllowed(s, 'p1')).toBe(2);
    expect(landsAllowed(advanceTo(s, 3, 'main1'), 'p1')).toBe(1);
  });

  it('CR 101.2, 305.2b: "can\'t play more than one land each turn" beats an additional land play', () => {
    const limit = ENCHANTMENT('Test Limit', [staticOf("Each player can't play more than one land each turn.", [cant(EACH_PLAYER, 'playLand', { max: 1 })])]);
    let s = board([azusa, limit], { battlefield: ['Test Azusa', 'Test Limit'], hand: ['Forest', 'Forest'] });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(landsAllowed(s, 'p1')).toBe(3);
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
  });
});

describe('CR 402.2, 514.1: maximum hand size (rulemod:maxHandSize, rulemod:handSizeNoLimit through the cleanup step)', () => {
  const tower = ENCHANTMENT('Test Tower', [staticOf('You have no maximum hand size.', [ruleMod('handSizeNoLimit', { player: YOU })])]);
  const small = ENCHANTMENT('Test Small Hands', [staticOf("Each player's maximum hand size is two.", [ruleMod('maxHandSize', { player: EACH_PLAYER, value: 2 })])]);
  const hand = Array(9).fill('Island') as string[];

  it('no maximum: nine cards stay in hand through the cleanup step', () => {
    const s = board([tower], { battlefield: ['Test Tower'], hand });
    expect(maxHandSize(s, 'p1')).toBeNull();
    const next = advanceTo(s, 2, 'upkeep'); // would stop at a discard decision (advanceTo can't answer one)
    expect(next.zones.hand.p1).toHaveLength(9);
  });

  it('a maximum of two: the active player discards down to two; the latest effect in timestamp order wins (CR 613.11)', () => {
    const s = board([small], { battlefield: ['Test Small Hands'], hand: ['Island', 'Island', 'Island', 'Island'] });
    expect([maxHandSize(s, 'p1'), maxHandSize(s, 'p2')]).toEqual([2, 2]);
    const cleanup = passUntil(s, (x) => x.pending?.kind === 'chooseObjects', 'the discard to hand size');
    expect(cleanup.pending?.kind === 'chooseObjects' && [cleanup.pending.min, cleanup.pending.rules]).toEqual([2, ['CR 514.1']]);
    const both = board([small, tower], { battlefield: ['Test Small Hands', 'Test Tower'] });
    expect(maxHandSize(both, 'p1')).toBeNull(); // the Tower is later
    expect(maxHandSize(both, 'p2')).toBe(2);
  });
});

describe('design 5.3: staticEffectsFor lists what constrains an action, restrictions ("can\'t") before permissions ("can"), in timestamp order (CR 101.2, 613.10)', () => {
  it('the restrictions on casting and the permission, each in timestamp order', () => {
    const first = ENCHANTMENT('Test First', [staticOf("Your opponents can't cast spells.", [cant({ ref: 'each', who: 'opponent' }, 'cast')])]);
    const second = ENCHANTMENT('Test Second', [staticOf("Players can't cast spells.", [cant(EACH_PLAYER, 'cast')])]);
    const perm = ENCHANTMENT('Test Permit', [staticOf('You may cast spells as though they had flash.', [permit(EACH_PLAYER, 'cast', { asThough: 'they had flash' })])]);
    const s = board([perm, first, second], { battlefield: ['Test Permit', 'Test First', 'Test Second'] });
    const p2 = staticEffectsFor(s, { action: 'cast', subject: 'p2' });
    expect(p2.map((e) => e.s)).toEqual(['restrict', 'restrict', 'permit']);
    expect(p2[0]).toMatchObject({ subject: { ref: 'each', who: 'opponent' } });
    expect(staticEffectsFor(s, { action: 'cast', subject: 'p1' }).map((e) => e.s)).toEqual(['restrict', 'permit']);
    expect(staticEffectsFor(s, { action: 'draw', subject: 'p1' })).toEqual([]);
  });

  it('an `onlyIf` restriction is listed only while its condition is not met, a `mustIfAble` requirement whenever it concerns the subject', () => {
    const onlyIf = VANILLA('Test Coward', ['1', '1'], [staticOf('This creature can attack only if you control a Forest.', [{ s: 'restrict', subject: SELF, mode: 'onlyIf', action: 'attack', when: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } } }])]);
    const must = VANILLA('Test Brute', ['3', '3'], [staticOf('This creature attacks each combat if able.', [{ s: 'restrict', subject: SELF, mode: 'mustIfAble', action: 'attack' }])]);
    const s = scenario(['Island'], { defs: [onlyIf, must], p1: { battlefield: ['Test Coward', 'Test Brute', 'Island'] } });
    expect(staticEffectsFor(s, { action: 'attack', subject: find(s, 'Test Coward', 'battlefield'), other: 'p2' })).toHaveLength(1);
    expect(hookpoints.canAttack(g(s), find(s, 'Test Coward', 'battlefield'), 'p2')?.rules).toContain('CR 508.1c');
    const withForest = scenario(['Forest'], { defs: [onlyIf], p1: { battlefield: ['Test Coward', 'Forest'] } });
    expect(staticEffectsFor(withForest, { action: 'attack', subject: find(withForest, 'Test Coward', 'battlefield'), other: 'p2' })).toEqual([]);
    expect(hookpoints.canAttack(g(withForest), find(withForest, 'Test Coward', 'battlefield'), 'p2')).toBeNull();
    expect(staticEffectsFor(s, { action: 'attack', subject: find(s, 'Test Brute', 'battlefield') }).map((e) => e.s === 'restrict' && e.mode)).toEqual(['mustIfAble']);
    expect(hookpoints.canAttack(g(s), find(s, 'Test Brute', 'battlefield'), 'p2')).toBeNull(); // a requirement never forbids (CR 508.1d is enforced by the declare step, R1: rules/requirements.ts)
  });
});

describe('CR 614.17: cantHappen answers any action, wired or not (WP11 maps its proposed events to it)', () => {
  it('"You can\'t draw cards" and a resolved "target player can\'t draw cards this turn" are found; nothing is found without them', () => {
    const noDraw = ENCHANTMENT('Test No Draw', [staticOf("You can't draw cards.", [cant(YOU, 'draw')])]);
    const s = board([noDraw], { battlefield: ['Test No Draw'] });
    expect(cantHappen(s, { action: 'draw', subject: 'p1' })?.rules).toEqual(['CR 121.1', 'CR 614.17', 'CR 101.2']);
    expect(cantHappen(s, { action: 'draw', subject: 'p2' })).toBeNull();
    const rec = withRuleEffect(board([]), cant({ ref: 'fixed', players: ['p2'] }, 'draw'));
    expect(cantHappen(rec, { action: 'draw', subject: 'p2' })?.message).toContain('Test Effect');
    expect(cantHappen(board([]), { action: 'draw', subject: 'p1' })).toBeNull();
  });
});
