/**
 * Commander top-rank second pass 3, edh-next-95: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler, each with its negative case. CR cites are from the text of 2026-09-25 where marked "checked", otherwise from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, pool, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

interface Picks { yes?: boolean; targets?: TargetChoice[][]; objects?: ObjectId[][] }
/** Answer every decision until a player has priority: yes/no by `yes`, targets and chosen objects in order, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  const cq = [...(o.objects ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: (ObjectId | { id: string })[]; min?: number; max?: number; items?: { id: string }[] };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: cq.shift() ?? (p.options as ObjectId[]).slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((i) => i.id) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const onBf = (s: GameState, name: string, controller: 'p1' | 'p2'): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && chars(s, id).name === name);
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => chars(s, id).name);
void advanceTo; void pool;

describe('CR 106.1, 106.4, 603.2 (unverified): "that player adds {C} for each artifact they control" (Blinkmoth Urn)', () => {
  const URN = card('Test Urn', 'Artifact', "At the beginning of each player's first main phase, if this artifact is untapped, that player adds {C} for each artifact they control.", { cost: '{5}' });
  const ROCK = card('Test Rock', 'Artifact', '', { cost: '{1}' });
  const defs = [URN, ROCK];
  it('is automated', () => expect(automated(URN)).toBe(true));
  it('the active player adds {C} for each artifact they control, the Urn itself included', () => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Urn', 'Test Rock', 'Test Rock'] }, p2: { battlefield: ['Test Rock'] }, defs });
    const s = resolveAll(advanceTo(s0, 2, 'main1'));
    // turn 2 is the second player's: they control one artifact (the Rock), so one {C}
    expect(s.turn.number).toBe(2);
    expect(pool(s, 'p2')).toBe('C');
    expect(pool(s, 'p1')).toBe('');
  });
  it('NEGATIVE: a tapped Urn adds nothing (the intervening "if")', () => {
    // the Urn stays tapped in the second player's turn (their untap step untaps their own permanents only)
    const s0 = scenario(['Mountain'], { p1: { battlefield: [{ name: 'Test Urn', tapped: true }, 'Test Rock'] }, p2: { battlefield: ['Test Rock'] }, defs });
    const s = resolveAll(advanceTo(s0, 2, 'main1'));
    expect(pool(s, 'p2')).toBe('');
  });
});

/** Cast `name` from p1's hand with {C} paid from the pool and every choice made by `drive`; the exiled/milled cards offered by a `chooseObjects` are all taken when `all`. */
function castWith(s0: GameState, name: string, o: Picks & { all?: boolean } = {}, mana = 4): GameState {
  for (let i = 0; i < mana; i++) s0.players[0]!.manaPool.push({ type: 'C' } as never);
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number } | null;
    if (p?.kind === 'chooseObjects' && o.all) s = answer(s, { kind: 'chooseObjects', ids: p.options! });
    else s = p?.kind === 'priority' ? pass(s) : drive(s, o);
  }
  return s;
}

describe('CR 608.2d, 406.1, 701.17a (unverified): "put any number of ... cards from among them onto the battlefield" after an exile of the top cards or a mill (Xenagos, the Reveler; Rampant Frogantua)', () => {
  const DIG = card('Test Dig', 'Sorcery', 'Exile the top four cards of your library. You may put any number of creature and/or land cards from among them onto the battlefield.', { cost: '{1}' });
  const MILL = card('Test Mill', 'Sorcery', 'Mill four cards. Put any number of land cards from among them onto the battlefield tapped.', { cost: '{1}' });
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'], cost: '{1}' });
  const ROCK = card('Test Rock', 'Artifact', '', { cost: '{1}' });
  const defs = [DIG, MILL, WOLF, ROCK];
  const library = ['Test Wolf', 'Mountain', 'Test Rock', 'Test Wolf', 'Mountain', 'Mountain'];
  it('are automated', () => { expect(automated(DIG)).toBe(true); expect(automated(MILL)).toBe(true); });
  it('exile: every offered creature and land card may be put onto the battlefield; the artifact card stays exiled', () => {
    const s = castWith(scenario(['Mountain'], { p1: { hand: ['Test Dig'], library }, defs }), 'Test Dig', { all: true });
    expect(onBf(s, 'Test Wolf', 'p1').length).toBe(2);
    expect(onBf(s, 'Mountain', 'p1').length).toBe(1);
    expect(exileNames(s)).toEqual(['Test Rock']);
  });
  it('NEGATIVE: the player may take none, and the cards stay exiled', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Dig'], library }, defs });
    for (let i = 0; i < 4; i++) s0.players[0]!.manaPool.push({ type: 'C' } as never);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dig', 'hand', 'p1') });
    for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const p = s.pending as unknown as { kind: string } | null;
      s = p?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [] }) : p?.kind === 'priority' ? pass(s) : drive(s);
    }
    expect(onBf(s, 'Test Wolf', 'p1').length).toBe(0);
    expect(exileNames(s).length).toBe(4);
  });
  it('mill: the land cards among the milled cards enter tapped; the creature and artifact cards stay in the graveyard', () => {
    const s = castWith(scenario(['Mountain'], { p1: { hand: ['Test Mill'], library }, defs }), 'Test Mill', { all: true });
    const lands = onBf(s, 'Mountain', 'p1');
    expect(lands.length).toBe(1); // the one land card among the four milled cards
    expect(lands.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(s.zones.graveyard.p1!.map((id) => chars(s, id).name).sort()).toEqual(['Test Mill', 'Test Rock', 'Test Wolf', 'Test Wolf'].sort());
  });
});

