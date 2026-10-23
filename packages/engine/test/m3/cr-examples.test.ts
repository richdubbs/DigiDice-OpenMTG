/**
 * The worked examples ("Example:" paragraphs) of the Comprehensive Rules that fall inside milestone 3,
 * as scenario tests: rules 106, 107.3, 107.4, 116, 117, 118, 202.3, 305, 405, 601, 602, 605 and 608.
 * Each test is named after the rule that carries the example ("CR 601.2c example: ...").
 *
 * Cards: the card named in the example when the fixture has it and its relevant behavior is implemented. Where a card's
 * effect is not automated yet (milestone 5), the real fixture card is compiled with a hand-built ability model
 * (`withAbilities`: what the milestone 5 compiler will produce) so its characteristics stay real. Where no printed card has the
 * example's exact shape, an equivalent fixture card is used and the test says so. The examples that need triggers, combat,
 * layers, replacement effects or copy effects are listed in the comment block at the end of the file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, findAbility, type AbilityDef, type CardDef, type GameState, type TargetSpec } from '../../src/index';
import { findObjects, NO_ENV } from '../../src/rules/filter';
import { getCard } from '../fixtures';
import { act, answer, castAuto, find, findAll, isTapped, labels, legal, life, pass, passBoth, pool, reject, scenario, zoneNames } from './scenario';
import { activated, legacySteps, spellAbility, synth, targetCreature, targetPlayer } from './synthetic';

/** A real fixture card whose abilities are the given hand-built model (the milestone 5 compiler's future output). */
function withAbilities(name: string, abilities: AbilityDef[]): CardDef {
  return compileCard(getCard(name), () => ({ abilities, unsupported: [] }));
}

const tappedNames = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).map((id) => s.objects[id]!.defId).sort();
const stackNames = (s: GameState): string[] => s.zones.stack.map((id) => s.objects[id]!.defId);
const manaSpentOn = (s: GameState): string => (s.objects[s.zones.stack[s.zones.stack.length - 1]!]!.stack!.costsPaid.manaSpent ?? []).map((u) => u.type).sort().join('');
const castFromHand = (s: GameState, name: string, player = 'p1'): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) });

