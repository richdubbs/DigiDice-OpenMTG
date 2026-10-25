/**
 * AP1: smart auto-pass and the temporary hold-priority toggle. It replaces FAST1 FXH's M2 rule (a player holding cards was always
 * asked, to hide whether they could respond; OpenMTG accepts that the other player may infer "no response").
 *
 * - CR 117.3d: a player who would receive priority with an object on the stack and nothing to do but pass and mana abilities (CR 605.3a) passes
 *   automatically; one who could cast a spell or activate a non-mana ability (by the engine's real legal actions, costs included) decides themselves.
 * - CR 117.4: when every player passes in succession the top of the stack resolves, automatic passes included.
 * - CR 117.3c: with hold priority on, a player receives priority again after their own spell; the toggle clears when the turn ends.
 * - The automatic pass is logged like a manual one.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type GameState, type OracleCard } from '../../src/index';
import { act, answer, castAuto, find, pass, scenario, type Zones } from '../m3/scenario';

const AUTO = { fullControl: false };
const CARDS = ['Llanowar Elves', 'Forest', 'Shock', 'Mountain', 'Grizzly Bears', 'Prodigal Pyromancer', 'Think Twice', 'Island'];

/** p1 (Alice) casts Llanowar Elves in their first main phase; p2 (Bob) has `p2`. Returns the state right after the cast is paid for. */
function afterElves(p2: Zones, p1Stops: Partial<GameState['players'][number]['stops']> = {}): GameState {
  let s = scenario(CARDS, { p1: { hand: ['Llanowar Elves'], battlefield: ['Forest'] }, p2, stops: AUTO });
  if (Object.keys(p1Stops).length > 0) s = act(s, { type: 'setStops', player: 'p1', stops: { ...s.players[0]!.stops, ...p1Stops } });
  return castAuto(s, 'Llanowar Elves');
}

const elvesResolved = (s: GameState): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Llanowar Elves');
const logText = (s: GameState): string[] => s.log.map((l) => l.text);

describe('AP1 smart auto-pass: responding to another player\'s spell (CR 117.3d)', () => {
  it('Shock in hand with an untapped Mountain: Bob can respond, so the game stops for him', () => {
    const s = afterElves({ hand: ['Shock'], battlefield: ['Mountain'] });
    expect(s.zones.stack).toHaveLength(1);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(applyAction(s, { type: 'pass', player: 'p2' }).error).toBeUndefined(); // he passes by hand
  });

  it('only untapped lands and no instant (a creature card, two Mountains): Bob passes automatically and the Elves resolve', () => {
    const s = afterElves({ hand: ['Grizzly Bears'], battlefield: ['Mountain', 'Mountain'] });
    expect(s.zones.stack).toEqual([]);
    expect(elvesResolved(s)).toBe(true);
  });

  it('a Shock but no land to pay for it: no castable spell, so Bob passes automatically', () => {
    const s = afterElves({ hand: ['Shock'] });
    expect(s.zones.stack).toEqual([]);
    expect(elvesResolved(s)).toBe(true);
  });

  it('mana abilities alone never stop a player (CR 605.3a): lands of every color and an empty hand', () => {
    const s = afterElves({ battlefield: ['Mountain', 'Forest', 'Island'] });
    expect(s.zones.stack).toEqual([]);
    expect(elvesResolved(s)).toBe(true);
  });

  it('an activatable non-mana ability stops the player (CR 602.2): an untapped Prodigal Pyromancer, but not a tapped or summoning-sick one (CR 302.6)', () => {
    // Bob (full control, to get priority in Alice's main phase) Shocks Alice; Alice controls a Prodigal Pyromancer.
    const shockAlice = (pyromancer: { tapped?: boolean; since?: number }): GameState => {
      let s = scenario(CARDS, { p1: { battlefield: [{ name: 'Prodigal Pyromancer', ...pyromancer }] }, p2: { hand: ['Shock'], battlefield: ['Mountain'] }, stops: AUTO });
      s = act(s, { type: 'setStops', player: 'p2', stops: { ...s.players[1]!.stops, fullControl: true } });
      if (s.pending!.player === 'p1') s = pass(s);
      expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
      s = castAuto(s, 'Shock', { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }] });
      expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' }); // full control: Bob keeps priority after his own spell (CR 117.3c)
      return pass(s);
    };
    const ready = shockAlice({});
    expect(ready.zones.stack).toHaveLength(1);
    expect(ready.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    for (const s of [shockAlice({ tapped: true }), shockAlice({ since: 1 })]) {
      expect(s.zones.stack).toEqual([]); // Alice could not respond: she passed automatically and the Shock resolved
      expect(s.players[0]!.life).toBe(18);
    }
  });

  it('a flashback card he can pay for in his graveyard stops him too (CR 702.34a)', () => {
    const s = afterElves({ graveyard: ['Think Twice'], battlefield: ['Island', 'Island', 'Island'] });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
  });

  it('both players passing automatically: the Elves resolve (CR 117.4) and the game advances to the next player who can act', () => {
    // Alice is passed for right after her own spell (Arena), Bob has nothing to do; once the Elves resolve Alice has nothing left either (the Forest is
    // tapped, the Elves are summoning sick), so the turn runs on to Bob's first main phase, where his drawn Plains can be played.
    const s = afterElves({});
    expect(s.zones.stack).toEqual([]);
    expect(elvesResolved(s)).toBe(true);
    expect(s.turn.number).toBe(2);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(s.turn.step).toBe('main1');
  });

  it('the automatic pass is logged as a normal pass: the same line as a pass by hand', () => {
    const auto = logText(afterElves({ hand: ['Grizzly Bears'], battlefield: ['Mountain', 'Mountain'] }));
    const cast = auto.findIndex((t) => t.includes('casts Llanowar Elves'));
    expect(cast).toBeGreaterThanOrEqual(0);
    const after = auto.slice(cast);
    expect(after).toContain('Alice passes.');
    expect(after).toContain('Bob passes.');
    expect(after.indexOf('Bob passes.')).toBeLessThan(after.findIndex((t) => t.includes('Llanowar Elves') && t.includes('resolves')));
    // By hand: Bob holds a Shock he could cast and passes himself; the lines are the same.
    let s = afterElves({ hand: ['Shock'], battlefield: ['Mountain'] });
    s = pass(s);
    const manual = logText(s).slice(logText(s).findIndex((t) => t.includes('casts Llanowar Elves')));
    expect(manual.filter((t) => t.endsWith('passes.'))).toEqual(after.filter((t) => t.endsWith('passes.')).slice(0, 2));
  });

  it('full control keeps every stop: Bob with full control and nothing to do is still asked', () => {
    let s = scenario(CARDS, { p1: { hand: ['Llanowar Elves'], battlefield: ['Forest'] }, stops: AUTO });
    s = act(s, { type: 'setStops', player: 'p2', stops: { ...s.players[1]!.stops, fullControl: true } });
    s = castAuto(s, 'Llanowar Elves');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
  });
});

