/**
 * Commander effort, round edh-c-20 (EDHREC ranks 18,126 to 18,750, third pass): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler. Alice (p1) casts and attacks. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 208.1, 608.2b           "destroy target non-Elf creature whose power and toughness aren't equal" (checked as targeted and as it resolves)
 *   CR 303.4b, 613.4c, 509.1b  "Creatures you control that are enchanted get +1/+1 and can't be blocked except by creatures with defender."
 *   CR 611.2a, 611.2c, 613.4c  "Attacking red creatures get +2/+0 and attacking white creatures get +0/+2 until end of turn."
 *   CR 118.12a, 107.3a         "that player sacrifices it unless they pay {X}, where X is its mana value"
 *   CR 113.6k, 400.7           "When this card is put into your hand from your graveyard, you gain 2 life."
 *   CR 400.3, 603.2c           "Whenever one or more cards are put into a library from anywhere, put a +1/+1 counter on this creature."
 *   CR 702.33d, 702.33e        "target opponent discards a card for each time it was kicked"
 *   CR 120.1, 603.4, 603.10a   "Whenever a creature an opponent controls dies, if ~ dealt damage to it this turn, draw a card."
 *   CR 509.1, 608.2h           "Whenever a Sliver becomes blocked, that Sliver gets +1/+1 until end of turn for each creature blocking it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, find, findAll, pass, scenario } from '../../m3/scenario';
import { answer, passUntil } from '../../m12/rules/helpers';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';
import { counters, full, inYard, named, pt, resolveAll, settle, type Picks } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
/** A synthetic card with colors (the cmd3 helper has none). */
function mk(name: string, type: string, text: string, p?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(p ? { power: p[0], toughness: p[1] } : {}) } as OracleCard);
}
const cast = (s: GameState, name: string, p: Picks = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);
const onBf = (s: GameState, defId: string): boolean => named(s, defId).length > 0;

