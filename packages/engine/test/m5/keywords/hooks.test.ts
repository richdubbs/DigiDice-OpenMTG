/**
 * keywords/hooks (design 7.3, WP3): one module per keyword, a dispatcher that asks only the keywords the objects have, the milestone 4 order of reasons, and one
 * scenario per hook of the table in 7.3 that is wired to a hookpoint. (The end-to-end combat, targeting and attachment suites of milestone 4 run through the same
 * provider and stay green; these tests pin the hook layer itself.)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { HOOK_IMPLS, HOOK_ORDER, keywordProvider } from '../../../src/keywords/hooks';
import { cached, charsOfId } from '../../../src/keywords/hooks/common';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { keywordRegistry, KeywordRegistryError } from '../../../src/keywords/registry';
import { HOOK_NAMES, type HookName, type KeywordDefData, type KeywordHooks } from '../../../src/keywords/types';
import { find, keyword, scenario, synth, withStatics } from '../helpers';

const g = (s: GameState) => gameOf(s);
const impl = (kw: string): Partial<KeywordHooks> => HOOK_IMPLS[kw]!;
const oracle = (o: Partial<OracleCard> & { name: string }): CardDef => compileCard({ layout: 'normal', oracle_text: '', ...o } as OracleCard);
const rules = (d: { rules: string[] } | null): string[] => d?.rules ?? [];

/** The data files and the code agree on which keyword has which hook, and the registry knows the implementations. */
describe('data <-> code coherence (design 7.1.6: no keyword is silently ignored)', () => {
  const hooked = keywordRegistry.all().filter((d) => d.hooks !== undefined && d.hooks.length > 0);

  it('every hook a data file lists is implemented by that keyword, and every implemented hook is listed in its data file', () => {
    for (const d of hooked) {
      for (const h of d.hooks!) expect(typeof impl(d.name)[h], `${d.name} lists ${h}`).toBe('function');
    }
    for (const [name, hooks] of Object.entries(HOOK_IMPLS)) {
      const listed = keywordRegistry.get(name)?.hooks ?? [];
      expect(Object.keys(hooks).sort(), name).toEqual([...listed].sort());
    }
  });

  it('the dispatch order lists exactly the keywords that implement each hook, once each (a hook added to a keyword without the order is a failing test, not a dead hook)', () => {
    for (const hook of HOOK_NAMES) {
      const implementers = Object.entries(HOOK_IMPLS).filter(([, h]) => typeof h[hook] === 'function').map(([n]) => n).sort();
      expect([...(HOOK_ORDER[hook] ?? [])].sort(), hook).toEqual(implementers);
      expect(new Set(HOOK_ORDER[hook] ?? []).size, hook).toBe((HOOK_ORDER[hook] ?? []).length);
    }
  });

  it('the registry knows the implementations once the provider is loaded (KeywordDef.hookImpl)', () => {
    for (const [name, hooks] of Object.entries(HOOK_IMPLS)) expect(keywordRegistry.get(name)!.hookImpl, name).toBe(hooks);
    expect(keywordRegistry.get('trample')!.hookImpl).toEqual({}); // a flag keyword has no hook
  });

  it('binding hooks to a keyword the library does not have is a programming error', () => {
    expect(() => keywordRegistry.bindHooks({ blorp: {} })).toThrow(KeywordRegistryError);
  });

  it('only implemented keywords have hooks (convoke included: WP7 calls paymentOptions in casting), and the hooks that no hookpoint routes yet are implemented by nobody (the damage, destruction and SBA code reads those keywords as flags)', () => {
    for (const d of hooked) expect(d.status, d.name).toBe('implemented');
    const unrouted: HookName[] = ['combatDamageSteps', 'assignCombatDamage', 'onDamageDealt', 'indestructible'];
    for (const h of unrouted) expect(Object.values(HOOK_IMPLS).filter((x) => x[h] !== undefined), h).toEqual([]);
  });

  it('the provider is the keyword provider of the hookpoints', () => {
    expect(keywordProvider.name).toBe('keywords');
  });
});

