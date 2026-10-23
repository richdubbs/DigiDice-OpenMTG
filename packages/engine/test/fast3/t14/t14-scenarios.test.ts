/**
 * T14 (FAST3 wave: pay-or-sacrifice and counter-unless payments, graveyard and library targets, combat-damage-bound triggers): the cards the T14 templates,
 * renderer, anaphora and engine changes automate, played through applyAction with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10). Each test is named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice, type TargetSpec } from '../../../src/index';
import { sameOwnerHolds } from '../../../src/rules/targets';
import { act, answer, find, findAll, legal, pass, passBoth, scenario } from '../../m3/scenario';
import { lifeOf, runCombat } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const zone = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones[z][p]!;
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const onField = (s: GameState, name: string): boolean => findAll(s, name, 'battlefield').length > 0;

/** Cast a p1 card with the given targets and pay automatically; the spell is on the stack (or a decision is pending). */
function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

/** Activate the only non-mana ability of a permanent and pay automatically. */
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = []): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === source && !x.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  let s = act(s0, a.action);
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}

const yes = { kind: 'yesNo' as const, yes: true };
const no = { kind: 'yesNo' as const, yes: false };
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

describe('CR 118.12, 118.12a, 118.3: "sacrifice it unless you return an untapped Island you control to its owner\'s hand"', () => {
  const DJINN = card('Test Spout Djinn', 'Creature — Djinn', "When ~ enters, sacrifice it unless you return an untapped Island you control to its owner's hand.", '{0}', ['4', '4']);
  const board = (islands: { tapped?: boolean }[]): GameState =>
    scenario(['Island'], { p1: { hand: ['Test Spout Djinn'], battlefield: islands.map((o) => ({ name: 'Island', ...o })) }, defs: [DJINN] });
  /** Cast the Djinn and let its trigger reach the payment question. */
  const toPayment = (s0: GameState): GameState => passBoth(passBoth(cast(s0, 'Test Spout Djinn')));
  it('the card is automated: one pay step whose cost returns an untapped Island you control and whose else sacrifices the creature', () => {
    expect(manualParts(DJINN)).toEqual([]);
    const ab = DJINN.faces[0]!.abilities[0]!;
    expect(JSON.stringify(ab)).toContain('"cost":{"other":[{"kind":"returnToHand","filter":{"tapped":false,"subtypes":["Island"],"controller":"you"},"count":1}]}');
  });
  it('CR 118.12a: paying is a choice: yes returns the Island and the creature stays', () => {
    let s = toPayment(board([{}]));
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, yes);
    while (s.pending && s.pending.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: ObjectId[] }).options.slice(0, 1) });
    expect(onField(s, 'Test Spout Djinn')).toBe(true);
    expect(zone(s, 'hand').map((id) => nameOf(s, id))).toContain('Island');
    expect(onField(s, 'Island')).toBe(false);
  });
  it('CR 118.12a: declining sacrifices the creature and keeps the Island', () => {
    let s = toPayment(board([{}]));
    s = answer(s, no);
    expect(onField(s, 'Test Spout Djinn')).toBe(false);
    expect(zone(s, 'graveyard').map((id) => nameOf(s, id))).toContain('Test Spout Djinn');
    expect(onField(s, 'Island')).toBe(true);
  });
  it('CR 118.3: only a tapped Island: the cost can\'t be paid, nobody is asked, and the creature is sacrificed', () => {
    const s = toPayment(board([{ tapped: true }]));
    expect(s.pending?.kind).toBe('priority');
    expect(onField(s, 'Test Spout Djinn')).toBe(false);
    expect(onField(s, 'Island')).toBe(true);
  });
});

describe('CR 118.12, 701.9a: "sacrifice it unless you discard a land card"', () => {
  const WURM = card('Test Rumble Wurm', 'Creature — Wurm', 'When ~ enters, sacrifice it unless you discard a land card.', '{0}', ['6', '6']);
  it('only a land card may be discarded; with none in hand the creature is sacrificed', () => {
    expect(manualParts(WURM)).toEqual([]);
    let s = passBoth(passBoth(cast(scenario(['Island', 'Lightning Bolt'], { p1: { hand: ['Test Rumble Wurm', 'Island', 'Lightning Bolt'] }, defs: [WURM] }), 'Test Rumble Wurm')));
    s = answer(s, yes);
    if (s.pending?.kind === 'chooseObjects') {
      const options = (s.pending as unknown as { options: ObjectId[] }).options;
      expect(options.map((id) => nameOf(s, id))).toEqual(['Island']);
      s = answer(s, { kind: 'chooseObjects', ids: options });
    }
    expect(onField(s, 'Test Rumble Wurm')).toBe(true);
    expect(zone(s, 'graveyard').map((id) => nameOf(s, id))).toEqual(['Island']);
    const t = passBoth(passBoth(cast(scenario(['Lightning Bolt'], { p1: { hand: ['Test Rumble Wurm', 'Lightning Bolt'] }, defs: [WURM] }), 'Test Rumble Wurm')));
    expect(t.pending?.kind).toBe('priority');
    expect(onField(t, 'Test Rumble Wurm')).toBe(false); // the Bolt stays in hand
    expect(zone(t, 'hand').map((id) => nameOf(t, id))).toEqual(['Lightning Bolt']);
  });
});