describe('CR 107.4e: hybrid mana symbols', () => {
  // Gallant Citizen costs {G/W}{G/W}, the same shape as the example.
  const pays: [string, string[], string][] = [
    ['{G}{G}', ['Forest', 'Forest'], 'GG'],
    ['{G}{W}', ['Forest', 'Plains'], 'GW'],
    ['{W}{W}', ['Plains', 'Plains'], 'WW'],
  ];
  it.each(pays)('CR 107.4e example: {G/W}{G/W} can be paid by spending %s (Gallant Citizen)', (_label, lands, spent) => {
    let s = scenario(['Gallant Citizen', 'Forest', 'Plains'], { p1: { hand: ['Gallant Citizen'], battlefield: lands } });
    expect(labels(s, 'p1')).toContain('Cast Gallant Citizen');
    s = castAuto(s, 'Gallant Citizen');
    expect(stackNames(s)).toEqual(['Gallant Citizen']);
    expect(manaSpentOn(s)).toBe(spent);
    expect(tappedNames(s)).toEqual([...lands].sort());
  });

  it('CR 107.4e example: {G/W}{G/W} can be paid by a manual payment of the player\'s own choice, one mana per symbol', () => {
    let s = scenario(['Gallant Citizen', 'Forest', 'Plains'], { p1: { hand: ['Gallant Citizen'], battlefield: ['Forest', 'Plains', 'Plains'] } });
    const [forest] = findAll(s, 'Forest', 'battlefield');
    const [plains] = findAll(s, 'Plains', 'battlefield');
    s = castFromHand(s, 'Gallant Citizen');
    s = answer(s, { kind: 'payCost', auto: false, activations: [{ objectId: forest!, abilityKey: 'r:basic:G' }, { objectId: plains!, abilityKey: 'r:basic:W' }] });
    expect(manaSpentOn(s)).toBe('GW');
    expect(tappedNames(s)).toEqual(['Forest', 'Plains']); // the third land (a Plains) is untouched
  });

  it('CR 107.4e example (negative): {G/W}{G/W} cannot be paid with mana of neither color', () => {
    const none = scenario(['Gallant Citizen', 'Mountain'], { p1: { hand: ['Gallant Citizen'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    expect(reject(none, { type: 'cast', player: 'p1', card: find(none, 'Gallant Citizen', 'hand') }).message).toMatch(/can't pay \{G\/W\}\{G\/W\}/);
    expect(labels(none, 'p1')).not.toContain('Cast Gallant Citizen');
    // One matching mana is not enough either: each hybrid symbol needs its own mana of one of its colors.
    const one = scenario(['Gallant Citizen', 'Forest', 'Mountain'], { p1: { hand: ['Gallant Citizen'], battlefield: ['Forest', 'Mountain'] } });
    reject(one, { type: 'cast', player: 'p1', card: find(one, 'Gallant Citizen', 'hand') });
  });
});

describe('CR 107.4f: Phyrexian mana symbols', () => {
  // No printed card has exactly {W/P}{W/P}. Dismember ({1}{B/P}{B/P}) has the same two symbols plus {1}, so the example is
  // played with black mana and a Mountain for the {1}. Symbol indices of Dismember's cost: 0 = {1}, 1 and 2 = the Phyrexian symbols.
  const hand = { hand: ['Dismember'] };
  // WP18: Dismember's effect is automated now and needs a target creature; these examples are about paying its cost, so it is compiled as manual text.
  const dismember = (lands: string[]): GameState => castFromHand(scenario(['Dismember', 'Swamp', 'Mountain'], { p1: { ...hand, battlefield: lands }, manual: ['Dismember'] }), 'Dismember');

  it('CR 107.4f example: {B/P}{B/P} can be paid by spending {B}{B}', () => {
    let s = dismember(['Swamp', 'Swamp', 'Mountain']);
    const [a, b] = findAll(s, 'Swamp', 'battlefield');
    s = answer(s, {
      kind: 'payCost', auto: false,
      activations: [{ objectId: a!, abilityKey: 'r:basic:B' }, { objectId: b!, abilityKey: 'r:basic:B' }, { objectId: find(s, 'Mountain', 'battlefield'), abilityKey: 'r:basic:R' }],
    });
    expect(life(s, 'p1')).toBe(20);
    expect(manaSpentOn(s)).toBe('BBR');
    expect(stackNames(s)).toEqual(['Dismember']);
  });

  it('CR 107.4f example: {B/P}{B/P} can be paid by spending {B} and paying 2 life', () => {
    let s = dismember(['Swamp', 'Mountain']);
    s = answer(s, {
      kind: 'payCost', auto: false, lifeForPhyrexian: [2],
      activations: [{ objectId: find(s, 'Swamp', 'battlefield'), abilityKey: 'r:basic:B' }, { objectId: find(s, 'Mountain', 'battlefield'), abilityKey: 'r:basic:R' }],
    });
    expect(life(s, 'p1')).toBe(18);
    expect(manaSpentOn(s)).toBe('BR');
    expect(s.objects[s.zones.stack[0]!]!.stack!.costsPaid.lifePaid).toBe(2);
  });

  it('CR 107.4f example: {B/P}{B/P} can be paid by paying 4 life', () => {
    let s = dismember(['Mountain']);
    s = answer(s, { kind: 'payCost', auto: false, lifeForPhyrexian: [1, 2], activations: [{ objectId: find(s, 'Mountain', 'battlefield'), abilityKey: 'r:basic:R' }] });
    expect(life(s, 'p1')).toBe(16);
    expect(manaSpentOn(s)).toBe('R');
    expect(s.objects[s.zones.stack[0]!]!.stack!.costsPaid.lifePaid).toBe(4);
    expect(stackNames(s)).toEqual(['Dismember']);
  });
});

describe('CR 202.3: mana value', () => {
  const chars = (s: GameState, name: string, zone: 'hand' | 'battlefield') => getChars(s, find(s, name, zone));

  it('CR 202.3 example: a mana cost of {3}{U}{U} translates to a mana value of 5 (Air Elemental)', () => {
    const s = scenario(['Air Elemental'], { p1: { hand: ['Air Elemental'], battlefield: ['Air Elemental'] } });
    expect(chars(s, 'Air Elemental', 'hand')).toMatchObject({ manaValue: 5 });
    expect(chars(s, 'Air Elemental', 'battlefield')).toMatchObject({ manaValue: 5 });
  });

  it('CR 202.3b example: Huntmaster of the Fells ({2}{R}{G}) has mana value 4, and after it transforms to Ravager of the Fells it is still 4', () => {
    const name = 'Huntmaster of the Fells // Ravager of the Fells';
    const s = scenario([name], { p1: { hand: [name], battlefield: [{ name, face: 1 }] } });
    expect(chars(s, name, 'hand')).toMatchObject({ name: 'Huntmaster of the Fells', manaValue: 4 });
    const back = getChars(s, findAll(s, name, 'battlefield')[0]!);
    expect(back).toMatchObject({ name: 'Ravager of the Fells', manaCost: null, manaValue: 4 });
  });

  it('CR 202.3b: the back face of Delver of Secrets (front face {U}) has mana value 1; a modal double-faced back face keeps its own cost', () => {
    const delver = 'Delver of Secrets // Insectile Aberration';
    const mdfc = 'Shatterskull Smashing // Shatterskull, the Hammer Pass';
    const s = scenario([delver, mdfc], { p1: { battlefield: [{ name: delver, face: 1 }, { name: mdfc, face: 1 }] } });
    expect(getChars(s, findAll(s, delver, 'battlefield')[0]!)).toMatchObject({ name: 'Insectile Aberration', manaValue: 1 });
    expect(getChars(s, findAll(s, mdfc, 'battlefield')[0]!)).toMatchObject({ name: 'Shatterskull, the Hammer Pass', manaValue: 0 }); // a land: no cost (CR 202.3a)
  });

  it('CR 202.3f example: {1}{W/U}{W/U} has mana value 3 (Vassal Soul); {2/B}{2/B}{2/B} has mana value 6 (Beseech the Queen)', () => {
    const s = scenario(['Vassal Soul', 'Beseech the Queen'], { p1: { hand: ['Vassal Soul', 'Beseech the Queen'] } });
    expect(chars(s, 'Vassal Soul', 'hand').manaValue).toBe(3);
    expect(chars(s, 'Beseech the Queen', 'hand').manaValue).toBe(6);
  });

  it('CR 202.3g example: {1}{W/P}{W/P} has mana value 3 (Dismember\'s {1}{B/P}{B/P} has the same shape)', () => {
    const s = scenario(['Dismember'], { p1: { hand: ['Dismember'] } });
    expect(chars(s, 'Dismember', 'hand').manaValue).toBe(3);
  });
});

describe('CR 305.5: land subtypes', () => {
  it('CR 305.5 example: "Basic Land - Mountain" is a land with the subtype Mountain', () => {
    const s = scenario(['Mountain', 'Taiga'], { p1: { battlefield: ['Mountain', 'Taiga'] } });
    expect(getChars(s, find(s, 'Mountain', 'battlefield'))).toMatchObject({ types: ['Land'], supertypes: ['Basic'], subtypes: ['Mountain'] });
    // CR 305.5: lands may have several subtypes; CR 305.6 gives each basic land type its mana ability.
    expect(getChars(s, find(s, 'Taiga', 'battlefield'))).toMatchObject({ types: ['Land'], subtypes: ['Mountain', 'Forest'] });
    expect(findAbility(s, find(s, 'Mountain', 'battlefield'), 'r:basic:R')).toBeDefined();
    expect(findAbility(s, find(s, 'Taiga', 'battlefield'), 'r:basic:R')).toBeDefined();
    expect(findAbility(s, find(s, 'Taiga', 'battlefield'), 'r:basic:G')).toBeDefined();
  });
});

describe('CR 601.2c: choosing targets', () => {
  // Blinding Beam: "Choose one - Tap two target creatures. - Creatures don't untap during target player's next untap step."
  // (entwine is not modeled: the engine has no entwine yet).
  const twoCreatures: TargetSpec = { ...targetCreature, min: 2, max: 2, text: 'two target creatures' };
  const beam = (): CardDef => withAbilities('Blinding Beam', [{
    kind: 'spell', text: 'Choose one -',
    effect: {
      targets: [], steps: [],
      modes: {
        min: 1, max: 1,
        options: [
          { text: 'Tap two target creatures.', program: { targets: [twoCreatures], steps: legacySteps([{ op: 'tap' }]) } },
          { text: "Creatures don't untap during target player's next untap step.", program: { targets: [targetPlayer], steps: legacySteps([{ op: 'skipUntap' }]) } },
        ],
      },
    },
  }]);
  const beamScenario = (creatures: string[]): GameState =>
    scenario(['Plains', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Blinding Beam'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: creatures }, defs: [beam()] });

  it('CR 601.2c example: "Tap two target creatures" needs two different legal targets - with one creature the mode cannot be chosen', () => {
    let s = beamScenario(['Grizzly Bears']);
    s = castFromHand(s, 'Blinding Beam');
    if (s.pending?.kind !== 'chooseOption') throw new Error('expected a mode choice');
    expect(s.pending.options.map((o) => [o.label, o.disabled ? 'disabled' : 'ok'])).toEqual([
      ['Tap two target creatures.', 'disabled'],
      ["Creatures don't untap during target player's next untap step.", 'ok'],
    ]);
    expect(reject(s, { type: 'answer', player: 'p1', decisionId: s.pending.id, answer: { kind: 'chooseOption', ids: ['0'] } }).message).toMatch(/can't be chosen/);
  });

  it('CR 601.2c example: "Tap two target creatures" - the same creature cannot be chosen twice, two different ones can', () => {
    let s = beamScenario(['Grizzly Bears', 'Hill Giant']);
    const [bears, giant] = [find(s, 'Grizzly Bears', 'battlefield', 'p2'), find(s, 'Hill Giant', 'battlefield', 'p2')];
    s = castFromHand(s, 'Blinding Beam');
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'two target creatures', min: 2, max: 2 });
    const decisionId = s.pending!.id;
    const choose = (ids: string[]) => ({ type: 'answer' as const, player: 'p1', decisionId, answer: { kind: 'chooseTargets' as const, targets: ids.map((id) => ({ kind: 'object' as const, id })) } });
    expect(reject(s, choose([bears, bears])).rules).toContain('CR 115.3'); // the same creature twice
    expect(reject(s, choose([bears])).message).toMatch(/exactly 2/); // two targets are required
    s = act(s, choose([bears, giant]));
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[s.zones.stack[0]!]!.stack).toMatchObject({ modes: [0], targets: [[{ kind: 'object', id: bears }, { kind: 'object', id: giant }]] });
  });

  it('CR 601.2c example: "Destroy target artifact and target land" can target the same artifact land twice (one choice per instance of "target")', () => {
    // No printed card has exactly this text, so the spell is synthetic; Ancient Den is a real artifact land.
    const targetArtifact: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Artifact'] }, min: 1, max: 1, text: 'target artifact' };
    const targetLand: TargetSpec = { id: 't1', kind: 'object', filter: { types: ['Land'] }, min: 1, max: 1, text: 'target land' };
    const shatter = synth({ name: 'Test Shatter', cost: '{1}{R}', type: 'Instant', abilities: [spellAbility('Destroy target artifact and target land.', [targetArtifact, targetLand], [{ op: 'destroy' }])] });
    let s = scenario(['Ancient Den', 'Plains', 'Mountain'], { p1: { hand: ['Test Shatter'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Ancient Den', 'Plains'] }, defs: [shatter] });
    const den = find(s, 'Ancient Den', 'battlefield');
    s = castFromHand(s, 'Test Shatter');
    // First instance of "target": only the artifact land is an artifact.
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target artifact', objects: [den] });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: den }] });
    // Second instance: the artifact land is chosen again, although it was already chosen for the first.
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target land' });
    if (s.pending?.kind !== 'chooseTargets') throw new Error('expected targets');
    expect(s.pending.objects).toContain(den);
    expect(s.pending.objects).toContain(find(s, 'Plains', 'battlefield', 'p2')); // any land is a legal second target
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: den }] });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[s.zones.stack[0]!]!.stack!.targets).toEqual([[{ kind: 'object', id: den }], [{ kind: 'object', id: den }]]);
    // Both targets are legal on resolution, so the spell resolves (by hand until milestone 5).
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', sourceName: 'Test Shatter' });
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'move', object: den, to: 'graveyard' }] });
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Ancient Den']);
  });
});