describe('CR 608.2c, 111.1, 603.4 (unverified): "create a tapped token that\'s a copy of ~ if C. Otherwise, create a tapped 1/1 ..." (Scouring Swarm)', () => {
  const SWARM = card('Test Swarm', 'Creature — Insect', "Whenever you sacrifice a land, create a tapped token that's a copy of this creature if seven or more land cards are in your graveyard. Otherwise, create a tapped 1/1 black Insect creature token with flying.", { pt: ['1', '1'], cost: '{1}' });
  const SAC = card('Test Sacrifice', 'Instant', 'Sacrifice a land.', { cost: '{0}' });
  const defs = [SWARM, SAC];
  const run = (lands: number): GameState => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Sacrifice'], battlefield: ['Test Swarm', 'Mountain'], graveyard: Array(lands).fill('Mountain') as string[] }, defs });
    return castWith(s0, 'Test Sacrifice', {}, 0);
  };
  it('is automated', () => expect(automated(SWARM)).toBe(true));
  it('seven land cards in the graveyard (the sacrificed one counts): a tapped copy of the Swarm', () => {
    const s = run(6);
    const swarms = onBf(s, 'Test Swarm', 'p1');
    expect(swarms.length).toBe(2);
    expect(swarms.filter((id) => s.objects[id]!.tapped).length).toBe(1);
    expect(s.zones.battlefield.filter((id) => Number(chars(s, id).power) === 1 && chars(s, id).keywords.some((k) => k.keyword === 'flying')).length).toBe(0); // no 1/1 Insect with flying
  });
  it('NEGATIVE: fewer than seven: the tapped 1/1 Insect with flying instead, no copy', () => {
    const s = run(5);
    expect(onBf(s, 'Test Swarm', 'p1').length).toBe(1);
    const insects = s.zones.battlefield.filter((id) => chars(s, id).subtypes.includes('Insect') && s.objects[id]!.kind === 'token');
    expect(insects.length).toBe(1);
    expect(s.objects[insects[0]!]!.tapped).toBe(true);
    expect(chars(s, insects[0]!).keywords.some((k) => k.keyword === 'flying')).toBe(true);
  });
});

