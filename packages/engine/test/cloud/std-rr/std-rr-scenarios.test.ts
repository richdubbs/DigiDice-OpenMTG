/**
 * std-rr (wave 2 slice s2): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 303.4, 702.5a, 119.7  "Enchanted player can't gain life." (PlayerRef enchantedPlayer): the player the Aura is attached to gains no life; the other player does
 *   CR 303.4, 120.2, 603.2  "Whenever enchanted player is dealt damage, they lose 3 life.": damage to that player only
 *   CR 603.2c, 510.2  "When one or more of your opponents are dealt combat damage during your turn, ...": once for the combat damage step; not for noncombat damage
 *   CR 121.4, 104.2b  "... draw three cards. If your library has no cards in it, you win the game. ~'s owner shuffles ~ into their library.": drawing the last card wins
 *   CR 613.4b, 608.2h, 611.2a  "Its base power and toughness become equal to ~'s power and toughness until end of turn": fixed as it resolves; ends with the turn
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { advanceTo, find, life, scenario } from '../../m3/scenario';
import { attackWith, card, cast, full, pt, resolveAll } from '../cmd3/helpers';
import { passUntil } from '../../m4/helpers';

const WOUND = card('Test Wound', 'Enchantment — Aura Curse', 'Enchant player\nEnchanted player can\'t gain life.');
const GASH = card('Test Gash', 'Enchantment — Aura Curse', 'Enchant player\nWhenever enchanted player is dealt damage, they lose 3 life.');
const FEAST = card('Test Feast', 'Sorcery', 'Each player gains 3 life.');
const SPARK = card('Test Spark', 'Instant', '~ deals 1 damage to target player.');
const SCOUT = card('Test Scout', 'Creature — Homunculus', 'When one or more of your opponents are dealt combat damage during your turn, draw three cards. If your library has no cards in it, you win the game. ~\'s owner shuffles ~ into their library.', ['1', '1']);
const BUTLER = card('Test Butler', 'Creature — Elf Advisor', 'When ~ enters, choose up to one other target creature you control. Its base power and toughness become equal to ~\'s power and toughness until end of turn.', ['4', '4']);
const SQUIRE = card('Test Squire', 'Creature — Human', '', ['1', '1']);
const BOOST = card('Test Boost', 'Instant', 'Target creature gets +2/+2 until end of turn.');
const DEFS = [WOUND, GASH, FEAST, SPARK, SCOUT, BUTLER, SQUIRE, BOOST];

const onP2 = { targets: [{ kind: 'player' as const, id: 'p2' }] };
const handCount = (s: GameState, p: string): number => s.zones.hand[p]!.length;

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 303.4, 702.5a, 119.7: "Enchanted player can\'t gain life."', () => {
  it('the enchanted player gains no life; the Aura\'s controller, not enchanted, does', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Wound', 'Test Feast'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Wound', onP2));
    expect(s.objects[find(s, 'Test Wound', 'battlefield')]!.attachedTo).toBe('p2');
    s = resolveAll(cast(s, 'Test Feast'));
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p1')).toBe(23);
  });
  it('an Aura attached to its own controller restricts that player instead (the attachment decides, not who controls the Aura)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Wound', 'Test Feast'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Wound', { targets: [{ kind: 'player', id: 'p1' }] }));
    s = resolveAll(cast(s, 'Test Feast'));
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(23);
  });
});

describe('CR 303.4, 120.2, 603.2: "Whenever enchanted player is dealt damage, they lose 3 life."', () => {
  it('1 damage to the enchanted player (20 -> 19), then they lose 3: 16', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Gash', 'Test Spark'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Gash', onP2));
    s = resolveAll(cast(s, 'Test Spark', onP2));
    expect(life(s, 'p2')).toBe(16);
    expect(life(s, 'p1')).toBe(20);
  });
  it('damage to the other player does not trigger it', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Gash', 'Test Spark'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Gash', onP2));
    s = resolveAll(cast(s, 'Test Spark', { targets: [{ kind: 'player', id: 'p1' }] }));
    expect(life(s, 'p1')).toBe(19);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 603.2c, 510.2: "When one or more of your opponents are dealt combat damage during your turn, draw three cards. ..."', () => {
  const attackOnTurn3 = (library?: number): { s: GameState; scout: ObjectId } => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Scout'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    if (library !== undefined) {
      for (const id of s.zones.library.p1!.slice(library)) delete s.objects[id];
      s.zones.library.p1 = s.zones.library.p1!.slice(0, library);
    }
    const scout = find(s, 'Test Scout', 'battlefield');
    s = attackWith(s, [scout]);
    s = resolveAll(passUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step === 'endCombat', 'the combat damage trigger'));
    return { s, scout };
  };
  it('combat damage to the opponent on your turn: three cards drawn, the library still has cards, the creature is shuffled into it, nobody wins', () => {
    let s0 = scenario(['Plains'], { p1: { battlefield: ['Test Scout'] }, defs: DEFS });
    s0 = advanceTo(s0, 3, 'main1');
    const before = handCount(s0, 'p1');
    const { s, scout } = attackOnTurn3();
    expect(life(s, 'p2')).toBe(19);
    expect(handCount(s, 'p1')).toBe(before + 3);
    expect(s.objects[scout]?.zone === 'battlefield').toBe(false);
    expect(s.zones.library.p1!.some((id) => s.objects[id]!.defId === 'Test Scout')).toBe(true);
    expect(s.result ?? null).toBeNull();
  });
  it('CR 121.4, 104.2b: drawing the last cards (two left, three to draw) wins the game before the empty draw would lose it', () => {
    const { s } = attackOnTurn3(2);
    expect(s.result?.winner).toBe('p1');
  });
  it('noncombat damage to the opponent on your turn does not trigger it', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Scout'], hand: ['Test Spark'] }, defs: DEFS });
    const before = handCount(s, 'p1') - 1;
    s = resolveAll(cast(s, 'Test Spark', onP2));
    expect(life(s, 'p2')).toBe(19);
    expect(handCount(s, 'p1')).toBe(before);
    expect(find(s, 'Test Scout', 'battlefield')).toBeDefined();
  });
});

describe('CR 613.4b, 608.2h, 611.2a: "Its base power and toughness become equal to ~\'s power and toughness until end of turn"', () => {
  const enter = (target: boolean): { s: GameState; butler: ObjectId; squire: ObjectId } => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Squire'], hand: ['Test Butler', 'Test Boost'] }, defs: DEFS });
    const squire = find(s, 'Test Squire', 'battlefield');
    s = resolveAll(cast(s, 'Test Butler'), { targets: target ? [{ kind: 'object', id: squire }] : [] });
    return { s, butler: find(s, 'Test Butler', 'battlefield'), squire };
  };
  it('the chosen creature becomes 4/4 (the source\'s 4/4); a later pump of the source does not change it (the values are fixed as it resolves)', () => {
    const r = enter(true);
    let s = r.s;
    expect(pt(s, r.squire)).toBe('4/4');
    s = resolveAll(cast(s, 'Test Boost', { targets: [{ kind: 'object', id: r.butler }] }));
    expect(pt(s, r.butler)).toBe('6/6');
    expect(pt(s, r.squire)).toBe('4/4');
  });
  it('the effect ends with the turn (CR 514.2): 1/1 again on the next turn', () => {
    const r = enter(true);
    const s = advanceTo(r.s, 2, 'upkeep');
    expect(pt(s, r.squire)).toBe('1/1');
  });
  it('with no target chosen ("up to one"), nothing changes', () => {
    const r = enter(false);
    expect(pt(r.s, r.squire)).toBe('1/1');
    expect(pt(r.s, r.butler)).toBe('4/4');
  });
});
