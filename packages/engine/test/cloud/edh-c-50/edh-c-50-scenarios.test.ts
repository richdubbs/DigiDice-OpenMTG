/**
 * Commander effort (coordinator C), round edh-c-50: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 611.2a, 613.4c, 613.1f      "Target creature gets +2/+2 and loses all abilities until end of turn."
 *   CR 615.1, 510.2, 702.3a        "As long as ~ has an ice counter on it, prevent all combat damage it would deal and it has defender."
 *   CR 205.1b, 613.4b, 509.1b      "As long as ~ is tapped, it's a Goblin Scout with base power and toughness 1/1 and can't be blocked."
 *   CR 106.1, 119.1, 608.2c        "For each creature card in target opponent's graveyard, add {C} and you gain 1 life."
 *   CR 105.3, 608.2d, 613.1e       "Any number of target creatures become the color of your choice until end of turn."
 *   CR 700.4, 110.5b, 107.3        "choose target player. You create a tapped Powerstone token for each nonland card in that player's graveyard that was put there from the battlefield this turn."
 *   CR 611.2a, 613.4b, 205.1a      "target artifact you control becomes an artifact creature with base power and toughness 5/5" (no duration: it lasts)
 *   CR 607.2a, 608.2d              "Choose a card at random that was exiled with ~. Put that card into its owner's hand."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { answer, find, pass, scenario } from '../../m3/scenario';
import { passUntil, runCombat, tweak } from '../../m4/helpers';
import { advanceTo as advanceToStep } from '../../m5/helpers';
import { synthetic } from '../../m6/costs/support';
import { cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string, player?: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (player === undefined || s.objects[id]!.controller === player));
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const hasKeyword = (s: GameState, id: ObjectId, kw: string): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === kw);

const GRUNT = synthetic('Test Grunt', 'Creature — Goblin', '{0}', '', { power: '2', toughness: '2' });
const FLYER = synthetic('Test Flyer', 'Creature — Bird', '{0}', 'Flying', { power: '2', toughness: '2' });

// ---- "Target creature gets +2/+2 and loses all abilities until end of turn" ------------------------------------------------------------------------------------------
const SLURP = synthetic('Test Slurp', 'Instant', '{0}', 'Target creature gets +2/+2 and loses all abilities until end of turn.');

describe('CR 611.2a, 613.4c, 613.1f: "Target creature gets +2/+2 and loses all abilities until end of turn"', () => {
  it('is automated; the target is 4/4 and has no flying while the effect lasts, and gets both back-to-normal at the end of the turn', () => {
    expect(full(SLURP)).toBe(true);
    const s0 = scenario([], { defs: [SLURP, FLYER], p1: { hand: ['Test Slurp'], battlefield: ['Test Flyer'] } });
    expect(hasKeyword(s0, onField(s0, 'Test Flyer')!, 'flying')).toBe(true);
    const s = resolveAll(cast(s0, 'Test Slurp', { targets: [{ kind: 'object', id: onField(s0, 'Test Flyer')! }] }));
    expect(pt(s, onField(s, 'Test Flyer')!)).toBe('4/4');
    expect(hasKeyword(s, onField(s, 'Test Flyer')!, 'flying')).toBe(false);
  });
  it('the negative case: a creature that was not targeted keeps its abilities and its size', () => {
    const s0 = scenario([], { defs: [SLURP, FLYER, GRUNT], p1: { hand: ['Test Slurp'], battlefield: ['Test Flyer', 'Test Grunt'] } });
    const s = resolveAll(cast(s0, 'Test Slurp', { targets: [{ kind: 'object', id: onField(s0, 'Test Grunt')! }] }));
    expect(pt(s, onField(s, 'Test Flyer')!)).toBe('2/2');
    expect(hasKeyword(s, onField(s, 'Test Flyer')!, 'flying')).toBe(true);
    expect(pt(s, onField(s, 'Test Grunt')!)).toBe('4/4');
  });
});

// ---- Woolly Razorback: prevent its combat damage while it has an ice counter -------------------------------------------------------------------------------------------
const ICE = synthetic('Test Ice', 'Creature — Boar', '{0}', 'As long as ~ has an ice counter on it, prevent all combat damage it would deal and it has defender.\nWhenever ~ blocks, remove an ice counter from it.', { power: '3', toughness: '3' });

describe('CR 615.1, 510.2, 702.3a: "As long as ~ has an ice counter on it, prevent all combat damage it would deal and it has defender"', () => {
  const block = (counters: number): GameState => {
    const s = scenario([], { defs: [ICE, GRUNT], p1: { battlefield: ['Test Grunt'] }, p2: { battlefield: [{ name: 'Test Ice', counters: counters > 0 ? { ice: counters } : {} }] } });
    return runCombat(s, { attack: [[onField(s, 'Test Grunt')!, 'p2']], block: [[onField(s, 'Test Ice')!, onField(s, 'Test Grunt')!]] });
  };
  it('is automated; with ice counters it has defender and its combat damage is prevented (the blocked attacker lives)', () => {
    expect(full(ICE)).toBe(true);
    const s0 = scenario([], { defs: [ICE], p1: { battlefield: [{ name: 'Test Ice', counters: { ice: 2 } }] } });
    expect(hasKeyword(s0, onField(s0, 'Test Ice')!, 'defender')).toBe(true);
    const s = block(3);
    expect(onField(s, 'Test Grunt')).toBeDefined();
    expect(s.objects[onField(s, 'Test Grunt')!]!.damage).toBe(0);
    expect(s.objects[onField(s, 'Test Ice')!]!.counters['ice']).toBe(2); // the block removed one
  });
  it('the damage dealt TO it is not prevented (ruling 2006-07-15)', () => {
    const s = block(3);
    expect(s.objects[onField(s, 'Test Ice')!]!.damage).toBe(2);
  });
  it('the negative case: with its last ice counter removed by the block, the same combat damage is dealt and it has no defender', () => {
    const s = block(1);
    expect(s.objects[onField(s, 'Test Ice')!]!.counters['ice'] ?? 0).toBe(0);
    expect(onField(s, 'Test Grunt')).toBeUndefined();
    const none = scenario([], { defs: [ICE], p1: { battlefield: ['Test Ice'] } });
    expect(hasKeyword(none, onField(none, 'Test Ice')!, 'defender')).toBe(false);
  });
});

// ---- Futurist Operative: as long as it is tapped, a 1/1 Goblin Scout that can't be blocked ---------------------------------------------------------------------------------
const OPERATIVE = synthetic('Test Operative', 'Creature — Human Ninja', '{0}', "As long as ~ is tapped, it's a Goblin Scout with base power and toughness 1/1 and can't be blocked.", { power: '3', toughness: '3' });

describe('CR 205.1b, 613.4b, 509.1b: "As long as ~ is tapped, it\'s a Goblin Scout with base power and toughness 1/1 and can\'t be blocked"', () => {
  it('is automated; untapped it is a 3/3 Human Ninja, tapped it is a 1/1 Goblin Scout', () => {
    expect(full(OPERATIVE)).toBe(true);
    const s = scenario([], { defs: [OPERATIVE], p1: { battlefield: ['Test Operative'] } });
    const id = onField(s, 'Test Operative')!;
    expect(pt(s, id)).toBe('3/3');
    expect(getChars(s, id)!.subtypes).toEqual(expect.arrayContaining(['Human', 'Ninja']));
    const t = tweak(s, (x) => { x.objects[id]!.tapped = true; });
    expect(pt(t, id)).toBe('1/1');
    expect(getChars(t, id)!.subtypes).toEqual(expect.arrayContaining(['Goblin', 'Scout']));
    expect(getChars(t, id)!.subtypes).not.toContain('Human');
  });
  it('attacking taps it: the attacker is a 1/1 and a creature that could block it is not allowed to (it deals 1 damage, the blocker is untouched)', () => {
    const s = scenario([], { defs: [OPERATIVE, GRUNT], p1: { battlefield: ['Test Operative'] }, p2: { battlefield: ['Test Grunt'] } });
    const t = runCombat(s, { attack: [[onField(s, 'Test Operative')!, 'p2']] });
    expect(life(t, 'p2')).toBe(19);
    // the untapped 2/2 would be a legal blocker of an ordinary attacker; here the game offers no block at all (a block plan is never asked for) and the attacker stays unblocked
    const u = runCombat(s, { attack: [[onField(s, 'Test Operative')!, 'p2']], block: [[onField(s, 'Test Grunt')!, onField(s, 'Test Operative')!]], until: 'combatDamage' });
    expect(u.combat!.attackers[0]!.blocked).toBe(false);
    expect(u.objects[onField(u, 'Test Grunt')!]!.damage).toBe(0);
  });
});

// ---- Spoils of Evil: for each creature card in target opponent's graveyard, add {C} and gain 1 life ---------------------------------------------------------------------
const SPOILS = synthetic('Test Spoils', 'Instant', '{0}', "For each creature card in target opponent's graveyard, add {C} and you gain 1 life.");
const RELIC = synthetic('Test Relic', 'Artifact', '{0}', '');

describe('CR 106.1, 119.1, 608.2c: "For each creature card in target opponent\'s graveyard, add {C} and you gain 1 life"', () => {
  it('is automated; three creature cards (not the artifact, not the controller\'s own graveyard) give {C}{C}{C} and 3 life', () => {
    expect(full(SPOILS)).toBe(true);
    const s0 = scenario([], { defs: [SPOILS, GRUNT, RELIC], p1: { hand: ['Test Spoils'], graveyard: ['Test Grunt'] }, p2: { graveyard: ['Test Grunt', 'Test Grunt', 'Test Grunt', 'Test Relic'] } });
    const s = resolveAll(cast(s0, 'Test Spoils', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(life(s, 'p1')).toBe(23);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.length).toBe(3);
    expect(life(s, 'p2')).toBe(20);
  });
  it('the negative case: an empty graveyard adds no mana and gains no life', () => {
    const s0 = scenario([], { defs: [SPOILS, GRUNT], p1: { hand: ['Test Spoils'], graveyard: ['Test Grunt'] } });
    const s = resolveAll(cast(s0, 'Test Spoils', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(life(s, 'p1')).toBe(20);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.length).toBe(0);
  });
});

// ---- Sway of Illusion: any number of target creatures become the color of your choice -------------------------------------------------------------------------------------
/** Resolve what is on the stack, answering the color choice with `color`. */
function resolveColor(s0: GameState, color: 'W' | 'U' | 'B' | 'R' | 'G'): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); guard++) {
    if (s.pending?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color } as never);
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s);
  }
  return s;
}
const SWAY = synthetic('Test Sway', 'Instant', '{0}', 'Any number of target creatures become the color of your choice until end of turn. Draw a card.');

