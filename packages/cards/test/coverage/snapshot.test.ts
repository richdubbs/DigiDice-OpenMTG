/**
 * WP25: the whole-index snapshot and guard G10 (design 6.8, 15.4, D27): "adding a template may change only formerly-manual units". The tests build
 * snapshots of the fixture set (and of synthetic cards) with and without a template and check that the diff accepts exactly what G10 allows.
 */
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, type OracleCard, type Template } from '@openmtg/engine';
import { fixtureCards } from '../../src/coverage/corpus';
import { createCoverageEngine, type CardRun } from '../../src/coverage/engine';
import {
  buildSnapshot, cardKey, diffSnapshots, keepsAutomated, maskAt, maskedBehavior, MANUAL_MARK, parseSnapshot, refineWithRuns, serializeSnapshot, stableJson,
  type Snapshot, type UnitRecord,
} from '../../src/coverage/snapshot';
import { ENGINE_CAPABILITIES, type AbilityDef, type CardDef } from '@openmtg/engine';
import { fixtureRuns, synthetic, tpl } from './support';

/** A run of a hand-built definition (its classification recomputed from the abilities: automation.faces dropped). */
function runOf(def: CardDef, name = def.name): CardRun {
  return { card: { name, oracle_id: `synthetic-${name}`, layout: 'normal' } as OracleCard, parse: { faces: [], parserVersion: 'test' }, def: { ...def, automation: { ...def.automation, faces: undefined } as CardDef['automation'] }, level: def.automation.level, requiresEngine: [] };
}
const snapOf = (runs: readonly CardRun[]): Snapshot => buildSnapshot(runs, { pipeline: 'test', compilerVersion: 'test', templates: 0, caps: ENGINE_CAPABILITIES });
/** Lightning Bolt's definition with its one ability replaced. */
const withAbility = (a: unknown): CardDef => {
  const bolt = fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!.def!;
  return { ...bolt, faces: [{ ...bolt.faces[0]!, abilities: [{ src: [0], ...(a as object) } as AbilityDef] }] };
};
const g10 = (before: CardDef, after: CardDef): ReturnType<typeof diffSnapshots> => {
  const b = runOf(before, 'Unit Under Test');
  const a = runOf(after, 'Unit Under Test');
  return refineWithRuns(diffSnapshots(snapOf([b]), snapOf([a])), snapOf([b]), new Map([[cardKey(a), a]]), ENGINE_CAPABILITIES);
};

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('WP25 G10: the automated parts of manual units are protected (design 10.2)', { timeout: 60_000 }, () => {
  const tap4 = { mana: [{ kind: 'generic', amount: 4 }], tap: true };
  const manualActivated = (cost: object, extra: object = {}) => ({ kind: 'manual', shape: 'activated', text: 'Do the thing.', reason: 'no template matches the sentence', cost, ...extra });
  it('CR 602.1, 118.3: a manual activated ability whose cost goes from {4},{T} to {4} is a violation (the engine charges that cost)', () => {
    const d = g10(withAbility(manualActivated(tap4)), withAbility(manualActivated({ mana: [{ kind: 'generic', amount: 4 }] })));
    expect(d.violations.map((v) => [v.kind, v.before])).toEqual([['changed', 'm']]);
  }, 60_000); // the first test compiles the fixture set (fixtureRuns, cached for the file): about 5 s alone, more on a loaded machine
  it('CR 602.5d: a manual ability that loses its sorcery-speed restriction is a violation', () => {
    const d = g10(withAbility(manualActivated(tap4, { sorcerySpeed: true })), withAbility(manualActivated(tap4)));
    expect(d.violations.map((v) => v.kind)).toEqual(['changed']);
  });
  it('CR 602.2: the same manual ability understood (same cost, an effect now) is progress, not a violation; with another cost it is', () => {
    const understood = (cost: object) => ({ kind: 'activated', text: 'Do the thing.', cost, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } });
    const ok = g10(withAbility(manualActivated(tap4)), withAbility(understood(tap4)));
    expect(ok.violations).toEqual([]);
    expect(ok.improvedUnits).toBe(1);
    expect(g10(withAbility(manualActivated(tap4)), withAbility(understood({ tap: true }))).violations.map((v) => v.kind)).toEqual(['changed']);
  });
  it('CR 603.2: a manual triggered ability keeps its understood effect ("Trigger now" runs it): changing that effect is a violation', () => {
    const trig = (count: number) => ({ kind: 'manual', shape: 'triggered', text: 'At some point, draw.', reason: 'needs-engine: event:x', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count }] } });
    expect(g10(withAbility(trig(1)), withAbility(trig(2))).violations.map((v) => v.kind)).toEqual(['changed']);
    expect(g10(withAbility(trig(1)), withAbility(trig(1))).violations).toEqual([]);
  });
  it('a manual ability with nothing automated may still change freely (that is what new templates are for)', () => {
    const plain = (text: string) => ({ kind: 'manual', shape: 'static', text, reason: 'no template matches the sentence' });
    const d = g10(withAbility(plain('One.')), withAbility({ kind: 'static', text: 'Two.', effects: [] }));
    expect(d.violations).toEqual([]);
  });
});

