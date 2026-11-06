/**
 * Commander lane edh-top, round edh-top-5: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler. The rulings of the cards were fetched from
 * Scryfall in the session; CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session unless a test says otherwise.
 *
 *   CR 701.15a, 701.15b, 122.1, 608.2c    "Put a double strike counter on target creature, then goad each creature that had a double strike counter put on it this way."
 *   CR 101.4, 608.2d, 701.15a, 122.6      "Each player may put two +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way."
 *   CR 508.1b-d, 701.21a, 108.3           "~ attacks each combat if able, can't be sacrificed, and can't attack its owner." / "... and can't attack its owner or planeswalkers its owner controls."
 *   CR 614.12, 110.2, 108.3               "~ enters under the control of an opponent of your choice."
 *   CR 108.4, 613.1b, 701.26b, 122.1      "That player gains control of ~, untaps it, and puts a +1/+1 counter on it."
 *   CR 609.4b, 107.4c, 611.2a             "Until end of turn, you may play that card, and you may spend mana as though it were mana of any color to cast it."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, commanderOptions, compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, life, pass, passBoth, put, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { legend } from '../../m11/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;

interface Script {
  yes?: boolean[];
  objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[];
  targets?: TargetChoice[][];
  colors?: string[];
  options?: string[][];
  attackers?: ObjectId[];
  defender?: PlayerId;
  blocks?: { blocker: ObjectId; attacker: ObjectId }[];
}
/** Answer the decisions that come up until a player has priority; the decisions asked are listed in `asked`. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (script.colors?.shift() ?? p.options[0]) as never });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: (script.attackers ?? []).map((attacker) => ({ attacker, defender: script.defender ?? ('p2' as const) })) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: script.blocks ?? [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes (in turn, all of them in a game of three or four) until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 120; guard++) s = drive(pass(s), script, asked);
  return s;
}
const castFree = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1', asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script, asked), script, asked);
/** p2's cast of `name` at `target`, as far as choosing the target: a throw means the target is not legal. */
const castAt = (s: GameState, name: string, target: TargetChoice) => answer(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') }), { kind: 'chooseTargets', targets: [target] });
/** Whether `attacker` (of the player whose declaration is pending) may be declared as an attacker of `defender` (a player id) now. */
const attackOk = (s: GameState, attacker: ObjectId, defender: PlayerId): boolean => {
  const d = s.pending;
  if (!d || d.kind !== 'declareAttackers') throw new Error(`no declaration pending: ${d?.kind}`);
  return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker, defender }] } }).error === undefined;
};
/** Everyone passes (declaring no attackers and no blockers, declining optional effects) until `turn`'s declare attackers decision is asked. */
function toDeclaration(s0: GameState, turn: number): GameState {
  let s = s0;
  for (let guard = 0; guard < 600; guard++) {
    const d = s.pending;
    if (d?.kind === 'declareAttackers' && s.turn.number === turn) return s;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else s = pass(s);
  }
  throw new Error(`could not reach the attackers of turn ${turn}`);
}
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const BEAR = (n: string): CardDef => card(`Test Bear ${n}`, 'Creature — Bear', '', { pt: ['2', '2'] });

const goadedBy = (s: GameState, id: ObjectId): PlayerId[] => (s.objects[id]!.goaded ?? []).map((g) => g.by);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;

// ---- Spectacular Showdown ---------------------------------------------------------------------------------------------------------------------------------------------

const SHOWDOWN = card('Test Showdown', 'Sorcery', 'Put a double strike counter on target creature, then goad each creature that had a double strike counter put on it this way.');

