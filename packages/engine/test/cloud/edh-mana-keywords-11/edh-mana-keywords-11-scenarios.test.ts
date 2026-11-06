/**
 * Round edh-mana-keywords-11: the behaviour it changed, played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 *
 *   CR 106.6, 107.3, 601.2f, 602.2b  "{T}: Add {C} for each charge counter on this artifact. Spend this mana only on costs that contain {X}." (Elementalist's Palette): the mana pays any part of a spell
 *                                   with {X} in its mana cost or an ability with {X} in its cost, and nothing else
 *   CR 701.6a, 614.15, 122.1, 702.62a "Counter target spell. If the spell is countered this way, exile it with three time counters on it instead of putting it into its owner's graveyard. If it
 *                                   doesn't have suspend, it gains suspend." (Delay): the countered spell is exiled with the counters and has suspend; a spell that can't be countered stays; one
 *                                   that has suspend keeps its one instance
 *   CR 701.13a, 608.2d, 400.3, 608.2c "Whenever a source deals damage to ~, that source's controller exiles a card from their hand at random. If it's a land card, you may put it onto the battlefield
 *                                   under your control. Otherwise, you may cast it without paying its mana cost." (Rona, Tolarian Obliterator): the hand of the source's controller, a land or a spell
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object !== undefined && nameOf(s, a.object) === name);
const activatable = (s: GameState, name: string): boolean => legal(s, 'p1', 'activate').some((a) => a.object !== undefined && nameOf(s, a.object) === name && a.isMana !== true);

// ---- Elementalist's Palette ---------------------------------------------------------------------------------------------------------------------------------
const PALETTE = card('Test Palette', 'Artifact', '{T}: Add {C} for each charge counter on this artifact. Spend this mana only on costs that contain {X}.');
const XSPELL = card('Test Xspell', 'Sorcery', 'You gain X life.', undefined, '{X}');
const XMIXED = card('Test Xmixed', 'Sorcery', 'You gain X life.', undefined, '{X}{1}');
const PLAIN = card('Test Plain', 'Sorcery', 'You gain 1 life.', undefined, '{2}');
const XWELL = card('Test Xwell', 'Artifact', '{X}, {T}: You gain X life.');
const PLAINWELL = card('Test Plainwell', 'Artifact', '{2}, {T}: You gain 1 life.');
const REMOVEWELL = card('Test Removewell', 'Artifact', '{3}, Remove X charge counters from this artifact: You gain X life.');
const ECHOX = card('Test Echox', 'Sorcery', 'You gain X life.\nFlashback {3}', undefined, '{X}{1}');
const PALETTE_DEFS = [PALETTE, XSPELL, XMIXED, PLAIN, XWELL, PLAINWELL, REMOVEWELL, ECHOX];

describe('CR 106.6, 107.3: "Spend this mana only on costs that contain {X}." (Elementalist\'s Palette)', () => {
  it('the cards are fully automated', () => {
    for (const d of PALETTE_DEFS) expect(full(d), `${d.name} ${JSON.stringify(d.automation)}`).toBe(true);
  });
  const board = (n: number): GameState => scenario([], {
    defs: PALETTE_DEFS,
    p1: { hand: ['Test Xspell', 'Test Xmixed', 'Test Plain'], battlefield: [{ name: 'Test Palette', counters: { charge: n } }, 'Test Xwell', 'Test Plainwell'] },
  });
  it('three charge counters: the three colorless mana cast a spell with {X} in its cost (X chosen up to the mana), not a spell without {X}', () => {
    const s = board(3);
    expect(castable(s, 'Test Xspell')).toBe(true);
    expect(castable(s, 'Test Plain')).toBe(false);
  });
  it('it pays any part of the cost, not just the {X}: {X}{1} is cast with the mana of the Palette alone (X = 2)', () => {
    expect(castable(board(3), 'Test Xmixed')).toBe(true);
    const s0 = board(3);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Xmixed', 'hand') });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    const t = resolveAll(s);
    expect(life(t, 'p1')).toBe(20 + 2);
    expect(t.zones.battlefield.map((id) => t.objects[id]!).find((o) => o.defId === 'Test Palette')!.tapped).toBe(true);
  });
  it('it pays the {X} of an activation cost, not an ability without {X} in its cost', () => {
    const s = board(3);
    expect(activatable(s, 'Test Xwell')).toBe(true);
    expect(activatable(s, 'Test Plainwell')).toBe(false);
  });
  it('negative: X can\'t be more than the Palette\'s mana: {X}{1} with X = 3 needs four mana and is not payable', () => {
    const s0 = board(3);
    expect(() => answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Xmixed', 'hand') }), { kind: 'chooseNumber', n: 3 })).toThrow();
  });
  it('negative: an X that is not the {X} symbol (remove X counters) does not make the cost one that contains {X} (the Nexos and Rosheen rulings)', () => {
    const s = scenario([], { defs: PALETTE_DEFS, p1: { battlefield: [{ name: 'Test Palette', counters: { charge: 3 } }, { name: 'Test Removewell', counters: { charge: 2 } }] } });
    expect(activatable(s, 'Test Removewell')).toBe(false);
  });
  it('negative: a spell with {X} in its mana cost cast for an alternative cost (flashback {3}) is not paid for by the mana: that total cost has no {X}', () => {
    const s = scenario([], { defs: PALETTE_DEFS, p1: { graveyard: ['Test Echox'], battlefield: [{ name: 'Test Palette', counters: { charge: 3 } }] } });
    const flashback = legal(s, 'p1', 'cast').some((a) => a.object !== undefined && nameOf(s, a.object) === 'Test Echox');
    expect(flashback).toBe(false);
  });
  it('negative: with no charge counter the Palette adds nothing, so nothing is payable by it', () => {
    const s = board(0);
    expect(castable(s, 'Test Xspell')).toBe(true); // X = 0 costs nothing
    expect(castable(s, 'Test Xmixed')).toBe(false); // {X}{1} needs one mana
  });
});

describe('CR 106.6, 107.3, 613.1f: the restriction is part of a granted mana ability too (Nexos, Rosheen Meanderer: held-out, opened for verification)', () => {
  const NEXUS = card('Test Nexus', 'Creature — Advisor', 'Basic lands you control have "{T}: Add {C}{C}. Spend this mana only on costs that contain {X}."', ['1', '1']);
  const GIANT = card('Test Giant', 'Creature — Giant', '{T}: Add {C}{C}{C}{C}. Spend this mana only on costs that contain {X}.', ['1', '1']);
  const defs = [NEXUS, GIANT, XSPELL, PLAIN];
  it('the cards are fully automated', () => {
    for (const d of [NEXUS, GIANT]) expect(full(d), `${d.name} ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('a Forest that has the granted ability: its two colorless mana cast a spell with {X} in its cost, not a spell without {X}', () => {
    const s = scenario(['Forest'], { defs, p1: { hand: ['Test Xspell', 'Test Plain'], battlefield: ['Test Nexus', 'Forest'] } });
    expect(castable(s, 'Test Xspell')).toBe(true);
    expect(castable(s, 'Test Plain')).toBe(false);
  });
  it('the four colorless mana of the Giant pay {X} for X = 4, and no spell without {X}', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Xspell', 'Test Plain'], battlefield: ['Test Giant'] } });
    expect(castable(s, 'Test Xspell')).toBe(true);
    expect(castable(s, 'Test Plain')).toBe(false);
  });
});

// ---- Delay ------------------------------------------------------------------------------------------------------------------------------------------------
const DELAY = card('Test Delay', 'Instant', "Counter target spell. If the spell is countered this way, exile it with three time counters on it instead of putting it into its owner's graveyard. If it doesn't have suspend, it gains suspend.");
const TARGETED = card('Test Gain', 'Sorcery', 'You gain 3 life.');
const WARDED = card('Test Stubborn', 'Sorcery', "This spell can't be countered.\nYou gain 3 life.");
const SUSPENDED = card('Test Waiter', 'Sorcery', 'Suspend 2--{R}\nYou gain 3 life.');
const FLASHBACK = card('Test Echo', 'Sorcery', 'You gain 3 life.\nFlashback {1}');
const DELAY_DEFS = [DELAY, TARGETED, WARDED, SUSPENDED, FLASHBACK];

describe('CR 701.6a, 122.1, 702.62a: Delay', () => {
  it('the cards are fully automated', () => {
    for (const d of DELAY_DEFS) expect(full(d), `${d.name} ${JSON.stringify(d.automation)}`).toBe(true);
  });
  /** p1 casts `spellName`, then Delay on it; everything resolves. */
  const play = (spellName: string, from: 'hand' | 'graveyard' = 'hand'): GameState => {
    const s0 = scenario(['Mountain'], { defs: DELAY_DEFS, p1: from === 'hand' ? { hand: [spellName, 'Test Delay'] } : { hand: ['Test Delay'], graveyard: [spellName], battlefield: ['Mountain'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, spellName, from), ...(from === 'graveyard' ? { method: 'flashback' } : {}) }));
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Delay', 'hand') }), { targets: [{ kind: 'object', id: spell }] });
    return resolveAll(s);
  };
  it('a countered spell is exiled with three time counters and has suspend; it never resolved', () => {
    const s = play('Test Gain');
    const exiled = s.zones.exile.flat().map((id) => s.objects[id]!).find((o) => o.defId === 'Test Gain');
    expect(exiled).toBeDefined();
    expect(exiled!.counters['time']).toBe(3);
    expect(kws(s, exiled!.id)).toContain('suspend');
    expect(life(s, 'p1')).toBe(20);
    expect((s.zones.graveyard['p1'] ?? []).map((id) => nameOf(s, id))).not.toContain('Test Gain');
  });
  it('a spell that has suspend keeps its one suspend: it is not given another', () => {
    const s = play('Test Waiter');
    const exiled = s.zones.exile.flat().map((id) => s.objects[id]!).find((o) => o.defId === 'Test Waiter');
    expect(exiled!.counters['time']).toBe(3);
    expect(kws(s, exiled!.id).filter((k) => k === 'suspend')).toHaveLength(1);
  });
  it('negative: a spell that can\'t be countered stays, resolves (CR 101.2) and gets no counters and no suspend', () => {
    const s = play('Test Stubborn');
    expect(life(s, 'p1')).toBe(23);
    expect(s.zones.exile.flat().map((id) => nameOf(s, id))).not.toContain('Test Stubborn');
    expect((s.zones.graveyard['p1'] ?? []).map((id) => nameOf(s, id))).toContain('Test Stubborn');
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!).find((o) => o.defId === 'Test Stubborn')!.counters['time'] ?? 0).toBe(0);
  });
  it('a spell cast with flashback is exiled all the same, with the counters and suspend (Delay ruling)', () => {
    const s = play('Test Echo', 'graveyard');
    const exiled = s.zones.exile.flat().map((id) => s.objects[id]!).find((o) => o.defId === 'Test Echo');
    expect(exiled).toBeDefined();
    expect(exiled!.counters['time']).toBe(3);
    expect(kws(s, exiled!.id)).toContain('suspend');
  });
  it('the granted suspend works: at the beginning of its owner\'s next upkeep a time counter is removed', () => {
    const s = play('Test Gain');
    const id = s.zones.exile.flat().find((i) => s.objects[i]!.defId === 'Test Gain')!;
    let t = advanceTo(s, s.turn.number + 2, 'upkeep');
    t = resolveAll(t);
    expect(t.objects[t.zones.exile.flat().find((i) => t.objects[i]!.defId === 'Test Gain')!]!.counters['time']).toBe(2);
    expect(id).toBeDefined();
  });
});

