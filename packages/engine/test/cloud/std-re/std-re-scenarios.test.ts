/**
 * Standard round E (std-re): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not in the cloud checkout).
 *
 *   CR 205.3m, 111.1   "each creature you control that's a Bear or a Wolf" / "that's a token or a Cat": only your creatures of one of the kinds
 *   CR 205.3m, 205.2a  "Bear or Wolf creature card": the card type goes with every subtype of the list
 *   CR 701.23a         a search for three descriptions finds one card of each, a card of none of them is never found
 *   CR 701.22a, 109.5  "you scry N": the controller scries, the opponent's library is untouched
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { find, findAll, scenario } from '../../m5/helpers';
import { cast, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

const RALLY = card('Test Den Rally', 'Sorcery', "Put a +1/+1 counter on each creature you control that's a Bear or a Wolf.");
const MUSTER = card('Test Token Muster', 'Sorcery', "Put a +1/+1 counter on each creature you control that's a token or a Cat.");
const SPROUT = card('Test Bear Sprout', 'Sorcery', 'Create a 2/2 green Bear creature token.');
const RECALL = card('Test Den Recall', 'Sorcery', 'Return target Bear or Wolf creature card from your graveyard to your hand.');
const TRIPLE = card('Test Triple Seek', 'Sorcery', 'Search your library for a red card, a white card, and a green card. Put those cards into your graveyard, then shuffle.');
const SEER = card('Test Tide Seer', 'Creature — Human Wizard', 'When this creature enters, it deals 1 damage to each opponent and you scry 1.', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const WOLF = card('Test Wolf', 'Creature — Wolf', '', ['2', '2']);
const CAT = card('Test Cat', 'Creature — Cat', '', ['2', '2']);
const RED = card('Test Red Ore', 'Artifact', '', undefined, ['R']);
const WHITE = card('Test White Ore', 'Artifact', '', undefined, ['W']);
const GREEN = card('Test Green Ore', 'Artifact', '', undefined, ['G']);
const BLUE = card('Test Blue Ore', 'Artifact', '', undefined, ['U']);
const DEFS = [RALLY, MUSTER, SPROUT, RECALL, TRIPLE, SEER, BEAR, WOLF, CAT, RED, WHITE, GREEN, BLUE];
const LIBRARY = ['Plains'];
const counters = (s: GameState, id: string): number => s.objects[id]!.counters['+1/+1'] ?? 0;

describe('std-re cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [RALLY, MUSTER, RECALL, TRIPLE, SEER]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 205.3m: "each creature you control that\'s a Bear or a Wolf"', () => {
  it('your Bear and your Wolf get a counter; your Cat and the opponent\'s Bear do not', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Den Rally'], battlefield: ['Test Bear', 'Test Wolf', 'Test Cat'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Den Rally'));
    const mine = (n: string) => findAll(s, n, 'battlefield').find((id) => s.objects[id]!.controller === 'p1')!;
    const theirs = findAll(s, 'Test Bear', 'battlefield').find((id) => s.objects[id]!.controller === 'p2')!;
    expect(counters(s, mine('Test Bear'))).toBe(1);
    expect(counters(s, mine('Test Wolf'))).toBe(1);
    expect(counters(s, mine('Test Cat'))).toBe(0);
    expect(counters(s, theirs)).toBe(0);
  });
});

describe('CR 111.1, 205.3m: "each creature you control that\'s a token or a Cat"', () => {
  it('a token Bear and a nontoken Cat get a counter; a nontoken Bear does not', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Bear Sprout', 'Test Token Muster'], battlefield: ['Test Bear', 'Test Cat'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Bear Sprout'));
    s = resolveAll(cast(s, 'Test Token Muster'));
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' || s.objects[id]!.defId === 'Test Bear');
    const token = bears.find((id) => s.objects[id]!.kind === 'token')!;
    const card = bears.find((id) => s.objects[id]!.kind !== 'token')!;
    expect(token).toBeDefined();
    expect(counters(s, token)).toBe(1);
    expect(counters(s, card)).toBe(0);
    expect(counters(s, find(s, 'Test Cat', 'battlefield'))).toBe(1);
  });
});

describe('CR 205.3m, 205.2a: "target Bear or Wolf creature card" from your graveyard', () => {
  it('a Wolf card returns; a Cat card is not a legal target', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Den Recall'], graveyard: ['Test Wolf', 'Test Cat'] }, defs: DEFS });
    const wolf = find(s, 'Test Wolf', 'graveyard', 'p1');
    const cat = find(s, 'Test Cat', 'graveyard', 'p1');
    expect(() => cast(s, 'Test Den Recall', [target(cat)])).toThrow();
    s = resolveAll(cast(s, 'Test Den Recall', [target(wolf)]));
    expect(findAll(s, 'Test Wolf', 'hand', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Cat', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.23a: a search for a red card, a white card, and a green card', () => {
  it('one card of each description goes to the graveyard; the blue card is never found', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Triple Seek'], library: ['Test Red Ore', 'Test White Ore', 'Test Green Ore', 'Test Blue Ore'] }, defs: DEFS });
    const red = find(s, 'Test Red Ore', 'library', 'p1');
    const white = find(s, 'Test White Ore', 'library', 'p1');
    const green = find(s, 'Test Green Ore', 'library', 'p1');
    s = resolveAll(cast(s, 'Test Triple Seek'), [{ kind: 'chooseObjects', ids: [red] }, { kind: 'chooseObjects', ids: [white] }, { kind: 'chooseObjects', ids: [green] }]);
    for (const n of ['Test Red Ore', 'Test White Ore', 'Test Green Ore']) expect(findAll(s, n, 'graveyard', 'p1'), n).toHaveLength(1);
    expect(findAll(s, 'Test Blue Ore', 'library', 'p1')).toHaveLength(1);
  });
});

describe('CR 701.22a, 109.5: "you scry 1" after damage to each opponent', () => {
  it('the controller scries (the card goes to the bottom of their library); the opponent only takes the damage', () => {
    let s = scenario(LIBRARY, { p1: { hand: ['Test Tide Seer'], library: ['Test Blue Ore'] }, p2: { library: ['Test Red Ore'] }, defs: DEFS });
    const ore = find(s, 'Test Blue Ore', 'library', 'p1');
    const theirTop = s.zones.library.p2![0];
    s = resolveAll(cast(s, 'Test Tide Seer'), [{ kind: 'chooseObjects', ids: [ore] }]);
    expect(s.players[1]!.life).toBe(19);
    const lib = s.zones.library.p1!;
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe('Test Blue Ore');
    expect(s.zones.library.p2![0]).toBe(theirTop);
  });
});
