/**
 * Token definitions (CR 111.3-111.4, 111.10, 707.2, 707.8a). Owner: WP14.
 *
 * A token's characteristics come from the effect that creates it (CR 111.3); the engine stores them as a `CardDef` in `state.defs` (Game.addDef: frozen and
 * shared, ARCHITECTURE "Engine principles"). The id of that definition is derived from its canonical JSON (keys sorted), so the same token made twice, or by two
 * effects, gets the same id and the definition is stored once (design 15.2 WP14), while two different tokens that share a name ("Spirit") never collide.
 *
 *  - `tokenCardDef`: an inline `TokenDef` (Raise the Alarm's 1/1 white Soldier) or a predefined one (CR 111.10: predefined-tokens.json, whose rules text is the
 *    Comprehensive Rules'), with every quantity (an X/X token) already evaluated by the handler (CR 608.2h);
 *  - `copiableTokenDef`: a token that is a copy of an object that is no copy itself (CR 707.2: its copiable values are its card definition). A copy of a
 *    double-faced object is a double-faced token (CR 707.8a).
 *  - `tokenDefFromCopied` (M6-2): a token whose copiable values are not a plain definition (a copy of a copy, of a face-down object, or with exceptions,
 *    CR 707.3, 707.9b, 708.2): built from the characteristics statics/copy.ts#charsFromCopiable gives (effects/handlers/tokens-copy.ts).
 */
import type { AbilityDef, Modification, TokenDef, TypeChange } from '../../types/ability';
import type { CardDef, CardType, FaceDef, Supertype } from '../../types/card';
import type { Color } from '../../types/mana';
import type { GameObject } from '../../types/state';
import PREDEFINED from '../predefined-tokens.json';

/** One face of a predefined token as predefined-tokens.json stores it. */
interface PredefinedFace {
  name: string;
  types: string[];
  subtypes: string[];
  supertypes?: string[];
  colors: string[];
  power?: string;
  toughness?: string;
  text: string;
  abilities: unknown[];
}

/** One predefined token (CR 111.10x). */
export interface PredefinedToken {
  name: string;
  rule: string;
  layout: 'token' | 'double_faced_token';
  faces: PredefinedFace[];
}

/** The predefined tokens of CR 111.10, by name (the `TokenDef.predefined` value: "Treasure", "Cursed Role", ...). */
export const PREDEFINED_TOKENS: readonly PredefinedToken[] = (PREDEFINED as unknown as { tokens: PredefinedToken[] }).tokens;

const byName = new Map(PREDEFINED_TOKENS.map((t) => [t.name.toLowerCase(), t]));

/** The predefined token named `name` (case-insensitive), or undefined (an unknown name is resolved by hand, never guessed). */
export const predefinedToken = (name: string): PredefinedToken | undefined => byName.get(name.toLowerCase());

// ---- canonical ids --------------------------------------------------------------------------------------------------------------------------------------

/** JSON with object keys sorted at every level: equal definitions give equal text whatever order their fields were built in. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** 64-bit FNV-1a (two 32-bit lanes with different offsets) as 16 hex digits: deterministic, no dependency, collisions negligible for token definitions. */
function hash64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Give a definition its content-derived id: `token:<name>:<hash of the canonical JSON of everything else>`. */
function withId(def: Omit<CardDef, 'id'>, prefix: string): CardDef {
  return { id: `${prefix}:${def.name}:${hash64(canonicalJson(def))}`, ...def } as CardDef;
}

// ---- building faces -------------------------------------------------------------------------------------------------------------------------------------

const cap = (s: string): string => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

const typeLineOf = (supertypes: string[], types: string[], subtypes: string[]): string =>
  `Token ${[...supertypes, ...types].join(' ')}${subtypes.length > 0 ? ` — ${subtypes.join(' ')}` : ''}`;

/**
 * How a token definition is classified (design 10.3, 5.2: from the engine's capability set, never asserted). The classifier is the model's `classifyCard` over
 * ENGINE_CAPABILITIES with the exact render gate of the predefined abilities (design 6.8); it lives in model/capabilities.ts, which installs it when it loads,
 * because the interpreter may not import the model (design 5.4: the same seam as effects/cast-hook.ts). A function registry, not game data.
 */
