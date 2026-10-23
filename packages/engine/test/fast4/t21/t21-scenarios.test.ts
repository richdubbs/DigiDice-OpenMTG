/**
 * FAST4 T21: the shapes of parser/templates/zz-fast4/t21.json (and the engine, render and capability support they needed) played through the engine with
 * synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 601.2c, 601.2f, 118.7   "~ costs {1}{R} more to cast for each target beyond the first" (strive): the mana, colored part too, once per extra target
 *   CR 601.2c, 601.2f          "~ costs {3} less to cast if it targets a tapped creature": read from the targets chosen before the total cost
 *   CR 601.2f, 115.9b          "Spells your opponents cast that target ~ cost {2} more to cast."
 *   CR 601.2f, 105.1, 105.2    "~ costs {1} less to cast for each color among permanents you control" (colorless is no color; an opponent's do not count)
 *   CR 601.2f, 118.7a, 208.1   "~ costs {X} less to cast, where X is the total power of creatures you control" (generic only, never below {0})
 *   CR 601.3, 506.1, 509.1     "Cast ~ only during combat before blockers are declared." (beginning of combat and declare attackers steps)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ManaSymbol, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { castCheck, modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` (a card in any zone, or a spell on the stack) for `player`, after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef, player = 'p1'): string {
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}
/** Test setup: the card `id` as a spell on the stack controlled by `player`, with these announced targets (CR 601.2c comes before the total cost, 601.2f). */
function onStack(s: GameState, id: ObjectId, targets: TargetChoice[], player = 'p1'): GameState {
  return tweak(s, (x) => {
    const o = x.objects[id]!;
    x.zones.hand[o.owner] = x.zones.hand[o.owner]!.filter((y) => y !== id);
    o.zone = 'stack';
    o.controller = player;
    x.zones.stack.push(id);
    o.stack = { kind: 'spell', face: 0, targets: [targets], costsPaid: {}, castFrom: 'hand' } as never;
  });
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** Cast from p1's hand, choosing these targets and paying automatically. */
function cast(s0: GameState, name: string, targets: TargetChoice[], player = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const tappedLands = (s: GameState, player: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && s.objects[id]!.tapped && /Plains|Island|Mountain|Forest|Swamp/.test(s.objects[id]!.defId)).length;
const noManual = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);

const STRIVE = card('Test Strive', 'Sorcery', 'This spell costs {1}{R} more to cast for each target beyond the first.\nTap any number of target creatures.', { cost: '{R}', colors: ['R'] });
const REBUKE = card('Test Rebuke', 'Instant', 'This spell costs {3} less to cast if it targets a tapped creature.\nDestroy target creature.', { cost: '{4}{W}', colors: ['W'] });
const SPHINX = card('Test Sphinx', 'Creature — Sphinx', 'Flying\nSpells your opponents cast that target this creature cost {2} more to cast.', { cost: '{4}{U}', colors: ['U'], pt: ['4', '4'] });
const PUMMELER = card('Test Pummeler', 'Creature — Plant', 'This spell costs {1} less to cast for each color among permanents you control.', { cost: '{6}{G}', colors: ['G'], pt: ['6', '5'] });
const HUNGER = card('Test Hunger', 'Creature — Dinosaur', 'This spell costs {X} less to cast, where X is the total power of creatures you control.\nTrample', { cost: '{10}{G}{G}', colors: ['G'], pt: ['12', '12'] });
const CRY = card('Test War Cry', 'Instant', 'Cast this spell only during combat before blockers are declared.\nTarget creature gets +2/+0 until end of turn.', { cost: '{R}', colors: ['R'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{1}{G}', colors: ['G'], pt: ['2', '2'] });
const KNIGHT = card('Test Knight', 'Creature — Human Knight', '', { cost: '{W}', colors: ['W'], pt: ['3', '1'] });
const GUILDMAGE = card('Test Guildmage', 'Creature — Human Wizard', '', { cost: '{U}{B}', colors: ['U', 'B'], pt: ['2', '2'] });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { cost: '{3}', pt: ['3', '3'] });
const DISPUTE = card('Test Dispute', 'Instant', 'This spell costs {2} less to cast if it targets a blue spell.\nCounter target spell unless its controller pays {3}.', { cost: '{2}{U}', colors: ['U'] });
const TORCH = card('Test Torch', 'Instant', 'This spell costs {2} less to cast if it targets a blue permanent.\nTest Torch deals 4 damage to target creature or spell.', { cost: '{3}{R}', colors: ['R'] });
const THOUGHT = card('Test Thought', 'Sorcery', 'Draw a card.', { cost: '{3}{U}', colors: ['U'] });
const DRAKE = card('Test Drake', 'Creature — Drake', 'Flying', { cost: '{1}{U}', colors: ['U'], pt: ['2', '1'] });
const SKYBONDER = card('Test Skybonder', 'Creature — Bird', 'Flying\nCreatures you control with flying have "Spells your opponents cast that target this creature cost {2} more to cast."', { cost: '{1}{W}', colors: ['W'], pt: ['2', '2'] });
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.', { cost: '{R}', colors: ['R'] });

describe('design 6.9: the T21 templates are stable, so a card they read completely is fully automated', () => {
  it('CR 601.2f, 601.3: every T21 sentence is automated', () => {
    for (const d of [STRIVE, REBUKE, SPHINX, PUMMELER, HUNGER, CRY]) expect(noManual(d), d.name).toEqual([]);
    for (const d of [STRIVE, REBUKE, SPHINX, PUMMELER, HUNGER, SKYBONDER, DISPUTE]) expect(d.automation.level, d.name).toBe('full');
  });
  it('CR 601.3: the timing line is full: the native recognizer (rules/cast-restriction.ts) reads it as the template does, and now that the renderer has its words the exact gate takes it (cards/pipeline.ts native stage)', () => {
    expect(CRY.automation.level).toBe('full');
    const st = CRY.faces[0]!.abilities.find((a) => a.kind === 'static');
    expect(st && st.kind === 'static' ? st.effects : null).toEqual([{ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'cast', when: { cond: 'turnOf', whose: 'any', step: ['beginCombat', 'declareAttackers'] } }]);
  });
});

describe('CR 601.2c, 601.2f, 118.7: "~ costs {1}{R} more to cast for each target beyond the first"', () => {
  it('no or one target: the mana cost; two targets: {1}{R} more; three targets: {2}{R}{R} more (the colored part counted each time)', () => {
    const s = scenario([], { p1: { hand: ['Test Strive'] }, defs: [STRIVE] });
    const id = find(s, 'Test Strive', 'hand');
    expect(costOf(s, id, STRIVE)).toBe('{R}'); // castCheck: no target is announced yet
    const t = (n: number): TargetChoice[] => Array.from({ length: n }, (_, i) => obj(`bear${i}`));
    for (const [n, want] of [[0, '{R}'], [1, '{R}'], [2, '{1}{R}{R}'], [3, '{2}{R}{R}{R}']] as const) expect(costOf(onStack(s, id, t(n)), id, STRIVE), `${n} targets`).toBe(want);
  });
  it('a real cast with two targets taps three Mountains (the total cost {1}{R}{R})', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Strive'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [STRIVE, BEAR] });
    const bears = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bear');
    const s = cast(s0, 'Test Strive', bears.map(obj));
    expect(s.zones.stack.length).toBe(1);
    expect(tappedLands(s, 'p1')).toBe(3);
  });
});

describe('CR 601.2c, 601.2f: "~ costs {3} less to cast if it targets a tapped creature"', () => {
  const board = (): GameState => scenario(['Plains'], { p1: { hand: ['Test Rebuke'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }, 'Test Knight'] }, defs: [REBUKE, BEAR, KNIGHT] });
  it('read from the chosen target: a tapped creature {1}{W}, an untapped one {4}{W}', () => {
    const s = board();
    const id = find(s, 'Test Rebuke', 'hand');
    expect(costOf(onStack(s, id, [obj(find(s, 'Test Bear', 'battlefield'))]), id, REBUKE)).toBe('{1}{W}');
    expect(costOf(onStack(s, id, [obj(find(s, 'Test Knight', 'battlefield'))]), id, REBUKE)).toBe('{4}{W}');
  });
  it('castCheck: offered with two Plains while a tapped creature could be its target, not when no creature is tapped', () => {
    const s = board();
    const castable = (t: GameState): boolean => legal(t, 'p1', 'cast').some((a) => a.object === find(t, 'Test Rebuke', 'hand'));
    expect(castable(s)).toBe(true);
    const untapped = tweak(s, (x) => { for (const id of x.zones.battlefield) if (x.objects[id]!.defId === 'Test Bear') x.objects[id]!.tapped = false; });
    expect(castable(untapped)).toBe(false);
  });
  it('a real cast on the tapped creature costs {1}{W} and destroys it', () => {
    const s0 = board();
    let s = cast(s0, 'Test Rebuke', [obj(find(s0, 'Test Bear', 'battlefield'))]);
    expect(s.zones.stack.length).toBe(1);
    expect(tappedLands(s, 'p1')).toBe(2);
    s = passBoth(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
  });
  it('a real cast on the untapped creature with two Plains is not completed (the total cost {4}{W} can\'t be paid, CR 601.2h)', () => {
    const s0 = board();
    let threw = false;
    let s = s0;
    try {
      s = cast(s0, 'Test Rebuke', [obj(find(s0, 'Test Knight', 'battlefield'))]);
    } catch {
      threw = true;
    }
    expect(threw || s.zones.stack.length === 0).toBe(true);
    if (!threw) expect(tappedLands(s, 'p1')).toBe(0);
  });
});

describe('CR 601.2c, 601.2f, 110.1: the filter of "if it targets ..." keeps its zone', () => {
  it('"a blue spell" is a spell on the stack; "a blue permanent" is on the battlefield, so a blue spell target does not reduce it', () => {
    const s = scenario(['Island'], { p1: { hand: ['Test Dispute', 'Test Torch'] }, p2: { hand: ['Test Thought'], battlefield: ['Test Drake'] }, defs: [DISPUTE, TORCH, THOUGHT, DRAKE] });
    const spell = find(s, 'Test Thought', 'hand', 'p2');
    const onTheStack = onStack(s, spell, [], 'p2'); // the opponent's blue spell, waiting on the stack
    const dispute = find(onTheStack, 'Test Dispute', 'hand');
    const torch = find(onTheStack, 'Test Torch', 'hand');
    expect(costOf(onStack(onTheStack, dispute, [obj(spell)]), dispute, DISPUTE)).toBe('{U}');
    expect(costOf(onStack(onTheStack, torch, [obj(spell)]), torch, TORCH)).toBe('{3}{R}');
    expect(costOf(onStack(onTheStack, torch, [obj(find(s, 'Test Drake', 'battlefield'))]), torch, TORCH)).toBe('{1}{R}');
  });
  it('castCheck (before targets): with one Island, offered while a blue spell is on the stack, refused when none is', () => {
    const s = scenario(['Island'], { p1: { hand: ['Test Dispute'], battlefield: ['Island'] }, p2: { hand: ['Test Thought'] }, defs: [DISPUTE, THOUGHT] });
    const dispute = find(s, 'Test Dispute', 'hand');
    const withSpell = onStack(s, find(s, 'Test Thought', 'hand', 'p2'), [], 'p2');
    expect(castCheck(withSpell, 'p1', dispute)).not.toHaveProperty('denial');
    const red = tweak(withSpell, (x) => { x.defs['Test Thought'] = { ...x.defs['Test Thought']!, faces: [{ ...x.defs['Test Thought']!.faces[0]!, colors: ['R'] }] }; });
    expect(castCheck(red, 'p1', dispute)).toHaveProperty('denial');
  });
});

describe('CR 613.1f, 601.2f: the ability granted to each flyer (have "Spells your opponents cast that target this creature cost {2} more to cast.")', () => {
  it('a spell that targets a flyer of its controller costs {2} more; one that targets a creature without flying does not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Skybonder', 'Test Drake', 'Test Bear'] }, p2: { hand: ['Test Shock'] }, defs: [SKYBONDER, DRAKE, BEAR, SHOCK] });
    expect(noManual(SKYBONDER)).toEqual([]);
    const theirs = find(s, 'Test Shock', 'hand', 'p2');
    expect(costOf(onStack(s, theirs, [obj(find(s, 'Test Drake', 'battlefield'))], 'p2'), theirs, SHOCK, 'p2')).toBe('{2}{R}');
    expect(costOf(onStack(s, theirs, [obj(find(s, 'Test Skybonder', 'battlefield'))], 'p2'), theirs, SHOCK, 'p2')).toBe('{2}{R}');
    expect(costOf(onStack(s, theirs, [obj(find(s, 'Test Bear', 'battlefield'))], 'p2'), theirs, SHOCK, 'p2')).toBe('{R}');
  });
});

