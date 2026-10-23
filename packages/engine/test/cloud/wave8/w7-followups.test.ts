/**
 * Merge wave 8, line w7-followups: the reviewed follow-ups of merge wave 7 (G13), played through applyAction
 * with synthetic cards compiled by the game's default compiler (invented names, Oracle wordings). Nothing is mocked. Record: docs/coverage/w8-followups-g10.txt.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, pool, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

type Opts = { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] };
/** Answer the decisions that come up, in order, until priority (or nothing scripted is left). */
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = { targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), q), q);
}

describe('CR 205.1b, 305.6 (w8-followups item 1): "It\'s still a land" keeps all the land\'s prior subtypes, so a basic land type keeps its mana ability', () => {
  const AWAKEN = card('Test Awaken', 'Sorcery', "Target land you control becomes a 4/4 Elemental creature with trample. It's still a land.");
  const GROVE = card('Test Grove', 'Basic Land — Forest', '');
  const ARBOR = card('Test Arbor', 'Land Creature — Forest Dryad', '', ['1', '1']);
  const STIR = card('Test Stir', 'Sorcery', "Put three +1/+1 counters on a Cave you control. It becomes a 0/0 Elemental creature with haste. It's still a land.");
  const CAVE = card('Test Hollow', 'Land — Cave', '{T}: Add {C}.');

  it('the type change adds the creature type and the Elemental subtype (none is set); the card is automated', () => {
    expect(automated(AWAKEN)).toBe(true);
    expect(automated(STIR)).toBe(true);
    const json = JSON.stringify(AWAKEN.faces[0]!.abilities[0]);
    expect(json).toContain('"types":{"add":["Creature"]}');
    expect(json).toContain('"subtypes":{"add":["Elemental"]}');
    expect(json).not.toContain('"set"');
  });

  it('a Forest becomes a 4/4 Elemental creature land that is still a Forest and taps for {G} (CR 305.6)', () => {
    let s = scenario([], { p1: { hand: ['Test Awaken'], battlefield: ['Test Grove'] }, defs: [AWAKEN, GROVE] });
    const g = find(s, 'Test Grove', 'battlefield', 'p1');
    s = cast(s, 'Test Awaken', { targets: [[obj(g)]] });
    const c = getChars(s, g);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Elemental']));
    expect([c.power, c.toughness]).toEqual(['4', '4']);
    const tap = legal(s, 'p1', 'activate').find((l) => l.isMana && (l.action as { source?: string }).source === g);
    expect(tap).toBeDefined();
    s = act(s, tap!.action);
    expect(pool(s, 'p1')).toBe('G');
  });

  it('a land creature keeps its creature types beside the new one: a Forest Dryad becomes a Forest Dryad Elemental (CR 205.1b: all prior subtypes are retained)', () => {
    let s = scenario([], { p1: { hand: ['Test Awaken'], battlefield: ['Test Arbor'] }, defs: [AWAKEN, ARBOR] });
    const a = find(s, 'Test Arbor', 'battlefield', 'p1');
    s = cast(s, 'Test Awaken', { targets: [[obj(a)]] });
    expect([...getChars(s, a).subtypes].sort()).toEqual(['Dryad', 'Elemental', 'Forest']);
  });

  it('a Cave stays a Cave land and becomes a 0/0 Elemental creature with three +1/+1 counters (Cosmium Confluence\'s mode)', () => {
    let s = scenario([], { p1: { hand: ['Test Stir'], battlefield: ['Test Hollow'] }, defs: [STIR, CAVE] });
    const h = find(s, 'Test Hollow', 'battlefield', 'p1');
    s = cast(s, 'Test Stir', { picks: [[h]] });
    const c = getChars(s, h);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Cave', 'Elemental']));
    expect([c.power, c.toughness]).toEqual(['3', '3']);
  });
});

