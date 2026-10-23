/**
 * T18 (FAST3 wave, template family R2-D: effects whose object or amount is a reference: it, them, those, that much, the sacrificed creature): the cards the
 * T18 templates, anaphora, renderer and engine changes automate, played through applyAction with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10). Each test is named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, life, passBoth, scenario, advanceTo } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { getChars, ptNumbers } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };

/** Answer the decisions of casting or activating: targets, then automatic payment; any choice of what to sacrifice takes `pick`. */
function settle(s0: GameState, targets: TargetChoice[], pick?: ObjectId): GameState {
  let s = s0;
  while (s.pending && s.pending.kind !== 'priority') {
    const d = s.pending as { kind: string; options?: ObjectId[] };
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseObjects' && pick !== undefined) s = answer(s, { kind: 'chooseObjects', ids: [pick] } as DecisionAnswer);
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], pick?: ObjectId): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, pick);
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = [], pick?: ObjectId): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === source && !x.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  return settle(act(s0, a.action), targets, pick);
}
const power = (s: GameState, id: ObjectId): number | null => ptNumbers(getChars(s, id)).power;
const toughness = (s: GameState, id: ObjectId): number | null => ptNumbers(getChars(s, id)).toughness;
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => getChars(s, id).keywords.some((x) => x.keyword === k);

describe('CR 608.2h, 602.2b: "Sacrifice a creature: You gain life equal to the sacrificed creature\'s toughness" reads the creature as it last existed', () => {
  const ALTAR = card('Test Bone Altar', 'Artifact', "{1}, Sacrifice a creature: You gain life equal to the sacrificed creature's toughness.");
  const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  it('the ability is automated and reads {ref:costSacrificed}', () => {
    expect(manualParts(ALTAR)).toEqual([]);
    expect(JSON.stringify(ALTAR.faces[0]!.abilities[0])).toContain('{"q":"stat","stat":"toughness","of":{"ref":"costSacrificed"}}');
  });
  it('its toughness on the battlefield, counters included (CR 122.1a), not the printed toughness of the card in the graveyard', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Bone Altar', { name: 'Test Hill Bear', counters: { '+1/+1': 3 } }, 'Plains'] }, defs: [ALTAR, BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    expect(toughness(s, bear)).toBe(5);
    s = activate(s, find(s, 'Test Bone Altar', 'battlefield', 'p1'), [], bear);
    expect(findAll(s, 'Test Hill Bear', 'battlefield').length).toBe(0); // paid as the cost (CR 601.2h)
    const before = life(s, 'p1');
    s = passBoth(s);
    expect(life(s, 'p1')).toBe(before + 5);
  });
  it('CR 111.7: a sacrificed token still has its last known information', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Bone Altar', { name: 'Test Hill Bear', counters: { '+1/+1': 1 } }, 'Plains'] }, defs: [ALTAR, BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    s.objects[bear]!.kind = 'token';
    s = activate(s, find(s, 'Test Bone Altar', 'battlefield', 'p1'), [], bear);
    const before = life(s, 'p1');
    s = passBoth(s);
    expect(life(s, 'p1')).toBe(before + 3);
  });
});

describe('CR 601.2b, 608.2h, 707.10: a spell\'s additional cost "sacrifice a creature" and "damage equal to the sacrificed creature\'s power"', () => {
  const HURL = card('Test Hurl', 'Instant', "As an additional cost to cast this spell, sacrifice a creature.\n~ deals damage equal to the sacrificed creature's power to any target.", '{1}{R}');
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', '{1}', ['3', '3']);
  it('both abilities are automated; the spell reads {ref:costSacrificed}', () => {
    expect(manualParts(HURL)).toEqual([]);
    expect(JSON.stringify(HURL)).toContain('"amount":{"q":"stat","stat":"power","of":{"ref":"costSacrificed"}}');
  });
  it('the damage is the power the creature had on the battlefield', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Hurl'], battlefield: [{ name: 'Test Big Ogre', counters: { '+1/+1': 2 } }, 'Mountain', 'Mountain'] }, defs: [HURL, OGRE] });
    const ogre = find(s, 'Test Big Ogre', 'battlefield', 'p1');
    s = cast(s, 'Test Hurl', [p2], ogre);
    expect(findAll(s, 'Test Big Ogre', 'battlefield').length).toBe(0);
    s = passBoth(s);
    expect(life(s, 'p2')).toBe(20 - 5);
  });
});