describe('AP1 review: mana the engine can\'t count (a mana ability activated by hand, CR 605.3b) never makes the game pass for a player', () => {
  // Karplusan Forest's "{T}: Add {R} or {G}. This land deals 1 damage to you." is a mana ability the recognizer leaves to the player (by hand), so the payment
  // check does not see its {R}: Shock is not listed as castable, although the player can tap the painland for {R} by hand and cast it (CR 601.2g).
  const PAIN = [...CARDS, 'Karplusan Forest'];

  it('responding: Shock in hand and an untapped Karplusan Forest stops Bob for Alice\'s Llanowar Elves', () => {
    let s = scenario(PAIN, { p1: { hand: ['Llanowar Elves'], battlefield: ['Forest'] }, p2: { hand: ['Shock'], battlefield: ['Karplusan Forest'] }, stops: AUTO });
    s = castAuto(s, 'Llanowar Elves');
    expect(s.zones.stack).toHaveLength(1);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
  });

  it('a spell that is not legal to cast now still passes automatically: a creature card (no flash, CR 307.1) with the painland', () => {
    let s = scenario(PAIN, { p1: { hand: ['Llanowar Elves'], battlefield: ['Forest'] }, p2: { hand: ['Grizzly Bears'], battlefield: ['Karplusan Forest'] }, stops: AUTO });
    s = castAuto(s, 'Llanowar Elves');
    expect(s.zones.stack).toEqual([]);
    expect(elvesResolved(s)).toBe(true);
  });

  it('her own main-phase stop: Alice with Shock in hand and only a Karplusan Forest is asked in her postcombat main phase (an empty-stack stop)', () => {
    // She passes her first main phase by hand; the steps that are not her stops go by, and main2 (a stop of hers) asks her again.
    const s = pass(scenario(PAIN, { p1: { hand: ['Shock'], battlefield: ['Karplusan Forest'] }, stops: AUTO }));
    expect(`${s.turn.number}:${s.turn.step}`).toBe('1:main2');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });

  it('a tapped painland is no mana at all: Bob with Shock and a tapped Karplusan Forest passes automatically', () => {
    let s = scenario(PAIN, { p1: { hand: ['Llanowar Elves'], battlefield: ['Forest'] }, p2: { hand: ['Shock'], battlefield: [{ name: 'Karplusan Forest', tapped: true }] }, stops: AUTO });
    s = castAuto(s, 'Llanowar Elves');
    expect(s.zones.stack).toEqual([]);
    expect(elvesResolved(s)).toBe(true);
  });
});