describe('CR 701.15a, 611.2a, 111.1 (unverified): "each opponent creates a token that\'s a copy of it. The tokens are goaded for the rest of the game." (Life of the Party)', () => {
  const PARTY = card('Test Party', 'Creature — Elemental', "When this creature enters, if it's not a token, each opponent creates a token that's a copy of it. The tokens are goaded for the rest of the game.", { pt: ['2', '2'], cost: '{1}' });
  const defs = [PARTY];
  it('is automated', () => expect(automated(PARTY)).toBe(true));
  it('the opponent gets a token copy, and it must attack each combat of theirs (goaded)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Party'] }, defs });
    const s1 = castWith(s0, 'Test Party', {}, 1);
    const copies = onBf(s1, 'Test Party', 'p2');
    expect(copies.length).toBe(1);
    expect(s1.objects[copies[0]!]!.kind).toBe('token');
    expect(onBf(s1, 'Test Party', 'p1').length).toBe(1);
    // the second player's turn: the copy is goaded, so declaring no attackers is refused, and it may not attack its goader
    let s = s1;
    for (let guard = 0; guard < 60 && s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
    expect(s.pending?.kind).toBe('declareAttackers');
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [] })).toThrow();
  });
  it('NEGATIVE: the original is not goaded (its controller declares no attackers freely)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Party'] }, defs });
    const s1 = castWith(s0, 'Test Party', {}, 1);
    // the original entered this turn: pass to the second player's turn and on to the first player's next turn, where it may attack or not
    let s = s1;
    for (let guard = 0; guard < 120 && !(s.turn.number === 3 && s.pending?.kind === 'declareAttackers'); guard++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: s.turn.number === 2 ? [{ attacker: onBf(s, 'Test Party', 'p2')[0]!, defender: 'p1' } as never] : [] }) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : pass(s);
    }
    expect(s.turn.number).toBe(3);
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [] })).not.toThrow();
  });
});

describe('CR 702.62b, 113.6k, 603.4 (unverified): "if this card is suspended" (Deep-Sea Kraken, Nihilith, Greater Gargadon)', () => {
  const KRAKEN = card('Test Kraken', 'Creature — Kraken', 'Suspend 3—{1}{U}\nWhenever you cast a spell, if this card is suspended, remove a time counter from it.', { pt: ['2', '2'], cost: '{3}{U}', colors: ['U'] });
  const GARGOYLE = card('Test Gargoyle', 'Creature — Gargoyle', 'Suspend 3—{1}{U}\nSacrifice a land: Remove a time counter from this card. Activate only if this card is suspended.', { pt: ['2', '2'], cost: '{3}{U}', colors: ['U'] });
  const SPELL = card('Test Spell', 'Instant', 'You gain 1 life.', { cost: '{0}' });
  const defs = [KRAKEN, GARGOYLE, SPELL];
  const time = (s: GameState, name: string, zone: 'exile' | 'hand'): number => {
    const id = zone === 'exile' ? s.zones.exile.find((x) => chars(s, x).name === name)! : find(s, name, 'hand', 'p1');
    return Number((s.objects[id] as unknown as { counters?: Record<string, number> }).counters?.['time'] ?? 0);
  };
  it('are automated', () => { expect(automated(KRAKEN)).toBe(true); expect(automated(GARGOYLE)).toBe(true); });
  it('a suspended card in exile loses a time counter when its owner casts a spell', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Spell'], exile: [{ name: 'Test Kraken', counters: { time: 3 } }] }, defs });
    expect(time(castWith(s0, 'Test Spell', {}, 0), 'Test Kraken', 'exile')).toBe(2);
  });
  it('NEGATIVE: in exile with no time counter it is not suspended: nothing happens', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Spell'], exile: ['Test Kraken'] }, defs });
    expect(time(castWith(s0, 'Test Spell', {}, 0), 'Test Kraken', 'exile')).toBe(0);
  });
  it('NEGATIVE: the same card in hand is not suspended (the ability works from exile only)', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Spell', { name: 'Test Kraken', counters: { time: 3 } }] }, defs });
    expect(time(castWith(s0, 'Test Spell', {}, 0), 'Test Kraken', 'hand')).toBe(3);
  });
  it('a step trigger of a suspended card works from exile too (Curse of the Cabal): at each player\'s upkeep that player may sacrifice a permanent, and if they do the card gets two time counters', () => {
    const CURSE = card('Test Curse', 'Sorcery', "Suspend 2--{2}{B}\nAt the beginning of each player's upkeep, if this card is suspended, that player may sacrifice a permanent of their choice. If the player does, put two time counters on this card.", { cost: '{4}{B}', colors: ['B'] });
    const defs2 = [CURSE];
    const run = (counters: Record<string, number>, yes: boolean): GameState => {
      const s0 = scenario(['Mountain'], { p1: { battlefield: ['Mountain'], exile: [{ name: 'Test Curse', counters }] }, defs: defs2 });
      return resolveAll(advanceTo(s0, 2, 'upkeep'), { yes });
    };
    const timeOf = (s: GameState): number => Number((s.objects[s.zones.exile.find((x) => chars(s, x).name === 'Test Curse')!] as unknown as { counters?: Record<string, number> }).counters?.['time'] ?? 0);
    void run; void timeOf;
    // (the suspend keyword's own upkeep trigger removes a counter at its owner's upkeep only, turn 3 here; turn 2 is the second player's upkeep)
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Mountain'] , exile: [{ name: 'Test Curse', counters: { time: 4 } }] }, p2: { battlefield: ['Mountain'] }, defs: defs2 });
    const s = resolveAll(advanceTo(s0, 2, 'upkeep'), { yes: true });
    expect(timeOf(s)).toBe(6); // the second player sacrificed their Mountain: two more time counters
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(0);
    const t0 = scenario(['Mountain'], { p1: { battlefield: ['Mountain'] , exile: [{ name: 'Test Curse', counters: { time: 4 } }] }, p2: { battlefield: ['Mountain'] }, defs: defs2 });
    const t = resolveAll(advanceTo(t0, 2, 'upkeep'), { yes: false });
    expect(timeOf(t)).toBe(4); // NEGATIVE: they declined
    const u0 = scenario(['Mountain'], { p1: { battlefield: ['Mountain'] , exile: ['Test Curse'] }, p2: { battlefield: ['Mountain'] }, defs: defs2 });
    expect(timeOf(resolveAll(advanceTo(u0, 2, 'upkeep'), { yes: true }))).toBe(0); // NEGATIVE: no time counter, not suspended: no trigger
  });
  it('an activated \"Activate only if this card is suspended\" works from exile with a time counter, not without one', () => {
    const withCounter = scenario(['Mountain'], { p1: { battlefield: ['Mountain'], exile: [{ name: 'Test Gargoyle', counters: { time: 3 } }] }, defs });
    const id = withCounter.zones.exile.find((x) => chars(withCounter, x).name === 'Test Gargoyle')!;
    const activations = (s: GameState, oid: ObjectId): number => legal(s, 'p1', 'activate').filter((x) => x.object === oid).length;
    expect(activations(withCounter, id)).toBeGreaterThan(0);
    const without = scenario(['Mountain'], { p1: { battlefield: ['Mountain'], exile: ['Test Gargoyle'] }, defs });
    expect(activations(without, without.zones.exile.find((x) => chars(without, x).name === 'Test Gargoyle')!)).toBe(0);
  });
});

