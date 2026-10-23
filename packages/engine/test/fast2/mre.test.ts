/**
 * FAST2 MRE (milestone 8, C6 gaps 6 and 7, and default stops):
 *  - manual resolution in steps: a manualResolve answer with `continue: true` is applied and the decision is asked again with the new game, until an answer
 *    without it (Brainstorm: draw three, see them, put two back; CR 608.2c). Deterministic under the re-execution model; hidden cards stay hidden (CR 400.2);
 *  - the by-hand tools: `manualTrigger` puts a manual triggered ability on the stack (CR 603.2, 603.3) and it resolves through the stepwise decision;
 *    `manualStatic` applies a manual static ability by hand without the stack (CR 604.1); both logged publicly with the card name and the text;
 *  - default stops: both players stop in the declare blockers step (CR 509.2); auto-pass still skips a player with nothing to do.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, DEFAULT_STOPS, MANUAL_MAX_STEPS, viewFor, type CardDef, type DecisionAnswer, type GameState, type ManualOp } from '../../src/index';
import { Game } from '../../src/core/game';
import { hasPriorityActions, hasPublicPriorityActions } from '../../src/core/legal';
import { act, answer, castAuto, find, legal, life, pass, passBoth, reject, scenario } from '../m3/scenario';
import { synth } from '../m3/synthetic';

const BRAINSTORM_TEXT = 'Draw three cards, then put two cards from your hand on top of your library in any order.';
const brainstorm: CardDef = synth({ name: 'Test Brainstorm', cost: '{W}', type: 'Instant', abilities: [{ kind: 'manual', text: BRAINSTORM_TEXT, reason: 'test: manual spell', shape: 'spell' }] });
const DRAIN_TEXT = 'When Test Drain Outlaw enters, each opponent loses 2 life.';
const drain: CardDef = synth({ name: 'Test Drain Outlaw', cost: '{1}', type: 'Creature — Human', pt: ['2', '2'], abilities: [{ kind: 'manual', text: DRAIN_TEXT, reason: 'test: no template for the trigger', shape: 'triggered' }] });
const ANTHEM_TEXT = 'Other creatures you control get +1/+1 as long as you control a Plains.';
const anthem: CardDef = synth({ name: 'Test Odd Anthem', cost: '{2}', type: 'Enchantment', abilities: [{ kind: 'manual', text: ANTHEM_TEXT, reason: 'test: no template for the static ability', shape: 'static' }] });

const LIBRARY = ['Grizzly Bears', 'Shock', 'Forest'];

/** p1 holds Test Brainstorm and a Mountain, with Plains to cast it; the top of p1's library is Grizzly Bears, Shock, Forest. */
function brainstormBoard(): GameState {
  return scenario([...LIBRARY, 'Mountain'], { defs: [brainstorm], p1: { hand: ['Test Brainstorm', 'Mountain'], battlefield: ['Plains'], library: LIBRARY } });
}

const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const hand = (s: GameState, p = 'p1'): string[] => s.zones.hand[p]!;
const publicLog = (s: GameState, viewer: string | null, from: number): string[] => viewFor(s, viewer).log.slice(from).map((e) => e.text);

