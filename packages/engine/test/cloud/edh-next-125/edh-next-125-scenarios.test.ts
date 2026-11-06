/**
 * edh-next-125 (must-finish round: becomes a creature, counters, artifacts): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites
 * checked against the Comprehensive Rules of 2026-09-25 (media.wizards.com MagicCompRules 20260925); the rulings were fetched from Scryfall in the cloud session.
 *
 *   CR 611.3a, 613.1d, 613.1f, 613.4b, 205.2a   "During your turn, each non-Equipment artifact and non-Aura enchantment you control with mana value 4 or greater is a 4/4
 *                                               Elemental creature in addition to its other types and has ..." (Bello, Bard of the Brambles)
 *   CR 614.1c, 613.4b, 107.3, 608.2c, 205.2a   "Return up to X target artifact and/or non-Aura enchantment cards each with mana value X or less from your graveyard to the battlefield.
 *                                               If X is 6 or more, those permanents are 4/4 creatures in addition to their other types." (Dance of the Manse; ruling 2019-10-04:
 *                                               they ENTER as 4/4 creatures)
 *   CR 611.2c, 613.1d, 613.4b, 122.1, 702.96a  "Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact that became a
 *                                               creature this way." with overload (Rise and Shine)
 *   CR 118.3, 607.2a, 603.7c, 400.7, 110.2      "{5}, Exile this Vehicle and four other artifact creatures and/or Vehicles you control: Create Mechtitan, ... When that token leaves the
 *                                               battlefield, return all cards exiled with this Vehicle except this card to the battlefield tapped under their owners' control." (Mechtitan Core)
 *   CR 611.2c, 613.1b, 613.7b, 514.2            "Untap all creatures you control and all creatures target opponent controls. You and that opponent each gain control of all creatures the
 *                                               other controls until end of turn. Those creatures gain haste until end of turn." (Reins of Power)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';
import { getChars, hasKeyword, ptNumbers } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const isCreature = (s: GameState, id: ObjectId): boolean => getChars(s, id).types.includes('Creature');
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; numbers?: number[]; pick?: (options: readonly string[], min: number, max: number) => string[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.pick ? script.pick(p.options, p.min, p.max) : p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);

// ---- Bello: during your turn, artifacts and enchantments of mana value 4 or more are 4/4 Elementals ----------------------------------------------------------------

const BARD = card('Test Bramble Bard', 'Legendary Creature — Raccoon Bard',
  'During your turn, each non-Equipment artifact and non-Aura enchantment you control with mana value 4 or greater is a 4/4 Elemental creature in addition to its other types and has indestructible, haste, and "Whenever this creature deals combat damage to a player, draw a card."',
  { cost: '{1}{R}{G}', pt: ['3', '3'] });
const BIG_RELIC = card('Test Heavy Relic', 'Artifact', '', { cost: '{4}' });
const SMALL_RELIC = card('Test Light Relic', 'Artifact', '', { cost: '{3}' });
const PLATE = card('Test Heavy Plate', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {2}', { cost: '{4}' });
const SHRINE = card('Test Grand Shrine', 'Enchantment', '', { cost: '{3}{G}{G}' });
const SHRINE_CREATURE = card('Test Shrine Beast', 'Enchantment Creature — Beast', '', { cost: '{2}{G}{G}', pt: ['2', '2'] });

describe('CR 611.3a, 613.1d, 613.4b, 205.2a: "During your turn, each non-Equipment artifact and non-Aura enchantment you control with mana value 4 or greater is a 4/4 Elemental creature ..."', () => {
  const setup = (): GameState => mpScenario({
    defs: [BARD, BIG_RELIC, SMALL_RELIC, PLATE, SHRINE, SHRINE_CREATURE],
    zones: {
      p1: { battlefield: ['Test Bramble Bard', 'Test Heavy Relic', 'Test Light Relic', 'Test Heavy Plate', 'Test Grand Shrine', 'Test Shrine Beast'] },
      p2: { battlefield: ['Test Heavy Relic'] },
    },
  });
  it('is automated', () => {
    expect(full(BARD)).toBe(true);
    expect(full(PLATE)).toBe(true);
  });
  it('during your turn: a non-Equipment artifact and a non-Aura enchantment of mana value 4 or more are 4/4 Elemental creatures with indestructible and haste, and keep their types', () => {
    const s = setup();
    expect(s.turn.activePlayer).toBe('p1');
    for (const name of ['Test Heavy Relic', 'Test Grand Shrine']) {
      const id = find(s, name, 'battlefield', 'p1');
      const c = getChars(s, id);
      expect(c.types, name).toContain('Creature');
      expect(c.types, name).toContain(name === 'Test Heavy Relic' ? 'Artifact' : 'Enchantment');
      expect(c.subtypes, name).toContain('Elemental');
      expect(ptNumbers(c), name).toEqual({ power: 4, toughness: 4 });
      expect(hasKeyword(c, 'indestructible'), name).toBe(true);
      expect(hasKeyword(c, 'haste'), name).toBe(true);
    }
    // an enchantment creature of mana value 4 is a 4/4 too (its base power and toughness set in layer 7b)
    expect(ptNumbers(getChars(s, find(s, 'Test Shrine Beast', 'battlefield', 'p1')))).toEqual({ power: 4, toughness: 4 });
  });
  it('negative: an Equipment, an artifact of mana value 3, an opponent\'s artifact and Bello itself are not changed', () => {
    const s = setup();
    expect(isCreature(s, find(s, 'Test Heavy Plate', 'battlefield', 'p1'))).toBe(false);
    expect(isCreature(s, find(s, 'Test Light Relic', 'battlefield', 'p1'))).toBe(false);
    expect(isCreature(s, find(s, 'Test Heavy Relic', 'battlefield', 'p2'))).toBe(false);
    const bard = getChars(s, find(s, 'Test Bramble Bard', 'battlefield', 'p1'));
    expect(ptNumbers(bard)).toEqual({ power: 3, toughness: 3 });
    expect(bard.subtypes).not.toContain('Elemental');
  });
  it('negative (CR 611.3a): during an opponent\'s turn the artifact is not a creature', () => {
    const s = passUntil(setup(), (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', "p2's main phase");
    expect(isCreature(s, find(s, 'Test Heavy Relic', 'battlefield', 'p1'))).toBe(false);
    expect(isCreature(s, find(s, 'Test Grand Shrine', 'battlefield', 'p1'))).toBe(false);
    expect(ptNumbers(getChars(s, find(s, 'Test Shrine Beast', 'battlefield', 'p1')))).toEqual({ power: 2, toughness: 2 });
  });
  it('CR 702.10, 510.2, 603.2: the animated artifact attacks with haste; its combat damage to a player draws its controller a card', () => {
    let s = setup();
    const relic = find(s, 'Test Heavy Relic', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: relic, defender: 'p2' }] });
    const life2 = s.players.find((p) => p.id === 'p2')!.life;
    const hand = handSize(s, 'p1');
    s = passUntil(s, (x) => x.turn.step === 'end' || x.turn.step === 'main2', 'after combat');
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life2 - 4);
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
});

// ---- Dance of the Manse: return up to X; if X is 6 or more, they enter as 4/4 creatures -----------------------------------------------------------------------------

const DANCE = card('Test Manor Waltz', 'Sorcery',
  'Return up to X target artifact and/or non-Aura enchantment cards each with mana value X or less from your graveyard to the battlefield. If X is 6 or more, those permanents are 4/4 creatures in addition to their other types.',
  { cost: '{X}{W}{U}' });
const IDOL = card('Test Grand Idol', 'Artifact', '', { cost: '{6}' });
const CHARM = card('Test Quiet Charm', 'Enchantment', '', { cost: '{1}{W}' });
const SERVO = card('Test Brass Servant', 'Artifact Creature — Construct', '', { cost: '{2}', pt: ['1', '1'] });
const HALO = card('Test Halo of Grace', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', { cost: '{W}' });
const COLOSSUS = card('Test Giant Engine', 'Artifact', '', { cost: '{7}' });
const WARDEN = card('Test Gate Warden', 'Creature — Human Cleric', 'Whenever another creature you control enters, you gain 1 life.', { cost: '{W}', pt: ['1', '1'] });

describe('CR 614.1c, 613.4b, 107.3: "Return up to X target artifact and/or non-Aura enchantment cards ... If X is 6 or more, those permanents are 4/4 creatures in addition to their other types."', () => {
  const lands = (n: number): string[] => [...Array(Math.ceil(n / 2)).fill('Plains'), ...Array(Math.floor(n / 2)).fill('Island')];
  const setup = (mana: number): GameState => mpScenario({
    cards: ['Island'],
    defs: [DANCE, IDOL, CHARM, SERVO, HALO, COLOSSUS, WARDEN],
    zones: {
      p1: { hand: ['Test Manor Waltz'], battlefield: [...lands(mana), 'Test Gate Warden'], graveyard: ['Test Grand Idol', 'Test Quiet Charm', 'Test Brass Servant', 'Test Halo of Grace', 'Test Giant Engine'] },
      p2: { graveyard: ['Test Grand Idol'] },
    },
  });
  it('is automated', () => { expect(full(DANCE)).toBe(true); });
  it('ruling 2019-10-04: with X = 6 the cards ENTER as 4/4 creatures (an "another creature enters" trigger sees each); an artifact creature is a 4/4 too', () => {
    let s = setup(8);
    const g = (n: string): ObjectId => find(s, n, 'graveyard', 'p1');
    const life = lifeOf(s, 'p1');
    s = cast(s, 'Test Manor Waltz', { numbers: [6], targets: [[obj(g('Test Grand Idol')), obj(g('Test Quiet Charm')), obj(g('Test Brass Servant'))]] });
    for (const n of ['Test Grand Idol', 'Test Quiet Charm', 'Test Brass Servant']) {
      const id = find(s, n, 'battlefield', 'p1');
      const c = getChars(s, id);
      expect(c.types, n).toContain('Creature');
      expect(ptNumbers(c), n).toEqual({ power: 4, toughness: 4 });
    }
    expect(getChars(s, find(s, 'Test Grand Idol', 'battlefield', 'p1')).types).toContain('Artifact');
    expect(getChars(s, find(s, 'Test Quiet Charm', 'battlefield', 'p1')).types).toContain('Enchantment');
    expect(lifeOf(s, 'p1')).toBe(life + 3); // each of the three entered as a creature
    // it stays a 4/4 creature on later turns (the effect has no duration)
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', "p2's turn");
    expect(ptNumbers(getChars(s, find(s, 'Test Grand Idol', 'battlefield', 'p1')))).toEqual({ power: 4, toughness: 4 });
  });
  it('negative: with X = 5 they return as they are: a noncreature artifact, no trigger; the artifact creature keeps its own 1/1', () => {
    let s = setup(7);
    const g = (n: string): ObjectId => find(s, n, 'graveyard', 'p1');
    const life = lifeOf(s, 'p1');
    s = cast(s, 'Test Manor Waltz', { numbers: [5], targets: [[obj(g('Test Quiet Charm')), obj(g('Test Brass Servant'))]] });
    expect(isCreature(s, find(s, 'Test Quiet Charm', 'battlefield', 'p1'))).toBe(false);
    expect(ptNumbers(getChars(s, find(s, 'Test Brass Servant', 'battlefield', 'p1')))).toEqual({ power: 1, toughness: 1 });
    expect(lifeOf(s, 'p1')).toBe(life + 1); // only the artifact creature
  });
  it('negative (CR 115.1, 107.3): an Aura card, a card of mana value greater than X and an opponent\'s card are not legal targets; up to X targets', () => {
    let s = setup(8);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Manor Waltz', 'hand', 'p1') });
    for (let guard = 0; guard < 5 && s.pending?.kind === 'chooseNumber'; guard++) s = answer(s, { kind: 'chooseNumber', n: 6 });
    expect(s.pending?.kind).toBe('chooseTargets');
    const p = s.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseTargets' }>;
    const legal = JSON.stringify(p);
    expect(legal).toContain(find(s, 'Test Grand Idol', 'graveyard', 'p1'));
    expect(legal).not.toContain(find(s, 'Test Halo of Grace', 'graveyard', 'p1'));
    expect(legal).not.toContain(find(s, 'Test Giant Engine', 'graveyard', 'p1'));
    expect(legal).not.toContain(find(s, 'Test Grand Idol', 'graveyard', 'p2'));
  });
});

// ---- Rise and Shine: becomes a 0/0 artifact creature; four +1/+1 counters on each that became a creature this way; overload ------------------------------------------

const RISE = card('Test Wake the Gears', 'Sorcery',
  'Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact that became a creature this way.\nOverload {4}{U}{U}',
  { cost: '{1}{U}' });
const WHEEL = card('Test Copper Wheel', 'Artifact', '', { cost: '{2}' });
const LAMP = card('Test Brass Lamp', 'Artifact', '', { cost: '{1}' });

describe('CR 611.2c, 613.4b, 122.1, 702.96a: "Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact that became a creature this way." (overload)', () => {
  const setup = (): GameState => mpScenario({
    cards: ['Island'],
    defs: [RISE, WHEEL, LAMP, SERVO],
    zones: {
      p1: { hand: ['Test Wake the Gears'], battlefield: ['Island', 'Island', 'Island', 'Island', 'Island', 'Island', 'Test Copper Wheel', 'Test Brass Lamp', 'Test Brass Servant'] },
      p2: { battlefield: ['Test Copper Wheel'] },
    },
  });
  it('is automated', () => { expect(full(RISE)).toBe(true); });
  it('cast normally: the target becomes a 0/0 artifact creature with four +1/+1 counters (4/4) for good; the other artifact is unchanged', () => {
    let s = setup();
    const wheel = find(s, 'Test Copper Wheel', 'battlefield', 'p1');
    const lamp = find(s, 'Test Brass Lamp', 'battlefield', 'p1');
    s = cast(s, 'Test Wake the Gears', { targets: [[obj(wheel)]] });
    expect(getChars(s, wheel).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(s.objects[wheel]!.counters['+1/+1']).toBe(4);
    expect(ptNumbers(getChars(s, wheel))).toEqual({ power: 4, toughness: 4 });
    expect(isCreature(s, lamp)).toBe(false);
    expect(s.objects[lamp]!.counters['+1/+1'] ?? 0).toBe(0);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', "p2's turn");
    expect(ptNumbers(getChars(s, wheel))).toEqual({ power: 4, toughness: 4 });
  });
  it('negative (CR 115.1): an artifact creature and an opponent\'s artifact are not legal targets', () => {
    let s = setup();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wake the Gears', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    const legal = JSON.stringify(s.pending);
    expect(legal).toContain(find(s, 'Test Copper Wheel', 'battlefield', 'p1'));
    expect(legal).not.toContain(find(s, 'Test Brass Servant', 'battlefield', 'p1'));
    expect(legal).not.toContain(find(s, 'Test Copper Wheel', 'battlefield', 'p2'));
  });
  it('overloaded (CR 702.96a-b): no target; EACH noncreature artifact you control becomes a 4/4; an artifact creature gets no counters; an opponent\'s artifact is unchanged', () => {
    let s = setup();
    const wheel = find(s, 'Test Copper Wheel', 'battlefield', 'p1');
    const lamp = find(s, 'Test Brass Lamp', 'battlefield', 'p1');
    const servo = find(s, 'Test Brass Servant', 'battlefield', 'p1');
    const theirs = find(s, 'Test Copper Wheel', 'battlefield', 'p2');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wake the Gears', 'hand', 'p1'), method: 'overload' } as never)));
    expect(s.zones.stack.length).toBe(0);
    for (const id of [wheel, lamp]) {
      expect(s.objects[id]!.counters['+1/+1']).toBe(4);
      expect(ptNumbers(getChars(s, id))).toEqual({ power: 4, toughness: 4 });
    }
    expect(s.objects[servo]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(ptNumbers(getChars(s, servo))).toEqual({ power: 1, toughness: 1 });
    expect(isCreature(s, theirs)).toBe(false);
    expect(s.objects[theirs]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ---- Mechtitan Core: exile it and four others for a 10/10; when the token leaves, the others return tapped under their owners' control ---------------------------------

const CORE = card('Test Titan Frame', 'Artifact — Vehicle',
  '{5}, Exile this Vehicle and four other artifact creatures and/or Vehicles you control: Create Mechtitan, a legendary 10/10 Construct artifact creature token with flying, vigilance, trample, lifelink, and haste that\'s all colors. When that token leaves the battlefield, return all cards exiled with this Vehicle except this card to the battlefield tapped under their owners\' control.\nCrew 2',
  { cost: '{2}', pt: ['2', '4'] });
const CART = card('Test Ore Cart', 'Artifact — Vehicle', 'Crew 1', { cost: '{1}', pt: ['3', '3'] });
const BEAST = card('Test Plain Beast', 'Creature — Beast', '', { cost: '{1}', pt: ['2', '2'] });
const UNMAKE = card('Test Unmaking', 'Instant', 'Exile target creature.', { cost: '{0}' });

describe('CR 118.3, 607.2a, 603.7c, 400.7: "{5}, Exile this Vehicle and four other artifact creatures and/or Vehicles you control: Create Mechtitan ... return all cards exiled with this Vehicle except this card ..."', () => {
  const setup = (beast = false): GameState => mpScenario({
    defs: [CORE, SERVO, CART, BEAST, UNMAKE],
    zones: {
      p1: { hand: ['Test Unmaking'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Titan Frame', 'Test Brass Servant', 'Test Brass Servant', 'Test Ore Cart', ...(beast ? ['Test Plain Beast'] : [])] },
      p2: { battlefield: ['Test Brass Servant'] },
    },
    // p1 controls p2's Brass Servant (owned by p2): it is one of the four, and returns under its OWNER's control
    setup: (s) => { const theirs = s.zones.battlefield.find((id) => s.objects[id]!.owner === 'p2' && s.defs[s.objects[id]!.defId]!.name === 'Test Brass Servant')!; s.objects[theirs]!.controller = 'p1'; },
  });
  const activateCore = (s: GameState): GameState =>
    settle(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Titan Frame', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { pick: (o, min) => o.slice(0, min) }));
  it('is automated', () => { expect(full(CORE)).toBe(true); });
  it('creates Mechtitan (legendary 10/10, all colors, flying, vigilance, trample, lifelink, haste); the Core and the four others are in exile', () => {
    const s = activateCore(setup());
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    const c = getChars(s, tokens[0]!);
    expect(c.name).toBe('Mechtitan');
    expect(c.supertypes).toContain('Legendary');
    expect(ptNumbers(c)).toEqual({ power: 10, toughness: 10 });
    expect([...c.colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    for (const k of ['flying', 'vigilance', 'trample', 'lifelink', 'haste']) expect(hasKeyword(c, k), k).toBe(true);
    const exiled = (owner: PlayerId): number => (s.zones.exile as unknown as ObjectId[]).filter((id) => s.objects[id]!.owner === owner).length;
    expect(exiled('p1')).toBe(4); // the Core, two Servants, the Cart (p1's)
    expect(exiled('p2')).toBe(1); // p2's Servant (exile is one shared zone, CR 406.1)
  });
  it('when the token leaves the battlefield, the four other cards return tapped under their owners\' control; the Core stays in exile', () => {
    let s = activateCore(setup());
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    s = cast(s, 'Test Unmaking', { targets: [[obj(token)]] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false);
    const back = (n: string, owner: PlayerId): ObjectId => find(s, n, 'battlefield', owner);
    for (const id of [...s.zones.battlefield.filter((x) => ['Test Brass Servant', 'Test Ore Cart'].includes(s.defs[s.objects[x]!.defId]!.name))]) expect(s.objects[id]!.tapped).toBe(true);
    expect(s.zones.battlefield.filter((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Brass Servant' && s.objects[x]!.owner === 'p1').length).toBe(2);
    expect(s.objects[back('Test Brass Servant', 'p2')]!.controller).toBe('p2'); // under its owner's control (CR 110.2)
    expect(s.zones.battlefield.some((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Ore Cart')).toBe(true);
    expect(find(s, 'Test Titan Frame', 'exile', 'p1')).toBeDefined(); // "except this card"
    expect(s.zones.battlefield.some((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Titan Frame')).toBe(false);
  });
  it('negative (CR 118.3, 602.2b): a nonartifact creature is not one of the cards the cost can exile; with only three others the ability cannot be activated', () => {
    const s = mpScenario({
      defs: [CORE, SERVO, CART, BEAST],
      zones: { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Titan Frame', 'Test Brass Servant', 'Test Ore Cart', 'Test Ore Cart', 'Test Plain Beast'] } },
    });
    const r = applyAction(s, { type: 'activate', player: 'p1', source: find(s, 'Test Titan Frame', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
    const after = r.error ? s : drive(r.state, { pick: (o, min) => o.slice(0, min) });
    expect(after.zones.battlefield.some((id) => after.objects[id]!.kind === 'token')).toBe(false);
    expect(after.zones.battlefield).toContain(find(s, 'Test Titan Frame', 'battlefield', 'p1')); // nothing was exiled
    expect(after.zones.battlefield).toContain(find(s, 'Test Plain Beast', 'battlefield', 'p1'));
  });
});

// ---- Reins of Power: untap both sides, swap them until end of turn, haste ------------------------------------------------------------------------------------------------

const REINS = card('Test Swapped Banners', 'Instant',
  'Untap all creatures you control and all creatures target opponent controls. You and that opponent each gain control of all creatures the other controls until end of turn. Those creatures gain haste until end of turn.',
  { cost: '{0}' });

describe('CR 611.2c, 613.1b, 613.7b: "You and that opponent each gain control of all creatures the other controls until end of turn. Those creatures gain haste until end of turn."', () => {
  const setup = (): GameState => mpScenario({
    defs: [REINS, BEAST, SERVO],
    zones: {
      p1: { hand: ['Test Swapped Banners'], battlefield: [{ name: 'Test Plain Beast', tapped: true } as never] },
      p2: { battlefield: [{ name: 'Test Brass Servant', tapped: true } as never, 'Test Plain Beast'] },
      p3: { battlefield: ['Test Brass Servant'] },
    },
  });
  it('is automated', () => { expect(full(REINS)).toBe(true); });
  it('the two groups are swapped at once (each set determined before either change), untapped, with haste; a third player\'s creature is untouched; control returns at end of turn', () => {
    let s = setup();
    const mine = find(s, 'Test Plain Beast', 'battlefield', 'p1');
    const theirs = [find(s, 'Test Brass Servant', 'battlefield', 'p2'), find(s, 'Test Plain Beast', 'battlefield', 'p2')];
    const p3s = find(s, 'Test Brass Servant', 'battlefield', 'p3');
    s = cast(s, 'Test Swapped Banners', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(getChars(s, mine).controller).toBe('p2');
    for (const id of theirs) expect(getChars(s, id).controller).toBe('p1');
    for (const id of [mine, ...theirs]) {
      expect(s.objects[id]!.tapped).toBe(false);
      expect(hasKeyword(getChars(s, id), 'haste')).toBe(true);
    }
    expect(getChars(s, p3s).controller).toBe('p3');
    expect(hasKeyword(getChars(s, p3s), 'haste')).toBe(false);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', "p2's turn");
    expect(getChars(s, mine).controller).toBe('p1');
    for (const id of theirs) expect(getChars(s, id).controller).toBe('p2');
    expect(hasKeyword(getChars(s, mine), 'haste')).toBe(false);
  });
  it('negative: with no creatures of yours, you still take the opponent\'s; nothing of yours goes to them', () => {
    let s = mpScenario({ defs: [REINS, BEAST], zones: { p1: { hand: ['Test Swapped Banners'] }, p2: { battlefield: ['Test Plain Beast'] } } });
    const b = find(s, 'Test Plain Beast', 'battlefield', 'p2');
    s = cast(s, 'Test Swapped Banners', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(getChars(s, b).controller).toBe('p1');
    expect(s.zones.battlefield.filter((id) => getChars(s, id).controller === 'p2').length).toBe(0);
  });
});