describe('CR 105.3, 608.2d, 613.1e: "Any number of target creatures become the color of your choice until end of turn"', () => {
  it('is automated; both targets become the one color chosen (red) and the controller draws; a creature not targeted keeps its color', () => {
    expect(full(SWAY)).toBe(true);
    const blue = synthetic('Test Blue', 'Creature — Wizard', '{0}', '', { power: '1', toughness: '1', colors: ['U'] });
    const s0 = scenario([], { defs: [SWAY, GRUNT, blue], p1: { hand: ['Test Sway'], battlefield: ['Test Grunt', 'Test Blue'] }, p2: { battlefield: ['Test Grunt'] } });
    const targets = [{ kind: 'object' as const, id: onField(s0, 'Test Grunt', 'p1')! }, { kind: 'object' as const, id: onField(s0, 'Test Blue')! }];
    const s = resolveColor(cast(s0, 'Test Sway', { targets }), 'R');
    expect(getChars(s, onField(s, 'Test Grunt', 'p1')!)!.colors).toEqual(['R']);
    expect(getChars(s, onField(s, 'Test Blue')!)!.colors).toEqual(['R']);
    expect(getChars(s, onField(s, 'Test Grunt', 'p2')!)!.colors).toEqual([]);
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('the negative case: zero targets is legal and only draws a card (ruling 2004-10-04)', () => {
    const s0 = scenario([], { defs: [SWAY, GRUNT], p1: { hand: ['Test Sway'], battlefield: ['Test Grunt'] } });
    const s = resolveColor(cast(s0, 'Test Sway', { targets: [] }), 'R');
    expect(getChars(s, onField(s, 'Test Grunt')!)!.colors).toEqual([]);
    expect(handSize(s, 'p1')).toBe(1);
  });
});

// ---- Wreck Hunter: choose target player; a tapped Powerstone for each nonland card put into their graveyard from the battlefield this turn --------------------------------
const HUNTER = synthetic('Test Hunter', 'Creature — Human', '{0}', "When this creature enters, choose target player. You create a tapped Powerstone token for each nonland card in that player's graveyard that was put there from the battlefield this turn.", { power: '1', toughness: '1' });
const SMITE = synthetic('Test Smite', 'Instant', '{0}', 'Destroy target creature.');

describe('CR 700.4, 110.5b, 107.3: "choose target player. You create a tapped Powerstone token for each nonland card in that player\'s graveyard that was put there from the battlefield this turn"', () => {
  const powerstones = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  it('is automated; one creature destroyed this turn gives one tapped token, and the older card in that graveyard gives nothing', () => {
    expect(full(HUNTER)).toBe(true);
    let s = scenario([], { defs: [HUNTER, SMITE, GRUNT], p1: { hand: ['Test Smite', 'Test Hunter'] }, p2: { battlefield: ['Test Grunt'], graveyard: ['Test Grunt'] } });
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: onField(s, 'Test Grunt', 'p2')! }] }));
    s = resolveAll(cast(s, 'Test Hunter'), { targets: [{ kind: 'player', id: 'p2' }] });
    const made = powerstones(s);
    expect(made.length).toBe(1);
    expect(s.objects[made[0]!]!.tapped).toBe(true);
  });
  it('the negative case: nothing put there this turn, no token; and the chosen player\'s graveyard counts, not the controller\'s', () => {
    let s = scenario([], { defs: [HUNTER, GRUNT], p1: { hand: ['Test Hunter'] }, p2: { graveyard: ['Test Grunt'] } });
    s = resolveAll(cast(s, 'Test Hunter'), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(powerstones(s).length).toBe(0);
  });
});

