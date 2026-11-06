/**
 * Commander lane edh-c, round edh-c-95 (EDHREC ranks 24,001-24,500, third pass): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 120.3, 614.15, 110.4       "~ deals 2 damage to target creature. If it's an artifact creature, ~ deals 4 damage to it instead." (Electrostatic Bolt)
 *   CR 508.1, 120.3, 614.15       "... deals 1 damage to target creature. If that creature is a Zombie, ~ deals 2 damage to it instead." (Purifying Dragon)
 *   CR 122.1, 122.5, 115.3        "Move a +1/+1 counter from target creature onto a second target creature." (Daghatar the Adamant)
 *   CR 119.3, 601.2h, 608.2c      "You gain X life if {G} was spent to cast ~ and X life if {W} was spent to cast ~." (Dawnglow Infusion)
 *   CR 702.82b, 604.1             "~ has flying and trample if it devoured a creature." (Hellkite Hatchling)
 *   CR 303.4, 400.3, 608.2c       "return enchanted creature and all Auras attached to that creature to their owners' hands" (Mark of Eviction)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, reject } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: (ObjectId | PlayerId)[]; yes?: boolean; option?: string; noObjects?: boolean; x?: number } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => (id.startsWith('p') && !id.startsWith('o') ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) } as never);
    else if (p.kind === 'chooseOption') {
      const pick = o.option !== undefined ? p.options.filter((x) => x.label === o.option || x.id === o.option) : p.options.slice(0, p.min);
      s = answer(s, { kind: 'chooseOption', ids: pick.map((x) => x.id) });
    }
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.noObjects === true ? [] : p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const castBy = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never);
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState => resolveAll(drive(castBy(s, name, player), o), o);
const activate = (s: GameState, source: ObjectId, ability: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState =>
  resolveAll(drive(act(s, { type: 'activate', player, source, ability } as never), o), o);
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onBf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (p === undefined || s.objects[id]!.controller === p));
const inGy = (s: GameState, name: string): number => Object.values(s.objects).filter((o) => o.zone === 'graveyard' && s.defs[o.defId]?.name === name).length;
const energy = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const subtypes = (s: GameState, id: ObjectId): string => [...chars(s, id).subtypes].sort().join(' ');

/** Pass priority (answering decisions) until the next declare-attackers decision. */
function toAttackers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 120 && s.pending?.kind !== 'declareAttackers'; i++) {
    if (s.result) throw new Error('The game ended');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  expect(s.pending?.kind).toBe('declareAttackers');
  return s;
}
const declareAction = (s: GameState, attacks: [ObjectId, PlayerId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) } });
const declare = (s: GameState, attacks: [ObjectId, PlayerId][]): GameState => act(s, declareAction(s, attacks) as never);
function toBlockers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 80 && s.pending?.kind !== 'declareBlockers'; i++) {
    if (s.turn.step === 'main2') throw new Error('No declare blockers decision came');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  return s;
}
/** Pass until `done`, declaring no blocks and no attackers when asked. */
function runUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 400): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  throw new Error(`Never reached ${what}`);
}


const hasKw = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const withCounters = (name: string, n: number) => (s: GameState): void => { for (const o of Object.values(s.objects)) if (s.defs[o.defId]?.name === name) o.counters['+1/+1'] = n; };

