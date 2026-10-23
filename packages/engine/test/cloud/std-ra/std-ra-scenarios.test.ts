/**
 * Standard round slot A (std-ra): the round's readings and engine rule played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 122.1, 613.4c, 301.5   hone counters (statics/hone.ts): each hone counter on an Equipment gives the creature it is attached to +1/+0; nothing when
 *                             the Equipment is unattached or the counters are on something that is not an Equipment; the bonus moves with the Equipment
 *   CR 115.1, 122.1           "put a <kind> counter on ~ for each creature target opponent controls": that opponent's creatures, not yours
 *   CR 613.4c, 122.1          "<group> get +N/+N for each <kind> counter on ~" (sta.stdra.pump.group.foreach.counters.self)
 *   CR 603.12, 608.2c         "When you discard one or more nonland cards this way, tap up to that many target creatures": the count of the matching
 *                             discarded cards, nothing when only lands were discarded
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { legalActions } from '../../../src/index';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(getChars(s, id).power), Number(getChars(s, id).toughness)];

/** Answer the decisions in order (mana is paid automatically, targets from `targets`); stops at priority or at a decision with no answer left. */
function drive(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order' && queue[0]?.kind !== 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (s.pending.kind === 'chooseTargets' && tq.length > 0) s = answer(s, { kind: 'chooseTargets', targets: tq.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty, answering decisions on the way. */
function resolveAll(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 60; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else {
      const before = s;
      s = drive(s, queue.splice(0, 1), tq.length > 0 && s.pending?.kind === 'chooseTargets' ? [tq.shift()!] : []);
      if (s === before) break;
    }
  }
  return s;
}
/** Cast `name` with `targets`, then resolve everything, answering `answers` and the targets of triggers (`later`) on the way. */
function castAt(s: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], later: TargetChoice[][] = []): GameState {
  return resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }), [], targets), answers, later);
}
/** Activate the (first) activated ability of `source` (an equip ability here), choosing `targets`, and resolve it. */
function activateAt(s: GameState, source: ObjectId, targets: TargetChoice[][]): GameState {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === source)!;
  return resolveAll(drive(act(s, a.action), [], targets));
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const LYNX = card('Test Lynx', 'Creature — Cat', '', { pt: ['1', '1'] });
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equip {0}');
const IDOL = card('Test Idol', 'Artifact', '');
const HONE2 = card('Test Whetting', 'Sorcery', 'Put two hone counters on target artifact.');

describe('CR 122.1, 613.4c, 301.5: hone counters (statics/hone.ts)', () => {
  const defs = [BEAR, LYNX, BLADE, IDOL, HONE2];
  it('the synthetic sorcery that puts hone counters is fully automated (counter:hone is a capability of the engine)', () => {
    expect(full(HONE2)).toBe(true);
  });
  it('two hone counters on an Equipment attached to a 2/2 make it 4/2; the Equipment itself has no power to change', () => {
    const s0 = scenario([], { p1: { hand: ['Test Whetting'], battlefield: ['Test Blade', 'Test Bear'] }, defs });
    const blade = find(s0, 'Test Blade', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = activateAt(s0, blade, [[obj(bear)]]);
    expect(s.objects[blade]!.attachedTo).toBe(bear);
    expect(pt(s, bear)).toEqual([2, 2]);
    s = castAt(s, 'Test Whetting', [[obj(blade)]]);
    expect(s.objects[blade]!.counters['hone']).toBe(2);
    expect(pt(s, bear)).toEqual([4, 2]);
  });
  it('an unattached Equipment with hone counters pumps nothing; equipping it later gives the bonus, and moving it moves the bonus', () => {
    const s0 = scenario([], { p1: { hand: ['Test Whetting'], battlefield: ['Test Blade', 'Test Bear', 'Test Lynx'] }, defs });
    const blade = find(s0, 'Test Blade', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const lynx = find(s0, 'Test Lynx', 'battlefield', 'p1');
    let s = castAt(s0, 'Test Whetting', [[obj(blade)]]);
    expect(pt(s, bear)).toEqual([2, 2]);
    expect(pt(s, lynx)).toEqual([1, 1]);
    s = activateAt(s, blade, [[obj(bear)]]);
    expect(pt(s, bear)).toEqual([4, 2]);
    s = activateAt(s, blade, [[obj(lynx)]]);
    expect(pt(s, bear)).toEqual([2, 2]);
    expect(pt(s, lynx)).toEqual([3, 1]);
  });
  it('hone counters on an artifact that is not an Equipment do nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Whetting'], battlefield: ['Test Idol', 'Test Bear'] }, defs });
    const idol = find(s0, 'Test Idol', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Whetting', [[obj(idol)]]);
    expect(s.objects[idol]!.counters['hone']).toBe(2);
    expect(pt(s, bear)).toEqual([2, 2]);
  });
});

