/**
 * R1 (M6-7a) review: the text the engine does not run that could change which attack or block declarations are legal (CR 508.1d, 509.1c).
 *
 * The requirements of a declaration are counted against EVERY restriction and cost: "the maximum number of requirements obeyed without violating any
 * restrictions", and a requirement that would need a cost to obey does not count (CR 508.1d, 509.1c-d). The engine models only some restrictions
 * (rules/combat-rules.ts) and no cost to attack or block, while cards such as Silent Arbiter ("No more than one creature can attack each combat."), Ghostly
 * Prison ("Creatures can't attack you unless their controller pays {2} ...") or Ironclaw Orcs ("can't block creatures with power 2 or greater") are manual.
 * With such text in play the maximum the engine computes may be wrong in either direction, so the declaration is not checked against it (design m6 3.9,
 * D13: never a wrong rejection) and the players settle it by hand, told so before they choose.
 *
 * Conservative: any manual text that mentions attacking or blocking counts, even one that only changes characteristics (Watchdog's "all creatures attacking
 * you get -1/-0" changes which blocks skulk allows, CR 702.118b); for attacks also defender (CR 702.3b), for blocks also the evasion abilities and
 * protection a manual effect may grant (a "must be blocked" requirement would otherwise force a block the rules forbid, CR 509.1b). Three places can hold
 * it (as in effects/handlers/actions-native.ts):
 *   - a manual static (or unknown-shape) ability of an object in play (battlefield, command zone), or a manual node inside one of its static abilities;
 *   - a reminder chip a manual step left for text that outlives it (not the chips this module's caller leaves itself: `REQUIREMENT_CHIP`);
 *   - a spell or ability with manual text that resolved this turn (its effect may last for the turn, CR 611.2a), read from the history and the last known
 *     information of the stack object (CR 608.2h).
 * Manual triggered and activated abilities in play do nothing until they resolve, and then they are in the history.
 */
import type { GameState } from '../types/state';
import { combatTaxTexts } from '../statics/combat-tax';
import { declarationLimits } from '../statics/hooks';
import { charsOfObject } from './characteristics';

/** One piece of manual text that may change the legality of a declaration. */
export interface ManualCombatText {
  sourceName: string;
  text: string;
  /** r5-static: automated text that puts a cost or a limit on the declaration (statics/combat-tax.ts, statics/hooks.ts#declarationLimits; CR 508.1c-d, 509.1b-d). */
  cost?: true;
}

/** The id prefix of the reminder chips the declare steps leave for what they could not check (core/combat.ts): not a manual restriction themselves. */
export const REQUIREMENT_CHIP = 'req-chip:';

const MENTIONS: Record<'attack' | 'block', RegExp> = {
  attack: /\b(attack|block|defender)/i, // defender: CR 702.3b
  block: /\b(attack|block|flying|reach|shadow|horsemanship|fear|intimidate|menace|skulk|\w*walk|protection)/i, // CR 509.1b: evasion (CR 702.9b ...), protection (CR 702.16f)
};

/** The texts of the manual nodes (a manual ability, a manual step) anywhere in a JSON tree. */
function manualTexts(node: unknown, out: string[]): string[] {
  if (Array.isArray(node)) {
    for (const x of node) manualTexts(x, out);
  } else if (node !== null && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if ((o['kind'] === 'manual' || o['op'] === 'manual') && typeof o['text'] === 'string') out.push(o['text']);
    for (const k in o) manualTexts(o[k], out);
  }
  return out;
}

/** CR 508.1d, 509.1c: the manual text in play, in chips, or resolved this turn that may change the legality of this declaration (deduplicated, in that order). */
export function manualCombatTexts(s: GameState, kind: 'attack' | 'block'): ManualCombatText[] {
  const out: ManualCombatText[] = [];
  const re = MENTIONS[kind];
  const add = (sourceName: string, text: string): void => {
    if (re.test(text) && !out.some((x) => x.sourceName === sourceName && x.text === text)) out.push({ sourceName, text });
  };
  for (const id of [...s.zones.battlefield, ...s.zones.command]) {
    const o = s.objects[id];
    if (!o || o.phasedOut) continue;
    const c = charsOfObject(s, o);
    const name = c.name || 'a face-down permanent';
    for (const a of c.abilities) {
      const d = a.def;
      if (d.kind === 'manual') {
        if (d.shape === 'static' || d.shape === 'unknown') add(name, d.text);
      } else if (d.kind === 'static' || d.kind === 'keyword') {
        for (const t of manualTexts(d, [])) add(name, t);
      }
    }
  }
  for (const r of s.reminders) if (!r.id.startsWith(REQUIREMENT_CHIP)) add(r.sourceName, r.text);
  // r5-static (CR 508.1d, 509.1c-d): a cost to attack or block the engine charges (statics/combat-tax.ts) changes which requirements count as well
  // r5-static (CR 508.1c-d, 509.1b-c): and so does a limit on the whole declaration ("No more than one creature can attack each combat"): the search knows none
  const limits = declarationLimits(s, kind).map((l) => ({ sourceName: l.sourceName, text: l.text }));
  for (const t of [...combatTaxTexts(s, kind), ...limits]) if (!out.some((x) => x.sourceName === t.sourceName && x.text === t.text)) out.push({ ...t, cost: true });
  for (const h of s.history) {
    if (h.turn !== s.turn.number || h.ev !== 'resolves' || h.subject === undefined) continue;
    const o = s.objects[h.subject] ?? s.lki[h.subject]?.object;
    if (!o) continue;
    const name = o.stack?.sourceName ?? s.defs[o.defId]?.name ?? 'a spell';
    for (const t of resolvedManualTexts(s.defs[o.defId], o.stack)) add(name, t);
  }
  return out;
}

/**
 * The manual text of what resolved: the ability itself when it is inline (CR 113.7a), else the card's abilities of the stack object's kind (a spell's
 * spell abilities, an activated or triggered ability's own kind), so a permanent spell's static or triggered text is not read as a resolved effect (once in
 * play it is read from there). Without stack information, the whole definition (conservative).
 */
function resolvedManualTexts(def: GameState['defs'][string] | undefined, stack: NonNullable<GameState['objects'][string]>['stack']): string[] {
  if (stack?.inline) return manualTexts(stack.inline, []);
  if (!stack || !def) return manualTexts(def ?? null, []);
  const out: string[] = [];
  for (const face of def.faces) {
    for (const a of face.abilities) {
      if (a.kind === 'manual' ? a.shape === stack.kind : a.kind === stack.kind) manualTexts(a, out);
    }
  }
  return out;
}
