/**
 * Godot plan phase 2 (view schema 2): the characteristics summary a view carries for every object its viewer may see (`GameView.chars`), so a front end
 * without the engine (the Godot table) shows what the rules use: the characteristics after the layers (CR 613), not the printed card. It is what
 * `getChars` gives for the object in the state the view is made from (rules/characteristics.ts), reduced to what a board shows: the name, mana cost and
 * mana value, colors, card types, power and toughness as numbers (`ptNumbers`: null for a "*" no characteristic-defining ability evaluated), loyalty and
 * defense as printed, the keyword abilities by name, every ability as the renderer reads it (render/: the "how OpenMTG plays this card" reading, one
 * string per ability with its stable key) and, for a permanent, its summoning sickness (CR 302.6, rules/timing.ts#isSummoningSick).
 *
 * What the viewer may not see is never summarized: an object the view shows as a blank card (a library card, another player's hand card, a card exiled
 * face down: `HIDDEN_DEF`) has no entry. A face-down permanent or spell the viewer may not look at gets the face-down characteristics exactly as the
 * engine has them (CR 708.2a: a nameless 2/2, ward {2} for disguise and cloak), which is all anybody may see of it; the characteristics of a face-down
 * object are those to every player, its controller included (CR 708.2).
 *
 * Pure and deterministic: a function of the state and the object. The renderer is the costly part (about a millisecond per ability), so the reading of an
 * ability is kept per ability definition, key and naming context (`abilityOf`): by identity for a frozen definition (every printed ability: card
 * definitions are deep-frozen, core/create.ts), by its JSON for any other (a granted ability, copied with its effect on every action), in a bounded memo.
 * Both are exact-input memos of a pure function (docs/ARCHITECTURE.md, the list of allowed pure memos; like the per-definition `FACE_CHARS`).
 */
import type { AbilityDef } from '../types/ability';
import type { CardType, Supertype } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import type { Color, ManaCost } from '../types/mana';
import type { GameObject, GameState } from '../types/state';
import { getChars, ptNumbers, type Chars } from '../rules/characteristics';
import { isSummoningSick } from '../rules/timing';
import { renderAbility } from '../render/render';

/** One ability of a summary: its stable key (`CharAbility.key`: `p:` printed, `k:` keyword-generated, `g:` granted, `r:` rule) and its reading. */
export interface ViewCharsAbility {
  key: string;
  /** The renderer's reading of the ability (an ability word first, "Landfall — ..."); a manual ability's own text. */
  text: string;
  /** Text the engine does not automate (a `manual` ability: it is resolved by hand). */
  manual?: true;
}

/** The characteristics of a visible object after the layers (CR 109.3, 613), as a front end without the engine shows them. */
export interface ViewChars {
  /** '' for a face-down object (CR 708.2a). */
  name: string;
  manaCost: ManaCost | null;
  manaValue: number;
  colors: Color[];
  supertypes: Supertype[];
  types: CardType[];
  subtypes: string[];
  /** Who controls it after layer 2 (CR 613.1b): can differ from `GameObject.controller` while a control-changing effect applies. */
  controller: PlayerId;
  /** Power and toughness after layers 7a-7d (`ptNumbers`); null for a "*" no characteristic-defining ability evaluated. Absent when it has none. */
  power?: number | null;
  toughness?: number | null;
  /** Printed loyalty and defense (CR 306.5b, 310.4b), as the characteristics have them; the counters on the object are in `GameObject.counters`. */
  loyalty?: string;
  defense?: string;
  /** The keyword abilities it has after layer 6, by canonical lower-case name ("flying", "ward"), in order. */
  keywords: string[];
  abilities: ViewCharsAbility[];
  /** Battlefield only: summoning sickness (CR 302.6), as the browser board shows it (board/model.ts). */
  summoningSick?: boolean;
}