describe('the dispatcher asks only the keywords that are present, in the order of milestone 4', () => {
  it('a creature without any hooked keyword asks no hook at all', () => {
    const s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const calls: string[] = [];
    const spies = Object.entries(HOOK_IMPLS).map(([name, hooks]) => {
      const saved = { ...hooks };
      for (const h of Object.keys(hooks) as (keyof KeywordHooks)[]) (hooks as Record<string, unknown>)[h] = (...a: unknown[]) => (calls.push(`${name}.${h}`), (saved[h] as (...x: unknown[]) => unknown)(...a));
      return { hooks, saved };
    });
    try {
      const bears = find(s, 'Grizzly Bears', 'battlefield');
      const giant = find(s, 'Hill Giant', 'battlefield');
      hookpoints.canAttack(g(s), bears, 'p2');
      hookpoints.canBlock(g(s), giant, bears);
      hookpoints.canBeTargeted(g(s), bears, giant, 'p2');
      hookpoints.canAttach(g(s), giant, bears);
      hookpoints.blockSetValid(g(s), bears, [giant]);
      expect(calls).toEqual([]);
      // ...and a flying attacker asks flying (and no keyword that is on neither object).
      const s2 = scenario(['Serra Angel', 'Hill Giant'], { p1: { battlefield: ['Serra Angel'] }, p2: { battlefield: ['Hill Giant'] } });
      hookpoints.canBlock(g(s2), find(s2, 'Hill Giant', 'battlefield'), find(s2, 'Serra Angel', 'battlefield'));
      expect(calls).toEqual(['flying.canBeBlocked']);
    } finally {
      for (const { hooks, saved } of spies) Object.assign(hooks, saved);
    }
  });

  it('CR 509.1b: a creature that breaks several evasion rules names the same first reason as milestone 4 did (flying, then fear); protection is named last', () => {
    const flyingFear = oracle({ name: 'Test Flying Fear', type_line: 'Creature — Wraith', mana_cost: '{B}', power: '1', toughness: '1', colors: ['B'], oracle_text: 'Flying, fear' });
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Flying Fear'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [flyingFear] });
    expect(rules(hookpoints.canBlock(g(s), find(s, 'Grizzly Bears', 'battlefield'), find(s, 'Test Flying Fear', 'battlefield')))).toContain('CR 702.9b'); // Bears: no flying/reach, not black
    const s2 = scenario(['Serra Angel', 'Black Knight'], { p1: { battlefield: ['Black Knight'] }, p2: { battlefield: ['Serra Angel'] } });
    expect(rules(hookpoints.canBlock(g(s2), find(s2, 'Serra Angel', 'battlefield'), find(s2, 'Black Knight', 'battlefield')))).toEqual(['CR 702.16f']); // pro-white: white blocker
  });

  it('the characteristics of an object are computed once per provider call and the cache never outlives the call', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const [a, b] = cached(() => [charsOfId(g(s), bears), charsOfId(g(s), bears)]);
    expect(a).toBe(b);
    expect(charsOfId(g(s), bears)).not.toBe(a); // outside a call: computed afresh
    expect(() => cached(() => { throw new Error('boom'); })).toThrow('boom');
    const [c, d] = cached(() => [charsOfId(g(s), bears), charsOfId(g(s), bears)]); // a failed call left no stale cache behind
    expect(c).toBe(d);
    expect(c).not.toBe(a);
    expect(charsOfId(g(s), 'p1')).toBeNull(); // a player is not an object
  });
});

describe('canAttack (CR 702.3b): defender', () => {
  const s = scenario(['Wall of Stone', 'Grizzly Bears'], { p1: { battlefield: ['Wall of Stone', 'Grizzly Bears'] } });
  const wall = find(s, 'Wall of Stone', 'battlefield');

  it('a creature with defender can\'t attack; one without can', () => {
    expect(rules(impl('defender').canAttack!(g(s), wall, 'p2'))).toEqual(['CR 702.3b']);
    expect(impl('defender').canAttack!(g(s), find(s, 'Grizzly Bears', 'battlefield'), 'p2')).toBeNull();
    expect(rules(hookpoints.canAttack(g(s), wall, 'p2'))).toEqual(['CR 702.3b']);
  });

  it('CR 609.4: "attack as though it didn\'t have defender" waives exactly this denial (and no other)', () => {
    expect(impl('defender').canAttack!(g(s), wall, 'p2')!.waivedBy).toEqual({ action: 'attackAsThoughNoDefender' });
    withStatics({ permits: (_g, q) => q.action === 'attackAsThoughNoDefender' && q.subject === wall }, () => {
      expect(hookpoints.canAttack(g(s), wall, 'p2')).toBeNull();
    });
  });
});

