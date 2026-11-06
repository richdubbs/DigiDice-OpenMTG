/**
 * Commander lane edh-c, round edh-c-45: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler, in 4-player games. Each group has its negative cases. CR cites are checked against the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 614.1a, 120.3   "If a red instant or sorcery spell you control or a red planeswalker you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead."
 *   CR 119.3, 701.21a  "Whenever you lose life, sacrifice a permanent for each 1 life you lost."
 *   CR 601.2f, 118.7   "~ costs {1} less to cast if you control an artifact and {1} less to cast if you control an enchantment."
 *   CR 702.11b, 702.11d "Hexproof from artifacts, creatures, and enchantments" (a hexproof ability for each type)
 *   CR 509.1c, 604.1    "All creatures able to block ~ or enchanted creature do so."
 *   CR 614.1a, 701.19b  "If ~ would be destroyed, regenerate it."
 *   CR 700.4, 202.3    "Whenever a nontoken creature you control dies, mill two cards. Then return a creature card with lesser mana value than the creature that died from your graveyard to your hand."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, find, mpScenario, pass } from '../../m12/rules/helpers';
import { legal, put, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { card, full, pt, resolveAll, settle } from '../cmd3/helpers';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const inHand = (s: GameState, p: string, defId: string): number => (s.zones.hand[p] ?? []).filter((id) => s.objects[id]!.defId === defId).length;
const castAs = (s: GameState, name: string, player: string, picks: Parameters<typeof settle>[1] = {}): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), picks);
const toPriority = (s0: GameState, who: string): GameState => { let s = s0; for (let i = 0; i < 8 && s.pending?.player !== who; i++) s = pass(s); return s; };
const target = (id: string, kind: 'object' | 'player' = 'object') => ({ kind, id } as never);
/** A synthetic card with a printed color (the shared helper makes colorless cards: Scryfall's `colors`, CR 202.2). */
const colored = (name: string, type: string, text: string, color: 'R' | 'U' | 'B', pt?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [color], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const castable = (s: GameState, name: string, player = 'p1'): boolean => legal(s, player, 'cast').some((a) => s.defs[s.objects[a.object!]!.defId]!.name === name);

describe('CR 614.1a, 120.3: "If a red instant or sorcery spell you control or a red planeswalker you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead."', () => {
  const GAUNT = card('Test Ember Gauntlet', 'Artifact', 'If a red instant or sorcery spell you control or a red planeswalker you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.');
  const RZAP = colored('Test Red Zap', 'Instant', '~ deals 2 damage to any target.', 'R');
  const BZAP = colored('Test Blue Zap', 'Instant', '~ deals 2 damage to any target.', 'U');
  const RSORC = colored('Test Red Scorch', 'Sorcery', '~ deals 3 damage to target creature.', 'R');
  const RIMP = colored('Test Red Imp', 'Creature — Imp', '{T}: ~ deals 1 damage to any target.', 'R', ['1', '1']);
  const RWALK = compileCard({ name: 'Test Red Walker', layout: 'normal', mana_cost: '{2}{R}', type_line: 'Legendary Planeswalker — Test', oracle_text: '+1: ~ deals 1 damage to target player.', loyalty: '4', colors: ['R'] } as OracleCard);
  const BWALK = compileCard({ name: 'Test Blue Walker', layout: 'normal', mana_cost: '{2}{U}', type_line: 'Legendary Planeswalker — Test', oracle_text: '+1: ~ deals 1 damage to target player.', loyalty: '4', colors: ['U'] } as OracleCard);
  const OX = card('Test Steady Ox', 'Creature — Ox', '', ['1', '9']);
  const defs = [GAUNT, RZAP, BZAP, RSORC, RIMP, RWALK, BWALK, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Ember Gauntlet', 'Test Red Imp', 'Test Red Walker', 'Test Blue Walker'], hand: ['Test Red Zap', 'Test Blue Zap', 'Test Red Scorch'] }, p2: { battlefield: ['Test Steady Ox'], hand: ['Test Red Zap'] } },
    setup: (st) => { for (const o of Object.values(st.objects)) if (st.defs[o.defId]?.name.endsWith(' Walker')) o.counters['loyalty'] = 4; } });
  it('is automated', () => expect(full(GAUNT)).toBe(true));
  it('a red instant of yours deals 2 + 2 to a player and to a creature', () => {
    const s0 = start();
    const s1 = resolveAll(castAs(s0, 'Test Red Zap', 'p1', { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s1, 'p2')).toBe(16);
    const ox = onBf(s0, 'p2', 'Test Steady Ox')[0]!;
    const s2 = resolveAll(castAs(s0, 'Test Red Zap', 'p1', { targets: [target(ox)] }), { targets: [target(ox)] });
    expect(s2.objects[ox]!.damage).toBe(4);
  });
  it('a red sorcery of yours deals 3 + 2 to a creature', () => {
    const s0 = start();
    const ox = onBf(s0, 'p2', 'Test Steady Ox')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Red Scorch', 'p1', { targets: [target(ox)] }), { targets: [target(ox)] });
    expect(s1.objects[ox]!.damage).toBe(5);
  });
  it('a red planeswalker of yours deals 1 + 2', () => {
    const s0 = start();
    const w = onBf(s0, 'p1', 'Test Red Walker')[0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === w && !x.isMana)!;
    const s1 = resolveAll(settle(act(s0, a.action), { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s1, 'p2')).toBe(17);
  });
  it('a blue instant, a blue planeswalker and a red creature of yours are not raised (negatives)', () => {
    const s0 = start();
    const s1 = resolveAll(castAs(s0, 'Test Blue Zap', 'p1', { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s1, 'p2')).toBe(18);
    const bw = onBf(s0, 'p1', 'Test Blue Walker')[0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === bw && !x.isMana)!;
    const s2 = resolveAll(settle(act(s0, a.action), { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s2, 'p2')).toBe(19);
    const imp = onBf(s0, 'p1', 'Test Red Imp')[0]!;
    const b = legal(s0, 'p1', 'activate').find((x) => x.object === imp && !x.isMana)!;
    const s3 = resolveAll(settle(act(s0, b.action), { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s3, 'p2')).toBe(19);
  });
  it('an opponent\'s red instant is not raised; damage to yourself from yours is ("a permanent or player")', () => {
    const s0 = start();
    const s1 = resolveAll(castAs(toPriority(s0, 'p2'), 'Test Red Zap', 'p2', { targets: [target('p3', 'player')] }), { targets: [target('p3', 'player')] });
    expect(life(s1, 'p3')).toBe(18);
    const s2 = resolveAll(castAs(s0, 'Test Red Zap', 'p1', { targets: [target('p1', 'player')] }), { targets: [target('p1', 'player')] });
    expect(life(s2, 'p1')).toBe(16);
  });
  it('"or" with a second description that is not understood leaves the card manual (negative)', () => {
    expect(full(card('Test Odd Gauntlet', 'Artifact', 'If a red instant or sorcery spell you control or a red frogwalker you control would deal damage to a permanent or player, it deals that much damage plus 2 to that permanent or player instead.'))).toBe(false);
  });
});

describe('CR 119.3, 701.21a: "Whenever you lose life, sacrifice a permanent for each 1 life you lost."', () => {
  const TOMB = card('Test Grave Ledger', 'Enchantment', 'Whenever you lose life, sacrifice a permanent for each 1 life you lost.');
  const LOSE = card('Test Heavy Toll', 'Sorcery', 'You lose X life.\nDraw a card.'.split('\n')[0]!);
  const LOSE2 = card('Test Light Toll', 'Sorcery', 'You lose 2 life.');
  const FOE = card('Test Foe Toll', 'Sorcery', 'Target opponent loses 2 life.');
  const GAIN = card('Test Warm Sip', 'Sorcery', 'You gain 2 life.');
  const LOSE5 = card('Test Great Toll', 'Sorcery', 'You lose 5 life.');
  const defs = [TOMB, LOSE, LOSE2, FOE, GAIN, LOSE5];
  const start = (hand: string): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Grave Ledger', 'Plains', 'Plains', 'Plains', 'Plains'], hand: [hand] } } });
  const count = (s: GameState, p = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).length;
  it('is automated', () => expect(full(TOMB)).toBe(true));
  it('losing 2 life sacrifices two permanents (one for each life lost)', () => {
    const s = resolveAll(castAs(start('Test Light Toll'), 'Test Light Toll', 'p1'));
    expect(life(s, 'p1')).toBe(18);
    expect(count(s)).toBe(3);
  });
  it('losing more life than you have permanents sacrifices all of them', () => {
    const s = resolveAll(castAs(start('Test Great Toll'), 'Test Great Toll', 'p1'));
    expect(life(s, 'p1')).toBe(15);
    expect(count(s)).toBe(0);
  });
  it('an opponent losing life, or you gaining life, sacrifices nothing (negatives)', () => {
    const s1 = resolveAll(castAs(start('Test Foe Toll'), 'Test Foe Toll', 'p1', { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s1, 'p2')).toBe(18);
    expect(count(s1)).toBe(5);
    const s2 = resolveAll(castAs(start('Test Warm Sip'), 'Test Warm Sip', 'p1'));
    expect(count(s2)).toBe(5);
  });
  it('the sentence is not understood after a trigger on gaining life (negative)', () => {
    expect(full(card('Test Odd Ledger', 'Enchantment', 'Whenever you gain life, sacrifice a permanent for each 1 life you lost.'))).toBe(false);
    expect(full(card('Test Odd Ledger', 'Enchantment', 'Whenever you lose life, sacrifice a permanent for each 2 life you lost.'))).toBe(false);
  });
});

describe('CR 601.2f, 118.7, 604.5: "~ costs {1} less to cast if you control an artifact and {1} less to cast if you control an enchantment."', () => {
  const INK = card('Test Haggle Ink', 'Sorcery', 'This spell costs {1} less to cast if you control an artifact and {1} less to cast if you control an enchantment.\nYou gain 1 life.', undefined, '{3}');
  const IDOL = card('Test Plain Idol', 'Artifact', '');
  const RUNE = card('Test Plain Rune', 'Enchantment', '');
  const BOTH = card('Test Idol Rune', 'Enchantment Artifact', '');
  const defs = [INK, IDOL, RUNE, BOTH];
  const fixture = (lands: number, mine: string[], theirs: string[] = []) => ({ defs, zones: { p1: { battlefield: [...(Array(lands).fill('Plains') as string[]), ...mine], hand: ['Test Haggle Ink'] }, p2: { battlefield: theirs } } });
  it('is automated', () => expect(full(INK)).toBe(true));
  it('costs {3} with neither, {2} with one of them, {1} with both', () => {
    expect(castable(mpScenario(fixture(2, [])), 'Test Haggle Ink')).toBe(false);
    expect(castable(mpScenario(fixture(3, [])), 'Test Haggle Ink')).toBe(true);
    expect(castable(mpScenario(fixture(1, ['Test Plain Idol'])), 'Test Haggle Ink')).toBe(false);
    expect(castable(mpScenario(fixture(2, ['Test Plain Idol'])), 'Test Haggle Ink')).toBe(true);
    expect(castable(mpScenario(fixture(1, ['Test Plain Rune'])), 'Test Haggle Ink')).toBe(false);
    expect(castable(mpScenario(fixture(2, ['Test Plain Rune'])), 'Test Haggle Ink')).toBe(true);
    expect(castable(mpScenario(fixture(0, ['Test Plain Idol', 'Test Plain Rune'])), 'Test Haggle Ink')).toBe(false);
    expect(castable(mpScenario(fixture(1, ['Test Plain Idol', 'Test Plain Rune'])), 'Test Haggle Ink')).toBe(true);
  });
  it('an artifact that is also an enchantment gives both reductions (ruling 2022-02-18: costs {2} less)', () => {
    expect(castable(mpScenario(fixture(0, ['Test Idol Rune'])), 'Test Haggle Ink')).toBe(false);
    expect(castable(mpScenario(fixture(1, ['Test Idol Rune'])), 'Test Haggle Ink')).toBe(true);
  });
  it('two artifacts reduce the cost once (each reduction needs only one such permanent), and opponents\' permanents do not count (negatives)', () => {
    expect(castable(mpScenario(fixture(1, ['Test Plain Idol', 'Test Plain Idol'])), 'Test Haggle Ink')).toBe(false);
    expect(castable(mpScenario(fixture(1, [], ['Test Plain Idol', 'Test Plain Rune'])), 'Test Haggle Ink')).toBe(false);
  });
  it('paying the reduced cost casts it and gains the life', () => {
    const s0 = mpScenario(fixture(1, ['Test Plain Idol', 'Test Plain Rune']));
    const s = resolveAll(castAs(s0, 'Test Haggle Ink', 'p1'));
    expect(life(s, 'p1')).toBe(21);
  });
  it('a second reduction of another kind of condition is not understood (negative)', () => {
    expect(full(card('Test Odd Ink', 'Sorcery', 'This spell costs {1} less to cast if you control an artifact and {1} less to cast if you have 5 life.\nYou gain 1 life.', undefined, '{3}'))).toBe(false);
  });
});

describe('CR 702.11b, 702.11d: "Hexproof from artifacts, creatures, and enchantments"', () => {
  const TYRANT = card('Test Hexed Tyrant', 'Legendary Creature — Zombie', 'Hexproof from artifacts, creatures, and enchantments', ['3', '3']);
  const IDOL = card('Test Pinging Idol', 'Artifact', '{T}: ~ deals 1 damage to target creature you don\'t control.');
  const RUNE = card('Test Pinging Rune', 'Enchantment', '{T}: ~ deals 1 damage to target creature you don\'t control.');
  const GOBLIN = card('Test Pinging Imp', 'Creature — Imp', '{0}: ~ deals 1 damage to target creature you don\'t control.', ['1', '1']);
  const BOLT = card('Test Plain Bolt', 'Sorcery', '~ deals 1 damage to target creature.');
  const SHOCK = card('Test Plain Shock', 'Instant', '~ deals 1 damage to target creature.');
  const OWNIDOL = card('Test Own Idol', 'Artifact', '{T}: ~ deals 1 damage to target creature.');
  const defs = [TYRANT, IDOL, RUNE, GOBLIN, BOLT, SHOCK, OWNIDOL];
  const canActivate = (s: GameState, who: string, name: string): boolean => legal(s, who, 'activate').some((a) => !a.isMana && s.defs[s.objects[a.object!]!.defId]!.name === name);
  const foe = (battlefield: string[], hand: string[] = []): GameState => toPriority(mpScenario({ defs, zones: { p1: { battlefield: ['Test Hexed Tyrant'] }, p2: { battlefield, hand } } }), 'p2');
  it('is automated, as three hexproof abilities', () => {
    expect(full(TYRANT)).toBe(true);
    const json = JSON.stringify(TYRANT);
    for (const q of ['type:Artifact', 'type:Creature', 'type:Enchantment']) expect(json, q).toContain(`"quality":"${q}"`);
  });
  it('control: against a plain creature the same three sources can target (so the next test is not vacuous)', () => {
    const plain = (b: string): GameState => toPriority(mpScenario({ defs: [...defs, card('Test Bare Bear', 'Creature — Bear', '', ['2', '2'])], zones: { p1: { battlefield: ['Test Bare Bear'] }, p2: { battlefield: [b] } } }), 'p2');
    for (const n of ['Test Pinging Idol', 'Test Pinging Rune', 'Test Pinging Imp']) expect(canActivate(plain(n), 'p2', n), n).toBe(true);
  });
  it('an opponent\'s artifact, creature or enchantment cannot target it', () => {
    expect(canActivate(foe(['Test Pinging Idol']), 'p2', 'Test Pinging Idol')).toBe(false);
    expect(canActivate(foe(['Test Pinging Rune']), 'p2', 'Test Pinging Rune')).toBe(false);
    expect(canActivate(foe(['Test Pinging Imp']), 'p2', 'Test Pinging Imp')).toBe(false);
  });
  it('a plain spell of an opponent (not an artifact, creature or enchantment) can target it (negative)', () => {
    expect(castable(foe([], ['Test Plain Shock']), 'Test Plain Shock', 'p2')).toBe(true);
  });
  it('its controller\'s own artifact can target it (negative: only opponents are kept off)', () => {
    const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Hexed Tyrant', 'Test Own Idol'] } } });
    expect(canActivate(s, 'p1', 'Test Own Idol')).toBe(true);
  });
  it('a list with a word that is not a card type is not understood (negative)', () => {
    expect(full(card('Test Odd Tyrant', 'Creature — Zombie', 'Hexproof from artifacts, creatures, and frogs', ['3', '3']))).toBe(false);
    expect(full(card('Test Odd Tyrant', 'Creature — Zombie', 'Hexproof from artifacts, creatures, and', ['3', '3']))).toBe(false);
  });
});

describe('CR 700.4, 202.3: "Whenever a nontoken creature you control dies, mill two cards. Then return a creature card with lesser mana value than the creature that died from your graveyard to your hand."', () => {
  const OASIS = card('Test Oasis Hall', 'Enchantment', 'Whenever a nontoken creature you control dies, mill two cards. Then return a creature card with lesser mana value than the creature that died from your graveyard to your hand.');
  const BIG = card('Test Big Ox', 'Creature — Ox', '', ['3', '3'], '{3}');
  const SMALL = card('Test Small Ox', 'Creature — Ox', '', ['1', '1'], '{1}');
  const EQUAL = card('Test Equal Ox', 'Creature — Ox', '', ['3', '3'], '{3}');
  const HUGE = card('Test Huge Ox', 'Creature — Ox', '', ['5', '5'], '{5}');
  const RAP = card('Test Hard Rap', 'Sorcery', 'Destroy target creature you control.');
  const MAKE = card('Test Token Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
  const defs = [OASIS, BIG, SMALL, EQUAL, HUGE, RAP, MAKE];
  const start = (grave: string[], die = 'Test Big Ox'): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Oasis Hall', die], graveyard: grave, hand: ['Test Hard Rap'] } } });
  const kill = (s0: GameState, die = 'Test Big Ox'): GameState => {
    const ox = onBf(s0, 'p1', die)[0]!;
    return resolveAll(castAs(s0, 'Test Hard Rap', 'p1', { targets: [target(ox)] }), { targets: [target(ox)] });
  };
  it('is automated', () => expect(full(OASIS)).toBe(true));
  it('returns a creature card with lesser mana value (the {1} one) and no other: not an equal one, not a greater one', () => {
    const s = kill(start(['Test Small Ox', 'Test Equal Ox', 'Test Huge Ox']));
    expect(inHand(s, 'p1', 'Test Small Ox')).toBe(1);
    expect(inHand(s, 'p1', 'Test Equal Ox')).toBe(0);
    expect(inHand(s, 'p1', 'Test Huge Ox')).toBe(0);
  });
  it('mills two cards first, so the dying creature itself is in the graveyard and not returned (its mana value is not lesser than itself)', () => {
    const s0 = start(['Test Small Ox']);
    const lib0 = (s0.zones.library.p1 ?? []).length;
    const s = kill(s0);
    expect((s.zones.library.p1 ?? []).length).toBe(lib0 - 2);
    expect(inHand(s, 'p1', 'Test Big Ox')).toBe(0);
  });
  it('with no creature card of lesser mana value in the graveyard nothing is returned (negative)', () => {
    const s = kill(start(['Test Equal Ox', 'Test Huge Ox']));
    expect(inHand(s, 'p1', 'Test Equal Ox') + inHand(s, 'p1', 'Test Huge Ox')).toBe(0);
  });
  it('the mana value compared is the one of the creature that died: a {1} creature dying finds nothing with a lesser one (negative)', () => {
    const s = kill(start(['Test Equal Ox', 'Test Huge Ox'], 'Test Small Ox'), 'Test Small Ox');
    expect(inHand(s, 'p1', 'Test Equal Ox') + inHand(s, 'p1', 'Test Huge Ox')).toBe(0);
  });
  it('a token dying does not trigger it (negative)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Oasis Hall'], graveyard: ['Test Small Ox'], hand: ['Test Token Maker', 'Test Hard Rap'] } } });
    const s1 = resolveAll(castAs(s0, 'Test Token Maker', 'p1'));
    const tok = s1.zones.battlefield.find((id) => s1.objects[id]!.kind === 'token')!;
    const s2 = resolveAll(castAs(s1, 'Test Hard Rap', 'p1', { targets: [target(tok)] }), { targets: [target(tok)] });
    expect(inHand(s2, 'p1', 'Test Small Ox')).toBe(0);
    expect((s2.zones.library.p1 ?? []).length).toBe((s1.zones.library.p1 ?? []).length); // no mill: the trigger never happened
  });
  it('"the creature that died" after a trigger on a creature entering is not understood (negative)', () => {
    expect(full(card('Test Odd Hall', 'Enchantment', 'Whenever a nontoken creature you control enters, return a creature card with lesser mana value than the creature that died from your graveyard to your hand.'))).toBe(false);
  });
});

describe('CR 614.1a, 701.19b, 701.19c: "If ~ would be destroyed, regenerate it."', () => {
  const TROLL = card('Test Mossy Troll', 'Creature — Troll', 'If ~ would be destroyed, regenerate it.', ['2', '2']);
  const PLAIN = card('Test Plain Troll', 'Creature — Troll', '', ['2', '2']);
  const END = card('Test Quiet End', 'Instant', 'Destroy target creature.');
  const NOREGEN = card('Test Final End', 'Instant', 'Destroy target creature. It can\'t be regenerated.');
  const BURN = card('Test Big Burn', 'Instant', '~ deals 5 damage to target creature.');
  const TITHE = card('Test Dark Tithe', 'Sorcery', 'Sacrifice a creature.');
  const defs = [TROLL, PLAIN, END, NOREGEN, BURN, TITHE];
  const start = (hand: string[]): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Mossy Troll', 'Test Plain Troll'], hand } } });
  const troll = (s: GameState): ObjectId | undefined => onBf(s, 'p1', 'Test Mossy Troll')[0];
  it('is automated', () => expect(full(TROLL)).toBe(true));
  it('destroyed by an effect it regenerates: it stays, tapped (CR 701.19b)', () => {
    const s0 = start(['Test Quiet End']);
    const t = troll(s0)!;
    expect(s0.objects[t]!.tapped).toBe(false);
    const s = resolveAll(castAs(s0, 'Test Quiet End', 'p1', { targets: [target(t)] }), { targets: [target(t)] });
    expect(troll(s)).toBe(t);
    expect(s.objects[t]!.tapped).toBe(true);
  });
  it('it regenerates every time it would be destroyed this turn (no shield to use up)', () => {
    const s0 = start(['Test Quiet End', 'Test Quiet End', 'Test Quiet End']);
    const t = troll(s0)!;
    let s = s0;
    for (let i = 0; i < 3; i++) s = resolveAll(castAs(s, 'Test Quiet End', 'p1', { targets: [target(t)] }), { targets: [target(t)] });
    expect(troll(s)).toBe(t);
  });
  it('lethal damage destroys it as a state-based action and it regenerates: the damage is removed (CR 704.5g, 701.19b)', () => {
    const s0 = start(['Test Big Burn']);
    const t = troll(s0)!;
    const s = resolveAll(castAs(s0, 'Test Big Burn', 'p1', { targets: [target(t)] }), { targets: [target(t)] });
    expect(troll(s)).toBe(t);
    expect(s.objects[t]!.damage).toBe(0);
    expect(s.objects[t]!.tapped).toBe(true);
  });
  it('"it can\'t be regenerated" makes the destruction stand (CR 701.19c)', () => {
    const s0 = start(['Test Final End']);
    const t = troll(s0)!;
    const s = resolveAll(castAs(s0, 'Test Final End', 'p1', { targets: [target(t)] }), { targets: [target(t)] });
    expect(troll(s)).toBeUndefined();
  });
  it('a sacrifice is no destruction: it dies (negative, CR 701.21a); and a creature without the ability dies when destroyed', () => {
    const s0 = start(['Test Dark Tithe']);
    const t = troll(s0)!;
    const s1 = resolveAll(castAs(s0, 'Test Dark Tithe', 'p1', { objects: [t] }), { objects: [t] });
    expect(troll(s1)).toBeUndefined();
    const s2 = start(['Test Quiet End']);
    const plain = onBf(s2, 'p1', 'Test Plain Troll')[0]!;
    const s3 = resolveAll(castAs(s2, 'Test Quiet End', 'p1', { targets: [target(plain)] }), { targets: [target(plain)] });
    expect(onBf(s3, 'p1', 'Test Plain Troll')).toEqual([]);
  });
  it('with a shield counter on it, the controller is asked which applies first (CR 616.1): choosing the Troll\'s regeneration keeps the counter', () => {
    const s0 = start(['Test Quiet End']);
    const t = troll(s0)!;
    s0.objects[t]!.counters['shield'] = 1;
    let s = castAs(s0, 'Test Quiet End', 'p1', { targets: [target(t)] });
    s = resolveAll(s, { targets: [target(t)], option: 'regenerate' });
    expect(troll(s)).toBe(t);
    expect(s.objects[t]!.counters['shield']).toBe(1);
  });
  it('the other regeneration forms do not parse as static (negative)', () => {
    expect(full(card('Test Odd Troll', 'Creature — Troll', 'If ~ would be destroyed, regenerate target creature.', ['2', '2']))).toBe(false);
    expect(full(card('Test Odd Troll', 'Creature — Troll', 'If ~ would be sacrificed, regenerate it.', ['2', '2']))).toBe(false);
  });
});

describe('CR 509.1c, 604.1: "All creatures able to block ~ or enchanted creature do so."', () => {
  const STAG = card('Test Lure Stag', 'Creature — Elk', 'All creatures able to block ~ or enchanted creature do so.', ['2', '2']);
  const MANTLE = card('Test Lure Mantle', 'Enchantment — Aura', 'Enchant creature\nAll creatures able to block ~ or enchanted creature do so.');
  const BEAR = card('Test Lone Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Wall Ogre', 'Creature — Ogre', '', ['2', '2']);
  const defs = [STAG, MANTLE, BEAR, OGRE];
  const bf = (s: GameState, defId: string, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
  const answerBlocks = (s: GameState, blocks: { blocker: ObjectId; attacker: ObjectId }[]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks } });
  const toBlocks = (s0: GameState, id: ObjectId): GameState => passUntil(declareAttackers(toDeclareAttackers(s0), [[id]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage');
  it('is automated', () => { expect(full(STAG)).toBe(true); expect(full(MANTLE)).toBe(true); });
  it('the creature itself attacking: every creature able to block it must (no blockers refused, both ogres accepted)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Lure Stag'] }, p2: { battlefield: ['Test Wall Ogre', 'Test Wall Ogre'] } });
    const stag = bf(s0, 'Test Lure Stag', 'p1')[0]!;
    const s = toBlocks(s0, stag);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(applyAction(s, answerBlocks(s, [])).error).toBeDefined();
    const [a, b] = bf(s, 'Test Wall Ogre', 'p2');
    expect(applyAction(s, answerBlocks(s, [{ blocker: a!, attacker: stag }])).error).toBeDefined();
    expect(applyAction(s, answerBlocks(s, [a!, b!].map((blocker) => ({ blocker, attacker: stag })))).error).toBeUndefined();
  });
  it('the enchanted creature attacking: the Aura makes them block it too', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Lone Bear'] }, p2: { battlefield: ['Test Wall Ogre', 'Test Wall Ogre'] } });
    const bear = bf(s0, 'Test Lone Bear', 'p1')[0]!;
    const s1 = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Lure Mantle')]!.attachedTo = bear; });
    const s = toBlocks(s1, bear);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(applyAction(s, answerBlocks(s, [])).error).toBeDefined();
  });
  it('another creature attacking (negative): no one must block it', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Lone Bear', 'Test Lure Stag'] }, p2: { battlefield: ['Test Wall Ogre', 'Test Wall Ogre'] } });
    const bear = bf(s0, 'Test Lone Bear', 'p1')[0]!;
    const s = toBlocks(s0, bear);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(applyAction(s, answerBlocks(s, [])).error).toBeUndefined();
  });
  it('"and" for "or" is not understood (negative)', () => {
    expect(full(card('Test Odd Stag', 'Creature — Elk', 'All creatures able to block ~ and enchanted creature do so.', ['2', '2']))).toBe(false);
  });
});

