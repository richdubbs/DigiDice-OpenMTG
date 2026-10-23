/**
 * std-rx22 (card wave 2, EDH lane rx22): the keyword suspend, played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks. CR cites written from memory in a cloud session (no rules/cr/):
 * unverified.
 *
 *   CR 702.62a, 116.2f        the special action: pay the suspend cost and exile the card from your hand with N time counters, when you could begin to cast it
 *   CR 702.62a-b, 113.6       a suspended card's two triggered abilities work in exile: an upkeep counter removal, then a free cast when the last is removed
 *   CR 702.62a, 118.9, 107.3b the cast is without paying the mana cost (an alternative cost named suspend, X is 0); declining leaves the card exiled
 *   CR 702.62a, 302.6, 613.1f the creature cast this way has haste until its caster loses control of it
 *   CR 701.6a, 608.2c         "Counter target spell if it's green.": any spell may be the target; the condition is read as the counterspell resolves
 *   CR 605.1a, 605.3b, 119.3  a mana ability that also says "You gain 1 life.": both happen at once, without the stack
 *   CR 614.12a, 607.2a        "As ~ enters, choose a color other than green.": the excluded color is not offered
 *   CR 601.2i, 608.2h         "You gain 1 life for each spell you've cast this turn.": the spells cast this turn, this one included
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type Action, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { wasCastKept } from '../../../src/statics/match';
import { act, answer, cast, drive, find, lands, next, pass, scenario, target } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string | null; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost === null ? '' : o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const labels = (s: GameState, player: 'p1' | 'p2' = 'p1'): string[] => legalActions(s, player).map((a) => a.label);
const special = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'special' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name)?.action;
const tappedCount = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
const inExile = (s: GameState, name: string): string | undefined => s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === name);

/** Step forward (passing priority, declaring nothing) until `done` holds or a yes/no question is asked. */
function upTo(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t) && t.pending?.kind !== 'yesNo'; i++) {
    t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
  }
  return t;
}
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => upTo(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
const yes = (s: GameState, y: boolean): GameState => drive(answer(s, { kind: 'yesNo', yes: y } as DecisionAnswer));

describe('CR 702.62a, 116.2f: suspend, the special action', () => {
  const SURGE = card('Test Slow Surge', 'Sorcery', 'You gain 5 life.\nSuspend 2—{R}', { cost: '{3}{R}' });
  const SPARK = card('Test Slow Spark', 'Instant', 'You gain 2 life.\nSuspend 1—{R}', { cost: '{1}{R}' });
  const VISION = card('Test Distant Vision', 'Sorcery', 'You gain 3 life.\nSuspend 3—{R}', { cost: null });
  const board = (): GameState => scenario(['Mountain'], { defs: [SURGE, SPARK, VISION], p1: { hand: ['Test Slow Surge', 'Test Slow Spark', 'Test Distant Vision'], battlefield: lands('Mountain', 3) }, p2: { battlefield: lands('Mountain', 2) } });

  it('the keyword is a capability and the cards compile full', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:suspend')).toBe(true);
    for (const d of [SURGE, SPARK, VISION]) expect(full(d), d.name).toBe(true);
  });
  it('suspending: pay the cost, exile the card from your hand with N time counters; no stack, priority stays (CR 116.2f, 116.3)', () => {
    let s = board();
    expect(labels(s)).toContain('Suspend Test Slow Surge (2 time counters, {R})');
    s = drive(act(s, special(s, 'Test Slow Surge')!));
    expect(tappedCount(s)).toBe(1);
    expect(s.zones.stack).toEqual([]);
    expect(s.pending?.kind).toBe('priority');
    expect(s.pending?.player).toBe('p1');
    const id = inExile(s, 'Test Slow Surge')!;
    expect(s.objects[id]!.counters['time']).toBe(2); // CR 702.62b: suspended
    expect(s.log.some((l) => (l.rules ?? []).includes('CR 702.62a') && /suspends Test Slow Surge/.test(l.text))).toBe(true);
  });
  it('a card with no mana cost can be suspended (it has a suspend cost; it is never begun to be cast)', () => {
    const s = board();
    expect(special(s, 'Test Distant Vision')).toBeDefined();
  });
  it('only when you could begin to cast it: a sorcery not on an opponent\'s turn, an instant then too; not without the cost (CR 702.62a, 307.1, 304.1)', () => {
    const s0 = board();
    const theirs = upTo(s0, (t) => t.turn.activePlayer === 'p2' && t.pending?.kind === 'priority' && t.pending.player === 'p1');
    expect(special(theirs, 'Test Slow Surge')).toBeUndefined();
    expect(special(theirs, 'Test Slow Spark')).toBeDefined();
    const poor = scenario(['Mountain'], { defs: [SURGE], p1: { hand: ['Test Slow Surge'], battlefield: [] } });
    expect(special(poor, 'Test Slow Surge')).toBeUndefined();
    const card0 = find(poor, 'Test Slow Surge', 'hand', 'p1');
    expect(applyAction(poor, { type: 'special', player: 'p1', kind: 'suspend', object: card0 }).error?.rules).toContain('CR 702.62a');
  });
});

