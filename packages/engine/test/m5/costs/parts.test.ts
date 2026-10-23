/**
 * WP7: the cost parts of the final model (CR 118.3, 601.2h, 602.2b): tapPower (crew), putCounters, payEnergy, reveal, mill, the actions collectEvidence / forage /
 * blight, the confirm-by-hand `manual` part, and the value forms discard self (cycling), discard hand, removeCounters on a chosen permanent, tapUntapped other.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type CostDef, type GameState } from '../../../src/index';
import { partsDenial, planFromCostDef } from '../../../src/rules/cost';
import { act, activated, answer, find, labels, legal, reject, scenario, synth } from '../helpers';
import { drive, mana } from '../announce/support';

type Zones = { hand?: string[]; battlefield?: string[]; graveyard?: string[] };

/** A board with the given permanent holding one activated ability with this cost. */
function setup(cost: CostDef, p1: Zones = {}, opts: { zone?: 'hand' | 'battlefield'; type?: string; pt?: [string, string]; library?: number } = {}): { s: GameState; id: string } {
  const card = synth({ name: 'Test Device', cost: '{1}', type: opts.type ?? 'Artifact', ...(opts.pt ? { pt: opts.pt } : {}), abilities: [activated('Do it.', cost, [], opts.zone === 'hand' ? { zone: ['hand'] } : {})] });
  const zone = opts.zone ?? 'battlefield';
  const s = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant', 'Serra Angel', 'Llanowar Elves'], {
    p1: { hand: [...(p1.hand ?? []), ...(zone === 'hand' ? ['Test Device'] : [])], graveyard: p1.graveyard ?? [], battlefield: [...(p1.battlefield ?? []), ...(zone === 'battlefield' ? ['Test Device'] : [])] },
    p2: { battlefield: ['Hill Giant'] },
    defs: [card],
  });
  return { s, id: find(s, 'Test Device', zone) };
}

const activate = (s: GameState, id: string) => act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
const names = (s: GameState, ids: string[]): string[] => ids.map((i) => s.objects[i]!.defId);
const tapped = (s: GameState, id: string): boolean => s.objects[id]!.tapped;

describe('CR 702.122a: tapPower — tap any number of untapped creatures with total power N or more', () => {
  const crew = { other: [{ kind: 'tapPower' as const, filter: { types: ['Creature'] }, power: 3 }] };

  it('the player names the creatures; a set with too little power is rejected and the decision stays open', () => {
    const { s: s0, id } = setup(crew, { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Hill Giant'] });
    const bears = s0.zones.battlefield.filter((x) => s0.objects[x]!.defId === 'Grizzly Bears');
    let s = activate(s0, id);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 1 });
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseObjects', ids: [bears[0]!] } });
    expect(err.message).toContain('total power 2');
    s = answer(s, { kind: 'chooseObjects', ids: bears });
    expect(bears.every((b) => tapped(s, b))).toBe(true);
    expect(tapped(s, find(s, 'Hill Giant', 'battlefield', 'p1'))).toBe(false);
    expect(s.objects[s.zones.stack[0]!]!.stack!.costsPaid.costObjects).toEqual(bears);
  });

  it('not offered when all the untapped creatures together have too little power; tapped creatures do not count', () => {
    const { s: poor, id: poorId } = setup(crew, { battlefield: ['Grizzly Bears'] });
    expect(legal(poor, 'p1', 'activate').filter((a) => a.object === poorId)).toEqual([]);
    const { s: tappedOut } = setup(crew, { battlefield: ['Grizzly Bears', { name: 'Hill Giant', tapped: true } as never] });
    expect(legal(tappedOut, 'p1', 'activate').filter((a) => a.label.includes('Do it'))).toEqual([]);
  });

  it('a creature tapped for the cost cannot also be tapped for its own mana: the cost is checked as a whole', () => {
    const mixed: CostDef = { mana: [{ kind: 'colored', color: 'G' }], other: [{ kind: 'tapPower', filter: { types: ['Creature'] }, power: 1 }] };
    const { s: both, id } = setup(mixed, { battlefield: ['Llanowar Elves', 'Grizzly Bears'] });
    expect(legal(both, 'p1', 'activate').filter((a) => a.object === id)).toHaveLength(1); // the Elves make {G}, the Bears are tapped for the cost
    const { s: elvesOnly, id: id2 } = setup(mixed, { battlefield: ['Llanowar Elves'] });
    expect(legal(elvesOnly, 'p1', 'activate').filter((a) => a.object === id2)).toEqual([]); // the Elves are the only source of {G} and the only creature to tap
  });

  it('other: the source (a Vehicle that is a creature) does not pay for itself', () => {
    const crewOther = { other: [{ kind: 'tapPower' as const, filter: { types: ['Creature'] }, power: 2, other: true }] };
    const { s, id } = setup(crewOther, {}, { type: 'Artifact Creature — Vehicle', pt: ['4', '4'] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]); // the Vehicle is the only creature
  });
});

