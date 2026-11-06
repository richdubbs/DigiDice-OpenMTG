/**
 * Commander lane each-player, round edh-next-66: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 101.4, 701.23a   "Each player may search their library for up to two basic land cards, put them onto the battlefield, then shuffle." (Veteran Explorer)
 *   CR 101.4, 107.3     "Each player may search their library for up to X basic land cards and put them onto the battlefield tapped." (New Frontiers)
 *   CR 101.4, 701.20a   "Each player may search ... up to X creature cards, reveal those cards, put them into their hand, then shuffle." (Weird Harvest)
 *   CR 101.4, 608.2d    "Each opponent may put any number of ... cards from their hand onto the battlefield." (Tempting Wurm)
 *   CR 701.9a, 400.3    "Each player discards their hand, then returns up to three cards from their graveyard to their hand." (Ill-Gotten Gains)
 *   CR 701.21a, 400.7j  "Each player exiles all artifact cards from their graveyard, then sacrifices all artifacts, then puts all cards they exiled this way onto the battlefield." (Scrap Mastery)
 *   CR 400.7, 110.2a    "Each player returns to the battlefield all ... cards in their graveyard that were put there from the battlefield this turn." (Second Sunrise)
 *   CR 508.1, 611.3a    "Each opponent who cast a spell this turn can't attack with creatures." (Angelic Arbiter)
 *   CR 701.24a, 108.3   "Each player shuffles their hand, graveyard, and all permanents they own into their library, then draws seven cards." (Sway of the Stars)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const bfNames = (s: GameState, p?: PlayerId): string[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p).map((id) => nameOf(s, id));
const count = (xs: string[], n: string): number => xs.filter((x) => x === n).length;

interface Picks { yes?: boolean | Record<string, boolean>; x?: number; take?: 'max' | 'min' | 'none' | Record<string, 'max' | 'min' | 'none'> }
/** Answer every decision until a player has priority and the stack is empty: yes/no by `yes` (per player), choices of objects by `take` (per player), X by `x`, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 200 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending as unknown as { kind: string; player: string; options?: ObjectId[]; min?: number; max?: number };
    const per = <T,>(v: T | Record<string, T> | undefined, d: T): T => (v !== null && typeof v === 'object' ? (v as Record<string, T>)[p.player] ?? d : v ?? d);
    if (p.kind === 'priority') s = pass(s);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: per(o.yes, true) } as DecisionAnswer);
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min ?? 0 } as never);
    else if (p.kind === 'chooseObjects') {
      const take = per(o.take, 'max');
      const n = take === 'none' ? 0 : take === 'min' ? p.min ?? 0 : Math.min(p.max ?? (p.options ?? []).length, (p.options ?? []).length);
      s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, n) } as DecisionAnswer);
    } else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
const cast = (s: GameState, name: string, o: Picks = {}, player: PlayerId = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), o);

const BASIC = card('Test Forest', 'Basic Land — Forest', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const target = (id: ObjectId) => ({ kind: 'object', id }) as const;

describe('CR 101.4, 701.23a: "Each player may search their library for up to two basic land cards, put them onto the battlefield, then shuffle." (Veteran Explorer)', () => {
  const EXPLORER = card('Test Explorer', 'Creature — Scout', 'When this creature dies, each player may search their library for up to two basic land cards, put them onto the battlefield, then shuffle.', { pt: ['1', '1'] });
  const defs = [EXPLORER, KILL, BASIC, BEAR];
  it('is automated', () => { expect(noManual(EXPLORER)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Kill'], battlefield: ['Test Explorer'], library: ['Test Forest', 'Test Forest', 'Test Forest', 'Test Bear'] }, p2: { library: ['Test Forest', 'Test Forest', 'Test Forest'] }, p3: { library: ['Test Forest', 'Test Bear'] } } });
  const kill = (s0: GameState, o: Picks): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [target(find(s0, 'Test Explorer', 'battlefield', 'p1'))] } as DecisionAnswer);
    return drive(s, o);
  };
  it('every player who agrees puts up to two basic lands from their own library onto the battlefield (the player with one basic gets one)', () => {
    const s = kill(start(), {});
    expect(count(bfNames(s, 'p1'), 'Test Forest')).toBe(2);
    expect(count(bfNames(s, 'p2'), 'Test Forest')).toBe(2);
    expect(count(bfNames(s, 'p3'), 'Test Forest')).toBe(1);
    expect(zoneNames(s, 'library', 'p3')).toContain('Test Bear');
    expect(bfNames(s)).not.toContain('Test Explorer');
  });
  it('a player who declines searches for nothing: no land arrives for them', () => {
    const s = kill(start(), { yes: { p2: false } });
    expect(count(bfNames(s, 'p2'), 'Test Forest')).toBe(0);
    expect(count(bfNames(s, 'p1'), 'Test Forest')).toBe(2);
  });
});

describe('CR 101.4, 107.3, 701.23a: "Each player may search their library for up to X basic land cards and put them onto the battlefield tapped. Then each player who searched their library this way shuffles." (New Frontiers)', () => {
  const FRONTIERS = card('Test Frontiers', 'Sorcery', 'Each player may search their library for up to X basic land cards and put them onto the battlefield tapped. Then each player who searched their library this way shuffles.', { cost: '{X}' });
  const defs = [FRONTIERS, BASIC];
  it('is automated', () => { expect(noManual(FRONTIERS)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Frontiers'], battlefield: ['Plains', 'Plains', 'Plains'], library: ['Test Forest', 'Test Forest', 'Test Forest'] }, p2: { library: ['Test Forest', 'Test Forest', 'Test Forest'] }, p3: { library: ['Test Forest'] } } });
  it('with X = 2 every player who agrees puts up to two basic lands onto the battlefield TAPPED', () => {
    const s = cast(start(), 'Test Frontiers', { x: 2 });
    for (const [p, n] of [['p1', 2], ['p2', 2], ['p3', 1]] as const) {
      const lands = s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && nameOf(s, id) === 'Test Forest');
      expect(lands.length, p).toBe(n);
      for (const id of lands) expect(s.objects[id]!.tapped, `${p} land tapped`).toBe(true);
    }
  });
  it('with X = 0 nothing is fetched; a player who declines fetches nothing', () => {
    const s0 = cast(start(), 'Test Frontiers', { x: 0 });
    expect(count(bfNames(s0), 'Test Forest')).toBe(0);
    const s1 = cast(start(), 'Test Frontiers', { x: 2, yes: { p2: false } });
    expect(count(bfNames(s1, 'p2'), 'Test Forest')).toBe(0);
    expect(count(bfNames(s1, 'p1'), 'Test Forest')).toBe(2);
  });
});

describe('CR 101.4, 701.20a, 701.23a: "Each player may search their library for up to X creature cards, reveal those cards, put them into their hand, then shuffle." (Weird Harvest)', () => {
  const HARVEST = card('Test Harvest', 'Instant', 'Each player may search their library for up to X creature cards, reveal those cards, put them into their hand, then shuffle.', { cost: '{X}' });
  const defs = [HARVEST, BEAR, BASIC];
  it('is automated', () => { expect(noManual(HARVEST)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Harvest'], battlefield: ['Plains', 'Plains'], library: ['Test Bear', 'Test Bear', 'Test Forest'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear'] }, p3: { library: ['Test Forest'] } } });
  it('every player takes up to X creature cards from their own library into their own hand; a player with none takes none', () => {
    const s = cast(start(), 'Test Harvest', { x: 2 });
    expect(count(zoneNames(s, 'hand', 'p1'), 'Test Bear')).toBe(2);
    expect(count(zoneNames(s, 'hand', 'p2'), 'Test Bear')).toBe(2);
    expect(count(zoneNames(s, 'hand', 'p3'), 'Test Bear')).toBe(0);
    expect(count(zoneNames(s, 'library', 'p2'), 'Test Bear')).toBe(1);
  });
  it('a player who declines takes nothing', () => {
    const s = cast(start(), 'Test Harvest', { x: 2, yes: { p2: false } });
    expect(count(zoneNames(s, 'hand', 'p2'), 'Test Bear')).toBe(0);
    expect(count(zoneNames(s, 'hand', 'p1'), 'Test Bear')).toBe(2);
  });
});

describe('CR 101.4, 608.2d, 110.2a: "When this creature enters, each opponent may put any number of artifact, creature, enchantment, and/or land cards from their hand onto the battlefield." (Tempting Wurm)', () => {
  const WURM = card('Test Wurm', 'Creature — Wurm', 'When this creature enters, each opponent may put any number of artifact, creature, enchantment, and/or land cards from their hand onto the battlefield.', { pt: ['1', '1'] });
  const SPELL = card('Test Charm', 'Instant', 'You gain 1 life.');
  const defs = [WURM, BEAR, BASIC, SPELL];
  it('is automated', () => { expect(noManual(WURM)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Wurm', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Test Forest', 'Test Charm'] }, p3: { hand: ['Test Bear', 'Test Charm'] } } });
  it('each opponent puts the permanent cards of their hand onto the battlefield (not the instant); the caster puts none of theirs', () => {
    const s = cast(start(), 'Test Wurm');
    expect(count(bfNames(s, 'p2'), 'Test Bear') + count(bfNames(s, 'p2'), 'Test Forest')).toBe(2);
    expect(count(bfNames(s, 'p3'), 'Test Bear')).toBe(1);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Charm']);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Bear');
    expect(bfNames(s, 'p1')).toEqual(['Test Wurm']);
  });
  it('an opponent may choose none: nothing leaves their hand', () => {
    const s = cast(start(), 'Test Wurm', { take: 'none' });
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p2')).toHaveLength(3);
  });
});

describe('CR 701.9a, 400.3, 101.4: "Exile ~. Each player discards their hand, then returns up to three cards from their graveyard to their hand." (Ill-Gotten Gains)', () => {
  const GAINS = card('Test Gains', 'Sorcery', 'Exile this spell. Each player discards their hand, then returns up to three cards from their graveyard to their hand.');
  const defs = [GAINS, BEAR, BASIC];
  it('is automated', () => { expect(noManual(GAINS)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Gains', 'Test Bear', 'Test Forest'], graveyard: ['Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bear'], graveyard: ['Test Forest', 'Test Forest', 'Test Forest', 'Test Forest'] }, p3: { hand: ['Test Forest'] } } });
  it('the hands are discarded first (so they can come back), each player then takes up to three cards from their own graveyard into their hand; the spell is exiled', () => {
    const s = cast(start(), 'Test Gains');
    expect(zoneNames(s, 'hand', 'p1').sort()).toEqual(['Test Bear', 'Test Bear', 'Test Forest']);
    expect(zoneNames(s, 'hand', 'p2')).toHaveLength(3);
    expect(zoneNames(s, 'graveyard', 'p2')).toHaveLength(3);
    expect(zoneNames(s, 'hand', 'p3')).toEqual(['Test Forest']);
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Gains')).toBe(true);
  });
  it('a player who chooses no card keeps an empty hand and everything in the graveyard', () => {
    const s = cast(start(), 'Test Gains', { take: 'none' });
    expect(zoneNames(s, 'hand', 'p2')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p2')).toHaveLength(6);
  });
});

describe('CR 701.21a, 400.7j, 608.2c: "Each player exiles all artifact cards from their graveyard, then sacrifices all artifacts they control, then puts all cards they exiled this way onto the battlefield." (Scrap Mastery)', () => {
  const MASTERY = card('Test Mastery', 'Sorcery', 'Each player exiles all artifact cards from their graveyard, then sacrifices all artifacts they control, then puts all cards they exiled this way onto the battlefield.');
  const GEAR = card('Test Gear', 'Artifact', '');
  const defs = [MASTERY, GEAR, BEAR];
  it('is automated', () => { expect(noManual(MASTERY)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Mastery'], battlefield: ['Test Gear'], graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Gear', 'Test Gear'], graveyard: ['Test Gear'] }, p3: { graveyard: ['Test Gear', 'Test Bear'] } } });
  it('artifacts on the battlefield are sacrificed, artifact cards from graveyards come back (each under its owner\'s control); non-artifact cards are untouched', () => {
    const s = cast(start(), 'Test Mastery');
    expect(count(bfNames(s, 'p1'), 'Test Gear')).toBe(0);
    expect(count(bfNames(s, 'p2'), 'Test Gear')).toBe(1);
    expect(count(bfNames(s, 'p3'), 'Test Gear')).toBe(1);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Gear', 'Test Mastery'].filter((n) => n !== 'Test Mastery').concat(['Test Mastery']).sort());
    expect(zoneNames(s, 'graveyard', 'p3')).toEqual(['Test Bear']);
    expect(zoneNames(s, 'graveyard', 'p2')).toHaveLength(2);
  });
});

describe('CR 400.7, 110.2a, 608.2c: "Each player returns to the battlefield all artifact, creature, enchantment, and land cards in their graveyard that were put there from the battlefield this turn." (Second Sunrise)', () => {
  const SUNRISE = card('Test Sunrise', 'Instant', 'Each player returns to the battlefield all artifact, creature, enchantment, and land cards in their graveyard that were put there from the battlefield this turn.');
  const defs = [SUNRISE, BEAR, KILL, BASIC];
  it('is automated', () => { expect(noManual(SUNRISE)).toEqual([]); });
  it('a creature that died this turn comes back under its owner\'s control; a card that was in the graveyard already does not', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Kill', 'Test Sunrise'], graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Bear'], graveyard: ['Test Forest'] }, p3: { battlefield: ['Test Bear'] } } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') } as never);
    s = answer(s, { kind: 'chooseTargets', targets: [target(find(s0, 'Test Bear', 'battlefield', 'p2'))] } as DecisionAnswer);
    s = drive(s);
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Bear');
    s = cast(s, 'Test Sunrise');
    expect(bfNames(s, 'p2')).toEqual(['Test Bear']);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Forest']);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear');
    expect(bfNames(s, 'p1')).toEqual([]);
    expect(bfNames(s, 'p3')).toEqual(['Test Bear']);
  });
});

describe('CR 508.1, 611.3a, 601.2: "Each opponent who cast a spell this turn can\'t attack with creatures. Each opponent who attacked with a creature this turn can\'t cast spells." (Angelic Arbiter)', () => {
  const ARBITER = card('Test Arbiter', 'Creature — Angel', "Each opponent who cast a spell this turn can't attack with creatures.\nEach opponent who attacked with a creature this turn can't cast spells.", { pt: ['5', '5'] });
  const CHARM = card('Test Charm', 'Instant', 'You gain 1 life.');
  const defs = [ARBITER, BEAR, CHARM];
  it('is automated', () => { expect(noManual(ARBITER)).toEqual([]); });
  // p1 has the Arbiter; it is p2's turn 2; p2 holds an instant
  const setup = (): GameState => advanceTo(scenario(['Plains'], { p1: { battlefield: ['Test Arbiter'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Charm', 'Test Charm'] }, defs }), 2, 'main1');
  it('an opponent who cast a spell this turn can\'t attack with creatures; one who did not cast can', () => {
    let s = drive(act(setup(), { type: 'cast', player: 'p2', card: find(setup(), 'Test Charm', 'hand', 'p2') } as never));
    s = toDeclareAttackers(s);
    expect(() => declareAttackers(s, [[find(s, 'Test Bear', 'battlefield', 'p2'), 'p1']])).toThrow();
    const t = toDeclareAttackers(setup());
    expect(() => declareAttackers(t, [[find(t, 'Test Bear', 'battlefield', 'p2'), 'p1']])).not.toThrow();
  });
  it('an opponent who attacked with a creature this turn can\'t cast spells; before attacking they can', () => {
    const s0 = setup();
    // the instant can be cast before attackers (a different player-turn check is the first test); here the opponent attacks first
    let s = toDeclareAttackers(s0);
    s = drive(declareAttackers(s, [[find(s, 'Test Bear', 'battlefield', 'p2'), 'p1']]));
    expect(() => act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Charm', 'hand', 'p2') } as never)).toThrow();
    const before = setup(); // the same position without the attack: the opponent can cast
    expect(() => act(before, { type: 'cast', player: 'p2', card: find(before, 'Test Charm', 'hand', 'p2') } as never)).not.toThrow();
  });
  it('the controller of the Arbiter is not stopped (it says "each opponent")', () => {
    const s0 = advanceTo(scenario(['Plains'], { p1: { battlefield: ['Test Arbiter', 'Test Bear'], hand: ['Test Charm'] }, p2: { hand: [] }, defs }), 1, 'main1');
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Charm', 'hand', 'p1') } as never));
    const t = toDeclareAttackers(s);
    expect(() => declareAttackers(t, [[find(t, 'Test Bear', 'battlefield', 'p1'), 'p2']])).not.toThrow();
  });
});

describe('CR 701.24a, 108.3, 401.1: "Each player shuffles their hand, graveyard, and all permanents they own into their library, then draws seven cards." (Sway of the Stars)', () => {
  const SWAY = card('Test Sway', 'Sorcery', "Each player shuffles their hand, graveyard, and all permanents they own into their library, then draws seven cards. Each player's life total becomes 7.");
  const GEAR = card('Test Gear', 'Artifact', '');
  const defs = [SWAY, BEAR, GEAR, BASIC];
  it('is automated', () => { expect(noManual(SWAY)).toEqual([]); });
  it('every player\'s hand, graveyard and OWNED permanents go to their own library and each draws seven; every life total becomes 7', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Sway', 'Test Bear'], battlefield: ['Test Gear'], graveyard: ['Test Bear'] }, p2: { hand: ['Test Forest'], battlefield: ['Test Bear'], graveyard: ['Test Forest'] }, p3: { hand: [] } } });
    // p2 controls a Gear that p1 owns? not needed: ownership is checked through the Bears
    const s = cast(s0, 'Test Sway');
    for (const p of ['p1', 'p2', 'p3'] as const) {
      expect(zoneNames(s, 'hand', p), p).toHaveLength(7);
      expect(s.players.find((x) => x.id === p)!.life, p).toBe(7);
    }
    expect(bfNames(s)).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Sway']);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual([]);
  });
  it('a permanent goes to the library of its OWNER, not its controller', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Sway'] }, p2: { battlefield: ['Test Bear'] } }, setup: (st) => {
      const id = st.zones.battlefield.find((x) => st.objects[x]!.controller === 'p2')!;
      st.objects[id]!.controller = 'p1';
    } });
    const s = cast(s0, 'Test Sway');
    const bears = Object.values(s.objects).filter((o) => nameOf(s, o.id) === 'Test Bear');
    expect(bears).toHaveLength(1);
    expect(bears[0]!.owner).toBe('p2');
    const inP1 = [...s.zones.library['p1']!, ...s.zones.hand['p1']!].includes(bears[0]!.id);
    const inP2 = [...s.zones.library['p2']!, ...s.zones.hand['p2']!].includes(bears[0]!.id);
    expect(inP2).toBe(true);
    expect(inP1).toBe(false);
  });
  it('everything is shuffled in before anybody draws: an opponent\'s "draw replacement" creature, owned by a LATER player, is gone before the caster draws (review)', () => {
    const THIEF = card('Test Thief', 'Creature — Rogue', 'If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.', { pt: ['3', '1'] });
    const s0 = mpScenario({ players: 3, defs: [...defs, THIEF], zones: { p1: { hand: ['Test Sway'] }, p2: { battlefield: ['Test Thief'] }, p3: {} } });
    const s = cast(s0, 'Test Sway');
    for (const p of ['p1', 'p2', 'p3'] as const) expect(zoneNames(s, 'hand', p), p).toHaveLength(7);
  });
  it('a token is not shuffled in and can\'t be drawn (rulings 2005-02-01): after the spell no token is left and every hand has seven real cards', () => {
    const MAKER = card('Test Maker', 'Sorcery', 'Create two 1/1 white Spirit creature tokens.');
    const s0 = mpScenario({ players: 3, defs: [...defs, MAKER], zones: { p1: { hand: ['Test Maker', 'Test Sway'] } } });
    let s = cast(s0, 'Test Maker');
    expect(bfNames(s, 'p1')).toHaveLength(2);
    s = cast(s, 'Test Sway');
    expect(Object.values(s.objects).filter((o) => o.kind === 'token')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p1')).toHaveLength(7);
  });
});
