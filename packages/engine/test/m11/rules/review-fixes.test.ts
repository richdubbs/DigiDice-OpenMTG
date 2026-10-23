/**
 * M11-1 review fixes: CR 903.9c (a merged or melded commander goes to the command zone on its own), a face-down commander's combat damage kept private
 * (CR 400.2, 708.2) until it is revealed, and a drawn commander offered the CR 903.9b choice.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, viewFor, type DecisionAnswer, type GameEvent, type GameState } from '../../../src/index';
import {
  act, answerUntilPriority, card, commanderOnBattlefield, commanderScenario, find, forests, legend, lifeOf, logHas, pass, runCombat, toStep, tweak,
} from './helpers';

const TITANIA = legend('Test Titania', '{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const BIG = card('Test Big', '{2}{G}', 'Creature — Beast', '', ['3', '3']);
const TUCK = card('Test Tuck', '{G}', 'Instant', "Put target creature on top of its owner's library.");
const KILL = card('Test Kill', '{G}', 'Instant', 'Destroy target creature.');

const answerZone = (s: GameState, command: boolean): { state: GameState; events: GameEvent[] } => {
  const d = s.pending!;
  const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'commanderZone', command } as DecisionAnswer });
  if (r.error) throw new Error(r.error.message);
  return { state: r.state, events: r.events };
};
const zoneOfDef = (s: GameState, defId: string): string[] => Object.values(s.objects).filter((o) => o.defId === defId).map((o) => o.zone);

/**
 * Alice's Titania merged with a Test Big (CR 730.2): `titaniaOnTop` decides which card is the topmost component. Alice holds Test Tuck and Test Kill.
 */
function mergedBoard(titaniaOnTop: boolean): { s: GameState; merged: string } {
  let s = commanderScenario({
    p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [BIG, TUCK, KILL],
    p1: { battlefield: [...forests(2), titaniaOnTop ? 'Test Titania' : 'Test Big'], hand: ['Test Tuck', 'Test Kill'] },
  });
  if (titaniaOnTop) s = commanderOnBattlefield(s, 'Test Titania');
  let merged = '';
  s = tweak(s, (t) => {
    const rec = t.players[0]!.commanders![0]!;
    if (!titaniaOnTop) {
      t.zones.command = t.zones.command.filter((x) => t.objects[x]!.cardId !== rec.card);
      for (const x of Object.keys(t.objects)) if (t.objects[x]!.cardId === rec.card) delete t.objects[x];
    }
    merged = t.zones.battlefield.find((x) => t.objects[x]!.defId === (titaniaOnTop ? TITANIA.id : BIG.id))!;
    const o = t.objects[merged]!;
    const titania = { kind: 'card' as const, defId: TITANIA.id, cardId: rec.card, owner: 'p1' };
    const big = { kind: 'card' as const, defId: BIG.id, cardId: titaniaOnTop ? 'cBig' : o.cardId!, owner: 'p1' };
    o.components = titaniaOnTop ? [titania, { ...big, mergedAt: t.counters.timestamp++ }] : [big, { ...titania, mergedAt: t.counters.timestamp++ }];
  });
  return { s, merged };
}
const castAt = (s: GameState, spell: string, target: string): GameState =>
  pass(pass(answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] }])));

describe('M11-1 review: CR 903.9c, a merged or melded commander', () => {
  it.each([false, true])('CR 903.9b-c: a merged commander (on top: %s) tucked: its owner is asked; yes puts the commander card into the command zone and the other card into the library', (onTop) => {
    const { s, merged } = mergedBoard(onTop);
    const asked = castAt(s, 'Test Tuck', merged);
    expect(asked.pending).toMatchObject({ kind: 'commanderZone', player: 'p1', rule: '903.9b', zone: 'library' });
    const { state, events } = answerZone(asked, true);
    expect(zoneOfDef(state, TITANIA.id)).toEqual(['command']);
    expect(zoneOfDef(state, BIG.id)).toEqual(['library']);
    expect(state.zones.command.filter((id) => state.objects[id]!.defId === TITANIA.id)).toHaveLength(1);
    expect(events.find((e) => e.type === 'zoneChanged' && e.to === 'command')).toMatchObject({ cause: 'commander' });
    expect(logHas(state, /by hand/)).toBe(false);
  });

  it('CR 903.9b: declined, both cards go to the library', () => {
    const { s, merged } = mergedBoard(false);
    const { state } = answerZone(castAt(s, 'Test Tuck', merged), false);
    expect(zoneOfDef(state, TITANIA.id)).toEqual(['library']);
    expect(zoneOfDef(state, BIG.id)).toEqual(['library']);
  });

  it('CR 903.9a: a merged commander destroyed: the commander card in the graveyard is asked about', () => {
    const { s, merged } = mergedBoard(false);
    const asked = castAt(s, 'Test Kill', merged);
    expect(asked.pending).toMatchObject({ kind: 'commanderZone', rule: '903.9a', zone: 'graveyard' });
    expect(zoneOfDef(answerZone(asked, true).state, TITANIA.id)).toEqual(['command']);
  });
});

