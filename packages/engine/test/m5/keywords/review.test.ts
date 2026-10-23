/**
 * WP3 review findings, each pinned by a test named after the rule it protects. These were written BEFORE the fixes (they failed first).
 *
 * The capability half of the findings: a `keyword:<name>` capability of an expansion keyword is advertised only when every capability its expansion needs
 * exists (design 5.2: "an unfinished work package can never make a card wrongly automated"). Until WP1's `capabilitiesOf` lands, `keywords/needs.ts` reads
 * the needs from the expansion data itself.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES } from '../../../src/index';
import type { AbilityDef, EffectStep, KeywordAbilityDef, KeywordActionName } from '../../../src/index';
import { ACTION_MACROS } from '../../../src/keywords/actions';
import type { ActionStep } from '../../../src/keywords/actions/common';
import { keywordCapabilities } from '../../../src/keywords/capabilities';
import { expandKeyword } from '../../../src/keywords/expand';
import { HOOK_IMPLS } from '../../../src/keywords/hooks';
import { actionNeeds, expansionNeeds } from '../../../src/keywords/needs';
import { createKeywordRegistry, keywordRegistry } from '../../../src/keywords/registry';
import { HOOK_NAMES, type ExpandContext, type KeywordDefData } from '../../../src/keywords/types';
import { keywordDataProblems } from '../../../src/keywords/validate';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { parseManaCost } from '../../../src/types/mana';
import { SRC_ROOT, find, keyword, labels, scenario, synth } from '../helpers';
import { SAMPLES } from './samples';

const ctx: ExpandContext = { granted: false, faceName: 'Test', types: ['Creature'], keyPrefix: 'k:0:0' };
const cost = (m: string) => ({ mana: parseManaCost(m)! });
const kwi = (keyword: string, rest: Partial<KeywordAbilityDef> = {}): KeywordAbilityDef => ({ kind: 'keyword', text: keyword, keyword, ...rest });
const data = (name: string) => keywordRegistry.get(name)!;
const dataJson = (name: string): AbilityDef[] => data(name).expand as AbilityDef[];
const expanded = (label: string): AbilityDef[] => expandKeyword(data(SAMPLES[label]!.keyword), SAMPLES[label]!, ctx);

/** Every `{op:'action'}` name used anywhere in a keyword's expansion. */
function actionsUsed(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => actionsUsed(n, out));
  else if (node !== null && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (o['op'] === 'action' && typeof o['action'] === 'string') out.add(o['action']);
    Object.values(o).forEach((v) => actionsUsed(v, out));
  }
  return out;
}

