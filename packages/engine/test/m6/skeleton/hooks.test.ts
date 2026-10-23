/**
 * M6-0 (m6 design 2.6, 4.1): every hook insertion calls its registry. Each test adds a TEST PART for the duration of the test (test/m6/helpers.ts
 * `withEntries`, `withEntry`) and shows the call-site uses it; with the registries empty (M6-0) the milestone 5 behavior is unchanged (the M5 and M3/M4
 * suites, the action-log replays and the soak tallies are the proof of that, see behavior-neutral.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, viewFor, type AbilityDef, type CostDef, type GameObject, type GameState } from '../../../src/index';
import { castCheck, castMethods } from '../../../src/actions/cast';
import { CAST_OPTION_PROVIDERS, type CastOptionProvider } from '../../../src/actions/cast-options';
import type { BaseChars } from '../../../src/rules/characteristics';
import { Game } from '../../../src/core/game';
import { MOVE_PARTS, RESOLVE_PERMANENT_PARTS, SPECIAL_ACTION_HANDLERS, TURN_BASED, VIEW_PARTS, type SpecialActionHandler } from '../../../src/core/registries';
import { moveObject } from '../../../src/core/zones';
import { performStateBasedActions } from '../../../src/core/sba';
import { CHANGE_FACE, changeFace } from '../../../src/effects/handlers/change-face';
import { propose } from '../../../src/effects/propose';
import { applicable, bodyFits } from '../../../src/effects/replacements';
import { ENTERS_PARTS, IMMEDIATE_CHECKS, RULE_REPLACEMENTS, type EntersPart } from '../../../src/effects/registries';
import { baseChars } from '../../../src/rules/base-chars';
import { BASE_PARTS } from '../../../src/rules/registries';
import { deny } from '../../../src/rules/denial';
import type { CharAbility, LiveEffect } from '../../../src/statics/api';
import { computeAll, INTRINSIC_PARTS, intrinsicChars, LAYER_TABLE, RULE_EFFECTS } from '../../../src/statics/layers';
import { withStatics } from '../../m5/helpers';
import { toStep } from '../../m4/helpers';
import { act, ctxOn, drive, find, scenario, tweak, withEntries, withEntry } from '../helpers';

// ---- a test cast option (m6 design 2.6: CastOptionProvider) --------------------------------------------------------------------------------------------

/** The characteristics a face-down spell has from the moment it is announced (CR 708.4): a 2/2 creature with no name, cost or abilities. */
const FACE_DOWN_CHARS: BaseChars = {
  name: '', names: [], face: 0, combined: false, manaCost: null, manaValue: 0, colors: [], supertypes: [], types: ['Creature'], subtypes: [], abilities: [], keywords: [],
  power: '2', toughness: '2',
};
const THREE: CostDef = { mana: [{ kind: 'generic', amount: 3 }] };

function testProvider(over: Partial<CastOptionProvider> = {}): CastOptionProvider {
  return {
    name: 'testFaceDown',
    offers: (_g, o) => o.zone === 'hand',
    cost: () => THREE,
    charsOverride: () => ({ ...FACE_DOWN_CHARS, names: [], colors: [], supertypes: [], types: ['Creature'], subtypes: [], abilities: [], keywords: [] }),
    onStack: (_g, spell) => { spell.stack!.flags = [...(spell.stack!.flags ?? []), 'test-provider']; },
    ...over,
  };
}

const boltHand = (lands = 3) => scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: Array(lands).fill('Mountain') as string[] }, p2: { battlefield: ['Grizzly Bears'] } });

