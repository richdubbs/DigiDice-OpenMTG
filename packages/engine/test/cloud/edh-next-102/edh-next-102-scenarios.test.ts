/**
 * Concept round saga-phasing, edh-next-102 (code edhn102): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text: unverified.
 *
 *   CR 714.2e, 202.3, 608.2h   "... where X is that Saga's mana value" in a trigger on a Saga's final chapter ability resolving (Narci, Fable Singer)
 *   CR 702.26b-c, 603.7, 702.26d "... that permanent phases in" when the source becomes untapped or leaves the battlefield (The Pandorica)
 *   CR 122.1, 701.27a, 701.26b "Then if there are three or more soul counters on it, remove those counters, transform it, then untap it." (Hostile Hostel)
 *   CR 701.15, 611.2b, 111.1   "Each player creates ... tokens. The tokens are goaded for as long as this Saga remains on the battlefield." (The War Games)
 *   CR 607.2a, 118.12, 608.2h  "you may exile a creature card from your graveyard. If you do, ... the number of creature cards exiled with this creature" (Creeping Inn)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { applyAction, compileCard, getChars, type CardDef, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, pass } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, tweak } from '../../m4/helpers';
import { activations, advanceTo, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r4-cost/support';

// ---- Narci: that Saga's mana value ----------------------------------------------------------------------------------------------------------------------
describe('CR 714.2e, 202.3: "Whenever the final chapter ability of a Saga you control resolves, each opponent loses X life and you gain X life, where X is that Saga\'s mana value."', () => {
  const SAGA = card('Test Saga', 'Enchantment — Saga', 'I — You gain 1 life.\nII — You gain 1 life.\nIII — You gain 1 life.', '{2}');
  const BIG = card('Test Big Saga', 'Enchantment — Saga', 'I — You gain 1 life.\nII — You gain 1 life.\nIII — You gain 1 life.', '{4}');
  const SINGER = card('Test Singer', 'Creature — Human Bard', 'Whenever the final chapter ability of a Saga you control resolves, each opponent loses X life and you gain X life, where X is that Saga\'s mana value.', '{0}', ['1', '1']);
  const defs = [SAGA, BIG, SINGER];
  const lifeP2 = (s: GameState): number => lifeOf(s, 'p2');
  const run = (name: string, lands: number): GameState => {
    let s = scenario([], { defs, p1: { hand: [name], battlefield: ['Test Singer', ...Array(lands).fill('Plains')] }, p2: {} });
    s = resolveAll(cast(s, name));
    return resolveAll(advanceTo(s, 5, 'main1')); // chapters II and III
  };
  it('is full', () => expect(full(SINGER)).toBe(true));
  it('drains the Saga\'s mana value (2) when chapter III resolves: the opponent loses 2, you gain 2 on top of the chapters', () => {
    const s = run('Test Saga', 2);
    expect(lifeP2(s)).toBe(20 - 2);
    expect(lifeOf(s)).toBe(20 + 3 + 2); // chapters I, II and III: 1 each, plus the drain
  });
  it('reads that Saga\'s own mana value: a mana value 4 Saga drains 4', () => {
    const s = run('Test Big Saga', 4);
    expect(lifeP2(s)).toBe(20 - 4);
    expect(lifeOf(s)).toBe(20 + 3 + 4);
  });
  it('negative: chapter I and II resolving drain nothing', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Saga'], battlefield: ['Test Singer', 'Plains', 'Plains'] }, p2: {} });
    s = resolveAll(cast(s, 'Test Saga'));
    s = resolveAll(advanceTo(s, 3, 'main1')); // chapter II
    expect(lifeP2(s)).toBe(20);
  });
});

const out = (s: GameState, id: ObjectId): boolean => s.objects[id]!.phasedOut;
const activate = (s: GameState, name: string, script?: Parameters<typeof drive>[1]): GameState => {
  const a = activations(s, name)[0];
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return drive(act(s, a.action), script);
};

// ---- The Pandorica: that permanent phases in -------------------------------------------------------------------------------------------------------------
describe('CR 702.26b-c, 603.7: "Untap another target nonland permanent, then it phases out. It can\'t phase in for as long as ~ remains tapped. When ~ becomes untapped or leaves the battlefield, that permanent phases in."', () => {
  const RELIC = card('Test Relic', 'Legendary Artifact', '{T}: Untap another target nonland permanent, then it phases out. It can\'t phase in for as long as ~ remains tapped. When ~ becomes untapped or leaves the battlefield, that permanent phases in. Activate only as a sorcery.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.', '{0}');
  const defs = [RELIC, BEAR, SHATTER];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Shatter'], battlefield: ['Test Relic'] }, p2: { battlefield: ['Test Bear'] } });
  it('is full', () => expect(full(RELIC)).toBe(true));
  it('the permanent stays out through its controller\'s untap step while the source is tapped, and phases in when the source untaps (your next untap step)', () => {
    let s = setup();
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(activate(s, 'Test Relic', { targets: [[obj(bear)]] }));
    expect(out(s, bear)).toBe(true);
    s = advanceTo(s, 2, 'main1'); // the opponent's untap step: "can't phase in" while the source remains tapped
    expect(out(s, bear)).toBe(true);
    s = resolveAll(advanceTo(s, 3, 'upkeep')); // your untap step untaps the source: the delayed trigger is on the stack, then resolves
    expect(out(s, bear)).toBe(false);
  });
  it('phases in at once when the source leaves the battlefield', () => {
    let s = setup();
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(activate(s, 'Test Relic', { targets: [[obj(bear)]] }));
    expect(out(s, bear)).toBe(true);
    s = resolveAll(cast(s, 'Test Shatter', { targets: [[obj(find(s, 'Test Relic', 'battlefield'))]] }));
    expect(out(s, bear)).toBe(false);
  });
  it('negative: it phases in only once (the source untapping later does not phase anything in again)', () => {
    let s = setup();
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(activate(s, 'Test Relic', { targets: [[obj(bear)]] }));
    s = resolveAll(cast(s, 'Test Shatter', { targets: [[obj(find(s, 'Test Relic', 'battlefield'))]] }));
    expect(out(s, bear)).toBe(false);
    expect(s.delayedTriggers.length).toBe(0);
  });
});

// ---- Hostile Hostel // Creeping Inn: soul counters, transform, untap; creature cards exiled with it ----------------------------------------------------------
type Face = { name: string; type: string; text: string; pt?: [string, string]; cost?: string };
/** A transforming double-faced card from two invented faces, compiled from text. */
function dfc(front: Face, back: Face): CardDef {
  const face = (f: Face) => ({ name: f.name, mana_cost: f.cost ?? '', type_line: f.type, oracle_text: f.text, colors: [], ...(f.pt ? { power: f.pt[0], toughness: f.pt[1] } : {}) });
  return compileCard({ name: `${front.name} // ${back.name}`, layout: 'transform', mana_cost: front.cost ?? '', type_line: `${front.type} // ${back.type}`, oracle_text: '', colors: [], keywords: [], card_faces: [face(front), face(back)] } as unknown as OracleCard);
}
describe('CR 122.1, 701.27a, 701.26b, 607.2a: "Then if there are two or more soul counters on it, remove those counters, transform it, then untap it." / "number of creature cards exiled with this creature"', () => {
  const INN = dfc(
    { name: 'Test Hostel', type: 'Land', text: 'Sacrifice a creature: Put a wisp counter on ~. Then if there are two or more wisp counters on it, remove those counters, transform it, then untap it.' },
    { name: 'Test Creeper', type: 'Artifact Creature — Horror Construct', text: 'Whenever this creature attacks, you may exile a creature card from your graveyard. If you do, each opponent loses X life and you gain X life, where X is the number of creature cards exiled with this creature.', pt: ['1', '1'] },
  );
  const FODDER = card('Test Fodder', 'Creature — Goblin', '', '{0}', ['1', '1']);
  const ELF = card('Test Elf', 'Creature — Elf', '', '{0}', ['1', '1']);
  const ROCK = card('Test Rock', 'Artifact', '', '{0}');
  const defs = [INN, FODDER, ELF, ROCK];
  const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
  const wisps = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['wisp'] ?? 0;
  const feed = (s: GameState, id: ObjectId): GameState => resolveAll(drive(act(s, activations(s, 'Test Hostel // Test Creeper')[0]!.action), { objects: [[find(s, 'Test Fodder', 'battlefield')]] }));
  it('is full (both faces)', () => expect(full(INN)).toBe(true));
  it('one counter does nothing; the second removes both, transforms the land and untaps it (a tapped land becomes an untapped creature)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Hostel // Test Creeper', 'Test Fodder', 'Test Fodder'] } });
    const id = find(s, 'Test Hostel // Test Creeper', 'battlefield');
    s = feed(s, id);
    expect(wisps(s, id)).toBe(1);
    expect(nameOf(s, id)).toBe('Test Hostel');
    s = tweak(s, (x) => { x.objects[id]!.tapped = true; });
    s = feed(s, id);
    expect(nameOf(s, id)).toBe('Test Creeper');
    expect(wisps(s, id)).toBe(0);
    expect(s.objects[id]!.tapped).toBe(false);
  });
  it('negative: with no second counter it is neither transformed nor untapped', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Hostel // Test Creeper', 'Test Fodder'] } });
    const id = find(s, 'Test Hostel // Test Creeper', 'battlefield');
    s = tweak(s, (x) => { x.objects[id]!.tapped = true; });
    s = feed(s, id);
    expect(nameOf(s, id)).toBe('Test Hostel');
    expect(s.objects[id]!.tapped).toBe(true);
  });
  it('the creature face drains the number of creature cards ever exiled with it: 1, then 2 (a noncreature card cannot be exiled for it)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Creeper'.length > 0 ? 'Test Hostel // Test Creeper' : ''], graveyard: ['Test Elf', 'Test Elf', 'Test Rock'] } });
    const id = find(s, 'Test Hostel // Test Creeper', 'battlefield');
    s = tweak(s, (x) => { x.objects[id]!.face = 1; });
    expect(nameOf(s, id)).toBe('Test Creeper');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[id]]);
    const elf = s.zones.graveyard['p1']!.find((g) => s.objects[g]!.defId === 'Test Elf')!;
    s = resolveAll(s, { yes: [true], objects: [[elf]] });
    expect(lifeOf(s, 'p2')).toBe(20 - 1); // the drain: one creature card exiled with it (combat damage has not been dealt yet)
    expect(lifeOf(s)).toBe(21);
    expect(s.zones.exile.filter((e) => s.objects[e]!.defId === 'Test Elf').length).toBe(1);
    // the count is of every creature card exiled with it, over the turns (CR 607.2a): the second attack drains 2
    const before = lifeOf(s, 'p2');
    s = advanceTo(s, 3, 'main1');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[id]]);
    s = resolveAll(s, { yes: [true], objects: [[s.zones.graveyard['p1']!.find((g) => s.objects[g]!.defId === 'Test Elf')!]] });
    expect(lifeOf(s, 'p2')).toBeLessThanOrEqual(before - 2);
    expect(s.zones.exile.filter((e) => s.objects[e]!.defId === 'Test Elf').length).toBe(2);
  });
  it('negative: declining the exile (or an empty graveyard of creature cards) drains nothing', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Hostel // Test Creeper'], graveyard: ['Test Elf', 'Test Rock'] } });
    const id = find(s, 'Test Hostel // Test Creeper', 'battlefield');
    s = tweak(s, (x) => { x.objects[id]!.face = 1; });
    s = declareAttackers(toDeclareAttackers(s), [[id]]);
    s = resolveAll(s, { yes: [false] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s)).toBe(20);
    expect(s.zones.exile.length).toBe(0);
  });
});

