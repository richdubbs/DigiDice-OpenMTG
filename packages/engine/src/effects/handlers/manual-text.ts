/**
 * "Is this keyword action modified by text the engine does not run?" (design 10: fail closed, never approximately). Shared by the native keyword actions of
 * actions-native.ts (WP32: cascade, discover, vote) and actions-native-counters.ts (PUSH1 T1: proliferate, bolster). Moved here unchanged from
 * actions-native.ts so both modules can use it without an import cycle (design 5.4). Owner: PUSH1 T1 (new file; `macroReplacedByManualText` is read by
 * handlers/game.ts, the `action` op).
 */
import type { Game } from '../../core/game';
import { charsOfObject } from '../../rules/characteristics';
import { syncHistory } from '../../triggers/stack';

/**
 * PUSH1 T1: the macro keyword actions (keywords/actions/*: no handler of their own) whose events another card's text replaces in the corpus: "If a creature you
 * control would explore, instead ..." (CR 614.1a, 701.44), "If a creature you control would connive, instead ..." (CR 701.50). Replacement effects of other
 * objects are milestone 6 (`feature:replace.foreign`), so such text is a manual static ability, and a macro run while it is in play would skip it silently.
 * The same fail-closed rule as the native actions applies (design 10): while text the engine does not run says "would <verb>", the action is resolved by hand.
 */
const MACRO_REPLACED: Readonly<Record<string, RegExp>> = {
  investigate: /\bwould investigate\b/i,
  explore: /\bwould explore\b/i,
  connive: /\bwould connive\b/i,
  amass: /\bwould amass\b/i,
  incubate: /\bwould incubate\b/i,
  populate: /\bwould populate\b/i,
};

/** For a macro action: the manual text that replaces it ("would explore"), or null (see `MACRO_REPLACED`). */
export function macroReplacedByManualText(g: Game, action: string): string | null {
  const re = MACRO_REPLACED[action];
  return re === undefined ? null : modifiedByManualText(g, re);
}

/** The texts of the manual nodes (a manual ability, a manual step) anywhere in a JSON tree: a card definition, an ability definition. */
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

/**
 * Is the action modified by text the engine does not run? Then it is resolved by hand. Three places can hold such text:
 *  - a manual ability of an object in play (battlefield, command zone): a static or "while voting" ability;
 *  - a reminder chip a manual step left for text that outlives it (ManualReminder);
 *  - a spell or ability that resolved earlier this turn with manual text that mentions the action (WP32 review: Illusion of Choice, "You choose how each player
 *    votes this turn.", an instant resolved by hand, leaves nothing in play; its effect lasts for the turn, CR 611.2a). Read from the turn's history of
 *    resolutions and the last known information of those stack objects (CR 608.2h): the card's whole definition, and a non-printed ability's own one.
 */
export function modifiedByManualText(g: Game, re: RegExp): string | null {
  const s = g.s;
  for (const id of [...s.zones.battlefield, ...s.zones.command]) {
    const o = s.objects[id];
    if (!o || o.phasedOut) continue;
    for (const a of charsOfObject(s, o).abilities) if (a.def.kind === 'manual' && re.test(a.def.text)) return `${g.nameOf(id)}: "${a.def.text}"`;
  }
  for (const r of s.reminders) if (re.test(r.text)) return `${r.sourceName}: "${r.text}"`;
  syncHistory(g); // what resolved earlier in this action is not in the history yet
  for (const h of s.history) {
    if (h.turn !== s.turn.number || h.ev !== 'resolves' || h.subject === undefined) continue;
    const o = s.objects[h.subject] ?? s.lki[h.subject]?.object;
    if (!o) continue;
    const hit = manualTexts([s.defs[o.defId], o.stack?.inline ?? null], []).find((t) => re.test(t));
    if (hit !== undefined) return `${o.stack?.sourceName ?? s.defs[o.defId]?.name ?? 'a spell'}, which resolved this turn: "${hit}"`;
  }
  return null;
}
