/**
 * Coordinator D, round edh-d-61 (lane transform, second pass): the round's readings and engine changes played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case.
 * CR cites: fetched from the 2026-09-25 text where noted in the record, otherwise from memory (listed as unverified in the record).
 *
 *   CR 701.21a, 118.12a, 608.2d     "Each opponent sacrifices a creature of their choice unless they discard a card."
 *   CR 603.7, 505.1                 "Whenever ~ attacks, add {R} at the beginning of your next main phase this turn."
 *   CR 120.3, 115.1, 601.2c         "~ deals 1 damage to each of up to one target creature, up to one target player, and/or up to one target planeswalker."
 *   CR 701.53a, 701.27a, 608.2d     "Incubate 2, then transform an Incubator token you control." / "incubate 3 X times"
 *   CR 202.3e, 611.2c, 608.2h       "Whenever you cast a spell, your opponents can't cast spells with the same mana value as that spell until your next turn."
 *   CR 603.7c, 700.4, 712.14a       "{2}: ~ fights another target creature you control. When ~ dies this turn, return it to the battlefield transformed under your control."
 *   CR 608.2d, 101.4                "Whenever ~ attacks, defending player chooses a nonland card in your graveyard. Return that card to your hand. ~ gets +X/+0 ..."
 *   CR 607.2a, 202.3, 701.27a       "If cards with five or more different mana values are exiled with ~, you gain 5 life, untap ~, and transform it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, castAuto, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
type Face = { name: string; type: string; text: string; pt?: [string, string]; cost?: string };
/** A transforming double-faced card from two invented faces, compiled from text. */
function dfc(front: Face, back: Face): CardDef {
  const face = (f: Face) => ({ name: f.name, mana_cost: f.cost ?? '', type_line: f.type, oracle_text: f.text, colors: [], ...(f.pt ? { power: f.pt[0], toughness: f.pt[1] } : {}) });
  return compileCard({ name: `${front.name} // ${back.name}`, layout: 'transform', mana_cost: front.cost ?? '', type_line: `${front.type} // ${back.type}`, oracle_text: '', colors: [], keywords: [], card_faces: [face(front), face(back)] } as unknown as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const ply = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: [...p.items.map((i: { id: string }) => i.id)] });
    else if (p.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (p.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, opts);
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
const onField = (s: GameState, name: string, owner: PlayerId = 'p1'): ObjectId => find(s, name, 'battlefield', owner);
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const inGy = (s: GameState, name: string, owner: PlayerId): boolean => s.zones.graveyard[owner]!.some((id) => getChars(s, id).name === name);
const handNames = (s: GameState, owner: PlayerId): string[] => s.zones.hand[owner]!.map((id) => getChars(s, id).name);

// ---- "Each opponent sacrifices a creature of their choice unless they discard a card." ---------------------------------------------------------------------------------------
const REAPER = card('Test Reaper', 'Artifact', '{0}: Each opponent sacrifices a creature of their choice unless they discard a card.');
const BOBCRIT = card('Test Bobcrit', 'Creature — Bear', '', { pt: ['2', '2'] });
describe('CR 701.21a, 118.12a: "Each opponent sacrifices a creature of their choice unless they discard a card."', () => {
  it('is automated', () => { expect(noManual(REAPER)).toBe(true); });
  const setup = () => scenario([], { p1: { battlefield: ['Test Reaper'] }, p2: { battlefield: ['Test Bobcrit'], hand: ['Plains'] }, defs: [REAPER, BOBCRIT] });
  const run = (a: DecisionAnswer): GameState => {
    const s0 = setup();
    return resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: onField(s0, 'Test Reaper'), ability: 'p:0:0' })), { answers: [a, a] });
  };
  it('the opponent who declines to discard sacrifices their creature', () => {
    const s = run(no);
    expect(inGy(s, 'Test Bobcrit', 'p2')).toBe(true);
    expect(handNames(s, 'p2')).toContain('Plains');
  });
  it('negative: the opponent who discards a card keeps the creature', () => {
    const s = run(yes);
    expect(inGy(s, 'Test Bobcrit', 'p2')).toBe(false);
    expect(handNames(s, 'p2')).not.toContain('Plains');
  });
});

