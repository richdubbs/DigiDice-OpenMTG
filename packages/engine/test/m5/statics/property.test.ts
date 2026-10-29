/**
 * Property test: when no effect depends on another (every affected set is fixed, or chosen by something no effect changes), the layer system must give
 * exactly what a TIMESTAMP-ONLY oracle gives: apply the layers in order, inside each layer the effects in timestamp order (CR 613.1, 613.7). The oracle below
 * is written independently of statics/ (plain sets and numbers, one function per layer, no filters, no dependency, no abilities as data), over random
 * boards and random effects in layers 2, 4, 5, 6, 7b, 7c and 7d, resolved effects and static abilities mixed.
 */
import { describe, expect, it } from 'vitest';
import { getChars, type AbilityDef, type CardDef, type Color, type ContinuousEffectDef, type GameState, type Modification } from '../../../src/index';
import { computeAll } from '../../../src/statics/layers';
import { board, continuous, creature, enchantment, nth, staticOf, tweak } from './fixtures';

// ---- a tiny seeded generator ---------------------------------------------------------------------------------------------------
function rng(seed: number): { int: (n: number) => number; pick: <T>(xs: readonly T[]) => T; chance: (p: number) => boolean } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return { int, pick: (xs) => xs[int(xs.length)]!, chance: (p) => next() < p };
}

const KEYWORDS = ['flying', 'haste', 'reach', 'menace'] as const;
const kw = (k: string): AbilityDef => ({ kind: 'keyword', text: k, keyword: k });
const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];
const NAMES = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].map((n) => `Prop ${n}`);

interface Spec {
  /** timestamp order = index */
  mods: Modification[];
  /** names of the creatures it affects */
  names: string[];
  /** a static ability on an enchantment, or a resolved effect? */
  kind: 'resolved' | 'static';
}

function randomMods(r: ReturnType<typeof rng>): Modification[] {
  switch (r.int(9)) {
    case 0: return [{ layer: 2, controller: { ref: 'fixed', players: [r.pick(['p1', 'p2'])] } }];
    case 1: return [{ layer: 4, types: { add: [r.pick(['Artifact', 'Enchantment'])] } }];
    case 2: return [{ layer: 4, types: r.chance(0.5) ? { remove: [r.pick(['Artifact', 'Creature'])] } : { set: [r.pick(['Artifact', 'Land'])] } }];
    case 3: {
      const cs = [r.pick(COLORS)];
      return [{ layer: 5, colors: r.pick([{ set: cs }, { add: cs }, { remove: cs }]) }];
    }
    case 4: return [{ layer: 6, add: [kw(r.pick(KEYWORDS))] }];
    case 5: return [r.chance(0.5) ? { layer: 6, remove: [r.pick(KEYWORDS)] } : { layer: 6, cantHave: [r.pick(KEYWORDS)] }];
    case 6: return [{ layer: 6, removeAll: true }, ...(r.chance(0.5) ? [{ layer: '7b' as const, power: r.int(4), toughness: 1 + r.int(4) }] : [])];
    case 7: return [{ layer: '7b', power: r.int(6), toughness: 1 + r.int(6) }, ...(r.chance(0.3) ? [{ layer: '7c' as const, power: 1, toughness: 1 }] : [])];
    default: return r.chance(0.7) ? [{ layer: '7c', power: r.int(5) - 2, toughness: r.int(5) - 2 }] : [{ layer: '7d', switchPT: true }];
  }
}

// ---- the oracle: layers in order, timestamps inside a layer ------------------------------------------------------------------------
interface O {
  controller: string;
  types: Set<string>;
  colors: Set<string>;
  kws: Set<string>;
  cant: Set<string>;
  power: number;
  toughness: number;
}

const LAYER_ORDER: Modification['layer'][] = [2, 4, 5, 6, '7b', '7c', '7d'];

function oracle(base: Map<string, O>, effects: { ts: number; mods: Modification[]; who: string[] }[]): Map<string, O> {
  const out = new Map([...base].map(([k, v]) => [k, { ...v, types: new Set(v.types), colors: new Set(v.colors), kws: new Set(v.kws), cant: new Set(v.cant) }]));
  for (const layer of LAYER_ORDER) {
    for (const e of [...effects].sort((a, b) => a.ts - b.ts)) {
      for (const m of e.mods) {
        if (m.layer !== layer) continue;
        for (const name of e.who) {
          const o = out.get(name)!;
          switch (m.layer) {
            case 2: o.controller = (m.controller as { players: string[] }).players[0]!; break;
            case 4:
              if (m.types?.set) o.types = new Set(m.types.set);
              for (const t of m.types?.add ?? []) o.types.add(t);
              for (const t of m.types?.remove ?? []) o.types.delete(t);
              break;
            case 5:
              if (m.colors.set) o.colors = new Set(m.colors.set);
              for (const c of m.colors.add ?? []) o.colors.add(c);
              for (const c of m.colors.remove ?? []) o.colors.delete(c);
              break;
            case 6:
              if (m.removeAll) o.kws.clear();
              for (const k of m.remove ?? []) o.kws.delete(k);
              for (const k of m.cantHave ?? []) { o.cant.add(k); o.kws.delete(k); }
              for (const a of m.add ?? []) if (a.kind === 'keyword' && !o.cant.has(a.keyword)) o.kws.add(a.keyword);
              break;
            case '7b': o.power = m.power as number; o.toughness = m.toughness as number; break;
            case '7c': o.power += (m.power as number) ?? 0; o.toughness += (m.toughness as number) ?? 0; break;
            case '7d': [o.power, o.toughness] = [o.toughness, o.power]; break;
            default: break;
          }
        }
      }
    }
  }
  return out;
}