describe('CR 601.2f, 115.9b: "Spells your opponents cast that target ~ cost {2} more to cast."', () => {
  const board = (): GameState => scenario([], { p1: { battlefield: ['Test Sphinx', 'Test Bear'], hand: ['Test Shock'] }, p2: { hand: ['Test Shock'] }, defs: [SPHINX, BEAR, SHOCK] });
  it('an opponent\'s spell that targets it: {2} more; that targets another creature: no change; not yet cast (no target chosen): no change', () => {
    const s = board();
    const theirs = find(s, 'Test Shock', 'hand', 'p2');
    expect(costOf(onStack(s, theirs, [obj(find(s, 'Test Sphinx', 'battlefield'))], 'p2'), theirs, SHOCK, 'p2')).toBe('{2}{R}');
    expect(costOf(onStack(s, theirs, [obj(find(s, 'Test Bear', 'battlefield'))], 'p2'), theirs, SHOCK, 'p2')).toBe('{R}');
    expect(costOf(onStack(s, theirs, [{ kind: 'player', id: 'p1' }], 'p2'), theirs, SHOCK, 'p2')).toBe('{R}');
    expect(costOf(s, theirs, SHOCK, 'p2')).toBe('{R}');
  });
  it('its controller\'s own spells that target it cost the same (the caster is an opponent)', () => {
    const s = board();
    const mine = find(s, 'Test Shock', 'hand', 'p1');
    expect(costOf(onStack(s, mine, [obj(find(s, 'Test Sphinx', 'battlefield'))]), mine, SHOCK)).toBe('{R}');
  });
  it('once it has left the battlefield, its ability no longer applies (CR 604.1, 611.3a)', () => {
    const s = board();
    const theirs = find(s, 'Test Shock', 'hand', 'p2');
    const sphinx = find(s, 'Test Sphinx', 'battlefield');
    const gone = tweak(s, (x) => {
      x.zones.battlefield = x.zones.battlefield.filter((y) => y !== sphinx);
      x.objects[sphinx]!.zone = 'graveyard';
      x.zones.graveyard.p1!.push(sphinx);
    });
    expect(costOf(onStack(gone, theirs, [obj(sphinx)], 'p2'), theirs, SHOCK, 'p2')).toBe('{R}');
  });
});

