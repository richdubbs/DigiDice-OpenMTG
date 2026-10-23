/**
 * Decisions while resolving: naming (CR 607.2d, 608.2d), the order of replacement and prevention effects (CR 616.1), and manual resolution with the
 * manual-adjustment panel (ARCHITECTURE "Manual resolution").
 */
import { act as reactAct, fireEvent, screen } from '@testing-library/react';
import { compileCard, viewFor, type AbilityDef, type GameState, type OracleCard, type ReplacementDef } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../src/api/http';
import { filterNames, serverCardNameSearch } from '../../src/prompts/ChooseNamePrompt';
import { buildOp, describeOp, emptyDraft, pickableObjects, staleReference } from '../../src/prompts/manualOps';
import { stubFetch } from '../helpers';
import { castAuto, click, clickRole, find, findAll, lifeOf, passBoth, pendingKind, press, renderPrompt, scenario, tweak } from './harness';

async function change(label: string, value: string): Promise<void> {
  await reactAct(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

/** A synthetic artifact whose only ability is "As this artifact enters, choose <what>." (hand-built JSON, the shape the compiler produces for creature types). */
function namer(name: string, what: 'cardName' | 'creatureType'): ReturnType<typeof compileCard> {
  const ability: AbilityDef = {
    kind: 'static', text: `As this artifact enters, choose a ${what === 'cardName' ? 'card name' : 'creature type'}.`,
    effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', choose: [{ what, link: 'n' }] } } as ReplacementDef],
  } as AbilityDef;
  const card = { name, layout: 'normal', mana_cost: '{1}', type_line: 'Artifact', oracle_text: ability.text } as OracleCard;
  return compileCard(card, () => ({ abilities: [ability], unsupported: [] }));
}

function toName(what: 'cardName' | 'creatureType'): GameState {
  const def = namer('Test Namer', what);
  let s = scenario(['Plains'], { p1: { hand: ['Test Namer'], battlefield: ['Plains'] }, defs: [def] });
  s = passBoth(castAuto(s, 'Test Namer'));
  expect(s.pending).toMatchObject({ kind: 'chooseName', what });
  return s;
}

describe('chooseName (CR 607.2d, 608.2d)', () => {
  it('a creature type from the closed list, filtered as the player types', async () => {
    const { conn } = renderPrompt(toName('creatureType'));
    await change('Search names', 'gobl');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('Goblin');
    await clickRole('option', 'Goblin');
    await click('Name "Goblin"');
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseName', name: 'Goblin' });
    expect(conn.errors).toEqual([]);
    const namerId = find(conn.state, 'Test Namer', 'battlefield');
    expect(conn.state.objects[namerId]!.links).toEqual({ n: { values: ['Goblin'] } });
  });

  it('a card name is searched in the card index (the server) and only a found name can be chosen', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.fn(async (q: string) => ({ names: q.toLowerCase().startsWith('light') ? ['Lightning Bolt', 'Lightning Helix'] : [], complete: true }));
      const { conn } = renderPrompt(toName('cardName'), { searchCardNames: search });
      expect((screen.getByRole('button', { name: 'Choose a name' }) as HTMLButtonElement).disabled).toBe(true);
      await change('Search names', 'light');
      await reactAct(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(search).toHaveBeenCalledWith('light', expect.any(AbortSignal));
      await clickRole('option', 'Lightning Helix');
      await click('Name "Lightning Helix"');
      expect(conn.lastAnswer()).toEqual({ kind: 'chooseName', name: 'Lightning Helix' });
      expect(conn.errors).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  /** Type into the card-name search and let the debounced search settle. */
  async function search(text: string): Promise<void> {
    await change('Search names', text);
    await reactAct(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }

  it("CR 201.4: when the card search is not available, the server's own message is shown and the names of the cards in this game can still be chosen", async () => {
    vi.useFakeTimers();
    try {
      const failing = vi.fn(async () => {
        throw new ApiRequestError(501, { error: 'Card search is not implemented yet.' } as never, 'Card search is not implemented yet.');
      });
      const { conn } = renderPrompt(toName('cardName'), { searchCardNames: failing });
      await search('pla');
      expect(screen.getByRole('status').textContent).toBe('The card search is not available: Card search is not implemented yet. (HTTP 501) Names of the cards in this game:');
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Plains']);
      await clickRole('option', 'Plains');
      await click('Name "Plains"');
      expect(conn.lastAnswer()).toEqual({ kind: 'chooseName', name: 'Plains' });
      expect(conn.errors).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('CR 201.4: when the server cannot be reached, a typed name can be used after an explicit warning that it is not checked', async () => {
    vi.useFakeTimers();
    try {
      const unreachable = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      const { conn } = renderPrompt(toName('cardName'), { searchCardNames: unreachable });
      await search('Black Lotus');
      expect(screen.getByRole('status').textContent).toMatch(/^The OpenMTG server could not be reached\./);
      expect(screen.queryAllByRole('option')).toEqual([]);
      await click('Use the typed name');
      expect(screen.getByText(/is not checked against the Oracle card list \(CR 201\.4\)/)).toBeTruthy();
      await click('Name "Black Lotus"');
      expect(conn.lastAnswer()).toEqual({ kind: 'chooseName', name: 'Black Lotus' });
      expect(conn.errors).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('CR 201.4b, 201.4f, 709.4a, 712.19: the server search offers the name of each face (never "A // B"), only names that match, prefix matches first', async () => {
    const face = (name: string) => ({ name, manaCost: null, typeLine: '', oracleText: '', colors: [] });
    const card = (name: string, layout: string, faces: string[]) => ({ name, layout, faces: faces.map(face) });
    const fetchMock = stubFetch(() => ({
      status: 200,
      body: {
        cards: [
          card('Fire // Ice', 'split', ['Fire', 'Ice']),
          card('Delver of Secrets // Insectile Aberration', 'transform', ['Delver of Secrets', 'Insectile Aberration']),
          card('Bonecrusher Giant // Stomp', 'adventure', ['Bonecrusher Giant', 'Stomp']),
          card('Lightning Bolt', 'normal', ['Lightning Bolt']),
          card('Shock', 'normal', ['Shock']), // matched by its rules text only
        ],
        page: 1, pageSize: 5, total: 9,
      },
    }));
    try {
      const r = await serverCardNameSearch('i', new AbortController().signal);
      expect(r.names).toEqual(['Ice', 'Insectile Aberration', 'Fire', 'Bonecrusher Giant', 'Lightning Bolt']);
      expect(r.complete).toBe(false); // 9 cards match, 5 came back
      expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/cards/search?q=i');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('filterNames: prefix matches first, then other matches, ignoring case and accents', () => {
    expect(filterNames(['Elf', 'Werewolf', 'Wolf', 'Éowyn'], 'wolf')).toEqual(['Wolf', 'Werewolf']);
    expect(filterNames(['Elf', 'Éowyn'], 'eo')).toEqual(['Éowyn']);
    expect(filterNames(['A', 'B'], '')).toEqual(['A', 'B']);
  });
});

describe('chooseReplacement (CR 616.1)', () => {
  it('two prevention shields on the same damage: the affected creature\'s controller picks which applies first', async () => {
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
    expect(s.pending).toMatchObject({ kind: 'chooseReplacement', player: 'p1' });
    const options = (s.pending as { options: { id: string; label: string }[] }).options;
    const big = options.find((o) => o.id.endsWith('e91'))!;
    const { conn } = renderPrompt(s);
    expect(screen.getAllByText(/CR 616.1/).length).toBeGreaterThan(0);
    await click(big.label);
    expect(conn.lastAnswer()).toEqual({ kind: 'chooseReplacement', id: big.id });
    expect(conn.errors).toEqual([]);
    expect(conn.state.objects[bears]!.damage).toBe(0); // the big shield prevented all 3
  });
});

describe('manualResolve: the manual-adjustment panel', () => {
  /** Lightning Bolt kept as manual text (the engine test convention), cast at Bob: its resolution asks for manual adjustments. */
  function manualBolt(): GameState {
    let s = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { manual: ['Lightning Bolt'], p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = passBoth(castAuto(s, 'Lightning Bolt'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', sourceName: 'Lightning Bolt' });
    return s;
  }

  it('shows the card text and applies "deal 3 damage to Bob" by hand', async () => {
    const { conn } = renderPrompt(manualBolt());
    expect(document.querySelector('.prompt-manual-text')!.textContent).toMatch(/Lightning Bolt deals 3 damage to any target/);
    await change('Operation', 'damage');
    await change('Damage to', 'p2');
    await change('Amount', '3');
    await click('Add adjustment');
    expect(screen.getByRole('list', { name: 'Adjustments to apply' }).textContent).toContain('Deal 3 damage to Bob');
    await click(/^Done: apply 1 adjustment/);
    expect(conn.lastAnswer()).toEqual({ kind: 'manualResolve', ops: [{ op: 'damage', target: 'p2', amount: 3 }] });
    expect(conn.errors).toEqual([]);
    expect(lifeOf(conn.state, 'p2')).toBe(17);
    expect(pendingKind(conn)).toBe('priority');
  });

  it('a card clicked on the board fills the panel; moving it to the graveyard; the resolving spell itself is not offered (CR 608.2n)', async () => {
    const s = manualBolt();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const bolt = s.zones.stack[0]!;
    const { conn } = renderPrompt(s);
    expect(screen.queryByRole('button', { name: `Board ${bolt}` })).toBeNull();
    await click(`Board ${bears}`);
    expect((screen.getByLabelText('Card') as HTMLSelectElement).value).toBe(bears);
    await click('Add adjustment');
    await change('Operation', 'note');
    await click('Add adjustment');
    expect(screen.getByRole('status').textContent).toBe('Write the note.');
    await click('Done: apply 1 adjustment');
    expect(conn.lastAnswer()).toEqual({ kind: 'manualResolve', ops: [{ op: 'move', object: bears, to: 'graveyard' }] });
    expect(conn.errors).toEqual([]);
    expect(conn.state.zones.graveyard.p2).toHaveLength(1);
  });

  it('"Done (no changes)" asks to confirm before resolving without adjustments; an adjustment can be removed before confirming', async () => {
    const { conn } = renderPrompt(manualBolt());
    await change('Operation', 'life');
    await change('Life change', '-3');
    await click('Add adjustment');
    await click(/^Remove/);
    await click('Done (no changes)');
    expect(conn.sent).toEqual([]);
    expect(screen.getByText(/Resolve with no changes\? Nothing of this effect will happen/)).toBeTruthy();
    await click('Back');
    expect(conn.sent).toEqual([]);
    await click('Done (no changes)');
    await click('Resolve with no changes');
    expect(conn.lastAnswer()).toEqual({ kind: 'manualResolve', ops: [] });
    expect(lifeOf(conn.state, 'p2')).toBe(20);
  });

  it('never silently skipped: Space does not confirm a manual resolution with no adjustments; with one it applies it', async () => {
    const { conn } = renderPrompt(manualBolt());
    await press(' ');
    await press(' ');
    expect(conn.sent).toEqual([]);
    expect(pendingKind(conn)).toBe('manualResolve');
    await change('Operation', 'damage');
    await change('Damage to', 'p2');
    await change('Amount', '3');
    await click('Add adjustment');
    await press(' '); // the focus is still on "Add adjustment" (a mouse click): Space is the prompt's OK

    expect(conn.lastAnswer()).toEqual({ kind: 'manualResolve', ops: [{ op: 'damage', target: 'p2', amount: 3 }] });
  });

  it('CR 400.7: an adjustment that names a card moved by an earlier adjustment of the same answer is refused, with the reason', async () => {
    const s = manualBolt();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    renderPrompt(s);
    await change('Card', bears);
    await change('To zone', 'hand');
    await click('Add adjustment');
    await change('Operation', 'tap');
    await change('Card', bears);
    await click('Add adjustment');
    expect(screen.getByRole('status').textContent).toMatch(/moved by adjustment 1.*new object \(CR 400\.7\)/);
    expect(screen.getByRole('list', { name: 'Adjustments to apply' }).querySelectorAll('li')).toHaveLength(1);
  });
});

describe('manual operations', () => {
  const view = { viewer: 'p1', players: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }], objects: {}, lki: {}, defs: {}, zones: { battlefield: [], stack: [], exile: [], graveyard: {}, hand: {}, library: { p1: ['o1', 'o2', 'o3'] } } } as never;

  it('builds exactly the engine operations, and explains what is missing', () => {
    const d = emptyDraft(view, 'counters');
    expect(buildOp({ ...d, target: 'o7', counter: '+1/+1', amount: '-2' })).toEqual({ op: { op: 'counters', object: 'o7', counter: '+1/+1', delta: -2 } });
    expect(buildOp({ ...d, counter: 'poison', amount: '1' })).toEqual({ error: 'Choose the object or player.' });
    expect(buildOp({ ...emptyDraft(view, 'draw'), amount: '2' })).toEqual({ op: { op: 'draw', player: 'p1', count: 2 } });
    expect(buildOp({ ...emptyDraft(view, 'mana'), mana: 'rr g' })).toEqual({ op: { op: 'mana', player: 'p1', types: ['R', 'R', 'G'] } });
    expect(buildOp({ ...emptyDraft(view, 'tap'), object: 'o5', tapped: false })).toEqual({ op: { op: 'tap', object: 'o5', tapped: false } });
    expect(buildOp({ ...emptyDraft(view, 'attach'), object: 'o5' })).toEqual({ op: { op: 'attach', object: 'o5', to: null } });
    expect(buildOp({ ...emptyDraft(view, 'move'), object: 'o5', zone: 'hand', attachTo: 'o6' })).toEqual({ op: { op: 'move', object: 'o5', to: 'hand' } });
    expect(buildOp({ ...emptyDraft(view, 'token'), name: 'Soldier', typeLine: 'Token Creature — Soldier', colors: 'w' })).toEqual({
      op: { op: 'token', player: 'p1', name: 'Soldier', typeLine: 'Token Creature — Soldier', power: '1', toughness: '1', colors: ['W'] },
    });
    expect('error' in buildOp({ ...emptyDraft(view, 'token'), name: 'Clue', typeLine: 'Token' })).toBe(true);
    expect(buildOp({ ...emptyDraft(view, 'life'), amount: 'x' })).toMatchObject({ error: expect.stringContaining('CR 119') });
  });

  it('describes operations and offers the top and bottom card of a library by position only', () => {
    expect(describeOp(view, { op: 'life', player: 'p2', delta: -3 })).toBe('Bob loses 3 life');
    expect(describeOp(view, { op: 'mana', player: 'p1', types: ['R', 'G'] })).toBe('Alice adds {R}{G}');
    expect(pickableObjects(view)).toEqual([
      { id: 'o1', label: "Top card of Alice's library" },
      { id: 'o3', label: "Bottom card of Alice's library" },
    ]);
  });

  it('two objects with the same label are numbered in the object pickers', () => {
    const s = scenario(['Forest'], { p1: { battlefield: ['Forest', 'Forest'] } });
    const [f1, f2] = findAll(s, 'Forest', 'battlefield', 'p1');
    const picks = pickableObjects(viewFor(s, 'p1')).filter((o) => o.id === f1 || o.id === f2);
    expect(picks.map((o) => o.label)).toEqual(['Forest #1', 'Forest #2']);
  });

  it('CR 400.7: staleReference names the earlier move or draw that made an object new', () => {
    const v = viewFor(scenario(['Forest'], { p1: { battlefield: ['Forest'] } }), 'p1');
    const forest = v.zones.battlefield[0]!;
    const top = v.zones.library.p1![0]!;
    expect(staleReference(v, [{ op: 'move', object: forest, to: 'hand' }], { op: 'tap', object: forest, tapped: true })).toMatch(/adjustment 1/);
    expect(staleReference(v, [{ op: 'draw', player: 'p1', count: 1 }], { op: 'move', object: top, to: 'graveyard' })).toMatch(/adjustment 1/);
    expect(staleReference(v, [{ op: 'life', player: 'p1', delta: 1 }], { op: 'tap', object: forest, tapped: true })).toBeNull();
  });
});
