/**
 * WP11 review: "can't" effects (CR 614.17, 101.2) and the rule hooks at the pipeline's call sites (design 9.4). The statics provider is WP16's; this file fakes
 * it (as forbidden.test.ts does): `staticEffectsFor` answers the restrictions listed in RULES, and RULE_HOOK_ACTIONS says which actions are wired.
 *   - (WP31: a restriction's `other` filter, read with "you" = the restriction's controller (CR 109.5), is statics/hooks.ts's evaluation now; those two tests
 *     run with real static abilities in test/m5/rulehooks/wp31-pipeline.test.ts)
 *   - the final, modified event is checked too (CR 614.6: an instruction that can't be carried out is ignored);
 *   - a destruction or a move that did not happen is not reported as one (rules/destroy.ts, the state-based actions, a resolving permanent spell, CR 608.3e);
 *   - "damage can't be prevented" (preventDamage, CR 615.12), "can't be regenerated" (beRegenerated, CR 701.19c), "can't pay life" (payLife, CR 119.8).
 */
import { describe, expect, it, vi } from 'vitest';
import type { GameState, RestrictionDef } from '../../../src/index';
import type { RuleQuery } from '../../../src/statics/api';

/** The restrictions the fake provider answers: for each query, those whose `when` accepts it. */
const RULES: { when: (s: GameState, q: RuleQuery) => boolean; def: RestrictionDef }[] = [];

vi.mock('../../../src/statics/hooks', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/statics/hooks')>();
  const wired = ['receiveDamage', 'dealDamage', 'leave', 'enter', 'beExiled', 'beDestroyed', 'preventDamage', 'beRegenerated', 'payLife'];
  return {
    ...orig,
    RULE_HOOK_ACTIONS: Object.fromEntries(wired.map((a) => [`rule:${a}`, true])),
    staticEffectsFor: (s: GameState, q: RuleQuery): RestrictionDef[] => RULES.filter((r) => r.def.action === q.action && r.when(s, q)).map((r) => r.def),
    // WP31: the call-sites ask `ruleDenial` (the full evaluator), so the fake answers that question too.
    ruleDenial: (s: GameState, q: RuleQuery) => (wired.includes(q.action) && RULES.some((r) => r.def.action === q.action && r.when(s, q)) ? { message: 'a test restriction', rules: ['CR 614.17'] } : null),
  };
});

const { destroy, addRegenerationShield } = await import('../../../src/rules/destroy');
const { dealDamage } = await import('../../../src/rules/damage');
const { act, castAuto, find, inGraveyard, logHas, pass, passBoth, scenario, tweak } = await import('../helpers');
const { entersSelf, permanent, run, shieldRecord, staticAbility } = await import('./support');

const named = (name: string) => (s: GameState, q: RuleQuery): boolean => s.defs[s.objects[q.subject]?.defId ?? '']?.name === name;
const cant = (action: RestrictionDef['action'], when: (s: GameState, q: RuleQuery) => boolean, extra: Partial<RestrictionDef> = {}): void => {
  RULES.length = 0;
  RULES.push({ when, def: { s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action, ...extra } });
};

const board = (): GameState => scenario(['Hill Giant', 'Craw Wurm', 'Grizzly Bears'], { p1: { battlefield: ['Craw Wurm'] }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] } });

describe('CR 614.6, 614.17: the modified event is checked as well', () => {
  it('an allowed move that a replacement turns into an exile that can\'t happen is not carried out (and it is not "destroyed")', () => {
    const pendulum = permanent('Test Pendulum', 'Creature — Test', [staticAbility('If ~ would be put into a graveyard, exile it instead.', [
      { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } } },
    ])], { pt: ['1', '1'] });
    const s = scenario([], { p1: { battlefield: ['Test Pendulum'] }, defs: [pendulum] });
    cant('beExiled', named('Test Pendulum'));
    const id = find(s, 'Test Pendulum', 'battlefield');
    const r = run(s, (g) => destroy(g, id));
    expect(r.g.s.objects[id]?.zone).toBe('battlefield');
    expect(r.g.s.zones.exile).toEqual([]);
    expect(r.result).toBe('none');
    expect(logHas(r.g.s, /Test Pendulum is destroyed/)).toBe(false);
  });
});

