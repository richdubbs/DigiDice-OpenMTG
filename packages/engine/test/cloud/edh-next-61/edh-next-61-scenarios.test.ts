/**
 * Commander lane instead (EDHREC top 20,000), round edh-next-61: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Each test is named after the rule it checks, with its negative case. Cites of the Comprehensive Rules were checked against the text of 2026-09-25 where the round's
 * record says so.
 *
 *   CR 120.3a, 614.1a, 104.3b       "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead." (Worship, Serra the Benevolent)
 *   CR 614.15, 701.23a, 702.33d     "Search ... basic land card ... onto the battlefield, then shuffle. If kicked, instead search for up to two ..." (Primal Growth)
 *   CR 614.15, 611.2a, 613.4c       "All creatures get -2/-2 until end of turn. If you have the city's blessing, instead only creatures your opponents control get -2/-2 ..." (Golden Demise)
 *   CR 614.1a, 614.5, 701.44a       "If a creature you control would explore, instead it explores, then it explores again." (Topography Tracker)
 *   CR 614.1a, 111.2, 611.2a        "Each token that would be created under an opponent's control this turn is created under your control instead." (Crafty Cutpurse)
 *   CR 614.1a, 614.12, 110.2        "If a creature would enter the battlefield under an opponent's control this turn, it enters under your control instead." (Gather Specimens)
 *   CR 614.1a, 122.1, 121.6         "If one or more counters would be put on a permanent your team controls, that many plus one ... are put on that permanent instead." (Pir, Imaginative Rascal)
 *   CR 614.1a, 614.6, 700.4, 122.1  "If a creature an opponent controls would die, instead exile it and put a number of +1/+1 counters equal to that creature's power on ~." (Ravenous Slime)
 *   CR 614.1a, 614.6, 104.3, 701.24a "If you would lose the game, instead shuffle your hand, your graveyard, and all permanents you own into your library, then draw seven cards ..." (Lich's Mirror)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean; x?: number; players?: PlayerId[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      // (the targets are chosen one requirement at a time)
      const d = p as unknown as { players: PlayerId[]; objects: ObjectId[]; min: number };
      const pl = (o.players ?? []).find((x) => d.players.includes(x));
      const ob = targets.find((x) => d.objects.includes(x));
      if (pl !== undefined) { (o.players ?? []).splice((o.players ?? []).indexOf(pl), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: pl }] }); }
      else if (ob !== undefined) { targets.splice(targets.indexOf(ob), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ob }] }); }
      else s = answer(s, { kind: 'chooseTargets', targets: d.min === 0 ? [] : d.players.length > 0 ? [{ kind: 'player', id: d.players[0]! }] : [{ kind: 'object', id: d.objects[0]! }] });
    }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'assignDamage') s = answer(s, { kind: 'assignDamage', amounts: p.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? p.amount : 0 })) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const lib = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const gy = (s: GameState, p: PlayerId): number => s.zones.graveyard[p]!.length;
const byName = (s: GameState, name: string, p?: PlayerId): ObjectId[] => (p ? findAll(s, name, 'battlefield', p) : s.zones.battlefield.filter((id) => chars(s, id).name === name));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;


const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const ISLAND = card('Test Island', 'Basic Land — Island', '{T}: Add {U}.');
const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
const cast = (s: GameState, name: string, from: 'hand' | 'graveyard' = 'hand', p: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player: p, card: find(s, name, from, p) });
/** Permanents of that name CONTROLLED by the player (an object may be owned by another player). */
const nBf = (s: GameState, name: string): ((p: PlayerId) => number) => (p) => s.zones.battlefield.filter((id) => chars(s, id).name === name && s.objects[id]!.controller === p).length;