describe('CR 603.2, 500.1 (unverified): "whenever this creature becomes tapped for the first time during each of your turns" (Tale of Katara and Toph)', () => {
  const TALE = card('Test Tale', 'Enchantment', 'Creatures you control have "Whenever this creature becomes tapped for the first time during each of your turns, put a +1/+1 counter on it."', { cost: '{2}{G}', colors: ['G'] });
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'], cost: '{1}' });
  const TAP = card('Test Tapper', 'Instant', 'Tap target creature.', { cost: '{0}' });
  const UNTAP = card('Test Untapper', 'Instant', 'Untap target creature.', { cost: '{0}' });
  const defs = [TALE, WOLF, TAP, UNTAP];
  const counters = (s: GameState, id: ObjectId): number => Number((s.objects[id] as unknown as { counters?: Record<string, number> }).counters?.['+1/+1'] ?? 0);
  it('is automated', () => expect(automated(TALE)).toBe(true));
  it('the first tap of the turn puts a counter, a second tap after an untap does not', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Tapper', 'Test Tapper', 'Test Untapper'], battlefield: ['Test Tale', 'Test Wolf'] }, defs });
    const wolf = onBf(s0, 'Test Wolf', 'p1')[0]!;
    const tapIt = (s: GameState): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1!.find((id) => chars(s, id).name === 'Test Tapper')! }), { targets: [[{ kind: 'object', id: wolf }]] });
    let s = tapIt(s0);
    expect(counters(s, wolf)).toBe(1);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Untapper', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: wolf }]] });
    s = tapIt(s);
    expect(s.objects[wolf]!.tapped).toBe(true);
    expect(counters(s, wolf)).toBe(1); // tapped a second time this turn: no second counter
  });
  it('NEGATIVE: without the enchantment the creature gets nothing', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Tapper'], battlefield: ['Test Wolf'] }, defs });
    const wolf = onBf(s0, 'Test Wolf', 'p1')[0]!;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tapper', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: wolf }]] });
    expect(counters(s, wolf)).toBe(0);
  });
});