describe('manual resolution in steps (C6 gap 6, CR 608.2c)', () => {
  it('Brainstorm: draw three with "Apply now", see them, then put two back; the decision is re-issued with the new game until confirmed', () => {
    let s = passBoth(castAuto(brainstormBoard(), 'Test Brainstorm'));
    const first = s.pending!;
    expect(first).toMatchObject({ kind: 'manualResolve', player: 'p1', sourceName: 'Test Brainstorm', text: BRAINSTORM_TEXT });
    expect(first).not.toHaveProperty('step');
    const before = [...hand(s)];
    expect(names(s, before)).toEqual(['Mountain']);
    const logFrom = s.log.length;

    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'draw', player: 'p1', count: 3 }], continue: true });
    const second = s.pending!;
    expect(second).toMatchObject({ kind: 'manualResolve', player: 'p1', sourceName: 'Test Brainstorm', step: 1, resolvingId: first.kind === 'manualResolve' ? first.resolvingId : '' });
    expect(second.id).not.toBe(first.id);
    // The game that comes with the re-issued decision already shows the drawn cards (the spell is still resolving on the stack).
    expect(names(s, hand(s)).sort()).toEqual(['Forest', 'Grizzly Bears', 'Mountain', 'Shock']);
    expect(s.zones.stack).toHaveLength(1);
    // The resolving player's view shows them; the opponent sees three hidden cards and a log that names none of them (CR 400.2).
    expect(viewFor(s, 'p1').zones.hand['p1']!.map((id) => viewFor(s, 'p1').objects[id]!.defId).sort()).toEqual(['Forest', 'Grizzly Bears', 'Mountain', 'Shock']);
    const opp = viewFor(s, 'p2');
    expect(opp.zones.hand['p1']!.every((id) => opp.objects[id]!.defId === '__hidden__')).toBe(true);
    for (const line of publicLog(s, 'p2', logFrom)) expect(line).not.toMatch(/Grizzly|Shock|Forest/);

    const back = hand(s).filter((id) => ['Grizzly Bears', 'Shock'].includes(s.defs[s.objects[id]!.defId]!.name));
    const ops: ManualOp[] = [{ op: 'move', object: back[0]!, to: 'libraryTop' }, { op: 'move', object: back[1]!, to: 'libraryTop' }];
    const done = answer(s, { kind: 'manualResolve', ops });
    expect(done.pending?.kind).toBe('priority');
    expect(done.zones.stack).toEqual([]);
    expect(names(done, hand(done)).sort()).toEqual(['Forest', 'Mountain']);
    expect(names(done, done.zones.library['p1']!.slice(0, 2)).sort()).toEqual(['Grizzly Bears', 'Shock']);
    expect(names(done, done.zones.graveyard['p1']!)).toEqual(['Test Brainstorm']);
    // The put-back cards are "a card" to the opponent and named for their owner.
    const oppLines = publicLog(done, 'p2', logFrom);
    expect(oppLines.filter((l) => /moves a card to libraryTop by hand/.test(l))).toHaveLength(2);
    for (const line of oppLines) expect(line).not.toMatch(/Grizzly|Shock|Forest/);
    expect(publicLog(done, 'p1', logFrom).some((l) => /Grizzly Bears to libraryTop/.test(l))).toBe(true);
  });

  it('is deterministic: the same answers on the same state give the same game (re-execution model)', () => {
    const s0 = passBoth(castAuto(brainstormBoard(), 'Test Brainstorm'));
    const step = (s: GameState): GameState => answer(s, { kind: 'manualResolve', ops: [{ op: 'draw', player: 'p1', count: 3 }], continue: true });
    const a = step(s0);
    const b = step(s0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const finish = (s: GameState): GameState => answer(s, { kind: 'manualResolve', ops: [{ op: 'move', object: hand(s)[0]!, to: 'libraryTop' }, { op: 'note', text: 'done' }] });
    expect(JSON.stringify(finish(a))).toBe(JSON.stringify(finish(b)));
  });

  it('an answer without the flag (or with continue: false) resolves at once, as before', () => {
    const s0 = passBoth(castAuto(brainstormBoard(), 'Test Brainstorm'));
    for (const extra of [{}, { continue: false }]) {
      const s = answer(s0, { kind: 'manualResolve', ops: [{ op: 'draw', player: 'p1', count: 3 }], ...extra } as DecisionAnswer);
      expect(s.pending?.kind).toBe('priority');
      expect(s.zones.stack).toEqual([]);
      expect(hand(s)).toHaveLength(4);
    }
  });

  it('refuses "Apply now" with nothing to apply, a continue that is not a boolean, and more than MANUAL_MAX_STEPS prompts', () => {
    let s = passBoth(castAuto(brainstormBoard(), 'Test Brainstorm'));
    const say = (a: unknown) => ({ type: 'answer' as const, player: 'p1', decisionId: s.pending!.id, answer: a as DecisionAnswer });
    expect(reject(s, say({ kind: 'manualResolve', ops: [], continue: true })).message).toMatch(/at least one adjustment/);
    expect(reject(s, say({ kind: 'manualResolve', ops: [], continue: 'yes' })).message).toMatch(/true or false/);
    for (let i = 0; i < MANUAL_MAX_STEPS - 1; i++) s = answer(s, { kind: 'manualResolve', ops: [{ op: 'note', text: `step ${i}` }], continue: true });
    expect(s.pending).toMatchObject({ kind: 'manualResolve', step: MANUAL_MAX_STEPS - 1 });
    expect(reject(s, say({ kind: 'manualResolve', ops: [{ op: 'note', text: 'more' }], continue: true })).message).toMatch(/50 steps/);
    s = answer(s, { kind: 'manualResolve', ops: [] });
    expect(s.zones.stack).toEqual([]);
  });

  it('a manual mana ability resolved in steps adds the player\'s own mana once, at the end, as the ability\'s (CR 605.3b)', () => {
    const painland = synth({ name: 'Test Odd Land', type: 'Land', abilities: [{ kind: 'manual', text: '{T}: Add {R}. Test Odd Land deals 1 damage to you.', reason: 'test', shape: 'activated', mana: true, cost: { tap: true } }] });
    let s = scenario([], { defs: [painland], p1: { battlefield: ['Test Odd Land'] } });
    const tool = legal(s, 'p1', 'activate').find((a) => a.label.includes('Test Odd Land'))!;
    s = act(s, tool.action);
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'damage', target: 'p1', amount: 1 }], continue: true });
    expect(life(s, 'p1')).toBe(19);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', step: 1, cancellable: false });
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'mana', player: 'p1', types: ['R'] }] });
    expect(s.players[0]!.manaPool.map((m) => m.type)).toEqual(['R']);
    expect(s.pending?.kind).toBe('priority');
  });

  it('a step applied with "Apply now" can no longer be cancelled: a drawn card (or a shuffle) is hidden information already shown (CR 733.1, CR 400.2)', () => {
    const painland = synth({ name: 'Test Odd Land', type: 'Land', abilities: [{ kind: 'manual', text: '{T}: Add {R}. Test Odd Land deals 1 damage to you.', reason: 'test', shape: 'activated', mana: true, cost: { tap: true } }] });
    const s0 = scenario([...LIBRARY], { defs: [anthem, painland], p1: { battlefield: ['Test Odd Anthem', 'Test Odd Land'], library: LIBRARY } });
    const library = [...s0.zones.library['p1']!];
    const tools = [legal(s0, 'p1', 'manualStatic')[0]!, legal(s0, 'p1', 'activate').find((a) => a.label.includes('Test Odd Land'))!];
    for (const tool of tools) {
      let s = act(s0, tool.action);
      expect(s.pending).toMatchObject({ kind: 'manualResolve', cancellable: true }); // nothing has happened yet
      s = answer(s, { kind: 'manualResolve', ops: [{ op: 'draw', player: 'p1', count: 3 }], continue: true });
      expect(names(s, viewFor(s, 'p1').zones.hand['p1']!).sort()).toEqual(['Forest', 'Grizzly Bears', 'Shock']);
      expect(s.pending).toMatchObject({ kind: 'manualResolve', step: 1, cancellable: false });
      expect(reject(s, { type: 'cancel', player: 'p1' }).message).toMatch(/nothing to cancel/i);
      // The same holds after a shuffle: its result is not something the player may see and then take back.
      let t = act(s0, tool.action);
      t = answer(t, { kind: 'manualResolve', ops: [{ op: 'shuffle', player: 'p1' }], continue: true });
      expect(t.pending).toMatchObject({ kind: 'manualResolve', step: 1, cancellable: false });
      expect(reject(t, { type: 'cancel', player: 'p1' }).message).toMatch(/nothing to cancel/i);
      // Confirming still works, and the cards stay drawn.
      s = answer(s, { kind: 'manualResolve', ops: [] });
      expect(s.pending?.kind).toBe('priority');
      expect(s.zones.library['p1']).toHaveLength(library.length - 3);
      expect(names(s, hand(s)).sort()).toEqual(['Forest', 'Grizzly Bears', 'Shock']);
    }
  });
});