describe('M6-0: castCheck judges a cast option provider\'s charsOverride (m6 design 2.6, CR 708.4, 718.3a-b, 712.8c)', () => {
  it('the provider is a cast method of the card it offers, listed by legalActions', () => {
    const s = boltHand();
    const bolt = find(s, 'Lightning Bolt', 'hand');
    withEntries(CAST_OPTION_PROVIDERS, [testProvider()], () => {
      expect(castMethods(s, bolt, 0)).toContain('testFaceDown');
      expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && (a.action as { method?: string }).method === 'testFaceDown')).toBe(true);
    });
    expect(castMethods(s, bolt, 0)).not.toContain('testFaceDown');
  });

  it('timing is judged on the overriding characteristics: an instant cast as a 2/2 creature has sorcery timing (CR 307.1, 302.1)', () => {
    const s = toStep(boltHand(), 'beginCombat');
    const bolt = find(s, 'Lightning Bolt', 'hand');
    expect('info' in castCheck(s, 'p1', bolt)).toBe(true); // an instant, at instant speed
    withEntries(CAST_OPTION_PROVIDERS, [testProvider()], () => {
      const r = castCheck(s, 'p1', bolt, undefined, 'testFaceDown');
      expect('denial' in r && r.denial.message).toMatch(/main phase|sorcery|stack is empty/i);
    });
  });

  it('a prohibition ("can\'t cast") is judged on the overriding characteristics: they reach the canCast hook', () => {
    const s = boltHand();
    const bolt = find(s, 'Lightning Bolt', 'hand');
    const noCreatures = { canCast: (_g: unknown, _spell: string, _p: string, _f: number, via: { chars?: { types: string[] } }) => (via.chars?.types.includes('Creature') ? deny('Creature spells can\'t be cast.', 'CR 101.2') : null) };
    withStatics(noCreatures as never, () => withEntries(CAST_OPTION_PROVIDERS, [testProvider()], () => {
      expect('info' in castCheck(s, 'p1', bolt)).toBe(true);
      const r = castCheck(s, 'p1', bolt, undefined, 'testFaceDown');
      expect('denial' in r && r.denial.message).toBe('Creature spells can\'t be cast.');
    }));
  });

  it('the provider\'s cost replaces the mana cost (CR 118.9): {3} needs three lands', () => {
    withEntries(CAST_OPTION_PROVIDERS, [testProvider()], () => {
      const poor = boltHand(1);
      expect('denial' in castCheck(poor, 'p1', find(poor, 'Lightning Bolt', 'hand'), undefined, 'testFaceDown')).toBe(true);
      const rich = boltHand(3);
      expect('info' in castCheck(rich, 'p1', find(rich, 'Lightning Bolt', 'hand'), undefined, 'testFaceDown')).toBe(true);
    });
  });

  it('a provider that does not offer the card denies the method; its extra targets are required (CR 601.2c)', () => {
    const s = boltHand();
    const bolt = find(s, 'Lightning Bolt', 'hand');
    withEntries(CAST_OPTION_PROVIDERS, [testProvider({ offers: () => false })], () => expect('denial' in castCheck(s, 'p1', bolt, undefined, 'testFaceDown')).toBe(true));
    const artifactTarget = { id: 'mt', kind: 'object' as const, filter: { types: ['Artifact'] }, min: 1, max: 1, text: 'target artifact' };
    withEntries(CAST_OPTION_PROVIDERS, [testProvider({ extraTargets: () => [artifactTarget] })], () => {
      const r = castCheck(s, 'p1', bolt, undefined, 'testFaceDown');
      expect('denial' in r && r.denial.rules).toContain('CR 601.2c'); // no artifact to target
    });
  });

  it('onStack gives the spell its status as it is put onto the stack', () => {
    let s = boltHand();
    const bolt = find(s, 'Lightning Bolt', 'hand');
    withEntries(CAST_OPTION_PROVIDERS, [testProvider()], () => {
      const r = applyAction(s, { type: 'cast', player: 'p1', card: bolt, method: 'testFaceDown' });
      expect(r.error).toBeUndefined();
      s = r.state;
    });
    const spell = Object.values(s.objects).find((o) => o.zone === 'stack' && o.defId === 'Lightning Bolt');
    expect(spell?.stack?.flags).toContain('test-provider');
  });
});

// ---- the fast path and the 1b part (m6 design E16) ----------------------------------------------------------------------------------------------------

describe('M6-0, E16: fast path = computeAll for a face-down permanent with no other layer source, before and after an in-place turn face down', () => {
  it('with the 1b part (M6-3 replaced the test part of M6-0 by statics/face-down.ts), intrinsicChars (INTRINSIC_PARTS) and computeAll (RULE_EFFECTS, LAYER_TABLE 1b) agree', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    expect([INTRINSIC_PARTS.length, RULE_EFFECTS.length, Object.hasOwn(LAYER_TABLE, '1b')]).toEqual([2, 4, true]); // M6-9: the merged permanent's parts (statics/merge.ts); FAST5X E12: the suspected permanent's layer 6 effect (statics/suspect.ts); std-ra: hone counters (statics/hone.ts)
    expect(intrinsicChars(s0, s0.objects[bears]!)).toEqual(computeAll(s0).get(bears)); // face up
    const s = tweak(s0, (t) => Object.assign(t.objects[bears]!, { faceDown: true, faceDownInfo: { by: 'effect', profile: 'ward2' } })); // turned face down in place
    const fast = intrinsicChars(s, s.objects[bears]!);
    expect(fast).toEqual(computeAll(s).get(bears));
    expect(fast).toMatchObject({ name: '', power: '2', toughness: '2', types: ['Creature'] });
    expect(fast.keywords.map((k) => k.keyword)).toEqual(['ward']);
  });

  it('with the plain profile (M6-3; before it, the milestone 5 base), a face-down 2/2 is what both paths give', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = tweak(s0, (t) => { t.objects[bears]!.faceDown = true; });
    expect(intrinsicChars(s, s.objects[bears]!)).toEqual(computeAll(s).get(bears));
    expect(intrinsicChars(s, s.objects[bears]!)).toMatchObject({ name: '', power: '2', toughness: '2', abilities: [] });
  });
});

