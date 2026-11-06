/**
 * edh-zones-12 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites from
 * memory unless a line says otherwise, unverified.
 *
 *   CR 707.12, 608.2g, 608.2c, 702.96a   "Exile target card that's an instant or sorcery from your graveyard. For each card exiled this way, copy it, and you may cast the copy
 *                                        without paying its mana cost." (Mizzix's Mastery), cast normally and overloaded
 *   CR 701.20a, 700.6, 608.2d            "Look at the top five cards of your library. You may reveal a historic card from among them and put it into your hand. Put the rest on the bottom of
 *                                        your library in a random order." (Weatherlight)
 *   CR 607.2a, 608.2d, 108.2b, 400.3      "Put a card exiled with ~ into its owner's graveyard. If it's a land card, create a Treasure token. If it's a nonland card, create a ... token." (Currency Converter)
 *   CR 607.2a, 707.12, 608.2d, 118.9     "exile an instant or sorcery card at random from your graveyard. Then copy each card exiled with ~. You may cast any number of the copies without paying their
 *                                        mana costs." (Arcane Bombardment)
 *   CR 607.2a, 109.2, 707.2, 702.10      "If you do, return each other card exiled with ~ to its owner's graveyard." and "Create a token that's a copy of a card exiled with ~. It gains haste. Exile it at
 *                                        the beginning of the next end step." (Mimic Vat)
 */
import { describe, expect, it } from 'vitest';
import { put } from '../../m3/scenario';
import type { GameState } from '../../../src/index';
import { advanceTo, pass, answer } from '../../m3/scenario';
import { life, noManual, card, obj, player, nameOf, exileNames, gyNames, handNames, onBf, yes, no, drive, resolveAll, castAt, activate, act, find, scenario } from './support';

const setLibrary = (s: GameState, p: 'p1' | 'p2', libNames: string[]): void => {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
};
const libNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));