describe('CR 701.15a, 122.1, 608.2c: "Put a double strike counter on target creature, then goad each creature that had a double strike counter put on it this way."', () => {
  const WARDEN = card('Test Warden', 'Enchantment', "Counters can't be put on creatures.");
  const setup = (extra: string[] = []): GameState => mpScenario({
    players: 4, defs: [SHOWDOWN, BEAR('A'), BEAR('B'), WARDEN],
    zones: { p1: { hand: ['Test Showdown'], battlefield: ['Test Bear A', ...extra] }, p2: { battlefield: ['Test Bear B'] } },
  });
  it('is automated', () => expect(full(SHOWDOWN)).toBe(true));
  it('the creature gets the counter and is goaded by the spell controller (CR 701.15a)', () => {
    const s0 = setup();
    const bear = find(s0, 'Test Bear B', 'battlefield', 'p2');
    const s = castFree(s0, 'Test Showdown', { targets: [[obj(bear)]] });
    expect(counters(s, bear, 'double strike')).toBe(1);
    expect(goadedBy(s, bear)).toEqual(['p1']);
  });
  it('another creature that got no counter is not goaded (the negative case)', () => {
    const s0 = setup();
    const target = find(s0, 'Test Bear B', 'battlefield', 'p2');
    const mine = find(s0, 'Test Bear A', 'battlefield', 'p1');
    const s = castFree(s0, 'Test Showdown', { targets: [[obj(target)]] });
    expect(goadedBy(s, mine)).toEqual([]);
  });
  it('a creature that can not have counters put on it gets none and is not goaded (Agitator Ant ruling 2020-04-17)', () => {
    const s0 = setup(['Test Warden']);
    const bear = find(s0, 'Test Bear B', 'battlefield', 'p2');
    const s = castFree(s0, 'Test Showdown', { targets: [[obj(bear)]] });
    expect(counters(s, bear, 'double strike')).toBe(0);
    expect(goadedBy(s, bear)).toEqual([]);
  });
});

describe('CR 702.96a, 701.15a, 122.1: the overloaded spell ("Overload {1}": "target" becomes "each") puts the counter on each creature and goads each that got one', () => {
  const OVER = card('Test Overload Showdown', 'Sorcery', 'Put a double strike counter on target creature, then goad each creature that had a double strike counter put on it this way.\nOverload {1}');
  it('is automated', () => expect(full(OVER)).toBe(true));
  it('every creature gets the counter and every one is goaded; the spell had no target (CR 702.96b)', () => {
    const s0 = mpScenario({ players: 4, defs: [OVER, BEAR('A'), BEAR('B'), BEAR('C')], zones: { p1: { hand: ['Test Overload Showdown'], battlefield: ['Test Bear A'] }, p2: { battlefield: ['Test Bear B'] }, p3: { battlefield: ['Test Bear C'] } } });
    s0.players[0]!.manaPool.push({ type: 'C' } as never);
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Overload Showdown', 'hand', 'p1'), method: 'overload' });
    expect(t.pending?.kind).not.toBe('chooseTargets');
    const s = settle(drive(t, {}), {});
    for (const [n, p] of [['A', 'p1'], ['B', 'p2'], ['C', 'p3']] as const) {
      const id = find(s, `Test Bear ${n}`, 'battlefield', p);
      expect(counters(s, id, 'double strike')).toBe(1);
      expect(goadedBy(s, id)).toEqual(['p1']);
    }
  });
});

// ---- Agitator Ant -----------------------------------------------------------------------------------------------------------------------------------------------------

const ANT = card('Test Ant', 'Creature — Insect', 'At the beginning of your end step, each player may put two +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way.', { pt: ['2', '2'] });
const STIR = card('Test Stir', 'Sorcery', 'Each player may put two +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way.');

