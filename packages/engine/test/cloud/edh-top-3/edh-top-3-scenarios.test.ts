/**
 * Commander lane edh-top, round edh-top-3: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (media.wizards.com text read in the session unless a test says otherwise).
 *
 *   CR 202.3, 115.1, 601.2c   "any number of target creature cards that each have a different mana value X or less" (TargetSpec.differentManaValues)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const nameOf = (s: GameState, id: ObjectId): string => s.objects[id]!.defId;
const pickT = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });

/** Cast `name` with X = `x`, paying automatically, until the targets are asked (or the spell is on the stack). */
function castX(s: GameState, name: string, x: number): GameState {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), x } as never);
  for (let g = 0; g < 20 && t.pending && t.pending.kind !== 'chooseTargets' && t.pending.kind !== 'priority'; g++) {
    t = t.pending.kind === 'payCost' ? answer(t, { kind: 'payCost', auto: true }) : t.pending.kind === 'chooseNumber' ? answer(t, { kind: 'chooseNumber', n: x }) : t;
  }
  return t;
}
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
const resolveTop = (s: GameState): GameState => settle(pass(pass(settle(s))));
const offeredNames = (s: GameState): string[] => ((s.pending as unknown as { objects?: ObjectId[] }).objects ?? []).map((id) => nameOf(s, id)).sort();

const AWAKEN = card('Test Awakening', 'Sorcery', 'Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less. You gain 2 life.', { cost: '{X}', colors: ['B'] });
const GENERIC = card('Test Recall', 'Sorcery', 'Return any number of target creature cards that each have a different mana value X or less from your graveyard to your hand.', { cost: '{X}', colors: ['B'] });
const ONE = card('Test Mote', 'Creature — Spirit', '', { pt: ['1', '1'], cost: '{1}' });
const ONEB = card('Test Mote Twin', 'Creature — Spirit', '', { pt: ['1', '2'], cost: '{1}' });
const TWO = card('Test Fawn', 'Creature — Elk', '', { pt: ['2', '2'], cost: '{1}{G}' });
const THREE = card('Test Stag', 'Creature — Elk', '', { pt: ['3', '3'], cost: '{2}{G}' });
const FOUR = card('Test Bull', 'Creature — Elk', '', { pt: ['4', '4'], cost: '{3}{G}' });
const WISP = card('Test Wisp', 'Creature — Spirit', '', { pt: ['0', '1'], cost: '{0}' });
const XBEAST = card('Test Xbeast', 'Creature — Beast', '', { pt: ['0', '1'], cost: '{X}' });
const GEM = card('Test Gem', 'Artifact', '', { cost: '{2}' });
const EXILER = card('Test Exiler', 'Instant', 'Exile target creature card from a graveyard.', { cost: '{0}', colors: ['B'] });
const ALL = [AWAKEN, GENERIC, ONE, ONEB, TWO, THREE, FOUR, GEM];
const board = (): GameState => scenario([], {
  defs: ALL,
  p1: { hand: ['Test Awakening'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Mote', 'Test Mote Twin', 'Test Fawn', 'Test Stag', 'Test Bull', 'Test Gem'] },
  p2: { graveyard: ['Test Stag'] },
});

describe('CR 202.3, 115.1, 601.2c: "Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less."', () => {
  it('is automated, with the target spec carrying differentManaValues', () => {
    expect(noManual(AWAKEN)).toEqual([]);
    expect(noManual(GENERIC)).toEqual([]);
    const spec = (AWAKEN.faces[0]!.abilities[0] as unknown as { effect: { targets: { differentManaValues?: boolean; min: number; max: unknown }[] } }).effect.targets[0]!;
    expect(spec).toMatchObject({ differentManaValues: true, min: 0, max: 'any' });
  });
  it('X = 3: only creature cards of your graveyard with mana value 3 or less are offered (not the Bull, the Gem or the opponent\'s Stag)', () => {
    const s = castX(board(), 'Test Awakening', 3);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(offeredNames(s)).toEqual(['Test Fawn', 'Test Mote', 'Test Mote Twin', 'Test Stag']);
  });
  it('three creature cards with the mana values 1, 2 and 3 are chosen and all return; the other mana value 1 card stays; you gain 2 life', () => {
    let s = castX(board(), 'Test Awakening', 3);
    const pick = [find(s, 'Test Mote', 'graveyard', 'p1'), find(s, 'Test Fawn', 'graveyard', 'p1'), find(s, 'Test Stag', 'graveyard', 'p1')];
    s = resolveTop(answer(s, pickT(...pick)));
    const bf = s.zones.battlefield.map((id) => nameOf(s, id)).filter((n) => n.startsWith('Test') && n !== 'Test Awakening');
    expect(bf.sort()).toEqual(['Test Fawn', 'Test Mote', 'Test Stag']);
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id)).sort()).toEqual(['Test Awakening', 'Test Bull', 'Test Gem', 'Test Mote Twin']);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
  it('CR 202.3, 601.2c: two creature cards with the same mana value (1 and 1) are rejected and the targets asked again', () => {
    const s = castX(board(), 'Test Awakening', 3);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: pickT(find(s, 'Test Mote', 'graveyard', 'p1'), find(s, 'Test Mote Twin', 'graveyard', 'p1')) });
    expect(err.rules).toContain('CR 202.3');
  });
  it('any number includes none: no targets at all is a legal cast and only the life is gained', () => {
    const s = resolveTop(answer(castX(board(), 'Test Awakening', 3), pickT()));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Mote')).toBe(false);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
  it('ruling 2020-09-25: with X = 0 a creature card with mana value 0 is a legal target (and a card with {X} in its cost has mana value 0 in the graveyard)', () => {
    const s0 = scenario([], { defs: [...ALL, WISP, XBEAST], p1: { hand: ['Test Awakening'], graveyard: ['Test Wisp', 'Test Xbeast', 'Test Mote'] } });
    const s = castX(s0, 'Test Awakening', 0);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(offeredNames(s)).toEqual(['Test Wisp', 'Test Xbeast']); // the Mote has mana value 1
    // both have mana value 0: they can't be chosen together (CR 202.3)
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: pickT(find(s, 'Test Wisp', 'graveyard', 'p1'), find(s, 'Test Xbeast', 'graveyard', 'p1')) });
    const t = resolveTop(answer(s, pickT(find(s, 'Test Xbeast', 'graveyard', 'p1'))));
    expect(t.zones.battlefield.some((id) => nameOf(t, id) === 'Test Xbeast')).toBe(true);
  });
  it('ruling 2020-09-25: X = 3 allows up to four cards, mana values 3, 2, 1 and 0', () => {
    const s0 = scenario([], { defs: [...ALL, WISP], p1: { hand: ['Test Awakening'], battlefield: ['Plains', 'Plains', 'Plains'], graveyard: ['Test Wisp', 'Test Mote', 'Test Fawn', 'Test Stag'] } });
    let s = castX(s0, 'Test Awakening', 3);
    s = resolveTop(answer(s, pickT(...['Test Wisp', 'Test Mote', 'Test Fawn', 'Test Stag'].map((n) => find(s, n, 'graveyard', 'p1')))));
    expect(['Test Wisp', 'Test Mote', 'Test Fawn', 'Test Stag'].every((n) => s.zones.battlefield.some((id) => nameOf(s, id) === n))).toBe(true);
  });
  it('a target that left the graveyard before resolution does not return; the legal ones do (CR 608.2b)', () => {
    const s0 = scenario([], {
      defs: [...ALL, EXILER],
      p1: { hand: ['Test Awakening', 'Test Exiler'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], graveyard: ['Test Mote', 'Test Fawn'] },
    });
    let s = castX(s0, 'Test Awakening', 3);
    s = settle(answer(s, pickT(find(s, 'Test Mote', 'graveyard', 'p1'), find(s, 'Test Fawn', 'graveyard', 'p1'))));
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Exiler', 'hand', 'p1') }));
    s = settle(answer(s, pickT(find(s, 'Test Fawn', 'graveyard', 'p1'))));
    for (let g = 0; g < 8 && s.zones.stack.length > 0; g++) s = settle(pass(pass(s)));
    const bf = s.zones.battlefield.map((id) => nameOf(s, id));
    expect(bf).toContain('Test Mote');
    expect(bf).not.toContain('Test Fawn');
  });
});

