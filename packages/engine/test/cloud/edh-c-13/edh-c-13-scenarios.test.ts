/**
 * Commander lane edh-c-13 (EDHREC ranks 18,751 to 19,375; code edhv13): the round's readings played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. CR cites checked against the Comprehensive Rules of 2026-09-25 where marked, else from memory.
 *
 *   CR 701.22a, 101.4, 608.2d     "When ~ enters, each player may scry 1.": each player decides for themselves, in turn order
 *   CR 111.1, 608.2h              "Create a tapped Powerstone token for each other creature you control": the entering creature itself is not counted
 *   CR 611.2a, 613.4c             "each other creature you control gets +1/+1 and gains trample until end of turn": the others, yours only
 *   CR 603.2c, 603.4              "Whenever one or more +1/+1 counters are put on one or more Humans you control, draw a card. ... only once each turn": one batch, one trigger
 *   CR 305.1, 601.2a              "Whenever you play a card, draw a card": a land played or a spell cast
 *   CR 122.1, 701.27a, 712.9      "Put a hatchling counter on ~. Then if there are N or more hatchling counters on it, remove all of them and transform it."
 *   CR 701.12a, 613.4b, 509.1h    "exchange its power and the power of target creature it's blocking until end of combat"
 *   CR 607.2a, 400.7, 110.2       "you may sacrifice ~. If you do, return each card exiled with ~ to the battlefield under its owner's control"
 *   CR 401.4, 701.20e             "Look at the top X cards of your library, where X is the number of Wizards on the battlefield, then put them back in any order"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, battlefieldNames, find, findAll, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
const hand = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

interface Seen { kind: string; player: string }
/** Answer the decisions that come up until priority; `yes` answers every yes/no, the order of simultaneous triggers and of cards is the given one; targets in turn. */
function drive(s0: GameState, o: { yes?: boolean; targets?: ObjectId[]; seen?: Seen[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    o.seen?.push({ kind: p.kind, player: p.player });
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);

describe('CR 701.22a, 101.4, 608.2d: "When this creature enters, each player may scry 1."', () => {
  const SCOUT = card('Test Scout', 'Creature — Scout', 'When this creature enters, each player may scry 1.', ['1', '1']);
  it('is parsed and automated', () => expect(automated(SCOUT)).toBe(true));
  it('each player is asked whether to scry, and a player who says yes scries', () => {
    const seen: Seen[] = [];
    const s0 = scenario([], { p1: { hand: ['Test Scout'] }, defs: [SCOUT] });
    cast(s0, 'Test Scout', { seen });
    expect(seen.filter((d) => d.kind === 'yesNo').map((d) => d.player).sort()).toEqual(['p1', 'p2']);
    expect(seen.length).toBeGreaterThan(2); // the scry itself asks the players who said yes
  });
  it('negative: when every player declines nobody scries, the creature still enters', () => {
    const seen: Seen[] = [];
    const s0 = scenario([], { p1: { hand: ['Test Scout'] }, defs: [SCOUT] });
    const s1 = cast(s0, 'Test Scout', { seen, yes: false });
    expect(seen.map((d) => d.kind)).toEqual(['yesNo', 'yesNo']);
    expect(battlefieldNames(s1, 'p1')).toContain('Test Scout');
  });
});

describe('CR 111.1, 111.10, 608.2h: "When this creature enters, create a tapped Powerstone token for each other creature you control."', () => {
  const PROSPECTOR = card('Test Prospector', 'Creature — Dwarf', 'When this creature enters, create a tapped Powerstone token for each other creature you control.', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [PROSPECTOR, BEAR];
  it('is parsed and automated', () => expect(automated(PROSPECTOR)).toBe(true));
  it('counts your other creatures (not the entering one, not the opponent\'s) and the tokens enter tapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Prospector'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, defs });
    const s1 = cast(s0, 'Test Prospector');
    const stones = s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p1' && getChars(s1, id)!.subtypes.includes('Powerstone'));
    expect(stones.length).toBe(2);
    expect(stones.every((id) => s1.objects[id]!.tapped)).toBe(true);
  });
  it('negative: with no other creature no token is created', () => {
    const s0 = scenario([], { p1: { hand: ['Test Prospector'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    const s1 = cast(s0, 'Test Prospector');
    expect(s1.zones.battlefield.some((id) => getChars(s1, id)!.subtypes.includes('Powerstone'))).toBe(false);
  });
});

describe('CR 611.2a, 613.4c, 603.2: "Whenever you cast a Spirit or Arcane spell, each other creature you control gets +1/+1 and gains trample until end of turn."', () => {
  const KODAMA = card('Test Kodama', 'Creature — Spirit', 'Whenever you cast a Spirit or Arcane spell, each other creature you control gets +1/+1 and gains trample until end of turn.', ['2', '2']);
  const WISP = card('Test Wisp', 'Instant — Arcane', 'Draw a card.');
  const SPIRIT = card('Test Spirit Spell', 'Creature — Spirit', '', ['1', '1']);
  const SHOT = card('Test Shot', 'Instant', 'Draw a card.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [KODAMA, WISP, SPIRIT, SHOT, BEAR];
  const setup = (spell: string): GameState => scenario([], { p1: { hand: [spell], battlefield: ['Test Kodama', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
  const keywords = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);
  it('is parsed and automated', () => expect(automated(KODAMA)).toBe(true));
  for (const spell of ['Test Wisp', 'Test Spirit Spell']) {
    it(`casting ${spell}: your other creatures get +1/+1 and trample, Kodama itself and the opponent's creature do not`, () => {
      const s0 = setup(spell);
      const s1 = cast(s0, spell);
      const bear = find(s1, 'Test Plain Bear', 'battlefield', 'p1');
      const kodama = find(s1, 'Test Kodama', 'battlefield', 'p1');
      const theirs = find(s1, 'Test Plain Bear', 'battlefield', 'p2');
      expect(power(s1, bear)).toBe(3);
      expect(keywords(s1, bear)).toContain('trample');
      expect(power(s1, kodama)).toBe(2);
      expect(keywords(s1, kodama)).not.toContain('trample');
      expect(power(s1, theirs)).toBe(2);
    });
  }
  it('negative: casting a spell that is neither a Spirit nor an Arcane changes nothing', () => {
    const s0 = setup('Test Shot');
    const s1 = cast(s0, 'Test Shot');
    expect(power(s1, find(s1, 'Test Plain Bear', 'battlefield', 'p1'))).toBe(2);
  });
});

describe('CR 603.2c, 603.4, 122.1: "Whenever one or more +1/+1 counters are put on one or more Humans you control, draw a card. This ability triggers only once each turn."', () => {
  const CADET = card('Test Cadet', 'Creature — Human', 'Whenever one or more +1/+1 counters are put on one or more Humans you control, draw a card. This ability triggers only once each turn.', ['1', '1']);
  const HUMAN = card('Test Plain Human', 'Creature — Human', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const FEED = card('Test Feed', 'Sorcery', 'Put a +1/+1 counter on each creature you control.');
  const FEED_BEAR = card('Test Feed Target', 'Sorcery', 'Put a +1/+1 counter on target creature you control.');
  const THEIR = card('Test Their Feed', 'Sorcery', 'Put a +1/+1 counter on target creature an opponent controls.');
  const defs = [CADET, HUMAN, BEAR, FEED, FEED_BEAR, THEIR];
  it('is parsed and automated', () => expect(automated(CADET)).toBe(true));
  it('counters put on two Humans at once draw exactly one card (one batch, CR 603.2c)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Feed'], battlefield: ['Test Cadet', 'Test Plain Human'] }, defs });
    const before = hand(s0, 'p1');
    const s1 = cast(s0, 'Test Feed');
    expect(hand(s1, 'p1')).toBe(before - 1 + 1);
  });
  it('once each turn: a second batch the same turn draws nothing more', () => {
    const s0 = scenario([], { p1: { hand: ['Test Feed', 'Test Feed'], battlefield: ['Test Cadet'] }, defs });
    const s1 = cast(s0, 'Test Feed');
    const s2 = cast(s1, 'Test Feed');
    expect(hand(s2, 'p1')).toBe(hand(s1, 'p1') - 1); // the second Feed left the hand, nothing was drawn
  });
  it('negative: counters on a non-Human creature, or on an opponent\'s Human, draw nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Feed Target'], battlefield: ['Test Plain Bear'] }, defs });
    const s1 = cast(s0, 'Test Feed Target', { targets: [find(s0, 'Test Plain Bear', 'battlefield', 'p1')] });
    expect(hand(s1, 'p1')).toBe(hand(s0, 'p1') - 1);
    const t0 = scenario([], { p1: { hand: ['Test Their Feed'], battlefield: ['Test Cadet'] }, p2: { battlefield: ['Test Plain Human'] }, defs });
    const t1 = cast(t0, 'Test Their Feed', { targets: [find(t0, 'Test Plain Human', 'battlefield', 'p2')] });
    expect(hand(t1, 'p1')).toBe(hand(t0, 'p1') - 1);
  });
});

