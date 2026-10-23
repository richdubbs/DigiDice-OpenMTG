/**
 * R1 (M6-7a): block requirements, CR 509.1c ("blocks each combat if able", "must be blocked if able"), maximized exactly with the restrictions of the whole
 * declaration (menace, CR 702.111b), a node budget, and a reminder chip when the budget runs out.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DeclareBlockersDecision, GameState, ObjectId } from '../../../src/index';
import { obeyRequirements, requirementsFor } from '../../../src/index';
import { act, creature, declareAttackers, find, findAll, passUntil, scenario, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { cards } from './cards';

const blocks = (s: GameState, pairs: [ObjectId, ObjectId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks: pairs.map(([blocker, attacker]) => ({ blocker, attacker })) } });
const decision = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;

/** p1 attacks with `attackers` (all of them), p2 is asked to declare blockers. */
function toBlocks(p1: string[], p2: string[], defs: CardDef[] = []): GameState {
  let s = scenario(['Grizzly Bears', 'Hill Giant', 'Elephant-Rat', 'Serra Angel'], { defs: [...cards('Gaea\'s Protector', 'Inescapable Brute', 'Razorgrass Screen', 'Watchdog'), ...defs], p1: { battlefield: p1 }, p2: { battlefield: p2 } });
  s = toDeclareAttackers(s);
  s = declareAttackers(s, [...new Set(p1)].flatMap((n) => findAll(s, n, 'battlefield', 'p1')).map((id) => [id] as [ObjectId]));
  return toDeclareBlockers(s);
}

