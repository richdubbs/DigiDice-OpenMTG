/**
 * Lane std-cardcopy, round std-cardcopy-1, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c            "If C, draw a card and repeat this process.": the whole effect runs again for as long as the condition holds after a run
 *   CR 205.2a, 105.2     "two cards that share a card type / a color were milled this way": a card type or a color in common (a colorless card has none)
 *   CR 607.2a, 707.2     "a creature card exiled with ~": one of the cards the linked exile put there, chosen as the effect begins, never a target
 *   CR 611.2b            "for as long as ~ remains attached to it": the copy effect ends when the Equipment moves to another creature
 *   CR 205.3j, 115.1     "target instant, sorcery, and/or Gideon planeswalker cards": a planeswalker card with that subtype, or an instant or sorcery card
 *   CR 707.12, 608.2g    "Copy them. You may cast any number of the copies.": a copy of each exiled card, each cast or not
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
/** No ability of the card is manual, at any depth. */
const noManual = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const names = (s: GameState, zone: 'graveyard' | 'hand' | 'library', p: string): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const byHandLog = (s: GameState): boolean => s.log.some((l) => /by hand/.test(l.text));

/** Answer the decisions in order (mana is paid automatically, targets from `targets`); stops at priority or at a decision with no answer left. */
function drive(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order' && queue[0]?.kind !== 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (s.pending.kind === 'chooseTargets' && tq.length > 0) s = answer(s, { kind: 'chooseTargets', targets: tq.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty, answering decisions on the way. */
function resolveAll(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 80; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else {
      const before = s;
      s = drive(s, queue.splice(0, 1));
      if (s === before) break;
    }
  }
  return s;
}
function castAt(s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  return resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), [], targets), answers);
}
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  const la = legalActions(s0, s0.pending!.player).find((a) => a.kind === 'activate' && !a.isMana && a.object === source);
  if (!la) throw new Error(`no activation of ${nameOf(s0, source)}`);
  return resolveAll(drive(act(s0, la.action), [], targets), answers);
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const GIANT = card('Test Giant', 'Creature — Giant', 'Trample', { pt: ['4', '6'], colors: ['R'] });
const HERO = card('Test Hero', 'Creature — Human Knight', 'Vigilance', { pt: ['3', '3'], colors: ['W'] });
const EMBER = card('Test Ember', 'Instant', 'Test Ember deals 1 damage to any target.', { colors: ['R'] });
const FLARE = card('Test Flare', 'Sorcery', 'Test Flare deals 2 damage to any target.', { colors: ['R'] });
const TIDE = card('Test Tide', 'Instant', 'Draw a card.', { colors: ['U'] });
const TRINKET = card('Test Trinket', 'Artifact', '');
const COMMON = [BEAR, GIANT, HERO, EMBER, FLARE, TIDE, TRINKET];

describe('CR 608.2c, 105.2: "Target player mills two cards. If two cards that share a color were milled this way, repeat this process." (eff.stdcardcopy1.repeatProcess.again)', () => {
  const WHEEL = card('Test Wheel', 'Artifact', '{1}, {T}: Target player mills two cards. If two cards that share a color were milled this way, repeat this process.');
  const defs = [...COMMON, WHEEL];
  it('has no manual part', () => expect(noManual(WHEEL)).toBe(true));
  it('a red pair runs it again; a red and blue pair stops it (four cards milled)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wheel', 'Plains'] }, p2: { library: ['Test Ember', 'Test Flare', 'Test Tide', 'Test Giant', 'Test Ember'] }, defs });
    const s = activate(s0, find(s0, 'Test Wheel', 'battlefield', 'p1'), [[player('p2')]]);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Ember', 'Test Flare', 'Test Tide', 'Test Giant']);
    expect(names(s, 'library', 'p2')[0]).toBe('Test Ember');
    expect(byHandLog(s)).toBe(false);
  });
  it('the negative case: a first pair of two colors stops it at once (two cards milled)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wheel', 'Plains'] }, p2: { library: ['Test Tide', 'Test Ember', 'Test Flare', 'Test Giant'] }, defs });
    const s = activate(s0, find(s0, 'Test Wheel', 'battlefield', 'p1'), [[player('p2')]]);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Tide', 'Test Ember']);
  });
  it('CR 105.2c: two colorless cards share no color (a Trinket and a Plains stop it)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Wheel', 'Plains'] }, p2: { library: ['Test Trinket', 'Plains', 'Test Ember', 'Test Flare'] }, defs });
    const s = activate(s0, find(s0, 'Test Wheel', 'battlefield', 'p1'), [[player('p2')]]);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Trinket', 'Plains']);
  });
});

describe('CR 608.2c, 205.2a: "Mill two cards. If two cards that share a card type were milled this way, draw a card and repeat this process." (eff.stdcardcopy1.repeatProcess.again)', () => {
  const STUDY = card('Test Study', 'Sorcery', 'Mill two cards. If two cards that share a card type were milled this way, draw a card and repeat this process.');
  const defs = [...COMMON, STUDY];
  it('has no manual part', () => expect(noManual(STUDY)).toBe(true));
  it('two creatures: draw and run it again (the draw takes the next card); an artifact and a creature then stop it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Study'], library: ['Test Bear', 'Test Giant', 'Test Tide', 'Test Trinket', 'Test Hero', 'Test Ember'] }, defs });
    const s = castAt(s0, 'Test Study');
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Bear', 'Test Giant', 'Test Trinket', 'Test Hero', 'Test Study']);
    expect(names(s, 'hand', 'p1')).toEqual(['Test Tide']);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Ember');
  });
  it('the negative case: an instant and a sorcery share no card type, so nothing is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Study'], library: ['Test Ember', 'Test Flare', 'Test Tide'] }, defs });
    const s = castAt(s0, 'Test Study');
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'library', 'p1')[0]).toBe('Test Tide');
  });
});

