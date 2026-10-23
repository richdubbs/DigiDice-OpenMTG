/**
 * std-rx9 (wave 2, slice s18): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 114.2, 607.2d, 608.2c  "Choose a creature type. You get an emblem with \"Creatures you control of the chosen type get +N/+N ...\"": the emblem keeps the
 *                             type chosen as the ability resolved, after the planeswalker has left; creatures of another type get nothing
 *   CR 614.12a, 118.12        "As ~ enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters tapped."
 *   CR 305.7                  "~ is the chosen type": the land is that basic land type only (its mana ability), never its old land types
 *   CR 601.3, 702.190a        "You may cast creature spells from your graveyard using their sneak abilities": the sneak cost from the graveyard, only with the permission
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { card, full, pt, resolveAll, settle } from '../cmd3/helpers';

function walker(name: string, text: string, loyalty: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testwalker', oracle_text: text, colors: [], loyalty } as OracleCard);
}

const SAGE = walker('Test Sage', '+1: Choose a creature type. You get an emblem with "Creatures you control of the chosen type get +2/+2 and have vigilance."', '3');
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const PASSAGE = card('Test Passage', 'Land', "As this land enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters tapped.\nThis land is the chosen type.");
const DOJO = card('Test Dojo', 'Enchantment', 'Creature cards in your graveyard have sneak {1}.\nYou may cast creature spells from your graveyard using their sneak abilities.');
const SHRINE = card('Test Shrine', 'Enchantment', 'Creature cards in your graveyard have sneak {1}.');
const RUNNER = card('Test Runner', 'Creature — Human', '', ['2', '2'], '{5}');
const DEFS = [SAGE, ELF, GOBLIN, PASSAGE, DOJO, SHRINE, RUNNER];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** Answer the name choice in front of us ("choose a creature type", "choose a basic land type") with `word`. */
function pick(s: GameState, word: string): GameState {
  const d = s.pending as { kind: string; options?: string[] } | undefined;
  expect(d?.kind, JSON.stringify(s.pending).slice(0, 200)).toBe('chooseName');
  expect(d!.options).toContain(word);
  return answer(s, { kind: 'chooseName', name: word });
}

describe('CR 114.2, 607.2d, 608.2c: "the chosen type" inside an emblem is the type the ability chose as it resolved', () => {
  const emblem = (type: string): GameState => {
    let s = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Sage', counters: { loyalty: 3 } }, 'Test Elf', 'Test Goblin'] }, defs: DEFS });
    s = advanceTo(s, 1, 'main1');
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Sage', 'battlefield'), ability: 'p:0:0' });
    s = settle(s);
    s = act(s, { type: 'pass', player: 'p1' });
    for (let i = 0; i < 5 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = act(s, { type: 'pass', player: s.pending.player });
    return settle(pick(s, type));
  };
  it('creatures you control of the chosen type get +2/+2 and vigilance; a creature of another type gets nothing', () => {
    const s = emblem('Elf');
    const elf = find(s, 'Test Elf', 'battlefield');
    const goblin = find(s, 'Test Goblin', 'battlefield');
    expect(pt(s, elf)).toBe('3/3');
    expect(getChars(s, elf)!.keywords.map((k) => k.keyword)).toContain('vigilance');
    expect(pt(s, goblin)).toBe('1/1');
    expect(getChars(s, goblin)!.keywords.map((k) => k.keyword)).not.toContain('vigilance');
  });
  it('the emblem keeps the choice after the planeswalker has left the battlefield (CR 114.4: it is the emblem that has the ability)', () => {
    const s0 = emblem('Goblin');
    const sage = find(s0, 'Test Sage', 'battlefield');
    const s = JSON.parse(JSON.stringify(s0)) as GameState;
    s.zones.battlefield = s.zones.battlefield.filter((id) => id !== sage);
    s.objects[sage]!.zone = 'graveyard';
    s.zones.graveyard['p1']!.push(sage);
    expect(pt(s, find(s, 'Test Goblin', 'battlefield'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Elf', 'battlefield'))).toBe('1/1');
  });
});

describe('CR 614.12a, 118.12, 305.7: "As ~ enters, choose a basic land type. Then you may pay 2 life ..." and "~ is the chosen type"', () => {
  const play = (type: string, pay: boolean): { s: GameState; land: ObjectId } => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Passage'] }, defs: DEFS });
    s = advanceTo(s, 1, 'main1');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Passage', 'hand') });
    s = pick(s, type);
    s = settle(s, { yes: pay });
    return { s, land: find(s, 'Test Passage', 'battlefield') };
  };
  it('paying 2 life: it enters untapped and is an Island with "{T}: Add {U}" (CR 305.6), and no other land type', () => {
    const { s, land } = play('Island', true);
    expect(life(s, 'p1')).toBe(18);
    expect(s.objects[land]!.tapped).toBe(false);
    expect(getChars(s, land)!.subtypes).toEqual(['Island']);
    // CR 305.7: its own rules text is gone (the type was set to a basic land type); the Island's mana ability is all it has
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === land).map((a) => a.label)).toEqual(['Test Passage: {T}: Add {U}.']);
  });
  it('not paying: it enters tapped, life unchanged, and is the chosen type all the same', () => {
    const { s, land } = play('Forest', false);
    expect(life(s, 'p1')).toBe(20);
    expect(s.objects[land]!.tapped).toBe(true);
    expect(getChars(s, land)!.subtypes).toEqual(['Forest']);
  });
});

describe('CR 601.3, 702.190a: "You may cast creature spells from your graveyard using their sneak abilities"', () => {
  const gyCasts = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard').map((a) => a.label);
  const toBlockers = (permit: string): GameState => {
    let s = scenario(['Plains'], { p1: { battlefield: [permit, 'Test Elf', 'Plains'], graveyard: ['Test Runner'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Elf', 'battlefield')]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || (x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority'), 'the declare blockers step', 10);
    if (s.pending?.kind === 'declareBlockers') s = act(s, { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: { kind: 'declareBlockers', blocks: [] } } as never);
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers' && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'p1 in the declare blockers step', 10);
    return s;
  };
  it('with the permission, the creature card is offered from the graveyard for its sneak cost in the declare blockers step, and it enters attacking', () => {
    let s = toBlockers('Test Dojo');
    const offered = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard');
    expect(offered.map((a) => a.label)).toEqual(gyCasts(s));
    expect(offered).toHaveLength(1);
    expect(offered[0]!.label).toMatch(/^Cast Test Runner \(sneak/);
    s = resolveAll(settle(act(s, offered[0]!.action)));
    const runner = find(s, 'Test Runner', 'battlefield');
    expect(s.objects[runner]!.tapped).toBe(true);
    expect(s.combat!.attackers.map((a) => a.id)).toContain(runner);
  });
  it('a card in the graveyard that only has sneak (no permission) is not offered (CR 601.3)', () => {
    const s = toBlockers('Test Shrine');
    expect(gyCasts(s)).toEqual([]);
  });
});
