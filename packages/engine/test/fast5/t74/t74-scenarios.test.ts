/**
 * FAST5 T74 (another player searches for basic lands): the shapes of parser/templates/zz-fast5/t74.json played through applyAction with synthetic cards compiled by the
 * game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 701.23a, 701.23b   a search looks through the library of the player searching; the searcher may find fewer cards than asked for (a hidden zone, a stated quality)
 *   CR 608.2d             "its controller may search": the choice is the searching player's own, not the caster's
 *   CR 608.2h, 400.7      "its controller" is the controller the destroyed or exiled permanent had (last known information)
 *   CR 110.2              what a player puts onto the battlefield is under that player's control, tapped when the text says so
 *   CR 608.2c, 608.2h     "that many": the number of cards the earlier instruction exiled
 *   CR 119.1, 119.3       "target player gains N life, then searches their library ...": the target gains the life, then searches (no choice to decline)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const full = (d: CardDef): boolean => d.automation.level === 'full' && manualParts(d).length === 0;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const tgtPlayer = (id: string): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => nameOf(s, id)).sort();
const onBattlefield = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Answer the decisions that come up: costs automatically, targets from the queue, object choices by `pick`, yes/no with `yes`; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], pick: (ids: ObjectId[], d: { min: number; max: number }) => ObjectId[] = (ids, d) => ids.slice(0, d.min), yes = true): GameState {
  let s = s0;
  const queue = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(d.options, d) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else break;
  }
  return s;
}
type Pick = Parameters<typeof settle>[2];
function resolveAll(s0: GameState, targets: TargetChoice[][] = [], pick?: Pick, yes = true): GameState {
  let s = settle(s0, targets, pick, yes);
  for (let guard = 0; guard < 60; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, [], pick, yes);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)}`);
}
const castFirst = (s0: GameState, name: string, targets: TargetChoice[][] = [], pick?: Pick, yes = true): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.slice(0, 1), pick, yes), targets.slice(1), pick, yes);
/** Cast and stop at the first decision that is not a cost or a target choice. */
function castUntilDecision(s0: GameState, name: string, targets: TargetChoice[][] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  const queue = [...targets];
  for (let guard = 0; guard < 20; guard++) {
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}

const BEAR = 'Grizzly Bears';
const GATE = card('Test Gate', 'Land — Gate', '');

describe('CR 701.23a, 608.2d, 608.2h, 110.2: "Destroy target creature. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle."', () => {
  const ERODE = card('Test Erode', 'Instant', 'Destroy target creature. Its controller may search their library for a basic Forest card, put it onto the battlefield tapped, then shuffle.');
  it('is automated (no manual part)', () => expect(manualParts(ERODE)).toEqual([]));
  it("the creature's controller (not the caster) is asked, and may find only a basic Forest of THEIR library; it enters tapped under THEIR control", () => {
    const s0 = scenario([BEAR, 'Forest', 'Mountain'], { p1: { hand: ['Test Erode'], library: ['Forest'] }, p2: { battlefield: [BEAR], library: [BEAR, 'Mountain', 'Forest', 'Test Gate'] }, defs: [ERODE, GATE] });
    const bear = find(s0, BEAR, 'battlefield', 'p2');
    let s = castUntilDecision(s0, 'Test Erode', [[obj(bear)]]);
    // the may decision belongs to the creature's controller
    expect(s.pending?.kind).toBe('yesNo');
    expect((s.pending as { player: string }).player).toBe('p2');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { player: string }).player).toBe('p2');
    const options = (s.pending as { options: ObjectId[] }).options;
    expect(names(s, options)).toEqual(['Forest']); // not the Bears, the Mountain or the Gate
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [options[0]!] }));
    const forests = onBattlefield(s, 'p2').filter((id) => nameOf(s, id) === 'Forest');
    expect(forests).toHaveLength(1);
    expect(s.objects[forests[0]!]!.tapped).toBe(true);
    expect(onBattlefield(s, 'p1').filter((id) => nameOf(s, id) === 'Forest')).toHaveLength(0);
    expect(s.zones.library['p1']!.map((id) => nameOf(s, id))).toContain('Forest'); // the caster's library is untouched
    expect(s.zones.graveyard['p2']!.some((id) => nameOf(s, id) === BEAR)).toBe(true);
  });
  it('the controller may decline: nothing is found and no basic land enters', () => {
    const s0 = scenario([BEAR, 'Forest'], { p1: { hand: ['Test Erode'] }, p2: { battlefield: [BEAR], library: ['Forest'] }, defs: [ERODE] });
    const bear = find(s0, BEAR, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Erode', [[obj(bear)]], undefined, false);
    expect(onBattlefield(s, 'p2')).toHaveLength(0);
    expect(s.zones.library['p2']).toHaveLength(s0.zones.library['p2']!.length); // nothing was taken from it
  });
});