describe('CR 202.3, 115.1: "Return any number of target creature cards that each have a different mana value X or less from your graveyard to your hand." (the general reading of the target words)', () => {
  it('two cards of one mana value are rejected, one of each of 1 and 2 go to the hand', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Recall'], battlefield: ['Plains', 'Plains', 'Plains'], graveyard: ['Test Mote', 'Test Mote Twin', 'Test Fawn'] } });
    let s = castX(s0, 'Test Recall', 2);
    expect(s.pending?.kind).toBe('chooseTargets');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: pickT(find(s, 'Test Mote', 'graveyard', 'p1'), find(s, 'Test Mote Twin', 'graveyard', 'p1')) });
    s = resolveTop(answer(s, pickT(find(s, 'Test Mote Twin', 'graveyard', 'p1'), find(s, 'Test Fawn', 'graveyard', 'p1'))));
    expect(s.zones.hand.p1!.map((id) => nameOf(s, id)).sort()).toEqual(['Test Fawn', 'Test Mote Twin']);
  });
});

const SMASH = card('Test Smash', 'Sorcery', 'Test Smash deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X is 6 or more, Test Smash deals twice X damage divided as you choose among them instead.', { cost: '{X}', colors: ['R'] });
const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '30'], cost: '{1}' });
const WALLB = card('Test Wall Twin', 'Creature — Wall', '', { pt: ['0', '30'], cost: '{1}' });