describe('CR 509.1c: block requirements', () => {
  it('CR 509.1c: Razorgrass Screen ("blocks each combat if able") must block; declaring no blockers is illegal', () => {
    const s = toBlocks(['Grizzly Bears'], ['Razorgrass Screen', 'Hill Giant']);
    const dog = find(s, 'Razorgrass Screen', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const d = decision(s);
    expect(d.requirements).toEqual([expect.objectContaining({ kind: 'block', creature: dog, text: 'Razorgrass Screen blocks each combat if able.' })]);
    expect(d.mustObey).toBe(1);
    expect(d.obeying).toEqual([{ blocker: dog, attacker: bears }]);
    expect(d.unchecked).toBeUndefined();
    expect(d.rules).toContain('CR 509.1c');
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(() => act(s, blocks(s, [[find(s, 'Hill Giant', 'battlefield'), bears]]))).toThrow(/Not obeyed: "Razorgrass Screen blocks each combat if able\." \(Razorgrass Screen\)/);
    expect(act(s, blocks(s, [[dog, bears]])).combat?.blockers).toHaveLength(1);
    expect(requirementsFor(s, 'block', 'p2')).toEqual(d.requirements); // design m6 3.9: the contract lists what the decision carries
  });

  it('CR 509.1c: Watchdog\'s own manual line ("all creatures attacking you get -1/-0") can change which blocks are legal, so its requirement is a hint', () => {
    // conservative (design m6 3.9, D13): a manual P/T change of attackers changes skulk (CR 702.118b) and power-based restrictions
    const s = toBlocks(['Grizzly Bears'], ['Watchdog', 'Hill Giant']);
    const d = decision(s);
    expect(d.requirements).toEqual([expect.objectContaining({ kind: 'block', text: 'Watchdog blocks each combat if able.' })]);
    expect(d.mustObey).toBeUndefined();
    expect(d.unchecked).toEqual([expect.objectContaining({ sourceName: 'Watchdog', text: expect.stringMatching(/all creatures attacking you get -1\/-0/) })]);
    expect(act(s, blocks(s, [])).log.some((l) => l.level === 'manual' && l.rules?.includes('CR 509.1c'))).toBe(true);
  });

  it('CR 509.1c worked example: a creature that blocks if able and one with no abilities facing a menace attacker must both block', () => {
    const s = toBlocks(['Elephant-Rat'], ['Razorgrass Screen', 'Grizzly Bears']);
    const dog = find(s, 'Razorgrass Screen', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const rat = find(s, 'Elephant-Rat', 'battlefield');
    const d = decision(s);
    expect(d.mustObey).toBe(1);
    expect([...d.obeying!].sort((a, b) => a.blocker.localeCompare(b.blocker))).toEqual([{ blocker: dog, attacker: rat }, { blocker: bears, attacker: rat }].sort((a, b) => a.blocker.localeCompare(b.blocker)));
    expect(() => act(s, blocks(s, [[dog, rat]]))).toThrow(/CR 702\.111b/); // only the first: breaks the menace restriction
    expect(() => act(s, blocks(s, [[bears, rat]]))).toThrow(); // only the second: breaks both
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/); // neither: obeys the restriction, not the requirement
    expect(act(s, blocks(s, [[dog, rat], [bears, rat]])).combat?.blockers).toHaveLength(2);
  });

  it('CR 509.1c, 702.111b: a creature that blocks if able whose only block is a menace attacker nobody can join can\'t obey it: it is not counted, another requirement is', () => {
    // The Screen could block only the Rat (the attacking Shade has shadow, CR 702.28b), and the only other defender, a Shade that blocks if able, can block
    // only the Shade: no legal declaration has the Screen block (menace), so its requirement is not one that can be obeyed; the Shade's is.
    const shade = creature('Test Shade', ['1', '1'], 'Shadow');
    const guard = creature('Test Shade Guard', ['1', '1'], 'Shadow\nThis creature blocks each combat if able.');
    const s = toBlocks(['Elephant-Rat', 'Test Shade'], ['Razorgrass Screen', 'Test Shade Guard'], [shade, guard]);
    const screen = find(s, 'Razorgrass Screen', 'battlefield');
    const rat = find(s, 'Elephant-Rat', 'battlefield');
    const g = find(s, 'Test Shade Guard', 'battlefield');
    const attackingShade = find(s, 'Test Shade', 'battlefield');
    const d = decision(s);
    expect(d.candidates.map((c) => c.id)).toEqual([g]); // CR 702.111b: the Screen alone can't block the Rat
    expect(d.requirements).toEqual([expect.objectContaining({ kind: 'block', creature: g })]);
    expect(d.mustObey).toBe(1);
    expect(d.obeying).toEqual([{ blocker: g, attacker: attackingShade }]);
    expect(() => act(s, blocks(s, [[screen, rat]]))).toThrow(/CR 702\.111b|CR 509\.1/);
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[g, attackingShade]])).combat?.blockers).toHaveLength(1); // the Screen does not block, and that is legal
  });

  it('CR 509.1c: "must be blocked if able" (Gaea\'s Protector) is obeyed by any one blocker; no block is illegal', () => {
    const s = toBlocks(["Gaea's Protector", 'Hill Giant'], ['Grizzly Bears', 'Razorgrass Screen']);
    const prot = find(s, "Gaea's Protector", 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const screen = find(s, 'Razorgrass Screen', 'battlefield');
    const d = decision(s);
    expect(d.requirements?.map((r) => [r.kind, r.creature])).toEqual(expect.arrayContaining([['block', screen], ['beBlocked', prot]]));
    expect(d.mustObey).toBe(2);
    expect(() => act(s, blocks(s, []))).toThrow(/obeys 0 of the requirements, but 2/);
    expect(() => act(s, blocks(s, [[screen, giant]]))).toThrow(/must be blocked if able/); // the screen obeys its own, not the Protector's
    expect(act(s, blocks(s, [[screen, prot]])).combat?.blockers).toHaveLength(1); // one blocker obeys both
    expect(act(s, blocks(s, [[bears, prot], [screen, giant]])).combat?.blockers).toHaveLength(2);
  });

  it('CR 509.1c: an attacker that must be blocked but that nobody can block imposes nothing', () => {
    const flyer = creature('Test Skyward Protector', ['2', '2'], 'Flying\nThis creature must be blocked if able.');
    const s = toBlocks(['Test Skyward Protector', 'Hill Giant'], ['Grizzly Bears'], [flyer]);
    expect(decision(s).requirements).toBeUndefined();
    expect(act(s, blocks(s, [])).combat?.blockers).toEqual([]);
  });

  it('CR 509.1c, 702.111b: a menace attacker that must be blocked needs two blockers; with two able creatures both must block it', () => {
    const brute = creature('Test Menacing Brute', ['3', '3'], 'Menace\nThis creature must be blocked if able.');
    const s = toBlocks(['Test Menacing Brute'], ['Grizzly Bears', 'Hill Giant'], [brute]);
    const b = find(s, 'Test Menacing Brute', 'battlefield');
    expect(decision(s).mustObey).toBe(1);
    expect(decision(s).obeying).toHaveLength(2);
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[find(s, 'Grizzly Bears', 'battlefield'), b], [find(s, 'Hill Giant', 'battlefield'), b]])).combat?.blockers).toHaveLength(2);
  });

  it('CR 509.1c: obeyRequirements: a bot that would not block gets the example declaration', () => {
    const s = toBlocks(['Elephant-Rat'], ['Razorgrass Screen', 'Grizzly Bears']);
    const fixed = obeyRequirements(decision(s), []);
    expect(fixed).toHaveLength(2);
    expect(act(s, blocks(s, fixed.map((b) => [b.blocker, b.attacker]))).combat?.blockers).toHaveLength(2);
  });

  it('design m6 3.9: over the search budget the declaration is accepted, with a manual line and a reminder chip (never a wrong rejection)', () => {
    // Six attackers with menace that must be blocked, eleven creatures able to block any of them: at most five can be blocked by two, and proving that
    // six can't takes more than the budget.
    const brute = creature('Test Menacing Brute', ['3', '3'], 'Menace\nThis creature must be blocked if able.');
    const s = toBlocks(Array(6).fill('Test Menacing Brute'), Array(11).fill('Grizzly Bears'), [brute]);
    const d = decision(s);
    expect(d.requirements).toHaveLength(6);
    expect(d.mustObey).toBeUndefined();
    expect(d.obeying).toBeUndefined();
    const t = act(s, blocks(s, []));
    expect(t.log.some((l) => l.level === 'manual' && /too many ways to declare/.test(l.text) && l.rules?.includes('CR 509.1c'))).toBe(true);
    expect(t.reminders).toEqual([expect.objectContaining({ sourceName: 'Test Menacing Brute', until: { d: 'endOfCombat' } })]);
    expect(passUntil(t, (x) => x.turn.step === 'main2', 'the second main phase').reminders).toEqual([]); // CR 500.5a: the chip ends with combat
  });
});
