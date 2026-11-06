/**
 * Commander lane random, round edh-d-28 (second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Random outcomes are checked over many seeds against the invariants of the rule (a seed changes the RNG only), and each test names the rule it checks, with its negative case.
 *
 *   CR 705.1, 608.2c       "Flip two coins. If both coins come up heads, ... If both coins come up tails, ..." (Two-Headed Giant)
 *   CR 701.9a, 608.2d      "That player discards a card at random. If the player can't, you draw a card." (Urgoros, the Empty One)
 *   CR 608.2d, 701.8a      "For each opponent, choose a nonland permanent that player controls. Destroy one of them chosen at random." (Chaos Defiler)
 *   CR 608.2d, 701.21a     "Target opponent chooses a permanent they control at random and sacrifices it. If a nonland permanent is sacrificed this way, repeat this process." (Tyrant of Discord)
 *   CR 608.2d, 109.2       "Choose a creature at random. You gain control of that creature until end of turn. ... Then destroy all other creatures." (The Nipton Lottery)
 *   CR 608.2d, 400.7 "Choose three target creature cards in your graveyard. Return two of them at random to the battlefield and put the other on the bottom of your library." (Sinister Waltz)
 *   CR 701.23a, 701.9a     "Search your library for up to three cards, put them into your hand, shuffle, then discard three cards at random." after a sentence that discarded cards (Fervent Mastery)
 *   CR 614.1a, 400.7       "Exile an instant or sorcery card at random from your graveyard. You may cast it this turn. If a spell cast this way would be put into your graveyard, exile it instead." (Radiant Scrollwielder)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
/** The player calls tails when asked to call a coin flip (a call of heads would make the flips won equal the coins that came up heads). */
let callTails = false;
const SEEDS = Array.from({ length: 16 }, (_, i) => `d28-${i}`);

/** Answer the decisions that come up until priority (payments automatic; every other choice the first allowed). */
function drive(s0: GameState, targets: ObjectId[] = []): GameState {
  let s = s0;
  const wanted = [...targets];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      const d = p as unknown as { players: PlayerId[]; objects: ObjectId[]; min: number; max: number };
      if (d.objects.length > 0) {
        const picked = wanted.length > 0 ? wanted.splice(0, d.max) : d.objects.slice(0, d.max);
        s = answer(s, { kind: 'chooseTargets', targets: picked.map((id) => ({ kind: 'object', id })) });
      } else s = answer(s, { kind: 'chooseTargets', targets: d.min === 0 ? [] : [{ kind: 'player', id: d.players[0]! }] });
    }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: callTails && /Call the coin flip/.test(p.prompt) ? ['tails'] : p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: ObjectId[] = []): GameState {
  let s = drive(s0, targets);
  for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) s = drive(pass(s), targets);
  return s;
}
/** Pass until `done`, declaring no blocks and answering other decisions. */
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
/** The attacker attacks the opponent; passes until its trigger has resolved and combat damage was dealt. */
function attackAndDamage(s0: GameState, attacker: ObjectId, defender: PlayerId): GameState {
  const s1 = runUntil(s0, (s) => s.pending?.kind === 'declareAttackers', 'declare attackers');
  let s = answer(s1, { kind: 'declareAttackers', attacks: [{ attacker, defender }] });
  s = runUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'the end of combat');
  return s;
}
const flips = (s: GameState): string[] => s.log.filter((l) => /flips a coin: (heads|tails)\./.test(l.text)).map((l) => /(heads|tails)\./.exec(l.text)![1]!);