const WINNOWER = mk('Test Winnower', 'Creature — Elf Warrior', 'When this creature enters, you may destroy target non-Elf creature whose power and toughness aren\'t equal.', ['2', '2']);
const MARK = mk('Test Mark', 'Enchantment — Aura', 'Enchant creature\nCreatures you control that are enchanted get +1/+1 and can\'t be blocked except by creatures with defender.', undefined, '{0}');
const VETERAN = mk('Test Veteran', 'Creature — Human Soldier', 'Whenever this creature attacks, attacking red creatures get +2/+0 and attacking white creatures get +0/+2 until end of turn.', ['1', '1']);
const TITHE = mk('Test Tithe', 'Enchantment — Aura', 'Enchant nonland permanent\nAt the beginning of the upkeep of enchanted permanent\'s controller, that player sacrifices it unless they pay {X}, where X is its mana value.', undefined, '{0}');
const SCALE = mk('Test Scale', 'Creature — Insect', 'When this card is put into your hand from your graveyard, you gain 2 life.', ['2', '2']);
const RETURN = mk('Test Return', 'Sorcery', 'Return target creature card from your graveyard to your hand.', undefined, '{0}');
const REVIVE = mk('Test Revive', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.', undefined, '{0}');
const SEEKER = mk('Test Seeker', 'Creature — Human Wizard', 'Whenever one or more cards are put into a library from anywhere, put a +1/+1 counter on this creature.', ['1', '1']);
const TUCK = mk('Test Tuck', 'Sorcery', 'Put target creature card from your graveyard on top of your library.', undefined, '{0}');
const MILL = mk('Test Mill', 'Sorcery', 'Target player mills a card.', undefined, '{0}');
const RITUAL = mk('Test Ritual', 'Creature — Vampire Cleric', 'Multikicker {B}\nWhen this creature enters, target opponent discards a card for each time it was kicked.', ['1', '1'], '{B}');
const ARCHER = mk('Test Archer', 'Creature — Human Archer', 'Reach\n{T}: Test Archer deals 1 damage to any target.\nWhenever a creature an opponent controls dies, if Test Archer dealt damage to it this turn, draw a card.', ['2', '2']);
const BOTTOM = mk('Test Bottom', 'Sorcery', 'Put the top card of your library on the bottom of your library.', undefined, '{0}');
const BOLT = mk('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to target creature.', undefined, '{0}');
const SPINED = mk('Test Spined', 'Creature — Sliver', 'Whenever a Sliver becomes blocked, that Sliver gets +1/+1 until end of turn for each creature blocking it.', ['1', '1']);
const BEAR = mk('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BRUTE = mk('Test Brute', 'Creature — Ogre', '', ['3', '2']);
const ELFLORD = mk('Test Elflord', 'Creature — Elf', '', ['3', '2']);
const PIKER = mk('Test Piker', 'Creature — Soldier', '', ['1', '1']);
const REDMAN = mk('Test Redman', 'Creature — Goblin', '', ['1', '1'], '{R}', ['R']);
const WHITEMAN = mk('Test Whiteman', 'Creature — Human', '', ['1', '1'], '{W}', ['W']);
const BOTHMAN = mk('Test Bothman', 'Creature — Human', '', ['1', '1'], '{R}{W}', ['R', 'W']);
const GREENMAN = mk('Test Greenman', 'Creature — Elf', '', ['1', '1'], '{G}', ['G']);
const COSTLY = mk('Test Costly', 'Creature — Golem', '', ['2', '2'], '{2}{G}', ['G']);
const FREEBIE = mk('Test Freebie', 'Artifact Creature — Construct', '', ['1', '1'], '{0}');
const WALL = mk('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const DEFS: CardDef[] = [BOTTOM, WINNOWER, MARK, VETERAN, TITHE, SCALE, RETURN, REVIVE, SEEKER, TUCK, MILL, RITUAL, ARCHER, BOLT, SPINED, BEAR, BRUTE, ELFLORD, PIKER, REDMAN, WHITEMAN, BOTHMAN, GREENMAN, COSTLY, FREEBIE, WALL];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 208.1, 608.2b: "destroy target non-Elf creature whose power and toughness aren\'t equal"', () => {
  it('a 3/2 non-Elf is destroyed; a 2/2 (equal) beside it is not', () => {
    let s = scenario([], { p1: { hand: ['Test Winnower'] }, p2: { battlefield: ['Test Bear', 'Test Brute'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Winnower'), { targets: [obj(findAll(s, 'Test Brute', 'battlefield', 'p2')[0]!)] });
    expect(onBf(s, 'Test Brute')).toBe(false);
    expect(onBf(s, 'Test Bear')).toBe(true);
  });
  it('no legal target (a 2/2 and an Elf 3/2 only): nothing is destroyed', () => {
    let s = scenario([], { p1: { hand: ['Test Winnower'] }, p2: { battlefield: ['Test Bear', 'Test Elflord'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Winnower'));
    expect(onBf(s, 'Test Bear')).toBe(true);
    expect(onBf(s, 'Test Elflord')).toBe(true);
  });
});

describe('CR 303.4b, 613.4c: "Creatures you control that are enchanted get +1/+1"', () => {
  it('the enchanted creature of the Aura\'s controller gets +1/+1; an unenchanted one and the opponent\'s enchanted one do not', () => {
    let s = scenario([], { p1: { hand: ['Test Mark'], battlefield: ['Test Bear', 'Test Piker'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const mine = findAll(s, 'Test Bear', 'battlefield', 'p1')[0]!;
    s = resolveAll(cast(s, 'Test Mark', { targets: [obj(mine)] }));
    expect(pt(s, mine)).toBe('3/3');
    expect(pt(s, findAll(s, 'Test Piker', 'battlefield', 'p1')[0]!)).toBe('1/1');
    expect(pt(s, findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!)).toBe('2/2');
  });
  it('CR 509.1b: the enchanted attacker can be blocked by a creature with defender only', () => {
    let s = scenario([], { p1: { hand: ['Test Mark'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Wall'] }, defs: DEFS });
    const mine = findAll(s, 'Test Bear', 'battlefield', 'p1')[0]!;
    s = resolveAll(cast(s, 'Test Mark', { targets: [obj(mine)] }));
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[mine]]));
    const bear = findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!;
    const wall = findAll(s, 'Test Wall', 'battlefield', 'p2')[0]!;
    expect(() => declareBlockers(s, [[bear, mine]])).toThrow();
    expect(() => declareBlockers(s, [[wall, mine]])).not.toThrow();
  });
});

describe('CR 611.2a, 611.2c, 613.4c: "Attacking red creatures get +2/+0 and attacking white creatures get +0/+2 until end of turn"', () => {
  it('red +2/+0, white +0/+2, green nothing, a red-and-white creature both', () => {
    let s = scenario([], { p1: { battlefield: ['Test Veteran', 'Test Redman', 'Test Whiteman', 'Test Greenman', 'Test Bothman'] }, defs: DEFS });
    const ids = ['Test Veteran', 'Test Redman', 'Test Whiteman', 'Test Greenman', 'Test Bothman'].map((n) => named(s, n)[0]!);
    s = declareAttackers(toDeclareAttackers(s), ids.map((id) => [id] as [ObjectId]));
    s = resolveAll(s);
    expect(ids.slice(1).map((id) => pt(s, id))).toEqual(['3/1', '1/3', '1/1', '3/3']);
  });
  it('a creature that does not attack is not pumped (negative)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Veteran', 'Test Redman'] }, defs: DEFS });
    const vet = named(s, 'Test Veteran')[0]!;
    s = declareAttackers(toDeclareAttackers(s), [[vet]]);
    s = resolveAll(s);
    expect(pt(s, named(s, 'Test Redman')[0]!)).toBe('1/1');
  });
});

describe('CR 118.12a, 107.3a: "that player sacrifices it unless they pay {X}, where X is its mana value"', () => {
  /** p1 puts the Aura on a p2 permanent, then play goes to p2's upkeep. */
  function toUpkeep(s0: GameState, target: string, p2lands: string[]): GameState {
    let s = scenario(['Forest'], { p1: { hand: ['Test Tithe'] }, p2: { battlefield: [target, ...p2lands] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Tithe', { targets: [obj(findAll(s, target, 'battlefield', 'p2')[0]!)] }));
    return passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'upkeep', 'the upkeep of p2', 200);
  }
  it('mana value 3 and the controller pays {3}: it stays', () => {
    let s = toUpkeep(scenario([]), 'Test Costly', ['Forest', 'Forest', 'Forest']);
    for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { yes: true });
    expect(onBf(s, 'Test Costly')).toBe(true);
  });
  it('the controller cannot pay (no lands): it is sacrificed', () => {
    let s = toUpkeep(scenario([]), 'Test Costly', []);
    for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { yes: true });
    expect(onBf(s, 'Test Costly')).toBe(false);
    expect(inYard(s, 'Test Costly', 'p2')).toBe(true);
  });
  it('the controller declines to pay: it is sacrificed (negative)', () => {
    let s = toUpkeep(scenario([]), 'Test Costly', ['Forest', 'Forest', 'Forest']);
    for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { yes: false });
    expect(onBf(s, 'Test Costly')).toBe(false);
  });
  it('mana value 0 (ruling 2012-10-01): nothing to pay, it stays', () => {
    let s = toUpkeep(scenario([]), 'Test Freebie', []);
    for (let g = 0; g < 20 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0); g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { yes: true });
    expect(onBf(s, 'Test Freebie')).toBe(true);
  });
});

const life = (s: GameState, id: string): number => s.players.find((p) => p.id === id)!.life;

describe('CR 113.6k, 400.7: "When this card is put into your hand from your graveyard, you gain 2 life."', () => {
  it('returned to hand from the graveyard by a spell: you gain 2 life', () => {
    let s = scenario([], { p1: { hand: ['Test Return'], graveyard: ['Test Scale'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Return', { targets: [obj(find(s, 'Test Scale', 'graveyard'))] }));
    expect(find(s, 'Test Scale', 'hand')).toBeDefined();
    expect(life(s, 'p1')).toBe(before + 2);
  });
  it('returned to the battlefield instead (negative): no life', () => {
    let s = scenario([], { p1: { hand: ['Test Revive'], graveyard: ['Test Scale'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Revive', { targets: [obj(find(s, 'Test Scale', 'graveyard'))] }));
    expect(life(s, 'p1')).toBe(before);
  });
  it('a copy of it in your hand that was never in the graveyard (negative): a card in hand gains nothing', () => {
    const s = scenario([], { p1: { hand: ['Test Scale'] }, defs: DEFS });
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 400.3, 603.2c: "Whenever one or more cards are put into a library from anywhere, put a +1/+1 counter on this creature."', () => {
  it('a creature card put on top of your library from your graveyard: one counter', () => {
    let s = scenario([], { p1: { hand: ['Test Tuck'], battlefield: ['Test Seeker'], graveyard: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Tuck', { targets: [obj(find(s, 'Test Bear', 'graveyard'))] }));
    expect(counters(s, named(s, 'Test Seeker')[0]!, '+1/+1')).toBe(1);
  });
  it('a card milled into a graveyard (negative): no counter', () => {
    let s = scenario([], { p1: { hand: ['Test Mill'], battlefield: ['Test Seeker'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Mill', { targets: [player('p1')] }));
    expect(counters(s, named(s, 'Test Seeker')[0]!, '+1/+1')).toBe(0);
  });
  it('the top card moved to the bottom of the same library (negative; Wan Shi Tong ruling 2025-10-02): no counter', () => {
    expect(full(BOTTOM), JSON.stringify(BOTTOM.automation)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bottom'], battlefield: ['Test Seeker'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Bottom'));
    expect(counters(s, named(s, 'Test Seeker')[0]!, '+1/+1')).toBe(0);
  });
  it('a card returned to hand from the graveyard (negative): no counter', () => {
    let s = scenario([], { p1: { hand: ['Test Return'], battlefield: ['Test Seeker'], graveyard: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Return', { targets: [obj(find(s, 'Test Bear', 'graveyard'))] }));
    expect(counters(s, named(s, 'Test Seeker')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 702.33d, 702.33e: "target opponent discards a card for each time it was kicked"', () => {
  function play(kicks: number): GameState {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Ritual'], battlefield: ['Swamp', 'Swamp', 'Swamp'] }, p2: { hand: ['Test Bear', 'Test Brute', 'Test Piker'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ritual', 'hand') });
    for (let g = 0; g < 12 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: kicks });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as { options: ObjectId[] }).options.slice(0, (d as { min: number }).min) });
      else s = settle(s, { targets: [player('p2')] });
    }
    return resolveAll(s, { targets: [player('p2')] });
  }
  it('kicked twice: the opponent discards two cards', () => {
    const s = play(2);
    expect((s.zones.hand['p2'] ?? []).length).toBe(1);
  });
  it('not kicked (negative): the opponent discards nothing', () => {
    const s = play(0);
    expect((s.zones.hand['p2'] ?? []).length).toBe(3);
  });
});

describe('CR 120.1, 603.4, 603.10a: "Whenever a creature an opponent controls dies, if ~ dealt damage to it this turn, draw a card."', () => {
  const board = (): GameState => scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Archer'] }, p2: { battlefield: ['Test Piker', 'Test Piker'] }, defs: DEFS });
  it('the Archer pings a 1/1 that dies: you draw a card', () => {
    let s = board();
    const handBefore = (s.zones.hand['p1'] ?? []).length;
    const archer = named(s, 'Test Archer')[0]!;
    s = act(s, { type: 'activate', player: 'p1', source: archer, ability: 'p:0:1' });
    s = resolveAll(s, { targets: [obj(findAll(s, 'Test Piker', 'battlefield', 'p2')[0]!)] });
    expect((s.zones.hand['p1'] ?? []).length).toBe(handBefore + 1);
  });
  it('another source kills the 1/1 (negative): no card is drawn', () => {
    let s = board();
    const handBefore = (s.zones.hand['p1'] ?? []).length;
    s = resolveAll(cast(s, 'Test Bolt', { targets: [obj(findAll(s, 'Test Piker', 'battlefield', 'p2')[0]!)] }));
    expect((s.zones.hand['p1'] ?? []).length).toBe(handBefore - 1);
  });
});

describe('CR 509.1, 608.2h: "Whenever a Sliver becomes blocked, that Sliver gets +1/+1 until end of turn for each creature blocking it."', () => {
  it('blocked by two creatures: +2/+2; the number is counted as the effect resolves', () => {
    let s = scenario([], { p1: { battlefield: ['Test Spined'] }, p2: { battlefield: ['Test Bear', 'Test Brute'] }, defs: DEFS });
    const sp = named(s, 'Test Spined')[0]!;
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[sp]]));
    s = declareBlockers(s, [[findAll(s, 'Test Bear', 'battlefield', 'p2')[0]!, sp], [findAll(s, 'Test Brute', 'battlefield', 'p2')[0]!, sp]]);
    s = resolveAll(s);
    expect(pt(s, sp)).toBe('3/3');
  });
  it('unblocked (negative): no trigger, no bonus', () => {
    let s = scenario([], { p1: { battlefield: ['Test Spined'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const sp = named(s, 'Test Spined')[0]!;
    s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[sp]]));
    s = declareBlockers(s, []);
    s = resolveAll(s);
    expect(pt(s, sp)).toBe('1/1');
  });
});

describe('parser/lower/ability.ts: "if ~ dealt damage to it this turn" is read only for the dies trigger of another object', () => {
  it('a combat trigger of the card itself is not automated (its "it" would be the card itself)', () => {
    const d = mk('Test Grudge', 'Creature — Human', 'Whenever this creature becomes blocked by a creature, if this creature dealt damage to it this turn, draw a card.', ['2', '2']);
    expect(full(d)).toBe(false);
  });
  it('your own creature dying draws nothing even after the Archer pinged it (negative)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Archer', 'Test Piker'] }, defs: DEFS });
    const handBefore = (s.zones.hand['p1'] ?? []).length;
    s = act(s, { type: 'activate', player: 'p1', source: named(s, 'Test Archer')[0]!, ability: 'p:0:1' });
    s = resolveAll(s, { targets: [obj(named(s, 'Test Piker')[0]!)] });
    expect((s.zones.hand['p1'] ?? []).length).toBe(handBefore);
  });
});
