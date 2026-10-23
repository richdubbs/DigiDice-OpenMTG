/**
 * WP30 (W1 follow-up b): the forms of `ObjectFilter` that read a reference or a quantity (`controller.ref`, `owner.ref`, `attacking.defender`, `cmp.quantity`,
 * `is`, `sharesWith`, `targets`) work in EVERY position a filter is read, through the environment of rules/filter-env.ts, and are therefore advertised
 * (design 5.2). Each position has a case here: the targets a spell may choose (CR 601.2c, 115.1) with the X it announced (CR 107.3a), the CR 608.2b re-check,
 * conditions read while announcing, cost parts (CR 601.2h), the enchant restriction (CR 303.4), mana spending restrictions (CR 106.6), trigger patterns and
 * trigger conditions (CR 603.2, 603.4).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, Condition, CostPart, GameState, KeywordAbilityDef, ObjectFilter, Quantity, TargetSpec } from '../../../src/index';
import { announceCond } from '../../../src/actions/announce-cond';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { auraCanEnchantObject } from '../../../src/rules/attachment';
import { charsOfObject } from '../../../src/rules/characteristics';
import { toPlanPart } from '../../../src/rules/cost';
import { partCandidates } from '../../../src/rules/cost-pick';
import { findObjects, matchesFilter, NEEDS_ENV, SUPPORTED_FILTER_FIELDS } from '../../../src/rules/filter';
import { filterCtxOutside, fixX, relaxUnannouncedX } from '../../../src/rules/filter-env';
import { spendAllows } from '../../../src/rules/sources';
import { isLegalTarget, recheckTargets, targetOptions } from '../../../src/rules/targets';
import { objectMatches } from '../../../src/triggers/filters';
import { localCondition } from '../../../src/triggers/cond';
import { EngineBug } from '../../../src/core/errors';
import { answer, find, legal, reject, scenario } from '../helpers';
import { gameOf } from '../triggers/helpers';
import { castCard, drive, objectTarget, playerTarget, spec, spell } from '../announce/support';

const X: Quantity = { q: 'X' };
const powerOfSelf: Quantity = { q: 'stat', stat: 'power', of: { ref: 'self' } };

/** p1: four Mountains and Grizzly Bears (2/2, mana value 2); p2: Hill Giant (3/3, mana value 4). */
const board = (hand: string[] = [], defs: ReturnType<typeof spell>[] = []): GameState =>
  scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], {
    p1: { hand, battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Grizzly Bears'] },
    p2: { battlefield: ['Hill Giant'] },
    defs,
  });
const bears = (s: GameState) => find(s, 'Grizzly Bears', 'battlefield');
const giant = (s: GameState) => find(s, 'Hill Giant', 'battlefield');

describe('design 5.2: the environment forms are capabilities now', () => {
  it('every form that needs an environment is advertised, because every call site passes one', () => {
    for (const n of NEEDS_ENV) {
      expect(SUPPORTED_FILTER_FIELDS.has(n), n).toBe(true);
      expect(ENGINE_CAPABILITIES.has(`filter:${n}`), n).toBe(true);
    }
  });
});

