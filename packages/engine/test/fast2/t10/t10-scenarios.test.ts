/**
 * T10 (FAST2 wave, template family: library searches, zone moves, event-bound and anaphoric object instructions): the cards the T10 templates and renderer
 * and anaphora changes automate, played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design
 * 6.10). Each test is named after the rule it checks.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, castAuto, find, findAll, legal, passBoth, scenario } from '../../m3/scenario';
import { runCombat } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const lib = (s: GameState, p: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones.library[p]!;
const hand = (s: GameState, p: 'p1' | 'p2' = 'p1'): ObjectId[] => s.zones.hand[p]!;
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;

/** Cast a p1 card with the given targets and pay automatically; the spell is on the stack. */
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

describe('CR 701.23a, 608.2d: "you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle"', () => {
  const SEEKER = card('Test Root Seeker', 'Creature — Elf', 'When ~ enters, you may search your library for a basic Forest card, put it onto the battlefield tapped, then shuffle.', '{0}', ['1', '1']);
  const board = (): GameState => scenario(['Forest', 'Island'], { p1: { hand: ['Test Root Seeker'], library: ['Island', 'Forest'] }, defs: [SEEKER] });
  it('the card is automated (no manual step)', () => expect(manualParts(SEEKER)).toEqual([]));
  it('CR 701.23a, 110.5b: yes: the chosen Forest enters tapped, the Island is never offered, and the library is shuffled (new ids, CR 701.24a)', () => {
    let s = passBoth(cast(board(), 'Test Root Seeker')); // the creature resolves, its trigger goes on the stack
    s = passBoth(s);
    expect(s.pending?.kind).toBe('yesNo');
    const before = [...lib(s)];
    s = answer(s, yes);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s, id))).toEqual(['Forest']);
    s = answer(s, { kind: 'chooseObjects', ids: options });
    const forest = find(s, 'Forest', 'battlefield', 'p1');
    expect(s.objects[forest]!.tapped).toBe(true);
    expect(lib(s).some((id) => before.includes(id))).toBe(false);
    expect(lib(s)).toHaveLength(before.length - 1);
  });
  it('CR 608.2d: no: nothing is searched and the library is not shuffled (the shuffle is part of the choice)', () => {
    let s = passBoth(passBoth(cast(board(), 'Test Root Seeker')));
    const before = [...lib(s)];
    s = answer(s, no);
    expect(lib(s)).toEqual(before);
    expect(findAll(s, 'Forest', 'battlefield')).toEqual([]);
  });
});

describe('CR 701.23a, 701.20a: "..., reveal it, put it into your hand, then shuffle" inside "you may"', () => {
  const SCOUT = card('Test Path Scout', 'Creature — Human', 'When ~ enters, you may search your library for a basic Island card, reveal it, put it into your hand, then shuffle.', '{0}', ['1', '1']);
  it('the found Island goes to the hand', () => {
    expect(manualParts(SCOUT)).toEqual([]);
    let s = passBoth(passBoth(cast(scenario(['Island'], { p1: { hand: ['Test Path Scout'], library: ['Island'] }, defs: [SCOUT] }), 'Test Path Scout')));
    s = answer(s, yes);
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    s = answer(s, { kind: 'chooseObjects', ids: options });
    expect(hand(s).map((id) => nameOf(s, id))).toEqual(['Island']);
  });
});

describe('CR 701.23a, 701.24a: "search your library for ..., reveal it, then shuffle and put that card on top"', () => {
  const TUTOR = card('Test Gear Tutor', 'Instant', 'Search your library for an artifact card, reveal it, then shuffle and put that card on top.');
  it('CR 701.24a: the library is shuffled first, then the found card is its top card', () => {
    expect(manualParts(TUTOR)).toEqual([]);
    let s = passBoth(cast(scenario(['Sol Ring', 'Island'], { p1: { hand: ['Test Gear Tutor'], library: ['Island', 'Island', 'Sol Ring'] }, defs: [TUTOR] }), 'Test Gear Tutor'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects' });
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s, id))).toEqual(['Sol Ring']);
    s = answer(s, { kind: 'chooseObjects', ids: options });
    expect(nameOf(s, lib(s)[0]!)).toBe('Sol Ring');
    expect(findAll(s, 'Sol Ring', 'library')).toHaveLength(1);
  });
});