describe('CR 701.23a, 608.2h, 110.2: "Destroy target land. That land\'s controller may search their library for a basic land card, put it onto the battlefield, then shuffle." (untapped) and "You may search your library ..."', () => {
  const FIELD = card('Test Field', 'Instant', "Destroy target land. That land's controller may search their library for a basic land card, put it onto the battlefield, then shuffle. You may search your library for a basic land card, put it onto the battlefield, then shuffle.");
  it('is automated (no manual part)', () => expect(manualParts(FIELD)).toEqual([]));
  it("each player finds from their own library: the land's controller gets an untapped basic land, the caster another one (their own choice each)", () => {
    const s0 = scenario(['Forest', 'Plains'], { p1: { hand: ['Test Field'], library: ['Plains'] }, p2: { battlefield: ['Forest'], library: ['Forest'] }, defs: [FIELD] });
    const land = find(s0, 'Forest', 'battlefield', 'p2');
    let s = castUntilDecision(s0, 'Test Field', [[obj(land)]]);
    const players: string[] = [];
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const d = s.pending as { kind: string; player: string; options?: ObjectId[] };
      players.push(`${d.kind}:${d.player}`);
      s = d.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes: true }) : answer(s, { kind: 'chooseObjects', ids: [d.options![0]!] });
    }
    s = resolveAll(s);
    expect(players).toEqual(['yesNo:p2', 'chooseObjects:p2', 'yesNo:p1', 'chooseObjects:p1']);
    const lands = (p: string): ObjectId[] => onBattlefield(s, p).filter((id) => nameOf(s, id) === 'Forest' || nameOf(s, id) === 'Plains');
    expect(names(s, lands('p2'))).toEqual(['Forest']); // the destroyed Forest went to the graveyard; the one found came in
    expect(s.objects[lands('p2')[0]!]!.tapped).toBe(false);
    expect(names(s, lands('p1'))).toEqual(['Plains']);
    expect(s.objects[lands('p1')[0]!]!.tapped).toBe(false);
  });
});

describe('CR 701.23a, 608.2h, 110.2: "That player may search their library for a basic land card, put it onto the battlefield, then shuffle." (the player of an earlier target)', () => {
  const FAULT = card('Test Fault', 'Instant', 'Destroy target land an opponent controls. That player may search their library for a basic land card, put it onto the battlefield, then shuffle.');
  it('is automated (no manual part)', () => expect(manualParts(FAULT)).toEqual([]));
  it('is the opponent who controlled the land (not the caster) who searches', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Fault'] }, p2: { battlefield: ['Forest'], library: ['Forest'] }, defs: [FAULT] });
    const land = find(s0, 'Forest', 'battlefield', 'p2');
    const s = castUntilDecision(s0, 'Test Fault', [[obj(land)]]);
    expect(s.pending?.kind).toBe('yesNo');
    expect((s.pending as { player: string }).player).toBe('p2');
  });
});

describe('CR 701.23b, 608.2c, 608.2h: "Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle."', () => {
  const WRECK = card('Test Wreckage', 'Instant', 'Exile all attacking creatures target player controls. That player may search their library for that many basic Forest cards, put those cards onto the battlefield tapped, then shuffle.', '{0}');
  it('is automated (no manual part)', () => expect(manualParts(WRECK)).toEqual([]));
  it('the attacking player finds up to as many basic lands as creatures were exiled, tapped; the defender who cast it gets none', () => {
    const s0 = scenario([BEAR, 'Forest'], {
      p1: { battlefield: [BEAR, BEAR, BEAR], library: ['Forest', 'Forest', 'Forest', 'Forest', BEAR] },
      p2: { hand: ['Test Wreckage'] },
      defs: [WRECK],
    });
    const bears = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1' && nameOf(s0, id) === BEAR);
    let s = declareAttackers(toDeclareAttackers(s0), [[bears[0]!], [bears[1]!]]); // two of the three attack
    // the active player passes priority; the defending player casts it
    for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.pending.player !== 'p2'; i++) s = pass(s);
    expect(s.pending?.kind).toBe('priority');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Wreckage', 'hand', 'p2') }), [[tgtPlayer('p1')]]);
    // resolve: both players pass
    s = pass(s);
    s = pass(s);
    // the attacking player (p1) is asked
    expect(s.pending?.kind).toBe('yesNo');
    expect((s.pending as { player: string }).player).toBe('p1');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending?.kind).toBe('chooseObjects');
    const d = s.pending as unknown as { player: string; min: number; max: number; options: ObjectId[] };
    expect(d.player).toBe('p1');
    expect(d.max).toBe(2); // two attacking creatures were exiled (the third stayed home)
    expect(d.min).toBe(0); // the searcher may find fewer (CR 701.23b)
    expect(names(s, d.options)).toEqual(['Forest', 'Forest', 'Forest', 'Forest']);
    s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, 2) });
    const forests = onBattlefield(s, 'p1').filter((id) => nameOf(s, id) === 'Forest');
    expect(forests).toHaveLength(2);
    expect(forests.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(onBattlefield(s, 'p1').filter((id) => nameOf(s, id) === BEAR)).toHaveLength(1); // only the non-attacker stayed
    expect(s.zones.exile.filter((id) => nameOf(s, id) === BEAR)).toHaveLength(2);
    expect(onBattlefield(s, 'p2').filter((id) => nameOf(s, id) === 'Forest')).toHaveLength(0);
  });
  it('finding fewer than that many is allowed (the searcher chooses none)', () => {
    const s0 = scenario([BEAR, 'Forest'], { p1: { battlefield: [BEAR], library: ['Forest'] }, p2: { hand: ['Test Wreckage'] }, defs: [WRECK] });
    const bear = find(s0, BEAR, 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[bear]]);
    for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.pending.player !== 'p2'; i++) s = pass(s);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Wreckage', 'hand', 'p2') }), [[tgtPlayer('p1')]]);
    s = pass(pass(s));
    s = answer(s, { kind: 'yesNo', yes: true });
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(onBattlefield(s, 'p1').filter((id) => nameOf(s, id) === 'Forest')).toHaveLength(0);
  });
});