describe('CR 602.1a: activation costs', () => {
  // "{2}, {T}: You gain 1 life" is the example's ability. No printed card in the fixture has it, so the permanent is synthetic.
  const healer = (): CardDef => synth({ name: 'Test Healer', type: 'Artifact', abilities: [activated('{2}, {T}: You gain 1 life.', { mana: [{ kind: 'generic', amount: 2 }], tap: true })] });
  const activate = (s: GameState, player = 'p1') => ({ type: 'activate' as const, player, source: find(s, 'Test Healer', 'battlefield'), ability: 'p:0:0' });

  it.each([[['Forest', 'Island']], [['Wastes', 'Wastes']], [['Mountain', 'Mountain']]])(
    'CR 602.1a example: "{2}, {T}" is two mana of any type plus tapping the permanent (paid with %j)',
    (lands) => {
      let s = scenario(['Forest', 'Island', 'Wastes', 'Mountain'], { p1: { battlefield: ['Test Healer', ...lands!] }, defs: [healer()] });
      expect(legal(s, 'p1', 'activate').map((a) => a.label)).toContain('Test Healer: {2}, {T}: You gain 1 life.');
      s = act(s, activate(s));
      expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{2}', cancellable: true });
      s = answer(s, { kind: 'payCost', auto: true });
      expect(tappedNames(s)).toEqual(['Test Healer', ...lands!].sort());
      expect(s.zones.stack.map((id) => s.objects[id]!.kind)).toEqual(['ability']);
      expect(pool(s, 'p1')).toBe('');
    },
  );

  it('CR 602.1a example: with only one mana source the {2} part cannot be paid, and a tapped permanent cannot pay {T}', () => {
    const short = scenario(['Forest'], { p1: { battlefield: ['Test Healer', 'Forest'] }, defs: [healer()] });
    expect(reject(short, activate(short)).message).toMatch(/can't pay \{2\}/);
    expect(labels(short, 'p1').filter((l) => l.startsWith('Test Healer'))).toEqual([]);
    const tapped = scenario(['Forest'], { p1: { battlefield: [{ name: 'Test Healer', tapped: true }, 'Forest', 'Forest'] }, defs: [healer()] });
    expect(reject(tapped, activate(tapped)).message).toMatch(/already tapped/);
  });

  it('CR 602.1a: the activation cost must be paid by the player who is activating the ability (the opponent cannot activate it)', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Test Healer'] }, p2: { battlefield: ['Forest', 'Forest'] }, defs: [healer()] });
    s = pass(s); // Bob has priority
    expect(reject(s, activate(s, 'p2')).message).toMatch(/control/);
    expect(labels(s, 'p2').filter((l) => l.startsWith('Test Healer'))).toEqual([]);
  });
});

