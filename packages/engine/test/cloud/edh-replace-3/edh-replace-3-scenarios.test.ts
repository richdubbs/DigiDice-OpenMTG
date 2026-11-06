/**
 * Commander lane edh-replace, round edh-replace-3: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (media.wizards.com), except where a cite is marked unverified.
 *
 *   CR 615.13, 615.1, 603.2   "Whenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
const P1: Target = { kind: 'player', id: 'p1' };
const P2: Target = { kind: 'player', id: 'p2' };
const obj = (id: ObjectId): Target => ({ kind: 'object', id });
const marked = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;

/** Answer the decisions that come up until priority (payments automatic; targets in order; object choices from `objects` in order, else the first allowed). */
function drive(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects.shift() ?? p.options.slice(0, Math.max(1, p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, objects);
  return s;
}
/** `player` activates the first ability of `src` whose label contains `label` (p2 gets priority by p1 passing first), and the stack resolves. */
function activate(s0: GameState, src: ObjectId, targets: Target[][] = [], player: PlayerId = 'p1', label = '', objects: ObjectId[][] = []): GameState {
  let s = s0;
  if (player === 'p2') s = pass(s);
  const a = legal(s, player, 'activate').find((x) => x.object === src && x.label.includes(label));
  if (a === undefined) throw new Error(`no activation of ${src} for ${player}`);
  return resolveAll(drive(act(s, a.action), targets, objects), targets, objects);
}
const cast = (s0: GameState, name: string, player: PlayerId = 'p1', targets: Target[][] = []): GameState =>
  resolveAll(drive(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), targets), targets);