describe('CR 122.1, 701.68: putCounters and blight', () => {
  it('put a counter on this permanent as a cost', () => {
    const { s: s0, id } = setup({ other: [{ kind: 'putCounters', counter: 'charge', count: 2, self: true }] });
    const s = drive(activate(s0, id), []);
    expect(s.objects[id]!.counters).toEqual({ charge: 2 });
  });

  it('blight N puts N -1/-1 counters on a creature you control, chosen by the player', () => {
    const { s: s0, id } = setup({ other: [{ kind: 'action', action: 'blight', arg: 1 }] }, { battlefield: ['Grizzly Bears', 'Hill Giant'] });
    let s = activate(s0, id);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects' });
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p1');
    s = drive(answer(s, { kind: 'chooseObjects', ids: [giant] }), []);
    expect(s.objects[giant]!.counters).toEqual({ '-1/-1': 1 });
  });

  it('with no creature to put the counters on, blight cannot be paid and the ability is not offered (CR 701.68b)', () => {
    const { s, id } = setup({ other: [{ kind: 'action', action: 'blight', arg: 1 }] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]);
  });
});

describe('CR 107.14: payEnergy', () => {
  it('pays energy counters; not offered without enough', () => {
    const { s: s0, id } = setup({ other: [{ kind: 'payEnergy', amount: 2 }] });
    expect(legal(s0, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]);
    s0.players[0]!.counters.energy = 3;
    expect(legal(s0, 'p1', 'activate').filter((a) => a.object === id)).toHaveLength(1);
    const s = drive(activate(s0, id), []);
    expect(s.players[0]!.counters.energy).toBe(1);
  });
});

describe('CR 701.20: reveal a card from your hand as a cost', () => {
  const cost: CostDef = { other: [{ kind: 'reveal', zone: 'hand', filter: { types: ['Creature'] }, count: 1 }] };

  it('the revealed card stays in the hand; an actionPerformed event names it', () => {
    const { s: s0, id } = setup(cost, { hand: ['Grizzly Bears', 'Mountain'] });
    const bears = find(s0, 'Grizzly Bears', 'hand');
    const r = applyAction(s0, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    expect(r.error).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'actionPerformed', verb: 'reveal', actor: 'p1', objectId: bears });
    expect(r.state.objects[bears]!.zone).toBe('hand');
  });

  it('no creature card in hand: not offered', () => {
    const { s, id } = setup(cost, { hand: ['Mountain'] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]);
  });
});

describe('CR 701.17a-b: mill as a cost', () => {
  it('the top cards go to the graveyard; a library with fewer cards cannot pay (CR 701.17b)', () => {
    const { s: s0, id } = setup({ other: [{ kind: 'mill', count: 3 }] });
    const before = s0.zones.library.p1!.length;
    const s = drive(activate(s0, id), []);
    expect(s.zones.library.p1).toHaveLength(before - 3);
    expect(s.zones.graveyard.p1).toHaveLength(3);
    const big = setup({ other: [{ kind: 'mill', count: 99 }] });
    expect(legal(big.s, 'p1', 'activate').filter((a) => a.object === big.id)).toEqual([]);
  });
});

