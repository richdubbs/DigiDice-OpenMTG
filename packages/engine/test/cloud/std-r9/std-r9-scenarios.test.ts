/**
 * Standard round 9 (new templates and template status): the templates of parser/templates/zz-cloud/std-r9.json and the engine capability of the round, and
 * two templates the round promoted to `stable` that had no played scenario of their own, played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 601.3, 101.2, 500.7      "You can't cast ~ during your first, second, or third turns of the game." (rst.stdr9.cast.self.firstThreeTurns, `turnsBegun`)
 *   CR 603.7b, 603.2c, 508.1    "When you next attack this turn, ..." (eff.stdr9.nextAttack.thisTurn)
 *   CR 613.4c, 611.3a, 604.1    "Other creatures you control get +1/+1 for each Aura and Equipment attached to ~." (sta.r3static.anthem.foreach, promoted)
 *   CR 400.7, 508.4, 506.3      "exile up to one target creature you own, then return it ... tapped and attacking" (eff.r3choose.exile.thenReturn.yours.tappedAttacking, promoted)
 *   CR 606.4, 107.3a, 601.2b    "−X: Tap target creature. Put X stun counters on it." (a loyalty cost of minus X, CostDef.loyaltyX)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, life, pass, put, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const turnsBegun = (s: GameState, p: PlayerId): number | undefined => s.players.find((x) => x.id === p)!.turnsBegun;

/** Answer the decisions that come up until priority (payments automatic; targets in order; other choices the first allowed). */
function drive(s0: GameState, targets: ObjectId[][] = []): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: ObjectId[][]): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets);
  return s;
}
const cast = (s: GameState, name: string, targets?: ObjectId[][]): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets), targets);
/** From the first main phase of p1's turn, pass to the declare attackers step and declare these attackers (at p2), then answer what comes up. */
function attackWith(s0: GameState, attackers: ObjectId[], targets?: ObjectId[][]): GameState {
  let s = s0;
  for (let i = 0; i < 20 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  return drive(s, targets);
}

describe('CR 601.3, 101.2, 500.7: "You can\'t cast ~ during your first, second, or third turns of the game." (rst.stdr9.cast.self.firstThreeTurns)', () => {
  const LATE = card('Test Latecomer', 'Creature — Elemental', "Flash\nYou can't cast this spell during your first, second, or third turns of the game.", { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(LATE)).toBe(true));
  it('CR 500.7, 500.11: each player\'s turns are counted as they begin (turn 1 is the starting player\'s first, turn 7 their fourth)', () => {
    let s = scenario([], { defs: [LATE] });
    expect(turnsBegun(s, 'p1')).toBe(1);
    expect(turnsBegun(s, 'p2') ?? 0).toBe(0);
    s = advanceTo(s, 7, 'main1');
    expect(turnsBegun(s, 'p1')).toBe(4);
    expect(turnsBegun(s, 'p2')).toBe(3);
  });
  it('during your first turn it can\'t be cast; the restriction says so', () => {
    const s = scenario([], { defs: [LATE], p1: { hand: ['Test Latecomer'] } });
    expect(legal(s, 'p1', 'cast').some((a) => a.action.type === 'cast' && a.action.card === find(s, 'Test Latecomer', 'hand', 'p1'))).toBe(false);
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Latecomer', 'hand', 'p1') });
  });
  it('during your third turn it still can\'t be cast; during your fourth turn it can', () => {
    const s3 = scenario([], { defs: [LATE], p1: { hand: ['Test Latecomer'] } });
    s3.players.find((p) => p.id === 'p1')!.turnsBegun = 3;
    reject(s3, { type: 'cast', player: 'p1', card: find(s3, 'Test Latecomer', 'hand', 'p1') });
    const s4 = scenario([], { defs: [LATE], p1: { hand: ['Test Latecomer'] } });
    s4.players.find((p) => p.id === 'p1')!.turnsBegun = 4;
    expect(findAll(cast(s4, 'Test Latecomer'), 'Test Latecomer', 'battlefield')).toHaveLength(1);
  });
  it('during an opponent\'s turn (not one of your turns) it can be cast with flash, even before your fourth turn', () => {
    let s = scenario([], { defs: [LATE], p1: { hand: ['Test Latecomer'] } });
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    expect(turnsBegun(s, 'p1')).toBe(1);
    s = pass(s); // p2 passes in their main phase: p1 gets priority
    expect(s.pending?.player).toBe('p1');
    expect(findAll(cast(s, 'Test Latecomer'), 'Test Latecomer', 'battlefield')).toHaveLength(1);
  });
});

describe('CR 603.7b, 603.2c, 508.1: "When you next attack this turn, you gain 3 life." (eff.stdr9.nextAttack.thisTurn, one delayed trigger for one declaration)', () => {
  const RALLY = card('Test Rally', 'Sorcery', 'Draw a card. When you next attack this turn, you gain 3 life.');
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(RALLY)).toBe(true));
  it('attacking with two creatures triggers it once: 3 life, not 6', () => {
    let s = scenario([], { defs: [RALLY, PUP], p1: { hand: ['Test Rally'], battlefield: ['Test Pup', 'Test Pup'] } });
    s = cast(s, 'Test Rally');
    const l0 = life(s, 'p1');
    s = resolveAll(attackWith(s, findAll(s, 'Test Pup', 'battlefield', 'p1')));
    expect(life(s, 'p1')).toBe(l0 + 3);
  });
  it('no attack this turn: nothing, and the delayed trigger does not wait for a later turn (CR 603.7c)', () => {
    let s = scenario([], { defs: [RALLY, PUP], p1: { hand: ['Test Rally'], battlefield: ['Test Pup'] } });
    s = cast(s, 'Test Rally');
    const l0 = life(s, 'p1');
    s = attackWith(s, []);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(attackWith(s, [find(s, 'Test Pup', 'battlefield', 'p1')]));
    expect(life(s, 'p1')).toBe(l0);
  });
});