export type TokenClassifier = (faces: readonly FaceDef[]) => CardDef['automation'];

let classifier: TokenClassifier | null = null;

/** Called once by model/capabilities.ts when it loads (WP14 review). */
export function installTokenClassifier(c: TokenClassifier): void {
  classifier = c;
}

/**
 * The automation of a token definition (WP14 review: never `full` without checking what its abilities need). Without the classifier (a module graph that never
 * loads the model) nothing is claimed: a token with abilities is at most `partial`.
 */
function automationOf(faces: FaceDef[]): CardDef['automation'] {
  if (classifier) return classifier(faces);
  const all = faces.flatMap((f) => f.abilities);
  const manual = all.filter((a) => a.kind === 'manual');
  const level = all.length === 0 ? 'full' : manual.length === all.length ? 'manual' : 'partial';
  const unchecked = all.filter((a) => a.kind !== 'manual').map((a) => a.text);
  return { level, unsupported: [...manual.map((a) => a.text), ...unchecked], source: 'templates' };
}

/** A token's characteristics, evaluated: the `TokenDef` with its quantities already numbers (CR 608.2h). */
export interface TokenSpec extends Omit<TokenDef, 'power' | 'toughness'> {
  power?: number;
  toughness?: number;
}

function faceFrom(spec: TokenSpec, base?: PredefinedFace): FaceDef {
  // CR 111.10: the effect may modify or add to the predefined characteristics. Characteristics it states replace the predefined ones; types, abilities and
  // keywords it lists are added to them.
  const union = (a: readonly string[] = [], b: readonly string[] = []): string[] => [...a, ...b.filter((x) => !a.includes(x))];
  const types = union(base?.types, spec.types);
  const subtypes = union(base?.subtypes, spec.subtypes);
  const supertypes = union(base?.supertypes, spec.supertypes);
  // CR 111.4: a token whose name the effect doesn't give is named after its subtypes plus "Token".
  const name = spec.name ?? base?.name ?? `${(subtypes.length > 0 ? subtypes : types).join(' ')} Token`;
  const keywordAbilities: AbilityDef[] = (spec.keywords ?? []).map((k) => ({ kind: 'keyword', text: cap(k), keyword: k.toLowerCase() }));
  const abilities: AbilityDef[] = [...((base?.abilities ?? []) as AbilityDef[]), ...keywordAbilities, ...(spec.abilities ?? [])];
  const text = [base?.text ?? '', ...keywordAbilities.map((a) => a.text), ...(spec.abilities ?? []).map((a) => a.text)].filter((t) => t.length > 0).join('\n');
  const face: FaceDef = {
    name,
    manaCost: null, // CR 111.3: a token has no mana cost unless the effect gives it one
    typeLine: typeLineOf(supertypes, types, subtypes),
    supertypes: supertypes as Supertype[],
    types: types as CardType[],
    subtypes,
    oracleText: text,
    colors: (spec.colors ?? (base?.colors as Color[] | undefined) ?? []) as Color[],
    keywords: keywordAbilities.map((a) => a.text),
    abilities,
  };
  const power = spec.power !== undefined ? String(spec.power) : base?.power;
  const toughness = spec.toughness !== undefined ? String(spec.toughness) : base?.toughness;
  if (power !== undefined) face.power = power;
  if (toughness !== undefined) face.toughness = toughness;
  return face;
}

/** The second face of a predefined double-faced token (Incubator's Phyrexian Token, CR 111.10i), unchanged by the effect. */
const plainFace = (f: PredefinedFace): FaceDef => faceFrom({}, f);

/**
 * The definition of the token an effect creates (CR 111.3, 111.4, 111.10). Returns `{ reason }` when the token can't be built exactly: an unknown predefined
 * name, or a definition with no characteristics at all (the lint rejects it, design 2.3).
 */
