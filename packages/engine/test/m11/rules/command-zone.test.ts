/**
 * M11-1: a commander returns to the command zone (CR 903.9): the replacement effect (CR 903.9b) and the state-based action (CR 903.9a, 704.6d), both through
 * the `commanderZone` decision of its owner (m11 design D4), and what other players may see of it (CR 400.2, 406.3a).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, viewFor, type DecisionAnswer, type GameEvent, type GameState, type ObjectId } from '../../../src/index';
import { act, answerUntilPriority, card, commanderScenario, find, forests, inCommand, legend, lifeOf, pass, tweak } from './helpers';

const TITANIA = legend('Test Titania', '{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const BOUNCE = card('Test Bounce', '{G}', 'Instant', "Return target creature to its owner's hand.");
const TUCK = card('Test Tuck', '{G}', 'Instant', "Put target creature on top of its owner's library.");
const KILL = card('Test Kill', '{G}', 'Instant', 'Destroy target creature.');
const EXILE = card('Test Exile', '{G}', 'Instant', 'Exile target creature.');
const MOURNER = card('Test Mourner', '{G}', 'Creature — Test', 'Whenever a creature dies, you gain 1 life.', ['1', '1']);

/** Alice's Titania on the battlefield and her instants in hand; Bob has a Mourner. */
function board(): GameState {
  return commanderScenario({
    p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [BOUNCE, TUCK, KILL, EXILE, MOURNER],
    p1: { battlefield: [...forests(3), 'Test Titania'], hand: ['Test Bounce', 'Test Tuck', 'Test Kill', 'Test Exile'] },
    p2: { battlefield: ['Test Mourner'] },
  });
}
const titaniaOn = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === TITANIA.id)!;
// The board puts Titania onto the battlefield directly: give that card the designation (a scenario object is a new card)
function withTitania(s: GameState): GameState {
  return tweak(s, (t) => {
    const id = titaniaOn(t);
    const rec = t.players[0]!.commanders![0]!;
    t.zones.command = t.zones.command.filter((x) => t.objects[x]!.defId !== TITANIA.id);
    for (const x of Object.keys(t.objects)) if (t.objects[x]!.defId === TITANIA.id && x !== id) delete t.objects[x];
    t.objects[id]!.cardId = rec.card;
  });
}
/** Alice casts an instant at Titania; Bob passes; it resolves. Returns at the first decision that is not a payment (or priority). */
function castAt(s: GameState, spell: string): GameState {
  const t = answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: titaniaOn(s) }] }]);
  return pass(pass(t));
}
const answerZone = (s: GameState, command: boolean): { state: GameState; events: GameEvent[] } => {
  const d = s.pending!;
  const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'commanderZone', command } as DecisionAnswer });
  if (r.error) throw new Error(r.error.message);
  return { state: r.state, events: r.events };
};
const titaniaZone = (s: GameState): string => Object.values(s.objects).find((o) => o.defId === TITANIA.id)!.zone;

describe('M11-1: CR 903.9b, a commander that would be put into its owner\'s hand or library', () => {
  it('CR 903.9b: bounced, its owner is asked (commanderZone, rule 903.9b, zone hand); yes puts it into the command zone instead, cause "commander"', () => {
    const s = castAt(withTitania(board()), 'Test Bounce');
    expect(s.pending).toMatchObject({ kind: 'commanderZone', player: 'p1', rule: '903.9b', zone: 'hand', card: s.players[0]!.commanders![0]!.card });
    const { state, events } = answerZone(s, true);
    expect(titaniaZone(state)).toBe('command');
    expect(state.zones.hand['p1']!.some((id) => state.objects[id]!.defId === TITANIA.id)).toBe(false);
    expect(events.find((e) => e.type === 'zoneChanged' && e.to === 'command')).toMatchObject({ from: 'battlefield', cause: 'commander' });
  });

  it('CR 903.9b: "may": declined, the commander goes to its owner\'s hand', () => {
    const { state } = answerZone(castAt(withTitania(board()), 'Test Bounce'), false);
    expect(titaniaZone(state)).toBe('hand');
    expect(state.pending?.kind).toBe('priority');
  });

  it('CR 903.9b: tucked into the library, the owner is asked (zone library); yes: the command zone', () => {
    const s = castAt(withTitania(board()), 'Test Tuck');
    expect(s.pending).toMatchObject({ kind: 'commanderZone', rule: '903.9b', zone: 'library' });
    expect(titaniaZone(answerZone(s, true).state)).toBe('command');
    expect(titaniaZone(answerZone(s, false).state)).toBe('library');
  });

  it('the decision is the owner\'s alone: other players see only that they wait (core/view.ts redacts it)', () => {
    const s = castAt(withTitania(board()), 'Test Bounce');
    const v = viewFor(s, 'p2');
    expect(v.pending?.kind).toBe('priority');
    expect(JSON.stringify(v.pending)).not.toMatch(/903\.9|Titania/);
  });
});