const RED_BLASTER = card('Test Red Blaster', 'Creature — Goblin', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const ONE_BLASTER = card('Test Pinger', 'Creature — Goblin', '{0}: This creature deals 1 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const BEAR = card('Test Brown Bear', 'Creature — Bear', '', { pt: ['2', '20'] });
const BASE = [RED_BLASTER, ONE_BLASTER, BEAR];

describe('CR 615.13, 615.1: "Whenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature."', () => {
  const SPRITE = card('Test Warding Sprite', 'Creature — Faerie', "When this creature enters, prevent all damage that would be dealt to you this turn.\nWhenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature.", { pt: ['1', '1'] });
  const defs = [...BASE, SPRITE];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Warding Sprite'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger'] } });
  it('is automated', () => expect(full(SPRITE)).toBe(true));
  it('damage to you prevented by the effect puts that many counters (3 and then 1), and you lose no life', () => {
    const s1 = cast(setup(), 'Test Warding Sprite');
    const sprite = find(s1, 'Test Warding Sprite', 'battlefield', 'p1');
    expect(counters(s1, sprite)).toBe(0);
    const s2 = activate(s1, find(s1, 'Test Red Blaster', 'battlefield', 'p2'), [[P1]], 'p2');
    expect(life(s2, 'p1')).toBe(20);
    expect(counters(s2, sprite)).toBe(3);
    const s3 = activate(s2, find(s2, 'Test Pinger', 'battlefield', 'p2'), [[P1]], 'p2');
    expect(life(s3, 'p1')).toBe(20);
    expect(counters(s3, sprite)).toBe(4);
  });
  it('damage that is not prevented (to a creature, to the opponent) does not trigger it; before the prevention exists, damage to you is dealt and makes no counters', () => {
    const defs2 = [...defs];
    const s0 = scenario([], { defs: defs2, p1: { hand: ['Test Warding Sprite'], battlefield: ['Test Brown Bear'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger'] } });
    const before = activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p2'), [[P1]], 'p2');
    expect(life(before, 'p1')).toBe(20 - 3);
    const s1 = cast(s0, 'Test Warding Sprite');
    const sprite = find(s1, 'Test Warding Sprite', 'battlefield', 'p1');
    const bear = find(s1, 'Test Brown Bear', 'battlefield', 'p1');
    const blaster = find(s1, 'Test Red Blaster', 'battlefield', 'p2');
    const s2 = activate(s1, blaster, [[P2]], 'p2');
    expect(life(s2, 'p2')).toBe(20 - 3);
    const s3 = activate(s2, blaster, [[obj(bear)]], 'p2');
    expect(marked(s3, bear)).toBe(3); // the prevention is of damage to you only
    expect(counters(s3, sprite)).toBe(0);
  });
});

describe('CR 615.13: "triggers each time a prevention effect is applied to one or more simultaneous damage events": two sources dealing combat damage to you at once are one occurrence', () => {
  const FLASHER = card('Test Flash Warder', 'Creature — Faerie', "Flash\nWhen this creature enters, prevent all combat damage that would be dealt to you this turn.\nWhenever damage that would be dealt to you is prevented, you gain 1 life.", { pt: ['1', '1'] });
  const BRUTE = card('Test Strong Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
  const defs = [...BASE, FLASHER, BRUTE];
  it('is automated', () => expect(full(FLASHER)).toBe(true));
  it('two attackers, 6 damage prevented: you gain 1 life once, not twice; with one attacker also once', () => {
    for (const [n, expected] of [[2, 20 + 1], [1, 20 + 1]] as const) {
      const s0 = scenario([], { defs, p1: { battlefield: Array.from({ length: n }, () => 'Test Strong Bear') }, p2: { hand: ['Test Flash Warder'] } });
      const attackers = findAll(s0, 'Test Strong Bear', 'battlefield', 'p1');
      let s = s0;
      for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
      s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((a) => ({ attacker: a, defender: 'p2' as PlayerId })) });
      s = pass(s);
      s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Warder', 'hand', 'p2') })));
      for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
      s = resolveAll(s);
      expect(life(s, 'p2')).toBe(expected);
    }
  });
});

describe('CR 614.12a, 607.2d, 120.3: "As this creature enters, choose a player. Whenever this creature is dealt damage, it deals that much damage to the chosen player. {T}: This creature deals 1 damage to itself."', () => {
  const DOLL = card('Test Plush Guardian', 'Artifact Creature — Toy', "Indestructible\nAs this creature enters, choose a player.\nWhenever this creature is dealt damage, it deals that much damage to the chosen player.\n{T}: This creature deals 1 damage to itself.", { pt: ['1', '3'] });
  const defs = [...BASE, DOLL];
  it('is automated', () => expect(full(DOLL)).toBe(true));
  /** Cast the Guardian and choose `chosen` as it enters. */
  const enter = (s0: GameState, chosen: PlayerId): GameState => {
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Plush Guardian', 'hand', 'p1') }));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseOption');
    return answer(s, { kind: 'chooseOption', ids: [chosen] });
  };
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Plush Guardian'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger'] } });
  it('damage dealt to it, more than its toughness too, is dealt by it to the player chosen as it entered (here the opponent), and only then', () => {
    const s1 = enter(setup(), 'p2');
    const doll = find(s1, 'Test Plush Guardian', 'battlefield', 'p1');
    const s2 = activate(s1, find(s1, 'Test Red Blaster', 'battlefield', 'p2'), [[obj(doll)]], 'p2');
    expect(life(s2, 'p2')).toBe(20 - 3); // 3 damage to a 1/3, and the trigger dealt 3 to the chosen player (the damage was not capped at its toughness)
    expect(life(s2, 'p1')).toBe(20);
    const s3 = activate(s2, find(s2, 'Test Pinger', 'battlefield', 'p2'), [[P2]], 'p2'); // damage to the chosen player itself makes nothing happen
    expect(life(s3, 'p2')).toBe(20 - 3 - 1);
    expect(life(s3, 'p1')).toBe(20);
  });
  it('the choice is the player made as it entered, not an opponent by default: choosing yourself makes its damage hit you', () => {
    const s1 = enter(setup(), 'p1');
    const doll = find(s1, 'Test Plush Guardian', 'battlefield', 'p1');
    const s2 = activate(s1, find(s1, 'Test Pinger', 'battlefield', 'p2'), [[obj(doll)]], 'p2');
    expect(life(s2, 'p1')).toBe(20 - 1);
    expect(life(s2, 'p2')).toBe(20);
  });
  it('"{T}: This creature deals 1 damage to itself": it takes 1 damage (indestructible keeps it) and its own trigger deals that 1 to the chosen player', () => {
    const s1 = advanceTo(enter(setup(), 'p2'), 3, 'main1'); // no longer summoning sick on its controller's next turn (CR 302.6)
    const doll = find(s1, 'Test Plush Guardian', 'battlefield', 'p1');
    const s2 = activate(s1, doll, [], 'p1', '');
    expect(marked(s2, doll)).toBe(1);
    expect(life(s2, 'p2')).toBe(20 - 1);
    expect(s2.objects[doll]!.tapped).toBe(true);
  });
});

