/**
 * std-ry5 (wave 2, Commander fresh lane ry5): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 614.10, 500.7       "you skip your next turn": the caster's next turn does not happen (the opponent takes two turns in a row), the one after does;
 *                          "you skip your next two turns": two of them are skipped
 *   CR 303.4, 115.1        "Destroy target Aura attached to a creature [you control]": an Aura on a creature is a legal target, one on a land (or on an opponent's
 *                          creature) is not
 *   CR 115.1               "Cards in graveyards can't be the targets of spells or abilities": a graveyard card can't be targeted (the spell has no legal target and
 *                          can't be cast), a permanent still can
 *   CR 502.3, 611.2b       "That creature doesn't untap during its controller's untap step for as long as this creature remains tapped": the creature stays
 *                          tapped through its controller's untap step while the source stays tapped, and untaps in the first one after the source untapped
 *   CR 615.1, 615.5        "If damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from this creature.": no damage, one counter less
 *   CR 602.5b, 208.1       formidable: not activatable with total power 4, activatable with total power 8
 *   CR 701.9a, 602.5b      "Activate only if you've discarded a card this turn": not before a discard, yes after one
 *   CR 613.1f, 113.6       "Cards in graveyards lose all abilities" stays manual: flashback is read from the card itself (actions/cast-options.ts), so the
 *                          engine would still offer it; the same effect on permanents is automated
 */
import { describe, expect, it } from 'vitest';
import { getChars, type CardDef, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, find, legal, scenario } from '../../m3/scenario';
import { card, cast, full, inYard, resolveAll, settle } from '../cmd3/helpers';

const settleTargets = (s: GameState, id: ObjectId): GameState => settle(s, { targets: [{ kind: 'object', id }] });

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const castable = (s: GameState, id: ObjectId, player = 'p1'): boolean => legal(s, player, 'cast').some((a) => (a.action as { card?: ObjectId }).card === id);

const LAPSE = card('Test Lapse', 'Sorcery', 'Draw a card. You skip your next turn.');
const SLEEPER = card('Test Sleeper', 'Creature — Beast', 'When this creature enters, you skip your next two turns.', ['6', '6']);
const PURGE = card('Test Purge', 'Instant', 'Destroy target Aura attached to a creature.');
const MENDING = card('Test Mending', 'Instant', 'Destroy target Aura attached to a creature you control.');
const CHARM = card('Test Charm', 'Enchantment — Aura', 'Enchant creature');
const RUNE = card('Test Rune', 'Enchantment — Aura', 'Enchant land');
const SEAL = card('Test Seal', 'Enchantment', "Cards in graveyards can't be the targets of spells or abilities.");
const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to your hand.');
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const JAILER = card('Test Jailer', 'Creature — Zombie', 'Cards in graveyards lose all abilities.', ['2', '1']);
const STRIP = card('Test Strip', 'Enchantment', 'Creatures your opponents control lose all abilities.');
const RECALL = card('Test Recall', 'Sorcery', 'You gain 2 life.\nFlashback {0}');
const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const SQUID = card('Test Squid', 'Creature — Squid', "{T}: Tap target creature. That creature doesn't untap during its controller's untap step for as long as this creature remains tapped.", ['1', '1']);
const WISP = card('Test Wisp', 'Creature — Spirit', 'This creature enters with two +1/+1 counters on it.\nIf damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from this creature.', ['0', '0']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target creature.');
const BRUTE = card('Test Brute', 'Creature — Ogre', '{0}: You gain 1 life. Activate only if creatures you control have total power 8 or greater.', ['2', '2']);
const GIANT = card('Test Giant', 'Creature — Giant', '', ['6', '6']);
const ROGUE = card('Test Rogue', 'Artifact', "{0}: You gain 1 life. Activate only if you've discarded a card this turn.");
const LOOT = card('Test Loot', 'Sorcery', 'Draw a card, then discard a card.');
const DEFS: CardDef[] = [LAPSE, SLEEPER, PURGE, MENDING, CHARM, RUNE, SEAL, RAISE, SMITE, JAILER, STRIP, RECALL, FLIER, BEAR, SQUID, WISP, BOLT, BRUTE, GIANT, ROGUE, LOOT];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS.filter((x) => x !== JAILER)) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 614.10, 500.7: "you skip your next turn"', () => {
  it('the caster\'s next turn does not happen: the opponent takes turns 2 and 3, the caster turn 4', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Lapse'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Lapse'));
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    s = advanceTo(s, 3, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    s = advanceTo(s, 4, 'main1');
    expect(s.turn.activePlayer).toBe('p1');
  });
  it('without the spell the turns alternate (the negative case)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Lapse'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    expect(s.turn.activePlayer).toBe('p1');
  });
  it('"you skip your next two turns": the opponent takes turns 2, 3 and 4, the caster turn 5', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Sleeper'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Sleeper'));
    for (const n of [2, 3, 4]) {
      s = advanceTo(s, n, 'main1');
      expect(s.turn.activePlayer, `turn ${n}`).toBe('p2');
    }
    s = advanceTo(s, 5, 'main1');
    expect(s.turn.activePlayer).toBe('p1');
  });
});