describe('CR 118.3, 118.12: "sacrifice it unless you return an enchantment to its owner\'s hand" may return any player\'s enchantment', () => {
  const DRAKE = card('Test Mist Drake', 'Creature — Drake', "When ~ enters, sacrifice it unless you return an enchantment to its owner's hand.", '{0}', ['2', '2']);
  const AURA = card('Test Glow Field', 'Enchantment', 'You gain 0 life.', '{1}');
  it('the opponent\'s enchantment is offered and goes to its owner\'s hand', () => {
    let s = passBoth(passBoth(cast(scenario([], { p1: { hand: ['Test Mist Drake'] }, p2: { battlefield: ['Test Glow Field'] }, defs: [DRAKE, AURA] }), 'Test Mist Drake')));
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    s = answer(s, yes);
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: ObjectId[] }).options.slice(0, 1) });
    expect(onField(s, 'Test Mist Drake')).toBe(true);
    expect(zone(s, 'hand', 'p2').map((id) => nameOf(s, id))).toEqual(['Test Glow Field']);
  });
});

describe('CR 118.3, 404.1: "sacrifice it unless you return a basic land card from your graveyard to your hand"', () => {
  const HWURM = card('Test Reaping Wurm', 'Creature — Wurm', 'When ~ enters, sacrifice it unless you return a basic land card from your graveyard to your hand.', '{0}', ['6', '5']);
  it('a basic land card of your graveyard is offered (not a land on the battlefield) and goes to your hand', () => {
    expect(manualParts(HWURM)).toEqual([]);
    let s = passBoth(passBoth(cast(scenario(['Forest', 'Island'], { p1: { hand: ['Test Reaping Wurm'], graveyard: ['Forest'], battlefield: ['Island'] }, p2: { graveyard: ['Island'] }, defs: [HWURM] }), 'Test Reaping Wurm')));
    s = answer(s, yes);
    if (s.pending?.kind === 'chooseObjects') {
      const options = (s.pending as unknown as { options: ObjectId[] }).options;
      expect(options.map((id) => `${nameOf(s, id)}@${s.objects[id]!.zone}`)).toEqual(['Forest@graveyard']);
      s = answer(s, { kind: 'chooseObjects', ids: options });
    }
    expect(onField(s, 'Test Reaping Wurm')).toBe(true);
    expect(zone(s, 'hand').map((id) => nameOf(s, id))).toEqual(['Forest']);
    expect(onField(s, 'Island')).toBe(true);
  });
});

