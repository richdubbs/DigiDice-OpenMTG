/**
 * WP7 review 2, paying (CR 601.2f-h, 702.119, 702.51): emerge reduces the TOTAL cost and offers only creatures that leave it payable; the affordability tests made
 * while announcing (X, kicker) honor convoke / delve / improvise like `castCheck` does; energy is paid by CR 107.14; a phased-out permanent can't pay a cost.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import type { PaymentOption } from '../../../src/keywords/types';
import { act, activated, answer, find, labels, legal, reject, scenario, synth, withStatics } from '../helpers';
import { additionalCost, alternativeCost, castCard, drive, mana, spell, staticAbility } from './support';

const stackInfo = (s: GameState) => s.objects[s.zones.stack[0]!]!.stack!;
const optionsOf = (s: GameState) => (s.pending as unknown as { options: string[] }).options;
const colors = ['W', 'U', 'B', 'R', 'G'];
const convoke: PaymentOption = {
  key: 'convoke', describe: 'Tap an untapped creature you control', reduces: { generic: 1, colors },
  cost: { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1 }] },
};
const only = (o: PaymentOption) => ({ paymentOptions: (_g: unknown, id: string) => (id.length > 0 ? [o] : []) });

describe('CR 702.119a, 601.2f: emerge reduces the TOTAL cost (base + additional costs), not just the alternative cost', () => {
  const emerge = alternativeCost('emerge', { mana: mana('{2}{R}'), other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] });
  const extra = additionalCost(undefined, { mana: mana('{2}') });
  const horror = synth({ name: 'Test Horror2', cost: '{6}{R}', type: 'Creature — Horror', pt: ['6', '6'], abilities: [staticAbility('Emerge {2}{R}', [emerge]), staticAbility('As an additional cost, pay {2}.', [extra])] });
  const board = (): GameState => scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Horror2'], battlefield: ['Mountain', 'Hill Giant'] }, defs: [horror] });

  it('{2}{R} + {2} = {4}{R} less the Giant\'s mana value 4 is {R}: the listed cast is accepted and the payment is not a dead end (it used to be {R}{2})', () => {
    let s = board();
    expect(labels(s, 'p1')).toContain('Cast Test Horror2 (emerge)');
    s = castCard(s, 'Test Horror2', { method: 'emerge' });
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Hill Giant', 'battlefield')] });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{R}', autoPayable: true });
    s = drive(s, []);
    expect(stackInfo(s).costsPaid.manaSpent).toHaveLength(1);
  });
});

describe('CR 702.119a, 601.2h: only the creatures that leave the emerge cost payable are offered', () => {
  const emerge = alternativeCost('emerge', { mana: mana('{3}{R}'), other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] });
  const horror = synth({ name: 'Test Horror3', cost: '{6}{R}', type: 'Creature — Horror', pt: ['6', '6'], abilities: [staticAbility('Emerge {3}{R}', [emerge])] });

  it('with one Mountain, the Bears (mana value 2: {1}{R} left) are not offered, the Giant (mana value 4: {R} left) is; naming the Bears anyway is refused', () => {
    let s = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Horror3'], battlefield: ['Mountain', 'Grizzly Bears', 'Hill Giant'] }, defs: [horror] });
    s = castCard(s, 'Test Horror3', { method: 'emerge' });
    expect(optionsOf(s)).toEqual([find(s, 'Hill Giant', 'battlefield')]);
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseObjects', ids: [find(s, 'Grizzly Bears', 'battlefield')] } });
  });
});

describe('CR 601.2b, 601.2f, 702.51a: the X ceiling and the optional costs honor convoke like castCheck does', () => {
  const chord = spell('Test Chord', '{X}{G}', []);
  const board = (hand: string[], defs: ReturnType<typeof spell>[]): GameState =>
    scenario(['Forest', 'Grizzly Bears'], { p1: { hand, battlefield: ['Forest', 'Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }, defs });

  it('one Forest and three creatures: X can be 3 (the creatures pay for it), not 0 as when only mana was counted', () => {
    const s0 = board(['Test Chord'], [chord]);
    const s = withStatics(only(convoke), () => {
      let t = castCard(s0, 'Test Chord');
      expect(t.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 3 });
      t = answer(t, { kind: 'chooseNumber', n: 3 });
      expect(t.pending).toMatchObject({ kind: 'chooseObjects', min: 0 });
      const bears = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Grizzly Bears');
      return drive(answer(t, { kind: 'chooseObjects', ids: bears }), []);
    });
    expect(stackInfo(s).x).toBe(3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Grizzly Bears').every((id) => s.objects[id]!.tapped)).toBe(true);
  });

  it('a kicker that only convoke makes affordable is offered (it used to be skipped: "can\'t pay the kicker cost")', () => {
    const kicked = spell('Test Convoke Kick', '{G}', [], { abilities: [staticAbility('Kicker {2}', [additionalCost('kicker', { mana: mana('{2}') }, { optional: true })])] });
    const s0 = board(['Test Convoke Kick'], [kicked]);
    const t = withStatics(only(convoke), () => castCard(s0, 'Test Convoke Kick'));
    expect(t.pending).toMatchObject({ kind: 'yesNo', prompt: expect.stringContaining('kicker') });
  });

  it('CR 702.51a: the green creature pays the colored {G}, the other creature the generic {1}; the Forest pays what is left', () => {
    const card = spell('Test Convoke Cost', '{2}{G}', [], { type: 'Sorcery' });
    const s0 = scenario(['Forest', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Convoke Cost'], battlefield: ['Forest', 'Grizzly Bears', 'Hill Giant'] }, defs: [card] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = withStatics(only(convoke), () => answer(castCard(s0, 'Test Convoke Cost'), { kind: 'chooseObjects', ids: [bears, giant] }));
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{1}' }); // {G} went to the Bears, {1} to the Giant, {1} is left for the Forest
    const done = withStatics(only(convoke), () => drive(s, []));
    const paid = stackInfo(done).costsPaid;
    expect(paid.costObjects).toEqual(expect.arrayContaining([bears, giant]));
    expect(paid.manaSpent!.map((u) => u.type)).toEqual(['G']);
  });

  it('an object that could pay for nothing is not offered, and refused: the red Giant cannot pay a colored {G}{G} cost', () => {
    const card = spell('Test Convoke Green', '{G}{G}', [], { type: 'Sorcery' });
    const s0 = scenario(['Forest', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Convoke Green'], battlefield: ['Forest', 'Grizzly Bears', 'Hill Giant'] }, defs: [card] });
    withStatics(only(convoke), () => {
      const t = castCard(s0, 'Test Convoke Green');
      // FXC (audit m1, CR 702.51a): only the green Bears can pay a {G}; the Giant was offered before and then rejected
      expect(optionsOf(t)).toEqual([find(s0, 'Grizzly Bears', 'battlefield')]);
      reject(t, { type: 'answer', player: 'p1', decisionId: t.pending!.id, answer: { kind: 'chooseObjects', ids: [find(s0, 'Hill Giant', 'battlefield')] } });
    });
  });
});

describe('CR 107.14: energy is paid by removing energy counters — the rule is cited as such', () => {
  it('a cost the player cannot pay cites CR 107.14, not the keyword-counter rule 122.1b', () => {
    const gadget = synth({ name: 'Test Charger', type: 'Artifact', abilities: [activated('{E}{E}: Do it.', { other: [{ kind: 'payEnergy', amount: 2 }] })] });
    const s = scenario([], { p1: { battlefield: ['Test Charger'] }, defs: [gadget] });
    const err = reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Charger', 'battlefield'), ability: 'p:0:0' });
    expect(err.rules).toContain('CR 107.14');
    expect(err.rules).not.toContain('CR 122.1b');
  });
});

describe('CR 702.26b: a phased-out permanent is treated as though it does not exist — it cannot pay a cost', () => {
  it('"Sacrifice a creature": a phased-out creature is not a candidate, so the ability is not offered', () => {
    const altar = synth({ name: 'Test Altar', type: 'Artifact', abilities: [activated('Sacrifice a creature: Do it.', { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }] })] });
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Altar', 'Grizzly Bears'] }, defs: [altar] });
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
    s.objects[find(s, 'Grizzly Bears', 'battlefield')]!.phasedOut = true;
    expect(legal(s, 'p1', 'activate')).toEqual([]);
  });
});

describe('CR 601.2h: costs that involve random elements or move cards out of the library are paid after the others', () => {
  it('a mill and a random discard are listed first but paid after the sacrifice', () => {
    const grinder = synth({
      name: 'Test Grinder', type: 'Artifact',
      abilities: [activated('Mill a card, discard a card at random, sacrifice a creature: Do it.', {
        other: [{ kind: 'mill', count: 1 }, { kind: 'discard', count: 1, random: true }, { kind: 'sacrifice', filter: { types: ['Creature'] }, count: 1 }],
      })],
    });
    let s = scenario(['Grizzly Bears', 'Mountain'], { p1: { hand: ['Mountain'], battlefield: ['Test Grinder', 'Grizzly Bears'] }, defs: [grinder] });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Grinder', 'battlefield'), ability: 'p:0:0' });
    s = drive(s, []);
    const text = s.log.map((l) => l.text);
    const at = (needle: string): number => text.findIndex((t) => t.includes(needle));
    expect(at('sacrifices')).toBeGreaterThanOrEqual(0);
    expect(at('mills')).toBeGreaterThan(at('sacrifices'));
    expect(at('discards')).toBeGreaterThan(at('sacrifices'));
  });
});