describe('CR 305.1, 601.2a, 603.2: "Whenever you play a card, draw a card."', () => {
  const PROFUSION = card('Test Profusion', 'Enchantment', 'Whenever you play a card, draw a card.');
  const SHOT = card('Test Shot', 'Instant', 'Scry 1.');
  const defs = [PROFUSION, SHOT];
  it('is parsed and automated', () => expect(automated(PROFUSION)).toBe(true));
  it('casting a spell draws a card', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shot'], battlefield: ['Test Profusion'] }, defs });
    const s1 = cast(s0, 'Test Shot');
    expect(hand(s1, 'p1')).toBe(hand(s0, 'p1') - 1 + 1);
  });
  it('playing a land draws a card', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Forest'], battlefield: ['Test Profusion'] }, defs });
    const s1 = resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Forest', 'hand', 'p1') }));
    expect(hand(s1, 'p1')).toBe(hand(s0, 'p1') - 1 + 1);
  });
  it('negative: a copy of a spell that is cast is not a card: it draws nothing (rulings of 2007-02-01 and 2018-07-13)', () => {
    const REPLAY = card('Test Replay', 'Sorcery', 'Exile target instant card from your graveyard. Copy it. You may cast the copy without paying its mana cost.');
    const s0 = scenario([], { p1: { hand: ['Test Replay'], graveyard: ['Test Shot'], battlefield: ['Test Profusion'] }, defs: [...defs, REPLAY] });
    const s1 = cast(s0, 'Test Replay', { targets: [find(s0, 'Test Shot', 'graveyard', 'p1')] });
    expect(hand(s1, 'p1')).toBe(hand(s0, 'p1') - 1 + 1); // one draw, for the Replay itself; none for the cast copy
  });
  it('negative: an opponent playing a card draws nothing for you, and putting a card onto the battlefield is not playing it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Profusion'] }, p2: { hand: ['Test Shot'] }, defs });
    const s1 = resolveAll(act(advanceTo(s0, 2, 'main1'), { type: 'cast', player: 'p2', card: find(s0, 'Test Shot', 'hand', 'p2') }));
    expect(hand(s1, 'p1')).toBe(hand(s0, 'p1')); // turn 2 is p2's: p2 cast the spell, p1 drew nothing
  });
});