// ---- Two-Headed Giant ----------------------------------------------------------------------------------------------------------------------------------------------
const TWIN = card('Test Twin Giant', 'Creature — Giant', 'Whenever this creature attacks, flip two coins. If both coins come up heads, this creature gains double strike until end of turn. If both coins come up tails, this creature gains menace until end of turn.', { pt: ['2', '2'] });
describe('CR 705.1, 608.2c: "Flip two coins. If both coins come up heads, ... If both coins come up tails, ..."', () => {
  it('is fully automated', () => { expect(noManual(TWIN) && TWIN.automation.level === 'full').toBe(true); });
  it('double strike exactly when both coins came up heads, menace exactly when both came up tails, neither when they differ (16 seeds)', () => {
    const seen = new Set<string>();
    for (const seed of Array.from({ length: 48 }, (_, i) => `d28-t${i}`)) {
      const s0 = scenario([], { seed, defs: [TWIN], p1: { battlefield: [{ name: 'Test Twin Giant', since: -1 }] } });
      const id = find(s0, 'Test Twin Giant', 'battlefield', 'p1');
      const s = attackAndDamage(s0, id, 'p2');
      const f = flips(s).slice(0, 2);
      expect(f.length).toBe(2);
      const c = chars(s, id);
      const heads = f.filter((x) => x === 'heads').length;
      expect(hasKeyword(c, 'double strike'), `${seed} ${f}`).toBe(heads === 2);
      expect(hasKeyword(c, 'menace'), `${seed} ${f}`).toBe(heads === 0);
      seen.add(`${heads}`);
    }
    expect([...seen].sort()).toEqual(['0', '1', '2']); // all three outcomes happened over the seeds: the checks above were not vacuous
  });
});

