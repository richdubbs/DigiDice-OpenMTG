/**
 * The typed walker (model/walk.ts): every object of an ability with the name of the model type that describes it, driven by the generated schema.
 */
import { describe, expect, it } from 'vitest';
import { walkAbility, walkValue, type WalkNode } from '../../../src/model';
import { ancestors, enclosing, isNestedAbility } from '../../../src/model/walk';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const nodes = (def: unknown, defName?: string): WalkNode[] => {
  const out: WalkNode[] = [];
  const visit = (n: WalkNode): void => void out.push(n);
  if (defName) walkValue(def, defName, visit);
  else walkAbility(def, visit);
  return out;
};
const names = (ns: WalkNode[]): [string, string][] => ns.map((n) => [n.def, n.path]);
const example = (name: string): unknown => EXAMPLES.find((e) => e.name === name)!.faces[0]!.abilities[0];

describe('walkAbility', () => {
  it('names the type of every object, with its pointer', () => {
    expect(names(nodes(example('Lightning Bolt')))).toEqual([
      ['SpellAbilityDef', ''],
      ['EffectProgram', '/effect'],
      ['TargetSpec', '/effect/targets/0'],
      ['EffectStep', '/effect/steps/0'],
      ['ObjRef', '/effect/steps/0/source'],
      ['ObjRef', '/effect/steps/0/to'],
    ]);
  });
  it('knows the slot, the index and the parent of each node', () => {
    const ns = nodes(example('Lightning Bolt'));
    const to = ns.find((n) => n.path === '/effect/steps/0/to')!;
    expect(to.slot).toBe('to');
    expect(to.parent!.path).toBe('/effect/steps/0');
    const step = ns.find((n) => n.path === '/effect/steps/0')!;
    expect([step.slot, step.index]).toEqual(['steps', 0]);
    expect([...ancestors(to)].map((a) => a.def)).toEqual(['EffectStep', 'EffectProgram', 'SpellAbilityDef']);
    expect(enclosing(to, 'EffectProgram')!.path).toBe('/effect');
    expect(enclosing(to, 'ManualAbilityDef')).toBeNull();
  });
  it('tells a quantity from a count, and an object reference from a player reference that share a tag', () => {
    const a = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'each', who: 'opponent' }, count: { q: 'X' } }, { op: 'tap', what: { ref: 'each', filter: {} } }] } };
    const ns = nodes(a);
    expect(ns.find((n) => n.path === '/effect/steps/0/who')!.def).toBe('PlayerRef');
    expect(ns.find((n) => n.path === '/effect/steps/1/what')!.def).toBe('ObjRef');
    expect(ns.find((n) => n.path === '/effect/steps/0/count')!.names).toEqual(['Quantity']);
    const t = nodes({ id: 't0', kind: 'object', min: { q: 'X' }, max: 'any', text: 't' }, 'TargetSpec');
    expect(t.find((n) => n.path === '/min')!.names).toEqual(['Count', 'Quantity']);
    expect(t.find((n) => n.path === '/min')!.def).toBe('Quantity');
  });
  it('names anonymous inline objects after their owner and slot', () => {
    const modal = EXAMPLES.find((e) => e.name === 'Cryptic Command')!.faces[0]!.abilities[0];
    expect(nodes(modal).map((n) => n.def)).toContain('ModeSpec.options');
    const chosen = nodes({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'tap', what: { ref: 'each', filter: { chosen: { link: 'c', quality: 'color' } } } }] } });
    expect(chosen.map((n) => n.def)).toContain('ObjectFilter.chosen');
  });
  it('a visitor can prune a sub-tree by returning false', () => {
    const seen: string[] = [];
    walkAbility(example('Lightning Bolt'), (n) => {
      seen.push(n.def);
      if (n.def === 'EffectStep') return false;
      return undefined;
    });
    expect(seen).toEqual(['SpellAbilityDef', 'EffectProgram', 'TargetSpec', 'EffectStep']);
  });
  it('skips what the schema does not describe instead of throwing (the validator reports it)', () => {
    const bad = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'frobnicate', what: { ref: 'self' } }, { op: 'tap', what: { ref: 'self' } }] } };
    expect(names(nodes(bad)).map(([d]) => d)).toEqual(['SpellAbilityDef', 'EffectProgram', 'EffectStep', 'ObjRef']);
    expect(nodes('flying')).toEqual([]);
    expect(nodes(null)).toEqual([]);
  });
  it('walks a sub-tree of an ability: a step, a condition, a continuation of a larger path', () => {
    const cond = nodes({ cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, { cond: 'not', of: { cond: 'wasCast', kicked: true } }] }, 'Condition');
    expect(cond.map((n) => n.path)).toEqual(['', '/of/0', '/of/1', '/of/1/of']);
    const out: string[] = [];
    walkValue({ op: 'tap', what: { ref: 'self' } }, 'EffectStep', (n) => void out.push(n.path), { path: '/effect/steps/3' });
    expect(out).toEqual(['/effect/steps/3', '/effect/steps/3/what']);
  });
  it('recognizes abilities nested in a node (a granted ability) and the root', () => {
    const sneak = nodes(example('Sneak Attack'));
    const nested = sneak.filter(isNestedAbility);
    expect(nested.map((n) => n.def)).toEqual(['KeywordAbilityDef']);
    expect(sneak.filter((n) => n.def === 'ActivatedAbilityDef' && !isNestedAbility(n))).toHaveLength(1);
  });
  it('visits every object of every worked example exactly once, each with a known type name', () => {
    for (const ex of EXAMPLES) {
      for (const a of ex.faces.flatMap((f) => f.abilities)) {
        const ns = nodes(a);
        expect(new Set(ns.map((n) => n.path)).size, ex.name).toBe(ns.length);
        // count the objects of the JSON that are not primitives' containers of nothing: every `{...}` the schema describes is visited
        let objects = 0;
        const count = (v: unknown): void => {
          if (Array.isArray(v)) v.forEach(count);
          else if (v && typeof v === 'object') (objects++, Object.values(v as J).forEach(count));
        };
        count(a);
        expect(ns.length, ex.name).toBe(objects);
      }
    }
  });
});
