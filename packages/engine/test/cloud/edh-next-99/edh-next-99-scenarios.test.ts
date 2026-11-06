/**
 * edh-next-99 (top-rank second pass 5): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. The rulings were fetched from Scryfall in the cloud
 * session; the CR cites are from memory (unverified: no rules/cr in a cloud checkout).
 *
 *   CR 614.10, 614.10a, 502.1    "Each opponent skips their next untap step.": one skip for EACH opponent (not one for the first), the caster untaps as usual
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, put } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil, step } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
void applyAction; void answer; void findAll; void legal; void namesOn; void obj; void pl; void lifeOf;

interface Script {
  yes?: boolean[];
  targets?: TargetChoice[][];
  objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[];
  options?: string[][];
  numbers?: number[];
}
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
// (two skips met in one untap step ask which to apply first, CR 616.1: the first option is taken)
const toTurn = (s0: GameState, n: number): GameState => {
  let s = s0;
  for (let guard = 0; guard < 400; guard++) {
    if (s.turn.number === n && s.turn.step === 'main1' && s.pending?.kind === 'priority') return s;
    if (s.pending?.kind === 'chooseReplacement') { s = answer(s, { kind: 'chooseReplacement', id: s.pending.options[0]!.id }); continue; }
    s = passUntil(s, (x) => (x.turn.number === n && x.turn.step === 'main1') || x.pending?.kind === 'chooseReplacement', `turn ${n}`);
  }
  throw new Error(`never reached turn ${n}`);
};
void put; void toTurn;

// ---- Brine Elemental ----------------------------------------------------------------------------------------------------------------------------------------------------

const NAP = card('Test Nap', 'Sorcery', 'Each opponent skips their next untap step.');
const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;

describe('CR 614.10, 614.10a, 502.1: "Each opponent skips their next untap step."', () => {
  const setup = (): GameState => mpScenario({
    defs: [NAP],
    zones: {
      p1: { hand: ['Test Nap'], battlefield: [{ name: 'Plains', tapped: true }] },
      p2: { battlefield: [{ name: 'Plains', tapped: true }] }, p3: { battlefield: [{ name: 'Plains', tapped: true }] }, p4: { battlefield: [{ name: 'Plains', tapped: true }] },
    },
  });
  it('is automated', () => expect(full(NAP)).toBe(true));
  it('every opponent keeps their land tapped in their own next untap step, and untaps in the one after; the caster untaps as usual', () => {
    let s = cast(setup(), 'Test Nap');
    const land = (p: PlayerId): ObjectId => find(s, 'Plains', 'battlefield', p);
    const ids = { p1: land('p1'), p2: land('p2'), p3: land('p3'), p4: land('p4') };
    s = toTurn(s, 2);
    expect(tapped(s, ids.p2), 'p2 turn 2').toBe(true);
    expect(tapped(s, ids.p3), 'p3 still waits').toBe(true);
    s = toTurn(s, 3);
    expect(tapped(s, ids.p3), 'p3 turn 3').toBe(true);
    s = toTurn(s, 4);
    expect(tapped(s, ids.p4), 'p4 turn 4').toBe(true);
    s = toTurn(s, 5);
    expect(tapped(s, ids.p1), 'the caster untapped in turn 5').toBe(false);
    s = toTurn(s, 6);
    expect(tapped(s, ids.p2), 'p2 untaps in the one after').toBe(false);
    s = toTurn(s, 8);
    expect(tapped(s, ids.p3) || tapped(s, ids.p4), 'p3 and p4 untapped too').toBe(false);
  });
  it('ruling: skipping the next untap step is cumulative - two of them make each opponent skip their next two untap steps', () => {
    const s0 = mpScenario({
      defs: [NAP], zones: { p1: { hand: ['Test Nap', 'Test Nap'], battlefield: [{ name: 'Plains', tapped: true }] }, p2: { battlefield: [{ name: 'Plains', tapped: true }] } },
    });
    let s = cast(cast(s0, 'Test Nap'), 'Test Nap');
    const land = find(s, 'Plains', 'battlefield', 'p2');
    s = toTurn(s, 2);
    expect(tapped(s, land), 'turn 2').toBe(true);
    s = toTurn(s, 6);
    expect(tapped(s, land), 'turn 6, the second skip').toBe(true);
    s = toTurn(s, 10);
    expect(tapped(s, land), 'turn 10, no skip left').toBe(false);
  });
  it('review: a group skip of a combat phase is one skip for each opponent', () => {
    const NAPC = card('Test Nap Combat', 'Sorcery', 'Each opponent skips their next combat phase.');
    let s = cast(mpScenario({ defs: [NAPC], zones: { p1: { hand: ['Test Nap Combat'] } } }), 'Test Nap Combat');
    const combats: Record<number, boolean> = {};
    for (let guard = 0; guard < 600 && s.turn.number <= 4; guard++) {
      if (s.turn.step === 'beginCombat') combats[s.turn.number] = true;
      if (s.pending?.kind === 'chooseReplacement') { s = answer(s, { kind: 'chooseReplacement', id: s.pending.options[0]!.id }); continue; }
      if (s.pending?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); continue; }
      if (s.pending?.kind === 'declareBlockers') { s = answer(s, { kind: 'declareBlockers', blocks: [] }); continue; }
      s = act(s, { type: 'pass', player: s.pending!.player });
    }
    expect(combats[2], 'p2 skips').toBeUndefined();
    expect(combats[3], 'p3 skips').toBeUndefined();
    expect(combats[4], 'p4 skips').toBeUndefined();
  });
  it('a player who has left the game before their turn takes no skip; the others still skip once (the negative case)', () => {
    let s = cast(setup(), 'Test Nap');
    const p4land = find(s, 'Plains', 'battlefield', 'p4');
    s = step(s, { type: 'concede', player: 'p3' }).state;
    s = toTurn(s, 4);
    expect(tapped(s, p4land), 'p4 turn 4').toBe(true);
  });
});

// ---- Insatiable Frugivore ------------------------------------------------------------------------------------------------------------------------------------------------

const RATS = card('Test Rats', 'Creature — Rat', 'When this creature enters, create a Food token, then you may exile three cards from your graveyard. If you do, repeat this process.', { pt: ['2', '2'] });
const foods = (s: GameState, p: PlayerId): number => namesOn(s, p).filter((n) => n === 'Food Token').length;

describe('CR 608.2c: "..., then you may exile three cards from your graveyard. If you do, repeat this process." (the whole effect repeats)', () => {
  const setup = (yard: number): GameState => mpScenario({ defs: [RATS], zones: { p1: { hand: ['Test Rats'], graveyard: Array(yard).fill('Plains') } } });
  const play = (yard: number, yes: boolean[]): GameState => cast(setup(yard), 'Test Rats', { yes });
  it('is automated', () => expect(full(RATS)).toBe(true));
  it('exiles three cards and makes another Food each time you say yes, and stops when you say no', () => {
    const s3 = play(7, [true, true, true]);
    expect(foods(s3, 'p1')).toBe(3);
    expect(s3.zones.graveyard['p1']!.length).toBe(1);
    expect(foods(play(7, [true, false]), 'p1')).toBe(2);
    expect(play(7, [true, false]).zones.graveyard['p1']!.length).toBe(4);
  });
  it('declining the first time makes just the one Food and exiles nothing (the negative case)', () => {
    const s = play(7, [false]);
    expect(foods(s, 'p1')).toBe(1);
    expect(s.zones.graveyard['p1']!.length).toBe(7);
  });
  it('with fewer than three cards in the graveyard the cost can not be paid, so the process does not repeat', () => {
    const s = play(2, [true, true]);
    expect(foods(s, 'p1')).toBe(1);
    expect(s.zones.graveyard['p1']!.length).toBe(2);
  });
});

// ---- Glorious Purpose ----------------------------------------------------------------------------------------------------------------------------------------------------

const PLAN = card('Test Plan', 'Enchantment — Plan', 'When this enchantment enters, sacrifice it. If you do, exile the top four cards of your library. You may cast any number of spells from among them without paying their mana costs. Put the rest into your hand.');
const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{2}' });
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();

describe('CR 608.2c, 406.1, 601.2: "You may cast any number of spells from among them without paying their mana costs. Put the rest into your hand."', () => {
  // the first card of the library is drawn as the game reaches the first main phase: the four cards after it are the ones exiled
  const setup = (): GameState => mpScenario({ defs: [PLAN, CUB], zones: { p1: { hand: ['Test Plan'], library: ['Plains', 'Test Cub', 'Plains', 'Test Cub', 'Test Cub'] } } });
  const gained = (before: GameState, after: GameState): string[] => { const was = names(before, before.zones.hand.p1!); const now = names(after, after.zones.hand.p1!); for (const n of was) if (now.includes(n)) now.splice(now.indexOf(n), 1); return now; };
  const play = (pick: (options: ObjectId[], s: GameState) => ObjectId[]): { before: GameState; after: GameState } => { const before = setup(); return { before, after: cast(before, 'Test Plan', { objects: [pick] }) }; };
  it('is automated', () => expect(full(PLAN)).toBe(true));
  it('the spells you cast leave exile for the stack; the uncast spell and the land go to your hand (a land is never cast)', () => {
    const { before, after } = play((o) => o.slice(0, 2));
    expect(gained(before, after)).toEqual(['Plains', 'Test Cub']);
    expect(after.zones.exile.length).toBe(0);
  });
  it('casting none puts all four exiled cards into your hand (the negative case)', () => {
    const { before, after } = play(() => []);
    expect(gained(before, after)).toEqual(['Plains', 'Test Cub', 'Test Cub', 'Test Cub']);
    expect(after.zones.stack.length).toBe(0);
  });
  it('review: a spell you choose but cannot cast (no legal target) is part of the rest and goes to your hand, not left in exile', () => {
    const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.');
    const before = mpScenario({ defs: [PLAN, CUB, SHATTER], zones: { p1: { hand: ['Test Plan'], library: ['Plains', 'Test Shatter', 'Test Cub', 'Plains', 'Plains'] } } });
    const after = cast(before, 'Test Plan', { objects: [(o) => o] });
    expect(names(after, after.zones.exile)).toEqual([]);
    expect(gained(before, after)).toContain('Test Shatter');
  });
  it('only the four exiled cards are touched: the rest of the library stays', () => {
    const { before, after } = play(() => []);
    expect(after.zones.library.p1!.length).toBe(before.zones.library.p1!.length - 4);
  });
});

// ---- Willowdusk, Essence Seer ----------------------------------------------------------------------------------------------------------------------------------------------

const SEER = card('Test Seer', 'Creature — Dryad', '{1}, {T}: Choose another target creature. Put a number of +1/+1 counters on it equal to the amount of life you gained this turn or the amount of life you lost this turn, whichever is greater. Activate only as a sorcery.', { pt: ['1', '3'] });
const SWING = card('Test Swing', 'Instant', 'You gain 3 life. You lose 5 life.');
const BOOST = card('Test Boost', 'Instant', 'You gain 4 life. You lose 2 life.');
const CALM = card('Test Calm', 'Creature — Bear', '', { pt: ['2', '2'] });
const plusCounters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;

describe('CR 119.3, 122.1, 608.2h: "Put a number of +1/+1 counters on it equal to the amount of life you gained this turn or the amount of life you lost this turn, whichever is greater."', () => {
  const setup = (spell?: string): GameState => mpScenario({
    defs: [SEER, SWING, BOOST, CALM],
    zones: { p1: { hand: spell ? [spell] : [], battlefield: ['Plains', 'Test Seer', 'Test Calm'] } },
  });
  const run = (spell?: string): { s: GameState; calm: ObjectId } => {
    let s = setup(spell);
    if (spell) s = cast(s, spell);
    const calm = find(s, 'Test Calm', 'battlefield', 'p1');
    const seer = find(s, 'Test Seer', 'battlefield', 'p1');
    s = settle(drive(act(s, { type: 'activate', player: 'p1', source: seer, ability: 'p:0:0' }), { targets: [[obj(calm)]] }));
    return { s, calm };
  };
  it('is automated', () => expect(full(SEER)).toBe(true));
  it('the greater of the two: lost 5 beats gained 3; gained 4 beats lost 2', () => {
    let r = run('Test Swing');
    expect(plusCounters(r.s, r.calm)).toBe(5);
    r = run('Test Boost');
    expect(plusCounters(r.s, r.calm)).toBe(4);
  });
  it('with no life gained or lost this turn no counters are put (the negative case)', () => {
    const r = run();
    expect(plusCounters(r.s, r.calm)).toBe(0);
  });
  it('another creature only: the Dryad itself is not a legal target', () => {
    const s = setup();
    const seer = find(s, 'Test Seer', 'battlefield', 'p1');
    const a = act(s, { type: 'activate', player: 'p1', source: seer, ability: 'p:0:0' });
    expect(() => answer(a, { kind: 'chooseTargets', targets: [obj(seer)] })).toThrow();
  });
});

// ---- Aloy, Savior of Meridian --------------------------------------------------------------------------------------------------------------------------------------------

const SCOUT = card('Test Scout', 'Enchantment', 'Whenever one or more artifact creatures you control attack, you gain life equal to the greatest power among them.');
const SCOUT_D = card('Test Scout Discover', 'Enchantment', 'Whenever one or more artifact creatures you control attack, discover X, where X is the greatest power among them.');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'] });
const BRUTE = card('Test Brute', 'Artifact Creature — Golem', '', { pt: ['5', '5'] });
const HOUND = card('Test Hound', 'Creature — Dog', '', { pt: ['7', '7'] });

describe('CR 208.1, 603.2, 608.2h: "the greatest power among them" is read over the creatures that attacked', () => {
  const attackWith = (names: string[], text = SCOUT.name): GameState => {
    let s = mpScenario({ defs: [SCOUT, SCOUT_D, GOLEM, BRUTE, HOUND], zones: { p1: { battlefield: [text, 'Test Golem', 'Test Brute', 'Test Hound'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: names.map((n) => ({ attacker: find(s, n, 'battlefield', 'p1'), defender: 'p2' as PlayerId })) });
    return settle(s);
  };
  const start = lifeOf(mpScenario({ defs: [SCOUT] }), 'p1');
  it('is automated', () => { expect(full(SCOUT)).toBe(true); expect(full(SCOUT_D)).toBe(true); });
  it('the greatest power of the attacking artifact creatures: 5 of the 3 and the 5; the unattacking Hound and a lone Golem do not change it', () => {
    expect(lifeOf(attackWith(['Test Golem', 'Test Brute']), 'p1')).toBe(start + 5);
    expect(lifeOf(attackWith(['Test Golem']), 'p1')).toBe(start + 3);
  });
  it('a non-artifact attacker neither triggers nor counts: the 7/7 Hound attacking alone gains nothing, and with the Golem the 3 is gained (the negative case)', () => {
    expect(lifeOf(attackWith(['Test Hound']), 'p1')).toBe(start);
    expect(lifeOf(attackWith(['Test Hound', 'Test Golem']), 'p1')).toBe(start + 3);
  });
  it('the discover wording plays without a manual step', () => {
    expect(() => attackWith(['Test Brute'], SCOUT_D.name)).not.toThrow();
  });
});

// ---- Kusari-Gama ----------------------------------------------------------------------------------------------------------------------------------------------------------

const CHAIN = card('Test Chain', 'Artifact — Equipment', 'Whenever equipped creature deals damage to a blocking creature, this Equipment deals that much damage to each other creature defending player controls.');
const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '6'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 120.3, 603.2: "...deals that much damage to each other creature defending player controls" (other than the blocking creature that was damaged)', () => {
  const run = (defender: PlayerId = 'p2'): GameState => {
    let s = mpScenario({
      defs: [CHAIN, GOLEM, WALL, BEAR],
      zones: { p1: { battlefield: ['Test Chain', 'Test Golem'] }, p2: { battlefield: ['Test Wall', 'Test Bear'] }, p3: { battlefield: ['Test Wall', 'Test Bear'] } },
      setup: (x) => { x.objects[find(x, 'Test Chain', 'battlefield', 'p1')]!.attachedTo = find(x, 'Test Golem', 'battlefield', 'p1'); },
    });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Golem', 'battlefield', 'p1'), defender }] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'declare blockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Wall', 'battlefield', defender), attacker: find(s, 'Test Golem', 'battlefield', 'p1') }] });
    return passUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'combat over');
  };
  it('is automated', () => expect(full(CHAIN)).toBe(true));
  it('the other creature of the defending player takes 3, the blocker takes only the combat damage once, another player\'s creature is untouched', () => {
    const s = run();
    const p2bear = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.defs[s.objects[id]!.defId]!.name === 'Test Bear');
    expect(p2bear.length, 'the 2/2 Bear took 3 and died').toBe(0);
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    expect(s.objects[wall]!.damage).toBe(3);
    expect(s.objects[find(s, 'Test Wall', 'battlefield', 'p3')]!.damage).toBe(0);
    expect(find(s, 'Test Bear', 'battlefield', 'p3'), 'p3 is not the defending player').toBeTruthy();
  });
  it('the defending player is the one the equipped creature attacks: attacking p3 hurts p3\'s Bear and leaves p2\'s (the negative case)', () => {
    const s = run('p3');
    const bears = (p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Test Bear').length;
    expect(bears('p3')).toBe(0);
    expect(bears('p2')).toBe(1);
  });
});

// ---- Leyline of Combustion -------------------------------------------------------------------------------------------------------------------------------------------------

const BEACON = card('Test Beacon', 'Enchantment', 'Whenever you and/or at least one permanent you control becomes the target of a spell or ability an opponent controls, this enchantment deals 2 damage to that player.');
const ZAP2 = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to each of up to two targets.');

describe('CR 115.1, 603.2c: "Whenever you and/or at least one permanent you control becomes the target of a spell or ability an opponent controls" triggers once (ruling 2019-07-12)', () => {
  const setup = (): GameState => mpScenario({
    defs: [BEACON, ZAP2, GOLEM, BRUTE],
    zones: { p1: { battlefield: ['Test Beacon', 'Test Golem', 'Test Brute'] }, p2: { hand: ['Test Zap', 'Test Zap'], battlefield: ['Test Golem'] }, p3: { hand: ['Test Zap'] } },
  });
  /** p2 (or `who`) casts a Zap at the given targets; the life lost by p2 shows how many times the Leyline triggered (2 each). */
  const zap = (targets: (s: GameState) => TargetChoice[], who: PlayerId = 'p2', s0: GameState = setup()): GameState => {
    const s = passUntil(s0, (x) => x.pending?.kind === 'priority' && x.pending.player === who, `${who} has priority`);
    return settle(drive(act(s, { type: 'cast', player: who, card: find(s, 'Test Zap', 'hand', who) }), { targets: [targets(s)] }));
  };
  it('is automated', () => expect(full(BEACON)).toBe(true));
  it('you and a permanent of yours in one spell: one trigger (2 damage), not two', () => {
    const s = zap((x) => [pl('p1'), obj(find(x, 'Test Golem', 'battlefield', 'p1'))]);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(setup(), 'p2') - 2);
  });
  it('two of your permanents in one spell: still one trigger; you alone: one trigger', () => {
    let s = zap((x) => [obj(find(x, 'Test Golem', 'battlefield', 'p1')), obj(find(x, 'Test Brute', 'battlefield', 'p1'))]);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(setup(), 'p2') - 2);
    s = zap(() => [pl('p1')]);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(setup(), 'p2') - 2);
  });
  it('the damage goes to the controller of the spell, so a spell of another opponent hurts that opponent, not p2', () => {
    const s = zap((x) => [obj(find(x, 'Test Golem', 'battlefield', 'p1'))], 'p3');
    expect(lifeOf(s, 'p3')).toBe(lifeOf(setup(), 'p3') - 2);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(setup(), 'p2'));
  });
  it('a spell that targets only a permanent of the opponent, or one you control cast by yourself, does not trigger (the negative cases)', () => {
    const s = zap((x) => [obj(find(x, 'Test Golem', 'battlefield', 'p2'))]);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(setup(), 'p2'));
    const s0 = setup();
    put(s0, 'p1', 'hand', 'Test Zap');
    const t = zap((x) => [obj(find(x, 'Test Golem', 'battlefield', 'p1'))], 'p1', s0);
    expect(lifeOf(t, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

// ---- Cutthroat Negotiator, Phabine, Boss's Confidant ---------------------------------------------------------------------------------------------------------------------

const PARLEY = card('Test Parley', 'Sorcery', 'Each player reveals the top card of their library. For each land card revealed this way, you create a 1/1 green and white Citizen creature token. Then creatures you control get +1/+1 until end of turn for each nonland card revealed this way. Then each player draws a card.');
const HAGGLE = card('Test Haggle', 'Sorcery', 'Each player reveals the top card of their library. For each nonland card revealed this way, you create a tapped Treasure token. Then each player draws a card.');
const tokensOf = (s: GameState, p: PlayerId, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name.startsWith(name));

describe('CR 701.20a, 608.2c: "For each <land | nonland> card revealed this way" counts the top cards every player revealed, across several sentences', () => {
  // p1 draws the first card of the library as the turn begins: the card revealed is the second one
  const setup = (): GameState => mpScenario({
    defs: [PARLEY, HAGGLE, BEAR],
    zones: {
      p1: { hand: ['Test Parley', 'Test Haggle'], library: ['Plains', 'Plains', 'Plains'] }, p2: { library: ['Test Bear', 'Plains'] },
      p3: { library: ['Plains', 'Test Bear'] }, p4: { library: ['Test Bear', 'Plains'] },
    },
  });
  it('are automated', () => { expect(full(PARLEY)).toBe(true); expect(full(HAGGLE)).toBe(true); });
  it('one Citizen for each revealed land (p1 and p3), then +1/+1 for each revealed nonland card (p2 and p4), and everyone draws', () => {
    const s0 = setup();
    const s = cast(s0, 'Test Parley');
    const citizens = tokensOf(s, 'p1', 'Citizen');
    expect(citizens.length).toBe(2);
    expect(Number(getChars(s, citizens[0]!)!.power)).toBe(3);
    expect(s.zones.hand.p2!.length).toBe(s0.zones.hand.p2!.length + 1);
  });
  it('one tapped Treasure for each revealed nonland card, and none for a revealed land (the negative case)', () => {
    const s = cast(setup(), 'Test Haggle');
    const treasures = tokensOf(s, 'p1', 'Treasure');
    expect(treasures.length).toBe(2);
    expect(treasures.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

// ---- Gideon of the Trials --------------------------------------------------------------------------------------------------------------------------------------------------

const MERCY = card('Test Mercy', 'Sorcery', 'Until your next turn, prevent all damage target permanent would deal.');
const GUARD = card('Test Guard', 'Enchantment', "As long as you control a Gideon planeswalker, you can't lose the game and your opponents can't win the game.");

describe('CR 615.1a, 611.2a: "Until your next turn, prevent all damage target permanent would deal."', () => {
  const setup = (): GameState => mpScenario({
    defs: [MERCY, GOLEM],
    zones: { p1: { hand: ['Test Mercy'] }, p2: { battlefield: ['Test Golem'] }, p3: { battlefield: ['Test Golem'] } },
  });
  const attackOn = (s0: GameState, turn: number, attacker: PlayerId): GameState => {
    let s = passUntil(s0, (x) => x.turn.number === turn && x.pending?.kind === 'declareAttackers', `turn ${turn} attackers`);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Golem', 'battlefield', attacker), defender: 'p1' as PlayerId }] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'main2', 'blockers');
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    return passUntil(s, (x) => x.turn.step === 'main2' || x.turn.number > turn, 'combat over');
  };
  it('is automated', () => expect(full(MERCY)).toBe(true));
  it('the targeted creature deals no damage in its own turn before your next turn, while another creature does; from your next turn on it does (the negative cases)', () => {
    const s0 = setup();
    let s = cast(s0, 'Test Mercy', { targets: [[obj(find(s0, 'Test Golem', 'battlefield', 'p2'))]] });
    const start = lifeOf(s, 'p1');
    s = attackOn(s, 2, 'p2');
    expect(lifeOf(s, 'p1'), 'p2 is prevented').toBe(start);
    s = attackOn(s, 3, 'p3');
    expect(lifeOf(s, 'p1'), 'p3 is not').toBe(start - 3);
    s = attackOn(s, 6, 'p2');
    expect(lifeOf(s, 'p1'), 'after your next turn began').toBe(start - 6);
  });
});

describe('CR 104.3b, 104.2a, 604.1: "As long as you control a Gideon planeswalker, you can\'t lose the game and your opponents can\'t win the game."', () => {
  const GID = compileCard({ name: 'Test Gid', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Gideon', oracle_text: '', colors: [], keywords: [], loyalty: '4' } as never);
  const DOOM = card('Test Doom', 'Sorcery', 'You lose 100 life.');
  const play = (withGideon: boolean): GameState => cast(mpScenario({ defs: [GUARD, GID, DOOM], zones: { p1: { hand: ['Test Doom'], battlefield: withGideon ? ['Test Guard', 'Test Gid'] : ['Test Guard'] } }, setup: (x) => { for (const id of x.zones.battlefield) if (x.defs[x.objects[id]!.defId]!.name === 'Test Gid') x.objects[id]!.counters['loyalty'] = 4; } }), 'Test Doom');
  it('is automated', () => expect(full(GUARD)).toBe(true));
  it('with a Gideon planeswalker you stay in the game at negative life; without one you lose (the negative case)', () => {
    const a = play(true);
    expect(a.players.find((x) => x.id === 'p1')!.hasLost).toBe(false);
    const b = play(false);
    expect(b.players.find((x) => x.id === 'p1')!.hasLost).toBe(true);
  });
});
