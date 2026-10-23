/**
 * Card wave 2, slice s6 (std-rw6): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.65a, 405.1     "Airbend target creature or spell": a spell is exiled from the stack (not countered), and its owner may cast the card for {2}
 *   CR 701.65a, 109.2     "airbend up to one other target creature or spell" on an enters trigger: a spell still on the stack is a legal target
 *   CR 115.1              an ability on the stack is not "a spell": it is never a target option
 *   CR 701.65b            "whenever you airbend" triggers when a spell is airbent
 *   CR 118.12, 101.4      "Each opponent may discard a card or sacrifice a creature. ~ deals 2 damage to each opponent who didn't.": the opponent discards, or
 *                         sacrifices, or is dealt the damage; a cost they can't pay is not offered (CR 118.3)
 *   CR 120.3, 702.15b     the damage is dealt by the creature (its lifelink applies)
 *   CR 702.171b, 301.7b   "Until end of turn, that permanent becomes saddled if it's a Mount and becomes an artifact creature if it's a Vehicle": a Mount is
 *                         saddled and stays what it is; a Vehicle becomes an artifact creature, not saddled; both end with the turn (CR 514.2)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, passBoth, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
/** Answer the decisions that come up (yes/no, targets, chosen objects in order; costs paid automatically) until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), script);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const onStack = (s: GameState, name: string): ObjectId | undefined => s.zones.stack.find((id) => s.objects[id]!.defId === name);
const exiled = (s: GameState, name: string): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === name);
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);

const OGRE = card('Test Hill Ogre', 'Creature — Ogre', '', ['5', '5'], '{3}{R}{R}');
const GALE = card('Test Sudden Gale', 'Instant', 'Airbend target creature or spell.');
const KITE = card('Test Kite Monk', 'Creature — Human Monk', 'Flash\nWhen this creature enters, airbend up to one other target creature or spell.', ['2', '2']);
const FIELD = card('Test Calm Field', 'Enchantment', 'Whenever you airbend, you gain 3 life.');
const AIR = [OGRE, GALE, KITE, FIELD];

describe('CR 701.65a, 405.1: "Airbend target creature or spell": a spell is exiled from the stack, and its owner may cast the card for {2}', () => {
  /** You cast the Ogre (holding priority), then the Gale targeting the Ogre spell; everything resolves. */
  const airbentOgre = (battlefield: string[] = []): GameState => {
    let s = scenario([], { p1: { hand: ['Test Hill Ogre', 'Test Sudden Gale'], battlefield }, defs: AIR });
    mana(s, 'R', 'R', 'C', 'C', 'C');
    s = cast(s, 'Test Hill Ogre');
    s = cast(s, 'Test Sudden Gale', { targets: [[obj(onStack(s, 'Test Hill Ogre')!)]] });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    return s;
  };
  it('is automated', () => {
    expect(full(GALE)).toBe(true);
    expect(full(KITE)).toBe(true);
  });
  it('the creature spell is exiled, not countered: it never reaches the battlefield or the graveyard, and the stack is empty', () => {
    const s = airbentOgre();
    expect(exiled(s, 'Test Hill Ogre')).toBeDefined();
    expect(named(s, 'Test Hill Ogre')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Sudden Gale']);
    expect(s.zones.stack).toEqual([]);
  });
  it('the exiled card is airbent: its owner may cast it for {2} rather than its mana cost', () => {
    let s = airbentOgre();
    const id = exiled(s, 'Test Hill Ogre')!;
    expect(s.objects[id]!.chosen?.['airbent']).toBe(true);
    expect(legal(s, 'p1', 'cast').filter((a) => a.object === id)).toEqual([]); // no mana yet
    mana(s, 'C', 'C');
    const acts = legal(s, 'p1', 'cast').filter((a) => a.object === id);
    expect(acts.map((a) => a.action)).toEqual([{ type: 'cast', player: 'p1', card: id, method: 'airbend' }]);
    s = drive(act(s, acts[0]!.action));
    s = drive(passBoth(s));
    expect(named(s, 'Test Hill Ogre')).toHaveLength(1);
  });
  it('CR 701.65b: "whenever you airbend" triggers when the spell is airbent', () => {
    const s = airbentOgre(['Test Calm Field']);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 701.65a, 109.2, 115.1: "When this creature enters, airbend up to one other target creature or spell."', () => {
  it('a spell still on the stack under the trigger is a target; the creature itself is not; the spell is exiled', () => {
    let s = scenario([], { p1: { hand: ['Test Hill Ogre', 'Test Kite Monk'] }, defs: AIR });
    mana(s, 'R', 'R', 'C', 'C', 'C');
    s = cast(s, 'Test Hill Ogre');
    s = cast(s, 'Test Kite Monk');
    s = passBoth(s); // the Monk resolves; its trigger asks for a target
    const monk = find(s, 'Test Kite Monk', 'battlefield', 'p1');
    const ogre = onStack(s, 'Test Hill Ogre')!;
    expect(s.pending).toMatchObject({ kind: 'chooseTargets' });
    expect(JSON.stringify(s.pending)).toContain(`"${ogre}"`);
    expect(JSON.stringify(s.pending)).not.toContain(`"${monk}"`);
    s = drive(s, { targets: [[obj(ogre)]] });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    expect(exiled(s, 'Test Hill Ogre')).toBeDefined();
    expect(named(s, 'Test Kite Monk')).toHaveLength(1);
  });
  it('CR 115.1: an ability on the stack is not a spell: the Monk\'s own trigger is never a target option of the Gale', () => {
    let s = scenario([], { p1: { hand: ['Test Kite Monk', 'Test Sudden Gale'] }, defs: AIR });
    s = cast(s, 'Test Kite Monk');
    s = passBoth(s); // the Monk resolves; its trigger goes on the stack with no target chosen
    s = drive(s, { targets: [[]] });
    const trigger = s.zones.stack[0]!;
    expect(s.objects[trigger]!.kind).toBe('ability');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sudden Gale', 'hand', 'p1') });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets' });
    expect(JSON.stringify(s.pending)).not.toContain(`"${trigger}"`);
  });
});

