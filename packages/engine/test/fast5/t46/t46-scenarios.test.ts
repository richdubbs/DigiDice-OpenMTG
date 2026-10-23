/**
 * FAST5 T46 (hand disruption: "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card."): the templates of
 * parser/templates/zz-fast5/t46.json played through the engine with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10).
 * Each test is named after the rule it checks.
 *
 *   CR 701.20a       the hand is revealed to every player; it stays where it is (701.20b)
 *   CR 701.20e       "look at" shows the cards to you only
 *   CR 608.2d        you choose from the revealed cards; "you may choose" may choose nothing
 *   CR 609.3         with no card of that description, the instruction does as much as it can: the hand was still revealed, nothing is chosen or discarded
 *   CR 701.9a        the player whose hand it is discards the card (a discard, not an exile, not a move by the caster)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { answer, find, scenario, passBoth, act } from '../../m3/scenario';
import { HIDDEN_DEF, viewFor, type ObjectId } from '../../../src/index';
const visibleTo = (s: GameState, p: string, id: ObjectId): boolean => viewFor(s, p).objects[id]!.defId !== HIDDEN_DEF;

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);

const DURESS = card('Test Duress', 'Sorcery', 'Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.', { colors: ['B'] });
const PILFER = card('Test Pilfer', 'Sorcery', 'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.', { colors: ['B'] });
const TACTICS = card('Test Tactics', 'Sorcery', 'Target opponent reveals their hand. You choose an artifact or creature card from it. Exile that card.', { colors: ['B'] });
const SEER = card('Test Seer', 'Sorcery', 'Target opponent reveals their hand. You choose a nonland card from it and exile that card.', { colors: ['B'] });
const SKULL = card('Test Skull', 'Sorcery', "Look at target player's hand. You may choose a nonland card from it. That player discards that card.", { colors: ['B'] });
const ANY = card('Test Any', 'Sorcery', 'Target opponent reveals their hand. You may choose a card from it. That player discards that card.', { colors: ['B'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { colors: ['G'], pt: ['2', '2'] });
const CHARM = card('Test Charm', 'Instant', 'You gain 3 life.', { colors: ['W'] });
const ROD = card('Test Rod', 'Artifact', '{T}: Add {C}.');
const ALL = [DURESS, PILFER, TACTICS, SEER, SKULL, ANY, BEAR, CHARM, ROD];

describe('design 6.9: every T46 sentence is compiled to data, none left manual', () => {
  it('no manual ability on the T46 test cards', () => {
    for (const d of [DURESS, PILFER, TACTICS, SEER, SKULL, ANY]) expect(noManual(d), d.name).toEqual([]);
  });
});

/** Cast `name` from p1's hand at the opponent (p2), pay, and let it resolve up to the first decision of the effect (or priority). */
function cast(s: GameState, name: string, target: TargetChoice = { kind: 'player', id: 'p2' }): GameState {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  while (t.pending && t.pending.kind !== 'priority') {
    if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [target] });
    else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else break;
  }
  return passBoth(t);
}
const offered = (s: GameState): string[] => ((s.pending as unknown as { options: string[] }).options ?? []).slice();
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const handOf = (s: GameState, p: string): string[] => names(s, s.zones.hand[p]!);
const graveOf = (s: GameState, p: string): string[] => names(s, s.zones.graveyard[p]!);
const board = (name: string, extra: string[] = []): GameState =>
  scenario([], { defs: ALL, p1: { hand: [name, ...extra] }, p2: { hand: ['Test Bear', 'Test Charm', 'Test Rod', 'Plains'] } });

