/**
 * Third pass top-rank-t1, edh-next-113: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler, each with its negative case. CR cites are from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { find, scenario } from '../../m3/scenario';
import { activate, cast, drive, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const withMana = (s: GameState, n: number): GameState => { for (let i = 0; i < n; i++) s.players[0]!.manaPool.push({ type: 'C' } as never); return s; };
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name);
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

describe('CR 701.16a, 603.2, 603.2c (unverified): "Whenever you investigate for the first time each turn, investigate an additional time." (Erdwal Illuminator)', () => {
  const SPIRIT = card('Test Spirit', 'Creature — Spirit', 'Whenever you investigate for the first time each turn, investigate an additional time.', { pt: ['1', '1'] });
  const SLEUTH = card('Test Sleuth', 'Sorcery', 'Investigate.', { cost: '{C}' });
  const defs = [SPIRIT, SLEUTH];
  it('is automated', () => expect(automated(SPIRIT)).toBe(true));
  it('the first investigation of the turn makes two Clues; the second investigation of the same turn makes only one', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sleuth', 'Test Sleuth'], battlefield: ['Test Spirit'] }, defs });
    withMana(s0, 2);
    const s1 = resolveAll(cast(s0, 'Test Sleuth'));
    expect(onBf(s1, 'Clue Token')).toHaveLength(2);
    const s2 = resolveAll(cast(s1, 'Test Sleuth'));
    expect(onBf(s2, 'Clue Token')).toHaveLength(3);
  });
  it('NEGATIVE (review): investigating X times with X = 0 is no investigation: no Clue and the first-time trigger is not used up', () => {
    const NONE = card('Test None', 'Sorcery', 'Investigate X times, where X is the number of creature cards in your graveyard.', { cost: '{C}' });
    const s0 = scenario([], { p1: { hand: ['Test None', 'Test Sleuth'], battlefield: ['Test Spirit'] }, defs: [...defs, NONE] });
    withMana(s0, 2);
    const s1 = resolveAll(cast(s0, 'Test None'));
    expect(onBf(s1, 'Clue Token')).toHaveLength(0);
    const s2 = resolveAll(cast(s1, 'Test Sleuth'));
    expect(onBf(s2, 'Clue Token')).toHaveLength(2);
  });
  it('NEGATIVE: without the creature one investigation makes one Clue', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sleuth'] }, defs });
    withMana(s0, 1);
    const t = resolveAll(cast(s0, 'Test Sleuth')); expect(onBf(t, 'Clue Token')).toHaveLength(1);
  });
});

describe('CR 603.7, 603.2, 400.3 (unverified): "Whenever a card is put into an opponent\'s graveyard from anywhere this turn, that player loses 1 life." (Duskmantle Guildmage)', () => {
  const MAGE = card('Test Mage', 'Creature — Wizard', '{C}: Whenever a card is put into an opponent\'s graveyard from anywhere this turn, that player loses 1 life.', { pt: ['1', '1'] });
  const MILL = card('Test Mill', 'Sorcery', 'Target player mills two cards.', { cost: '{C}' });
  const defs = [MAGE, MILL];
  it('is automated', () => expect(automated(MAGE)).toBe(true));
  it('each card milled from the opponent\'s library costs that opponent 1 life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mill'], battlefield: ['Test Mage'] }, defs });
    withMana(s0, 2);
    const mage = onBf(s0, 'Test Mage')[0]!;
    const s1 = resolveAll(activate(s0, mage));
    const s2 = resolveAll(cast(s1, 'Test Mill', [target('p2')]));
    expect(lifeOf(s2, 'p2')).toBe(18);
    expect(lifeOf(s2, 'p1')).toBe(20);
  });
  it('review: a creature you stole that dies goes to its owner\'s graveyard: that opponent (the owner) loses 1 life, not you', () => {
    const STEAL = card('Test Steal', 'Sorcery', 'Gain control of target creature until end of turn.', { cost: '{C}' });
    const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
    const SMASH = card('Test Smash', 'Instant', 'Destroy target creature.', { cost: '{C}' });
    const s0 = scenario([], { p1: { hand: ['Test Steal', 'Test Smash'], battlefield: ['Test Mage'] }, p2: { battlefield: ['Test Bear'] }, defs: [...defs, STEAL, BEAR, SMASH] });
    withMana(s0, 3);
    const mage = onBf(s0, 'Test Mage')[0]!;
    const s1 = resolveAll(activate(s0, mage));
    const s2 = resolveAll(cast(s1, 'Test Steal', [target(onBf(s1, 'Test Bear')[0]!)]));
    const s3 = resolveAll(cast(s2, 'Test Smash', [target(onBf(s2, 'Test Bear')[0]!)]));
    expect(lifeOf(s3, 'p2')).toBe(19);
    expect(lifeOf(s3, 'p1')).toBe(20);
  });
  it('G10 change (Bloodchief Ascension reads the same \"that player\"): \"you may have that player lose 2 life\" after a stolen card died is the owner, not the controller', () => {
    const ASC = card('Test Ascent', 'Enchantment', 'Whenever a card is put into an opponent\'s graveyard from anywhere, you may have that player lose 2 life.', { cost: '{C}' });
    const STEAL = card('Test Steal', 'Sorcery', 'Gain control of target creature until end of turn.', { cost: '{C}' });
    const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
    const SMASH = card('Test Smash', 'Instant', 'Destroy target creature.', { cost: '{C}' });
    const s0 = scenario([], { p1: { hand: ['Test Steal', 'Test Smash'], battlefield: ['Test Ascent'] }, p2: { battlefield: ['Test Bear'] }, defs: [ASC, STEAL, BEAR, SMASH] });
    withMana(s0, 2);
    const s2 = resolveAll(cast(s0, 'Test Steal', [target(onBf(s0, 'Test Bear')[0]!)]));
    const s3 = resolveAll(cast(s2, 'Test Smash', [target(onBf(s2, 'Test Bear')[0]!)]), [{ kind: 'yesNo', yes: true } as never]);
    expect(lifeOf(s3, 'p2')).toBe(18);
    expect(lifeOf(s3, 'p1')).toBe(20);
  });
  it('NEGATIVE: cards milled from your own library, or milled without the ability, cost no one life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mill'], battlefield: ['Test Mage'] }, defs });
    withMana(s0, 2);
    const mage = onBf(s0, 'Test Mage')[0]!;
    const s1 = resolveAll(activate(s0, mage));
    const s2 = resolveAll(cast(s1, 'Test Mill', [target('p1')]));
    expect(lifeOf(s2, 'p1')).toBe(20);
    expect(lifeOf(s2, 'p2')).toBe(20);
    const t0 = scenario([], { p1: { hand: ['Test Mill'] }, defs });
    withMana(t0, 1);
    expect(lifeOf(resolveAll(cast(t0, 'Test Mill', [target('p2')])), 'p2')).toBe(20);
  });
});

describe('CR 707.10, 707.10c (unverified): "Copy any number of target instant and/or sorcery spells. You may choose new targets for the copies." (Display of Power)', () => {
  const DISPLAY = card('Test Display', 'Instant', 'Copy any number of target instant and/or sorcery spells. You may choose new targets for the copies.', { cost: '{C}' });
  const GAIN = card('Test Gain', 'Instant', 'You gain 3 life.', { cost: '{C}' });
  const defs = [DISPLAY, GAIN];
  it('is automated', () => expect(automated(DISPLAY)).toBe(true));
  it('copies both targeted spells: three life each, so two originals and two copies gain 12', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gain', 'Test Gain', 'Test Display'] }, defs });
    withMana(s0, 3);
    let s = cast(s0, 'Test Gain');
    s = cast(s, 'Test Gain');
    const ids = s.zones.stack.slice();
    expect(ids).toHaveLength(2);
    s = drive(cast(s, 'Test Display', [target(...ids)]), [{ kind: 'yesNo', yes: false } as never]);
    const s2 = resolveAll(s, [{ kind: 'yesNo', yes: false } as never, { kind: 'yesNo', yes: false } as never]);
    expect(lifeOf(s2, 'p1')).toBe(20 + 12);
  });
  it('NEGATIVE: copying nothing (no target) leaves only the originals', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gain', 'Test Display'] }, defs });
    withMana(s0, 2);
    let s = cast(s0, 'Test Gain');
    s = cast(s, 'Test Display', [target()]);
    const s2 = resolveAll(s);
    expect(lifeOf(s2, 'p1')).toBe(23);
  });
});

describe('CR 701.65a, 603.2, 115.1 (unverified): "Whenever another creature you control becomes the target of a spell or ability, you may airbend that creature." (Monk Gyatso)', () => {
  const MONK = card('Test Monk', 'Creature — Monk', 'Whenever another creature you control becomes the target of a spell or ability, you may airbend that creature. (Exile it. While it\'s exiled, its owner may cast it for {2} rather than its mana cost.)', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{C}' });
  const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.', { cost: '{C}' });
  const defs = [MONK, BEAR, PUMP];
  const inExile = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => chars(s, id).name === name);
  it('is automated', () => expect(automated(MONK)).toBe(true));
  it('targeting your other creature lets you airbend it: it is exiled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Pump'], battlefield: ['Test Monk', 'Test Bear'] }, defs });
    withMana(s0, 1);
    const bear = onBf(s0, 'Test Bear')[0]!;
    const s1 = resolveAll(cast(s0, 'Test Pump', [target(bear)]), [{ kind: 'yesNo', yes: true } as never]);
    expect(onBf(s1, 'Test Bear')).toHaveLength(0);
    expect(inExile(s1, 'Test Bear')).toHaveLength(1);
  });
  it('NEGATIVE: declining the option, or targeting the Monk itself, leaves the creature alone', () => {
    const s0 = scenario([], { p1: { hand: ['Test Pump'], battlefield: ['Test Monk', 'Test Bear'] }, defs });
    withMana(s0, 1);
    const bear = onBf(s0, 'Test Bear')[0]!;
    const s1 = resolveAll(cast(s0, 'Test Pump', [target(bear)]), [{ kind: 'yesNo', yes: false } as never]);
    expect(onBf(s1, 'Test Bear')).toHaveLength(1);
    const t0 = scenario([], { p1: { hand: ['Test Pump'], battlefield: ['Test Monk', 'Test Bear'] }, defs });
    withMana(t0, 1);
    const monk = onBf(t0, 'Test Monk')[0]!;
    const t1 = resolveAll(cast(t0, 'Test Pump', [target(monk)]));
    expect(onBf(t1, 'Test Monk')).toHaveLength(1);
    expect(inExile(t1, 'Test Monk')).toHaveLength(0);
  });
});

describe('CR 118.12a, 120.3, 608.2d (unverified): "return that card to your hand unless target opponent has ~ deal 3 damage to them" (Pia\'s Revolution)', () => {
  const REV = card('Test Revolt', 'Enchantment', 'Whenever a nontoken artifact is put into your graveyard from the battlefield, return that card to your hand unless target opponent has ~ deal 3 damage to them.', { cost: '{C}' });
  const GADGET = card('Test Gadget', 'Artifact', '', { cost: '{C}' });
  const KILL = card('Test Smash', 'Instant', 'Destroy target artifact.', { cost: '{C}' });
  const defs = [REV, GADGET, KILL];
  const inHand = (s: GameState, p: 'p1' | 'p2', name: string): ObjectId[] => (s.zones.hand[p] ?? []).filter((id) => chars(s, id).name === name);
  const play = (yes: boolean): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Smash'], battlefield: ['Test Revolt', 'Test Gadget'] }, defs });
    withMana(s0, 1);
    const gadget = onBf(s0, 'Test Gadget')[0]!;
    return resolveAll(cast(s0, 'Test Smash', [target(gadget)]), [target('p2'), { kind: 'yesNo', yes } as never]);
  };
  it('is automated', () => expect(automated(REV)).toBe(true));
  it('the opponent declines to be dealt damage: the artifact returns to your hand and no damage is dealt', () => {
    const s = play(false);
    expect(inHand(s, 'p1', 'Test Gadget')).toHaveLength(1);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('NEGATIVE: the opponent chooses to take 3 damage: the artifact stays in the graveyard', () => {
    const s = play(true);
    expect(inHand(s, 'p1', 'Test Gadget')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
});
void find;
