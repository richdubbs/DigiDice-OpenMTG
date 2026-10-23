/** Paying costs (CR 601.2g-h): auto pay by default, manual sources, Phyrexian mana paid with life (CR 107.4f, 119.4), rejections, cancel (CR 733.1). */
import { screen } from '@testing-library/react';
import type { GameState } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { costSymbols, manualAnswer, neededColors, phyrexianIndices, togglePicked } from '../../src/prompts/payCost';
import { act, answer, click, clickRole, find, findAll, lifeOf, pendingKind, press, renderPrompt, scenario } from './harness';

/** Grizzly Bears being cast with two Forests and a Mountain: the payCost decision is pending. */
function bears(): GameState {
  const s = scenario(['Grizzly Bears', 'Forest', 'Mountain'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Mountain'] } });
  return act(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'hand') });
}

const tapped = (s: GameState, ids: string[]) => ids.filter((id) => s.objects[id]!.tapped);

describe('payCost (CR 601.2g-h)', () => {
  it('Auto pay is the default (Space) and the spell is cast', async () => {
    const s = bears();
    expect(s.pending).toMatchObject({ kind: 'payCost', autoPayable: true });
    const { conn } = renderPrompt(s);
    expect(screen.getByRole('button', { name: 'Auto pay' }).className).toContain('button-primary');
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'payCost', auto: true });
    expect(conn.errors).toEqual([]);
    expect(conn.state.zones.stack).toHaveLength(1);
  });

  it('a cost with only one way to pay (two Forests for {1}{G}) is paid at once, without the prompt', async () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'hand') });
    expect(s.pending).toMatchObject({ kind: 'payCost', onlyWay: true });
    const { conn } = renderPrompt(s);
    await screen.findByText(/Waiting|priority|Pass/i).catch(() => undefined);
    expect(conn.answers()).toEqual([{ kind: 'payCost', auto: true }]);
    expect(conn.errors).toEqual([]);
    expect(conn.state.zones.stack).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Auto pay' })).toBeNull();
  });

  it('CR 601.2g: paying by hand activates exactly the clicked sources', async () => {
    const s = bears();
    const forests = findAll(s, 'Forest', 'battlefield');
    const mountain = find(s, 'Mountain', 'battlefield');
    const { conn } = renderPrompt(s);
    await click('Pay by hand');
    await click(`Board ${forests[0]}`); // a click on the board picks that land
    await click(/^Mountain/);
    await click('Pay with chosen sources');
    expect(conn.lastAnswer()).toEqual({
      kind: 'payCost', auto: false,
      activations: [{ objectId: forests[0], abilityKey: 'r:basic:G' }, { objectId: mountain, abilityKey: 'r:basic:R' }],
    });
    expect(conn.errors).toEqual([]);
    expect(tapped(conn.state, [...forests, mountain])).toEqual([forests[0], mountain]);
  });

  it("CR 601.2h, 733: a payment that doesn't cover the cost is rejected; the engine's explanation and rule are shown and the decision stays", async () => {
    const { conn } = renderPrompt(bears());
    await click('Pay by hand');
    await click(/^Mountain/);
    await click('Pay with chosen sources');
    expect(conn.errors).toHaveLength(1);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(conn.errors[0]!.message);
    expect(alert.textContent).toContain('CR 601.2h');
    expect(pendingKind(conn)).toBe('payCost');
  });

  it('CR 733.1: Cancel reverses the whole cast', async () => {
    const { conn } = renderPrompt(bears());
    await click('Cancel');
    expect(conn.sent.at(-1)).toEqual({ type: 'cancel', player: 'p1' });
    expect(pendingKind(conn)).toBe('priority');
    expect(conn.state.zones.hand.p1).toHaveLength(1);
  });

  it('CR 107.4f, 119.4: Dismember with one Swamp: the Swamp pays {1} and both Phyrexian symbols are paid with 4 life', async () => {
    let s = scenario(['Dismember', 'Grizzly Bears', 'Swamp'], { p1: { hand: ['Dismember'], battlefield: ['Swamp'] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Dismember', 'hand') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'battlefield') }] });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{1}{B/P}{B/P}' });
    const { conn } = renderPrompt(s);
    await click('Pay by hand');
    await click(/^Swamp/);
    await clickRole('checkbox', /symbol 2/);
    await clickRole('checkbox', /symbol 3/);
    await click('Pay with chosen sources');
    expect(conn.lastAnswer()).toEqual({ kind: 'payCost', auto: false, activations: [{ objectId: find(s, 'Swamp', 'battlefield'), abilityKey: 'r:basic:B' }], lifeForPhyrexian: [1, 2] });
    expect(conn.errors).toEqual([]);
    expect(lifeOf(conn.state, 'p1')).toBe(16);
    expect(conn.state.zones.stack).toHaveLength(1);
  });

  it('CR 107.4f, 119.4: with Phyrexian symbols, the prompt warns that Auto pay may spend life, and Space does not auto pay', async () => {
    let s = scenario(['Dismember', 'Grizzly Bears', 'Swamp'], { p1: { hand: ['Dismember'], battlefield: ['Swamp'] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Dismember', 'hand') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'battlefield') }] });
    expect(s.pending).toMatchObject({ kind: 'payCost', autoPayable: true });
    const { conn } = renderPrompt(s);
    expect(screen.getByRole('status').textContent).toMatch(/Auto pay may pay Phyrexian symbols with 2 life each/);
    await press(' ');
    expect(conn.sent).toEqual([]);
    expect(lifeOf(conn.state, 'p1')).toBe(20);
  });

  it('CR 106.1, 601.2g: a source that makes any color starts with a color the cost still needs; the chosen mana is tallied against the cost', async () => {
    const s0 = scenario(['Grizzly Bears', 'Swamp', 'Forest', 'Birds of Paradise'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Swamp', 'Forest', 'Birds of Paradise'] } });
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Grizzly Bears', 'hand') });
    const { conn } = renderPrompt(s);
    await click('Pay by hand');
    await click(/^Swamp/);
    await click(/^Birds of Paradise/);
    expect((screen.getByLabelText(/^Color from Birds of Paradise/) as HTMLSelectElement).value).toBe('G');
    expect(screen.getByText(/^Chosen:/).textContent).toBe('Chosen: {B}{G} for {1}{G}.');
    await click('Pay with chosen sources');
    expect(conn.errors).toEqual([]);
    expect(conn.state.zones.stack).toHaveLength(1);
  });

  it('CR 605.3a: two identical mana sources get distinct labels', async () => {
    renderPrompt(bears());
    await click('Pay by hand');
    const labels = [...screen.getByRole('list', { name: 'Mana sources' }).querySelectorAll('button')].map((b) => b.textContent);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((l) => l?.startsWith('Forest'))).toHaveLength(2);
  });
});

describe('payCost helpers', () => {
  it('splits a cost text into its symbols and finds the Phyrexian ones', () => {
    expect(costSymbols('{2}{W/U/P}{G}{B/P}')).toEqual(['{2}', '{W/U/P}', '{G}', '{B/P}']);
    expect(phyrexianIndices('{2}{W/U/P}{G}{B/P}')).toEqual([1, 3]);
    expect(phyrexianIndices('{X}{R}')).toEqual([]);
  });

  it('one ability per permanent; a source that can make several colors starts with its first color', () => {
    const birds = { objectId: 'o1', abilityKey: 'p:0:1', label: 'Birds', produces: ['W', 'U', 'B', 'R', 'G'] as const };
    const land = { objectId: 'o2', abilityKey: 'a', label: 'Land A', produces: ['R'] as const };
    const land2 = { objectId: 'o2', abilityKey: 'b', label: 'Land B', produces: ['G'] as const };
    let picked = togglePicked([], { ...birds, produces: [...birds.produces] });
    expect(picked).toEqual([{ objectId: 'o1', abilityKey: 'p:0:1', color: 'W' }]);
    picked = togglePicked(picked, { ...land, produces: [...land.produces] });
    picked = togglePicked(picked, { ...land2, produces: [...land2.produces] });
    expect(picked).toEqual([{ objectId: 'o1', abilityKey: 'p:0:1', color: 'W' }, { objectId: 'o2', abilityKey: 'b' }]);
    // With the colors the cost still needs, a multi-color source starts with one of them (CR 106.1).
    expect(togglePicked([], { ...birds, produces: [...birds.produces] }, ['G'])).toEqual([{ objectId: 'o1', abilityKey: 'p:0:1', color: 'G' }]);
    expect(neededColors('{1}{G}{G}', [{ color: 'G' }], [])).toEqual(['G']);
    expect(neededColors('{1}{G}', [], [{ type: 'G' }])).toEqual([]);
    expect(neededColors('{B/P}{R/G}', [], [])).toEqual(['B', 'R', 'G']);
    expect(manualAnswer(picked, [3, 1])).toEqual({
      kind: 'payCost', auto: false, activations: [{ objectId: 'o1', abilityKey: 'p:0:1', color: 'W' }, { objectId: 'o2', abilityKey: 'b' }], lifeForPhyrexian: [1, 3],
    });
  });
});