describe('WP25 G10: masks are placed on the canonical form (canonicalize sorts the operands of all/any)', { timeout: 60_000 }, () => {
  const guarded = (types: string[]) => ({
    kind: 'spell', text: 'If you control a creature and the moon is full, draw a card.',
    effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'all', of: [{ cond: 'exists', filter: { types, controller: 'you' } }, { cond: 'ask', text: 'the moon is full' }] }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] },
  });
  it('CR 608.2c: the ask operand is masked and the automated operand kept, whatever order the parser built them in', () => {
    const masked = JSON.stringify(maskedBehavior(guarded(['Creature']) as unknown as AbilityDef));
    expect(masked).toContain(MANUAL_MARK);
    expect(masked).toContain('"Creature"');
    expect(masked).not.toContain('"ask"');
  });
  it('CR 608.2c: changing the automated operand of a partial unit (Creature -> Artifact) is a violation', () => {
    const d = g10(withAbility(guarded(['Creature'])), withAbility(guarded(['Artifact'])));
    expect(d.violations.map((v) => [v.kind, v.before])).toEqual([['changed', 'p']]);
  });
  it('CR 608.2c: filling the ask is progress, not a violation', () => {
    const filled = { ...guarded(['Creature']), effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'all', of: [{ cond: 'exists', filter: { types: ['Creature'], controller: 'you' } }, { cond: 'exists', filter: { types: ['Land'], controller: 'you' } }] }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } };
    expect(g10(withAbility(guarded(['Creature'])), withAbility(filled)).violations).toEqual([]);
  });
});

describe('WP25 snapshot header: what produced it', { timeout: 60_000 }, () => {
  it('records content hashes of the template set and the capability set, and the revision; a different template set has a different hash', () => {
    const e = createCoverageEngine({ templates: BOOTSTRAP_TEMPLATES });
    const runs = fixtureCards().slice(0, 5).map((c) => e.run(c));
    const a = buildSnapshot(runs, { pipeline: e.pipeline(), compilerVersion: e.compilerVersion, templates: BOOTSTRAP_TEMPLATES, caps: e.caps, revision: 'abc123' });
    const b = buildSnapshot(runs, { pipeline: e.pipeline(), compilerVersion: e.compilerVersion, templates: without('eff.draw.you'), caps: e.caps });
    expect(a.templatesHash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.templatesHash).not.toBe(b.templatesHash);
    expect(a.capabilitiesHash).toBe(b.capabilitiesHash);
    expect(a.revision).toBe('abc123');
    expect(parseSnapshot(serializeSnapshot(a))).toEqual(a);
  });
});

