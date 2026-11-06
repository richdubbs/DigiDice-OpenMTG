/**
 * Lane trek, round trek-16 (Star Trek: copies and extra triggers), played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 614.12, 707.2, 707.9b  "You may have ~ enter as a copy of a creature card in a graveyard, except ~ is a Spy in addition to ~'s other types and has menace.":
 *                             any graveyard; the copy has the card's values, the added subtype and menace; declining enters as itself
 *   CR 614.12, 400.7, 707.9b  "... of any creature card in your graveyard that was put there from the battlefield this turn, except ~'s name is ~ and ~ is a
 *                             legendary Trill in addition to ~'s other types.": only a card that died this turn; the name stays, the copy is legendary
 *   CR 614.1a, 614.6, 111.1   "If one or more tokens would be created under your control, that many 3/3 ... tokens are created instead.": every token of the
 *                             controller, the same number; an opponent's tokens are not replaced
 *   CR 707.2, 611.2a          "Each Equipment token you control becomes a copy of target Equipment you control until end of turn.": tokens only, ends with the turn
 *   CR 603.7, 603.10a         "When it dies this turn, return that card to the battlefield ... with a +1/+1 counter on it at the beginning of the next end step."
 *   CR 603.2d, 611.2b         "For as long as ~ remains tapped, if a triggered ability of that creature triggers, that ability triggers an additional time."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => (id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) as never });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}, who: PlayerId = 'p1'): GameState =>
  resolveAll(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), o);

/** The tokens on the battlefield (a token's definition id starts with `token:`), of one controller or all, with the given subtype. */
const tokens = (s: GameState, subtype?: string, who?: PlayerId): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith('token:') && (who === undefined || s.objects[id]!.controller === who) && (subtype === undefined || chars(s, id).subtypes.includes(subtype)));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

// ---- enter as a copy of a creature card in a graveyard ---------------------------------------------------------------------------------------------------

const SHADE = card('Test Shade', 'Legendary Creature — Shapeshifter', "You may have ~ enter as a copy of a creature card in a graveyard, except ~ is a Spy in addition to ~'s other types and has menace.", { pt: ['0', '0'] });
const DOUBLE = card('Test Double', 'Legendary Creature — Shapeshifter', "You may have ~ enter as a copy of any creature card in your graveyard that was put there from the battlefield this turn, except ~'s name is ~ and ~ is a legendary Ooze in addition to ~'s other types.", { pt: ['0', '0'] });
const FOX = card('Test Fox', 'Creature — Fox', 'Flying', { pt: ['3', '1'] });
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');

describe('CR 614.12, 707.2, 707.9b: "enter as a copy of a creature card in a graveyard, except ~ is a Spy in addition to ~\'s other types and has menace"', () => {
  it('is fully automated', () => expect(full(SHADE)).toBe(true));
  it('enters as a copy of a creature card in an opponent\'s graveyard: its name, power, toughness and abilities, the Spy subtype added, menace added', () => {
    let s = scenario([], { defs: [SHADE, FOX], p1: { hand: ['Test Shade'] }, p2: { graveyard: ['Test Fox'] } });
    const fox = find(s, 'Test Fox', 'graveyard', 'p2');
    s = cast(s, 'Test Shade', { yes: true, pick: () => [fox] });
    const id = findAll(s, 'Test Shade', 'battlefield', 'p1')[0]!;
    const c = chars(s, id);
    expect(c.name).toBe('Test Fox');
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 1]);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Fox', 'Spy']));
    expect(JSON.stringify(c.keywords ?? c)).toContain('menace');
    expect(JSON.stringify(c.keywords ?? c)).toContain('flying');
    expect(s.objects[fox]?.zone).toBe('graveyard'); // the card copied stays where it is
  });
  it('declining the copy: it enters as itself, a 0/0 that dies', () => {
    let s = scenario([], { defs: [SHADE, FOX], p1: { hand: ['Test Shade'] }, p2: { graveyard: ['Test Fox'] } });
    s = cast(s, 'Test Shade', { yes: true, pick: () => [] });
    expect(findAll(s, 'Test Shade', 'battlefield', 'p1')).toEqual([]);
  });
  it('a permanent on the battlefield is not offered (the negative case)', () => {
    let s = scenario([], { defs: [SHADE, FOX], p1: { hand: ['Test Shade'] }, p2: { battlefield: ['Test Fox'] } });
    let offered: ObjectId[] = [];
    s = cast(s, 'Test Shade', { pick: (o) => { offered = o; return []; } });
    expect(offered).toEqual([]);
  });
});