describe('canBeBlocked (CR 509.1b): the evasion keywords', () => {
  const blockBy = (attacker: string, blocker: string, extra: { p1?: string[]; p2?: string[]; defs?: CardDef[] } = {}) => {
    const s = scenario([attacker, blocker, ...(extra.p1 ?? []), ...(extra.p2 ?? [])], { p1: { battlefield: [attacker, ...(extra.p1 ?? [])] }, p2: { battlefield: [blocker, ...(extra.p2 ?? [])] }, ...(extra.defs ? { defs: extra.defs } : {}) });
    const a = find(s, attacker, 'battlefield', 'p1');
    const b = find(s, blocker, 'battlefield', 'p2');
    return { s, a, b, denial: hookpoints.canBlock(g(s), b, a) };
  };

  it('CR 702.9b, 702.17b: flying: only flying or reach can block; the flying hook alone answers', () => {
    const t = blockBy('Serra Angel', 'Hill Giant');
    expect(rules(t.denial)).toEqual(['CR 702.9b', 'CR 702.17b']);
    expect(t.denial!.waivedBy).toEqual({ action: 'blockAsThough', asThough: 'flying' });
    expect(rules(impl('flying').canBeBlocked!(g(t.s), t.a, t.b))).toEqual(['CR 702.9b', 'CR 702.17b']);
    expect(blockBy('Serra Angel', 'Giant Spider').denial).toBeNull(); // reach
    expect(blockBy('Hill Giant', 'Serra Angel').denial).toBeNull(); // a flyer may block anything
    expect(HOOK_IMPLS['reach']).toBeUndefined(); // reach is read by the flying hook, it has none of its own
  });

  it('CR 702.28b: shadow works in both directions', () => {
    expect(rules(blockBy('Soltari Foot Soldier', 'Grizzly Bears').denial)).toEqual(['CR 702.28b']);
    expect(rules(blockBy('Grizzly Bears', 'Soltari Foot Soldier').denial)).toEqual(['CR 702.28b']);
    expect(blockBy('Soltari Foot Soldier', 'Thalakos Sentry').denial).toBeNull();
    expect(blockBy('Grizzly Bears', 'Hill Giant').denial).toBeNull();
  });

  it('CR 702.31b: horsemanship', () => {
    expect(rules(blockBy('Shu Cavalry', 'Grizzly Bears').denial)).toEqual(['CR 702.31b']);
    expect(blockBy('Shu Cavalry', 'Wei Scout').denial).toBeNull();
  });

  it('CR 702.13b: intimidate: artifact creatures and creatures that share a color', () => {
    expect(rules(blockBy('Highborn Ghoul', 'Grizzly Bears').denial)).toEqual(['CR 702.13b']);
    expect(blockBy('Highborn Ghoul', 'Vampire Nighthawk').denial).toBeNull();
    expect(blockBy('Highborn Ghoul', 'Ornithopter').denial).toBeNull();
  });

  it('CR 702.36b: fear: artifact creatures and black creatures', () => {
    expect(rules(blockBy('Prickly Boggart', 'Serra Angel').denial)).toEqual(['CR 702.36b']);
    expect(blockBy('Prickly Boggart', 'Vampire Nighthawk').denial).toBeNull();
  });

  it('CR 702.118b: skulk: a blocker with greater power is refused', () => {
    expect(rules(blockBy('Furtive Homunculus', 'Hill Giant').denial)).toEqual(['CR 702.118b']);
    expect(blockBy('Furtive Homunculus', 'Grizzly Bears').denial).toBeNull();
  });

  it('CR 702.14c: landwalk: the defending player (the blocker\'s controller) controls a matching land', () => {
    expect(rules(blockBy('Bog Raiders', 'Grizzly Bears', { p2: ['Swamp'] }).denial)).toEqual(['CR 702.14c']);
    expect(blockBy('Bog Raiders', 'Grizzly Bears', { p2: ['Forest'] }).denial).toBeNull();
    expect(blockBy('Bog Raiders', 'Grizzly Bears', { p1: ['Swamp'] }).denial).toBeNull(); // the attacker's own land does not count
  });

  it('CR 702.16f: protection: the attacker can\'t be blocked by creatures with the quality; this denial is NOT waivable by a permission (it is a prohibition)', () => {
    const t = blockBy('Black Knight', 'Serra Angel');
    expect(rules(t.denial)).toEqual(['CR 702.16f']);
    expect(t.denial!.waivedBy).toBeUndefined();
    expect(blockBy('Black Knight', 'Hill Giant').denial).toBeNull();
    withStatics({ permits: () => true }, () => expect(hookpoints.canBlock(g(t.s), t.b, t.a)).not.toBeNull());
  });
});