// ---- Worship / Serra the Benevolent ---------------------------------------------------------------------------------------------------------------------------------
const WORSHIP = card('Test Worship', 'Enchantment', 'If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead.');
const BOLT = card('Test Bolt', 'Sorcery', 'Test Bolt deals 25 damage to target player.');
describe('CR 120.3a, 614.1a, 104.3b: "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead."', () => {
  it('is fully automated', () => { expect(noManual(WORSHIP) && WORSHIP.automation.level === 'full').toBe(true); });
  const hit = (mine: string[], life0 = 20): GameState => {
    const s0 = scenario([], { defs: [WORSHIP, BOLT, BEAR], life: life0, p1: { hand: ['Test Bolt'], battlefield: ['Test Worship', ...mine] } });
    return resolveAll(cast(s0, 'Test Bolt'), { players: ['p1'] });
  };
  it('with a creature you control, 25 damage leaves you at 1 life and in the game', () => {
    const s = hit(['Test Plain Bear']);
    expect(life(s, 'p1')).toBe(1);
    expect(s.result == null).toBe(true);
  });
  it('negative: with no creature you control, the same damage kills you (the condition decides as the damage would be dealt)', () => {
    const s = hit([]);
    expect(s.result != null || life(s, 'p1') <= 0).toBe(true);
  });
  it('a player with 1 life takes the damage as normal-looking floor: stays at 1, not lower', () => {
    expect(life(hit(['Test Plain Bear'], 1), 'p1')).toBe(1);
  });
});
const SERRA = card('Test Serra', 'Planeswalker — Test', '−6: You get an emblem with "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead."', { loyalty: '6' });
describe('Serra the Benevolent: the emblem holds the same reading', () => {
  it('is fully automated', () => { expect(noManual(SERRA)).toBe(true); });
});

// ---- Primal Growth --------------------------------------------------------------------------------------------------------------------------------------------------
const GROWTH = card('Test Growth', 'Sorcery', 'Kicker {1}\nSearch your library for a basic land card, put that card onto the battlefield, then shuffle. If this spell was kicked, instead search your library for up to two basic land cards, put them onto the battlefield, then shuffle.', { cost: '{G}' });
describe('CR 614.15, 701.23a, 702.33d: "Search ... for a basic land card, put it onto the battlefield, then shuffle. If this spell was kicked, instead search for up to two basic land cards ..."', () => {
  it('is fully automated', () => { expect(noManual(GROWTH) && GROWTH.automation.level === 'full').toBe(true); });
  const play = (kick: boolean): GameState => {
    const s0 = scenario([], { defs: [GROWTH, FOREST, ISLAND], p1: { hand: ['Test Growth'], battlefield: ['Test Forest', 'Test Forest', 'Test Forest'], library: Array.from({ length: 6 }, () => 'Test Forest') } });
    return resolveAll(cast(s0, 'Test Growth'), { yes: kick });
  };
  it('not kicked: one basic land onto the battlefield', () => { expect(nBf(play(false), 'Test Forest')('p1')).toBe(3 + 1); });
  it('kicked: two basic lands instead (not three: the single search is replaced, not added to)', () => { expect(nBf(play(true), 'Test Forest')('p1')).toBe(3 + 2); });
});

// ---- Golden Demise --------------------------------------------------------------------------------------------------------------------------------------------------
const DEMISE = card('Test Demise', 'Sorcery', "Ascend\nAll creatures get -2/-2 until end of turn. If you have the city's blessing, instead only creatures your opponents control get -2/-2 until end of turn.", { cost: '{0}' });
describe('CR 614.15, 611.2a, 613.4c: "All creatures get -2/-2 until end of turn. If you have the city\'s blessing, instead only creatures your opponents control get -2/-2 ..."', () => {
  it('is fully automated', () => { expect(noManual(DEMISE) && DEMISE.automation.level === 'full').toBe(true); });
  const play = (lands: number): GameState => {
    const s0 = scenario([], { defs: [DEMISE, BEAR, ISLAND], p1: { hand: ['Test Demise'], battlefield: ['Test Plain Bear', ...Array.from({ length: lands }, () => 'Test Island')] }, p2: { battlefield: ['Test Plain Bear'] } });
    return resolveAll(cast(s0, 'Test Demise'));
  };
  it('without the city\'s blessing (fewer than ten permanents): every creature gets -2/-2, both bears die', () => {
    const s = play(2);
    expect(nBf(s, 'Test Plain Bear')('p1') + nBf(s, 'Test Plain Bear')('p2')).toBe(0);
  });
  it("with the city's blessing (ten permanents): only the opponent's creature gets -2/-2: yours lives, theirs dies", () => {
    const s = play(10);
    expect(nBf(s, 'Test Plain Bear')('p1')).toBe(1);
    expect(nBf(s, 'Test Plain Bear')('p2')).toBe(0);
  });
});

