/**
 * p2-misc-2 (Phase 2 lane p2-misc): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by
 * the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 603.2d, 112.1   "If a triggered ability of a colorless spell you control or another colorless permanent you control triggers, that ability triggers an
 *                      additional time": a colorless spell's "when you cast this spell" and another colorless permanent's trigger twice; a colored one's once
 *   CR 702.16b, 702.16e, "Until your next turn, your life total can't change and you gain protection from everything": no gain or loss of life, not targeted, not
 *   119.7, 611.2a      dealt damage, until the player's next turn; then it ends
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, scenario } from '../../m5/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 80 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as DecisionAnswer);
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const cast = (s: GameState, player: PlayerId, name: string, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState =>
  settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), [], targets);

describe('CR 603.2d, 112.1: "If a triggered ability of a colorless spell you control or another colorless permanent you control triggers, that ability triggers an additional time."', () => {
  const ECHO = card('Test Endless Hum', 'Enchantment', 'If a triggered ability of a colorless spell you control or another colorless permanent you control triggers, that ability triggers an additional time.');
  const HERALD = card('Test Void Herald', 'Creature — Eldrazi', 'When you cast this spell, you gain 2 life.', { pt: ['3', '3'] });
  const RED_HERALD = card('Test Ember Herald', 'Creature — Elemental', 'When you cast this spell, you gain 2 life.', { pt: ['3', '3'], cost: '{R}', colors: ['R'] });
  const RELIC = card('Test Humming Relic', 'Artifact', 'Whenever you cast a spell, you gain 1 life.');
  const IDOL = card('Test Ruby Idol', 'Artifact', 'Whenever you cast a spell, you gain 1 life.', { cost: '{R}', colors: ['R'] });
  const DEFS = [ECHO, HERALD, RED_HERALD, RELIC, IDOL];
  it('is automated', () => expect(full(ECHO)).toBe(true));
  it('a colorless spell\'s cast trigger triggers twice', () => {
    let s = scenario([], { p1: { battlefield: ['Test Endless Hum'], hand: ['Test Void Herald'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = cast(s, 'p1', 'Test Void Herald');
    expect(life(s, 'p1')).toBe(before + 4);
  });
  it('without the enchantment: once', () => {
    let s = scenario([], { p1: { hand: ['Test Void Herald'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = cast(s, 'p1', 'Test Void Herald');
    expect(life(s, 'p1')).toBe(before + 2);
  });
  it('another colorless permanent\'s trigger twice, a colored permanent\'s once; a colored spell\'s cast trigger once', () => {
    let s = scenario(['Mountain'], { p1: { battlefield: ['Test Endless Hum', 'Test Humming Relic', 'Test Ruby Idol', 'Mountain'], hand: ['Test Ember Herald'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = cast(s, 'p1', 'Test Ember Herald');
    expect(life(s, 'p1')).toBe(before + 2 /* Relic twice */ + 1 /* Idol once */ + 2 /* the red spell's own trigger once */);
  });
});

describe('CR 702.16b, 702.16e, 119.7, 611.2a: "Until your next turn, your life total can\'t change and you gain protection from everything."', () => {
  const PRAYER = card('Test Still Prayer', 'Instant', "Until your next turn, your life total can't change and you gain protection from everything. Draw a card.");
  const RAIN = card('Test Ash Rain', 'Sorcery', 'Test Ash Rain deals 3 damage to each opponent.');
  const BOLT = card('Test Spark Jab', 'Instant', 'Test Spark Jab deals 2 damage to any target.');
  const SALVE = card('Test Warm Salve', 'Instant', 'You gain 4 life.');
  const DEFS = [PRAYER, RAIN, BOLT, SALVE];
  it('is automated', () => expect(full(PRAYER)).toBe(true));
  it('no life gained; on the next turn no damage from a spell that does not target; on the player\'s own next turn it is over', () => {
    let s = scenario([], { p1: { hand: ['Test Still Prayer', 'Test Warm Salve'] }, p2: { hand: ['Test Ash Rain', 'Test Ash Rain'] }, defs: DEFS });
    s = cast(s, 'p1', 'Test Still Prayer');
    const before = life(s, 'p1');
    s = cast(s, 'p1', 'Test Warm Salve');
    expect(life(s, 'p1')).toBe(before);
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'p2', 'Test Ash Rain');
    expect(life(s, 'p1')).toBe(before);
    s = advanceTo(s, 3, 'main1');
    s = advanceTo(s, 4, 'main1');
    s = cast(s, 'p2', 'Test Ash Rain');
    expect(life(s, 'p1')).toBe(before - 3);
  });
  it('without it the same spell deals its damage', () => {
    let s = scenario([], { p2: { hand: ['Test Ash Rain'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'p2', 'Test Ash Rain');
    expect(life(s, 'p1')).toBe(before - 3);
  });
  it('CR 702.16b: the player is not among the legal targets of an opponent\'s spell', () => {
    let s = scenario([], { p1: { hand: ['Test Still Prayer'] }, p2: { hand: ['Test Spark Jab'] }, defs: DEFS });
    s = cast(s, 'p1', 'Test Still Prayer');
    s = advanceTo(s, 2, 'main1');
    const t = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Spark Jab', 'hand', 'p2') });
    const d = t.pending as { kind: string; players: PlayerId[] };
    expect(d.kind).toBe('chooseTargets');
    expect(d.players).not.toContain('p1');
    expect(d.players).toContain('p2');
  });
});