describe('blockSetValid (CR 702.111b): menace', () => {
  const s = scenario(['Grizzly Bears', 'Hill Giant', 'Elephant-Rat'], { p1: { battlefield: ['Elephant-Rat'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] } });
  const rat = find(s, 'Elephant-Rat', 'battlefield');
  const bears = find(s, 'Grizzly Bears', 'battlefield');
  const giant = find(s, 'Hill Giant', 'battlefield');

  it('one blocker is not enough; none or two are fine; a creature without menace is unaffected', () => {
    expect(rules(impl('menace').blockSetValid!(g(s), rat, [bears]))).toEqual(['CR 702.111b']);
    expect(rules(hookpoints.blockSetValid(g(s), rat, [bears]))).toEqual(['CR 702.111b']);
    expect(hookpoints.blockSetValid(g(s), rat, [bears, giant])).toBeNull();
    expect(hookpoints.blockSetValid(g(s), rat, [])).toBeNull();
    expect(hookpoints.blockSetValid(g(s), bears, [giant])).toBeNull();
  });
});

describe('attackTaps, summoningSick, castTiming: vigilance, haste, flash (CR 702.20b, 702.10b, 702.8a)', () => {
  const s = scenario(['Alpine Watchdog', 'Raging Goblin', 'Ambush Viper', 'Grizzly Bears'], { p1: { battlefield: ['Alpine Watchdog', 'Raging Goblin', 'Grizzly Bears'], hand: ['Ambush Viper'] } });
  const id = (n: string, zone: 'battlefield' | 'hand' = 'battlefield') => find(s, n, zone, 'p1');
  const chars = (n: string, zone: 'battlefield' | 'hand' = 'battlefield') => getChars(s, id(n, zone));

  it('vigilance: attacking doesn\'t cause the creature to tap', () => {
    expect(impl('vigilance').attackTaps!(g(s), id('Alpine Watchdog'), 'p1', chars('Alpine Watchdog'))).toBe(false);
    expect(hookpoints.attackTaps(g(s), id('Alpine Watchdog'), 'p1', chars('Alpine Watchdog'))).toBe(false);
    expect(hookpoints.attackTaps(g(s), id('Grizzly Bears'), 'p1', chars('Grizzly Bears'))).toBe(true);
    expect(keywordProvider.attackTaps!(g(s), id('Grizzly Bears'), 'p1', chars('Grizzly Bears'))).toBeUndefined(); // no opinion
  });

  it('haste: the creature is not summoning sick', () => {
    expect(impl('haste').summoningSick!(g(s), id('Raging Goblin'), 'p1', chars('Raging Goblin'))).toBe(false);
    expect(hookpoints.summoningSick(g(s), id('Raging Goblin'), 'p1', chars('Raging Goblin'))).toBe(false);
    expect(hookpoints.summoningSick(g(s), id('Grizzly Bears'), 'p1', chars('Grizzly Bears'))).toBe(true);
    expect(keywordProvider.summoningSick!(g(s), id('Grizzly Bears'), 'p1', chars('Grizzly Bears'))).toBeUndefined();
  });

  it('flash: the card may be cast any time its owner could cast an instant (it functions in the hand)', () => {
    expect(impl('flash').castTiming!(g(s), id('Ambush Viper', 'hand'), 'p1', chars('Ambush Viper', 'hand'))).toBe('instant');
    expect(hookpoints.castsAsInstant(g(s), id('Ambush Viper', 'hand'), 'p1', chars('Ambush Viper', 'hand'))).toBe(true);
    expect(impl('flash').castTiming!(g(s), id('Grizzly Bears'), 'p1', chars('Grizzly Bears'))).toBeNull();
    expect(hookpoints.castsAsInstant(g(s), id('Grizzly Bears'), 'p1', chars('Grizzly Bears'))).toBe(false);
  });
});

