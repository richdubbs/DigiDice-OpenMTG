/**
 * CMDF item 5: a commander drawn and put into the command zone instead (CR 903.9b) WAS drawn.
 *
 * The ruling (no official ruling names this case; found 2026-10-15, see core/zones.ts#drawCard):
 *   - CR 121.1: "A player draws a card by putting the top card of their library into their hand." The 903.9b replacement changes only where the card is put,
 *     not the draw: compare CR 702.35a (madness: "that player discards it, but exiles it instead of putting it into their graveyard") and 701.9a-c (a card
 *     "discarded, but ... put into a hidden zone instead of into its owner's graveyard" is still discarded), where an action defined as a zone move stays
 *     that action when its destination is replaced.
 *   - An effect that replaces the draw itself says so ("if you would draw a card, ... instead", CR 121.6, 614.11); 903.9b says "would be put into its owner's
 *     hand", not "would draw".
 *   - Magic Judges forum (apps.magicjudges.org/forum/topic/50974, Callum Milne): with the 903.9 replacement, a commander exiled by "exile ..." was still
 *     exiled ("exile" is both a zone and a verb), so effects that count what was exiled this way count it: the same reading for the verb "draw".
 * So "whenever you draw a card" triggers, the cards drawn this turn count it (the Nth card each turn) and "draw a card" effects count it as drawn.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameEvent, type GameState, type OracleCard } from '../../src/index';
import { drive } from '../m5/cr-examples/helpers';
import { act, answerUntilPriority, commanderScenario, find, forests, legend, lifeOf, pass, tweak } from '../m11/rules/helpers';

const synth = (name: string, cost: string, type: string, text: string): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [] } as unknown as OracleCard);
const TITANIA = legend('Test Titania', '{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const WATCH = synth('Test Draw Watch', '{G}', 'Enchantment', 'Whenever you draw a card, you gain 1 life.');
const INSIGHT = synth('Test Insight', '{G}', 'Instant', 'Draw a card.');

/** Alice's commander on top of her library (she let it go there earlier, CR 903.9b is optional). */
const onTop = (s: GameState): GameState => tweak(s, (t) => {
  const id = t.zones.command.find((x) => t.objects[x]!.defId === TITANIA.id)!;
  t.zones.command = t.zones.command.filter((x) => x !== id);
  t.objects[id]!.zone = 'library';
  t.zones.library['p1']!.unshift(id);
});
const answerZone = (s: GameState, command: boolean): { state: GameState; events: GameEvent[] } => {
  const d = s.pending!;
  const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'commanderZone', command } as DecisionAnswer });
  if (r.error) throw new Error(r.error.message);
  return { state: r.state, events: r.events };
};
const zoneOfDef = (s: GameState, defId: string): string[] => Object.values(s.objects).filter((o) => o.defId === defId).map((o) => o.zone);
const drawn = (s: GameState): number => s.players[0]!.turnStats.cardsDrawn;

describe('CMDF item 5: a drawn commander put into the command zone was drawn (CR 121.1, 903.9b)', () => {
  it('CR 903.9b, 121.1, 603.2: drawn by an effect and put into the command zone: "whenever you draw a card" triggers and the draw is counted', () => {
    let s = onTop(commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WATCH, INSIGHT], p1: { battlefield: [...forests(1), 'Test Draw Watch'], hand: ['Test Insight'] } }));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Insight', 'hand', 'p1') }));
    s = pass(pass(s));
    expect(s.pending).toMatchObject({ kind: 'commanderZone', player: 'p1', rule: '903.9b', zone: 'hand' });
    const r = answerZone(s, true);
    expect(zoneOfDef(r.state, TITANIA.id)).toEqual(['command']);
    const drew = r.events.find((e) => e.type === 'drew');
    expect(drew).toMatchObject({ type: 'drew', player: 'p1', commandZone: true });
    expect(drawn(r.state)).toBe(1); // CR 121.1: a card drawn this turn
    expect(r.state.log.some((l) => /draws Test Titania and puts it into the command zone instead of into their hand/.test(l.text))).toBe(true);
    s = answerUntilPriority(r.state);
    expect(s.zones.stack).toHaveLength(1); // the draw trigger (CR 603.2)
    s = pass(pass(s));
    expect(lifeOf(s, 'p1')).toBe(41);
  });

  it('CR 903.9b: kept in the hand instead, it is an ordinary draw (the same count, the same trigger)', () => {
    let s = onTop(commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WATCH, INSIGHT], p1: { battlefield: [...forests(1), 'Test Draw Watch'], hand: ['Test Insight'] } }));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Insight', 'hand', 'p1') }));
    s = pass(pass(s));
    const r = answerZone(s, false);
    expect(zoneOfDef(r.state, TITANIA.id)).toEqual(['hand']);
    expect(r.events.find((e) => e.type === 'drew')).toMatchObject({ type: 'drew', player: 'p1' });
    expect(r.events.find((e) => e.type === 'drew' && e.commandZone)).toBeUndefined();
    expect(drawn(r.state)).toBe(1);
  });

  it('CR 504.1, 903.9b: the draw step\'s draw of a commander put into the command zone counts as the turn\'s card drawn', () => {
    let s = onTop(commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WATCH], p1: { battlefield: ['Test Draw Watch'] } }));
    for (let i = 0; i < 80 && s.pending && s.pending.kind !== 'commanderZone'; i++) {
      const d = s.pending;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'declareAttackers') s = answerUntilPriority(s, [{ kind: 'declareAttackers', attacks: [] }]);
      else if (d.kind === 'declareBlockers') s = answerUntilPriority(s, [{ kind: 'declareBlockers', blocks: [] }]);
      else throw new Error(`unexpected ${d.kind}`);
    }
    expect(s.turn.step).toBe('draw');
    const r = answerZone(s, true);
    expect(drawn(r.state)).toBe(1);
    expect(r.state.zones.hand['p1']).toHaveLength(0);
    s = answerUntilPriority(r.state);
    expect(s.zones.stack).toHaveLength(1); // "whenever you draw a card"
  });
});
