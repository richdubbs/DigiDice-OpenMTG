/**
 * Lane std-cardcopy, round std-cardcopy-3, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.12a, 107.3m   "As ~ enters, exile up to X creature cards from your graveyard": chosen as it enters, X as cast; counters for each card exiled
 *   CR 607.2a            the cards exiled as it enters are "exiled with it": the target of its activated ability is one of them, never another exiled card
 *   CR 707.9a-b, 613.4c  "becomes a copy of ..., except it's 0/0 and has this ability": the copy's base P/T is 0/0, its counters stay, it keeps the ability
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { activatedAbilities } from '../../../src/rules/abilities';
import { activationDenial } from '../../../src/actions/activate';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const byHandLog = (s: GameState): boolean => s.log.some((l) => /by hand/.test(l.text));

/** Answer every decision: X from `x`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { x?: number; pick?: (options: ObjectId[], max: number, s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, p.max, s) : p.options.slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GIANT = card('Test Giant', 'Creature — Giant', 'Trample', { pt: ['4', '6'] });
const TRINKET = card('Test Trinket', 'Artifact', '');
const OOZE = card('Test Ooze', 'Creature — Ooze', 'As this creature enters, exile up to X creature cards from your graveyard. It enters with two +1/+1 counters on it for each creature card exiled this way.\n{1}: This creature becomes a copy of target creature card exiled with it, except it\'s 0/0 and has this ability.', { pt: ['0', '0'], cost: '{X}' });
const defs = [BEAR, GIANT, TRINKET, OOZE];

describe('CR 614.12a, 607.2a, 707.9a-b: "As ~ enters, exile up to X creature cards ... becomes a copy of target creature card exiled with it, except it\'s 0/0 and has this ability."', () => {
  it('has no manual part', () => expect(noManual(OOZE)).toBe(true));
  const enter = (x: number, pick?: (options: ObjectId[], max: number, s: GameState) => ObjectId[]): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Ooze'], graveyard: ['Test Bear', 'Test Giant', 'Test Trinket'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { graveyard: ['Test Bear'] } });
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ooze', 'hand', 'p1') }), { x, ...(pick ? { pick } : {}) });
  };
  const ooze = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ooze')!;
  it('X = 2: only your creature cards are offered (not the Trinket, not the opponent\'s Bear); two exiled, four +1/+1 counters', () => {
    let offered: string[] = [];
    const s = enter(2, (options, max, at) => { offered = options.map((id) => nameOf(at, id)); return options.slice(0, max); });
    expect(offered.sort()).toEqual(['Test Bear', 'Test Giant']);
    const o = ooze(s);
    expect(s.objects[o]!.counters['+1/+1']).toBe(4);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Giant']);
    expect(byHandLog(s)).toBe(false);
  });
  it('the negative case: X = 0 exiles nothing and it enters with no counters (a 0/0, put into the graveyard)', () => {
    const s = enter(0);
    expect(s.zones.exile.length).toBe(0);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ooze')).toBe(false);
  });
  it('{1}: it becomes a 0/0 copy of the exiled Giant with its counters (4/4), and has the ability, linked to nothing now (CR 607.5)', () => {
    let s = enter(2);
    const o = ooze(s);
    const giant = s.zones.exile.find((id) => nameOf(s, id) === 'Test Giant')!;
    const la = legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && a.object === o && !a.isMana);
    s = resolveAll(act(s, la!.action), { targets: [[giant]] });
    expect(nameOf(s, o)).toBe('Test Giant');
    expect([getChars(s, o).power, getChars(s, o).toughness]).toEqual(['4', '4']);
    // it has the ability, but as an ability the copy effect gave it: linked to no other ability of the object (CR 607.5), so no card is "exiled with it" for it
    const gained = activatedAbilities(s, s.objects[o]!);
    expect(gained.length).toBe(1);
    expect(JSON.stringify(activationDenial(s, 'p1', s.objects[o]!, gained[0]!))).toContain('no legal one');
  });
  it('CR 607.2a: a creature card that was not exiled with it is not a legal target; the one exiled with it is', () => {
    let s = enter(1, (options, _max, at) => [options.find((id) => nameOf(at, id) === 'Test Bear')!]);
    const o = ooze(s);
    const bear = s.zones.exile.find((id) => nameOf(s, id) === 'Test Bear')!; // the card exiled with it
    const giantInGy = find(s, 'Test Giant', 'graveyard', 'p1'); // a creature card not exiled with it
    const la = legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && a.object === o && !a.isMana);
    expect(() => resolveAll(act(s, la!.action), { targets: [[giantInGy]] })).toThrow();
    s = resolveAll(act(s, la!.action), { targets: [[bear]] });
    expect(nameOf(s, o)).toBe('Test Bear');
  });
});