describe('CR 613.4c, 611.3a, 301.5: "Other creatures you control get +1/+1 for each Aura and Equipment attached to ~." (sta.r3static.anthem.foreach)', () => {
  const PAL = card('Test Paladin', 'Creature — Human Knight', 'Other creatures you control get +1/+1 for each Aura and Equipment attached to this creature.', { pt: ['2', '2'] });
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equip {1}');
  const CHARM = card('Test Charm', 'Enchantment — Aura', 'Enchant creature');
  it('is understood', () => expect(noManual(PAL)).toBe(true));
  it('counts the Aura and the Equipment attached to it, continuously; the source itself and an opponent\'s creature are not pumped', () => {
    const s = scenario([], { defs: [PAL, PUP, BLADE, CHARM], p1: { battlefield: ['Test Paladin', 'Test Pup'] }, p2: { battlefield: ['Test Pup'] } });
    const pal = find(s, 'Test Paladin', 'battlefield');
    const mine = find(s, 'Test Pup', 'battlefield', 'p1');
    const theirs = find(s, 'Test Pup', 'battlefield', 'p2');
    expect(Number(getChars(s, mine)!.power)).toBe(1);
    const blade = put(s, 'p1', 'battlefield', 'Test Blade');
    s.objects[blade]!.attachedTo = pal;
    expect(Number(getChars(s, mine)!.power)).toBe(2);
    const charm = put(s, 'p1', 'battlefield', 'Test Charm');
    s.objects[charm]!.attachedTo = pal;
    expect(Number(getChars(s, mine)!.toughness)).toBe(3);
    expect(Number(getChars(s, pal)!.power)).toBe(2);
    expect(Number(getChars(s, theirs)!.power)).toBe(1);
  });
  it('an Equipment attached to another creature does not count', () => {
    const s = scenario([], { defs: [PAL, PUP, BLADE], p1: { battlefield: ['Test Paladin', 'Test Pup'] } });
    const mine = find(s, 'Test Pup', 'battlefield', 'p1');
    const blade = put(s, 'p1', 'battlefield', 'Test Blade');
    s.objects[blade]!.attachedTo = mine;
    expect(Number(getChars(s, mine)!.power)).toBe(1);
  });
});