describe('CR 603.4, 603.12 (w8-followups item 2): "When you do, if X, Y" in one sentence is an intervening "if": checked when the reflexive ability would trigger and on resolution', () => {
  // Sigil of Myrkul's Oracle text
  const SIGIL = card('Test Sigil', 'Enchantment', 'At the beginning of combat on your turn, mill a card. When you do, if there are four or more creature cards in your graveyard, put a +1/+1 counter on target creature you control and it gains deathtouch until end of turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
  const ROCK = card('Test Rock', 'Artifact', '');
  const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id).abilities.map((a) => (a.def as { keyword?: string }).keyword ?? '');

  it('the reflexive step checks the condition when it would trigger (when.if) and again on resolution (the if kept in do)', () => {
    expect(automated(SIGIL)).toBe(true);
    const steps = (SIGIL.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; when?: { if?: unknown }; do?: { op: string; cond?: unknown }[] }[] } }).effect.steps;
    const refl = steps.find((x) => x.op === 'reflexive')!;
    expect(refl.do).toHaveLength(1);
    expect(refl.do![0]!.op).toBe('if');
    expect(refl.when!.if).toEqual(refl.do![0]!.cond);
  });

  it('with three creature cards after the mill, no target is asked for and nothing goes on the stack; with four, it targets and resolves', () => {
    let s = scenario([], { p1: { battlefield: ['Test Sigil', 'Test Bear'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'], library: ['Test Rock', 'Test Rock'] }, defs: [SIGIL, BEAR, ROCK] });
    s = settle(advanceTo(s, 1, 'beginCombat'));
    for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 12; guard++) {
      s = settle(pass(pass(s)));
      expect(s.pending?.kind).not.toBe('chooseTargets');
    }
    expect(s.zones.stack.length).toBe(0);
    expect(s.zones.graveyard['p1']!.length).toBe(4); // the Rock was milled: three creature cards
    const bear0 = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(s.objects[bear0]!.counters['+1/+1'] ?? 0).toBe(0);

    s = scenario([], { p1: { battlefield: ['Test Sigil', 'Test Bear'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'], library: ['Test Bear', 'Test Bear'] }, defs: [SIGIL, BEAR, ROCK] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = drain(settle(advanceTo(s, 1, 'beginCombat'), { targets: [[obj(bear)]] }), { targets: [[obj(bear)]] });
    expect(s.zones.graveyard['p1']!.length).toBe(4);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(keywords(s, bear)).toContain('deathtouch');
  });
});

describe('CR 500.9, 500.10, 603.7a (w8-followups item 3): "at the beginning of the next turn\'s upkeep" is the next turn\'s, not an additional upkeep step of this turn', () => {
  const LATER = card('Test Later', 'Sorcery', "Draw a card. Draw two cards at the beginning of the next turn's upkeep.");
  const SOON = card('Test Soon', 'Sorcery', 'Draw a card. Draw two cards at the beginning of the next upkeep.');
  const EXTRA = card('Test Extra', 'Sorcery', 'You get two additional upkeep steps after this phase.');
  const ROCK = card('Test Rock', 'Artifact', '');
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;

  it('T3 builds turn: next; "the next upkeep" (r4-refs) does not', () => {
    expect(automated(LATER)).toBe(true);
    expect(automated(SOON)).toBe(true);
    expect(JSON.stringify(LATER.faces[0]!.abilities[0])).toContain('"when":{"at":"step","step":"upkeep","next":true,"turn":"next"}');
    expect(JSON.stringify(SOON.faces[0]!.abilities[0])).toContain('"when":{"at":"step","step":"upkeep","next":true}');
  });

  it("cast in the main phase, then two additional upkeep steps after it: the delayed draw comes in the next turn's upkeep, once", () => {
    expect(automated(EXTRA)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Later', 'Test Extra'], library: Array(10).fill('Test Rock') }, p2: { library: Array(10).fill('Test Rock') }, defs: [LATER, EXTRA, ROCK] });
    s = cast(s, 'Test Later');
    s = cast(s, 'Test Extra');
    const before = hand(s); // the first draw is done; both sorceries are gone
    s = drain(advanceTo(s, 1, 'upkeep')); // the first additional upkeep step of turn 1 (CR 500.10)
    expect(s.turn.number).toBe(1);
    expect(hand(s)).toBe(before);
    s = drain(advanceTo(s, 2, 'draw'));
    expect(hand(s)).toBe(before + 2);
    s = drain(advanceTo(s, 3, 'draw'));
    expect(hand(s)).toBe(before + 3); // p1's own draw of turn 3 only: the delayed trigger fired once (CR 603.7b)
  });
});

describe('w8-followups item 6: held-out spot-checks of wave 7 (G3), played', () => {
  it('Astonishing Spider-Man (CR 508.1m, 701.9a, 608.2c): attacking, you may discard your hand; if you do, draw a card for each card discarded this turn, the hand included', () => {
    const SPIDEY = card('Test Spider', 'Legendary Creature — Spider Human Hero', 'Reach\nWhenever Test Spider attacks, you may discard your hand. If you do, draw a card for each card you\'ve discarded this turn.', ['4', '4']);
    const ROCK = card('Test Rock', 'Artifact', '');
    const LOOT = card('Test Loot', 'Sorcery', 'Discard a card.');
    expect(automated(SPIDEY)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Loot', 'Test Rock', 'Test Rock', 'Test Rock'], battlefield: ['Test Spider'], library: Array(10).fill('Test Rock') }, p2: { library: Array(5).fill('Test Rock') }, defs: [SPIDEY, ROCK, LOOT] });
    s = cast(s, 'Test Loot', { picks: [[s.zones.hand['p1']!.find((id) => s.objects[id]!.defId === 'Test Rock')!]] });
    expect(s.zones.hand['p1']!.length).toBe(2); // one card discarded earlier this turn
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Spider', 'battlefield', 'p1'), 'p2']]);
    s = drain(settle(s, { answers: [{ kind: 'yesNo', yes: true }] }), { answers: [{ kind: 'yesNo', yes: true }] });
    expect(s.zones.graveyard['p1']!.filter((id) => s.objects[id]!.defId === 'Test Rock').length).toBe(3);
    expect(s.zones.hand['p1']!.length).toBe(3); // 1 + the 2 of the hand
  });

  it('Concord with the Kami (CR 700.2, 700.2d): one or more modes, each mode once (its draw and token modes are guarded instructions, checked as they resolve)', () => {
    const CONCORD = card('Test Concord', 'Enchantment', 'At the beginning of your end step, choose one or more —\n• Put a +1/+1 counter on target creature with a counter on it.\n• Draw a card if you control an enchanted creature.\n• Create a 1/1 colorless Spirit creature token if you control an equipped creature.');
    expect(automated(CONCORD)).toBe(true);
    const modes = (CONCORD.faces[0]!.abilities[0] as unknown as { effect: { modes: { min: number; max: number; allowRepeat?: boolean } } }).effect.modes;
    expect([modes.min, modes.max, modes.allowRepeat ?? false]).toEqual([1, 3, false]);
  });
});
