/**
 * The generated JSON Schema and the validator that reads it (design 11.3 gate 2, D29). The drift test regenerates the schema from types/ability.ts
 * (in a child process) and compares it with the checked-in file: the TypeScript model and the schema cannot diverge.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { schemaIssues, validateAbility, validateStoredAbility, stripAbility } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SCHEMA_PATH = resolve(ROOT, 'packages/engine/src/model/schema.generated.json');

const bolt = (): AbilityDef => ({
  kind: 'spell',
  text: '~ deals 3 damage to any target.',
  effect: {
    targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' }],
    steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3 }],
  },
});

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('the generated schema', () => {
  it('model/schema.generated.json is exactly what scripts/gen-ability-schema.ts generates from types/ability.ts (drift test)', () => {
    // the generator pulls in the TypeScript compiler API, so it runs in its own process (and is not imported into the type-checked test program)
    const out = execFileSync(process.execPath, ['--import', 'tsx', resolve(ROOT, 'scripts/gen-ability-schema.ts'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toContain('up to date');
  }, 60_000);

  it('describes every ability kind, step op and layer of the model (the placeholder of the skeleton is gone)', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as { definitions: Record<string, unknown> };
    for (const name of ['AbilityDef', 'EffectStep', 'Quantity', 'Condition', 'ObjRef', 'PlayerRef', 'ObjectFilter', 'Modification', 'StaticEffect', 'EventPattern', 'Duration']) {
      expect(schema.definitions[name], name).toBeDefined();
    }
    expect(JSON.stringify(schema)).toContain('"const":"damage"');
  });
});

describe('the schema validator', () => {
  it('accepts a valid ability and all 53 worked examples', () => {
    expect(schemaIssues(bolt())).toEqual([]);
    for (const ex of EXAMPLES) for (const f of ex.faces) for (const a of f.abilities) expect(schemaIssues(a), ex.name).toEqual([]);
  });

  it('names an unknown op at the step, with a suggestion for a typo', () => {
    const a = clone(bolt()) as unknown as { effect: { steps: Record<string, unknown>[] } };
    a.effect.steps[0]!['op'] = 'dammage';
    const issues = schemaIssues(a);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: '/effect/steps/0', code: 'schema', severity: 'error' });
    expect(issues[0]!.message).toContain('unknown op "dammage"');
    expect(issues[0]!.message).toContain('did you mean "damage"?');
  });

  it('reports a missing required field at the deepest path (a draw step without `who` is a compile error, not a silent "you")', () => {
    const a = {
      kind: 'spell', text: 'Draw a card.', effect: { targets: [], steps: [{ op: 'draw', count: 1 }] },
    };
    const issues = schemaIssues(a);
    expect(issues.map((i) => [i.path, i.message])).toEqual([['/effect/steps/0/who', 'missing required property "who"']]);
  });

  it('rejects unknown properties (a typo is not silently ignored) and a wrong type', () => {
    const a = clone(bolt()) as unknown as { effect: { steps: Record<string, unknown>[] } };
    a.effect.steps[0]!['amout'] = 3;
    a.effect.steps[0]!['amount'] = 'three';
    const msgs = schemaIssues(a).map((i) => `${i.path}: ${i.message}`);
    expect(msgs).toContain('/effect/steps/0/amout: unexpected property "amout"');
    expect(msgs.some((m) => m.startsWith('/effect/steps/0/amount: expected'))).toBe(true);
  });

  it('reports a missing discriminator and a wrong kind of ability', () => {
    expect(schemaIssues({ text: 'x' })[0]!.message).toContain('missing "kind"');
    expect(schemaIssues({ kind: 'sorcery', text: 'x' })[0]!.message).toContain('unknown kind "sorcery"');
    expect(schemaIssues('flying')[0]!.message).toContain('expected an object with "kind"');
  });

  it('forbids a property that must be absent (a non-battlefield destination has no controller)', () => {
    const a = {
      kind: 'spell', text: 'Return target creature to its owner\'s hand.',
      effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature' }], steps: [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'hand', controller: { ref: 'you' } } }] },
    };
    const issues = schemaIssues(a);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path.endsWith('/to') || i.path.includes('/to/'))).toBe(true);
  });

  it('a battlefield destination REQUIRES its controller (CR 110.2)', () => {
    const a = {
      kind: 'spell', text: 'Put it onto the battlefield.',
      effect: { targets: [], steps: [{ op: 'move', what: { ref: 'self' }, to: { zone: 'battlefield' } }] },
    };
    expect(schemaIssues(a).length).toBeGreaterThan(0);
  });

  it('the stored form: display fields are optional, everything else is still required', () => {
    const stored = stripAbility(bolt());
    expect(stored).not.toHaveProperty('text');
    expect(schemaIssues(stored).length).toBeGreaterThan(0); // `text` is required in the full form
    expect(schemaIssues(stored, 'AbilityDef', { stored: true })).toEqual([]);
    expect(validateStoredAbility(stored)).toEqual([]);
    const broken = clone(stored) as unknown as { effect: { steps: Record<string, unknown>[] } };
    delete broken.effect.steps[0]!['source'];
    expect(validateStoredAbility(broken).map((i) => i.path)).toEqual(['/effect/steps/0/source']);
  });

  it('a schema error stops the lint (validateAbility returns schema issues only)', () => {
    const a = clone(bolt()) as unknown as { effect: { steps: Record<string, unknown>[]; targets: Record<string, unknown>[] } };
    a.effect.steps[0]!['to'] = { ref: 'target', id: 'nope' }; // would be an unknown-target lint error
    a.effect.steps[0]!['extra'] = 1;
    expect(validateAbility(a as unknown as AbilityDef).every((i) => i.code === 'schema')).toBe(true);
  });
});