describe('CR 303.4, 115.1: "target Aura attached to a creature [you control]"', () => {
  const board = (): { s: GameState; charm: ObjectId; rune: ObjectId } => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Charm', 'Test Rune', 'Test Purge', 'Test Mending'], battlefield: ['Test Bear', 'Plains'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Charm', { targets: [obj(find(s, 'Test Bear', 'battlefield'))] }));
    s = resolveAll(cast(s, 'Test Rune', { targets: [obj(find(s, 'Plains', 'battlefield'))] }));
    return { s, charm: find(s, 'Test Charm', 'battlefield'), rune: find(s, 'Test Rune', 'battlefield') };
  };
  it('the Aura on a creature is a legal target and is destroyed; the Aura on a land is not a legal target', () => {
    const { s, charm, rune } = board();
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Purge', 'hand') });
    expect(t.pending?.kind).toBe('chooseTargets');
    const options = JSON.stringify(t.pending);
    expect(options).toContain(`"${charm}"`);
    expect(options).not.toContain(`"${rune}"`);
    const done = resolveAll(cast(s, 'Test Purge', { targets: [obj(charm)] }));
    expect(inYard(done, 'Test Charm')).toBe(true);
    expect(done.zones.battlefield).toContain(rune);
  });
  it('"attached to a creature you control": an Aura on the opponent\'s creature is not a legal target, one on your own creature is', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Charm', 'Test Charm', 'Test Mending'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Flier'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Charm', { targets: [obj(find(s, 'Test Bear', 'battlefield'))] }));
    s = resolveAll(cast(s, 'Test Charm', { targets: [obj(find(s, 'Test Flier', 'battlefield', 'p2'))] }));
    const auras = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Charm');
    const mine = auras.find((id) => s.objects[id]!.attachedTo === find(s, 'Test Bear', 'battlefield'))!;
    const theirs = auras.find((id) => id !== mine)!;
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mending', 'hand') });
    const options = JSON.stringify(t.pending);
    expect(options).toContain(`"${mine}"`);
    expect(options).not.toContain(`"${theirs}"`);
  });
});

describe('CR 115.1: "Cards in graveyards can\'t be the targets of spells or abilities"', () => {
  it('a creature card in a graveyard can\'t be targeted, so the spell can\'t be cast; without the enchantment it can', () => {
    const s = scenario(['Plains'], { p1: { hand: ['Test Raise'], graveyard: ['Test Bear'], battlefield: ['Test Seal'] }, defs: DEFS });
    expect(castable(s, find(s, 'Test Raise', 'hand'))).toBe(false);
    const free = scenario(['Plains'], { p1: { hand: ['Test Raise'], graveyard: ['Test Bear'] }, defs: DEFS });
    expect(castable(free, find(free, 'Test Raise', 'hand'))).toBe(true);
  });
  it('a creature on the battlefield is still a legal target', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Smite'], battlefield: ['Test Seal'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Smite', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    expect(inYard(s, 'Test Bear', 'p2')).toBe(true);
  });
});