// ---- "add {R} at the beginning of your next main phase this turn" ----------------------------------------------------------------------------------------------------------
const STORM = card('Test Stormer', 'Creature — Werewolf', 'Whenever this creature attacks, add {R} at the beginning of your next main phase this turn.', { pt: ['2', '2'] });
describe('CR 603.7, 505.1: "Whenever ~ attacks, add {R} at the beginning of your next main phase this turn."', () => {
  it('is automated', () => { expect(noManual(STORM)).toBe(true); });
  const redIn = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.manaPool.filter((m) => m.type === 'R').length;
  it('no mana as the creature attacks; one red mana when the second main phase begins', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Stormer'] }, defs: [STORM] });
    let s = resolveAll(settle(declareAttackers(toDeclareAttackers(s0), [[onField(s0, 'Test Stormer')]])));
    expect(redIn(s)).toBe(0);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 80);
    s = resolveAll(s);
    expect(redIn(s)).toBe(1);
  });
  it('negative: a creature that does not attack adds nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Stormer'] }, defs: [STORM] });
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), []), (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 80);
    s = resolveAll(s);
    expect(redIn(s)).toBe(0);
  });
});

// ---- three targets of one damage instruction -------------------------------------------------------------------------------------------------------------------------------
const ARSON = card('Test Arsonist', 'Creature — Werewolf', 'Whenever this creature attacks, it deals 1 damage to each of up to one target creature, up to one target player, and/or up to one target planeswalker.', { pt: ['2', '2'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['3', '3'] });
const WALKER = card('Test Walker', 'Planeswalker — Test', '', {});
describe('CR 120.3, 115.1: "~ deals 1 damage to each of up to one target creature, up to one target player, and/or up to one target planeswalker."', () => {
  it('is automated', () => { expect(noManual(ARSON)).toBe(true); });
  it('each chosen target is dealt 1 damage; targets left out are dealt none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Arsonist'] }, p2: { battlefield: ['Test Bear'] }, defs: [ARSON, BEAR] });
    const bear = onField(s0, 'Test Bear', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), [[onField(s0, 'Test Arsonist')]]);
    s = resolveAll(settle(s, { targets: [[obj(bear)], [ply('p2')], []] }));
    expect(s.objects[bear]!.damage).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('negative: choosing only the player leaves the creature undamaged', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Arsonist'] }, p2: { battlefield: ['Test Bear'] }, defs: [ARSON, BEAR] });
    const bear = onField(s0, 'Test Bear', 'p2');
    let s = declareAttackers(toDeclareAttackers(s0), [[onField(s0, 'Test Arsonist')]]);
    s = resolveAll(settle(s, { targets: [[], [ply('p2')], []] }));
    expect(s.objects[bear]!.damage).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});
void WALKER;

// ---- "Incubate 2, then transform an Incubator token you control." ------------------------------------------------------------------------------------------------------------
const SUNDER = card('Test Sunder', 'Sorcery', 'Incubate 2, then transform an Incubator token you control.');
const PLAINCUBATE = card('Test Plain Incubate', 'Sorcery', 'Incubate 2.');
describe('CR 701.53a, 701.27a: "Incubate 2, then transform an Incubator token you control."', () => {
  it('is automated', () => { expect(noManual(SUNDER)).toBe(true); });
  const names = (s: GameState): string[] => s.zones.battlefield.map((id) => nameOf(s, id));
  it('the Incubator token it made becomes a 0/0 Phyrexian artifact creature with its two counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sunder'] }, defs: [SUNDER] });
    const s = resolveAll(settle(castAuto(s0, 'Test Sunder')));
    expect(names(s)).toEqual(['Phyrexian Token']);
    const id = s.zones.battlefield[0]!;
    expect(getChars(s, id).types).toContain('Creature');
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
  });
  it('negative: plain "Incubate 2" leaves the Incubator token untransformed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Plain Incubate'] }, defs: [PLAINCUBATE] });
    const s = resolveAll(settle(castAuto(s0, 'Test Plain Incubate')));
    expect(names(s)).toEqual(['Incubator Token']);
  });
});

// ---- "Incubate 3 X times" ----------------------------------------------------------------------------------------------------------------------------------------------------
const FORGE = card('Test Forge', 'Artifact', '{X}: Incubate 3 X times.');
describe('CR 701.53a, 107.3: "Incubate 3 X times."', () => {
  it('is automated', () => { expect(noManual(FORGE)).toBe(true); });
  it('X = 2 makes two Incubator tokens with three +1/+1 counters each; X = 0 makes none', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Forge', 'Plains', 'Plains'] }, defs: [FORGE] });
    const id = onField(s0, 'Test Forge');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }), { answers: [{ kind: 'chooseNumber', n: 2 }] }), { answers: [] });
    const tokens = s.zones.battlefield.filter((t) => nameOf(s, t) === 'Incubator Token');
    expect(tokens.length).toBe(2);
    for (const t of tokens) expect(s.objects[t]!.counters['+1/+1']).toBe(3);
    const z = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }), { answers: [{ kind: 'chooseNumber', n: 0 }] }));
    expect(z.zones.battlefield.filter((t) => nameOf(z, t) === 'Incubator Token').length).toBe(0);
  });
});

