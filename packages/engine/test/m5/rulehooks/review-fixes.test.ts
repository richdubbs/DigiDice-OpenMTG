/**
 * WP16 review fixes: the filter forms the render gate accepts for "spells" and "abilities" (`stackKind`) work in the rule hooks; what the statics can't
 * evaluate inside a rule effect is a missing capability (fail closed, never a silent no-op); affinity counts only the caster's permanents (CR 702.41a);
 * permission fields the hooks don't implement are not advertised; "can't be the target" reads last known information and the spell or ability's
 * controller (CR 113.7a, 115.1); emerge uses the modified cost (CR 601.2f, 702.119a); the rule-effect memo sees token definitions added later (CR 111.4).
 */
import { describe, expect, it } from 'vitest';
import { cloneState, ENGINE_CAPABILITIES, missingCapabilities, renderGate, type AbilityDef, type CardDef, type GameState, type ObjectFilter } from '../../../src/index';
import { castCheck } from '../../../src/actions/cast';
import { landsAllowed } from '../../../src/actions/land';
import { Game } from '../../../src/core/game';
import { createToken, moveObject } from '../../../src/core/zones';
import { renderGateKeywordLine } from '../../../src/render/gate';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { targetOptions } from '../../../src/rules/targets';
import { additionalLandPlays, cantHappen, maxHandSize, RULE_HOOK_ACTIONS, UNWIRED_RULE_ACTIONS } from '../../../src/statics/hooks';
import { act, advanceTo, find, labels, legal, scenario, synth } from '../helpers';
import { alternativeCost, mana, staticAbility } from '../announce/support';
import {
  DEATH_RATTLE_ONI, EACH_PLAYER, ENCHANTMENT, FROGMITE, ORNITHOPTER, SELF, SORCERY, THALIA, VANILLA, YOU, affinityFor, cant, kw, permit, ruleMod, staticOf,
} from './fixtures';

const CTX = (name: string) => ({ selfNames: [name] });
const gate = (a: AbilityDef, text: string, name = 'Test Card'): boolean => renderGate(a, [text], CTX(name)).ok;
const missing = (a: AbilityDef): string[] => missingCapabilities(a, ENGINE_CAPABILITIES);
const g = (s: GameState) => gameOf(s);
const LANDS = ['Swamp', 'Swamp', 'Island', 'Island', 'Forest', 'Forest'];

function board(defs: CardDef[], p1: { battlefield?: string[]; hand?: string[] } = {}, p2: { battlefield?: string[]; hand?: string[] } = {}): GameState {
  return scenario(['Swamp', 'Island', 'Forest', 'Lightning Bolt', 'Mountain'], {
    defs, p1: { battlefield: [...LANDS, ...(p1.battlefield ?? [])], hand: p1.hand ?? [] }, p2: { battlefield: ['Mountain', ...(p2.battlefield ?? [])], hand: p2.hand ?? [] },
  });
}

const BLACK_SORCERY = synth({ name: 'Test Black Sorcery', cost: '{B}', type: 'Sorcery', abilities: [{ kind: 'manual', shape: 'spell', text: 'Do something.', reason: 'test' }] });
const BLACK_KNIGHT = VANILLA('Test Black Knight', ['2', '2']);
const blackKnight: CardDef = { ...BLACK_KNIGHT, faces: [{ ...BLACK_KNIGHT.faces[0]!, colors: ['B'], manaCost: [{ kind: 'colored', color: 'B' }, { kind: 'generic', amount: 1 }] }] };