describe('CR 701.59: collect evidence N', () => {
  const cost: CostDef = { other: [{ kind: 'action', action: 'collectEvidence', arg: 4 }] };

  it('exile cards from the graveyard with total mana value N or more', () => {
    const { s: s0, id } = setup(cost, { graveyard: ['Grizzly Bears', 'Grizzly Bears', 'Mountain'] });
    const two = s0.zones.graveyard.p1!.filter((x) => s0.objects[x]!.defId === 'Grizzly Bears');
    let s = activate(s0, id);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects' });
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseObjects', ids: [two[0]!] } });
    expect(err.message).toContain('total mana value 2');
    s = drive(answer(s, { kind: 'chooseObjects', ids: two }), []);
    expect(names(s, s.zones.exile.filter((x) => s.objects[x]!.defId === 'Grizzly Bears'))).toHaveLength(2);
  });

  it('a graveyard without enough mana value cannot pay (CR 701.59b)', () => {
    const { s, id } = setup(cost, { graveyard: ['Grizzly Bears', 'Mountain'] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]);
  });
});

describe('CR 701.61: forage — exile three cards from your graveyard or sacrifice a Food', () => {
  const cost: CostDef = { other: [{ kind: 'action', action: 'forage' }] };
  const food = synth({ name: 'Test Food', cost: '{1}', type: 'Artifact — Food', abilities: [] });

  it('three graveyard cards are exiled', () => {
    const { s: s0, id } = setup(cost, { graveyard: ['Mountain', 'Mountain', 'Mountain'] });
    const s = drive(activate(s0, id), []);
    expect(s.zones.exile.filter((x) => s.objects[x]!.defId === 'Mountain')).toHaveLength(3);
  });

  it('with a Food and a full graveyard the player chooses; the Food is sacrificed', () => {
    const card = synth({ name: 'Test Device', cost: '{1}', type: 'Artifact', abilities: [activated('Do it.', cost)] });
    const s0 = scenario(['Mountain'], { p1: { graveyard: ['Mountain', 'Mountain', 'Mountain'], battlefield: ['Test Device', 'Test Food'] }, defs: [card, food] });
    let s = activate(s0, find(s0, 'Test Device', 'battlefield'));
    expect(s.pending).toMatchObject({ kind: 'chooseOption', options: [{ id: 'exile' }, { id: 'food' }] });
    s = drive(answer(s, { kind: 'chooseOption', ids: ['food'] }), []);
    expect(s.zones.graveyard.p1!.map((x) => s.objects[x]!.defId)).toContain('Test Food');
    expect(s.zones.exile).toHaveLength(0);
  });

  it('neither three cards nor a Food: not offered', () => {
    const { s, id } = setup(cost, { graveyard: ['Mountain'] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]);
  });
});

describe('CR 118.3, 733.1: the `manual` cost part is confirmed by the controller', () => {
  const cost: CostDef = { other: [{ kind: 'manual', text: 'Exert Test Device' }] };

  it('yes: the cost is paid and the log says it was confirmed by hand', () => {
    const { s: s0, id } = setup(cost);
    expect(legal(s0, 'p1', 'activate').filter((a) => a.object === id)).toHaveLength(1);
    let s = activate(s0, id);
    expect(s.pending).toMatchObject({ kind: 'yesNo', cancellable: true });
    s = drive(answer(s, { kind: 'yesNo', yes: true }), []);
    expect(s.log.some((l) => l.level === 'manual' && l.text.includes('Exert Test Device'))).toBe(true);
    expect(s.zones.stack).toHaveLength(1);
  });

  it('no: the activation is refused with the decision still open; cancelling takes the whole action back', () => {
    const { s: s0, id } = setup(cost);
    const s = activate(s0, id);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'yesNo', yes: false } });
    expect(err.message).toContain('was not paid');
    const back = act(s, { type: 'cancel', player: 'p1' });
    expect(back.zones.stack).toHaveLength(0);
    expect(back.objects[id]).toBeDefined();
  });

  it('a keyword action the build cannot pay (clash; FAST5X E28 pays exert) stays a manual plan part: the ability is not offered', () => {
    const { s, id } = setup({ other: [{ kind: 'action', action: 'clash' }] });
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]);
    expect(partsDenial(s, 'p1', id, planFromCostDef({ other: [{ kind: 'action', action: 'clash' }] }, 0))?.message).toContain("can't be paid automatically");
  });
});

