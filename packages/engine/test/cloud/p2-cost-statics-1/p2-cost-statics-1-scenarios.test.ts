/**
 * p2-cost-statics-1 (lane p2-cost-statics): cost reductions by counts of the turn's history, conditional alternative costs (the traps) and a cost increase for two
 * kinds of spells, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). CR cites
 * from memory, unverified.
 *
 *   CR 601.2f, 118.7, 700.4  "This spell costs {1} less to cast for each creature that died this turn": every creature put into a graveyard from the battlefield
 *   CR 601.2f, 601.2i        "... for each spell your opponents have cast this turn": the caster's own spells do not count
 *   CR 601.2f, 508.1, 506.4  "... for each creature you attacked with this turn": each attacker once
 *   CR 118.9, 506.4          "If three or more creatures are attacking, you may pay {U} rather than pay this spell's mana cost": the alternative cost is offered
 *                            only while that many creatures attack; "If exactly one creature is attacking" likewise
 *   CR 118.9, 601.2i         "If an opponent cast two or more spells this turn, you may pay {0} ...": one opponent's spells, not the caster's
 *   CR 118.9, 601.2b, 117.3  an alternative cost's condition reads the turn's history: "If an opponent cast a blue spell this turn", "If you attacked this turn"
 *   CR 601.2f, 604.1         "Red creature spells and green creature spells cost {1} more to cast": whoever casts them; other spells are not affected
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

interface Script { yes?: boolean[]; numbers?: number[]; targets?: TargetChoice[][] }
/** Answer every decision but priority from the script (defaults: no, the minimum, no targets, the first `min` options, no blockers). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], numbers: [...(script.numbers ?? [])], targets: [...(script.targets ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.numbers.shift() ?? p.min });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const pass = (s: GameState): GameState => drive(act(s, { type: 'pass', player: s.pending!.player }));
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** Whether `player` may begin casting `name` from their hand for its alternative cost (the method 'alternative', CR 118.9, 601.2b) now. */
const altOk = (s: GameState, name: string, player = 'p1'): boolean => applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player), method: 'alternative' }).error === undefined;
const canCast = (s: GameState, name: string, player = 'p1'): boolean => { const id = find(s, name, 'hand', player); return legal(s, player, 'cast').some((a) => a.object === id); };
const castBy = (s: GameState, name: string, player: string, script?: Script, method?: string): GameState =>
  drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), ...(method ? { method } : {}) }), script);
/** p2 casts `name` while p1 holds priority in p1's main phase (p1 passes first), and it resolves; p1 has priority again. */
function opponentCasts(s0: GameState, name: string): GameState {
  return resolveAll(castBy(pass(s0), name, 'p2'));
}
/** p1 attacks with `attackers`, nobody blocks; the game stops when p1 has priority in the declare attackers step. */
const attackWith = (s: GameState, attackers: ObjectId[]): GameState => drive(declareAttackers(toDeclareAttackers(s), attackers.map((a) => [a])));
function toMain2(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) s = drive(passBoth(s));
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const CULL = card('Test Cull', 'Instant', 'Destroy target creature.');
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
const WAKE = card('Test Wake Rite', 'Sorcery', 'This spell costs {1} less to cast for each creature that died this turn.\nYou gain 3 life.', '{3}');
const FIND = card('Test Bright Find', 'Sorcery', 'This spell costs {1} less to cast for each spell your opponents have cast this turn.\nYou gain 3 life.', '{3}');
const CAPTAIN = card('Test Scout Captain', 'Creature — Human Scout', 'This spell costs {1} less to cast for each creature you attacked with this turn.', '{3}', ['2', '2']);
const SNARE = card('Test Snare', 'Instant', "If three or more creatures are attacking, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life.", '{4}{U}');
const PIT = card('Test Lone Pit', 'Instant', "If exactly one creature is attacking, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life.", '{4}{W}');
const MIND = card('Test Mind Snare', 'Instant', "If an opponent cast two or more spells this turn, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life.", '{4}{U}{U}');
const SQUALL = card('Test Squall', 'Enchantment', 'Red creature spells and green creature spells cost {1} more to cast.', '{0}');
const IMP = card('Test Red Imp', 'Creature — Imp', '', '{1}', ['1', '1'], ['R']);
const DRAKE = card('Test Blue Drake', 'Creature — Drake', '', '{1}', ['1', '1'], ['U']);
const BLUE_SPARK = card('Test Blue Spark', 'Instant', 'You gain 1 life.', '{0}', undefined, ['U']);
const RICOCHET = card('Test Rebound Trap', 'Instant', "If an opponent cast a blue spell this turn, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life.", '{3}{R}');
const RAID = card('Test Raid Order', 'Instant', "If you attacked this turn, you may pay {0} rather than pay this spell's mana cost.\nYou gain 3 life.", '{2}{U}{U}');
const DEFS = [BEAR, CULL, SPARK, WAKE, FIND, CAPTAIN, SNARE, PIT, MIND, SQUALL, IMP, DRAKE, BLUE_SPARK, RICOCHET, RAID];