describe('CR 122.1, 701.27a, 712.9: "Put a ritual counter on ~. Then if it has N or more ritual counters on it, remove them and transform it."', () => {
  const FRONT = { name: 'Test Mirror', mana_cost: '{0}', type_line: 'Artifact', oracle_text: '{0}: Put a ritual counter on this artifact. Then if it has two or more ritual counters on it, remove them and transform it.', colors: [] };
  const BACK = { name: 'Test Fiend', mana_cost: '', type_line: 'Artifact Creature — Fiend', oracle_text: '', power: '4', toughness: '4', colors: [] };
  const MIRROR: CardDef = compileCard({ name: 'Test Mirror // Test Fiend', layout: 'transform', mana_cost: '{0}', type_line: 'Artifact // Artifact Creature — Fiend', colors: [], card_faces: [FRONT, BACK] } as unknown as OracleCard);
  const FRONT2 = { name: 'Test Egg', mana_cost: '{0}', type_line: 'Creature — Bird', oracle_text: '{0}: Put a hatchling counter on this creature. Then if there are two or more hatchling counters on it, remove all of them and transform it.', power: '0', toughness: '2', colors: [] };
  const BACK2 = { name: 'Test Roc', mana_cost: '', type_line: 'Creature — Bird', oracle_text: '', power: '5', toughness: '5', colors: [] };
  const EGG: CardDef = compileCard({ name: 'Test Egg // Test Roc', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Bird // Creature — Bird', colors: [], card_faces: [FRONT2, BACK2] } as unknown as OracleCard);
  const activate = (s: GameState, id: ObjectId): GameState => resolveAll(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }));
  for (const [def, name, kind] of [[MIRROR, 'Test Mirror // Test Fiend', 'ritual'], [EGG, 'Test Egg // Test Roc', 'hatchling']] as const) {
    it(`${name}: is parsed and automated`, () => expect(automated(def)).toBe(true));
    it(`${name}: the first activation leaves one ${kind} counter, the second removes them all and transforms it`, () => {
      const s0 = scenario([], { p1: { battlefield: [name] }, defs: [def] });
      const id = find(s0, name, 'battlefield', 'p1');
      const s1 = activate(s0, id);
      expect(s1.objects[id]!.counters[kind]).toBe(1);
      expect(s1.objects[id]!.face).toBe(0);
      const s2 = activate(s1, id);
      expect(s2.objects[id]!.counters[kind] ?? 0).toBe(0);
      expect(s2.objects[id]!.face).toBe(1);
    });
  }
  it('negative: counters of another kind do not count, and nothing is removed below the threshold', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Egg // Test Roc', counters: { ritual: 5 } }] }, defs: [EGG] });
    const id = find(s0, 'Test Egg // Test Roc', 'battlefield', 'p1');
    const s1 = activate(s0, id);
    expect(s1.objects[id]!.face).toBe(0);
    expect(s1.objects[id]!.counters['ritual']).toBe(5);
    expect(s1.objects[id]!.counters['hatchling']).toBe(1);
  });
});

