/**
 * std-finish-1 (the last Standard cards, owner approval 2026-10-21): the one engine-visible change, played through the engine with synthetic cards (invented
 * names; the wording is eff.stdrx32.delay.loseControl.ifAttached's own synthetic example, design 6.10). CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 603.7b    a delayed triggered ability with a stated duration ("this turn") triggers each time its event happens during that duration, not only the first
 *                time: "When you lose control of that Equipment this turn, ..." no longer carries `once` (it did until this round)
 *   CR 603.4     its intervening "if it's attached to a creature you control" is checked each time: attached to an opponent's creature, nothing happens
 *   CR 613.1b    control-changing effects apply in timestamp order, so each later "gain control ... until end of turn" takes the Equipment again
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
type Opts = { targets?: TargetChoice[][] };

function settle(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending as { kind: string };
    if (d.kind === 'chooseTargets' && (o.targets?.length ?? 0) > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets!.shift()! });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false } as DecisionAnswer);
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return s;
}
/** `player` casts the card from their hand (they are given priority first). */
function cast(s0: GameState, name: string, target: ObjectId, player: 'p1' | 'p2'): GameState {
  const s = tweak(s0, (x) => { x.pending = { kind: 'priority', player, prompt: '' } as never; });
  return settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), { targets: [[obj(target)]] });
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    if (s.pending?.kind === 'priority') { s = passBoth(s); continue; }
    const before = s;
    s = settle(s);
    if (s === before) break;
  }
  return s;
}
const attach = (s: GameState, what: ObjectId, to: ObjectId): GameState => tweak(s, (x) => { x.objects[what]!.attachedTo = to; });

describe('CR 603.7b, 603.4: "When you lose control of that Equipment this turn, if it\'s attached to a creature you control, unattach it." triggers every time', () => {
  const GRAB = card('Test Mantle Grab', 'Instant', "Gain control of target Equipment until end of turn. When you lose control of that Equipment this turn, if it's attached to a creature you control, unattach it.");
  const SNATCH = card('Test Snatch', 'Instant', 'Gain control of target artifact until end of turn.');
  const CLEAVER = card('Test Iron Cleaver', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {0}');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const DEFS = [GRAB, SNATCH, CLEAVER, BEAR];
  const BASICS = ['Mountain', 'Island', 'Swamp', 'Forest', 'Plains'];
  const setup = () => {
    const s = scenario(BASICS, { p1: { hand: ['Test Mantle Grab', 'Test Snatch'], battlefield: ['Test Grove Bear'] }, p2: { hand: ['Test Snatch', 'Test Snatch'], battlefield: ['Test Iron Cleaver', 'Test Grove Bear'] }, defs: DEFS });
    return { s, cleaver: find(s, 'Test Iron Cleaver', 'battlefield', 'p2'), mine: find(s, 'Test Grove Bear', 'battlefield', 'p1'), theirs: find(s, 'Test Grove Bear', 'battlefield', 'p2') };
  };

  it('is parsed and automated as a delayed trigger with a duration and no `once`', () => {
    expect(manualParts(GRAB)).toEqual([]);
    const j = JSON.stringify(GRAB.faces[0]!.abilities);
    expect(j).toContain('"op":"delay"');
    expect(j).toContain('"duration":{"d":"endOfTurn"}');
    expect(j).not.toContain('"once"');
  });

  it('losing control twice in the same turn unattaches the Equipment both times (before this round only the first time)', () => {
    let { s, cleaver, mine } = setup();
    s = resolveAll(cast(s, 'Test Mantle Grab', cleaver, 'p1'));
    expect(s.objects[cleaver]!.controller).toBe('p1');
    s = attach(s, cleaver, mine);
    s = resolveAll(cast(s, 'Test Snatch', cleaver, 'p2')); // the first loss of control
    expect(s.objects[cleaver]!.controller).toBe('p2');
    expect(s.objects[cleaver]!.attachedTo).toBeUndefined();
    s = resolveAll(cast(s, 'Test Snatch', cleaver, 'p1')); // p1 takes it back with another effect and attaches it again
    expect(s.objects[cleaver]!.controller).toBe('p1');
    s = attach(s, cleaver, mine);
    s = resolveAll(cast(s, 'Test Snatch', cleaver, 'p2')); // the second loss of control, same turn
    expect(s.objects[cleaver]!.controller).toBe('p2');
    expect(s.objects[cleaver]!.attachedTo).toBeUndefined();
  });

  it('attached to a creature an opponent controls when control is lost: the intervening if is false and it stays attached', () => {
    let { s, cleaver, theirs } = setup();
    s = resolveAll(cast(s, 'Test Mantle Grab', cleaver, 'p1'));
    s = attach(s, cleaver, theirs);
    s = resolveAll(cast(s, 'Test Snatch', cleaver, 'p2'));
    expect(s.objects[cleaver]!.controller).toBe('p2');
    expect(s.objects[cleaver]!.attachedTo).toBe(theirs);
  });
});