describe('CR 614.1a, 614.6, 601.2a: "If a nontoken creature would enter and it wasn\'t cast, exile it instead."', () => {
  const PRIEST = card('Test Containment Warder', 'Creature — Human Cleric', "Flash\nIf a nontoken creature would enter and it wasn't cast, exile it instead.", { pt: ['2', '2'] });
  const REANIMATE = card('Test Raise Dead', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const RETRIEVE = card('Test Raise Relic', 'Sorcery', 'Return target artifact card from your graveyard to the battlefield.');
  const MAKER = card('Test Soldier Maker', 'Creature — Human', '{0}: Create a 1/1 white Soldier creature token.', { pt: ['1', '1'] });
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const CUB = card('Test Flash Cub', 'Creature — Bear', 'Flash', { pt: ['1', '1'] });
  const defs = [...BASE, PRIEST, REANIMATE, RETRIEVE, MAKER, TRINKET, CUB];
  const names = (s: GameState, zone: 'battlefield' | 'exile', p: PlayerId): string[] => (zone === 'battlefield' ? s.zones.battlefield : s.zones.exile).filter((id) => s.objects[id]!.controller === p || s.objects[id]!.owner === p).map((id) => s.objects[id]!.defId);
  it('is automated', () => expect(full(PRIEST)).toBe(true));
  it('a creature cast from your hand enters; a creature put onto the battlefield from a graveyard is exiled instead (and a creature cast, by anyone, still enters)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Raise Dead', 'Test Brown Bear'], graveyard: ['Test Pinger'], battlefield: ['Test Containment Warder'] }, p2: { hand: ['Test Flash Cub'] } });
    const s1 = cast(s0, 'Test Brown Bear');
    expect(names(s1, 'battlefield', 'p1')).toContain('Test Brown Bear');
    const s2 = cast(s1, 'Test Raise Dead', 'p1', [[obj(find(s1, 'Test Pinger', 'graveyard', 'p1'))]]);
    expect(names(s2, 'battlefield', 'p1')).not.toContain('Test Pinger');
    expect(names(s2, 'exile', 'p1')).toContain('Test Pinger');
    const s3 = scenario([], { defs, p1: { battlefield: ['Test Containment Warder'] }, p2: { hand: ['Test Flash Cub'] } });
    const s4 = cast(pass(s3), 'Test Flash Cub', 'p2');
    expect(names(s4, 'battlefield', 'p2')).toContain('Test Flash Cub');
  });
  it('tokens are not exiled (nontoken only) and a noncreature permanent put onto the battlefield from a graveyard enters', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Raise Relic'], graveyard: ['Test Trinket'], battlefield: ['Test Containment Warder', 'Test Soldier Maker'] } });
    const s1 = activate(s0, find(s0, 'Test Soldier Maker', 'battlefield', 'p1'));
    expect(names(s1, 'battlefield', 'p1').filter((n) => n.includes('Soldier Token'))).toHaveLength(1);
    const s2 = cast(s1, 'Test Raise Relic', 'p1', [[obj(find(s1, 'Test Trinket', 'graveyard', 'p1'))]]);
    expect(names(s2, 'battlefield', 'p1')).toContain('Test Trinket');
  });
  it('the Warder does not exile itself: it returns from the graveyard with no Warder on the battlefield yet (the replacement works only from the battlefield)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Raise Dead'], graveyard: ['Test Containment Warder'] } });
    const s1 = cast(s0, 'Test Raise Dead', 'p1', [[obj(find(s0, 'Test Containment Warder', 'graveyard', 'p1'))]]);
    expect(names(s1, 'battlefield', 'p1')).toContain('Test Containment Warder');
  });
});

