/**
 * FAST3 CL1: the client side of FAST2 MRE (docs/design/m8-client.md "Manual resolution in steps and the by-hand tools"; STATUS "Known gaps of C6" 6 and 7).
 *  - Manual resolution in steps (CR 608.2c): "Apply and continue" sends the adjustments so far with `continue: true`, the prompt comes back with the game
 *    after them (Brainstorm's three drawn cards are in the hand and can be picked), and "Done" ends it. No cancel after a step (CR 733.1, 400.2).
 *  - The by-hand tools: a manual triggered ability (Arrogant Outlaw's enters trigger, CR 603.2, 603.3) and a manual static ability (CR 604.1) are offered
 *    from the card on the board (the click menu) and in the prompt ("By hand (N)"), never done by one click; the engine's public log lines name the card
 *    and the text.
 * Cards: Brainstorm is automated by the templates today, so it is compiled here with its whole text kept manual (the engine tests' convention for tests
 * whose subject is manual resolution); Arrogant Outlaw's real Oracle text is automated since FAST4 T23, so its trigger is kept manual here the same way.
 */
import { act as reactAct, fireEvent, render, screen, within } from '@testing-library/react';
import {
  compileCard, isByHandKind, legalActions, MANUAL_MAX_STEPS, noAbilityCompiler, viewFor, type CardDef, type GameState, type OracleCard,
} from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { GameBoard } from '../../src/board';
import { playableObjects } from '../../src/board/model';
import { useGameView, useLegalActions } from '../../src/connection/useGame';
import { useBoardInteraction } from '../../src/game/interaction';
import { PromptBar } from '../../src/prompts/PromptBar';
import { PromptSelectionProvider, SelectionStore } from '../../src/prompts/selection';
import { answer, castAuto, click, clickEl, find, lifeOf, passBoth, pendingKind, renderPrompt, scenario, StateConnection } from './harness';

const BRAINSTORM: OracleCard = {
  name: 'Brainstorm', layout: 'normal', mana_cost: '{U}', type_line: 'Instant',
  oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.',
} as OracleCard;
const OUTLAW: OracleCard = {
  name: 'Arrogant Outlaw', layout: 'normal', mana_cost: '{2}{B}', type_line: 'Creature — Vampire Noble', power: '3', toughness: '2',
  oracle_text: 'When this creature enters, if an opponent lost life this turn, each opponent loses 2 life and you gain 2 life.',
} as OracleCard;
/** A synthetic enchantment with a static ability the engine cannot state (kept manual on purpose). */
const ANTHEM_TEXT = 'Other creatures you control get +1/+1 as long as you control a Plains.';
const anthem: CardDef = compileCard({ name: 'Test Odd Anthem', layout: 'normal', mana_cost: '{2}', type_line: 'Enchantment', oracle_text: ANTHEM_TEXT } as OracleCard, () => ({
  abilities: [{ kind: 'manual', shape: 'static', text: ANTHEM_TEXT, reason: 'test: no template for the static ability' }],
  unsupported: [ANTHEM_TEXT],
}));

const manualBrainstorm = compileCard(BRAINSTORM, noAbilityCompiler);
// FAST4 T23 automates Arrogant Outlaw's intervening "if" (an opponent lost life this turn, CR 603.4), so its trigger is kept manual here (the engine tests'
// convention for tests whose subject is a manual ability)
const outlaw = compileCard(OUTLAW, (face) => ({
  abilities: [{ kind: 'manual', shape: 'triggered', text: face.oracleText.trim(), reason: 'test: the trigger is kept manual' }],
  unsupported: [face.oracleText.trim()],
}));

