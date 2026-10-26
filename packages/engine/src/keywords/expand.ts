/**
 * Keyword expansion: placeholder substitution (`$cost`, `$amount`, `$quality`, `$filter`, `$costAdd`, `$ifParam`) over a keyword's JSON `expand` template, giving
 * the abilities a keyword instance stands for (design 7.2). Pure: the data and the instance are never changed, the result shares nothing with either. Owner: WP3.
 *
 * The placeholder language is deliberately tiny and has no code and no arithmetic (design 7.1, principle 1):
 *   - a WHOLE string value "$cost" | "$amount" | "$quality" | "$filter" is replaced by that parameter of the keyword instance;
 *   - {"$costAdd": {"base": "$cost", "other": [...]}} is the cost `base` with the cost parts `other` appended (Cycling: the discard of the card);
 *     CMD3: with "tap": true it also has the {T} symbol (outlast, CR 702.107a);
 *   - {"$ifParam": "filter", "then": X, "else": Y} is X when the instance has that parameter, otherwise Y (Equip with and without a restriction);
 *   - {"$ordinal": "kicker"} is the name "kicker" for the first instance on the face and "kicker:2", "kicker:3" for later ones (ExpandContext.ordinal), so the two
 *     kicker costs of "Kicker {A} and/or {B}" can be told apart (CR 702.33b, 702.33f, 607.2i);
 *   - FAST5X E1: {"$byQuality": {"card": X, ...}} is the branch of the instance's quality (gift, CR 702.174d-i), and {"$ifTypes": [types], "then": X,
 *     "else": Y} is X when the face has one of those card types (ExpandContext.types; CR 702.174b).
 * Anything else that starts with "$" is a data error and throws `KeywordExpandError`, so a typo can never become a silent wrong ability.
 */
import type { AbilityDef, CostDef, KeywordAbilityDef, ObjectFilter, Quantity } from '../types/ability';
import { formatManaCost } from '../types/mana';
import type { ExpandContext, KeywordDefData } from './types';

export class KeywordExpandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordExpandError';
  }
}

/** The parameters a keyword instance carries (the four placeholder names). */
interface Params {
  cost?: CostDef;
  amount?: Quantity;
  quality?: string;
  filter?: ObjectFilter;
}

export const PARAM_NAMES = ['cost', 'amount', 'quality', 'filter'] as const;
export type ParamName = (typeof PARAM_NAMES)[number];

const isParamName = (s: unknown): s is ParamName => typeof s === 'string' && (PARAM_NAMES as readonly string[]).includes(s);

const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

function paramsOf(kw: KeywordAbilityDef): Params {
  const p: Params = {};
  if (kw.cost !== undefined) p.cost = kw.cost;
  if (kw.amount !== undefined) p.amount = kw.amount;
  if (kw.quality !== undefined) p.quality = kw.quality;
  if (kw.filter !== undefined) p.filter = kw.filter;
  return p;
}

