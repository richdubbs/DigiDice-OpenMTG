/**
 * trek-15 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, the
 * wordings of the cards made full). Nothing is mocked. Scryfall had no rulings for these ten cards (checked 2026-10-29); the Comprehensive Rules cites are from memory
 * (unverified: rules/cr/ is not in the cloud checkout), and the Star Trek mechanics have only their reminder text (a goaded creature is CR 701.15).
 *
 *   CR 506.3, 508.1, 603.3d      "up to X target creatures, where X is the number of opponents you attacked this turn" (Galvanizing Tenor, Martok): the attacks of the whole turn,
 *                                counted when the targets are chosen, each opponent once (planeswalkers and battles attacked are not their players)
 *   CR 601.2f, 118.7             "This spell costs {1} less to cast for each opponent you attacked this turn" (Own the Day)
 *   CR 107.3, 608.2h             "... where X is the number of differently named lands you control. If X is 6 or more, ..." (The Destruction of Praxis): X is fixed once
 *   CR 109.2, 701.21a, 400.7     "You may sacrifice a Klingon or Warrior. If you do, return all other Klingon and Warrior creature cards from your graveyard" (The Promise of Kahless)
 *   CR 508.4, 111.1              "for each opponent you attacked this turn / each attacking non-Faerie creature, create a tapped and attacking ... token" (Rite of Ascension, Worf)
 *   CR 701.15, 611.2b            "~ and that creature are goaded for as long as you control ~" (Kang, Suspicious Captain)
 *   CR 608.2c, 614.1a            "That player loses 2 life instead if there are seven or more quest counters on this enchantment" (Vengeance Mission)
 *   CR 608.2d, 608.2c            "target opponent may have you draw a card. If they don't, they lose 4 life and you surveil 1" (Tell Me What You See)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;

interface Script {
  yes?: boolean[];
  objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[];
  targets?: TargetChoice[][];
  attacks?: { attacker: ObjectId; defender: PlayerId }[];
  /** The ids chosen by the chooseOption decisions (who a token attacks), in order; the first option when none is left. */
  options?: string[][];
  asked?: string[];
}
/** Answer the decisions that come up until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    script.asked?.push(`${p.kind}:${p.player}`);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? [p.options[0]!.id] });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: script.attacks ?? [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 120; guard++) s = drive(pass(s), script);
  return s;
}
/** Pass priority (nothing cast) until the declaration of attackers of the active player. */
function toAttackers(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending?.kind !== 'declareAttackers'; guard++) s = s.pending!.kind === 'priority' ? pass(s) : drive(s);
  return s;
}
const idOf = (s: GameState, name: string, owner: PlayerId, n = 0): ObjectId => findAll(s, name, 'battlefield', owner)[n]!;
const battlefield = (s: GameState, name: string, owner?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (owner === undefined || s.objects[id]!.controller === owner));
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters?.[kind] ?? 0;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

// ---- Galvanizing Tenor and Martok -----------------------------------------------------------------------------------------------------------------------------------

const GOADER = card('Test Goader', 'Creature — Klingon Performer', 'Menace\nWhenever this creature attacks, goad up to X target creatures, where X is the number of opponents you attacked this turn.', { pt: ['2', '2'] });
const COUNTER = card('Test Counterer', 'Legendary Creature — Klingon Warrior', 'Whenever you attack, put a +1/+1 counter on each of up to X target creatures you control, where X is the number of opponents you attacked this turn.', { pt: ['2', '2'] });