describe('CR 615.1, 615.5, 603.12: "If damage would be dealt to this creature, prevent that damage. When damage is prevented this way, this creature deals that much damage to any other target."', () => {
  const WARDER = card('Test Phyrexian Warder', 'Creature — Horror', "Flying\nIf damage would be dealt to this creature, prevent that damage. When damage is prevented this way, this creature deals that much damage to any other target.", { pt: ['2', '2'] });
  const defs = [...BASE, WARDER];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Phyrexian Warder', 'Test Brown Bear'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger', 'Test Brown Bear'] } });
  it('is automated', () => expect(full(WARDER)).toBe(true));
  it('damage to it is prevented (it takes none) and the reflexive trigger deals that much damage to the target its controller chooses: a player, or a creature', () => {
    const s0 = setup();
    const warder = find(s0, 'Test Phyrexian Warder', 'battlefield', 'p1');
    const blaster = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const s1 = activate(s0, blaster, [[obj(warder)], [P2]], 'p2');
    expect(marked(s1, warder)).toBe(0);
    expect(life(s1, 'p2')).toBe(20 - 3);
    const theirBear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    const s2 = activate(s0, blaster, [[obj(warder)], [obj(theirBear)]], 'p2');
    expect(marked(s2, theirBear)).toBe(3);
    expect(marked(s2, warder)).toBe(0);
  });
  it('damage to another creature is not prevented and starts nothing; the Warder itself is not a legal target of its trigger ("any other target")', () => {
    const s0 = setup();
    const warder = find(s0, 'Test Phyrexian Warder', 'battlefield', 'p1');
    const myBear = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const s1 = activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p2'), [[obj(myBear)]], 'p2');
    expect(marked(s1, myBear)).toBe(3);
    expect(life(s1, 'p2')).toBe(20);
    // the options of the trigger's target do not include the Warder
    let s = pass(s0);
    const a = legal(s, 'p2', 'activate').find((x) => x.object === find(s0, 'Test Pinger', 'battlefield', 'p2'))!;
    s = act(s, a.action);
    s = answer(s, { kind: 'chooseTargets', targets: [obj(warder)] });
    s = drive(s);
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseTargets');
    const pending = s.pending as { objects: ObjectId[] };
    expect(pending.objects).not.toContain(warder);
    expect(pending.objects).toContain(myBear);
  });
});

describe('CR 615.1, 615.5, 122.1: "If damage would be dealt to another creature you control, prevent that damage. Put a +1/+1 counter on that creature for each 1 damage prevented this way."', () => {
  const GUARD = card('Test Guarding Incarnation', 'Creature — Incarnation', "Trample\nIf damage would be dealt to another creature you control, prevent that damage. Put a +1/+1 counter on that creature for each 1 damage prevented this way.", { pt: ['6', '6'] });
  const defs = [...BASE, GUARD];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Guarding Incarnation', 'Test Brown Bear', 'Test Pinger'] }, p2: { battlefield: ['Test Red Blaster', 'Test Pinger', 'Test Brown Bear'] } });
  it('is automated', () => expect(full(GUARD)).toBe(true));
  it('damage to another creature you control is prevented and that creature gets as many +1/+1 counters as the damage prevented (3, then 1 more for the Pinger\'s 1)', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const s1 = activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p2'), [[obj(bear)]], 'p2');
    expect(marked(s1, bear)).toBe(0);
    expect(counters(s1, bear)).toBe(3);
    const s2 = activate(s1, find(s1, 'Test Pinger', 'battlefield', 'p2'), [[obj(bear)]], 'p2');
    expect(counters(s2, bear)).toBe(4);
    const pinger = find(s2, 'Test Pinger', 'battlefield', 'p1');
    const s3 = activate(s2, find(s2, 'Test Red Blaster', 'battlefield', 'p2'), [[obj(pinger)]], 'p2');
    expect(counters(s3, pinger)).toBe(3); // each creature gets its own
    expect(counters(s3, bear)).toBe(4);
  });
  it('damage to the Incarnation itself, to an opponent\'s creature and to a player is not prevented and puts no counter anywhere', () => {
    const s0 = setup();
    const incarnation = find(s0, 'Test Guarding Incarnation', 'battlefield', 'p1');
    const theirBear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    const blaster = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    const s1 = activate(s0, blaster, [[obj(incarnation)]], 'p2');
    expect(marked(s1, incarnation)).toBe(3);
    expect(counters(s1, incarnation)).toBe(0);
    const s2 = activate(s1, blaster, [[obj(theirBear)]], 'p2');
    expect(marked(s2, theirBear)).toBe(3);
    expect(counters(s2, theirBear)).toBe(0);
    const s3 = activate(s2, blaster, [[P1]], 'p2');
    expect(life(s3, 'p1')).toBe(20 - 3);
  });
});