describe('"Exile target card that\'s an instant or sorcery from your graveyard. For each card exiled this way, copy it, and you may cast the copy without paying its mana cost." (CR 707.12, 608.2c, 608.2g; Mizzix\'s Mastery)', () => {
  const MASTER = card('Test Echo Rite', 'Sorcery', 'Exile target card that\'s an instant or sorcery from your graveyard. For each card exiled this way, copy it, and you may cast the copy without paying its mana cost.\nOverload {1}');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', { cost: '{5}{R}' });
  const GAIN = card('Test Salve', 'Sorcery', 'You gain 4 life.', { cost: '{4}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [MASTER, BOLT, GAIN, BEAR];
  it('has no manual part', () => expect(noManual(MASTER)).toBe(true));

  it('one target: the card is exiled, its copy is cast for free and the original stays exiled (it is not cast again)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Echo Rite'], graveyard: ['Test Bolt', 'Test Salve', 'Test Bear'] }, defs });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Rite', 'hand', 'p1') }), [], [[obj(find(s0, 'Test Bolt', 'graveyard', 'p1'))]]), [yes], [[player('p2')]]);
    expect(life(s, 'p2')).toBe(17);
    expect(exileNames(s)).toEqual(['Test Bolt']);
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Echo Rite', 'Test Salve']); // the other instant/sorcery and the creature were not touched
  });
  it('declining: the card is exiled, no copy is cast', () => {
    const s0 = scenario([], { p1: { hand: ['Test Echo Rite'], graveyard: ['Test Bolt'] }, defs });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Rite', 'hand', 'p1') }), [], [[obj(find(s0, 'Test Bolt', 'graveyard', 'p1'))]]), [no]);
    expect(life(s, 'p2')).toBe(20);
    expect(exileNames(s)).toEqual(['Test Bolt']);
  });
  it('the negative case: a creature card and a card of an opponent\'s graveyard are not legal targets, only your own instants and sorceries', () => {
    const s0 = scenario([], { p1: { hand: ['Test Echo Rite'], graveyard: ['Test Bear', 'Test Salve'] }, p2: { graveyard: ['Test Bolt'] }, defs });
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Rite', 'hand', 'p1') }));
    const pending = s.pending as { kind: string; specs?: { options?: unknown[] }[] } | undefined;
    expect(pending?.kind).toBe('chooseTargets');
    const options = JSON.stringify(pending);
    expect(options).toContain(find(s0, 'Test Salve', 'graveyard', 'p1'));
    expect(options).not.toContain(find(s0, 'Test Bear', 'graveyard', 'p1'));
    expect(options).not.toContain(find(s0, 'Test Bolt', 'graveyard', 'p2'));
  });
  it('overloaded: every instant and sorcery card of your graveyard is exiled and each copy may be cast; the creature and the opponent\'s graveyard stay', () => {
    const s0 = scenario([], { p1: { hand: ['Test Echo Rite'], graveyard: ['Test Bolt', 'Test Salve', 'Test Bear'] }, p2: { graveyard: ['Test Bolt'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Rite', 'hand', 'p1'), method: 'overload' });
    expect(t.pending?.kind).not.toBe('chooseTargets');
    const s = resolveAll(t, [yes, yes], [[player('p2')]]);
    expect(exileNames(s)).toEqual(['Test Bolt', 'Test Salve']);
    expect(life(s, 'p2')).toBe(17); // the copy of the bolt
    expect(life(s, 'p1')).toBe(24); // the copy of the salve
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Echo Rite']);
    expect(gyNames(s, 'p2')).toEqual(['Test Bolt']);
  });
  it('overloaded: each copy is its own choice, so one may be declined', () => {
    const s0 = scenario([], { p1: { hand: ['Test Echo Rite'], graveyard: ['Test Bolt', 'Test Salve'] }, defs });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Rite', 'hand', 'p1'), method: 'overload' });
    const s = resolveAll(t, [no, no]);
    expect(exileNames(s)).toEqual(['Test Bolt', 'Test Salve']);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('"Look at the top five cards of your library. You may reveal a historic card from among them and put it into your hand. Put the rest on the bottom of your library in a random order." (CR 701.20a, 700.6; Weatherlight)', () => {
  const SCOUT = card('Test Relic Scout', 'Artifact Creature — Construct', 'When this creature enters, look at the top five cards of your library. You may reveal a historic card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', { pt: ['1', '1'], cost: '{0}' });
  const RELIC = card('Test Relic', 'Artifact', '');
  const KING = card('Test Old King', 'Legendary Creature — Human', '', { pt: ['2', '2'] });
  const CHAPTERS = card('Test Chapters', 'Enchantment — Saga', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WOODS = card('Test Woods', 'Enchantment', '');
  const defs = [SCOUT, RELIC, KING, CHAPTERS, BEAR, WOODS];
  it('has no manual part', () => expect(noManual(SCOUT)).toBe(true));
  it('an artifact, a legendary permanent and a Saga are historic and offered; the others in the top five are not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Relic Scout'] }, defs });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Relic', 'Test Old King', 'Test Chapters', 'Test Woods', 'Test Bear']);
    const s = drive(castAt(s0, 'Test Relic Scout'));
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = ((s.pending as unknown as { options: string[] }).options).map((id) => nameOf(s, id)).sort();
    expect(options).toEqual(['Test Chapters', 'Test Old King', 'Test Relic']);
  });
  it('the chosen card goes to the hand, the other four go to the bottom and the sixth card stays on top', () => {
    const s0 = scenario([], { p1: { hand: ['Test Relic Scout'] }, defs });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Relic', 'Test Old King', 'Test Chapters', 'Test Woods', 'Test Bear']);
    let s = castAt(s0, 'Test Relic Scout');
    const pick = (s.pending as unknown as { options: string[] }).options.find((id) => nameOf(s, id) === 'Test Old King')!;
    s = resolveAll(drive(s, [{ kind: 'chooseObjects', ids: [pick] }]));
    expect(handNames(s, 'p1')).toEqual(['Test Old King']);
    expect(libNames(s, 'p1')[0]).toBe('Test Bear'); // the sixth card of the library, never looked at
    expect([...libNames(s, 'p1').slice(1)].sort()).toEqual(['Test Bear', 'Test Chapters', 'Test Relic', 'Test Woods']);
  });
  it('the negative case: with no historic card among the five, nothing is chosen and all five go to the bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Relic Scout'] }, defs });
    setLibrary(s0, 'p1', ['Test Bear', 'Test Woods', 'Test Bear', 'Test Woods', 'Test Bear', 'Test Relic']);
    const s = resolveAll(castAt(s0, 'Test Relic Scout'));
    expect(handNames(s, 'p1')).toEqual([]);
    expect(libNames(s, 'p1')[0]).toBe('Test Relic'); // the sixth card
    expect(libNames(s, 'p1')).toHaveLength(6);
  });
});