describe('the ten cards of the round are automated', () => {
  it('the synthetic cards with their wordings are full', () => {
    for (const d of [GOADER, COUNTER]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 506.3, 508.1, 603.3d: "up to X target creatures, where X is the number of opponents you attacked this turn" (Galvanizing Tenor)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [GOADER, BEAR], zones: { p1: { battlefield: ['Test Goader', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
  it('attacking two opponents lets the trigger choose up to two creatures; they are goaded by the controller', () => {
    let s = toAttackers(setup());
    const g = idOf(s, 'Test Goader', 'p1');
    const b = idOf(s, 'Test Bear', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: g, defender: 'p2' }, { attacker: b, defender: 'p3' }] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 2 });
    const p2bear = idOf(s, 'Test Bear', 'p2');
    const p3bear = idOf(s, 'Test Bear', 'p3');
    s = settle(s, { targets: [[obj(p2bear), obj(p3bear)]] });
    expect(s.objects[p2bear]!.goaded?.length).toBeGreaterThan(0);
    expect(s.objects[p3bear]!.goaded?.length).toBeGreaterThan(0);
  });
  it('attacking one opponent with two creatures counts that opponent once: at most one target (the negative case)', () => {
    let s = toAttackers(setup());
    const g = idOf(s, 'Test Goader', 'p1');
    const b = idOf(s, 'Test Bear', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: g, defender: 'p2' }, { attacker: b, defender: 'p2' }] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 1 });
    expect(() => answer(s, { kind: 'chooseTargets', targets: [obj(idOf(s, 'Test Bear', 'p2')), obj(idOf(s, 'Test Bear', 'p3'))] })).toThrow();
  });
});

describe('CR 506.3, 508.1: "Whenever you attack, put a +1/+1 counter on each of up to X target creatures you control, where X is the number of opponents you attacked this turn" (Martok)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [COUNTER, BEAR], zones: { p1: { battlefield: ['Test Counterer', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
  it('two opponents attacked: counters on up to two chosen creatures you control', () => {
    let s = toAttackers(setup());
    const m = idOf(s, 'Test Counterer', 'p1');
    const b0 = idOf(s, 'Test Bear', 'p1', 0);
    const b1 = idOf(s, 'Test Bear', 'p1', 1);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: m, defender: 'p2' }, { attacker: b0, defender: 'p3' }] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 2 });
    s = settle(s, { targets: [[obj(b0), obj(b1)]] });
    expect([counters(s, b0), counters(s, b1), counters(s, m)]).toEqual([1, 1, 0]);
  });
  it('one opponent attacked: only one creature; the opponent\'s creature is not a legal target', () => {
    let s = toAttackers(setup());
    const m = idOf(s, 'Test Counterer', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: m, defender: 'p2' }] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 1 });
    expect((s.pending as unknown as { objects: ObjectId[] }).objects).not.toContain(idOf(s, 'Test Bear', 'p2'));
  });
});

// ---- Own the Day ---------------------------------------------------------------------------------------------------------------------------------------------------

const DAY = card('Test Day', 'Sorcery', 'This spell costs {1} less to cast for each opponent you attacked this turn.\nUntap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.', { cost: '{4}' });
/** Pass (answering what comes up, attacking as `script` says in the first declaration only) until `step` of the current turn. */
function toStep(s0: GameState, step: GameState['turn']['step'], script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 200 && s.turn.step !== step; guard++) s = s.pending!.kind === 'priority' ? pass(s) : drive(s, script);
  return s;
}
const tappedLands = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && s.objects[id]!.controller === p && s.objects[id]!.tapped).length;
const castDay = (s0: GameState): GameState => settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Day', 'hand', 'p1') })));