const SORT = (xs: Iterable<string>): string[] => [...xs].sort();

describe('property: with no dependencies the layers equal a timestamp-only oracle', () => {
  const creatures: CardDef[] = NAMES.map((n, i) => creature(n, String(1 + (i % 4)), String(1 + ((i + 1) % 4)), i % 2 === 0 ? [kw('flying')] : [kw('haste'), kw('reach')], { cost: `{1}{${COLORS[i % 5]}}` }));
  const enchantments: CardDef[] = [0, 1, 2].map((i) => enchantment(`Prop S${i}`, '{1}', []));
  const base = board([...creatures, ...enchantments], [...NAMES.slice(0, 3), 'Prop S0', 'Prop S1'], [...NAMES.slice(3), 'Prop S2']);

  it('400 random boards', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const specs: Spec[] = Array.from({ length: 2 + r.int(8) }, () => ({
        mods: randomMods(r),
        names: NAMES.filter(() => r.chance(0.5)),
        kind: r.chance(0.35) ? 'static' : 'resolved',
      }));
      // Statics are on the enchantments (never affected themselves): a static's timestamp is its object's. Resolved effects get timestamps after everything on the board.
      const holders = ['Prop S0', 'Prop S1', 'Prop S2'];
      const effects: { ts: number; mods: Modification[]; who: string[] }[] = [];
      const s: GameState = tweak(base, (t) => {
        const abilities: Record<string, AbilityDef[]> = { 'Prop S0': [], 'Prop S1': [], 'Prop S2': [] };
        let h = 0;
        for (const sp of specs) {
          if (sp.kind === 'static') {
            const name = holders[h++ % 3]!;
            const fx: ContinuousEffectDef = continuous({ ref: 'each', filter: { anyOf: sp.names.map((n) => ({ name: n })) } }, sp.mods);
            abilities[name]!.push(staticOf('Test static', [fx]));
            // among the abilities of one object the effects are ordered by their keys, that is by their position
            effects.push({ ts: t.objects[nth(t, name)]!.timestamp + abilities[name]!.length * 1e-6, mods: sp.mods, who: sp.names });
          } else {
            const ts = t.counters.timestamp++;
            t.continuousEffects.push({
              id: `e${t.counters.effect++}`, source: null, sourceName: 'x', controller: 'p1', timestamp: ts, startedTurn: 1, duration: { d: 'endOfTurn' },
              effect: continuous({ ref: 'fixed', objects: sp.names.map((n) => ({ id: nth(t, n), zone: 'battlefield' as const })) }, sp.mods),
            });
            effects.push({ ts, mods: sp.mods, who: sp.names });
          }
        }
        // copy-on-write: the definitions are frozen and `tweak`'s clone shares them (util/clone.ts, F17/F9)
        for (const name of holders) { const d = t.defs[name]!; t.defs[name] = { ...d, faces: [{ ...d.faces[0]!, abilities: abilities[name]! }, ...d.faces.slice(1)] }; }
      });
      // the starting point: the printed values
      const start = new Map<string, O>();
      NAMES.forEach((n, i) => {
        const id = nth(s, n);
        const o = s.objects[id]!;
        start.set(n, {
          controller: o.controller, types: new Set(['Creature']), colors: new Set([COLORS[i % 5]!]),
          kws: new Set(i % 2 === 0 ? ['flying'] : ['haste', 'reach']), cant: new Set(), power: 1 + (i % 4), toughness: 1 + ((i + 1) % 4),
        });
      });
      const expected = oracle(start, effects);
      const all = computeAll(s);
      for (const n of NAMES) {
        const id = nth(s, n);
        const e = expected.get(n)!;
        const c = all.get(id)!;
        const what = `seed ${seed}, ${n}`;
        expect(c.controller, what).toBe(e.controller);
        expect(SORT(c.types), what).toEqual(SORT(e.types));
        expect(SORT(c.colors), what).toEqual(SORT(e.colors));
        expect(SORT(new Set(c.keywords.map((k) => k.keyword))), what).toEqual(SORT(e.kws));
        expect([c.power, c.toughness], what).toEqual([String(e.power), String(e.toughness)]);
        expect(getChars(s, id), `${what} (getChars)`).toEqual(c);
      }
    }
  });
});