describe('CR 705.1-705.2: the coins that came up heads are counted for a flip that is called only because the source watches flips', () => {
  const WATCHER = card('Test Twin Watcher', 'Creature — Giant', 'Whenever this creature attacks, flip two coins. If both coins come up heads, you gain 4 life.\nWhenever you win a coin flip, you gain 1 life.', { pt: ['2', '2'] });
  it('is fully automated', () => { expect(noManual(WATCHER) && WATCHER.automation.level === 'full').toBe(true); });
  it('4 life exactly when both coins came up heads (whatever the calls won), plus 1 life for each flip won (48 seeds)', () => {
    const seen = new Set<number>();
    callTails = true;
    for (const seed of Array.from({ length: 48 }, (_, i) => `d28-w${i}`)) {
      const s0 = scenario([], { seed, defs: [WATCHER], p1: { battlefield: [{ name: 'Test Twin Watcher', since: -1 }] } });
      const s = attackAndDamage(s0, find(s0, 'Test Twin Watcher', 'battlefield', 'p1'), 'p2');
      const lines = s.log.map((l) => /flips (heads|tails)\b.*?(wins|loses) the flip/.exec(l.text)).filter((m): m is RegExpExecArray => m !== null);
      expect(lines.length, seed).toBe(2);
      const heads = lines.filter((m) => m[1] === 'heads').length;
      const won = lines.filter((m) => m[2] === 'wins').length;
      const unblocked = s.players.find((x) => x.id === 'p2')!.life; // (the 2/2 attacker is unblocked: it is not the subject of this check)
      expect(unblocked).toBeLessThan(20);
      expect(s.players.find((x) => x.id === 'p1')!.life - 20, seed).toBe((heads === 2 ? 4 : 0) + won);
      seen.add(heads);
    }
    callTails = false;
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

// ---- Urgoros ------------------------------------------------------------------------------------------------------------------------------------------------------
const HAUNT = card('Test Haunting Specter', 'Creature — Specter', "Whenever this creature deals combat damage to a player, that player discards a card at random. If the player can't, you draw a card.", { pt: ['2', '2'] });
describe('CR 701.9a, 608.2d: "That player discards a card at random. If the player can\'t, you draw a card."', () => {
  it('is fully automated', () => { expect(noManual(HAUNT) && HAUNT.automation.level === 'full').toBe(true); });
  const run = (opponentHand: number): { before: GameState; after: GameState } => {
    const s0 = scenario([], { defs: [HAUNT], p1: { battlefield: [{ name: 'Test Haunting Specter', since: -1 }] }, p2: { hand: Array(opponentHand).fill('Plains') as string[] } });
    const before = runUntil(s0, (s) => s.pending?.kind === 'declareAttackers', 'declare attackers');
    return { before, after: attackAndDamage(s0, find(s0, 'Test Haunting Specter', 'battlefield', 'p1'), 'p2') };
  };
  it('the player has cards: one is discarded at random and you draw nothing', () => {
    const { before, after } = run(2);
    expect(after.zones.hand.p2!.length).toBe(before.zones.hand.p2!.length - 1);
    expect(after.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length);
  });
  it("negative / CR 701.9b: the player has no cards: nothing is discarded, so you draw a card", () => {
    const { before, after } = run(0);
    expect(after.zones.hand.p2!.length).toBe(0);
    expect(after.zones.hand.p1!.length).toBe(before.zones.hand.p1!.length + 1);
  });
});

// ---- Chaos Defiler ------------------------------------------------------------------------------------------------------------------------------------------------
const DEFILER = card('Test Chaos Demon', 'Creature — Demon', 'When this creature enters, for each opponent, choose a nonland permanent that player controls. Destroy one of them chosen at random.', { pt: ['3', '3'] });
const WALL = (n: string): CardDef => card(n, 'Artifact', '');
describe('CR 608.2d, 701.8a: "For each opponent, choose a nonland permanent that player controls. Destroy one of them chosen at random."', () => {
  it('is fully automated', () => { expect(noManual(DEFILER) && DEFILER.automation.level === 'full').toBe(true); });
  it('exactly one of the permanents you chose (one per opponent) is destroyed, picked by the game: both opponents are hit over the seeds; lands and unchosen permanents stay', () => {
    const hit = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = mpScenario({
        players: 3, seed, defs: [DEFILER, WALL('Test Gizmo A'), WALL('Test Gizmo B'), WALL('Test Gizmo C'), WALL('Test Gizmo D')],
        zones: { p1: { hand: ['Test Chaos Demon'] }, p2: { battlefield: ['Test Gizmo A', 'Test Gizmo B', 'Plains'] }, p3: { battlefield: ['Test Gizmo C', 'Test Gizmo D', 'Plains'] } },
      });
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Chaos Demon', 'hand', 'p1') }));
      const gone = (['p2', 'p3'] as const).map((p) => s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === p).length - s.zones.battlefield.filter((id) => s.objects[id]?.controller === p).length);
      expect(gone.reduce((a, b) => a + b, 0), seed).toBe(1);
      hit.add(gone[0] === 1 ? 'p2' : 'p3');
      expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains').length, seed).toBe(2); // the lands are untouched (nonland permanents only)
    }
    expect([...hit].sort()).toEqual(['p2', 'p3']);
  });
  it("ruling 2022-10-07: a chosen permanent with indestructible is not picked while another chosen one lacks it: the other one is always destroyed (16 seeds)", () => {
    for (const seed of SEEDS) {
      const s0 = mpScenario({
        players: 3, seed, defs: [DEFILER, card('Test Gizmo X', 'Artifact', 'Indestructible'), WALL('Test Gizmo C')],
        zones: { p1: { hand: ['Test Chaos Demon'] }, p2: { battlefield: ['Test Gizmo X'] }, p3: { battlefield: ['Test Gizmo C'] } },
      });
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Chaos Demon', 'hand', 'p1') }));
      expect(findAll(s, 'Test Gizmo C', 'battlefield', 'p3').length, seed).toBe(0);
      expect(findAll(s, 'Test Gizmo X', 'battlefield', 'p2').length, seed).toBe(1);
    }
  });
  it('negative: an opponent with no nonland permanent has nothing to choose: only the other opponent\'s chosen permanent is destroyed', () => {
    const s0 = mpScenario({
      players: 3, defs: [DEFILER, WALL('Test Gizmo A')],
      zones: { p1: { hand: ['Test Chaos Demon'] }, p2: { battlefield: ['Plains'] }, p3: { battlefield: ['Test Gizmo A'] } },
    });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Chaos Demon', 'hand', 'p1') }));
    expect(findAll(s, 'Test Gizmo A', 'battlefield', 'p3').length).toBe(0);
    expect(findAll(s, 'Plains', 'battlefield', 'p2').length).toBe(1);
  });
});

// ---- Tyrant of Discord --------------------------------------------------------------------------------------------------------------------------------------------
const TYRANT = card('Test Discord Tyrant', 'Creature — Elemental', 'When this creature enters, target opponent chooses a permanent they control at random and sacrifices it. If a nonland permanent is sacrificed this way, repeat this process.', { pt: ['5', '5'] });
describe('CR 608.2d, 701.21a: "Target opponent chooses a permanent they control at random and sacrifices it. If a nonland permanent is sacrificed this way, repeat this process."', () => {
  it('is fully automated', () => { expect(noManual(TYRANT) && TYRANT.automation.level === 'full').toBe(true); });
  const run = (seed: string, perms: string[]): { s0: GameState; s: GameState } => {
    const s0 = scenario([], { seed, defs: [TYRANT, WALL('Test Gizmo A'), WALL('Test Gizmo B')], p1: { hand: ['Test Discord Tyrant'] }, p2: { battlefield: perms } });
    return { s0, s: resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Discord Tyrant', 'hand', 'p1') })) };
  };
  it('it repeats while a nonland permanent is sacrificed and stops after a land: the land is always sacrificed (the opponent had one), the others only up to it (16 seeds)', () => {
    const left = new Set<number>();
    for (const seed of SEEDS) {
      const { s } = run(seed, ['Test Gizmo A', 'Test Gizmo B', 'Plains']);
      const rest = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').map((id) => nameOf(s, id));
      expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id)), seed).toContain('Plains');
      expect(rest.includes('Plains'), seed).toBe(false);
      left.add(rest.length);
    }
    expect([...left].length).toBeGreaterThan(1); // sometimes the land comes first (two permanents stay), sometimes last (none stay)
  });
  it('negative: a land is sacrificed first: the process stops (a second permanent is not sacrificed)', () => {
    const { s } = run('d28-lands', ['Plains', 'Plains']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(1);
    expect(s.zones.graveyard.p2!.length).toBe(1);
  });
  it("ruling 2012-05-01: a permanent that can't be sacrificed is still picked at random and stays, and the process ends (24 seeds)", () => {
    const outcomes = new Set<string>();
    for (const seed of Array.from({ length: 24 }, (_, i) => `d28-cs${i}`)) {
      const s0 = scenario([], { seed, defs: [TYRANT, card('Test Anchor', 'Artifact', "This artifact can't be sacrificed.")], p1: { hand: ['Test Discord Tyrant'] }, p2: { battlefield: ['Test Anchor', 'Plains'] } });
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Discord Tyrant', 'hand', 'p1') }));
      expect(s.zones.graveyard.p2!.length, seed).toBeLessThanOrEqual(1);
      expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Anchor'), seed).toBe(true);
      outcomes.add(String(s.zones.graveyard.p2!.length));
    }
    expect([...outcomes].sort()).toEqual(['0', '1']); // sometimes the anchor is picked (nothing sacrificed), sometimes the land
  });
  it('negative: the opponent controls nothing: nothing happens and the process does not run on', () => {
    const { s } = run('d28-empty', []);
    expect(s.zones.graveyard.p2!.length).toBe(0);
    expect(find(s, 'Test Discord Tyrant', 'battlefield', 'p1')).toBeDefined();
  });
});

// ---- The Nipton Lottery -------------------------------------------------------------------------------------------------------------------------------------------
const LOTTERY = card('Test Lottery', 'Sorcery', 'Choose a creature at random. You gain control of that creature until end of turn. Untap it. It gains haste until end of turn. Then destroy all other creatures.');
const critter = (n: string): CardDef => card(n, 'Creature — Bear', '', { pt: ['2', '2'] });
describe('CR 608.2d, 109.2: "Choose a creature at random. You gain control of that creature until end of turn. Untap it. It gains haste until end of turn. Then destroy all other creatures."', () => {
  it('is fully automated', () => { expect(noManual(LOTTERY) && LOTTERY.automation.level === 'full').toBe(true); });
  it('exactly one creature survives, under your control, untapped and hasty; the others are destroyed; the survivor is any creature over the seeds', () => {
    const survivors = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = scenario([], { seed, defs: [LOTTERY, critter('Test Bear A'), critter('Test Bear B'), critter('Test Bear C')], p1: { hand: ['Test Lottery'], battlefield: [{ name: 'Test Bear A', since: -1 }] }, p2: { battlefield: [{ name: 'Test Bear B', since: -1, tapped: true } as never, { name: 'Test Bear C', since: -1 }] } });
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Lottery', 'hand', 'p1') }));
      const alive = s.zones.battlefield.filter((id) => chars(s, id).types.includes('Creature'));
      expect(alive.length, seed).toBe(1);
      const id = alive[0]!;
      expect(s.objects[id]!.controller, seed).toBe('p1');
      expect(s.objects[id]!.tapped, seed).toBe(false);
      expect(hasKeyword(chars(s, id), 'haste'), seed).toBe(true);
      survivors.add(nameOf(s, id));
    }
    expect(survivors.size).toBeGreaterThan(1);
  });
  it('negative: with no other creature, the one creature is still yours until end of turn and nothing else is destroyed', () => {
    const s0 = scenario([], { defs: [LOTTERY, critter('Test Bear B')], p1: { hand: ['Test Lottery'] }, p2: { battlefield: [{ name: 'Test Bear B', since: -1 }] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Lottery', 'hand', 'p1') }));
    const bear = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bear B')!;
    expect(s.objects[bear]!.controller).toBe('p1');
  });
});

// ---- Sinister Waltz -----------------------------------------------------------------------------------------------------------------------------------------------
const WALTZ = card('Test Waltz', 'Sorcery', 'Choose three target creature cards in your graveyard. Return two of them at random to the battlefield and put the other on the bottom of your library.');
describe('CR 608.2d, 400.7: "Choose three target creature cards in your graveyard. Return two of them at random to the battlefield and put the other on the bottom of your library."', () => {
  it('is fully automated', () => { expect(noManual(WALTZ) && WALTZ.automation.level === 'full').toBe(true); });
  it('two of the three come back, the third goes to the bottom of your library; a card you did not target stays in the graveyard; every card is the one left over on some seed', () => {
    const left = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = scenario([], { seed, defs: [WALTZ, critter('Test Bear A'), critter('Test Bear B'), critter('Test Bear C'), critter('Test Bear D')], p1: { hand: ['Test Waltz'], graveyard: ['Test Bear A', 'Test Bear B', 'Test Bear C', 'Test Bear D'] } });
      const targets = ['Test Bear A', 'Test Bear B', 'Test Bear C'].map((n) => find(s0, n, 'graveyard', 'p1'));
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Waltz', 'hand', 'p1') }), targets);
      const back = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => nameOf(s, id)).sort();
      expect(back.length, seed).toBe(2);
      const bottom = s.zones.library.p1![s.zones.library.p1!.length - 1]!;
      expect(['Test Bear A', 'Test Bear B', 'Test Bear C'], seed).toContain(nameOf(s, bottom));
      expect(back, seed).not.toContain(nameOf(s, bottom));
      expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id)).sort(), seed).toEqual(['Test Bear D', 'Test Waltz']); // (the spell itself, and the card that was not targeted)
      left.add(nameOf(s, bottom));
    }
    expect(left.size).toBe(3);
  });
});

