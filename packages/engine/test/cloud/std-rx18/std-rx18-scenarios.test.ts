/**
 * std-rx18 (wave 2, Commander precon lane rx18): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 205.1b, 613.1d, 611.2a  "Target permanent becomes an artifact in addition to its other types until end of turn": an artifact land until the turn ends,
 *                              a land again after; with no duration it stays an artifact (CR 611.2c)
 *   CR 613.4b, 613.1f          "Enchanted creature has base power and toughness N/N and has <keyword>": the counters still apply on top (layer 7c)
 *   CR 613.1f, 508.1c, 509.1b  "Enchanted creature loses all abilities and can't attack or block": no flying, not offered as an attacker
 *   CR 702.29a, 701.9a, 109.1  "Whenever you cycle or discard another card": one trigger for a cycled card, one for a discarded card; an opponent's discard is not
 *   CR 701.21a, 701.9a, 119.3  "Target opponent sacrifices a creature of their choice, discards a card, and loses N life"
 *   CR 701.16a, 102.3          "investigate X times, where X is the number of opponents you have": one Clue in a two-player game
 *   CR 111.2, 115.1            "you and target opponent each create a Treasure token": one Treasure each
 *   CR 509.1b, 611.2c          "creatures without flying your opponents control can't block this turn": their flyer may block, their other creature may not
 */
import { describe, expect, it } from 'vitest';
import { getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { card, full, pt, tokens } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const types = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.types;
const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);

/** Pay costs automatically, then answer the queued decisions in order; stop at priority. */
function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty, answering the queued decisions on the way. */
function resolveAll(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = settle(s0, answers);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), answers);
  return s;
}
/** Cast an Aura from a player's hand onto `target` and resolve it. */
const enchant = (s: GameState, aura: string, target: ObjectId, player = 'p1'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player, card: find(s, aura, 'hand', player) }), [{ kind: 'chooseTargets', targets: [obj(target)] }]));
function activate(s: GameState, id: ObjectId, answers: DecisionAnswer[] = [], text?: string, player = 'p1'): GameState {
  const la = legal(s, player, 'activate').find((a) => a.object === id && !a.isMana && (text === undefined || a.label.includes(text)));
  if (!la) throw new Error(`no ability to activate on ${s.objects[id]?.defId}${text ? ` (${text})` : ''}`);
  return settle(act(s, la.action), answers);
}

const COATING = card('Test Coating', 'Artifact', '{T}: Target permanent becomes an artifact in addition to its other types until end of turn.');
const FORGE = card('Test Forge', 'Artifact', '{T}: Target permanent becomes an artifact in addition to its other types.');
const MANTLE = card('Test Mantle', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has base power and toughness 5/5 and has trample.');
const STASIS = card('Test Stasis', 'Enchantment — Aura', "Enchant creature\nEnchanted creature loses all abilities and can't attack or block.");
const FIEND = card('Test Fiend', 'Creature — Demon', 'Whenever you cycle or discard another card, you gain 2 life.', ['3', '3']);
const CYCLER = card('Test Cycler', 'Creature — Bird', 'Cycling {0}', ['1', '1']);
const PURGE = card('Test Purge', 'Sorcery', 'Target opponent sacrifices a creature of their choice, discards a card, and loses 3 life.');
const RUMMAGE = card('Test Rummage', 'Sorcery', 'Discard a card, then draw a card.');
const SLEUTH = card('Test Sleuth', 'Creature — Spirit', 'When this creature enters, investigate X times, where X is the number of opponents you have.', ['1', '1']);
const BROKER = card('Test Broker', 'Creature — Human', 'When this creature enters, you and target opponent each create a Treasure token.', ['1', '1']);
const QUAKE = card('Test Quake', 'Sorcery', "Creatures without flying your opponents control can't block this turn.");
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const HAWK = card('Test Hawk', 'Creature — Bird', 'Flying', ['1', '1']);
const DEFS: CardDef[] = [COATING, FORGE, MANTLE, STASIS, FIEND, CYCLER, PURGE, RUMMAGE, SLEUTH, BROKER, QUAKE, BEAR, HAWK];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 205.1b, 613.1d, 611.2a: "<permanent> becomes an artifact in addition to its other types [until end of turn]"', () => {
  it('until end of turn: the land is an artifact land this turn (its other types kept), only a land in the next turn; another land is untouched', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Coating', 'Plains', 'Plains'] }, defs: DEFS });
    const [land, other] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains');
    s = resolveAll(activate(s, find(s, 'Test Coating', 'battlefield'), [{ kind: 'chooseTargets', targets: [obj(land!)] }]));
    expect(types(s, land!).sort()).toEqual(['Artifact', 'Land']);
    expect(getChars(s, land!)!.subtypes).toContain('Plains');
    expect(types(s, other!)).toEqual(['Land']);
    s = advanceTo(s, 2, 'main1');
    expect(types(s, land!)).toEqual(['Land']);
  });
  it('with no duration (CR 611.2c): still an artifact in the next turn', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Forge', 'Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(activate(s, find(s, 'Test Forge', 'battlefield'), [{ kind: 'chooseTargets', targets: [obj(bear)] }]));
    s = advanceTo(s, 2, 'main1');
    expect(types(s, bear).sort()).toEqual(['Artifact', 'Creature']);
  });
});