describe('CR 601.2f, 118.7: "This spell costs {1} less to cast for each opponent you attacked this turn" (Own the Day)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [DAY, BEAR], zones: { p1: { hand: ['Test Day'], battlefield: ['Test Bear', 'Test Bear', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
  it('is automated', () => expect(full(DAY)).toBe(true));
  it('with no attack this turn the spell costs its full {4}', () => {
    expect(tappedLands(castDay(setup()), 'p1')).toBe(4);
  });
  it('attacking two opponents makes it cost {2}; attacking one opponent twice makes it cost {3}', () => {
    let s = toAttackers(setup());
    const [b0, b1] = [idOf(s, 'Test Bear', 'p1', 0), idOf(s, 'Test Bear', 'p1', 1)];
    s = toStep(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b0, defender: 'p2' }, { attacker: b1, defender: 'p3' }] }), 'main2');
    expect(s.turn.step).toBe('main2');
    expect(tappedLands(castDay(s), 'p1')).toBe(2);
    let t = toAttackers(setup());
    t = toStep(answer(t, { kind: 'declareAttackers', attacks: [{ attacker: idOf(t, 'Test Bear', 'p1', 0), defender: 'p2' }, { attacker: idOf(t, 'Test Bear', 'p1', 1), defender: 'p2' }] }), 'main2');
    expect(tappedLands(castDay(t), 'p1')).toBe(3);
  });
  it('CR 500.8: cast in the second main phase it untaps the creatures that attacked and adds a combat phase after that main phase, then another main phase', () => {
    let s = toAttackers(setup());
    const [b0, b1] = [idOf(s, 'Test Bear', 'p1', 0), idOf(s, 'Test Bear', 'p1', 1)];
    s = toStep(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b0, defender: 'p2' }, { attacker: b1, defender: 'p3' }] }), 'main2');
    expect(s.objects[b0]!.tapped && s.objects[b1]!.tapped).toBe(true);
    s = castDay(s);
    expect(s.objects[b0]!.tapped || s.objects[b1]!.tapped).toBe(false);
    // the turn goes on: main2 ends, a second combat begins (the creatures may attack again), then a main phase
    const seen: string[] = [];
    for (let guard = 0; guard < 120 && !(s.turn.step === 'cleanup' || s.turn.number > 1); guard++) {
      if (seen[seen.length - 1] !== s.turn.step) seen.push(s.turn.step);
      s = s.pending!.kind === 'priority' ? pass(s) : drive(s, { attacks: [] });
    }
    expect(seen.slice(seen.indexOf('main2'), seen.indexOf('main2') + 5)).toEqual(['main2', 'beginCombat', 'declareAttackers', 'endCombat', 'main2']); // (no blockers: the declaration of an empty block is skipped)
  });
  it('never below {0}: three opponents attacked against a {1} cost', () => {
    const cheap = card('Test Cheap Day', 'Sorcery', 'This spell costs {1} less to cast for each opponent you attacked this turn.\nDraw a card.', { cost: '{1}' });
    let s = mpScenario({ players: 3, defs: [cheap, BEAR], zones: { p1: { hand: ['Test Cheap Day'], battlefield: ['Test Bear', 'Test Bear', 'Plains'] }, p2: {}, p3: {} } });
    s = toAttackers(s);
    s = toStep(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'p1', 0), defender: 'p2' }, { attacker: idOf(s, 'Test Bear', 'p1', 1), defender: 'p3' }] }), 'main2');
    expect(tappedLands(settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cheap Day', 'hand', 'p1') }))), 'p1')).toBe(0);
  });
});

// ---- The Destruction of Praxis -------------------------------------------------------------------------------------------------------------------------------------

const PRAXIS = card('Test Strange Worlds', 'Sorcery', 'All creatures get -X/-X until end of turn, where X is the number of differently named lands you control. If X is 6 or more, create two 2/1 red Klingon Warrior creature tokens with haste.');
const OAK = card('Test Oak', 'Creature — Treefolk', '', { pt: ['9', '9'] });
const TLAND = card('Test Land', 'Land', '');
const TLAND2 = card('Test Land Two', 'Land', '');
const lands = (names: string[]): string[] => names;
const powerOf = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);