describe('CR 115.1, 101.2: "This creature can\'t be the target of black spells." in the form the render gate accepts (stackKind: spell)', () => {
  const line = "This creature can't be the target of black spells.";
  const ability = staticOf(line, [cant(SELF, 'beTargeted', { other: { colors: ['B'], stackKind: 'spell' } })]);
  const warded = VANILLA('Test Warded', ['2', '2'], [ability]);

  it('the gate accepts it, it needs nothing the engine lacks, and the colors-only form reads "black permanents" (rejected)', () => {
    expect(gate(ability, line, 'Test Warded')).toBe(true);
    expect(gate(staticOf(line, [cant(SELF, 'beTargeted', { other: { colors: ['B'] } })]), line, 'Test Warded')).toBe(false);
    expect(missing(ability)).toEqual([]);
  });

  it('a black spell (in the hand while castCheck asks, then on the stack) can\'t target it; a black permanent\'s ability and a red spell can', () => {
    const s = board([warded, BLACK_SORCERY, blackKnight], { battlefield: ['Test Warded', 'Test Black Knight'], hand: ['Test Black Sorcery', 'Lightning Bolt'] });
    const target = find(s, 'Test Warded', 'battlefield');
    expect(hookpoints.canBeTargeted(g(s), target, find(s, 'Test Black Sorcery', 'hand'), 'p1')?.rules).toEqual(expect.arrayContaining(['CR 115.1', 'CR 101.2']));
    const game = new Game(cloneState(s));
    const onStack = moveObject(game, find(s, 'Test Black Sorcery', 'hand'), 'stack', { controller: 'p1', cause: 'cast' })!;
    game.obj(onStack).stack = { kind: 'spell', targets: [], costsPaid: {} };
    expect(hookpoints.canBeTargeted(g(game.s), target, onStack, 'p1')).not.toBeNull();
    expect(hookpoints.canBeTargeted(g(s), target, find(s, 'Test Black Knight', 'battlefield'), 'p1')).toBeNull(); // an ability, not a spell
    expect(hookpoints.canBeTargeted(g(s), target, find(s, 'Lightning Bolt', 'hand'), 'p1')).toBeNull();
  });
});

describe('CR 115.1, 113.7a: "can\'t be the target" reads the source\'s last known information and the controller of the spell or ability', () => {
  const ward = staticOf("This creature can't be the target of black spells or abilities from black sources.", [cant(SELF, 'beTargeted', { other: { colors: ['B'] } })]);
  const warded = VANILLA('Test Warded', ['2', '2'], [ward]);

  it('an ability whose black source has left the battlefield (a dies trigger) still can\'t target it', () => {
    const s = board([warded, blackKnight], { battlefield: ['Test Warded'] }, { battlefield: ['Test Black Knight'] });
    const target = find(s, 'Test Warded', 'battlefield');
    const knight = find(s, 'Test Black Knight', 'battlefield');
    expect(hookpoints.canBeTargeted(g(s), target, knight, 'p2')).not.toBeNull();
    const game = new Game(cloneState(s));
    moveObject(game, knight, 'graveyard', { cause: 'test' });
    expect(game.s.objects[knight]).toBeUndefined();
    expect(hookpoints.canBeTargeted(g(game.s), target, knight, 'p2')?.rules).toContain('CR 115.1');
  });

  it('"spells or abilities your opponents control" is matched against the controller of the spell or ability, also when its source is gone', () => {
    const line = "You can't be the target of spells or abilities your opponents control.";
    const filter: ObjectFilter = { controller: 'opponent', anyOf: [{ stackKind: 'spell' }, { stackKind: 'ability' }] };
    const sanctity = staticOf(line, [cant(YOU, 'beTargeted', { other: filter })]);
    expect(gate(sanctity, line)).toBe(true);
    expect(missing(sanctity)).toEqual([]);
    const s = board([ENCHANTMENT('Test Sanctity', [sanctity]), blackKnight], { battlefield: ['Test Sanctity'], hand: ['Lightning Bolt'] }, { battlefield: ['Test Black Knight'], hand: ['Lightning Bolt'] });
    const spec = { id: 't0', kind: 'anyTarget' as const, min: 1, max: 1, text: 'any target' };
    expect(targetOptions(s, spec, 'p2', find(s, 'Lightning Bolt', 'hand', 'p2')).players).toEqual(['p2']);
    expect(targetOptions(s, spec, 'p1', find(s, 'Lightning Bolt', 'hand', 'p1')).players).toEqual(['p1', 'p2']);
    const knight = find(s, 'Test Black Knight', 'battlefield');
    expect(hookpoints.canBeTargeted(g(s), 'p1', knight, 'p2')).not.toBeNull();
    const game = new Game(cloneState(s));
    moveObject(game, knight, 'graveyard', { cause: 'test' });
    expect(hookpoints.canBeTargeted(g(game.s), 'p1', knight, 'p2')).not.toBeNull();
    expect(hookpoints.canBeTargeted(g(game.s), 'p1', knight, 'p1')).toBeNull(); // an ability p1 controls
  });
});