describe('CR 115.1, 601.2c: "exile up to two target cards from a single graveyard" (TargetSpec.sameOwner)', () => {
  const DECAY = card('Test Dust Decay', 'Sorcery', 'Exile up to two target cards from a single graveyard.', '{0}');
  const board = (): GameState => scenario(['Island', 'Forest', 'Mountain'], { p1: { hand: ['Test Dust Decay'], graveyard: ['Island'] }, p2: { graveyard: ['Forest', 'Mountain'] }, defs: [DECAY] });
  it('the spec says one owner and the card is automated', () => {
    expect(manualParts(DECAY)).toEqual([]);
    const spec = (DECAY.faces[0]!.abilities[0] as { effect: { targets: TargetSpec[] } }).effect.targets[0]!;
    expect(spec).toMatchObject({ min: 0, max: 2, sameOwner: true, filter: { zone: 'graveyard' } });
  });
  it('whose cards are chosen first; then only that player\'s cards are offered, and both are exiled', () => {
    let s = act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Dust Decay', 'hand', 'p1') });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    const options = (s.pending as unknown as { options: { id: string }[] }).options.map((o) => o.id);
    expect(options.sort()).toEqual(['p1', 'p2']);
    s = answer(s, { kind: 'chooseOption', ids: ['p2'] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 2 });
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered.map((id) => nameOf(s, id)).sort()).toEqual(['Forest', 'Mountain']);
    s = answer(s, { kind: 'chooseTargets', targets: offered.map(obj) });
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'payCost', auto: true });
    s = passBoth(s);
    expect(zone(s, 'graveyard', 'p2')).toEqual([]);
    expect(zone(s, 'graveyard').map((id) => nameOf(s, id))).toContain('Island');
  });
  it('one player has cards there: no question about whose', () => {
    const s0 = scenario(['Forest', 'Mountain'], { p1: { hand: ['Test Dust Decay'] }, p2: { graveyard: ['Forest', 'Mountain'] }, defs: [DECAY] });
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dust Decay', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
  });
  it('CR 115.1: sameOwnerHolds refuses targets of two owners (the check behind the announcement)', () => {
    const s = board();
    const spec = (DECAY.faces[0]!.abilities[0] as { effect: { targets: TargetSpec[] } }).effect.targets[0]!;
    const island = find(s, 'Island', 'graveyard', 'p1');
    const forest = find(s, 'Forest', 'graveyard', 'p2');
    const mountain = find(s, 'Mountain', 'graveyard', 'p2');
    expect(sameOwnerHolds(s, spec, [obj(forest), obj(mountain)])).toBe(true);
    expect(sameOwnerHolds(s, spec, [obj(island), obj(forest)])).toBe(false);
    expect(sameOwnerHolds(s, { ...spec, sameOwner: undefined }, [obj(island), obj(forest)])).toBe(true);
  });
});

describe('CR 115.1, 601.2c: "target player shuffles up to two target cards from their graveyard into their library"', () => {
  const BLESS = card('Test Tidal Blessing', 'Sorcery', 'Target player shuffles up to two target cards from their graveyard into their library.', '{0}');
  it('the cards are chosen from the chosen player\'s graveyard only, go to that library, and it is shuffled', () => {
    expect(manualParts(BLESS)).toEqual([]);
    const s0 = scenario(['Island', 'Forest'], { p1: { hand: ['Test Tidal Blessing'], graveyard: ['Island'] }, p2: { graveyard: ['Forest'] }, defs: [BLESS] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tidal Blessing', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered.map((id) => nameOf(s, id))).toEqual(['Forest']);
    s = answer(s, { kind: 'chooseTargets', targets: offered.map(obj) });
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'payCost', auto: true });
    const libBefore = zone(s, 'library', 'p2').length;
    s = passBoth(s);
    expect(zone(s, 'graveyard', 'p2')).toEqual([]);
    expect(zone(s, 'library', 'p2')).toHaveLength(libBefore + 1);
    expect(zone(s, 'graveyard').map((id) => nameOf(s, id))).toEqual(['Island', 'Test Tidal Blessing']);
  });
});