describe('CR 605.2: a mana ability stays a mana ability when it cannot produce mana', () => {
  // Gaea's Cradle: "{T}: Add {G} for each creature you control." Automated since FAST2 T7 (eff.t7.mana.forEach, CR 106.4): the amount is counted as the
  // ability resolves, and it is still a mana ability (CR 605.1a) even when it can produce no mana: it never uses the stack (CR 605.3b).
  const cradle = (s: GameState) => find(s, "Gaea's Cradle", 'battlefield');

  it('CR 605.2 example: with no creatures the ability is still a mana ability - it is listed as one, does not use the stack, and adds no mana', () => {
    let s = scenario(["Gaea's Cradle"], { p1: { battlefield: ["Gaea's Cradle"] } });
    expect(findAbility(s, cradle(s), 'p:0:0')!.def).toMatchObject({ kind: 'activated', isMana: true });
    expect(legal(s, 'p1', 'activate')).toMatchObject([{ isMana: true }]);
    s = act(s, { type: 'activate', player: 'p1', source: cradle(s), ability: 'p:0:0' });
    expect(s.zones.stack).toEqual([]); // CR 605.3b: no stack
    expect(pool(s, 'p1')).toBe(''); // zero creatures: zero {G}
    expect(isTapped(s, cradle(s))).toBe(true);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // still the same priority (CR 117.1d)
  });

  it("CR 605.2 example: an already tapped permanent's ability is still a mana ability, it just cannot be activated now", () => {
    const s = scenario(["Gaea's Cradle"], { p1: { battlefield: [{ name: "Gaea's Cradle", tapped: true }] } });
    expect(findAbility(s, cradle(s), 'p:0:0')!.def).toMatchObject({ kind: 'activated', isMana: true });
    expect(legal(s, 'p1', 'activate')).toEqual([]);
    const err = reject(s, { type: 'activate', player: 'p1', source: cradle(s), ability: 'p:0:0' });
    expect(err.message).toMatch(/already tapped/);
    expect(s.zones.stack).toEqual([]);
  });

  it('CR 605.2 (companion to the example): with creatures the ability adds one {G} for each, still without the stack', () => {
    let s = scenario(["Gaea's Cradle", 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ["Gaea's Cradle", 'Grizzly Bears', 'Hill Giant'] } });
    s = act(s, { type: 'activate', player: 'p1', source: cradle(s), ability: 'p:0:0' });
    expect(pool(s, 'p1')).toBe('GG');
    expect(s.zones.stack).toEqual([]);
  });
});