describe('AP1 hold priority (a temporary stop at every priority, CR 117.3c)', () => {
  it('Alice holding priority receives priority again right after her own spell, so she can respond to it', () => {
    const s = afterElves({}, { holdPriority: true });
    expect(s.zones.stack).toHaveLength(1);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    // She passes; Bob has nothing to do, so the Elves resolve, and Alice (still holding) gets priority again in her main phase (CR 117.3b).
    const t = pass(s);
    expect(elvesResolved(t)).toBe(true);
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(t.turn.step).toBe('main1');
  });

  it('a player holding priority stops at every priority with nothing to do, also in steps that are not their stops', () => {
    let s = scenario(CARDS, { p1: { battlefield: ['Forest'] }, stops: AUTO });
    s = act(s, { type: 'setStops', player: 'p1', stops: { ...s.players[0]!.stops, holdPriority: true } });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(`${s.turn.step}:${s.pending!.player}`);
      s = pass(s);
    }
    // main1, then beginning of combat (not a stop of hers), ... every step of her turn where she gets priority.
    expect(seen.slice(0, 2)).toEqual(['main1:p1', 'beginCombat:p1']);
  });

  it('the toggle clears when the turn ends: the next turn begins with it off for every player', () => {
    let s = scenario(CARDS, { p1: { battlefield: ['Forest'] }, stops: AUTO });
    s = act(s, { type: 'setStops', player: 'p1', stops: { ...s.players[0]!.stops, holdPriority: true } });
    s = act(s, { type: 'setStops', player: 'p2', stops: { ...s.players[1]!.stops, holdPriority: true } });
    expect(s.players.map((p) => p.stops.holdPriority)).toEqual([true, true]);
    // Pass through the rest of turn 1 (both stop at every priority while holding); the first priority of turn 2 has it off for both.
    while (s.turn.number === 1) s = pass(s);
    expect(s.players.map((p) => p.stops.holdPriority)).toEqual([undefined, undefined]);
    expect(s.turn.step).toBe('main1'); // Bob no longer stops in his upkeep or draw step (not his stops)
    // Turned off by hand before that: off at once, and Alice passes through the steps that are not her stops again.
    let t = scenario(CARDS, { p1: { battlefield: ['Forest'] }, stops: AUTO });
    t = act(t, { type: 'setStops', player: 'p1', stops: { ...t.players[0]!.stops, holdPriority: true } });
    t = act(t, { type: 'setStops', player: 'p1', stops: { ...t.players[0]!.stops, holdPriority: false } });
    t = pass(t);
    expect(`${t.turn.number}:${t.turn.step}`).not.toBe('1:beginCombat');
  });

  it('a player holding priority is asked to respond to the other player\'s spell even with nothing to do', () => {
    let s = scenario(CARDS, { p1: { hand: ['Llanowar Elves'], battlefield: ['Forest'] }, stops: AUTO });
    s = act(s, { type: 'setStops', player: 'p2', stops: { ...s.players[1]!.stops, holdPriority: true } });
    s = castAuto(s, 'Llanowar Elves');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(s.zones.stack).toHaveLength(1);
    expect(find(s, 'Llanowar Elves', 'stack')).toBeDefined();
  });
});

describe('TRG-STOP: after a triggered ability of hers resolves and empties the stack, the step counts as a stop for her (CR 117.3b, 507.2)', () => {
  // Owner, 2026-10-25 (Irma, Part-Time Mutant): the game passed for her while her beginning-of-combat trigger was on the stack (her own object), then again
  // after it resolved (beginning of combat is not one of her stops), so attackers came before she could cast an instant.
  const BUGLE = compileCard({
    name: 'Test Battle Bugle', layout: 'normal', mana_cost: '{0}', type_line: 'Enchantment', oracle_text: 'At the beginning of combat on your turn, you gain 1 life.',
    colors: [], keywords: [],
  } as OracleCard);
  const withBugle = (p1: { hand: string[]; battlefield: string[] }): GameState =>
    pass(scenario(CARDS, { defs: [BUGLE], p1: { hand: p1.hand, battlefield: ['Test Battle Bugle', ...p1.battlefield] }, stops: AUTO }));

  it('Shock and an untapped Mountain: she is asked with her trigger on the stack (TRG-STOP2), then in beginning of combat once it resolved, before attackers', () => {
    let s = withBugle({ hand: ['Shock'], battlefield: ['Mountain'] });
    expect(`${s.turn.number}:${s.turn.step}`).toBe('1:beginCombat');
    expect(s.zones.stack).toHaveLength(1);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    s = pass(s);
    expect(`${s.turn.number}:${s.turn.step}`).toBe('1:beginCombat');
    expect(s.zones.stack).toEqual([]);
    expect(s.players[0]!.life).toBe(21); // the trigger resolved first
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
  });

  it('nothing she can cast: the trigger resolves and the game passes for her as before', () => {
    const s = withBugle({ hand: ['Shock'], battlefield: [] });
    expect(s.players[0]!.life).toBe(21);
    expect(`${s.turn.number}:${s.turn.step}`).not.toBe('1:beginCombat');
  });

  it('the stop lasts only for that step: when she passes, the turn goes on to her next stop', () => {
    const s = pass(pass(withBugle({ hand: ['Shock'], battlefield: ['Mountain'] })));
    expect(`${s.turn.number}:${s.turn.step}`).toBe('1:main2');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.priority.afterTrigger).toBeUndefined();
  });
});