describe('CR 701.20a, 608.2d, 701.9a: "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card."', () => {
  it('the whole hand is revealed; you choose among the noncreature nonland cards only (never the creature or the land); that card is discarded', () => {
    const s0 = board('Test Duress');
    const s = cast(s0, 'Test Duress');
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p1'); // you choose, not the opponent (CR 608.2d)
    for (const id of s0.zones.hand.p2!) expect(visibleTo(s, 'p1', id), 'CR 701.20a: every card of the hand is shown').toBe(true);
    expect(names(s, offered(s)).sort()).toEqual(['Test Charm', 'Test Rod']);
    const rod = find(s, 'Test Rod', 'hand', 'p2');
    const done = answer(s, { kind: 'chooseObjects', ids: [rod] });
    expect(done.pending?.kind).toBe('priority');
    expect(graveOf(done, 'p2')).toEqual(['Test Rod']);
    expect(handOf(done, 'p2').sort()).toEqual(['Plains', 'Test Bear', 'Test Charm']);
    expect(done.zones.graveyard.p1).toHaveLength(1); // only the resolved spell
  });
  it('CR 701.9a: it is a discard BY the hand\'s owner (the log names them), not an exile and not a move for the caster', () => {
    const s = cast(board('Test Pilfer'), 'Test Pilfer');
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Charm', 'hand', 'p2')] });
    expect(done.log.some((l) => /Bob discards/.test(l.text) && (l.rules ?? []).includes('CR 701.9a'))).toBe(true);
    expect(done.zones.exile).toHaveLength(0);
    expect(graveOf(done, 'p2')).toEqual(['Test Charm']);
  });
  it('CR 609.3, 701.20b: with no card of that description the hand was still revealed, nothing is chosen, nothing is discarded, no decision is asked', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Duress'] }, p2: { hand: ['Test Bear', 'Plains'] } });
    const s = cast(s0, 'Test Duress');
    expect(s.pending?.kind).toBe('priority');
    for (const id of s0.zones.hand.p2!) expect(visibleTo(s, 'p1', id)).toBe(true);
    expect(graveOf(s, 'p2')).toEqual([]);
    expect(handOf(s, 'p2').sort()).toEqual(['Plains', 'Test Bear']);
  });
  it('CR 609.3: an empty hand reveals nothing and does nothing', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Duress'] }, p2: { hand: [] } });
    const s = cast(s0, 'Test Duress');
    expect(s.pending?.kind).toBe('priority');
    expect(graveOf(s, 'p2')).toEqual([]);
  });
  it('one card of that description: it is the only choice, so it is discarded with nothing asked', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Duress'] }, p2: { hand: ['Test Bear', 'Test Charm', 'Plains'] } });
    const s = cast(s0, 'Test Duress');
    expect(s.pending?.kind).toBe('priority');
    expect(graveOf(s, 'p2')).toEqual(['Test Charm']);
  });
  it('CR 608.2d: the opponent never chooses; you may pick any offered card, and an answer outside the offer is refused', () => {
    const s = cast(board('Test Duress'), 'Test Duress');
    expect(names(s, offered(s)).sort()).toEqual(['Test Charm', 'Test Rod']);
    expect(() => answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p2')] })).toThrow();
  });
});

describe('CR 406.1, 701.20a: "You choose an artifact or creature card from it. Exile that card." (no discard)', () => {
  it('the offered cards are the artifacts and creatures; the chosen card is exiled from the hand, not discarded', () => {
    const s = cast(board('Test Tactics'), 'Test Tactics');
    expect(names(s, offered(s)).sort()).toEqual(['Test Bear', 'Test Rod']);
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p2')] });
    expect(graveOf(done, 'p2')).toEqual([]);
    expect(names(done, done.zones.exile)).toEqual(['Test Bear']);
    expect(handOf(done, 'p2').sort()).toEqual(['Plains', 'Test Charm', 'Test Rod']);
  });
  it('"You choose a nonland card from it and exile that card." is the same choice and exile in one sentence', () => {
    const s = cast(board('Test Seer'), 'Test Seer');
    expect(names(s, offered(s)).sort()).toEqual(['Test Bear', 'Test Charm', 'Test Rod']);
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Charm', 'hand', 'p2')] });
    expect(names(done, done.zones.exile)).toEqual(['Test Charm']);
    expect(graveOf(done, 'p2')).toEqual([]);
  });
});

describe('CR 701.20e, 608.2d: "Look at target player\'s hand. You may choose a nonland card from it. That player discards that card."', () => {
  it('looking shows the hand to you only (it is not revealed to the opponent\'s side, nothing else is shown)', () => {
    const s0 = board('Test Skull');
    const s = cast(s0, 'Test Skull');
    for (const id of s0.zones.hand.p2!) expect(visibleTo(s, 'p1', id)).toBe(true);
    expect(s.pending?.kind).toBe('chooseObjects');
  });
  it('you may choose nothing: nothing is discarded', () => {
    const s = cast(board('Test Skull'), 'Test Skull');
    const done = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(done.pending?.kind).toBe('priority');
    expect(graveOf(done, 'p2')).toEqual([]);
    expect(handOf(done, 'p2')).toHaveLength(4);
  });
  it('you may choose a card: that player discards it', () => {
    const s = cast(board('Test Skull'), 'Test Skull');
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p2')] });
    expect(graveOf(done, 'p2')).toEqual(['Test Bear']);
  });
  it('"You may choose a card from it": any card of the hand is offered, lands included', () => {
    const s = cast(board('Test Any'), 'Test Any');
    expect(names(s, offered(s)).sort()).toEqual(['Plains', 'Test Bear', 'Test Charm', 'Test Rod']);
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p2')] });
    expect(graveOf(done, 'p2')).toEqual(['Test Bear']);
  });
  it('you can aim it at yourself: the "opponent" of nothing — your own hand is looked at and you discard the card you chose', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Skull', 'Test Bear', 'Test Charm'] }, p2: { hand: [] } });
    const s = cast(s0, 'Test Skull', { kind: 'player', id: 'p1' });
    expect(s.pending?.kind).toBe('chooseObjects');
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p1')] });
    expect(names(done, done.zones.graveyard.p1!).sort()).toEqual(['Test Bear', 'Test Skull']);
  });
});