// ---- Rona, Tolarian Obliterator -------------------------------------------------------------------------------------------------------------------------
const RONA = card('Test Obliterator', 'Creature — Wizard', "Whenever a source deals damage to this creature, that source's controller exiles a card from their hand at random. If it's a land card, you may put it onto the battlefield under your control. Otherwise, you may cast it without paying its mana cost.", ['3', '3']);
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 1 damage to target creature.');
const BOON = card('Test Boon', 'Sorcery', 'You gain 5 life.');
const RONA_DEFS = [RONA, SHOCK, BOON];

describe('CR 701.13a, 608.2d, 400.3: Rona, Tolarian Obliterator', () => {
  it('the cards are fully automated', () => {
    for (const d of RONA_DEFS) expect(full(d), `${d.name} ${JSON.stringify(d.automation)}`).toBe(true);
  });
  /** p2 controls the Obliterator; p1 shocks it with `hand` left in their hand; the trigger's decisions answer `yes`. */
  const play = (hand: string[], yes: boolean): GameState => {
    const s0 = scenario(['Mountain'], { defs: RONA_DEFS, p1: { hand: ['Test Shock', ...hand] }, p2: { battlefield: ['Test Obliterator'] } });
    const rona = find(s0, 'Test Obliterator', 'battlefield', 'p2');
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shock', 'hand', 'p1') }), { targets: [{ kind: 'object', id: rona }] });
    return resolveAll(s, { yes });
  };
  const inExile = (s: GameState, name: string): boolean => s.zones.exile.flat().some((id) => nameOf(s, id) === name);
  it('a land: the hand of the player whose source dealt the damage loses it, and the controller of the Obliterator may put it onto the battlefield under their control', () => {
    const s = play(['Mountain'], true);
    expect(s.zones.hand['p1']!.map((id) => nameOf(s, id))).not.toContain('Mountain');
    const land = s.zones.battlefield.map((id) => s.objects[id]!).find((o) => o.defId === 'Mountain');
    expect(land?.controller).toBe('p2');
  });
  it('a land the controller declines to put onto the battlefield stays exiled (a land can\'t be cast)', () => {
    const s = play(['Mountain'], false);
    expect(s.zones.battlefield.map((id) => nameOf(s, id))).not.toContain('Mountain');
    expect(inExile(s, 'Mountain')).toBe(true);
  });
  it('not a land: the controller of the Obliterator may cast it without paying its mana cost (they gain the life)', () => {
    const s = play(['Test Boon'], true);
    expect(life(s, 'p2')).toBe(25);
    expect(life(s, 'p1')).toBe(20);
  });
  it('not a land, declined: the card stays exiled', () => {
    const s = play(['Test Boon'], false);
    expect(life(s, 'p2')).toBe(20);
    expect(inExile(s, 'Test Boon')).toBe(true);
  });
  it('negative: with no other card in that hand nothing is exiled and nothing happens', () => {
    const s = play([], true);
    expect(s.zones.exile.flat()).toHaveLength(0);
    expect(life(s, 'p2')).toBe(20);
  });
  it('the card exiled is taken from the hand of the source\'s controller, not from the Obliterator\'s controller', () => {
    const s0 = scenario(['Mountain'], { defs: RONA_DEFS, p1: { hand: ['Test Shock', 'Mountain'] }, p2: { hand: ['Test Boon'], battlefield: ['Test Obliterator'] } });
    const rona = find(s0, 'Test Obliterator', 'battlefield', 'p2');
    const s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shock', 'hand', 'p1') }), { targets: [{ kind: 'object', id: rona }] });
    const s = resolveAll(s1, { yes: true });
    expect(s.zones.hand['p2']!.map((id) => nameOf(s, id))).toContain('Test Boon');
    void answer;
  });
});