describe('ruling 2021-11-19: Sinister Waltz with only two legal targets as it resolves', () => {
  const HEX = card('Test Hex', 'Instant', 'Exile target creature card from a graveyard.');
  it('both legal targets come back and nothing is put on the bottom of the library', () => {
    const s0 = scenario([], { defs: [WALTZ, HEX, critter('Test Bear A'), critter('Test Bear B'), critter('Test Bear C')], p1: { hand: ['Test Waltz'], graveyard: ['Test Bear A', 'Test Bear B', 'Test Bear C'] }, p2: { hand: ['Test Hex'] } });
    const targets = ['Test Bear A', 'Test Bear B', 'Test Bear C'].map((n) => find(s0, n, 'graveyard', 'p1'));
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Waltz', 'hand', 'p1') }), targets);
    const libBefore = s.zones.library.p1!.length;
    s = pass(s); // p1 passes priority: p2 may respond
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hex', 'hand', 'p2') }), [targets[2]!]);
    s = resolveAll(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear A', 'Test Bear B']);
    expect(s.zones.library.p1!.length).toBe(libBefore);
  });
});

// ---- Radiant Scrollwielder ---------------------------------------------------------------------------------------------------------------------------------------
const WIELDER = card('Test Scroll Keeper', 'Creature — Dwarf', 'At the beginning of your upkeep, exile an instant or sorcery card at random from your graveyard. You may cast it this turn. If a spell cast this way would be put into your graveyard, exile it instead.', { pt: ['2', '2'] });
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
describe('CR 614.1a, 400.7: "Exile an instant or sorcery card at random from your graveyard. You may cast it this turn. If a spell cast this way would be put into your graveyard, exile it instead."', () => {
  it('is fully automated', () => { expect(noManual(WIELDER) && WIELDER.automation.level === 'full').toBe(true); });
  it('the exiled card is cast, resolves and goes to exile, not the graveyard; a creature card in the graveyard is not exiled', () => {
    const s0 = scenario([], { defs: [WIELDER, ZAP, critter('Test Bear A')], p1: { battlefield: [{ name: 'Test Scroll Keeper', since: -1 }], graveyard: ['Test Zap', 'Test Bear A'] } });
    let s = runUntil(s0, (x) => x.turn.number >= 3 && x.turn.step === 'upkeep' && x.turn.activePlayer === 'p1' && x.pending?.kind === 'priority', 'p1 upkeep');
    s = resolveAll(s);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Zap');
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).toEqual(['Test Bear A']);
    const exiled = find(s, 'Test Zap', 'exile', 'p1');
    s = runUntil(s, (x) => x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main phase');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: exiled }));
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id)), 'cast this way: exiled, not put into the graveyard').not.toContain('Test Zap');
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Zap');
  });
});