describe('p2-cost-statics-1: the synthetic cards are automated', () => {
  it('every card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

describe('CR 601.2f, 118.7, 700.4: "costs {1} less to cast for each creature that died this turn"', () => {
  const board = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Wake Rite', 'Test Cull', 'Test Cull'], battlefield: ['Plains', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('CR 700.4: two creatures died (one of each player): {3} costs {1}, castable with one land', () => {
    let s = board();
    expect(canCast(s, 'Test Wake Rite')).toBe(false);
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
    s = resolveAll(castBy(s, 'Test Cull', 'p1', { targets: [[obj(bears[0]!)]] }));
    expect(canCast(s, 'Test Wake Rite')).toBe(false);
    s = resolveAll(castBy(s, 'Test Cull', 'p1', { targets: [[obj(bears[1]!)]] }));
    expect(canCast(s, 'Test Wake Rite')).toBe(true);
    s = resolveAll(castBy(s, 'Test Wake Rite', 'p1'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(23);
  });
});

describe('CR 601.2f, 601.2i: "costs {1} less to cast for each spell your opponents have cast this turn"', () => {
  const board = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Bright Find', 'Test Spark', 'Test Spark'], battlefield: ['Plains'] }, p2: { hand: ['Test Spark', 'Test Spark'] } });
  it('CR 601.2i: two spells of the opponent take {2} off; the caster\'s own two spells take nothing off', () => {
    let s = board();
    s = resolveAll(castBy(s, 'Test Spark', 'p1'));
    s = resolveAll(castBy(s, 'Test Spark', 'p1'));
    expect(canCast(s, 'Test Bright Find')).toBe(false);
    s = opponentCasts(s, 'Test Spark');
    expect(canCast(s, 'Test Bright Find')).toBe(false);
    s = opponentCasts(s, 'Test Spark');
    expect(canCast(s, 'Test Bright Find')).toBe(true);
  });
});

describe('CR 601.2f, 508.1, 506.4: "costs {1} less to cast for each creature you attacked with this turn"', () => {
  it('CR 508.1: two attackers take {2} off {3} in the second main phase; before combat the full cost is due', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Scout Captain'], battlefield: ['Plains', { name: 'Test Bear', since: 0 }, { name: 'Test Bear', since: 0 }] } });
    expect(canCast(s, 'Test Scout Captain')).toBe(false);
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
    s = toMain2(attackWith(s, bears));
    expect(canCast(s, 'Test Scout Captain')).toBe(true);
  });
  it('CR 508.1: one attacker takes {1} off: {2} is still too much for one land', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Scout Captain'], battlefield: ['Plains', { name: 'Test Bear', since: 0 }, { name: 'Test Bear', since: 0 }] } });
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
    s = toMain2(attackWith(s, [bears[0]!]));
    expect(canCast(s, 'Test Scout Captain')).toBe(false);
  });
});

describe('CR 118.9, 506.4: the traps\' alternative costs by the number of attacking creatures', () => {
  const board = (n: number): GameState => scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Snare', 'Test Lone Pit'], battlefield: Array.from({ length: n }, () => ({ name: 'Test Bear', since: 0 })) } });
  const bearsOf = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
  it('CR 118.9: with three attackers "three or more creatures are attacking" offers {0}; the spell is cast for it and resolves', () => {
    let s = board(3);
    expect(canCast(s, 'Test Snare')).toBe(false);
    s = attackWith(s, bearsOf(s));
    expect(altOk(s, 'Test Snare')).toBe(true);
    expect(canCast(s, 'Test Lone Pit')).toBe(false);
    s = resolveAll(castBy(s, 'Test Snare', 'p1', {}, 'alternative'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(23);
  });
  it('CR 506.4: with two attackers neither trap is castable without mana', () => {
    let s = board(2);
    s = attackWith(s, bearsOf(s));
    expect(canCast(s, 'Test Snare')).toBe(false);
    expect(canCast(s, 'Test Lone Pit')).toBe(false);
    expect(altOk(s, 'Test Snare')).toBe(false);
    expect(altOk(s, 'Test Lone Pit')).toBe(false);
  });
  it('CR 506.4: with exactly one attacker "exactly one creature is attacking" offers {0}', () => {
    let s = board(2);
    s = attackWith(s, [bearsOf(s)[0]!]);
    expect(altOk(s, 'Test Lone Pit')).toBe(true);
    expect(canCast(s, 'Test Snare')).toBe(false);
  });
});

describe('CR 118.9, 601.2i: "If an opponent cast two or more spells this turn, you may pay {0} ..."', () => {
  const board = (): GameState => scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Mind Snare', 'Test Spark', 'Test Spark'] }, p2: { hand: ['Test Spark', 'Test Spark'] } });
  it('CR 601.2i: two spells of one opponent offer {0}; one does not; the caster\'s own spells never count', () => {
    let s = board();
    s = resolveAll(castBy(s, 'Test Spark', 'p1'));
    s = resolveAll(castBy(s, 'Test Spark', 'p1'));
    expect(canCast(s, 'Test Mind Snare')).toBe(false);
    expect(altOk(s, 'Test Mind Snare')).toBe(false);
    s = opponentCasts(s, 'Test Spark');
    expect(canCast(s, 'Test Mind Snare')).toBe(false);
    expect(altOk(s, 'Test Mind Snare')).toBe(false);
    s = opponentCasts(s, 'Test Spark');
    expect(altOk(s, 'Test Mind Snare')).toBe(true);
    s = resolveAll(castBy(s, 'Test Mind Snare', 'p1', {}, 'alternative'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(25);
  });
});

describe('CR 601.2f, 604.1: "Red creature spells and green creature spells cost {1} more to cast"', () => {
  it('CR 601.2f: a red creature spell costs {1} more for its controller and for the opponent; a blue one costs its mana cost', () => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Red Imp', 'Test Blue Drake'], battlefield: ['Test Squall', 'Plains'] }, p2: { hand: ['Test Red Imp'], battlefield: ['Plains', 'Plains'] } });
    expect(canCast(s, 'Test Red Imp')).toBe(false);
    expect(canCast(s, 'Test Blue Drake')).toBe(true);
    const t = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Red Imp'], battlefield: ['Test Squall', 'Plains', 'Plains'] } });
    expect(canCast(t, 'Test Red Imp')).toBe(true);
  });
});

describe('CR 118.9, 601.2b, 117.3: an alternative cost\'s condition reads this turn\'s history', () => {
  it('CR 601.2i: "If an opponent cast a blue spell this turn": offered after the opponent casts a blue spell, not after a colorless one or the caster\'s own blue spell', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Rebound Trap', 'Test Blue Spark'] }, p2: { hand: ['Test Spark', 'Test Blue Spark'] } });
    s = resolveAll(castBy(s, 'Test Blue Spark', 'p1'));
    expect(altOk(s, 'Test Rebound Trap')).toBe(false);
    s = opponentCasts(s, 'Test Spark');
    expect(altOk(s, 'Test Rebound Trap')).toBe(false);
    s = opponentCasts(s, 'Test Blue Spark');
    expect(altOk(s, 'Test Rebound Trap')).toBe(true);
    s = resolveAll(castBy(s, 'Test Rebound Trap', 'p1', {}, 'alternative'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(24);
  });
  it('CR 508.1: "If you attacked this turn": offered in the second main phase after an attack, not before it', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Raid Order'], battlefield: [{ name: 'Test Bear', since: 0 }] } });
    expect(altOk(s, 'Test Raid Order')).toBe(false);
    s = toMain2(attackWith(s, [find(s, 'Test Bear', 'battlefield')]));
    expect(altOk(s, 'Test Raid Order')).toBe(true);
  });
});