describe('CR 400.7, 508.4, 506.3: "Whenever ~ attacks, exile up to one target creature you own, then return it to the battlefield under your control tapped and attacking."', () => {
  const RIFT = card('Test Riftrunner', 'Creature — Elf Rebel', 'Whenever this creature attacks, exile up to one target creature you own, then return it to the battlefield under your control tapped and attacking.', { pt: ['2', '2'] });
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(RIFT)).toBe(true));
  it('a creature that did not attack comes back as a new object, tapped and attacking the defending player', () => {
    let s = scenario([], { defs: [RIFT, PUP], p1: { battlefield: ['Test Riftrunner', 'Test Pup'] } });
    const pup = find(s, 'Test Pup', 'battlefield', 'p1');
    s = attackWith(s, [find(s, 'Test Riftrunner', 'battlefield')], [[pup]]);
    s = resolveAll(s, [[pup]]);
    const back = find(s, 'Test Pup', 'battlefield', 'p1');
    expect(back).not.toBe(pup); // CR 400.7: a new object
    expect(s.objects[back]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === back)).toBe(true);
  });
  it('with no target chosen nothing is exiled', () => {
    let s = scenario([], { defs: [RIFT, PUP], p1: { battlefield: ['Test Riftrunner', 'Test Pup'] } });
    const pup = find(s, 'Test Pup', 'battlefield', 'p1');
    s = resolveAll(attackWith(s, [find(s, 'Test Riftrunner', 'battlefield')], [[]]), [[]]);
    expect(find(s, 'Test Pup', 'battlefield', 'p1')).toBe(pup);
    expect(s.objects[pup]!.tapped).toBe(false);
  });
});

describe('CR 606.4, 107.3a, 601.2b: "−X: Tap target creature. Put X stun counters on it." (a loyalty cost of minus X, announced as it is activated)', () => {
  const WALKER = card('Test Frostcaller', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.\n−X: Tap target creature. Put X stun counters on it.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const start = (loyalty: number): GameState => {
    const s = scenario([], { defs: [WALKER, OGRE], p2: { battlefield: ['Test Ogre'] } });
    const w = put(s, 'p1', 'battlefield', 'Test Frostcaller');
    s.objects[w]!.counters['loyalty'] = loyalty;
    return s;
  };
  const minusX = (s: GameState) => legal(s, 'p1', 'activate').find((a) => a.action.type === 'activate' && a.action.source === find(s, 'Test Frostcaller', 'battlefield') && a.action.ability === 'p:0:1');
  it('is understood', () => expect(noManual(WALKER)).toBe(true));
  it('X is chosen up to the loyalty; that many loyalty counters are removed and X stun counters are put', () => {
    let s = start(4);
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = act(s, minusX(s)!.action);
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 4 });
    s = answer(s, { kind: 'chooseNumber', n: 3 });
    s = resolveAll(drive(s, [[ogre]]), [[ogre]]);
    expect(s.objects[find(s, 'Test Frostcaller', 'battlefield')]!.counters['loyalty']).toBe(1);
    expect(s.objects[ogre]!.tapped).toBe(true);
    expect(s.objects[ogre]!.counters['stun']).toBe(3);
  });
  it('X = 0 removes no loyalty and puts no stun counter (the creature is still tapped)', () => {
    let s = start(2);
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = answer(act(s, minusX(s)!.action), { kind: 'chooseNumber', n: 0 });
    s = resolveAll(drive(s, [[ogre]]), [[ogre]]);
    expect(s.objects[find(s, 'Test Frostcaller', 'battlefield')]!.counters['loyalty']).toBe(2);
    expect(s.objects[ogre]!.counters['stun'] ?? 0).toBe(0);
    expect(s.objects[ogre]!.tapped).toBe(true);
  });
});
