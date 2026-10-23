/**
 * The shape check in front of the renderer (WP2): the gate runs on JSON from a parser or an LLM, so it must refuse (never throw on, never mis-print)
 * anything that is not an ability of the model. Every refusal is a `NoRenderer`, which the gate reports as a rejection.
 *
 *  - the ability must be an object with a known `kind`;
 *  - no key or string value may be a property name of `Object.prototype` ("constructor", "toString", "__proto__" ...): the renderer looks words up in
 *    tables keyed by model strings, and such a string would find a function of the prototype chain instead of nothing;
 *  - the JSON is bounded in depth and size, because the renderer prints every alternative reading of a nested step and a hostile ability could
 *    otherwise take exponential time (the gate also runs on pack data nobody reviewed).
 */
import { NoRenderer } from './text';

const KINDS = new Set(['spell', 'activated', 'triggered', 'static', 'keyword', 'chapter', 'classLevel', 'levelBracket', 'case' /* M6-6: CR 719.3 */, 'manual']);
const PROTO_NAMES = new Set([...Object.getOwnPropertyNames(Object.prototype), '__proto__']);

/** Most nested JSON levels and most JSON nodes of one ability. The largest real abilities are well below both. */
export const MAX_JSON_DEPTH = 60;
export const MAX_JSON_NODES = 20000;

export function checkAbility(def: unknown): void {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) throw new NoRenderer('ability that is not an object');
  const kind = (def as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !KINDS.has(kind)) throw new NoRenderer(`ability kind ${String(kind)}`);
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    if (depth > MAX_JSON_DEPTH) throw new NoRenderer('ability nested too deeply');
    if (++nodes > MAX_JSON_NODES) throw new NoRenderer('ability too large');
    if (typeof node === 'string') {
      if (PROTO_NAMES.has(node)) throw new NoRenderer(`reserved word ${node}`);
    } else if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
    } else if (node !== null && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (PROTO_NAMES.has(k)) throw new NoRenderer(`reserved key ${k}`);
        visit((node as Record<string, unknown>)[k], depth + 1);
      }
    }
  };
  visit(def, 0);
}