describe('CR 119.1, 701.23a, 110.2: "Target player gains 2 life, then searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles."', () => {
  const TECH = card('Test Technique', 'Sorcery', 'Target player gains 2 life, then searches their library for a basic Forest card, puts it onto the battlefield tapped, then shuffles.');
  it('is automated (no manual part)', () => expect(manualParts(TECH)).toEqual([]));
  it('the target player (here the opponent) gains the life, finds a basic land from THEIR library (no may) and it enters tapped under their control', () => {
    const s0 = scenario(['Forest', BEAR], { p1: { hand: ['Test Technique'], library: ['Forest'] }, p2: { library: [BEAR, 'Forest'] }, defs: [TECH] });
    const life = lifeOf(s0, 'p2');
    let s = castUntilDecision(s0, 'Test Technique', [[tgtPlayer('p2')]]);
    expect(s.pending?.kind).toBe('chooseObjects'); // no "may": straight to the search
    const d = s.pending as unknown as { player: string; options: ObjectId[] };
    expect(d.player).toBe('p2');
    expect(names(s, d.options)).toEqual(['Forest']);
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [d.options[0]!] }));
    expect(lifeOf(s, 'p2')).toBe(life + 2);
    const forests = onBattlefield(s, 'p2').filter((id) => nameOf(s, id) === 'Forest');
    expect(forests).toHaveLength(1);
    expect(s.objects[forests[0]!]!.tapped).toBe(true);
    expect(onBattlefield(s, 'p1')).toHaveLength(0);
  });
  it('is the caster who gains and searches when they target themselves', () => {
    const s0 = scenario(['Forest', BEAR], { p1: { hand: ['Test Technique'], library: ['Forest', BEAR] }, defs: [TECH] });
    const life = lifeOf(s0, 'p1');
    let s = castUntilDecision(s0, 'Test Technique', [[tgtPlayer('p1')]]);
    const d = s.pending as unknown as { player: string; options: ObjectId[] };
    expect(d.player).toBe('p1');
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [d.options[0]!] }));
    expect(lifeOf(s, 'p1')).toBe(life + 2);
    expect(onBattlefield(s, 'p1').filter((id) => nameOf(s, id) === 'Forest')).toHaveLength(1);
  });
});

describe('CR 608.2b, 608.2h: "Destroy up to one target land. Its controller may search ..." with no target chosen', () => {
  const PHANTOM = card('Test Phantom', 'Instant', 'Destroy up to one target land. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.');
  it('is automated and, with no target, nobody is asked and nothing is found', () => {
    expect(manualParts(PHANTOM)).toEqual([]);
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Phantom'] }, p2: { battlefield: ['Forest'], library: ['Forest'] }, defs: [PHANTOM] });
    const s = castFirst(s0, 'Test Phantom', [[]]);
    expect(s.pending?.kind).toBe('priority');
    expect(onBattlefield(s, 'p2').map((id) => nameOf(s, id))).toEqual(['Forest']); // the land stayed, nothing else came
    expect(s.zones.library['p2']).toHaveLength(s0.zones.library['p2']!.length);
  });
});

describe('the synthetic wordings of the family are fully automated', () => {
  it('synthetic wordings are full', () => {
    for (const d of [
      card('Test Erode', 'Instant', 'Destroy target creature or planeswalker. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.'),
      card('Test Wreckage', 'Instant', 'Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle.'),
      card('Test Technique', 'Sorcery', 'Target player gains 2 life, then searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles.'),
    ]) expect(full(d), d.name).toBe(true);
  });
});
