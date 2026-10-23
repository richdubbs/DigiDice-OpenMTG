/**
 * std-ry4 (wave 2 top-down, Commander lane ry4): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 107.3a, 601.2b    "As an additional cost to cast this spell, discard X cards / exile X cards from your graveyard": X is announced with the spell, no more than
 *                        can be paid, and that many cards are discarded / exiled
 *   CR 603.5, 613.1f     "you may have Elf creatures you control gain vigilance until end of turn": yes gives it to the Elves only, no gives it to none
 *   CR 603.2, 503.1      "At the beginning of your upkeep and whenever you cast a green spell": both events trigger it; a red spell does not
 *   CR 508.1, 611.2a     "Target creature can't attack this turn": not offered as an attacker that turn, offered the next; another creature attacks as usual
 *   CR 201.2             "search your library and/or graveyard for a card named <combo piece>": finds that card in the graveyard
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, OracleCard } from '../../../src/index';
import { compileCard, getChars } from '../../../src/index';
import { act, advanceTo, card, cast, find, full, lifeOf, obj, resolveAll, scenario } from '../r5-cost/support';
import { toDeclareAttackers } from '../../m4/helpers';

const FERVOR = card('Test Fervor', 'Sorcery', 'As an additional cost to cast this spell, discard X cards.\nYou gain X life.');
const DIRGE = card('Test Dirge', 'Sorcery', 'As an additional cost to cast this spell, exile X cards from your graveyard.\nYou gain X life.');
const BARD = card('Test Bard', 'Creature — Elf Bard', 'When this creature enters, you may have Elf creatures you control gain vigilance until end of turn.', '{0}', ['1', '1']);
const SHRINE = card('Test Shrine', 'Artifact', 'At the beginning of your upkeep and whenever you cast a green spell, put a charge counter on this artifact.');
const SPROUT = card('Test Sprout', 'Sorcery', 'You gain 1 life.', '{0}', undefined, ['G']);
const SPARK = card('Test Spark', 'Sorcery', 'You gain 1 life.', '{0}', undefined, ['R']);
const SNARE = card('Test Snare', 'Instant', "Target creature can't attack this turn.");
const ELF = card('Test Elf', 'Creature — Elf', '', '{0}', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const SEEKER = compileCard({
  name: 'Test Seeker', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Elf', power: '1', toughness: '1', colors: [],
  oracle_text: 'When this creature enters, you may search your library and/or graveyard for a card named Vexa, Keeper of Vows, reveal it, and put it into your hand. If you search your library this way, shuffle.',
  all_parts: [{ component: 'combo_piece', name: 'Vexa, Keeper of Vows', type_line: 'Legendary Creature — Elf' }, { component: 'combo_piece', name: 'Test Seeker', type_line: 'Creature — Elf' }],
} as OracleCard);
const VEXA = card('Vexa, Keeper of Vows', 'Legendary Creature — Elf', '', '{0}', ['3', '3']);
const DEFS = [FERVOR, DIRGE, BARD, SHRINE, SPROUT, SPARK, SNARE, ELF, BEAR, SEEKER, VEXA];

const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]?.counters[kind] ?? 0;
const hasKeyword = (s: GameState, id: ObjectId, kw: string): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === kw);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 107.3a, 601.2b: X defined by an additional cost', () => {
  it('"discard X cards": X = 2 discards two cards and gains 2 life', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Fervor', 'Test Bear', 'Test Elf', 'Test Spark'] } });
    const s = resolveAll(cast(s0, 'Test Fervor', { x: [2] }));
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(s.zones.hand.p1).toHaveLength(1);
    expect(s.zones.graveyard.p1).toHaveLength(3); // the two discarded cards and the spell
  });
  it('X can be no more than the cards that can be discarded (the spell itself is not one of them)', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Fervor', 'Test Bear'] } });
    const d = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fervor', 'hand') }).pending;
    expect(d?.kind === 'chooseNumber' ? d.max : d?.kind).toBe(1);
  });
  it('"exile X cards from your graveyard": X = 3 exiles three of the four cards there', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Dirge'], graveyard: ['Test Bear', 'Test Elf', 'Test Spark', 'Test Sprout'] } });
    const s = resolveAll(cast(s0, 'Test Dirge', { x: [3] }));
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.zones.exile).toHaveLength(3);
  });
  it('X = 0 costs nothing and gains nothing', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Dirge'], graveyard: ['Test Bear'] } });
    const s = resolveAll(cast(s0, 'Test Dirge', { x: [0] }));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.exile).toHaveLength(0);
  });
});

describe('CR 603.5, 613.1f: "you may have Elf creatures you control gain vigilance until end of turn"', () => {
  it('yes: the Elves you control gain vigilance until end of turn, the Bear does not', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Bard'], battlefield: ['Test Elf', 'Test Bear'] } });
    const s = resolveAll(cast(s0, 'Test Bard'), { yes: [true] });
    expect(hasKeyword(s, find(s, 'Test Elf', 'battlefield'), 'vigilance')).toBe(true);
    expect(hasKeyword(s, find(s, 'Test Bard', 'battlefield'), 'vigilance')).toBe(true);
    expect(hasKeyword(s, find(s, 'Test Bear', 'battlefield'), 'vigilance')).toBe(false);
    const later = advanceTo(s, 2, 'main1');
    expect(hasKeyword(later, find(later, 'Test Elf', 'battlefield'), 'vigilance')).toBe(false);
  });
  it('no: nothing gains vigilance', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Bard'], battlefield: ['Test Elf'] } });
    const s = resolveAll(cast(s0, 'Test Bard'), { yes: [false] });
    expect(hasKeyword(s, find(s, 'Test Elf', 'battlefield'), 'vigilance')).toBe(false);
  });
});

describe('CR 603.2, 503.1: "At the beginning of your upkeep and whenever you cast a green spell"', () => {
  it('a green spell adds a counter, a red one does not; your next upkeep adds another', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Sprout', 'Test Spark'], battlefield: ['Test Shrine'] } });
    s = advanceTo(s, 1, 'main1');
    const shrine = find(s, 'Test Shrine', 'battlefield');
    s = resolveAll(cast(s, 'Test Sprout'));
    expect(counters(s, shrine, 'charge')).toBe(1);
    s = resolveAll(cast(s, 'Test Spark'));
    expect(counters(s, shrine, 'charge')).toBe(1);
    s = advanceTo(s, 2, 'main1');
    expect(counters(s, shrine, 'charge')).toBe(1); // the opponent's upkeep is not yours
    s = advanceTo(s, 3, 'main1');
    expect(counters(s, shrine, 'charge')).toBe(2);
  });
});

describe('CR 508.1, 611.2a: "Target creature can\'t attack this turn"', () => {
  const candidates = (s: GameState): ObjectId[] => ((s.pending as { candidates?: { id: ObjectId }[] }).candidates ?? []).map((c) => c.id);
  it('the target is not offered as an attacker this turn, the other creature is; the next turn it attacks again', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Snare'], battlefield: ['Test Bear', 'Test Elf'] } });
    s = advanceTo(s, 3, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Snare', { targets: [[obj(bear)]] }));
    const atk = toDeclareAttackers(s);
    expect(candidates(atk)).not.toContain(bear);
    expect(candidates(atk)).toContain(find(s, 'Test Elf', 'battlefield'));
    const next = toDeclareAttackers(advanceTo(s, 5, 'main1'));
    expect(candidates(next)).toContain(bear);
  });
});

describe('CR 201.2: "a card named <combo piece>" (parser/parse.ts#namedComboPieces)', () => {
  it('searching the graveyard (the zone the player chooses, CR 701.23a) finds the named card and puts it into your hand; another card stays', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Seeker'], graveyard: ['Vexa, Keeper of Vows', 'Test Bear'] } });
    const vexa = find(s0, 'Vexa, Keeper of Vows', 'graveyard');
    const s = resolveAll(cast(s0, 'Test Seeker'), { yes: [true], options: [['graveyard']], objects: [[vexa]] });
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toContain('Vexa, Keeper of Vows');
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Bear']);
  });
});