describe('CR 701.9, 702.29: discard this card (cycling) and discard your hand', () => {
  it('cycling: an ability of a card in hand whose cost discards itself', () => {
    const { s: s0, id } = setup({ mana: mana('{1}'), other: [{ kind: 'discard', count: 1, self: true }] }, { battlefield: ['Mountain', 'Mountain'] }, { zone: 'hand', type: 'Creature — Beast', pt: ['2', '2'] });
    expect(labels(s0, 'p1').some((l) => l.includes('Do it'))).toBe(true);
    const s = drive(activate(s0, id), []);
    expect(s.zones.graveyard.p1!.map((x) => s.objects[x]!.defId)).toEqual(['Test Device']);
    expect(s.zones.stack).toHaveLength(1);
    expect(s.objects[s.zones.stack[0]!]!.stack!.sourceId).toBe(id);
  });

  it('discard your hand: every card in it goes to the graveyard, even with no choice to make', () => {
    const { s: s0, id } = setup({ other: [{ kind: 'discard', count: 0, hand: true }] }, { hand: ['Mountain', 'Grizzly Bears', 'Hill Giant'] });
    const s = drive(activate(s0, id), []);
    expect(s.zones.hand.p1).toHaveLength(0);
    expect(s.zones.graveyard.p1).toHaveLength(3);
  });
});

describe('CR 118.3: removeCounters from a chosen permanent, tapUntapped other', () => {
  it('remove a +1/+1 counter from a creature you control: the player picks among those that have one', () => {
    const { s: s0, id } = setup({ other: [{ kind: 'removeCounters', counter: '+1/+1', count: 1, filter: { types: ['Creature'] } }] }, { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 2 } } as never, 'Hill Giant'] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = drive(activate(s0, id), []); // the only creature with a counter: nothing to choose
    expect(s.objects[bears]!.counters).toEqual({ '+1/+1': 1 });
  });

  it('tap another untapped creature: the source creature is not a candidate', () => {
    const cost: CostDef = { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1, other: true }] };
    const { s: alone, id } = setup(cost, {}, { type: 'Creature — Beast', pt: ['2', '2'] });
    expect(legal(alone, 'p1', 'activate').filter((a) => a.object === id)).toEqual([]);
    const { s: withFriend, id: id2 } = setup(cost, { battlefield: ['Grizzly Bears'] }, { type: 'Creature — Beast', pt: ['2', '2'] });
    const s = drive(activate(withFriend, id2), []);
    expect(tapped(s, find(s, 'Grizzly Bears', 'battlefield'))).toBe(true);
    expect(tapped(s, id2)).toBe(false);
  });
});

describe('CR 601.2b, 107.3a: "any number of" in a cost is chosen by the player when the cost is announced', () => {
  const cost: CostDef = { other: [{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 'any' }] };

  it('the player says how many (0 to the number of creatures), then which; the ability is offered even with none', () => {
    const { s: s0, id } = setup(cost, { battlefield: ['Grizzly Bears', 'Grizzly Bears'] });
    expect(legal(s0, 'p1', 'activate').filter((a) => a.object === id)).toHaveLength(1);
    let s = activate(s0, id);
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 2 });
    s = answer(s, { kind: 'chooseNumber', n: 1 });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 1, max: 1 });
    s = drive(answer(s, { kind: 'chooseObjects', ids: [find(s, 'Grizzly Bears', 'battlefield')] }), []);
    expect(s.zones.battlefield.filter((x) => s.objects[x]!.defId === 'Grizzly Bears')).toHaveLength(1);
  });

  it('zero is a legal count: nothing is sacrificed', () => {
    const { s: s0, id } = setup(cost, { battlefield: ['Grizzly Bears'] });
    const s = drive(answer(activate(s0, id), { kind: 'chooseNumber', n: 0 }), []);
    expect(s.zones.battlefield.some((x) => s.objects[x]!.defId === 'Grizzly Bears')).toBe(true);
    expect(s.zones.stack).toHaveLength(1);
  });
});
