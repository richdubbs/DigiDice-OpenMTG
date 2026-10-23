/**
 * Standard round J (slot J of the parallel rounds F-J): the readings of the round played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, and has its negative case.
 *
 *   CR 508.4, 701.20a, 401.4     "Put that card onto the battlefield tapped and attacking and the rest on the bottom of your library in a random order."
 *   CR 603.4, 707.2, 608.2d      "... if they entered or were cast from a graveyard, create a token that's a copy of one of them."
 *   CR 701.17a, 608.2d, 205.4a   "You may put any number of legendary and/or enchantment cards from among them into your hand." after "you mill that many cards"
 *   CR 603.12, 406.1, 601.2      "When you do, target opponent exiles the top N cards of their library. You may cast up to two spells from among the exiled cards ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Nothing of the card is left manual. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** The answers to the decisions of a cast or a resolution, in order of kind; payment is automatic. Stops at the next priority decision. */
interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; options?: string[][]; x?: number[]; stop?: boolean }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], options: [...(script.options ?? [])], x: [...(script.x ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (script.stop === true && p.kind === 'chooseObjects') break;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.x.shift() ?? p.min });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
/** Both players pass until the stack is empty (triggers included), answering what comes up with the script. */
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) {
    if (script?.stop === true && s.pending?.kind === 'chooseObjects') break;
    s = drive(passBoth(s), script);
  }
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const names = (s: GameState, zone: 'battlefield' | 'exile' | 'stack', owner?: string): string[] => s.zones[zone].filter((id) => owner === undefined || s.objects[id]!.owner === owner).map((id) => s.defs[s.objects[id]!.defId]!.name);
const lib = (s: GameState, p: string): string[] => s.zones.library[p]!.map((id) => s.objects[id]!.defId);
const hand = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
/**
 * Attack with one creature and let combat run, no blocks, answering the decisions with the script; stops at the end of combat (with `stop`: at a pending choice
 * of objects, which the caller answers).
 */
