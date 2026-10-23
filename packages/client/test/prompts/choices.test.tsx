/**
 * Choices while casting and resolving, each answered through its prompt on a real engine state: targets (CR 601.2c, 115), division (CR 601.2d), modes
 * (CR 700.2), X (CR 107.3), a mana color (CR 106.1, 605.3b), the order of triggered abilities (CR 603.3b), an optional part of an effect (CR 608.2d).
 */
import { act as reactAct, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { act, answer, castAuto, click, find, passBoth, pendingKind, press, renderPrompt, scenario } from './harness';
import { viewFor } from '@openmtg/engine';
import { countText, toggle } from '../../src/prompts/ChoicePrompts';
import { objectName } from '../../src/prompts/names';

async function type(label: string, value: string): Promise<void> {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

describe('chooseTargets (CR 601.2c, 115.1)', () => {
  const bolt = () => {
    const s = scenario(['Mountain', 'Lightning Bolt', 'Grizzly Bears', 'Gladecover Scout'], {
      p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] },
      p2: { battlefield: ['Grizzly Bears', 'Gladecover Scout'] },
    });
    return act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
  };

  it('CR 702.11b: only legal targets are offered: the hexproof creature is neither listed nor clickable on the board', () => {
    const s = bolt();
    renderPrompt(s);
    const scout = find(s, 'Gladecover Scout', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(within(screen.getByRole('group', { name: 'Targets' })).queryByText(/Gladecover Scout/)).toBeNull();
    expect(screen.queryByRole('button', { name: `Board ${scout}` })).toBeNull();
    expect(screen.getByRole('button', { name: `Board ${bears}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bob' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alice (you)' })).toBeTruthy();
  });

  it('CR 115.1: a player target is answered as a player choice', async () => {
    const { conn } = renderPrompt(bolt());
    const ok = screen.getByRole('button', { name: 'Choose targets' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await click('Bob');
    await click('Choose targets');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    expect(conn.errors).toEqual([]);
    // The cost has only one way to pay (`onlyWay`): it is paid at once (auto pay), and the spell is on the stack.
    expect(conn.answers().at(-1)).toEqual({ kind: 'payCost', auto: true });
    expect(pendingKind(conn)).toBe('priority');
  });

  it('CR 115.1: a creature target clicked on the board is answered as an object choice (Space confirms)', async () => {
    const s = bolt();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { conn } = renderPrompt(s);
    await click(`Board ${bears}`);
    expect(screen.getByRole('button', { name: /Grizzly Bears/, pressed: true })).toBeTruthy();
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    expect(conn.errors).toEqual([]);
  });

  it('CR 733.1: Esc cancels the cast and the card goes back to the hand', async () => {
    const { conn } = renderPrompt(bolt());
    await press('Escape');
    expect(conn.sent.at(-1)).toEqual({ type: 'cancel', player: 'p1' });
    expect(pendingKind(conn)).toBe('priority');
    expect(conn.state.zones.hand.p1).toHaveLength(1);
  });
});

describe('chooseDivision (CR 601.2d)', () => {
  it('Fire: two damage divided between two targets, each at least 1', async () => {
    let s = scenario(['Fire // Ice', 'Grizzly Bears', 'Mountain'], { p1: { hand: ['Fire // Ice'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Fire // Ice', 'hand') });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { conn } = renderPrompt(s);
    await click(/Grizzly Bears/);
    await click('Bob');
    await click('Choose targets');
    expect(pendingKind(conn)).toBe('chooseDivision');
    const divide = screen.getByRole('button', { name: 'Divide' }) as HTMLButtonElement;
    expect(divide.disabled).toBe(false); // the default: 1 and 1
    await type(`Amount for ${screen.getAllByRole('rowheader')[0]!.textContent}`, '2');
    expect(divide.disabled).toBe(true); // 3 of 2: not a division of exactly 2
    expect(screen.getByRole('status').textContent).toBe('1 too many: divide exactly 2 (CR 601.2d).');
    await type(`Amount for ${screen.getAllByRole('rowheader')[0]!.textContent}`, '0');
    expect(screen.getByRole('status').textContent).toBe('Each target needs at least 1 (CR 601.2d).');
    await type(`Amount for ${screen.getAllByRole('rowheader')[0]!.textContent}`, '1');
    expect(screen.queryByRole('status')).toBeNull();
    await click('Divide');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseDivision', amounts: [1, 1] });
    expect(conn.errors).toEqual([]);
    expect(conn.state.objects[conn.state.zones.stack[0]!]!.stack!.targets.flat()).toEqual([{ kind: 'object', id: bears }, { kind: 'player', id: 'p2' }]);
  });
});

describe('chooseOption (CR 700.2)', () => {
  it('CR 700.2a: a mode without legal targets is shown as not possible, with the reason; a legal mode is answered by its id', async () => {
    let s = scenario(['Abzan Charm', 'Plains', 'Swamp', 'Forest'], { p1: { hand: ['Abzan Charm'], battlefield: ['Plains', 'Swamp', 'Forest'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Abzan Charm', 'hand') });
    const { conn } = renderPrompt(s);
    const exile = screen.getByRole('button', { name: /Exile target creature/ }) as HTMLButtonElement;
    expect(exile.disabled).toBe(true);
    // FAST4 T28 automates the third mode too, "distribute two +1/+1 counters among one or two target creatures" (CR 601.2d): no creature, no target either
    expect(screen.getAllByText(/Not possible: it has no legal targets/)).toHaveLength(2);
    expect((screen.getByRole('button', { name: /Distribute two \+1\/\+1 counters/ }) as HTMLButtonElement).disabled).toBe(true);
    await click(/You draw two cards/);
    await click('OK');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseOption', ids: ['1'] });
    expect(conn.errors).toEqual([]);
    // The cost has only one way to pay (`onlyWay`): it is paid at once (auto pay), and the spell is on the stack.
    expect(conn.answers().at(-1)).toEqual({ kind: 'payCost', auto: true });
    expect(pendingKind(conn)).toBe('priority');
  });

  it('CR 700.2: "choose two" needs exactly two modes', async () => {
    let s = scenario(["Kolaghan's Command", 'Mountain', 'Swamp'], { p1: { hand: ["Kolaghan's Command"], battlefield: ['Mountain', 'Swamp', 'Swamp', 'Mountain'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, "Kolaghan's Command", 'hand') });
    const d = s.pending!;
    expect(d).toMatchObject({ kind: 'chooseOption', min: 2, max: 2 });
    const { conn } = renderPrompt(s);
    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    const enabled = screen.getAllByRole('button', { pressed: false }).filter((b) => !(b as HTMLButtonElement).disabled && b.closest('.prompt-options'));
    await click(enabled[0]!.textContent!);
    expect(ok.disabled).toBe(true);
    await click(enabled[1]!.textContent!);
    expect(ok.disabled).toBe(false);
    const buttons = [...document.querySelectorAll('.prompt-options .prompt-option > button:first-child')];
    await click('OK');
    const opts = (d as { options: { id: string; label: string }[] }).options;
    const ids = [enabled[0]!, enabled[1]!].map((b) => opts[buttons.indexOf(b)]!.id);
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseOption', ids });
    expect(conn.errors).toEqual([]);
  });

  it("CR 201.5: a mode's self-reference (~ in the engine's label) is shown as the card's name", () => {
    let s = scenario(["Kolaghan's Command", 'Mountain', 'Swamp'], { p1: { hand: ["Kolaghan's Command"], battlefield: ['Mountain', 'Swamp', 'Swamp', 'Mountain'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, "Kolaghan's Command", 'hand') });
    expect((s.pending as { options: { label: string }[] }).options.some((o) => o.label.includes('~'))).toBe(true);
    renderPrompt(s);
    const labels = [...document.querySelectorAll('.prompt-options')].map((e) => e.textContent).join(' ');
    expect(labels).not.toContain('~');
    expect(screen.getByRole('button', { name: "Kolaghan's Command deals 2 damage to any target." })).toBeTruthy();
  });
});

describe('chooseNumber (CR 107.3a, 601.2b)', () => {
  it('Fireball: X is chosen within the offered range', async () => {
    let s = scenario(['Fireball', 'Mountain'], { p1: { hand: ['Fireball'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Fireball', 'hand') });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 2 });
    const { conn } = renderPrompt(s);
    await click('Increase');
    await click('Increase');
    expect((screen.getByRole('button', { name: 'Increase' }) as HTMLButtonElement).disabled).toBe(true);
    await type('Number', '7');
    expect((screen.getByRole('button', { name: /^Choose/ }) as HTMLButtonElement).disabled).toBe(true);
    await type('Number', '2');
    await click('Choose 2');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseNumber', n: 2 });
    expect(conn.errors).toEqual([]);
  });
});

describe('chooseColor (CR 106.1, 605.3b)', () => {
  it('Birds of Paradise: the chosen color is the mana added', async () => {
    let s = scenario(['Birds of Paradise'], { p1: { battlefield: ['Birds of Paradise'] } });
    const birds = find(s, 'Birds of Paradise', 'battlefield');
    s = act(s, { type: 'activate', player: 'p1', source: birds, ability: 'p:0:1' });
    const { conn } = renderPrompt(s);
    await click('Green (G)');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseColor', color: 'G' });
    expect(conn.state.players[0]!.manaPool.map((u) => u.type)).toEqual(['G']);
  });
});

describe('order (CR 603.3b)', () => {
  it('two triggered abilities: moving one down puts it on the stack last, so it resolves first', async () => {
    let s = scenario(['Soul Warden', 'Elvish Visionary', 'Forest'], { p1: { hand: ['Elvish Visionary'], battlefield: ['Soul Warden', 'Forest', 'Forest'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Elvish Visionary', 'hand') });
    while (s.pending?.kind === 'payCost') s = act(s, { type: 'answer', player: 'p1', decisionId: s.pending.id, answer: { kind: 'payCost', auto: true } });
    s = act(act(s, { type: 'pass', player: 'p1' }), { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('order');
    const items = (s.pending as { items: { id: string; label: string }[] }).items;
    const { conn } = renderPrompt(s);
    // Positions are numbered (the list style is flex, so the <ol> numbers are not drawn); "~" reads as the source's name (CR 201.5).
    const order = screen.getByRole('list', { name: 'Order' });
    expect([...order.querySelectorAll('.prompt-order-pos')].map((e) => e.textContent)).toEqual(['1.', '2.']);
    expect(order.textContent).not.toContain('~');
    const source0 = items[0]!.label.split(':')[0]!;
    await click(new RegExp(`^Move down: ${source0}`));
    await click('OK');
    expect(conn.lastAnswer()).toEqual({ kind: 'order', ids: [items[1]!.id, items[0]!.id] });
    expect(conn.errors).toEqual([]);
    const top = conn.state.objects[conn.state.zones.stack.at(-1)!]!;
    expect(top.stack?.sourceName).toBe(items[0]!.label.split(':')[0]);
  });
});

describe('yesNo (CR 608.2d, 603.5: an optional part of a resolving ability)', () => {
  /** Gravedigger's enters trigger targets the Grizzly Bears card in the graveyard; on resolution "you may return" asks yes or no. */
  function gravedigger() {
    let s = scenario(['Gravedigger', 'Swamp', 'Grizzly Bears'], { p1: { hand: ['Gravedigger'], graveyard: ['Grizzly Bears'], battlefield: Array<string>(4).fill('Swamp') } });
    s = passBoth(castAuto(s, 'Gravedigger'));
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'graveyard') }] });
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    return s;
  }

  it('Yes (also Space) does the optional part: the card returns to the hand', async () => {
    const { conn } = renderPrompt(gravedigger());
    expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy();
    await press(' ');
    expect(conn.lastAnswer()).toEqual({ kind: 'yesNo', yes: true });
    expect(conn.errors).toEqual([]);
    expect(conn.state.zones.hand.p1!.map((id) => conn.state.objects[id]!.defId)).toContain('Grizzly Bears');
  });

  it('No leaves the card in the graveyard', async () => {
    const { conn } = renderPrompt(gravedigger());
    await click('No');
    expect(conn.lastAnswer()).toEqual({ kind: 'yesNo', yes: false });
    expect(conn.state.zones.graveyard.p1!.map((id) => conn.state.objects[id]!.defId)).toContain('Grizzly Bears');
  });
});

describe('names (CR 709.4)', () => {
  it('CR 709.4: a split card outside the stack is named after both halves; on the stack after the half that was cast (CR 709.3)', () => {
    let s = scenario(['Fire // Ice', 'Mountain'], { p1: { hand: ['Fire // Ice'], battlefield: ['Mountain', 'Mountain'] } });
    const card = find(s, 'Fire // Ice', 'hand');
    expect(objectName(viewFor(s, 'p1'), card)).toBe('Fire // Ice');
    renderPrompt(s);
    expect(screen.getByRole('button', { name: 'Fire // Ice (in hand)' })).toBeTruthy();
    s = act(s, { type: 'cast', player: 'p1', card, face: 0 });
    const onStack = s.zones.stack[0]!;
    expect(objectName(viewFor(s, 'p1'), onStack)).toBe('Fire');
  });
});

describe('selection helpers', () => {
  it('toggle: max 1 replaces, a full selection does not grow, a second click removes', () => {
    expect(toggle(['a'], 'b', 1)).toEqual(['b']);
    expect(toggle(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a', 2)).toEqual(['b']);
  });
  it('countText', () => {
    expect(countText(2, 2)).toBe('Choose 2');
    expect(countText(0, 3)).toBe('Choose up to 3');
    expect(countText(1, 2)).toBe('Choose 1 to 2');
  });
});