describe('CR 101.4, 608.2d, 701.15a: "Each player may put two +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way."', () => {
  const setup = (): GameState => mpScenario({
    players: 4, defs: [STIR, BEAR('A'), BEAR('B'), BEAR('C'), BEAR('D')],
    zones: { p1: { hand: ['Test Stir'], battlefield: ['Test Bear A'] }, p2: { battlefield: ['Test Bear B'] }, p3: { battlefield: ['Test Bear C'] }, p4: { battlefield: ['Test Bear D'] } },
  });
  it('the trigger version is automated', () => expect(full(ANT)).toBe(true));
  it('only the creatures that got counters are goaded, by the controller of the ability; the player who declined keeps a plain creature (the negative case)', () => {
    const s0 = setup();
    const ids = ['A', 'B', 'C', 'D'].map((n, i) => find(s0, `Test Bear ${n}`, 'battlefield', `p${i + 1}` as PlayerId));
    const asked: string[] = [];
    const s = castFree(s0, 'Test Stir', { yes: [true, true, false, true], objects: [(o) => o.slice(0, 1), (o) => o.slice(0, 1), (o) => o.slice(0, 1)] }, 'p1', asked);
    expect(ids.map((id) => counters(s, id))).toEqual([2, 2, 0, 2]);
    expect(ids.map((id) => goadedBy(s, id))).toEqual([['p1'], ['p1'], [], ['p1']]);
  });
  it('nobody choosing means nobody is goaded', () => {
    const s0 = setup();
    const s = castFree(s0, 'Test Stir', { yes: [false, false, false, false] });
    for (const n of ['A', 'B', 'C', 'D']) expect(goadedBy(s, find(s, `Test Bear ${n}`, 'battlefield'))).toEqual([]);
  });
  it('a player who controls no creature can not choose one, so adds nothing', () => {
    const s0 = mpScenario({ players: 4, defs: [STIR, BEAR('A'), BEAR('B')], zones: { p1: { hand: ['Test Stir'], battlefield: ['Test Bear A'] }, p2: { battlefield: ['Test Bear B'] } } });
    const s = castFree(s0, 'Test Stir', { yes: [true, true, true, true], objects: [(o) => o.slice(0, 1), (o) => o.slice(0, 1)] });
    expect(goadedBy(s, find(s, 'Test Bear A', 'battlefield'))).toEqual(['p1']);
    expect(goadedBy(s, find(s, 'Test Bear B', 'battlefield'))).toEqual(['p1']);
  });
});

describe('CR 701.15a: only a creature is goaded, whatever else had counters put on it this way', () => {
  const ROCK = card('Test Rock', 'Artifact', '');
  const STIR_ARTIFACT = card('Test Stir Artifact', 'Sorcery', 'Each player may put two +1/+1 counters on an artifact they control. Goad each creature that had counters put on it this way.');
  it('is automated', () => expect(full(STIR_ARTIFACT)).toBe(true));
  it('an artifact that is not a creature gets the counters and is not goaded; an artifact creature is', () => {
    const MECH = card('Test Mech', 'Artifact Creature — Construct', '', { pt: ['1', '1'] });
    const s0 = mpScenario({ players: 4, defs: [STIR_ARTIFACT, ROCK, MECH], zones: { p1: { hand: ['Test Stir Artifact'], battlefield: ['Test Rock'] }, p2: { battlefield: ['Test Mech'] } } });
    const rock = find(s0, 'Test Rock', 'battlefield', 'p1');
    const mech = find(s0, 'Test Mech', 'battlefield', 'p2');
    const s = castFree(s0, 'Test Stir Artifact', { yes: [true, true, false, false], objects: [(o) => o.slice(0, 1), (o) => o.slice(0, 1)] });
    expect(counters(s, rock)).toBe(2);
    expect(goadedBy(s, rock)).toEqual([]);
    expect(counters(s, mech)).toBe(2);
    expect(goadedBy(s, mech)).toEqual(['p1']);
  });
});

// ---- Alexios, Deimos of Kosmos ----------------------------------------------------------------------------------------------------------------------------------------

const BERSERKER = card('Test Berserker', 'Creature — Human Berserker', "Trample\nTest Berserker attacks each combat if able, can't be sacrificed, and can't attack its owner.\nAt the beginning of each player's upkeep, that player gains control of Test Berserker, untaps it, and puts a +1/+1 counter on it. It gains haste until end of turn.", { pt: ['4', '4'] });
const PLANESWALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.', { loyalty: '4' });