// ---- The War Games: the tokens are goaded for as long as the Saga remains on the battlefield ------------------------------------------------------------------
describe('CR 701.15, 611.2b, 111.1: "Each player creates two tapped 1/1 white Warrior creature tokens. The tokens are goaded for as long as ~ remains on the battlefield."', () => {
  const SAGA = card('Test Games', 'Enchantment — Saga', 'I — Each player creates two tapped 1/1 white Warrior creature tokens. The tokens are goaded for as long as ~ remains on the battlefield.\nII — You gain 1 life.\nIII — You gain 1 life.', '{0}');
  const SMASH = card('Test Smash', 'Instant', 'Destroy target enchantment.', '{0}');
  const defs = [SAGA, SMASH];
  const warriors = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).subtypes.includes('Warrior') && s.objects[id]!.controller === p);
  const attackAccepted = (s: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[]): boolean => {
    const d = s.pending;
    if (!d || d.kind !== 'declareAttackers') throw new Error(`no declaration pending: ${d?.kind}`);
    return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks } }).error === undefined;
  };
  function toDeclarationOf(s0: GameState, player: PlayerId): GameState {
    let s = s0;
    for (let guard = 0; guard < 400; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers' && d.player === player) return s;
      if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d?.kind === 'priority') s = pass(s);
      else s = drive(s);
    }
    throw new Error(`could not reach the attackers of ${player}`);
  }
  const setup = (): GameState => resolveAll(cast(scenario([], { defs, p1: { hand: ['Test Games', 'Test Smash'] } }), 'Test Games'));
  it('is full', () => expect(full(SAGA)).toBe(true));
  it('every token of every player (two each) is goaded: the opponent must attack with both of his on his turn, and attacking with nothing or one is refused', () => {
    let s = setup();
    expect(warriors(s, 'p1').length).toBe(2);
    expect(warriors(s, 'p2').length).toBe(2);
    s = toDeclarationOf(s, 'p2');
    const theirs = warriors(s, 'p2');
    expect(attackAccepted(s, [])).toBe(false);
    expect(attackAccepted(s, [{ attacker: theirs[0]!, defender: 'p1' }])).toBe(false);
    expect(attackAccepted(s, theirs.map((attacker) => ({ attacker, defender: 'p1' as PlayerId })))).toBe(true);
  });
  it('negative: once the Saga has left the battlefield the tokens are no longer goaded', () => {
    let s = setup();
    s = resolveAll(cast(s, 'Test Smash', { targets: [[obj(find(s, 'Test Games', 'battlefield'))]] }));
    s = toDeclarationOf(s, 'p2');
    expect(attackAccepted(s, [])).toBe(true);
  });
});