describe('"Put a card exiled with ~ into its owner\'s graveyard. If it\'s a land card, create a Treasure token. If it\'s a nonland card, create a 2/2 black Rogue creature token." (CR 607.2a, 111.1; Currency Converter)', () => {
  const CONVERT = card('Test Cash Box', 'Artifact', 'Whenever you discard a card, you may exile that card from your graveyard.\n{T}: Put a card exiled with this artifact into its owner\'s graveyard. If it\'s a land card, create a Treasure token. If it\'s a nonland card, create a 2/2 black Rogue creature token.');
  const DISCARD = card('Test Purge', 'Sorcery', 'Discard two cards.');
  const ROCK = card('Test Rock', 'Land', '');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [CONVERT, DISCARD, ROCK, BEAR];
  const tokens = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && nameOf(s, id).includes(name));
  const setup = (): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Purge', 'Test Rock', 'Test Bear'], battlefield: ['Test Cash Box'] }, defs });
    // discard both cards; exile each from the graveyard with the trigger
    return castAt(s0, 'Test Purge', [], [yes, yes]);
  };
  it('has no manual part', () => expect(noManual(CONVERT)).toBe(true));
  it('a land card exiled with it: it goes to its owner\'s graveyard and a Treasure is created, no Rogue', () => {
    let s = setup();
    expect(exileNames(s).sort()).toEqual(['Test Bear', 'Test Rock']);
    const box = find(s, 'Test Cash Box', 'battlefield', 'p1');
    const rock = find(s, 'Test Rock', 'exile');
    s = activate(s, box, [], [{ kind: 'chooseObjects', ids: [rock] }]);
    expect(gyNames(s, 'p1')).toContain('Test Rock');
    expect(exileNames(s)).toEqual(['Test Bear']);
    expect(tokens(s, 'Treasure')).toHaveLength(1);
    expect(tokens(s, 'Rogue')).toHaveLength(0);
  });
  it('a nonland card exiled with it: a 2/2 Rogue is created and no Treasure', () => {
    let s = setup();
    const box = find(s, 'Test Cash Box', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'exile');
    s = activate(s, box, [], [{ kind: 'chooseObjects', ids: [bear] }]);
    expect(gyNames(s, 'p1')).toContain('Test Bear');
    expect(tokens(s, 'Rogue')).toHaveLength(1);
    expect(tokens(s, 'Treasure')).toHaveLength(0);
  });
  it('the negative case: with no card exiled with it nothing happens and no token is created', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cash Box'] }, p2: {}, defs });
    const s = activate(s0, find(s0, 'Test Cash Box', 'battlefield', 'p1'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
});

describe('Mimic Vat (CR 607.2a, 109.2, 707.2, 702.10): the imprint trigger and the hasty token copy', () => {
  const VAT = card('Test Clone Vat', 'Artifact', 'Whenever a nontoken creature dies, you may exile that card. If you do, return each other card exiled with this artifact to its owner\'s graveyard.\n{1}, {T}: Create a token that\'s a copy of a card exiled with this artifact. It gains haste. Exile it at the beginning of the next end step.');
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const GIANT = card('Test Giant', 'Creature — Giant', 'Trample', { pt: ['5', '5'] });
  const SPIRIT = card('Test Spirit Maker', 'Sorcery', 'Create a 1/1 white Spirit creature token.');
  const defs = [VAT, SMITE, BEAR, GIANT, SPIRIT];
  const kill = (s0: GameState, victim: string, who: 'p1' | 'p2', answers = [yes]): GameState => resolveAll(castAt(s0, 'Test Smite', [[obj(find(s0, victim, 'battlefield', who))]]), answers);
  it('has no manual part', () => expect(noManual(VAT)).toBe(true));
  it('the first creature to die is exiled with it; the next one replaces it: the first goes to its owner\'s graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Clone Vat'] }, p2: { battlefield: ['Test Bear', 'Test Giant'] }, defs });
    s = kill(s, 'Test Bear', 'p2');
    expect(exileNames(s)).toEqual(['Test Bear']);
    s = kill(s, 'Test Giant', 'p2');
    expect(exileNames(s)).toEqual(['Test Giant']);
    expect(gyNames(s, 'p2')).toEqual(['Test Bear']); // back in its owner's graveyard, not mine
  });
  it('declining the exile leaves the earlier card exiled and the creature in the graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Clone Vat'] }, p2: { battlefield: ['Test Bear', 'Test Giant'] }, defs });
    s = kill(s, 'Test Bear', 'p2');
    s = kill(s, 'Test Giant', 'p2', [no]);
    expect(exileNames(s)).toEqual(['Test Bear']);
    expect(gyNames(s, 'p2')).toEqual(['Test Giant']);
  });
  it('the negative case: a token creature dying is not exiled with it', () => {
    const s0 = scenario([], { p1: { hand: ['Test Spirit Maker', 'Test Smite'], battlefield: ['Test Clone Vat'] }, defs });
    let s = castAt(s0, 'Test Spirit Maker');
    const spirit = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    s = resolveAll(castAt(s, 'Test Smite', [[obj(spirit)]]), [yes]);
    expect(exileNames(s)).toEqual([]);
  });
  it('{1},{T}: a token that is a copy of the exiled creature, with haste, exiled at the next end step; the card stays exiled', () => {
    let s = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Clone Vat', 'Plains'] }, p2: { battlefield: ['Test Giant'] }, defs });
    s = kill(s, 'Test Giant', 'p2');
    s = activate(s, find(s, 'Test Clone Vat', 'battlefield', 'p1'));
    const copies = onBf(s, 'Test Giant');
    expect(copies).toHaveLength(1);
    expect(s.objects[copies[0]!]!.kind).toBe('token');
    expect(s.objects[copies[0]!]!.controller).toBe('p1');
    expect(exileNames(s)).toEqual(['Test Giant']); // the card itself is still exiled with the Vat
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(onBf(s, 'Test Giant')).toHaveLength(0);
    expect(exileNames(s)).toEqual(['Test Giant']); // the token ceased to exist in exile; the card is untouched
  });
});

