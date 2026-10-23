/**
 * std-library-3 (account B lane std-library: library and graveyard sequences): the round's readings played through the engine with synthetic cards compiled by
 * the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 205.2a, 608.2d        "For each card type, you may exile a card of that type from among them.": one card per card type at most, offered type by type;
 *                            an artifact creature taken for one type is not offered for the other
 *   CR 608.2c, 608.2h        "if you exiled four or more cards this way": the count of what that exile moved; with three, nothing is cast
 *   CR 608.2g, 118.9, 305.9  "You may cast a spell from among the exiled cards without paying its mana cost": a nonland exiled card, free; a land is not offered
 *   CR 608.2c, 406.1, 400.7  "Then put the rest of the exiled cards into your hand.": the exiled cards not cast; the revealed cards not exiled went to the graveyard
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, card, drive, find, full, passBoth, scenario } from '../r5-cost/support';

const PT = (p: string, t: string): [string, string] => [p, t];
const OMEN = card('Test Dire Omen', 'Sorcery', 'Reveal the top X cards of your library. For each card type, you may exile a card of that type from among them. Put the rest into your graveyard. You may cast a spell from among the exiled cards without paying its mana cost if you exiled four or more cards this way. Then put the rest of the exiled cards into your hand.', '{X}{W}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', PT('2', '2'));
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{3}', PT('3', '3'));
const RELIC = card('Test Relic', 'Artifact', '', '{2}');
const AURA = card('Test Ward', 'Enchantment', '', '{2}');
const SPARK = card('Test Spark', 'Instant', 'You gain 3 life.', '{5}');
const DEFS = [OMEN, BEAR, GOLEM, RELIC, AURA, SPARK];

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => nameOf(s, id)).sort();
const optionNames = (s: GameState): string[] => names(s, (s.pending as unknown as { options: ObjectId[] }).options);
const prompt = (s: GameState): string => (s.pending as unknown as { prompt: string }).prompt;

/** Cast the Omen with X = `x` (the lands pay), and stop at the first choice of its resolution. */
function castOmen(s0: GameState, x: number): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dire Omen', 'hand', 'p1') });
  s = drive(s, { x: [x] });
  return passBoth(s);
}
const pick = (s: GameState, name?: string): GameState => answer(s, { kind: 'chooseObjects', ids: name === undefined ? [] : [find(s, name, 'library', 'p1')] });

describe('the synthetic card is automated', () => {
  it('plays fully', () => expect(full(OMEN), JSON.stringify(OMEN.automation)).toBe(true));
});

describe('CR 205.2a, 608.2d, 608.2g, 406.1: for each card type, the free cast when four or more were exiled, the rest into your hand', () => {
  const start = (): GameState => scenario([], {
    defs: DEFS,
    p1: { hand: ['Test Dire Omen'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], library: ['Test Golem', 'Test Bear', 'Test Relic', 'Plains', 'Test Spark', 'Test Ward'] },
  });
  it('one card of each type: the Golem as the artifact is not offered again as the creature; four exiled, the Spark is cast free, the others go to your hand', () => {
    let s = castOmen(start(), 5); // Golem, Bear, Relic, Plains, Spark revealed; the Ward stays on top
    expect(prompt(s)).toContain('artifact');
    expect(optionNames(s)).toEqual(['Test Golem', 'Test Relic']);
    s = pick(s, 'Test Golem'); // the artifact
    expect(prompt(s)).toContain('creature');
    expect(optionNames(s)).toEqual(['Test Bear']); // the Golem is taken
    s = pick(s, 'Test Bear');
    expect(prompt(s)).toContain('instant');
    s = pick(s, 'Test Spark');
    expect(prompt(s)).toContain('land');
    s = pick(s, 'Plains');
    expect(s.pending?.kind).toBe('chooseObjects'); // four exiled: the free cast
    expect(optionNames(s)).toEqual(['Test Bear', 'Test Golem', 'Test Spark']); // the land is no spell (CR 305.9)
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.exile.find((id) => nameOf(s, id) === 'Test Spark')!] });
    s = drive(s);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Test Dire Omen', 'Test Relic']); // the Relic: revealed, not exiled
    expect(names(s, s.zones.hand.p1!)).toEqual(['Plains', 'Test Bear', 'Test Golem']); // the rest of the exiled cards
    expect(names(s, s.zones.stack)).toEqual(['Test Spark']); // cast without paying its {5} (six lands paid X = 5 and {W})
    expect(s.zones.exile).toHaveLength(0);
  });
  it('three exiled: no cast is offered and the three go to your hand', () => {
    let s = castOmen(start(), 5);
    s = pick(s, 'Test Relic');
    s = pick(s, 'Test Bear');
    s = pick(s, 'Test Spark');
    s = pick(s);
    s = drive(s);
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Bear', 'Test Relic', 'Test Spark']);
    expect(names(s, s.zones.graveyard.p1!)).toEqual(['Plains', 'Test Dire Omen', 'Test Golem']);
    expect(s.zones.stack).toHaveLength(0);
  });
});