// ---- the other call-sites ---------------------------------------------------------------------------------------------------------------------------------

describe('M6-0: the hook insertions call their registries', () => {
  it('special actions: a handler\'s listing is a legal action (kind "special"), performed through the handler; an unlisted object is rejected (CR 116.2)', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const performed: string[] = [];
    const handler: SpecialActionHandler = {
      kind: 'testSpecial',
      list: (_g, player) => (player === 'p1' ? [{ object: bears, label: 'Test special', cost: null }] : []),
      perform: (g, a) => { if (a.object !== bears) throw new Error('not listed'); performed.push(a.object); g.log('test special'); },
    };
    withEntries(SPECIAL_ACTION_HANDLERS, [handler], () => {
      const listed = legalActions(s, 'p1').filter((a) => a.kind === 'special');
      expect(listed).toEqual([{ action: { type: 'special', player: 'p1', kind: 'testSpecial', object: bears }, kind: 'special', label: 'Test special', isMana: false, object: bears }]);
      const after = act(s, listed[0]!.action);
      expect(performed).toEqual([bears]);
      expect(after.pending).toMatchObject({ kind: 'priority', player: 'p1' }); // CR 116.3: the player keeps priority
    });
    expect(applyAction(s, { type: 'special', player: 'p1', kind: 'testSpecial', object: bears }).error?.rules).toContain('CR 116.1');
  });

  it('MOVE_PARTS: afterLeave and beforeEnter run after the new object exists and before the zoneChanged event, with the proposal\'s facts', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const g = new Game(s);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const seen: string[] = [];
    withEntries(MOVE_PARTS, [{ afterLeave: (gg, old, newId) => seen.push(`leave ${old.zone} -> ${newId !== null && gg.s.objects[newId] !== undefined}`), beforeEnter: (gg, o) => seen.push(`enter ${o.zone} events=${gg.events.length}`) }], () => {
      propose(g, { ev: 'zoneChange', object: { id: bears, zone: 'battlefield' }, from: 'battlefield', to: 'graveyard', destination: { cause: 'test' } });
    });
    expect(seen).toEqual(['leave battlefield -> true', 'enter graveyard events=0']);
    expect(g.events.map((e) => e.type)).toContain('zoneChanged');
  });

  it('RESOLVE_PERMANENT_PARTS: `options` changes how a permanent spell enters, `instead` takes the resolution over (CR 608.3)', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Grizzly Bears', 'hand') })); // auto-paid
    const tapped = withEntries(RESOLVE_PERMANENT_PARTS, [{ options: (_g, _spell, opts) => ({ ...opts, tapped: true }) }], () => act(act(s, { type: 'pass', player: 'p1' }), { type: 'pass', player: 'p2' }));
    expect(tapped.objects[find(tapped, 'Grizzly Bears', 'battlefield')]!.tapped).toBe(true);
    const taken = withEntries(RESOLVE_PERMANENT_PARTS, [{ instead: (g, spell) => { moveObject(g, spell.id, 'exile', { cause: 'test' }); return true; } }], () => act(act(s, { type: 'pass', player: 'p1' }), { type: 'pass', player: 'p2' }));
    expect(taken.zones.exile.map((id) => taken.objects[id]!.defId)).toContain('Grizzly Bears');
  });

  it('IMMEDIATE_CHECKS run after every performed event and first in each state-based action check', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const g = new Game(s);
    let calls = 0;
    withEntries(IMMEDIATE_CHECKS, [() => { calls++; }], () => {
      propose(g, { ev: 'life', change: 'gain', player: 'p1', amount: 2 });
      expect(calls).toBe(1);
      performStateBasedActions(g);
      expect(calls).toBe(2);
    });
  });

  it('TURN_BASED: each step is proposed before it begins and one it refuses is skipped (CR 614.10; M6-1); untapSecondPart and precombatMainBegins run in their steps', () => {
    const s = scenario(['Forest'], { p1: { battlefield: ['Forest'] } }); // no creature: no attack to declare while passing through the turns
    const log: string[] = [];
    const proposed: string[] = [];
    const seen: string[] = [];
    const skipUpkeep = (_g: Game, what: { ev: string; step?: string }) => { proposed.push(String(what.step)); return what.step !== 'upkeep'; };
    withEntry(TURN_BASED, 'propose', skipUpkeep, () => withEntries(TURN_BASED.untapSecondPart, [() => log.push('untap 502.2')], () => withEntries(TURN_BASED.precombatMainBegins, [() => log.push('main 714.3c')], () => {
      let t = s;
      for (let i = 0; i < 40 && !(t.turn.number === 2 && t.turn.step === 'main1'); i++) {
        t = act(t, { type: 'pass', player: t.pending!.player });
        seen.push(`${t.turn.number}:${t.turn.step}`);
      }
      expect(t.turn.number).toBe(2);
    })));
    expect(proposed).toEqual(expect.arrayContaining(['beginCombat', 'main2', 'end', 'cleanup', 'upkeep', 'draw', 'main1']));
    expect(seen).not.toContain('2:upkeep'); // skipped
    expect(seen).toContain('2:draw');
    expect(log).toEqual(['untap 502.2', 'main 714.3c']);
  });

  it('CHANGE_FACE: a form with an entry is performed through it, per permanent, instead of by hand', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const done: string[] = [];
    const step = { op: 'changeFace' as const, what: { ref: 'self' as const }, to: 'flip' as const }; // M6-4 registered every form: a test entry replaces flip's
    const real = CHANGE_FACE.flip;
    const r = withEntry(CHANGE_FACE, 'flip', (_cx: unknown, _st: unknown, id: string) => done.push(id), () => changeFace(ctxOn(s, bears, { targets: [], steps: [step] }), step));
    expect(done).toEqual([bears]);
    expect(r).toMatchObject({ performed: true, count: 1 });
    expect(CHANGE_FACE.flip).toBe(real);
  });

  it('ENTERS_PARTS: an enters body with an M6 field fits only when a part takes the field, and the part\'s facts reach the move (CR 614.12)', () => {
    const s = scenario(['Grizzly Bears'], { p1: { hand: ['Grizzly Bears'] } });
    const g = new Game(s);
    const card = find(s, 'Grizzly Bears', 'hand');
    // a field no package has registered yet (M6-6 registered `prepared`; `transformed` is M6-4's): the body does not fit until a part takes it
    const field = (['transformed', 'prepared'] as const).find((f) => !ENTERS_PARTS.some((p) => p.field === f));
    if (field === undefined) return;
    const body = { b: 'enters' as const, [field]: true };
    const e = { ev: 'zoneChange' as const, object: { id: card, zone: 'hand' as const }, from: 'hand' as const, to: 'battlefield' as const, destination: { controller: 'p1' } };
    expect(bodyFits(e, body, g)).toBe(false);
    const part: EntersPart = { field, capability: `body:enters.${field}`, apply: () => ({ [field]: true }), hypothetical: () => {} };
    withEntries(ENTERS_PARTS, [part], () => expect(bodyFits(e, body, g)).toBe(true));
  });

  it('RULE_REPLACEMENTS, BASE_PARTS and VIEW_PARTS are consulted', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const g = new Game(s);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const e = { ev: 'life' as const, change: 'gain' as const, player: 'p1', amount: 1 };
    const fake = { id: 'rule:test', def: { s: 'replace' as const, replaces: { ev: 'life' as const, change: 'gain' as const }, body: { b: 'prevent' as const, amount: 'all' as const } }, source: { id: bears, zone: 'battlefield' as const }, klass: 4 as const, sourceName: 'the rules', controller: 'p1' };
    withEntries(RULE_REPLACEMENTS, [() => [fake]], () => expect(applicable(g, e).map((c) => c.id)).toContain('rule:test'));
    withEntries(BASE_PARTS, [{ source: (_d, o) => (o.id === bears ? { kind: 'melded' } : null), chars: () => ({ ...FACE_DOWN_CHARS, name: 'Test Melded', names: ['Test Melded'], colors: [], supertypes: [], types: ['Creature'], subtypes: [], abilities: [], keywords: [], power: '9', toughness: '9' }) }], () => {
      expect(baseChars(s, s.objects[bears]!)).toMatchObject({ name: 'Test Melded', power: '9' });
    });
    expect(viewFor(s, 'p2').defs['Hill Giant']).toBeUndefined();
    withEntries(VIEW_PARTS, [{ usedDefs: () => ['Grizzly Bears'] }], () => expect(viewFor(s, 'p2').defs['Grizzly Bears']).toBeDefined());
  });
});
