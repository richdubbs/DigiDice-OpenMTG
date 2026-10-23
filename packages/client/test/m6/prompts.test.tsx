/**
 * M6-11 (m6 design 5 "M6-11"): the prompts for the milestone 6 decisions, on real engine states (the prompts harness: a GameConnection over `applyAction`).
 *  - the turn-face-up special action (CR 116.2b, 702.37e, 701.40b; m6 design D8): a click on the face-down permanent opens its menu, one button per way
 *    (`via`), X chosen next (CR 702.37f);
 *  - attack and block requirements (M6-7, CR 508.1d, 509.1c): pre-selected when the engine enforces them, with a hint of what is obeyed;
 *  - replacement choices grouped by their CR 616.1 class (`klass`).
 */
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChooseReplacementDecision, DeclareBlockersDecision, GameState, ObjectId } from '@openmtg/engine';
import { initialAttacks, initialBlocks, requirementObeyed } from '../../src/prompts/combat';
import { replacementGroups } from '../../src/prompts/SimplePrompts';
import { cards } from '../../../engine/test/m6/combat/cards';
import { lands, putFaceDown, synthetic } from '../../../engine/test/m6/face-down/support';
import { castAuto, click, declareAttackers, find, findAll, passBoth, pendingKind, renderPrompt, scenario, toDeclareAttackers, toDeclareBlockers, tweak } from '../prompts/harness';

const XMORPH = synthetic('Test Swelling Shade', 'Creature — Shade', '{2}{B}', 'Morph {X}{B}', { power: '1', toughness: '1' });