describe('CR 115.1, 122.1, 608.2c: "put a hone counter on ~ for each creature target opponent controls" (render/steps-life.ts, perForms)', () => {
  const KEEN = card('Test Keen Edge', 'Artifact — Equipment', 'When this Equipment enters, put a hone counter on it for each creature target opponent controls.\nEquip {0}');
  const defs = [BEAR, LYNX, KEEN];
  it('is fully automated', () => expect(full(KEEN), JSON.stringify(KEEN.automation)).toBe(true));
  it("counts the target opponent's creatures, not its controller's: two opposing creatures, three of its own, two hone counters", () => {
    const s0 = scenario([], { p1: { hand: ['Test Keen Edge'], battlefield: ['Test Bear', 'Test Bear', 'Test Lynx'] }, p2: { battlefield: ['Test Bear', 'Test Lynx'] }, defs });
    const s = castAt(s0, 'Test Keen Edge', [], [], [[player('p2')]]);
    const keen = find(s, 'Test Keen Edge', 'battlefield', 'p1');
    expect(s.objects[keen]!.counters['hone']).toBe(2);
  });
});

describe('CR 613.4c, 122.1: "<group> get +N/+N for each <kind> counter on ~" (sta.stdra.pump.group.foreach.counters.self)', () => {
  const STANDARD = card('Test Verse Standard', 'Artifact', 'Bears you control get +1/+1 for each verse counter on this artifact.');
  const VERSE = card('Test Verse', 'Sorcery', 'Put two verse counters on target artifact.');
  const defs = [BEAR, LYNX, STANDARD, VERSE];
  it('is fully automated', () => expect(full(STANDARD), JSON.stringify(STANDARD.automation)).toBe(true));
  it('no counter: no bonus; two verse counters: your Bears get +2/+2, your Cat and the opponent\'s Bear do not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Verse'], battlefield: ['Test Verse Standard', 'Test Bear', 'Test Lynx'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const std = find(s0, 'Test Verse Standard', 'battlefield', 'p1');
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const lynx = find(s0, 'Test Lynx', 'battlefield', 'p1');
    expect(pt(s0, mine)).toEqual([2, 2]);
    const s = castAt(s0, 'Test Verse', [[obj(std)]]);
    expect(pt(s, mine)).toEqual([4, 4]);
    expect(pt(s, lynx)).toEqual([1, 1]);
    expect(pt(s, theirs)).toEqual([2, 2]);
  });
});

describe('CR 603.12, 608.2c, 608.2h: "When you discard one or more creature cards this way, tap up to that many target creatures"', () => {
  const GRIND = card('Test Grind', 'Sorcery', 'Discard two cards. When you discard one or more creature cards this way, tap up to that many target creatures.');
  const defs = [BEAR, LYNX, GRIND];
  /** Cast Test Grind discarding the hand cards named `discard`, then report the trigger's target spec (or null: no trigger) and resolve with `targets`. */
  function grind(hand: string[], discard: string[]): { max: number | null; s: GameState } {
    let s = scenario([], { p1: { hand: ['Test Grind', ...hand] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grind', 'hand') });
    let max: number | null = null;
    for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const p = s.pending;
      if (p?.kind === 'priority') { s = pass(s); continue; }
      if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'chooseObjects') {
        const ids: ObjectId[] = [];
        for (const n of discard) { const id = p.options.find((o) => s.objects[o]!.defId === n && !ids.includes(o)); if (id) ids.push(id); }
        s = answer(s, { kind: 'chooseObjects', ids });
      } else if (p?.kind === 'chooseTargets') {
        max = p.max;
        const bears = p.objects.filter((id) => s.objects[id]!.controller === 'p2');
        s = answer(s, { kind: 'chooseTargets', targets: bears.slice(0, max).map(obj) });
      } else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
      else break;
    }
    return { max, s };
  }
  const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.tapped).length;
  it('is fully automated', () => expect(full(GRIND), JSON.stringify(GRIND.automation)).toBe(true));
  it('two creature cards discarded: up to two targets, both tapped', () => {
    const { s, max } = grind(['Test Bear', 'Test Lynx'], ['Test Bear', 'Test Lynx']);
    expect(max).toBe(2);
    expect(tapped(s)).toBe(2);
  });
  it('a creature card and a land discarded: "that many" counts the creature card only, one creature tapped', () => {
    const { s, max } = grind(['Test Bear', 'Plains'], ['Test Bear', 'Plains']);
    expect(max).toBe(1);
    expect(tapped(s)).toBe(1);
  });
  it('only lands discarded: no trigger, nothing tapped', () => {
    const { s, max } = grind(['Plains', 'Plains'], ['Plains', 'Plains']);
    expect(max).toBeNull();
    expect(tapped(s)).toBe(0);
  });
});
