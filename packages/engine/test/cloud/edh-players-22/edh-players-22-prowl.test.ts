/**
 * edh-players-22: prowl (CR 702.76a), the alternative cost castable after a creature with one of the spell's creature types dealt combat damage to a player this turn, and
 * "if its prowl cost was paid". Synthetic cards (design 6.10) played through the engine; each rule with its negative case.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, find, findAll, life, reject, scenario } from '../../m3/scenario';
import { attackUnblocked, toStep } from '../../m4/helpers';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const THUG = card('Test Back-Alley Thug', 'Creature — Human Rogue', '', ['2', '2']);
const BRUISER = card('Test Open Bruiser', 'Creature — Human Warrior', '', ['2', '2']);
const SHIFTER = card('Test Many-Faced Shifter', 'Creature — Shapeshifter', 'Changeling', ['2', '2']);
const SCHEME = card('Test Dark Scheme', 'Kindred Sorcery — Rogue', 'Prowl {1} (You may cast this for its prowl cost if you dealt combat damage to a player this turn with a Rogue.)\nYou gain 1 life. If ~\'s prowl cost was paid, you gain 4 life.', undefined, '{5}');
const LORE = card('Test Elf Lore', 'Kindred Sorcery — Elf', 'Prowl {1}\nYou gain 1 life. If ~\'s prowl cost was paid, you gain 4 life.', undefined, '{5}');
const DEFS = [THUG, BRUISER, SHIFTER, SCHEME, LORE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** p1 attacks p2 with the named creature, unblocked, and combat damage is dealt; the state is after combat damage. */
const hit = (s: GameState, ...names: string[]): GameState => toStep(attackUnblocked(s, names.map((n) => find(s, n, 'battlefield', 'p1') as ObjectId)), 'main2');
const setup = (extra: string[] = []): GameState => scenario(['Plains'], { p1: { battlefield: ['Plains', 'Test Back-Alley Thug', 'Test Open Bruiser', 'Test Many-Faced Shifter'], hand: ['Test Dark Scheme', 'Test Elf Lore', ...extra] }, defs: DEFS });

describe('CR 702.76a: prowl', () => {
  it('after a Rogue deals combat damage to a player, the spell is cast for its prowl cost and "if its prowl cost was paid" holds', () => {
    let s = hit(setup(), 'Test Back-Alley Thug');
    const l0 = life(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dark Scheme', 'hand', 'p1'), method: 'prowl' })));
    expect(life(s, 'p1')).toBe(l0 + 5);
  });
  it('cast for its mana cost the same turn, the prowl cost was not paid', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Back-Alley Thug'], hand: ['Test Dark Scheme'] }, defs: DEFS });
    s = hit(s, 'Test Back-Alley Thug');
    const l1 = life(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dark Scheme', 'hand', 'p1') })));
    expect(life(s, 'p1')).toBe(l1 + 1);
  });
  it('negative: no combat damage yet this turn: the prowl cost is not offered', () => {
    const s = setup();
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dark Scheme', 'hand', 'p1'), method: 'prowl' });
  });
  it("negative: a creature that does not share a creature type with the spell (a Warrior for a Rogue spell) dealt the damage: not offered", () => {
    const s = hit(setup(), 'Test Open Bruiser');
    reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dark Scheme', 'hand', 'p1'), method: 'prowl' });
  });
  it('a changeling is every creature type: it enables a spell with any creature type, here an Elf', () => {
    const s = hit(setup(), 'Test Many-Faced Shifter');
    const t = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Elf Lore', 'hand', 'p1'), method: 'prowl' })));
    expect(findAll(t, 'Test Elf Lore', 'graveyard', 'p1')).toHaveLength(1);
  });
});