// ---- Topography Tracker ---------------------------------------------------------------------------------------------------------------------------------------------
const TRACKER = card('Test Tracker', 'Creature — Scout', 'If a creature you control would explore, instead it explores, then it explores again.', { pt: ['1', '1'] });
const EXPLORER = card('Test Explorer', 'Sorcery', 'Target creature you control explores.');
describe('CR 614.1a, 614.5, 701.44a: "If a creature you control would explore, instead it explores, then it explores again."', () => {
  it('is fully automated', () => { expect(noManual(TRACKER) && TRACKER.automation.level === 'full').toBe(true); });
  const setup = (withTracker: boolean): GameState => scenario([], { defs: [TRACKER, EXPLORER, BEAR, ISLAND], p1: { hand: ['Test Explorer'], battlefield: ['Test Plain Bear', ...(withTracker ? [{ name: 'Test Tracker', since: -1 }] : [])], library: Array.from({ length: 10 }, () => 'Test Island') } });
  const play = (withTracker: boolean): { before: GameState; after: GameState } => {
    const s0 = setup(withTracker);
    const bear = byName(s0, 'Test Plain Bear', 'p1')[0]!;
    return { before: s0, after: resolveAll(cast(s0, 'Test Explorer'), { targets: [bear] }) };
  };
  it('the land revealed twice: two cards in hand (the library is lands), the creature explores two times', () => {
    const { before, after } = play(true);
    expect(hand(after, 'p1') - (hand(before, 'p1') - 1)).toBe(2);
  });
  it('negative: without the tracker it explores once (one land to hand)', () => {
    const { before, after } = play(false);
    expect(hand(after, 'p1') - (hand(before, 'p1') - 1)).toBe(1);
  });
});

// ---- Crafty Cutpurse ------------------------------------------------------------------------------------------------------------------------------------------------
const CUTPURSE = card('Test Cutpurse', 'Creature — Faerie Rogue', 'Flash\nWhen Test Cutpurse enters, each token that would be created under an opponent\'s control this turn is created under your control instead.', { pt: ['3', '2'] });
const GIVER = card('Test Giver', 'Sorcery', 'Each opponent creates a 1/1 white Soldier creature token.');
describe('CR 614.1a, 111.2, 611.2a: "Each token that would be created under an opponent\'s control this turn is created under your control instead."', () => {
  it('is fully automated', () => { expect(noManual(CUTPURSE) && CUTPURSE.automation.level === 'full').toBe(true); });
  const play = (cut: boolean): GameState => {
    let s = scenario([], { defs: [CUTPURSE, GIVER], p1: { hand: [...(cut ? ['Test Cutpurse'] : []), 'Test Giver'] } });
    if (cut) s = resolveAll(cast(s, 'Test Cutpurse'));
    return resolveAll(cast(s, 'Test Giver'));
  };
  it('the token an opponent would create is created under your control', () => {
    const s = play(true);
    expect(byName(s, 'Soldier Token', 'p1').length + byName(s, 'Soldier', 'p1').length).toBe(1);
    expect(byName(s, 'Soldier Token', 'p2').length + byName(s, 'Soldier', 'p2').length).toBe(0);
  });
  it('negative: without the Cutpurse the opponent keeps the token', () => {
    const s = play(false);
    expect(byName(s, 'Soldier Token', 'p2').length + byName(s, 'Soldier', 'p2').length).toBe(1);
  });
});