describe('CR 120.1, 400.7, 603.10a: "whenever a creature dealt damage by ~ this turn dies" (filter dealtDamageBySourceThisTurn)', () => {
  const DRINKER = card('Test Blood Sipper', 'Creature — Vampire', 'Whenever a creature dealt damage by ~ this turn dies, you gain 3 life.\n{0}: ~ deals 1 damage to target creature.', '{0}', ['2', '2']);
  const PUP = card('Test Pup', 'Creature — Dog', 'You gain 0 life.', '{1}', ['1', '1']);
  const board = (): GameState => scenario(['Lightning Bolt', 'Mountain'], { p1: { battlefield: ['Test Blood Sipper', 'Mountain'], hand: ['Lightning Bolt'] }, p2: { battlefield: ['Test Pup'] }, defs: [DRINKER, PUP] });
  it('the trigger is automated with the new filter', () => {
    expect(manualParts(DRINKER)).toEqual([]);
    expect(JSON.stringify(DRINKER.faces[0]!.abilities[0])).toContain('"dealtDamageBySourceThisTurn":true');
  });
  it('a creature this object damaged dies: the ability triggers', () => {
    let s = board();
    const pup = find(s, 'Test Pup', 'battlefield', 'p2');
    s = activate(s, find(s, 'Test Blood Sipper', 'battlefield', 'p1'), [obj(pup)]);
    s = passBoth(s); // the damage resolves, the Pup dies (CR 704.5g), the trigger goes on the stack
    s = passBoth(s);
    expect(lifeOf(s, 'p1')).toBe(23);
  });
  it('a creature another source damaged dies: no trigger', () => {
    let s = board();
    const pup = find(s, 'Test Pup', 'battlefield', 'p2');
    s = cast(s, 'Lightning Bolt', [obj(pup)]);
    s = passBoth(s);
    expect(onField(s, 'Test Pup')).toBe(false);
    expect(s.zones.stack).toEqual([]);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 509.1, 603.7c: "whenever ~ blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat"', () => {
  const BASILISK = card('Test Stone Lizard', 'Creature — Basilisk', 'Whenever ~ blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.', '{0}', ['4', '3']);
  it('the other creature of each pattern is the event role `object` (the attacker it blocks; the creature blocking it)', () => {
    expect(manualParts(BASILISK)).toEqual([]);
    expect(JSON.stringify(BASILISK.faces[0]!.abilities[0])).toContain('"what":{"ref":"event","role":"object"}');
  });
  it('becomes blocked: the blocker is destroyed at end of combat (CR 603.7: a delayed trigger fixed on that creature), not the Basilisk', () => {
    const TURTLE = card('Test Shell Turtle', 'Creature — Turtle', 'You gain 0 life.', '{1}', ['1', '9']);
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Stone Lizard', since: -1 }] }, p2: { battlefield: ['Test Shell Turtle'] }, defs: [BASILISK, TURTLE] });
    const lizard = find(s, 'Test Stone Lizard', 'battlefield', 'p1');
    const turtle = find(s, 'Test Shell Turtle', 'battlefield', 'p2');
    s = runCombat(s, { attack: [[lizard, 'p2']], block: [[turtle, lizard]], assign: { [lizard]: [{ id: turtle, amount: 4 }] } });
    expect(onField(s, 'Test Shell Turtle')).toBe(true); // 4 damage to a 1/9 (CR 510.2)
    // the end of combat step began: the delayed trigger is on the stack (CR 603.7, 511.2)
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(onField(s, 'Test Shell Turtle')).toBe(false);
    expect(onField(s, 'Test Stone Lizard')).toBe(true);
  });
});

describe('CR 118.12a: "counter that spell or ability unless its controller pays {2}" (Frost Titan shape)', () => {
  const GIANT = card('Test Frost Giant', 'Creature — Giant', 'Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless its controller pays {2}.', '{0}', ['6', '6']);
  it('"its controller" is the controller of the spell or ability, and the spell is countered when they don\'t pay', () => {
    expect(manualParts(GIANT)).toEqual([]);
    const step = JSON.stringify(GIANT.faces[0]!.abilities[0]);
    expect(step).toContain('"who":{"ref":"controllerOf","object":{"ref":"event","role":"spell"}}');
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { battlefield: ['Test Frost Giant'] }, p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, defs: [GIANT] });
    const giant = find(s, 'Test Frost Giant', 'battlefield', 'p1');
    s = pass(s); // p2 gets priority
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Lightning Bolt', 'hand', 'p2') });
    while (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(giant)] });
      else s = answer(s, { kind: 'payCost', auto: true });
    }
    // the trigger goes on the stack above the Bolt and resolves first; p2 has no mana left, so they can't pay (CR 118.3) and the Bolt is countered
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'yesNo' ? answer(s, no) : pass(s);
    expect(onField(s, 'Test Frost Giant')).toBe(true);
    expect(s.objects[giant]!.damage).toBe(0);
    expect(zone(s, 'graveyard', 'p2').map((id) => nameOf(s, id))).toContain('Lightning Bolt');
  });
});

describe('CR 401.2: "look at the top card of target player\'s library" and "target opponent exiles the top card of their library"', () => {
  const EYE = card('Test Peeping Eye', 'Creature — Merfolk', "When ~ enters, look at the top card of target player's library.", '{0}', ['1', '1']);
  const HARVEST = card('Test Mind Harvest', 'Sorcery', 'Target opponent exiles the top card of their library.', '{0}');
  it('both are automated', () => {
    expect(manualParts(EYE)).toEqual([]);
    expect(manualParts(HARVEST)).toEqual([]);
  });
  it('the opponent\'s top card is exiled', () => {
    let s = scenario([], { p1: { hand: ['Test Mind Harvest'] }, defs: [HARVEST] });
    const top = s.objects[zone(s, 'library', 'p2')[0]!]!.cardId;
    const size = zone(s, 'library', 'p2').length;
    s = passBoth(cast(s, 'Test Mind Harvest', [{ kind: 'player', id: 'p2' }]));
    expect(s.zones.exile.map((id) => s.objects[id]!.cardId)).toEqual([top]); // a new object in exile (CR 400.7), the same card
    expect(zone(s, 'library', 'p2')).toHaveLength(size - 1);
  });
});