describe('M11-1: CR 903.9a, 704.6d, a commander put into a graveyard or exile', () => {
  it('CR 903.9a, 704.6d: destroyed, it dies first (CR 700.4: "dies" triggers see it), then the state-based action asks its owner (zone graveyard)', () => {
    const s = castAt(withTitania(board()), 'Test Kill');
    expect(s.pending).toMatchObject({ kind: 'commanderZone', player: 'p1', rule: '903.9a', zone: 'graveyard' });
    const { state } = answerZone(s, true);
    expect(titaniaZone(state)).toBe('command');
    const after = answerUntilPriority(state);
    // Bob's Mourner saw it die (its trigger is on the stack or resolved)
    const triggered = after.zones.stack.some((id) => after.objects[id]!.kind === 'ability') || lifeOf(after, 'p2') === 41;
    expect(triggered).toBe(true);
  });

  it('CR 903.9a: left in the graveyard, the flag is removed and its owner is not asked again', () => {
    const s = castAt(withTitania(board()), 'Test Kill');
    let t = answerZone(s, false).state;
    expect(titaniaZone(t)).toBe('graveyard');
    expect(Object.values(t.objects).find((o) => o.defId === TITANIA.id)!.commanderMoved).toBeUndefined();
    for (let i = 0; i < 4 && t.pending?.kind === 'priority'; i++) t = pass(t);
    expect(t.pending?.kind).not.toBe('commanderZone');
  });

  it('CR 903.9a: exiled, its owner is asked (zone exile)', () => {
    const s = castAt(withTitania(board()), 'Test Exile');
    expect(s.pending).toMatchObject({ kind: 'commanderZone', rule: '903.9a', zone: 'exile' });
    expect(titaniaZone(answerZone(s, true).state)).toBe('command');
  });

  it('CR 406.3a, 400.2: a commander exiled face down is asked about without telling the other player what it is; left there, nothing public names it', () => {
    let s = withTitania(board());
    s = tweak(s, (t) => {
      const id = titaniaOn(t);
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.objects[id] = { ...t.objects[id]!, zone: 'exile', faceDown: true, commanderMoved: true };
      t.zones.exile.push(id);
    });
    const logBefore = s.log.length;
    s = pass(s); // a player would receive priority: state-based actions are checked
    expect(s.pending).toMatchObject({ kind: 'commanderZone', player: 'p1', rule: '903.9a', zone: 'exile' });
    expect(viewFor(s, 'p2').pending?.kind).toBe('priority');
    const { state } = answerZone(s, false);
    const publicLines = viewFor(state, 'p2').log.slice(logBefore).map((l) => l.text).join('\n');
    expect(publicLines).not.toMatch(/Titania|command zone/);
    const id = state.zones.exile.find((x) => state.objects[x]!.defId === TITANIA.id)!;
    expect(viewFor(state, 'p2').objects[id]!.defId).not.toBe(TITANIA.id);
  });

  it('a token or a card that is not a commander is never asked about (CR 903.3)', () => {
    const s = commanderScenario({
      p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [KILL, MOURNER],
      p1: { battlefield: [...forests(1)], hand: ['Test Kill'] }, p2: { battlefield: ['Test Mourner'] },
    });
    const mourner = find(s, 'Test Mourner', 'battlefield');
    const t = answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: mourner }] }]);
    const after = pass(pass(t));
    expect(after.pending?.kind).not.toBe('commanderZone');
  });
});
