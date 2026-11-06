/**
 * Commander lane edh-c, round edh-c-80 (EDHREC ranks 21,001-21,500, third pass): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites are from memory
 * (unverified, see the round's record).
 *
 *   CR 509.1b, 611.2a, 120.3     "A creature dealt damage this way can't block this turn." (Ballista Wielder)
 *   CR 400.3, 107.1a, 608.2d     "Choose target player. Return half the creatures they control to their owner's hand, rounded up." (Split the Party)
 *   CR 615.1, 510.2, 303.4b      "Prevent all combat damage that would be dealt this turn except combat damage that would be dealt by enchanted creatures and enchantment creatures." (Inspire Awe)
 *   CR 115.1, 601.2c, 107.3a     "Prevent all combat damage X target creatures would deal this turn." (Serene Sunset)
 *   CR 609.7a, 615.1a, 115.1     "Prevent all damage that would be dealt to any target this turn by a source of your choice." (Shieldmage Advocate)
 *   CR 607.2a, 400.3, 110.2a     "When ~ leaves the battlefield, each player returns to the battlefield all cards they own exiled with it." (Parallax Tide)
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
function drive(s0: GameState, o: { targets?: (ObjectId | PlayerId)[]; yes?: boolean; option?: string; x?: number; pick?: ObjectId[]; all?: boolean } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, o.all === true ? targets.length : 1).map((id) => (id.startsWith('p') && !id.startsWith('o') ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) } as never);
    else if (p.kind === 'chooseOption') {
      const pick = o.option !== undefined ? p.options.filter((x) => x.label === o.option || x.id === o.option) : p.options.slice(0, p.min);
      s = answer(s, { kind: 'chooseOption', ids: pick.map((x) => x.id) });
    }
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick !== undefined ? o.pick.filter((id) => p.options.includes(id)).slice(0, p.max) : p.options.slice(0, p.max) });
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


const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const GOBLIN = card('Test Plain Goblin', 'Creature — Goblin', '', { pt: ['3', '3'], colors: ['R'] });
const BALLISTA = card('Test Ballista', 'Creature — Werewolf', '{0}: This creature deals 1 damage to any target. A creature dealt damage this way can\'t block this turn.', { pt: ['1', '1'] });
const SPLIT = card('Test Split', 'Sorcery', "Choose target player. Return half the creatures they control to their owner's hand, rounded up.");
const AWE = card('Test Awe', 'Instant', 'Prevent all combat damage that would be dealt this turn except combat damage that would be dealt by enchanted creatures and enchantment creatures.');
const AURA = card('Test Ribbon', 'Enchantment — Aura', 'Enchant creature');
const ENCH_CREATURE = card('Test Spirit', 'Enchantment Creature — Spirit', '', { pt: ['2', '2'], colors: ['W'] });
const SUNSET = card('Test Sunset', 'Instant', 'Prevent all combat damage X target creatures would deal this turn.', { cost: '{X}' });
const ADVOCATE = card('Test Advocate', 'Creature — Human Cleric', "{0}: Return target card from an opponent's graveyard to their hand. Prevent all damage that would be dealt to any target this turn by a source of your choice.", { pt: ['1', '1'] });
const ZAPPER = card('Test Zapper', 'Creature — Goblin', '{0}: This creature deals 1 damage to any target.', { pt: ['1', '1'] });
const TIDE = card('Test Tide', 'Enchantment', 'Remove a fade counter from this enchantment: Exile target land.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.');
const TIDE0 = card('Test Tide Zero', 'Enchantment', '{0}: Exile target land.\nWhen this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.');
const SMITE = card('Test Smite', 'Instant', 'Destroy target enchantment.');
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.');
const WASTES = card('Test Wastes', 'Land', '{T}: Add {C}.');
const FOREST = card('Test Forest', 'Land', '');
const MOUNTAIN = card('Test Mountain', 'Land', '');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [WASTES, BEAR, GOBLIN, BALLISTA, SPLIT, AWE, AURA, ENCH_CREATURE, SUNSET, ADVOCATE, ZAPPER, TIDE0, SMITE, BOLT]) expect(noManual(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Ballista Watcher // Ballista Wielder', 'Split the Party', 'Inspire Awe', 'Serene Sunset', 'Shieldmage Advocate', 'Parallax Tide'])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 509.1b, 611.2a: "A creature dealt damage this way can\'t block this turn." (Ballista Wielder)', () => {
  const game = () => mpScenario({ players: 3, defs: [BALLISTA, BEAR, GOBLIN], zones: { p1: { battlefield: [{ name: 'Test Ballista', since: -1 }, { name: 'Test Plain Goblin', since: -1 }] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] } } });
  it('the creature the ability damaged can not block this turn; the other creature of its controller can', () => {
    const s0 = game();
    const [bear1, bear2] = onBf(s0, 'Test Plain Bear');
    let s = activate(s0, onBf(s0, 'Test Ballista')[0]!, 'p:0:0', { targets: [bear1!] });
    expect(s.objects[bear1!]!.damage).toBe(1);
    s = toBlockers(declare(toAttackers(s), [[onBf(s, 'Test Plain Goblin')[0]!, 'p2']]));
    const gob = onBf(s, 'Test Plain Goblin')[0]!;
    reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: bear1!, attacker: gob }] } } as never);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: bear2!, attacker: gob }] });
    expect(s.pending?.kind === 'declareBlockers').toBe(false);
  });
  it('negative: the restriction ends with the turn it was made in', () => {
    const s0 = game();
    const [bear1] = onBf(s0, 'Test Plain Bear');
    const s = activate(s0, onBf(s0, 'Test Ballista')[0]!, 'p:0:0', { targets: [bear1!] });
    expect(JSON.stringify(s.continuousEffects)).toContain('"action":"block"'); // in force this turn
    const t = runUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1', 'the next turn');
    // the restriction was for the turn it was made: nothing in the next turn's state keeps the bear from blocking
    expect(JSON.stringify(t.continuousEffects)).not.toContain('"action":"block"');
  });
});

describe('CR 400.3, 107.1a, 608.2d: "Choose target player. Return half the creatures they control to their owner\'s hand, rounded up." (Split the Party)', () => {
  const bears = (n: number): string[] => Array.from({ length: n }, () => 'Test Plain Bear');
  const game = (n: number) => mpScenario({ players: 3, defs: [SPLIT, BEAR], zones: { p1: { hand: ['Test Split'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: bears(n) } } });
  it('three creatures: two (half, rounded up) return to their owner\'s hand; the caster\'s own creature and the other player stay', () => {
    const s = cast(game(3), 'Test Split', { targets: ['p2'] });
    expect(onBf(s, 'Test Plain Bear', 'p2').length).toBe(1);
    expect(hand(s, 'p2')).toBe(2);
    expect(onBf(s, 'Test Plain Bear', 'p1').length).toBe(1);
  });
  it('four creatures: two return (an even number is exactly half)', () => {
    const s = cast(game(4), 'Test Split', { targets: ['p2'] });
    expect(onBf(s, 'Test Plain Bear', 'p2').length).toBe(2);
    expect(hand(s, 'p2')).toBe(2);
  });
  it('negative: a player with no creatures loses none and nothing else changes; targeting yourself returns half of your own', () => {
    const s = cast(game(0), 'Test Split', { targets: ['p3'] });
    expect(onBf(s, 'Test Plain Bear').length).toBe(1);
    const own = cast(game(0), 'Test Split', { targets: ['p1'] });
    expect(onBf(own, 'Test Plain Bear', 'p1').length).toBe(0);
    expect(hand(own, 'p1')).toBe(hand(game(0), 'p1') - 1 + 1); // the spell leaves the hand, the bear comes back
  });
});

describe('CR 615.1, 510.2, 303.4b: "Prevent all combat damage that would be dealt this turn except combat damage that would be dealt by enchanted creatures and enchantment creatures." (Inspire Awe)', () => {
  const run = (attackers: string[], aura?: string) => {
    const s0 = mpScenario({ players: 3, defs: [AWE, AURA, BEAR, GOBLIN, ENCH_CREATURE, BOLT], zones: { p1: { hand: ['Test Awe', 'Test Ribbon'], battlefield: attackers.map((name) => ({ name, since: -1 })) } } });
    let s = s0;
    if (aura !== undefined) s = cast(s, 'Test Ribbon', { targets: [onBf(s, aura)[0]!] });
    s = cast(s, 'Test Awe');
    s = declare(toAttackers(s), attackers.map((n) => [onBf(s, n)[0]!, 'p2'] as [ObjectId, PlayerId]));
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    return life(s, 'p2');
  };
  it('the damage of an ordinary creature is prevented', () => expect(run(['Test Plain Bear'])).toBe(20));
  it('the damage of an enchanted creature is not (checked as it would be dealt)', () => expect(run(['Test Plain Bear'], 'Test Plain Bear')).toBe(18));
  it('the damage of an enchantment creature is not', () => expect(run(['Test Spirit'])).toBe(18));
  it('negative: damage that is not combat damage is not prevented', () => {
    const s0 = mpScenario({ players: 3, defs: [AWE, BOLT], zones: { p1: { hand: ['Test Awe', 'Test Bolt'] } } });
    const s = cast(cast(s0, 'Test Awe'), 'Test Bolt', { targets: ['p2'] });
    expect(life(s, 'p2')).toBe(17);
  });
  it('negative: of two attackers only the enchanted one deals its damage', () => expect(run(['Test Plain Bear', 'Test Plain Goblin'], 'Test Plain Goblin')).toBe(17));
});

describe('CR 115.1, 601.2c, 107.3a: "Prevent all combat damage X target creatures would deal this turn." (Serene Sunset)', () => {
  const run = (x: number, targetNames: string[]) => {
    const s0 = mpScenario({ players: 3, defs: [SUNSET, BEAR, GOBLIN, WASTES], zones: { p1: { hand: ['Test Sunset'], battlefield: ['Test Wastes', 'Test Wastes', { name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Goblin', since: -1 }] } } });
    let s = cast(s0, 'Test Sunset', { x, all: true, targets: targetNames.map((n) => onBf(s0, n)[0]!) });
    s = declare(toAttackers(s), ['Test Plain Bear', 'Test Plain Goblin'].map((n) => [onBf(s, n)[0]!, 'p2'] as [ObjectId, PlayerId]));
    s = runUntil(s, (y) => y.turn.step === 'main2', 'the second main phase');
    return life(s, 'p2');
  };
  it('X = 1: the one target creature deals no combat damage, the other does', () => expect(run(1, ['Test Plain Goblin'])).toBe(18));
  it('X = 2: both targets are prevented', () => expect(run(2, ['Test Plain Bear', 'Test Plain Goblin'])).toBe(20));
  it('negative: X = 0 targets nothing and prevents nothing', () => expect(run(0, [])).toBe(15));
});

describe('CR 609.7a, 615.1a, 115.1: "Prevent all damage that would be dealt to any target this turn by a source of your choice." (Shieldmage Advocate)', () => {
  const game = () => mpScenario({ players: 3, defs: [ADVOCATE, ZAPPER, BEAR, BOLT], zones: { p1: { battlefield: [{ name: 'Test Advocate', since: -1 }, { name: 'Test Zapper', since: -1 }] }, p2: { graveyard: ['Test Bolt'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] } } });
  const shield = (s0: GameState, who: ObjectId | PlayerId, source: ObjectId): GameState => {
    const bolt = Object.keys(s0.objects).find((id) => s0.objects[id]!.zone === 'graveyard' && s0.defs[s0.objects[id]!.defId]?.name === 'Test Bolt')!;
    return activate(s0, onBf(s0, 'Test Advocate')[0]!, 'p:0:0', { targets: [bolt, who], pick: [source] });
  };
  it('the chosen source\'s damage to the target is prevented this turn (a permanent target); the card returns to its owner\'s hand', () => {
    const s0 = game();
    const bear = onBf(s0, 'Test Plain Bear')[0]!;
    const zap = onBf(s0, 'Test Zapper')[0]!;
    let s = shield(s0, bear, zap);
    expect(hand(s, 'p2')).toBe(1);
    s = activate(s, zap, 'p:0:0', { targets: [bear] });
    expect(s.objects[bear]!.damage).toBe(0);
  });
  it('a player as the target: the chosen source\'s damage to that player is prevented, its damage to another player is not', () => {
    const s0 = game();
    const zap = onBf(s0, 'Test Zapper')[0]!;
    const s = shield(s0, 'p2', zap);
    expect(life(activate(s, zap, 'p:0:0', { targets: ['p2'] }), 'p2')).toBe(20);
    expect(life(activate(s, zap, 'p:0:0', { targets: ['p3'] }), 'p3')).toBe(19);
  });
  it('negative: the damage of another source, or to another target, is not prevented', () => {
    const s0 = game();
    const bear = onBf(s0, 'Test Plain Bear')[0]!;
    const zap = onBf(s0, 'Test Zapper')[0]!;
    const adv = onBf(s0, 'Test Advocate')[0]!;
    const s = shield(s0, bear, adv); // the chosen source is the Advocate, not the Zapper
    const t = activate(s, zap, 'p:0:0', { targets: [bear] });
    expect(t.objects[bear]!.damage).toBe(1);
    const u = shield(s0, onBf(s0, 'Test Plain Bear')[0]!, zap);
    const other = onBf(s0, 'Test Plain Bear')[1]!;
    const v = activate(u, zap, 'p:0:0', { targets: [other] }); // a different recipient
    expect(v.objects[other]!.damage).toBe(1);
  });
});

describe('CR 607.2a, 400.3, 110.2a: "When ~ leaves the battlefield, each player returns to the battlefield all cards they own exiled with it." (Parallax Tide)', () => {
  const game = () => mpScenario({ players: 3, defs: [TIDE0, SMITE, FOREST, MOUNTAIN], zones: { p1: { hand: ['Test Smite'], battlefield: ['Test Tide Zero', 'Test Forest'] }, p2: { battlefield: ['Test Mountain'] } } });
  it('each exiled land returns under its owner\'s control when the enchantment leaves; before that they stay exiled', () => {
    const s0 = game();
    const tide = onBf(s0, 'Test Tide Zero')[0]!;
    let s = activate(s0, tide, 'p:0:0', { targets: [onBf(s0, 'Test Forest')[0]!] });
    s = activate(s, tide, 'p:0:0', { targets: [onBf(s0, 'Test Mountain')[0]!] });
    expect(onBf(s, 'Test Forest').length + onBf(s, 'Test Mountain').length).toBe(0);
    s = cast(s, 'Test Smite', { targets: [tide] });
    expect(onBf(s, 'Test Forest', 'p1').length).toBe(1);
    expect(onBf(s, 'Test Mountain', 'p2').length).toBe(1);
  });
  it('negative: a land exiled by something else is not returned', () => {
    const s0 = mpScenario({ players: 3, defs: [TIDE0, SMITE, FOREST], zones: { p1: { hand: ['Test Smite'], battlefield: ['Test Tide Zero'], exile: ['Test Forest'] } } });
    const s = cast(s0, 'Test Smite', { targets: [onBf(s0, 'Test Tide Zero')[0]!] });
    expect(onBf(s, 'Test Forest').length).toBe(0);
  });
});
