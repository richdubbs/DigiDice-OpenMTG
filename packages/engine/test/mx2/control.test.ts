/**
 * MX2: layer-2 control on the stored controller (core/control.ts; CR 108.4, 613.1b, 302.6, 502.3, 506.4) and the exchange of control (CR 701.12a-b).
 * Real fixture cards on the game path (Act of Treason, Threaten, Control Magic, Switcheroo, Oko, Thief of Crowns), driven by real actions; one synthetic
 * instant compiled from its Oracle wording by the default compiler (the CR 506.4 case needs an instant-speed steal).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../src/index';
import { capabilitiesOf } from '../../src/model/capabilities';
import { getCard } from '../fixtures';
import { act, advanceTo, answer, find, pass, reject, scenario, tweak } from '../m5/helpers';
import { activate, cast, resolveTop, target } from '../m5/cr-examples/helpers';
import { declareAttackers, lifeOf, passUntil, toDeclareAttackers } from '../m4/helpers';

const card = (name: string, type: string, text: string, cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [] } as OracleCard);
const ctl = (s: GameState, id: ObjectId) => s.objects[id]!.controller;
const mountains = (n: number) => Array(n).fill('Mountain') as string[];
const islands = (n: number) => Array(n).fill('Island') as string[];

describe('MX2: the capabilities', () => {
  it('feature:control.layered and op:exchange.control are advertised; a layer-2 modification still names the feature (model/cap-walk.ts)', () => {
    expect(ENGINE_CAPABILITIES.has('feature:control.layered')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:exchange.control')).toBe(true);
    const mod = { kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 2, controller: { ref: 'you' } }] }] };
    expect(capabilitiesOf(mod as never)).toContain('feature:control.layered');
    for (const n of ['Act of Treason', 'Threaten', 'Control Magic', 'Switcheroo', 'Oko, Thief of Crowns']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
  });
});

describe('CR 613.1b, 108.4: Act of Treason (gain control until end of turn, untap, haste)', () => {
  const board = (): GameState => scenario(['Act of Treason', 'Hill Giant', 'Mountain'], {
    p1: { hand: ['Act of Treason'], battlefield: mountains(3) }, p2: { battlefield: [{ name: 'Hill Giant', tapped: true }] },
  });

  it('the new controller attacks with it; at the cleanup step it returns to its owner (CR 514.2, 611.2a)', () => {
    let s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = resolveTop(cast(s, 'Act of Treason', [target(giant)]));
    expect(ctl(s, giant)).toBe('p1');
    expect(s.objects[giant]!.baseController).toBe('p2');
    expect(getChars(s, giant).controller).toBe('p1');
    expect(s.objects[giant]!.tapped).toBe(false);
    expect(s.log.some((l) => /Alice now controls Hill Giant/.test(l.text) && l.rules?.includes('CR 613.1b'))).toBe(true);
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[giant]]); // CR 508.1a: a creature its controller controls; haste (CR 702.10b) answers CR 302.6
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(lifeOf(s, 'p2')).toBe(17);
    s = advanceTo(s, 2, 'upkeep');
    expect(ctl(s, giant)).toBe('p2');
    expect(s.objects[giant]!.baseController).toBeUndefined();
    expect(getChars(s, giant).controller).toBe('p2');
  });

  it('the CR 613.6 example: the effect applies in layer 2 and layer 6 to the same object (control, then haste)', () => {
    let s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = resolveTop(cast(s, 'Act of Treason', [target(giant)]));
    expect(getChars(s, giant).keywords.some((k) => k.keyword === 'haste')).toBe(true);
    expect(ctl(s, giant)).toBe('p1');
  });
});

describe('CR 302.6, 502.3: Control Magic (a static control effect)', () => {
  const board = (): GameState => scenario(['Control Magic', 'Hill Giant', 'Grizzly Bears', 'Island', 'Disenchant', 'Plains'], {
    p1: { hand: ['Control Magic'], battlefield: [...islands(4), 'Grizzly Bears'] }, p2: { hand: ['Disenchant'], battlefield: ['Hill Giant', 'Plains', 'Plains'] },
  });

  it('it can\'t attack the turn control changed; its new controller untaps it, not its owner; it attacks on the next turn', () => {
    let s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = resolveTop(cast(s, 'Control Magic', [target(giant)]));
    expect(ctl(s, giant)).toBe('p1');
    expect(s.objects[giant]!.controlledSinceTurn).toBe(1);
    s = toDeclareAttackers(s);
    const d = s.pending!;
    const r = reject(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: giant, defender: 'p2' }] } });
    expect(r.rules).toContain('CR 302.6');
    s = declareAttackers(s, [[bears]]);
    s = tweak(s, (t) => { t.objects[giant]!.tapped = true; });
    s = advanceTo(s, 2, 'main1');
    expect(s.objects[giant]!.tapped).toBe(true); // CR 502.3: the active player untaps the permanents HE controls
    expect(legalActions(s, 'p2').some((a) => a.kind === 'activate' && a.object === giant)).toBe(false);
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[giant]!.tapped).toBe(false);
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[giant]]);
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(lifeOf(s, 'p2')).toBe(20 - 2 - 3);
  });

  it('when the Aura leaves, the creature returns to its owner at once (CR 611.3a, 613.1b)', () => {
    let s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = resolveTop(cast(s, 'Control Magic', [target(giant)]));
    const magic = find(s, 'Control Magic', 'battlefield');
    s = pass(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Disenchant', 'hand', 'p2') });
    while (s.pending?.kind === 'chooseTargets' || s.pending?.kind === 'payCost') s = answer(s, s.pending.kind === 'payCost' ? { kind: 'payCost', auto: true } : target(magic));
    s = resolveTop(s);
    expect(ctl(s, giant)).toBe('p2');
    expect(s.objects[giant]!.baseController).toBeUndefined();
    expect(s.objects[giant]!.controlledSinceTurn).toBe(1);
  });
});

describe('CR 506.4: a creature whose controller changes is removed from combat', () => {
  const SEIZE = card('Test Seize', 'Instant', 'Gain control of target creature until end of turn.');

  it('Hill Giant attacks p1; p1 takes it during combat: it deals no damage, and it returns at the end of the turn', () => {
    expect(SEIZE.automation.level).toBe('full');
    let s = scenario(['Hill Giant'], { p1: { hand: ['Test Seize'] }, p2: { battlefield: ['Hill Giant'] }, defs: [SEIZE] });
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = advanceTo(s, 2, 'main1');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[giant]]);
    s = pass(s); // p2 passes in the declare attackers step: p1 has priority
    s = resolveTop(cast(s, 'Test Seize', [target(giant)], 'p1'));
    expect(ctl(s, giant)).toBe('p1');
    expect(s.combat?.attackers.some((a) => a.id === giant) ?? false).toBe(false);
    expect(s.log.some((l) => /removed from combat: its controller changed/.test(l.text))).toBe(true);
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(lifeOf(s, 'p1')).toBe(20);
    s = advanceTo(s, 3, 'upkeep');
    expect(ctl(s, giant)).toBe('p2');
  });
});

describe('CR 701.12a-b: exchange of control', () => {
  const board = (more: { p1?: string[]; p2?: string[] } = {}): GameState => scenario(['Switcheroo', 'Grizzly Bears', 'Hill Giant', 'Island', 'Lightning Bolt', 'Mountain'], {
    p1: { hand: ['Switcheroo', 'Lightning Bolt'], battlefield: [...islands(5), 'Mountain', 'Grizzly Bears', ...(more.p1 ?? [])] }, p2: { battlefield: ['Hill Giant', ...(more.p2 ?? [])] },
  });

  it('Switcheroo: each player gains control of the creature the other controlled; the exchange has no end', () => {
    let s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = resolveTop(cast(s, 'Switcheroo', [target(bears, giant)]));
    expect([ctl(s, bears), ctl(s, giant)]).toEqual(['p2', 'p1']);
    expect([s.objects[bears]!.controlledSinceTurn, s.objects[giant]!.controlledSinceTurn]).toEqual([1, 1]);
    expect(s.log.some((l) => /exchange control of Grizzly Bears and Hill Giant/.test(l.text) && l.rules?.includes('CR 701.12b'))).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect([ctl(s, bears), ctl(s, giant)]).toEqual(['p2', 'p1']);
  });

  it('CR 701.12b: two permanents of the same controller: nothing happens', () => {
    let s = board({ p1: ['Hill Giant'] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const mine = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && s.defs[s.objects[id]!.defId]!.name === 'Hill Giant')!;
    s = resolveTop(cast(s, 'Switcheroo', [target(bears, mine)]));
    expect([ctl(s, bears), ctl(s, mine)]).toEqual(['p1', 'p1']);
    expect(s.continuousEffects).toHaveLength(0);
    expect(s.log.some((l) => /Control is not exchanged: Alice controls both/.test(l.text))).toBe(true);
  });

  it('CR 701.12a: one of the two is gone (Lightning Bolt in response): no part of the exchange happens', () => {
    let s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = cast(s, 'Switcheroo', [target(bears, giant)]);
    s = resolveTop(cast(s, 'Lightning Bolt', [target(bears)]));
    s = resolveTop(s);
    expect(ctl(s, giant)).toBe('p2');
    expect(s.continuousEffects).toHaveLength(0);
  });

  it('Oko, Thief of Crowns -5: exchange control of an artifact or creature you control and a creature an opponent controls with power 3 or less', () => {
    let s = scenario(['Oko, Thief of Crowns', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: [{ name: 'Oko, Thief of Crowns', counters: { loyalty: 6 } }, 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const oko = find(s, 'Oko, Thief of Crowns', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = resolveTop(activate(s, oko, [target(bears), target(giant)], /: -5:/));
    expect([ctl(s, bears), ctl(s, giant)]).toEqual(['p2', 'p1']);
    expect(s.objects[oko]!.counters.loyalty).toBe(1);
  });
});