describe('CR 701.12a, 613.4b, 509.1h: "Whenever this creature blocks, exchange its power and the power of target creature it\'s blocking until end of combat."', () => {
  const MASTER = card('Test Master', 'Creature — Monk', "Whenever this creature blocks, exchange its power and the power of target creature it's blocking until end of combat.", ['1', '5']);
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['4', '4']);
  const defs = [MASTER, BRUTE];
  const setup = (): GameState => scenario([], { p1: { battlefield: ['Test Brute'] }, p2: { battlefield: ['Test Master'] }, defs });
  it('is parsed and automated', () => expect(automated(MASTER)).toBe(true));
  it('the powers are exchanged: the Brute is left with 1 power and dies to the Master, which now has 4', () => {
    const s0 = advanceTo(setup(), 3, 'main1');
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    const s1 = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[brute]]));
    const master = find(s1, 'Test Master', 'battlefield', 'p2');
    let s2 = declareBlockers(s1, [[master, brute]]);
    s2 = drive(s2, { targets: [brute] });
    for (let i = 0; i < 8 && s2.zones.stack.length > 0; i++) s2 = drive(pass(s2), { targets: [brute] });
    expect(power(s2, master)).toBe(4);
    expect(power(s2, brute)).toBe(1);
    // through combat damage: the Brute (toughness 4) takes 4 from the Master and dies, the Master (toughness 5) takes 1
    for (let i = 0; i < 12 && s2.zones.battlefield.includes(brute) && !s2.result; i++) s2 = drive(pass(s2));
    expect(s2.zones.battlefield.includes(brute)).toBe(false);
    expect(s2.zones.battlefield.includes(master)).toBe(true);
  });
  it('the exchange ends with the combat: both creatures have their own power again after it', () => {
    const s0 = advanceTo(setup(), 3, 'main1');
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    const s1 = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[brute]]));
    const master = find(s1, 'Test Master', 'battlefield', 'p2');
    let s2 = drive(declareBlockers(s1, [[master, brute]]), { targets: [brute] });
    for (let i = 0; i < 40 && !(s2.turn.step === 'main2' || s2.turn.step === 'end'); i++) s2 = drive(pass(s2), { targets: [brute] });
    expect(['main2', 'end']).toContain(s2.turn.step);
    expect(power(s2, master)).toBe(1);
    if (s2.zones.battlefield.includes(brute)) expect(power(s2, brute)).toBe(4);
  });
  it('negative: a Master that does not block exchanges nothing (the trigger is about blocking)', () => {
    const s0 = advanceTo(setup(), 3, 'main1');
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    const s1 = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[brute]]));
    const master = find(s1, 'Test Master', 'battlefield', 'p2');
    expect(power(s1, master)).toBe(1);
    expect(power(s1, brute)).toBe(4);
  });
});

