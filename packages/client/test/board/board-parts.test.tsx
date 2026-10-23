/**
 * The board's parts: markers outside the card image (damage, combat, summoning sickness, tapped), P/T and counters on the card, the
 * stack with controller and targets, the game
 * log with its rule citations and turn filter, highlights and clicks driven by props, the stops (setStops), zone viewers and the mana pool.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { applyAction, compileCard, DUNGEONS, dungeonDef, legalActions, type GameView, type ObjectId } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import { GameBoard, filterLog, playableObjects, toggleStop } from '../../src/board';
import { withStaged } from '../../src/board/GameBoard';
import { COLLAPSED_ENTRIES } from '../../src/board/GameLog';
import { cardCount } from '../../src/board/model';
import { ALICE, BOB, editable, playGame, type Captured } from './fixtures';

const game = playGame(6, undefined, (s) => s.zones.stack.length > 0);

function at(turn: number, step: string, viewer?: string): Captured {
  const c = game.captured.find((x) => x.turn === turn && x.step === step && (viewer === undefined || x.view.viewer === viewer));
  if (!c) throw new Error(`no capture at ${turn}:${step}`);
  return c;
}

function slot(container: HTMLElement, id: ObjectId): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.board-card[data-object-id="${id}"]`);
  if (!el) throw new Error(`no card slot for ${id}`);
  return el;
}

function named(view: GameView, controller: string, name: string): ObjectId[] {
  return view.zones.battlefield.filter((id) => view.objects[id]!.controller === controller && view.defs[view.objects[id]!.defId]?.name === name);
}

describe('battlefield rows, markers (outside the card image) and the card overlay (on it)', () => {
  it('CR 403: creatures, lands and other permanents are in separate rows for each player', () => {
    const c = at(5, 'main1', ALICE);
    render(<GameBoard view={c.view} />);
    const lands = screen.getByRole('list', { name: "Alice's lands" });
    const creatures = screen.getByRole('list', { name: "Alice's creatures" });
    // direct children: the marker strips inside are lists too
    expect(lands.children.length).toBe(named(c.view, ALICE, 'Forest').length);
    expect(creatures.children.length).toBe(named(c.view, ALICE, 'Test Bear').length);
    expect(screen.getByRole('list', { name: "Bob's creatures" }).children.length).toBe(named(c.view, BOB, 'Test Bear').length);
    expect(screen.getByRole('list', { name: "Alice's other permanents" }).children.length).toBe(0);
    expect(named(c.view, ALICE, 'Forest').length).toBeGreaterThan(0);
    expect(named(c.view, BOB, 'Test Bear').length).toBeGreaterThan(0);
  });

  it('only creatures (with what is attached to them) stand on the main line; other nonland permanents go beside the lands', () => {
    const v = editable(at(5, 'main1', ALICE).view);
    const relic = compileCard({ name: 'Test Relic', layout: 'normal', mana_cost: '{2}', type_line: 'Artifact', oracle_text: '' });
    v.defs[relic.id] = relic;
    const [forest, other] = named(v, ALICE, 'Forest');
    const [bear] = named(v, ALICE, 'Test Bear');
    v.objects[forest!] = { ...v.objects[forest!]!, defId: relic.id };
    // An Aura-like attachment rides with its host on the main line, whatever its type.
    v.objects[other!] = { ...v.objects[other!]!, attachedTo: bear! };
    render(<GameBoard view={v} />);
    const others = screen.getByRole('list', { name: "Alice's other permanents" });
    const creatures = screen.getByRole('list', { name: "Alice's creatures" });
    expect(others.querySelector(`[data-object-id="${forest}"]`)).not.toBeNull();
    expect(creatures.querySelector(`[data-object-id="${forest}"]`)).toBeNull();
    expect(creatures.querySelector(`[data-object-id="${other}"]`)).not.toBeNull();
    expect(screen.getByRole('list', { name: "Alice's lands" }).querySelector(`[data-object-id="${other}"]`)).toBeNull();
  });

  it('CR 302.6: a creature cast this turn is marked summoning sick; CR 701.26: lands tapped for mana are tapped (rotated)', () => {
    const c = at(3, 'beginCombat', ALICE);
    const { container } = render(<GameBoard view={c.view} />);
    const [bear] = named(c.view, ALICE, 'Test Bear');
    expect(within(slot(container, bear!)).getByText('Summoning sick')).toBeTruthy();
    const pt = slot(container, bear!).querySelector('.board-card-image .card-pt')!;
    expect(pt.getAttribute('data-pt')).toBe('2/2');
    expect(pt.getAttribute('data-tone')).toBe('same');
    const tapped = named(c.view, ALICE, 'Forest').filter((id) => c.view.objects[id]!.tapped);
    expect(tapped.length).toBe(2);
    for (const id of tapped) {
      expect(slot(container, id).classList.contains('is-tapped')).toBe(true);
      expect(within(slot(container, id)).getByText('Tapped')).toBeTruthy();
    }
  });

  it('CR 508.1, 509.1: attacking and blocking creatures are marked with what they attack and block', () => {
    const c = at(5, 'declareBlockers', ALICE);
    const combat = c.view.combat!;
    expect(combat.attackers.length).toBeGreaterThan(0);
    expect(combat.blockers.length).toBeGreaterThan(0);
    const { container } = render(<GameBoard view={c.view} />);
    const a = combat.attackers[0]!;
    expect(within(slot(container, a.id)).getByText(`Attacking Bob${a.blocked ? ' (blocked)' : ''}`)).toBeTruthy();
    const b = combat.blockers[0]!;
    expect(within(slot(container, b.id)).getByText('Blocking Test Bear')).toBeTruthy();
  });

  it('CR 120.6: marked damage is a chip under the card; CR 122.1, 613.4c: counters are on the card, +1/+1 and -1/-1 counters in the P/T and as a badge', () => {
    const c = at(5, 'main1', ALICE);
    const v = editable(c.view);
    const [bear] = named(v, BOB, 'Test Bear');
    const [other] = named(v, ALICE, 'Test Bear');
    v.objects[bear!] = { ...v.objects[bear!]!, damage: 1, counters: { '+1/+1': 2, charge: 3 } };
    v.objects[other!] = { ...v.objects[other!]!, counters: { '-1/-1': 1 } };
    const { container } = render(<GameBoard view={v} />);
    const el = slot(container, bear!);
    expect(within(el).getByText('1 damage')).toBeTruthy();
    expect(el.querySelector(':scope > .marker-strip')).not.toBeNull();
    expect(container.querySelectorAll('.board-card-image .marker')).toHaveLength(0);
    // no "+1/+1 x2" chip and no second P/T; the card's own P/T is raised and drawn as changed
    expect(within(el).queryByText(/\+1\/\+1 ×/)).toBeNull();
    const pt = el.querySelector('.board-card-image .card-pt')!;
    expect(pt.getAttribute('data-pt')).toBe('4/4');
    expect(pt.getAttribute('data-tone')).toBe('up');
    expect(pt.getAttribute('title')).toContain('2 +1/+1 counters');
    // the +1/+1 counters get a badge too, first
    const badges = el.querySelectorAll<HTMLElement>('.board-card-image .card-counter');
    expect([...badges].map((b) => b.dataset.counter)).toEqual(['+1/+1', 'charge']);
    expect(badges[0]!.textContent).toContain('+1/+1');
    expect(badges[0]!.querySelector('.card-counter-n')!.textContent).toBe('×2');
    expect(badges[0]!.getAttribute('title')).toBe('2 +1/+1 counters (CR 122.1)');
    const charge = el.querySelector<HTMLElement>('.board-card-image .card-counter[data-counter="charge"]')!;
    expect(charge.querySelector('.card-counter-n')!.textContent).toBe('3');
    expect(charge.getAttribute('title')).toBe('3 charge counters (CR 122.1)');
    const lower = slot(container, other!).querySelector('.card-pt')!;
    expect(lower.getAttribute('data-pt')).toBe('1/1');
    expect(lower.getAttribute('data-tone')).toBe('down');
    const minus = slot(container, other!).querySelectorAll<HTMLElement>('.card-counter');
    expect([...minus].map((b) => b.dataset.counter)).toEqual(['-1/-1']);
    expect(minus[0]!.querySelector('.card-counter-n')).toBeNull();
  });
});

describe('the stack (CR 405)', () => {
  it('lists spells top first with their controller', () => {
    const k = game.kept.find((x) => x.view.viewer === ALICE)!;
    render(<GameBoard view={k.view} />);
    const stack = screen.getByRole('region', { name: /^Stack \(/ });
    const items = [...stack.querySelectorAll<HTMLElement>('.stack-item')];
    expect(items).toHaveLength(k.view.zones.stack.length);
    expect(items[0]!.getAttribute('data-stack-id')).toBe(k.view.zones.stack[k.view.zones.stack.length - 1]);
    expect(within(items[0]!).getByText('Top')).toBeTruthy();
    expect(within(items[0]!).getByText('Controller: Alice')).toBeTruthy();
    expect(items[0]!.querySelector('.stack-name')?.textContent).toBe('Test Bear');
  });

  it('ui/arena: the stack also stands as a pile on the table (the next to resolve in front), always; one card at a time while pictures may not overlap; it is decoration', () => {
    const k = game.kept.find((x) => x.view.viewer === ALICE)!;
    const top = k.view.zones.stack[k.view.zones.stack.length - 1]!;
    const { container, rerender } = render(<GameBoard view={k.view} cardsMayOverlap />);
    const pile = container.querySelector<HTMLElement>('.table-stack')!;
    expect(pile.getAttribute('aria-hidden')).toBe('true');
    const cards = [...pile.querySelectorAll<HTMLElement>('[data-table-stack-id]')];
    expect(cards).toHaveLength(Math.min(4, k.view.zones.stack.length));
    // Drawn back to front: the top object comes last in the page, and it is the one marked as the top.
    expect(cards[cards.length - 1]!.dataset.tableStackId).toBe(top);
    expect(cards[cards.length - 1]!.classList.contains('is-top')).toBe(true);
    // Nothing in it takes the keyboard (the rail's list does), and it is no second copy of a board card for lookups by object id.
    expect(pile.querySelectorAll('[tabindex], [data-object-id]')).toHaveLength(0);
    expect(pile.querySelector(".table-stack-count")?.textContent).toBe(`Stack ${k.view.zones.stack.length}`);
    // Scryfall images may be on screen: only the top object stands on the table, so no picture is ever covered (ARCHITECTURE.md "Card images"), and the
    // count still says how many are waiting.
    rerender(<GameBoard view={k.view} cardsMayOverlap={false} />);
    const one = [...container.querySelectorAll<HTMLElement>('.table-stack [data-table-stack-id]')];
    expect(one.map((c) => c.dataset.tableStackId)).toEqual([top]);
    expect(container.querySelector('.table-stack-count')?.textContent).toBe(`Stack ${k.view.zones.stack.length}`);
  });

  it('ui/arena: a spell that came and went inside one change stands on both stacks while the animator stages it, over that view only', () => {
    const k = game.kept.find((x) => x.view.viewer === ALICE)!;
    const top = k.view.zones.stack[k.view.zones.stack.length - 1]!;
    const o = k.view.objects[top]!;
    // The view after the change: the spell is gone from the stack already (every player passed at once).
    const { [top]: _gone, ...objects } = k.view.objects;
    const base: GameView = { ...k.view, objects, zones: { ...k.view.zones, stack: k.view.zones.stack.filter((id) => id !== top) } };
    const staged = { base, objects: [o], defs: { [o.defId]: k.view.defs[o.defId]! } };
    const shown = withStaged(base, staged);
    expect(shown.zones.stack[shown.zones.stack.length - 1]).toBe(top);
    expect(shown.objects[top]?.zone).toBe('stack');
    // Another view on screen: nothing is added.
    expect(withStaged(k.view, staged)).toBe(k.view);
    const { container } = render(<GameBoard view={shown} cardsMayOverlap={false} />);
    expect([...container.querySelectorAll<HTMLElement>('.table-stack [data-table-stack-id]')].map((c) => c.dataset.tableStackId)).toEqual([top]);
    expect(container.querySelector(`.stack-panel [data-stack-id="${top}"]`)).not.toBeNull();
  });

  it('CR 115.1, 601.2c: targets are listed, marked on the board, and emphasized while pointing at the stack entry', () => {
    const c = at(5, 'main1', ALICE);
    const v = editable(c.view);
    const [aliceBear] = named(v, ALICE, 'Test Bear');
    const [bobBear] = named(v, BOB, 'Test Bear');
    const id = 'o-ability-test';
    v.objects[id] = {
      ...structuredClone(v.objects[aliceBear!]!), id, kind: 'ability', zone: 'stack',
      stack: { kind: 'triggered', sourceId: aliceBear!, sourceName: 'Test Bear', targets: [[{ kind: 'object', id: bobBear! }, { kind: 'player', id: BOB }]], costsPaid: {} },
    };
    v.zones.stack.push(id);
    const { container } = render(<GameBoard view={v} />);
    const item = container.querySelector<HTMLElement>(`[data-stack-id="${id}"]`)!;
    expect(within(item).getByText('Triggered ability')).toBeTruthy();
    expect(within(item).getByText('Bob')).toBeTruthy();
    expect(item.querySelectorAll('.target-chip')).toHaveLength(2);
    expect(within(slot(container, bobBear!)).getByText('Target of Ability of Test Bear')).toBeTruthy();
    expect(slot(container, bobBear!).getAttribute('data-highlight')).toBe('targeted');
    const bobPanel = container.querySelector<HTMLElement>(`.player-panel[data-player-id="${BOB}"]`)!;
    expect(within(bobPanel).getByText('Target of Ability of Test Bear')).toBeTruthy();
    fireEvent.mouseEnter(item);
    expect(slot(container, bobBear!).getAttribute('data-highlight')).toBe('focus');
    expect(bobPanel.getAttribute('data-highlight')).toBe('focus');
    fireEvent.mouseLeave(item);
    expect(slot(container, bobBear!).getAttribute('data-highlight')).toBe('targeted');
  });
});

describe('game log with rule citations', () => {
  const last = game.captured[game.captured.length - 1]!;

  it('is hidden behind the rail\'s Log button, a drawer over the table', () => {
    const { container } = render(<GameBoard view={last.view} />);
    expect(container.querySelector('.game-log')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Log/ }));
    expect(container.querySelector('.board-main .game-log')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close the log' }));
    expect(container.querySelector('.game-log')).toBeNull();
  });

  it('shows every shown entry\'s rule citations, newest first', () => {
    const { container } = render(<GameBoard view={last.view} />);
    fireEvent.click(screen.getByRole('button', { name: /^Log/ }));
    const entries = [...container.querySelectorAll<HTMLElement>('.log-entry')];
    expect(entries.length).toBe(Math.min(COLLAPSED_ENTRIES, last.view.log.length));
    const bySeq = new Map(last.view.log.map((e) => [String(e.seq), e]));
    expect(entries[0]!.getAttribute('data-seq')).toBe(String(last.view.log[last.view.log.length - 1]!.seq));
    let cited = 0;
    for (const el of entries) {
      const e = bySeq.get(el.getAttribute('data-seq')!)!;
      expect([...el.querySelectorAll('cite')].map((x) => x.textContent)).toEqual(e.rules ?? []);
      cited += e.rules?.length ?? 0;
    }
    expect(cited).toBeGreaterThan(0);
    expect(screen.getAllByText('CR 117.3d').length).toBeGreaterThan(0);
  });

  it('expands to the whole log and filters by turn', () => {
    const { container } = render(<GameBoard view={last.view} />);
    fireEvent.click(screen.getByRole('button', { name: /^Log/ }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(container.querySelectorAll('.log-entry').length).toBe(last.view.log.length);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter log by turn' }), { target: { value: '2' } });
    const shown = [...container.querySelectorAll('.log-turn')].map((x) => x.textContent);
    expect(shown.length).toBe(last.view.log.filter((e) => e.turn === 2).length);
    expect(new Set(shown)).toEqual(new Set(['T2']));
    expect(filterLog(last.view.log, 'current', 3).every((e) => e.turn === 3)).toBe(true);
  });
});

describe('highlights and clicks come from props', () => {
  it('CR 117.1: cards with legal actions are highlighted and clickable; others are not', () => {
    const c = at(1, 'main1', ALICE);
    const legal = legalActions(c.state, ALICE);
    const { playable } = playableObjects(legal);
    expect(playable.size).toBeGreaterThan(0);
    const onObjectClick = vi.fn();
    const { container } = render(<GameBoard view={c.view} legalActions={legal} interaction={{ onObjectClick }} />);
    const [first] = [...playable];
    const el = slot(container, first!);
    expect(el.getAttribute('data-highlight')).toBe('playable');
    fireEvent.click(el);
    expect(onObjectClick).toHaveBeenCalledWith(first);
    const notPlayable = c.view.zones.hand[ALICE]!.find((id) => !playable.has(id));
    if (notPlayable) expect(slot(container, notPlayable).getAttribute('role')).toBe('group');
  });

  it('selectable objects and players (a decision\'s choices) are highlighted and report clicks; selected ones are pressed', () => {
    const c = at(5, 'main1', ALICE);
    const [bobBear] = named(c.view, BOB, 'Test Bear');
    const onObjectClick = vi.fn();
    const onPlayerClick = vi.fn();
    const { container } = render(
      <GameBoard view={c.view} interaction={{ selectable: [bobBear!, BOB], selected: [ALICE], onObjectClick, onPlayerClick }} />,
    );
    expect(slot(container, bobBear!).getAttribute('data-highlight')).toBe('selectable');
    fireEvent.click(slot(container, bobBear!));
    expect(onObjectClick).toHaveBeenCalledWith(bobBear);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Bob' }));
    expect(onPlayerClick).toHaveBeenCalledWith(BOB);
    expect(screen.getByRole('button', { name: 'Choose Alice' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('stops (Arena-style auto-pass) through setStops', () => {
  it('toggleStop keeps the steps in turn order', () => {
    const s = toggleStop({ ownTurn: ['main2'], opponentTurn: [], fullControl: false }, 'ownTurn', 'upkeep');
    expect(s.ownTurn).toEqual(['upkeep', 'main2']);
    expect(toggleStop(s, 'ownTurn', 'main2').ownTurn).toEqual(['upkeep']);
  });

  it('clicking a stop sends a setStops action the engine accepts', () => {
    const c = at(1, 'main1', ALICE);
    const v = editable(c.view);
    v.players.find((p) => p.id === ALICE)!.stops = { ownTurn: ['main1', 'main2'], opponentTurn: ['end'], fullControl: false };
    const onSetStops = vi.fn();
    render(<GameBoard view={v} interaction={{ onSetStops }} />);
    expect(screen.getByRole('button', { name: 'Stop at Main 1 (my turn)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Stop at Untap (my turn)' })).toBeNull(); // CR 502.4
    fireEvent.click(screen.getByRole('button', { name: "Stop at Attackers (opponent's turn)" }));
    const action = onSetStops.mock.calls[0]![0];
    expect(action).toEqual({ type: 'setStops', player: ALICE, stops: { ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'], fullControl: false } });
    expect(applyAction(c.state, action).error).toBeUndefined();
  });

  it('with full control every stop is on and read-only; the checkbox turns it off', () => {
    const c = at(1, 'main1', ALICE);
    const onSetStops = vi.fn();
    render(<GameBoard view={c.view} interaction={{ onSetStops }} />);
    const t = screen.getByRole('button', { name: 'Stop at Upkeep (my turn)' }) as HTMLButtonElement;
    expect(t.disabled).toBe(true);
    expect(t.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Full control' }));
    expect(onSetStops.mock.calls[0]![0].stops.fullControl).toBe(false);
  });
});

describe('zones and mana', () => {
  it('CR 404: the graveyard viewer lists the cards face up, top first, and closes with Escape', () => {
    const c = game.captured.filter((x) => x.view.zones.graveyard[BOB]!.length > 0 && x.view.viewer === ALICE).pop()!;
    render(<GameBoard view={c.view} />);
    const gy = c.view.zones.graveyard[BOB]!;
    fireEvent.click(screen.getByRole('button', { name: `Bob's graveyard: ${cardCount(gy.length)}` }));
    const dialog = screen.getByRole('dialog', { name: "Bob's graveyard" });
    const slots = [...dialog.querySelectorAll('.board-card')];
    expect(slots.map((s) => s.getAttribute('data-object-id'))).toEqual([...gy].reverse());
    expect(slots.every((s) => s.getAttribute('data-face') === 'up')).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('CR 106.4: the mana pool shows each type with its amount', () => {
    const c = at(1, 'main1', ALICE);
    const v = editable(c.view);
    v.players.find((p) => p.id === ALICE)!.manaPool = [{ type: 'G' }, { type: 'G' }, { type: 'C' }];
    render(<GameBoard view={v} />);
    const pool = screen.getByRole('list', { name: "Alice's mana pool" });
    expect(within(pool).getByLabelText('2 {G}')).toBeTruthy();
    expect(within(pool).getByLabelText('1 {C}')).toBeTruthy();
  });

  it('CR 119, 122.1f: life and poison are shown; the prompt slot renders below the board', () => {
    const c = at(1, 'main1', ALICE);
    const v = editable(c.view);
    v.players.find((p) => p.id === BOB)!.poison = 3;
    render(<GameBoard view={v} prompt={<button type="button">Pass</button>} />);
    expect(screen.getAllByLabelText('Life 20')).toHaveLength(2);
    expect(screen.getByLabelText('Poison 3')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Prompt' })).getByRole('button', { name: 'Pass' })).toBeTruthy();
  });

  it('MX4, CR 309.4, 309.7: the room the venture marker is on and the number of completed dungeons are shown', () => {
    const c = at(1, 'main1', ALICE);
    const v = editable(c.view);
    const d = DUNGEONS.find((x) => x.name === 'Lost Mine of Phandelver')!;
    v.defs['dungeon:Lost Mine of Phandelver'] = dungeonDef(d) as never;
    v.objects['dng'] = { ...structuredClone(v.objects[v.zones.battlefield[0] ?? Object.keys(v.objects)[0]!]!), id: 'dng', defId: 'dungeon:Lost Mine of Phandelver', owner: ALICE, controller: ALICE, zone: 'command', ventureRoom: 2 } as never;
    v.zones.command.push('dng');
    v.designations.completedDungeons = { [ALICE]: ['Tomb of Annihilation'] };
    const { container } = render(<GameBoard view={v} />);
    const panel = container.querySelector<HTMLElement>(`.player-panel[data-player-id="${ALICE}"]`)!;
    expect(within(panel).getByText('Mine Tunnels')).toBeTruthy();
    expect(within(panel).getByText('Dungeons 1')).toBeTruthy();
  });
});
