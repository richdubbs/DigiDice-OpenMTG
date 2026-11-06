/**
 * Top-rank round 3, edh-next-87 (code edhn87): the readings and render alternatives of the round at the parser level (guard G9, design 6.8): each wording is fully automated with its card
 * shape and its near misses are not. The round adds no template file; it widens the pronoun rule (parser/lower/anaphora.ts), the keyword link of backup (parser/parse.ts), the repeat-process
 * marker (parser/lower/repeat-process.ts, model/lint-flow.ts) and the renderer (render/refs.ts, steps-flow.ts, steps-life.ts, evt.ts), and one template pattern of edh-next-50. The behavior is in
 * edh-next-87-scenarios.test.ts. Synthetic wordings (design 6.10). CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { card, full } from '../r4-cost/support';

const creature = (text: string): boolean => full(card('Example Relic', 'Legendary Artifact Creature — Golem', text, '{2}', ['2', '2']));
const spell = (text: string): boolean => full(card('Example Plan', 'Sorcery', text, '{1}'));
const enchantment = (text: string): boolean => full(card('Example Charm', 'Enchantment', text, '{1}'));
const artifact = (text: string): boolean => full(card('Example Gizmo', 'Artifact', text, '{1}'));

describe('edh-next-87 readings (CR 608.2c, 115.1)', () => {
  it('parser/lower/anaphora.ts, render/refs.ts: "it" after a target of the ability is the target, beside the spell cast or the creature that died', () => {
    expect(creature('Whenever you cast a black spell, you may destroy target creature if it\'s tapped.')).toBe(true);
    expect(creature('Whenever a creature dies, you may destroy target creature if it\'s tapped.')).toBe(true);
    // near miss: a condition no template reads stays manual
    expect(creature('Whenever you cast a black spell, you may destroy target creature if it\'s untapped or tapped or wibbled.')).toBe(false);
  });
  it('render/steps-flow.ts: "then discard a card unless there are five or more mana values among cards in your graveyard" (CR 202.3)', () => {
    expect(spell('Draw two cards. Then discard a card unless there are five or more mana values among cards in your graveyard.')).toBe(true);
    expect(spell('Draw two cards. Then discard a card unless there are five or more colors among cards in your graveyard.')).toBe(false);
  });
  it('render/steps-life.ts: "put a number of +1/+1 counters on it equal to the damage dealt" after a damage trigger (CR 120.3, 122.1)', () => {
    expect(creature('Whenever one or more creatures you control with base power 0 deal combat damage to a player, create a 0/0 green and blue Fractal creature token. Put a number of +1/+1 counters on it equal to the damage dealt.')).toBe(true);
    // near miss: no damage event, "the damage dealt" has no amount to name
    expect(creature('When this creature enters, create a 0/0 green and blue Fractal creature token. Put a number of +1/+1 counters on it equal to the damage dealt.')).toBe(false);
  });
  it('zz-cloud/edh-next-50.json (eff.edhn50.search.graveyardLibrary.named.battlefield): the comma wording "..., put it onto the battlefield, then shuffle" (CR 701.23a)', () => {
    expect(creature('When this creature enters, search your graveyard, hand, and library for a card named Example Spear, put it onto the battlefield, then shuffle.')).toBe(true);
    expect(creature('When this creature enters, search your graveyard, hand, and library for a card named Example Spear and put it onto the battlefield. If you search your library this way, shuffle.')).toBe(true);
    expect(creature('When this creature enters, search your graveyard, hand, and library for a card named Example Spear, put it into your hand, then shuffle.')).toBe(false);
    expect(creature('When this creature enters, search your graveyard and library for a card named Example Spear, put it onto the battlefield, then shuffle.')).toBe(false);
  });
  it('parser/lower/repeat-process.ts, model/lint-flow.ts: "If you do, repeat this process" after an optional step inside a condition (CR 608.2c)', () => {
    expect(spell('Exile the top card of your library. If it\'s a permanent card, you may put it onto the battlefield. If you do, repeat this process.')).toBe(true);
    // near miss: a marker whose "if you do" has no option before it
    // edh-d-101 (CR 608.2c; Demonlord Belzenlok): a sentence after the marker is read now (it runs once, after the last run): that case moved to edh-d-101's tests
    expect(spell('Exile the top card of your library. If it\'s a permanent card, you may put it onto the battlefield. If you do, repeat this process. You gain 1 life.')).toBe(true);
    expect(spell('Exile the top card of your library. If it\'s a permanent card, put it onto the battlefield. If you do, repeat this process wibble.')).toBe(false);
  });
  it('render/evt.ts: "~ or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield" (CR 603.2, 700.4)', () => {
    expect(artifact('Whenever this artifact or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield, create a tapped Powerstone token.')).toBe(true);
    // near miss: a third zone beside the two is no wording of this fold
    expect(artifact('Whenever this artifact or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield or is put into your hand from the battlefield, create a tapped Powerstone token.')).toBe(false);
  });
  it('parser/lower/anaphora.ts: "that card" after the sacrifice of the ability\'s own source is the card the trigger\'s event is about (CR 608.2c, 201.5)', () => {
    expect(enchantment('Whenever a creature is put into your graveyard from the battlefield, you may sacrifice this enchantment. If you do, return that card to the battlefield.')).toBe(true);
    // near miss: sacrificing another permanent leaves "that card" with two candidates
    expect(enchantment('Whenever a creature is put into your graveyard from the battlefield, you may sacrifice a land. If you do, return that card to the battlefield.')).toBe(false);
  });
  it('parser/parse.ts#fillBackupAbilities (CR 702.165a): backup abilities printed one after the other grant the abilities below the last of them; apart, or with a manual ability below, they stay manual', () => {
    expect(creature('Backup 1, backup 1, backup 1\nTrample\nWhenever this creature deals combat damage to a player, put that many +1/+1 counters on it.')).toBe(true);
    expect(creature('Backup 1\nBackup 1\nTrample')).toBe(true);
    expect(creature('Backup 1\nTrample\nBackup 1\nFlying')).toBe(false);
    expect(creature('Backup 1, backup 1\nTrample\nThis creature wibbles every frotzing blorp.')).toBe(false);
  });
});