describe('"Whenever you cast your first instant or sorcery spell each turn, exile an instant or sorcery card at random from your graveyard. Then copy each card exiled with ~. You may cast any number of the copies without paying their mana costs." (CR 607.2a, 707.12, 608.2d; Arcane Bombardment)', () => {
  const BOMB = card('Test Echo Hall', 'Enchantment', 'Whenever you cast your first instant or sorcery spell each turn, exile an instant or sorcery card at random from your graveyard. Then copy each card exiled with this enchantment. You may cast any number of the copies without paying their mana costs.');
  const CHEER = card('Test Cheer', 'Instant', 'You gain 1 life.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', { cost: '{5}{R}' });
  const ZAP = card('Test Zap', 'Sorcery', 'Test Zap deals 2 damage to each opponent.', { cost: '{5}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [BOMB, CHEER, BOLT, ZAP, BEAR];
  it('has no manual part', () => expect(noManual(BOMB)).toBe(true));
  it('the first instant cast exiles the only instant or sorcery card of the graveyard (a creature card is not eligible), copies it and casts the copy for free', () => {
    const s0 = scenario([], { p1: { hand: ['Test Cheer'], battlefield: ['Test Echo Hall'], graveyard: ['Test Bolt', 'Test Bear'] }, defs });
    const s = resolveAll(castAt(s0, 'Test Cheer'), [yes], [[player('p2')]]);
    expect(exileNames(s)).toEqual(['Test Bolt']);
    expect(gyNames(s, 'p1')).toEqual(['Test Bear', 'Test Cheer']);
    expect(life(s, 'p2')).toBe(17); // the copy of the bolt hit the opponent
    expect(life(s, 'p1')).toBe(21); // and Test Cheer resolved after
  });
  it('each copy is its own choice: a copy may be declined and the card stays exiled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Cheer'], battlefield: ['Test Echo Hall'], graveyard: ['Test Bolt'] }, defs });
    const s = resolveAll(castAt(s0, 'Test Cheer'), [no]);
    expect(exileNames(s)).toEqual(['Test Bolt']);
    expect(life(s, 'p2')).toBe(20);
  });
  it('the second instant or sorcery cast the same turn does not trigger it; on a later turn every card exiled with it is copied again', () => {
    const s0 = scenario([], { p1: { hand: ['Test Cheer', 'Test Cheer', 'Test Cheer'], battlefield: ['Test Echo Hall'], graveyard: ['Test Bolt'] }, defs });
    let s = resolveAll(castAt(s0, 'Test Cheer'), [yes], [[player('p2')]]);
    expect(life(s, 'p2')).toBe(17);
    // the second spell of the same turn: no trigger (nothing is asked, no copy)
    s = resolveAll(castAt(s, 'Test Cheer'));
    expect(life(s, 'p2')).toBe(17);
    expect(exileNames(s)).toEqual(['Test Bolt']);
    // a later turn of the game (the opponent\'s): the first spell of that turn triggers it again, and the bolt exiled earlier is copied once more
    s = pass(advanceTo(s, 2, 'upkeep')); // the active player (the opponent) passes first
    // (the two Cheers cast so far are in the graveyard now: one is exiled at random, and BOTH cards exiled with it are copied, each copy its own choice, declined here)
    s = castAt(s, 'Test Cheer');
    const asked = (): number => (s.pending?.kind === 'yesNo' ? 1 : 0);
    expect(asked()).toBe(1);
    s = resolveAll(s, [no, no]);
    expect(exileNames(s)).toEqual(['Test Bolt', 'Test Cheer']);
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('a token that is a copy of a card exiled with ~ when the card is no permanent (CR 111.1, 707.2; Mimic Vat ruling 2018-07-13)', () => {
  const MIRROR = card('Test Mirror Vat', 'Artifact', 'When this artifact enters, exile target instant card from a graveyard.\n{T}: Create a token that\'s a copy of a card exiled with this artifact.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', { cost: '{5}{R}' });
  it('no token is created from an instant card (a token copy of a nonpermanent card does not exist), and nothing else breaks', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mirror Vat'] }, p2: { graveyard: ['Test Bolt'] }, defs: [MIRROR, BOLT] });
    let s = resolveAll(castAt(s0, 'Test Mirror Vat', [], []), [], [[obj(find(s0, 'Test Bolt', 'graveyard', 'p2'))]]);
    expect(exileNames(s)).toEqual(['Test Bolt']);
    s = activate(s, find(s, 'Test Mirror Vat', 'battlefield', 'p1'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
    expect(exileNames(s)).toEqual(['Test Bolt']);
  });
});