describe('canBeTargetedBy (CR 115.1): shroud, hexproof, protection answer separately and cite their own rule', () => {
  const white = oracle({ name: 'Test Hexproof From White', type_line: 'Creature — Test', mana_cost: '{1}{G}', power: '2', toughness: '2', colors: ['G'], oracle_text: 'Hexproof from white' });
  const s = scenario(['Gladecover Scout', 'Elvish Lookout', 'White Knight', 'Serra Angel', 'Vampire Nighthawk', 'Grizzly Bears'], {
    p1: { battlefield: ['Serra Angel', 'Vampire Nighthawk', 'Grizzly Bears'] },
    p2: { battlefield: ['Gladecover Scout', 'Elvish Lookout', 'White Knight', 'Test Hexproof From White'] },
    defs: [white],
  });
  const at = (n: string, o: 'p1' | 'p2') => find(s, n, 'battlefield', o);
  const scout = at('Gladecover Scout', 'p2');
  const lookout = at('Elvish Lookout', 'p2');
  const knight = at('White Knight', 'p2'); // protection from black
  const hexWhite = at('Test Hexproof From White', 'p2');
  const angel = at('Serra Angel', 'p1');
  const nighthawk = at('Vampire Nighthawk', 'p1');

  it('CR 702.11b: hexproof stops the opponent\'s sources, not the controller\'s own', () => {
    expect(rules(hookpoints.canBeTargeted(g(s), scout, angel, 'p1'))).toEqual(['CR 115.1', 'CR 702.11b']);
    expect(rules(impl('hexproof').canBeTargetedBy!(g(s), scout, angel, 'p1'))).toEqual(['CR 115.1', 'CR 702.11b']);
    expect(hookpoints.canBeTargeted(g(s), scout, null, 'p2')).toBeNull();
    expect(impl('shroud').canBeTargetedBy!(g(s), scout, angel, 'p1')).toBeNull(); // the shroud hook has nothing to say about a hexproof creature
  });

  it('CR 702.11d: hexproof from a quality stops only sources with the quality', () => {
    expect(rules(hookpoints.canBeTargeted(g(s), hexWhite, angel, 'p1'))).toContain('CR 702.11b');
    expect(hookpoints.canBeTargeted(g(s), hexWhite, nighthawk, 'p1')).toBeNull();
    expect(hookpoints.canBeTargeted(g(s), hexWhite, null, 'p1')).toBeNull(); // unknown source: only plain hexproof can stop it
  });

  it('CR 702.18a: shroud stops everyone, its controller included; a source that has left the game is read from last known information', () => {
    expect(rules(hookpoints.canBeTargeted(g(s), lookout, null, 'p2'))).toEqual(['CR 115.1', 'CR 702.18a']);
    expect(rules(impl('shroud').canBeTargetedBy!(g(s), lookout, angel, 'p1'))).toEqual(['CR 115.1', 'CR 702.18a']);
    expect(rules(hookpoints.canBeTargeted(g(s), lookout, 'o-gone', 'p1'))).toContain('CR 702.18a');
  });

  it('CR 702.16b: protection stops a source with the quality; another source may target', () => {
    expect(rules(hookpoints.canBeTargeted(g(s), knight, nighthawk, 'p1'))).toEqual(['CR 115.1', 'CR 702.16b']);
    expect(rules(impl('protection').canBeTargetedBy!(g(s), knight, nighthawk, 'p1'))).toEqual(['CR 115.1', 'CR 702.16b']);
    expect(hookpoints.canBeTargeted(g(s), knight, angel, 'p1')).toBeNull();
    expect(impl('hexproof').canBeTargetedBy!(g(s), knight, nighthawk, 'p1')).toBeNull();
  });

  it('the keywords function on the battlefield only (CR 113.6) and players have none yet', () => {
    expect(hookpoints.canBeTargeted(g(s), 'p2', angel, 'p1')).toBeNull();
    const s2 = scenario(['Gladecover Scout'], { p2: { graveyard: ['Gladecover Scout'] } });
    expect(hookpoints.canBeTargeted(g(s2), find(s2, 'Gladecover Scout', 'graveyard', 'p2'), null, 'p1')).toBeNull();
  });
});

