/**
 * Structural validation of one keyword data file (`keywords/data/<name>.json`, design 7.2). Pure; returns the problems, empty when the file is well formed.
 * The registry refuses to build when any file has a problem, so a bad data file is a loud failure at import time and a failing test, never a silently
 * ignored keyword. (Whether the EXPANSION is a valid ability is the job of the ability validator of WP1, `model/validate.ts`; this checks the keyword file itself
 * and that the expansion only uses placeholders the instance can fill.)
 */
import { HOOK_NAMES, type KeywordDefData } from './types';

/**
 * FAST5X E18: keywords newer than the Comprehensive Rules in rules/cr, whose data says `rule: "reminder"` (the reminder text is the rule source). Empty since the
 * 2026-09-25 edition gave Storied, the first one, CR 702.195, until trek-1 added Beam me up (Star Trek, CR 702 rule number not in that edition).
 */
export const REMINDER_RULE_KEYWORDS: readonly string[] = [
  'beam me up', // trek-1: Star Trek (Open Communications); its reminder text is the rule source
];

const MECHANISMS = ['flag', 'hook', 'expands', 'castOption', 'replacement', 'structural'];
const PARAM_TYPES: Record<string, string[]> = { cost: ['cost'], amount: ['number'], quality: ['quality'], filter: ['filter'] };
const KNOWN_KEYS = new Set(['name', 'aliases', 'rule', 'params', 'mechanisms', 'reminder', 'multiple', 'status', 'hooks', 'readers', 'expand', 'modifies', 'family']);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Every `$name` placeholder and `$ifParam` name used in an expansion template. */
export function placeholdersOf(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof node === 'string') {
    if (node.startsWith('$')) out.add(node.slice(1));
  } else if (Array.isArray(node)) {
    for (const x of node) placeholdersOf(x, out);
  } else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ifParam' && typeof v === 'string') out.add(v);
      else if (k === '$byQuality') { out.add('quality'); placeholdersOf(v, out); } // FAST5X E1: the branches are chosen by the quality param
      else if (k === '$costAdd') placeholdersOf(v, out);
      else placeholdersOf(v, out);
    }
  }
  return out;
}

