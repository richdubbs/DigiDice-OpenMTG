/**
 * edh-next-115 (third pass over top-rank-t3): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites are from memory (unverified:
 * no rules/cr in a cloud checkout); the rulings were fetched from Scryfall in the cloud session.
 *
 *   CR 107.3, 608.2h, 603.2c   "you may return target creature card with mana value X or less from your graveyard to the battlefield, where X is the amount of damage ~ dealt to that player" (Venerable Warsinger)
 *   CR 706.2, 603.2c           "When you roll a natural 20, return this card from your graveyard to your hand" (Critical Hit)
 *   CR 702.144a, 613.1f        "Creature spells you cast have demonstrate" (Silverquill Lecturer)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { answer, find, mpScenario, pass, passUntil } from '../../m12/rules/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const inZone = (s: GameState, zone: 'battlefield' | 'graveyard' | 'hand', name: string, p: PlayerId): ObjectId[] => {
  const ids = zone === 'battlefield' ? s.zones.battlefield : s.zones[zone][p]!;
  return ids.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.owner === p);
};

// ---- Venerable Warsinger: where X is the amount of damage ~ dealt ---------------------------------------------------------------------------------------------------

const WARSINGER = card('Test Dirge Singer', 'Creature — Spirit', 'Whenever ~ deals combat damage to a player, you may return target creature card with mana value X or less from your graveyard to the battlefield, where X is the amount of damage ~ dealt to that player.', ['3', '3']);
const WARSINGER_STRONG = card('Test Dirge Singer', 'Creature — Spirit', 'Whenever ~ deals combat damage to a player, you may return target creature card with mana value X or less from your graveyard to the battlefield, where X is the amount of damage ~ dealt to that player.', ['5', '5']);
const SMALL = card('Test Small Corpse', 'Creature — Zombie', '', ['1', '1'], '{2}');
const BIG = card('Test Big Corpse', 'Creature — Zombie', '', ['4', '4'], '{5}');
const HUGE = card('Test Huge Corpse', 'Creature — Zombie', '', ['5', '5'], '{4}');

function warsingerGame(): GameState {
  return mpScenario({ defs: [WARSINGER, SMALL, BIG, HUGE], zones: { p1: { battlefield: ['Test Dirge Singer'], graveyard: ['Test Small Corpse', 'Test Big Corpse', 'Test Huge Corpse'] } } });
}
function attack(s0: GameState, yes: boolean, pick?: string): GameState {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Dirge Singer', 'battlefield', 'p1'), defender: 'p2' }] });
  for (let i = 0; i < 60 && !(s.turn.step === 'endCombat' || s.turn.step === 'main2'); i++) {
    const p = s.pending;
    if (p?.kind === 'chooseTargets') {
      const opts = (p as unknown as { options?: { id: string }[] }).options;
      s = answer(s, { kind: 'chooseTargets', targets: pick === undefined ? [] : [{ kind: 'object', id: find(s, pick, 'graveyard', 'p1') } as never] });
      void opts;
    } else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p?.kind === 'priority') s = pass(s);
    else if (p?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] } as never);
    else throw new Error(`unexpected ${p?.kind}`);
  }
  return s;
}

describe('CR 107.3, 608.2h: "return target creature card with mana value X or less ..., where X is the amount of damage ~ dealt to that player"', () => {
  it('is automated', () => { expect(full(WARSINGER)).toBe(true); });
  it('3 combat damage: the mana value 2 creature card returns to the battlefield', () => {
    const s = attack(warsingerGame(), true, 'Test Small Corpse');
    expect(inZone(s, 'battlefield', 'Test Small Corpse', 'p1')).toHaveLength(1);
    expect(inZone(s, 'graveyard', 'Test Small Corpse', 'p1')).toHaveLength(0);
  });
  it('negative: the mana value 5 card is no legal target for 3 damage (the target is refused, it stays in the graveyard)', () => {
    expect(() => attack(warsingerGame(), true, 'Test Big Corpse')).toThrow(/not a legal target/);
  });
  it('X is the damage dealt: with 5 damage the mana value 5 card is a legal target and returns', () => {
    const g = mpScenario({ defs: [WARSINGER_STRONG, SMALL, BIG, HUGE], zones: { p1: { battlefield: ['Test Dirge Singer'], graveyard: ['Test Small Corpse', 'Test Big Corpse', 'Test Huge Corpse'] } } });
    const s = attack(g, true, 'Test Big Corpse');
    expect(inZone(s, 'battlefield', 'Test Big Corpse', 'p1')).toHaveLength(1);
  });
  it('"you may": declining returns nothing', () => {
    const s = attack(warsingerGame(), false, 'Test Small Corpse');
    expect(inZone(s, 'battlefield', 'Test Small Corpse', 'p1')).toHaveLength(0);
  });
});

// ---- Critical Hit: a natural 20 ----------------------------------------------------------------------------------------------------------------------------------
import { card as scard, cast as scast, full as sfull, resolveAll, scenario } from '../r4-cost/support';

const HIT = scard('Test Lucky Strike', 'Instant', 'Target creature gains double strike until end of turn.\nWhen you roll a natural 20, return this card from your graveyard to your hand.', '{0}');
const ROLLER = scard('Test Dice Bowl', 'Sorcery', 'Roll a d20.', '{0}');
const ROLLER_I = scard('Test Quick Bowl', 'Instant', 'Roll a d20.', '{0}');
const D6 = scard('Test Tiny Bowl', 'Sorcery', 'Roll a d6.', '{0}');
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const SEEDS = Array.from({ length: 60 }, (_, i) => `n${i}`);

describe('CR 706.2, 603.2c: "When you roll a natural 20, return this card from your graveyard to your hand."', () => {
  it('is automated', () => { expect(sfull(HIT)).toBe(true); });
  it('returns to the hand exactly when the d20 shows 20 (and only then)', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = scenario([], { seed, defs: [HIT, ROLLER], p1: { hand: ['Test Dice Bowl'], graveyard: ['Test Lucky Strike'] } });
      const s = resolveAll(scast(s0, 'Test Dice Bowl'));
      const roll = rolled(s)[0]!;
      const inHand = (s.zones.hand.p1 ?? []).some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Lucky Strike');
      expect(inHand, `${seed}: rolled ${roll}`).toBe(roll === 20);
      seen.add(roll === 20 ? 'twenty' : 'other');
    }
    expect([...seen].sort(), 'the seeds roll a 20 and another number').toEqual(['other', 'twenty']);
  });
  it('the NATURAL result counts: a roll of 19 modified to 20 does not return it, a natural 20 modified to 21 does', () => {
    const PLUS = scard('Test Loaded Bowl', 'Sorcery', 'Roll a d20 and add 1.', '{0}');
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = scenario([], { seed, defs: [HIT, PLUS], p1: { hand: ['Test Loaded Bowl'], graveyard: ['Test Lucky Strike'] } });
      const s = resolveAll(scast(s0, 'Test Loaded Bowl'));
      const natural = rolled(s)[0]!;
      const inHand = (s.zones.hand.p1 ?? []).some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Lucky Strike');
      expect(inHand, `${seed}: natural ${natural}`).toBe(natural === 20);
      if (natural === 19) seen.add('nineteen');
      if (natural === 20) seen.add('twenty');
    }
    expect([...seen].sort(), 'the seeds roll a 19 and a 20').toEqual(['nineteen', 'twenty']);
  });
  it('negative: a natural 20 on another die size (a d6 never shows it) and the card in the hand are untouched; an opponent\'s roll does not count', () => {
    const s0 = scenario([], { seed: 'n1', defs: [HIT, D6], p1: { hand: ['Test Tiny Bowl'], graveyard: ['Test Lucky Strike'] } });
    const s = resolveAll(scast(s0, 'Test Tiny Bowl'));
    expect((s.zones.hand.p1 ?? []).some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Lucky Strike')).toBe(false);
    let twenties = 0;
    for (const seed of SEEDS) {
      const g = mpScenario({ seed, defs: [HIT, ROLLER], options: { startingPlayer: 'p2' }, zones: { p1: { graveyard: ['Test Lucky Strike'] }, p2: { hand: ['Test Dice Bowl'] } } });
      let o = act(g, { type: 'cast', player: 'p2', card: g.zones.hand.p2![0]! });
      for (let i = 0; i < 20 && (o.zones.stack.length > 0 || (o.pending && o.pending.kind !== 'priority')); i++) o = o.pending?.kind === 'payCost' ? answer(o, { kind: 'payCost', auto: true }) : passBoth(o);
      if (rolled(o)[0] === 20) twenties++;
      expect((o.zones.hand.p1 ?? []).some((id) => o.defs[o.objects[id]!.defId]!.name === 'Test Lucky Strike'), `${seed}: the opponent's roll never returns it`).toBe(false);
    }
    expect(twenties, 'the opponent rolled a natural 20 at least once').toBeGreaterThan(0);
  });
});

// ---- Silverquill Lecturer: every creature spell has demonstrate -------------------------------------------------------------------------------------------------------
describe('CR 702.144a, 613.1f: "Creature spells you cast have demonstrate."', () => {
  const LECTURER = scard('Test Lecturer', 'Creature — Elf', 'Creature spells you cast have demonstrate.', '{0}', ['1', '1']);
  const WISP = scard('Test Wisp', 'Creature — Spirit', '', '{0}', ['1', '1']);
  const BOLT = scard('Test Spark', 'Instant', 'You gain 1 life.', '{0}');
  const wisps = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Wisp').length;
  const defs = [LECTURER, WISP, BOLT];
  const castAnswering = (s0: GameState, name: string): { s: GameState; asked: boolean } => {
    let s = act0(s0, name);
    let asked = false;
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending;
      if (p === null) break;
      if (p.kind === 'yesNo') { asked = true; s = answer(s, { kind: 'yesNo', yes: true }); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
      else if (p.kind === 'priority') s = passBoth(s);
      else break;
    }
    return { s, asked };
  };
  function act0(s0: GameState, name: string): GameState { return actCast(s0, name); }
  it('is automated', () => { expect(sfull(LECTURER)).toBe(true); });
  it('EVERY creature spell may be copied by demonstrate (both the first and the second)', () => {
    let s0 = scenario([], { defs, p1: { hand: ['Test Wisp', 'Test Wisp'], battlefield: ['Test Lecturer'] } });
    const a = castAnswering(s0, 'Test Wisp');
    expect(a.asked).toBe(true);
    expect(wisps(a.s)).toBe(3);
    const b = castAnswering(a.s, 'Test Wisp');
    expect(b.asked, 'the second creature spell of the turn too').toBe(true);
    s0 = b.s;
    expect(wisps(s0)).toBe(6);
  });
  it('negative: a noncreature spell is not offered demonstrate, and an opponent\'s creature spell has none', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Spark'], battlefield: ['Test Lecturer'] }, p2: { hand: ['Test Wisp'] } });
    expect(castAnswering(s0, 'Test Spark').asked).toBe(false);
    const s1 = mpScenario({ defs, options: { startingPlayer: 'p2' }, zones: { p1: { battlefield: ['Test Lecturer'] }, p2: { hand: ['Test Wisp'] } } });
    let t = act(s1, { type: 'cast', player: 'p2', card: s1.zones.hand.p2![0]! });
    let asked = false;
    for (let i = 0; i < 40 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
      if (t.pending?.kind === 'yesNo') { asked = true; t = answer(t, { kind: 'yesNo', yes: true }); } else if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true }); else t = passBoth(t);
    }
    expect(asked, 'the opponent\'s creature spell has no demonstrate from p1\'s Lecturer').toBe(false);
  });
});
import { act, passBoth } from '../../m3/scenario';
function actCast(s: GameState, name: string): GameState { return act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => s.defs[s.objects[id]!.defId]!.name === name)! }); }

// ---- The Animus: exile a card from a graveyard WITH a counter -----------------------------------------------------------------------------------------------------------
describe('CR 122.2, 406.3, 701.13a: "exile up to one target legendary creature card from a graveyard with a memory counter on it"', () => {
  const ANIMUS = scard('Test Memory Vault', 'Legendary Artifact', 'At the beginning of your end step, exile up to one target legendary creature card from a graveyard with a memory counter on it.', '{0}');
  const KING = scard('Test Old King', 'Legendary Creature — Human', '', '{0}', ['2', '2']);
  const PAWN = scard('Test Old Pawn', 'Creature — Human', '', '{0}', ['1', '1']);
  const toEndStep = (s0: GameState, targetName: string | null, owner: 'p1' | 'p2'): GameState => {
    let s = s0;
    for (let i = 0; i < 80 && !(s.turn.step === 'end' && s.zones.stack.length === 0 && s.turn.number === s0.turn.number); i++) {
      const p = s.pending;
      if (p?.kind === 'chooseTargets') {
        const id = targetName === null ? undefined : (s.zones.graveyard[owner] ?? []).find((x) => s.defs[s.objects[x]!.defId]!.name === targetName);
        s = answer(s, { kind: 'chooseTargets', targets: id === undefined ? [] : [{ kind: 'object', id } as never] });
      } else if (p?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] } as never);
      else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
      else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else s = pass(s);
    }
    return s;
  };
  it('is automated', () => { expect(sfull(ANIMUS)).toBe(true); });
  it('the legendary creature card of an opponent\'s graveyard is exiled with a memory counter on it', () => {
    const s0 = mpScenario({ defs: [ANIMUS, KING, PAWN], zones: { p1: { battlefield: ['Test Memory Vault'] }, p2: { graveyard: ['Test Old King', 'Test Old Pawn'] } } });
    const s = toEndStep(s0, 'Test Old King', 'p2');
    const exiled = s.zones.exile.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Old King');
    expect(exiled, 'exiled').toBeDefined();
    expect(s.objects[exiled!]!.counters['memory']).toBe(1);
    expect(inZone(s, 'graveyard', 'Test Old Pawn', 'p2')).toHaveLength(1);
  });
  it('negative: a nonlegendary creature card is no legal target, and "up to one" allows exiling nothing', () => {
    const s0 = mpScenario({ defs: [ANIMUS, KING, PAWN], zones: { p1: { battlefield: ['Test Memory Vault'] }, p2: { graveyard: ['Test Old King', 'Test Old Pawn'] } } });
    expect(() => toEndStep(s0, 'Test Old Pawn', 'p2')).toThrow(/not a legal target/);
    const none = toEndStep(s0, null, 'p2');
    expect(none.zones.exile).toHaveLength(0);
  });
});

// ---- Mila, Crafty Companion: attacks on planeswalkers, once per declaration ----------------------------------------------------------------------------------------------
describe('CR 508.1b, 506.3, 603.2c: "Whenever an opponent attacks one or more planeswalkers you control, put a loyalty counter on each planeswalker you control."', () => {
  const TOWER = scard('Test Watch Tower', 'Artifact', 'Whenever an opponent attacks one or more planeswalkers you control, put a loyalty counter on each planeswalker you control.', '{0}');
  const WALKER = scard('Test Oath Walker', 'Planeswalker — Testa', '+1: You gain 1 life.', '{0}');
  const RAIDER = scard('Test Hill Raider', 'Creature — Goblin', '', '{0}', ['1', '1']);
  const loyalty = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;
  const game = (): GameState => mpScenario({
    defs: [TOWER, WALKER, RAIDER], options: { startingPlayer: 'p2' },
    zones: { p1: { battlefield: ['Test Watch Tower', { name: 'Test Oath Walker', counters: { loyalty: 3 } }, { name: 'Test Oath Walker', counters: { loyalty: 3 } }] }, p2: { battlefield: ['Test Hill Raider', 'Test Hill Raider', 'Test Hill Raider'] } },
  });
  function declare(s0: GameState, attacks: (idx: number) => { attacker: ObjectId; defender: PlayerId | ObjectId }[]): GameState {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    const raiders = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.defs[s.objects[id]!.defId]!.name === 'Test Hill Raider');
    const walkers = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Oath Walker');
    void walkers;
    s = answer(s, { kind: 'declareAttackers', attacks: attacks(0).map((a, i) => ({ attacker: raiders[i]!, defender: a.defender })) });
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind === 'order'); i++) {
      if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else throw new Error(`unexpected ${s.pending?.kind}`);
    }
    return s;
  }
  const walkersOf = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Oath Walker');
  it('is automated', () => { expect(sfull(TOWER)).toBe(true); });
  it('two creatures attack TWO planeswalkers: one trigger, every planeswalker gets exactly one loyalty counter', () => {
    const s0 = game();
    const [w1, w2] = walkersOf(s0);
    const s = declare(s0, () => [{ attacker: '' as ObjectId, defender: w1! }, { attacker: '' as ObjectId, defender: w2! }]);
    expect(loyalty(s, w1!)).toBe(4);
    expect(loyalty(s, w2!)).toBe(4);
  });
  it('three creatures attack ONE planeswalker: still one trigger (the ruling: once however many creatures attack)', () => {
    const s0 = game();
    const [w1, w2] = walkersOf(s0);
    const s = declare(s0, () => [{ attacker: '' as ObjectId, defender: w1! }, { attacker: '' as ObjectId, defender: w1! }, { attacker: '' as ObjectId, defender: w1! }]);
    expect(loyalty(s, w1!)).toBe(4);
    expect(loyalty(s, w2!)).toBe(4);
  });
  it('negative: an attack on you (the player) or on another player does not trigger it', () => {
    const s0 = game();
    const [w1, w2] = walkersOf(s0);
    const s = declare(s0, () => [{ attacker: '' as ObjectId, defender: 'p1' }, { attacker: '' as ObjectId, defender: 'p3' }]);
    expect(loyalty(s, w1!)).toBe(3);
    expect(loyalty(s, w2!)).toBe(3);
  });
});

// ---- Battle of Hoover Dam: a Siege between two factions ----------------------------------------------------------------------------------------------------------------
describe('CR 614.12a, 607.2d: "As this enchantment enters, choose NCR or Legion." (only the chosen faction\'s ability)', () => {
  const SIEGE = scard('Test Dam Siege', 'Enchantment', 'As this enchantment enters, choose NCR or Legion.\n• NCR -- At the beginning of your end step, you gain 2 life.\n• Legion -- At the beginning of your end step, each opponent loses 2 life.');
  const run = (word: string): GameState => {
    let s = scenario([], { defs: [SIEGE], p1: { hand: ['Test Dam Siege'] } });
    s = act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! });
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseOption'; i++) s = s.pending?.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : passBoth(s);
    expect(s.pending?.kind).toBe('chooseOption');
    s = answer(s, { kind: 'chooseOption', ids: [word] });
    for (let i = 0; i < 80 && s.turn.activePlayer !== 'p2'; i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else s = pass(s);
    }
    return s;
  };
  it('is automated', () => { expect(sfull(SIEGE)).toBe(true); });
  it('NCR: the end step gains 2 life and the opponent loses nothing', () => {
    const s = run('NCR');
    expect([s.players[0]!.life, s.players[1]!.life]).toEqual([22, 20]);
  });
  it('Legion: the opponent loses 2 life and you gain nothing; any other word is no choice', () => {
    const s = run('Legion');
    expect([s.players[0]!.life, s.players[1]!.life]).toEqual([20, 18]);
    expect(sfull(scard('Test Odd Dam', 'Enchantment', 'As this enchantment enters, choose NCR or Elves.\n• NCR -- Creatures you control get +1/+0.\n• Elves -- Creatures you control get +0/+1.'))).toBe(false);
  });
});