describe('CR 614.1a, 611.2a, 601.2a: "Until end of turn, if a [nontoken] creature would enter and it wasn\'t cast, exile it instead." as a resolved effect (Hallowed Moonlight, Mistcaller)', () => {
  const MOON = card('Test Pale Moonlight', 'Instant', "Until end of turn, if a creature would enter and it wasn't cast, exile it instead.\nDraw a card.");
  const SEER = card('Test Mist Seer', 'Creature — Merfolk', "Sacrifice this creature: Until end of turn, if a nontoken creature would enter and it wasn't cast, exile it instead.", { pt: ['1', '1'] });
  const REANIMATE = card('Test Raise Dead', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const MAKER = card('Test Soldier Maker', 'Creature — Human', '{0}: Create a 1/1 white Soldier creature token.', { pt: ['1', '1'] });
  const defs = [...BASE, MOON, SEER, REANIMATE, MAKER];
  const on = (s: GameState, p: PlayerId, defId: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId.includes(defId)).length;
  const exiled = (s: GameState, defId: string): number => s.zones.exile.filter((id) => s.objects[id]!.defId === defId).length;
  it('are automated', () => { expect(full(MOON)).toBe(true); expect(full(SEER)).toBe(true); });
  it('until end of turn a creature put onto the battlefield, a token too, is exiled (the Moonlight: "a creature"); a creature cast still enters; the effect ends with the turn', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Pale Moonlight', 'Test Raise Dead', 'Test Raise Dead', 'Test Brown Bear'], graveyard: ['Test Pinger', 'Test Red Blaster'], battlefield: ['Test Soldier Maker'] } });
    const s1 = cast(s0, 'Test Pale Moonlight');
    const s2 = cast(s1, 'Test Raise Dead', 'p1', [[obj(find(s1, 'Test Pinger', 'graveyard', 'p1'))]]);
    expect(exiled(s2, 'Test Pinger')).toBe(1);
    expect(on(s2, 'p1', 'Test Pinger')).toBe(0);
    const s3 = activate(s2, find(s2, 'Test Soldier Maker', 'battlefield', 'p1'));
    expect(on(s3, 'p1', 'Soldier Token')).toBe(0);
    const s4 = cast(s3, 'Test Brown Bear');
    expect(on(s4, 'p1', 'Test Brown Bear')).toBe(1);
    const s5 = advanceTo(s4, 3, 'main1'); // the next turn of p1: the effect is over
    expect(s5.turn.number).toBe(3);
    const s6 = cast(s5, 'Test Raise Dead', 'p1', [[obj(find(s5, 'Test Red Blaster', 'graveyard', 'p1'))]]);
    expect(on(s6, 'p1', 'Test Red Blaster')).toBe(1);
  });
  it('the Mist Seer\'s version is for nontoken creatures only: a token is made; a reanimated creature is exiled; without sacrificing it nothing happens', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Raise Dead'], graveyard: ['Test Pinger'], battlefield: ['Test Mist Seer', 'Test Soldier Maker'] } });
    const noSac = cast(s0, 'Test Raise Dead', 'p1', [[obj(find(s0, 'Test Pinger', 'graveyard', 'p1'))]]);
    expect(on(noSac, 'p1', 'Test Pinger')).toBe(1);
    const s1 = activate(s0, find(s0, 'Test Mist Seer', 'battlefield', 'p1'));
    expect(on(s1, 'p1', 'Test Mist Seer')).toBe(0);
    const s2 = activate(s1, find(s1, 'Test Soldier Maker', 'battlefield', 'p1'));
    expect(on(s2, 'p1', 'Soldier Token')).toBe(1);
    const s3 = cast(s2, 'Test Raise Dead', 'p1', [[obj(find(s2, 'Test Pinger', 'graveyard', 'p1'))]]);
    expect(exiled(s3, 'Test Pinger')).toBe(1);
  });
});
