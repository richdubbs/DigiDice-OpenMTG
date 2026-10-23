/**
 * WP7: announcing targets (CR 601.2c-d, 115): ids across modes, distinctFrom, groupLimit, onlyIf, chooser, PlayerRef, anyTarget, stackObject, the division and the
 * becameTarget event. Every scenario uses synthetic spells with hand-built abilities and real fixture creatures.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameState, type ModeSpec } from '../../../src/index';
import { effectivePrograms } from '../../../src/actions/announce';
import { isLegalTarget, targetOptions, targetsById } from '../../../src/rules/targets';
import { act, activated, answer, find, legal, reject, scenario, synth, withStatics } from '../helpers';
import { additionalCost, castCard, drive, mana, objectTarget, playerTarget, spec, spell, staticAbility } from './support';

const board = (hand: string[], defs: ReturnType<typeof spell>[], extra: { p1?: string[]; p2?: string[] } = {}): GameState =>
  scenario(['Mountain', 'Grizzly Bears', 'Hill Giant', 'Serra Angel'], {
    p1: { hand, battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Grizzly Bears', ...(extra.p1 ?? [])] },
    p2: { battlefield: ['Hill Giant', ...(extra.p2 ?? [])] },
    defs,
  });

const bears = (s: GameState) => find(s, 'Grizzly Bears', 'battlefield');
const giant = (s: GameState) => find(s, 'Hill Giant', 'battlefield');

describe('CR 115.3, 601.2c: distinctFrom ("another target") and the same object for two instances of "target"', () => {
  const two = spell('Test Two Targets', '{R}', [spec({ id: 't0' }), spec({ id: 't1', text: 'another target creature', distinctFrom: ['t0'] })]);
  const free = spell('Test Free Targets', '{R}', [spec({ id: 't0' }), spec({ id: 't1', text: 'target creature' })]);

  it('the second spec cannot offer what the first chose', () => {
    let s = board(['Test Two Targets'], [two]);
    s = castCard(s, 'Test Two Targets');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'another target creature', objects: [giant(s)] });
  });

  it('without distinctFrom the same creature may be chosen for both instances of "target" (CR 115.3)', () => {
    let s = board(['Test Free Targets'], [free]);
    s = castCard(s, 'Test Free Targets');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', objects: expect.arrayContaining([bears(s), giant(s)]) });
  });

  it('a spell whose "another target" has nothing left to choose is not castable at all (the matching is checked up front)', () => {
    const s = scenario(['Mountain', 'Grizzly Bears'], { p1: { hand: ['Test Two Targets'], battlefield: ['Mountain', 'Grizzly Bears'] }, defs: [two] });
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Two Targets', 'hand') }).message).toContain('needs a target');
  });

  it('feasibility looks past a first choice: t0 may be either creature but t1 only the Giant, so t0 must not take it (CR 601.2c)', () => {
    const picky = spell('Test Picky', '{R}', [spec({ id: 't0' }), spec({ id: 't1', filter: { types: ['Creature'], power: { op: '>=', value: 3 } }, distinctFrom: ['t0'] })]);
    let s = board(['Test Picky'], [picky]);
    expect(legal(s, 'p1', 'cast')).toHaveLength(1);
    s = castCard(s, 'Test Picky');
    // Choosing the Giant for t0 would leave nothing for t1, so it is not offered at all (CR 601.2c) and naming it anyway is refused with the decision still open.
    expect((s.pending as unknown as { objects: string[] }).objects).toEqual([bears(s)]);
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [objectTarget(giant(s))] } });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', objects: [giant(s)] });
  });
});

describe('CR 115.1: groupLimit ("any number of target creatures with total power 3 or less")', () => {
  const limit = spell('Test Group', '{R}', [spec({ min: 0, max: 'any', text: 'any number of target creatures with total power 3 or less', groupLimit: { stat: 'power', cmp: { op: '<=', value: 3 } } })]);

  it('a set within the limit is accepted, a set over it is rejected and the decision stays open', () => {
    let s = board(['Test Group'], [limit], { p1: ['Serra Angel'] }); // bears 2, giant 3, angel 4
    s = castCard(s, 'Test Group');
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0 });
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [objectTarget(bears(s)), objectTarget(giant(s))] } });
    expect(err.message).toContain('limit');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(giant(s))] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack!.targets[0]).toEqual([objectTarget(giant(s))]);
  });

  it('a minimum that already breaks the limit makes the spell uncastable', () => {
    const must = spell('Test Must', '{R}', [spec({ min: 2, max: 2, text: 'two target creatures with total power 3 or less', groupLimit: { stat: 'power', cmp: { op: '<=', value: 3 } } })]);
    expect(legal(board(['Test Must'], [must]), 'p1', 'cast')).toEqual([]); // bears 2 + giant 3 > 3
    const small = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Must'], battlefield: ['Mountain', 'Grizzly Bears'] }, defs: [must] });
    expect(legal(small, 'p1', 'cast')).toEqual([]); // only one creature at all
  });
});

describe('CR 601.2c, 700.2c: onlyIf (a target required only if the spell was kicked)', () => {
  const kicker = staticAbility('Kicker {1}', [additionalCost('kicker', { mana: mana('{1}') }, { optional: true })]);
  const conditional = spell('Test Kicked Target', '{R}', [
    spec({ id: 't0', text: 'target creature' }),
    spec({ id: 't1', text: 'target creature (kicked)', onlyIf: { cond: 'wasCast', kicked: true } }),
  ], { abilities: [kicker] });

  it('unkicked: only the first target is chosen; the second spec has an empty list', () => {
    let s = board(['Test Kicked Target'], [conditional]);
    s = castCard(s, 'Test Kicked Target');
    expect(s.pending).toMatchObject({ kind: 'yesNo' });
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target creature' });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(giant(s))] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack!.targets).toEqual([[objectTarget(giant(s))], []]);
  });

  it('kicked: the second target is asked too', () => {
    let s = board(['Test Kicked Target'], [conditional]);
    s = castCard(s, 'Test Kicked Target');
    s = answer(s, { kind: 'yesNo', yes: true });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(giant(s))] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target creature (kicked)' });
  });

  it('kicker is not offered when the kicked spell would need a target that does not exist', () => {
    const lonely = spell('Test Lonely', '{R}', [spec({ id: 't0', filter: { types: ['Creature'], controller: 'opponent' } }), spec({ id: 't1', filter: { types: ['Planeswalker'] }, onlyIf: { cond: 'wasCast', kicked: true } })], { abilities: [kicker] });
    let s = board(['Test Lonely'], [lonely]);
    s = castCard(s, 'Test Lonely');
    expect(s.pending).toMatchObject({ kind: 'chooseTargets' }); // no kicker question
  });
});

describe('CR 601.2c, 601.7: chooser (another player chooses) and a PlayerRef as the player filter', () => {
  it('the opponent chooses the target; the decision is theirs and cannot be cancelled', () => {
    const edict = spell('Test Opponent Picks', '{R}', [spec({ filter: { types: ['Creature'], controller: 'you' }, text: 'target creature of an opponent\'s choice', chooser: { ref: 'anOpponent' } })]);
    let s = board(['Test Opponent Picks'], [edict]);
    s = castCard(s, 'Test Opponent Picks');
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p2', cancellable: false });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    expect(s.pending?.kind).toBe('payCost');
  });

  it('"target player who controls it": the player filter is a reference to a target already chosen', () => {
    const owner = spell('Test Controller', '{R}', [spec({ id: 't0' }), spec({ id: 't1', kind: 'player', filter: undefined, text: 'its controller', players: { who: { ref: 'controllerOf', object: { ref: 'target', id: 't0' } } } })]);
    let s = board(['Test Controller'], [owner]);
    s = castCard(s, 'Test Controller');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(giant(s))] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', players: ['p2'] });
  });
});

describe('CR 115.4, 115.5: anyTarget and stackObject', () => {
  const bolt = spell('Test Any', '{R}', [spec({ kind: 'anyTarget', filter: undefined, text: 'any target' })]);

  it('any target: creatures and players; a noncreature artifact is not one', () => {
    const rock = spell('Test Rock', '{1}', [], { type: 'Artifact' });
    const s = scenario(['Mountain', 'Grizzly Bears'], { p1: { hand: ['Test Any'], battlefield: ['Mountain', 'Grizzly Bears', 'Test Rock'] }, defs: [bolt, rock] });
    const opts = targetOptions(s, spec({ kind: 'anyTarget', filter: undefined, text: 'any target' }), 'p1');
    expect(opts.objects).toEqual([find(s, 'Grizzly Bears', 'battlefield')]);
    expect(opts.players).toEqual(['p1', 'p2']);
    const narrowed = targetOptions(s, spec({ kind: 'anyTarget', filter: { controller: 'opponent' }, text: 'any target an opponent controls' }), 'p1');
    expect(narrowed.objects).toEqual([]); // the filter narrows the objects; players are not filtered by an object filter
  });

  it('stackObject: a spell or an ability; spell and ability kinds each take only their own; a spell cannot target itself', () => {
    const counterAny = spell('Test Stifle Spell', '{U}', [spec({ kind: 'stackObject', filter: undefined, text: 'target spell or ability' })]);
    const bolt2 = spell('Test Bolt', '{R}', [spec({ kind: 'player', filter: undefined, text: 'target player' })]);
    let s = scenario(['Mountain', 'Island'], { p1: { hand: ['Test Bolt', 'Test Stifle Spell'], battlefield: ['Mountain', 'Island', 'Island'] }, defs: [counterAny, bolt2] });
    s = castCard(s, 'Test Bolt');
    s = answer(s, { kind: 'chooseTargets', targets: [playerTarget('p2')] });
    s = drive(s, []);
    const boltOnStack = s.zones.stack[0]!;
    s = castCard(s, 'Test Stifle Spell');
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', objects: [boltOnStack] }); // the spell on the stack, not itself (CR 115.5)
  });
});

describe('CR 601.2d: the division of damage or counters among the targets', () => {
  const fireball = spell('Test Divide', '{R}', [spec({ kind: 'objectOrPlayer', filter: { types: ['Creature'] }, min: 1, max: 3, text: 'one, two or three targets', divide: { what: 'damage', total: 4 } })]);

  it('with several targets the caster announces a division, each target at least 1; the answer is stored per spec id', () => {
    let s = board(['Test Divide'], [fireball]);
    s = castCard(s, 'Test Divide');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s)), objectTarget(giant(s)), playerTarget('p2')] });
    expect(s.pending).toMatchObject({ kind: 'chooseDivision', what: 'damage', total: 4 });
    expect((s.pending as { targets: unknown[] }).targets).toHaveLength(3);
    const bad = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseDivision', amounts: [2, 2, 0] } });
    expect(bad.rules).toContain('CR 601.2d');
    s = answer(s, { kind: 'chooseDivision', amounts: [2, 1, 1] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack!.division).toEqual({ t0: [2, 1, 1] });
  });

  it('a single target gets all of it without a question', () => {
    let s = board(['Test Divide'], [fireball]);
    s = castCard(s, 'Test Divide');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(giant(s))] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack!.division).toEqual({ t0: [4] });
  });

  it('the number of targets is limited by the amount to divide (each target gets at least 1)', () => {
    const two = spell('Test Divide Two', '{R}', [spec({ kind: 'objectOrPlayer', min: 1, max: 3, divide: { what: 'damage', total: 2 } })]);
    let s = board(['Test Divide Two'], [two]);
    s = castCard(s, 'Test Divide Two');
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', max: 2 });
  });
});

describe('CR 603.2, 601.2i: becameTarget is emitted once per distinct target when the spell is cast', () => {
  it('the final payment answer returns the events', () => {
    const poke = spell('Test Poke Twice', '{R}', [spec({ id: 't0' }), spec({ id: 't1' })]);
    let s = board(['Test Poke Twice'], [poke]);
    s = castCard(s, 'Test Poke Twice');
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'payCost', auto: true } });
    expect(r.error).toBeUndefined();
    const events = r.events.filter((e) => e.type === 'becameTarget');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ objectId: bears(s), byController: 'p1', byStackId: r.state.zones.stack[0] });
  });
});

describe('CR 608.2b: per-target legality (what WP4 builds the resolution check on)', () => {
  it('isLegalTarget follows the spec filter, the zone and the rule hooks; targetsById names the choices by spec id', () => {
    const poke = spell('Test Poke', '{R}', [spec({ id: 'a', filter: { types: ['Creature'], controller: 'opponent' } })]);
    const s = board(['Test Poke'], [poke]);
    const sp = spec({ id: 'a', filter: { types: ['Creature'], controller: 'opponent' } });
    expect(isLegalTarget(s, sp, objectTarget(giant(s)), 'p1', bears(s), 'x')).toBe(true);
    expect(isLegalTarget(s, sp, objectTarget(bears(s)), 'p1', bears(s), 'x')).toBe(false);
    expect(isLegalTarget(s, sp, playerTarget('p2'), 'p1', bears(s), 'x')).toBe(false);
    // A "can't be the target" effect (WP16 will provide them) removes the target through isTargetable / hookpoints.
    const hexed = withStatics({ canBeTargeted: (_g, target) => (target === giant(s) ? { message: 'hexproof', rules: [] } : null) }, () => isLegalTarget(s, sp, objectTarget(giant(s)), 'p1', bears(s), 'x'));
    expect(hexed).toBe(false);
    expect([...targetsById([sp, spec({ id: 'b' })], [[objectTarget(giant(s))], []]).entries()]).toEqual([['a', [objectTarget(giant(s))]], ['b', []]]);
  });
});

describe('CR 700.2d: target ids are unique across the modes of one ability; chosen modes run in printed order', () => {
  const modal: ModeSpec = {
    min: 2, max: 2,
    options: [
      { text: 'a', program: { targets: [spec({ id: 't0', text: 'first' })], steps: [] } },
      { text: 'b', program: { targets: [spec({ id: 't1', kind: 'player', filter: undefined, text: 'second' })], steps: [] } },
      { text: 'c', program: { targets: [spec({ id: 't2', text: 'third' })], steps: [] } },
    ],
  };
  const program = { targets: [], modes: modal, steps: [] };

  it('effectivePrograms sorts the chosen modes into printed order and keeps the ability\'s own targets last', () => {
    const own = { ...program, targets: [spec({ id: 'own' })] };
    expect(effectivePrograms([own], [2, 0]).flatMap((p) => p.targets.map((t) => t.id))).toEqual(['t0', 't2', 'own']);
    expect(new Set(modal.options.flatMap((o) => o.program.targets.map((t) => t.id))).size).toBe(3);
  });

  it('casting: the targets of the chosen modes are asked in printed order whatever order the modes were named', () => {
    const charm = spell('Test Charm Two', '{R}', [], { modes: modal });
    let s = board(['Test Charm Two'], [charm]);
    s = castCard(s, 'Test Charm Two');
    s = answer(s, { kind: 'chooseOption', ids: ['2', '0'] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'first' });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(giant(s))] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'third' });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack).toMatchObject({ modes: [0, 2] });
  });
});

describe('CR 115.1, 115.2: targeting abilities on the stack', () => {
  const stifle = spell('Test Stifle', '{U}', [spec({ kind: 'ability', filter: undefined, text: 'target activated or triggered ability' })]);
  const either = spell('Test Either', '{U}', [spec({ kind: 'stackObject', filter: undefined, text: 'target spell or ability' })]);
  const onlySpells = spell('Test Only Spells', '{U}', [spec({ kind: 'spell', filter: undefined, text: 'target spell' })]);
  const gadget = synth({ name: 'Test Gadget', type: 'Artifact', abilities: [activated('Do it.', {})] });

  it('an ability is a target for "ability" and "stackObject" specs, not for "spell" specs; a spell is the reverse', () => {
    let s = scenario(['Island'], { p1: { hand: ['Test Stifle', 'Test Either', 'Test Only Spells'], battlefield: ['Island', 'Island', 'Island', 'Test Gadget'] }, defs: [stifle, either, onlySpells, gadget] });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Gadget', 'battlefield'), ability: 'p:0:0' });
    const ability = s.zones.stack[0]!;
    expect(s.objects[ability]!.kind).toBe('ability');
    const opts = (name: string) => targetOptions(s, spec({ kind: name as never, filter: undefined }), 'p1').objects;
    expect(opts('ability')).toEqual([ability]);
    expect(opts('stackObject')).toEqual([ability]);
    expect(opts('spell')).toEqual([]);
    // A spell cast in response with "ability" can target it; the spell-only card cannot be cast (no spell on the stack).
    expect(legal(s, 'p1', 'cast').map((a) => a.label).sort()).toEqual(['Cast Test Either', 'Cast Test Stifle']);
    const t = castCard(s, 'Test Stifle');
    expect(t.pending).toMatchObject({ kind: 'chooseTargets', objects: [ability] });
    // The ability filter understands its kind: a triggered-ability filter finds nothing among activated abilities.
    expect(targetOptions(s, spec({ kind: 'ability', filter: { stackKind: 'triggeredAbility' } }), 'p1').objects).toEqual([]);
    expect(targetOptions(s, spec({ kind: 'ability', filter: { stackKind: 'activatedAbility', controller: 'opponent' } }), 'p1').objects).toEqual([]);
    expect(targetOptions(s, spec({ kind: 'ability', filter: { stackKind: 'activatedAbility', controller: 'you' } }), 'p1').objects).toEqual([ability]);
  });
});
