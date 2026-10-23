/**
 * The type migration of WP0 (design 4.4): the files of milestones 3 and 4 now speak the final ability model (types/ability.ts), and everything
 * observable stays as it was. The M3/M4 suites prove the behavior; these tests pin the new SHAPES the migration introduced and the places where the old
 * data forms were mapped (cast restrictions, enters-with-counters, activation limits and zones, cost parts, target counts, filters, decisions, views).
 */
import { describe, expect, it } from 'vitest';
import {
  compileCard, enumerateAbilities, faceChars, getChars, noAbilityCompiler, viewFor, type Count, type CostPart, type Decision, type DecisionAnswer, type EffectProgram,
  type GameState, type ObjectFilter, type OracleCard, type TargetSpec,
} from '../../../src/index';
import { simpleEntersCounters, parseEntersWithCounters } from '../../../src/cards/enters-with';
import { validateAnswer } from '../../../src/core/validate';
import { castRestrictionDenial, castRestrictionOf, parseCastRestriction } from '../../../src/rules/cast-restriction';
import { partsDenial, planFromCostDef, toPlanPart } from '../../../src/rules/cost';
import { findObjects, matchesFilter, NO_ENV } from '../../../src/rules/filter';
import { auraTargetProgram } from '../../../src/rules/attachment';
import { programHasTargets, targetOptions } from '../../../src/rules/targets';
import { parseManaAbilityLine } from '../../../src/rules/mana-text';
import { act, activated, advanceTo, find, legal, scenario, synth, tweak } from '../helpers';

const board = (): GameState => scenario(['Grizzly Bears', 'Hill Giant', 'Serra Angel'], { p1: { battlefield: ['Grizzly Bears', 'Serra Angel'] }, p2: { battlefield: ['Hill Giant'] } });
const ctx = { you: 'p1' as const, env: NO_ENV };

describe('casting restrictions are `restrict` effects (design 4.4)', () => {
  it('"Cast this spell only during combat." is a static ability with one onlyIf restriction on casting, a turnOf condition and the combat steps', () => {
    const def = parseCastRestriction('Cast this spell only during combat.')!;
    expect(def).toMatchObject({ kind: 'static', zone: ['stack'], effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'onlyIf', action: 'cast' }] });
    expect(castRestrictionOf(def)).toEqual({ whose: 'any', steps: ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'] });
  });

  it('whose turn is `whose`; no steps means any step', () => {
    expect(castRestrictionOf(parseCastRestriction('Cast this spell only during your turn.')!)).toEqual({ whose: 'you' });
    expect(castRestrictionOf(parseCastRestriction('Cast this spell only during an opponent\'s upkeep.')!)).toEqual({ whose: 'opponent', steps: ['upkeep'] });
  });

  it('CR 601.3: the denial depends on the turn and the step, as before', () => {
    const s = board(); // turn 1, main1, p1 active
    const combat = parseCastRestriction('Cast this spell only during combat.')!;
    const mine = parseCastRestriction('Cast this spell only during your turn.')!;
    const theirs = parseCastRestriction('Cast this spell only during an opponent\'s turn.')!;
    expect(castRestrictionDenial(s, 'p1', combat)?.rules).toEqual(['CR 601.3', 'CR 101.2']);
    expect(castRestrictionDenial(s, 'p1', mine)).toBeNull();
    expect(castRestrictionDenial(s, 'p2', mine)).not.toBeNull();
    expect(castRestrictionDenial(s, 'p2', theirs)).toBeNull();
  });

  it('anything that is not a timing restriction is not recognized', () => {
    expect(parseCastRestriction('Cast this spell only if you control a creature.')).toBeNull();
    expect(castRestrictionOf({ kind: 'static', text: 'x', effects: [] })).toBeUndefined();
  });
});

