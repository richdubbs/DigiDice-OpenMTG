/**
 * std-rw7 (card wave 2, slice s7): the readings of parser/templates/zz-cloud/std-rw7.json played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2g, 118.9, 305.9   "you may cast a sorcery spell with mana value 2 or less from your hand without paying its mana cost" (one card of the description in
 *                             your hand, cast during the resolution for free; a land, a bigger spell or another type is never offered)
 *   CR 608.2g, 601.2f         "you may cast an artifact, instant, or sorcery spell from your graveyard" (one card of your graveyard, cast paying its costs)
 *   CR 614.1a, 205.2a         "If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead." (a sorcery cast this way is
 *                             exiled; an artifact spell cast this way and countered goes to the graveyard as usual)
 *   CR 608.2g, 608.2h         "Counter target spell. You may cast a spell that shares a card type with that spell from your hand ..." (the countered spell as it
 *                             last existed on the stack decides what is offered)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer what comes up until priority: the card choice picks `pick` when offered (recording what was offered), targets `targets`, payments automatic. */
function settle(s0: GameState, o: { pick?: string; offered?: string[][]; targets?: ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (o.targets ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseObjects') {
      const names = p.options.map((id) => s.defs[s.objects[id]!.defId]!.name);
      o.offered?.push(names);
      const want = p.options.find((id) => s.defs[s.objects[id]!.defId]!.name === o.pick);
      s = answer(s, { kind: 'chooseObjects', ids: want !== undefined ? [want] : p.options.slice(0, p.min) });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Both players pass until the stack is empty, answering as `settle` does. */
function drain(s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), o);
  return s;
}
const castP1 = (s: GameState, name: string, o: Parameters<typeof settle>[1] = {}): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);

const RITE = card('Test Rite', 'Sorcery', 'You gain 3 life.', { cost: '{1}' });
const BIG_RITE = card('Test Big Rite', 'Sorcery', 'You gain 5 life.', { cost: '{3}' });
const QUICK = card('Test Quick', 'Instant', 'You gain 1 life.', { cost: '{1}' });