describe('CR 702.62a-b, 113.6, 118.9: a suspended card\'s triggered abilities work in exile', () => {
  const SURGE = card('Test Slow Surge', 'Sorcery', 'You gain 5 life.\nSuspend 2—{R}', { cost: '{3}{R}' });
  const board = (): GameState => scenario(['Mountain'], { defs: [SURGE], p1: { hand: ['Test Slow Surge'], battlefield: lands('Mountain', 1) } });
  const suspended = (): GameState => {
    const s = board();
    return drive(act(s, special(s, 'Test Slow Surge')!));
  };

  it('at the beginning of your upkeep a time counter is removed; not in the opponent\'s upkeep', () => {
    const s = mainOf(suspended(), 'p2');
    expect(s.objects[inExile(s, 'Test Slow Surge')!]!.counters['time']).toBe(2); // p2's upkeep: nothing
    const t = mainOf(s, 'p1');
    expect(t.objects[inExile(t, 'Test Slow Surge')!]!.counters['time']).toBe(1);
  });
  it('when the last is removed, you may cast it without paying its mana cost: the spell resolves (no mana spent, cast via suspend)', () => {
    let s = mainOf(mainOf(suspended(), 'p2'), 'p1');
    const life = lifeOf(s, 'p1');
    s = upTo(mainOf(s, 'p2'), () => false);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.turn.step).toBe('upkeep');
    s = yes(s, true);
    expect(s.zones.stack.length).toBe(1);
    const spell = s.objects[s.zones.stack[0]!]!;
    expect(spell.stack?.costsPaid.alternative).toBe('suspend');
    expect(tappedCount(s)).toBe(0);
    s = upTo(s, (t) => t.zones.stack.length === 0);
    expect(lifeOf(s, 'p1')).toBe(life + 5);
    expect(inExile(s, 'Test Slow Surge')).toBeUndefined();
  });
  it('declining the cast leaves the card in exile, with no time counter: it is no longer suspended and nothing triggers again', () => {
    let s = upTo(mainOf(mainOf(mainOf(suspended(), 'p2'), 'p1'), 'p2'), () => false);
    s = yes(s, false);
    const id = inExile(s, 'Test Slow Surge')!;
    expect(s.objects[id]!.counters['time'] ?? 0).toBe(0);
    s = mainOf(mainOf(s, 'p2'), 'p1');
    expect(inExile(s, 'Test Slow Surge')).toBe(id);
  });
});

describe('CR 702.62a, 302.6, 613.1f: a creature cast with suspend has haste until you lose control of it', () => {
  const BEAST = card('Test Patient Beast', 'Creature — Beast', 'Suspend 1—{G}', { cost: '{4}{G}', pt: ['4', '4'] });
  const board = (): GameState => scenario(['Forest'], { defs: [BEAST], p1: { hand: ['Test Patient Beast'], battlefield: lands('Forest', 1) } });

  it('the cast creature has haste; the same creature cast from the hand has not', () => {
    let s = board();
    s = drive(act(s, special(s, 'Test Patient Beast')!));
    s = upTo(mainOf(s, 'p2'), () => false);
    s = upTo(yes(s, true), (t) => t.zones.stack.length === 0);
    const id = find(s, 'Test Patient Beast', 'battlefield', 'p1');
    expect(charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === 'haste')).toBe(true);
    expect(wasCastKept(s.objects[id], 'p1')).toBe(true);
    const plain = scenario(['Forest'], { defs: [BEAST], p1: { battlefield: ['Test Patient Beast'] } });
    expect(charsOfObject(plain, plain.objects[find(plain, 'Test Patient Beast', 'battlefield', 'p1')]!).keywords.some((k) => k.keyword === 'haste')).toBe(false);
  });
  it('once its controller has changed, the haste is gone, also after it comes back (wasCast.kept)', () => {
    let s = board();
    s = drive(act(s, special(s, 'Test Patient Beast')!));
    s = upTo(mainOf(s, 'p2'), () => false);
    s = upTo(yes(s, true), (t) => t.zones.stack.length === 0);
    const id = find(s, 'Test Patient Beast', 'battlefield', 'p1');
    const lost = structuredClone(s);
    lost.objects[id]!.cast = { ...lost.objects[id]!.cast!, controlLost: true };
    expect(wasCastKept(lost.objects[id], 'p1')).toBe(false);
    expect(charsOfObject(lost, lost.objects[id]!).keywords.some((k) => k.keyword === 'haste')).toBe(false);
  });
});