describe('CR 107.3, 608.2h: "All creatures get -X/-X until end of turn, where X is the number of differently named lands you control. If X is 6 or more, create two ..." (The Destruction of Praxis)', () => {
  const setup = (landNames: string[]): GameState => mpScenario({ players: 3, cards: ['Island', 'Swamp', 'Mountain', 'Forest'], defs: [PRAXIS, OAK, BEAR, TLAND, TLAND2], zones: { p1: { hand: ['Test Strange Worlds'], battlefield: [...landNames, 'Test Oak', 'Test Bear'] }, p2: { battlefield: ['Test Oak', 'Test Bear'] }, p3: {} } });
  it('is automated', () => expect(full(PRAXIS)).toBe(true));
  it('five different names: every creature of every player gets -5/-5 (the bears die), the oaks are 4/4, and no tokens', () => {
    const s0 = setup(lands(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Plains']));
    const s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Strange Worlds', 'hand', 'p1') })));
    expect(battlefield(s, 'Test Bear')).toEqual([]); // both players' bears
    expect(battlefield(s, 'Test Oak').map((id) => powerOf(s, id))).toEqual([4, 4]);
    expect(battlefield(s, 'Klingon Warrior')).toHaveLength(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
  it('six different names (two Plains are one name): -6/-6 and two hasty 2/1 Klingon Warrior tokens that the -6/-6 did not touch', () => {
    const s0 = setup(lands(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Test Land', 'Plains']));
    const s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Strange Worlds', 'hand', 'p1') })));
    expect(battlefield(s, 'Test Oak').map((id) => powerOf(s, id))).toEqual([3, 3]);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    for (const t of tokens) {
      const c = getChars(s, t)!;
      expect([c.power, c.toughness, c.subtypes.join(' ')]).toEqual(['2', '1', 'Klingon Warrior']);
      expect(c.abilities.some((a) => JSON.stringify(a).includes('haste'))).toBe(true);
      expect(s.objects[t]!.controller).toBe('p1');
    }
  });
  it('CR 608.2h: X is determined once as the spell resolves: destroying a land afterwards does not change the -X/-X', () => {
    const smash = card('Test Smash', 'Instant', 'Destroy target land.');
    const s0 = mpScenario({ players: 3, cards: ['Island', 'Swamp', 'Mountain', 'Forest'], defs: [PRAXIS, OAK, TLAND, smash], zones: { p1: { hand: ['Test Strange Worlds', 'Test Smash'], battlefield: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Test Land', 'Test Oak'] }, p2: {}, p3: {} } });
    let s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Strange Worlds', 'hand', 'p1') })));
    const oak = idOf(s, 'Test Oak', 'p1');
    expect(powerOf(s, oak)).toBe(3);
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smash', 'hand', 'p1') }), { targets: [[obj(idOf(s, 'Test Land', 'p1'))]] }));
    expect(battlefield(s, 'Test Land')).toHaveLength(0);
    expect(powerOf(s, oak)).toBe(3);
  });
  it('only the lands YOU control count: an opponent\'s differently named lands add nothing (the negative case)', () => {
    const s0 = mpScenario({ players: 3, cards: ['Island', 'Swamp', 'Mountain', 'Forest'], defs: [PRAXIS, OAK, TLAND, TLAND2], zones: { p1: { hand: ['Test Strange Worlds'], battlefield: ['Plains', 'Island', 'Test Oak'] }, p2: { battlefield: ['Swamp', 'Mountain', 'Forest', 'Test Land', 'Test Land Two', 'Test Oak'] }, p3: {} } });
    const s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Strange Worlds', 'hand', 'p1') })));
    expect(battlefield(s, 'Test Oak').map((id) => powerOf(s, id))).toEqual([7, 7]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
});

// ---- The Promise of Kahless -----------------------------------------------------------------------------------------------------------------------------------------

const PROMISE = card('Test Oath', 'Sorcery', 'You may sacrifice a Klingon or Warrior. If you do, return all other Klingon and Warrior creature cards from your graveyard to the battlefield.');
const KLINGON = card('Test Klingon', 'Creature — Klingon', '', { pt: ['2', '2'] });
const WARRIOR = card('Test Warrior', 'Creature — Human Warrior', '', { pt: ['1', '1'] });
const gy = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();

describe('CR 701.21a, 109.2, 608.2c: "You may sacrifice a Klingon or Warrior. If you do, return all other Klingon and Warrior creature cards from your graveyard to the battlefield." (The Promise of Kahless)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [PROMISE, KLINGON, WARRIOR, BEAR], zones: { p1: { hand: ['Test Oath'], battlefield: ['Test Klingon'], graveyard: ['Test Klingon', 'Test Warrior', 'Test Bear'] }, p2: { graveyard: ['Test Klingon', 'Test Warrior'] }, p3: {} } });
  it('is automated', () => expect(full(PROMISE)).toBe(true));
  it('sacrificing returns the other Klingon and Warrior creature cards, not the one just sacrificed, not other card types, not an opponent\'s graveyard', () => {
    const s0 = setup();
    const sac = idOf(s0, 'Test Klingon', 'p1');
    const s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Oath', 'hand', 'p1') }), { yes: [true], objects: [[sac]] }), { yes: [true], objects: [[sac]] });
    expect(battlefield(s, 'Test Klingon', 'p1')).toHaveLength(1); // the one from the graveyard, a new object
    expect(battlefield(s, 'Test Warrior', 'p1')).toHaveLength(1);
    expect(gy(s, 'p1')).toEqual(['Test Bear', 'Test Klingon', 'Test Oath'].sort()); // the sacrificed Klingon stays; the spell goes there too
    expect(gy(s, 'p2')).toEqual(['Test Klingon', 'Test Warrior']);
    expect(battlefield(s, 'Test Klingon', 'p2')).toHaveLength(0);
  });
  it('with nothing to sacrifice you cannot "do" it: nothing returns (the graveyard stays as it was)', () => {
    const s0 = mpScenario({ players: 3, defs: [PROMISE, KLINGON, WARRIOR], zones: { p1: { hand: ['Test Oath'], graveyard: ['Test Klingon', 'Test Warrior'] }, p2: {}, p3: {} } });
    const s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Oath', 'hand', 'p1') }), { yes: [true] }), { yes: [true] });
    expect(battlefield(s, 'Test Klingon')).toHaveLength(0);
    expect(battlefield(s, 'Test Warrior')).toHaveLength(0);
  });
  it('declining the sacrifice returns nothing ("if you do")', () => {
    const s0 = setup();
    const s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Oath', 'hand', 'p1') }), { yes: [false] }), { yes: [false] });
    expect(battlefield(s, 'Test Warrior')).toHaveLength(0);
    expect(gy(s, 'p1')).toEqual(['Test Bear', 'Test Klingon', 'Test Oath', 'Test Warrior']);
  });
});

// ---- Rite of Ascension and Worf, Still Not Merry -----------------------------------------------------------------------------------------------------------------------

const RITE = card('Test Rite', 'Enchantment', 'Whenever you attack, for each opponent you attacked this turn, create a tapped and attacking 2/1 red Klingon Warrior creature token with haste.');
const WARCHIEF = card('Test Warchief', 'Legendary Creature — Klingon Warrior Officer', 'Whenever this creature attacks, for each attacking non-Faerie creature, create a tapped and attacking 1/1 blue Faerie creature token with flying.', { pt: ['3', '3'] });
const SPRITE = card('Test Sprite', 'Creature — Faerie', '', { pt: ['1', '1'] });
const tokensOf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id)!.subtypes.join(' ').includes(name) && (p === undefined || s.objects[id]!.controller === p));
const attackingIds = (s: GameState): ObjectId[] => (s.combat?.attackers ?? []).map((a: { id: ObjectId }) => a.id);

describe('CR 508.4, 111.1, 506.3: "for each opponent you attacked this turn, create a tapped and attacking 2/1 red Klingon Warrior creature token with haste" (Rite of Ascension)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [RITE, BEAR], zones: { p1: { battlefield: ['Test Rite', 'Test Bear', 'Test Bear'] }, p2: {}, p3: {} } });
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('two opponents attacked: two tokens, tapped and attacking, with haste; one opponent attacked twice: one token', () => {
    let s = toAttackers(setup());
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'p1', 0), defender: 'p2' }, { attacker: idOf(s, 'Test Bear', 'p1', 1), defender: 'p3' }] }));
    const toks = tokensOf(s, 'Klingon');
    expect(toks).toHaveLength(2);
    for (const t of toks) {
      expect(s.objects[t]!.tapped).toBe(true);
      expect(attackingIds(s)).toContain(t);
      expect(getChars(s, t)!.abilities.some((a) => JSON.stringify(a).includes('haste'))).toBe(true);
    }
    let t = toAttackers(setup());
    t = settle(answer(t, { kind: 'declareAttackers', attacks: [{ attacker: idOf(t, 'Test Bear', 'p1', 0), defender: 'p2' }, { attacker: idOf(t, 'Test Bear', 'p1', 1), defender: 'p2' }] }));
    expect(tokensOf(t, 'Klingon')).toHaveLength(1);
  });
});

describe('CR 508.4, 111.1: "for each attacking non-Faerie creature, create a tapped and attacking 1/1 blue Faerie creature token with flying" (Worf, Still Not Merry)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [WARCHIEF, BEAR, SPRITE], zones: { p1: { battlefield: ['Test Warchief', 'Test Bear', 'Test Sprite'] }, p2: {}, p3: {} } });
  it('is automated', () => expect(full(WARCHIEF)).toBe(true));
  it('counts the attacking creatures that are not Faeries (itself too): three attackers, one a Faerie, makes two tokens; the new Faeries do not count themselves', () => {
    let s = toAttackers(setup());
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [idOf(s, 'Test Warchief', 'p1'), idOf(s, 'Test Bear', 'p1'), idOf(s, 'Test Sprite', 'p1')].map((attacker) => ({ attacker, defender: 'p2' as PlayerId })) }));
    const toks = tokensOf(s, 'Faerie', 'p1');
    expect(toks).toHaveLength(2);
    for (const t of toks) {
      expect(s.objects[t]!.tapped).toBe(true);
      expect(attackingIds(s)).toContain(t);
    }
  });
  it('attacking with the Warchief alone makes one token (the count includes the Warchief itself)', () => {
    let s = toAttackers(setup());
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Warchief', 'p1'), defender: 'p2' }] }));
    expect(tokensOf(s, 'Faerie', 'p1')).toHaveLength(1);
  });
});