// ---- Fervent Mastery ------------------------------------------------------------------------------------------------------------------------------------------------
const MASTERY = card('Test Hunger', 'Sorcery', "You may pay {1} rather than pay this spell's mana cost.\nIf the {1} cost was paid, an opponent discards any number of cards, then draws that many cards.\nSearch your library for up to three cards, put them into your hand, shuffle, then discard three cards at random.", { cost: '{2}' });
describe('CR 701.23a, 701.9a, 608.2c: "Search your library for up to three cards, put them into your hand, shuffle, then discard three cards at random."', () => {
  it('is fully automated (\"them\" is the cards found, not the cards an earlier sentence made an opponent discard)', () => { expect(noManual(MASTERY) && MASTERY.automation.level === 'full').toBe(true); });
  it('three cards come into your hand, then three cards of your hand are discarded at random (the hand ends as it was, the graveyard holds three more cards and the spell)', () => {
    const s0 = scenario([], { defs: [MASTERY], p1: { hand: ['Test Hunger', 'Plains', 'Plains'], battlefield: ['Plains', 'Plains'] } });
    const handBefore = s0.zones.hand.p1!.length;
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hunger', 'hand', 'p1') }));
    expect(s.zones.hand.p1!.length).toBe(handBefore - 1); // -1 the spell, +3 searched, -3 discarded
    expect(s.zones.graveyard.p1!.length).toBe(1 + 3);
    expect(s.zones.hand.p2!.length).toBe(s0.zones.hand.p2!.length); // negative: the alternative cost was not paid: the opponent discarded nothing
  });
});