describe('CR 601.2c, 107.3a: a target filter that compares with X reads the announced X', () => {
  // "Destroy target creature with mana value X or less."
  const xKill = spell('Test X Kill', '{X}{R}', [spec({ filter: { types: ['Creature'], manaValue: { op: '<=', value: X } }, text: 'target creature with mana value X or less' })]);

  it('before X is announced the spell is castable (some X allows a target); the announcement offers exactly what the announced X allows', () => {
    let s = board(['Test X Kill'], [xKill]);
    expect(legal(s, 'p1', 'cast')).toHaveLength(1); // the check is made before X exists: it does not refuse what X = 2 or 3 would allow
    s = castCard(s, 'Test X Kill');
    expect(s.pending).toMatchObject({ kind: 'chooseNumber' });
    const at2 = answer(s, { kind: 'chooseNumber', n: 2 });
    expect(at2.pending).toMatchObject({ kind: 'chooseTargets', objects: [bears(at2)] }); // mana value 2 <= 2; Hill Giant's 4 is not
    const at3 = answer(s, { kind: 'chooseNumber', n: 3 });
    expect(at3.pending).toMatchObject({ kind: 'chooseTargets', objects: [bears(at3)] });
    // With X = 1 nothing has mana value 1 or less: the answer is refused and the decision stays open (CR 601.2c, never half-applied).
    expect(reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseNumber', n: 1 } }).rules).toContain('CR 601.2c');
  });

  it('CR 608.2b: the re-check on resolution reads the X stored on the stack object', () => {
    let s = board(['Test X Kill'], [xKill]);
    s = castCard(s, 'Test X Kill');
    s = drive(answer(s, { kind: 'chooseNumber', n: 2 }), [{ kind: 'chooseTargets', targets: [objectTarget(bears(s))] }]);
    const stackId = s.zones.stack[0]!;
    expect(s.objects[stackId]!.stack!.x).toBe(2);
    const specs = [xKill.faces[0]!.abilities.find((a): a is Extract<AbilityDef, { kind: 'spell' }> => a.kind === 'spell')!.effect.targets[0]!];
    expect(recheckTargets(s, specs, [[objectTarget(bears(s))]], 'p1', stackId, stackId)).toEqual({ legal: 1, total: 1 });
    // The same target with X = 1 on the stack is illegal (its mana value is 2).
    const lowered = structuredClone(s);
    lowered.objects[stackId]!.stack!.x = 1;
    expect(recheckTargets(lowered, specs, [[objectTarget(bears(s))]], 'p1', stackId, stackId)).toEqual({ legal: 0, total: 1 });
  });
});

describe('CR 601.2c, 115.1: a target filter that names another target or reads the board', () => {
  // "Choose target player. Destroy target creature that player controls."
  const thatPlayer = spell('Test That Player', '{R}', [
    { id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' },
    spec({ id: 't1', filter: { types: ['Creature'], controller: { ref: 'target', id: 't0' } }, text: 'target creature that player controls' }),
  ]);

  it('controller.ref: the creature must be controlled by the player chosen for the earlier target', () => {
    let s = board(['Test That Player'], [thatPlayer]);
    s = castCard(s, 'Test That Player');
    const p2 = answer(s, { kind: 'chooseTargets', targets: [playerTarget('p2')] });
    expect(p2.pending).toMatchObject({ kind: 'chooseTargets', objects: [giant(p2)] });
    const p1 = answer(s, { kind: 'chooseTargets', targets: [playerTarget('p1')] });
    expect(p1.pending).toMatchObject({ kind: 'chooseTargets', objects: [bears(p1)] });
  });

  const optionsFor = (s: GameState, filter: ObjectFilter, controller = 'p1', source?: string, kind: TargetSpec['kind'] = 'object'): string[] =>
    targetOptions(s, { id: 't0', kind, filter, min: 1, max: 1, text: 'target' }, controller, source).objects;

  it('cmp.quantity: "target creature with power greater than this creature\'s power" (the source is Grizzly Bears)', () => {
    const s = board();
    expect(optionsFor(s, { types: ['Creature'], power: { op: '>', value: powerOfSelf } }, 'p1', bears(s))).toEqual([giant(s)]);
  });

  it('is, sharesWith, owner.ref', () => {
    const s = board();
    expect(optionsFor(s, { types: ['Creature'], not: { is: { ref: 'self' } } }, 'p1', bears(s))).toEqual([giant(s)]);
    expect(optionsFor(s, { types: ['Creature'], sharesWith: { with: { ref: 'self' }, quality: 'color' } }, 'p1', bears(s))).toEqual([bears(s)]); // green shares with green only
    expect(optionsFor(s, { types: ['Creature'], owner: { ref: 'controllerOf', object: { ref: 'self' } } }, 'p2', bears(s))).toEqual([bears(s)]);
  });

  it('targets: "target spell that targets you" sees what the spell on the stack targets', () => {
    const ping = spell('Test Ping', '{R}', [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]);
    let s = board(['Test Ping'], [ping]);
    s = drive(castCard(s, 'Test Ping'), [{ kind: 'chooseTargets', targets: [playerTarget('p2')] }]);
    const pingId = s.zones.stack[0]!;
    expect(optionsFor(s, { targets: { ref: 'you' } }, 'p2', giant(s), 'spell')).toEqual([pingId]);
    expect(optionsFor(s, { targets: { ref: 'you' } }, 'p1', bears(s), 'spell')).toEqual([]);
    expect(isLegalTarget(s, { id: 't0', kind: 'spell', filter: { targets: { ref: 'you' } }, min: 1, max: 1, text: 'target spell that targets you' }, objectTarget(pingId), 'p2', giant(s), giant(s))).toBe(true);
  });

  it('CR 603.2: a triggered ability\'s filter reads the event it triggered on ("target creature that player controls", the player of the event)', () => {
    const s = board();
    const ctx = filterCtxOutside(s, { controller: 'p1', sourceId: bears(s), event: { ev: 'damage', roles: { player: { players: ['p2'] } }, before: {} } });
    expect(findObjects(s, { types: ['Creature'], controller: { ref: 'event', role: 'player' } }, ctx).map((o) => o.id)).toEqual([giant(s)]);
  });

  it('what cannot be determined outside a resolution never matches: a name bound only while an effect resolves, a choice no check may ask', () => {
    const s = board();
    const ctx = filterCtxOutside(s, { controller: 'p1', sourceId: bears(s) });
    expect(findObjects(s, { types: ['Creature'], is: { ref: 'bound', name: 'it' } }, ctx)).toEqual([]);
    expect(findObjects(s, { types: ['Creature'], power: { op: '>=', value: { q: 'ask', text: 'How much?' } as unknown as Quantity } }, ctx)).toEqual([]);
    expect(s.counters.decision).toBe(board().counters.decision); // nothing was asked: the state is unchanged
  });
});

describe('CR 601.2b-c: before X is announced, a comparison with X is relaxed for the legality check and unreadable in a condition', () => {
  it('relaxUnannouncedX drops what reads X, turns it into "nothing" under a not, and leaves other filters alone', () => {
    const f: ObjectFilter = { types: ['Creature'], manaValue: { op: '<=', value: X }, not: { power: { op: '>', value: X } }, anyOf: [{ colors: ['G'] }, { toughness: { op: '==', value: X } }] };
    expect(relaxUnannouncedX(f)).toEqual({ types: ['Creature'], not: { anyOf: [] }, anyOf: [{ colors: ['G'] }, {}] });
    const plain: ObjectFilter = { types: ['Creature'], power: { op: '<=', value: 2 } };
    expect(relaxUnannouncedX(plain)).toBe(plain);
  });

  it('a condition read while announcing whose filter compares with an X not yet announced is undetermined (never false); with X it is read', () => {
    const s = board();
    const cond: Condition = { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], manaValue: { op: '<=', value: X } } } };
    const env = { s, player: 'p1', sourceId: bears(s), costsPaid: {} };
    expect(announceCond(env, cond)).toBeUndefined();
    expect(announceCond({ ...env, x: 1 }, cond)).toBe(false);
    expect(announceCond({ ...env, x: 2 }, cond)).toBe(true);
    expect(announceCond(env, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], power: { op: '>', value: powerOfSelf } } } })).toBe(true); // Hill Giant 3 > 2
    expect(announceCond(env, { cond: 'matches', object: { ref: 'self' }, filter: { sharesWith: { with: { ref: 'self' }, quality: 'color' } } })).toBe(true);
  });
});