describe('CR 601.2d, 107.3, 614.15: "~ deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X is 6 or more, ~ deals twice X damage divided as you choose among them instead."', () => {
  const board = (): GameState => scenario([], {
    defs: [SMASH, WALL, WALLB],
    p1: { hand: ['Test Smash'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] },
    p2: { battlefield: ['Test Wall', 'Test Wall Twin'] },
  });
  /** Cast with X, target both walls, divide `amounts` (when asked), resolve: the damage marked on the first and second wall. */
  function play(x: number, amounts: number[]): { total: number; asked: number | undefined; damage: number[] } {
    let s = castX(board(), 'Test Smash', x);
    expect(s.pending?.kind).toBe('chooseTargets');
    const walls = [find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')];
    s = answer(s, pickT(...walls));
    let asked: number | undefined;
    if (s.pending?.kind === 'chooseDivision') {
      asked = (s.pending as unknown as { total: number }).total;
      s = answer(s, { kind: 'chooseDivision', amounts } as DecisionAnswer);
    }
    s = resolveTop(s);
    return { total: amounts.reduce((a, b) => a + b, 0), asked, damage: walls.map((id) => s.objects[id]!.damage) };
  }
  it('is automated', () => expect(noManual(SMASH)).toEqual([]));
  it('X = 5 (below 6): the division asked is of 5 and 5 damage is dealt', () => {
    expect(play(5, [2, 3])).toEqual({ total: 5, asked: 5, damage: [2, 3] });
  });
  it('X = 6: the division asked is of twice X = 12', () => {
    expect(play(6, [5, 7])).toEqual({ total: 12, asked: 12, damage: [5, 7] });
  });
  it('X = 8: twice X = 16, not three times (the number is met once, not per multiple of 6)', () => {
    expect(play(8, [8, 8])).toEqual({ total: 16, asked: 16, damage: [8, 8] });
  });
  it('negative: X = 5 with 12 divided is not accepted (the total announced is 5)', () => {
    let s = castX(board(), 'Test Smash', 5);
    s = answer(s, pickT(find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')));
    expect(s.pending?.kind).toBe('chooseDivision');
    expect(() => answer(s, { kind: 'chooseDivision', amounts: [6, 6] } as DecisionAnswer)).toThrow();
  });
  it('one target gets the whole total without a question: X = 7 on one wall deals 14', () => {
    let s = castX(board(), 'Test Smash', 7);
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    s = resolveTop(answer(s, pickT(wall)));
    expect(s.objects[wall]!.damage).toBe(14);
  });
});

const COVER = card('Test Cover', 'Creature — Wall', 'Defender\nSacrifice this creature: It deals 2 damage to target creature it\'s blocking.', { pt: ['0', '3'], cost: '{1}' });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '4'], cost: '{1}{G}', colors: ['G'] });

describe('CR 509.1g-h, 506.4, 608.2b: "Sacrifice this creature: It deals 2 damage to target creature it\'s blocking."', () => {
  const toBlock = (): { s: GameState; cover: ObjectId; bear: ObjectId; bear2: ObjectId } => {
    let s = scenario([], { defs: [COVER, BEAR], p1: { battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Cover'] } });
    const [bear, bear2] = findAll(s, 'Test Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const cover = find(s, 'Test Cover', 'battlefield', 'p2');
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) { if (guard > 20) throw new Error('no declare attackers'); s = pass(s); }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }, { attacker: bear2, defender: 'p2' }] });
    for (let guard = 0; s.pending?.kind !== 'declareBlockers'; guard++) { if (guard > 20) throw new Error('no declare blockers'); s = pass(s); }
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: cover, attacker: bear }] });
    return { s, cover, bear, bear2 };
  };
  const toPriority = (s0: GameState, who: 'p1' | 'p2'): GameState => {
    let s = s0;
    for (let guard = 0; guard < 10 && !(s.pending?.kind === 'priority' && s.pending.player === who); guard++) s = pass(s);
    return s;
  };
  it('is automated', () => expect(noManual(COVER)).toEqual([]));
  it('the only legal target is the attacker it blocks (not the other attacker); the damage is dealt although the Cover was sacrificed to pay', () => {
    const { s: s0, cover, bear, bear2 } = toBlock();
    let s = toPriority(s0, 'p2');
    const a = legal(s, 'p2', 'activate').find((x) => x.object === cover);
    expect(a).toBeDefined();
    s = act(s, a!.action);
    expect(s.pending?.kind).toBe('chooseTargets');
    const objs = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(objs).toContain(bear);
    expect(objs).not.toContain(bear2);
    s = settle(answer(s, pickT(bear)));
    for (let g = 0; g < 8 && s.zones.stack.length > 0; g++) s = settle(pass(pass(s)));
    expect(s.objects[bear]?.damage ?? 0).toBe(2);
    expect(s.zones.battlefield.includes(cover)).toBe(false);
  });
  it('negative: a Cover that blocks nothing has no target, so the ability can\'t be activated', () => {
    let s = scenario([], { defs: [COVER, BEAR], p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Cover'] } });
    for (let guard = 0; s.pending?.kind !== 'declareAttackers'; guard++) { if (guard > 20) throw new Error('no declare attackers'); s = pass(s); }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Bear', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let guard = 0; s.pending?.kind !== 'declareBlockers'; guard++) { if (guard > 20) throw new Error('no declare blockers'); s = pass(s); }
    s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = toPriority(s, 'p2');
    expect(legal(s, 'p2', 'activate').some((x) => x.object === find(s, 'Test Cover', 'battlefield', 'p2'))).toBe(false);
  });
});
