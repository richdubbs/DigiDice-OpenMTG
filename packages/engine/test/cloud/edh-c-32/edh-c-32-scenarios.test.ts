/**
 * Commander lane edh-c, round edh-c-32: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25
 * (see the round's record).
 *
 *   CR 701.23a-b, 201.2         "Search its controller's graveyard, hand, and library for all cards with the same name as that creature and exile them." (Eradicate, Splinter): the matching cards of a graveyard are all found
 *   CR 118.12, 701.21a          "At the beginning of the upkeep of enchanted creature's controller, that player sacrifices that creature unless they pay {2}." (Slow Motion)
 *   CR 601.3, 101.2, 503.1      "Cast this spell only during an opponent's upkeep." (Festival)
 *   CR 205.3m, 604.3, 702.73a   "~ is every creature type." (Mistform Ultimus): in every zone
 *   CR 701.20a, 701.9a          "Target player reveals their hand and discards all nonland cards." (Amnesia)
 *   CR 701.9a, 202.3, 608.2h    "... target player discards a card. ~ deals damage to that player equal to that card's mana value." (Hellhole Rats)
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, find, pass } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const cast = (s: GameState, name: string, p: { targets?: TargetChoice[]; objects?: ObjectId[]; yes?: boolean } = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const idsOf = (s: GameState, name: string, zone: string, owner: string): ObjectId[] =>
  Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name && o.zone === zone && o.owner === owner).map((o) => o.id);
const n = (s: GameState, name: string, zone: string, owner: string): number => idsOf(s, name, zone, owner).length;

const ERADICATE = card('Test Eradicate', 'Sorcery', "Exile target nonblack creature. Search its controller's graveyard, hand, and library for all cards with the same name as that creature and exile them. Then that player shuffles.");
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const CUB = card('Test Cub', 'Creature — Bear', '', ['1', '1']);
const SLOW = card('Test Slowdown', 'Enchantment — Aura', "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player sacrifices that creature unless they pay {2}.");
const FESTIVAL = card('Test Festival', 'Instant', "Cast this spell only during an opponent's upkeep.\nCreatures can't attack this turn.");
const ILLUSION = card('Test Illusion', 'Creature — Illusion', 'Test Illusion is every creature type.', ['1', '1']);
const AMNESIA = card('Test Amnesia', 'Sorcery', 'Target player reveals their hand and discards all nonland cards.');
const RATS = card('Test Rats', 'Creature — Rat', "Haste\nWhen this creature enters, target player discards a card. This creature deals damage to that player equal to that card's mana value.", ['1', '1']);
const BIGSPELL = card('Test Big Spell', 'Sorcery', 'You gain 1 life.', undefined, '{2}{R}');
const DEFS: CardDef[] = [ERADICATE, BEAR, CUB, SLOW, FESTIVAL, ILLUSION, AMNESIA, RATS, BIGSPELL];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.23a-b, 201.2: "Search its controller\'s graveyard, hand, and library for all cards with the same name as that creature and exile them." (Eradicate, Splinter)', () => {
  const game = () => mpScenario({
    players: 3, defs: DEFS,
    zones: { p1: { hand: ['Test Eradicate'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Bear', 'Test Bear', 'Test Cub'], hand: ['Test Bear'], library: ['Test Bear'] } },
  });
  it('the copies in the graveyard are all found even when the searcher takes none from the hand and library (701.23b: only a hidden zone may be left)', () => {
    const s0 = game();
    const s = resolveAll(cast(s0, 'Test Eradicate', { targets: [obj(idsOf(s0, 'Test Bear', 'battlefield', 'p2')[0]!)], objects: [] }), { objects: [] });
    expect(n(s, 'Test Bear', 'exile', 'p2')).toBe(3); // the target and both graveyard copies
    expect(n(s, 'Test Bear', 'graveyard', 'p2')).toBe(0);
    expect(n(s, 'Test Bear', 'hand', 'p2')).toBe(1); // a hidden zone: the searcher may leave it
    expect(n(s, 'Test Bear', 'library', 'p2')).toBe(1);
  });
  it('the copies in the hand and the library are exiled when the searcher finds them', () => {
    const s0 = game();
    const pick = [...idsOf(s0, 'Test Bear', 'hand', 'p2'), ...idsOf(s0, 'Test Bear', 'library', 'p2')];
    const s = resolveAll(cast(s0, 'Test Eradicate', { targets: [obj(idsOf(s0, 'Test Bear', 'battlefield', 'p2')[0]!)], objects: pick }), { objects: pick });
    expect(n(s, 'Test Bear', 'exile', 'p2')).toBe(5);
    expect(n(s, 'Test Bear', 'hand', 'p2') + n(s, 'Test Bear', 'library', 'p2') + n(s, 'Test Bear', 'graveyard', 'p2')).toBe(0);
  });
  it('negative: a card with another name stays where it is', () => {
    const s0 = game();
    const s = resolveAll(cast(s0, 'Test Eradicate', { targets: [obj(idsOf(s0, 'Test Bear', 'battlefield', 'p2')[0]!)], objects: [] }));
    expect(n(s, 'Test Cub', 'graveyard', 'p2')).toBe(1);
    expect(n(s, 'Test Cub', 'exile', 'p2')).toBe(0);
  });
});

describe('CR 118.12, 701.21a: "At the beginning of the upkeep of enchanted creature\'s controller, that player sacrifices that creature unless they pay {2}." (Slow Motion)', () => {
  const game = () => mpScenario({
    players: 3, defs: DEFS,
    zones: { p1: { hand: ['Test Slowdown'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Plains', 'Plains'] } },
  });
  const atUpkeep = (): { s: GameState; bear: ObjectId } => {
    const s0 = game();
    const bear = idsOf(s0, 'Test Bear', 'battlefield', 'p2')[0]!;
    let s = resolveAll(cast(s0, 'Test Slowdown', { targets: [obj(bear)] }));
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && x.zones.stack.length > 0, "the enchanted creature's controller's upkeep");
    return { s, bear };
  };
  it('declining the payment: the enchanted creature is sacrificed (and only that one)', () => {
    const { s: s0 } = atUpkeep();
    const s = resolveAll(s0, { yes: false });
    expect(n(s, 'Test Bear', 'graveyard', 'p2')).toBe(1); // a card that left the battlefield is a new object (CR 400.7), so it is found by name
    expect(n(s, 'Test Bear', 'battlefield', 'p2')).toBe(1);
  });
  it('negative: paying {2} keeps the creature (the two lands are tapped for it)', () => {
    const { s: s0, bear } = atUpkeep();
    const s = resolveAll(s0, { yes: true });
    expect(s.objects[bear]!.zone).toBe('battlefield');
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.owner === 'p2' && s.defs[o.defId]?.name === 'Plains' && o.tapped).length).toBe(2);
  });
});

describe('CR 601.3, 101.2, 503.1: "Cast this spell only during an opponent\'s upkeep." (Festival)', () => {
  const game = () => mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Festival'] } } });
  it('it cannot be cast on its controller\'s own turn', () => {
    const s = game();
    expect(() => act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Festival', 'hand', 'p1') })).toThrow(/Action rejected/);
  });
  it('it can be cast in an opponent\'s upkeep, and not in that opponent\'s draw step', () => {
    let s = passUntil(game(), (x) => x.turn.number === 2 && x.turn.step === 'upkeep', "p2's upkeep");
    for (let i = 0; i < 4 && s.pending?.player !== 'p1'; i++) s = pass(s);
    expect(s.pending?.player).toBe('p1');
    const cast1 = resolveAll(cast(s, 'Test Festival'));
    expect(n(cast1, 'Test Festival', 'graveyard', 'p1')).toBe(1);
    const later = passUntil(game(), (x) => x.turn.number === 2 && x.turn.step === 'draw', "p2's draw step");
    let atDraw = later;
    for (let i = 0; i < 4 && atDraw.pending?.player !== 'p1'; i++) atDraw = pass(atDraw);
    expect(() => act(atDraw, { type: 'cast', player: 'p1', card: find(atDraw, 'Test Festival', 'hand', 'p1') })).toThrow(/Action rejected/);
  });
});

describe('CR 205.3m, 604.3, 702.73a: "~ is every creature type." (Mistform Ultimus)', () => {
  const game = () => mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Illusion'], battlefield: ['Test Bear'] } } });
  it('it has every creature type on the battlefield and in the hand (a characteristic-defining ability works in every zone)', () => {
    const s0 = game();
    const inHand = getChars(s0, idsOf(s0, 'Test Illusion', 'hand', 'p1')[0]!)!;
    expect(inHand.subtypes).toEqual(expect.arrayContaining(['Elf', 'Goblin', 'Human']));
    const s = resolveAll(cast(s0, 'Test Illusion'));
    const onBf = getChars(s, idsOf(s, 'Test Illusion', 'battlefield', 'p1')[0]!)!;
    expect(onBf.subtypes).toEqual(expect.arrayContaining(['Elf', 'Goblin', 'Human']));
  });
  it('negative: another creature does not gain the types', () => {
    const s = game();
    expect(getChars(s, idsOf(s, 'Test Bear', 'battlefield', 'p1')[0]!)!.subtypes).not.toContain('Elf');
  });
});

describe('CR 701.20a, 701.9a: "Target player reveals their hand and discards all nonland cards." (Amnesia)', () => {
  const game = () => mpScenario({
    players: 3, defs: DEFS,
    zones: { p1: { hand: ['Test Amnesia', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Plains', 'Test Big Spell', 'Plains'] } },
  });
  it('every nonland card of the target player\'s hand is discarded; the lands stay', () => {
    const s0 = game();
    const s = resolveAll(cast(s0, 'Test Amnesia', { targets: [plr('p2')] }));
    expect(n(s, 'Test Bear', 'graveyard', 'p2')).toBe(1);
    expect(n(s, 'Test Big Spell', 'graveyard', 'p2')).toBe(1);
    expect(n(s, 'Plains', 'hand', 'p2')).toBe(2);
    expect(n(s, 'Plains', 'graveyard', 'p2')).toBe(0);
  });
  it('negative: the caster\'s own hand is untouched', () => {
    const s0 = game();
    const s = resolveAll(cast(s0, 'Test Amnesia', { targets: [plr('p2')] }));
    expect(n(s, 'Test Bear', 'hand', 'p1')).toBe(1);
  });
});

describe('CR 701.9a, 202.3, 608.2h: "target player discards a card. ~ deals damage to that player equal to that card\'s mana value." (Hellhole Rats)', () => {
  const game = (hand: string[]) => mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Rats'] }, p2: { hand } } });
  it('the damage equals the mana value of the card discarded (3 for {2}{R})', () => {
    const s0 = game(['Test Big Spell']);
    const s = resolveAll(cast(s0, 'Test Rats', {}), { targets: [plr('p2')], objects: [] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
    expect(n(s, 'Test Big Spell', 'graveyard', 'p2')).toBe(1);
  });
  it('negative: a land has mana value 0 and an empty hand discards nothing: no damage', () => {
    const s0 = game(['Plains']);
    const s = resolveAll(cast(s0, 'Test Rats', {}), { targets: [plr('p2')], objects: [] });
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
    const e0 = game([]);
    const e = resolveAll(cast(e0, 'Test Rats', {}), { targets: [plr('p2')], objects: [] });
    expect(lifeOf(e, 'p2')).toBe(lifeOf(e0, 'p2'));
  });
});