describe('CR 601.2f-h: cost parts', () => {
  it('the X inside a cost part\'s filter is the announced X (the total cost is locked in, CR 601.2f)', () => {
    const part: CostPart = { kind: 'sacrifice', filter: { types: ['Creature'], manaValue: { op: '<=', value: X } }, count: 1 };
    const plan = toPlanPart(part, 2);
    expect(plan).toMatchObject({ kind: 'sacrifice', filter: { manaValue: { op: '<=', value: 2 } } });
    expect(fixX({ types: ['Creature'] }, 3)).toEqual({ types: ['Creature'] });
    const s = board();
    expect(partCandidates(s, 'p1', null, plan)).toEqual([bears(s)]);
    expect(partCandidates(s, 'p1', null, toPlanPart(part, 1))).toEqual([]);
  });

  it('a reference in a cost part\'s filter: "sacrifice a creature that shares a color with this permanent"', () => {
    const s = board();
    const plan = toPlanPart({ kind: 'sacrifice', filter: { types: ['Creature'], sharesWith: { with: { ref: 'self' }, quality: 'color' } }, count: 1 }, 0);
    expect(partCandidates(s, 'p1', bears(s), plan)).toEqual([bears(s)]);
    const mountain = find(s, 'Mountain', 'battlefield');
    expect(partCandidates(s, 'p1', mountain, plan)).toEqual([]); // a colorless source shares no color
  });
});