describe('CR 613.4b, 613.1f: "Enchanted creature has base power and toughness 5/5 and has trample"', () => {
  it('the base 5/5 and trample apply to the enchanted creature; its +1/+1 counter still counts (layer 7c after 7b); another creature is untouched', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Mantle'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Hawk'] }, defs: DEFS });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const hawk = find(s0, 'Test Hawk', 'battlefield');
    const s = enchant(s0, 'Test Mantle', bear);
    expect(s.objects[find(s, 'Test Mantle', 'battlefield')]!.attachedTo).toBe(bear);
    expect(pt(s, bear)).toBe('6/6');
    expect(keywords(s, bear)).toContain('trample');
    expect(pt(s, hawk)).toBe('1/1');
    expect(keywords(s, hawk)).not.toContain('trample');
  });
});

describe('CR 613.1f, 508.1c, 509.1b: "Enchanted creature loses all abilities and can\'t attack or block"', () => {
  it('the enchanted flyer has no flying and is not offered as an attacker; the other creature is', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Stasis'], battlefield: ['Test Hawk', 'Test Bear'] }, defs: DEFS });
    const hawk = find(s, 'Test Hawk', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = enchant(s, 'Test Stasis', hawk);
    expect(keywords(s, hawk)).not.toContain('flying');
    s = toDeclareAttackers(advanceTo(s, 3, 'main1'));
    const d = s.pending as { kind: string; candidates: { id: ObjectId }[] };
    expect(d.candidates.map((c) => c.id)).toEqual([bear]);
  });
  it('the enchanted creature of the opponent cannot block', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Stasis'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Hawk'] }, defs: DEFS });
    const hawk = find(s, 'Test Hawk', 'battlefield', 'p2');
    s = enchant(s, 'Test Stasis', hawk);
    s = declareAttackers(toDeclareAttackers(advanceTo(s, 3, 'main1')), [[find(s, 'Test Bear', 'battlefield')]]);
    // its only creature can't block, so p2 is never asked to declare blockers (or is offered no blocker) and the Bear's damage goes through
    for (let guard = 0; guard < 40 && s.turn.step !== 'endCombat'; guard++) {
      if (s.pending?.kind === 'declareBlockers') {
        expect(JSON.stringify(s.pending)).not.toContain(`"${hawk}"`);
        s = answer(s, { kind: 'declareBlockers', blocks: [] });
      } else s = pass(s);
    }
    expect(s.turn.number).toBe(3);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 702.29a, 701.9a, 109.1: "Whenever you cycle or discard another card, you gain 2 life"', () => {
  it('cycling a card triggers it once (the cycling cost discards the card); discarding a card to an effect triggers it once more', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Cycler', 'Test Rummage', 'Test Bear'], battlefield: ['Test Fiend'] }, defs: DEFS });
    s = resolveAll(activate(s, find(s, 'Test Cycler', 'hand')));
    expect(life(s, 'p1')).toBe(22);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rummage', 'hand') })), [{ kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand')] }]);
    expect(life(s, 'p1')).toBe(24);
  });
  it('an opponent\'s discard does not trigger it', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Fiend'] }, p2: { hand: ['Test Rummage', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Rummage', 'hand', 'p2') })), [{ kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p2')] }]);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 701.21a, 701.9a, 119.3: "Target opponent sacrifices a creature of their choice, discards a card, and loses 3 life"', () => {
  it('the opponent sacrifices their creature, discards their card and loses 3 life; your own creature stays', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Purge'], battlefield: ['Test Hawk'] }, p2: { hand: ['Test Bear'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Purge', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    s = resolveAll(s, [{ kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'battlefield', 'p2')] }, { kind: 'chooseObjects', ids: [find(s, 'Test Bear', 'hand', 'p2')] }]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.defId === 'Test Bear')).toEqual([]);
    expect(s.zones.hand['p2']).toEqual([]);
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Hawk')).toBe(true);
  });
});

describe('CR 701.16a, 102.3: "investigate X times, where X is the number of opponents you have"', () => {
  it('in a two-player game: one Clue for you, none for the opponent', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Sleuth'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sleuth', 'hand') })));
    expect(tokens(s, 'p1').map((id) => s.objects[id]!.defId).filter((d) => /Clue/i.test(d))).toHaveLength(1);
    expect(tokens(s, 'p2')).toEqual([]);
  });
});

describe('CR 111.2, 115.1: "you and target opponent each create a Treasure token"', () => {
  it('one Treasure for you and one for the target opponent', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Broker'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Broker', 'hand') })), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    const treasures = (p: string): number => tokens(s, p).filter((id) => /Treasure/i.test(s.objects[id]!.defId)).length;
    expect(treasures('p1')).toBe(1);
    expect(treasures('p2')).toBe(1);
  });
});

describe('CR 509.1b, 611.2c: "Creatures without flying your opponents control can\'t block this turn"', () => {
  it('the opponent\'s creature without flying is not offered as a blocker; their flyer is', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Quake'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Hawk'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quake', 'hand') })));
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1')]]));
    const d = JSON.stringify(s.pending);
    expect(d).toContain(`"${find(s, 'Test Hawk', 'battlefield', 'p2')}"`);
    expect(d).not.toContain(`"${find(s, 'Test Bear', 'battlefield', 'p2')}"`);
  });
});