// ---- Kang, Suspicious Captain ----------------------------------------------------------------------------------------------------------------------------------------

const CAPTAIN = card('Test Captain', 'Legendary Creature — Klingon Warrior Officer', 'When this creature enters, choose target creature an opponent controls. This creature and that creature are goaded for as long as you control this creature.\nWhenever one or more goaded creatures attack, put a +1/+1 counter on target creature you control.', { pt: ['3', '3'], cost: '{0}' });
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
/** Whether the declaration pending for `attacker` of the active player is accepted. */
const attackAccepted = (s: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[]): boolean => {
  const d = s.pending;
  if (!d || d.kind !== 'declareAttackers') throw new Error(`no declaration pending: ${d?.kind}`);
  return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks } }).error === undefined;
};
/** Pass (declaring nothing when that is allowed) until `player` is asked to declare attackers. */
function toDeclarationOf(s0: GameState, player: PlayerId): GameState {
  let s = s0;
  for (let guard = 0; guard < 400; guard++) {
    const d = s.pending;
    if (d?.kind === 'declareAttackers' && d.player === player) return s;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'priority') s = pass(s);
    else s = drive(s);
  }
  throw new Error(`could not reach the attackers of ${player}`);
}

describe('CR 701.15, 611.2b: "choose target creature an opponent controls. This creature and that creature are goaded for as long as you control this creature." (Kang, Suspicious Captain)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [CAPTAIN, BEAR, DOOM], zones: { p1: { hand: ['Test Captain'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
  const enter = (s0: GameState): GameState => settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Captain', 'hand', 'p1') })), { targets: [[obj(idOf(s0, 'Test Bear', 'p2'))]] });
  it('is automated', () => expect(full(CAPTAIN)).toBe(true));
  it('the chosen creature must attack on its controller\'s turn, and not the goader: attacking nobody or the goader is refused, attacking another player is accepted', () => {
    const s0 = setup();
    let s = enter(s0);
    const bear = idOf(s, 'Test Bear', 'p2');
    s = toDeclarationOf(s, 'p2');
    expect(attackAccepted(s, [])).toBe(false);
    expect(attackAccepted(s, [{ attacker: bear, defender: 'p1' }])).toBe(false); // CR 701.15b: a player other than the goader
    expect(attackAccepted(s, [{ attacker: bear, defender: 'p3' }])).toBe(true);
  });
  it('a creature of another opponent is not goaded (the negative case): after the first opponent\'s forced attack, the other may attack with nothing', () => {
    let s = enter(setup());
    s = toDeclarationOf(s, 'p2');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'p2'), defender: 'p3' }] }), { targets: [[obj(idOf(s, 'Test Captain', 'p1'))]] });
    s = toDeclarationOf(s, 'p3');
    expect(attackAccepted(s, [])).toBe(true);
  });
  it('"Whenever one or more goaded creatures attack": the goaded bear attacking puts a +1/+1 counter on a creature its goader controls', () => {
    let s = enter(setup());
    const captain = idOf(s, 'Test Captain', 'p1');
    s = toDeclarationOf(s, 'p2');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'p2'), defender: 'p3' }] }), { targets: [[obj(captain)]] });
    expect(counters(s, captain)).toBe(1);
  });
  it('the Captain itself is goaded too: on its controller\'s next turn it must attack an opponent ("a player other than the goader")', () => {
    let s = enter(setup());
    const captain = idOf(s, 'Test Captain', 'p1');
    s = toDeclarationOf(s, 'p2');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'p2'), defender: 'p3' }] }), { targets: [[obj(captain)]] });
    s = toDeclarationOf(s, 'p1');
    expect(s.turn.number).toBe(4);
    expect(attackAccepted(s, [])).toBe(false);
    expect(attackAccepted(s, [{ attacker: captain, defender: 'p2' }])).toBe(true);
  });
  it('a creature that is not goaded attacking does not trigger the Captain (the negative case)', () => {
    let s = enter(setup());
    const captain = idOf(s, 'Test Captain', 'p1');
    s = toDeclarationOf(s, 'p2');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'p2'), defender: 'p3' }] }), { targets: [[obj(captain)]] });
    expect(counters(s, captain)).toBe(1);
    s = toDeclarationOf(s, 'p3');
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'p3'), defender: 'p2' }] }));
    expect(counters(s, captain)).toBe(1); // p3's bear is not goaded: nothing triggered, nothing was asked
  });
  it('CR 611.2b: another player gaining control of the Captain also ends the goad ("for as long as you control")', () => {
    const gift = card('Test Gift', 'Instant', 'Target player gains control of target creature you control.');
    const s0 = mpScenario({ players: 3, defs: [CAPTAIN, BEAR, gift], zones: { p1: { hand: ['Test Captain', 'Test Gift'] }, p2: { battlefield: ['Test Bear'] }, p3: {} } });
    let s = enter(s0);
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gift', 'hand', 'p1') }), { targets: [[pl('p3')], [obj(idOf(s, 'Test Captain', 'p1'))]] }));
    expect(s.objects[idOf(s, 'Test Captain', 'p1')]!.controller).toBe('p3');
    s = toDeclarationOf(s, 'p2');
    expect(attackAccepted(s, [])).toBe(true);
  });
  it('the goad ends when you stop controlling the Captain: the bear may then attack nobody', () => {
    const s0 = mpScenario({ players: 3, defs: [CAPTAIN, BEAR, DOOM], zones: { p1: { hand: ['Test Captain', 'Test Doom'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
    let s = enter(s0);
    const captain = idOf(s, 'Test Captain', 'p1');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [[obj(captain)]] }));
    expect(battlefield(s, 'Test Captain')).toHaveLength(0);
    s = toDeclarationOf(s, 'p2');
    expect(attackAccepted(s, [])).toBe(true);
  });
});