const BOLT = card('Test Spark', 'Instant', "~ deals 2 damage to target creature. If it's an artifact creature, ~ deals 4 damage to it instead.");
const WALL = card('Test Plain Wall', 'Creature — Wall', '', { pt: ['0', '9'] });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['0', '9'] });
const DRAGON = card('Test Zombie Slayer', 'Creature — Dragon', 'Flying\nWhenever this creature attacks, it deals 1 damage to target creature defending player controls. If that creature is a Zombie, ~ deals 2 damage to it instead.', { pt: ['2', '2'] });
const ZOMBIE = card('Test Zombie', 'Creature — Zombie', '', { pt: ['0', '9'] });
const MOVER = card('Test Mover', 'Creature — Human', '{0}: Move a +1/+1 counter from target creature onto a second target creature.', { pt: ['1', '1'] });
const INFUSION = card('Test Infusion', 'Sorcery', 'You gain X life if {G} was spent to cast ~ and X life if {W} was spent to cast ~.', { cost: '{X}{G/W}' });
const PRIDE = card('Test Pridemate', 'Creature — Cat', 'Whenever you gain life, put a +1/+1 counter on this creature.', { pt: ['2', '2'] });
const FOREST = card('Test Forest', 'Basic Land — Forest', '');
const PLAINS = card('Test Plains', 'Basic Land — Plains', '');
const HATCH = card('Test Hatchling', 'Creature — Dragon', 'Devour 1\nThis creature has flying and trample if it devoured a creature.', { pt: ['2', '2'] });
const FODDER = card('Test Fodder', 'Creature — Goblin', '', { pt: ['1', '1'] });
const MARK = card('Test Mark', 'Enchantment — Aura', "Enchant creature\nAt the beginning of your upkeep, return enchanted creature and all Auras attached to that creature to their owners' hands.");
const OTHERAURA = card('Test Other Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [BOLT, WALL, GOLEM, DRAGON, ZOMBIE, MOVER, INFUSION, PRIDE, HATCH, FODDER, MARK, OTHERAURA]) expect(noManual(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Electrostatic Bolt', 'Purifying Dragon', 'Daghatar the Adamant', 'Dawnglow Infusion', 'Hellkite Hatchling', 'Mark of Eviction'])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 120.3, 614.15, 110.4: "If it\'s an artifact creature, ~ deals 4 damage to it instead." (Electrostatic Bolt)', () => {
  const game = () => mpScenario({ players: 3, defs: [BOLT, WALL, GOLEM], zones: { p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Plain Wall', 'Test Golem'] } } });
  it('an artifact creature is dealt 4 damage, not 2 and not 6', () => {
    const s0 = game();
    const golem = onBf(s0, 'Test Golem')[0]!;
    expect(dmg(cast(s0, 'Test Spark', { targets: [golem] }), golem)).toBe(4);
  });
  it('negative: a creature that is not an artifact is dealt 2 damage', () => {
    const s0 = game();
    const wall = onBf(s0, 'Test Plain Wall')[0]!;
    expect(dmg(cast(s0, 'Test Spark', { targets: [wall] }), wall)).toBe(2);
  });
});

describe('CR 508.1, 120.3, 614.15: "If that creature is a Zombie, ~ deals 2 damage to it instead." (Purifying Dragon)', () => {
  const game = () => mpScenario({ players: 3, defs: [DRAGON, WALL, ZOMBIE], zones: { p1: { battlefield: [{ name: 'Test Zombie Slayer', since: -1 }] }, p2: { battlefield: ['Test Plain Wall', 'Test Zombie'] } } });
  const attack = (target: string): { s: GameState; id: ObjectId } => {
    const s0 = game();
    const id = onBf(s0, target)[0]!;
    const s = resolveAll(declare(toAttackers(s0), [[onBf(s0, 'Test Zombie Slayer')[0]!, 'p2']]), { targets: [id] });
    return { s, id };
  };
  it('a Zombie is dealt 2 damage by the attack trigger', () => {
    const { s, id } = attack('Test Zombie');
    expect(dmg(s, id)).toBe(2);
  });
  it('negative: another creature is dealt 1 damage', () => {
    const { s, id } = attack('Test Plain Wall');
    expect(dmg(s, id)).toBe(1);
  });
});

describe('CR 122.1, 122.5, 115.3: "Move a +1/+1 counter from target creature onto a second target creature." (Daghatar the Adamant)', () => {
  const game = () => mpScenario({ players: 3, defs: [MOVER, WALL, ZOMBIE], zones: { p1: { battlefield: [{ name: 'Test Mover', since: -1 }] }, p2: { battlefield: ['Test Plain Wall', 'Test Zombie'] } }, setup: withCounters('Test Plain Wall', 2) });
  it('one counter leaves the first target and lands on the second', () => {
    const s0 = game();
    const [wall, zombie] = [onBf(s0, 'Test Plain Wall')[0]!, onBf(s0, 'Test Zombie')[0]!];
    const s = activate(s0, onBf(s0, 'Test Mover')[0]!, 'p:0:0', { targets: [wall, zombie] });
    expect(counters(s, wall)).toBe(1);
    expect(counters(s, zombie)).toBe(1);
  });
  it('ruling 2014-11-24: the two targets must be different creatures (choosing the same one twice is refused)', () => {
    const s0 = game();
    const wall = onBf(s0, 'Test Plain Wall')[0]!;
    const s1 = act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'Test Mover')[0]!, ability: 'p:0:0' } as never);
    const first = answer(s1, { kind: 'chooseTargets', targets: [{ kind: 'object', id: wall }] });
    expect(first.pending?.kind).toBe('chooseTargets'); // the second target is still asked for
    reject(first, { type: 'answer', player: 'p1', decisionId: first.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: wall }] } } as never);
  });
  it('negative: a first target with no counter moves nothing (no counter appears on the second)', () => {
    const s0 = game();
    const [wall, zombie] = [onBf(s0, 'Test Plain Wall')[0]!, onBf(s0, 'Test Zombie')[0]!];
    const s = activate(s0, onBf(s0, 'Test Mover')[0]!, 'p:0:0', { targets: [zombie, wall] });
    expect(counters(s, wall)).toBe(2);
    expect(counters(s, zombie)).toBe(0);
  });
});

