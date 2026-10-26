/**
 * Pass 8b, same-for (std-combat-2; CR 608.2c, 122.1b): "If that creature has haste and ~ doesn't, put a haste counter on ~. Do the same for flying, first strike,
 * ... and vigilance." (Super-Adaptoid). Template eff.stdcombat2.sameFor builds the intermediate node `{"lower": "sameFor", "what": [<keyword abilities>]}`. The
 * sentence right before it, understood and with one step, names exactly one keyword, in its keyword tests (`filter.keyword`) and keyword counters (`putCounters`
 * of that kind); the node becomes that step once more for each listed keyword, in the printed order, the keyword replaced. Anything else is manual (fail closed):
 * a keyword the sentence before names twice or not at all, a listed ability with a parameter or one that is not a keyword counter where a counter is put.
 */
import { KEYWORD_COUNTERS } from '../../types/ability';
import type { Draft, Rec, Unit } from './types';
import { clone, cloneDraft, isRec, sequences, setManual, visit } from './util';

const sameForNode = (u: Unit): Rec | null => {
  const only = u.steps.length === 1 ? u.steps[0] : undefined;
  return isRec(only) && only['lower'] === 'sameFor' ? only : null;
};

/** pc-combat-1 (CR 608.2c, 508.1, 303.4; the Curses): the node of "Each opponent attacking that player does the same" (template eff.pccombat1.attackersDoTheSame). */
const attackersNode = (u: Unit): Rec | null => {
  const only = u.steps.length === 1 ? u.steps[0] : undefined;
  return isRec(only) && only['lower'] === 'attackersDoSame' ? only : null;
};

/**
 * pc-combat-1 (CR 608.2c, 508.1a, 303.4; Curse of Opulence, Curse of Vitality): the opponents who attack the player the source Aura is attached to, "each opponent attacking that
 * player" (the attackers of one declaration are all the active player's, CR 508.1a, so these are the opponents with a creature attacking enchanted player). The player of
 * `eachWho` with scope `attacking` reads them as the effect resolves (the opponents who control a creature attacking that player; effects/refs.ts), as the Curse of Opulence ruling says.
 */
export const ATTACKING_ENCHANTED_PLAYER = { ref: 'eachWho', who: 'opponent', did: { ev: 'attacks', defender: { ref: 'enchantedPlayer' } }, scope: 'attacking' } as const;
/** The instructions "does the same" repeats for those players: a player's own draw, life gain or token creation (the performer is the `who` of the step). */
const SAME_FOR_PLAYER = ['draw', 'gainLife', 'createToken'];

/** The one keyword the step names (its keyword tests and keyword counters), or null when it names none, two, or the keyword in any other place. */
function onlyKeyword(step: Rec): string | null {
  const seen = new Set<string>();
  let bad = false;
  visit(step, (n) => {
    if ('keyword' in n) { if (typeof n['keyword'] === 'string') seen.add(n['keyword']); else bad = true; }
    if ('notKeyword' in n) bad = true;
    if (n['op'] === 'putCounters' && typeof n['kind'] === 'string' && KEYWORD_COUNTERS.includes(n['kind'])) seen.add(n['kind']);
  });
  return !bad && seen.size === 1 ? [...seen][0]! : null;
}

/** The step with every keyword test and keyword counter of `from` made `to`. */
function withKeyword(step: Rec, from: string, to: string): Rec {
  const out = clone(step);
  visit(out, (n) => {
    if (n['keyword'] === from) n['keyword'] = to;
    if (n['op'] === 'putCounters' && n['kind'] === from) n['kind'] = to;
  });
  return out;
}

/** The keyword names of the listed abilities (bare keywords only), or null. */
function listedKeywords(what: unknown): string[] | null {
  if (!Array.isArray(what) || what.length === 0) return null;
  const out: string[] = [];
  for (const a of what) {
    if (!isRec(a) || a['kind'] !== 'keyword' || typeof a['keyword'] !== 'string') return null;
    if (Object.keys(a).some((k) => k !== 'kind' && k !== 'keyword' && k !== 'text')) return null;
    out.push(a['keyword']);
  }
  return new Set(out).size === out.length ? out : null;
}

export function lowerSameFor(draft: Draft): Draft {
  if (!sequences(draft).some((seq) => seq.some((u) => sameForNode(u) !== null || attackersNode(u) !== null))) return draft;
  const d = cloneDraft(draft);
  for (const seq of sequences(d)) {
    seq.forEach((u, i) => {
      if (u.manual === undefined && attackersNode(u) !== null) {
        const prev = seq[i - 1];
        const failA = (reason: string): void => setManual(u, { code: 'unbound-reference', reason: `"each opponent attacking that player does the same": ${reason} (CR 608.2c)` });
        const step = prev?.steps.length === 1 ? prev.steps[0] : undefined;
        if (prev === undefined || i !== 1 || prev.manual !== undefined || prev.rider !== undefined || !isRec(step)) { failA('the sentence before it is not the one understood instruction of the ability'); return; }
        if (typeof step['op'] !== 'string' || !SAME_FOR_PLAYER.includes(step['op']) || JSON.stringify(step['who']) !== '{"ref":"you"}') { failA('the instruction before it is not a draw, life gain or token creation of the controller'); return; }
        u.steps = [{ ...clone(step), who: { ...ATTACKING_ENCHANTED_PLAYER } }];
        return;
      }
      const node = sameForNode(u);
      if (u.manual !== undefined || node === null) return;
      const prev = seq[i - 1];
      const fail = (reason: string): void => setManual(u, { code: 'unbound-reference', reason: `"do the same for": ${reason} (CR 608.2c)` });
      if (prev === undefined || prev.manual !== undefined || prev.rider !== undefined || prev.steps.length !== 1 || !isRec(prev.steps[0])) { fail('the sentence before it is not one understood instruction'); return; }
      const from = onlyKeyword(prev.steps[0]);
      const list = listedKeywords(node['what']);
      if (from === null) { fail('the sentence before it names no single keyword'); return; }
      if (list === null || list.includes(from)) { fail('the list is not of other bare keywords'); return; }
      const counters = JSON.stringify(prev.steps[0]).includes('"op":"putCounters"');
      if (counters && !list.every((k) => KEYWORD_COUNTERS.includes(k))) { fail('a listed keyword is no keyword counter (CR 122.1b)'); return; }
      u.steps = list.map((k) => withKeyword(prev.steps[0]!, from, k));
    });
  }
  return d;
}
