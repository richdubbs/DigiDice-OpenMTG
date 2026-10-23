/**
 * Standard round D (slot D of five parallel rounds): the templates of parser/templates/zz-cloud/std-rD.json played through the engine with synthetic cards
 * compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2d, 607.2d, 205.2a   "Choose artifact or enchantment. Destroy all permanents of the chosen type." (eff.stdrd.choose.cardTypeList)
 *   CR 614.12a, 607.2a, 205.2a  "As ~ enters, choose creature or sorcery." (rep.stdrd.enters.choose.cardTypeList)
 *   CR 601.3, 607.2d, 101.2     "Players can't cast spells of the chosen type." (sta.stdrd.players.cantCast.chosen)
 *   CR 608.2c, 400.7, 701.9a    "Whenever you discard a card, exile that card from your graveyard." (eff.stdrd.exile.fromYourGraveyard), and "If you do, until the
 *                               end of your next turn, you may play that card." after it
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions that come up until priority (payments automatic; yes to "you may"; other choices the first allowed, or `name` for a named choice). */
function drive(s0: GameState, o: { name?: string; yes?: boolean } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: o.name ?? (p as { options?: string[] }).options![0]! });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o?: { name?: string; yes?: boolean }): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const castId = (s: GameState, id: ObjectId, o?: { name?: string; yes?: boolean }): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: id }), o), o);
const castable = (s: GameState, player: 'p1' | 'p2', id: ObjectId): boolean => legal(s, player, 'cast').some((a) => a.action.type === 'cast' && a.action.card === id);

const PEBBLE = card('Test Pebble', 'Artifact', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
const RUNE = card('Test Rune', 'Enchantment', '');
const RUMMAGER = card('Test Rummager', 'Artifact', '{0}: Discard a card.');

describe('CR 608.2d, 607.2d, 205.2a: "Choose artifact or enchantment. Destroy all permanents of the chosen type." (eff.stdrd.choose.cardTypeList)', () => {
  const SWEEP = card('Test Sweep', 'Sorcery', 'Choose artifact or enchantment. Destroy all permanents of the chosen type.');
  const DEFS = [SWEEP, PEBBLE, RUNE, BEAR];
  it('is understood', () => expect(noManual(SWEEP)).toBe(true));
  it('only the two listed card types are offered; another type is refused', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Sweep'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sweep', 'hand', 'p1') }));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseName');
    expect((s.pending as { options?: string[] }).options).toEqual(['Artifact', 'Enchantment']);
    expect(() => answer(s, { kind: 'chooseName', name: 'Creature' })).toThrow();
  });
  it('choosing enchantment destroys every enchantment (both players\') and no artifact or creature', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Sweep'], battlefield: ['Test Pebble', 'Test Rune', 'Test Bear'] }, p2: { battlefield: ['Test Rune', 'Test Pebble'] } });
    const s = castId(s0, find(s0, 'Test Sweep', 'hand', 'p1'), { name: 'Enchantment' });
    expect(findAll(s, 'Test Rune', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Pebble', 'battlefield')).toHaveLength(2);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(1);
  });
});

describe('CR 614.12a, 601.3, 607.2d: "As ~ enters, choose creature or sorcery." and "Players can\'t cast spells of the chosen type."', () => {
  const VOW = card('Test Vow', 'Artifact', "As this artifact enters, choose creature or sorcery.\nPlayers can't cast spells of the chosen type.");
  const DEFS = [VOW, BEAR, RITE];
  it('is understood', () => expect(noManual(VOW)).toBe(true));
  it('CR 614.12a: the choice is made as it enters, among the two listed types only', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Vow'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Vow', 'hand', 'p1') }));
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseName');
    expect((s.pending as { options?: string[] }).options).toEqual(['Creature', 'Sorcery']);
    expect(() => answer(s, { kind: 'chooseName', name: 'Artifact' })).toThrow();
  });
  it('CR 601.3, 101.2: with sorcery chosen, no player can cast a sorcery spell; a creature spell is still cast', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Vow', 'Test Rite', 'Test Bear'] }, p2: { hand: ['Test Rite', 'Test Bear'] } });
    let s = castId(s0, find(s0, 'Test Vow', 'hand', 'p1'), { name: 'Sorcery' });
    expect(findAll(s, 'Test Vow', 'battlefield')).toHaveLength(1);
    expect(castable(s, 'p1', find(s, 'Test Rite', 'hand', 'p1'))).toBe(false);
    expect(castable(s, 'p1', find(s, 'Test Bear', 'hand', 'p1'))).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(castable(s, 'p2', find(s, 'Test Rite', 'hand', 'p2'))).toBe(false);
    expect(castable(s, 'p2', find(s, 'Test Bear', 'hand', 'p2'))).toBe(true);
  });
  it('with creature chosen, the sorcery is cast and the creature is not', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Vow', 'Test Rite', 'Test Bear'] } });
    const s = castId(s0, find(s0, 'Test Vow', 'hand', 'p1'), { name: 'Creature' });
    expect(castable(s, 'p1', find(s, 'Test Rite', 'hand', 'p1'))).toBe(true);
    expect(castable(s, 'p1', find(s, 'Test Bear', 'hand', 'p1'))).toBe(false);
  });
});