function snap(templates: readonly Template[], cards: readonly OracleCard[]): { snapshot: Snapshot; runs: CardRun[] } {
  const e = createCoverageEngine({ templates });
  const runs = cards.map((c) => e.run(c));
  return { snapshot: buildSnapshot(runs, { pipeline: e.pipeline(), compilerVersion: e.compilerVersion, templates: templates.length, caps: e.caps }), runs };
}

const without = (id: string): Template[] => BOOTSTRAP_TEMPLATES.filter((t) => t.id !== id);
const live = (runs: readonly CardRun[]): Map<string, CardRun> => new Map(runs.map((r) => [cardKey(r), r]));

describe('WP25 snapshot format', { timeout: 60_000 }, () => {
  it('keys are sorted at every level; serialize and parse round-trip; one card per line; no Oracle text', () => {
    expect(stableJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
    const { snapshot } = snap(BOOTSTRAP_TEMPLATES, fixtureCards().slice(0, 40));
    const text = serializeSnapshot(snapshot);
    expect(parseSnapshot(text)).toEqual(snapshot);
    expect(serializeSnapshot(parseSnapshot(text))).toBe(text);
    expect(text.split('\n').length).toBe(Object.keys(snapshot.cards).length + 3);
    const bolt = fixtureCards().find((c) => c.name === 'Lightning Bolt')!;
    expect(serializeSnapshot(snap(BOOTSTRAP_TEMPLATES, [bolt]).snapshot)).not.toContain('damage to any target');
  });
  it('refuses a file that is not a snapshot of this version', () => {
    expect(() => parseSnapshot('{"format":"other"}')).toThrow(/not a coverage snapshot/);
    expect(() => parseSnapshot('{"format":"openmtg-coverage-snapshot","version":99}')).toThrow(/version 99/);
  });
  it('maskAt replaces the nodes at JSON pointers', () => {
    expect(maskAt({ effect: { steps: [{ op: 'a' }, { op: 'manual' }] } }, ['/effect/steps/1'])).toEqual({ effect: { steps: [{ op: 'a' }, '<manual>'] } });
    expect(maskAt({ a: 1 }, ['/missing/path'])).toEqual({ a: 1 });
  });
  it('keepsAutomated: a marker matches any subtree and, in an array, any run of one or more elements; targets may be added, not changed', () => {
    const M = MANUAL_MARK;
    const old = { effect: { targets: [{ id: 't0', kind: 'player' }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' } }, M] } };
    expect(keepsAutomated(old, { effect: { targets: [{ id: 't0', kind: 'player' }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' } }, { op: 'a' }, { op: 'b' }] } })).toBe(true);
    expect(keepsAutomated(old, { effect: { targets: [{ id: 't0', kind: 'player' }, { id: 't1', kind: 'object' }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' } }, { op: 'x', what: { ref: 'target', id: 't1' } }] } })).toBe(true);
    expect(keepsAutomated(old, { effect: { targets: [{ id: 't0', kind: 'player' }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' } }] } })).toBe(false);
    expect(keepsAutomated(old, { effect: { targets: [{ id: 't0', kind: 'object' }], steps: [{ op: 'draw', who: { ref: 'target', id: 't0' } }, { op: 'a' }] } })).toBe(false);
    expect(keepsAutomated(old, { effect: { targets: [{ id: 't0', kind: 'player' }], steps: [M, { op: 'a' }] } })).toBe(false);
    expect(keepsAutomated({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
  it('keepsAutomated (FAST5 T61): the step before a manual run may gain `then`, `else` and `as` when that sentence is understood; nothing else, and no other step', () => {
    const M = MANUAL_MARK;
    const old = { effect: { targets: [], steps: [{ op: 'pay', who: { ref: 'you' }, cost: { mana: [{ kind: 'generic', amount: 2 }] } }, M] } };
    const pay = { op: 'pay', who: { ref: 'you' }, cost: { mana: [{ kind: 'generic', amount: 2 }] } };
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ ...pay, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } })).toBe(true);
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ ...pay, as: 'b0' }, { op: 'if', cond: { cond: 'did', step: 'b0' }, then: [] }] } })).toBe(true);
    // a changed field of the step is still a change, and a step with no manual run after it grows nothing
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ ...pay, cost: { mana: [{ kind: 'generic', amount: 3 }] }, then: [] }] } })).toBe(false);
    expect(keepsAutomated({ effect: { targets: [], steps: [pay] } }, { effect: { targets: [], steps: [{ ...pay, then: [] }] } })).toBe(false);
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ ...pay, who: { ref: 'each' } }] } })).toBe(false);
  });
  it('keepsAutomated (FAST5 T78): an `if` whose branch held the `may` a later "If you do" sentence reads takes that sentence in at the end of its branch (and the `may` gains `as`); nothing else changes', () => {
    const M = MANUAL_MARK;
    const cond = { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Raccoon'], controller: 'you' } } };
    const may = { op: 'may', who: { ref: 'you' }, do: [{ op: 'discard', who: { ref: 'you' }, count: 1 }] };
    const old = { effect: { targets: [], steps: [{ op: 'if', cond, then: [may] }, M] } };
    const folded = { effect: { targets: [], steps: [{ op: 'if', cond, then: [{ ...may, as: 'did' }, { op: 'if', cond: { cond: 'did', step: 'did' }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] }] } };
    expect(keepsAutomated(old, folded)).toBe(true);
    // the branch only grows at its end: a changed first instruction, a changed condition, or no manual run after the `if` is a change
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ op: 'if', cond, then: [{ ...may, do: [{ op: 'discard', who: { ref: 'you' }, count: 2 }], as: 'did' }, { op: 'a' }] }] } })).toBe(false);
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ op: 'if', cond: { ...cond, atLeast: 2 }, then: [{ ...may, as: 'did' }, { op: 'a' }] }] } })).toBe(false);
    expect(keepsAutomated({ effect: { targets: [], steps: [{ op: 'if', cond, then: [may] }] } }, folded)).toBe(false);
  });
  it('keepsAutomated (Cloud std-fin): inside the step before a manual run, a nested instruction may gain the name (`as`) the understood sentence reads; nothing else', () => {
    const M = MANUAL_MARK;
    const move = { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'battlefield' } };
    const may = { op: 'may', who: { ref: 'you' }, do: [move] };
    const old = { effect: { targets: [], steps: [may, M] } };
    const attach = { op: 'if', cond: { cond: 'did', step: 'did' }, then: [{ op: 'attach', what: { ref: 'bound', name: 'moved' }, to: { ref: 'self' } }] };
    // "You may return target Equipment card from your graveyard to the battlefield. If you do, you may attach it to ~." (CR 400.7: the move is named)
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ ...may, as: 'did', do: [{ ...move, as: 'moved' }] }, attach] } })).toBe(true);
    // a nested instruction that changes otherwise is still a change; a nested name with no manual run after the step is too; a renamed instruction is a change
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ ...may, do: [{ ...move, as: 'moved', to: { zone: 'hand' } }] }, attach] } })).toBe(false);
    expect(keepsAutomated({ effect: { targets: [], steps: [may] } }, { effect: { targets: [], steps: [{ ...may, do: [{ ...move, as: 'moved' }] }] } })).toBe(false);
    expect(keepsAutomated({ effect: { targets: [], steps: [{ ...may, do: [{ ...move, as: 'a' }] }, M] } }, { effect: { targets: [], steps: [{ ...may, do: [{ ...move, as: 'b' }] }, attach] } })).toBe(false);
  });
  it('keepsAutomated (cloud std-spm): a triggered ability whose effect ended manual may gain the limit "Do this only once each turn" (`limit.action`); no other limit, kind or trigger change', () => {
    const M = MANUAL_MARK;
    const trigger = { on: [{ ev: 'zoneChange', subject: { controller: 'you', other: true, subtypes: ['Villain'] }, to: 'battlefield' }] };
    const old = { kind: 'triggered', trigger, effect: { targets: [], steps: [M] } };
    const once = { per: 'turn', max: 1, action: true };
    const steps = [{ op: 'may', who: { ref: 'you' }, do: [{ op: 'action', action: 'connive', subject: { ref: 'event', role: 'subject' } }], as: 'once' }];
    expect(keepsAutomated(old, { kind: 'triggered', trigger, effect: { targets: [], steps }, limit: once })).toBe(true);
    expect(keepsAutomated({ ...old, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }, M] } }, { kind: 'triggered', trigger, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }, ...steps] }, limit: once })).toBe(true);
    // a limit other than the action's, an effect that did not end manual, another ability kind, or a changed trigger is still a change
    expect(keepsAutomated(old, { kind: 'triggered', trigger, effect: { targets: [], steps }, limit: { per: 'turn', max: 1 } })).toBe(false);
    expect(keepsAutomated({ ...old, effect: { targets: [], steps: [M, { op: 'draw', who: { ref: 'you' }, count: 1 }] } }, { kind: 'triggered', trigger, effect: { targets: [], steps: [...steps, { op: 'draw', who: { ref: 'you' }, count: 1 }] }, limit: once })).toBe(false);
    expect(keepsAutomated({ ...old, kind: 'activated' }, { kind: 'activated', trigger, effect: { targets: [], steps }, limit: once })).toBe(false);
    expect(keepsAutomated(old, { kind: 'triggered', trigger: { on: [] }, effect: { targets: [], steps }, limit: once })).toBe(false);
  });
  it('keepsAutomated (CLOUD std-msh): a guarded instruction before a manual run may take in "Otherwise, Y.": `if` its guard, then the same instruction, else Y; nothing else', () => {
    const M = MANUAL_MARK;
    const guard = { cond: 'matches', object: { ref: 'event', role: 'subject' }, filter: { attacking: true } };
    const draw = { op: 'draw', who: { ref: 'you' }, count: 1 };
    const damage = { op: 'damage', source: { ref: 'self' }, to: { ref: 'each', who: 'opponent' }, amount: 1 };
    const old = { effect: { targets: [], steps: [{ ...draw, guard }, M] } };
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ op: 'if', cond: guard, then: [draw], else: [damage] }] } })).toBe(true);
    // another condition, another instruction, no else, more than the instruction in the branch, or no manual run after the guarded step: a change
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ op: 'if', cond: { ...guard, filter: { blocking: true } }, then: [draw], else: [damage] }] } })).toBe(false);
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ op: 'if', cond: guard, then: [{ ...draw, count: 2 }], else: [damage] }] } })).toBe(false);
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ op: 'if', cond: guard, then: [draw] }] } })).toBe(false);
    expect(keepsAutomated(old, { effect: { targets: [], steps: [{ op: 'if', cond: guard, then: [draw, damage], else: [damage] }] } })).toBe(false);
    expect(keepsAutomated({ effect: { targets: [], steps: [{ ...draw, guard }] } }, { effect: { targets: [], steps: [{ op: 'if', cond: guard, then: [draw], else: [damage] }] } })).toBe(false);
  });
});