describe('CR 613.1f, 113.6: "Cards in graveyards lose all abilities" stays manual (fail closed)', () => {
  it('the layer system removes the abilities, but flashback is read from the card itself, so the effect is not automated', () => {
    expect(full(JAILER)).toBe(false);
    expect(JSON.stringify(JAILER.automation)).toContain('feature:layer6.loseAbilities.offBattlefield');
    const s = scenario(['Plains'], { p1: { graveyard: ['Test Recall'], battlefield: ['Test Jailer'] }, defs: DEFS });
    expect(castable(s, find(s, 'Test Recall', 'graveyard'))).toBe(true); // why: the engine would still offer it
  });
  it('the same effect on permanents is automated as before', () => {
    expect(full(STRIP)).toBe(true);
    const s = scenario(['Plains'], { p1: { battlefield: ['Test Strip'] }, p2: { battlefield: ['Test Flier'] }, defs: DEFS });
    expect(getChars(s, find(s, 'Test Flier', 'battlefield', 'p2'))!.keywords).toEqual([]);
  });
});

const activatable = (s: GameState, id: ObjectId, player = 'p1'): boolean => legal(s, player, 'activate').some((a) => a.object === id);

describe('CR 502.3, 611.2b: "doesn\'t untap during its controller\'s untap step for as long as this creature remains tapped"', () => {
  it('the tapped creature stays tapped in its controller\'s untap step while the source stays tapped; it untaps once the source has untapped', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Squid'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const squid = find(s, 'Test Squid', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const ability = legal(s, 'p1', 'activate').find((a) => a.object === squid)!;
    s = resolveAll(settleTargets(act(s, ability.action), bear));
    expect(s.objects[bear]!.tapped).toBe(true);
    s = advanceTo(s, 2, 'main1'); // the opponent's untap step: the source is still tapped
    expect(s.objects[bear]!.tapped).toBe(true);
    s = advanceTo(s, 3, 'main1'); // the source untaps in its controller's untap step: the effect ends
    expect(s.objects[squid]!.tapped).toBe(false);
    expect(s.objects[bear]!.tapped).toBe(true);
    s = advanceTo(s, 4, 'main1');
    expect(s.objects[bear]!.tapped).toBe(false);
  });
});

describe('CR 615.1, 615.5: "If damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from this creature."', () => {
  it('3 damage is prevented and one +1/+1 counter is removed; another creature is dealt damage as usual', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Wisp', 'Test Bolt', 'Test Bolt'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Wisp'));
    const wisp = find(s, 'Test Wisp', 'battlefield');
    expect(s.objects[wisp]!.counters['+1/+1']).toBe(2);
    s = resolveAll(cast(s, 'Test Bolt', { targets: [obj(wisp)] }));
    expect(s.objects[wisp]!.damage).toBe(0);
    expect(s.objects[wisp]!.counters['+1/+1']).toBe(1);
    s = resolveAll(cast(s, 'Test Bolt', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    expect(inYard(s, 'Test Bear', 'p2')).toBe(true);
  });
});

describe('CR 602.5b, 208.1: formidable, "Activate only if creatures you control have total power 8 or greater"', () => {
  it('not activatable with total power 4 (two 2/2s), activatable with total power 8 (a 2/2 and a 6/6); the opponent\'s creatures do not count', () => {
    const low = scenario(['Plains'], { p1: { battlefield: ['Test Brute', 'Test Bear'] }, p2: { battlefield: ['Test Giant'] }, defs: DEFS });
    expect(activatable(low, find(low, 'Test Brute', 'battlefield'))).toBe(false);
    const high = scenario(['Plains'], { p1: { battlefield: ['Test Brute', 'Test Giant'] }, defs: DEFS });
    expect(activatable(high, find(high, 'Test Brute', 'battlefield'))).toBe(true);
  });
});

describe('CR 701.9a, 602.5b: "Activate only if you\'ve discarded a card this turn"', () => {
  it('not activatable before a discard this turn; activatable after one', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Loot'], battlefield: ['Test Rogue'] }, defs: DEFS });
    const rogue = find(s, 'Test Rogue', 'battlefield');
    expect(activatable(s, rogue)).toBe(false);
    s = resolveAll(cast(s, 'Test Loot'));
    expect(activatable(s, rogue)).toBe(true);
  });
});