describe('CR 303.4, 106.6: the enchant restriction and mana spending restrictions', () => {
  it('enchant: "Enchant creature an opponent of its controller controls" (controller.ref)', () => {
    const s = board();
    const aura = s.objects[find(s, 'Mountain', 'battlefield')]!; // only the controller and the identity of the Aura are read
    const kw: KeywordAbilityDef = { kind: 'keyword', text: 'Enchant creature', keyword: 'enchant', filter: { types: ['Creature'], controller: { ref: 'anOpponent' } } };
    const ac = charsOfObject(s, aura);
    expect(auraCanEnchantObject(s, aura, ac, kw, s.objects[giant(s)]!)).toBe(true);
    expect(auraCanEnchantObject(s, aura, ac, kw, s.objects[bears(s)]!)).toBe(false);
  });

  it('spending: a restriction whose filter names a player by a reference that needs the environment ("abilities of permanents the controller of this land controls")', () => {
    const s = board();
    const mountain = find(s, 'Mountain', 'battlefield');
    const f = { abilities: { controller: { ref: 'controllerOf' as const, object: { ref: 'self' as const } } } };
    expect(spendAllows(s, 'p1', { kind: 'ability', id: bears(s) })(f, mountain)).toBe(true); // p1's Mountain, p1's Bears
    expect(spendAllows(s, 'p1', { kind: 'ability', id: giant(s) })(f, mountain)).toBe(false); // p2's Hill Giant
  });
});

describe('CR 106.6: "this" in a spending restriction is the source of the mana, not the spell it pays for', () => {
  it('self: "only on spells that share a color with this permanent" reads the mana\'s source', () => {
    const s = board();
    const f = { spells: { sharesWith: { with: { ref: 'self' as const }, quality: 'color' as const } } };
    const allows = spendAllows(s, 'p1', { kind: 'spell', id: bears(s) }); // a green object being paid for
    expect(allows(f, bears(s))).toBe(true); // green mana source
    expect(allows(f, find(s, 'Mountain', 'battlefield'))).toBe(false); // a colorless land shares no color with it
    expect(allows(f, undefined)).toBe(false); // an unknown source: "this" can't be read
  });

  it('chosen: "a creature spell of the chosen type" reads the type chosen for the land (Cavern of Souls, Unclaimed Territory)', () => {
    const s = board();
    const mountain = find(s, 'Mountain', 'battlefield');
    s.objects[mountain]!.links = { type: { values: ['Bear'] } };
    const f = { spells: { types: ['Creature' as const], chosen: { link: 'type', quality: 'creatureType' as const } } };
    expect(spendAllows(s, 'p1', { kind: 'spell', id: bears(s) })(f, mountain)).toBe(true);
    expect(spendAllows(s, 'p1', { kind: 'spell', id: giant(s) })(f, mountain)).toBe(false);
  });
});

describe('CR 603.2, 603.4: trigger patterns and trigger conditions', () => {
  it('a pattern filter with a quantity, a player reference or a link is read (it used to never match)', () => {
    const s = board();
    const cx = { source: bears(s), controller: 'p1' };
    const g = s.objects[giant(s)]!;
    expect(objectMatches(s, { types: ['Creature'], power: { op: '>', value: powerOfSelf } }, g, [g.id], cx)).toBe(true); // "a creature with greater power"
    expect(objectMatches(s, { types: ['Creature'], controller: { ref: 'anOpponent' } }, g, [g.id], cx)).toBe(true);
    expect(objectMatches(s, { types: ['Creature'], controller: { ref: 'anOpponent' } }, s.objects[bears(s)]!, [bears(s)], cx)).toBe(false);
    // CR 607.2d: "a creature of the chosen type" reads the link of the source (an unchosen link matches nothing, CR 607.5a).
    expect(objectMatches(s, { chosen: { link: 'type', quality: 'creatureType' } }, g, [g.id], cx)).toBe(false);
    const linked = structuredClone(s);
    linked.objects[bears(s)]!.links = { type: { values: ['Giant'] } };
    expect(objectMatches(linked, { chosen: { link: 'type', quality: 'creatureType' } }, linked.objects[giant(s)]!, [giant(s)], cx)).toBe(true);
  });

  it('a condition read by the trigger module itself ("each" with a filter that reads the source) is evaluated in the same environment', () => {
    const s = board();
    const g = gameOf(s);
    const env = { source: { id: bears(s), zone: 'battlefield' as const }, controller: 'p1', event: null };
    expect(localCondition(g, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], power: { op: '>', value: powerOfSelf } } } }, env)).toBe(true);
    expect(localCondition(g, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], power: { op: '>', value: { q: 'stat', stat: 'power', of: { ref: 'event', role: 'subject' } } } } } }, env)).toBe(false); // no event: nothing
  });
});