describe("CR 508.1b-d, 701.21a, 108.3, 108.4, 613.1b, 701.26b: Alexios's \"attacks each combat if able, can't be sacrificed, and can't attack its owner\" and its upkeep trigger", () => {
  const setup = (): GameState => mpScenario({
    players: 4, defs: [BERSERKER, PLANESWALKER, BEAR('A')], zones: { p1: { battlefield: [{ name: 'Test Berserker', since: 1 }, { name: 'Test Walker', counters: { loyalty: 4 } }, 'Test Bear A'] } },
  });
  it('is automated (all four abilities)', () => expect(full(BERSERKER)).toBe(true));
  it('its owner can not be attacked by it, even while another player controls it; another opponent and the owner\'s planeswalker can (the ruling of 2024-07-05)', () => {
    const s0 = setup();
    const id = find(s0, 'Test Berserker', 'battlefield', 'p1');
    const walker = find(s0, 'Test Walker', 'battlefield', 'p1');
    // p2's turn (turn 2): p2 gains control at the upkeep; the owner is p1
    const s = toDeclaration(s0, 2);
    expect(s.pending?.player).toBe('p2');
    expect(s.objects[id]!.controller).toBe('p2');
    expect(s.objects[id]!.owner).toBe('p1');
    expect(counters(s, id)).toBe(1);
    expect(attackOk(s, id, 'p1')).toBe(false); // can't attack its owner
    expect(attackOk(s, id, 'p3')).toBe(true);
    expect(applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: id, defender: walker }] } }).error).toBeUndefined(); // a planeswalker its owner controls stays attackable
  });
  it('it attacks each combat if able: a declaration without it is refused when it can attack (the negative case: it is not forced when it could not attack)', () => {
    const s0 = setup();
    const id = find(s0, 'Test Berserker', 'battlefield', 'p1');
    const s = toDeclaration(s0, 2);
    const none = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [] } });
    expect(none.error).toBeDefined();
    expect(s.objects[id]!.tapped).toBe(false); // untapped by the trigger, and it has haste until end of turn so it could attack
  });
  it('it gains haste until end of turn: the creature that just came under p2\'s control attacks the turn p2 gets it (CR 302.6)', () => {
    const s = toDeclaration(setup(), 2);
    const id = find(s, 'Test Berserker', 'battlefield');
    expect(attackOk(s, id, 'p3')).toBe(true);
  });
  it('the new controller puts the counter (CR 122.6): a "twice that many counters" effect of the new controller doubles it, one of the old controller does not', () => {
    const DOUBLER = card('Test Doubler', 'Creature — Elf', 'If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead.', { pt: ['1', '1'] });
    const at = (who: PlayerId): number => {
      const s0 = mpScenario({ players: 4, defs: [BERSERKER, DOUBLER, BEAR('A')], zones: { p1: { battlefield: [{ name: 'Test Berserker', since: 1 }, 'Test Bear A'] }, [who]: { battlefield: ['Test Doubler'] } } });
      const id = find(s0, 'Test Berserker', 'battlefield', 'p1');
      return counters(toDeclaration(s0, 2), id);
    };
    expect(at('p2')).toBe(2); // p2 gains control and puts the counter: its own doubler applies
    expect(at('p3')).toBe(1); // p3's doubler is not the putter's
  });
  it('can not be sacrificed (CR 701.21a): a sacrifice effect finds nothing to sacrifice but the other creature', () => {
    const SAC = card('Test Edict', 'Sorcery', 'Target player sacrifices a creature.');
    const s0 = mpScenario({ players: 4, defs: [BERSERKER, SAC, BEAR('A')], zones: { p1: { hand: ['Test Edict'], battlefield: ['Test Berserker'] }, p2: { battlefield: ['Test Bear A'] } } });
    const berserker = find(s0, 'Test Berserker', 'battlefield', 'p1');
    const s = castFree(s0, 'Test Edict', { targets: [[pl('p1')]] });
    expect(s.objects[berserker]!.zone).toBe('battlefield');
  });
});

// ---- Xantcha, Sleeper Agent -------------------------------------------------------------------------------------------------------------------------------------------

const SLEEPER = card('Test Sleeper', 'Legendary Creature — Phyrexian Minion', "Test Sleeper enters under the control of an opponent of your choice.\nTest Sleeper attacks each combat if able and can't attack its owner or planeswalkers its owner controls.", { cost: '{0}', pt: ['5', '5'] });