describe('CR 701.6a, 608.2c: "Counter target spell if it\'s green." (eff.stdrx22.counter.if)', () => {
  const RUSH = card('Test Green Rush', 'Instant', 'You gain 2 life.', { cost: '{G}', colors: ['G'] });
  const FLARE = card('Test Red Flare', 'Instant', 'You gain 2 life.', { cost: '{R}', colors: ['R'] });
  const SNUB = card('Test Verdant Snub', 'Instant', "Counter target spell if it's green.", { cost: '{0}' });
  const board = (): GameState => scenario(['Forest', 'Mountain'], { defs: [RUSH, FLARE, SNUB], p1: { hand: ['Test Green Rush', 'Test Red Flare', 'Test Verdant Snub'], battlefield: ['Forest', 'Mountain'] } });
  const resolveStack = (s: GameState): GameState => upTo(s, (t) => t.zones.stack.length === 0);

  it('is full', () => expect(full(SNUB)).toBe(true));
  it('a green spell is countered: it never resolves', () => {
    let s = cast(board(), 'Test Green Rush');
    s = cast(s, 'Test Verdant Snub', [target(find(s, 'Test Green Rush', 'stack', 'p1'))]);
    s = resolveStack(s);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Test Green Rush');
  });
  it('a spell of another color can be the target, and is not countered (the condition is false as it resolves)', () => {
    let s = cast(board(), 'Test Red Flare');
    s = cast(s, 'Test Verdant Snub', [target(find(s, 'Test Red Flare', 'stack', 'p1'))]);
    s = resolveStack(s);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

describe('CR 605.1a, 605.3b, 119.3: a mana ability that also says "You gain 1 life."', () => {
  const IDOL = card('Test Life Idol', 'Artifact', '{T}: Add {C}. You gain 1 life.');
  it('activating it adds the mana and gains the life at once, without the stack', () => {
    expect(full(IDOL)).toBe(true);
    const s0 = scenario([], { defs: [IDOL], p1: { battlefield: ['Test Life Idol'] } });
    const idol = find(s0, 'Test Life Idol', 'battlefield', 'p1');
    const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === idol);
    expect(la).toBeDefined();
    const s = drive(act(s0, la!.action));
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(s.zones.stack).toEqual([]);
    expect(JSON.stringify(s.players.find((p) => p.id === 'p1')!.manaPool)).toContain('C');
    expect(s.objects[idol]!.tapped).toBe(true);
  });
});

describe('CR 614.12a, 607.2a: "As ~ enters, choose a color other than green." (rep.stdrx22.enters.choose.color.otherThan)', () => {
  const GATE = card('Test Prism Gate', 'Land — Gate', 'As this land enters, choose a color other than green.\n{T}: Add {G} or one mana of the chosen color.', { cost: null });
  it('the choice as it enters does not offer the excluded color, and the chosen color is linked to the mana ability', () => {
    expect(full(GATE)).toBe(true);
    const s0 = scenario([], { defs: [GATE], p1: { hand: ['Test Prism Gate'] } });
    const play = legalActions(s0, 'p1').find((a) => a.kind === 'playLand')!;
    const s1 = act(s0, play.action);
    expect(s1.pending?.kind).toBe('chooseColor');
    const ids = (s1.pending as { options: string[] }).options;
    expect([...ids].sort()).toEqual(['B', 'R', 'U', 'W']);
    const s = drive(answer(s1, { kind: 'chooseColor', color: 'U' } as DecisionAnswer));
    const gate = find(s, 'Test Prism Gate', 'battlefield', 'p1');
    expect(JSON.stringify({ chosen: s.objects[gate]!.chosen, links: s.objects[gate]!.links })).toContain('"U"');
  });
});

describe('CR 601.2i, 608.2h: "You gain 1 life for each spell you\'ve cast this turn."', () => {
  const TALLY = card('Test Tally', 'Instant', "You gain 1 life for each spell you've cast this turn.");
  const OTHER = card('Test Other', 'Instant', 'Draw a card.');
  it('counts the spells cast this turn, this one included', () => {
    let s = scenario(['Island'], { defs: [TALLY, OTHER], p1: { hand: ['Test Other', 'Test Tally'], library: lands('Island', 5) } });
    s = upTo(cast(s, 'Test Other'), (t) => t.zones.stack.length === 0);
    s = upTo(cast(s, 'Test Tally'), (t) => t.zones.stack.length === 0);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});
