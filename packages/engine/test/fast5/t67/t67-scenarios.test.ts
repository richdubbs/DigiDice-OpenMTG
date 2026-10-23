/**
 * FAST5 T67 (counted token creation, emblems, "Choose a creature type." riders): the templates of parser/templates/zz-fast5/t67.json, the in-ability link
 * pass (parser/lower/links.ts), the count window of the anaphora pass and the renderer support they needed, played through the engine with synthetic cards
 * compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 111.1, 608.2h, 201.5     "Whenever ~ enters or attacks, create a number of ... tokens equal to its power": the object itself, its power as the step runs
 *   CR 111.1, 107.3, 111.10a    "For each land you control, create a Treasure token": one creation of the counted number of tokens
 *   CR 110.5b, 111.1            "Create a tapped 2/2 ... token for each multicolored permanent you control"
 *   CR 122.1, 608.2h            "... for each counter on ~" after ~ was sacrificed to pay the cost: its counters as it last existed
 *   CR 608.2c, 608.2d, 205.3m   "Choose a creature type. Create a Treasure token for each creature you control of that type." / "of the chosen type"
 *   CR 608.2c, 611.2c           "Then if you control five or more Rats, each Rat you control gets +2/+0 until end of turn."
 *   CR 114.1-114.4, 702.40a     "You get an emblem with \"...\"": the emblem's triggered and static abilities work from the command zone
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { maxHandSize } from '../../../src/statics/hooks';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests: an experimental template caps it, design 6.9). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const tokens = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const subtypeTokens = (s: GameState, p: PlayerId, sub: string): ObjectId[] => tokens(s, p).filter((id) => getChars(s, id)!.subtypes.includes(sub));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

/** Answer the decisions that come up (payments automatic, the creature type `names` in order); stop at priority. */
function drive(s0: GameState, names: string[] = []): GameState {
  let s = s0;
  const q = [...names];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: q.shift() ?? 'Goblin' });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, names?: string[]): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), names);
  return s;
}
const cast = (s: GameState, name: string, names?: string[]): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') })), names);

const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const GOBLIN_CARD = card('Test Goblin Scout', 'Creature — Goblin Scout', '', { pt: ['2', '1'] });
const RAT = card('Test Rat', 'Creature — Rat', '', { pt: ['1', '1'] });
const SHRINE = card('Test Shrine', 'Enchantment — Shrine', '');
const GOLD = card('Test Gold Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{W}{U}', colors: ['W', 'U'] });
const MONO = card('Test Mono Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{W}', colors: ['W'] });
const DRAW = card('Test Sorcery', 'Sorcery', 'Draw a card.');
const PEEK = card('Test Instant', 'Instant', 'Draw a card.');
const BASE = [GOBLIN, ELF, GOBLIN_CARD, RAT, SHRINE, GOLD, MONO, DRAW, PEEK];

describe('CR 111.1, 608.2h, 201.5: "Whenever ~ enters or attacks, create a number of 1/1 colorless Gnome artifact creature tokens equal to its power."', () => {
  const HULK = card('Test Hulk', 'Artifact Creature — Construct', 'This creature enters with three +1/+1 counters on it.\nWhenever this creature enters or attacks, create a number of 1/1 colorless Gnome artifact creature tokens equal to its power.', { pt: ['0', '0'] });

  it('is understood: "its" is the object itself, in the count of the first instruction (lower/anaphora.ts#countWindow)', () => {
    expect(noManual(HULK)).toBe(true);
    const steps = JSON.stringify(HULK.faces[0]!.abilities[1]);
    expect(steps).toContain('"count":{"q":"stat","stat":"power","of":{"ref":"self"}}');
  });

  it('CR 111.1, 608.2h: it enters with three counters, so its power is 3 as the trigger resolves: three Gnomes, created at once', () => {
    const s = cast(scenario([], { defs: [HULK, ...BASE], p1: { hand: ['Test Hulk'] } }), 'Test Hulk');
    expect(subtypeTokens(s, 'p1', 'Gnome')).toHaveLength(3);
    for (const id of subtypeTokens(s, 'p1', 'Gnome')) expect(pt(s, id)).toBe('1/1');
  });

  it('CR 608.2h: when it attacks, the count is its power as the trigger resolves (five counters: five Gnomes)', () => {
    let s = scenario([], { defs: [HULK, ...BASE], p1: { battlefield: [{ name: 'Test Hulk', counters: { '+1/+1': 5 } }] } });
    const hulk = find(s, 'Test Hulk', 'battlefield');
    for (let i = 0; i < 60 && s.turn.step !== 'declareBlockers' && s.turn.step !== 'combatDamage'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: hulk, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = pass(s);
      else s = drive(s);
      if (subtypeTokens(s, 'p1', 'Gnome').length > 0) break;
    }
    expect(subtypeTokens(s, 'p1', 'Gnome')).toHaveLength(5);
  });
});