describe('CR 614.12, 110.2, 108.3, 508.1b-d: "~ enters under the control of an opponent of your choice." and "can\'t attack its owner or planeswalkers its owner controls"', () => {
  const setup = (): GameState => mpScenario({
    players: 4, defs: [SLEEPER, PLANESWALKER], zones: { p1: { hand: ['Test Sleeper'], battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }] } },
  });
  it('is automated', () => expect(full(SLEEPER)).toBe(true));
  it('it enters under the control of the opponent its owner chooses; its owner stays p1 (CR 108.3)', () => {
    const asked: string[] = [];
    const s = castFree(setup(), 'Test Sleeper', { options: [['p3']] }, 'p1', asked);
    const id = find(s, 'Test Sleeper', 'battlefield');
    expect(s.objects[id]!.owner).toBe('p1');
    expect(s.objects[id]!.controller).toBe('p3');
  });
  it('with a different choice another opponent controls it (the negative case: it never stays under its owner)', () => {
    const s = castFree(setup(), 'Test Sleeper', { options: [['p4']] });
    const id = find(s, 'Test Sleeper', 'battlefield');
    expect(s.objects[id]!.controller).toBe('p4');
  });
  it("it can't attack its owner or planeswalkers its owner controls, but can attack another player (CR 508.1b-c)", () => {
    let s = castFree(setup(), 'Test Sleeper', { options: [['p2']] });
    const id = find(s, 'Test Sleeper', 'battlefield');
    const walker = find(s, 'Test Walker', 'battlefield', 'p1');
    s = toDeclaration(s, 2);
    expect(s.pending?.player).toBe('p2');
    expect(attackOk(s, id, 'p1')).toBe(false);
    expect(applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: id, defender: walker }] } }).error).toBeDefined();
    expect(attackOk(s, id, 'p3')).toBe(true);
  });
});

// ---- You Find Some Prisoners (the permission of its second mode) -------------------------------------------------------------------------------------------------------

const PEEK = card('Test Peek', 'Sorcery', "Exile the top card of target opponent's library. Until end of turn, you may play that card, and you may spend mana as though it were mana of any color to cast it.");
const BURN = card('Test Burn', 'Instant', 'Test Burn deals 1 damage to each opponent.', { cost: '{R}', colors: ['R'] });

describe("CR 609.4b, 107.4c, 611.2a: \"Until end of turn, you may play that card, and you may spend mana as though it were mana of any color to cast it.\"", () => {
  const setup = (): GameState => mpScenario({
    players: 4, defs: [PEEK, BURN],
    zones: { p1: { hand: ['Test Peek'], battlefield: ['Plains'] }, p2: { library: ['Test Burn'] } },
  });
  const castBurn = (s: GameState): GameState => {
    const id = find(s, 'Test Burn', 'exile');
    return drive(act(s, { type: 'cast', player: 'p1', card: id }), {});
  };
  it('is automated', () => expect(full(PEEK)).toBe(true));
  it('the exiled red spell is cast with white mana (CR 609.4b); its target player loses nothing before and 1 life after', () => {
    const s0 = castFree(setup(), 'Test Peek', { targets: [[pl('p2')]] });
    expect(s0.objects[find(s0, 'Test Burn', 'exile')]).toBeDefined();
    const s = settle(castBurn(s0));
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('without the any-color clause a red spell needs red mana (the negative case: the plain permission does not allow white mana)', () => {
    const PLAIN = card('Test Plain Peek', 'Sorcery', "Exile the top card of target opponent's library. Until end of turn, you may play that card.");
    const s0 = mpScenario({ players: 4, defs: [PLAIN, BURN], zones: { p1: { hand: ['Test Plain Peek'], battlefield: ['Plains'] }, p2: { library: ['Test Burn'] } } });
    const s1 = castFree(s0, 'Test Plain Peek', { targets: [[pl('p2')]] });
    const id = find(s1, 'Test Burn', 'exile');
    let s = s1;
    try { s = settle(drive(act(s1, { type: 'cast', player: 'p1', card: id }), {})); } catch { /* the cast or its payment is refused */ }
    expect(lifeOf(s, 'p2')).toBe(20); // the red spell was not cast and resolved with white mana
    expect(s.objects[id]?.zone).not.toBe('graveyard');
  });
  it('the permission ends with the turn (CR 611.2a): on the next turn the card can not be cast', () => {
    const s0 = castFree(setup(), 'Test Peek', { targets: [[pl('p2')]] });
    const s = advanceTo(s0, 2, 'main1');
    const id = find(s, 'Test Burn', 'exile');
    expect(applyAction(s, { type: 'cast', player: s.turn.activePlayer, card: id }).error).toBeDefined();
  });
});