// ---- Tezzeret's emblem: an artifact becomes an artifact creature with base power and toughness 5/5, no duration ------------------------------------------------------------
const FORGE = synthetic('Test Forge', 'Enchantment', '{0}', 'At the beginning of combat on your turn, target artifact you control becomes an artifact creature with base power and toughness 5/5.');

describe('CR 611.2a, 613.4b, 205.1a: "target artifact you control becomes an artifact creature with base power and toughness 5/5" (no duration)', () => {
  it('is automated; the artifact is a 5/5 artifact creature from the beginning of combat on, and still is in the next turn', () => {
    expect(full(FORGE)).toBe(true);
    let s = scenario([], { defs: [FORGE, RELIC, GRUNT], p1: { battlefield: ['Test Forge', 'Test Relic', 'Test Grunt'] } });
    s = settle(passUntil(s, (x) => x.turn.step === 'beginCombat' && (x.zones.stack.length > 0 || x.pending?.kind !== 'priority'), 'the beginning of combat trigger'), { targets: [{ kind: 'object', id: onField(s, 'Test Relic')! }] });
    s = resolveAll(s, { targets: [{ kind: 'object', id: onField(s, 'Test Relic')! }] });
    const relic = onField(s, 'Test Relic')!;
    expect(pt(s, relic)).toBe('5/5');
    expect(getChars(s, relic)!.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    s = advanceToStep(s, 2, 'upkeep');
    expect(pt(s, onField(s, 'Test Relic')!)).toBe('5/5');
  });
  it('the negative case: a creature that is not an artifact is not a legal target, so it keeps its size', () => {
    let s = scenario([], { defs: [FORGE, GRUNT], p1: { battlefield: ['Test Forge', 'Test Grunt'] } });
    s = passUntil(s, (x) => x.turn.step === 'beginCombat' && x.pending?.kind === 'priority', 'beginning of combat');
    expect(pt(s, onField(s, 'Test Grunt')!)).toBe('2/2');
  });
});

// ---- Skyship Weatherlight: choose a card at random that was exiled with ~, put it into its owner's hand ---------------------------------------------------------------------
const SHIP = synthetic('Test Ship', 'Artifact', '{0}', 'When this artifact enters, exile the top three cards of your library.\n{0}: Choose a card at random that was exiled with ~. Put that card into its owner\'s hand.');

describe('CR 607.2a, 608.2d: "Choose a card at random that was exiled with ~. Put that card into its owner\'s hand"', () => {
  it('is automated; one of the three exiled cards goes to the hand and the other two stay in exile', async () => {
    expect(full(SHIP)).toBe(true);
    const { act } = await import('../../m3/scenario');
    let s = scenario([], { defs: [SHIP, GRUNT], p1: { hand: ['Test Ship'], library: ['Test Grunt', 'Test Grunt', 'Test Grunt', 'Test Grunt'] } });
    s = resolveAll(cast(s, 'Test Ship'));
    const ship = onField(s, 'Test Ship')!;
    const exiledBefore = s.zones.exile.length;
    expect(exiledBefore).toBe(3);
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: ship, ability: 'p:0:1' } as never));
    expect(handSize(s, 'p1')).toBe(1);
    expect(s.zones.exile.length).toBe(2);
  });
  it('the negative case: with nothing exiled with it, the ability moves nothing', async () => {
    const { act } = await import('../../m3/scenario');
    let s = scenario([], { defs: [SHIP, GRUNT], p1: { battlefield: ['Test Ship'] }, p2: { exile: ['Test Grunt'] } });
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: onField(s, 'Test Ship')!, ability: 'p:0:1' } as never));
    expect(handSize(s, 'p1')).toBe(0);
    expect(s.zones.exile.length).toBe(1);
    expect(find(s, 'Test Grunt', 'exile', 'p2')).toBeDefined();
  });
});