describe('CR 508.5, 506.3: attacking.defender outside a resolution', () => {
  /** Grizzly Bears attack p2. */
  const inCombat = (): GameState => {
    const s = board();
    s.combat = {
      number: 1, attacked: true, damageSteps: 0, extraDamageStep: false, firstStrikers: [],
      attackers: [{ id: bears(s), defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }], blockers: [],
    };
    return s;
  };
  const attackingThatPlayer: TargetSpec = { id: 't1', kind: 'object', filter: { types: ['Creature'], attacking: { defender: { ref: 'target', id: 't0' } } }, min: 1, max: 1, text: 'target creature attacking that player' };

  it('a target: "target creature attacking that player" reads the player chosen for the earlier target (CR 601.2c)', () => {
    const s = inCombat();
    expect(targetOptions(s, attackingThatPlayer, 'p2', giant(s), undefined, { chosen: new Map([['t0', [playerTarget('p2')]]]) }).objects).toEqual([bears(s)]);
    expect(targetOptions(s, attackingThatPlayer, 'p2', giant(s), undefined, { chosen: new Map([['t0', [playerTarget('p1')]]]) }).objects).toEqual([]);
  });

  it('a condition read while announcing: "if a creature is attacking an opponent of yours"', () => {
    const s = inCombat();
    const cond: Condition = { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], attacking: { defender: { ref: 'anOpponent' } } } } };
    expect(announceCond({ s, player: 'p1', sourceId: bears(s), costsPaid: {} }, cond)).toBe(true);
    expect(announceCond({ s, player: 'p2', sourceId: giant(s), costsPaid: {} }, cond)).toBe(false);
  });

  it('a trigger pattern: "whenever a creature attacking the player of the event ..." reads the event (CR 603.2)', () => {
    const s = inCombat();
    const ctx = filterCtxOutside(s, { controller: 'p2', sourceId: giant(s), event: { ev: 'attacks', roles: { player: { players: ['p2'] } }, before: {} } });
    expect(findObjects(s, { types: ['Creature'], attacking: { defender: { ref: 'event', role: 'player' } } }, ctx).map((o) => o.id)).toEqual([bears(s)]);
  });
});

describe('WP30 review: only what is undeterminable outside a resolution is "no match"; an engine bug propagates', () => {
  it('a variable set by a `let` and a bound name do not exist outside a resolution: the filter does not match', () => {
    const s = board();
    const ctx = filterCtxOutside(s, { controller: 'p1', sourceId: bears(s) });
    expect(findObjects(s, { types: ['Creature'], power: { op: '>=', value: { q: 'var', name: 'n' } as Quantity } }, ctx)).toEqual([]);
    expect(findObjects(s, { types: ['Creature'], sharesWith: { with: { ref: 'bound', name: 'it' }, quality: 'color' } }, ctx)).toEqual([]);
  });

  it('a quantity with no evaluator is an EngineBug, never silently "does not match"', () => {
    const s = board();
    const ctx = filterCtxOutside(s, { controller: 'p1', sourceId: bears(s) });
    expect(() => findObjects(s, { types: ['Creature'], power: { op: '>=', value: { q: 'noSuchQuantity' } as unknown as Quantity } }, ctx)).toThrow(EngineBug);
  });
});

describe('the environment is read-only and costs nothing until a filter needs it', () => {
  it('reading filters through it never changes the state', () => {
    const s = board();
    const before = JSON.stringify(s);
    const ctx = filterCtxOutside(s, { controller: 'p1', sourceId: bears(s) });
    findObjects(s, { types: ['Creature'], power: { op: '>', value: powerOfSelf }, controller: { ref: 'anOpponent' } }, ctx);
    matchesFilter(s, s.objects[giant(s)]!, { is: { ref: 'self' } }, ctx);
    expect(JSON.stringify(s)).toBe(before);
  });
});