describe('CR 616.1b: the control-changing token replacement is applied first (Crafty Cutpurse ruling)', () => {
  it('an opponent\'s doubling effect is not applied first: the replacement is class 1 (who controls it), so the engine offers it before the doubler', async () => {
    const { klassOf } = await import('../../../src/effects/replacements');
    expect(klassOf({ s: 'replace', replaces: { ev: 'createToken', player: 'opponent' }, body: { b: 'modify', to: { ref: 'you' } } })).toBe(1);
    expect(klassOf({ s: 'replace', replaces: { ev: 'draw', player: 'opponent' }, body: { b: 'modify', to: { ref: 'you' } } })).toBe(4);
  });
});

// ---- Gather Specimens -----------------------------------------------------------------------------------------------------------------------------------------------
const SPECIMENS = card('Test Specimens', 'Instant', 'If a creature would enter the battlefield under an opponent\'s control this turn, it enters under your control instead.');
const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from a graveyard to the battlefield under its owner\'s control.');
describe('CR 614.1a, 614.12, 110.2: "If a creature would enter the battlefield under an opponent\'s control this turn, it enters under your control instead."', () => {
  it('is fully automated', () => { expect(noManual(SPECIMENS) && SPECIMENS.automation.level === 'full').toBe(true); });
  const play = (fromOpp: boolean, specimens = true): GameState => {
    let s = scenario([], { defs: [SPECIMENS, RAISE, BEAR], p1: { hand: [...(specimens ? ['Test Specimens'] : []), 'Test Raise'], graveyard: fromOpp ? [] : ['Test Plain Bear'] }, p2: { graveyard: fromOpp ? ['Test Plain Bear'] : [] } });
    if (specimens) s = resolveAll(cast(s, 'Test Specimens'));
    const target = findAll(s, 'Test Plain Bear', 'graveyard', fromOpp ? 'p2' : 'p1')[0]!;
    return resolveAll(cast(s, 'Test Raise'), { targets: [target] });
  };
  it('an opponent\'s creature that would enter under their control enters under yours', () => {
    const s = play(true);
    expect(nBf(s, 'Test Plain Bear')('p1')).toBe(1);
    expect(nBf(s, 'Test Plain Bear')('p2')).toBe(0);
  });
  it('negative: your own creature entering under your control is unchanged', () => { expect(nBf(play(false), 'Test Plain Bear')('p1')).toBe(1); });
  it('negative: without the spell the opponent\'s creature enters under their control', () => { expect(nBf(play(true, false), 'Test Plain Bear')('p2')).toBe(1); });
});