describe('CR 601.2f, 105.1, 105.2: "~ costs {1} less to cast for each color among permanents you control"', () => {
  it('white, blue and black among your permanents: {3} less; a colorless artifact and an opponent\'s red-free board add nothing', () => {
    const s = scenario(['Plains'], { p1: { hand: ['Test Pummeler'], battlefield: ['Test Knight', 'Test Guildmage', 'Test Golem', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: [PUMMELER, KNIGHT, GUILDMAGE, GOLEM, BEAR] });
    expect(costOf(s, find(s, 'Test Pummeler', 'hand'), PUMMELER)).toBe('{3}{G}');
    const none = scenario(['Plains'], { p1: { hand: ['Test Pummeler'], battlefield: ['Test Golem', 'Plains'] }, p2: { battlefield: ['Test Knight', 'Test Guildmage'] }, defs: [PUMMELER, KNIGHT, GUILDMAGE, GOLEM] });
    expect(costOf(none, find(none, 'Test Pummeler', 'hand'), PUMMELER)).toBe('{6}{G}');
  });
});

describe('CR 601.2f, 118.7a, 208.1: "~ costs {X} less to cast, where X is the total power of creatures you control"', () => {
  it('power 2 + 3 = 5: {5}{G}{G}; an opponent\'s creature does not count; more power than the generic part: {G}{G} (never the colored part)', () => {
    const s = scenario([], { p1: { hand: ['Test Hunger'], battlefield: ['Test Bear', 'Test Knight'] }, p2: { battlefield: ['Test Golem'] }, defs: [HUNGER, BEAR, KNIGHT, GOLEM] });
    expect(costOf(s, find(s, 'Test Hunger', 'hand'), HUNGER)).toBe('{5}{G}{G}');
    const big = scenario([], { p1: { hand: ['Test Hunger'], battlefield: ['Test Golem', 'Test Golem', 'Test Golem', 'Test Golem'] }, defs: [HUNGER, GOLEM] });
    expect(costOf(big, find(big, 'Test Hunger', 'hand'), HUNGER)).toBe('{G}{G}');
  });
});

describe('CR 601.3, 506.1, 508.1, 509.1: "Cast ~ only during combat before blockers are declared."', () => {
  it('castable in the beginning of combat and declare attackers steps, of either player\'s turn; not in a main phase, the declare blockers step or later', () => {
    const s = scenario(['Mountain'], { p1: { hand: ['Test War Cry'], battlefield: ['Mountain', 'Test Bear'] }, defs: [CRY, BEAR] });
    const id = find(s, 'Test War Cry', 'hand');
    const at = (step: GameState['turn']['step'], active = 'p1'): boolean => !('denial' in castCheck(tweak(s, (x) => { x.turn.step = step; x.turn.activePlayer = active; }), 'p1', id));
    expect(at('main1')).toBe(false);
    expect(at('beginCombat')).toBe(true);
    expect(at('declareAttackers')).toBe(true);
    expect(at('declareAttackers', 'p2')).toBe(true);
    expect(at('declareBlockers')).toBe(false);
    expect(at('combatDamage')).toBe(false);
    expect(at('end')).toBe(false);
  });
});