async function change(label: string, value: string): Promise<void> {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const handNames = (s: GameState, p = 'p1'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();
const optionTexts = (label: string): string[] => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.textContent ?? '');

describe('manual resolution in steps (C6 gap 6, CR 608.2c): Brainstorm', () => {
  const LIBRARY = ['Grizzly Bears', 'Lightning Bolt', 'Forest'];

  /** p1 casts Brainstorm (kept manual) with a Mountain in hand; the top of p1's library is Grizzly Bears, Lightning Bolt, Forest. */
  function resolving(): GameState {
    let s = scenario([...LIBRARY, 'Mountain', 'Island'], { defs: [manualBrainstorm], p1: { hand: ['Brainstorm', 'Mountain'], battlefield: ['Island'], library: LIBRARY } });
    s = passBoth(castAuto(s, 'Brainstorm'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1', sourceName: 'Brainstorm' });
    return s;
  }

  it('"Apply and continue" draws three, the prompt comes back with the drawn cards in the hand; two are put back and "Done" ends it', async () => {
    const s0 = resolving();
    const firstId = s0.pending!.id;
    const { conn } = renderPrompt(s0);
    expect(document.querySelector('.prompt-manual-text')!.textContent).toBe(BRAINSTORM.oracle_text);
    // Nothing to continue with yet: "Apply and continue" needs at least one adjustment (the engine refuses an empty step).
    expect((screen.getByRole('button', { name: 'Apply and continue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(optionTexts('Card').some((t) => /Grizzly Bears|Lightning Bolt/.test(t))).toBe(false);

    await change('Operation', 'draw');
    await change('Player', 'p1');
    await change('Cards', '3');
    await click('Add adjustment');
    await click('Apply and continue');
    expect(conn.lastAnswer()).toEqual({ kind: 'manualResolve', ops: [{ op: 'draw', player: 'p1', count: 3 }], continue: true });
    expect(conn.errors).toEqual([]);

    // The same question again (a new decision), with the game after the step: the spell is still on the stack, the cards are in the hand.
    expect(conn.state.pending).toMatchObject({ kind: 'manualResolve', sourceName: 'Brainstorm', step: 1 });
    expect(conn.state.pending!.cancellable).toBeFalsy();
    expect(conn.state.pending!.id).not.toBe(firstId);
    expect(conn.state.zones.stack).toHaveLength(1);
    expect(handNames(conn.state)).toEqual(['Forest', 'Grizzly Bears', 'Lightning Bolt', 'Mountain']);
    expect(screen.getByRole('heading', { name: /Brainstorm · Step 2/ })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/1 step already applied/);
    // The list starts over, Cancel is gone (CR 733.1), and the drawn cards can be picked in the panel and on the board.
    expect(screen.queryByRole('list', { name: 'Adjustments to apply' })!.querySelectorAll('li')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(optionTexts('Card')).toEqual(expect.arrayContaining(['Grizzly Bears (in hand)', 'Lightning Bolt (in hand)', 'Forest (in hand)']));
    const bears = find(conn.state, 'Grizzly Bears', 'hand', 'p1');
    const bolt = find(conn.state, 'Lightning Bolt', 'hand', 'p1');

    await click(`Board ${bears}`);
    expect((screen.getByLabelText('Card') as HTMLSelectElement).value).toBe(bears);
    await change('To zone', 'libraryTop');
    await click('Add adjustment');
    await change('Card', bolt);
    await change('To zone', 'libraryTop');
    await click('Add adjustment');
    await click('Done: apply 2 adjustments');
    expect(conn.lastAnswer()).toEqual({ kind: 'manualResolve', ops: [{ op: 'move', object: bears, to: 'libraryTop' }, { op: 'move', object: bolt, to: 'libraryTop' }] });
    expect(conn.errors).toEqual([]);
    expect(pendingKind(conn)).toBe('priority');
    expect(conn.state.zones.stack).toEqual([]);
    expect(handNames(conn.state)).toEqual(['Forest', 'Mountain']);
    expect(conn.state.zones.library.p1!.slice(0, 2).map((id) => nameOf(conn.state, id)).sort()).toEqual(['Grizzly Bears', 'Lightning Bolt']);
    expect(conn.state.zones.graveyard.p1!.map((id) => nameOf(conn.state, id))).toEqual(['Brainstorm']);
  });

  it('after a step, "Done" with nothing more to add confirms at once (no "nothing will happen" question)', async () => {
    const s = answer(resolving(), { kind: 'manualResolve', ops: [{ op: 'draw', player: 'p1', count: 3 }], continue: true });
    const { conn } = renderPrompt(s);
    expect(screen.queryByRole('button', { name: 'Done (no changes)' })).toBeNull();
    await click('Done');
    expect(conn.lastAnswer()).toEqual({ kind: 'manualResolve', ops: [] });
    expect(pendingKind(conn)).toBe('priority');
    expect(handNames(conn.state)).toEqual(['Forest', 'Grizzly Bears', 'Lightning Bolt', 'Mountain']);
  });

  it(`the last of ${MANUAL_MAX_STEPS} prompts can only be confirmed: "Apply and continue" is gone`, async () => {
    let s = resolving();
    for (let i = 0; i < MANUAL_MAX_STEPS - 1; i++) s = answer(s, { kind: 'manualResolve', ops: [{ op: 'note', text: `step ${i}` }], continue: true });
    expect(s.pending).toMatchObject({ kind: 'manualResolve', step: MANUAL_MAX_STEPS - 1 });
    renderPrompt(s);
    expect(screen.queryByRole('button', { name: 'Apply and continue' })).toBeNull();
    expect(screen.getByText(/The last step/)).toBeTruthy();
  });
});

describe('by-hand tools (C6 gap 7): a manual triggered ability (Arrogant Outlaw) and a manual static ability', () => {
  /** p1 controls Arrogant Outlaw (its enters trigger is manual text) and the odd anthem, with a Forest to play so auto-pass does not skip the turn. */
  function board(): GameState {
    return scenario(['Forest', 'Grizzly Bears'], { defs: [outlaw, anthem], p1: { battlefield: ['Arrogant Outlaw', 'Test Odd Anthem', 'Grizzly Bears'], hand: ['Forest'] } });
  }

  it('the board marks a source with only by-hand tools as "by hand", never as playable', () => {
    const s = board();
    const legal = legalActions(s, 'p1');
    const outlawId = find(s, 'Arrogant Outlaw', 'battlefield');
    expect(legal.filter((a) => isByHandKind(a.kind)).map((a) => a.object)).toContain(outlawId);
    const { playable, byHand } = playableObjects(legal);
    expect(playable.has(outlawId)).toBe(false);
    expect(byHand.has(outlawId)).toBe(true);
    expect(byHand.has(find(s, 'Test Odd Anthem', 'battlefield'))).toBe(true);
  });

  it('CR 603.2, 603.3: in the prompt, "By hand (2)" lists the sources; the menu puts the trigger on the stack, logged with the card and its text; it resolves in steps', async () => {
    const s = board();
    const outlawId = find(s, 'Arrogant Outlaw', 'battlefield');
    const { conn } = renderPrompt(s);
    // Not among the playable cards; one entry like the mana sources, and a click on the board never acts at once.
    expect(within(screen.getByRole('group', { name: 'Playable cards' })).queryByText(/Arrogant Outlaw/)).toBeNull();
    expect(screen.getByRole('button', { name: `Board ${outlawId}` }).getAttribute('data-mark')).toBe('by hand');
    await click(`Board ${outlawId}`);
    expect(conn.sent).toEqual([]);
    const menu = screen.getByRole('group', { name: 'Actions of Arrogant Outlaw' });
    expect(within(menu).getByRole('group', { name: 'By hand' }).textContent).toMatch(/CR 603\.2/);
    await click('Close');
    await click('By hand (2)');
    const tools = screen.getByRole('group', { name: 'By-hand tools' });
    expect(within(tools).getAllByRole('button').map((b) => b.textContent)).toEqual(['Arrogant Outlaw · by hand', 'Test Odd Anthem · by hand']);
    await clickEl(within(tools).getByRole('button', { name: /Arrogant Outlaw/ }));
    const trigger = within(screen.getByRole('group', { name: 'By hand' })).getByRole('button', { name: /it triggered: put it on the stack by hand/ });
    expect(trigger.textContent).toContain(OUTLAW.oracle_text);

    const from = conn.state.log.length;
    await clickEl(trigger);
    expect(conn.errors).toEqual([]);
    expect(conn.sent.at(-1)).toMatchObject({ type: 'manualTrigger', player: 'p1', source: outlawId });
    // The public log names the card and the text (the opponent's view too).
    expect(viewFor(conn.state, 'p2').log.slice(from).some((l) => l.text.includes("Arrogant Outlaw's triggered ability on the stack by hand") && l.text.includes(OUTLAW.oracle_text!))).toBe(true);
    expect(conn.state.zones.stack).toHaveLength(1);

    // Both players pass: it resolves through the manualResolve prompt, in steps.
    await click('Pass priority');
    await click('Pass priority');
    expect(conn.state.pending).toMatchObject({ kind: 'manualResolve', player: 'p1', sourceName: 'Arrogant Outlaw' });
    expect(document.querySelector('.prompt-manual-text')!.textContent).toBe(OUTLAW.oracle_text);
    await change('Operation', 'life');
    await change('Player', 'p2');
    await change('Life change', '-2');
    await click('Add adjustment');
    await click('Apply and continue');
    expect(lifeOf(conn.state, 'p2')).toBe(18);
    expect(conn.state.pending).toMatchObject({ kind: 'manualResolve', step: 1 });
    await change('Operation', 'life');
    await change('Player', 'p1');
    await change('Life change', '2');
    await click('Add adjustment');
    await click('Done: apply 1 adjustment');
    expect(conn.errors).toEqual([]);
    expect(lifeOf(conn.state, 'p1')).toBe(22);
    expect(conn.state.zones.stack).toEqual([]);
    expect(pendingKind(conn)).toBe('priority');
  });

  it('CR 604.1: the static tool opens a cancellable manual prompt without the stack; "Apply and continue" says it commits; Cancel reverses it', async () => {
    const s = board();
    const anthemId = find(s, 'Test Odd Anthem', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const { conn } = renderPrompt(s);
    await click(`Board ${anthemId}`);
    await click(/apply it by hand/);
    expect(conn.state.pending).toMatchObject({ kind: 'manualResolve', sourceName: 'Test Odd Anthem', subjectId: anthemId, cancellable: true });
    expect(conn.state.zones.stack).toEqual([]);
    expect(screen.getByText(/"Apply and continue" commits this action/)).toBeTruthy();
    await click('Cancel');
    expect(pendingKind(conn)).toBe('priority');

    const from = conn.state.log.length;
    await click(`Board ${anthemId}`);
    await click(/apply it by hand/);
    await change('Operation', 'counters');
    await change('Counters on', bears);
    await click('Add adjustment');
    await click('Apply and continue');
    expect(conn.state.pending).toMatchObject({ kind: 'manualResolve', step: 1, cancellable: false });
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await click('Done');
    expect(conn.errors).toEqual([]);
    expect(conn.state.objects[bears]!.counters).toEqual({ '+1/+1': 1 });
    expect(conn.state.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // CR 117.3c: the player keeps priority
    // The public log names the card and the text (the opponent's view too), with the adjustment.
    const lines = viewFor(conn.state, 'p2').log.slice(from).map((l) => l.text);
    expect(lines.some((l) => l.includes("applies Test Odd Anthem's static ability by hand") && l.includes(ANTHEM_TEXT))).toBe(true);
  });

  it('on the real game board: the source is drawn as "by hand" (not playable) and its click opens the menu in the prompt', async () => {
    const s = board();
    const outlawId = find(s, 'Arrogant Outlaw', 'battlefield');
    const forestInHand = find(s, 'Forest', 'hand', 'p1');
    const conn = new StateConnection(s);
    const store = new SelectionStore();
    function Screen() {
      const view = useGameView(conn);
      const legal = useLegalActions(conn);
      const interaction = useBoardInteraction(conn, store);
      return <GameBoard view={view} legalActions={legal} interaction={interaction} prompt={<PromptBar connection={conn} armDelayMs={0} />} />;
    }
    const { container } = render(
      <PromptSelectionProvider store={store}>
        <Screen />
      </PromptSelectionProvider>,
    );
    const slot = container.querySelector<HTMLElement>(`.board-card[data-object-id="${outlawId}"]`)!;
    expect(slot.getAttribute('data-highlight')).toBe('byhand');
    expect(container.querySelector(`.board-card[data-object-id="${forestInHand}"]`)!.getAttribute('data-highlight')).not.toBe('byhand');
    await clickEl(slot);
    expect(conn.sent).toEqual([]);
    expect(within(screen.getByRole('group', { name: 'Actions of Arrogant Outlaw' })).getByRole('group', { name: 'By hand' })).toBeTruthy();
  });
});
