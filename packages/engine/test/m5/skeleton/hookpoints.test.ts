/**
 * rules/hookpoints.ts: the one place call-sites ask "may this happen?". WP0 moved milestone 4's inline keyword checks behind it; these tests pin that the
 * provider answers with the same rules (the M3/M4 suites pin the end-to-end behavior) and that providers combine as the design says: any denial wins.
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState } from '../../../src/index';
import { deny } from '../../../src/rules/denial';
import { createHookpoints, gameOf, hookpoints, type RuleHookProvider } from '../../../src/rules/hookpoints';
import { keywordProvider } from '../../../src/keywords/hooks';
import { staticsProvider } from '../../../src/statics/hooks';
import { targetOptions } from '../../../src/rules/targets';
import { find, scenario, synth } from '../helpers';

const g = (s: GameState) => gameOf(s);

describe('the hookpoints combine providers (design 5.3, rules/hookpoints.ts)', () => {
  const veto = deny('Test veto.', 'CR 101.2');
  const mk = (p: Partial<RuleHookProvider>): RuleHookProvider => ({ name: 'statics', ...p });
  const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
  const bears = find(s, 'Grizzly Bears', 'battlefield');

  it('CR 101.2: a denial from any provider wins, whatever the order', () => {
    const ok = mk({ canAttack: () => null });
    const no = mk({ canAttack: () => veto });
    expect(createHookpoints(() => [ok, no]).canAttack(g(s), bears, 'p2')).toBe(veto);
    expect(createHookpoints(() => [no, ok]).canAttack(g(s), bears, 'p2')).toBe(veto);
    expect(createHookpoints(() => [ok]).canAttack(g(s), bears, 'p2')).toBeNull();
    expect(createHookpoints(() => []).canAttack(g(s), bears, 'p2')).toBeNull();
  });

  it('a provider without an opinion on a query is skipped', () => {
    expect(createHookpoints(() => [mk({})]).canBlock(g(s), bears, bears)).toBeNull();
  });

  it('boolean queries start from the rules default and any provider can change them', () => {
    const c = getChars(s, bears);
    const none = createHookpoints(() => []);
    expect([none.attackTaps(g(s), bears, 'p1', c), none.summoningSick(g(s), bears, 'p1', c), none.castsAsInstant(g(s), bears, 'p1', c)]).toEqual([true, true, false]); // CR 508.1f, 302.6, 117.1a
    const all = createHookpoints(() => [mk({ attackTaps: () => false, summoningSick: () => false, castsAsInstant: () => true })]);
    expect([all.attackTaps(g(s), bears, 'p1', c), all.summoningSick(g(s), bears, 'p1', c), all.castsAsInstant(g(s), bears, 'p1', c)]).toEqual([false, false, true]);
    const abstain = createHookpoints(() => [mk({ attackTaps: () => undefined })]);
    expect(abstain.attackTaps(g(s), bears, 'p1', c)).toBe(true);
  });

  it('payment options of all providers are concatenated', () => {
    const opt = { key: 'x', describe: 'x', reduces: {}, cost: {} };
    expect(createHookpoints(() => [mk({ paymentOptions: () => [opt] }), mk({ paymentOptions: () => [opt] }), mk({})]).paymentOptions(g(s), bears, 'p1')).toHaveLength(2);
  });
});

describe('the engine registers the keyword provider and the statics provider', () => {
  it('the statics provider answers the hooks of design 9.4 (WP16; its behavior is pinned in test/m5/rulehooks/)', () => {
    expect(Object.keys(staticsProvider).sort()).toEqual(['activatesAsThoughHaste' /* r4-fxz: CR 302.6 */, 'blockSetValid' /* MX5: CR 509.1b */, 'canActivate', 'canAttach', 'canAttack', 'canBeCountered', 'canBeTargeted', 'canBlock', 'canCast', 'canPlayLand', 'castFlashAddCosts' /* std-rx10 */, 'castFlashCosts' /* FAST5 T56 */, 'castsAsInstant', 'loyaltyAsInstant' /* r4-mech */, 'name', 'permits']);
    expect(staticsProvider.name).toBe('statics');
    expect(keywordProvider.name).toBe('keywords');
  });

  it('CR 702.3b: defender cannot attack', () => {
    const s = scenario(['Wall of Stone', 'Grizzly Bears'], { p1: { battlefield: ['Wall of Stone', 'Grizzly Bears'] } });
    expect(hookpoints.canAttack(g(s), find(s, 'Wall of Stone', 'battlefield'), 'p2')?.rules).toContain('CR 702.3b');
    expect(hookpoints.canAttack(g(s), find(s, 'Grizzly Bears', 'battlefield'), 'p2')).toBeNull();
  });

  it('CR 702.9b, 702.17b: flying can be blocked only by flying or reach', () => {
    const s = scenario(['Serra Angel', 'Grizzly Bears', 'Giant Spider'], { p1: { battlefield: ['Serra Angel'] }, p2: { battlefield: ['Grizzly Bears', 'Giant Spider'] } });
    const angel = find(s, 'Serra Angel', 'battlefield');
    expect(hookpoints.canBlock(g(s), find(s, 'Grizzly Bears', 'battlefield'), angel)?.rules).toContain('CR 702.9b');
    expect(hookpoints.canBlock(g(s), find(s, 'Giant Spider', 'battlefield'), angel)).toBeNull(); // reach
  });

  it('CR 702.111b: menace needs two blockers', () => {
    const s = scenario(['Grizzly Bears', 'Hill Giant', 'Elephant-Rat'], { p1: { battlefield: ['Elephant-Rat'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] } });
    const [a, b] = [find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Hill Giant', 'battlefield')];
    const menace = find(s, 'Elephant-Rat', 'battlefield');
    expect(hookpoints.blockSetValid(g(s), menace, [a])?.rules).toContain('CR 702.111b');
    expect(hookpoints.blockSetValid(g(s), menace, [a, b])).toBeNull();
    expect(hookpoints.blockSetValid(g(s), menace, [])).toBeNull(); // not blocked at all is fine
    expect(hookpoints.blockSetValid(g(s), a, [b])).toBeNull(); // no menace
  });

  it('CR 702.11b: hexproof stops an opponent\'s source from targeting, not its controller; players have no keywords yet', () => {
    const s = scenario(['Gladecover Scout', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Gladecover Scout'] } });
    const scout = find(s, 'Gladecover Scout', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(hookpoints.canBeTargeted(g(s), scout, bears, 'p1')?.rules).toContain('CR 702.11b'); // hexproof: an opponent's source
    expect(hookpoints.canBeTargeted(g(s), scout, null, 'p2')).toBeNull(); // its controller may target it
    expect(hookpoints.canBeTargeted(g(s), bears, scout, 'p2')).toBeNull();
    expect(hookpoints.canBeTargeted(g(s), 'p1', scout, 'p2')).toBeNull(); // players have no such keywords yet
    expect(targetOptions(s, { id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }, 'p1', bears).players).toEqual(['p1', 'p2']); // ...and targetOptions offers them
  });

  it('CR 702.18a: shroud stops everyone, its controller included; the source may be gone (last known information)', () => {
    const s = scenario(['Elvish Lookout', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Elvish Lookout'] } });
    const lookout = find(s, 'Elvish Lookout', 'battlefield');
    expect(hookpoints.canBeTargeted(g(s), lookout, null, 'p2')?.rules).toContain('CR 702.18a');
    expect(hookpoints.canBeTargeted(g(s), lookout, 'o-gone', 'p1')?.rules).toContain('CR 702.18a');
  });
});

describe('the keyword provider answers each rule it took over from milestone 4 (provider level, WP0 review)', () => {
  it('CR 702.16f: a creature with protection can\'t be blocked by a creature that has the quality; one that doesn\'t has no problem', () => {
    const s = scenario(['Black Knight', 'White Knight', 'Grizzly Bears'], { p1: { battlefield: ['Black Knight'] }, p2: { battlefield: ['White Knight', 'Grizzly Bears'] } });
    const attacker = find(s, 'Black Knight', 'battlefield'); // protection from white
    expect(hookpoints.canBlock(g(s), find(s, 'White Knight', 'battlefield'), attacker)?.rules).toContain('CR 702.16f');
    expect(hookpoints.canBlock(g(s), find(s, 'Grizzly Bears', 'battlefield'), attacker)).toBeNull();
  });

  it('CR 702.16b: protection stops a source with the quality from targeting; another source may', () => {
    const s = scenario(['White Knight', 'Black Knight', 'Grizzly Bears'], { p1: { battlefield: ['Black Knight', 'Grizzly Bears'] }, p2: { battlefield: ['White Knight'] } });
    const knight = find(s, 'White Knight', 'battlefield'); // protection from black
    expect(hookpoints.canBeTargeted(g(s), knight, find(s, 'Black Knight', 'battlefield'), 'p1')?.rules).toContain('CR 702.16b');
    expect(hookpoints.canBeTargeted(g(s), knight, find(s, 'Grizzly Bears', 'battlefield'), 'p1')).toBeNull();
  });

  it('CR 702.16c: protection stops an Aura of the quality from being attached; CR 702.16d: the same for an Equipment', () => {
    const blade = synth({ name: 'Test Dark Blade', cost: '{B}', type: 'Artifact — Equipment', abilities: [] });
    const s = scenario(['White Knight', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears', 'Test Dark Blade'] }, p2: { battlefield: ['White Knight'] }, defs: [blade] });
    const knight = find(s, 'White Knight', 'battlefield'); // protection from black
    const bladeId = find(s, 'Test Dark Blade', 'battlefield');
    expect(getChars(s, bladeId).colors).toEqual(['B']);
    expect(hookpoints.canAttach(g(s), bladeId, knight)?.rules).toContain('CR 702.16d');
    expect(hookpoints.canAttach(g(s), bladeId, find(s, 'Grizzly Bears', 'battlefield'))).toBeNull();
    const aura = scenario(['Black Knight', 'Pacifism'], { p1: { hand: ['Pacifism'] }, p2: { battlefield: ['Black Knight'] } }); // protection from white
    expect(hookpoints.canAttach(g(aura), find(aura, 'Pacifism', 'hand'), find(aura, 'Black Knight', 'battlefield'))?.rules).toContain('CR 702.16c');
  });

  it('CR 702.20b, 702.10b, 702.8a: vigilance, haste and flash answer for real creatures and only for them', () => {
    const s = scenario(['Alpine Watchdog', 'Raging Goblin', 'Ambush Viper', 'Grizzly Bears'], { p1: { battlefield: ['Alpine Watchdog', 'Raging Goblin', 'Ambush Viper', 'Grizzly Bears'] } });
    const ask = (name: string) => {
      const id = find(s, name, 'battlefield');
      const c = getChars(s, id);
      return [hookpoints.attackTaps(g(s), id, 'p1', c), hookpoints.summoningSick(g(s), id, 'p1', c), hookpoints.castsAsInstant(g(s), id, 'p1', c)];
    };
    expect(ask('Alpine Watchdog')).toEqual([false, true, false]); // vigilance
    expect(ask('Raging Goblin')).toEqual([true, false, false]); // haste
    expect(ask('Ambush Viper')).toEqual([true, true, true]); // flash
    expect(ask('Grizzly Bears')).toEqual([true, true, false]);
  });

  it('CR 702.14c: landwalk: the attacker can\'t be blocked while the defending player controls a land of that type', () => {
    const walk = scenario(['Bog Raiders', 'Grizzly Bears', 'Swamp'], { p1: { battlefield: ['Bog Raiders'] }, p2: { battlefield: ['Grizzly Bears', 'Swamp'] } });
    expect(hookpoints.canBlock(g(walk), find(walk, 'Grizzly Bears', 'battlefield'), find(walk, 'Bog Raiders', 'battlefield'))?.rules).toContain('CR 702.14c');
    const open = scenario(['Bog Raiders', 'Grizzly Bears'], { p1: { battlefield: ['Bog Raiders'] }, p2: { battlefield: ['Grizzly Bears'] } });
    expect(hookpoints.canBlock(g(open), find(open, 'Grizzly Bears', 'battlefield'), find(open, 'Bog Raiders', 'battlefield'))).toBeNull();
  });
});