describe('CR 401.4: "look at the top three cards of your library, then put them back in any order"', () => {
  const SEER = card('Test Pool Seer', 'Sorcery', 'Look at the top three cards of your library, then put them back in any order.');
  it('the owner orders exactly those three cards on top; the rest of the library is untouched', () => {
    expect(manualParts(SEER)).toEqual([]);
    let s = passBoth(cast(scenario(['Forest', 'Island', 'Swamp', 'Mountain'], { p1: { hand: ['Test Pool Seer'], library: ['Forest', 'Island', 'Swamp', 'Mountain'] }, defs: [SEER] }), 'Test Pool Seer'));
    const rest = lib(s).slice(3).map((id) => nameOf(s, id));
    expect(s.pending).toMatchObject({ kind: 'order', player: 'p1' });
    const items = (s.pending as unknown as { items: { id: string; label: string }[] }).items;
    expect(items.map((i) => i.label).sort()).toEqual(['Forest', 'Island', 'Swamp']);
    // put them back as Swamp, Forest, Island from the top
    const pick = (n: string): string => items.find((i) => i.label === n)!.id;
    s = answer(s, { kind: 'order', ids: [pick('Swamp'), pick('Forest'), pick('Island')] });
    expect(lib(s).slice(0, 4).map((id) => nameOf(s, id))).toEqual(['Swamp', 'Forest', 'Island', 'Mountain']);
    expect(lib(s).slice(3).map((id) => nameOf(s, id))).toEqual(rest);
  });
});