describe('CR 614.12, 400.7, 707.9b: "enter as a copy of any creature card in your graveyard that was put there from the battlefield this turn, except ~\'s name is ~ and ~ is a legendary Ooze"', () => {
  it('is fully automated', () => expect(full(DOUBLE)).toBe(true));
  it('offers only the creature card that died this turn: a card put into the graveyard from the hand is not offered; the copy keeps its own name and is legendary', () => {
    let s = scenario([], { defs: [DOUBLE, FOX, BEAR, DOOM], p1: { hand: ['Test Double', 'Test Doom'], battlefield: ['Test Fox'], graveyard: ['Test Bear'] } });
    const fox = find(s, 'Test Fox', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'graveyard', 'p1');
    s = cast(s, 'Test Doom', { targets: [[fox]] });
    const foxCard = find(s, 'Test Fox', 'graveyard', 'p1');
    let offered: ObjectId[] = [];
    s = cast(s, 'Test Double', { pick: (o) => { offered = o; return [foxCard]; } });
    expect(offered).toEqual([foxCard]);
    expect(offered).not.toContain(bear);
    const id = findAll(s, 'Test Double', 'battlefield', 'p1')[0]!;
    const c = chars(s, id);
    expect([c.name, Number(c.power), Number(c.toughness)]).toEqual(["Test Double", 3, 1]);
    expect(c.supertypes).toContain('Legendary');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Fox', 'Ooze']));
  });
});

// ---- if one or more tokens would be created under your control, that many ... are created instead -----------------------------------------------------------

