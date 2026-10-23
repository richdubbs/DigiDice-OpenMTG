/**
 * Wave 7 merge (r4-fxb + r4-fxz): one mechanism for a cast trigger that reads its spell's X. The X announced for the spell is carried by the cast event and put
 * on the triggered ability's own stack object (triggers/stack.ts#castX), so the ability keeps it once the spell has left the stack, as last known information
 * (CR 107.3, 608.2h): the spell countered before the trigger resolves changes nothing. Synthetic cards compiled by the default compiler; nothing is mocked.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

type Opts = { targets?: TargetChoice[][]; answers?: DecisionAnswer[]; x?: number };
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseNumber' && opts.x !== undefined) s = answer(s, { kind: 'chooseNumber', n: opts.x });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** p1 casts `name` and keeps priority (nothing resolves). */
function castHold(s: GameState, name: string, opts: Opts = {}): GameState {
  const q: Opts = { ...opts, targets: [...(opts.targets ?? [])], answers: [...(opts.answers ?? [])] };
  return settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), ...(opts.x !== undefined ? { x: opts.x } : {}) } as never), q);
}
/** Both players pass once: the top object of the stack resolves. */
const resolveTop = (s: GameState, opts: Opts = {}): GameState => settle(pass(pass(s)), opts);

const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');

describe('CR 107.3, 608.2h (wave 7 merge, cast X carried by the event): the trigger keeps the X of its spell once that spell is countered', () => {
  it('"Whenever you cast a spell with {X} in its mana cost, you gain X life.": X = 3, the spell countered first, you still gain 3', () => {
    const WATCHER = card('Test Watcher', 'Enchantment', 'Whenever you cast a spell with {X} in its mana cost, you gain X life.');
    const BLAST = card('Test Blast', 'Sorcery', 'You gain X life.', undefined, '{X}');
    expect(automated(WATCHER)).toBe(true);
    let s = scenario(['Mountain'], { p1: { hand: ['Test Blast', 'Test Negate'], battlefield: ['Test Watcher', 'Mountain', 'Mountain', 'Mountain'] }, defs: [WATCHER, BLAST, NEGATE] });
    const before = life(s, 'p1');
    s = castHold(s, 'Test Blast', { x: 3 });
    expect(s.zones.stack).toHaveLength(2); // the spell, its trigger on top
    const blast = s.zones.stack[0]!;
    s = castHold(s, 'Test Negate', { targets: [[obj(blast)]] });
    s = resolveTop(s); // Negate: the spell is countered
    expect(s.zones.stack).toHaveLength(1);
    expect(s.zones.stack.includes(blast)).toBe(false);
    s = resolveTop(s); // the trigger
    expect(s.zones.stack).toHaveLength(0);
    expect(life(s, 'p1')).toBe(before + 3);
  });
  it('"When you cast this spell, copy it X times.": X = 2, the spell countered first, the trigger still makes two copies of it (last known information)', () => {
    const BARRAGE = card('Test Barrage', 'Sorcery', 'When you cast this spell, copy it X times. You may choose new targets for the copies.\nThis spell deals 1 damage to target creature.', undefined, '{X}{R}', ['R']);
    expect(automated(BARRAGE)).toBe(true);
    let s = scenario(['Mountain'], { p1: { hand: ['Test Barrage', 'Test Negate'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Bear'] }, defs: [BARRAGE, NEGATE, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = castHold(s, 'Test Barrage', { x: 2, targets: [[obj(bear)]] });
    expect(s.zones.stack).toHaveLength(2);
    const spell = s.zones.stack[0]!;
    const trigger = s.zones.stack[1]!;
    expect(s.objects[trigger]!.stack?.x).toBe(2); // the event's X, on the ability itself
    s = castHold(s, 'Test Negate', { targets: [[obj(spell)]] });
    s = resolveTop(s); // Negate
    expect(s.zones.stack).toEqual([trigger]);
    s = resolveTop(s, { answers: [{ kind: 'yesNo', yes: false }, { kind: 'yesNo', yes: false }] }); // the trigger: two copies (CR 707.10)
    const copies = s.zones.stack.filter((id) => s.objects[id]!.kind === 'spellCopy');
    expect(copies).toHaveLength(2);
  });
});
