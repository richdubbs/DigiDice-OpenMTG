/**
 * trek-20 (lane trek, Star Trek reprints): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 508.1b, 611.2a  "Until your next turn, creatures can't attack you." (Chronomantic Escape): the creatures of every player, you, not your planeswalkers; over when your next turn begins
 *   CR 500.8, 505.1    "After the second main phase this turn, there's an additional combat phase followed by an additional main phase. At the beginning of that combat, untap all creatures
 *                      that attacked this turn." (World at War): after the postcombat main phase, never after the first main phase of the turn it is cast in
 *   CR 101.4, 122.1,   "Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those creatures can't attack you or planeswalkers you control for
 *   611.2b, 701.21a    as long as it has a vow counter on it." (Promise of Loyalty): one creature kept per player, in turn order; the restriction is the caster's and ends creature by creature
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { answer, find } from '../../m5/helpers';
import { castWith, synthetic } from '../../m6/costs/support';
import { mpScenario, passUntil, resolveStack, drive as mpDrive } from '../../m12/rules/helpers';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const toAttackersOf = (s: GameState, p: PlayerId): GameState => passUntil(s, (t) => t.pending?.kind === 'declareAttackers' && t.pending.player === p, `the attack of ${p}`);
const defendersOf = (s: GameState, id: ObjectId): (string)[] => (s.pending?.kind === 'declareAttackers' ? s.pending.candidates.find((c) => c.id === id)?.defenders ?? [] : []);

describe('CR 508.1b, 611.2a: "Until your next turn, creatures can\'t attack you." (Chronomantic Escape)', () => {
  const VEIL = synthetic('Test Time Veil', 'Sorcery', '{0}', 'Until your next turn, creatures can\'t attack you. Exile this spell with three time counters on it.\nSuspend 3--{2}{W}');
  const BEAR = synthetic('Test Bear', 'Creature — Bear', '{0}', '', { power: '2', toughness: '2' });
  const DEFS = [VEIL, BEAR];

  it('the card is automated', () => expect(full(VEIL), JSON.stringify(VEIL.automation)).toBe(true));
  it('nobody can attack its caster until the caster\'s next turn; the other players stay attackable; the spell is exiled with three time counters', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Time Veil'] }, p2: { battlefield: ['Test Bear'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveStack(castWith(s, 'Test Time Veil'));
    const veil = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Time Veil')!;
    expect(veil.zone).toBe('exile');
    expect(veil.counters['time']).toBe(3);
    s = toAttackersOf(s, 'p2');
    expect(defendersOf(s, bear)).not.toContain('p1');
    expect(defendersOf(s, bear)).toEqual(expect.arrayContaining(['p3', 'p4']));
  });
  it('negative: it ends as the caster\'s next turn begins (their creatures\' attackers are free to attack them again two turns later)', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Time Veil'] }, p2: { battlefield: ['Test Bear'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveStack(castWith(s, 'Test Time Veil'));
    s = passUntil(s, (t) => t.turn.number === 6 && t.pending?.kind === 'declareAttackers' && t.pending.player === 'p2', 'the attack of p2 on turn 6');
    expect(defendersOf(s, bear)).toContain('p1');
  });
});

describe('CR 500.8, 505.1: "After the second main phase this turn, there\'s an additional combat phase followed by an additional main phase. At the beginning of that combat, untap all creatures that attacked this turn." (World at War)', () => {
  const WAR = synthetic('Test Second Wind', 'Sorcery', '{0}', 'After the second main phase this turn, there\'s an additional combat phase followed by an additional main phase. At the beginning of that combat, untap all creatures that attacked this turn.');
  const BEAR = synthetic('Test Bear', 'Creature — Bear', '{0}', '', { power: '2', toughness: '2' });
  const DEFS = [WAR, BEAR];
  it('the card is automated', () => expect(full(WAR), JSON.stringify(WAR.automation)).toBe(true));
  it('cast in the first main phase: the extra combat and main phase come after the SECOND main phase, and the attackers untap as that combat begins', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Second Wind'], battlefield: ['Test Bear'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveStack(castWith(s, 'Test Second Wind'));
    // combat 1: the bear attacks and stays tapped
    s = toAttackersOf(s, 'p1');
    s = resolveStack(mpDrive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] })));
    s = passUntil(s, (t) => t.turn.step === 'main2' && t.turn.number === 1 && t.pending?.kind === 'priority' && t.pending.player === 'p1', 'the second main phase');
    expect(s.objects[bear]!.tapped).toBe(true);
    // the second main phase ends: the added combat phase begins, and its beginning untaps the bear
    s = passUntil(s, (t) => t.turn.step === 'beginCombat' && t.turn.number === 1 && t.turn.phaseResume !== undefined, 'the added combat phase');
    s = resolveStack(s);
    expect(s.objects[bear]!.tapped).toBe(false);
  });
  it('negative: nothing begins after the FIRST main phase: the turn goes to its combat phase and the added phase waits for the second main phase', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Second Wind'], battlefield: ['Test Bear'] } } });
    s = resolveStack(castWith(s, 'Test Second Wind'));
    expect(s.turn.extraPhases).toHaveLength(2); // the combat phase and the main phase that follows it
    expect(s.turn.extraPhases!.filter((x) => x.secondMain === true).map((x) => x.phase)).toEqual(['combat']);
    s = passUntil(s, (t) => t.turn.step === 'beginCombat' && t.turn.number === 1, 'the combat phase');
    expect(s.turn.phaseResume).toBeUndefined(); // the ordinary combat phase, not an added one
    expect(s.turn.extraPhases).toHaveLength(2);
    s = passUntil(s, (t) => t.turn.step === 'main2' && t.turn.number === 1 && t.pending?.kind === 'priority', 'the second main phase');
    expect(s.turn.extraPhases).toHaveLength(2); // still waiting for the end of this main phase
  });
  it('the phases of the turn: combat, the second main phase, then the added combat and main phases, then the end step (no main phase between the ordinary combat and the second main phase)', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Second Wind'] } } });
    s = resolveStack(castWith(s, 'Test Second Wind'));
    const seen: string[] = [];
    for (let guard = 0; guard < 60 && s.turn.step !== 'end'; guard++) {
      const here = s.turn.step;
      if (seen[seen.length - 1] !== here) seen.push(here);
      s = passUntil(s, (t) => t.turn.step !== here || t.turn.number !== 1, 'the next step');
    }
    expect(seen).toEqual(['main1', 'beginCombat', 'declareAttackers', 'endCombat', 'main2', 'beginCombat', 'declareAttackers', 'endCombat', 'main2']);
  });
  it('two copies are cumulative (Scryfall ruling 2010-06-15): two added combat phases, each followed by its main phase; a copy cast in an ADDED main phase adds nothing', () => {
    const seq = (s0: GameState): string[] => {
      let s = s0;
      const seen: string[] = [];
      for (let guard = 0; guard < 80 && s.turn.step !== 'end'; guard++) {
        const here = s.turn.step;
        if (seen[seen.length - 1] !== here) seen.push(here);
        s = passUntil(s, (t) => t.turn.step !== here || t.turn.number !== 1, 'the next step');
      }
      return seen;
    };
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Second Wind', 'Test Second Wind'] } } });
    s = resolveStack(castWith(s, 'Test Second Wind'));
    s = resolveStack(castWith(s, 'Test Second Wind'));
    const three = ['beginCombat', 'declareAttackers', 'endCombat', 'main2'];
    expect(seq(s)).toEqual(['main1', ...three, ...three, ...three]);
    // the second copy is cast in the first added main phase, the turn's THIRD main phase (original main1, original main2, the added one): no more phases are created
    let t = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Second Wind', 'Test Second Wind'] } } });
    t = resolveStack(castWith(t, 'Test Second Wind'));
    t = passUntil(t, (x) => x.turn.step === 'main2' && x.turn.number === 1 && x.pending?.kind === 'priority' && x.pending.player === 'p1', 'the second main phase');
    t = passUntil(t, (x) => x.turn.step === 'beginCombat' && x.turn.phaseResume !== undefined, 'the added combat');
    t = passUntil(t, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.pending.player === 'p1' && x.turn.phaseResume !== undefined, 'the added main phase');
    t = resolveStack(castWith(t, 'Test Second Wind'));
    expect(t.turn.extraPhases?.filter((e) => e.secondMain === true)).toBeUndefined(); // a third main phase: the second one is over, nothing is added (ruling 2010-06-15)
    t = passUntil(t, (x) => x.turn.step === 'end' || x.turn.number !== 1, 'the end of the turn');
    expect(t.turn.step === 'end' || t.turn.number === 2).toBe(true);
  });
  it('the second main phase counts the main phases that occur (CR 505.1b): after an added main phase (the turn\'s second), the phases come right after it, before the ordinary combat', () => {
    const RUSH = synthetic('Test Rush', 'Sorcery', '{0}', 'After this main phase, there is an additional combat phase followed by an additional main phase.');
    let s = mpScenario({ defs: [...DEFS, RUSH], zones: { p1: { hand: ['Test Rush', 'Test Second Wind'] } } });
    s = resolveStack(castWith(s, 'Test Rush'));
    s = resolveStack(castWith(s, 'Test Second Wind'));
    const flags: boolean[] = [];
    for (let guard = 0; guard < 60 && s.turn.step !== 'end' && s.turn.number === 1; guard++) {
      if (s.turn.step === 'beginCombat') flags.push(s.turn.phaseResume !== undefined);
      const here = s.turn.step;
      s = passUntil(s, (t) => t.turn.step !== here || t.turn.number !== 1, 'the next step');
    }
    expect(flags).toEqual([true, true, false]); // Rush's combat, World at War's combat, then the ordinary combat phase
  });
  it('regression: a combat phase added DURING an added combat phase does not lose the main phase the first one is followed by (All-Out Assault + Combat Celebrant)', () => {
    const RUSH = synthetic('Test Rush', 'Sorcery', '{0}', 'After this main phase, there is an additional combat phase followed by an additional main phase.');
    const FLASH = synthetic('Test Flash Combat', 'Instant', '{0}', 'After this phase, there is an additional combat phase.');
    let s = mpScenario({ defs: [RUSH, FLASH], zones: { p1: { hand: ['Test Rush', 'Test Flash Combat'] } } });
    s = resolveStack(castWith(s, 'Test Rush'));
    s = passUntil(s, (t) => t.turn.step === 'beginCombat' && t.turn.phaseResume !== undefined && t.pending?.kind === 'priority' && t.pending.player === 'p1', 'the added combat');
    s = resolveStack(castWith(s, 'Test Flash Combat'));
    const seen: string[] = [];
    for (let guard = 0; guard < 60 && s.turn.number === 1 && s.turn.step !== 'end'; guard++) {
      const here = s.turn.step;
      if (seen[seen.length - 1] !== here) seen.push(here);
      s = passUntil(s, (t) => t.turn.step !== here || t.turn.number !== 1, 'the next step');
    }
    expect(seen).toEqual(['beginCombat', 'declareAttackers', 'endCombat', 'beginCombat', 'declareAttackers', 'endCombat', 'main2', 'beginCombat', 'declareAttackers', 'endCombat', 'main2']);
  });
  it('negative: cast after the second main phase has ended (a third main phase): no phase is added at all', () => {
    const RUSH = synthetic('Test Rush', 'Sorcery', '{0}', 'After this main phase, there is an additional combat phase followed by an additional main phase.');
    let s = mpScenario({ defs: [...DEFS, RUSH], zones: { p1: { hand: ['Test Rush', 'Test Second Wind'] } } });
    s = resolveStack(castWith(s, 'Test Rush'));
    s = passUntil(s, (t) => t.turn.step === 'main2' && t.turn.phaseResume !== undefined && t.pending?.kind === 'priority' && t.pending.player === 'p1', 'the added main phase');
    s = passUntil(s, (t) => t.turn.step === 'main2' && t.turn.phaseResume === undefined && t.pending?.kind === 'priority' && t.pending.player === 'p1', 'the ordinary second main phase (the third main phase)');
    s = resolveStack(castWith(s, 'Test Second Wind'));
    expect(s.turn.extraPhases).toBeUndefined();
  });
  it('cast in the second main phase: it counts (the current second main phase is the one the phase follows)', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Second Wind'], battlefield: ['Test Bear'] } } });
    s = passUntil(s, (t) => t.turn.step === 'main2' && t.turn.number === 1 && t.pending?.kind === 'priority' && t.pending.player === 'p1', 'the second main phase');
    s = resolveStack(castWith(s, 'Test Second Wind'));
    s = passUntil(s, (t) => t.turn.step === 'beginCombat' && t.turn.number === 1, 'the added combat phase');
    expect(s.turn.phaseResume).toBeDefined();
  });
});

describe('CR 101.4, 122.1, 611.2b, 701.21a: "Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those creatures can\'t attack you or planeswalkers you control for as long as it has a vow counter on it." (Promise of Loyalty)', () => {
  const PROMISE = synthetic('Test Oath of Peace', 'Sorcery', '{0}', 'Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those creatures can\'t attack you or planeswalkers you control for as long as it has a vow counter on it.');
  const BEAR = synthetic('Test Bear', 'Creature — Bear', '{0}', '', { power: '2', toughness: '2' });
  const DEFS = [PROMISE, BEAR];
  const bears = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === p);

  it('the card is automated', () => expect(full(PROMISE), JSON.stringify(PROMISE.automation)).toBe(true));
  it('every player keeps the creature they choose (a player with none keeps none), the rest are sacrificed, and the kept ones cannot attack the caster but can attack the others', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Oath of Peace'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p4: { battlefield: ['Test Bear'] } } });
    const [a1, a2] = bears(s, 'p1');
    const [b1, b2, b3] = bears(s, 'p2');
    const [d1] = bears(s, 'p4');
    s = resolveStack(castWith(s, 'Test Oath of Peace'), [pick(a2!), pick(b2!), pick(d1!)]);
    expect(bears(s, 'p1')).toEqual([a2]);
    expect(bears(s, 'p2')).toEqual([b2]);
    expect(bears(s, 'p4')).toEqual([d1]);
    expect([a1, b1, b3].map((id) => s.objects[id!]?.zone === 'battlefield')).toEqual([false, false, false]); // (a sacrificed card is a new object in the graveyard)
    expect(Object.values(s.objects).filter((o) => o.zone === 'graveyard' && s.defs[o.defId]!.name === 'Test Bear').length).toBe(3);
    expect([a2, b2, d1].map((id) => s.objects[id!]!.counters['vow'])).toEqual([1, 1, 1]);
    s = toAttackersOf(s, 'p2');
    expect(defendersOf(s, b2!)).not.toContain('p1');
    expect(defendersOf(s, b2!)).toEqual(expect.arrayContaining(['p3', 'p4']));
  });
  it('negative: a creature that loses its vow counter can attack the caster again while the others stay held (judged creature by creature)', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Oath of Peace'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
    const [a] = bears(s, 'p1');
    const [b] = bears(s, 'p2');
    const [c] = bears(s, 'p3');
    s = resolveStack(castWith(s, 'Test Oath of Peace'), [pick(a!), pick(b!), pick(c!)]);
    delete s.objects[b!]!.counters['vow'];
    s = toAttackersOf(s, 'p2');
    expect(defendersOf(s, b!)).toContain('p1');
    s = passUntil(s, (t) => t.turn.number === 3 && t.pending?.kind === 'declareAttackers' && t.pending.player === 'p3', 'the attack of p3');
    expect(defendersOf(s, c!)).not.toContain('p1');
  });
  it('negative: the restriction belongs to the player who cast it: a second copy cast by another player protects that player, not the first caster', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { hand: ['Test Oath of Peace'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Oath of Peace'], battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear'] } } });
    const [a] = bears(s, 'p1');
    const [b] = bears(s, 'p2');
    const [c] = bears(s, 'p3');
    s = resolveStack(castWith(s, 'Test Oath of Peace'), [pick(a!), pick(b!), pick(c!)]);
    s = passUntil(s, (t) => t.turn.number === 2 && t.pending?.kind === 'priority' && t.turn.step === 'main1' && t.pending.player === 'p2', 'main phase of p2');
    s = resolveStack(castWith(s, 'Test Oath of Peace', [], undefined, 'p2'), [pick(a!), pick(b!), pick(c!)]);
    s = toAttackersOf(s, 'p2');
    expect(defendersOf(s, b!)).not.toContain('p1'); // still held by the first copy
    expect(defendersOf(s, b!)).not.toContain('p2'); // a creature never attacks its own controller
    s = passUntil(s, (t) => t.turn.number === 3 && t.pending?.kind === 'declareAttackers' && t.pending.player === 'p3', 'the attack of p3');
    expect(defendersOf(s, c!)).not.toContain('p1');
    expect(defendersOf(s, c!)).not.toContain('p2');
    expect(legalActions(s, 'p3').length).toBeGreaterThanOrEqual(0);
  });
});

describe('CR 702.14a, 702.16a, 608.2c: "The same is true for ..., landwalk, protection, ..." (Concerted Effort): every variant of the family that a creature you control has is shared', () => {
  const CONCORD = synthetic('Test Concord', 'Enchantment', '{0}', 'At the beginning of each upkeep, creatures you control gain flying until end of turn if a creature you control has flying. The same is true for landwalk, protection, and vigilance.');
  const WALKER = synthetic('Test Walker', 'Creature — Scout', '{0}', 'Islandwalk', { power: '1', toughness: '1' });
  const WARDEN = synthetic('Test Warden', 'Creature — Scout', '{0}', 'Protection from red\nVigilance', { power: '1', toughness: '1' });
  const PLAIN = synthetic('Test Plain', 'Creature — Scout', '{0}', '', { power: '1', toughness: '1' });
  const DEFS = [CONCORD, WALKER, WARDEN, PLAIN];
  const kws = (s: GameState, id: ObjectId): string[] => (getChars(s, id)?.keywords ?? []).map((k) => `${k.keyword}${k.quality !== undefined ? `:${k.quality}` : ''}`).sort();
  const atUpkeep = (s: GameState): GameState => resolveStack(passUntil(s, (t) => t.turn.number === 2 && t.turn.step === 'upkeep' && t.zones.stack.length > 0, 'the upkeep trigger'));

  it('the card is automated', () => expect(full(CONCORD), JSON.stringify(CONCORD.automation)).toBe(true));
  it('the islandwalk and the protection from red are shared with every creature of the controller (other upkeeps count too: each upkeep, any player\'s), nothing else is', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Concord', 'Test Walker', 'Test Warden', 'Test Plain'] } } });
    const plain = find(s, 'Test Plain', 'battlefield', 'p1');
    s = atUpkeep(s);
    expect(kws(s, plain)).toEqual(expect.arrayContaining(['vigilance']));
    expect(kws(s, plain).filter((k) => k.startsWith('landwalk') || k.startsWith('protection'))).toHaveLength(2);
    expect(kws(s, plain).some((k) => k === 'flying')).toBe(false); // nobody has flying
  });
  it('negative: with no creature that has a landwalk, a protection or vigilance, nothing is shared', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Concord', 'Test Plain'] } } });
    const plain = find(s, 'Test Plain', 'battlefield', 'p1');
    s = atUpkeep(s);
    expect(kws(s, plain)).toEqual([]);
  });
});