// ---- "your opponents can't cast spells with the same mana value as that spell until your next turn" -----------------------------------------------------------------------------
const WARDEN = card('Test Warden', 'Enchantment', 'Whenever you cast a spell, your opponents can\'t cast spells with the same mana value as that spell until your next turn.');
const TWO = card('Test Two', 'Instant', 'You gain 1 life.', { cost: '{1}{R}' });
const TWOB = card('Test Two B', 'Instant', 'You gain 1 life.', { cost: '{1}{U}' });
const THREE = card('Test Three', 'Instant', 'You gain 1 life.', { cost: '{2}{U}' });
describe('CR 202.3e, 611.2c, 608.2h: "Whenever you cast a spell, your opponents can\'t cast spells with the same mana value as that spell until your next turn."', () => {
  it('is automated', () => { expect(noManual(WARDEN)).toBe(true); });
  const setup = () => {
    const s0 = scenario(['Mountain', 'Island'], { p1: { battlefield: ['Test Warden', 'Mountain', 'Mountain'], hand: ['Test Two'] }, p2: { battlefield: ['Island', 'Island', 'Island'], hand: ['Test Two B', 'Test Three'] }, defs: [WARDEN, TWO, TWOB, THREE] });
    return resolveAll(settle(castAuto(s0, 'Test Two')));
  };
  it('Bob cannot cast a spell of mana value 2', () => {
    const s = setup();
    expect(() => castAuto(pass(s), 'Test Two B', { player: 'p2' })).toThrow(/cast|can't|legal/i);
  });
  it('negative: Bob can still cast a spell of mana value 3', () => {
    const s = setup();
    const t = castAuto(pass(s), 'Test Three', { player: 'p2' });
    expect(t.zones.stack.length).toBeGreaterThan(0);
  });
});

// ---- "When ~ dies this turn, return it to the battlefield transformed under your control." -------------------------------------------------------------------------------
const GUARD = dfc(
  { name: 'Test Guardian', type: 'Artifact Creature — Golem', text: '{0}: This creature fights another target creature you control. When this creature dies this turn, return it to the battlefield transformed under your control.', pt: ['1', '1'] },
  { name: 'Test Garrison', type: 'Land', text: '{T}: Add {C}.' },
);
const BIG = card('Test Big Friend', 'Creature — Giant', '', { pt: ['4', '4'] });
const SMALL = card('Test Small Friend', 'Creature — Mouse', '', { pt: ['0', '3'] });
describe('CR 603.7c, 700.4, 712.14a: "~ fights another target creature you control. When ~ dies this turn, return it to the battlefield transformed."', () => {
  it('is automated', () => { expect(noManual(GUARD)).toBe(true); });
  it('when the fight kills it, it comes back transformed (the back face, under Alice\'s control)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Guardian // Test Garrison', 'Test Big Friend'] }, defs: [GUARD, BIG] });
    const g = onField(s0, 'Test Guardian // Test Garrison');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: g, ability: 'p:0:0' }), { targets: [[obj(onField(s0, 'Test Big Friend'))]] }));
    const back = s.zones.battlefield.find((id) => s.objects[id]!.defId === GUARD.id);
    expect(back).toBeDefined();
    expect(s.objects[back!]!.face).toBe(1);
    expect(nameOf(s, back!)).toBe('Test Garrison');
  });
  it('negative: when the fight does not kill it, it stays on the battlefield, front face up', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Guardian // Test Garrison', 'Test Small Friend'] }, defs: [GUARD, SMALL] });
    const g = onField(s0, 'Test Guardian // Test Garrison');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: g, ability: 'p:0:0' }), { targets: [[obj(onField(s0, 'Test Small Friend'))]] }));
    expect(s.objects[g]!.face).toBe(0);
    expect(s.zones.battlefield).toContain(g);
  });
});

