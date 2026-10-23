/**
 * p2-exile-play-1 (Phase 2 lane p2-exile-play): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 607.2a, 118.9          "Sacrifice ~: You may cast an instant spell from among cards exiled with ~ without paying its mana cost." (eff.p2ep1.cast.linked.free)
 *   CR 607.2a, 201.2, 101.2   "Your opponents can't cast spells with the same name as the exiled card." (a static's "the exiled card", lower/p2ep1.ts) and
 *                             "Players can't cast spells with the same name as the exiled card." (sta.p2ep1.players.cantCast.sameName)
 *   CR 607.2a, 601.2f, 205.2a "Spells you cast that share a card type with the exiled card cost {3} less to cast." (sta.p2ep1.costmod.less.shareCardType.exiled)
 *   CR 120.1                  "if an opponent was dealt 3 or more damage this turn" (parser/holes/cond.ts, the damage one opponent was dealt this turn)
 *   CR 607.2a, 611.3a, 702.51a "You may play cards exiled with ~ as long as you control an artifact." (sta.p2ep1.play.linked.asLongAs) and "Noncreature spells
 *                             you cast from exile have convoke." (sta.p2ep1.spells.cast.fromExile.convoke)
 *   CR 607.2a, 611.3a, 500.1  "During your turn, if you gained life this turn, you may play lands and cast spells from among cards exiled with ~."
 *                             (sta.p2ep1.yourTurn.if.play.linked)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState, type ObjectId } from '../../../src/index';
import { act, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const KEEPER = card('Test Keeper', 'Artifact', '{T}: Exile target card from a graveyard.\nSacrifice Test Keeper: You may cast an instant spell from among cards exiled with Test Keeper without paying its mana cost.');
const WARD = card('Test Ward', 'Artifact', "{T}: Exile target card from a graveyard.\nYour opponents can't cast spells with the same name as the exiled card.");
const RITE = card('Test Rite', 'Artifact', "{T}: Exile target card from a graveyard.\nPlayers can't cast spells with the same name as the exiled card.");
const ANVIL = card('Test Anvil', 'Artifact', '{T}: Exile target card from a graveyard.\nSpells you cast that share a card type with the exiled card cost {3} less to cast.');
const TALLY = card('Test Tally', 'Artifact', 'At the beginning of your end step, if an opponent was dealt 3 or more damage this turn, you gain 10 life.');
const PACER = card('Test Pacer', 'Artifact', '{T}: Exile target card from a graveyard.\nYou may play cards exiled with Test Pacer as long as you control an artifact.');
const THRASHER = card('Test Thrasher', 'Enchantment', 'Noncreature spells you cast from exile have convoke.');
const STAGE = card('Test Stage', 'Enchantment', '{T}: Exile target card from a graveyard.\nDuring your turn, if you gained life this turn, you may play lands and cast spells from among cards exiled with Test Stage.');
const TONIC = card('Test Tonic', 'Instant', 'You gain 3 life.', undefined, '{5}');
const BREW = card('Test Brew', 'Sorcery', 'You gain 2 life.', undefined, '{3}');
const GOLEM = card('Test Golem', 'Creature — Golem', '', ['3', '3'], '{3}');
const SQUIRE = card('Test Squire', 'Creature — Human', '', ['1', '1']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target player.');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
const DEFS = [KEEPER, WARD, RITE, ANVIL, TALLY, PACER, THRASHER, STAGE, TONIC, BREW, GOLEM, SQUIRE, BOLT, SIP];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const castAction = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
const activations = (s: GameState, name: string): Action[] =>
  legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object !== undefined && nameOf(s, a.object) === name).map((a) => a.action);
/** p1 passes priority in its main phase with an empty stack: p2 gets priority (CR 117.4), so p2's instants are castable. */
const toP2 = (s: GameState): GameState => act(s, { type: 'pass', player: 'p1' });
const p2Casts = (s: GameState, name: string): boolean => { const t = toP2(s); expect(t.pending?.player).toBe('p2'); return castAction(t, name, 'p2') !== undefined; };
const inExile = (s: GameState, name: string): ObjectId | undefined => s.zones.exile.find((id) => nameOf(s, id) === name);
const yardOf = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => (s.zones.graveyard[p] ?? []).map((id) => nameOf(s, id));
/** Activate the first ability of `source` (its "{T}: Exile target card from a graveyard.") on the card named `what` in a graveyard. */
function exileWith(s0: GameState, source: string, what: string, owner: 'p1' | 'p2' = 'p1'): GameState {
  const target = find(s0, what, 'graveyard', owner);
  const a = activations(s0, source)[0]!;
  return resolveAll(settle(act(s0, a), { targets: [{ kind: 'object', id: target }] }), { targets: [{ kind: 'object', id: target }] });
}

describe('CR 607.2a, 118.9: you may cast an instant spell from among cards exiled with ~ without paying its mana cost', () => {
  it('the linked instant is cast free after ~ is sacrificed (no mana); a card in exile not exiled with ~ and a sorcery are not offered', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Keeper'], graveyard: ['Test Tonic'], exile: ['Test Sip'] } });
    s = exileWith(s, 'Test Keeper', 'Test Tonic');
    const tonic = inExile(s, 'Test Tonic')!;
    expect(tonic).toBeDefined();
    const before = life(s, 'p1');
    const sac = activations(s, 'Test Keeper').at(-1)!;
    s = settle(act(s, sac));
    s = settle(s);
    // pass priority with the ability on the stack; the choice offers the linked instant only
    let seen: ObjectId[] = [];
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) {
      if (s.pending?.kind === 'chooseObjects') seen = (s.pending as unknown as { options: ObjectId[] }).options;
      s = resolveAll(s, { objects: [tonic] });
    }
    expect(seen).not.toContain(inExile(s, 'Test Sip'));
    expect(life(s, 'p1')).toBe(before + 3);
    expect(yardOf(s)).toContain('Test Tonic');
  });
  it('declining casts nothing: the instant stays in exile', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Keeper'], graveyard: ['Test Tonic'] } });
    s = exileWith(s, 'Test Keeper', 'Test Tonic');
    const before = life(s, 'p1');
    s = resolveAll(act(s, activations(s, 'Test Keeper').at(-1)!), { objects: [] });
    expect(life(s, 'p1')).toBe(before);
    expect(inExile(s, 'Test Tonic')).toBeDefined();
  });
});