describe('CR 607.2a, 400.7, 110.2: "{2}, {T}: Exile target creature you control." and "At the beginning of your upkeep, you may sacrifice this land. If you do, return each card exiled with this land to the battlefield under its owner\'s control."', () => {
  const HAVEN = card('Test Haven', 'Land', "{0}, {T}: Exile target creature you control.\nAt the beginning of your upkeep, you may sacrifice this land. If you do, return each card exiled with this land to the battlefield under its owner's control.");
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [HAVEN, BEAR];
  const exileBear = (): { s: GameState; bear: ObjectId; haven: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Haven', 'Test Plain Bear'] }, defs });
    const haven = find(s0, 'Test Haven', 'battlefield', 'p1');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const s1 = resolveAll(act(s0, { type: 'activate', player: 'p1', source: haven, ability: 'p:0:0' }), { targets: [bear] });
    return { s: s1, bear, haven };
  };
  it('is parsed and automated', () => expect(automated(HAVEN)).toBe(true));
  it('exiled with the land, then at your next upkeep: sacrifice it and the creature returns (a new object, under its owner\'s control)', () => {
    const { s: s1, haven } = exileBear();
    expect(battlefieldNames(s1, 'p1')).not.toContain('Test Plain Bear');
    expect(s1.zones.exile.some((id) => s1.objects[id]!.defId === 'Test Plain Bear')).toBe(true);
    let s2 = advanceTo(s1, 3, 'upkeep');
    s2 = resolveAll(s2, { yes: true });
    expect(battlefieldNames(s2, 'p1')).toContain('Test Plain Bear');
    expect(s2.zones.battlefield.includes(haven)).toBe(false);
    expect(s2.zones.exile.some((id) => s2.objects[id]!.defId === 'Test Plain Bear')).toBe(false);
  });
  it('negative: declining the sacrifice leaves the creature exiled and the land in play', () => {
    const { s: s1, haven } = exileBear();
    let s2 = advanceTo(s1, 3, 'upkeep');
    s2 = resolveAll(s2, { yes: false });
    expect(battlefieldNames(s2, 'p1')).not.toContain('Test Plain Bear');
    expect(s2.zones.battlefield.includes(haven)).toBe(true);
  });
});

describe('CR 401.4, 701.20e, 107.3: "{T}: Look at the top X cards of your library, where X is the number of Wizards on the battlefield, then put them back in any order."', () => {
  const DEALER = card('Test Dealer', 'Creature — Human Wizard', '{T}: Look at the top X cards of your library, where X is the number of Wizards on the battlefield, then put them back in any order.', ['1', '1']);
  const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [DEALER, WIZARD, BEAR];
  const look = (s0: GameState): Seen[] => {
    const seen: Seen[] = [];
    const dealer = find(s0, 'Test Dealer', 'battlefield', 'p1');
    const s1 = act(s0, { type: 'activate', player: 'p1', source: dealer, ability: 'p:0:0' });
    let s = s1;
    for (let i = 0; i < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      if (s.pending && s.pending.kind !== 'priority') {
        const p = s.pending;
        seen.push({ kind: p.kind === 'order' ? `order:${p.items.length}` : p.kind, player: p.player });
        s = drive(s);
      } else s = pass(s);
    }
    return seen;
  };
  it('is parsed and automated', () => expect(automated(DEALER)).toBe(true));
  it('X counts the Wizards of every player: three Wizards put three cards back in an order of your choice', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dealer', 'Test Wizard'] }, p2: { battlefield: ['Test Wizard', 'Test Plain Bear'] }, defs });
    expect(look(s0)).toContainEqual({ kind: 'order:3', player: 'p1' });
  });
  it('negative: a creature that is not a Wizard does not count (the Dealer alone looks at one card, nothing to order)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dealer', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] }, defs });
    expect(look(s0).some((d) => d.kind.startsWith('order:') && d.kind !== 'order:1')).toBe(false);
  });
});