describe('M11-1 review: a face-down commander\'s combat damage stays private (CR 400.2, 708.2)', () => {
  function faceDownAttack(): GameState {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [KILL], p1: { battlefield: ['Test Titania', ...forests(1)], hand: ['Test Kill'] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === TITANIA.id)!;
    s = tweak(s, (t) => Object.assign(t.objects[id]!, { faceDown: true, faceDownInfo: { by: 'effect', profile: 'plain' } }));
    return runCombat(s, { attack: [[id]] });
  }
  const card0 = (s: GameState): string => s.players[0]!.commanders![0]!.card;

  it('the other player learns nothing: no commander damage entry, no log line, no event naming it as a commander; its controller is told', () => {
    const s = faceDownAttack();
    expect(lifeOf(s, 'p2')).toBe(38);
    expect(s.players.find((p) => p.id === 'p2')!.commanderDamage).toBeUndefined(); // no public tally, so no commanderDamage event either
    const bob = viewFor(s, 'p2');
    expect(bob.players.find((p) => p.id === 'p2')!.commanderDamage?.[card0(s)]).toBeUndefined();
    expect(JSON.stringify(bob.players)).not.toContain(card0(s) + '":');
    expect(bob.log.some((l) => /as a commander|commander damage/.test(l.text))).toBe(false);
    expect(JSON.stringify(Object.values(bob.objects))).not.toMatch(/ommanderDamage/);
    const alice = viewFor(s, 'p1');
    expect(alice.log.some((l) => /Your face-down commander Test Titania: 2 commander damage to Bob/.test(l.text))).toBe(true);
  });

  it('CR 704.6c still reads the true total: 21 from a face-down commander loses', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], p1: { battlefield: ['Test Titania'] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === TITANIA.id)!;
    s = tweak(s, (t) => {
      Object.assign(t.objects[id]!, { faceDown: true, faceDownInfo: { by: 'effect', profile: 'plain' } });
      t.players.find((p) => p.id === 'p2')!.commanderDamage = { [card0(t)]: 19 };
    });
    s = runCombat(s, { attack: [[id]] });
    expect(s.result?.winner).toBe('p1');
  });

  it('CR 708.9: revealed as it leaves the battlefield, the damage joins the public tally with its commanderDamage event', () => {
    let s = toStep(faceDownAttack(), 'main2');
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === TITANIA.id)!;
    s = answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id }] }]);
    s = pass(s);
    const r = applyAction(s, { type: 'pass', player: s.pending!.player });
    expect(r.events.find((e) => e.type === 'commanderDamage')).toMatchObject({ player: 'p2', commander: card0(r.state), amount: 2, total: 2 });
    expect(viewFor(r.state, 'p2').players.find((p) => p.id === 'p2')!.commanderDamage?.[card0(r.state)]).toBe(2);
  });

  it('CR 708.8: turned face up, the damage joins the public tally at the next state-based action check', () => {
    let s = faceDownAttack();
    s = toStep(s, 'main2');
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === TITANIA.id)!;
    // turned face up (CR 708.8): folded at the next state-based action check
    s = tweak(s, (t) => { const o = t.objects[id]!; o.faceDown = false; delete o.faceDownInfo; });
    s = pass(s);
    expect(viewFor(s, 'p2').players.find((p) => p.id === 'p2')!.commanderDamage?.[card0(s)]).toBe(2);
  });
});

describe('M11-1 review: drawing a commander (CR 903.9b)', () => {
  it('CR 903.9b: a commander that would be drawn may be put into the command zone instead', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB] });
    // Alice's commander is on top of her library (she let it go there earlier)
    s = tweak(s, (t) => {
      const id = t.zones.command.find((x) => t.objects[x]!.defId === TITANIA.id)!;
      t.zones.command = t.zones.command.filter((x) => x !== id);
      t.objects[id]!.zone = 'library';
      t.zones.library['p1']!.unshift(id);
    });
    // pass to Alice's next turn's draw step
    for (let i = 0; i < 80 && s.pending && s.pending.kind !== 'commanderZone'; i++) {
      const d = s.pending;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'declareAttackers') s = answerUntilPriority(s, [{ kind: 'declareAttackers', attacks: [] }]);
      else if (d.kind === 'declareBlockers') s = answerUntilPriority(s, [{ kind: 'declareBlockers', blocks: [] }]);
      else throw new Error(`unexpected ${d.kind}`);
    }
    expect(s.pending).toMatchObject({ kind: 'commanderZone', player: 'p1', rule: '903.9b', zone: 'hand' });
    expect(zoneOfDef(answerZone(s, true).state, TITANIA.id)).toEqual(['command']);
    expect(zoneOfDef(answerZone(s, false).state, TITANIA.id)).toEqual(['hand']);
  });
});