describe('CR 702.85, 701.x: an implemented keyword never uses a keyword action the engine has no macro for', () => {
  it('every {op:action} of an implemented expansion has a registered macro (cascade has its native one since WP32)', () => {
    for (const d of keywordRegistry.all().filter((k) => k.status === 'implemented' && k.expand !== undefined)) {
      for (const a of actionsUsed(d.expand)) expect(ACTION_MACROS[a as KeywordActionName], `${d.name} uses action ${a} without a macro`).toBeDefined();
    }
  });

  it('cascade is implemented (WP32) and keyword:cascade is a capability exactly because action:cascade is (its native handler, feature:action.native.cascade)', () => {
    expect(data('cascade').status).toBe('implemented');
    expect(ENGINE_CAPABILITIES.has('feature:action.native.cascade')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('action:cascade')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:cascade')).toBe(true);
  });

  it('the checker can fail: a fake implemented keyword that uses an unregistered action is found', () => {
    const fake: KeywordDefData = {
      name: 'zap', rule: '702.1', params: [], mechanisms: ['expands'], reminder: '', multiple: 'independent', status: 'implemented',
      expand: [{ kind: 'triggered', text: 't', effect: { targets: [], steps: [{ op: 'action', action: 'clash', who: { ref: 'you' } }] } }],
    };
    expect([...actionsUsed(fake.expand)]).toEqual(['clash']); // PUSH1 T1: proliferate is registered now (native); M12-3: goad too; clash is not
    expect(ACTION_MACROS['clash']).toBeUndefined();
  });
});

describe('design 5.2: keyword:<name> of an expansion keyword needs the capabilities of its expansion', () => {
  it('expansionNeeds reads the discriminators of the expansion: ops, actions, events, conditions, quantities, refs, statics, bodies, durations, cost parts', () => {
    const ward = expansionNeeds(data('ward'));
    expect(ward).toEqual(expect.arrayContaining(['ev:becomes', 'op:pay', 'op:counter', 'ref:event', 'ref:controllerOf']));
    expect(expansionNeeds(data('storm'))).toEqual(expect.arrayContaining(['ev:cast', 'op:copy', 'q:spellsBefore']));
    expect(expansionNeeds(data('prowess'))).toEqual(expect.arrayContaining(['op:effect', 'static:continuous', 'dur:endOfTurn', 'layer:7c']));
    expect(expansionNeeds(data('buyback'))).toEqual(expect.arrayContaining(['static:additionalCost', 'static:replace', 'body:modify', 'cond:wasCast', 'feature:replace.cause']));
    expect(expansionNeeds(data('ninjutsu'))).toEqual(expect.arrayContaining(['cost:reveal', 'cost:returnToHand', 'feature:activate.onlyIf', 'cond:turnOf']));
    expect(expansionNeeds(data('cycling'))).toEqual(expect.arrayContaining(['cost:discard', 'cost:discard.self', 'op:draw']));
    expect(expansionNeeds(data('typecycling'))).toEqual(expect.arrayContaining(['cost:discard', 'op:search', 'op:shuffle']));
    expect(expansionNeeds(data('flying'))).toEqual([]); // a flag keyword has no expansion
  });

  it('needs are sorted, without duplicates, and a function of the data alone', () => {
    for (const d of keywordRegistry.all().filter((k) => k.expand !== undefined || k.modifies !== undefined)) {
      const needs = expansionNeeds(d);
      expect(needs, d.name).toEqual([...new Set(needs)].sort());
      expect(expansionNeeds(d), d.name).toEqual(needs);
    }
  });

  it('a wrapper keyword (exhaust) and a modal keyword (entwine) have needs from what they modify', () => {
    expect(expansionNeeds(data('exhaust'))).toEqual(expect.arrayContaining(['feature:limit.game']));
    expect(expansionNeeds(data('entwine'))).toEqual(expect.arrayContaining(['static:additionalCost', 'feature:modes.override']));
  });

  it('keywordCapabilities withholds keyword:X while a need is missing, and adds it the moment the need exists (fake registry)', () => {
    const base = { rule: '702.1', params: [], mechanisms: ['expands' as const], reminder: '', multiple: 'independent' as const, status: 'implemented' as const };
    const reg = createKeywordRegistry([
      { ...base, name: 'zap', expand: [{ kind: 'triggered', text: 't', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } }] },
      { ...base, name: 'zip', expand: [{ kind: 'triggered', text: 't', effect: { targets: [], steps: [{ op: 'pay', who: { ref: 'you' }, cost: {}, else: [] }] } }] },
      { ...base, name: 'plain', mechanisms: ['flag' as const], readers: ['a.ts#f'] },
      { ...base, name: 'old', status: 'native' as const },
    ]);
    const kws = (available: string[]): string[] => keywordCapabilities(reg, new Set(available)).filter((c) => c.startsWith('keyword:'));
    expect(kws([])).toEqual(['keyword:old', 'keyword:plain']);
    expect(kws(['op:draw', 'ref:you'])).toEqual(['keyword:old', 'keyword:plain', 'keyword:zap']);
    expect(kws(['op:draw', 'ref:you', 'op:pay'])).toEqual(['keyword:old', 'keyword:plain', 'keyword:zap', 'keyword:zip']);
  });

  it('action:<name> of a registered macro whose expansion can run counts as available for a keyword that uses that action', () => {
    const base = { rule: '702.1', params: [], mechanisms: ['expands' as const], reminder: '', multiple: 'independent' as const, status: 'implemented' as const };
    const reg = createKeywordRegistry([
      { ...base, name: 'sleuth', expand: [{ kind: 'triggered', text: 't', effect: { targets: [], steps: [{ op: 'action', action: 'investigate', who: { ref: 'you' } }] } }] },
    ]);
    const investigate = actionNeeds(ACTION_MACROS.investigate!); // createToken, ref:you (WP15 review: the macro is advertised only when its expansion can run)
    // M6-12: the general walker's names count too (keywords/needs.ts#expansionNeeds): the `action` step itself is `op:action`
    expect(keywordCapabilities(reg, new Set(['ref:you', 'op:action', ...investigate])).filter((c) => c.startsWith('keyword:'))).toEqual(['keyword:sleuth']);
    expect(keywordCapabilities(reg, new Set(['ref:you'])).filter((c) => c.startsWith('keyword:'))).toEqual([]);
    expect(keywordCapabilities(reg, new Set()).filter((c) => c.startsWith('keyword:'))).toEqual([]);
  });

  it('the real engine: keyword:X is advertised for an implemented expansion keyword iff every need is in the other capabilities (nothing is falsely supported)', () => {
    for (const d of keywordRegistry.all().filter((k) => k.status === 'implemented' && (k.expand !== undefined || k.modifies !== undefined))) {
      const missing = expansionNeeds(d).filter((n) => !ENGINE_CAPABILITIES.has(n));
      expect(ENGINE_CAPABILITIES.has(`keyword:${d.name}`), `${d.name} (missing: ${missing.join(', ')})`).toBe(missing.length === 0);
    }
  });

  it('keyword:ward is advertised only with every capability its expansion needs: op:pay, op:counter and the trigger "becomes the target" (feature:ev.becomes.targeted)', () => {
    // op:pay (WP10) and op:counter (WP14) exist since the W2 merge; WP32 made triggered abilities emit `becameTarget` too, so every targeting spell or ability is
    // seen and the form is advertised (end to end: test/m5/triggers/wp32-ward.test.ts)
    expect(ENGINE_CAPABILITIES.has('op:pay') && ENGINE_CAPABILITIES.has('op:counter')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.targeted')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:ward')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:flashback')).toBe(true); // native: the engine acts on it
    expect(ENGINE_CAPABILITIES.has('keyword:flying')).toBe(true); // flag keywords have no expansion to gate
  });
});

