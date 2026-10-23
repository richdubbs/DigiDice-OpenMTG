/** Combat prompts on real boards: declare attackers (CR 508.1), declare blockers (CR 509.1), combat damage assignment (CR 510.1c-d, 702.19b). */
import { act as reactAct, fireEvent, screen } from '@testing-library/react';
import type { AssignDamageDecision, DeclareBlockersDecision, GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { assignmentProblem, defaultAssignment, defaultDefender, toggleBlock, underBlocked } from '../../src/prompts/combat';
import { click, declareAttackers, declareBlockers, find, findAll, lifeOf, passUntil, pendingKind, press, renderPrompt, scenario, toDeclareAttackers, toDeclareBlockers } from './harness';

async function change(label: string, value: string): Promise<void> {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

/** p1 attacks with `attacker`; p2 has `blockers`; returns the state at p2's declare blockers decision. */
function toBlocks(attacker: string, blockers: string[]): GameState {
  let s = scenario([attacker, ...blockers], { p1: { battlefield: [attacker] }, p2: { battlefield: blockers } });
  s = declareAttackers(toDeclareAttackers(s), [[find(s, attacker, 'battlefield', 'p1')]]);
  return toDeclareBlockers(s);
}

describe('declareAttackers (CR 508.1)', () => {
  it('CR 508.1a: click a creature to attack the opponent; the answer lists exactly that attack', async () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } });
    s = toDeclareAttackers(s);
    const [a] = findAll(s, 'Grizzly Bears', 'battlefield', 'p1');
    const { conn } = renderPrompt(s);
    expect(screen.getByRole('button', { name: 'No attacks' })).toBeTruthy();
    await click(`Board ${a}`);
    expect(screen.getByRole('button', { name: `Board ${a}` }).getAttribute('data-mark')).toBe('attacking Bob');
    await click('Attack with 1');
    expect(conn.lastAnswer()).toEqual({ kind: 'declareAttackers', attacks: [{ attacker: a, defender: 'p2' }] });
    expect(conn.errors).toEqual([]);
    expect(conn.state.combat?.attackers.map((x) => x.id)).toEqual([a]);
  });

  it('CR 508.1b: with a planeswalker to attack, the defender is chosen per attacker', async () => {
    let s = scenario(['Grizzly Bears', 'Jace Beleren'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } });
    s = toDeclareAttackers(s);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const jace = find(s, 'Jace Beleren', 'battlefield');
    const { conn } = renderPrompt(s);
    await click(/^Grizzly Bears/);
    await change('Grizzly Bears attacks', jace);
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'declareAttackers', attacks: [{ attacker: bears, defender: jace }] });
    expect(conn.errors).toEqual([]);
  });

  it('CR 508.8: "No attacks" declares no attackers, and the declare blockers and combat damage steps are skipped', async () => {
    const s = toDeclareAttackers(scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } }));
    const { conn } = renderPrompt(s);
    await click('Attack with all');
    await click('Clear');
    await click('No attacks');
    expect(conn.lastAnswer()).toEqual({ kind: 'declareAttackers', attacks: [] });
    expect(conn.errors).toEqual([]);
    const steps: string[] = [];
    passUntil(conn.state, (t) => {
      steps.push(t.turn.step);
      return t.turn.step === 'main2';
    }, 'the postcombat main phase');
    expect(steps).not.toContain('declareBlockers');
    expect(steps).not.toContain('combatDamage');
    expect(steps.at(-1)).toBe('main2');
  });

  it('CR 508.1b: two attackers with the same name get distinct labels in the defender choice', async () => {
    let s = scenario(['Grizzly Bears', 'Jace Beleren'], { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } });
    s = toDeclareAttackers(s);
    renderPrompt(s);
    await click('Attack with all');
    expect(screen.getByLabelText('Grizzly Bears #1 attacks')).toBeTruthy();
    expect(screen.getByLabelText('Grizzly Bears #2 attacks')).toBeTruthy();
  });
});