describe('CR 120.3, 506.4: "Whenever a creature attacks, ~ deals 1 damage to it" (the attacker, never the source)', () => {
  const SPIKES = card('Test Floor Spikes', 'Artifact', 'Whenever a creature attacks, ~ deals 1 damage to it.');
  const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  it('is automated: the damage goes to the attacker (event role)', () => {
    expect(manualParts(SPIKES)).toEqual([]);
    expect(JSON.stringify(SPIKES)).toContain('"to":{"ref":"event","role":"attacker"}');
  });
  it('the attacking creature is dealt 1 damage', () => {
    let s = scenario([], { p1: { battlefield: ['Test Floor Spikes', 'Test Hill Bear'] }, defs: [SPIKES, BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[bear]]);
    s = passUntil(s, (x) => x.objects[bear]?.damage === 1, 'the trigger to resolve', 20);
    expect(s.objects[bear]!.damage).toBe(1);
  });
});

describe('CR 120.1: Oracle\'s singular "them": "At the beginning of each player\'s upkeep, ~ deals 1 damage to them"', () => {
  const VORTEX = card('Test Spinning Vortex', 'Enchantment', "At the beginning of each player's upkeep, ~ deals 1 damage to them.");
  it('is automated: the damage goes to the event\'s player', () => {
    expect(manualParts(VORTEX)).toEqual([]);
    expect(JSON.stringify(VORTEX)).toContain('"to":{"ref":"event","role":"player"}');
  });
  it('the player whose upkeep it is loses 1 life, the other none', () => {
    let s = scenario([], { p1: { battlefield: ['Test Spinning Vortex'] }, defs: [VORTEX] });
    s = advanceTo(s, 2, 'draw');
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.2c: "Whenever you attack with one or more creatures, those creatures get +1/+1 until end of turn" (a batch: all the attackers)', () => {
  const BANNER = card('Test War Banner', 'Enchantment', 'Whenever you attack with one or more creatures, those creatures get +1/+1 until end of turn.');
  const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  it('every attacker gets +1/+1, a creature that did not attack does not', () => {
    expect(manualParts(BANNER)).toEqual([]);
    let s = scenario([], { p1: { battlefield: ['Test War Banner', 'Test Hill Bear', 'Test Hill Bear', 'Test Hill Bear'] }, defs: [BANNER, BEAR] });
    const [a, b, c] = findAll(s, 'Test Hill Bear', 'battlefield', 'p1') as [ObjectId, ObjectId, ObjectId];
    s = declareAttackers(toDeclareAttackers(s), [[a], [b]]);
    s = passUntil(s, (x) => power(x, a) === 3, 'the trigger to resolve', 20);
    expect([power(s, a), power(s, b), power(s, c)]).toEqual([3, 3, 2]);
  });
});

describe('CR 122.6: "Whenever you attack with one or more creatures, put a +1/+1 counter on each of them"', () => {
  const DRUM = card('Test War Drum', 'Enchantment', 'Whenever you attack with one or more creatures, put a +1/+1 counter on each of them.');
  const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  it('each attacker gets a counter', () => {
    expect(manualParts(DRUM)).toEqual([]);
    let s = scenario([], { p1: { battlefield: ['Test War Drum', 'Test Hill Bear', 'Test Hill Bear', 'Test Hill Bear'] }, defs: [DRUM, BEAR] });
    const [a, b, c] = findAll(s, 'Test Hill Bear', 'battlefield', 'p1') as [ObjectId, ObjectId, ObjectId];
    s = declareAttackers(toDeclareAttackers(s), [[a], [b]]);
    s = passUntil(s, (x) => (x.objects[a]?.counters['+1/+1'] ?? 0) === 1, 'the trigger to resolve', 20);
    expect([a, b, c].map((id) => s.objects[id]!.counters['+1/+1'] ?? 0)).toEqual([1, 1, 0]);
  });
});

describe('CR 603.5, 701.26b, 506.4: "Whenever ~ becomes blocked, you may untap it and remove it from combat"', () => {
  const RUNNER = card('Test Wind Runner', 'Creature — Bird', 'Whenever ~ becomes blocked, you may untap it and remove it from combat.', '{1}', ['2', '2']);
  const WALL = card('Test Stone Wall', 'Creature — Wall', '', '{1}', ['0', '4']);
  const toChoice = (s0: GameState): { s: GameState; runner: ObjectId } => {
    let s = s0;
    const runner = find(s, 'Test Wind Runner', 'battlefield', 'p1');
    const wall = find(s, 'Test Stone Wall', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[runner]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers', 20);
    s = declareBlockers(s, [[wall, runner]]);
    s = passUntil(s, (x) => x.pending?.kind === 'yesNo', 'the may choice', 20);
    return { s, runner };
  };
  const board = (): GameState => scenario([], { p1: { battlefield: ['Test Wind Runner'] }, p2: { battlefield: ['Test Stone Wall'] }, defs: [RUNNER, WALL] });
  it('is automated: one may with both steps', () => {
    expect(manualParts(RUNNER)).toEqual([]);
    expect(JSON.stringify(RUNNER)).toContain('"op":"may"');
    expect(JSON.stringify(RUNNER)).toContain('"op":"removeFromCombat"');
  });
  it('yes: the creature is untapped and no longer attacking', () => {
    const { s: s0, runner } = toChoice(board());
    const s = answer(s0, { kind: 'yesNo', yes: true });
    expect(s.objects[runner]!.tapped).toBe(false);
    expect(s.combat?.attackers.some((x) => x.id === runner) ?? false).toBe(false);
  });
  it('no: it stays tapped and attacking', () => {
    const { s: s0, runner } = toChoice(board());
    const s = answer(s0, { kind: 'yesNo', yes: false });
    expect(s.objects[runner]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((x) => x.id === runner)).toBe(true);
  });
});

describe('CR 701.24a, 608.2n: "Shuffle ~ into its owner\'s library" (the spell goes to the library, not to the graveyard)', () => {
  const BEACON = card('Test Beacon of Rest', 'Sorcery', "You gain 3 life. Shuffle ~ into its owner's library.", '{0}');
  it('the spell is automated and ends in its owner\'s library', () => {
    expect(manualParts(BEACON)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Beacon of Rest'] }, defs: [BEACON] });
    const libBefore = s.zones.library.p1!.length;
    s = passBoth(cast(s, 'Test Beacon of Rest'));
    expect(life(s, 'p1')).toBe(23);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).not.toContain('Test Beacon of Rest');
    expect(s.zones.library.p1!.length).toBe(libBefore + 1);
    expect(s.zones.library.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Beacon of Rest');
  });
});

describe('CR 201.2: "Target creature and all other creatures with the same name as that creature get -1/-1 until end of turn"', () => {
  const BLIGHT = card('Test Name Blight', 'Instant', 'Target creature and all other creatures with the same name as that creature get -1/-1 until end of turn.', '{0}');
  const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', '{1}', ['3', '3']);
  it('the target and every creature sharing its name, on both sides, but no other creature', () => {
    expect(manualParts(BLIGHT)).toEqual([]);
    expect(JSON.stringify(BLIGHT)).toContain('"sharesWith":{"with":{"ref":"target","id":"t0"},"quality":"name"}');
    let s = scenario([], { p1: { hand: ['Test Name Blight'], battlefield: ['Test Hill Bear', 'Test Big Ogre'] }, p2: { battlefield: ['Test Hill Bear'] }, defs: [BLIGHT, BEAR, OGRE] });
    const mine = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Hill Bear', 'battlefield', 'p2');
    const ogre = find(s, 'Test Big Ogre', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Name Blight', [obj(theirs)]));
    expect([power(s, mine), power(s, theirs), power(s, ogre)]).toEqual([1, 1, 3]);
  });
});

describe('CR 611.2c, 608.2h: "Until end of turn, target creature gets +1/+1 for each creature you control and gains trample"', () => {
  const CHORUS = card('Test Choir of Strength', 'Instant', 'Until end of turn, target creature gets +1/+1 for each creature you control and gains trample.', '{0}');
  const BEAR = card('Test Hill Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  it('the count is taken as the spell resolves; the creature gains trample', () => {
    expect(manualParts(CHORUS)).toEqual([]);
    let s = scenario([], { p1: { hand: ['Test Choir of Strength'], battlefield: ['Test Hill Bear', 'Test Hill Bear', 'Test Hill Bear'] }, defs: [CHORUS, BEAR] });
    const bear = find(s, 'Test Hill Bear', 'battlefield', 'p1');
    s = passBoth(cast(s, 'Test Choir of Strength', [obj(bear)]));
    expect(power(s, bear)).toBe(5);
    expect(toughness(s, bear)).toBe(5);
    expect(hasKeyword(s, bear, 'trample')).toBe(true);
  });
});

describe('CR 608.2h: "{2}: ~ deals damage equal to its power to any target" ("its" is the source, the subject of the clause)', () => {
  const ELDER = card('Test Spike Elder', 'Creature — Goblin', '{2}: ~ deals damage equal to its power to any target.', '{1}', ['2', '2']);
  it('is automated with the source\'s power', () => {
    expect(manualParts(ELDER)).toEqual([]);
    expect(JSON.stringify(ELDER)).toContain('"amount":{"q":"stat","stat":"power","of":{"ref":"self"}}');
    let s = scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Spike Elder', counters: { '+1/+1': 1 } }, 'Mountain', 'Mountain'] }, defs: [ELDER] });
    s = passBoth(activate(s, find(s, 'Test Spike Elder', 'battlefield', 'p1'), [p2]));
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('CR 603.6a, 201.5: "Whenever ~ enters or attacks, it deals 1 damage to any target" ("it" is the object in both events)', () => {
  const DRAKE = card('Test Ember Drake', 'Creature — Drake', 'Whenever ~ enters or attacks, it deals 1 damage to any target.', '{0}', ['2', '2']);
  it('is automated with the object as the source', () => {
    expect(manualParts(DRAKE)).toEqual([]);
    expect(JSON.stringify(DRAKE)).toContain('"source":{"ref":"self"}');
  });
  it('it triggers on entering and deals 1 damage', () => {
    let s = scenario([], { p1: { hand: ['Test Ember Drake'] }, defs: [DRAKE] });
    s = passBoth(cast(s, 'Test Ember Drake'));
    s = settle(s, [p2]);
    s = passBoth(s);
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 509.1g, 608.2h: "Whenever ~ becomes blocked, it gets +2/+2 until end of turn for each creature blocking it"', () => {
  const ELK = card('Test Herd Elk', 'Creature — Elk', 'Whenever ~ becomes blocked, it gets +2/+2 until end of turn for each creature blocking it.', '{0}', ['2', '2']);
  const WALL = card('Test Stone Wall', 'Creature — Wall', '', '{1}', ['0', '4']);
  it('two blockers: +4/+4; a creature that does not block it does not count', () => {
    expect(manualParts(ELK)).toEqual([]);
    expect(JSON.stringify(ELK)).toContain('"blockingObject":{"ref":"event","role":"attacker"}');
    let s = scenario([], { p1: { battlefield: ['Test Herd Elk'] }, p2: { battlefield: ['Test Stone Wall', 'Test Stone Wall', 'Test Stone Wall'] }, defs: [ELK, WALL] });
    const elk = find(s, 'Test Herd Elk', 'battlefield', 'p1');
    const [w1, w2, w3] = findAll(s, 'Test Stone Wall', 'battlefield', 'p2') as [ObjectId, ObjectId, ObjectId];
    s = declareAttackers(toDeclareAttackers(s), [[elk]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers', 20);
    s = declareBlockers(s, [[w1, elk], [w2, elk]]);
    s = passUntil(s, (x) => power(x, elk) !== 2, 'the trigger to resolve', 20);
    expect([power(s, elk), toughness(s, elk)]).toEqual([6, 6]);
    expect(power(s, w3)).toBe(0);
  });
});

describe('the unique-candidate rule still holds (design 6.4)', () => {
  it('"Whenever a creature enters, ~ deals damage equal to its power to any target": "its" may be ~ or the creature, so it stays manual', () => {
    const c = card('Test Hot Gate', 'Enchantment', 'Whenever a creature enters, ~ deals damage equal to its power to any target.');
    expect(manualParts(c).length).toBeGreaterThan(0);
  });
  it('"the sacrificed creature" names nothing in a triggered ability (no cost of its own)', () => {
    const c = card('Test Odd Shrine', 'Enchantment', "Whenever a creature dies, you gain life equal to the sacrificed creature's toughness.");
    expect(manualParts(c).length).toBeGreaterThan(0);
  });
  it('nothing acts on what the cost sacrificed (it is a new object, CR 400.7)', () => {
    const c = card('Test Grave Altar', 'Artifact', '{1}, Sacrifice a creature: Return the sacrificed creature to its owner\'s hand.');
    expect(JSON.stringify(c)).not.toContain('costSacrificed');
  });
  it('a bare "it" never means what the cost sacrificed', () => {
    const c = card('Test Blood Altar', 'Artifact', '{1}, Sacrifice a creature: Target creature gets +2/+2 until end of turn. It gains trample until end of turn.');
    expect(JSON.stringify(c)).not.toContain('costSacrificed');
  });
});