export function keywordDataProblems(d: unknown): string[] {
  const p: string[] = [];
  if (!isObj(d)) return ['not an object'];
  const name = typeof d['name'] === 'string' ? d['name'] : '?';
  const bad = (m: string): void => void p.push(`${name}: ${m}`);
  for (const k of Object.keys(d)) if (!KNOWN_KEYS.has(k)) bad(`unknown key "${k}"`);
  if (typeof d['name'] !== 'string' || d['name'] === '' || d['name'] !== d['name'].toLowerCase() || d['name'] !== d['name'].trim()) bad('name must be a non-empty lower-case string');
  if (d['aliases'] !== undefined && !(Array.isArray(d['aliases']) && d['aliases'].every((a) => typeof a === 'string' && a === a.toLowerCase()))) bad('aliases must be lower-case strings');
  // FAST5X E18 INTERFACE CHANGE (additive): "reminder" for a keyword of a set newer than the Comprehensive Rules in rules/cr: its reminder text is the rule
  // source until the CR gives it a number (REMINDER_RULE_KEYWORDS lists them)
  if (typeof d['rule'] !== 'string' || !(/^702\.\d+$/.test(d['rule']) || (d['rule'] === 'reminder' && REMINDER_RULE_KEYWORDS.includes(name)))) bad('rule must be "702.<n>" (or "reminder" for a keyword listed in REMINDER_RULE_KEYWORDS)');
  if (typeof d['reminder'] !== 'string') bad('reminder must be a string (empty when the keyword has no reminder text)');
  if (!['redundant', 'redundantPerParam', 'cumulative', 'independent'].includes(String(d['multiple']))) bad('multiple must be redundant | redundantPerParam | cumulative | independent');
  if (d['family'] !== undefined && !(typeof d['family'] === 'string' && d['family'] !== '' && d['family'] === d['family'].toLowerCase() && d['family'] !== d['name'])) bad('family must be the lower-case name of another keyword');
  if (!['implemented', 'planned', 'native'].includes(String(d['status']))) bad('status must be implemented | planned | native');

  const paramNames = new Set<string>();
  if (!Array.isArray(d['params'])) bad('params must be an array');
  else {
    for (const q of d['params']) {
      if (!isObj(q) || typeof q['name'] !== 'string') {
        bad('a param needs a name');
        continue;
      }
      const types = PARAM_TYPES[q['name']];
      if (!types) bad(`param name "${q['name']}" is not cost | amount | quality | filter`);
      else if (!types.includes(String(q['type']))) bad(`param ${q['name']} must have type ${types.join('|')}, not ${String(q['type'])}`);
      if (paramNames.has(q['name'])) bad(`duplicate param "${q['name']}"`);
      paramNames.add(q['name']);
    }
  }

  const mechanisms = Array.isArray(d['mechanisms']) ? (d['mechanisms'] as unknown[]) : null;
  if (mechanisms === null || !mechanisms.every((m) => typeof m === 'string' && MECHANISMS.includes(m))) bad(`mechanisms must be a list of ${MECHANISMS.join(' | ')}`);
  const has = (m: string): boolean => mechanisms?.includes(m) === true;

  const hooks = d['hooks'];
  if (hooks !== undefined) {
    if (!Array.isArray(hooks) || !hooks.every((h) => (HOOK_NAMES as readonly unknown[]).includes(h))) bad(`hooks must be names of KeywordHooks (${HOOK_NAMES.join(', ')})`);
    else if (hooks.length > 0 && !has('hook')) bad('hooks are listed but the mechanism "hook" is not');
  }
  if (has('hook') && d['status'] === 'implemented' && !(Array.isArray(hooks) && hooks.length > 0)) bad('mechanism "hook" with status implemented needs at least one entry in hooks');
  const readers = d['readers'];
  if (readers !== undefined && !(Array.isArray(readers) && readers.every((r) => typeof r === 'string' && /^[\w./-]+\.ts#\w+$/.test(r)))) bad('readers must be "<file>.ts#<function>" strings');
  if (d['status'] === 'implemented' && (has('flag') || has('hook')) && !(Array.isArray(readers) && readers.length > 0)) bad('an implemented flag or hook keyword must list its readers (design 7.1.6)');

  const expand = d['expand'];
  if (expand !== undefined) {
    // FAST5X E1: an item may be {"$ifTypes": [...], "then": ability, "else": ability} (keywords/expand.ts): each branch present is an ability
    const isAbility = (e: unknown): boolean => isObj(e) && typeof e['kind'] === 'string' && typeof e['text'] === 'string';
    // Cloud r3-mech: or {"$ifParam": "<param>", "then": ability, "else": ability} (mayhem with and without a cost, CR 702.187a-b): each branch present is an ability
    const isItem = (e: unknown): boolean => isAbility(e) || (isObj(e) && (Array.isArray(e['$ifTypes']) || typeof e['$ifParam'] === 'string') && (e['then'] === undefined || isAbility(e['then'])) && (e['else'] === undefined || isAbility(e['else'])));
    if (!Array.isArray(expand) || expand.length === 0 || !expand.every(isItem)) bad('expand must be a non-empty list of abilities with kind and text');
    else {
      for (const ph of placeholdersOf(expand)) {
        if (!['cost', 'amount', 'quality', 'filter', 'costAdd', 'ifParam'].includes(ph)) bad(`expand uses the unknown placeholder "$${ph}"`);
        else if (PARAM_TYPES[ph] && !paramNames.has(ph)) bad(`expand uses $${ph} but the keyword has no ${ph} param`);
      }
    }
  }
  if (d['status'] === 'implemented' && (has('expands') || has('castOption') || has('replacement')) && expand === undefined && d['modifies'] === undefined) {
    bad('an implemented keyword with mechanism expands | castOption | replacement needs its expand (or modifies)');
  }
  if (d['modifies'] !== undefined) {
    const kind = isObj(d['modifies']) ? d['modifies']['kind'] : undefined;
    if (kind !== 'activated' && kind !== 'modal' && kind !== 'grant') bad('modifies must be {kind:"activated", ...}, {kind:"modal", chooseAll:{when}} or {kind:"grant", while}');
    if (kind === 'modal' && !(isObj(d['modifies']) && isObj(d['modifies']['chooseAll']) && isObj(d['modifies']['chooseAll']['when']))) bad('a modal modifier needs chooseAll.when');
    if (kind === 'grant' && !(isObj(d['modifies']) && isObj(d['modifies']['while']))) bad('a grant modifier needs while (FAST5X-4, CR 702.178a)');
    if ((kind === 'activated' || kind === 'grant') && expand !== undefined) bad('a wrapper keyword (modifies activated or grant) generates no ability of its own: no expand');
  }
  for (const m of String(d['reminder']).matchAll(/\{(cost|n|quality)\}/g)) {
    const need = m[1] === 'cost' ? 'cost' : m[1] === 'n' ? 'amount' : null;
    if (need !== null && !paramNames.has(need)) bad(`reminder uses {${m[1]}} but the keyword has no ${need} param`);
    if (m[1] === 'quality' && !paramNames.has('quality') && !paramNames.has('filter')) bad('reminder uses {quality} but the keyword has no quality or filter param');
  }
  return p;
}

/** The problems of a list of files, including duplicate names and aliases across files. */
export function keywordDataSetProblems(all: readonly unknown[]): string[] {
  const p: string[] = [];
  const seen = new Map<string, string>();
  const names = new Set(all.map((d) => (d as KeywordDefData).name));
  for (const d of all) {
    p.push(...keywordDataProblems(d));
    const data = d as KeywordDefData;
    if (typeof data.family === 'string' && !names.has(data.family)) p.push(`${data.name}: family "${data.family}" is not a keyword of the library`);
    for (const n of [data.name, ...(data.aliases ?? [])]) {
      if (typeof n !== 'string') continue;
      const prev = seen.get(n);
      if (prev !== undefined) p.push(`${data.name}: the name "${n}" is already used by ${prev}`);
      else seen.set(n, data.name);
    }
  }
  return p;
}