describe('declareBlockers (CR 509.1)', () => {
  it('CR 509.1a: click a blocker, then the attacker it blocks', async () => {
    const s = toBlocks('Grizzly Bears', ['Grizzly Bears']);
    const attacker = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const blocker = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const { conn } = renderPrompt(s);
    expect(screen.queryByRole('button', { name: `Board ${attacker}` })).toBeNull(); // attackers are clickable only once a blocker is picked
    await click(`Board ${blocker}`);
    await click(`Board ${attacker}`); // the attacker becomes clickable once a blocker is picked
    expect(screen.getByText(/blocks Grizzly Bears/)).toBeTruthy();
    await click('Confirm blocks');
    expect(conn.lastAnswer()).toEqual({ kind: 'declareBlockers', blocks: [{ blocker, attacker }] });
    expect(conn.errors).toEqual([]);
    expect(conn.state.combat?.blockers.map((b) => b.id)).toEqual([blocker]);
  });

  it('CR 702.111b: a single blocker on a menace attacker is flagged, and the engine rejects it with its explanation', async () => {
    const s = toBlocks('Elephant-Rat', ['Grizzly Bears', 'Grizzly Bears']);
    const d = s.pending as DeclareBlockersDecision;
    const rat = find(s, 'Elephant-Rat', 'battlefield');
    expect(d.needsMultiple).toEqual([rat]);
    const { conn } = renderPrompt(s);
    await click(/^Grizzly Bears #1/);
    await click(/^Elephant-Rat/);
    expect(screen.getByRole('status').textContent).toMatch(/two or more creatures/);
    await click('Confirm blocks');
    expect(conn.errors).toHaveLength(1);
    const alert = screen.getByRole('alert').textContent!;
    expect(alert).toContain("Elephant-Rat has menace: it can't be blocked except by two or more creatures.");
    expect(alert).toContain('CR 702.111b');
    expect(pendingKind(conn)).toBe('declareBlockers');
    await click(/^Remove/);
    await click('No blocks');
    expect(conn.lastAnswer()).toEqual({ kind: 'declareBlockers', blocks: [] });
    expect(conn.errors).toHaveLength(1);
  });

  it('CR 509.1a: two attackers with the same name can be told apart: attackers, marks, the blocks list and its Remove buttons are numbered', async () => {
    let s = scenario(['Grizzly Bears', 'Elephant-Rat'], { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, p2: { battlefield: ['Elephant-Rat'] } });
    s = toDeclareAttackers(s);
    const [a1, a2] = findAll(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = toDeclareBlockers(declareAttackers(s, [[a1!], [a2!]]));
    const rat = find(s, 'Elephant-Rat', 'battlefield', 'p2');
    const { conn } = renderPrompt(s);
    expect(screen.getByRole('heading', { name: 'Your blockers' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Attackers' })).toBeTruthy();
    const attackers = screen.getByRole('group', { name: 'Attackers' });
    const labels = [...attackers.querySelectorAll('button')].map((b) => b.textContent);
    const second = "Grizzly Bears (Alice's, tapped) #2"; // attacking taps them (CR 508.1f)
    expect(labels).toEqual(["Grizzly Bears (Alice's, tapped) #1", second]);
    await click(/^Elephant-Rat/);
    await click(second);
    expect(screen.getByRole('list', { name: 'Blocks' }).textContent).toContain(`Elephant-Rat blocks ${second}`);
    expect(screen.getByRole('button', { name: `Board ${rat}` }).getAttribute('data-mark')).toBe(`blocking ${second}`);
    expect(screen.getByRole('button', { name: `Remove: Elephant-Rat blocks ${second}` })).toBeTruthy();
    await click('Confirm blocks');
    expect(conn.lastAnswer()).toEqual({ kind: 'declareBlockers', blocks: [{ blocker: rat, attacker: a2 }] });
  });
});

describe('assignDamage (CR 510.1c-d)', () => {
  function blockedBy(attacker: string, blockers: string[]): GameState {
    let s = toBlocks(attacker, blockers);
    const a = find(s, attacker, 'battlefield', 'p1');
    s = declareBlockers(s, findAll(s, blockers[0]!, 'battlefield', 'p2').map((b) => [b, a] as [string, string]));
    return passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
  }

  it('CR 702.19b: trample: lethal damage to the blocker first, the rest to the player (the default), Space assigns', async () => {
    const s = blockedBy('Colossal Dreadmaw', ['Grizzly Bears']);
    const d = s.pending as AssignDamageDecision;
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    expect(d.canTrample).toBe(true);
    const { conn } = renderPrompt(s);
    expect(screen.getByText(/lethal: 2/)).toBeTruthy();
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'assignDamage', amounts: [{ id: bears, amount: 2 }, { id: 'p2', amount: 4 }] });
    expect(conn.errors).toEqual([]);
    expect(lifeOf(conn.state, 'p2')).toBe(16);
  });

  it('CR 702.19b: damage to the player before the blocker has lethal damage is not offered', async () => {
    const s = blockedBy('Colossal Dreadmaw', ['Grizzly Bears']);
    const { conn } = renderPrompt(s);
    await change("Damage to Grizzly Bears (Bob's)", '1');
    await change('Damage to Bob', '5');
    expect((screen.getByRole('button', { name: 'Assign damage' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/lethal damage/);
    await click('Lethal first');
    await click('Assign damage');
    expect(conn.errors).toEqual([]);
  });

  it('CR 510.1c: a creature blocked by two creatures divides its damage freely', async () => {
    const s = blockedBy('Craw Wurm', ['Grizzly Bears', 'Grizzly Bears']);
    const [b1, b2] = findAll(s, 'Grizzly Bears', 'battlefield', 'p2');
    const { conn } = renderPrompt(s);
    await change("Damage to Grizzly Bears (Bob's) #1", '3');
    await change("Damage to Grizzly Bears (Bob's) #2", '3');
    await click('Assign damage');
    expect(conn.lastAnswer()).toEqual({ kind: 'assignDamage', amounts: [{ id: b1, amount: 3 }, { id: b2, amount: 3 }] });
    expect(conn.errors).toEqual([]);
  });
});

describe('combat helpers', () => {
  const view = { players: [{ id: 'p1' }, { id: 'p2' }] } as never;
  it('the default defender is a player when one can be attacked', () => {
    expect(defaultDefender(view, ['o9', 'p2'])).toBe('p2');
    expect(defaultDefender(view, ['o9'])).toBe('o9');
  });

  it('a blocker that can block one attacker moves its block (CR 509.1a); one that can block two adds it', () => {
    const d = { candidates: [{ id: 'b', attackers: ['x', 'y'], maxBlocks: 1 }, { id: 'c', attackers: ['x', 'y'], maxBlocks: 2 }], needsMultiple: ['x'] } as unknown as DeclareBlockersDecision;
    expect(toggleBlock([{ blocker: 'b', attacker: 'x' }], d, 'b', 'y')).toEqual([{ blocker: 'b', attacker: 'y' }]);
    expect(toggleBlock([{ blocker: 'c', attacker: 'x' }], d, 'c', 'y')).toEqual([{ blocker: 'c', attacker: 'x' }, { blocker: 'c', attacker: 'y' }]);
    expect(toggleBlock([{ blocker: 'c', attacker: 'x' }], d, 'c', 'x')).toEqual([]);
    expect(underBlocked(d, [{ blocker: 'b', attacker: 'x' }])).toEqual(['x']);
    expect(underBlocked(d, [{ blocker: 'b', attacker: 'x' }, { blocker: 'c', attacker: 'x' }])).toEqual([]);
  });

  it('FAST5 T57, CR 509.1b: an attacker that cannot be blocked except by three or more creatures is under-blocked with one or two blockers, not with none or three', () => {
    const d = { candidates: [], needsMultiple: ['x'], minBlockers: [{ attacker: 'x', min: 3 }] } as unknown as DeclareBlockersDecision;
    const on = (n: number) => Array.from({ length: n }, (_, i) => ({ blocker: `b${i}`, attacker: 'x' }));
    expect(underBlocked(d, on(0))).toEqual([]);
    expect(underBlocked(d, on(1))).toEqual(['x']);
    expect(underBlocked(d, on(2))).toEqual(['x']);
    expect(underBlocked(d, on(3))).toEqual([]);
  });

  it('default assignment and its checks (CR 510.1, 702.19b, deathtouch lethal 1)', () => {
    const d = { amount: 5, canTrample: true, recipients: [{ id: 'a', lethal: 1 }, { id: 'b', lethal: 3 }, { id: 'p2', lethal: 0, trampleTarget: true }] } as unknown as AssignDamageDecision;
    expect(defaultAssignment(d)).toEqual({ a: 1, b: 3, p2: 1 });
    expect(assignmentProblem(d, { a: 1, b: 3, p2: 1 })).toBeNull();
    expect(assignmentProblem(d, { a: 1, b: 2, p2: 1 })).toMatch(/1 damage left/);
    expect(assignmentProblem(d, { a: 0, b: 4, p2: 1 })).toMatch(/CR 702.19b/);
    const noTrample = { ...d, canTrample: false, recipients: d.recipients.slice(0, 2) } as AssignDamageDecision;
    expect(defaultAssignment(noTrample)).toEqual({ a: 2, b: 3 });
  });
});