describe('CR 702.51a, 702.51b: convoke taps creatures of the CASTER and is advertised once casting calls the hook', () => {
  const convoker = () => synth({ name: 'Test Convoke', cost: '{4}{G}', type: 'Sorcery', abilities: [keyword('convoke')] });
  const s = scenario(['Grizzly Bears', 'Serra Angel', 'Vampire Nighthawk'], {
    p1: { hand: ['Test Convoke'], battlefield: ['Grizzly Bears', 'Serra Angel'] },
    p2: { battlefield: ['Vampire Nighthawk'] },
    defs: [convoker()],
  });

  it('paymentOptions takes the caster: a spell cast by another player than its owner offers the caster\'s creatures (CR 702.51a "you control")', () => {
    const spell = find(s, 'Test Convoke', 'hand', 'p1');
    expect(hookpoints.paymentOptions(gameOf(s), spell, 'p1')[0]!.reduces).toEqual({ generic: 2, colors: ['W', 'G'] });
    expect(hookpoints.paymentOptions(gameOf(s), spell, 'p2')[0]!.reduces).toEqual({ generic: 1, colors: ['B'] });
  });

  it('convoke is implemented now that WP7 calls paymentOptions in casting (castCheck and the payment step): the call-sites are its readers', () => {
    expect(engineFilesCalling('paymentOptions')).toEqual(['rules/payment-options.ts']);
    expect(data('convoke').status).toBe('implemented');
    expect(data('convoke').readers).toEqual(['rules/payment-options.ts#payableWithOptions', 'rules/payment-options.ts#applyPaymentOptions']);
    expect(ENGINE_CAPABILITIES.has('keyword:convoke')).toBe(true);
  });

  it('integration (WP3 hook + WP7 casting): with the real keyword provider, a convoke spell is listed when the creatures make up the missing mana, and not otherwise', () => {
    const short = scenario(['Forest', 'Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Test Convoke'], battlefield: ['Forest', 'Grizzly Bears', 'Hill Giant'] }, defs: [synth({ name: 'Test Convoke', cost: '{2}{G}', type: 'Sorcery', abilities: [keyword('convoke')] })] });
    expect(labels(short, 'p1')).toContain('Cast Test Convoke');
    const alone = scenario(['Forest'], { p1: { hand: ['Test Convoke'], battlefield: ['Forest'] }, defs: [synth({ name: 'Test Convoke', cost: '{2}{G}', type: 'Sorcery', abilities: [keyword('convoke')] })] });
    expect(labels(alone, 'p1')).not.toContain('Cast Test Convoke');
  });

  it('the hook is registered for convoke (the implementation exists and is tested), and the implemented keyword lists its readers', () => {
    expect(typeof HOOK_IMPLS['convoke']!.paymentOptions).toBe('function');
  });
});