function attackAndResolve(s0: GameState, attacker: ObjectId, script: Script = {}): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
  for (let guard = 0; guard < 80; guard++) {
    const p = s.pending;
    if (!p) break;
    if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (p.kind !== 'priority') {
      if (script.stop === true && p.kind === 'chooseObjects') return s;
      s = drive(s, script);
    } else if ((s.turn.step === 'endCombat' || s.turn.step === 'main2') && s.zones.stack.length === 0) return s;
    else s = passBoth(s);
  }
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const FREE_BEAR = card('Test Free Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['4', '4']);
const TRINKET = card('Test Trinket', 'Artifact', '', '{1}');
const FARM = card('Test Farm', 'Land', '{T}: Add {G}.');

// ---- "Put that card onto the battlefield tapped and attacking and the rest on the bottom of your library in a random order." --------------------------------

const RAIDER = card('Test Raider', 'Creature — Goblin', 'Haste\nWhenever Test Raider attacks, reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield tapped and attacking and the rest on the bottom of your library in a random order.', '{0}', ['1', '1']);
describe('CR 508.4, 701.20a, 401.4: reveal until a creature card, then that card enters tapped and attacking and the rest go to the bottom', () => {
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('the first creature card enters tapped and attacking; the revealed cards before it go to the bottom; the cards not reached stay on top', () => {
    const s0 = scenario([], { defs: [RAIDER, BEAR, OGRE, TRINKET, FARM], p1: { battlefield: ['Test Raider'], library: ['Test Trinket', 'Test Farm', 'Test Bear', 'Test Ogre'] } });
    const raider = find(s0, 'Test Raider', 'battlefield', 'p1');
    const s = attackAndResolve(s0, raider);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(s.combat?.attackers.map((a) => a.id)).toContain(bear);
    // the Ogre was never revealed: it is on top; the Trinket and the Farm are on the bottom
    expect(lib(s, 'p1')[0]).toBe('Test Ogre');
    expect(lib(s, 'p1').slice(-2).sort()).toEqual(['Test Farm', 'Test Trinket']);
    expect(lib(s, 'p1')).toHaveLength(lib(s0, 'p1').length - 1);
  });
  it('no creature card in the library: every card is revealed, none enters, and all go to the bottom (the library keeps its size)', () => {
    const s0 = scenario([], { defs: [RAIDER, TRINKET, FARM], p1: { battlefield: ['Test Raider'], library: ['Test Trinket', 'Test Farm'] } });
    const s = attackAndResolve(s0, find(s0, 'Test Raider', 'battlefield', 'p1'));
    expect(names(s, 'battlefield', 'p1')).toEqual(['Test Raider']);
    expect(lib(s, 'p1')).toHaveLength(lib(s0, 'p1').length);
  });
});

// ---- "if they entered or were cast from a graveyard, create a token that's a copy of one of them" -------------------------------------------------------------

const MIRROR = card('Test Mirror Cleric', 'Creature — Elf Cleric', "Whenever one or more other creatures you control enter, if they entered or were cast from a graveyard, create a token that's a copy of one of them. This ability triggers only once each turn.", '{0}', ['1', '1']);
const RAISE = card('Test Raise Dead', 'Sorcery', 'Return up to two target creature cards from your graveyard to the battlefield.');
describe('CR 603.4, 707.2, 608.2d: an intervening "if they entered or were cast from a graveyard" and a copy of one of the entering creatures', () => {
  it('is automated', () => {
    expect(full(MIRROR)).toBe(true);
    expect(full(RAISE)).toBe(true);
  });
  it('two creatures return from the graveyard together: one token that is a copy of the chosen one is created (the other is not copied)', () => {
    const s0 = scenario([], { defs: [MIRROR, RAISE, BEAR, OGRE], p1: { hand: ['Test Raise Dead'], battlefield: ['Test Mirror Cleric'], graveyard: ['Test Bear', 'Test Ogre'] } });
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const ogre = find(s0, 'Test Ogre', 'graveyard', 'p1');
    let s = resolveAll(cast(s0, 'Test Raise Dead', { targets: [[obj(bear), obj(ogre)]] }), { stop: true });
    // the choice of the one to copy is made as the trigger resolves, among the two that entered
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = s.pending?.kind === 'chooseObjects' ? s.pending.options : [];
    expect(options.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Ogre']);
    const theOgre = options.find((id) => s.objects[id]!.defId === 'Test Ogre')!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [theOgre] }));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    expect(s.defs[s.objects[tokens[0]!]!.defId]!.name).toBe('Test Ogre');
    expect(names(s, 'battlefield', 'p1').filter((n) => n === 'Test Bear')).toHaveLength(1);
    expect(names(s, 'battlefield', 'p1').filter((n) => n === 'Test Ogre')).toHaveLength(2);
  });
  it('the token is made once each turn: a second batch the same turn makes none', () => {
    const s0 = scenario([], { defs: [MIRROR, RAISE, BEAR, OGRE], p1: { hand: ['Test Raise Dead', 'Test Raise Dead'], battlefield: ['Test Mirror Cleric'], graveyard: ['Test Bear', 'Test Ogre'] } });
    let s = resolveAll(cast(s0, 'Test Raise Dead', { targets: [[obj(find(s0, 'Test Bear', 'graveyard', 'p1'))]] }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(1);
    s = resolveAll(cast(s, 'Test Raise Dead', { targets: [[obj(find(s, 'Test Ogre', 'graveyard', 'p1'))]] }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(1);
  });
  it('a creature cast from the hand does not satisfy the condition: no token (CR 603.4: the creature did not enter or get cast from a graveyard)', () => {
    const s0 = scenario([], { defs: [MIRROR, FREE_BEAR], p1: { hand: ['Test Free Bear'], battlefield: ['Test Mirror Cleric'] } });
    const s = resolveAll(cast(s0, 'Test Free Bear'));
    expect(names(s, 'battlefield', 'p1').sort()).toEqual(['Test Free Bear', 'Test Mirror Cleric']);
    expect(Object.values(s.objects).filter((o) => o.kind === 'token')).toHaveLength(0);
  });
});

// ---- "you mill that many cards. You may put any number of legendary and/or enchantment cards from among them into your hand." ----------------------------------

const DELVER = card('Test Dark Delver', 'Creature — Rat', 'Whenever Test Dark Delver deals combat damage to a player, you mill that many cards. You may put any number of legendary and/or enchantment cards from among them into your hand. If you put no cards into your hand this way, put a +1/+1 counter on Test Dark Delver.', '{0}', ['3', '3']);
const KING = card('Test Rat King', 'Legendary Creature — Rat', '', '{1}', ['1', '1']);
const CHARM = card('Test Charm', 'Enchantment', '');
describe('CR 701.17a, 608.2d, 205.4a: any number of legendary and/or enchantment cards from among the milled cards, and a counter when none was put into the hand', () => {
  it('is automated', () => expect(full(DELVER)).toBe(true));
  it('three cards milled; the legendary card and the enchantment card can be taken, a plain creature card cannot; both taken: no counter', () => {
    const s0 = scenario([], { defs: [DELVER, KING, CHARM, BEAR, OGRE], p1: { battlefield: ['Test Dark Delver'], library: ['Test Rat King', 'Test Bear', 'Test Charm', 'Test Ogre'] } });
    const delver = find(s0, 'Test Dark Delver', 'battlefield', 'p1');
    let s = attackAndResolve(s0, delver, { stop: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    const pend = s.pending?.kind === 'chooseObjects' ? s.pending : undefined;
    // the milled cards are new objects in the graveyard: found by name
    expect((pend?.options ?? []).map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Charm', 'Test Rat King']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: pend!.options }));
    expect(hand(s, 'p1').filter((n) => n.startsWith('Test')).sort()).toEqual(['Test Charm', 'Test Rat King']);
    expect(s.objects[delver]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(lib(s, 'p1')[0]).toBe('Test Ogre');
  });
  it('none taken: the milled cards stay in the graveyard and the creature gets a +1/+1 counter', () => {
    const s0 = scenario([], { defs: [DELVER, KING, CHARM, BEAR, OGRE], p1: { battlefield: ['Test Dark Delver'], library: ['Test Rat King', 'Test Bear', 'Test Charm', 'Test Ogre'] } });
    const delver = find(s0, 'Test Dark Delver', 'battlefield', 'p1');
    const s = attackAndResolve(s0, delver, { objects: [[]] });
    expect(hand(s, 'p1').filter((n) => n.startsWith('Test'))).toEqual([]);
    expect(s.objects[delver]!.counters['+1/+1']).toBe(1);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Charm', 'Test Rat King']);
  });
});

// ---- "When you do, target opponent exiles the top N cards of their library. You may cast up to two spells from among the exiled cards ..." --------------------

const PLAN = card('Test Grand Plan', 'Enchantment — Plan', '{0}: Put a plan counter on Test Grand Plan.\nWhen the second plan counter is put on Test Grand Plan, sacrifice it. When you do, target opponent exiles the top four cards of their library. You may cast up to two spells from among the exiled cards without paying their mana costs.', '{0}');
describe('CR 603.12, 406.1, 601.2, 118.9: a sentence after "When you do" is an instruction of the reflexive trigger and may read the cards it exiled', () => {
  it('is automated', () => expect(full(PLAN)).toBe(true));
  /** Activate the plan's ability twice, resolving each; the second resolution puts the second counter on it, which triggers the sacrifice and the reflexive trigger. */
  function twoCounters(s0: GameState, script: Script): GameState {
    let s = s0;
    for (let i = 0; i < 2; i++) {
      const plan = find(s, 'Test Grand Plan', 'battlefield', 'p1');
      const a = legal(s, 'p1', 'activate').find((x) => x.action.type === 'activate' && x.action.source === plan && !x.isMana);
      expect(a, 'an activation of the plan').toBeDefined();
      s = resolveAll(drive(act(s, a!.action), script), script);
    }
    return s;
  }
  it('the opponent exiles four cards; you cast two of the nonland spells among them for free (they resolve under your control); a land among them is not offered', () => {
    const s0 = scenario([], { defs: [PLAN, BEAR, OGRE, TRINKET, FARM], p1: { battlefield: ['Test Grand Plan'] }, p2: { library: ['Test Farm', 'Test Bear', 'Test Ogre', 'Test Trinket', 'Test Bear'] } });
    let s = twoCounters(s0, { targets: [[{ kind: 'player', id: 'p2' }]], stop: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    const pend = s.pending?.kind === 'chooseObjects' ? s.pending : undefined;
    const offered = (pend?.options ?? []).map((id) => s.objects[id]!.defId).sort();
    // the four exiled cards were a land, two creatures and an artifact: the land is never offered (CR 305.9), the fifth card of the library was not exiled
    expect(offered).toEqual(['Test Bear', 'Test Ogre', 'Test Trinket']);
    expect(pend?.max).toBe(2);
    expect(names(s, 'exile', 'p2').sort()).toEqual(['Test Bear', 'Test Farm', 'Test Ogre', 'Test Trinket']);
    const pick = (n: string): ObjectId => pend!.options.find((id) => s.objects[id]!.defId === n)!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [pick('Test Ogre'), pick('Test Bear')] }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && ['Test Ogre', 'Test Bear'].includes(s.objects[id]!.defId))).toHaveLength(2);
    expect(names(s, 'battlefield')).not.toContain('Test Grand Plan');
    expect(names(s, 'exile', 'p2').sort()).toEqual(['Test Farm', 'Test Trinket']);
  });
});

// ---- "You may cast that card without paying its mana cost if the spell's mana value is less than N. If you don't cast that card this way, put it into your hand." ----

const REVELATION = card('Test Fire Revelation', 'Sorcery', "Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than the number of Mountains you control. If you don't cast that card this way, put it into your hand.");
const MOUNTAIN = card('Test Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
const GIANT = card('Test Giant', 'Creature — Giant', '', '{4}{R}', ['5', '5']);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
describe("CR 118.9, 202.3, 601.2, 608.2c: a free cast under a condition on the card's mana value, and the card goes to the hand when it is not cast", () => {
  it('is automated', () => expect(full(REVELATION)).toBe(true));
  it('mana value 1 < two Mountains: the Bear is cast for free and enters; the Farm exiled before it stays in exile; nothing goes to the hand', () => {
    const s0 = scenario([], { defs: [REVELATION, BEAR, FARM, MOUNTAIN], p1: { hand: ['Test Fire Revelation'], battlefield: ['Test Mountain', 'Test Mountain'], library: ['Test Farm', 'Test Bear'] } });
    const h0 = hand(s0, 'p1').length;
    const s = resolveAll(cast(s0, 'Test Fire Revelation'), { yes: [true] });
    expect(names(s, 'battlefield', 'p1')).toContain('Test Bear');
    expect(hand(s, 'p1')).toHaveLength(h0 - 1);
    expect(names(s, 'exile', 'p1')).toEqual(['Test Farm']);
  });
  it('the option declined: the Bear goes to the hand ("you don\'t cast that card this way")', () => {
    const s0 = scenario([], { defs: [REVELATION, BEAR, FARM, MOUNTAIN], p1: { hand: ['Test Fire Revelation'], battlefield: ['Test Mountain', 'Test Mountain'], library: ['Test Farm', 'Test Bear'] } });
    const s = resolveAll(cast(s0, 'Test Fire Revelation'), { yes: [false] });
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Bear');
    expect(hand(s, 'p1')).toContain('Test Bear');
  });
  it('mana value 5 is not less than two Mountains: the option is never offered and the Giant goes to the hand', () => {
    const s0 = scenario([], { defs: [REVELATION, GIANT, MOUNTAIN], p1: { hand: ['Test Fire Revelation'], battlefield: ['Test Mountain', 'Test Mountain'], library: ['Test Giant'] } });
    const s = resolveAll(cast(s0, 'Test Fire Revelation'), { yes: [true] });
    expect(names(s, 'battlefield', 'p1')).not.toContain('Test Giant');
    expect(hand(s, 'p1')).toContain('Test Giant');
  });
});

// ---- "You lose life equal to that card's mana value if C. Otherwise, each opponent loses that much life." -------------------------------------------------------

const BRONCO = card('Test Reckless Bronco', 'Creature — Horse', "Whenever Test Reckless Bronco attacks, reveal the top card of your library and put it into your hand. You lose life equal to that card's mana value if you control a Goblin. Otherwise, each opponent loses that much life.", '{0}', ['1', '1']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['1', '1']);
const IDOL = card('Test Costly Idol', 'Artifact', '', '{3}');
describe('CR 119.3, 608.2c, 608.2h: a life loss under a trailing "if", and "that much" of the otherwise branch', () => {
  it('is automated', () => expect(full(BRONCO)).toBe(true));
  it("with a Goblin you lose life equal to the revealed card's mana value (3) and the opponent loses none (only the Bronco's 1 combat damage)", () => {
    const s0 = scenario([], { defs: [BRONCO, GOBLIN, IDOL], p1: { battlefield: ['Test Reckless Bronco', 'Test Goblin'], library: ['Test Costly Idol'] } });
    const s = attackAndResolve(s0, find(s0, 'Test Reckless Bronco', 'battlefield', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') - 3);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 1);
    expect(hand(s, 'p1')).toContain('Test Costly Idol');
  });
  it('without a Goblin each opponent loses that much (3) and you lose none', () => {
    const s0 = scenario([], { defs: [BRONCO, GOBLIN, IDOL], p1: { battlefield: ['Test Reckless Bronco'], library: ['Test Costly Idol'] } });
    const s = attackAndResolve(s0, find(s0, 'Test Reckless Bronco', 'battlefield', 'p1'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3 - 1);
  });
});