export function tokenCardDef(spec: TokenSpec): CardDef | { reason: string } {
  const pre = spec.predefined !== undefined ? predefinedToken(spec.predefined) : undefined;
  if (spec.predefined !== undefined && !pre) return { reason: `"${spec.predefined}" is not a predefined token this build knows (CR 111.10)` };
  if (!pre && spec.name === undefined && (spec.types ?? []).length === 0 && (spec.subtypes ?? []).length === 0) return { reason: 'the token has no characteristics (CR 111.3)' };
  const faces: FaceDef[] = pre ? [faceFrom(spec, pre.faces[0]), ...pre.faces.slice(1).map(plainFace)] : [faceFrom(spec)];
  const layout = pre?.layout ?? 'token';
  const name = faces.length > 1 ? faces.map((f) => f.name).join(' // ') : faces[0]!.name;
  return withId({ name, layout, faces, isToken: true, automation: automationOf(faces) }, 'token');
}

/** The characteristics a token copy gets from copiable values that are not a plain definition (M6-2): computed by statics/copy.ts#charsFromCopiable. */
export interface CopiedFace {
  name: string;
  manaCost: FaceDef['manaCost'];
  colors: Color[];
  supertypes: string[];
  types: string[];
  subtypes: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  /** The copied rules text (CR 707.2): printed abilities of the copied face and the abilities exceptions give (CR 707.9b), not their keyword expansions. */
  abilities: AbilityDef[];
  /**
   * M6-6 INTERFACE CHANGE (additive, CR 722.2b): the prepare spell of the copied preparation card: part of the copiable values whatever the exceptions, so the
   * token keeps it as the second face of a `prepare` definition (core/prepare.ts#prepareSpellOf reads it there).
   */
  prepare?: FaceDef;
}

/**
 * M6-2 (CR 707.2, 707.9, 111.4): the definition of a token whose copiable values are not a plain card definition: a copy of an object that is itself a copy, of
 * a face-down object (the profile, CR 708.2), or with exceptions ("except it's a 1/1 Elemental", CR 707.9b). Single-faced: a copy of a copy of a double-faced
 * permanent copies only its face (CR 707.8); token copies of double-faced objects WITH exceptions are refused by the handler.
 */
export function tokenDefFromCopied(f: CopiedFace): CardDef {
  const face: FaceDef = {
    name: f.name,
    manaCost: f.manaCost,
    typeLine: typeLineOf(f.supertypes, f.types, f.subtypes),
    supertypes: f.supertypes as Supertype[],
    types: f.types as CardType[],
    subtypes: f.subtypes,
    oracleText: f.abilities.map((a) => a.text).join('\n'),
    colors: f.colors,
    keywords: f.abilities.flatMap((a) => (a.kind === 'keyword' ? [a.text] : [])),
    abilities: f.abilities,
  };
  for (const k of ['power', 'toughness', 'loyalty', 'defense'] as const) if (f[k] !== undefined) face[k] = f[k];
  if (f.prepare) return withId({ name: f.name, layout: 'prepare', faces: [face, f.prepare], isToken: true, automation: automationOf([face]) }, 'copy'); // M6-6, CR 722.2b
  return withId({ name: f.name, layout: 'token', faces: [face], isToken: true, automation: automationOf([face]) }, 'copy');
}

/**
 * CLOUD std-misc (CR 707.9b, 707.10, 707.10f): the definition of a copy of a spell with exceptions ("copy it, except the copy isn't legendary", "except the copy is an
 * artifact in addition to its other types", "... is a 1/1 Spirit in addition to its other types"): the spell's definition with the face it is cast as changed by the
 * exceptions, which become part of the copy's copiable values, so the token a copy of a permanent spell becomes has them too. Only supertypes, card types and
 * subtypes added or removed (layer 4), colors set (layer 5) and a fixed power and toughness (layer 7b); the abilities are the spell's own, so its modes and targets
 * stay what they were. Anything else, a split or flip card, or a face that isn't there: `{ reason }`.
 */