/** Engine source files (outside keywords/ and the hookpoint's own file) that mention `fn(`: the call-sites. */
function engineFilesCalling(fn: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) {
        const rel = p.slice(SRC_ROOT.length + 1).replace(/\\/g, '/');
        if (rel.startsWith('keywords/') || rel === 'rules/hookpoints.ts') continue;
        if (new RegExp(`\\.${fn}\\(`).test(readFileSync(p, 'utf8'))) out.push(rel);
      }
    }
  };
  walk(SRC_ROOT);
  return out.sort();
}

describe('CR 702.27a, 608.2b, 701.6a: buyback returns the spell to hand only as it RESOLVES', () => {
  const replacement = () => (dataJson('buyback')[1] as unknown as { effects: { replaces: Record<string, unknown> }[] }).effects[0]!.replaces;

  it('the replacement matches the stack-to-graveyard move only when its cause is "resolve" (a countered or fizzled spell stays in the graveyard)', () => {
    expect(replacement()).toEqual({ ev: 'zoneChange', subject: { self: true }, from: 'stack', to: 'graveyard', cause: 'resolve' });
  });

  it('flashback\'s replacement still applies any time the spell would leave the stack (CR 702.34a): no cause', () => {
    const f = (data('flashback').expand as { effects: { replaces: Record<string, unknown> }[] }[])[1]!.effects[0]!.replaces;
    expect(f).not.toHaveProperty('cause');
  });

  it('keyword:buyback needs the engine to read the cause of the move (feature:replace.cause, M6-5a; was feature:event.cause), so it never returns a countered spell to hand', () => {
    expect(expansionNeeds(data('buyback'))).toContain('feature:replace.cause');
    // M6-5a (m6 design D12) registered it in effects/propose.ts; the countered and fizzled cases are pinned in test/m6/costs/cast-costs.test.ts
    expect(ENGINE_CAPABILITIES.has('feature:replace.cause')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:buyback')).toBe(true);
  });
});

describe('CR 702.40a: storm counts the spells cast BEFORE it, fixed when it is cast', () => {
  const copy = () => ((dataJson('storm')[0] as unknown as { effect: { steps: EffectStep[] } }).effect.steps[0]) as Extract<EffectStep, { op: 'copy' }>;

  it('the copy count is the cast event\'s count of earlier spells, not a count taken when the trigger resolves (a spell cast in response is not counted)', () => {
    expect(copy().count).toEqual({ q: 'spellsBefore' });
  });

  it('the cast event documents spellsBefore as the spells of ALL players cast this turn before this one (storm counts every player\'s spells)', () => {
    const text = readFileSync(join(SRC_ROOT, 'types/events.ts'), 'utf8');
    const line = text.split('\n').find((l) => l.includes("type: 'spellCast'"))!;
    expect(line).toMatch(/all players/i);
    expect(line).not.toMatch(/the player had cast/i);
  });

  it('q:spellsBefore is evaluated (from the cast event, effects/eval.ts), and with op:copy (WP14) keyword:storm is advertised', () => {
    expect(ENGINE_CAPABILITIES.has('q:spellsBefore')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('op:copy')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('keyword:storm')).toBe(true);
  });
});

describe('CR 702.49a, 702.49c: ninjutsu needs an UNBLOCKED attacker, so it is activated once blockers are declared', () => {
  const ability = () => dataJson('ninjutsu')[0] as unknown as { onlyIf?: unknown };

  it('activation is limited to the declare blockers step and later (CR 509.1h: a creature is unblocked only when blockers are declared)', () => {
    expect(ability().onlyIf).toEqual({ cond: 'turnOf', whose: 'you', step: ['declareBlockers', 'combatDamage', 'endCombat'] });
  });

  // std-typechange-1: the deviation is closed; the move itself names the defender of the returned creature (Destination `attacking: { asReturned: true }`)
  it('CR 702.49c: the card enters tapped and attacking what the returned creature attacked, with no manual step', () => {
    const steps = (dataJson('ninjutsu')[0] as unknown as { effect: { steps: EffectStep[] } }).effect.steps;
    expect(steps.map((s) => s.op)).toEqual(['move']);
    expect(steps[0]).toMatchObject({ op: 'move', to: { zone: 'battlefield', tapped: true, attacking: { asReturned: true } } });
    expect(ENGINE_CAPABILITIES.has('keyword:ninjutsu')).toBe(true);
  });
});

describe('CR 702.42a: entwine says that paying its cost chooses all modes', () => {
  it('the data says that every mode is chosen when the entwine cost was paid, next to the additional cost (actions/cast.ts#spellPrograms applies it at announcement as ModeSpec.override with the mode count of the card, CR 601.2b)', () => {
    expect(data('entwine').modifies).toEqual({ kind: 'modal', chooseAll: { when: { cond: 'wasCast', kicked: 'entwine' } } });
    expect(expansionNeeds(data('entwine'))).toContain('feature:modes.override');
    // M6-5a: static:additionalCost is registered; the lowering does not touch the modifier, actions/cast.ts#spellPrograms (withModalKeywords) turns it into
    // the override when the spell is announced (test/m6/costs/cast-costs.test.ts)
    expect(ENGINE_CAPABILITIES.has('keyword:entwine')).toBe(true);
  });

  it('a keyword with a modal modifier may also expand (the cost is an ability, the mode choice a modifier of the spell); an activated modifier may not', () => {
    const { hookImpl: _hooks, special: _special, ...entwine } = data('entwine');
    expect(keywordDataProblems(entwine)).toEqual([]);
    expect(keywordDataProblems({ ...(({ hookImpl: _h, special: _s, ...rest }) => rest)(data('exhaust')), expand: [{ kind: 'static', text: 't' }] }).join('\n')).toContain('no expand');
  });
});

describe('CR 702.21a: ward\'s payer is the controller of the targeting spell or ability, whatever the event role "player" means', () => {
  it('who pays is controllerOf(event spell), not {ref:event, role:player}', () => {
    const pay = ((dataJson('ward')[0] as unknown as { effect: { steps: EffectStep[] } }).effect.steps[0]) as Extract<EffectStep, { op: 'pay' }>;
    expect(pay.who).toEqual({ ref: 'controllerOf', object: { ref: 'event', role: 'spell' } });
  });

  it('the design sentence (3.5) names the role "player" as the controller of the targeting spell or ability', () => {
    const doc = readFileSync(join(SRC_ROOT, '../../../docs/design/m5-ability-model.md'), 'utf8');
    expect(doc).not.toContain("player (that object's controller)");
  });
});

describe('CR 702.24a: cumulative upkeep does nothing if the permanent has left the battlefield (intervening if, CR 603.4)', () => {
  it('the trigger has the intervening "if this permanent is on the battlefield"', () => {
    const t = dataJson('cumulative upkeep')[0] as unknown as { interveningIf?: unknown };
    expect(t.interveningIf).toEqual({ cond: 'matches', object: { ref: 'self' }, filter: { zone: 'battlefield' } });
  });
});

describe('display text of generated abilities', () => {
  it('affinity reads "Affinity for artifacts" (CR 702.41a)', () => {
    expect(expanded('affinity for artifacts')[0]!.text).toBe('Affinity for artifacts');
  });

  it('ward with a non-mana cost reads "unless that player pays 3 life" (CR 702.21a), with one full stop', () => {
    expect(expanded('ward -- pay 3 life')[0]!.text).toBe('Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless that player pays 3 life.');
    expect(expanded('ward {2}')[0]!.text).toBe('Whenever ~ becomes the target of a spell or ability an opponent controls, counter that spell or ability unless that player pays {2}.');
  });

  it('typecycling and equip keep the printed keyword text (CR 702.29e)', () => {
    expect(expanded('basic landcycling {1}')[0]!.text).toBe('Basic landcycling {1}');
    expect(expanded('equip {3} to a legendary creature')[0]!.text).toBe('Equip legendary creature {3}');
    expect(expanded('cycling -- pay 2 life')[0]!.text).toBe('Cycling—Pay 2 life');
  });

  it('equip\'s target prompt says "target creature you control" only for the unrestricted form', () => {
    const prompt = (label: string): string => ((expanded(label)[0] as unknown as { effect: { targets: { text: string }[] } }).effect.targets[0]!.text);
    expect(prompt('equip {1}')).toBe('target creature you control');
    expect(prompt('equip {3} to a legendary creature')).toBe('target creature');
  });
});

describe('printed keyword lines carry only what is printed: prowl and amplify have no quality or filter parameter (CR 702.76a, 702.38a)', () => {
  it('prowl is a cost only; amplify is a number only (the creature type comes from the card itself)', () => {
    expect(data('prowl').params.map((p) => p.name)).toEqual(['cost']);
    expect(data('amplify').params.map((p) => p.name)).toEqual(['amount']);
    expect(data('prowl').reminder).not.toContain('{quality}');
    expect(data('amplify').reminder).not.toContain('{quality}');
  });
});

describe('CR 702.29f, 702.33c: a typecycling ability is a cycling ability, a multikicker cost is a kicker cost', () => {
  it('generated abilities carry the provenance of the family, so "when you cycle" and kicker links see them', () => {
    expect(keywordRegistry.expand(SAMPLES['basic landcycling {1}']!, ctx)[0]!.prov).toEqual({ by: 'keyword', id: 'cycling', reviewed: true });
    expect(keywordRegistry.expand(SAMPLES['multikicker {1}{B}']!, ctx)[0]!.prov).toEqual({ by: 'keyword', id: 'kicker', reviewed: true });
    expect(keywordRegistry.expand(SAMPLES['kicker {2}{G}']!, ctx)[0]!.prov).toEqual({ by: 'keyword', id: 'kicker', reviewed: true });
  });

  it('the family must name another keyword of the library', () => {
    const base: KeywordDefData = { name: 'zap', rule: '702.1', params: [], mechanisms: ['flag'], reminder: '', multiple: 'redundant', status: 'planned' };
    expect(keywordDataProblems({ ...base, family: 'cycling' })).toEqual([]);
    expect(keywordDataProblems({ ...base, family: 7 })).not.toEqual([]);
    expect(() => createKeywordRegistry([{ ...base, family: 'nothing' }])).toThrow(/family/);
  });
});

describe('CR 702.16g, 702.14e, 702.11f: instances with DIFFERENT qualities are separate abilities', () => {
  it('protection, landwalk and hexproof are redundant only for the same parameter', () => {
    for (const n of ['protection', 'landwalk', 'hexproof']) expect(data(n).multiple, n).toBe('redundantPerParam');
    expect(data('flying').multiple).toBe('redundant');
  });
});

describe('CR 702.33f, 607.2i: two kicker costs of one card are told apart', () => {
  const name = (a: AbilityDef): string => (a as unknown as { effects: { name: string }[] }).effects[0]!.name;

  it('the first kicker cost is "kicker", the second "kicker:2" (ExpandContext.ordinal, 1 by default)', () => {
    expect(name(keywordRegistry.expand(SAMPLES['kicker {2}{G}']!, ctx)[0]!)).toBe('kicker');
    expect(name(keywordRegistry.expand(SAMPLES['kicker {2}{G}']!, { ...ctx, ordinal: 2 })[0]!)).toBe('kicker:2');
    expect(name(keywordRegistry.expand(SAMPLES['multikicker {1}{B}']!, { ...ctx, ordinal: 2 })[0]!)).toBe('kicker:2');
    expect(name(keywordRegistry.expand(kwi('buyback', { cost: cost('{3}') }), { ...ctx, ordinal: 2 })[0]!)).toBe('buyback'); // only kicker costs are numbered
  });
});

describe('registry hardening: loaded keyword definitions cannot be edited', () => {
  it('get() hands out frozen definitions: changing the status of ward throws and changes nothing', () => {
    const ward = keywordRegistry.get('ward')!;
    expect(Object.isFrozen(ward)).toBe(true);
    expect(() => { (ward as { status: string }).status = 'planned'; }).toThrow();
    expect(keywordRegistry.get('ward')!.status).toBe('implemented');
    expect(Object.isFrozen(ward.special)).toBe(true);
  });

  it('all() is a copy: sorting or emptying the answer does not touch the registry', () => {
    const all = keywordRegistry.all() as unknown[];
    expect(all).not.toBe(keywordRegistry.all());
    const n = all.length;
    try { all.length = 0; } catch { /* a frozen copy is fine too */ }
    expect(keywordRegistry.all()).toHaveLength(n);
  });

  it('the hook slot is still filled by bindHooks and read through the frozen definition', () => {
    expect(keywordRegistry.get('flying')!.hookImpl).toBe(HOOK_IMPLS['flying']);
  });

  it('capabilities() says what it contains: keyword names only (action: names come from keywordCapabilities)', () => {
    expect(keywordRegistry.capabilities().every((c) => c.startsWith('keyword:'))).toBe(true);
    const src = readFileSync(join(SRC_ROOT, 'keywords/types.ts'), 'utf8');
    expect(src).not.toContain('`action:<name>` for every implemented action');
  });
});

describe('CR 701.35a: detain', () => {
  const you = { ref: 'you' } as const;
  const step = (rest: Partial<ActionStep>): ActionStep => ({ op: 'action', action: 'detain', who: you, ...rest });

  it('until your next turn the permanent can\'t attack or block and its activated abilities can\'t be activated', () => {
    const target = { ref: 'target', id: 't0' } as const;
    const out = ACTION_MACROS.detain!.expand!(step({ subject: target }));
    expect(out).toEqual([
      {
        op: 'effect',
        effects: [
          { s: 'restrict', subject: target, mode: 'cant', action: 'attack' },
          { s: 'restrict', subject: target, mode: 'cant', action: 'block' },
          { s: 'restrict', subject: target, mode: 'cant', action: 'activate' },
        ],
        duration: { d: 'untilNextTurn', whose: you },
      },
    ]);
  });

  it('it is the controller of the detaining spell or ability whose next turn ends it (not the step\'s `who`); without a subject it is manual', () => {
    const out = ACTION_MACROS.detain!.expand!(step({ subject: { ref: 'bound', name: 'x' }, who: { ref: 'anOpponent' } }));
    expect((out[0] as Extract<EffectStep, { op: 'effect' }>).duration).toEqual({ d: 'untilNextTurn', whose: you });
    expect(ACTION_MACROS.detain!.expand!(step({}))[0]).toMatchObject({ op: 'manual' });
  });
});

describe('test drift guards', () => {
  it('every keyword with an expansion has a sample (so the snapshot and the type-check file cover it)', () => {
    const sampled = new Set(Object.values(SAMPLES).map((s) => s.keyword));
    const missing = keywordRegistry.all().filter((d) => d.expand !== undefined && !sampled.has(d.name)).map((d) => d.name);
    expect(missing).toEqual([]);
  });

  it('HOOK_NAMES is exactly the method list of the KeywordHooks interface', () => {
    const src = readFileSync(join(SRC_ROOT, 'keywords/types.ts'), 'utf8');
    const body = src.slice(src.indexOf('export interface KeywordHooks'), src.indexOf('export interface PaymentOption'));
    const methods = [...body.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]!).sort();
    expect([...HOOK_NAMES].sort()).toEqual(methods);
  });
});