describe('CR 614.17: a destruction or a move that did not happen is not reported as one', () => {
  it('CR 704.5g: a creature with lethal damage that can\'t leave the battlefield: destroy answers none, and the game goes on', () => {
    cant('leave', named('Hill Giant'));
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const r = run(s0, (g) => destroy(g, giant, { reason: 'lethal damage' }));
    expect(r.result).toBe('none');
    expect(logHas(r.g.s, /Hill Giant is destroyed/)).toBe(false);
    const hurt = tweak(s0, (t) => { t.objects[giant]!.damage = 5; });
    const after = pass(hurt); // the state-based actions see it every time, but nothing happens: no endless loop
    expect(after.objects[giant]?.zone).toBe('battlefield');
  });

  it('CR 704.5f: a 0-toughness creature that can\'t leave the battlefield stays, and the game goes on', () => {
    cant('leave', named('Hill Giant'));
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const weak = tweak(s0, (t) => { t.continuousEffects.push({ id: 'e1', source: null, sourceName: 'Test', controller: 'p1', timestamp: 900, startedTurn: 1, duration: { d: 'endOfTurn' }, effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] }, mods: [{ layer: '7c', power: -3, toughness: -3 }] } } as never); });
    const after = pass(weak);
    expect(after.objects[giant]?.zone).toBe('battlefield');
    expect(logHas(after, /Hill Giant is put into its owner's graveyard/)).toBe(false);
  });

  it('CR 608.3e: a permanent spell that can\'t enter the battlefield is put into its owner\'s graveyard', () => {
    cant('enter', named('Grizzly Bears'));
    const s0 = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    const s = passBoth(castAuto(s0, 'Grizzly Bears'));
    expect(s.zones.stack).toEqual([]);
    expect(inGraveyard(s, 'Grizzly Bears', 'p1')).toBe(true);
    expect(logHas(s, /Grizzly Bears resolves and enters the battlefield/)).toBe(false);
  });
});

describe('design 9.4: the rule hooks at the pipeline\'s call sites', () => {
  it('CR 615.12: "damage can\'t be prevented" (preventDamage): a prevention shield prevents nothing and is not reduced', () => {
    const s0 = board();
    const [wurm, giant] = [find(s0, 'Craw Wurm', 'battlefield'), find(s0, 'Hill Giant', 'battlefield')];
    cant('preventDamage', named('Hill Giant'));
    const s = tweak(s0, (t) => {
      t.continuousEffects.push(shieldRecord('e90', { s: 'replace', replaces: { ev: 'damage', recipient: { object: { is: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] } } } }, body: { b: 'prevent', amount: 2 }, shield: { uses: 'all' } }));
    });
    const r = run(s, (g) => dealDamage(g, wurm, giant, 2));
    expect(r.result).toBe(2);
    expect(r.g.s.continuousEffects[0]).not.toHaveProperty('usesLeft');
  });

  it('CR 701.19c: "can\'t be regenerated" (beRegenerated): the regeneration shield is not applied', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    cant('beRegenerated', named('Hill Giant'));
    const s = run(s0, (g) => addRegenerationShield(g, giant)).g.s;
    const r = run(s, (g) => destroy(g, giant));
    expect(r.result).toBe('destroyed');
    expect(inGraveyard(r.g.s, 'Hill Giant', 'p2')).toBe(true);
  });

  it('CR 119.8, 614.17b: a player who can\'t pay life (payLife) is not asked to pay for a shock land; it enters tapped', () => {
    const land = permanent('Test Fountain', 'Land — Plains Island', [
      staticAbility('As ~ enters, you may pay 2 life. If you don\'t, it enters tapped.', [entersSelf({ tappedUnlessPay: { other: [{ kind: 'payLife', amount: 2 }] } })], { zone: ['stack', 'battlefield'] }),
    ]);
    RULES.length = 0;
    RULES.push({ when: (_s, q) => q.subject === 'p1', def: { s: 'restrict', subject: { ref: 'you' }, mode: 'cant', action: 'payLife' } });
    const s0 = scenario([], { p1: { hand: ['Test Fountain'] }, defs: [land] });
    const s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Fountain', 'hand') });
    expect(s.pending?.kind).toBe('priority');
    expect(s.objects[find(s, 'Test Fountain', 'battlefield')]!.tapped).toBe(true);
  });
});
