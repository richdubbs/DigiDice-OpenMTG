/**
 * std-control-3 (lane std-control): controlling another player (CR 723, "Controlling Another Player"; earlier editions numbered it 722), played through the engine
 * with synthetic cards compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative
 * case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 723.1, 723.5     "You control target opponent during their next turn.": every decision of that player in their next turn (priority, attacks, the cleanup
 *                       discard) names the controller (`decidedBy`); the controller's seat may send that player's actions, the player's own seat may not; the
 *                       rest of the turn the effect was created in, and the turns after, are the player's own
 *   CR 723.1b           the next turn the player actually takes: an extra turn of the caster comes first and changes nothing; a skipped turn of theirs is
 *                       not taken, so the control waits for the next one
 *   CR 723.1a           of two effects for one player, the most recently created one works
 *   CR 723.4            the controller sees what the controlled player can see (their hand)
 *   CR 723.5b, 104.3a   the controller can't concede for them or change their stops
 *   CR 723.1, 506.1     "... during their next combat phase": from the beginning of combat step to the end of that combat phase, nothing before or after
 *   CR 601.2b, 608.2c   "If this spell's additional cost was paid, you control that player during their next turn instead."
 *   CR 122.1, 603.2     "When the seventh plan counter is put on this enchantment, sacrifice it. When you do, you control target opponent during their next turn."
 *   CR 602.2b, 118.7    a granted "{15}, Exile <Equipment>: ... This ability costs {X} less to activate, where X is this creature's power."
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction, controllerOfPlayer, legalActions, mayActAs, viewFor, type Action, type CardDef, type GameState, type ObjectId, type PlayerControlRec, type TargetChoice,
} from '../../../src/index';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const bob: TargetChoice = { kind: 'player', id: 'p2' };
const alice: TargetChoice = { kind: 'player', id: 'p1' };

const MIND = card('Test Mindwhip', 'Sorcery', 'You control target opponent during their next turn.');
const BRAWL = card('Test Brawl Puppet', 'Instant', 'You control target player during their next combat phase.');
const SECRET = card('Test Secret Strings', 'Sorcery',
  "As an additional cost to cast this spell, you may discard a card.\nYou control target opponent during their next combat phase. If this spell's additional cost was paid, you control that player during their next turn instead.\nExile Test Secret Strings.");
const CUBE = card('Test Scheme Engine', 'Enchantment',
  '{1}: Put a plan counter on this enchantment.\nWhen the seventh plan counter is put on this enchantment, sacrifice it. When you do, you control target opponent during their next turn.');
const BANGLE = card('Test Bangle', 'Artifact — Equipment',
  'Equipped creature gets +1/+1 and has "{15}, Exile Test Bangle: You control target opponent during their next turn. This ability costs {X} less to activate, where X is this creature\'s power. Activate only as a sorcery."\nEquip {1}', undefined, '{2}');
const GIANT = card('Test Giant', 'Creature — Giant', '', ['11', '11']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const TIME = card('Test Time Bend', 'Sorcery', 'Take an extra turn after this one.');
const DEFS: CardDef[] = [MIND, BRAWL, SECRET, CUBE, BANGLE, GIANT, BEAR, TIME];

/** Answer whatever is pending in the simplest legal way (priority passes, no attackers or blockers, the first choices). */
function step(s: GameState): GameState {
  const d = s.pending!;
  if (d.kind === 'priority') return act(s, { type: 'pass', player: d.player });
  if (d.kind === 'declareAttackers') return answer(s, { kind: 'declareAttackers', attacks: [] });
  if (d.kind === 'declareBlockers') return answer(s, { kind: 'declareBlockers', blocks: [] });
  const next = settle(s);
  if (next === s) throw new Error(`step: cannot answer ${d.kind}`);
  return next;
}

/** Run the game until `stop` holds, recording every decision on the way. */
function runUntil(s0: GameState, stop: (s: GameState) => boolean, seen: GameState[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !stop(s); i++) {
    seen.push(s);
    s = step(s);
  }
  if (!stop(s)) throw new Error('runUntil: the condition never held');
  return s;
}

const at = (turn: number, stepName: GameState['turn']['step']) => (s: GameState): boolean => s.turn.number === turn && s.turn.step === stepName && s.pending?.kind === 'priority';
const startOf = (turn: number) => (s: GameState): boolean => s.turn.number === turn;

function base(extra: { p1?: Record<string, unknown>; p2?: Record<string, unknown> } = {}): GameState {
  return scenario([], { p1: { hand: ['Test Mindwhip'], ...extra.p1 }, p2: { hand: ['Test Bear'], ...extra.p2 }, defs: DEFS });
}

/** Alice casts the turn-control spell in her first main phase, targeting Bob, and it resolves. */
function mindwhipped(s0 = base()): GameState {
  const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mindwhip', 'hand', 'p1') });
  return resolveAll(s, { targets: [bob] });
}