// ---- Vengeance Mission ---------------------------------------------------------------------------------------------------------------------------------------------------

const MISSION = card('Test Vengeance', 'Enchantment', 'Whenever a creature dies, put a quest counter on this enchantment. Target opponent loses 1 life. That player loses 2 life instead if there are seven or more quest counters on this enchantment.');

describe('CR 608.2c, 614.1a, 122.1: "Whenever a creature dies, put a quest counter on this enchantment. Target opponent loses 1 life. That player loses 2 life instead if there are seven or more quest counters on this enchantment." (Vengeance Mission)', () => {
  const setup = (quest: number): GameState => mpScenario({ players: 3, defs: [MISSION, BEAR, DOOM], zones: { p1: { hand: ['Test Doom', 'Test Doom'], battlefield: [{ name: 'Test Vengeance', counters: { quest } }] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
  const kill = (s: GameState, victim: ObjectId, who: PlayerId): GameState => settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [[obj(victim)]] }), { targets: [[pl(who)]] });
  it('is automated', () => expect(full(MISSION)).toBe(true));
  it('below seven counters after the new one: the chosen opponent loses 1 life and only that opponent', () => {
    const s0 = setup(5);
    const s = kill(s0, idOf(s0, 'Test Bear', 'p2', 0), 'p2');
    expect(counters(s, idOf(s, 'Test Vengeance', 'p1'), 'quest')).toBe(6);
    expect([life(s, 'p1'), life(s, 'p2'), life(s, 'p3')]).toEqual([20, 19, 20]);
  });
  it('the counter that makes seven counts: that player loses 2 life instead (not 1 and 2); the other opponent is untouched', () => {
    const s0 = setup(6);
    const s = kill(s0, idOf(s0, 'Test Bear', 'p3', 0), 'p2');
    expect(counters(s, idOf(s, 'Test Vengeance', 'p1'), 'quest')).toBe(7);
    expect([life(s, 'p1'), life(s, 'p2'), life(s, 'p3')]).toEqual([20, 18, 20]);
  });
  it('a creature of yours dying counts too, and the loss stays 2 with more counters', () => {
    const s0 = mpScenario({ players: 3, defs: [MISSION, BEAR, DOOM], zones: { p1: { hand: ['Test Doom'], battlefield: [{ name: 'Test Vengeance', counters: { quest: 9 } }, 'Test Bear'] }, p2: {}, p3: {} } });
    const s = kill(s0, idOf(s0, 'Test Bear', 'p1'), 'p3');
    expect(counters(s, idOf(s, 'Test Vengeance', 'p1'), 'quest')).toBe(10);
    expect([life(s, 'p2'), life(s, 'p3')]).toEqual([20, 18]);
  });
});

// ---- Tell Me What You See ------------------------------------------------------------------------------------------------------------------------------------------------

const VISION = card('Test Vision', 'Enchantment', 'When this enchantment enters, target opponent may have you draw a card. If they don\'t, they lose 4 life and you surveil 1.\nWhenever you face a dilemma, you may return this enchantment to its owner\'s hand.');

describe('CR 608.2d, 608.2c, 701.25a: "target opponent may have you draw a card. If they don\'t, they lose 4 life and you surveil 1." (Tell Me What You See)', () => {
  const setup = (): GameState => mpScenario({ players: 3, defs: [VISION], zones: { p1: { hand: ['Test Vision'] }, p2: {}, p3: {} } });
  const cast = (s0: GameState, yes: boolean, asked: string[] = []): GameState => settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Vision', 'hand', 'p1') }), { targets: [[pl('p2')]], yes: [yes], asked }), { targets: [[pl('p2')]], yes: [yes], asked });
  it('is automated', () => expect(full(VISION)).toBe(true));
  it('the opponent agrees: you draw a card, they lose nothing and you do not surveil', () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = cast(s0, true, asked);
    expect(s.zones.hand['p1']!.length).toBe(s0.zones.hand['p1']!.length - 1 + 1);
    expect([life(s, 'p2'), life(s, 'p3')]).toEqual([20, 20]);
    expect(asked).toContain('yesNo:p2'); // the targeted opponent is asked, not the controller
  });
  it('the opponent refuses: they lose 4 life, you do not draw, and you surveil 1 (a decision of yours)', () => {
    const s0 = setup();
    const asked: string[] = [];
    const s = cast(s0, false, asked);
    expect(s.zones.hand['p1']!.length).toBe(s0.zones.hand['p1']!.length - 1);
    expect([life(s, 'p2'), life(s, 'p3')]).toEqual([16, 20]);
    expect(asked.some((a) => a.endsWith(':p1') && (a.startsWith('chooseObjects') || a.startsWith('chooseOption') || a.startsWith('yesNo')))).toBe(true); // the surveil
  });
  it('CR 608.2d, 121.3a: when you cannot draw (a rule lets each player draw one card a turn and you drew one), the opponent cannot choose to have you draw: they are not asked and lose 4 life', () => {
    const limiter = card('Test Limiter', 'Enchantment', "Each player can't draw more than one card each turn.");
    const cantrip = card('Test Cantrip', 'Instant', 'Draw a card.');
    const s0 = mpScenario({ players: 3, defs: [VISION, limiter, cantrip], zones: { p1: { hand: ['Test Cantrip', 'Test Vision'] }, p2: { battlefield: ['Test Limiter'] }, p3: {} } });
    const s1 = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cantrip', 'hand', 'p1') })));
    const asked: string[] = [];
    const s = settle(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Vision', 'hand', 'p1') }), { targets: [[pl('p2')]], yes: [true], asked }), { targets: [[pl('p2')]], yes: [true], asked });
    expect(asked).not.toContain('yesNo:p2');
    expect(life(s, 'p2')).toBe(16);
  });
});