describe('the by-hand tools for manual triggered and static abilities (C6 gap 7)', () => {
  function board(): GameState {
    return scenario(['Grizzly Bears'], { defs: [drain, anthem], p1: { battlefield: ['Test Drain Outlaw', 'Test Odd Anthem', 'Grizzly Bears'], hand: ['Grizzly Bears'] } });
  }

  it('legalActions lists them for the controller only, and only when such an ability exists', () => {
    const s = board();
    const trig = legal(s, 'p1', 'manualTrigger');
    const stat = legal(s, 'p1', 'manualStatic');
    expect(trig).toHaveLength(1);
    expect(trig[0]).toMatchObject({ isMana: false, object: find(s, 'Test Drain Outlaw', 'battlefield'), action: { type: 'manualTrigger', player: 'p1', source: find(s, 'Test Drain Outlaw', 'battlefield') } });
    expect(trig[0]!.label).toContain(DRAIN_TEXT);
    expect(stat).toHaveLength(1);
    expect(stat[0]!.label).toContain(ANTHEM_TEXT);
    // Not the opponent's (CR 603.3a), and not for a board without manual triggered or static abilities.
    const p2 = act(s, { type: 'pass', player: 'p1' });
    expect(legal(p2, 'p2').filter((a) => a.kind === 'manualTrigger' || a.kind === 'manualStatic')).toEqual([]);
    const plain = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    expect(legal(plain, 'p1').filter((a) => a.kind === 'manualTrigger' || a.kind === 'manualStatic')).toEqual([]);
  });

  it('manualTrigger puts the ability on the stack, logged publicly with the name and text; it resolves through the stepwise manualResolve decision', () => {
    let s = board();
    const from = s.log.length;
    const tool = legal(s, 'p1', 'manualTrigger')[0]!;
    s = act(s, tool.action);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // CR 117.3c
    expect(s.zones.stack).toHaveLength(1);
    const ab = s.objects[s.zones.stack[0]!]!;
    expect(ab).toMatchObject({ kind: 'ability', controller: 'p1', stack: { kind: 'triggered', sourceName: 'Test Drain Outlaw' } });
    expect(publicLog(s, 'p2', from).some((l) => l.includes("Test Drain Outlaw's triggered ability on the stack by hand") && l.includes(DRAIN_TEXT))).toBe(true);
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1', sourceName: 'Test Drain Outlaw', resolvingId: ab.id });
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'life', player: 'p2', delta: -1 }], continue: true });
    expect(life(s, 'p2')).toBe(19);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', step: 1 });
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'life', player: 'p2', delta: -1 }] });
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.stack).toEqual([]);
    expect(s.pending?.kind).toBe('priority');
  });

  it('manualTrigger is refused for another player\'s permanent and for an ability that is not a manual triggered one', () => {
    const s = board();
    const tool = legal(s, 'p1', 'manualTrigger')[0]!.action as { source: string; ability: string };
    const p2 = act(s, { type: 'pass', player: 'p1' });
    expect(reject(p2, { type: 'manualTrigger', player: 'p2', source: tool.source, ability: tool.ability }).message).toMatch(/control/);
    expect(reject(s, { type: 'manualTrigger', player: 'p1', source: tool.source, ability: 'p:0:7' }).message).toMatch(/triggered ability/);
    const anthemId = find(s, 'Test Odd Anthem', 'battlefield');
    const staticKey = (legal(s, 'p1', 'manualStatic')[0]!.action as { ability: string }).ability;
    expect(reject(s, { type: 'manualTrigger', player: 'p1', source: anthemId, ability: staticKey }).message).toMatch(/triggered ability/);
  });

  it('manualStatic applies manual ops without the stack (CR 604.1), cancellable on its first prompt, logged publicly with the name and text', () => {
    const s0 = board();
    const from = s0.log.length;
    const tool = legal(s0, 'p1', 'manualStatic')[0]!;
    const anthemId = find(s0, 'Test Odd Anthem', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = act(s0, tool.action);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1', sourceName: 'Test Odd Anthem', text: ANTHEM_TEXT, subjectId: anthemId, cancellable: true });
    expect(s.zones.stack).toEqual([]);
    // Cancelling reverses everything (CR 733.1).
    const cancelled = act(s, { type: 'cancel', player: 'p1' });
    expect(cancelled.pending?.kind).toBe('priority');
    expect(cancelled.objects[bears]!.counters).toEqual({});
    // In steps, then confirmed: the player keeps priority (CR 117.3c).
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'note', text: 'Grizzly Bears gets +1/+1' }], continue: true });
    expect(s.pending).toMatchObject({ kind: 'manualResolve', step: 1 });
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'counters', object: bears, counter: '+1/+1', delta: 1 }] });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.objects[bears]!.counters).toEqual({ '+1/+1': 1 });
    const lines = publicLog(s, 'p2', from);
    expect(lines.some((l) => l.includes("applies Test Odd Anthem's static ability by hand") && l.includes(ANTHEM_TEXT))).toBe(true);
    expect(s.log.slice(from).find((l) => l.text.includes('static ability by hand'))).toMatchObject({ level: 'manual', rules: ['CR 604.1'] });
  });

  it('the tools never count as something to do for auto-pass', () => {
    const s = scenario([], { defs: [drain, anthem], p1: { battlefield: ['Test Drain Outlaw', 'Test Odd Anthem'] } });
    expect(hand(s)).toEqual([]);
    expect(legal(s, 'p1').some((a) => a.kind === 'manualTrigger')).toBe(true);
    expect(hasPriorityActions(new Game(s, []), 'p1')).toBe(false);
    expect(hasPublicPriorityActions(new Game(s, []), 'p1')).toBe(false);
  });

  it('a manual triggered ability of a card that left the battlefield is not offered (CR 113.6)', () => {
    const s = scenario([], { defs: [drain], p1: { graveyard: ['Test Drain Outlaw'] } });
    expect(legal(s, 'p1', 'manualTrigger')).toEqual([]);
  });
});

