/**
 * Commander lane edh-c, round edh-c-47 (EDHREC ranks 16,001 to 16,500, later pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks and has its negative case. CR cites checked against
 * the Comprehensive Rules of 2026-09-25.
 *
 *   CR 107.3, 122.1, 602.2b, 608.2c    "Remove all +1/+1 counters from ~: Target creature gets -1/-1 until end of turn for each +1/+1 counter removed this way." and the damage "where X is the number of counters removed this way"
 *   CR 701.53a                         "You incubate 2."
 *   CR 602.2b, 601.2f, 205.3i          "This ability costs {1} less to activate for each basic land type among lands you control."
 *   CR 701.16a, 608.2h                 "Discard any number of cards, then investigate twice for each card discarded this way."
 *   CR 202.1, 614.1c, 122.6            "~ enters with a +1/+1 counter on it for each different mana cost among nonland cards in your graveyard."
 *   CR 510.1b, 510.1c, 609.4           "You may have <the card> assign his combat damage as though he weren't blocked." (a character's own pronouns)
 *   CR 601.2b, 118.9, 500.1            "Once during each of your turns, you may cast a noncreature or Robot spell from your hand without paying its mana cost."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, find, legal, scenario } from '../../m3/scenario';
import { counters, full, named, pt, resolveAll, settle, tokens } from '../cmd3/helpers';
import { mpScenario, passUntil, reject, answer as manswer } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function cardOf(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;
const alive = (s: GameState, id: ObjectId): boolean => s.objects[id]?.zone === 'battlefield';
const activate = (s: GameState, source: ObjectId, targets: TargetChoice[] = []): GameState => {
  const la = legal(s, 'p1', 'activate').find((a) => a.object === source);
  expect(la, 'the ability is activatable').toBeDefined();
  return resolveAll(act(s, la!.action), { targets });
};

describe('CR 107.3, 122.1, 602.2b, 608.2c: "Remove all +1/+1 counters from ~: Target creature gets -1/-1 until end of turn for each +1/+1 counter removed this way."', () => {
  const BEARER = cardOf('Test Wither Bearer', 'Creature — Wizard', 'Remove all +1/+1 counters from ~: Target creature gets -1/-1 until end of turn for each +1/+1 counter removed this way.', { pt: ['1', '1'] });
  const BIG = cardOf('Test Big Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const game = (n: number): GameState => scenario([], { defs: [BEARER, BIG], p1: { battlefield: [{ name: 'Test Wither Bearer', counters: n > 0 ? { '+1/+1': n } : {} }] }, p2: { battlefield: ['Test Big Ox'] } });
  it('is automated', () => { expect(full(BEARER)).toBe(true); });
  it('three counters: the target gets -3/-3 and the counters are gone; no counters: -0/-0 (the negative case)', () => {
    const s0 = game(3);
    const ox = find(s0, 'Test Big Ox', 'battlefield', 'p2');
    const bearer = find(s0, 'Test Wither Bearer', 'battlefield', 'p1');
    const s = activate(s0, bearer, [obj(ox)]);
    expect(pt(s, ox)).toBe('1/1');
    expect(counters(s, bearer, '+1/+1')).toBe(0);
    const none = game(0);
    const s2 = activate(none, find(none, 'Test Wither Bearer', 'battlefield', 'p1'), [obj(find(none, 'Test Big Ox', 'battlefield', 'p2'))]);
    expect(pt(s2, find(s2, 'Test Big Ox', 'battlefield', 'p2'))).toBe('4/4');
  });
});

describe('CR 107.3, 120.3, 608.2c: "Remove all +1/+1 counters from ~: ~ deals X damage to target creature, where X is the number of counters removed this way."', () => {
  const SHOOTER = cardOf('Test Spark Archer', 'Creature — Archer', 'Remove all +1/+1 counters from ~: ~ deals X damage to target creature, where X is the number of counters removed this way.', { pt: ['1', '1'] });
  const OX = cardOf('Test Small Ox', 'Creature — Ox', '', { pt: ['2', '3'] });
  const game = (): GameState => scenario([], { defs: [SHOOTER, OX], p1: { battlefield: [{ name: 'Test Spark Archer', counters: { '+1/+1': 2 } }] }, p2: { battlefield: ['Test Small Ox'] } });
  it('is automated', () => { expect(full(SHOOTER)).toBe(true); });
  it('two counters removed: two damage to the target (a 2/3 survives), and the counters are gone', () => {
    const s0 = game();
    const ox = find(s0, 'Test Small Ox', 'battlefield', 'p2');
    const archer = find(s0, 'Test Spark Archer', 'battlefield', 'p1');
    const s = activate(s0, archer, [obj(ox)]);
    expect(dmg(s, ox)).toBe(2);
    expect(alive(s, ox)).toBe(true);
    expect(counters(s, archer, '+1/+1')).toBe(0);
  });
});

describe('CR 701.53a: "You incubate 2."', () => {
  const RITE = cardOf('Test Gene Rite', 'Sorcery', 'You incubate 2.');
  it('is automated; an Incubator token with two +1/+1 counters enters under your control, not an opponent\'s', () => {
    expect(full(RITE)).toBe(true);
    const s0 = scenario([], { defs: [RITE], p1: { hand: ['Test Gene Rite'] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gene Rite', 'hand', 'p1') } as never));
    const inc = tokens(s, 'p1');
    expect(inc.length).toBe(1);
    expect(counters(s, inc[0]!, '+1/+1')).toBe(2);
    expect(tokens(s, 'p2').length).toBe(0);
  });
});

describe('CR 602.2b, 601.2f, 205.3i: "This ability costs {1} less to activate for each basic land type among lands you control."', () => {
  const CODEX = cardOf('Test Domain Codex', 'Artifact — Book', '{5}, {T}: Draw a card. This ability costs {1} less to activate for each basic land type among lands you control.', { cost: '{5}' });
  const game = (lands: string[]): GameState => scenario(['Forest', 'Island', 'Mountain'], { defs: [CODEX], p1: { battlefield: ['Test Domain Codex', ...lands], library: ['Forest', 'Forest'] } });
  const can = (s: GameState): boolean => legal(s, 'p1', 'activate').some((a) => a.object === find(s, 'Test Domain Codex', 'battlefield', 'p1') && !a.isMana);
  it('is automated', () => { expect(full(CODEX)).toBe(true); });
  it('two basic land types: {3} (three lands pay it); one basic land type, even from three lands: {4} (three lands cannot)', () => {
    expect(can(game(['Forest', 'Island', 'Forest']))).toBe(true);
    expect(can(game(['Forest', 'Forest', 'Forest']))).toBe(false);
    expect(can(game(['Forest', 'Island', 'Mountain']))).toBe(true);
  });
});

describe('CR 701.16a, 608.2h: "Discard any number of cards, then investigate twice for each card discarded this way."', () => {
  const STUDY = cardOf('Test Deep Study', 'Sorcery', 'Discard any number of cards, then investigate twice for each card discarded this way.');
  const hand = ['Test Deep Study', 'Forest', 'Forest', 'Island'];
  const run = (pick: number): number => {
    const s0 = scenario(['Forest', 'Island'], { defs: [STUDY], p1: { hand } });
    const cards = s0.zones.hand['p1']!.filter((id) => s0.objects[id]!.defId !== 'Test Deep Study');
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Deep Study', 'hand', 'p1') } as never));
    const done = resolveAll(s1, { objects: cards.slice(0, pick) });
    return tokens(done, 'p1').filter((id) => JSON.stringify(done.objects[id]).includes('Clue')).length;
  };
  it('is automated', () => { expect(full(STUDY)).toBe(true); });
  it('two cards discarded: four Clues; one: two; none: none (the count is the cards discarded, not the cards in hand)', () => {
    expect(run(2)).toBe(4);
    expect(run(1)).toBe(2);
    expect(run(0)).toBe(0);
  });
});

describe('CR 202.1, 614.1c, 122.6: "~ enters with a +1/+1 counter on it for each different mana cost among nonland cards in your graveyard."', () => {
  const FIEND = cardOf('Test Cost Fiend', 'Creature — Demon', '~ enters with a +1/+1 counter on it for each different mana cost among nonland cards in your graveyard.', { pt: ['0', '0'] });
  const A = cardOf('Test Cost A', 'Instant', 'You gain 1 life.', { cost: '{1}{R}' });
  const B = cardOf('Test Cost B', 'Sorcery', 'You gain 1 life.', { cost: '{1}{R}' });
  const C = cardOf('Test Cost C', 'Instant', 'You gain 1 life.', { cost: '{2}' });
  const D = cardOf('Test Cost D', 'Artifact', '', { cost: '{3}' });
  const defs = [FIEND, A, B, C, D];
  const enter = (mine: string[], theirs: string[] = []): number => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Test Cost Fiend'], graveyard: mine }, p2: { graveyard: theirs } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cost Fiend', 'hand', 'p1') } as never));
    return counters(s, named(s, 'Test Cost Fiend')[0]!, '+1/+1');
  };
  it('is automated', () => { expect(full(FIEND)).toBe(true); });
  it('two cards with the same cost count once; another cost counts again; a land and an opponent\'s graveyard count not at all', () => {
    expect(enter(['Test Cost A', 'Test Cost B'])).toBe(1);
    expect(enter(['Test Cost A', 'Test Cost B', 'Test Cost C'])).toBe(2);
    expect(enter(['Test Cost A', 'Test Cost C', 'Test Cost D', 'Forest'])).toBe(3);
    expect(enter(['Forest'], ['Test Cost A', 'Test Cost C'])).toBe(0);
  });
  it('a split card counts its two halves joined: {1}{R} // {1}{U} is {2}{U}{R}, the same cost as a single card {2}{R}{U}; a different cost is another (ruling 2019-07-12, CR 709.4b)', () => {
    const SPLIT = compileCard({ name: 'Test Split One // Test Split Two', layout: 'split', mana_cost: '{1}{R} // {1}{U}', type_line: 'Instant // Instant', colors: [], card_faces: [
      { name: 'Test Split One', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'You gain 1 life.' }, { name: 'Test Split Two', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'You gain 1 life.' }] } as unknown as OracleCard);
    const JOINED = cardOf('Test Joined Cost', 'Sorcery', 'You gain 1 life.', { cost: '{2}{R}{U}' });
    const run = (yard: string[]): number => {
      const s0 = scenario([], { defs: [...defs, SPLIT, JOINED], p1: { hand: ['Test Cost Fiend'], graveyard: yard } });
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cost Fiend', 'hand', 'p1') } as never));
      return counters(s, named(s, 'Test Cost Fiend')[0]!, '+1/+1');
    };
    expect(run(['Test Split One // Test Split Two', 'Test Joined Cost'])).toBe(1);
    expect(run(['Test Split One // Test Split Two', 'Test Cost C'])).toBe(2);
  });
});

describe('CR 510.1b, 510.1c, 609.4: "You may have <the card> assign his combat damage as though he weren\'t blocked."', () => {
  const HERO = cardOf('Test Claw Hero', 'Legendary Creature — Mutant Hero', "You may have Test Claw Hero assign his combat damage as though he weren't blocked.", { pt: ['3', '3'] });
  const PLAIN = cardOf('Test Claw Plain', 'Creature — Mutant', "You may have ~ assign its combat damage as though it weren't blocked.", { pt: ['3', '3'] });
  const NONE = cardOf('Test Claw None', 'Legendary Creature — Mutant Hero', 'Trample', { pt: ['3', '3'] });
  const permit = (d: CardDef): string => JSON.stringify(d.faces[0]!.abilities.map((a) => JSON.parse(JSON.stringify(a, (k, v) => (k === 'text' || k === 'src' || k === 'prov' ? undefined : v)))));
  it('is automated and builds the same permission as the "its ... it" wording; a different wording (trample) builds none', () => {
    expect(full(HERO)).toBe(true);
    expect(permit(HERO)).toBe(permit(PLAIN));
    expect(permit(NONE)).not.toContain('assignAsUnblocked');
    expect(permit(HERO)).toContain('assignAsUnblocked');
  });
});

describe('CR 601.2b, 118.9, 500.1: "Once during each of your turns, you may cast a noncreature or Robot spell from your hand without paying its mana cost."', () => {
  const SYNTH = cardOf('Test Free Synth', 'Creature — Robot', 'Once during each of your turns, you may cast a noncreature or Robot spell from your hand without paying its mana cost.', { pt: ['1', '1'] });
  const BOLT = cardOf('Test Big Bolt', 'Instant', 'You gain 1 life.', { cost: '{5}' });
  const DROID = cardOf('Test Big Droid', 'Creature — Robot', '', { pt: ['2', '2'], cost: '{5}' });
  const BEAR = cardOf('Test Big Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{5}' });
  const defs = [SYNTH, BOLT, DROID, BEAR];
  const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));
  it('is automated', () => { expect(full(SYNTH)).toBe(true); });
  it('a noncreature spell and a Robot spell are free; a creature that is no Robot is not (the negative case)', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Free Synth'], hand: ['Test Big Bolt', 'Test Big Droid', 'Test Big Bear'] } });
    expect(castable(s, 'Test Big Bolt')).toBe(true);
    expect(castable(s, 'Test Big Droid')).toBe(true);
    expect(castable(s, 'Test Big Bear')).toBe(false);
  });
  it('only once each turn: after the free Robot, the free instant is no longer castable', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Free Synth'], hand: ['Test Big Bolt', 'Test Big Droid'] } });
    const free = legal(s0, 'p1', 'cast').find((a) => a.object === find(s0, 'Test Big Droid', 'hand', 'p1'))!;
    const s = resolveAll(act(s0, free.action));
    expect(castable(s, 'Test Big Bolt')).toBe(false);
  });
  it('without the permanent nothing is free', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Big Bolt'] } });
    expect(castable(s, 'Test Big Bolt')).toBe(false);
  });
});
