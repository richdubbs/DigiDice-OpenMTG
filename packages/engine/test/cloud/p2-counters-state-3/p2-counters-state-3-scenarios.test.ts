/**
 * p2-counters-state-3 (lane p2-counters-state): a calculated number of targets, "{T}, Sacrifice ~: Destroy up to X target lands, where X is the number of gloom
 * counters on ~.", played through the engine with a synthetic card compiled by the default compiler (invented wording, design 6.10), and the parser and renderer
 * support (render/program.ts#targetCountWhereX, model/forms.ts#countQuantityForms). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 601.2c, 601.2h   the number of targets is read as they are announced, before the sacrifice cost is paid: two gloom counters allow two lands
 *   CR 601.2c           with one gloom counter, a second target is refused
 */
import { describe, expect, it } from 'vitest';
import { type CardDef, type DecisionAnswer, type GameState, type ObjectId } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { act } from '../../m5/helpers';
import { card } from '../../m5/templates/support';
import { drive, find, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const URN = synthetic('Test Gloom Censer', 'Artifact', '{2}', '{T}, Sacrifice ~: Destroy up to X target lands, where X is the number of gloom counters on ~.');
const DEFS = [URN];

function board(counters: number): { s: GameState; censer: ObjectId; theirs: ObjectId[] } {
  const s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Gloom Censer'] }, p2: { battlefield: lands('Forest', 3) } });
  const censer = find(s, 'Test Gloom Censer', 'battlefield');
  s.objects[censer]!.counters['gloom'] = counters;
  const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
  return { s, censer, theirs };
}
const activate = (s: GameState, id: ObjectId, targets: ObjectId[]): GameState =>
  resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }), [{ kind: 'chooseTargets', targets: targets.map((t) => ({ kind: 'object', id: t })) } as DecisionAnswer]));

describe('the synthetic card is automated', () => {
  it('plays fully', () => expect(full(URN), JSON.stringify(URN.automation)).toBe(true));
});

describe('CR 601.2c, 601.2h: "Destroy up to X target lands, where X is the number of gloom counters on ~."', () => {
  it('CR 601.2c, 601.2h: two gloom counters, read as the targets are announced (before the sacrifice): two lands are destroyed', () => {
    const { s, censer, theirs } = board(2);
    const t = activate(s, censer, theirs.slice(0, 2));
    expect(theirs.filter((id) => t.zones.battlefield.includes(id)).length).toBe(1);
    expect(t.zones.battlefield).not.toContain(censer);
  });
  it('CR 601.2c: with one gloom counter, two targets are refused', () => {
    const { s, censer, theirs } = board(1);
    expect(() => activate(s, censer, theirs.slice(0, 2))).toThrow();
  });
});

describe('p2-counters-state-3 parser and renderer (CR 601.2c, 107.3)', () => {
  const opts = defaultParseOptions();
  const f = (type: string, text: string) => parseCard(card('Example Codex', type, text), opts).faces[0]!;
  it('the calculated count is the target spec\'s max and the sentence is gated with its "where X is" clause', () => {
    const x = f('Sorcery', 'Return up to X target creatures to their owners\' hands, where X is the number of Elves you control.');
    expect(x.gate.every((g) => g.ok), JSON.stringify(x.gate)).toBe(true);
    expect(JSON.stringify(x.abilities)).toContain('"max":{"q":"count","of":{"ref":"each","filter":{"subtypes":["Elf"],"controller":"you"}}}');
  });
  it('a body of two sentences is not given the clause (it closes one sentence only): the second sentence\'s X stays its own', () => {
    const x = f('Sorcery', 'Destroy up to X target lands. Draw a card, where X is the number of Elves you control.');
    expect(x.gate.every((g) => g.ok)).toBe(false);
  });
});