export function exceptedSpellDef(def: CardDef, faceIndex: number, except: readonly Modification[]): CardDef | { reason: string } {
  if (def.layout === 'split' || def.layout === 'flip' || def.layout === 'meld') return { reason: 'a copy with exceptions of a split, flip or meld card is not automated yet (CR 707.9b, 709)' };
  const face = def.faces[faceIndex];
  if (face === undefined) return { reason: 'the face of the copied spell is unknown' };
  const no = { reason: 'this copy exception is not automated for a copy of a spell (CR 707.9b)' };
  const change = (list: readonly string[], ch: TypeChange | undefined): string[] | null => {
    if (ch === undefined) return [...list];
    if (Object.entries(ch).some(([k, v]) => v !== undefined && k !== 'add' && k !== 'remove')) return null;
    const out = list.filter((x) => !(ch.remove ?? []).includes(x));
    for (const a of ch.add ?? []) if (!out.includes(a)) out.push(a);
    return out;
  };
  let supertypes: string[] = [...face.supertypes];
  let types: string[] = [...face.types];
  let subtypes: string[] = [...face.subtypes];
  let colors: Color[] = [...face.colors];
  let pt: { power?: string; toughness?: string } = {};
  for (const m of except) {
    if (m.layer === 4) {
      if (m.named !== undefined) return no;
      const sp = change(supertypes, m.supertypes);
      const ty = change(types, m.types);
      const sb = change(subtypes, m.subtypes);
      if (sp === null || ty === null || sb === null) return no;
      [supertypes, types, subtypes] = [sp, ty, sb];
    } else if (m.layer === 5) {
      if (m.colors.set === undefined || m.colors.add !== undefined || m.colors.remove !== undefined || m.colors.chosen !== undefined) return no;
      colors = [...m.colors.set];
    } else if (m.layer === '7b') {
      if (typeof m.power !== 'number' || typeof m.toughness !== 'number') return no;
      pt = { power: String(m.power), toughness: String(m.toughness) };
    } else return no;
  }
  const typeLine = `${[...supertypes, ...types].join(' ')}${subtypes.length > 0 ? ` — ${subtypes.join(' ')}` : ''}`;
  const changed: FaceDef = { ...face, typeLine, supertypes: supertypes as Supertype[], types: types as CardType[], subtypes, colors, ...pt };
  const { id: _id, ...rest } = def;
  return withId({ ...rest, faces: def.faces.map((f, i) => (i === faceIndex ? changed : f)) }, 'copy');
}

/**
 * The definition of a token that is a copy of `o` (an object as it is or as it last existed), and the face it enters with. CR 707.2: the copiable values; CR
 * 707.8a: a copy of a double-faced object is a double-faced token, entering with the face that was up. Returns `{ reason }` for what this build can't copy
 * exactly: a face-down object (CR 707.2, 708.2: milestone 6), a flip card (its flipped status is copiable, CR 709.2), a split permanent (Rooms).
 */
export function copiableTokenDef(defs: Readonly<Record<string, CardDef>>, o: GameObject): { def: CardDef; face: number } | { reason: string } {
  const def = defs[o.defId];
  if (!def) return { reason: 'the object has no definition' };
  if (o.faceDown) return { reason: 'copying a face-down object is milestone 6 (CR 707.2, 708.2)' };
  if (def.layout === 'flip') return { reason: 'the copiable values of a flip card depend on its flipped status (CR 709.2), not automated yet' };
  if (def.layout === 'split' && o.zone === 'battlefield') return { reason: 'copying a split permanent is not automated yet (CR 709)' };
  const dfc = def.faces.length === 2 && (def.layout === 'transform' || def.layout === 'modal_dfc' || def.layout === 'double_faced_token');
  // CR 715.4 and the like: outside the stack an adventurer (or prepare) card has only its normal characteristics, its first face.
  // M6-6 INTERFACE CHANGE (CR 722.2b): the prepare spell is part of the copiable values: a token copy of a preparation card keeps it as its second face (the
  // token has its first face's characteristics in every zone, CR 722.4)
  const prepare = def.layout === 'prepare' && def.faces.length > 1;
  const faces = dfc ? def.faces : prepare ? [def.faces[0]!, def.faces[1]!] : [def.faces[o.zone === 'battlefield' ? o.face : 0] ?? def.faces[0]!];
  const copy = withId({ name: dfc ? def.name : faces[0]!.name, layout: dfc ? 'double_faced_token' : prepare ? 'prepare' : 'token', faces, isToken: true, automation: def.automation }, 'copy');
  return { def: copy, face: dfc && o.zone === 'battlefield' ? o.face : 0 };
}
