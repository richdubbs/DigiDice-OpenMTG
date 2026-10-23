/**
 * M6-6 (m6 design 3.7 "Case", 5 "M6-6"): Cases (CR 719.3). "To solve -- [condition]" is a triggered ability at the beginning of its controller's end step with
 * an intervening "if" (CR 719.3a, 603.4); "solved" is a designation that is not copiable (CR 719.3b); "Solved -- [ability]" functions only while the Case is
 * solved (CR 719.3c). The segmentation and lowering of the two lines (parser/segment.ts, lower/ability.ts) and the expansion (statics/levels.ts).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, ptNumbers, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { advanceTo, find, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m5/helpers';
import { cast, drive, resolveTop, target } from '../../m5/cr-examples/helpers';

function card(name: string, layout: string, typeLine: string, manaCost: string, lines: string[]): CardDef {
  return compileCard({ name, layout, type_line: typeLine, mana_cost: manaCost, oracle_text: lines.join('\n'), colors: [] } as OracleCard);
}

const BEARS_CASE = card('Test Case of the Bears', 'case', 'Enchantment — Case', '{1}{G}', [
  'To solve — You control three or more creatures. (If unsolved, solve at the beginning of your end step.)',
  'Solved — Creatures you control get +1/+1.',
]);
const COPIER = card('Test Duplicate', 'normal', 'Sorcery', '{1}', ["Create a token that's a copy of target enchantment you control."]);
const bearPT = (s: GameState): [number | null, number | null] => {
  const n = ptNumbers(getChars(s, find(s, 'Grizzly Bears', 'battlefield')));
  return [n.power, n.toughness];
};

/** Pass to p1's end step of turn 1 and put its triggers on the stack. */
const toEndStep = (s: GameState): GameState => drive(advanceTo(s, 1, 'end'));

describe('the lowering of a Case (CR 719.3): one ability with the condition and the solved ability', () => {
  it('a CaseDef: "To solve" read as a condition, "Solved" as the ability it stands for; the card is full', () => {
    const def = BEARS_CASE.faces[0]!.abilities;
    expect(def.map((a) => a.kind)).toEqual(['case']);
    expect(def[0]).toMatchObject({ kind: 'case', solve: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, atLeast: 3 } });
    expect(BEARS_CASE.automation?.level).toBe('full');
  });

  it('Case of the Locked Hothouse (fixture): the Case is lowered and, since FAST5X E14, its solved ability too, so the card is full (not capped by its layout)', () => {
    const s = scenario(['Case of the Locked Hothouse']);
    const def = s.defs['Case of the Locked Hothouse']!;
    expect(def.faces[0]!.abilities.map((a) => a.kind)).toEqual(['static', 'case']);
    expect(def.automation?.level).toBe('full');
  });
});

describe('CR 719.3a: at the beginning of your end step, if [condition] and this Case is not solved, it becomes solved', () => {
  it('the condition does not hold: it does not trigger (CR 603.4) and stays unsolved', () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Case of the Bears', 'Grizzly Bears', 'Grizzly Bears'] }, defs: [BEARS_CASE] });
    const id = find(s, 'Test Case of the Bears', 'battlefield');
    s = toEndStep(s);
    expect(s.zones.stack).toHaveLength(0);
    expect(s.objects[id]!.solved).toBeUndefined();
    expect(bearPT(s)).toEqual([2, 2]);
  });

  it('the condition holds at the end step: it triggers, resolves, and the Case is solved; the solved ability applies from then on (CR 719.3c)', () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Case of the Bears', 'Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }, defs: [BEARS_CASE] });
    const id = find(s, 'Test Case of the Bears', 'battlefield');
    expect(getChars(s, id).abilities.filter((a) => a.key.startsWith('x:')).map((a) => [a.key, a.def.kind])).toEqual([['x:0:0:solve', 'triggered'], ['x:0:0:0', 'static']]);
    expect(bearPT(s)).toEqual([2, 2]); // not solved yet
    s = toEndStep(s);
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(s.objects[id]!.solved).toBe(true);
    expect(bearPT(s)).toEqual([3, 3]);
    expect(s.log.some((l) => /becomes solved/.test(l.text) && l.rules?.includes('CR 719.3b'))).toBe(true);
    // the next end step: already solved, so it does not trigger again (the intervening "if")
    s = toEndStepOf(s, 3);
    expect(s.zones.stack).toHaveLength(0);
  });

  it('CR 603.4: the condition is checked again on resolution: a creature lost in response, and the Case is not solved', () => {
    let s = scenario(['Grizzly Bears', 'Lightning Bolt', 'Mountain'], { p1: { battlefield: ['Test Case of the Bears', 'Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }, p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, defs: [BEARS_CASE] });
    const id = find(s, 'Test Case of the Bears', 'battlefield');
    s = toEndStep(s);
    expect(s.zones.stack).toHaveLength(1);
    s = pass(s); // p1 passes; p2 bolts a bear in response
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    s = cast(s, 'Lightning Bolt', [target(find(s, 'Grizzly Bears', 'battlefield'))], 'p2');
    s = resolveTop(s); // the Bolt
    s = resolveTop(s); // the "To solve" trigger: two creatures now
    expect(s.objects[id]!.solved).toBeUndefined();
  });
});

describe('CR 719.3b: solved is a designation, not a copiable value', () => {
  it('a token copy of a solved Case is not solved: its solved ability does not apply', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Test Duplicate'], battlefield: ['Test Case of the Bears', 'Grizzly Bears', 'Forest'] }, defs: [BEARS_CASE, COPIER] });
    const id = find(s, 'Test Case of the Bears', 'battlefield');
    s = tweak(s, (t) => { t.objects[id]!.solved = true; });
    expect(bearPT(s)).toEqual([3, 3]);
    s = resolveTop(cast(s, 'Test Duplicate', [target(id)]));
    const copy = s.zones.battlefield.find((x) => x !== id && s.objects[x]!.kind === 'token')!;
    expect(getChars(s, copy).name).toBe('Test Case of the Bears');
    expect(s.objects[copy]!.solved).toBeUndefined();
    expect(bearPT(s)).toEqual([3, 3]); // only the original's solved ability
  });
});

/** Pass to p1's end step of `turn` and put its triggers on the stack. */
const toEndStepOf = (s: GameState, turn: number): GameState => drive(advanceTo(s, turn, 'end'));