describe('canBeEnchantedBy, canBeEquippedBy (CR 702.16c-d): protection stops Auras and Equipment', () => {
  const blackBlade = oracle({ name: 'Test Black Blade', type_line: 'Artifact — Equipment', mana_cost: '{1}{B}', colors: ['B'], oracle_text: 'Equip {1}' });
  const s = scenario(['White Knight', 'Black Knight', 'Pacifism', 'Bonesplitter'], {
    p1: { battlefield: ['White Knight', 'Black Knight', 'Bonesplitter', 'Test Black Blade'], hand: ['Pacifism'] }, // an Aura on the battlefield would be put into the graveyard by CR 704.5m
    defs: [blackBlade],
  });
  const id = (n: string) => find(s, n, n === 'Pacifism' ? 'hand' : 'battlefield', 'p1');

  it('an Aura asks the enchant hooks: Black Knight (protection from white) can\'t be enchanted by white Pacifism', () => {
    expect(rules(hookpoints.canAttach(g(s), id('Pacifism'), id('Black Knight')))).toEqual(['CR 702.16c', 'CR 702.16d']);
    expect(rules(impl('protection').canBeEnchantedBy!(g(s), id('Pacifism'), id('Black Knight')))).toEqual(['CR 702.16c', 'CR 702.16d']);
    expect(hookpoints.canAttach(g(s), id('Pacifism'), id('White Knight'))).toBeNull(); // pro-black doesn't care about a white Aura
  });

  it('Equipment asks the equip hooks: White Knight (protection from black) can\'t be equipped with a black Equipment, a colorless one is fine', () => {
    expect(rules(hookpoints.canAttach(g(s), id('Test Black Blade'), id('White Knight')))).toEqual(['CR 702.16c', 'CR 702.16d']);
    expect(rules(impl('protection').canBeEquippedBy!(g(s), id('Test Black Blade'), id('White Knight')))).toEqual(['CR 702.16c', 'CR 702.16d']);
    expect(hookpoints.canAttach(g(s), id('Bonesplitter'), id('White Knight'))).toBeNull();
    expect(hookpoints.canAttach(g(s), id('Test Black Blade'), id('Black Knight'))).toBeNull();
  });
});

describe('paymentOptions (CR 702.51a): convoke', () => {
  const convoker = (): CardDef => synth({ name: 'Test Convoke', cost: '{4}{G}', type: 'Sorcery', abilities: [keyword('convoke')] });
  const board = (opts: { tappedAngel?: boolean; p2Bears?: boolean } = {}) =>
    scenario(['Grizzly Bears', 'Serra Angel', 'Vampire Nighthawk'], {
      p1: { hand: ['Test Convoke'], battlefield: ['Grizzly Bears', opts.tappedAngel ? { name: 'Serra Angel', tapped: true } : 'Serra Angel'] },
      p2: { battlefield: opts.p2Bears ? ['Vampire Nighthawk'] : [] },
      defs: [convoker()],
    });

  it('describes the capacity: how many untapped creatures can pay for generic mana and which colors they can pay for', () => {
    const s = board();
    const options = hookpoints.paymentOptions(g(s), find(s, 'Test Convoke', 'hand', 'p1'), 'p1');
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ key: 'convoke', reduces: { generic: 2, colors: ['W', 'G'] }, cost: { other: [{ kind: 'tapUntapped', count: 'any' }] } });
  });

  it('tapped creatures and the opponent\'s creatures are not counted; with none, there is no option', () => {
    const s = board({ tappedAngel: true, p2Bears: true });
    expect(hookpoints.paymentOptions(g(s), find(s, 'Test Convoke', 'hand', 'p1'), 'p1')[0]!.reduces).toEqual({ generic: 1, colors: ['G'] });
    const empty = scenario([], { p1: { hand: ['Test Convoke'] }, defs: [convoker()] });
    expect(hookpoints.paymentOptions(g(empty), find(empty, 'Test Convoke', 'hand', 'p1'), 'p1')).toEqual([]);
  });

  it('a spell without convoke has no payment option', () => {
    const s = scenario(['Grizzly Bears'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Grizzly Bears'] } });
    expect(hookpoints.paymentOptions(g(s), find(s, 'Grizzly Bears', 'hand', 'p1'), 'p1')).toEqual([]);
  });
});

describe('data of a keyword whose data file lists readers points at code that exists', () => {
  it('every hooked keyword names the hookpoint call-site that reaches it', () => {
    const data = (n: string): KeywordDefData => keywordRegistry.get(n)!;
    for (const d of keywordRegistry.all().filter((x) => (x.hooks ?? []).length > 0 && x.status === 'implemented')) expect(data(d.name).readers!.length, d.name).toBeGreaterThan(0);
  });
});