describe('CR 610.3, 603.7c, 400.7: exile, then return at the beginning of the next end step', () => {
  const MIST = card('Test Mist Step', 'Instant', "Exile target creature. Return that card to the battlefield under its owner's control at the beginning of the next end step.");
  const board = (): GameState => scenario(['Grizzly Bears'], { p1: { hand: ['Test Mist Step'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [MIST] });
  it('CR 610.3: the exiled card returns under its owner\'s control at the next end step, as a new object (CR 400.7)', () => {
    expect(manualParts(MIST)).toEqual([]);
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    let s = passBoth(cast(s0, 'Test Mist Step', [{ kind: 'object', id: bears }]));
    expect(findAll(s, 'Grizzly Bears', 'exile')).toHaveLength(1);
    s = advanceTo(s, 1, 'end');
    s = passBoth(s);
    const back = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    expect(back).not.toBe(bears);
    expect(s.objects[back]!.controller).toBe('p2');
  });
  it('CR 400.7, 603.7c: a card that left exile before the end step is a new object; the delayed trigger does not return it', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    let s = passBoth(cast(s0, 'Test Mist Step', [{ kind: 'object', id: bears }]));
    // move the exiled card to its owner's graveyard (test setup)
    const exiled = find(s, 'Grizzly Bears', 'exile');
    s = structuredClone(s);
    s.zones.exile = s.zones.exile.filter((id) => id !== exiled);
    s.objects[exiled]!.zone = 'graveyard';
    s.zones.graveyard.p2 = [...s.zones.graveyard.p2!, exiled];
    s = advanceTo(s, 1, 'end');
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toEqual([]);
  });
});

describe('CR 610.3: "Exile ~. Return it to the battlefield under its owner\'s control at the beginning of the next end step."', () => {
  const SHIMMER = card('Test Shimmer Wisp', 'Creature — Spirit', "{0}: Exile ~. Return it to the battlefield under its owner's control at the beginning of the next end step.", '{0}', ['2', '2']);
  it('the object leaves and a new object with the same card returns at the end step', () => {
    expect(manualParts(SHIMMER)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Shimmer Wisp'] }, defs: [SHIMMER] });
    const wisp = find(s0, 'Test Shimmer Wisp', 'battlefield');
    let s = passBoth(activate(s0, wisp));
    expect(findAll(s, 'Test Shimmer Wisp', 'exile')).toHaveLength(1);
    s = passBoth(advanceTo(s, 1, 'end'));
    const back = find(s, 'Test Shimmer Wisp', 'battlefield', 'p1');
    expect(back).not.toBe(wisp);
  });
});

describe('CR 603.7c, 506.4: "Whenever ~ blocks a creature, destroy that creature at end of combat."', () => {
  const MEDUSA = card('Test Stone Gazer', 'Creature — Gorgon', 'Whenever ~ blocks a creature, destroy that creature at end of combat.', '{0}', ['1', '4']);
  it('the creature it blocked is destroyed at end of combat, not the blocker itself', () => {
    expect(manualParts(MEDUSA)).toEqual([]);
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Test Stone Gazer'] }, defs: [MEDUSA] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    const gazer = find(s0, 'Test Stone Gazer', 'battlefield', 'p2');
    let s = runCombat(s0, { attack: [[bears]], block: [[gazer, bears]] });
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toHaveLength(1); // still there before the delayed trigger resolves
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toEqual([]);
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Stone Gazer', 'battlefield', 'p2')).toHaveLength(1);
  });
});

describe('CR 509.1, 201.5: "Whenever ~ becomes blocked by an artifact creature, destroy that creature."', () => {
  const LEADFOOT = card('Test Iron Stomper', 'Creature — Ogre', 'Whenever ~ becomes blocked by an artifact creature, destroy that creature.', '{0}', ['3', '3']);
  it('"that creature" is the blocker, never ~ itself', () => {
    expect(manualParts(LEADFOOT)).toEqual([]);
    const s0 = scenario(['Ornithopter'], { p1: { battlefield: ['Test Iron Stomper'] }, p2: { battlefield: ['Ornithopter'] }, defs: [LEADFOOT] });
    const stomper = find(s0, 'Test Iron Stomper', 'battlefield', 'p1');
    const thopter = find(s0, 'Ornithopter', 'battlefield', 'p2');
    const s = runCombat(s0, { attack: [[stomper]], block: [[thopter, stomper]] });
    expect(findAll(s, 'Ornithopter', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Iron Stomper', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('CR 603.10a, 603.7c: "When ~ dies, return it to its owner\'s hand at the beginning of the next end step."', () => {
  const PHOENIX = card('Test Ember Phoenix', 'Creature — Phoenix', "When ~ dies, return it to its owner's hand at the beginning of the next end step.", '{0}', ['2', '2']);
  const BOLT = 'Lightning Bolt';
  it('the card goes back to the hand from the graveyard at the end step', () => {
    expect(manualParts(PHOENIX)).toEqual([]);
    const s0 = scenario([BOLT, 'Mountain'], { p1: { hand: [BOLT], battlefield: ['Test Ember Phoenix', 'Mountain'] }, defs: [PHOENIX] });
    const phoenix = find(s0, 'Test Ember Phoenix', 'battlefield');
    let s = passBoth(cast(s0, BOLT, [{ kind: 'object', id: phoenix }]));
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(findAll(s, 'Test Ember Phoenix', 'graveyard', 'p1')).toHaveLength(1);
    s = advanceTo(s, 1, 'end');
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(hand(s).map((id) => nameOf(s, id))).toContain('Test Ember Phoenix');
  });
});

describe('CR 301.5c, 701.3a: Equipment that attaches itself', () => {
  const BLADE = card('Test Squire Blade', 'Artifact — Equipment', 'When ~ enters, create a 1/1 white Soldier creature token, then attach ~ to it.\nEquipped creature gets +1/+1.\nEquip {1}');
  const RIG = card('Test Quick Rig', 'Artifact — Equipment', 'Whenever a creature you control enters, you may attach ~ to it.\nEquipped creature gets +1/+1.\nEquip {2}');
  it('"create a token, then attach ~ to it": the Equipment is attached to the token', () => {
    expect(manualParts(BLADE)).toEqual([]);
    let s = passBoth(cast(scenario([], { p1: { hand: ['Test Squire Blade'] }, defs: [BLADE] }), 'Test Squire Blade'));
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    const blade = find(s, 'Test Squire Blade', 'battlefield');
    expect(s.objects[blade]!.attachedTo).toBe(token);
  });
  it('"you may attach ~ to it": yes attaches it to the creature that entered', () => {
    expect(manualParts(RIG)).toEqual([]);
    let s = passBoth(cast(scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Test Quick Rig', 'Forest', 'Forest'] }, defs: [RIG] }), 'Grizzly Bears'));
    s = passBoth(s);
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, yes);
    expect(s.objects[find(s, 'Test Quick Rig', 'battlefield')]!.attachedTo).toBe(find(s, 'Grizzly Bears', 'battlefield'));
  });
});

describe('CR 406.1, 608.2d: "target opponent exiles a card from their hand"', () => {
  const SNAIL = card('Test Mind Snail', 'Sorcery', 'Target opponent exiles a card from their hand.');
  it('the opponent chooses one of their own cards and exiles it', () => {
    expect(manualParts(SNAIL)).toEqual([]);
    let s = passBoth(cast(scenario(['Island', 'Forest'], { p1: { hand: ['Test Mind Snail'] }, p2: { hand: ['Island', 'Forest'] }, defs: [SNAIL] }), 'Test Mind Snail', [{ kind: 'player', id: 'p2' }]));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2', min: 1, max: 1 });
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s, id)).sort()).toEqual(['Forest', 'Island']);
    s = answer(s, { kind: 'chooseObjects', ids: [options.find((id) => nameOf(s, id) === 'Forest')!] });
    expect(findAll(s, 'Forest', 'exile')).toHaveLength(1);
    expect(hand(s, 'p2').map((id) => nameOf(s, id))).toEqual(['Island']);
  });
});

describe('CR 110.5b, 608.2d: "you may put a land card from your hand onto the battlefield tapped"', () => {
  const GRAZER = card('Test Field Grazer', 'Sorcery', 'You may put a land card from your hand onto the battlefield tapped.');
  it('the chosen land enters tapped; a nonland card is not offered', () => {
    expect(manualParts(GRAZER)).toEqual([]);
    let s = passBoth(cast(scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Test Field Grazer', 'Forest', 'Grizzly Bears'] }, defs: [GRAZER] }), 'Test Field Grazer'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 1 });
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s, id))).toEqual(['Forest']);
    s = answer(s, { kind: 'chooseObjects', ids: options });
    expect(s.objects[find(s, 'Forest', 'battlefield')]!.tapped).toBe(true);
  });
});

describe('CR 110.4, 202.3: "search your library for a Goblin permanent card with mana value 2 or less"', () => {
  const RECRUITER = card('Test Goblin Herald', 'Creature — Goblin', '{0}: Search your library for a Goblin permanent card with mana value 2 or less, put it onto the battlefield, then shuffle.', '{0}', ['1', '1']);
  const BIG = card('Test Goblin Warlord', 'Creature — Goblin', '', '{3}{R}', ['4', '4']);
  const TRICK = card('Test Goblin Trick', 'Kindred Instant — Goblin', 'Draw a card.', '{R}');
  it('only a permanent card with the subtype and mana value 2 or less is offered', () => {
    expect(manualParts(RECRUITER)).toEqual([]);
    const s0 = scenario(['Raging Goblin', 'Grizzly Bears'], { p1: { battlefield: ['Test Goblin Herald'], library: ['Test Goblin Warlord', 'Test Goblin Trick', 'Grizzly Bears', 'Raging Goblin'] }, defs: [RECRUITER, BIG, TRICK] });
    let s = passBoth(activate(s0, find(s0, 'Test Goblin Herald', 'battlefield')));
    const options = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(options.map((id) => nameOf(s, id))).toEqual(['Raging Goblin']);
    s = answer(s, { kind: 'chooseObjects', ids: options });
    expect(findAll(s, 'Raging Goblin', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('CR 205.2a, 205.3, 115.1: "Destroy target creature or Vehicle."', () => {
  const WRECK = card('Test Road Wreck', 'Instant', 'Destroy target creature or Vehicle.');
  const CART = card('Test War Cart', 'Artifact — Vehicle', 'Crew 1', '{1}', ['3', '3']);
  it('a creature or a Vehicle may be targeted, another artifact may not', () => {
    expect(manualParts(WRECK)).toEqual([]);
    const s0 = scenario(['Grizzly Bears', 'Sol Ring'], { p1: { hand: ['Test Road Wreck'] }, p2: { battlefield: ['Grizzly Bears', 'Sol Ring', 'Test War Cart'] }, defs: [WRECK, CART] });
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Road Wreck', 'hand') });
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = JSON.stringify(s.pending);
    expect(offered).toContain(find(s0, 'Grizzly Bears', 'battlefield'));
    expect(offered).toContain(find(s0, 'Test War Cart', 'battlefield'));
    expect(offered).not.toContain(`"${find(s0, 'Sol Ring', 'battlefield')}"`);
    const cart = find(s0, 'Test War Cart', 'battlefield');
    const done = passBoth(cast(s0, 'Test Road Wreck', [{ kind: 'object', id: cart }]));
    expect(findAll(done, 'Test War Cart', 'graveyard', 'p2')).toHaveLength(1);
  });
});

describe('CR 701.21a, 603.2: "When ~ becomes the target of a spell or ability, sacrifice it."', () => {
  const BEAR = card('Test Glass Bear', 'Creature — Bear Illusion', 'When ~ becomes the target of a spell or ability, sacrifice it.', '{0}', ['3', '3']);
  it('the creature is sacrificed when its trigger resolves, before the spell that targeted it', () => {
    expect(manualParts(BEAR)).toEqual([]);
    const s0 = scenario(['Shock', 'Mountain'], { p1: { hand: ['Shock'], battlefield: ['Mountain'] }, p2: { battlefield: ['Test Glass Bear'] }, defs: [BEAR] });
    const bear = find(s0, 'Test Glass Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Shock', [{ kind: 'object', id: bear }]);
    expect(s.zones.stack).toHaveLength(2); // Shock, then the trigger on top
    s = passBoth(s);
    expect(findAll(s, 'Test Glass Bear', 'graveyard', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Shock', 'battlefield')).toEqual([]);
  });
});

describe('CR 603.7c, 506.4: "Whenever ~ blocks a creature, return that creature to its owner\'s hand at end of combat."', () => {
  const WALL = card('Test Tide Wall', 'Creature — Wall', "Defender\nWhenever ~ blocks a creature, return that creature to its owner's hand at end of combat.", '{0}', ['0', '5']);
  it('the blocked creature goes back to its owner\'s hand at end of combat', () => {
    expect(manualParts(WALL)).toEqual([]);
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Test Tide Wall'] }, defs: [WALL] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    let s = runCombat(s0, { attack: [[bears]], block: [[find(s0, 'Test Tide Wall', 'battlefield'), bears]] });
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(hand(s).map((id) => nameOf(s, id))).toContain('Grizzly Bears');
    expect(findAll(s, 'Grizzly Bears', 'battlefield')).toEqual([]);
  });
});

describe('CR 400.7, 603.10a: "Whenever a creature you control dies, return that card to its owner\'s hand."', () => {
  const SHRINE = card('Test Recall Shrine', 'Enchantment', "Whenever a creature you control dies, return that card to its owner's hand.");
  it('the card that died goes from the graveyard to its owner\'s hand', () => {
    expect(manualParts(SHRINE)).toEqual([]);
    const s0 = scenario(['Grizzly Bears', 'Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Test Recall Shrine', 'Grizzly Bears', 'Mountain'] }, defs: [SHRINE] });
    let s = passBoth(cast(s0, 'Lightning Bolt', [{ kind: 'object', id: find(s0, 'Grizzly Bears', 'battlefield') }]));
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(hand(s).map((id) => nameOf(s, id))).toEqual(['Grizzly Bears']);
  });
});

describe('CR 400.7, 603.7c: "When ~ dies, return it to its owner\'s hand at the beginning of the next end step." once the card has left the graveyard', () => {
  const PHOENIX = card('Test Ash Phoenix', 'Creature — Phoenix', "When ~ dies, return it to its owner's hand at the beginning of the next end step.", '{0}', ['2', '2']);
  it('a card that left the graveyard before the end step is a new object: nothing returns to the hand', () => {
    const s0 = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Test Ash Phoenix', 'Mountain'] }, defs: [PHOENIX] });
    let s = passBoth(cast(s0, 'Lightning Bolt', [{ kind: 'object', id: find(s0, 'Test Ash Phoenix', 'battlefield') }]));
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    const dead = find(s, 'Test Ash Phoenix', 'graveyard', 'p1');
    s = structuredClone(s);
    s.zones.graveyard.p1 = s.zones.graveyard.p1!.filter((id) => id !== dead);
    s.objects[dead]!.zone = 'exile';
    s.zones.exile = [...s.zones.exile, dead];
    s = advanceTo(s, 1, 'end');
    for (let i = 0; i < 3 && s.zones.stack.length > 0; i++) s = passBoth(s);
    expect(hand(s).map((id) => nameOf(s, id))).not.toContain('Test Ash Phoenix');
  });
});
