/**
 * Guard G6, the exact render gate: normalize(render(JSON)) must equal normalize(Oracle text) (design 6.8). Owner: WP2. Contract: render/api.ts#RenderGate.
 *
 * The renderer returns text with alternative groups at the positions Oracle varies (render/text.ts). The Oracle side is matched against ALL combinations
 * of the groups at once (a position set walk, linear in the text), so the result is "equal to some reading of the model", never "similar".
 */
import type { KeywordAbilityDef } from '../types/ability';
import type { GateResult, RenderContext, RenderGate } from './api';
import './boot';
import { gateTokens, normalizeForGate } from './equivalence';
import { K } from './kernel';
import { keywordLineOf } from './kw';
import { newState } from './state';
import { checkAbility } from './guard';
import { firstAlt, isDisplayOnly, NoRenderer, parseMarked, type MarkedNode } from './text';

/** Position-set matcher: which token positions can the pattern end at, starting from `starts`. `furthest` records how far any path got. */
function walk(nodes: MarkedNode[], tokens: string[], starts: Set<number>, names: string[], progress: { furthest: number }, cache: Map<string, string[]>): Set<number> {
  let cur = starts;
  for (const node of nodes) {
    if (cur.size === 0) return cur;
    if (typeof node === 'string') {
      let lits = cache.get(node);
      if (!lits) {
        lits = gateTokens(normalizeForGate(node, names));
        cache.set(node, lits);
      }
      for (const lit of lits) {
        const next = new Set<number>();
        for (const p of cur) {
          if (tokens[p] === lit) {
            next.add(p + 1);
            if (p + 1 > progress.furthest) progress.furthest = p + 1;
          }
        }
        cur = next;
        if (cur.size === 0) return cur;
      }
    } else {
      const ends = new Set<number>();
      for (const option of node.alts) {
        if (isDisplayOnly(option)) continue;
        for (const e of walk(option, tokens, cur, names, progress, cache)) ends.add(e);
      }
      cur = ends;
    }
  }
  return cur;
}

/** The nodes of a sequence, walked from every start in `starts`: where each node can end. */
function stepSets(nodes: MarkedNode[], tokens: string[], start: number, names: string[], cache: Map<string, string[]>): Set<number>[] {
  const sets: Set<number>[] = [new Set([start])];
  for (const node of nodes) sets.push(walk([node], tokens, sets[sets.length - 1]!, names, { furthest: 0 }, cache));
  return sets;
}

/** The literal pieces of ONE reading of `nodes` that runs from `start` to `end` over the tokens, or null. */
function trace(nodes: MarkedNode[], tokens: string[], start: number, end: number, names: string[], cache: Map<string, string[]>): string[] | null {
  const sets = stepSets(nodes, tokens, start, names, cache);
  if (!sets[nodes.length]!.has(end)) return null;
  const parts: string[] = [];
  let to = end;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    let found: { from: number; piece: string[] } | null = null;
    for (const from of sets[i]!) {
      if (!walk([node], tokens, new Set([from]), names, { furthest: 0 }, cache).has(to)) continue;
      if (typeof node === 'string') {
        found = { from, piece: [node] };
      } else {
        for (const option of node.alts) {
          if (isDisplayOnly(option)) continue;
          const piece = trace(option, tokens, from, to, names, cache);
          if (piece) {
            found = { from, piece };
            break;
          }
        }
      }
      if (found) break;
    }
    if (!found) return null;
    parts.unshift(...found.piece);
    to = found.from;
  }
  return parts;
}

/**
 * The reading of the marked text that the Oracle lines match (design 10.5): the display of an ability whose Oracle text is known. Null when no reading matches.
 * One reading is chosen when several match (the first by group order).
 */
export function matchedReading(marked: string, oracleLines: string[], names: string[]): string | null {
  const tokens = gateTokens(normalizeForGate(oracleLines.join(' '), names));
  const parts = trace(parseMarked(marked), tokens, 0, tokens.length, names, new Map());
  return parts === null ? null : parts.join('');
}

/**
 * The gate for a text that is not one ability: `build` prints the marked text from the pass state. Total like `renderGate`: whatever the arguments are, the
 * answer is a result, and a refusal is a rejection.
 */
function gateOf(build: (st: ReturnType<typeof newState>) => string, oracleLines: string[], ctx: RenderContext): GateResult {
  const names = Array.isArray(ctx?.selfNames) ? ctx.selfNames.filter((n): n is string => typeof n === 'string') : [];
  const safeCtx = { ...ctx, selfNames: names };
  let expected = '';
  try {
    expected = normalizeForGate((Array.isArray(oracleLines) ? oracleLines : []).map(String).join(' '), names);
    if (ctx === null || typeof ctx !== 'object') throw new NoRenderer('render context');
    const marked = build(newState(safeCtx));
    if (typeof marked !== 'string') throw new NoRenderer('ability');
    const rendered = normalizeForGate(firstAlt(marked), names);
    const tokens = gateTokens(expected);
    const progress = { furthest: 0 };
    const ends = walk(parseMarked(marked), tokens, new Set([0]), names, progress, new Map());
    if (ends.has(tokens.length)) return { ok: true, rendered: expected, expected };
    return { ok: false, rendered, expected, firstDiff: progress.furthest };
  } catch (e) {
    return { ok: false, rendered: `<cannot render: ${e instanceof Error ? e.message : String(e)}>`, expected, firstDiff: 0 };
  }
}

export const renderGate: RenderGate = (def, oracleLines, ctx) =>
  gateOf((st) => {
    checkAbility(def);
    return K.ability(def, st);
  }, oracleLines, ctx);

/** Guard G6 for a line of keywords ("Flying, first strike"): the keyword abilities in the order of the line. Not part of the contract of api.ts (WP2 addition). */
export function renderGateKeywordLine(defs: KeywordAbilityDef[], oracleLines: string[], ctx: RenderContext): GateResult {
  return gateOf((st) => {
    if (!Array.isArray(defs)) throw new NoRenderer('a keyword line that is not a list');
    for (const d of defs) {
      checkAbility(d);
      if (d.kind !== 'keyword') throw new NoRenderer(`${d.kind} in a keyword line`);
    }
    return keywordLineOf(defs, st);
  }, oracleLines, ctx);
}