describe('CR 608.2b: targets that became illegal', () => {
  // Sorin's Thirst ({B}{B} instant): "deals 2 damage to target creature and you gain 2 life." The real card with a hand-built
  // ability model. Milestone 5 (W2 merge: WP10's interpreter, WP11's pipeline, WP12's damage and life ops) resolves both parts itself.
  const thirst = (): CardDef => withAbilities("Sorin's Thirst", [{
    kind: 'spell', text: "Sorin's Thirst deals 2 damage to target creature and you gain 2 life.",
    effect: { targets: [targetCreature], steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: targetCreature.id }, amount: 2 }, { op: 'gainLife', who: { ref: 'you' }, amount: 2 }] },
  }]);
  const board = (): GameState =>
    scenario(['Swamp', 'Mountain', 'Grizzly Bears', 'Lightning Bolt'], {
      p1: { hand: ["Sorin's Thirst"], battlefield: ['Swamp', 'Swamp'] },
      p2: { hand: ['Lightning Bolt'], battlefield: ['Grizzly Bears', 'Mountain'] },
      defs: [thirst()],
    });
  const castThirst = (s: GameState): GameState => castAuto(s, "Sorin's Thirst", { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'battlefield', 'p2') }] }] });

  it("CR 608.2b example (control case): while the creature is a legal target, Sorin's Thirst resolves and its controller applies both parts", () => {
    let s = castThirst(board());
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // both parts are performed by the engine (CR 608.2c)
    expect(life(s, 'p1')).toBe(22);
    // Milestone 4: the 2 damage is lethal to the 2/2 and state-based action 704.5g destroys it.
    expect(s.objects[bears]).toBeUndefined();
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Grizzly Bears']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(["Sorin's Thirst"]);
  });

  it("CR 608.2b example: if the creature isn't a legal target during resolution (it left the battlefield), Sorin's Thirst doesn't resolve and its controller doesn't gain any life", () => {
    let s = castThirst(board());
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    s = pass(s); // Alice passes; Bob responds
    s = castAuto(s, 'Lightning Bolt', { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] });
    s = passBoth(s); // Lightning Bolt resolves first (last in, first out)
    // WP18: Bolt resolves through the interpreter: 3 damage (CR 120.3), then state-based action 704.5g puts the creature into the graveyard.
    expect(s.objects[bears]).toBeUndefined();
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Grizzly Bears');
    expect(stackNames(s)).toEqual(["Sorin's Thirst"]);
    s = passBoth(s);
    // No manualResolve: the spell was removed from the stack without resolving, and went to its owner's graveyard.
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(stackNames(s)).toEqual([]);
    expect(life(s, 'p1')).toBe(20);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(["Sorin's Thirst"]);
    expect(s.log.some((l) => /Sorin's Thirst fizzles/.test(l.text) && l.rules?.includes('CR 608.2b'))).toBe(true);
    expect(s.log.some((l) => /Sorin's Thirst resolves\./.test(l.text))).toBe(false);
  });
});

describe('CR 608.2j: an effect checks only the characteristics it names', () => {
  // The effects "Destroy all black creatures" / "Destroy all nonblack creatures" are run by the milestone 5 interpreter; what
  // the example decides is which creatures their filters select, and the filter evaluation exists now.
  it('CR 608.2j example: "all black creatures" includes a white-and-black creature, "all nonblack creatures" does not', () => {
    const s = scenario(['Obzedat, Ghost Council', 'Serra Angel', 'Vampire Nighthawk'], { p1: { battlefield: ['Obzedat, Ghost Council', 'Serra Angel'] }, p2: { battlefield: ['Vampire Nighthawk'] } });
    const names = (f: Parameters<typeof findObjects>[1]) => findObjects(s, f, { you: 'p1', env: NO_ENV }).map((o) => s.defs[o.defId]!.name).sort();
    expect(getChars(s, find(s, 'Obzedat, Ghost Council', 'battlefield')).colors).toEqual(['W', 'B']);
    expect(names({ types: ['Creature'], colors: ['B'] })).toEqual(['Obzedat, Ghost Council', 'Vampire Nighthawk']);
    expect(names({ types: ['Creature'], notColors: ['B'] })).toEqual(['Serra Angel']);
  });
});

/*
 * Worked examples in the sections above that are NOT automated yet, and what they wait for.
 * (CR 116, 117 and 405 have no "Example:" paragraphs in this edition of the Comprehensive Rules, 2026-09-25.
 *  CR 107.3 has none either; X is covered by the tests named "CR 107.3" in payment.test.ts and review-casting.test.ts.)
 *
 *  CR 106.5   Meteor Crater ("Choose a color of a permanent you control. Add one mana of that color."): choosing a color from
 *             the colors of permanents, and producing no mana when there is none -> effect interpreter, milestone 5.
 *  CR 106.6   Doubling Cube: mana that can be spent only on creature spells, doubling unspent mana keeps the restriction ->
 *             mana spending restrictions and the "double the unspent mana" effect, milestone 5 (restrictions are never used by the payer today).
 *  CR 106.7   Exotic Orchard ("any color that a land an opponent controls could produce") -> "could produce" evaluation, milestone 5/6.
 *  CR 118.11  Psychic Vortex + Obstinate Familiar (paying a cost whose actions a replacement effect changes) -> replacement effects, milestone 6.
 *  CR 118.12  Standstill ("If you do" after an unpayable sacrifice) -> triggered abilities and the effect interpreter, milestone 5.
 *  CR 118.12  Gather Specimens + Dermoplasm (turning a morph face up, then a replacement effect on the creature put onto the battlefield)
 *             -> special action CR 116.2b / face-down permanents and replacement effects, milestone 6.
 *  CR 202.3b  Clone as a copy of Ravager of the Fells has mana value 0; Insectile Aberration becoming a copy of Ravager of the Fells has
 *             mana value 0 -> copy effects, milestone 6. (The first three sentences of the rule are tested above.)
 *  CR 601.2h  Altar's Reap + Thunderscape Familiar (the total cost is locked in before the sacrifice, so {B} is paid, not {1}{B}) ->
 *             cost reductions (a static ability) and additional costs written in Oracle text, milestones 5/6. The order of payment itself
 *             (tap costs, mana, then sacrifices) is tested in review-costs.test.ts.
 *  CR 601.3a  Void Winnower + Rolling Thunder (a restriction on casting by mana value, checked while X may still change) -> static
 *             "can't cast" effects, milestone 6; the X announcement exists (CR 107.3a).
 *  CR 601.3b  an effect that lets Aura spells be cast as though they had flash, with a bestow creature card -> bestow and static
 *             permission effects, milestone 5/6.
 *  CR 601.3e  Garruk's Horde / Melek, Izzet Paragon with Giant Killer // Chop Down (casting from the top of the library, judged with
 *             the characteristics of the face that would be cast) -> casting from the library, static permission effects, milestone 6.
 *  CR 601.4   Inscription of Abundance (modes chosen with "choose any number instead" if the spell was kicked) -> conditional mode counts;
 *             ModeSpec has a fixed minimum and maximum, milestone 5.
 *  CR 602.1a  (the example is tested above)
 *  CR 605.4a  a triggered mana ability that adds mana while a spell is being paid for -> triggered mana abilities, milestone 5.
 *  CR 608.2b  Plague Spores (the same creature land chosen for "target nonblack creature" and "target land"; its color is changed to
 *             black before resolution, so only one of the two targets is illegal and the spell still resolves) -> continuous
 *             color-changing effects (layers), milestone 6. The all-targets-illegal half of the rule is tested above.
 *  CR 608.2d  "You may sacrifice a creature. If you don't, you lose 4 life." with no creatures -> effect interpreter, milestone 5.
 *  CR 608.2e  Blatant Thievery (simultaneous control change of all targets) and Soulfire Eruption (one target at a time, with a
 *             library exile for each) -> effect interpreter, milestone 5.
 *  CR 608.2i  Search Party Captain (cost reduction from "creatures you attacked with this turn") -> combat history and cost
 *             reductions, milestones 4 and 5.
 *  CR 608.2k  Wall of Tears (a trigger referring to an object that stopped being a creature) -> triggers, combat and layers, milestones 4-6.
 *  CR 608.3e  Worms of the Earth + Clone copying Dryad Arbor (a permanent spell that cannot enter the battlefield goes to the
 *             graveyard) -> static "can't enter" effects and copy effects, milestone 6.
 */
