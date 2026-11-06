/**
 * Commander lane edh-next, round edh-next-44 (EDHREC ranks 16,251-17,500, second pass): the round's readings played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory and
 * unverified (cloud session, no rules/cr).
 *
 *   CR 601.2i, 603.4, 113.6k            "Whenever you cast a spell, if it's the second creature spell you cast this turn, you may return this card from your graveyard to the battlefield." (Vengevine)
 *   CR 701.21a, 107.1a                  "Whenever ~ attacks, sacrifice half the non-Demon permanents you control, rounded up." (Rakdos the Defiler)
 *   CR 120.3, 608.2c, 603.7             "Whenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat." (Sosuke, Son of Seshiro)
 *   CR 613.4b, 608.2h, 608.2d           "You may have ~'s base power become 1 plus the greatest power among other creatures you control until end of turn." (Arni Brokenbrow)
 *   CR 602.5, 605.1a, 702.122a          "Enchanted permanent can't attack, block, or crew Vehicles, and its activated abilities can't be activated unless they're mana abilities." (Bound in Gold)
 *   CR 701.23a, 201.2                   "Search your library for up to four Minotaur creature cards with different names, put them onto the battlefield, then shuffle." (Deathbellow War Cry)
 *   CR 118.9, 601.3b, 702.8a            "If a creature is attacking you and you control a Forest and a Plains, you may cast ~ without paying its mana cost and as though it had flash." (Qasali Ambusher)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { applyAction, getChars } from '../../../src/index';
import { advanceTo, answer, find, findAll, legal, pass, passBoth, put, scenario } from '../../m3/scenario';
import { declareAttackers, runCombat, toDeclareAttackers, tweak } from '../../m4/helpers';
import { attackWith as attackWith2, card, cast, full, lifeOf, obj, resolveAll } from '../r4-cost/support';
import { activate, resolveAll as resolveAll3 } from '../../m5/cr-examples/helpers';

const onBf = (s: GameState, name: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && (p === undefined || s.objects[id]!.controller === p));
const inYard = (s: GameState, name: string, p = 'p1'): ObjectId[] => (s.zones.graveyard[p] ?? []).filter((id) => s.objects[id]!.defId === name);
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);

// ---- Vengevine --------------------------------------------------------------------------------------------------------------------------------------------------------------
const VINE = card('Test Vine', 'Creature — Elemental', "Haste\nWhenever you cast a spell, if it's the second creature spell you cast this turn, you may return this card from your graveyard to the battlefield.", '{0}', ['4', '3']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '3']);
const RITE = card('Test Rite', 'Sorcery', 'You gain 1 life.');
describe('CR 601.2i, 603.4, 113.6k: "Whenever you cast a spell, if it\'s the second creature spell you cast this turn, you may return this card from your graveyard to the battlefield."', () => {
  const DEFS = [VINE, BEAR, OX, RITE];
  it('is automated', () => expect(full(VINE)).toBe(true));
  it('the second creature spell of the turn brings it back from the graveyard, a noncreature spell between the two not counting', () => {
    let s = scenario([], { defs: DEFS, p1: { graveyard: ['Test Vine'], hand: ['Test Bear', 'Test Rite', 'Test Ox'] } });
    s = resolveAll(cast(s, 'Test Bear'));
    expect(onBf(s, 'Test Vine').length).toBe(0);
    s = resolveAll(cast(s, 'Test Rite'));
    expect(onBf(s, 'Test Vine').length).toBe(0);
    s = resolveAll(cast(s, 'Test Ox', { yes: [true] }), { yes: [true] });
    expect(onBf(s, 'Test Vine', 'p1').length).toBe(1);
    expect(inYard(s, 'Test Vine').length).toBe(0);
  });
  it('it counts the creature spells of the whole turn, also those cast before it reached the graveyard (ruling 2020-08-07)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Vine'], hand: ['Test Bear', 'Test Ox'] } });
    s = resolveAll(cast(s, 'Test Bear'));
    const vine = onBf(s, 'Test Vine')[0]!;
    s = resolveAll3(s);
    // the Vine goes to the graveyard (state edit), then the second creature spell is cast
    const t = JSON.parse(JSON.stringify(s)) as GameState;
    t.zones.battlefield = t.zones.battlefield.filter((x) => x !== vine);
    t.zones.graveyard.p1!.push(vine);
    t.objects[vine]!.zone = 'graveyard';
    s = resolveAll(cast(t, 'Test Ox'), { yes: [true] });
    expect(onBf(s, 'Test Vine', 'p1').length).toBe(1);
  });
  it('negative: the first creature spell, the third creature spell and an opponent\'s second creature spell do not bring it back', () => {
    let s = scenario([], { defs: DEFS, p1: { graveyard: ['Test Vine'], hand: ['Test Bear', 'Test Rite'] } });
    s = resolveAll(cast(s, 'Test Bear'), { yes: [true] });
    s = resolveAll(cast(s, 'Test Rite'), { yes: [true] });
    expect(onBf(s, 'Test Vine').length).toBe(0);
    let o = scenario([], { defs: DEFS, p1: { graveyard: ['Test Vine'] }, p2: { hand: ['Test Bear', 'Test Ox'] } });
    o = advanceTo(o, 2, 'main1');
    o = resolveAll(cast(o, 'Test Bear', {}, 'p2'), { yes: [true] });
    o = resolveAll(cast(o, 'Test Ox', {}, 'p2'), { yes: [true] });
    expect(onBf(o, 'Test Vine').length).toBe(0);
    expect(inYard(o, 'Test Vine').length).toBe(1);
  });
  it('negative: the third creature spell of the turn does not bring it back a second time (it is already back; a Vine put into the graveyard again waits for the next turn)', () => {
    let s = scenario([], { defs: [...DEFS, card('Test Elk', 'Creature — Elk', '', '{0}', ['1', '1'])], p1: { graveyard: ['Test Vine'], hand: ['Test Bear', 'Test Ox', 'Test Elk'] } });
    s = resolveAll(cast(s, 'Test Bear'));
    s = resolveAll(cast(s, 'Test Ox'), { yes: [true] });
    expect(onBf(s, 'Test Vine').length).toBe(1);
    const vine = onBf(s, 'Test Vine')[0]!;
    const t = JSON.parse(JSON.stringify(s)) as GameState;
    t.zones.battlefield = t.zones.battlefield.filter((x) => x !== vine);
    t.zones.graveyard.p1!.push(vine);
    t.objects[vine]!.zone = 'graveyard';
    s = resolveAll(cast(t, 'Test Elk'), { yes: [true] });
    expect(onBf(s, 'Test Vine').length).toBe(0);
  });
});

// ---- Rakdos the Defiler -----------------------------------------------------------------------------------------------------------------------------------------------
const FIEND = card('Test Fiend', 'Creature — Demon', '{0}: Sacrifice half the non-Demon permanents you control, rounded up.', '{0}', ['3', '3']);
const IMP = card('Test Imp', 'Creature — Demon', '', '{0}', ['1', '1']);
describe('CR 701.21a, 107.1a: "Sacrifice half the non-Demon permanents you control, rounded up."', () => {
  it('is automated', () => expect(full(FIEND)).toBe(true));
  it('half of the non-Demon permanents, rounded up, are sacrificed, as many as you choose among them; Demons are never counted or sacrificed', () => {
    let s = scenario([], { defs: [FIEND, BEAR, OX, IMP], p1: { battlefield: ['Test Fiend', 'Test Imp', 'Test Bear', 'Test Bear', 'Test Ox'] } });
    const bears = onBf(s, 'Test Bear');
    s = resolveAll(activate(s, onBf(s, 'Test Fiend')[0]!, []), { objects: [[bears[0]!, bears[1]!]] });
    expect(onBf(s, 'Test Bear').length).toBe(0);
    expect(onBf(s, 'Test Ox').length).toBe(1);
    expect(onBf(s, 'Test Fiend').length).toBe(1);
    expect(onBf(s, 'Test Imp').length).toBe(1);
  });
  it('rounds up: one non-Demon permanent is sacrificed in full; with none nothing happens', () => {
    let s = scenario([], { defs: [FIEND, BEAR, IMP], p1: { battlefield: ['Test Fiend', 'Test Imp', 'Test Bear'] } });
    s = resolveAll(activate(s, onBf(s, 'Test Fiend')[0]!, []));
    expect(onBf(s, 'Test Bear').length).toBe(0);
    expect(onBf(s, 'Test Imp').length).toBe(1);
    let t = scenario([], { defs: [FIEND, IMP], p1: { battlefield: ['Test Fiend', 'Test Imp'] } });
    t = resolveAll(activate(t, onBf(t, 'Test Fiend')[0]!, []));
    expect(onBf(t, 'Test Fiend').length).toBe(1);
    expect(onBf(t, 'Test Imp').length).toBe(1);
  });
  it('negative: the opponent\'s permanents are not counted or sacrificed', () => {
    let s = scenario([], { defs: [FIEND, BEAR], p1: { battlefield: ['Test Fiend', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    s = resolveAll(activate(s, onBf(s, 'Test Fiend')[0]!, []));
    expect(onBf(s, 'Test Bear', 'p1').length).toBe(0);
    expect(onBf(s, 'Test Bear', 'p2').length).toBe(3);
  });
});

// ---- Sosuke, Son of Seshiro -------------------------------------------------------------------------------------------------------------------------------------------
const CAPTAIN = card('Test Captain', 'Creature — Human Warrior', "Whenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat.", '{0}', ['2', '2']);
const RECRUIT = card('Test Recruit', 'Creature — Human Warrior', '', '{0}', ['3', '3']);
const SCOUT = card('Test Scout', 'Creature — Elf Scout', '', '{0}', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', '', '{0}', ['0', '6']);
describe('CR 120.3, 608.2c, 603.7: "Whenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat."', () => {
  const DEFS = [CAPTAIN, RECRUIT, SCOUT, WALL];
  it('is automated', () => expect(full(CAPTAIN)).toBe(true));
  it('the creature the Warrior damaged is destroyed at end of combat; the Warrior is not', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Captain', 'Test Recruit'] }, p2: { battlefield: ['Test Wall'] } });
    const recruit = onBf(s, 'Test Recruit')[0]!;
    s = runCombat(s, { attack: [[recruit, 'p2']], block: [[onBf(s, 'Test Wall')[0]!, recruit]], assign: { [recruit]: (d) => [{ id: d.recipients[0]!.id, amount: d.amount }] } });
    expect(onBf(s, 'Test Wall').length).toBe(1); // still there before the delayed trigger resolves
    s = resolveAll(s);
    expect(onBf(s, 'Test Wall').length).toBe(0);
    expect(onBf(s, 'Test Recruit', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Captain', 'p1').length).toBe(1);
  });
  it('negative: a creature that is not a Warrior dealing the damage does not set it up; damage to a player does not either', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Captain', 'Test Scout'] }, p2: { battlefield: ['Test Wall'] } });
    const scout = onBf(s, 'Test Scout')[0]!;
    s = runCombat(s, { attack: [[scout, 'p2']], block: [[onBf(s, 'Test Wall')[0]!, scout]], assign: { [scout]: (d) => [{ id: d.recipients[0]!.id, amount: d.amount }] } });
    s = resolveAll(s);
    expect(onBf(s, 'Test Wall').length).toBe(1);
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Captain', 'Test Recruit'] }, p2: { battlefield: ['Test Wall'] } });
    t = runCombat(t, { attack: [[onBf(t, 'Test Recruit')[0]!, 'p2']] });
    t = resolveAll(t);
    expect(onBf(t, 'Test Wall').length).toBe(1);
    expect(lifeOf(t, 'p2')).toBe(17);
  });
});

// ---- Arni Brokenbrow --------------------------------------------------------------------------------------------------------------------------------------------------
const ARNI = card('Test Berserker', 'Creature — Human Berserker', "{0}: You may have ~'s base power become 1 plus the greatest power among other creatures you control until end of turn.", '{0}', ['2', '2']);
const TITAN = card('Test Titan', 'Creature — Giant', '', '{0}', ['6', '6']);
describe("CR 613.4b, 608.2h, 608.2d: \"You may have ~'s base power become 1 plus the greatest power among other creatures you control until end of turn.\"", () => {
  it('is automated', () => expect(full(ARNI)).toBe(true));
  it('with a 6-power creature beside it the base power becomes 7 (a counter on it still adds after); you decline and it stays 2', () => {
    const s0 = scenario([], { defs: [ARNI, TITAN, BEAR], p1: { battlefield: ['Test Berserker', 'Test Titan', 'Test Bear'] } });
    const arni = onBf(s0, 'Test Berserker')[0]!;
    let s = resolveAll(activate(s0, arni, []), { yes: [true] });
    expect(power(s, arni)).toBe(7);
    let t = resolveAll(activate(s0, arni, []), { yes: [false] });
    expect(power(t, arni)).toBe(2);
  });
  it('the greatest power among OTHER creatures: it does not count itself, and an opponent\'s creature does not count', () => {
    const s0 = scenario([], { defs: [ARNI, TITAN, BEAR], p1: { battlefield: ['Test Berserker', 'Test Bear'] }, p2: { battlefield: ['Test Titan'] } });
    const arni = onBf(s0, 'Test Berserker')[0]!;
    const s = resolveAll(activate(s0, arni, []), { yes: [true] });
    expect(power(s, arni)).toBe(3); // 1 + the Bear's 2
    // the value is fixed when the ability resolves (CR 608.2h): it stays 7 after the 6-power creature leaves
    const s1 = scenario([], { defs: [ARNI, TITAN], p1: { battlefield: ['Test Berserker', 'Test Titan'] } });
    const arni1 = onBf(s1, 'Test Berserker')[0]!;
    const fixed = resolveAll(activate(s1, arni1, []), { yes: [true] });
    const gone = JSON.parse(JSON.stringify(fixed)) as GameState;
    gone.zones.battlefield = gone.zones.battlefield.filter((x) => x !== onBf(s1, 'Test Titan')[0]);
    expect(power(fixed, arni1)).toBe(7);
    expect(power(gone, arni1)).toBe(7);
    const alone = scenario([], { defs: [ARNI], p1: { battlefield: ['Test Berserker'] } });
    const a = onBf(alone, 'Test Berserker')[0]!;
    expect(power(resolveAll(activate(alone, a, []), { yes: [true] }), a)).toBe(1); // nothing else: 1 plus 0
  });
});

// ---- Bound in Gold --------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 602.5, 605.1a, 702.122a: "Enchanted permanent can\'t attack, block, or crew Vehicles, and its activated abilities can\'t be activated unless they\'re mana abilities." (joined by ", and")', () => {
  const SEAL = card('Test Seal', 'Enchantment — Aura', "Enchant permanent\nEnchanted permanent can't attack, block, or crew Vehicles, and its activated abilities can't be activated unless they're mana abilities.");
  const TWO = card('Test Seal Two', 'Enchantment — Aura', "Enchant permanent\nEnchanted permanent can't attack, block, or crew Vehicles. Its activated abilities can't be activated unless they're mana abilities.");
  const MAGE = card('Test Mage', 'Creature — Wizard', '{0}: You gain 1 life.\n{T}: Add {G}.', '{0}', ['1', '1']);
  it('is automated and gives the same abilities as the two-sentence wording', () => {
    expect(full(SEAL)).toBe(true);
    expect(JSON.stringify(SEAL.faces[0]!.abilities.map((a) => ({ ...a, text: undefined })))).toBe(JSON.stringify(TWO.faces[0]!.abilities.map((a) => ({ ...a, text: undefined }))));
  });
  it('the enchanted creature\'s activated ability can\'t be activated but its mana ability can; unenchanted, both can', () => {
    const base = scenario([], { defs: [SEAL, MAGE], p1: { battlefield: ['Test Mage'] } });
    const mage = onBf(base, 'Test Mage')[0]!;
    const sealed = tweak(base, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Seal')]!.attachedTo = mage; });
    const kinds = (s: GameState): string[] => legal(s, 'p1', 'activate').filter((a) => a.object === mage).map((a) => (a.isMana === true ? 'mana' : 'other'));
    expect(kinds(sealed)).toEqual(['mana']);
    expect(kinds(base).sort()).toEqual(['mana', 'other']);
  });
});

// ---- Deathbellow War Cry ----------------------------------------------------------------------------------------------------------------------------------------------
const HORDE = card('Test Horde', 'Sorcery', 'Search your library for up to four Minotaur creature cards with different names, put them onto the battlefield, then shuffle.');
const MINO_A = card('Test Minotaur A', 'Creature — Minotaur', '', '{0}', ['2', '2']);
const MINO_B = card('Test Minotaur B', 'Creature — Minotaur', '', '{0}', ['3', '3']);
describe('CR 701.23a, 201.2: "Search your library for up to four Minotaur creature cards with different names, put them onto the battlefield, then shuffle."', () => {
  it('is automated', () => expect(full(HORDE)).toBe(true));
  it('two cards with the same name cannot both be found; cards of different names can', () => {
    const s0 = scenario([], { defs: [HORDE, MINO_A, MINO_B, BEAR], p1: { hand: ['Test Horde'], library: ['Test Minotaur A', 'Test Minotaur A', 'Test Minotaur B', 'Test Bear'] } });
    const a = findAll(s0, 'Test Minotaur A', 'library', 'p1');
    const b = find(s0, 'Test Minotaur B', 'library', 'p1');
    // the search asks for the cards one at a time: after one Minotaur A the other is no longer offered (a name already found), a Minotaur B and nothing else is
    let s = passBoth(cast(s0, 'Test Horde'));
    const first = s.pending as unknown as { kind: string; options: ObjectId[] };
    expect(first.kind).toBe('chooseObjects');
    expect(first.options).toEqual(expect.arrayContaining([a[0]!, a[1]!, b]));
    expect(first.options).not.toContain(find(s0, 'Test Bear', 'library', 'p1')); // not a Minotaur
    s = answer(s, { kind: 'chooseObjects', ids: [a[0]!] });
    const second = s.pending as unknown as { kind: string; options: ObjectId[] };
    expect(second.options).toContain(b);
    expect(second.options).not.toContain(a[1]!);
    const ok = resolveAll(cast(s0, 'Test Horde'), { objects: [[a[0]!], [b]] });
    expect(onBf(ok, 'Test Minotaur A', 'p1').length).toBe(1);
    expect(onBf(ok, 'Test Minotaur B', 'p1').length).toBe(1);
    expect(onBf(ok, 'Test Bear', 'p1').length).toBe(0); // not a Minotaur: it can't be found
  });
});

// ---- Qasali Ambusher --------------------------------------------------------------------------------------------------------------------------------------------------
const AMBUSH = card('Test Ambusher', 'Creature — Cat', "Reach\nIf a creature is attacking you and you control a Forest and a Plains, you may cast ~ without paying its mana cost and as though it had flash.", '{3}{G}', ['2', '3']);
describe('CR 118.9, 601.3b, 702.8a: "If a creature is attacking you and you control a Forest and a Plains, you may cast ~ without paying its mana cost and as though it had flash."', () => {
  const FOREST = card('Test Forest', 'Land — Forest', '{T}: Add {G}.');
  const PLAINS = card('Test Plains', 'Land — Plains', '{T}: Add {W}.');
  const SAVANNAH = card('Test Savannah', 'Land — Forest Plains', '{T}: Add {G} or {W}.');
  const DEFS = [AMBUSH, BEAR, FOREST, PLAINS, SAVANNAH];
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.');
  /** p2 attacks with a Bear: you (`you`), or only a planeswalker of yours; p1 then has priority in the declare attackers step. */
  const attacked = (p1bf: string[], at: 'you' | 'walker' = 'you'): GameState => {
    const s0 = scenario([], { defs: [...DEFS, WALKER], p1: { hand: ['Test Ambusher'], battlefield: at === 'walker' ? [...p1bf, { name: 'Test Walker', counters: { loyalty: 3 } }] : p1bf }, p2: { battlefield: ['Test Bear'] } });
    const s1 = advanceTo(s0, 2, 'main1');
    const target = at === 'walker' ? onBf(s1, 'Test Walker')[0]! : 'p1';
    return pass(declareAttackers(toDeclareAttackers(s1), [[onBf(s1, 'Test Bear')[0]!, target]]));
  };
  /** Is casting it with its free alternative cost accepted now (the game applies the cast, or refuses it)? */
  const canFree = (s: GameState): boolean => applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ambusher', 'hand', 'p1'), method: 'alternative' } as never).error === undefined;
  it('is automated', () => expect(full(AMBUSH)).toBe(true));
  it('on the opponent\'s turn, with a creature attacking you and a Forest and a Plains, you can cast it for free at instant speed', () => {
    const s = attacked(['Test Forest', 'Test Plains']);
    const s2 = cast(s, 'Test Ambusher', {}, 'p1', 'alternative');
    expect(s2.zones.stack.length).toBe(1);
    const done = resolveAll(s2);
    expect(onBf(done, 'Test Ambusher', 'p1').length).toBe(1);
  });
  it('one land with both subtypes is enough (ruling 2008-10-01); the lands need not be named Forest and Plains', () => {
    expect(canFree(attacked(['Test Savannah']))).toBe(true);
  });
  it('negative: without a Plains, with the creature attacking only a planeswalker (or the opponent), or with no attack, the free cast is not offered, and the normal cast is sorcery-speed', () => {
    expect(canFree(attacked(['Test Forest', 'Test Plains']))).toBe(true); // the positive control of the same set-up
    expect(canFree(attacked(['Test Forest']))).toBe(false);
    expect(canFree(attacked(['Test Plains']))).toBe(false);
    expect(canFree(attacked(['Test Forest', 'Test Plains'], 'walker'))).toBe(false);
    const quiet = scenario([], { defs: DEFS, p1: { hand: ['Test Ambusher'], battlefield: ['Test Forest', 'Test Plains'] } });
    expect(canFree(quiet)).toBe(false); // p1's own main phase, no attacker: p1 has priority, so only the missing attack refuses it
    // the normal cast (full cost, no mana here) is refused at instant speed on the opponent's turn (CR 117.1a)
    const nsv = attacked(['Test Forest', 'Test Plains']);
    expect(applyAction(nsv, { type: 'cast', player: 'p1', card: find(nsv, 'Test Ambusher', 'hand', 'p1') } as never).error).toBeDefined();
  });
});