describe('CR 614.1a, 614.6, 400.3: "If a black or red permanent, spell, or card not on the battlefield would be put into a graveyard, exile it instead." and "exile all cards that are black or red from all graveyards"', () => {
  const HALL = card('Test Pale Hall', 'Enchantment', 'If a black or red permanent, spell, or card not on the battlefield would be put into a graveyard, exile it instead.');
  const CLERIC = card('Test Pale Cleric', 'Creature — Human Cleric', 'When ~ enters, exile all cards that are black or red from all graveyards.', ['1', '1']);
  const BBEAR = colored('Test Black Bear', 'Creature — Bear', '', 'B', ['2', '2']);
  const WBEAR = card('Test White Bear', 'Creature — Bear', '', ['2', '2']);
  const RZAP = colored('Test Red Pop', 'Instant', '~ deals 1 damage to any target.', 'R');
  const END = card('Test Quiet End', 'Instant', 'Destroy target creature.');
  const DISC = card('Test Idle Mind', 'Sorcery', 'Discard a card.');
  const defs = [HALL, CLERIC, BBEAR, WBEAR, RZAP, END, DISC];
  const gy = (s: GameState, p: string, defId: string): boolean => (s.zones.graveyard[p] ?? []).some((id) => s.objects[id]!.defId === defId);
  const ex = (s: GameState, defId: string): boolean => Object.values(s.zones.exile ?? {}).flat().some((id) => s.objects[id]!.defId === defId);
  it('is automated', () => { expect(full(HALL)).toBe(true); expect(full(CLERIC)).toBe(true); });
  it('a black creature that would die is exiled instead; a white one dies (negative)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Pale Hall', 'Test Black Bear', 'Test White Bear'], hand: ['Test Quiet End', 'Test Quiet End'] } } });
    const b = onBf(s0, 'p1', 'Test Black Bear')[0]!;
    const w = onBf(s0, 'p1', 'Test White Bear')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Quiet End', 'p1', { targets: [target(b)] }), { targets: [target(b)] });
    expect(gy(s1, 'p1', 'Test Black Bear')).toBe(false);
    expect(ex(s1, 'Test Black Bear')).toBe(true);
    const s2 = resolveAll(castAs(s1, 'Test Quiet End', 'p1', { targets: [target(w)] }), { targets: [target(w)] });
    expect(gy(s2, 'p1', 'Test White Bear')).toBe(true);
  });
  it('a black card discarded from a hand is exiled instead (a card not on the battlefield); a white one goes to the graveyard (negative); an instant resolving is red and exiled too (a spell)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Pale Hall'], hand: ['Test Idle Mind', 'Test Black Bear', 'Test White Bear'] } } });
    const bb = find(s0, 'Test Black Bear', 'hand', 'p1');
    const s1 = resolveAll(castAs(s0, 'Test Idle Mind', 'p1', { objects: [bb] }), { objects: [bb] });
    expect(ex(s1, 'Test Black Bear')).toBe(true);
    const wb = find(s0, 'Test White Bear', 'hand', 'p1');
    const s2 = resolveAll(castAs(s0, 'Test Idle Mind', 'p1', { objects: [wb] }), { objects: [wb] });
    expect(gy(s2, 'p1', 'Test White Bear')).toBe(true);
    const s3 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Pale Hall'], hand: ['Test Red Pop'] } } });
    const s4 = resolveAll(castAs(s3, 'Test Red Pop', 'p1', { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(gy(s4, 'p1', 'Test Red Pop')).toBe(false);
    expect(ex(s4, 'Test Red Pop')).toBe(true);
  });
  it('the Cleric entering exiles every black or red card from every graveyard and no other', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Pale Cleric'], graveyard: ['Test Black Bear', 'Test White Bear'] }, p2: { graveyard: ['Test Red Pop', 'Test White Bear'] } } });
    const s = resolveAll(castAs(s0, 'Test Pale Cleric', 'p1'));
    expect(gy(s, 'p1', 'Test Black Bear')).toBe(false);
    expect(gy(s, 'p2', 'Test Red Pop')).toBe(false);
    expect(gy(s, 'p1', 'Test White Bear')).toBe(true);
    expect(gy(s, 'p2', 'Test White Bear')).toBe(true);
  });
  it('a list with a different tail is not understood (negative)', () => {
    expect(full(card('Test Odd Hall', 'Enchantment', 'If a black or red permanent or card not on the battlefield would be put into a graveyard, exile it instead.'))).toBe(false);
  });
});
