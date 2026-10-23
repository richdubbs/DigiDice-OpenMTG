/**
 * Standard round rx3 (std-rx3, wave 2 slice s24): the readings this round added, played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory, unverified:
 * rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c, 121.1     "you may draw X cards ... If you draw one or more cards this way, discard two cards.": declining, and drawing zero cards, discard nothing
 *   CR 701.23a, 107.1    "Search your library for any number of land cards, exile them, then shuffle.": the chosen cards, only cards of the description
 *   CR 118.9, 601.2b     "Until end of turn, you may cast those cards without paying their mana costs.": cast free from exile; not for its mana cost, not
 *                        another exiled card, not after the turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { findAll, scenario } from '../../m5/helpers';
import { cast, resolveAll } from '../../m5/cr-examples/helpers';
import { act, advanceTo, answer, find, reject } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt0?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt0 ? { power: pt0[0], toughness: pt0[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const hand = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

const SEER = card('Test Lantern Seer', 'Creature — Human Wizard', 'When this creature enters, you may draw a card. If you draw one or more cards this way, discard two cards.', ['1', '1']);
const COUNTER = card('Test Gear Counter', 'Creature — Human Artificer', 'When this creature enters, you may draw X cards, where X is the number of artifacts you control. If you draw one or more cards this way, discard two cards.', ['1', '1']);
const SIFT = card('Test Land Sift', 'Sorcery', 'Search your library for any number of land cards, exile them, then shuffle.');
const VAULT = card('Test Vault Call', 'Sorcery', 'Search your library for any number of artifact cards, exile them, then shuffle. Until end of turn, you may cast those cards without paying their mana costs.');
const ENGINE = card('Test Brass Engine', 'Artifact', '', undefined, '{5}');
const RELIC = card('Test Brass Relic', 'Artifact', '', undefined, '{4}');
const FILLER = card('Test Filler', 'Sorcery', 'Draw a card.');
const DEFS = [SEER, COUNTER, SIFT, VAULT, ENGINE, RELIC, FILLER];

describe('std-rx3 cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [SEER, COUNTER]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 608.2c, 121.1: "If you draw one or more cards this way, discard two cards."', () => {
  it('drawing a card, you discard two', () => {
    let s = scenario(['Plains', 'Plains', 'Plains'], { p1: { hand: ['Test Lantern Seer', 'Test Filler', 'Test Filler'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Lantern Seer'), [{ kind: 'yesNo', yes: true }]);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: s.zones.hand.p1!.slice(0, 2) }));
    expect(hand(s, 'p1')).toBe(1);
    expect(s.zones.graveyard.p1!.length).toBe(2);
  });
  it('declining the draw, you discard nothing', () => {
    let s = scenario(['Plains', 'Plains', 'Plains'], { p1: { hand: ['Test Lantern Seer', 'Test Filler', 'Test Filler'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Lantern Seer'), [{ kind: 'yesNo', yes: false }]);
    expect(hand(s, 'p1')).toBe(2);
    expect(s.zones.graveyard.p1!.length).toBe(0);
  });
  it('choosing to draw X cards with X = 0 draws nothing, so nothing was drawn this way: you discard nothing', () => {
    let s = scenario(['Plains', 'Plains', 'Plains'], { p1: { hand: ['Test Gear Counter', 'Test Filler', 'Test Filler'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Gear Counter'), [{ kind: 'yesNo', yes: true }]);
    expect(hand(s, 'p1')).toBe(2);
    expect(s.zones.graveyard.p1!.length).toBe(0);
  });
});

describe('CR 701.23a, 107.1: "Search your library for any number of land cards, exile them, then shuffle."', () => {
  it('the cards chosen are exiled, the others stay; a card that is not a land is not offered', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Land Sift'], library: ['Island', 'Test Brass Engine'] }, defs: DEFS });
    s = cast(s, 'Test Land Sift');
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = (s.pending as unknown as { options: string[] }).options.map((id) => s.objects[id]!.defId);
    expect(offered).toContain('Island');
    expect(offered).not.toContain('Test Brass Engine');
    const island = find(s, 'Island', 'library');
    const plains = find(s, 'Plains', 'library');
    const before = s.zones.library.p1!.length;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [island, plains] }));
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Island', 'Plains']);
    expect(s.zones.library.p1!.length).toBe(before - 2);
    expect(findAll(s, 'Test Brass Engine', 'library')).toHaveLength(1);
  });
});

const castOptions = (s: GameState, id: string) => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === id);

describe('CR 118.9, 601.2b, 611.2a: "Until end of turn, you may cast those cards without paying their mana costs."', () => {
  function afterVault(): GameState {
    let s = scenario([], { p1: { hand: ['Test Vault Call'], library: ['Test Brass Engine'], exile: ['Test Brass Relic'] }, defs: DEFS });
    s = cast(s, 'Test Vault Call');
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    return resolveAll(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Brass Engine', 'library')] }));
  }
  it('the exiled artifact is cast for no mana with no lands, and resolves', () => {
    let s = afterVault();
    const engine = find(s, 'Test Brass Engine', 'exile');
    const opts = castOptions(s, engine);
    expect(opts.length).toBe(1);
    s = act(s, opts[0]!.action);
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveAll(s);
    expect(findAll(s, 'Test Brass Engine', 'battlefield')).toHaveLength(1);
  });
  it('casting it for its mana cost is not allowed (the permission is to cast it without paying)', () => {
    const s = afterVault();
    const engine = find(s, 'Test Brass Engine', 'exile');
    expect(reject(s, { type: 'cast', player: 'p1', card: engine }).rules).toContain('CR 118.9');
  });
  it('a card in exile the spell did not exile is not offered', () => {
    const s = afterVault();
    expect(castOptions(s, find(s, 'Test Brass Relic', 'exile'))).toHaveLength(0);
  });
  it('after the turn ends, the card can no longer be cast', () => {
    let s = afterVault();
    s = advanceTo(s, 2, 'main1');
    expect(castOptions(s, find(s, 'Test Brass Engine', 'exile'))).toHaveLength(0);
  });
});
