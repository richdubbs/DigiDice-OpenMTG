/**
 * Commander lane edh-c, round edh-c-26 (EDHREC ranks 21,001-21,500): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against
 * the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 115.1, 101.2, 608.2b       "Creatures can't be the targets of spells." (Dense Foliage): a spell can't target a creature; an ability can
 *   CR 121.1, 119.3, 122.1, 107.14 "You draw two cards, lose 2 life, and get {E}{E}." (Live Fast)
 *   CR 509.1, 603.2, 701.8a        "When this creature blocks a creature, destroy that creature and this creature." (Loyal Sentry)
 *   CR 614.9, 120.3                "All damage that would be dealt to enchanted creature is dealt to its controller instead." (Treacherous Link)
 *   CR 205.3m, 608.2c, 701.8a      "Destroy all creatures of the creature type of your choice." (Extinction)
 *   CR 601.2f, 602.2b, 606.1       "Loyalty abilities of planeswalkers your opponents control cost {1} more to activate." (Eidolon of Obstruction)
 *   CR 508.1c, 604.1               "~ can't attack if there's another creature on the battlefield." (Shauku, Endbringer)
 *   CR 608.2c, 120.3, 109.5        "... deals 2 damage to that player unless they control two or more basic lands." (Furnace Punisher)
 *   CR 702.33d, 122.1b, 613.1f     "If ~ was kicked, it enters with two +1/+1 counters and a trample counter on it and with haste." (Voidpouncer)
 *   CR 205.1a, 613.1d, 613.4b      "During your turn, ~ is a Bear with base power and toughness 4/2." (Circle of the Moon Druid)
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
function drive(s0: GameState, o: { targets?: (ObjectId | PlayerId)[]; yes?: boolean; option?: string } = {}): GameState {
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
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
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

const DENSE = card('Test Dense Moss', 'Enchantment', "Creatures can't be the targets of spells.");
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.');
const ZAPPER = card('Test Zapper', 'Creature — Goblin', '{0}: This creature deals 1 damage to target creature.', { pt: ['1', '1'] });
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const GOBLIN = card('Test Plain Goblin', 'Creature — Goblin', '', { pt: ['2', '2'], colors: ['R'] });
const LIVE = card('Test Live Fast', 'Sorcery', 'You draw two cards, lose 2 life, and get {E}{E}.');
const SENTRY = card('Test Sentry', 'Creature — Human Soldier', 'When this creature blocks a creature, destroy that creature and this creature.', { pt: ['1', '1'] });
const LINK = card('Test Link', 'Enchantment — Aura', 'Enchant creature\nAll damage that would be dealt to enchanted creature is dealt to its controller instead.');
const EXT = card('Test Extinction', 'Sorcery', 'Destroy all creatures of the creature type of your choice.');
const EIDOLON = card('Test Eidolon', 'Creature — Spirit', 'Loyalty abilities of planeswalkers your opponents control cost {1} more to activate.', { pt: ['2', '2'] });
const WALKER = card('Test Walker', 'Planeswalker — Test', '+1: You gain 1 life.', { loyalty: '3' });
const SHAUKU = card('Test Shauku', 'Creature — Nightmare', "Flying\nThis creature can't attack if there's another creature on the battlefield.", { pt: ['3', '3'] });
const PUNISHER = card('Test Punisher', 'Creature — Phyrexian Warrior', "At the beginning of each player's upkeep, this creature deals 2 damage to that player unless they control two or more basic lands.", { pt: ['3', '3'] });
const POUNCER = card('Test Pouncer', 'Creature — Eldrazi', 'Kicker {0}\nIf this creature was kicked, it enters with two +1/+1 counters and a trample counter on it and with haste.', { pt: ['3', '1'] });
const DRUID = card('Test Moon Druid', 'Creature — Human Elf Druid', 'Bear Form — During your turn, this creature is a Bear with base power and toughness 4/2.', { pt: ['2', '4'] });

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [DENSE, BOLT, ZAPPER, BEAR, GOBLIN, LIVE, SENTRY, LINK, EXT, EIDOLON, WALKER, SHAUKU, PUNISHER, POUNCER, DRUID]) expect(noManual(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Dense Foliage', 'Live Fast', 'Loyal Sentry', 'Treacherous Link', 'Extinction', 'Eidolon of Obstruction', 'Shauku, Endbringer', 'Furnace Punisher', 'Voidpouncer', 'Circle of the Moon Druid'])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 115.1, 101.2: "Creatures can\'t be the targets of spells." (Dense Foliage)', () => {
  const game = () => mpScenario({ players: 3, defs: [DENSE, BOLT, ZAPPER, BEAR], zones: { p1: { hand: ['Test Bolt'], battlefield: ['Test Dense Moss', { name: 'Test Zapper', since: -1 }] }, p2: { battlefield: ['Test Plain Bear'] } } });
  it('a spell can not target a creature (the answer is refused) but can target a player', () => {
    const s0 = castBy(game(), 'Test Bolt');
    expect(s0.pending?.kind).toBe('chooseTargets');
    const bear = onBf(s0, 'Test Plain Bear')[0]!;
    reject(s0, { type: 'answer', player: 'p1', decisionId: s0.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } } as never);
    const s = resolveAll(s0, { targets: ['p2'] });
    expect(life(s, 'p2')).toBe(17);
  });
  it('negative: an ability can target a creature (the ban is for spells only)', () => {
    const s0 = game();
    const bear = onBf(s0, 'Test Plain Bear')[0]!;
    const s = activate(s0, onBf(s0, 'Test Zapper')[0]!, 'p:0:0', { targets: [bear] });
    expect(s.objects[bear]!.damage).toBe(1);
  });
  it('negative: without the enchantment a spell can target a creature', () => {
    const s0 = mpScenario({ players: 3, defs: [BOLT, BEAR], zones: { p1: { hand: ['Test Bolt'] }, p2: { battlefield: ['Test Plain Bear'] } } });
    const s = cast(s0, 'Test Bolt', { targets: [onBf(s0, 'Test Plain Bear')[0]!] });
    expect(inGy(s, 'Test Plain Bear')).toBe(1);
  });
});

describe('CR 121.1, 119.3, 122.1, 107.14: "You draw two cards, lose 2 life, and get {E}{E}." (Live Fast)', () => {
  it('its controller draws two cards, loses 2 life and gets two energy counters; nobody else is touched', () => {
    const s0 = mpScenario({ players: 3, defs: [LIVE], zones: { p1: { hand: ['Test Live Fast'] } } });
    const s = cast(s0, 'Test Live Fast');
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1 + 2); // the spell leaves the hand, two cards are drawn
    expect(life(s, 'p1')).toBe(18);
    expect(energy(s, 'p1')).toBe(2);
    expect(life(s, 'p2')).toBe(20);
    expect(hand(s, 'p2')).toBe(0);
    expect(energy(s, 'p2')).toBe(0);
  });
});

describe('CR 509.1, 603.2, 701.8a: "When this creature blocks a creature, destroy that creature and this creature." (Loyal Sentry)', () => {
  const game = () => mpScenario({ players: 3, defs: [SENTRY, BEAR, BOLT], zones: { p1: { hand: ['Test Bolt'], battlefield: [{ name: 'Test Plain Bear', since: -1 }] }, p2: { battlefield: [{ name: 'Test Sentry', since: -1 }] } } });
  const toBlock = (s: GameState): GameState => toBlockers(declare(toAttackers(s), [[onBf(s, 'Test Plain Bear')[0]!, 'p2']]));
  it('blocking destroys the blocked creature and the Sentry before damage', () => {
    const s0 = game();
    let s = toBlock(s0);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: onBf(s0, 'Test Sentry')[0]!, attacker: onBf(s0, 'Test Plain Bear')[0]! }] });
    s = resolveAll(s);
    expect(inGy(s, 'Test Sentry')).toBe(1);
    expect(inGy(s, 'Test Plain Bear')).toBe(1);
    expect(life(s, 'p2')).toBe(20); // blocked, no damage to the player
  });
  it('ruling 2018-03-16: the blocked creature is destroyed even if the Sentry left the battlefield before the trigger resolved', () => {
    const s0 = game();
    let s = toBlock(s0);
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: onBf(s0, 'Test Sentry')[0]!, attacker: onBf(s0, 'Test Plain Bear')[0]! }] });
    expect(s.zones.stack.length).toBe(1); // the trigger
    s = resolveAll(castBy(s, 'Test Bolt'), { targets: [onBf(s0, 'Test Sentry')[0]!] }); // p1 kills the Sentry in response
    expect(inGy(s, 'Test Sentry')).toBe(1);
    expect(inGy(s, 'Test Plain Bear')).toBe(1);
  });
  it('negative: unblocked, nothing is destroyed and the attacker hits', () => {
    let s = toBlock(game());
    s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(inGy(s, 'Test Sentry') + inGy(s, 'Test Plain Bear')).toBe(0);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 614.9, 120.3: "All damage that would be dealt to enchanted creature is dealt to its controller instead." (Treacherous Link)', () => {
  const game = (enchant: 'Test Plain Bear' | 'Test Plain Goblin') => mpScenario({
    players: 3, defs: [LINK, BEAR, GOBLIN, BOLT], zones: { p1: { hand: ['Test Bolt'], battlefield: ['Test Link'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Goblin'] } },
    setup: (s) => {
      const link = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Link')!;
      const target = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === enchant)!;
      link.attachedTo = target.id;
    },
  });
  it('damage to the enchanted creature goes to its controller (not the Aura\'s controller) and the creature takes none', () => {
    const s0 = game('Test Plain Bear');
    const bear = onBf(s0, 'Test Plain Bear')[0]!;
    const s = cast(s0, 'Test Bolt', { targets: [bear] });
    expect(s.objects[bear]!.damage).toBe(0);
    expect(inGy(s, 'Test Plain Bear')).toBe(0);
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative: an unenchanted creature takes the damage itself and its controller loses nothing', () => {
    const s0 = game('Test Plain Bear');
    const s = cast(s0, 'Test Bolt', { targets: [onBf(s0, 'Test Plain Goblin')[0]!] });
    expect(inGy(s, 'Test Plain Goblin')).toBe(1);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 205.3m, 608.2c, 701.8a: "Destroy all creatures of the creature type of your choice." (Extinction)', () => {
  const game = () => mpScenario({ players: 3, defs: [EXT, BEAR, GOBLIN], zones: { p1: { hand: ['Test Extinction'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Goblin'] }, p3: { battlefield: ['Test Plain Goblin'] } } });
  it('every creature of the chosen type is destroyed, whoever controls it; creatures of other types stay', () => {
    let s = drive(castBy(game(), 'Test Extinction'));
    for (let i = 0; i < 6 && s.pending?.kind === 'priority'; i++) s = pass(s); // the spell resolves: its controller names a creature type
    expect(s.pending?.kind).toBe('chooseName');
    s = answer(s, { kind: 'chooseName', name: 'Bear' } as never);
    s = resolveAll(s);
    expect(onBf(s, 'Test Plain Bear').length).toBe(0);
    expect(inGy(s, 'Test Plain Bear')).toBe(2);
    expect(onBf(s, 'Test Plain Goblin').length).toBe(2);
  });
});

describe('CR 601.2f, 602.2b, 606.1: "Loyalty abilities of planeswalkers your opponents control cost {1} more to activate." (Eidolon of Obstruction)', () => {
  const game = (eidolonOwner: PlayerId) => mpScenario({
    players: 3, defs: [EIDOLON, WALKER], cards: ['Plains'],
    zones: eidolonOwner === 'p1'
      ? { p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }, { name: 'Plains', since: -1 }, { name: 'Test Eidolon', since: -1 }] } }
      : { p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }, { name: 'Plains', since: -1 }] }, p2: { battlefield: [{ name: 'Test Eidolon', since: -1 }] } },
  });
  it('an opponent\'s Eidolon makes the loyalty ability cost {1}: it is activated by tapping a land, and the land is tapped', () => {
    const s0 = game('p2');
    const walker = onBf(s0, 'Test Walker')[0]!;
    const s = activate(s0, walker, 'p:0:0');
    expect(life(s, 'p1')).toBe(21);
    expect(s.objects[onBf(s0, 'Plains')[0]!]!.tapped).toBe(true);
  });
  it('negative: your own Eidolon does not tax your planeswalker (the land stays untapped)', () => {
    const s0 = game('p1');
    const s = activate(s0, onBf(s0, 'Test Walker')[0]!, 'p:0:0');
    expect(life(s, 'p1')).toBe(21);
    expect(s.objects[onBf(s0, 'Plains')[0]!]!.tapped).toBe(false);
  });
});

describe('CR 508.1c, 604.1: "~ can\'t attack if there\'s another creature on the battlefield." (Shauku, Endbringer)', () => {
  it('with another creature on the battlefield (any controller) the attack is refused', () => {
    const s0 = mpScenario({ players: 3, defs: [SHAUKU, BEAR], zones: { p1: { battlefield: [{ name: 'Test Shauku', since: -1 }] }, p3: { battlefield: ['Test Plain Bear'] } } });
    const s = toAttackers(s0);
    reject(s, declareAction(s, [[onBf(s0, 'Test Shauku')[0]!, 'p2']]) as never);
    const none = declare(s, []);
    expect(none.pending?.kind === 'declareAttackers').toBe(false);
  });
  it('negative: creature cards in graveyards, hands and libraries are not on the battlefield and do not stop it', () => {
    const s0 = mpScenario({ players: 3, defs: [SHAUKU, BEAR], zones: { p1: { battlefield: [{ name: 'Test Shauku', since: -1 }], graveyard: ['Test Plain Bear'] }, p2: { hand: ['Test Plain Bear'] } } });
    let s = declare(toAttackers(s0), [[onBf(s0, 'Test Shauku')[0]!, 'p2']]);
    s = runUntil(s, (x) => x.turn.step === 'main2' || x.turn.step === 'end', 'the end of combat');
    expect(life(s, 'p2')).toBe(17);
  });
  it('alone on the battlefield it attacks', () => {
    const s0 = mpScenario({ players: 3, defs: [SHAUKU], zones: { p1: { battlefield: [{ name: 'Test Shauku', since: -1 }] } } });
    let s = declare(toAttackers(s0), [[onBf(s0, 'Test Shauku')[0]!, 'p2']]);
    s = runUntil(s, (x) => x.turn.step === 'main2' || x.turn.step === 'end', 'the end of combat');
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('CR 608.2c, 120.3, 109.5: "At the beginning of each player\'s upkeep, ~ deals 2 damage to that player unless they control two or more basic lands." (Furnace Punisher)', () => {
  it('a player with one basic land takes 2 at their upkeep; a player with two does not', () => {
    const s0 = mpScenario({ players: 3, defs: [PUNISHER], zones: { p1: { battlefield: ['Test Punisher', 'Plains', 'Plains'] }, p2: { battlefield: ['Plains'] }, p3: { battlefield: ['Plains', 'Plains'] } } });
    // turn 1 (p1's own upkeep is already past), turn 2 is p2's, turn 3 is p3's
    const s2 = runUntil(s0, (x) => x.turn.number === 2 && x.turn.step === 'draw', "p2's draw step");
    expect(life(s2, 'p2')).toBe(18);
    const s3 = runUntil(s2, (x) => x.turn.number === 3 && x.turn.step === 'draw', "p3's draw step");
    expect(life(s3, 'p3')).toBe(20);
    expect(life(s3, 'p1')).toBe(20);
  });
});

describe('CR 702.33d, 122.1b, 613.1f: "If ~ was kicked, it enters with two +1/+1 counters and a trample counter on it and with haste." (Voidpouncer)', () => {
  const game = () => mpScenario({ players: 3, defs: [POUNCER], zones: { p1: { hand: ['Test Pouncer'] } } });
  it('kicked: 5/3 with trample (the counter) and haste; unkicked: a plain 3/1 with neither', () => {
    const s0 = game();
    const kicked = resolveAll(drive(castBy(s0, 'Test Pouncer'), { yes: true }), { yes: true });
    const id = onBf(kicked, 'Test Pouncer')[0]!;
    expect(stat(kicked, id)).toBe('5/3');
    expect(kicked.objects[id]!.counters['trample']).toBe(1);
    const kw = chars(kicked, id).keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword));
    expect(kw).toContain('trample');
    expect(kw).toContain('haste');
    const plain = resolveAll(drive(castBy(s0, 'Test Pouncer'), { yes: false }), { yes: false });
    const id2 = onBf(plain, 'Test Pouncer')[0]!;
    expect(stat(plain, id2)).toBe('3/1');
    expect(plain.objects[id2]!.counters['trample'] ?? 0).toBe(0);
    const kw2 = chars(plain, id2).keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword));
    expect(kw2).not.toContain('haste');
    expect(kw2).not.toContain('trample');
  });
});

describe('CR 205.1a, 613.1d, 613.4b: "During your turn, ~ is a Bear with base power and toughness 4/2." (Circle of the Moon Druid)', () => {
  it('on its controller\'s turn it is a 4/2 Bear (its other creature types are gone); on another player\'s turn it is the 2/4 Human Elf Druid', () => {
    const s0 = mpScenario({ players: 3, defs: [DRUID], zones: { p1: { battlefield: ['Test Moon Druid'] } } });
    const id = onBf(s0, 'Test Moon Druid')[0]!;
    expect(stat(s0, id)).toBe('4/2');
    expect(subtypes(s0, id)).toBe('Bear');
    const s2 = runUntil(s0, (x) => x.turn.number === 2 && x.turn.step === 'main1', "p2's main phase");
    expect(stat(s2, id)).toBe('2/4');
    expect(subtypes(s2, id)).toBe('Druid Elf Human');
  });
});