describe('CR 608.2c, 609.3: "You may choose a nonland card from it. If you do, exile that card." and "If the card\'s mana value is 1 or less, create a Spirit"', () => {
  const PRIEST = card('Test Priest', 'Sorcery', 'Target opponent reveals their hand. You may choose a nonland card from it. If you do, exile that card.', { colors: ['B'] });
  const SEARCH = card('Test Search', 'Sorcery', "Target opponent reveals their hand. You choose a nonland card from it. Exile that card. If the card's mana value is 1 or less, create a 1/1 white and black Spirit creature token with flying.", { colors: ['B'] });
  const BIG = card('Test Big', 'Creature — Giant', '', { cost: '{3}{G}', colors: ['G'], pt: ['4', '4'] });
  const TINY = card('Test Tiny', 'Artifact', '', { cost: '{1}' });
  const DEFS = [...ALL, PRIEST, SEARCH, BIG, TINY];
  const play = (name: string, p2hand: string[]): GameState => cast(scenario([], { defs: DEFS, p1: { hand: [name] }, p2: { hand: p2hand } }), name);
  const spirits = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' || s.defs[s.objects[id]!.defId]?.name === 'Spirit').length;
  it('"if you do": choosing a card exiles it; choosing none exiles nothing', () => {
    const s = play('Test Priest', ['Test Bear', 'Test Charm', 'Plains']);
    const exiled = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Charm', 'hand', 'p2')] });
    expect(names(exiled, exiled.zones.exile)).toEqual(['Test Charm']);
    const none = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(none.zones.exile).toHaveLength(0);
    expect(handOf(none, 'p2')).toHaveLength(3);
  });
  it('the exiled card has mana value 1 or less: you get the Spirit', () => {
    const s = play('Test Search', ['Test Tiny', 'Test Big', 'Plains']);
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Tiny', 'hand', 'p2')] });
    expect(names(done, done.zones.exile)).toEqual(['Test Tiny']);
    expect(spirits(done)).toBe(1);
  });
  it('the exiled card has a larger mana value: no Spirit', () => {
    const s = play('Test Search', ['Test Tiny', 'Test Big', 'Plains']);
    const done = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Big', 'hand', 'p2')] });
    expect(names(done, done.zones.exile)).toEqual(['Test Big']);
    expect(spirits(done)).toBe(0);
  });
  it('CR 609.3: no nonland card to choose: nothing is exiled and no Spirit is created (no card, no mana value to compare)', () => {
    const done = play('Test Search', ['Plains']);
    expect(done.pending?.kind).toBe('priority');
    expect(done.zones.exile).toHaveLength(0);
    expect(spirits(done)).toBe(0);
  });
});

describe('CR 107.3, 608.2d: "You choose a nonland card with mana value X or less from it" (the X the spell was cast with)', () => {
  const GLIMMER = card('Test Glimmer', 'Sorcery', 'Target player reveals their hand. You choose a nonland card with mana value X or less from it. That player discards that card.', { cost: '{X}', colors: ['B'] });
  const BIG = card('Test Big', 'Creature — Giant', '', { cost: '{3}{G}', colors: ['G'], pt: ['4', '4'] });
  const TINY = card('Test Tiny', 'Artifact', '', { cost: '{1}' });
  it('only cards of mana value X or less are offered', () => {
    const s0 = scenario([], { defs: [...ALL, GLIMMER, BIG, TINY], p1: { hand: ['Test Glimmer'], battlefield: ['Plains', 'Plains'] }, p2: { hand: ['Test Big', 'Test Tiny', 'Test Rod', 'Plains'] } });
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Glimmer', 'hand', 'p1') });
    while (t.pending && t.pending.kind !== 'priority') {
      if (t.pending.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: 1 });
      else if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else break;
    }
    t = passBoth(t);
    expect(t.pending?.kind).toBe('chooseObjects');
    expect(names(t, offered(t)).sort()).toEqual(['Test Rod', 'Test Tiny']); // the 4-mana creature is out
  });
});