describe('CR 607.2a, 201.2, 101.2: no opponent can cast a spell with the same name as the exiled card', () => {
  it('the opponent cannot cast a card with that name, but can cast another; you still can', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ward'], graveyard: ['Test Sip'], hand: ['Test Sip'] }, p2: { hand: ['Test Sip', 'Test Bolt'] } });
    expect(castAction(s, 'Test Sip', 'p1')).toBeDefined();
    s = exileWith(s, 'Test Ward', 'Test Sip');
    expect(inExile(s, 'Test Sip')).toBeDefined();
    expect(p2Casts(s, 'Test Sip')).toBe(false);
    expect(p2Casts(s, 'Test Bolt')).toBe(true);
    expect(castAction(s, 'Test Sip', 'p1')).toBeDefined();
  });
  it('"Players can\'t cast": you cannot either; before anything is exiled, both can', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Rite'], graveyard: ['Test Sip'], hand: ['Test Sip'] }, p2: { hand: ['Test Sip'] } });
    expect(castAction(s, 'Test Sip', 'p1')).toBeDefined();
    expect(p2Casts(s, 'Test Sip')).toBe(true);
    s = exileWith(s, 'Test Rite', 'Test Sip');
    expect(castAction(s, 'Test Sip', 'p1')).toBeUndefined();
    expect(p2Casts(s, 'Test Sip')).toBe(false);
  });
});

describe('CR 607.2a, 601.2f, 205.2a: spells you cast that share a card type with the exiled card cost {3} less', () => {
  it('with a sorcery exiled, a {3} sorcery is castable with no mana; a {3} creature is not', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Anvil'], graveyard: ['Test Brew'], hand: ['Test Brew', 'Test Golem'] } });
    expect(castAction(s, 'Test Brew')).toBeUndefined();
    s = exileWith(s, 'Test Anvil', 'Test Brew');
    expect(castAction(s, 'Test Brew')).toBeDefined();
    expect(castAction(s, 'Test Golem')).toBeUndefined();
  });
});

describe('CR 120.1: "an opponent was dealt 3 or more damage this turn" adds up the damage one opponent was dealt', () => {
  const endStep = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 40 && !(s.turn.step === 'end' && s.zones.stack.length > 0) && s.turn.number === 1; i++) s = settle(act(s, { type: 'pass', player: s.pending!.player }));
    return resolveAll(s);
  };
  it('3 damage to the opponent: the trigger gains 10 life; none: nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tally'], hand: ['Test Bolt'] } });
    const before = life(s, 'p1');
    s = resolveAll(settle(act(s, castAction(s, 'Test Bolt')!), { targets: [{ kind: 'player', id: 'p2' }] }), { targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBeLessThan(40);
    s = endStep(s);
    expect(life(s, 'p1')).toBe(before + 10);
    let n = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tally'] } });
    const b2 = life(n, 'p1');
    n = endStep(n);
    expect(life(n, 'p1')).toBe(b2);
  });
  it('damage to you does not count: you dealt 3 to yourself and the trigger does nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tally'], hand: ['Test Bolt'] } });
    s = resolveAll(settle(act(s, castAction(s, 'Test Bolt')!), { targets: [{ kind: 'player', id: 'p1' }] }), { targets: [{ kind: 'player', id: 'p1' }] });
    const before = life(s, 'p1');
    s = endStep(s);
    expect(life(s, 'p1')).toBe(before);
  });
});

describe('CR 607.2a, 611.3a, 702.51a: cards exiled with ~ may be played as long as a condition holds; noncreature spells cast from exile have convoke', () => {
  it('a {3} sorcery exiled with ~ is castable with three creatures to tap only while the convoke grant applies', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pacer', 'Test Thrasher', 'Test Squire', 'Test Squire', 'Test Squire'], graveyard: ['Test Brew'] } });
    s = exileWith(s, 'Test Pacer', 'Test Brew');
    expect(castAction(s, 'Test Brew')).toBeDefined();
    const without = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pacer', 'Test Squire', 'Test Squire', 'Test Squire'], graveyard: ['Test Brew'] } });
    expect(castAction(exileWith(without, 'Test Pacer', 'Test Brew'), 'Test Brew')).toBeUndefined();
  });
  it('a creature card cast from exile does not get convoke (the filter)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pacer', 'Test Thrasher', 'Test Squire', 'Test Squire', 'Test Squire'], graveyard: ['Test Golem'] } });
    s = exileWith(s, 'Test Pacer', 'Test Golem');
    expect(castAction(s, 'Test Golem')).toBeUndefined();
  });
});

describe('CR 607.2a, 611.3a, 500.1: during your turn, if you gained life this turn, you may cast spells from among cards exiled with ~', () => {
  it('before you gain life the exiled {0} instant is not castable; after, it is', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Stage'], graveyard: ['Test Bolt'], hand: ['Test Sip'] } });
    s = exileWith(s, 'Test Stage', 'Test Bolt');
    expect(castAction(s, 'Test Bolt')).toBeUndefined();
    s = resolveAll(act(s, castAction(s, 'Test Sip')!));
    expect(castAction(s, 'Test Bolt')).toBeDefined();
  });
});