describe('default stops (C6 gap 3): both players stop in the declare blockers step (CR 509.2)', () => {
  it('DEFAULT_STOPS has declareBlockers in both lists', () => {
    expect(DEFAULT_STOPS.ownTurn).toEqual(['main1', 'declareBlockers', 'main2']);
    expect(DEFAULT_STOPS.opponentTurn).toEqual(['declareAttackers', 'declareBlockers', 'end']);
  });

  const stops = { ownTurn: [...DEFAULT_STOPS.ownTurn], opponentTurn: [...DEFAULT_STOPS.opponentTurn], fullControl: false };

  /**
   * p1 attacks p2 with Grizzly Bears; p2 blocks with nothing. Returns the state right after blockers are declared. Each player has an untapped Mountain, so a
   * Shock in hand can be cast (AP1: the engine's real legal actions decide whether a player at a stop is asked).
   */
  function afterBlocks(p1Hand: string[], p2Hand: string[]): GameState {
    let s = scenario(['Grizzly Bears', 'Shock', 'Mountain'], { stops, p1: { battlefield: ['Grizzly Bears', 'Mountain'], hand: p1Hand }, p2: { battlefield: ['Mountain'], hand: p2Hand } });
    let guard = 0;
    while (s.pending?.kind !== 'declareAttackers') {
      if (++guard > 20) throw new Error('no declare attackers');
      s = pass(s);
    }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Grizzly Bears', 'battlefield'), defender: 'p2' }] });
    while (s.pending?.kind === 'priority' && s.turn.step === 'declareAttackers') s = pass(s);
    // p2 has no creature: there is no declare blockers choice to make, the step goes straight to priority (CR 509.1, 509.2).
    return s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s;
  }

  it('the attacker, then the defender, get priority after blocks when they can cast something', () => {
    let s = afterBlocks(['Shock'], ['Shock']);
    expect(s.turn.step).toBe('declareBlockers');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    s = pass(s);
    expect(s.turn.step).toBe('declareBlockers');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
  });

  it('auto-pass still skips a player with nothing to do (only a mana ability; AP1: also one holding a Shock with no Mountain)', () => {
    const s = afterBlocks([], ['Shock']);
    expect(s.turn.step).toBe('declareBlockers');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    const none = afterBlocks([], []);
    expect(none.turn.step).not.toBe('declareBlockers');
    // AP1: the cards in a hand count only when they can be cast: a tapped Mountain leaves the Shock uncastable.
    let tapped = scenario(['Grizzly Bears', 'Shock', 'Mountain'], { stops, p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: [{ name: 'Mountain', tapped: true }], hand: ['Shock'] } });
    while (tapped.pending?.kind !== 'declareAttackers') tapped = pass(tapped);
    tapped = answer(tapped, { kind: 'declareAttackers', attacks: [{ attacker: find(tapped, 'Grizzly Bears', 'battlefield'), defender: 'p2' }] });
    expect(tapped.turn.step).not.toBe('declareBlockers');
  });
});

describe('a game against itself still moves on', () => {
  it('applyAction accepts every listed by-hand action', () => {
    const s = scenario([], { defs: [drain, anthem], p1: { battlefield: ['Test Drain Outlaw', 'Test Odd Anthem'] } });
    for (const a of legal(s, 'p1').filter((x) => x.kind === 'manualTrigger' || x.kind === 'manualStatic')) expect(applyAction(s, a.action).error).toBeUndefined();
  });
});