/** The summary of `o` (an object of `s`), or null when the engine cannot compute its characteristics (the browser board then shows none either). */
export function viewCharsOf(s: GameState, o: GameObject): ViewChars | null {
  let c: Chars;
  try {
    c = getChars(s, o.id);
  } catch {
    return null;
  }
  const naming = namingOf(c);
  const out: ViewChars = {
    name: c.name,
    manaCost: c.manaCost === null ? null : c.manaCost.map((x) => ({ ...x })),
    manaValue: c.manaValue,
    colors: c.colors,
    supertypes: c.supertypes,
    types: c.types,
    subtypes: c.subtypes,
    controller: c.controller,
    keywords: c.keywords.map((k) => k.keyword),
    abilities: c.abilities.map((a) => abilityOf(a.key, a.def, naming)),
  };
  if (c.power !== undefined || c.toughness !== undefined) {
    const pt = ptNumbers(c);
    out.power = pt.power;
    out.toughness = pt.toughness;
  }
  if (c.loyalty !== undefined) out.loyalty = c.loyalty;
  if (c.defense !== undefined) out.defense = c.defense;
  if (o.zone === 'battlefield') out.summoningSick = sickOrFalse(s, o, c);
  return out;
}

function sickOrFalse(s: GameState, o: GameObject, c: Chars): boolean {
  try {
    return isSummoningSick(s, o, c);
  } catch {
    return false;
  }
}

/** The summaries of every object of `s` that `shown` says the viewer may see, in the state's object order (a view's `chars`). */
export function viewCharsFor(s: GameState, shown: (id: ObjectId) => boolean): Record<ObjectId, ViewChars> {
  const out: Record<ObjectId, ViewChars> = {};
  for (const [id, o] of Object.entries(s.objects)) {
    if (!shown(id)) continue;
    const c = viewCharsOf(s, o);
    if (c) out[id] = c;
  }
  return out;
}

// ---- the reading of an ability, memoized ----------------------------------------------------------------------------------------------------

/** `renderAbility`'s naming context of an object ("~" is its first name; its types choose "enchanted" or "equipped"), with its memo key. */
interface Naming {
  selfNames: string[];
  selfTypes: string[];
  key: string;
}

function namingOf(c: Chars): Naming {
  const selfNames = c.names.length > 0 ? c.names : [c.name];
  const selfTypes = [...c.supertypes, ...c.types, ...c.subtypes];
  return { selfNames, selfTypes, key: `${selfNames.join('\u0001')}\u0002${selfTypes.join(' ')}` };
}

/**
 * The summary entries of frozen ability definitions, per naming context and key: one frozen entry shared by every view that shows the ability (so a
 * view patch finds it unchanged by identity, core/view-patch.ts).
 */
const BY_DEF = new WeakMap<AbilityDef, Map<string, ViewCharsAbility>>();
/** Entries of other definitions, by their JSON, naming context and key; the oldest go first past `BY_JSON_CAP`. */
const BY_JSON = new Map<string, ViewCharsAbility>();
const BY_JSON_CAP = 4000;

function abilityOf(key: string, def: AbilityDef, naming: Naming): ViewCharsAbility {
  if (Object.isFrozen(def)) {
    let per = BY_DEF.get(def);
    if (!per) BY_DEF.set(def, (per = new Map()));
    const k = `${key}\u0003${naming.key}`;
    let a = per.get(k);
    if (a === undefined) per.set(k, (a = entryOf(key, def, naming)));
    return a;
  }
  const k = `${key}\u0003${naming.key}\u0003${JSON.stringify(def)}`;
  let a = BY_JSON.get(k);
  if (a === undefined) {
    a = entryOf(key, def, naming);
    if (BY_JSON.size >= BY_JSON_CAP) BY_JSON.delete(BY_JSON.keys().next().value!);
    BY_JSON.set(k, a);
  }
  return a;
}

function entryOf(key: string, def: AbilityDef, naming: Naming): ViewCharsAbility {
  return Object.freeze({ key, text: readAbility(def, naming.selfNames, naming.selfTypes), ...(def.kind === 'manual' ? { manual: true as const } : {}) });
}

/** The reading of one ability of an object named `selfNames` with the types `selfTypes` (not memoized: `abilityOf` keeps it). */
export function readAbility(def: AbilityDef, selfNames: string[], selfTypes: string[]): string {
  const name = selfNames[0] ?? '';
  const own = (def.text ?? '').trim();
  // The Oracle text the ability was compiled from (when the definition still has it) chooses the card's own reading (render/api.ts, design 10.5).
  const sentences = renderAbility(def, { selfNames, selfTypes, ...(own !== '' ? { oracleLines: [own] } : {}) });
  let text = sentences.join(' ');
  // A form the renderer cannot print yet shows the ability's own text (what the card says), never a marker.
  if (text.startsWith('[cannot render') && own !== '') text = own.replace(/~/g, name);
  return def.label ? `${def.label} \u2014 ${text}` : text;
}