describe('"enters with counters" is a self replacement with an `enters` body (design D9)', () => {
  it('X counters', () => {
    const def = parseEntersWithCounters('This creature enters with X +1/+1 counters on it.', 'Endless One')!;
    expect(def.effects).toEqual([{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: { q: 'X' } }] }, selfReplacement: true }]);
    expect(simpleEntersCounters(def)).toEqual({ counter: '+1/+1', count: 'X' });
  });

  it('a fixed number, also spelled out', () => {
    expect(simpleEntersCounters(parseEntersWithCounters('Hangarback Walker enters with three +1/+1 counters on it.', 'Hangarback Walker')!)).toEqual({ counter: '+1/+1', count: 3 });
  });

  it('only the simple shape is applied by the milestone 3/4 code; a body that also does something else is left alone', () => {
    const def = parseEntersWithCounters('This creature enters with two charge counters on it.', 'X')!;
    const e = def.effects[0]!;
    if (e.s !== 'replace' || e.body.b !== 'enters') throw new Error('shape');
    expect(simpleEntersCounters({ ...def, effects: [{ ...e, body: { ...e.body, tapped: true } }] })).toBeNull();
    expect(simpleEntersCounters({ ...def, effects: [] })).toBeNull();
    expect(simpleEntersCounters({ kind: 'static', text: 'x', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'attack' }] })).toBeNull();
  });
});

describe('activated abilities: `limit` and `zone` (design 4.4)', () => {
  const activate = (s: GameState, name: string) => ({ type: 'activate' as const, player: 'p1' as const, source: find(s, name, 'battlefield'), ability: 'p:0:0' });

  it('CR 602.5b: "activate no more than twice each turn" is limit {per:turn, max:2}', () => {
    const twice = synth({ name: 'Test Twice', type: 'Artifact', abilities: [activated('Twice each turn.', {}, [], { limit: { per: 'turn', max: 2 } })] });
    let s = scenario([], { p1: { battlefield: ['Test Twice'] }, defs: [twice] });
    s = act(s, activate(s, 'Test Twice'));
    s = act(s, { type: 'pass', player: 'p1' }); // (let it resolve: the ability is on the stack)
    s = act(s, { type: 'pass', player: 'p2' });
    expect(legal(s, 'p1', 'activate')).toHaveLength(1); // one use left
    s = act(s, activate(s, 'Test Twice'));
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    expect(legal(s, 'p1', 'activate')).toEqual([]);
    s = advanceTo(s, 3, 'main1');
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
  });

  it('a limit per game is tracked on the object (WP7); a limit per combat still fails closed: the ability is not offered', () => {
    const exhaust = synth({ name: 'Test Exhaust', type: 'Artifact', abilities: [activated('Once per game.', {}, [], { limit: { per: 'game', max: 1 } })] });
    const s = scenario([], { p1: { battlefield: ['Test Exhaust'] }, defs: [exhaust] });
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
    const combat = synth({ name: 'Test Combat Limit', type: 'Artifact', abilities: [activated('Once per combat.', {}, [], { limit: { per: 'combat', max: 1 } })] });
    expect(legal(scenario([], { p1: { battlefield: ['Test Combat Limit'] }, defs: [combat] }), 'p1', 'activate')).toEqual([]);
  });

  it('the old `oncePerTurn` flag of the milestone 3 test helper maps to limit {turn, 1}', () => {
    expect(activated('Once.', {}, [], { oncePerTurn: true })).toMatchObject({ limit: { per: 'turn', max: 1 } });
  });

  it('CR 113.6: `zone` lists every zone the ability functions from', () => {
    const multi = synth({ name: 'Test Multi', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [activated('{0}: from a graveyard or hand.', {}, [], { zone: ['graveyard', 'hand'] })] });
    expect(legal(scenario([], { p1: { graveyard: ['Test Multi'] }, defs: [multi] }), 'p1', 'activate')).toHaveLength(1);
    expect(legal(scenario([], { p1: { hand: ['Test Multi'] }, defs: [multi] }), 'p1', 'activate')).toHaveLength(1);
    expect(legal(scenario([], { p1: { battlefield: ['Test Multi'] }, defs: [multi] }), 'p1', 'activate')).toHaveLength(0);
    expect(legal(scenario([], { p1: { exile: ['Test Multi'] }, defs: [multi] }), 'p1', 'activate')).toHaveLength(0);
  });
});