describe('CR 601.3, 601.3e: "can\'t cast creature spells" in each form the gate accepts (the spell is seen on the stack)', () => {
  const line = "Each player can't cast creature spells.";
  const forms: [string, ObjectFilter][] = [['types', { types: ['Creature'] }], ['zone: stack', { types: ['Creature'], zone: 'stack' }], ['stackKind: spell', { types: ['Creature'], stackKind: 'spell' }]];

  it.each(forms)('%s: accepted by the gate, nothing missing, and the creature is denied while the sorcery is not', (_n, other) => {
    const ability = staticOf(line, [cant(EACH_PLAYER, 'cast', { other })]);
    expect(gate(ability, line)).toBe(true);
    expect(missing(ability)).toEqual([]);
    const s = board([ENCHANTMENT('Test Ban', [ability]), VANILLA('Test Bears'), SORCERY('Test Sorcery')], { battlefield: ['Test Ban'], hand: ['Test Bears', 'Test Sorcery'] });
    const d = castCheck(s, 'p1', find(s, 'Test Bears', 'hand'));
    expect('denial' in d && d.denial.rules).toEqual(expect.arrayContaining(['CR 601.3', 'CR 101.2']));
    expect(legal(s, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Test Sorcery']);
  });
});

describe('CR 601.2f: "Noncreature spells cost {1} more to cast." with stackKind: spell (Thalia in the other gate-accepted form)', () => {
  const cost = { s: 'costMod' as const, applies: { spells: { stackKind: 'spell' as const, notTypes: ['Creature' as const] }, caster: 'any' as const }, change: { kind: 'increase' as const, generic: 1 } };
  const ability = staticOf('Noncreature spells cost {1} more to cast.', [cost], { zone: ['battlefield'] });

  it('accepted by the gate, nothing missing, and a sorcery costs {1} more while a creature does not', () => {
    expect(gate(ability, 'Noncreature spells cost {1} more to cast.')).toBe(true);
    expect(missing(ability)).toEqual([]);
    const thalia = synth({ name: 'Test Thalia', cost: '{1}{W}', type: 'Creature — Human Soldier', pt: ['2', '1'], abilities: [ability] });
    const two = scenario(['Island', 'Forest'], { defs: [thalia, SORCERY('Test Sorcery'), VANILLA('Test Bears')], p1: { battlefield: ['Test Thalia', 'Island', 'Island'], hand: ['Test Sorcery'] } });
    expect(legal(two, 'p1', 'cast')).toEqual([]);
    const three = scenario(['Island', 'Forest'], { defs: [thalia, SORCERY('Test Sorcery'), VANILLA('Test Bears')], p1: { battlefield: ['Test Thalia', 'Island', 'Island', 'Forest'], hand: ['Test Sorcery', 'Test Bears'] } });
    expect(legal(three, 'p1', 'cast').map((a) => a.label).sort()).toEqual(['Cast Test Bears', 'Cast Test Sorcery']);
  });

  it('"Creature spells cost {1} more to cast." with stackKind: Grizzly Bears needs three lands', () => {
    const more = staticOf('Creature spells cost {1} more to cast.', [{ s: 'costMod', applies: { spells: { types: ['Creature'], stackKind: 'spell' }, caster: 'any' }, change: { kind: 'increase', generic: 1 } }]);
    expect(gate(more, 'Creature spells cost {1} more to cast.')).toBe(true);
    const s = scenario(['Forest', 'Grizzly Bears'], { defs: [ENCHANTMENT('Test Tax', [more])], p1: { battlefield: ['Test Tax', 'Forest', 'Forest'], hand: ['Grizzly Bears'] } });
    expect(legal(s, 'p1', 'cast')).toEqual([]);
  });
});

describe('design 5.2: inside a rule effect, what the statics can\'t evaluate is a missing capability (fail closed, CR 402.2, 305.2, 613.11)', () => {
  const died = { ev: 'zoneChange' as const, subject: { types: ['Creature' as const] }, from: 'battlefield' as const, to: 'graveyard' as const };

  it('a history filter field, a history quantity in a rule modification and a history condition in a restriction are missing', () => {
    expect(missing(staticOf("Creatures that entered this turn can't attack.", [cant({ ref: 'each', filter: { types: ['Creature'], enteredThisTurn: true } }, 'attack')]))).toContain('rfilter:enteredThisTurn');
    // CLOUD std-ecl: a history count is evaluated by the statics now (statics/match.ts `happenedCount`, test/cloud/std-ecl), so the one still missing is a count of
    // the targets of a spell outside a cost
    const hand = staticOf('Your maximum hand size is equal to the number of creatures that died this turn.', [ruleMod('maxHandSize', { value: { q: 'happenedCount', event: died, scope: 'turn' } })]);
    expect(missing(hand)).not.toContain('rq:happenedCount');
    expect(missing(staticOf('Test', [permit(YOU, 'playLand', { count: { q: 'spellTargetCount' } })]))).toContain('rq:spellTargetCount');
    // FAST5X E9: a history condition is evaluated by the statics now (statics/match.ts `happened`), so a restriction's `when` with one is no longer missing
    expect(missing(staticOf("You can't lose the game if a creature died this turn.", [cant(YOU, 'lose', { when: { cond: 'happened', event: died, scope: 'turn' } })]))).not.toContain('rcond:happened');
  });

  it('what the statics do evaluate is advertised: the cost path\'s history count and the announced targets (Death-Rattle Oni, Fireball), stackKind, castFrom', () => {
    for (const a of DEATH_RATTLE_ONI.faces[0]!.abilities.filter((x) => x.kind === 'static')) expect(missing(a)).toEqual([]);
    for (const c of ['rfilter:stackKind', 'rfilter:castFrom', 'rfilter:types', 'rq:count', 'rq:cost.happenedCount', 'rq:cost.spellTargetCount', 'rcond:turnOf']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    for (const c of ['rfilter:enteredThisTurn', 'rfilter:targets', 'rq:spellTargetCount']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(false);
    expect(ENGINE_CAPABILITIES.has('rq:happenedCount')).toBe(true); // CLOUD std-ecl (statics/match.ts `happenedCount`)
    expect(ENGINE_CAPABILITIES.has('rcond:happened')).toBe(true); // FAST5X E9 (statics/match.ts `happened`)
  });

  it('at run time a "can\'t" whose filter can\'t be evaluated applies (fail closed) and says so', () => {
    const odd = ENCHANTMENT('Test Odd Ban', [staticOf("Players can't cast spells that target creatures.", [cant(EACH_PLAYER, 'cast', { other: { targets: { ref: 'each', filter: { types: ['Creature'] } } } })])]);
    const s = board([odd, SORCERY('Test Sorcery')], { battlefield: ['Test Odd Ban'], hand: ['Test Sorcery'] });
    const d = castCheck(s, 'p1', find(s, 'Test Sorcery', 'hand'));
    expect('denial' in d && d.denial.message).toMatch(/can't evaluate/);
    expect(cantHappen(s, { action: 'cast', subject: 'p1', other: find(s, 'Test Sorcery', 'hand') })).not.toBeNull();
  });

  it('maxHandSize and the land count are unchanged by a rule effect whose quantity is unknown (such a card is manual, above)', () => {
    const s = board([ENCHANTMENT('Test Odd Hand', [staticOf('Test', [ruleMod('maxHandSize', { value: { q: 'spellTargetCount' } })])])], { battlefield: ['Test Odd Hand'] });
    expect(maxHandSize(s, 'p1')).toBe(7);
  });
});

describe('CR 702.41a: affinity counts the artifacts its caster controls, with the filter the gate accepts ("Affinity for artifacts")', () => {
  const frogmite = synth({ name: 'Frogmite', cost: '{4}', type: 'Artifact Creature — Frog', pt: ['2', '2'], abilities: [kw('affinity', { text: 'Affinity for artifacts', filter: { types: ['Artifact'] } })] });

  it('the keyword line renders as Oracle prints it', () => {
    const a = frogmite.faces[0]!.abilities[0]! as Extract<AbilityDef, { kind: 'keyword' }>;
    expect(renderGateKeywordLine([a], ['Affinity for artifacts'], CTX('Frogmite')).ok).toBe(true);
    expect(FROGMITE.faces[0]!.abilities[0]).toEqual(a); // the fixture uses the same data
  });

  it('three opponent artifacts do not reduce the cost; three of the caster\'s own do', () => {
    const theirs = scenario(['Island'], { defs: [frogmite, ORNITHOPTER], p1: { hand: ['Frogmite'] }, p2: { battlefield: ['Ornithopter', 'Ornithopter', 'Ornithopter'] } });
    expect(legal(theirs, 'p1', 'cast')).toEqual([]);
    const mine = scenario(['Island'], { defs: [frogmite, ORNITHOPTER], p1: { battlefield: ['Ornithopter', 'Ornithopter', 'Ornithopter', 'Island'], hand: ['Frogmite'] } });
    expect(legal(mine, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Frogmite']);
    expect(affinityFor('Test', '{1}', 'Artifact').faces[0]!.abilities[0]).toMatchObject({ filter: { types: ['Artifact'] } });
  });
});

describe('CR 305.2, 601.3b: permission fields the hooks do not implement are not advertised and are not applied', () => {
  it('"You may play lands from your graveyard." (from) is missing and grants no extra land play', () => {
    const crucible = staticOf('You may play lands from your graveyard.', [permit(YOU, 'playLand', { from: 'graveyard' })]);
    expect(missing(crucible)).toContain('feature:permit.playLand.from');
    const s = board([ENCHANTMENT('Test Crucible', [crucible])], { battlefield: ['Test Crucible'] });
    expect(additionalLandPlays(s, 'p1')).toBe(0);
    expect(landsAllowed(s, 'p1')).toBe(1);
    expect(missing(staticOf('You may play an additional land on each of your turns.', [permit(YOU, 'playLand')]))).toEqual([]);
  });

  it('a price of a flash permission in a form other than "pay {N} more" (costChange without mana) is missing and gives no flash (FAST5 T56 runs only the fixed generic increase)', () => {
    const ghitu = staticOf('You may cast this spell as though it had flash if you pay {2} more to cast it.', [permit(YOU, 'haveFlash', { of: { self: true }, costChange: { kind: 'increase', generic: 2 } })], { zone: ['hand'] });
    expect(missing(ghitu)).toContain('feature:permit.haveFlash.costChange.form');
    const priced = staticOf('You may cast this spell as though it had flash if you pay {2} more to cast it.', [permit(YOU, 'haveFlash', { of: { self: true }, costChange: { kind: 'increase', mana: [{ kind: 'generic', amount: 2 }] } })], { zone: ['hand'] });
    expect(missing(priced)).toEqual([]);
    const card = synth({ name: 'Test Ghitu', cost: '{R}', type: 'Sorcery', abilities: [ghitu, { kind: 'manual', shape: 'spell', text: 'Do something.', reason: 'test' }] });
    const field = ENCHANTMENT('Test Field', [staticOf('You may cast sorcery spells as though they had flash if you pay {2} more.', [permit(YOU, 'haveFlash', { of: { types: ['Sorcery'] }, costChange: { kind: 'increase', generic: 2 } })])]);
    const s = advanceTo(scenario(['Mountain'], { defs: [card, field], p1: { battlefield: ['Test Field', 'Mountain', 'Mountain', 'Mountain'], hand: ['Test Ghitu'] } }), 1, 'beginCombat');
    expect(legal(s, 'p1', 'cast')).toEqual([]);
  });
});

describe('CR 303.4i: an Aura spell resolving onto a creature that can\'t be enchanted (WP31 wired core/resolve.ts; test/m5/rulehooks/wp31-handlers.test.ts)', () => {
  it('rule:beEnchanted and rule:beAttached are advertised now, like rule:beEquipped', () => {
    for (const a of ['beEnchanted', 'beAttached', 'beEquipped'] as const) {
      expect(Object.hasOwn(RULE_HOOK_ACTIONS, `rule:${a}`), a).toBe(true);
      expect(Object.hasOwn(UNWIRED_RULE_ACTIONS, a), a).toBe(false);
      expect(ENGINE_CAPABILITIES.has(`rule:${a}`)).toBe(true);
    }
  });
});

describe('CR 601.2f, 702.119a: emerge with a cost modifier in play (the sacrifice candidates are judged on the modified cost)', () => {
  const emerge = staticAbility('Emerge {3}', [alternativeCost('emerge', { mana: mana('{3}'), other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] })]);
  const horror = synth({ name: 'Test Horror', cost: '{6}{U}', type: 'Creature — Horror', pt: ['6', '6'], abilities: [emerge] });
  const squire = synth({ name: 'Test Squire', cost: '{W}', type: 'Creature — Human', pt: ['1', '2'], abilities: [] });
  const change = (kind: 'reduce' | 'increase', text: string) => ENCHANTMENT('Test Modifier', [staticOf(text, [{ s: 'costMod', applies: { spells: { types: ['Creature'] }, caster: 'you' }, change: { kind, generic: 1 } }])]);

  it('a reduction: {3} - 1 - 2 (Grizzly Bears) = {0} with no land; the listed cast is accepted and offers the Bears', () => {
    const s = scenario(['Grizzly Bears'], { defs: [horror, change('reduce', 'Creature spells you cast cost {1} less to cast.')], p1: { battlefield: ['Grizzly Bears', 'Test Modifier'], hand: ['Test Horror'] } });
    expect(labels(s, 'p1').filter((l) => l.startsWith('Cast'))).toEqual(['Cast Test Horror (emerge)']);
    const after = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Horror', 'hand'), method: 'emerge' });
    expect(after.pending).toMatchObject({ kind: 'chooseObjects', options: [find(s, 'Grizzly Bears', 'battlefield')] });
  });

  it('an increase: with two lands only the Bears leave the total payable ({3} + 1 - 2), not the mana value 1 creature', () => {
    const s = scenario(['Grizzly Bears', 'Island'], { defs: [horror, squire, change('increase', 'Creature spells you cast cost {1} more to cast.')], p1: { battlefield: ['Grizzly Bears', 'Test Squire', 'Test Modifier', 'Island', 'Island'], hand: ['Test Horror'] } });
    const after = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Horror', 'hand'), method: 'emerge' });
    expect(after.pending).toMatchObject({ kind: 'chooseObjects', options: [find(s, 'Grizzly Bears', 'battlefield')] });
  });
});

describe('CR 111.4, 611.3a: a token definition with a rule effect added later in the run is seen (the memo is not stale)', () => {
  it('a Bird token with "This creature can\'t block." can\'t block, also in a state cloned from that game', () => {
    const soldier = VANILLA('Test Soldier', ['1', '1']);
    const bird = VANILLA('Test Bird', ['1', '1'], [staticOf("This creature can't block.", [cant(SELF, 'block')])]);
    const s = scenario(['Grizzly Bears'], { p2: { battlefield: ['Grizzly Bears'] } });
    const game = new Game(cloneState(s));
    createToken(game, soldier, 'p1');
    const attacker = find(game.s, 'Grizzly Bears', 'battlefield');
    expect(cantHappen(game.s, { action: 'block', subject: attacker })).toBeNull(); // primes the memo with "no rule effects"
    const defsBefore = game.s.defs;
    const b = createToken(game, bird, 'p1')!; // WP11: createToken returns null when the pipeline stops it
    expect(game.s.defs).toBe(defsBefore); // the same object, mutated (Game.addDef copies once per run)
    expect(hookpoints.canBlock(g(game.s), b, attacker)?.rules).toContain('CR 509.1b');
    expect(hookpoints.canBlock(g(new Game(cloneState(game.s)).s), b, attacker)?.rules).toContain('CR 509.1b');
  });
});

describe('THALIA fixture still in the design 13.5 form', () => {
  it('renders as Oracle prints it', () => {
    const a = THALIA.faces[0]!.abilities[1]!;
    expect(gate(a, 'Noncreature spells cost {1} more to cast.', 'Thalia, Guardian of Thraben')).toBe(true);
  });
});