describe('TRG-STOP2 and RES-ALL: a chance before every trigger resolves, and Resolve all (owner, 2026-10-25)', () => {
  // "You should be able to cast an instant spell in between every single trigger. There should also be an option to 'resolve all'."
  const trigger = (name: string, life: number) =>
    compileCard({
      name, layout: 'normal', mana_cost: '{0}', type_line: 'Enchantment', oracle_text: `At the beginning of combat on your turn, you gain ${life} life.`,
      colors: [], keywords: [],
    } as OracleCard);
  const DEFS = [trigger('Test Battle Bugle', 1), trigger('Test War Drum', 2)];
  const ordered = (s: GameState): GameState => {
    while (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    return s;
  };
  /** Alice passes her first main phase; both her beginning-of-combat triggers go on the stack (CR 603.3b). */
  const atCombat = (p1Hand: string[], p1Lands: string[], p2: Zones = {}): GameState =>
    ordered(pass(scenario(CARDS, { defs: DEFS, p1: { hand: p1Hand, battlefield: ['Test Battle Bugle', 'Test War Drum', ...p1Lands] }, p2, stops: AUTO })));

  it('Shock and a Mountain: she is asked with each of her triggers on top, and once more after the last one resolved', () => {
    let s = atCombat(['Shock'], ['Mountain']);
    const seen: string[] = [];
    while (s.turn.step === 'beginCombat' && s.pending?.kind === 'priority') {
      seen.push(`${s.pending.player}:${s.zones.stack.length}`);
      s = pass(s);
    }
    expect(seen).toEqual(['p1:2', 'p1:1', 'p1:0']);
    expect(s.players[0]!.life).toBe(23);
  });

  it('nothing she can cast: the triggers resolve without asking her, as before', () => {
    const s = atCombat(['Shock'], []);
    expect(s.players[0]!.life).toBe(23);
    expect(`${s.turn.number}:${s.turn.step}`).not.toBe('1:beginCombat');
  });

  it('Resolve all: both triggers resolve without asking her; with the stack empty she is asked in beginning of combat (the stop after a trigger)', () => {
    let s = atCombat(['Shock'], ['Mountain']);
    expect(s.zones.stack).toHaveLength(2);
    s = act(s, { type: 'pass', player: 'p1', resolveAll: true });
    expect(s.zones.stack).toEqual([]);
    expect(s.players[0]!.life).toBe(23);
    expect(`${s.turn.step}:${s.pending?.player}`).toBe('beginCombat:p1');
    expect(s.priority.resolveAll).toBeUndefined();
  });

  it('Resolve all stops when the other player casts something: Bob Shocks her in response and she is asked to answer it', () => {
    let s = atCombat(['Shock'], ['Mountain'], { hand: ['Shock'], battlefield: ['Mountain'] });
    s = act(s, { type: 'pass', player: 'p1', resolveAll: true });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' }); // Bob can answer her trigger
    s = castAuto(s, 'Shock', { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }] });
    expect(s.priority.resolveAll).toBeUndefined();
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.zones.stack).toHaveLength(3);
  });

  it('her own spell again once the answer above it resolved: right after casting she is passed for, after Bob\'s Shock resolves she is asked', () => {
    let s = scenario(CARDS, { p1: { hand: ['Shock', 'Shock'], battlefield: ['Mountain', 'Mountain'] }, p2: { hand: ['Shock'], battlefield: ['Mountain'] }, stops: AUTO });
    s = castAuto(s, 'Shock', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }] });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p2' }); // Arena: passed for right after her own spell (CR 117.3c)
    s = castAuto(s, 'Shock', { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }] });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    s = pass(s); // Bob's Shock resolves (CR 117.4)
    expect(s.zones.stack).toHaveLength(1);
    expect(s.players[0]!.life).toBe(18);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // her own Shock on top, but something resolved since she cast it (CR 117.3b)
  });
});
