/**
 * edh-next-12 scenarios (Commander lane edh-next, ranks 5,001-6,500, fourth pass: engine statics): each new reading played through the engine with synthetic cards
 * (invented names, design 6.10), with its negative case.
 * Rules (Comprehensive Rules 2026-09-25):
 *   CR 614.1a, 120.3, 611.2a   "If a source you control would deal damage this turn to an opponent or a permanent an opponent controls, it deals triple that damage instead"
 *   CR 601.3, 101.2, 102.1     "Players can cast spells only during their own turns" (Dosan the Falling Leaf)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { canSee } from '../../../src/core/view';
import { act, activations, advanceTo, card, drive, find, full, legal, lifeOf, named, obj, pool, resolveAll, scenario } from '../r3-cost/support';

describe('CR 614.1a, 120.3: triple damage this turn to opponents and their permanents', () => {
  const WAVE = card('Test Isen Wave', 'Sorcery', "Damage can't be prevented this turn. If a source you control would deal damage this turn to an opponent or a permanent an opponent controls, it deals triple that damage instead.", '{0}');
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to any target.', '{0}');
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['1', '9']);
  const DEFS = [WAVE, BOLT, OX];
  it('is automated', () => { expect(full(WAVE)).toBe(true); });
  const bolt = (s: GameState, player: 'p1' | 'p2', target: { kind: 'player'; id: 'p1' | 'p2' } | { kind: 'object'; id: string }): GameState =>
    resolveAll(drive(act(s, { type: 'cast', player, card: find(s, 'Test Spark', 'hand', player) }), { targets: [[target as never]] }));
  it("a source you control deals triple damage to an opponent this turn, and to an opponent's permanent", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Isen Wave', 'Test Spark', 'Test Spark'] }, p2: { battlefield: ['Test Ox'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Isen Wave', 'hand', 'p1') })));
    const before = lifeOf(s, 'p2');
    s = bolt(s, 'p1', { kind: 'player', id: 'p2' });
    expect(lifeOf(s, 'p2')).toBe(before - 6);
    const ox = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Ox')!;
    s = bolt(s, 'p1', obj(ox) as never);
    expect(s.objects[ox]!.damage).toBe(6);
  });
  it('negative: damage to you is not tripled, and an opponent source is not tripled', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Isen Wave', 'Test Spark'] }, p2: { hand: ['Test Spark'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Isen Wave', 'hand', 'p1') })));
    const mine = lifeOf(s, 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p1' } as never]] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Spark', 'hand', 'p2') }), { targets: [[{ kind: 'player', id: 'p1' } as never]] });
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(mine - 4);
  });
  it('ruling 2023-11-03: two resolutions in one turn multiply the damage by 9', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Isen Wave', 'Test Isen Wave', 'Test Spark'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Isen Wave', 'hand', 'p1') })));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Isen Wave', 'hand', 'p1') })));
    const before = lifeOf(s, 'p2');
    s = bolt(s, 'p1', { kind: 'player', id: 'p2' });
    expect(lifeOf(s, 'p2')).toBe(before - 18);
  });
  it('it lasts this turn only: on the next turn of yours the damage is not tripled', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Isen Wave', 'Test Spark'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Isen Wave', 'hand', 'p1') })));
    s = advanceTo(s, 3, 'main1');
    const before = lifeOf(s, 'p2');
    s = bolt(s, 'p1', { kind: 'player', id: 'p2' });
    expect(lifeOf(s, 'p2')).toBe(before - 2);
  });
});

describe('CR 601.3, 101.2: "Players can cast spells only during their own turns"', () => {
  const DOSAN = card('Test Leaf Monk', 'Legendary Creature — Human Monk', 'Players can cast spells only during their own turns.', '{0}', ['1', '1']);
  const FLASH = card('Test Flash Trick', 'Instant', 'Draw a card.', '{0}');
  const DEFS = [DOSAN, FLASH];
  it('is automated', () => { expect(full(DOSAN)).toBe(true); });
  const tryTrick = (s: GameState, player: 'p1' | 'p2'): boolean => legal(s, player, 'cast').some((a) => a.object === find(s, 'Test Flash Trick', 'hand', player));
  it("a player casts on their own turn but not on the other player's turn", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Leaf Monk'], hand: ['Test Flash Trick', 'Test Flash Trick'] }, p2: { hand: ['Test Flash Trick'] } });
    expect(tryTrick(s, 'p1')).toBe(true);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flash Trick', 'hand', 'p1') })));
    // (the stack is empty again; p1's spell resolved). On p2's turn p2 casts, and p1 may not respond
    s = advanceTo(s, 2, 'main1');
    expect(tryTrick(s, 'p2')).toBe(true);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Trick', 'hand', 'p2') }));
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.player).toBe('p1');
    expect(tryTrick(s, 'p1')).toBe(false);
  });
  it('without it the other player may respond on that turn', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Flash Trick'] }, p2: { hand: ['Test Flash Trick'] } });
    s = advanceTo(s, 2, 'main1');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flash Trick', 'hand', 'p2') }));
    s = act(s, { type: 'pass', player: 'p2' });
    expect(tryTrick(s, 'p1')).toBe(true);
  });
});

describe('CR 705.1, 614.1a: "If you would flip a coin, instead flip two coins and ignore one" (Krark\'s Thumb)', () => {
  const THUMB = card("Test Lucky Thumb", 'Legendary Artifact', 'If you would flip a coin, instead flip two coins and ignore one.', '{0}');
  const FLIP = card('Test Toss', 'Instant', 'Flip a coin. If you win the flip, you gain 3 life.', '{0}');
  const DEFS = [THUMB, FLIP];
  it('is automated', () => { expect(full(THUMB)).toBe(true); });
  const toss = (seed: string, thumb: boolean): { gained: boolean; text: string } => {
    let s = scenario([], { defs: DEFS, seed, p1: { battlefield: thumb ? ['Test Lucky Thumb'] : [], hand: ['Test Toss'] } });
    const before = lifeOf(s);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Toss', 'hand', 'p1') })));
    return { gained: lifeOf(s) === before + 3, text: s.log.map((l) => l.text).join('\n') };
  };
  it('two coins are flipped and one result is kept: the flip (called heads) is lost only when both come up tails', () => {
    let two = 0; let lost = 0;
    for (let i = 0; i < 24; i++) {
      const r = toss(`thumb-${i}`, true);
      expect(r.text).toContain('flips 2 coins');
      const bothTails = r.text.includes('(tails, tails)');
      expect(r.gained).toBe(!bothTails);
      two++; if (!r.gained) lost++;
    }
    expect(two).toBe(24);
    expect(lost).toBeLessThan(24);
  });
  it('without it one coin is flipped', () => {
    for (let i = 0; i < 6; i++) expect(toss(`plain-${i}`, false).text).not.toContain('flips 2 coins');
  });
  it("an opponent's Thumb does not help you", () => {
    const s = scenario([], { defs: DEFS, seed: 'thumb-0', p1: { hand: ['Test Toss'] }, p2: { battlefield: ['Test Lucky Thumb'] } });
    const t = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Toss', 'hand', 'p1') })));
    expect(t.log.map((l) => l.text).join('\n')).not.toContain('flips 2 coins');
  });
});

describe('CR 402.3, 604.1: "Your opponents play with their hands revealed" (Telepathy)', () => {
  const MIND = card('Test Open Mind', 'Enchantment', 'Your opponents play with their hands revealed.', '{0}');
  const DEFS = [MIND];
  it('is automated', () => { expect(full(MIND)).toBe(true); });
  it("the cards in an opponent's hand are seen by every player; your own hand stays hidden from them", () => {
    const s = scenario(['Lightning Bolt'], { defs: DEFS, p1: { battlefield: ['Test Open Mind'], hand: ['Lightning Bolt'] }, p2: { hand: ['Lightning Bolt'] } });
    const mine = s.objects[find(s, 'Lightning Bolt', 'hand', 'p1')]!;
    const theirs = s.objects[find(s, 'Lightning Bolt', 'hand', 'p2')]!;
    expect(canSee(s, theirs, 'p1')).toBe(true);
    expect(canSee(s, theirs, 'p2')).toBe(true);
    expect(canSee(s, mine, 'p2')).toBe(false);
  });
  it('without it (or once it leaves) the hand is hidden', () => {
    const s = scenario(['Lightning Bolt'], { defs: DEFS, p1: { hand: ['Lightning Bolt'] }, p2: { hand: ['Lightning Bolt'] } });
    expect(canSee(s, s.objects[find(s, 'Lightning Bolt', 'hand', 'p2')]!, 'p1')).toBe(false);
  });
  it('an opponent\'s Telepathy reveals your hand to them, not theirs to you', () => {
    const s = scenario(['Lightning Bolt'], { defs: DEFS, p1: { hand: ['Lightning Bolt'] }, p2: { battlefield: ['Test Open Mind'], hand: ['Lightning Bolt'] } });
    expect(canSee(s, s.objects[find(s, 'Lightning Bolt', 'hand', 'p1')]!, 'p2')).toBe(true);
    expect(canSee(s, s.objects[find(s, 'Lightning Bolt', 'hand', 'p2')]!, 'p1')).toBe(false);
  });
});

describe('CR 601.2f, 118.7: "As long as ~ is untapped, each spell that would cost less than three mana to cast costs three mana to cast" (Trinisphere)', () => {
  const PRISM = card('Test Floor Prism', 'Artifact', 'As long as ~ is untapped, each spell that would cost less than three mana to cast costs three mana to cast.', '{0}');
  const CHEAP = card('Test Cheap Bear', 'Creature — Bear', '', '{W}', ['1', '1']);
  const TWO = card('Test Two Bear', 'Creature — Bear', '', '{1}{W}', ['2', '2']);
  const FREE = card('Test Free Bear', 'Creature — Bear', '', '{0}', ['1', '1']);
  const BIG = card('Test Big Bear', 'Creature — Bear', '', '{2}{W}', ['3', '3']);
  const DEFS = [PRISM, CHEAP, TWO, FREE, BIG];
  const lands = (n: number, prism = true) => ({ battlefield: [...(prism ? ['Test Floor Prism'] : []), ...Array(n).fill('Plains')] as string[], hand: ['Test Cheap Bear', 'Test Two Bear', 'Test Free Bear', 'Test Big Bear'] });
  const can = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));
  it('is automated', () => { expect(full(PRISM)).toBe(true); });
  it('with two lands nothing that costs less than three is castable; with three each costs three (a {1}{W} spell becomes {2}{W}, a free spell {3})', () => {
    const two = scenario([], { defs: DEFS, p1: lands(2) });
    for (const n of ['Test Cheap Bear', 'Test Two Bear', 'Test Free Bear', 'Test Big Bear']) expect(can(two, n), n).toBe(false);
    const three = scenario([], { defs: DEFS, p1: lands(3) });
    for (const n of ['Test Cheap Bear', 'Test Two Bear', 'Test Free Bear', 'Test Big Bear']) expect(can(three, n), n).toBe(true);
    const after = resolveAll(drive(act(three, { type: 'cast', player: 'p1', card: find(three, 'Test Free Bear', 'hand', 'p1') })));
    expect(after.zones.battlefield.filter((id) => after.objects[id]!.tapped).length).toBe(3);
    expect(named(after, 'Test Free Bear')).toHaveLength(1);
  });
  it('a spell that already costs three or more is unchanged', () => {
    const s = scenario([], { defs: DEFS, p1: lands(3) });
    const after = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Bear', 'hand', 'p1') })));
    expect(after.zones.battlefield.filter((id) => after.objects[id]!.tapped).length).toBe(3);
  });
  it('it applies to every player: an opponent with two lands cannot cast a one-mana spell either', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Floor Prism'] }, p2: { battlefield: ['Plains', 'Plains'], hand: ['Test Cheap Bear'] } });
    const t2 = advanceTo(s, 2, 'main1');
    expect(legal(t2, 'p2', 'cast').some((a) => a.object === find(t2, 'Test Cheap Bear', 'hand', 'p2'))).toBe(false);
  });
  it('CR 118.9d: a spell cast without paying its mana cost still costs three mana (the floor applies to the total cost of the spell)', () => {
    const GIFT = card('Test Free Gift', 'Sorcery', 'You may cast a creature spell from your hand without paying its mana cost.', '{0}');
    const base = { battlefield: ['Test Floor Prism', 'Plains', 'Plains'], hand: ['Test Free Gift', 'Test Cheap Bear'] };
    const two = scenario([], { defs: [...DEFS, GIFT], p1: base });
    expect(legal(two, 'p1', 'cast').some((a) => a.object === find(two, 'Test Free Gift', 'hand', 'p1'))).toBe(false); // the gift itself costs three
    const six = scenario([], { defs: [...DEFS, GIFT], p1: { ...base, battlefield: ['Test Floor Prism', ...Array(6).fill('Plains')] as string[] } });
    const s = resolveAll(drive(act(six, { type: 'cast', player: 'p1', card: find(six, 'Test Free Gift', 'hand', 'p1') })), { yes: [true], objects: [[find(six, 'Test Cheap Bear', 'hand', 'p1')]] });
    expect(named(s, 'Test Cheap Bear')).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(6); // three for the gift, three for the free bear
  });
  it('a Phyrexian or {2/W} symbol: a cost that can never be less than three is unchanged; one that depends on the life-or-mana choice is not guessed (refused)', () => {
    const POD = card('Test Pod Bear', 'Creature — Bear', '', '{3}{G/P}', ['1', '1']);
    const PROC = card('Test Proc Bear', 'Creature — Bear', '', '{2/W}{2/W}{2/W}', ['1', '1']);
    const MISS = card('Test Miss Bear', 'Creature — Bear', '', '{U/P}', ['1', '1']);
    const s = scenario([], { defs: [...DEFS, POD, PROC, MISS], p1: { battlefield: ['Test Floor Prism', ...Array(6).fill('Plains')] as string[], hand: ['Test Pod Bear', 'Test Proc Bear', 'Test Miss Bear'] } });
    expect(can(s, 'Test Pod Bear')).toBe(true);
    expect(can(s, 'Test Proc Bear')).toBe(true);
    expect(can(s, 'Test Miss Bear')).toBe(false);
  });
  it('negative: while it is tapped the spells cost what they cost', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Floor Prism', tapped: true }, 'Plains'], hand: ['Test Cheap Bear'] } });
    expect(can(s, 'Test Cheap Bear')).toBe(true);
  });
  it('negative: without it a one-mana spell costs one mana', () => {
    const s = scenario([], { defs: DEFS, p1: lands(1, false) });
    expect(can(s, 'Test Cheap Bear')).toBe(true);
  });
});

describe('CR 106.12, 614.1a, 601.2f: Damping Sphere', () => {
  const SPHERE = card('Test Damp Sphere', 'Artifact', 'If a land is tapped for two or more mana, it produces {C} instead of any other type and amount.\nEach spell a player casts costs {1} more to cast for each other spell that player has cast this turn.', '{2}');
  const TWIN = card('Test Twin Land', 'Land', '{T}: Add {G}{G}.');
  const ONE = card('Test One Land', 'Land', '{T}: Add {G}.');
  const SPELL = card('Test Pair Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2'], ['G']);
  const CHEAP = card('Test Wisp', 'Creature — Spirit', '', '{G}', ['1', '1'], ['G']);
  const DEFS = [SPHERE, TWIN, ONE, SPELL, CHEAP];
  it('is automated', () => { expect(full(SPHERE)).toBe(true); });
  const tap = (s: GameState, name: string): GameState => act(s, activations(s, name, true)[0]!.action);
  it('a land tapped for {G}{G} produces one {C}; a land tapped for one mana is unchanged', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Damp Sphere', 'Test Twin Land', 'Test One Land'] } });
    expect(pool(tap(s, 'Test Twin Land'), 'p1')).toBe('C');
    expect(pool(tap(s, 'Test One Land'), 'p1')).toBe('G');
  });
  it('without it the land makes {G}{G}', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Twin Land'] } });
    expect(pool(tap(s, 'Test Twin Land'), 'p1')).toBe('GG');
  });
  it("the planner knows it: a {1}{G} spell is castable from a twin land alone without the Sphere, and not with it", () => {
    const base = { battlefield: ['Test Twin Land'], hand: ['Test Pair Bear'] };
    const free = scenario([], { defs: DEFS, p1: base });
    expect(legal(free, 'p1', 'cast').some((a) => a.object === find(free, 'Test Pair Bear', 'hand', 'p1'))).toBe(true);
    const sphere = scenario([], { defs: DEFS, p1: { ...base, battlefield: ['Test Damp Sphere', ...base.battlefield] } });
    expect(legal(sphere, 'p1', 'cast').some((a) => a.object === find(sphere, 'Test Pair Bear', 'hand', 'p1'))).toBe(false);
  });
  it('each spell costs {1} more for each other spell its caster cast this turn: the first costs its cost, the second {1} more, the third {2} more', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Damp Sphere', ...Array(6).fill('Test One Land')] as string[], hand: ['Test Wisp', 'Test Wisp', 'Test Wisp'] } });
    const tapped = (st: GameState): number => st.zones.battlefield.filter((id) => st.objects[id]!.tapped).length;
    const cast1 = (st: GameState): GameState => resolveAll(drive(act(st, { type: 'cast', player: 'p1', card: find(st, 'Test Wisp', 'hand', 'p1') })));
    s = cast1(s);
    expect(tapped(s)).toBe(1);
    s = cast1(s);
    expect(tapped(s)).toBe(1 + 2);
    s = cast1(s);
    expect(tapped(s)).toBe(1 + 2 + 3);
  });
  it("the count is the caster's own: a spell an opponent cast this turn does not raise the cost of yours", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Damp Sphere', 'Test One Land'], hand: ['Test Wisp'] }, p2: { battlefield: ['Test One Land'], hand: ['Test Wisp'] } });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Wisp', 'hand', 'p2') }))); // p2's first spell this turn
    expect(named(s, 'Test Wisp')).toHaveLength(1);
    expect(s.players.find((p) => p.id === 'p1')!.turnStats.spellsCast).toBe(0);
  });
  it("negative: without it the second spell costs its own cost, and the count is each player's own", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Damp Sphere', 'Test One Land', 'Test One Land'], hand: ['Test Wisp', 'Test Wisp'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wisp', 'hand', 'p1') })));
    expect(legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Wisp', 'hand', 'p1'))).toBe(false); // the second needs {2}: only one land was left untapped
    const plain = scenario([], { defs: DEFS, p1: { battlefield: ['Test One Land', 'Test One Land'], hand: ['Test Wisp', 'Test Wisp'] } });
    let t = resolveAll(drive(act(plain, { type: 'cast', player: 'p1', card: find(plain, 'Test Wisp', 'hand', 'p1') })));
    t = resolveAll(drive(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Wisp', 'hand', 'p1') })));
    expect(named(t, 'Test Wisp')).toHaveLength(2);
  });
});