/** Substitute one node. `undefined` means "nothing here" (an `$ifParam` without an `else` and without the parameter): the parent drops it. */
function sub(node: unknown, p: Params, who: string, ordinal: number, types: readonly string[] = []): unknown {
  if (typeof node === 'string') {
    if (!node.startsWith('$')) return node;
    const name = node.slice(1);
    if (!isParamName(name)) throw new KeywordExpandError(`${who}: unknown placeholder "${node}"`);
    const v = p[name];
    if (v === undefined) throw new KeywordExpandError(`${who}: the keyword instance has no ${name} parameter ("${node}")`);
    return clone(v);
  }
  if (Array.isArray(node)) return node.map((x) => sub(x, p, who, ordinal, types)).filter((x) => x !== undefined);
  if (node === null || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  if ('$costAdd' in obj) {
    if (Object.keys(obj).length !== 1) throw new KeywordExpandError(`${who}: "$costAdd" must be the only key of its object`);
    const spec = obj['$costAdd'] as { base?: unknown; other?: unknown; tap?: unknown };
    const base = sub(spec.base, p, who, ordinal, types) as CostDef | undefined;
    if (base === undefined || typeof base !== 'object') throw new KeywordExpandError(`${who}: "$costAdd" needs a cost as its base`);
    if (spec.tap !== undefined && spec.tap !== true) throw new KeywordExpandError(`${who}: "$costAdd" tap must be true`);
    const other = sub(spec.other ?? [], p, who, ordinal, types) as CostDef['other'];
    // CMD3: {"tap": true} adds the {T} symbol to the cost ("Outlast [cost]" is "[Cost], {T}: ...", CR 702.107a)
    return { ...base, ...(spec.tap === true ? { tap: true } : {}), other: [...(base.other ?? []), ...(other ?? [])] };
  }
  if ('$ordinal' in obj) {
    const base = obj['$ordinal'];
    if (Object.keys(obj).length !== 1 || typeof base !== 'string') throw new KeywordExpandError(`${who}: "$ordinal" must be the only key of its object and name a string`);
    return ordinal <= 1 ? base : `${base}:${ordinal}`;
  }
  if ('$byQuality' in obj) {
    // FAST5X E1: {"$byQuality": {"card": X, "Food": Y}} is the branch named by the instance's quality ("Gift a card", "Gift a Food": CR 702.174d-i define one
    // effect per gift). A quality with no branch is a data error, never an empty ability.
    const table = obj['$byQuality'];
    if (Object.keys(obj).length !== 1 || table === null || typeof table !== 'object' || Array.isArray(table)) throw new KeywordExpandError(`${who}: "$byQuality" must be the only key of its object and map qualities to values`);
    const q = p.quality;
    const branch = q === undefined ? undefined : (table as Record<string, unknown>)[q];
    if (branch === undefined) throw new KeywordExpandError(`${who}: no "$byQuality" branch for the quality ${q === undefined ? '(none)' : `"${q}"`}`);
    return sub(branch, p, who, ordinal, types);
  }
  if ('$ifTypes' in obj) {
    // FAST5X E1: {"$ifTypes": ["Instant", "Sorcery"], "then": X, "else": Y} is X when the face has one of those card types (CR 702.174b: gift is a spell
    // ability on an instant or sorcery and a triggered ability on a permanent)
    const want = obj['$ifTypes'];
    if (!Array.isArray(want) || !want.every((t) => typeof t === 'string')) throw new KeywordExpandError(`${who}: "$ifTypes" must list card types`);
    const branch = want.some((t) => types.includes(t as string)) ? obj['then'] : obj['else'];
    return branch === undefined ? undefined : sub(branch, p, who, ordinal, types);
  }
  if ('$ifParam' in obj) {
    const name = obj['$ifParam'];
    if (!isParamName(name)) throw new KeywordExpandError(`${who}: "$ifParam" names no parameter: ${String(name)}`);
    const branch = p[name] !== undefined ? obj['then'] : obj['else'];
    return branch === undefined ? undefined : sub(branch, p, who, ordinal, types);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$')) throw new KeywordExpandError(`${who}: unknown key "${k}"`);
    const r = sub(v, p, who, ordinal, types);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

/** What follows the keyword name in the printed text ("Kicker {2}{G}" -> "{2}{G}"; "Ward—Pay 3 life." -> "Pay 3 life"), for display only. */
function argText(kw: KeywordAbilityDef, data: KeywordDefData): string {
  const t = kw.text.trim();
  const lower = t.toLowerCase();
  const rest = lower.startsWith(data.name) ? t.slice(data.name.length).replace(/^[\s—–:-]+/, '').trim() : t;
  return rest.replace(/\.+$/, ''); // the templates end their own sentences
}

const isManaOnly = (c: CostDef | undefined): c is CostDef & { mana: NonNullable<CostDef['mana']> } =>
  c !== undefined && c.mana !== undefined && !c.tap && !c.untap && c.loyalty === undefined && (c.other ?? []).length === 0;

/** The text of a generated ability: the template's `{cost}`, `{n}`, `{quality}`, `{filter}` filled from the instance (display data only, design 2.3). */
function fillText(template: string, kw: KeywordAbilityDef, data: KeywordDefData): string {
  return template
    .replace(/\{cost\}/g, () => (isManaOnly(kw.cost) ? formatManaCost(kw.cost.mana) : argText(kw, data)))
    // "unless that player pays {pay}": the cost as the object of "pays" ("Ward—Pay 3 life" -> "3 life", a mana cost -> its symbols)
    .replace(/\{pay\}/g, () => (isManaOnly(kw.cost) ? formatManaCost(kw.cost.mana) : argText(kw, data).replace(/^pay\s+/i, '')))
    // the keyword line as printed ("Basic landcycling {1}", "Equip legendary creature {3}", "Cycling—Pay 2 life")
    .replace(/\{printed\}/g, () => kw.text.trim())
    .replace(/\{n\}/g, () => (typeof kw.amount === 'number' ? String(kw.amount) : kw.amount !== undefined && typeof kw.amount === 'object' && kw.amount.q === 'X' ? 'X' : argText(kw, data)))
    .replace(/\{quality\}/g, () => kw.quality ?? argText(kw, data))
    .replace(/\{filter\}/g, () => argText(kw, data));
}

/** r5-cost: the keywords whose "cost is equal to its mana cost" keyword expansion substitutes (CR 702.180a, 702.128a; trek-7: beam me up, "The beam me up cost is equal to that spell's mana cost"). */
const COST_IS_MANA_COST_EXPANDED: ReadonlySet<string> = new Set(['harmonize', 'embalm', 'beam me up' /* trek-7: Scotty, Miracle Worker */]);

/**
 * trek-7 (CR 118.9, 601.2b; Scotty, Miracle Worker): the keywords of COST_IS_MANA_COST_EXPANDED whose cost is the mana cost of the FACE being cast, so a granted instance is
 * not expanded with the object's own mana cost when it is granted (a split card in a graveyard has both halves' costs together, an Adventurer the creature's): actions/cast-options.ts
 * #castOptionsOf expands it with the mana cost of the face cast now, as it reads a granted flashback's.
 */
export const MANA_COST_OF_FACE_CAST: ReadonlySet<string> = new Set(['beam me up']);

/**
 * The abilities a keyword instance stands for (empty for flag and hook keywords). Throws `KeywordExpandError` when the template needs a parameter the instance
 * lacks or uses a placeholder the language does not have. Generated abilities carry provenance `{by:'keyword', id:<family or name>}` (a typecycling ability is a cycling ability, CR 702.29e-f; the engine uses it to recognize
 * "cycling" and "crew" abilities for the events "when you cycle" and "becomes crewed") and, for a printed keyword, the source lines of the instance (`src`).
 */
export function expandKeyword(data: KeywordDefData, kw0: KeywordAbilityDef, ctx: ExpandContext): AbilityDef[] {
  if (data.expand === undefined) return [];
  // r5-cost (CR 702.180a, 702.128a, 118.9): "Its harmonize cost is equal to its mana cost": the cost is the object's mana cost as it has it now; an object with no
  // mana cost has no such cost to pay (CR 118.6), so the keyword stands for nothing. Harmonize and embalm only: flashback's and mayhem's are read by
  // actions/cast-options.ts, as before (FAST5 T56, cloud r3-mech; merge wave 8 keeps mayhem's own reading)
  const byManaCost = kw0.costIsManaCost === true && kw0.cost === undefined && COST_IS_MANA_COST_EXPANDED.has(kw0.keyword);
  if (byManaCost && (ctx.manaCost === undefined || ctx.manaCost === null)) return [];
  const kw: KeywordAbilityDef = byManaCost ? { ...kw0, cost: { mana: [...ctx.manaCost!] } } : kw0;
  const params = paramsOf(kw);
  const out: AbilityDef[] = [];
  data.expand.forEach((template, i) => {
    const who = `keyword "${data.name}" expansion #${i}`;
    const ability = sub(template, params, who, ctx.ordinal ?? 1, ctx.types) as AbilityDef & { text: string };
    // FAST5X E1: a type branch that is absent; std-rl (CR 702.63b): a parameter branch that is absent ("Vanishing" without a number has no time counters of its own)
    if (ability === undefined && typeof template === 'object' && template !== null && ('$ifTypes' in template || '$ifParam' in template)) return;
    if (ability === undefined || typeof ability !== 'object') throw new KeywordExpandError(`${who}: not an ability`);
    // FAST5X E27 (CR 602.5b): "Activate only once each turn." printed on the keyword's line restricts the activated ability it stands for
    const limited = kw.limit !== undefined && ability.kind === 'activated' ? { limit: { ...kw.limit } } : {};
    // r4-cost (CR 601.2f, 602.2b): "This ability costs {1} less to activate for each ..." printed on the keyword's line changes the cost of the ability it stands for
    const changed = kw.costChange !== undefined && ability.kind === 'activated'
      ? { costChange: JSON.parse(JSON.stringify(kw.costChange)) as typeof kw.costChange, ...(kw.costChangeIf !== undefined ? { costChangeIf: JSON.parse(JSON.stringify(kw.costChangeIf)) as typeof kw.costChangeIf } : {}) } // pc-statics-1: its condition
      : {};
    out.push({
      ...ability,
      ...limited,
      ...changed,
      text: fillText(ability.text, kw, data),
      ...(kw.src !== undefined && !ctx.granted ? { src: [...kw.src] } : {}),
      prov: { by: 'keyword', id: data.family ?? data.name, reviewed: true },
    });
  });
  if (kw.costChange !== undefined) {
    const activated = out.filter((a) => a.kind === 'activated');
    if (activated.length !== 1) throw new KeywordExpandError(`keyword "${data.name}": a cost change on a keyword that does not stand for exactly one activated ability`);
    // r4-cost (CR 601.2c): "the creature it targets" names a target the activated ability declares
    const declared = new Set(activated[0]!.kind === 'activated' ? activated[0]!.effect.targets.map((t) => t.id) : []);
    const named = [...JSON.stringify(kw.costChange).matchAll(/"ref":"target","id":"([^"]+)"/g)].map((m) => m[1]!);
    if (named.some((id) => !declared.has(id))) throw new KeywordExpandError(`keyword "${data.name}": a cost change names a target its activated ability does not declare`);
  }
  if (kw.limit !== undefined && !out.some((a) => a.kind === 'activated')) throw new KeywordExpandError(`keyword "${data.name}": an activation limit on a keyword that stands for no activated ability`);
  return out;
}