const FORGE = card('Test Forge', 'Creature — Artificer', 'If one or more tokens would be created under your control, that many 3/3 colorless Golem artifact creature tokens are created instead.', { pt: ['1', '1'] });
const MUSTER = card('Test Muster', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
const GIFTING = card('Test Gifting', 'Sorcery', 'Each opponent creates a 1/1 white Soldier creature token.');
const TREASURY = card('Test Treasury', 'Sorcery', 'Create a Treasure token.');

describe('CR 614.1a, 614.6, 111.1: "If one or more tokens would be created under your control, that many 3/3 colorless Golem artifact creature tokens are created instead."', () => {
  it('is fully automated', () => expect(full(FORGE)).toBe(true));
  it('every token you would create (two Soldiers, then a Treasure) is replaced by as many Golems', () => {
    let s = scenario([], { defs: [FORGE, MUSTER, TREASURY], p1: { hand: ['Test Muster', 'Test Treasury'], battlefield: ['Test Forge'] } });
    s = cast(s, 'Test Muster');
    expect(tokens(s, 'Soldier').length).toBe(0);
    const golems = tokens(s, 'Golem');
    expect(golems.length).toBe(2);
    expect(chars(s, golems[0]!).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect([Number(chars(s, golems[0]!).power), Number(chars(s, golems[0]!).toughness)]).toEqual([3, 3]);
    s = cast(s, 'Test Treasury');
    expect(tokens(s, 'Golem').length).toBe(3);
    expect(tokens(s, 'Treasure').length).toBe(0);
  });
  it('the negative case: without it the Soldiers are created; tokens an opponent creates are not replaced', () => {
    let s = scenario([], { defs: [MUSTER], p1: { hand: ['Test Muster'] } });
    s = cast(s, 'Test Muster');
    expect(tokens(s, 'Soldier').length).toBe(2);
    let t = scenario([], { defs: [FORGE, GIFTING], p1: { hand: ['Test Gifting'], battlefield: ['Test Forge'] } });
    t = cast(t, 'Test Gifting');
    const theirs = tokens(t, undefined, 'p2');
    expect(theirs.length).toBe(1);
    expect(chars(t, theirs[0]!).subtypes).toContain('Soldier');
  });
});

// ---- each Equipment token becomes a copy of target Equipment until end of turn ---------------------------------------------------------------------------

const ANVIL = card('Test Anvil', 'Creature — Dwarf', '{2}: Each Equipment token you control becomes a copy of target Equipment you control until end of turn.', { pt: ['1', '1'] });
const SMITH = card('Test Smith', 'Sorcery', 'Create a colorless Equipment artifact token named Test Heirloom with "Equipped creature gets +1/+1" and equip {2}.');
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +3/+0.\nEquip {1}');
const SPARE = card('Test Spare', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}');

describe('CR 707.2, 611.2a: "Each Equipment token you control becomes a copy of target Equipment you control until end of turn."', () => {
  it('is fully automated', () => expect(full(ANVIL)).toBe(true));
  it('the Equipment token becomes a copy of the target Equipment; an Equipment card that is not a token stays itself; at the end of the turn the token is itself again', () => {
    let s = scenario([], { defs: [ANVIL, SMITH, BLADE, SPARE], p1: { hand: ['Test Smith'], battlefield: ['Test Anvil', 'Test Blade', 'Test Spare', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Smith');
    const token = tokens(s, 'Equipment')[0]!;
    expect(chars(s, token).name).toBe('Test Heirloom');
    const blade = find(s, 'Test Blade', 'battlefield', 'p1');
    const spare = find(s, 'Test Spare', 'battlefield', 'p1');
    const anvil = find(s, 'Test Anvil', 'battlefield', 'p1');
    s = drive(act(s, { type: 'activate', player: 'p1', source: anvil, ability: 'p:0:0' }), { targets: [[blade]] });
    s = resolveAll(s);
    expect(chars(s, token).name).toBe('Test Blade');
    expect(chars(s, spare).name).toBe('Test Spare');
    expect(s.objects[token]?.zone).toBe('battlefield');
    s = advanceTo(s, 2, 'upkeep');
    expect(chars(s, token).name).toBe('Test Heirloom');
  });
});

// ---- when it dies this turn, return that card to the battlefield ... at the beginning of the next end step ---------------------------------------------------

const MEDIC = card('Test Medic', 'Creature — Human Doctor', "When ~ enters, choose up to one other target creature. When it dies this turn, return that card to the battlefield under its owner's control with a +1/+1 counter on it at the beginning of the next end step.", { pt: ['1', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });

describe('CR 603.7, 603.10a: "choose up to one other target creature. When it dies this turn, return that card to the battlefield under its owner\'s control with a +1/+1 counter on it at the beginning of the next end step"', () => {
  it('is fully automated', () => expect(full(MEDIC)).toBe(true));
  it('the creature dies this turn: it is returned at the beginning of the next end step, under its owner\'s control, with a +1/+1 counter', () => {
    let s = scenario([], { defs: [MEDIC, OGRE, DOOM], p1: { hand: ['Test Medic', 'Test Doom'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Medic', { targets: [[ogre]] });
    s = cast(s, 'Test Doom', { targets: [[ogre]] });
    expect(findAll(s, 'Test Ogre', 'battlefield', 'p2')).toEqual([]);
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2').length).toBe(1);
    s = resolveAll(advanceTo(s, 1, 'end'));
    const back = findAll(s, 'Test Ogre', 'battlefield', 'p2');
    expect(back.length).toBe(1);
    expect(s.objects[back[0]!]!.counters['+1/+1']).toBe(1);
    expect(findAll(s, 'Test Ogre', 'battlefield', 'p1')).toEqual([]);
  });
  it('the negative cases: a creature that does not die is not returned or given a counter; one that dies on a later turn stays dead', () => {
    let s = scenario([], { defs: [MEDIC, OGRE, DOOM], p1: { hand: ['Test Medic', 'Test Doom'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Medic', { targets: [[ogre]] });
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(s.objects[ogre]?.counters['+1/+1'] ?? 0).toBe(0);
    s = advanceTo(s, 3, 'main1');
    s = cast(s, 'Test Doom', { targets: [[find(s, 'Test Ogre', 'battlefield', 'p2')]] });
    s = resolveAll(advanceTo(s, 3, 'end'));
    expect(findAll(s, 'Test Ogre', 'battlefield', 'p2')).toEqual([]);
  });
});

// ---- for as long as ~ remains tapped, if a triggered ability of that creature triggers, that ability triggers an additional time -----------------------------

const SEER = card('Test Seer', 'Legendary Creature — Advisor', "{2}, {T}: Choose another target creature you control. For as long as ~ remains tapped, if a triggered ability of that creature triggers, that ability triggers an additional time.", { pt: ['1', '1'] });
const PRIEST = card('Test Priest', 'Creature — Cleric', 'At the beginning of your end step, you gain 1 life.', { pt: ['1', '1'] });

describe('CR 603.2d, 611.2b: "For as long as ~ remains tapped, if a triggered ability of that creature triggers, that ability triggers an additional time."', () => {
  it('is fully automated', () => expect(full(SEER)).toBe(true));
  it('the chosen creature\'s end-step trigger happens twice while the Seer is tapped; without the ability it happens once', () => {
    let s = scenario([], { defs: [SEER, PRIEST], p1: { battlefield: ['Test Seer', 'Test Priest', 'Plains', 'Plains'] } });
    const seer = find(s, 'Test Seer', 'battlefield', 'p1');
    const priest = find(s, 'Test Priest', 'battlefield', 'p1');
    const before = life(s, 'p1');
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: seer, ability: 'p:0:0' }), { targets: [[priest]] }));
    expect(s.objects[seer]!.tapped).toBe(true);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(life(s, 'p1')).toBe(before + 2);
    // the negative case: no activation, one trigger
    let t = scenario([], { defs: [SEER, PRIEST], p1: { battlefield: ['Test Seer', 'Test Priest'] } });
    t = resolveAll(advanceTo(t, 1, 'end'));
    expect(life(t, 'p1')).toBe(before + 1);
  });
  it('the effect ends when the Seer untaps: in the next turn\'s end step the trigger happens once', () => {
    let s = scenario([], { defs: [SEER, PRIEST], p1: { battlefield: ['Test Seer', 'Test Priest', 'Plains', 'Plains'] } });
    const seer = find(s, 'Test Seer', 'battlefield', 'p1');
    const priest = find(s, 'Test Priest', 'battlefield', 'p1');
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: seer, ability: 'p:0:0' }), { targets: [[priest]] }));
    s = resolveAll(advanceTo(s, 3, 'main1'));
    expect(s.objects[seer]!.tapped).toBe(false);
    const before = life(s, 'p1');
    s = resolveAll(advanceTo(s, 3, 'end'));
    expect(life(s, 'p1')).toBe(before + 1);
  });
});

// ---- target opponent whose turn it is may cast a spell from their hand free; if they do you copy that spell; if they don't you draw -----------------------

const EMPATH = card('Test Empath', 'Legendary Creature — Advisor', "{T}: Target opponent whose turn it is may cast a spell from their hand without paying its mana cost. If they do, you copy that spell. You may choose new targets for the copy. If they don't, you draw a card.", { pt: ['1', '1'] });
const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.');
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.');

/** Pass priority from the opponent's turn-2 upkeep to p1, who holds the Empath. */
const p1Priority = (s: GameState): GameState => pass(advanceTo(s, 2, 'upkeep'));

describe('"Target opponent whose turn it is may cast a spell from their hand without paying its mana cost. If they do, you copy that spell. ... If they don\'t, you draw a card."', () => {
  const defs = [EMPATH, TONIC, BEAR, SHATTER];
  it('is fully automated', () => expect(full(EMPATH)).toBe(true));
  it('they cast the spell free (they gain 2 life) and you copy it (you gain 2 life): no card is drawn', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Empath'], library: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Tonic'] } });
    const empath = find(s, 'Test Empath', 'battlefield', 'p1');
    s = p1Priority(s);
    const handBefore = s.zones.hand['p1']!.length;
    const [l1, l2] = [life(s, 'p1'), life(s, 'p2')];
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: empath, ability: 'p:0:0' }), { targets: [['p2']] });
    expect(life(s, 'p2')).toBe(l2 + 2);
    expect(life(s, 'p1')).toBe(l1 + 2);
    expect(s.zones.hand['p1']!.length).toBe(handBefore);
    expect(s.zones.hand['p2']!.length).toBe(0);
  });
  it('they decline: no copy, and you draw a card', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Empath'], library: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Tonic'] } });
    const empath = find(s, 'Test Empath', 'battlefield', 'p1');
    s = p1Priority(s);
    const handBefore = s.zones.hand['p1']!.length;
    const [l1, l2] = [life(s, 'p1'), life(s, 'p2')];
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: empath, ability: 'p:0:0' }), { targets: [['p2']], yes: false });
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([l1, l2]);
    expect(s.zones.hand['p1']!.length).toBe(handBefore + 1);
    expect(s.zones.hand['p2']!.length).toBe(1);
  });
  it('they say yes but have no spell they could cast (only a land, or nothing): they do not cast, so you draw a card', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Empath'], library: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Plains'] } });
    const empath = find(s, 'Test Empath', 'battlefield', 'p1');
    s = p1Priority(s);
    const handBefore = s.zones.hand['p1']!.length;
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: empath, ability: 'p:0:0' }), { targets: [['p2']], yes: true });
    expect(s.zones.hand['p1']!.length).toBe(handBefore + 1);
    expect(s.zones.hand['p2']!.length).toBe(1);
  });
  it('they say yes and choose a nonland card they cannot cast (no legal target): nothing is cast, so you draw a card and nothing is copied', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Empath'], library: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Shatter'] } });
    const empath = find(s, 'Test Empath', 'battlefield', 'p1');
    s = p1Priority(s);
    const handBefore = s.zones.hand['p1']!.length;
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: empath, ability: 'p:0:0' }), { targets: [['p2']], yes: true });
    expect(s.zones.hand['p1']!.length).toBe(handBefore + 1);
    expect(s.zones.hand['p2']!.length).toBe(1);
    expect(s.zones.stack.length).toBe(0);
  });
  it('the negative case: on your own turn no opponent is the player whose turn it is, so the ability has no target and cannot be activated', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Empath'] }, p2: { hand: ['Test Tonic'] } });
    const empath = find(s, 'Test Empath', 'battlefield', 'p1');
    let refused = false;
    try {
      reject(s, { type: 'activate', player: 'p1', source: empath, ability: 'p:0:0' });
      refused = true;
    } catch { refused = false; }
    expect(refused).toBe(true);
  });
});
