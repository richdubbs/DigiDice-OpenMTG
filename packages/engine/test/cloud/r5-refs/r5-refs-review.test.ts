/**
 * Merge wave 8, r5-refs line: the independent review's scenario tests (synthetic cards compiled by the default compiler, invented wordings; nothing is mocked).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
type Opts = { targets?: TargetChoice[][]; answers?: DecisionAnswer[] };
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && (opts.targets?.length ?? 0) > 0) s = answer(s, { kind: 'chooseTargets', targets: opts.targets!.shift()! });
    else if ((opts.answers?.length ?? 0) > 0) s = answer(s, opts.answers!.shift()!);
    else break;
  }
  return s;
}
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function passTo(s0: GameState, done: (s: GameState) => boolean): GameState {
  let s = s0;
  for (let guard = 0; guard < 400 && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step})`);
  return s;
}

describe('CR 608.2h, 608.2c, 611.2a: "its controller may exile that many cards ... They may play those cards until the end of their next turn." when the damaged creature died', () => {
  const LEGACY = card('Review Legacy', 'Enchantment', 'Whenever a creature is dealt damage, its controller may exile that many cards from the top of their library. They may play those cards until the end of their next turn.');
  const SHOCK = card('Review Shock', 'Instant', 'This spell deals 2 damage to target creature.');
  const BEAR = card('Review Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
  const CUB = card('Review Cub', 'Creature — Bear', '', ['1', '1']);
  it('the dead creature\'s last controller is asked, exiles their cards, and may play them on their next turn (last known information)', () => {
    let s = scenario([], { p1: { hand: ['Review Shock'], battlefield: ['Review Legacy'] }, p2: { battlefield: ['Review Bear'], library: ['Review Cub', 'Review Cub', 'Review Cub'] }, defs: [LEGACY, SHOCK, BEAR, CUB] });
    const q = { targets: [[obj(find(s, 'Review Bear', 'battlefield', 'p2'))]] };
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Review Shock', 'hand', 'p1') }), q), q);
    expect(s.zones.graveyard.p2!.map((id) => s.objects[id]!.defId)).toContain('Review Bear');
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending?.player).toBe('p2');
    s = drain(settle(answer(s, { kind: 'yesNo', yes: true })));
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.defId === 'Review Cub');
    expect(exiled).toHaveLength(2);
    expect(legal(s, 'p1', 'cast').map((a) => a.object)).not.toContain(exiled[0]);
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(legal(s, 'p2', 'cast').map((a) => a.object)).toEqual(expect.arrayContaining(exiled));
    // until the end of THEIR next turn: gone on the turn after it (CR 611.2a, 500.1)
    s = passTo(s, (x) => x.turn.number === 4 && x.turn.step === 'main1' && x.pending?.kind === 'priority');
    expect(legal(s, 'p2', 'cast').map((a) => a.object)).not.toContain(exiled[0]);
  });
});

describe('CR 603.7b, 508.1b, 603.2c: "Until your next turn, whenever one or more creatures attack one of your opponents, those creatures get +2/+2 ..." (only the creatures that attacked the opponent)', () => {
  const HOWL = card('Review Howl', 'Instant', 'Until your next turn, whenever one or more creatures attack one of your opponents, those creatures get +2/+2 and gain trample until end of turn.');
  const BEAR = card('Review Bear Two', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
  const OX = card('Review Ox', 'Creature — Ox', '', ['1', '4'], '{1}{W}');
  const WALKER = compileCard({ name: 'Review Walker', layout: 'normal', mana_cost: '{3}', type_line: 'Legendary Planeswalker — Test', oracle_text: '+1: You gain 1 life.', colors: [], loyalty: '5' } as OracleCard);
  it('a creature that attacks the opponent planeswalker in the same combat does not attack that opponent and gets nothing', () => {
    let s = scenario([], { p1: { hand: ['Review Howl'], battlefield: ['Review Bear Two', 'Review Ox'] }, p2: { battlefield: [{ name: 'Review Walker', counters: { loyalty: 5 } }] }, defs: [HOWL, BEAR, OX, WALKER] });
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Review Howl', 'hand', 'p1') })));
    const bear = find(s, 'Review Bear Two', 'battlefield', 'p1');
    const ox = find(s, 'Review Ox', 'battlefield', 'p1');
    const walker = find(s, 'Review Walker', 'battlefield', 'p2');
    s = drain(settle(declareAttackers(toDeclareAttackers(s), [[bear, 'p2'], [ox, walker]])));
    expect(Number(getChars(s, bear).power)).toBe(4);
    expect(Number(getChars(s, ox).power)).toBe(1);
  });
});
