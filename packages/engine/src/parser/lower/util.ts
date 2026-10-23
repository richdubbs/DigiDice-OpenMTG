/**
 * Small JSON helpers of the lowering passes (design 6.5). Owner: WP17. Pure: nothing here edits its input.
 */
import type { Condition, StaticAbilityDef } from '../../types/ability';
import type { Draft, Rec, Unit } from './types';

export const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * WP22 ADDITION (INTERFACE CHANGE): the value of an ability-level static template (parser/templates/ability.json and the zone/condition forms of the other
 * WP22 files) is `{kind:'static', condition?, zone?, effects}`: its condition (CR 604.1, 611.3a) and its zones (CR 113.6, 604.5, 614.12) belong to the
 * whole ability. Null for an ordinary static template (one effect or an array of effects). Read by both builders of a static ability: a printed one
 * (lower/ability.ts) and a quoted one (lower/quoted.ts, CR 113.1c).
 */
export function abilityLevel(v: unknown): { condition?: Condition; zone?: StaticAbilityDef['zone']; otherwise?: StaticAbilityDef['otherwise']; effects: unknown[] } | null {
  if (!isRec(v) || v['kind'] !== 'static' || !Array.isArray(v['effects'])) return null;
  return {
    ...(v['condition'] !== undefined ? { condition: v['condition'] as Condition } : {}),
    ...(v['zone'] !== undefined ? { zone: v['zone'] as StaticAbilityDef['zone'] } : {}),
    ...(v['otherwise'] !== undefined ? { otherwise: v['otherwise'] as StaticAbilityDef['otherwise'] } : {}), // r5-static (CR 611.3a)
    effects: v['effects'] as unknown[],
  };
}

/** Is this a non-empty list of static effects (each with its `s` discriminator)? */
export const isStaticEffects = (effects: readonly unknown[]): boolean => effects.length > 0 && effects.every((e) => isRec(e) && typeof e['s'] === 'string');

/** A deep copy of plain JSON (chart values are frozen; the passes work on copies). */
export function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone) as unknown as T;
  const out: Rec = {};
  for (const [k, x] of Object.entries(v as Rec)) if (x !== undefined) out[k] = clone(x);
  return out as T;
}

/** A copy of the draft whose units, modes and targets can be edited. */
export function cloneDraft(d: Draft): Draft {
  const units = d.units.map(cloneUnit);
  return {
    ...d,
    units,
    ...(d.modes ? { modes: { ...d.modes, options: d.modes.options.map((o) => ({ text: o.text, units: o.units.map(cloneUnit), ...(o.cost ? { cost: clone(o.cost) } : {}) })) } } : {}),
    targets: clone(d.targets),
    mentions: [...d.mentions],
    names: [...d.names],
    diagnostics: [...d.diagnostics],
  };
}

export function cloneUnit(u: Unit): Unit {
  return { ...u, steps: clone(u.steps), ...(u.rider ? { rider: clone(u.rider) } : {}), ...(u.manual ? { manual: { ...u.manual } } : {}), templates: [...u.templates], experimental: [...u.experimental], flags: [...u.flags], ...(u.targetIds ? { targetIds: [...u.targetIds] } : {}), ...(u.targetPos ? { targetPos: { ...u.targetPos } } : {}), ...(u.lostNames ? { lostNames: [...u.lostNames] } : {}) };
}

/** Every unit sequence of the draft in text order: the main units, then each modal option (design 6.2: bullets follow the header). */
export function sequences(d: Draft): Unit[][] {
  return [d.units, ...(d.modes?.options.map((o) => o.units) ?? [])];
}

/**
 * Visit every object node of a value, depth first in document order, with its parent and key; `fn` may return a replacement (the node is then not
 * descended into) or undefined to keep it and descend. Returns the (possibly new) root.
 */
export function rewrite(value: unknown, fn: (node: Rec, path: string) => unknown | undefined, path = ''): unknown {
  if (Array.isArray(value)) return value.map((x, i) => rewrite(x, fn, `${path}/${i}`));
  if (!isRec(value)) return value;
  const repl = fn(value, path);
  if (repl !== undefined) return repl;
  const out: Rec = {};
  for (const [k, x] of Object.entries(value)) out[k] = rewrite(x, fn, `${path}/${k}`);
  return out;
}

/** Visit every object node (read only). Return false from `fn` to skip the node's children. */
export function visit(value: unknown, fn: (node: Rec, path: string) => boolean | void, path = ''): void {
  if (Array.isArray(value)) { value.forEach((x, i) => visit(x, fn, `${path}/${i}`)); return; }
  if (!isRec(value)) return;
  if (fn(value, path) === false) return;
  for (const [k, x] of Object.entries(value)) visit(x, fn, `${path}/${k}`);
}

/**
 * std-rx9 (CR 114.2, 607.2d, 608.2c): the link placeholder of "the chosen type" inside quotation marks (lower/quoted.ts). Only an emblem the same ability creates
 * may read it (lower/links.ts#resolveEmblemChoices: the choice an earlier instruction made, stored on the emblem as it is created); anywhere else it stays, and
 * the sentence is manual.
 */
export const QUOTED_LINK = '$quotedLink';

/** Markers left by the hole grammars or by templates (keys starting with `$`, the `'$link'` placeholder, the `lower` intermediate nodes). */
/** std-mana-12: the marker "that color" of template eff.stdmana12.becomesManaColor writes until lower/links.ts#resolveManaColor names the mana it means. */
export const MANA_COLOR_MARKER = '@manaColor';

export function leftoverMarker(value: unknown): string | null {
  let found: string | null = null;
  const walk = (v: unknown): void => {
    if (found !== null) return;
    if (v === '$link') { found = '$link'; return; }
    // std-rx9: "the chosen ..." inside a quoted ability, left for the ability that creates the emblem (lower/links.ts#resolveEmblemChoices)
    if (v === QUOTED_LINK) { found = QUOTED_LINK; return; }
    if (v === MANA_COLOR_MARKER) { found = MANA_COLOR_MARKER; return; } // std-mana-12: "that color" with no mana before it (lower/links.ts#resolveManaColor)
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!isRec(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('$')) { found = k; return; }
      if (k === 'lower') { found = `lower:${String(x)}`; return; }
      walk(x);
    }
  };
  walk(value);
  return found;
}

/** Make a unit manual (keeps the first reason; a later one is ignored). */
export function setManual(u: Unit, info: NonNullable<Unit['manual']>): void {
  if (u.manual) return;
  u.manual = info;
  const lost = namesIn(u.steps);
  if (lost.length > 0) u.lostNames = [...new Set([...(u.lostNames ?? []), ...lost])];
  u.steps = [];
  delete u.rider;
}

/** A fresh binding name based on `base`, recorded in the draft (no two steps share a name, CR 608.2c references stay unambiguous). */
export function freshName(d: Draft, base: string): string {
  const stem = base.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'it';
  let name = stem;
  for (let k = 2; d.names.includes(name); k++) name = `${stem}${k}`;
  d.names.push(name);
  return name;
}

/** Binding names already written by templates (`as` fields), so fresh names never collide with them. */
export function namesIn(value: unknown): string[] {
  const out: string[] = [];
  visit(value, (n) => {
    if (typeof n['as'] === 'string' && typeof n['op'] === 'string') out.push(n['as']);
    if (typeof n['cantAs'] === 'string' && typeof n['op'] === 'string') out.push(n['cantAs']); // C6
    if (n['op'] === 'let' && typeof n['name'] === 'string') out.push(n['name']);
  });
  return out;
}