describe('CR 608.2c, 400.7, 701.9a: "Whenever you discard a card, exile that card from your graveyard." (eff.stdrd.exile.fromYourGraveyard)', () => {
  const HOARD = card('Test Hoard Keeper', 'Creature — Rogue', 'Whenever you discard a card, you may exile that card from your graveyard. If you do, until the end of your next turn, you may play that card.', { pt: ['1', '1'] });
  const BURNER = card('Test Ash Altar', 'Enchantment', 'Whenever you discard a card, exile that card from your graveyard.');
  const DEFS = [HOARD, BURNER, RUMMAGER, PEBBLE];
  const discard = (s0: GameState, o?: { yes?: boolean }): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.action.type === 'activate' && s0.objects[(x.action as { source: ObjectId }).source]?.defId === 'Test Rummager');
    expect(a).toBeDefined();
    return resolveAll(drive(act(s0, a!.action), o), o);
  };
  it('is understood', () => {
    expect(noManual(HOARD)).toBe(true);
    expect(noManual(BURNER)).toBe(true);
  });
  it('CR 701.13a: the discarded card is exiled from the graveyard', () => {
    const s = discard(scenario([], { defs: DEFS, p1: { hand: ['Test Pebble'], battlefield: ['Test Ash Altar', 'Test Rummager'] } }));
    expect(findAll(s, 'Test Pebble', 'graveyard')).toHaveLength(0);
    expect(findAll(s, 'Test Pebble', 'exile')).toHaveLength(1);
  });
  it('CR 400.7: with two such triggers, the second finds the card gone from the graveyard and does not move it again', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Pebble'], battlefield: ['Test Ash Altar', 'Test Ash Altar', 'Test Rummager'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.action.type === 'activate' && s0.objects[(x.action as { source: ObjectId }).source]?.defId === 'Test Rummager');
    let s = drive(pass(pass(drive(act(s0, a!.action))))); // the discard resolves; both triggers go on the stack
    expect(s.zones.stack).toHaveLength(2);
    s = drive(pass(pass(s))); // the first trigger exiles the card
    expect(s.zones.stack).toHaveLength(1);
    const exiled = findAll(s, 'Test Pebble', 'exile');
    expect(exiled).toHaveLength(1);
    s = drive(pass(pass(s))); // the second finds no such card in the graveyard
    expect(s.zones.stack).toHaveLength(0);
    expect(findAll(s, 'Test Pebble', 'exile')).toEqual(exiled);
  });
  it('CR 611.2c: "if you do": the card exiled this way may be played from exile until the end of your next turn, and not after', () => {
    let s = discard(scenario([], { defs: DEFS, p1: { hand: ['Test Pebble'], battlefield: ['Test Hoard Keeper', 'Test Rummager'] } }));
    const id = find(s, 'Test Pebble', 'exile');
    expect(castable(s, 'p1', id)).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, 'p1', find(s, 'Test Pebble', 'exile'))).toBe(true);
    s = advanceTo(s, 5, 'main1');
    expect(castable(s, 'p1', find(s, 'Test Pebble', 'exile'))).toBe(false);
  });
  it('the card played this way is cast from exile', () => {
    let s = discard(scenario([], { defs: DEFS, p1: { hand: ['Test Pebble'], battlefield: ['Test Hoard Keeper', 'Test Rummager'] } }));
    s = castId(s, find(s, 'Test Pebble', 'exile'));
    expect(findAll(s, 'Test Pebble', 'battlefield')).toHaveLength(1);
  });
  it('CR 603.5: declining the "may" leaves the card in the graveyard, and it can\'t be played from there', () => {
    const s = discard(scenario([], { defs: DEFS, p1: { hand: ['Test Pebble'], battlefield: ['Test Hoard Keeper', 'Test Rummager'] } }), { yes: false });
    const id = find(s, 'Test Pebble', 'graveyard', 'p1');
    expect(findAll(s, 'Test Pebble', 'exile')).toHaveLength(0);
    expect(castable(s, 'p1', id)).toBe(false);
  });
});