describe('CR 607.2a, 707.2, 611.2b: "... for as long as ~ remains attached to it, that creature becomes a copy of a creature card exiled with ~." (eff.stdcardcopy1.dur.becomeCopy.linkedCard)', () => {
  const MASK = card('Test Mask', 'Artifact — Equipment', 'When this Equipment enters, exile up to one target creature until this Equipment leaves the battlefield.\nWhenever this Equipment becomes attached to a creature, for as long as this Equipment remains attached to it, that creature becomes a copy of a creature card exiled with this Equipment.\nEquip {0}');
  const defs = [...COMMON, MASK];
  it('has no manual part', () => expect(noManual(MASK)).toBe(true));
  const setup = (target: boolean): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Mask'], battlefield: ['Test Bear', 'Test Hero'] }, p2: { battlefield: ['Test Giant'] }, defs });
    return castAt(s0, 'Test Mask', [], [{ kind: 'chooseTargets', targets: target ? [obj(find(s0, 'Test Giant', 'battlefield', 'p2'))] : [] }]);
  };
  const mask = (s: GameState): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Mask')!;
  const equip = (s: GameState, to: ObjectId): GameState => {
    const la = legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && a.object === mask(s));
    return resolveAll(drive(act(s, la!.action), [], [[obj(to)]]));
  };
  it('the equipped Bear becomes a Giant copy; moved to the Hero, the Bear is a Bear again and the Hero is the Giant', () => {
    let s = setup(true);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Giant']);
    const bear = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear')!;
    const hero = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Hero')!;
    s = equip(s, bear);
    expect(nameOf(s, bear)).toBe('Test Giant');
    expect([getChars(s, bear).power, getChars(s, bear).toughness]).toEqual(['4', '6']);
    s = equip(s, hero);
    expect(nameOf(s, bear)).toBe('Test Bear');
    expect(nameOf(s, hero)).toBe('Test Giant');
    expect(byHandLog(s)).toBe(false);
  });
  it('the negative case: with no creature card exiled with it, the equipped creature stays itself', () => {
    let s = setup(false);
    const bear = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear')!;
    s = equip(s, bear);
    expect(nameOf(s, bear)).toBe('Test Bear');
  });
});

describe('CR 205.3j, 115.1, 707.12: "Exile any number of target instant, sorcery, and/or Gideon planeswalker cards from your graveyard. Copy them. You may cast any number of the copies."', () => {
  const GIDEON = card('Test Gideon', 'Legendary Planeswalker — Gideon', '+1: You gain 1 life.', { loyalty: '3' });
  const JACE = card('Test Jace', 'Legendary Planeswalker — Jace', '+1: Draw a card.', { loyalty: '3' });
  const RECALL = card('Test Recall', 'Sorcery', 'Exile any number of target instant, sorcery, and/or Gideon planeswalker cards from your graveyard. Copy them. You may cast any number of the copies.');
  const defs = [...COMMON, GIDEON, JACE, RECALL];
  it('has no manual part', () => expect(noManual(RECALL)).toBe(true));
  it('a Gideon planeswalker card and an instant card are legal targets; a Jace planeswalker card and a creature card are not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Recall'], graveyard: ['Test Gideon', 'Test Ember', 'Test Jace', 'Test Bear'] }, defs });
    const ok = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Recall', 'hand') }), [], [[obj(find(s0, 'Test Gideon', 'graveyard', 'p1')), obj(find(s0, 'Test Ember', 'graveyard', 'p1'))]]);
    expect(ok.zones.stack.length).toBe(1);
    for (const bad of ['Test Jace', 'Test Bear']) {
      expect(() => drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Recall', 'hand') }), [], [[obj(find(s0, bad, 'graveyard', 'p1'))]]), bad).toThrow();
    }
  });
  it('the copy of the Gideon card is cast (a token planeswalker); the instant copy is not cast and ceases to exist', () => {
    const s0 = scenario([], { p1: { hand: ['Test Recall'], graveyard: ['Test Gideon', 'Test Ember'], battlefield: ['Plains'] }, defs });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Recall', 'hand') }), [], [[obj(find(s0, 'Test Gideon', 'graveyard', 'p1')), obj(find(s0, 'Test Ember', 'graveyard', 'p1'))]]);
    for (let i = 0; i < 10 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = pass(s);
    for (let i = 0; i < 8 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: /Gideon/.test((s.pending as unknown as { prompt: string }).prompt) });
      else s = drive(s);
    }
    s = resolveAll(s);
    const pw = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Gideon');
    expect(pw.length).toBe(1);
    expect(s.objects[pw[0]!]!.kind).toBe('token');
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Ember', 'Test Gideon']);
    expect(s.zones.exile.every((id) => s.objects[id]!.kind === 'card')).toBe(true);
  });
});