describe('WP25 guard G10 on the fixture set', { timeout: 60_000 }, () => {
  const cards = fixtureCards();
  it('adding a template changes only formerly-manual units: no violation, some cards move up (eff.draw.you)', () => {
    const before = snap(without('eff.draw.you'), cards);
    const after = snap(BOOTSTRAP_TEMPLATES, cards);
    const d = refineWithRuns(diffSnapshots(before.snapshot, after.snapshot), before.snapshot, live(after.runs));
    expect(d.violations).toEqual([]);
    expect(d.improvedUnits).toBeGreaterThan(0);
    expect(d.up.length).toBeGreaterThan(0);
    expect(d.down).toEqual([]);
  }, 60_000); // two compiles of the fixture set: well over vitest's 5 s default when the suite runs in parallel
  it('removing it is caught: every formerly automated unit that used it is a violation (changed, removed or demoted)', () => {
    const before = snap(BOOTSTRAP_TEMPLATES, cards);
    const after = snap(without('eff.draw.you'), cards);
    const d = refineWithRuns(diffSnapshots(before.snapshot, after.snapshot), before.snapshot, live(after.runs));
    expect(d.violations.length).toBeGreaterThan(0);
    expect(d.down.length).toBeGreaterThan(0);
    expect(d.fullChanged.length).toBeGreaterThan(0);
  }, 60_000);
  it('the same inputs give an identical snapshot and an empty diff', () => {
    const a = snap(BOOTSTRAP_TEMPLATES, cards).snapshot;
    const b = snap(BOOTSTRAP_TEMPLATES, cards).snapshot;
    expect(serializeSnapshot(a)).toBe(serializeSnapshot(b));
    const d = diffSnapshots(a, b);
    expect(d.violations).toEqual([]);
    expect(d.up.length + d.down.length + d.improvedUnits).toBe(0);
  }, 60_000);
});

