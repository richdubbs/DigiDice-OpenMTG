/**
 * std-exile-play-2-3 (lane std-exile-play-2): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 608.2d, 406.1         "Exile up to one noncreature, nonland card from that player's graveyard." (eff.sxp23.exile.upTo.fromPlayerGraveyard): a choice, no target
 *   CR 118.9, 701.67a, 611.2b "For as long as you control ~, you may cast the exiled card during your turn by waterbending {X} rather than paying its mana cost, where X
 *                            is its mana value." (eff.sxp23.permit.cast.duringYourTurn.waterbendManaValue)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, scenario } from '../../m3/scenario';
import { passUntil } from '../../m4/helpers';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const WITCH = card('Test Witch', 'Legendary Creature — Human Warlock',
  "When Test Witch enters, target opponent mills three cards. Exile up to one noncreature, nonland card from that player's graveyard. For as long as you control Test Witch, you may cast the exiled card during your turn by waterbending {X} rather than paying its mana cost, where X is its mana value.",
  ['2', '2']);
const HEX = card('Test Hex', 'Sorcery', 'You gain 2 life.', undefined, '{2}{B}');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const PEBBLE = card('Test Pebble', 'Artifact', '');
const DEFS = [WITCH, HEX, CUB, PEBBLE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const inExile = (s: GameState, defId: string): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === defId);
const castsOf = (s: GameState, id: ObjectId | undefined) => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === id);

/** Cast the Witch, target p2, and stop at the choice of the milled card (or at priority with an empty stack when there is none). */
function toChoice(pebbles: number): GameState {
  const s0 = scenario(['Plains'], {
    p1: { hand: ['Test Witch'], battlefield: Array(pebbles).fill('Test Pebble') as string[] },
    p2: { library: ['Test Hex', 'Plains', 'Test Cub'] }, defs: DEFS,
  });
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Witch', 'hand') });
  for (let guard = 0; guard < 40; guard++) {
    const d = s.pending;
    if (d?.kind === 'chooseObjects') return s;
    if (d?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    else if (d?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else if (d?.kind === 'priority') return s;
    else s = settle(s);
  }
  return s;
}

/** The Witch's trigger resolved with `pick` (a defId among the choices) or nothing chosen. */
function enter(pebbles: number, pick: string | null): GameState {
  let s = toChoice(pebbles);
  if (s.pending?.kind !== 'chooseObjects') return s;
  const opts = (s.pending as unknown as { options: ObjectId[] }).options;
  const id = pick === null ? undefined : opts.find((o) => s.objects[o]!.defId === pick);
  s = answer(s, { kind: 'chooseObjects', ids: id === undefined ? [] : [id] });
  return resolveAll(s);
}

describe('CR 608.2d, 406.1: "Exile up to one noncreature, nonland card from that player\'s graveyard"', () => {
  it('the milled sorcery may be exiled; the creature and land cards are not among the choices', () => {
    const s = toChoice(0);
    expect(s.pending?.kind).toBe('chooseObjects');
    const opts = (s.pending as unknown as { options: ObjectId[] }).options.map((o) => s.objects[o]!.defId);
    expect(opts).toEqual(['Test Hex']);
  });
  it('up to one: choosing none exiles nothing', () => {
    const s = enter(3, null);
    expect(inExile(s, 'Test Hex')).toBeUndefined();
    expect((s.zones.graveyard['p2'] ?? []).length).toBe(3);
  });
});

describe('CR 118.9, 701.67a, 611.2b: the exiled card is cast during your turn by waterbending {X}, X its mana value, rather than paying its mana cost', () => {
  it('with three untapped artifacts and no land, the sorcery (mana value 3) is cast by tapping all three', () => {
    const s0 = enter(3, 'Test Hex');
    const hex = inExile(s0, 'Test Hex');
    expect(hex).toBeDefined();
    const casts = castsOf(s0, hex);
    expect(casts.length).toBe(1);
    const before = life(s0, 'p1');
    let s = act(s0, casts[0]!.action);
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: ObjectId[] }).options.slice(0, 3) });
    s = resolveAll(settle(s));
    expect(life(s, 'p1')).toBe(before + 2);
    const tapped = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped);
    expect(tapped.length).toBe(3); // three of the four artifacts and creatures paid {1} each
  });
  it('CR 118.3, 701.67a: one artifact and the Witch itself (a creature may be tapped for waterbend) pay only {2} of waterbend {3}: the card is not offered', () => {
    const s = enter(1, 'Test Hex');
    expect(castsOf(s, inExile(s, 'Test Hex')).length).toBe(0);
  });
  it('not during an opponent\'s turn', () => {
    const s0 = enter(3, 'Test Hex');
    const hex = inExile(s0, 'Test Hex')!;
    let s = advanceTo(s0, 2, 'main1');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 2');
    expect(castsOf(s, hex).length).toBe(0);
  });
  it('CR 611.2b: once you no longer control the source, the permission ends', () => {
    const s0 = enter(3, 'Test Hex');
    const hex = inExile(s0, 'Test Hex')!;
    const witch = find(s0, 'Test Witch', 'battlefield');
    const s = { ...s0, objects: { ...s0.objects, [witch]: { ...s0.objects[witch]!, controller: 'p2' } } } as GameState;
    expect(castsOf(s, hex).length).toBe(0);
  });
});