describe('CR 608.2g, 118.9, 305.9: "you may cast a sorcery spell with mana value 2 or less from your hand without paying its mana cost" (eff.stdrw7.cast.fromHand.free)', () => {
  const ENVOY = card('Test Envoy', 'Creature — Human Wizard', 'When this creature enters, you may cast a sorcery spell with mana value 2 or less from your hand without paying its mana cost.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(ENVOY)).toBe(true));
  it('a sorcery of mana value 1 in your hand: offered, cast with no mana spent, and it resolves', () => {
    const offered: string[][] = [];
    const s0 = scenario([], { defs: [ENVOY, RITE, BIG_RITE, QUICK], p1: { hand: ['Test Envoy', 'Test Rite', 'Test Big Rite', 'Test Quick', 'Plains'] } });
    const before = life(s0, 'p1');
    const s = drain(castP1(s0, 'Test Envoy'), { pick: 'Test Rite', offered });
    expect(life(s, 'p1')).toBe(before + 3);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Rite']);
    // only the sorcery of mana value 2 or less: not the bigger sorcery, not the instant, never the land (CR 305.9)
    expect(offered).toEqual([['Test Rite']]);
  });
  it('no card of the description: nothing is offered and nothing is cast', () => {
    const offered: string[][] = [];
    const s0 = scenario([], { defs: [ENVOY, BIG_RITE, QUICK], p1: { hand: ['Test Envoy', 'Test Big Rite', 'Test Quick'] } });
    const before = life(s0, 'p1');
    const s = drain(castP1(s0, 'Test Envoy'), { pick: 'Test Big Rite', offered });
    expect(offered.flat()).toEqual([]);
    expect(life(s, 'p1')).toBe(before);
    expect(zoneNames(s, 'hand', 'p1').sort()).toEqual(['Test Big Rite', 'Test Quick']);
  });
  it('the option declined (no card chosen): the sorcery stays in your hand', () => {
    const s0 = scenario([], { defs: [ENVOY, RITE], p1: { hand: ['Test Envoy', 'Test Rite'] } });
    const before = life(s0, 'p1');
    const s = drain(castP1(s0, 'Test Envoy'), {});
    expect(life(s, 'p1')).toBe(before);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Rite']);
  });
});

describe('CR 608.2g, 601.2f, 614.1a: "you may cast an artifact, instant, or sorcery spell from your graveyard. If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead."', () => {
  const ROGUE = card('Test Rogue', 'Creature — Halfling Rogue', 'When this creature enters, you may cast an artifact, instant, or sorcery spell from your graveyard. If an instant or sorcery spell cast this way would be put into your graveyard, exile it instead.', { pt: ['1', '1'] });
  const RELIC = card('Test Relic', 'Artifact', '', { cost: '{1}' });
  const BEAST = card('Test Beast', 'Creature — Beast', '', { pt: ['2', '2'], cost: '{1}' });
  const DENY = card('Test Deny', 'Instant', 'Counter target spell.');
  it('is understood', () => expect(noManual(ROGUE)).toBe(true));
  it('a sorcery in your graveyard: cast paying {1}, it resolves and is exiled instead of going to your graveyard', () => {
    const offered: string[][] = [];
    const s0 = scenario([], { defs: [ROGUE, RITE, BEAST], p1: { hand: ['Test Rogue'], graveyard: ['Test Rite', 'Test Beast'], battlefield: ['Plains'] } });
    const before = life(s0, 'p1');
    const s = drain(castP1(s0, 'Test Rogue'), { pick: 'Test Rite', offered });
    expect(life(s, 'p1')).toBe(before + 3);
    expect(findAll(s, 'Test Rite', 'exile', 'p1')).toHaveLength(1);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Beast']);
    // a creature card is never offered (only artifact, instant or sorcery cards), and the Plains paid for it (CR 601.2g-h)
    expect(offered).toEqual([['Test Rite']]);
    expect(s.objects[find(s, 'Plains', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
  /** Cast the Rogue, let it resolve and its trigger resolve, picking `pick`: the card cast this way is on the stack, p2 has priority, then p2 counters it. */
  function castThenCounter(pick: string, graveyard: string[]): GameState {
    const s0 = scenario(['Island'], { defs: [ROGUE, RITE, RELIC, DENY], p1: { hand: ['Test Rogue'], graveyard, battlefield: ['Plains'] }, p2: { hand: ['Test Deny'] } });
    let s = settle(pass(pass(castP1(s0, 'Test Rogue')))); // the Rogue resolves; its trigger goes on the stack
    s = settle(pass(pass(s)), { pick }); // the trigger resolves: the card is cast (CR 608.2g), p1 has priority
    const spell = s.zones.stack.find((id) => s.defs[s.objects[id]!.defId]!.name === pick)!;
    expect(spell, 'the card cast this way is on the stack').toBeDefined();
    s = pass(s); // p2 has priority
    return drain(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Deny', 'hand', 'p2') }), { targets: [spell] }));
  }
  it('an artifact cast this way and countered goes to your graveyard (the replacement is of instant and sorcery spells only, CR 614.1a)', () => {
    const s = castThenCounter('Test Relic', ['Test Relic']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Relic']);
    expect(findAll(s, 'Test Relic', 'exile', 'p1')).toHaveLength(0);
  });
  it('a sorcery cast this way and countered is exiled instead', () => {
    const s = castThenCounter('Test Rite', ['Test Rite']);
    expect(findAll(s, 'Test Rite', 'exile', 'p1')).toHaveLength(1);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
  });
});

describe('CR 608.2g, 608.2h: "Counter target spell. You may cast a spell that shares a card type with that spell from your hand without paying its mana cost."', () => {
  const RETORT = card('Test Retort', 'Instant', 'Counter target spell. You may cast a spell that shares a card type with that spell from your hand without paying its mana cost.');
  it('is understood', () => expect(noManual(RETORT)).toBe(true));
  it('the countered sorcery, now in the graveyard, is read as it last existed: a sorcery in your hand is offered, the instant is not', () => {
    const offered: string[][] = [];
    const s0 = scenario([], { defs: [RETORT, RITE, BIG_RITE, QUICK], p1: { hand: ['Test Rite', 'Test Retort', 'Test Big Rite', 'Test Quick'], battlefield: ['Plains'] } });
    const before = life(s0, 'p1');
    let s = castP1(s0, 'Test Rite'); // on the stack; p1 keeps priority
    const rite = s.zones.stack[0]!;
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Retort', 'hand', 'p1') }), { targets: [rite] }), { pick: 'Test Big Rite', offered });
    expect(offered).toEqual([['Test Big Rite']]);
    expect(life(s, 'p1')).toBe(before + 5); // the countered Rite gained nothing; the Big Rite was cast for free and resolved
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Quick']);
  });
});