describe('WP25 guard G10 for partial units: only the formerly manual nodes may change', { timeout: 60_000 }, () => {
  // invented wording (design 6.10): the second sentence has no template in the bootstrap set and no modifier word, so the unit is partial (design 6.7)
  const card = synthetic('Quiet Bargain', 'Sorcery', 'Draw two cards. You gain 3 life.');
  const gain = tpl('test.wp25.gainlife', 'effect', '{p:Player} gain[s] {n:Qty} life', { op: 'gainLife', who: '$p', amount: '$n' });
  it('a template that fills the manual step is progress: the diff of hashes flags it, the live re-check clears it', () => {
    const before = snap(BOOTSTRAP_TEMPLATES, [card]);
    const unit = Object.values(before.snapshot.cards)[0]!.units;
    const rec = Object.values(unit)[0]!;
    expect(rec[0]).toBe('p');
    expect(rec.length).toBe(3);
    const after = snap([...BOOTSTRAP_TEMPLATES, gain], [card]);
    expect(Object.values(Object.values(after.snapshot.cards)[0]!.units)[0]![0]).toBe('f');
    const raw = diffSnapshots(before.snapshot, after.snapshot);
    expect(raw.violations.map((v) => v.kind)).toEqual(['changed']);
    expect(refineWithRuns(raw, before.snapshot, live(after.runs)).violations).toEqual([]);
  });
  it('a change to an automated node of a partial unit stays a violation', () => {
    const before = snap(BOOTSTRAP_TEMPLATES, [card]);
    // the draw step now draws three: same manual node, different automated node
    const after = snap(BOOTSTRAP_TEMPLATES, [synthetic('Quiet Bargain', 'Sorcery', 'Draw three cards. You gain 3 life.')]);
    const d = refineWithRuns(diffSnapshots(before.snapshot, after.snapshot), before.snapshot, live(after.runs));
    expect(d.violations.map((v) => v.kind)).toEqual(['changed']);
  });
  it('full units must keep their hash exactly; a lost unit is "removed"; a unit with the same JSON but a lower level is "demoted"', () => {
    const base = snap(BOOTSTRAP_TEMPLATES, [synthetic('Plain Study', 'Sorcery', 'Draw two cards.')]).snapshot;
    const key = Object.keys(base.cards)[0]!;
    const unitKey = Object.keys(base.cards[key]!.units)[0]!;
    const edit = (rec: UnitRecord | null): Snapshot => {
      const c = structuredClone(base);
      if (rec === null) delete c.cards[key]!.units[unitKey];
      else c.cards[key]!.units[unitKey] = rec;
      return c;
    };
    const old = base.cards[key]!.units[unitKey]!;
    expect(diffSnapshots(base, edit(['f', 'ffffffffffffffff'])).violations.map((v) => v.kind)).toEqual(['changed']);
    expect(diffSnapshots(base, edit(null)).violations.map((v) => v.kind)).toEqual(['removed']);
    expect(diffSnapshots(base, edit(['m', old[1]])).violations.map((v) => v.kind)).toEqual(['demoted']);
    expect(diffSnapshots(edit(['m', 'x']), base).violations).toEqual([]);
  });
});
