/**
 * WP0 review: the announcement code (casting, activating, targeting) fails CLOSED for everything it does not read, names what it does not read as a capability
 * (model/forms.ts), threads the announced X into target counts, and never lets a definition it can't read crash `legalActions` or the auto-pass loop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyAction, ENGINE_CAPABILITIES, legalActions, type ActivatedAbilityDef, type CostPart, type EffectProgram, type GameState, type ModeSpec, type ObjectFilter, type TargetSpec,
} from '../../../src/index';
import { FEATURES } from '../../../src/actions/announce';
import { buildEngineCapabilities } from '../../../src/model/capabilities';
import { activatedForms, costPartForms, filterForms, FIELD_COVERAGE, modeSpecForms, programForms, targetSpecForms } from '../../../src/model/forms';
import { COST_FORMS, toPlanPart } from '../../../src/rules/cost';
import { matchesFilter, SUPPORTED_FILTER_FIELDS, NO_ENV } from '../../../src/rules/filter';
import { act, activated, answer, engineModules, find, legal, reject, scenario, SRC_ROOT, spellAbility, synth, targetCreature } from '../helpers';

const spec = (over: Partial<TargetSpec>): TargetSpec => ({ id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature', ...over });
const spell = (name: string, targets: TargetSpec[], modes?: ModeSpec) =>
  synth({ name, cost: '{R}', type: 'Instant', abilities: [{ kind: 'spell', text: 'x', effect: { targets, steps: [], ...(modes ? { modes } : {}) } as EffectProgram }] });

const board = (hand: string[], defs: ReturnType<typeof synth>[], p2hand: string[] = [], fullControl = true): GameState =>
  scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { hand, battlefield: ['Mountain', 'Mountain', 'Mountain', 'Grizzly Bears'] }, p2: { hand: p2hand, battlefield: ['Hill Giant'] }, defs, stops: { fullControl } });

describe('CR 601.2b-c, 107.3a: the announced X is the value of a target count of X', () => {
  const volley = synth({ name: 'Test Volley', cost: '{X}{R}', type: 'Sorcery', abilities: [spellAbility('Up to X target creatures.', [spec({ min: 0, max: { q: 'X' }, text: 'up to X target creatures' })])] });
  const exact = synth({ name: 'Test Exactly', cost: '{X}{R}', type: 'Sorcery', abilities: [spellAbility('X target creatures.', [spec({ min: { q: 'X' }, max: { q: 'X' }, text: 'X target creatures' })])] });

  it('X = 2 offers a choice of up to 2 targets (it used to read X as 0 and put the spell on the stack with no targets)', () => {
    let s = board(['Test Volley'], [volley]);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Volley', 'hand') });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber' });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 2 });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'battlefield') }, { kind: 'object', id: find(s, 'Hill Giant', 'battlefield') }] });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[s.zones.stack[0]!]!.stack!.targets[0]).toHaveLength(2);
  });

  it('X = 0 needs no target choice; "X target creatures" with X = 2 requires exactly 2', () => {
    let s = board(['Test Volley'], [volley]);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Volley', 'hand') });
    s = answer(s, { kind: 'chooseNumber', n: 0 });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[s.zones.stack[0]!]!.stack!.targets).toEqual([[]]);

    let t = board(['Test Exactly'], [exact]);
    t = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Exactly', 'hand') });
    t = answer(t, { kind: 'chooseNumber', n: 2 });
    expect(t.pending).toMatchObject({ kind: 'chooseTargets', min: 2, max: 2 });
  });

  it('an activated ability announces X before its targets the same way', () => {
    const pinger = synth({ name: 'Test Xinger', type: 'Artifact', abilities: [activated('{X}: Up to X target creatures.', { mana: [{ kind: 'variable', name: 'X' }] }, [spec({ min: 0, max: { q: 'X' }, text: 'up to X target creatures' })])] });
    let s = scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Mountain', 'Mountain', 'Test Xinger', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs: [pinger] });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Xinger', 'battlefield'), ability: 'p:0:0' });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', min: 0, max: 2 });
  });

  it('a missing X environment is loud (evalCount throws), so no caller can quietly read 0 again', async () => {
    const { evalCount } = await import('../../../src/effects/eval');
    expect(() => evalCount({ q: 'X' })).toThrow('not been announced');
    expect(evalCount({ q: 'X' }, { x: 0 })).toBe(0);
  });
});

describe('CR 601.2c: a definition the build cannot read is NOT OFFERED; it never crashes legalActions or the auto-pass loop (ARCHITECTURE principle 4)', () => {
  // WP7 reads every target kind, `distinctFrom`, `divide`, `groupLimit`, `chooser` and a PlayerRef it can resolve (anyTarget, stackObject and the other kinds are tested in test/m5/announce).
  // What stays unread: a computed count (waits for WP4's evalCount), a PlayerRef that doesn't exist yet while targets are announced, and a condition that needs history.
  // (std-tdm / std-blb: an activation restriction reads the history of THIS turn with no player or object reference, model/forms.ts#turnHistoryAtAnnouncement; last turn's is never read.)
  const unreadable: [string, TargetSpec[], RegExp][] = [
    ['a computed target count', [spec({ min: 0, max: { q: 'count', of: { ref: 'self' } } })], /can't announce part of this yet/],
    ['a PlayerRef that can\'t be read while announcing (defending player)', [spec({ kind: 'player', filter: undefined, players: { who: { ref: 'defending' } } })], /can't read part of this yet/],
    ['an onlyIf that needs history', [spec({ onlyIf: { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' } })], /can't read part of this yet/],
  ];

  it.each(unreadable)('%s: the spell is not castable (with a reason), in either hand, and a cast request is refused', (_name, targets, message) => {
    const s = board(['Test Unreadable'], [spell('Test Unreadable', targets)]);
    expect(() => legalActions(s, 'p1')).not.toThrow();
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    const err = reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unreadable', 'hand') });
    expect(err.message).toMatch(message);
    expect(err.rules).toContain('CR 601.2c');
  });

  it.each(unreadable)('%s: with the card in the OPPONENT\'s hand, passing priority never throws out of applyAction (the match is not bricked)', (_name, targets) => {
    let s = board([], [spell('Test Unreadable', targets)], ['Test Unreadable'], false);
    for (let i = 0; i < 12 && !s.result; i++) {
      const d = s.pending!;
      const r = applyAction(s, d.kind === 'declareAttackers' ? { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [] } } : d.kind === 'declareBlockers' ? { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [] } } : { type: 'pass', player: d.player });
      expect(r.error?.message, `step ${i}`).toBeUndefined();
      s = r.state;
    }
    expect(s.turn.number).toBeGreaterThanOrEqual(1);
  });

  it('modal programs are checked through their options (a mode whose option cannot be read keeps the whole spell out)', () => {
    const modal: ModeSpec = { min: 1, max: 1, options: [{ text: 'a', program: { targets: [], steps: [] } }, { text: 'b', program: { targets: [spec({ min: 0, max: { q: 'count', of: { ref: 'self' } } })], steps: [] } }] };
    const s = board(['Test Modal'], [spell('Test Modal', [], modal)]);
    expect(legal(s, 'p1', 'cast')).toEqual([]);
  });

  it('a readable spec is still offered, and the pass loop still plays normally (nothing else changed)', () => {
    const s = board(['Test Readable'], [spell('Test Readable', [targetCreature])]);
    expect(legal(s, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Test Readable']);
  });
});

describe('WP0 review: model fields that the build does not read are named capabilities AND are not played with the field ignored (WP7 reads most of them now)', () => {
  const readFields: [string, string][] = [
    ['feature:target.distinct', 'distinctFrom ("another target creature")'], ['feature:target.divide', 'divide (divided damage, CR 601.2d)'],
    ['feature:target.groupLimit', 'groupLimit ("total power 5 or less")'], ['feature:target.onlyIf', 'onlyIf (a kicker-dependent target)'], ['feature:target.chooser', 'chooser (an opponent chooses)'],
    ['feature:target.playerRef', 'a PlayerRef as the player filter'], ['feature:target.sameOwner', 'sameOwner ("from a single graveyard", FAST3 T14)'], ['feature:target.perOpponent', 'perOpponent ("for each opponent, ... that player controls", FAST5 T66)'], ['feature:target.sharedCardType', 'sharedCardType ("that share a card type", FAST5 T66)'], ['feature:target.sharedCreatureType', 'sharedCreatureType ("that share a creature type", CLOUD std-ecl)'], ['feature:modes.chooser', 'an opponent chooses the modes'], ['feature:modes.override', 'kicked / entwined mode counts'],
    ['feature:target.differentControllers', 'differentControllers ("controlled by different players", CLOUD std-tmt)'],
    ['feature:target.perPlayer', 'perPlayer ("for each player, ... that player controls", r5-fxb)'],
    ['feature:target.random', 'random ("chosen at random", p2-damage-2)'],
    ['feature:modes.cost', 'a cost on a mode'], ['feature:activate.onlyIf', 'an activation restriction'], ['feature:limit.game', 'once per game'],
  ];
  it.each(readFields)('%s (%s) is a capability of this build (WP7 reads it; scenarios are in test/m5/announce)', (cap) => {
    expect(ENGINE_CAPABILITIES.has(cap)).toBe(true);
  });

  const unreadFields: [string, string, TargetSpec[], ModeSpec?][] = [
    ['feature:count.quantity', 'a computed target count', [spec({ min: 0, max: { q: 'count', of: { ref: 'self' } } })]],
  ];

  it.each(unreadFields)('%s (%s): not offered; named by targetSpecForms; absent from ENGINE_CAPABILITIES', (cap, _what, targets) => {
    const s = board(['Test Field'], [spell('Test Field', targets)]);
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Field', 'hand') }).message).toContain(cap);
    expect(targets.flatMap(targetSpecForms)).toContain(cap);
    expect(ENGINE_CAPABILITIES.has(cap)).toBe(false);
  });

  const unreadModes: [string, ModeSpec][] = [
    ['feature:count.quantity', { min: 1, max: { q: 'count', of: { ref: 'self' } }, options: [{ text: 'a', program: { targets: [], steps: [] } }] }],
  ];

  it.each(unreadModes)('%s: a modal spell that uses it is not offered', (cap, modes) => {
    const s = board(['Test Mode'], [spell('Test Mode', [], modes)]);
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mode', 'hand') }).message).toContain(cap);
    expect(modeSpecForms(modes)).toContain(cap);
    expect(ENGINE_CAPABILITIES.has(cap)).toBe(false);
  });

  it('feature:activate.onlyIf: an activation restriction the engine can attest is offered; one it can\'t read is not (CR 602.5b); a limit per combat is still not offered', () => {
    const def = (extra: Partial<ActivatedAbilityDef> = {}) => synth({ name: 'Test Gate', type: 'Artifact', abilities: [activated('Activate only if x.', {}, [], extra as never)] });
    const plain = scenario([], { p1: { battlefield: ['Test Gate'] }, defs: [def()] });
    expect(legal(plain, 'p1', 'activate')).toHaveLength(1);
    const attested = scenario([], { p1: { battlefield: ['Test Gate'] }, defs: [def({ onlyIf: { cond: 'ask', text: 'x' } })] });
    expect(legal(attested, 'p1', 'activate')).toHaveLength(1); // asked when it is activated
    // std-tdm / std-blb: an activation restriction reads this turn's history (CR 602.5b, model/forms.ts#turnHistoryAtAnnouncement); a history over the whole game stays unread
    const unread = scenario([], { p1: { battlefield: ['Test Gate'] }, defs: [def({ onlyIf: { cond: 'happened', event: { ev: 'draw' }, scope: 'game' } })] });
    expect(legal(unread, 'p1', 'activate')).toEqual([]);
    expect(reject(unread, { type: 'activate', player: 'p1', source: find(unread, 'Test Gate', 'battlefield'), ability: 'p:0:0' }).message).toContain("can't check part of this ability");
    const combat = scenario([], { p1: { battlefield: ['Test Gate'] }, defs: [def({ limit: { per: 'combat', max: 1 } })] });
    expect(legal(combat, 'p1', 'activate')).toEqual([]);
    expect(activatedForms({ kind: 'activated', text: 'x', cost: {}, effect: { targets: [], steps: [] }, onlyIf: { cond: 'ask', text: 'x' } })).toEqual(['feature:activate.onlyIf', 'feature:announce.cond.ask']);
    expect(activatedForms({ kind: 'activated', text: 'x', cost: {}, effect: { targets: [], steps: [] }, limit: { per: 'game', max: 1 } })).toEqual(['feature:limit.game']);
    expect(activatedForms({ kind: 'activated', text: 'x', cost: {}, effect: { targets: [], steps: [] }, limit: { per: 'combat', max: 1 } })).toEqual(['feature:limit.combat']);
    expect(ENGINE_CAPABILITIES.has('feature:limit.combat')).toBe(false);
    for (const cap of ['feature:activate.onlyIf', 'feature:limit.game']) expect(ENGINE_CAPABILITIES.has(cap), cap).toBe(true);
  });

  it('a table entry flips both halves at once: with the name in FEATURES the capability exists and the spell is offered (WP7 only has to add names)', () => {
    const features = FEATURES as string[];
    const modes: ModeSpec = { min: 1, max: { q: 'count', of: { ref: 'self' } }, options: [{ text: 'a', program: { targets: [], steps: [] } }] };
    const s = board(['Test Field'], [spell('Test Field', [], modes)]);
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    try {
      features.push('count.quantity');
      expect(buildEngineCapabilities().has('feature:count.quantity')).toBe(true);
      expect(legal(s, 'p1', 'cast')).toHaveLength(1);
    } finally {
      features.pop();
    }
    expect(legal(s, 'p1', 'cast')).toEqual([]);
  });

  it('programForms collects the kinds and fields of a program and of all of its modes', () => {
    const p: EffectProgram = { targets: [spec({ kind: 'anyTarget' })], modes: { min: 1, max: 1, options: [{ text: 'a', program: { targets: [spec({ divide: { what: 'damage', total: 2 } })], steps: [] } }] }, steps: [] };
    expect(programForms(p).sort()).toEqual(['feature:target.divide', 'target:anyTarget', 'target:object']);
  });

  it('every field classified `read` has a reader in the engine (no field is claimed without a call-site)', () => {
    const readers: Record<string, RegExp> = {
      'TargetSpec.filter': /spec\.filter/, 'TargetSpec.players': /spec\.players/, 'ModeSpec.allowRepeat': /\.allowRepeat/, 'ActivatedAbilityDef.isMana': /\.isMana/,
      'ActivatedAbilityDef.isLoyalty': /\.isLoyalty/, 'ActivatedAbilityDef.sorcerySpeed': /\.sorcerySpeed/, 'ActivatedAbilityDef.limit': /def\.limit/, 'ActivatedAbilityDef.zone': /def\.zone/,
      'ActivatedAbilityDef.anyPlayer': /def\.anyPlayer/, // MX5: any player may activate it (actions/activate.ts, CR 602.2)
      'TargetSpec.distinctFrom': /distinctFrom/, 'TargetSpec.divide': /spec\.divide/, 'TargetSpec.groupLimit': /spec\.groupLimit/, 'TargetSpec.onlyIf': /spec\.onlyIf/, 'TargetSpec.chooser': /spec\.chooser/,
      'TargetSpec.differentNames': /spec\.differentNames/, // FAST5 T42: "with different names" (actions/announce-targets.ts, rules/targets.ts)
      'TargetSpec.perOpponent': /spec\.perOpponent/, 'TargetSpec.sharedCardType': /spec\.sharedCardType/, 'TargetSpec.sharedCreatureType': /spec\.sharedCreatureType/, // FAST5 T66; CLOUD std-ecl: "for each opponent, ... that player controls", "that share a card type" (rules/targets.ts)
      'TargetSpec.sameController': /spec\.sameController/, // std-rx30: "controlled by the same opponent" (rules/targets.ts#sameControllerHolds)
      'TargetSpec.perCardType': /spec\.perCardType/, // std-cardcopy-7: "of each card type" (rules/targets.ts#perCardTypeHolds)
      'TargetSpec.perPlayer': /spec\.perPlayer/, // r5-fxb: "for each player, ... that player controls" (rules/targets.ts#perOpponentHolds)
      'TargetSpec.random': /spec\.random/, // p2-damage-2: "chosen at random" (actions/announce-targets.ts#randomTargets, CR 601.2c, 603.3d)
      'TargetSpec.differentControllers': /spec\.differentControllers/, // CLOUD std-tmt: "controlled by different players" (actions/announce-targets.ts, rules/targets.ts)
      'TargetSpec.sameOwner': /spec\.sameOwner/, // FAST3 T14: "from a single graveyard" (actions/announce-targets.ts, rules/targets.ts)
      'TargetSpec.link': /spec\.link/, // FAST5 LNK1: the targets an ability affected, remembered on its source (effects/run.ts#rememberTargets, CR 607.1)
      'ModeSpec.chooser': /spec\.chooser/, 'ModeSpec.override': /spec\.override/, 'ActivatedAbilityDef.onlyIf': /def\.onlyIf/,
      'ActivatedAbilityDef.keyword': /def\.keyword/, // FAST1 T4: the wrapper keyword names the refusal of a second activation (rules/timing.ts)
      'ActivatedAbilityDef.reducedByManaCost': /def.reducedByManaCost/, // T35: power-up (actions/activate.ts#abilityPlan)
      'ActivatedAbilityDef.costChange': /def\.costChange/, // FAST5 T38: the ability's own cost change (actions/activate.ts#costChangeOf)
      'ActivatedAbilityDef.xMin': /def\.xMin/, // std-rx12: "X can't be 0." (actions/activate.ts)
      'ActivatedAbilityDef.tapForMana': /def\.tapForMana/, // std-rx27: tap creatures rather than pay an activation's mana (actions/activate.ts)
      'ActivatedAbilityDef.uncopiable': /def\.uncopiable/, // std-copy-1: "This ability can't be copied." (effects/handlers/tokens-copy.ts#copySpells, CR 707.10)
      'ActivatedAbilityDef.costChangeIf': /def\.costChangeIf/, // r4-cost: the condition of the ability's own cost change (actions/activate.ts#costChangeOf)
      'ModeSpec.pawprints': /spec\.pawprints/, // std-blb: the pawprint budget of a "Season" (actions/announce.ts#chooseModes, CR 700.2i)
      'ModeSpec.unchosen': /spec\.unchosen/, // r3-choose: "choose one that hasn't been chosen" (actions/announce.ts#usedModes, CR 700.2)
      'ModeSpec.random': /spec\.random/, // p2-modal-2: "choose one at random" (actions/announce.ts#chooseModes, CR 700.2)
    };
    const src = engineModules().filter((m) => !['types', 'model'].includes(m.layer)).map((m) => readFileSync(join(SRC_ROOT, `${m.id}.ts`), 'utf8')).join(' ');
    const claimed = Object.entries(FIELD_COVERAGE).flatMap(([record, fields]) => Object.entries(fields).filter(([, c]) => c === 'read').map(([f]) => `${record}.${f}`));
    expect(claimed.sort()).toEqual(Object.keys(readers).sort());
    for (const [field, re] of Object.entries(readers)) expect(re.test(src), field).toBe(true);
  });

  it('every optional field of TargetSpec, ModeSpec and ActivatedAbilityDef is classified: read, or a capability the build does not have', () => {
    for (const [record, fields] of Object.entries(FIELD_COVERAGE)) {
      for (const [field, coverage] of Object.entries(fields)) {
        if (coverage === 'read') continue;
        expect(ENGINE_CAPABILITIES.has(coverage), `${record}.${field} -> ${coverage}`).toBe(false);
      }
    }
    expect(Object.keys(FIELD_COVERAGE.TargetSpec).sort()).toEqual(['chooser', 'differentControllers', 'differentNames', 'distinctFrom', 'divide', 'filter', 'groupLimit', 'link', 'onlyIf', 'perCardType', 'perOpponent', 'perPlayer', 'players', 'random', 'sameController', 'sameOwner', 'sharedCardType', 'sharedCreatureType']);
  });
});

describe('WP0 review: value forms of supported filter fields and cost kinds are named, and fail closed until their owner honors them', () => {
  const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
  const bears = s.objects[find(s, 'Grizzly Bears', 'battlefield')]!;
  const ctx = { you: 'p1' as const, env: NO_ENV };
  // WP4 evaluates every filter form (design 15.2) where it has what the form needs. The list forms need nothing and are advertised. The forms that mention a reference or a
  // quantity need a FilterEnv: every call site passes one since WP30 (rules/filter-env.ts), so they are advertised too; WITHOUT an environment they still never match.
  const advertised: [string, ObjectFilter, boolean][] = [
    ['filter:keyword.list', { keyword: ['flying', 'reach'] }, false],
    ['filter:notKeyword.list', { notKeyword: ['flying'] }, true],
  ];
  const needsEnv: [string, ObjectFilter][] = [
    ['filter:controller.ref', { controller: { ref: 'you' } }],
    ['filter:owner.ref', { owner: { ref: 'you' } }],
    ['filter:attacking.defender', { attacking: { defender: 'opponent' } }],
    ['filter:cmp.quantity', { power: { op: '<=', value: { q: 'X' } } }],
  ];

  it.each(advertised)('%s: reported by filterForms, advertised and evaluated', (cap, form, matches) => {
    expect(filterForms(form)).toContain(cap);
    expect(ENGINE_CAPABILITIES.has(cap)).toBe(true);
    expect(matchesFilter(s, bears, form, ctx)).toBe(matches);
    expect(SUPPORTED_FILTER_FIELDS.has(cap.slice('filter:'.length))).toBe(true);
  });
  it.each(needsEnv)('%s: reported by filterForms and advertised since every call site passes an environment (WP30)', (cap, form) => {
    expect(filterForms(form)).toContain(cap);
    expect(ENGINE_CAPABILITIES.has(cap)).toBe(true);
    expect(SUPPORTED_FILTER_FIELDS.has(cap.slice('filter:'.length))).toBe(true);
  });
  it('without an environment a quantity or a reference other than you / active / self never matches; the plain forms of the same fields do', () => {
    expect(matchesFilter(s, bears, { power: { op: '<=', value: { q: 'X' } } }, ctx)).toBe(false);
    expect(matchesFilter(s, bears, { power: { op: '<=', value: 3 } }, ctx)).toBe(true);
    expect(matchesFilter(s, bears, { is: { ref: 'target', id: 't0' } }, ctx)).toBe(false);
  });

  const costForm: [string, CostPart][] = [
    ['cost:count.quantity', { kind: 'sacrifice', filter: {}, count: { q: 'count', of: { ref: 'self' } } }],
    ['cost:exileFrom.zone', { kind: 'exileFrom', zone: 'library', count: 1 }],
  ];

  it.each(costForm)('%s: reported by costPartForms, absent from ENGINE_CAPABILITIES, and a manual plan part (never silently free)', (cap, part) => {
    expect(costPartForms(part)).toContain(cap);
    expect(ENGINE_CAPABILITIES.has(cap)).toBe(false);
    expect(toPlanPart(part, 0).kind).toBe('manual');
  });

  it('the supported forms of the same kinds report nothing, including the announced X', () => {
    for (const p of [
      { kind: 'sacrifice', filter: {}, count: 2 }, { kind: 'sacrifice', filter: {}, count: { q: 'X' } }, { kind: 'payLife', amount: { q: 'X' } }, { kind: 'discard', count: 1 },
      { kind: 'exileFrom', zone: 'graveyard', count: 1 }, { kind: 'removeCounters', counter: 'charge', count: 1 }, { kind: 'tapUntapped', filter: {}, count: 1 },
    ] satisfies CostPart[]) {
      expect(costPartForms(p), JSON.stringify(p)).toEqual([]);
      expect(toPlanPart(p, 2).kind, JSON.stringify(p)).not.toBe('manual');
    }
    expect(filterForms({ controller: 'you', keyword: 'flying', attacking: true, power: { op: '>=', value: 2 } })).toEqual([]);
    // The forms WP7 pays are still named by costPartForms (the walker needs the names) and are capabilities of this build now.
    const paid: [string, CostPart][] = [
      ['cost:discard.self', { kind: 'discard', count: 1, self: true }], ['cost:discard.hand', { kind: 'discard', count: 1, hand: true }],
      ['cost:removeCounters.filter', { kind: 'removeCounters', counter: 'charge', count: 1, filter: {} }], ['cost:tapUntapped.other', { kind: 'tapUntapped', filter: {}, count: 1, other: true }],
      ['cost:action.forage', { kind: 'action', action: 'forage' }], ['cost:count.any', { kind: 'sacrifice', filter: {}, count: 'any' }],
    ];
    for (const [cap, part] of paid) {
      expect(costPartForms(part), cap).toContain(cap);
      expect(ENGINE_CAPABILITIES.has(cap), cap).toBe(true);
      expect(toPlanPart(part, 0).kind, cap).not.toBe('manual');
    }
    expect(ENGINE_CAPABILITIES.has('cost:action.clash')).toBe(false); // FAST5X E28: cost:action.exert is paid now (rules/pay-parts.ts#exertForCost)
  });

  it('what the build does NOT cover is recorded here for WP4 and WP7: the tables list kinds and fields, never these forms', () => {
    // WP7 pays discard.self (cycling), discard.hand, removeCounters.filter, tapUntapped.other and the actions collectEvidence, forage and blight (test/m5/costs);
    // FAST5X E10: and waterbend (CR 701.67a, rules/cost.ts, test/fast5x/e10)
    // FAST5X E13: exile from the battlefield ("Exile ~", a permanent you control), craft's materials and their "N or more" count (CR 118.3, 702.167a)
    expect([...COST_FORMS].sort()).toEqual(['action.blight', 'action.collectEvidence', 'action.exert' /* FAST5X E28 */, 'action.forage', 'action.waterbend', 'count.any', 'discard.hand', 'discard.self', 'exileFrom.atLeast', 'exileFrom.battlefield', 'exileFrom.orGraveyard', 'exileFrom.stack' /* r5-mech: a resolving spell exiles itself, CR 608.2n */, 'exileFrom.symbolTotal' /* std-cardcopy-7: a total of mana symbols, CR 118.3, 107.4 */, 'exileFrom.totalManaValue' /* std-costs-1: an exact total mana value, CR 118.3, 107.3a */, 'removeCounters.all' /* p2-counters-move-2 */, 'removeCounters.among' /* r3-cost: "from among creatures you control", CR 118.3, 122.1 */, 'removeCounters.any' /* CLOUD std-ecl (also cloud std-spm's, one implementation): counters of any kinds, CR 122.1, 118.3 */, 'removeCounters.filter', 'sacrifice.atLeast' /* std-mana-1: "Sacrifice one or more artifacts", CR 601.2b, 118.3 */, 'sacrifice.distinctNames' /* r3-cost: "with different names", CR 118.3, 201.2 */, 'tapUntapped.other'].sort());
    for (const [cap] of costForm) expect(ENGINE_CAPABILITIES.has(cap)).toBe(false);
    for (const [cap] of needsEnv) expect(ENGINE_CAPABILITIES.has(cap)).toBe(true); // WP30: every call site passes a FilterEnv
    expect(ENGINE_CAPABILITIES.has('cost:discard')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('filter:keyword')).toBe(true);
  });

  it('adding a form name to the owner\'s table makes the capability appear (the same mechanism as every other capability)', () => {
    const forms = COST_FORMS as string[];
    try {
      forms.push('count.quantity');
      expect(buildEngineCapabilities().has('cost:count.quantity')).toBe(true);
    } finally {
      forms.pop();
    }
    const fields = SUPPORTED_FILTER_FIELDS as Set<string>;
    try {
      fields.add('madeUpForm');
      expect(buildEngineCapabilities().has('filter:madeUpForm')).toBe(true);
    } finally {
      fields.delete('madeUpForm');
    }
  });
});