describe('cost parts: counts are resolved once X is fixed; what is not implemented is a manual part (design 4.4)', () => {
  const sac = (count: Count): CostPart => ({ kind: 'sacrifice', filter: { types: ['Creature'] }, count });

  it('a number stays a number; {q:"X"} becomes the announced X', () => {
    expect(planFromCostDef({ other: [sac(2)] }, 0).other).toEqual([{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 2 }]);
    expect(planFromCostDef({ other: [sac({ q: 'X' })] }, 3).other).toEqual([{ kind: 'sacrifice', filter: { types: ['Creature'] }, count: 3 }]);
    expect(planFromCostDef({ other: [{ kind: 'payLife', amount: { q: 'X' } }] }, 4).other).toEqual([{ kind: 'payLife', amount: 4 }]);
  });

  it('a computed quantity needs WP4: the part becomes manual, which cannot be paid automatically ("any number" is chosen by the player since WP7)', () => {
    const plan = planFromCostDef({ other: [sac({ q: 'count', of: { ref: 'self' } })] }, 0);
    expect(plan.other[0]).toMatchObject({ kind: 'manual' });
    expect(partsDenial(board(), 'p1', null, plan)?.message).toMatch(/can't be paid automatically/);
    expect(planFromCostDef({ other: [sac('any')] }, 0).other[0]).toMatchObject({ kind: 'sacrifice', count: 0, any: true });
  });

  it('the cost parts milestone 3/4 did not know are plan parts since WP7; a keyword action the build cannot pay is still manual (never silently free)', () => {
    const parts: [CostPart, string][] = [
      [{ kind: 'tapPower', filter: {}, power: 3 }, 'tapPower'], [{ kind: 'putCounters', counter: '+1/+1', count: 1, self: true }, 'putCounters'], [{ kind: 'payEnergy', amount: 1 }, 'payEnergy'],
      [{ kind: 'reveal', zone: 'hand', count: 1 }, 'reveal'], [{ kind: 'mill', count: 2 }, 'mill'], [{ kind: 'manual', text: 'Do the thing' }, 'confirm'],
    ];
    for (const [p, kind] of parts) expect(toPlanPart(p, 0), p.kind).toMatchObject({ kind });
    expect(toPlanPart({ kind: 'action', action: 'clash' }, 0)).toMatchObject({ kind: 'manual' }); // FAST5X E28: exert is paid now (rules/pay-parts.ts)
    expect(toPlanPart({ kind: 'putCounters', counter: '+1/+1', count: 1 }, 0)).toMatchObject({ kind: 'manual' }); // neither "this permanent" nor a filter: unclear where
  });

  it('variants that are still manual: a computed or "any number" count, a zone other than graveyard or hand', () => {
    expect(toPlanPart({ kind: 'sacrifice', filter: {}, count: 'any' }, 0)).toEqual({ kind: 'sacrifice', filter: {}, count: 0, any: true }); // the player chooses the count (WP7)
    expect(toPlanPart({ kind: 'discard', count: { q: 'count', of: { ref: 'self' } } }, 0).kind).toBe('manual');
    expect(toPlanPart({ kind: 'exileFrom', zone: 'library', count: 1 }, 0).kind).toBe('manual');
    expect(toPlanPart({ kind: 'discard', count: 1, random: true }, 0)).toEqual({ kind: 'discard', count: 1, random: true });
  });
});

describe('targets: Count for min/max, `players` instead of playerFilter, kinds this build lacks (design 4.4)', () => {
  const spec = (over: Partial<TargetSpec>): TargetSpec => ({ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature', ...over });
  const program = (targets: TargetSpec[]): EffectProgram => ({ targets, steps: [] });

  it('min and max may be {q:"X"} or "any"; the number of options bounds them', () => {
    const s = board();
    expect(programHasTargets(s, program([spec({ min: { q: 'X' }, max: 'any' })]), 'p1')).toBe(true); // X not announced yet: 0
    expect(programHasTargets(s, program([spec({ min: 3, max: 3 })]), 'p1')).toBe(true); // three creatures
    expect(programHasTargets(s, program([spec({ min: 4, max: 4 })]), 'p1')).toBe(false);
    expect(programHasTargets(s, program([spec({ min: 0, max: 'any', filter: { types: ['Planeswalker'] } })]), 'p1')).toBe(true);
  });

  it('`players.who` filters players', () => {
    const s = board();
    const opts = (who: 'you' | 'opponent' | 'any') => targetOptions(s, spec({ kind: 'player', filter: undefined, players: { who } }), 'p1').players;
    expect([opts('you'), opts('opponent'), opts('any')]).toEqual([['p1'], ['p2'], ['p1', 'p2']]);
  });

  it('a kind the build lacks is a loud error, never a guess; a player reference it cannot read finds no player (WP7 reads the rest)', () => {
    const s = board();
    expect(() => targetOptions(s, spec({ kind: 'nothing' as never }), 'p1')).toThrow('not implemented: WP7');
    expect(targetOptions(s, spec({ kind: 'player', players: { who: { ref: 'anOpponent' } } }), 'p1').players).toEqual(['p2']);
    expect(targetOptions(s, spec({ kind: 'player', players: { who: { ref: 'defending' } } }), 'p1').players).toEqual([]);
    expect(() => targetOptions(s, spec({ kind: 'anyTarget' }), 'p1')).not.toThrow();
    expect(() => targetOptions(s, spec({ kind: 'stackObject' }), 'p1')).not.toThrow();
  });

  it('an Aura\'s target program (CR 303.4a) has an id and `players` for "Enchant player"', () => {
    const player: OracleCard = { name: 'Test Curse', layout: 'normal', type_line: 'Enchantment — Aura', oracle_text: 'Enchant player' };
    expect(auraTargetProgram(faceChars(compileCard(player), 0))?.targets[0]).toEqual({ id: 't0', kind: 'player', players: { who: 'any' }, min: 1, max: 1, text: 'player' });
    const creature: OracleCard = { name: 'Test Pacifism', layout: 'normal', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' };
    expect(auraTargetProgram(faceChars(compileCard(creature), 0))?.targets[0]).toMatchObject({ id: 't0', kind: 'object', filter: { types: ['Creature'], zone: 'battlefield' } });
  });
});

describe('ObjectFilter: the fields milestone 4 evaluates, in the final model\'s spelling (design 4.4)', () => {
  const s = board();
  const names = (f: ObjectFilter): string[] => findObjects(s, f, ctx).map((o) => getChars(s, o.id).name);

  it('power, toughness and manaValue are NumberCmp (renamed from powerCmp...)', () => {
    expect(names({ types: ['Creature'], power: { op: '>=', value: 3 } }).sort()).toEqual(['Hill Giant', 'Serra Angel']);
    expect(names({ types: ['Creature'], toughness: { op: '<', value: 3 } })).toEqual(['Grizzly Bears']);
    expect(names({ types: ['Creature'], manaValue: { op: '>=', value: 4 } }).sort()).toEqual(['Hill Giant', 'Serra Angel']);
    expect(names({ types: ['Creature'], manaValue: { op: '==', value: 2 } })).toEqual(['Grizzly Bears']);
    expect(names({ types: ['Creature'], power: { op: '!=', value: 2 } }).sort()).toEqual(['Hill Giant', 'Serra Angel']);
  });

  it('zone may be a list; keyword may be a name', () => {
    const t = tweak(s, () => undefined);
    const inYard = findObjects(t, { zone: ['battlefield', 'graveyard'], types: ['Creature'] }, ctx);
    expect(inYard).toHaveLength(3);
    expect(names({ keyword: 'flying' })).toEqual(['Serra Angel']);
    expect(names({ notKeyword: 'flying', types: ['Creature'] }).sort()).toEqual(['Grizzly Bears', 'Hill Giant']);
  });

  it('a filter that cannot be evaluated NEVER matches (no `unsupported` escape: nothing is approximately right); WP4 evaluates every field of the model', () => {
    const bears = s.objects[find(s, 'Grizzly Bears', 'battlefield')]!;
    expect(matchesFilter(s, bears, { types: ['Creature'] }, ctx)).toBe(true);
    for (const f of [
      { madeUpField: true } as unknown as ObjectFilter, // a field this build does not know
      { is: { ref: 'target' as const, id: 't0' } }, // a reference with no way to resolve it (no filter environment)
      { power: { op: '<=' as const, value: { q: 'X' as const } } }, // a quantity with no way to evaluate it
      { not: { is: { ref: 'target' as const, id: 't0' } } }, // "could not be evaluated" is never turned into "true" by a not
      { sharesWith: { with: { ref: 'self' as const }, quality: 'color' as const } }, // no source object in this context
    ] satisfies ObjectFilter[]) {
      expect(matchesFilter(s, bears, f, ctx), JSON.stringify(f)).toBe(false);
    }
    // the fields WP0 listed as unevaluable are real now (the full table is in test/m5/eval/filter.test.ts)
    for (const f of [{ monocolored: true }, { anyOf: [{ types: ['Creature'] }] }, { not: { types: ['Land'] } }, { controller: { ref: 'you' as const } }, { dealtDamageThisTurn: false }] satisfies ObjectFilter[]) {
      expect(matchesFilter(s, bears, f, ctx), JSON.stringify(f)).toBe(true);
    }
    for (const f of [{ dealtDamageThisTurn: true }, { keyword: ['flying', 'reach'] }, { attacking: { defender: 'opponent' as const } }] satisfies ObjectFilter[]) {
      expect(matchesFilter(s, bears, f, ctx), JSON.stringify(f)).toBe(false);
    }
  });
});

describe('decisions: chooseDivision (CR 601.2d) and chooseName (CR 607.2d) are validated', () => {
  const s = board();
  const division: Decision = { kind: 'chooseDivision', id: 'd1', player: 'p1', prompt: 'Divide 5 damage.', what: 'damage', total: 5, targets: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }] };
  const names: Decision = { kind: 'chooseName', id: 'd2', player: 'p1', prompt: 'Choose a creature type.', what: 'creatureType', options: ['Bear', 'Giant'] };
  const check = (d: Decision, a: DecisionAnswer): string | null => {
    try {
      validateAnswer(s, d, a);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  it('a division gives each target at least 1, one amount per target, adding up to the total', () => {
    expect(check(division, { kind: 'chooseDivision', amounts: [3, 2] })).toBeNull();
    expect(check(division, { kind: 'chooseDivision', amounts: [4, 1] })).toBeNull();
    expect(check(division, { kind: 'chooseDivision', amounts: [5, 0] })).toMatch(/at least 1/);
    expect(check(division, { kind: 'chooseDivision', amounts: [2, 2] })).toMatch(/add up to 4/);
    expect(check(division, { kind: 'chooseDivision', amounts: [5] })).toMatch(/one amount for each of the 2/);
    expect(check(division, { kind: 'chooseDivision', amounts: [2.5, 2.5] })).toMatch(/at least 1/);
    expect(check(division, { kind: 'chooseDivision', amounts: 'x' as unknown as number[] })).toMatch(/one amount/);
  });

  it('a name comes from the options when there are any; a card name is any non-empty text', () => {
    expect(check(names, { kind: 'chooseName', name: 'Bear' })).toBeNull();
    expect(check(names, { kind: 'chooseName', name: 'Dragon' })).toMatch(/not one of the options/);
    expect(check(names, { kind: 'chooseName', name: '   ' })).toMatch(/Name something/);
    const card: Decision = { ...names, what: 'cardName' } as Decision;
    delete (card as { options?: string[] }).options;
    expect(check(card, { kind: 'chooseName', name: 'Lightning Bolt' })).toBeNull();
    expect(check(card, { kind: 'chooseName', name: 7 as unknown as string })).toMatch(/Name something/);
  });

  it('an answer of the wrong kind is refused', () => {
    expect(check(division, { kind: 'chooseName', name: 'x' })).toMatch(/needs a "chooseDivision" answer/);
  });

  it('other players see only that someone is deciding, not what (redaction like every decision)', () => {
    const t = tweak(s, (x) => { x.pending = division; });
    const v = viewFor(t, 'p2');
    expect(v.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(JSON.stringify(v.pending)).not.toContain('damage');
    expect(viewFor(t, 'p1').pending).toMatchObject({ kind: 'chooseDivision', total: 5 });
  });
});

describe('views hide what hidden objects remember (links and cast, like `chosen`)', () => {
  it('a card in a hand carries its link store and cast record only for its owner', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'hand');
    const s = tweak(s0, (t) => {
      t.objects[bears]!.links = { named: { values: ['Lightning Bolt'] } };
      t.objects[bears]!.cast = { costsPaid: {}, from: 'hand', turn: 1 };
    });
    expect(viewFor(s, 'p1').objects[bears]!.links).toEqual({ named: { values: ['Lightning Bolt'] } });
    const v2 = viewFor(s, 'p2'); // m4 (audit 2026-10-12): another player's hand under the view's aliases
    const other = v2.objects[v2.zones.hand['p1']![0]!]!;
    expect(other.links).toBeUndefined();
    expect(other.cast).toBeUndefined();
    expect(other.defId).toBe('__hidden__');
  });
});

describe('compiler output keeps its M3/M4 shape, in the new model\'s terms', () => {
  it('manual abilities carry the `shape` the model requires: unknown text, and the by-hand mana abilities are "activated"', () => {
    const face = (text: string, type = 'Creature — Bear') => ({ name: 'T', manaCost: null, typeLine: type, supertypes: [], types: ['Creature' as const], subtypes: [], oracleText: text, colors: [], keywords: [] });
    // WP18: milestone 4's basicAbilityCompiler is gone; the default compiler (the compile pipeline) gives its manual abilities a shape too
    const card = (text: string): OracleCard => ({ name: 'Test Bear', layout: 'normal', type_line: 'Creature — Bear', oracle_text: text });
    const unknown = compileCard(card('Frobnicate the quux.')).faces[0]!.abilities;
    expect(unknown).toMatchObject([{ kind: 'manual' }]);
    expect(['spell', 'activated', 'triggered', 'static', 'unknown']).toContain((unknown[0] as { shape: string }).shape);
    const mana = compileCard(card('{T}: Add {R}. Each opponent gains 1 life.')).faces[0]!.abilities; // CMD5: a pain land's damage is automated now
    expect(mana).toMatchObject([{ kind: 'manual', shape: 'activated', mana: true }]);
    expect(noAbilityCompiler(face('Flying'), { name: 'T', layout: 'normal' }).abilities).toMatchObject([{ kind: 'manual', shape: 'unknown' }]);
  });

  it('CR 106.3, CR 605.1a: the ability the recognizer builds is a valid model step (`who` is required, design D4/3.2/4.4), like the abilities the engine generates (basic lands)', () => {
    expect(parseManaAbilityLine('{T}: Add {C}.', 'Sol Ring')!.effect.steps[0]).toEqual({ op: 'addMana', who: { ref: 'you' }, units: [['C']] });
    const s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } });
    const forest = s.objects[find(s, 'Forest', 'battlefield')]!;
    const rule = enumerateAbilities(s, forest).find((a) => a.key === 'r:basic:G')!;
    expect(rule.origin).toBe('rule');
    expect((rule.def as { effect: EffectProgram }).effect.steps[0]).toEqual({ op: 'addMana', who: { ref: 'you' }, units: [['G']] });
  });

  it('CardDef.automation is the CardAutomation superset with the three milestone 4 fields', () => {
    const def = compileCard({ name: 'Bear', layout: 'normal', type_line: 'Creature — Bear', oracle_text: 'Trample', power: '2', toughness: '2' });
    // WP18: the compile pipeline fills the whole CardAutomation (faces, autoRatio, textHash, compilerVersion), not just the milestone 4 fields
    expect(def.automation).toMatchObject({ level: 'full', unsupported: [], source: 'keywords-only', autoRatio: 1, faces: [{ abilities: [{ level: 'full', manual: [] }] }] });
    expect(def.automation.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(def.automation.compilerVersion).toBeTruthy();
  });
});