describe('CR 118.12, 101.4, 118.3: "Each opponent may discard a card or sacrifice a creature. This creature deals 2 damage to each opponent who didn\'t."', () => {
  const TONGUE = card('Test Ember Tongue', 'Creature — Goblin Shaman', "Lifelink\nWhen this creature enters, each opponent may discard a card or sacrifice a creature of their choice. This creature deals 2 damage to each opponent who didn't.", ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const PUP = card('Test Pup', 'Creature — Dog', '', ['1', '1']);
  const ROCK = card('Test Rock', 'Artifact', '');
  const DEFS = [TONGUE, BEAR, PUP, ROCK];
  const enter = (s0: GameState, script: Script): GameState => {
    let s = cast(s0, 'Test Ember Tongue');
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
    return s;
  };
  it('is automated', () => {
    expect(full(TONGUE)).toBe(true);
  });
  it('the opponent discards, or sacrifices the creature of their choice, or is dealt the damage: their choice', () => {
    const s0 = scenario([], { p1: { hand: ['Test Ember Tongue'] }, p2: { hand: ['Test Rock'], battlefield: ['Test Bear', 'Test Pup'] }, defs: DEFS });
    const discarded = enter(s0, { yes: [true] });
    expect(life(discarded, 'p2')).toBe(20);
    expect(zoneNames(discarded, 'graveyard', 'p2')).toEqual(['Test Rock']);
    const pup = find(s0, 'Test Pup', 'battlefield', 'p2');
    const sacrificed = enter(s0, { yes: [false, true], objects: [[pup]] });
    expect(life(sacrificed, 'p2')).toBe(20);
    expect(zoneNames(sacrificed, 'graveyard', 'p2')).toEqual(['Test Pup']);
    expect(zoneNames(sacrificed, 'hand', 'p2')).toEqual(['Test Rock']);
    const neither = enter(s0, { yes: [false, false] });
    expect(life(neither, 'p2')).toBe(18);
    expect(named(neither, 'Test Bear')).toHaveLength(1);
  });
  it('CR 120.3, 702.15b: the damage is dealt by the creature, so its lifelink gains you that much life; nothing is dealt to you', () => {
    const s0 = scenario([], { p1: { hand: ['Test Ember Tongue'] }, defs: DEFS });
    const s = enter(s0, {});
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(22);
  });
  it('CR 118.3: an opponent with no card in hand and no creature cannot pay: the damage is dealt with no question; with only an artifact, it can\'t be sacrificed', () => {
    const empty = enter(scenario([], { p1: { hand: ['Test Ember Tongue'] }, defs: DEFS }), {});
    expect(empty.pending?.kind).toBe('priority');
    expect(life(empty, 'p2')).toBe(18);
    const rock = enter(scenario([], { p1: { hand: ['Test Ember Tongue'] }, p2: { battlefield: ['Test Rock'] }, defs: DEFS }), { yes: [true, true] });
    expect(named(rock, 'Test Rock')).toHaveLength(1);
    expect(life(rock, 'p2')).toBe(18);
  });
});

describe('CR 702.171b, 301.7b: "Choose target Mount or Vehicle you control. Until end of turn, that permanent becomes saddled if it\'s a Mount and becomes an artifact creature if it\'s a Vehicle."', () => {
  const RACK = card('Test Saddle Rack', 'Artifact', "{0}: Choose target Mount or Vehicle you control. Until end of turn, that permanent becomes saddled if it's a Mount and becomes an artifact creature if it's a Vehicle.");
  const PONY = card('Test Pony', 'Creature — Horse Mount', 'Saddle 1', ['2', '2']);
  const CART = card('Test Cart', 'Artifact — Vehicle', 'Crew 1', ['3', '3']);
  const DEFS = [RACK, PONY, CART];
  const use = (s0: GameState, target: string): GameState => {
    const rack = find(s0, 'Test Saddle Rack', 'battlefield', 'p1');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === rack && !a.isMana)!;
    let s = drive(act(s0, la.action), { targets: [[obj(find(s0, target, 'battlefield', 'p1'))]] });
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
    return s;
  };
  const start = (): GameState => scenario([], { p1: { battlefield: ['Test Saddle Rack', 'Test Pony', 'Test Cart'] }, defs: DEFS });
  it('is automated', () => {
    expect(full(RACK)).toBe(true);
  });
  it('a Mount becomes saddled and stays what it is', () => {
    const s = use(start(), 'Test Pony');
    const pony = find(s, 'Test Pony', 'battlefield', 'p1');
    expect(s.objects[pony]!.saddled).toBe(true);
    expect(getChars(s, pony)!.types).toEqual(['Creature']);
  });
  it('a Vehicle becomes an artifact creature, not saddled, until end of turn (CR 514.2)', () => {
    const s = use(start(), 'Test Cart');
    const cart = find(s, 'Test Cart', 'battlefield', 'p1');
    expect(getChars(s, cart)!.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(s.objects[cart]!.saddled).not.toBe(true);
    const next = advanceTo(s, 2, 'main1');
    expect(getChars(next, find(next, 'Test Cart', 'battlefield', 'p1'))!.types).toEqual(['Artifact']);
  });
});