describe('CR 111.1, 107.3: "For each <Filter>, create a <token>." is one creation of the counted number of tokens', () => {
  const BOUNTY = card('Test Bounty', 'Sorcery', 'For each land you control, create a Treasure token.');
  const TEMPLE = card('Test Temple', 'Land', 'When this land enters, for each Shrine you control, create a 1/1 red Monk creature token with prowess.');

  it('is understood', () => {
    expect(noManual(BOUNTY)).toBe(true);
    expect(noManual(TEMPLE)).toBe(true);
  });

  it('CR 111.10a: three lands you control (not the opponent\'s) give three Treasures', () => {
    const s = cast(scenario(['Forest', 'Island'], { defs: [BOUNTY, ...BASE], p1: { hand: ['Test Bounty'], battlefield: ['Forest', 'Forest', 'Island'] }, p2: { battlefield: ['Forest'] } }), 'Test Bounty');
    expect(subtypeTokens(s, 'p1', 'Treasure')).toHaveLength(3);
    expect(tokens(s, 'p2')).toHaveLength(0);
  });

  it('CR 702.108a: each Monk has prowess; with no Shrine, no token', () => {
    let s = scenario([], { defs: [TEMPLE, ...BASE], p1: { hand: ['Test Temple'], battlefield: ['Test Shrine', 'Test Shrine'] } });
    s = resolveAll(drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Temple', 'hand') })));
    const monks = subtypeTokens(s, 'p1', 'Monk');
    expect(monks).toHaveLength(2);
    for (const m of monks) expect(hasKeyword(getChars(s, m)!, 'prowess')).toBe(true);
    let none = scenario([], { defs: [TEMPLE, ...BASE], p1: { hand: ['Test Temple'] } });
    none = resolveAll(drive(act(none, { type: 'playLand', player: 'p1', card: find(none, 'Test Temple', 'hand') })));
    expect(subtypeTokens(none, 'p1', 'Monk')).toHaveLength(0);
  });
});

describe('CR 110.5b, 111.1: "Create a tapped 2/2 colorless Robot artifact creature token for each multicolored permanent you control."', () => {
  const STATION = card('Test Station', 'Sorcery', 'Create a tapped 2/2 colorless Robot artifact creature token for each multicolored permanent you control.');

  it('CR 105.2b: two multicolored permanents give two Robots, both tapped; a monocolored one does not count', () => {
    expect(noManual(STATION)).toBe(true);
    const s = cast(scenario([], { defs: [STATION, ...BASE], p1: { hand: ['Test Station'], battlefield: ['Test Gold Bear', 'Test Gold Bear', 'Test Mono Bear'] } }), 'Test Station');
    const robots = subtypeTokens(s, 'p1', 'Robot');
    expect(robots).toHaveLength(2);
    for (const r of robots) expect(s.objects[r]!.tapped).toBe(true);
  });
});

describe('CR 122.1, 608.2h: "{T}, Sacrifice ~: Create a 1/1 black Rat creature token for each counter on ~."', () => {
  const DOLL = card('Test Doll', 'Artifact', '{T}, Sacrifice this artifact: Create a 1/1 black Rat creature token for each counter on this artifact.');

  it('counts every counter of every kind on it as it last existed on the battlefield (it was sacrificed to pay the cost)', () => {
    expect(noManual(DOLL)).toBe(true);
    let s = scenario([], { defs: [DOLL, ...BASE], p1: { battlefield: [{ name: 'Test Doll', counters: { charge: 2, oil: 1 } }] } });
    const doll = find(s, 'Test Doll', 'battlefield');
    const la = legal(s, 'p1', 'activate').find((a) => a.object === doll && !a.isMana)!;
    s = resolveAll(drive(act(s, la.action)));
    expect(findAll(s, 'Test Doll', 'graveyard')).toHaveLength(1);
    expect(subtypeTokens(s, 'p1', 'Rat')).toHaveLength(3);
  });
});

describe('CR 608.2c, 608.2d, 205.3m: "Choose a creature type." and a later "of that type" / "of the chosen type" of the same ability', () => {
  const CLEAVER = card('Test Cleaver', 'Sorcery', 'Choose a creature type. Create a Treasure token for each creature you control of that type.');
  const CRESCENDO = card('Test Crescendo', 'Sorcery', 'Choose a creature type. Draw a card for each permanent you control of that type.');
  const BIDDING = card('Test Bidding', 'Sorcery', 'Choose a creature type. Return all creature cards of the chosen type from your graveyard to the battlefield.');
  const LONE = card('Test Lone', 'Sorcery', 'Create a Treasure token for each creature you control of that type.');

  it('is understood, and the filter reads the choice of the same ability (parser/lower/links.ts)', () => {
    for (const d of [CLEAVER, CRESCENDO, BIDDING]) expect(noManual(d), d.name).toBe(true);
    expect(JSON.stringify(CLEAVER.faces[0]!.abilities)).toContain('"chosen":{"link":"chosenCreatureType","quality":"creatureType"}');
  });

  it('design 6.4: "of that type" with no earlier choice in the ability is never guessed: the sentence stays manual', () => {
    expect(noManual(LONE)).toBe(false);
  });

  it('CR 608.2d: the controller chooses as it resolves; only creatures you control of that type count', () => {
    const board = { hand: ['Test Cleaver'], battlefield: ['Test Goblin', 'Test Goblin', 'Test Elf', 'Test Goblin Scout'] };
    const goblins = cast(scenario([], { defs: [CLEAVER, ...BASE], p1: board, p2: { battlefield: ['Test Goblin'] } }), 'Test Cleaver', ['Goblin']);
    expect(subtypeTokens(goblins, 'p1', 'Treasure')).toHaveLength(3);
    const elves = cast(scenario([], { defs: [CLEAVER, ...BASE], p1: board }), 'Test Cleaver', ['Elf']);
    expect(subtypeTokens(elves, 'p1', 'Treasure')).toHaveLength(1);
    const none = cast(scenario([], { defs: [CLEAVER, ...BASE], p1: board }), 'Test Cleaver', ['Dragon']);
    expect(subtypeTokens(none, 'p1', 'Treasure')).toHaveLength(0);
  });

  it('CR 121.2: "Draw a card for each permanent you control of that type"', () => {
    const s0 = scenario([], { defs: [CRESCENDO, ...BASE], p1: { hand: ['Test Crescendo'], battlefield: ['Test Goblin', 'Test Goblin', 'Test Elf'], library: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    const s = cast(s0, 'Test Crescendo', ['Goblin']);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 2);
  });

  it('CR 400.7: "Return all creature cards of the chosen type from your graveyard to the battlefield"', () => {
    const s = cast(scenario([], { defs: [BIDDING, ...BASE], p1: { hand: ['Test Bidding'], graveyard: ['Test Goblin Scout', 'Test Goblin', 'Test Elf'] } }), 'Test Bidding', ['Goblin']);
    expect(findAll(s, 'Test Goblin Scout', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Test Goblin', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Test Elf', 'graveyard')).toHaveLength(1);
  });
});

describe('CR 608.2c, 611.2c: "create two 1/1 black Rat creature tokens with \\"This token can\'t block.\\" Then if you control five or more Rats, each Rat you control gets +2/+0 until end of turn."', () => {
  const OGRE = card('Test Ogre', 'Creature — Ogre Warlock', 'Whenever this creature enters or attacks, create two 1/1 black Rat creature tokens with "This token can\'t block." Then if you control five or more Rats, each Rat you control gets +2/+0 until end of turn.', { pt: ['3', '3'] });

  it('is understood', () => {
    expect(noManual(OGRE)).toBe(true);
  });

  it('four Rats after the tokens: no bonus; five: each Rat you control gets +2/+0, the new tokens included', () => {
    const four = cast(scenario([], { defs: [OGRE, ...BASE], p1: { hand: ['Test Ogre'], battlefield: ['Test Rat', 'Test Rat'] } }), 'Test Ogre');
    expect(subtypeTokens(four, 'p1', 'Rat')).toHaveLength(2);
    for (const id of findAll(four, 'Test Rat', 'battlefield')) expect(pt(four, id)).toBe('1/1');
    const five = cast(scenario([], { defs: [OGRE, ...BASE], p1: { hand: ['Test Ogre'], battlefield: ['Test Rat', 'Test Rat', 'Test Rat'] }, p2: { battlefield: ['Test Rat'] } }), 'Test Ogre');
    const mine = [...findAll(five, 'Test Rat', 'battlefield', 'p1'), ...subtypeTokens(five, 'p1', 'Rat')];
    expect(mine).toHaveLength(5);
    for (const id of mine) expect(pt(five, id)).toBe('3/1');
    expect(pt(five, find(five, 'Test Rat', 'battlefield', 'p2'))).toBe('1/1');
    expect(pt(five, find(five, 'Test Ogre', 'battlefield'))).toBe('3/3');
  });
});

describe('CR 611.2c, 107.3m: "each <Filter> gets <PT> until end of turn"', () => {
  const HOOK = card('Test Hook', 'Enchantment', 'When this enchantment enters, each creature gets -X/-X until end of turn.', { cost: '{X}' });

  it('CR 107.3m: X of the enters trigger is the X paid for the spell; the creatures are fixed as it resolves (CR 611.2c)', () => {
    expect(noManual(HOOK)).toBe(true);
    let s = scenario(['Forest'], { defs: [HOOK, ...BASE], p1: { hand: ['Test Hook'], battlefield: ['Forest', 'Test Goblin', 'Test Gold Bear'] }, p2: { battlefield: ['Test Elf'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hook', 'hand', 'p1') });
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      s = s.pending.kind === 'chooseNumber' ? answer(s, { kind: 'chooseNumber', n: 1 }) : drive(s);
    }
    s = resolveAll(s);
    expect(findAll(s, 'Test Goblin', 'graveyard')).toHaveLength(1);
    expect(findAll(s, 'Test Elf', 'graveyard')).toHaveLength(1);
    expect(pt(s, find(s, 'Test Gold Bear', 'battlefield'))).toBe('1/1');
  });
});

describe('CR 114.1-114.4: "You get an emblem with \\"...\\""', () => {
  const NINJAS = card('Test Ninja Plan', 'Sorcery', 'You get an emblem with "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token."');
  const STORM = card('Test Storm Plan', 'Sorcery', 'Draw a card. You get an emblem with "Instant and sorcery spells you cast have storm."');
  const BAD = card('Test Bad Plan', 'Sorcery', 'You get an emblem with "Whenever you cast a spell, blorfty the zoof."');

  it('is understood; an inner ability that is not understood makes the whole sentence manual, never an emblem without it', () => {
    expect(noManual(NINJAS)).toBe(true);
    expect(noManual(STORM)).toBe(true);
    expect(noManual(BAD)).toBe(false);
    expect(JSON.stringify(BAD.faces[0]!.abilities)).not.toContain('createEmblem');
  });

  it('CR 114.2, 114.4: the emblem is in the command zone, owned by its player, and its triggered ability works from there', () => {
    let s = cast(scenario([], { defs: [NINJAS, ...BASE], p1: { hand: ['Test Ninja Plan', 'Test Sorcery'], library: ['Plains', 'Plains'] } }), 'Test Ninja Plan');
    const emblems = s.zones.command.filter((id) => s.objects[id]!.kind === 'emblem');
    expect(emblems).toHaveLength(1);
    expect(s.objects[emblems[0]!]!.owner).toBe('p1');
    expect(subtypeTokens(s, 'p1', 'Ninja')).toHaveLength(0); // the spell that made it was cast before the emblem existed
    s = cast(s, 'Test Sorcery');
    const ninjas = subtypeTokens(s, 'p1', 'Ninja');
    expect(ninjas).toHaveLength(1);
    expect(pt(s, ninjas[0]!)).toBe('2/1');
  });

  it('CR 114.4, 120.1: "this emblem deals 3 damage to any target": the emblem is the source of the damage', () => {
    const PLAN = card('Test Fire Plan', 'Sorcery', 'You get an emblem with "Whenever you cast a sorcery spell, this emblem deals 3 damage to any target."');
    expect(noManual(PLAN)).toBe(true);
    let s = cast(scenario([], { defs: [PLAN, ...BASE], p1: { hand: ['Test Fire Plan', 'Test Sorcery'], library: ['Plains', 'Plains'] } }), 'Test Fire Plan');
    const emblem = s.zones.command.find((id) => s.objects[id]!.kind === 'emblem')!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sorcery', 'hand', 'p1') });
    // the trigger goes on the stack above the sorcery and asks for its target
    for (let i = 0; i < 6 && s.pending?.kind === 'payCost'; i++) s = answer(s, { kind: 'payCost', auto: true });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }));
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(17);
    expect(s.log.some((l) => l.text.includes('3 damage'))).toBe(true);
    expect(s.objects[emblem]!.zone).toBe('command');
  });

  it('CR 114.4, 402.2: "You have no maximum hand size." works from the command zone', () => {
    const PLAN = card('Test Hand Plan', 'Sorcery', 'You get an emblem with "You have no maximum hand size."');
    expect(noManual(PLAN)).toBe(true);
    const s = cast(scenario([], { defs: [PLAN, ...BASE], p1: { hand: ['Test Hand Plan'] } }), 'Test Hand Plan');
    expect(maxHandSize(s, 'p1')).toBeNull();
    expect(maxHandSize(s, 'p2')).toBe(7);
  });

  it('CR 114.4, 602.2: an emblem with an activated ability is not automated (emblems are not listed for activation): the ability stays manual', () => {
    const PLAN = card('Test Tap Plan', 'Sorcery', 'You get an emblem with "Tap an untapped artifact you control: This emblem deals 1 damage to any target."');
    expect(PLAN.automation.level).not.toBe('full');
    expect(JSON.stringify(PLAN.faces[0]!.abilities)).toContain('"abilities":[{"kind":"manual"');
  });

  it('CR 702.40a, 613.1f: instants and sorceries you cast have storm, granted from the command zone', () => {
    const s0 = scenario([], { defs: [STORM, ...BASE], p1: { hand: ['Test Storm Plan', 'Test Instant'], library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    let s = cast(s0, 'Test Storm Plan');
    const afterPlan = handSize(s, 'p1');
    s = cast(s, 'Test Instant');
    // the instant and one storm copy (one other spell was cast before it this turn) each draw a card; the instant left the hand
    expect(handSize(s, 'p1')).toBe(afterPlan - 1 + 2);
  });
});