describe('the synthetic cards are automated (the experimental templates cap them at partial until promoted)', () => {
  it('every synthetic control card parses with no manual unit', () => {
    for (const d of [MIND, BRAWL, SECRET, CUBE, BANGLE]) {
      const manual = (d.automation.faces ?? []).flatMap((f) => f.abilities.flatMap((a) => a.manual));
      expect(manual, d.name).toEqual([]);
    }
    expect(full(TIME)).toBe(true);
  });
});

describe('CR 723.1, 723.5: "You control target opponent during their next turn."', () => {
  it('the spell creates a waiting effect; the rest of Alice\'s turn, Bob decides for himself', () => {
    const s = mindwhipped();
    expect(s.playerControl).toEqual([expect.objectContaining({ controller: 'p1', player: 'p2', during: 'turn' })]);
    expect(s.playerControl![0]!.active).toBeUndefined();
    // Alice passes in her main phase: Bob gets priority in Alice's turn, his own decision
    const t = act(s, { type: 'pass', player: 'p1' });
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(t.pending!.decidedBy).toBeUndefined();
  });

  it('in Bob\'s next turn every decision of Bob names Alice: priority, the declaration of attackers, the cleanup discard', () => {
    // Bob holds eight cards: he discards one in his cleanup step (CR 514.1), still in the controlled turn
    const s0 = base({ p2: { hand: Array(8).fill('Plains'), battlefield: ['Test Bear'] } });
    const seen: GameState[] = [];
    const end = runUntil(mindwhipped(s0), startOf(3), seen);
    const bobs = seen.filter((s) => s.turn.number === 2 && s.pending!.player === 'p2');
    const kinds = new Set(bobs.map((s) => s.pending!.kind));
    expect(kinds.has('priority')).toBe(true);
    expect(kinds.has('declareAttackers')).toBe(true);
    expect(kinds.has('chooseObjects')).toBe(true); // the cleanup discard
    for (const s of bobs) expect(s.pending!.decidedBy, `${s.turn.step} ${s.pending!.kind}`).toBe('p1');
    // Alice's own decisions in Bob's turn stay hers
    for (const s of seen.filter((x) => x.turn.number === 2 && x.pending!.player === 'p1')) expect(s.pending!.decidedBy).toBeUndefined();
    // turn 3 (Alice's) began: the effect is over
    expect(end.playerControl).toBeUndefined();
  });

  it('the effect ends as the next turn begins: in Bob\'s turn 4 his decisions are his own again', () => {
    const seen: GameState[] = [];
    runUntil(runUntil(mindwhipped(), startOf(3)), startOf(5), seen);
    const later = seen.filter((s) => s.pending!.player === 'p2');
    expect(later.length).toBeGreaterThan(0);
    for (const s of later) expect(s.pending!.decidedBy).toBeUndefined();
  });

  it('who may send Bob\'s actions: Alice\'s seat, not Bob\'s; Alice\'s seat gets Bob\'s legal actions', () => {
    const s = runUntil(mindwhipped(), at(2, 'main1'));
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2', decidedBy: 'p1' });
    const pass: Action = { type: 'pass', player: 'p2' };
    expect(mayActAs(s, 'p1', pass)).toBe(true);
    expect(mayActAs(s, 'p2', pass)).toBe(false);
    expect(legalActions(s, 'p2')).toEqual([]);
    const forBob = legalActions(s, 'p1');
    expect(forBob.length).toBeGreaterThan(0);
    for (const l of forBob) expect((l.action as { player: string }).player).toBe('p2');
    // Bob's land play, chosen by Alice, is Bob's: the engine applies it as his
    const land = forBob.find((l) => l.kind === 'playLand');
    expect(land).toBeDefined();
    const after = applyAction(s, land!.action);
    expect(after.error).toBeUndefined();
    expect(after.state.players.find((p) => p.id === 'p2')!.landsPlayedThisTurn).toBe(1);
  });

  it('CR 723.5b, 104.3a: Alice can\'t concede for Bob or change his stops; Bob may still concede', () => {
    const s = runUntil(mindwhipped(), at(2, 'main1'));
    expect(mayActAs(s, 'p1', { type: 'concede', player: 'p2' })).toBe(false);
    expect(mayActAs(s, 'p1', { type: 'setStops', player: 'p2', stops: s.players[1]!.stops })).toBe(false);
    expect(mayActAs(s, 'p2', { type: 'concede', player: 'p2' })).toBe(true);
  });

  it('CR 723.4: Alice\'s view shows Bob\'s hand while she controls him, and not before', () => {
    const before = mindwhipped();
    const bear = find(before, 'Test Bear', 'hand', 'p2');
    expect(viewFor(before, 'p1').objects[bear]).toBeUndefined(); // another player's hidden hand card: shown under an alias only
    const s = runUntil(before, at(2, 'main1'));
    const v = viewFor(s, 'p1');
    expect(v.objects[bear]?.defId).toBe('Test Bear');
    expect(v.pending).toMatchObject({ kind: 'priority', player: 'p2', decidedBy: 'p1' });
  });

  it('CR 723.1b: Alice\'s extra turn comes first and Bob is not controlled in it; his turn after it is the controlled one', () => {
    let s = mindwhipped(base({ p1: { hand: ['Test Mindwhip', 'Test Time Bend'] } }));
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Time Bend', 'hand', 'p1') }));
    const seen: GameState[] = [];
    runUntil(s, startOf(4), seen);
    expect(seen.some((x) => x.turn.number === 2 && x.turn.activePlayer === 'p1')).toBe(true);
    for (const x of seen.filter((y) => y.turn.number === 2 && y.pending!.player === 'p2')) expect(x.pending!.decidedBy).toBeUndefined();
    const t3 = seen.filter((y) => y.turn.number === 3 && y.pending!.player === 'p2');
    expect(t3.length).toBeGreaterThan(0);
    for (const x of t3) expect(x.pending!.decidedBy).toBe('p1');
  });

  it('CR 723.1b: a skipped turn of Bob\'s is not his next turn; the control waits for the one he takes', () => {
    let s = mindwhipped();
    // "Bob skips his next turn": the replacement effect "you skip your next turn" builds (parser/templates/zz-cloud/std-ry5.json), created for Bob
    s = structuredClone(s);
    s.continuousEffects.push({
      id: 'e-skip', sourceId: 'none', controller: 'p2', timestamp: s.counters.timestamp++, duration: { d: 'permanent' },
      effect: { s: 'replace', replaces: { ev: 'beginTurn', whose: { ref: 'you' } }, body: { b: 'skip' }, shield: { uses: 1 } },
    } as unknown as GameState['continuousEffects'][number]);
    const seen: GameState[] = [];
    const end = runUntil(s, (x) => x.turn.number === 3 && x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', seen);
    expect(seen.some((x) => x.turn.number === 2 && x.turn.activePlayer === 'p1')).toBe(true); // Bob's turn was skipped: Alice again
    expect(end.pending).toMatchObject({ player: 'p2', decidedBy: 'p1' });
  });

  it('a player can\'t be made to control themselves: Alice targeting herself creates nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Brawl Puppet'] }, defs: DEFS });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Brawl Puppet', 'hand', 'p1') }), { targets: [alice] });
    expect(s.playerControl).toBeUndefined();
  });
});

