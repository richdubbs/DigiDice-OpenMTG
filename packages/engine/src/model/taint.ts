/**
 * Taint: how far a manual island spreads (design 6.7). Owner: WP1 (the parser's lowering, WP17, uses the same word list and the same rules).
 *
 *  - T1 forward poisoning: a step that reads (`bound`, `did`, `resultCount`, `var`, `linked`, a capture or a reflexive wait) a name or value produced by
 *    a manual step is manual too, transitively. Names bound inside a branch or loop never escape it (model/lint-flow.ts), so the walk is per list.
 *  - T2 contagion: if a manual sentence contains a modifier word, the whole effect program becomes one manual step (earlier automated steps included).
 *    `would`, `instead`, `unless`, `except`, `still`, `twice`... change the meaning of what the sentence modifies, in either direction, and a prompt
 *    cannot intercept a later event (design 6.7).
 *
 * The functions here only DECIDE (they return paths); model/degrade.ts rewrites the tree.
 */
import { ABILITY_DEFS, walkValue } from './walk';

type Rec = Record<string, unknown>;
const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : []);

/** The closed list of modifier words (design 6.7). */
export const MODIFIER_WORDS: readonly string[] = [
  'instead', 'rather than', 'except', 'unless', "can't", 'cannot', 'additional', 'also', 'in addition', 'as though', 'if able', 'only', 'each other',
  'each time', 'still', 'this way', 'would', 'until', 'twice', 'half', 'double', 'triple', 'again', 'extra', 'that many', 'that much', 'no more than',
  'at least', 'up to', 'any number', 'random', 'chosen', 'different', 'same',
];

const MODIFIER_RE = new RegExp(`(?<![\\w'])(${MODIFIER_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w'])`, 'i');

/** The first modifier word in a sentence, lower-cased, or null. */
export function modifierWord(text: string): string | null {
  const m = MODIFIER_RE.exec(text.replace(/’/g, "'"));
  return m ? m[1]!.toLowerCase() : null;
}

/** The step lists nested in a step, with the pointer of each (alternatives and bodies; design 8.3). */
export function nestedLists(step: Rec, path: string): { list: Rec[]; path: string }[] {
  const out: { list: Rec[]; path: string }[] = [];
  const add = (key: string): void => {
    if (Array.isArray(step[key])) out.push({ list: step[key] as Rec[], path: `${path}/${key}` });
  };
  switch (step['op']) {
    case 'if': add('then'); add('else'); break;
    case 'may': add('do'); add('otherwise'); break;
    case 'pay': add('then'); add('else'); break;
    case 'forEach': case 'repeat': case 'delay': case 'reflexive': add('do'); break;
    case 'flipCoin': add('onWin'); add('onLose'); break;
    case 'clash': add('onWin'); add('onLose'); break; // p2-player-rules-2 (CR 701.30)
    case 'rollDie': arr(step['table']).forEach((row, j) => { if (Array.isArray(row['do'])) out.push({ list: row['do'] as Rec[], path: `${path}/table/${j}/do` }); }); break;
    default:
  }
  return out;
}

export interface Taint {
  names: ReadonlySet<string>;
  vars: ReadonlySet<string>;
  /** Links (CR 607) whose producing step is manual: a consumer reads nothing. */
  links: ReadonlySet<string>;
}

/** What one step reads in its own fields (not in its nested steps). */
export function ownReferences(step: Rec, path: string): Taint {
  const names = new Set<string>();
  const vars = new Set<string>();
  const links = new Set<string>();
  walkValue(step, 'EffectStep', (n) => {
    if (n.path !== path && (n.def === 'EffectStep' || ABILITY_DEFS.has(n.def))) return false;
    const v = n.value;
    if ((n.def === 'ObjRef' || n.def === 'PlayerRef') && v['ref'] === 'bound') names.add(v['name'] as string);
    else if ((n.def === 'ObjRef' || n.def === 'PlayerRef') && v['ref'] === 'linked') links.add(v['link'] as string);
    else if ((n.def === 'ObjectFilter.chosen' || (n.def === 'Condition' && v['cond'] === 'chosen')) && typeof v['link'] === 'string') links.add(v['link']);
    else if (n.def === 'Condition' && v['cond'] === 'did') names.add(v['step'] as string);
    else if (n.def === 'Quantity' && (v['q'] === 'resultCount' || v['q'] === 'excessDamage' || v['q'] === 'lifeLost' || v['q'] === 'countersRemoved' || v['q'] === 'countersPut' || v['q'] === 'votes' || v['q'] === 'damageDealt')) names.add(v['step'] as string); // FAST5X E16: excessDamage
    else if (n.def === 'Quantity' && v['q'] === 'var') vars.add(v['name'] as string);
    return undefined;
  }, { path });
  const when = step['when'] as Rec | undefined;
  if (step['op'] === 'reflexive' && typeof when?.['did'] === 'string') names.add(when['did']);
  if (step['op'] === 'delay') for (const c of (step['capture'] as string[] | undefined) ?? []) names.add(c);
  return { names, vars, links };
}

/**
 * T1 over one step list: the paths of the steps that must become manual because they read what a manual step (or an earlier poisoned one) produces.
 * `culprits` are the paths of steps that are manual for another reason (and the pre-existing `manual` steps); `out` receives path -> reason.
 */
export function poisonedSteps(list: Rec[], path: string, culprits: ReadonlySet<string>, out: Map<string, string>, inherited: Taint = { names: new Set(), vars: new Set(), links: new Set() }): void {
  const names = new Set(inherited.names);
  const vars = new Set(inherited.vars);
  const links = new Set(inherited.links);
  list.forEach((step, i) => {
    const p = `${path}/${i}`;
    let manual = culprits.has(p) || step['op'] === 'manual';
    if (!manual) {
      const refs = ownReferences(step, p);
      const hit = [...refs.names].find((n) => names.has(n)) ?? [...refs.vars].find((v) => vars.has(v)) ?? [...refs.links].find((l) => links.has(l));
      if (hit !== undefined) {
        out.set(p, `tainted: reads "${hit}", which a manual step produces`);
        manual = true;
      }
    }
    if (manual) {
      if (step['op'] !== 'forEach' && typeof step['as'] === 'string') names.add(step['as']);
      if (step['op'] === 'piles') for (const k of ['chosen', 'other']) if (typeof step[k] === 'string') names.add(step[k] as string);
      if (step['op'] === 'revealUntil' && typeof step['revealed'] === 'string') names.add(step['revealed']); // r3-dig: every card revealed
      if (step['op'] === 'exileUntil' && typeof step['exiled'] === 'string') names.add(step['exiled']); // trek-7: every card exiled
      if (typeof step['cantAs'] === 'string') names.add(step['cantAs']); // C6: the players who can't (discard, sacrificeChoice)
      if (step['op'] === 'let' && typeof step['name'] === 'string') vars.add(step['name']);
      if (typeof step['link'] === 'string') links.add(step['link']);
      return;
    }
    for (const nested of nestedLists(step, p)) poisonedSteps(nested.list, nested.path, culprits, out, { names, vars, links });
  });
}