// ---- "defending player chooses a nonland card in your graveyard. Return that card to your hand. ~ gets +X/+0 ..." ----------------------------------------------------------------
const DRAGON = card('Test Dragon', 'Creature — Dragon', 'Whenever this creature attacks, defending player chooses a nonland card in your graveyard. Return that card to your hand. This creature gets +X/+0 until end of turn, where X is the mana value of that card.', { pt: ['2', '2'] });
const CHEAP = card('Test Cheap Spell', 'Sorcery', 'You gain 1 life.', { cost: '{1}' });
const COSTLY = card('Test Costly Spell', 'Sorcery', 'You gain 1 life.', { cost: '{4}{R}' });
describe('CR 608.2d, 101.4: "Defending player chooses a nonland card in your graveyard. Return that card to your hand. ~ gets +X/+0, where X is its mana value."', () => {
  it('is automated', () => { expect(noManual(DRAGON)).toBe(true); });
  it('Bob chooses which of Alice\'s nonland cards comes back (never a land); the dragon gets +X/+0 for its mana value', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dragon'], graveyard: ['Test Cheap Spell', 'Test Costly Spell', 'Plains'] }, defs: [DRAGON, CHEAP, COSTLY] });
    const dragon = onField(s0, 'Test Dragon');
    let s = declareAttackers(toDeclareAttackers(s0), [[dragon]]);
    for (let i = 0; i < 6 && s.pending?.kind === 'priority'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p2'); // the defending player chooses, not Alice
    const costly = find(s, 'Test Costly Spell', 'graveyard', 'p1');
    s = settle(s, { picks: [[costly]] });
    s = resolveAll(s);
    expect(handNames(s, 'p1')).toContain('Test Costly Spell');
    expect(inGy(s, 'Plains', 'p1')).toBe(true);
    expect(getChars(s, dragon).power).toBe('7');
  });
});

// ---- "If cards with five or more different mana values are exiled with ~, you gain 5 life, untap ~, and transform it." -----------------------------------------------------
const GATE = dfc(
  { name: 'Test Gateway', type: 'Legendary Artifact', text: '{0}: Draw a card, then exile a card from your hand. If cards with five or more different mana values are exiled with Test Gateway, you gain 5 life, untap Test Gateway, and transform it.' },
  { name: 'Test Sanctum', type: 'Legendary Land', text: '{T}: Add {C}.' },
);
const mk = (n: string, mv: number): CardDef => card(n, 'Sorcery', 'You gain 1 life.', { cost: `{${mv}}` });
const SPELLS = [mk('Test Mv1', 1), mk('Test Mv2', 2), mk('Test Mv2b', 2), mk('Test Mv3', 3), mk('Test Mv4', 4), mk('Test Mv5', 5)];
describe('CR 607.2a, 202.3: "If cards with five or more different mana values are exiled with ~, you gain 5 life, untap ~, and transform it."', () => {
  it('is automated', () => { expect(noManual(GATE)).toBe(true); });
  const run = (names: string[]): { s: GameState; gate: ObjectId } => {
    let s = scenario([], { p1: { battlefield: ['Test Gateway // Test Sanctum'], hand: names }, defs: [GATE, ...SPELLS] });
    const gate = onField(s, 'Test Gateway // Test Sanctum');
    for (const n of names) {
      s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: gate, ability: 'p:0:0' }), { picks: [[find(s, n, 'hand', 'p1')]] }), { picks: [[find(s, n, 'hand', 'p1')]] });
    }
    return { s, gate };
  };
  it('after cards of five different mana values were exiled with it, it transforms and gains 5 life', () => {
    const { s, gate } = run(['Test Mv1', 'Test Mv2', 'Test Mv3', 'Test Mv4', 'Test Mv5']);
    expect(s.objects[gate]!.face).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(25);
  });
  it('negative: five exiled cards but only four different mana values do not transform it', () => {
    const { s, gate } = run(['Test Mv1', 'Test Mv2', 'Test Mv2b', 'Test Mv3', 'Test Mv4']);
    expect(s.objects[gate]!.face).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

// ---- "Each opponent chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest." -----------
const CULL = card('Test Cull', 'Artifact', '{0}: Each opponent chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest.');
const B1 = card('Test Bear One', 'Creature — Bear', '', { pt: ['2', '2'] });
const B2 = card('Test Bear Two', 'Creature — Bear', '', { pt: ['3', '3'] });
const RING = card('Test Ring', 'Artifact', '');
describe('CR 101.4, 608.2d, 701.21a: "Each opponent chooses an artifact, a creature, an enchantment, and a planeswalker ..., then sacrifices the rest." (opponents only)', () => {
  it('is automated', () => { expect(noManual(CULL)).toBe(true); });
  it('Bob keeps one creature of his choice and his artifact; Alice sacrifices nothing', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Cull', 'Test Bear One', 'Test Bear Two'] }, p2: { battlefield: ['Test Bear One', 'Test Bear Two', 'Test Ring', 'Plains'] }, defs: [CULL, B1, B2, RING] });
    const bobBears = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2' && getChars(s0, id).types.includes('Creature'));
    const a = act(s0, { type: 'activate', player: 'p1', source: onField(s0, 'Test Cull'), ability: 'p:0:0' });
    const s = resolveAll(a, { picks: [[bobBears[0]!]] });
    const bobKept = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(bobKept.length).toBe(3); // one bear, the ring, the land
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(3);
  });
});