describe('CR 116.2b, 702.37e: turning a face-down permanent face up (the special action)', () => {
  it('a click on the face-down permanent opens its menu (never does it at once); the button takes the action with its via', async () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 4) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    const { conn } = renderPrompt(s);
    await click(`Board ${id}`);
    expect(conn.sent).toEqual([]); // the menu opened; nothing was sent
    const group = screen.getByRole('group', { name: 'Turn face up' });
    expect(group.textContent).toContain('special action: it doesn\'t use the stack, so nobody can respond (CR 116.2b, 702.37e)');
    await click('Turn Exalted Angel face up (morph {2}{W}{W})');
    expect(conn.sent[0]).toEqual({ type: 'special', player: 'p1', kind: 'turnFaceUp', object: id, via: 'morph' });
    expect(conn.errors).toEqual([]);
  });

  it('CR 701.40c: a manifested card with morph can be turned face up two ways: one button each, the player chooses how', async () => {
    let s = scenario(['Exalted Angel', 'Plains'], { p1: { battlefield: lands('Plains', 6) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel', { by: 'manifest', profile: 'plain' });
    const { conn } = renderPrompt(s);
    await click(`Board ${id}`);
    const group = screen.getByRole('group', { name: 'Turn face up' });
    expect(group.textContent).toContain('it can be turned face up in 2 ways');
    const buttons = within(group).getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Turn Exalted Angel face up (morph {2}{W}{W})', 'Turn Exalted Angel face up (manifest {4}{W}{W})']);
    await click('Turn Exalted Angel face up (manifest {4}{W}{W})');
    expect(conn.sent[0]).toMatchObject({ type: 'special', kind: 'turnFaceUp', object: id, via: 'manifest' });
    expect(conn.errors).toEqual([]);
  });

  it('CR 702.37f: a morph cost with X says so, and X is asked next (the chooseNumber prompt)', async () => {
    let s = scenario(['Swamp'], { p1: { battlefield: lands('Swamp', 4) }, defs: [XMORPH] });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Test Swelling Shade');
    const { conn } = renderPrompt(s);
    await click(`Board ${id}`);
    expect(screen.getByRole('group', { name: 'Turn face up' }).textContent).toContain('You choose X next (CR 702.37f).');
    await click(/Turn Test Swelling Shade face up \(morph \{X\}\{B\}\)/);
    expect(conn.errors).toEqual([]);
    expect(pendingKind(conn)).toBe('chooseNumber');
    expect(screen.getAllByText(/Choose a value for X/).length).toBeGreaterThan(0);
  });
});

/** p1 attacks with every creature of `p1`; p2 has `p2`; the state at p2's declare blockers decision. */
function toBlocks(p1: string[], p2: string[]): GameState {
  let s = scenario(['Grizzly Bears', 'Hill Giant'], { defs: cards("Gaea's Protector", 'Razorgrass Screen', 'Goblin Brigand'), p1: { battlefield: p1 }, p2: { battlefield: p2 } });
  s = toDeclareAttackers(s);
  s = declareAttackers(s, [...new Set(p1)].flatMap((n) => findAll(s, n, 'battlefield', 'p1')).map((id) => [id] as [ObjectId]));
  return toDeclareBlockers(s);
}

describe('M6-7, CR 508.1d, 509.1c: attack and block requirements in the declare prompts', () => {
  it('CR 508.1d: Goblin Brigand is pre-selected to attack and the hint says the requirement is obeyed; clearing it warns', async () => {
    const s = toDeclareAttackers(scenario(['Grizzly Bears'], { defs: cards('Goblin Brigand'), p1: { battlefield: [{ name: 'Goblin Brigand', since: 0 }, 'Grizzly Bears'] } }));
    const brigand = find(s, 'Goblin Brigand', 'battlefield');
    renderPrompt(s);
    expect(screen.getByRole('button', { name: `Board ${brigand}` }).getAttribute('data-mark')).toBe('attacking Bob');
    const hint = screen.getByRole('group', { name: 'Requirements (CR 508.1d)' });
    expect(hint.textContent).toContain('obey 1 of 1');
    expect(hint.textContent).toContain('Goblin Brigand attacks each combat if able.');
    expect(hint.textContent).toContain('obeyed');
    await click('Clear');
    expect(screen.getByRole('group', { name: 'Requirements (CR 508.1d)' }).textContent).toContain('This declaration obeys 0 of the 1 requirements it must obey');
    expect(screen.getByRole('button', { name: `Board ${brigand}` }).getAttribute('data-mark')).toBe('must attack');
  });

  it('CR 509.1c: the engine\'s obeying blocks are pre-selected (Razorgrass Screen blocks Gaea\'s Protector), and the declaration is accepted', async () => {
    const s = toBlocks(["Gaea's Protector", 'Hill Giant'], ['Grizzly Bears', 'Razorgrass Screen']);
    const d = s.pending as DeclareBlockersDecision;
    expect(d.mustObey).toBe(2);
    const prot = find(s, "Gaea's Protector", 'battlefield');
    const screenId = find(s, 'Razorgrass Screen', 'battlefield');
    expect(initialBlocks(d)).toEqual(d.obeying);
    expect(d.requirements!.every((r) => requirementObeyed(r, { blocks: initialBlocks(d) }))).toBe(true);
    const { conn } = renderPrompt(s);
    const hint = screen.getByRole('group', { name: 'Requirements (CR 509.1c)' });
    expect(hint.textContent).toContain('obey 2 of 2');
    expect(hint.textContent).toContain('Obeyed now: 2.');
    await click('Clear');
    // nothing blocks now: each creature says what its requirement asks
    expect(screen.getByRole('button', { name: `Board ${screenId}` }).getAttribute('data-mark')).toBe('must block');
    expect(screen.getByRole('button', { name: /Gaea's Protector/ }).textContent).toContain('must be blocked');
    expect(screen.getByRole('group', { name: 'Requirements (CR 509.1c)' }).textContent).toContain('obeys 0 of the 2 requirements it must obey');
    expect(prot).toBeTruthy();
    expect(conn.errors).toEqual([]);
  });

  it('without enforcement (no mustObey) nothing is pre-selected beyond "must attack" creatures', () => {
    const d = { kind: 'declareAttackers', candidates: [{ id: 'o1', defenders: ['p2'] }], requirements: [], obeying: [{ attacker: 'o1', defender: 'p2' }] } as never;
    const view = { players: [{ id: 'p2' }] } as never;
    expect(initialAttacks(view, d)).toEqual({});
  });
});

describe('CR 616.1a-e: replacement choices grouped by class (klass)', () => {
  it('the groups follow the CR 616.1 order; options without a class come last', () => {
    const options: ChooseReplacementDecision['options'] = [
      { id: 'a', label: 'Any', klass: 4 }, { id: 'b', label: 'Self', klass: 0 }, { id: 'c', label: 'Old engine' }, { id: 'd', label: 'Copy', klass: 2 },
    ];
    expect(replacementGroups(options).map((g) => [g.klass, g.options.map((o) => o.id)])).toEqual([[0, ['b']], [2, ['d']], [4, ['a']], [null, ['c']]]);
  });

  it('two prevention shields (CR 616.1e): one group, headed with its rule; the choice is answered', async () => {
    let s = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain', 'Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const shield = (id: string, amount: number, sourceName: string) => ({
      id, source: null, sourceName, controller: 'p1', timestamp: 900, startedTurn: 1, duration: { d: 'endOfTurn' },
      effect: { s: 'replace', replaces: { ev: 'damage', recipient: { object: { is: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] } } } }, body: { b: 'prevent', amount }, shield: { uses: 1 } },
    });
    s = tweak(s, (t) => {
      t.continuousEffects.push(shield('e90', 1, 'Small') as never, shield('e91', 5, 'Big') as never);
    });
    s = passBoth(castAuto(s, 'Lightning Bolt', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] }));
    const d = s.pending as ChooseReplacementDecision;
    // The engine does not fill the optional `klass` yet (effects/propose.ts#choose, M6-1's file): without it the options are one plain group.
    expect(replacementGroups(d.options).map((g) => g.klass)).toEqual([d.options[0]!.klass ?? null]);
    // With the class the decision type defines (m6 design 2.3), the group is headed with its rule; the same answer is accepted.
    s = { ...s, pending: { ...d, options: d.options.map((o) => ({ ...o, klass: 4 as const })) } };
    const { conn } = renderPrompt(s);
    const group = screen.getByRole('group', { name: 'Replacement and prevention effects (CR 616.1e)' });
    expect(group.textContent).toContain('Any of these may apply first.');
    const big = d.options.find((o) => o.id.endsWith('e91'))!;
    await click(big.label);
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseReplacement', id: big.id });
    expect(conn.errors).toEqual([]);
  });
});