describe('CR 723.1a: two effects for one player, the most recently created one works', () => {
  it('Carol\'s later effect wins over Alice\'s; with Carol out of the game, Alice\'s works', () => {
    const recs: PlayerControlRec[] = [
      { id: 'pc1', controller: 'p1', player: 'p2', during: 'turn', timestamp: 5, active: true, sourceName: 'A' },
      { id: 'pc2', controller: 'p3', player: 'p2', during: 'turn', timestamp: 9, active: true, sourceName: 'B' },
    ];
    const players = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as GameState['players'];
    expect(controllerOfPlayer({ players, playerControl: recs }, 'p2')).toBe('p3');
    const gone = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', hasLost: true }] as GameState['players'];
    expect(controllerOfPlayer({ players: gone, playerControl: recs }, 'p2')).toBe('p1');
    // a waiting effect controls nobody yet
    expect(controllerOfPlayer({ players, playerControl: [{ ...recs[0]!, active: undefined }] }, 'p2')).toBe('p2');
  });
});

describe('CR 723.1, 506.1: "You control target player during their next combat phase."', () => {
  function puppeted(): GameState {
    const s = scenario([], { p1: { hand: ['Test Brawl Puppet'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    return resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Brawl Puppet', 'hand', 'p1') }), { targets: [bob] });
  }
  it('Bob\'s combat phase in his next turn is Alice\'s to decide, from the beginning of combat to its end, nothing before or after', () => {
    const seen: GameState[] = [];
    const end = runUntil(puppeted(), startOf(3), seen);
    const COMBAT = new Set(['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat']);
    const bobs = seen.filter((s) => s.turn.number === 2 && s.pending!.player === 'p2');
    expect(bobs.some((s) => s.pending!.kind === 'declareAttackers' && s.pending!.decidedBy === 'p1')).toBe(true);
    for (const s of bobs) expect(s.pending!.decidedBy, `${s.turn.step} ${s.pending!.kind}`).toBe(COMBAT.has(s.turn.step) ? 'p1' : undefined);
    expect(bobs.some((s) => s.turn.step === 'main2')).toBe(true);
    expect(end.playerControl).toBeUndefined();
  });
  it('Alice\'s own combat phase in turn 1 is not Bob\'s: the effect waits (cast before Alice\'s combat)', () => {
    const seen: GameState[] = [];
    runUntil(puppeted(), startOf(2), seen);
    for (const s of seen.filter((x) => x.pending!.player === 'p2')) expect(s.pending!.decidedBy).toBeUndefined();
  });
  it('Alice controls Bob\'s attack: she declares his Bear as an attacker against herself', () => {
    const s = runUntil(puppeted(), (x) => x.turn.number === 2 && x.pending?.kind === 'declareAttackers');
    expect(s.pending).toMatchObject({ player: 'p2', decidedBy: 'p1' });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const t = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] });
    expect(t.combat?.attackers.some((a) => a.id === bear)).toBe(true);
  });
});

describe('CR 601.2b, 608.2c: "If this spell\'s additional cost was paid, you control that player during their next turn instead."', () => {
  function secret(pay: boolean): GameState {
    const s = scenario([], { p1: { hand: ['Test Secret Strings', 'Plains'] }, defs: DEFS });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Secret Strings', 'hand', 'p1') });
    t = settle(t, { yes: pay, targets: [bob] });
    return resolveAll(t, { yes: pay, targets: [bob] });
  }
  it('paid: Bob\'s next turn; the spell is exiled', () => {
    const s = secret(true);
    expect(s.playerControl).toEqual([expect.objectContaining({ controller: 'p1', player: 'p2', during: 'turn' })]);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Secret Strings')).toBe(true);
  });
  it('not paid: only Bob\'s next combat phase', () => {
    const s = secret(false);
    expect(s.playerControl).toEqual([expect.objectContaining({ controller: 'p1', player: 'p2', during: 'combat' })]);
  });
});

describe('CR 122.1, 603.2: "When the seventh plan counter is put on this enchantment, sacrifice it. When you do, ..."', () => {
  function engineWith(n: number): { s: GameState; id: ObjectId } {
    const s = structuredClone(scenario([], { p1: { battlefield: ['Plains', 'Plains'] }, defs: DEFS }));
    const id = put(s, 'p1', 'battlefield', { name: 'Test Scheme Engine', counters: { plan: n } });
    return { s, id };
  }
  const addOne = (s: GameState, id: ObjectId): GameState => {
    const l = legalActions(s, 'p1').find((x) => x.kind === 'activate' && (x.action as { source?: string }).source === id)!;
    return resolveAll(settle(act(s, l.action)), { targets: [bob] });
  };
  it('the seventh counter: the enchantment is sacrificed and Alice will control Bob during his next turn', () => {
    const { s, id } = engineWith(6);
    const t = addOne(s, id);
    expect(t.objects[id]?.zone ?? 'gone').not.toBe('battlefield');
    expect(t.playerControl).toEqual([expect.objectContaining({ controller: 'p1', player: 'p2', during: 'turn' })]);
  });
  it('the sixth counter does nothing', () => {
    const { s, id } = engineWith(5);
    const t = addOne(s, id);
    expect(t.objects[id]!.zone).toBe('battlefield');
    expect(t.objects[id]!.counters.plan).toBe(6);
    expect(t.playerControl).toBeUndefined();
  });
});

describe('CR 602.2b, 118.7: a granted "{15}, Exile <Equipment>: ... This ability costs {X} less to activate, where X is this creature\'s power."', () => {
  function equipped(creature: string, lands: number): { s: GameState; holder: ObjectId; bangle: ObjectId } {
    const s = structuredClone(scenario([], { p1: { battlefield: Array(lands).fill('Plains') }, defs: DEFS }));
    const holder = put(s, 'p1', 'battlefield', creature);
    const bangle = put(s, 'p1', 'battlefield', 'Test Bangle');
    s.objects[bangle]!.attachedTo = holder;
    return { s, holder, bangle };
  }
  const grantedOn = (s: GameState, holder: ObjectId) => legalActions(s, 'p1').filter((l) => l.kind === 'activate' && (l.action as { source?: string }).source === holder);
  it('a 12-power creature (11 and the +1/+1) pays {3}: the Equipment is exiled and Alice will control Bob', () => {
    const { s, holder, bangle } = equipped('Test Giant', 3);
    const acts = grantedOn(s, holder);
    expect(acts.length).toBe(1);
    const t = resolveAll(settle(act(s, acts[0]!.action), { targets: [bob] }), { targets: [bob] });
    expect(t.objects[bangle]?.zone ?? 'exile').toBe('exile');
    expect(t.playerControl).toEqual([expect.objectContaining({ controller: 'p1', player: 'p2', during: 'turn' })]);
  });
  it('a 3-power creature can\'t pay {12} with three lands', () => {
    const { s, holder } = equipped('Test Bear', 3);
    const acts = grantedOn(s, holder);
    expect(acts).toEqual([]);
  });
});