// ---- Pir, Imaginative Rascal ----------------------------------------------------------------------------------------------------------------------------------------
const PIR = card('Test Pir', 'Creature — Human', 'If one or more counters would be put on a permanent your team controls, that many plus one of each of those kinds of counters are put on that permanent instead.', { pt: ['1', '1'] });
const GROW = card('Test Grow', 'Sorcery', 'Put a +1/+1 counter on target creature.');
describe('CR 614.1a, 122.1, 121.6: "If one or more counters would be put on a permanent your team controls, that many plus one of each of those kinds of counters are put on that permanent instead."', () => {
  it('is fully automated', () => { expect(noManual(PIR) && PIR.automation.level === 'full').toBe(true); });
  const play = (own: boolean): ObjectId[] => {
    const s0 = scenario([], { defs: [PIR, GROW, BEAR], p1: { hand: ['Test Grow'], battlefield: ['Test Pir', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const bear = byName(s0, 'Test Plain Bear', own ? 'p1' : 'p2')[0]!;
    const s = resolveAll(cast(s0, 'Test Grow'), { targets: [bear] });
    return [s.objects[bear]!.counters['+1/+1'] ?? 0] as never;
  };
  it('a +1/+1 counter put on a creature you control: two counters', () => { expect(play(true)).toEqual([2]); });
  it('negative: on a creature an opponent controls: one counter', () => { expect(play(false)).toEqual([1]); });
});

// ---- Ravenous Slime -------------------------------------------------------------------------------------------------------------------------------------------------
const SLIME = card('Test Slime', 'Creature — Ooze', 'If a creature an opponent controls would die, instead exile it and put a number of +1/+1 counters equal to that creature\'s power on Test Slime.', { pt: ['1', '1'] });
const KILL = card('Test Kill', 'Sorcery', 'Destroy target creature.');
describe('CR 614.1a, 614.6, 700.4, 122.1: "If a creature an opponent controls would die, instead exile it and put a number of +1/+1 counters equal to that creature\'s power on ~."', () => {
  it('is fully automated', () => { expect(noManual(SLIME) && SLIME.automation.level === 'full').toBe(true); });
  const play = (opp: boolean): { s: GameState; slime: ObjectId; bear: ObjectId } => {
    const s0 = scenario([], { defs: [SLIME, KILL, BEAR], p1: { hand: ['Test Kill'], battlefield: ['Test Slime', ...(opp ? [] : ['Test Plain Bear'])] }, p2: { battlefield: opp ? ['Test Plain Bear'] : [] } });
    const bear = byName(s0, 'Test Plain Bear')[0]!;
    return { s: resolveAll(cast(s0, 'Test Kill'), { targets: [bear] }), slime: byName(s0, 'Test Slime')[0]!, bear };
  };
  it("an opponent's creature that would die is exiled and the Slime gets counters equal to its power (2)", () => {
    const { s, slime, bear } = play(true);
    expect(s.objects[bear]?.zone === 'exile' || Object.values(s.objects).some((o) => o.zone === 'exile' && s.defs[o.defId]!.name === 'Test Plain Bear')).toBe(true);
    expect(s.objects[slime]!.counters['+1/+1']).toBe(2);
  });
  it('negative: your own creature dies normally and the Slime gets nothing', () => {
    const { s, slime } = play(false);
    expect(gy(s, 'p1')).toBeGreaterThanOrEqual(2);
    expect(s.objects[slime]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ---- Lich's Mirror --------------------------------------------------------------------------------------------------------------------------------------------------
const MIRROR = card('Test Mirror', 'Artifact', 'If you would lose the game, instead shuffle your hand, your graveyard, and all permanents you own into your library, then draw seven cards and your life total becomes 20.');
describe("CR 614.1a, 614.6, 104.3, 701.24a: \"If you would lose the game, instead shuffle your hand, your graveyard, and all permanents you own into your library, then draw seven cards and your life total becomes 20.\"", () => {
  it('is fully automated', () => { expect(noManual(MIRROR) && MIRROR.automation.level === 'full').toBe(true); });
  const play = (target: PlayerId): GameState => {
    const s0 = scenario([], { defs: [MIRROR, BOLT, BEAR], life: 3, p1: { hand: ['Test Bolt', 'Test Plain Bear'], graveyard: ['Test Plain Bear'], battlefield: ['Test Mirror', 'Test Plain Bear'] } });
    return resolveAll(cast(s0, 'Test Bolt'), { players: [target] });
  };
  it('you would lose to damage: the game goes on, 7 cards in hand, life 20, nothing of yours left on the battlefield or in the graveyard', () => {
    const s = play('p1');
    expect(s.result == null).toBe(true);
    expect(life(s, 'p1')).toBe(20);
    expect(hand(s, 'p1')).toBe(7);
    expect(gy(s, 'p1')).toBe(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(0);
  });
  it('negative: an opponent losing the game is not replaced', () => {
    const s = play('p2');
    expect(s.result != null || life(s, 'p2') <= 0).toBe(true);
    expect(life(s, 'p1')).toBe(3);
  });
});