describe('CR 119.3, 601.2h, 608.2c: "You gain X life if {G} was spent ... and X life if {W} was spent ..." (Dawnglow Infusion)', () => {
  const game = (lands: string[]) => mpScenario({ players: 3, defs: [INFUSION, FOREST, PLAINS, PRIDE], zones: { p1: { hand: ['Test Infusion'], battlefield: [...lands, 'Test Pridemate'] } } });
  it('green and white mana both spent: X life twice', () => {
    const s0 = game(['Test Forest', 'Test Plains']);
    const s = cast(s0, 'Test Infusion', { x: 1 });
    expect(life(s, 'p1')).toBe(22);
    expect(counters(s, onBf(s, 'Test Pridemate')[0]!)).toBe(1); // ruling 2008-05-01: one life gain, "whenever you gain life" triggers once
  });
  it('negative: only green mana spent: X life once', () => {
    const s0 = game(['Test Forest', 'Test Forest']);
    { const s = cast(s0, 'Test Infusion', { x: 1 }); expect(life(s, 'p1')).toBe(21); expect(counters(s, onBf(s, 'Test Pridemate')[0]!)).toBe(1); }
  });
  it('negative: only white mana spent: X life once', () => {
    const s0 = game(['Test Plains', 'Test Plains']);
    { const s = cast(s0, 'Test Infusion', { x: 1 }); expect(life(s, 'p1')).toBe(21); expect(counters(s, onBf(s, 'Test Pridemate')[0]!)).toBe(1); }
  });
});

describe('CR 702.82b, 604.1: "~ has flying and trample if it devoured a creature." (Hellkite Hatchling)', () => {
  const game = () => mpScenario({ players: 3, defs: [HATCH, FODDER], zones: { p1: { hand: ['Test Hatchling'], battlefield: ['Test Fodder'] } } });
  it('after devouring a creature it has flying and trample', () => {
    const s = cast(game(), 'Test Hatchling');
    const h = onBf(s, 'Test Hatchling')[0]!;
    expect(onBf(s, 'Test Fodder').length).toBe(0);
    expect(hasKw(s, h, 'flying')).toBe(true);
    expect(hasKw(s, h, 'trample')).toBe(true);
    expect(counters(s, h)).toBe(1);
  });
  it('negative: having devoured nothing it has neither', () => {
    const s = cast(game(), 'Test Hatchling', { noObjects: true });
    const h = onBf(s, 'Test Hatchling')[0]!;
    expect(onBf(s, 'Test Fodder').length).toBe(1);
    expect(hasKw(s, h, 'flying')).toBe(false);
    expect(hasKw(s, h, 'trample')).toBe(false);
  });
});

describe('CR 303.4, 400.3, 608.2c: "return enchanted creature and all Auras attached to that creature to their owners\' hands" (Mark of Eviction)', () => {
  const game = () => mpScenario({
    players: 3, defs: [MARK, OTHERAURA, WALL, ZOMBIE], zones: { p1: { battlefield: ['Test Mark'] }, p2: { battlefield: ['Test Plain Wall', 'Test Zombie', 'Test Other Aura', 'Test Other Aura'] } },
    setup: (s) => {
      const wall = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Plain Wall')!;
      const zombie = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Zombie')!;
      const auras = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Other Aura');
      Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Mark')!.attachedTo = wall.id;
      auras[0]!.attachedTo = wall.id;
      auras[1]!.attachedTo = zombie.id;
    },
  });
  it('at the next upkeep of its controller the creature and both Auras on it return to their owners hands; the other creature and its Aura stay', () => {
    const s0 = game();
    const s = runUntil(s0, (x) => x.turn.number >= 4 && onBf(x, 'Test Plain Wall').length === 0 && x.zones.stack.length === 0, "the return at Alice's next upkeep", 900);
    expect(s.turn.number).toBe(4);
    expect(onBf(s, 'Test Plain Wall').length).toBe(0);
    const names = s.zones.hand['p2']!.map((id) => chars(s, id).name);
    expect(names).toContain('Test Other Aura');
    expect(names).toContain('Test Plain Wall');
    expect(s.zones.hand['p1']!.map((id) => chars(s, id).name)).toContain('Test Mark');
    expect(onBf(s, 'Test Zombie').length).toBe(1);
    expect(onBf(s, 'Test Other Aura').length).toBe(1);
  });
});
