/**
 * Quoted abilities ("Creatures you control gain \"{T}: Add {G}.\"", tokens with "...") parsed as a sub-stream (design 6.1 step 4, CR 113.1c: a quoted
 * ability is an ability of the object that gains it, and inside the quotes "this creature" is that object, CR 201.5a). Owner: WP17.
 *
 * The hole grammar `Abilities` calls this through `HoleEnv.subParser`. Only a quoted ability that is understood COMPLETELY is returned (a keyword list, a
 * static ability, "[cost]: [effect]", "[trigger], [effect]"); anything else returns null, so the sentence that grants it does not parse and stays manual:
 * granting half an ability would be granting a different ability.
 */
import type { AbilityDef, Condition, CostDef, EffectProgram, StaticAbilityDef, StaticEffect, TriggerDef, TriggeredAbilityDef, ZoneName } from '../../types/ability';
import { canonicalJson, runHole } from '../holes';
import type { Tok } from '../holes/tok';
import { spanText } from '../holes/tok';
import { applyTaint } from '../taint';
import { activationLimits, activationZone, requiresSelfExiled } from './activation';
import { costMentionsOf, interveningIfReads, triggerLimitOf } from './ability';
import { lowerProgram } from './index';
import type { Draft, Mention, Unit } from './types';
import type { UnitEnv } from './units';
import { parseEffectUnit, parseWhole } from './units';
import { abilityLevel, isRec, isStaticEffects, leftoverMarker, QUOTED_LINK, rewrite, visit } from './util';

/** std-rx9: a `chosen` filter field of a quoted ability with the link placeholder of the Filter hole (`'$link'`) gets the placeholder of a quoted one. */
const quoteChosen = (v: unknown): unknown => rewrite(v, (n) => {
  const c = n['chosen'];
  if (!isRec(c) || c['link'] !== '$link') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(n)) out[k] = k === 'chosen' ? { ...c, link: QUOTED_LINK } : quoteChosen(x);
  return out;
});

/** The value without its quoted-link placeholders, to look for any other leftover marker. */
const withoutQuotedLinks = (v: unknown): unknown => rewrite(v, (n) => (n['link'] === QUOTED_LINK ? {} : undefined));

/** The ability-level fields of an ability-level template's value (lower/util.ts#abilityLevel), without its effects. */
const levelOf = (lv: NonNullable<ReturnType<typeof abilityLevel>>): Pick<StaticAbilityDef, 'condition' | 'zone'> =>
  ({ ...(lv.condition !== undefined ? { condition: lv.condition } : {}), ...(lv.zone !== undefined ? { zone: lv.zone } : {}) });

function splitSentences(tokens: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of tokens) {
    cur.push(t);
    if (t.kind === 'PUNCT' && t.norm === '.') { out.push(cur); cur = []; }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * PUSH1 T2 review (INTERFACE CHANGE of this WP17 file): the templates a quoted ability that WAS understood used, reported to the caller (parser/parse.ts),
 * so they are recorded with the ability that grants it: an `experimental` template inside the quotes caps the card at partial like one outside them
 * (design 6.9), and the G10 snapshot lists it.
 */
export type QuotedUse = (templates: readonly string[], experimental: readonly string[]) => void;

/** The templates of the readings a quoted ability is made of. */
interface Used { templates: string[]; experimental: string[] }
const record = (into: Used, templates: readonly string[], experimental: readonly string[]): void => {
  for (const t of templates) if (!into.templates.includes(t)) into.templates.push(t);
  for (const t of experimental) if (!into.experimental.includes(t)) into.experimental.push(t);
};

/** A complete program from sentences, or null; the templates of its sentences are recorded in `used`. */
function program(pieces: Tok[][], ue: UnitEnv, selfHeads: string[], used: Used, trigger?: TriggerDef, mentions: Mention[] = [], condition?: Condition): EffectProgram | null {
  const units: Unit[] = pieces.map((tokens, index) => parseEffectUnit({ index, tokens }, ue));
  if (units.some((u) => u.manual)) return null;
  // cmd1: an intervening "if" names objects a pronoun of the effect may refer to, as in a printed trigger (lower/ability.ts#triggered)
  const draft: Draft = { units, targets: [], ...(trigger ? { trigger } : {}), ...(condition ? { condition: condition as never } : {}), selfHeads, mentions, names: [], diagnostics: [] };
  const t = applyTaint(lowerProgram(draft).program);
  let manual = false;
  visit(t.program, (n) => { if (n['op'] === 'manual') manual = true; });
  if (manual || t.units.some((u) => u.manual)) return null;
  for (const u of units) record(used, u.templates, u.experimental);
  return t.program;
}

/**
 * The display text of a quoted ability (W3b audit, Harried Spearguard). The tokens are read from the parse text, where a self reference is "~" padded with
 * blanks ("This token" -> "         ~"); inside the quotes it is the object that has the ability (CR 113.1c, 201.5a), not the card that printed it, so
 * the text shows the words the card prints there ("This token can't block."), read at the same offsets from the face's normalized text. The `self`
 * binding of the ability is unchanged. Without the normalized text, the "~" is trimmed of its padding.
 */
function quotedText(tokens: readonly Tok[], normalized: string | undefined): string {
  const shown = tokens.map((t) => {
    if (t.norm !== '~' || t.text.trim() === t.text) return t;
    const words = normalized !== undefined && t.end <= normalized.length ? normalized.slice(t.start, t.end).trim() : '';
    return { ...t, text: words !== '' && !words.includes('"') ? words : t.text.trim() };
  });
  return spanText(shown, 0, shown.length);
}

const PERMANENT_HEADS = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle'];
const GRANTEE_NOUNS: Readonly<Record<string, readonly string[]>> = {
  creature: ['creature'], artifact: ['artifact'], enchantment: ['enchantment'], land: ['land'], planeswalker: ['planeswalker'], battle: ['battle'],
  vehicle: ['artifact', 'vehicle'], equipment: ['artifact', 'equipment'], aura: ['enchantment', 'aura'], permanent: PERMANENT_HEADS,
};

/**
 * cmd1 (CR 113.1c, 201.5a): the heads of the object that HAS the quoted ability, as its own text calls itself ("this creature", "this land"): a Background's
 * "Commander creatures you own have \"Whenever this creature attacks, another target creature ...\"" is a creature's ability, so "another target creature" is
 * "other than this creature" (lower/targets.ts#otherNotSource), never refused because the card that prints the quote is an enchantment. Null when the quote
 * names itself by no such noun (the printed card's heads are kept).
 */
function granteeHeads(tokens: readonly Tok[], normalized: string | undefined): string[] | null {
  if (normalized === undefined) return null;
  const heads = new Set<string>();
  for (const t of tokens) {
    if (t.norm !== '~' || t.end > normalized.length) continue;
    const m = /^this ([a-z]+)$/.exec(normalized.slice(t.start, t.end).trim().toLowerCase());
    const nouns = m ? GRANTEE_NOUNS[m[1]!] : undefined;
    if (nouns === undefined) return null;
    nouns.forEach((n) => heads.add(n));
  }
  return heads.size > 0 ? [...heads] : null;
}

/**
 * Parse the tokens inside quotation marks as abilities; null when not completely understood. `normalized`: the face's normalized text (the display, and the noun the
 * quote calls its own object by: granteeHeads);
 * `use`: told the templates of a reading that is returned (never of one that is not).
 */
export function parseQuoted(tokens: readonly Tok[], ue: UnitEnv, printedHeads: string[], normalized?: string, use?: QuotedUse): AbilityDef[] | null {
  const used: Used = { templates: [], experimental: [] };
  const selfHeads = granteeHeads(tokens, normalized) ?? printedHeads;
  const done = (out: AbilityDef[] | null): AbilityDef[] | null => {
    if (out !== null) use?.(used.templates, used.experimental);
    return out;
  };
  const text = quotedText(tokens, normalized);
  // T55 (CR 207.2c): an ability word before the dash inside the quotes ("Landfall -- Whenever a land you control enters, ...") has no rules meaning: the ability
  // after it is the quoted ability, and the word is its `label` (rendered back inside the quotes, render/quote.ts)
  const dash = tokens.findIndex((t) => t.kind === 'PUNCT' && t.norm === '--');
  if (dash > 0 && dash <= 3 && dash < tokens.length - 1 && tokens.slice(0, dash).every((t) => t.kind === 'WORD')) {
    const word = tokens.slice(0, dash).map((t) => t.norm).join(' ');
    if (ue.env.lexicon.abilityWords.some((w) => w.toLowerCase() === word)) {
      const inner = parseQuoted(tokens.slice(dash + 1), ue, selfHeads, normalized, use);
      return inner === null ? null : inner.map((a) => ({ ...a, label: tokens.slice(0, dash).map((t) => t.text).join(' '), text }));
    }
  }
  const sentences = splitSentences(tokens);
  if (sentences.length === 0) return null;
  // a keyword
  const kw = parseWhole(tokens, 'ability', ue);
  if (kw.ok && (kw.value as { kind?: string }).kind === 'keyword') {
    record(used, kw.d.templatesUsed, kw.d.experimental);
    return done([{ ...(kw.value as AbilityDef), text }]);
  }
  const first = sentences[0]!;
  // "[cost]: [effect]" (CR 602.1)
  const colon = first.findIndex((t) => t.kind === 'PUNCT' && t.norm === ':');
  if (colon > 0) {
    const alts = runHole('Cost', first.slice(0, colon), 0, ue.env).filter((a) => a.end === colon);
    const vals = new Map(alts.map((a) => [canonicalJson(a.value), a.value]));
    if (vals.size !== 1) return null;
    const cost = JSON.parse(JSON.stringify([...vals.values()][0])) as CostDef;
    if (leftoverMarker(cost) !== null) return null;
    // T55 (CR 602.5d): a trailing "Activate only as a sorcery." is a restriction of the quoted ability, never an instruction; lower/activation.ts#activationLimits
    // reads it as it does for a printed ability. A restriction the controller would have to attest (`onlyIf: ask`) is not understood here.
    // std-control-3 (CR 601.2f, 602.2b, 118.7): "This ability costs {X} less to activate, where X is this creature's power." of a quoted ability is its own cost change
    // (`costChange`, T38), as for a printed ability (lower/ability.ts); never of a loyalty ability
    const lim = activationLimits([first.slice(colon + 1), ...sentences.slice(1)], { text: (t) => spanText(t, 0, t.length), claim: () => undefined }, ue, { costChange: cost.loyalty === undefined });
    if (lim.fields.onlyIf?.cond === 'ask') return null;
    // FAST5 T68 (CR 602.2b, 113.7a): "it" in "{2}, Sacrifice this artifact: It deals damage ..." is the object the cost sacrificed, as in a printed ability (lower/ability.ts#costMentions)
    const effect = program(lim.pieces, ue, selfHeads, used, undefined, costMentionsOf(cost, selfHeads));
    if (effect === null) return null;
    let mana = false;
    visit(effect, (n) => { if (n['op'] === 'addMana') mana = true; });
    if (lim.fields.sorcerySpeed === true && mana) return null; // FAST5X E20, CR 605.1a: a mana ability with a timing restriction is not read here
    if (lim.extras.costChange !== undefined && mana) return null; // T38: not on a mana ability
    record(used, lim.extras.templates, lim.extras.experimental);
    // FAST5 T68 (CR 605.1a, 606.1): a loyalty ability ("[+1]: Add {R}.") is never a mana ability, whatever it does; it is a loyalty ability (activated once per turn at sorcery speed, CR 606.3)
    const loyalty = cost.loyalty !== undefined;
    const change = lim.extras.costChange === undefined ? {} : { costChange: lim.extras.costChange, ...(lim.extras.costChangeIf !== undefined ? { costChangeIf: lim.extras.costChangeIf } : {}) };
    // trek-12 (CR 113.6, 602.5b; Q, Stacking the Deck): "Activate only if this card is exiled" says where the quoted ability functions: in exile (parser/lower/activation.ts#activationZone).
    // Only that zone is stated for a quoted ability; its cost or effect naming the card in another zone is no ability that could be activated, so it is not understood
    let zone: { zone?: ZoneName[] } = {};
    if (requiresSelfExiled(lim.fields.onlyIf)) {
      const where = activationZone(cost, `${lim.pieces.map((p) => spanText(p, 0, p.length)).join(' ')} ${lim.text}`, lim.fields.onlyIf);
      if ('manual' in where) return null;
      zone = where;
    }
    return done([{ kind: 'activated', text, cost, effect, ...lim.fields, ...change, ...zone, ...(mana && effect.targets.length === 0 && !loyalty ? { isMana: true } : {}), ...(loyalty ? { isLoyalty: true } : {}) }]);
  }
  // "[When/Whenever/At] [event], [effect]" (CR 603.1), read as the ability driver reads a printed trigger (lower/ability.ts): every comma is tried, two
  // readings are ambiguous (guard G5). cmd1: an "if" right after the trigger clause is an intervening "if" (CR 603.4), read as lower/ability.ts#triggered
  // reads a printed one (its pronouns name the event's roles; one reading only), never an effect-level "if" (that would check the condition only on
  // resolution); and "This ability triggers only once each turn." after the effect is the trigger's limit (CR 603.2h), never an effect sentence
  const w = first[0]?.norm;
  if (w === 'when' || w === 'whenever' || w === 'at') {
    const found = new Map<string, { at: number; trigger: TriggerDef; templates: string[]; experimental: string[] }>();
    for (let c = 1; c < first.length; c++) {
      if (first[c]!.norm !== ',' || first[c]!.kind !== 'PUNCT') continue;
      const r = parseWhole(first.slice(0, c), 'trigger', ue);
      if (!r.ok) continue;
      const v = r.value as Partial<TriggerDef>;
      if (!Array.isArray(v.on) || v.on.length === 0 || leftoverMarker(v) !== null) continue;
      // std-ru (CR 603.1, 603.2): the condition of the trigger event ("during your turn", "while ...") and "for the first time each turn" come from the template, as
      // for a printed trigger (lower/ability.ts#triggered); a condition with a pronoun left unresolved was refused above (leftoverMarker)
      const trig: TriggerDef = {
        on: v.on, ...(v.batch === true || r.d.flags.includes('batch') ? { batch: true } : {}),
        ...(v.while !== undefined ? { while: v.while } : {}), ...(v.first === 'turn' ? { first: 'turn' as const } : {}),
      };
      found.set(`${c}|${canonicalJson(trig)}`, { at: c, trigger: trig, templates: r.d.templatesUsed, experimental: r.d.experimental });
    }
    if (found.size !== 1) return null;
    const t = [...found.values()][0]!;
    let limit: TriggeredAbilityDef['limit'];
    const later: Tok[][] = [];
    for (const p of sentences.slice(1)) {
      const l = triggerLimitOf(p);
      if (l === null) { later.push(p); continue; }
      if (l === 'unknown' || limit !== undefined) return null;
      limit = l;
    }
    let body = first.slice(t.at + 1);
    let interveningIf: Condition | undefined;
    if (body[0]?.norm === 'if') {
      // the reader of a printed trigger's intervening "if" (lower/ability.ts#interveningIfReads): one reading only (guard G5)
      const reads = interveningIfReads(body, t.trigger, { selfHeads }, ue.env);
      if (reads.length !== 1) return null;
      const r = reads[0]!;
      interveningIf = JSON.parse(JSON.stringify(r.value)) as Condition;
      body = body.slice(r.at + 1);
    }
    const effect = program([body, ...later], ue, selfHeads, used, t.trigger, [], interveningIf);
    if (effect === null) return null;
    record(used, t.templates, t.experimental);
    return done([{ kind: 'triggered', text, trigger: t.trigger, ...(interveningIf !== undefined ? { interveningIf } : {}), effect, ...(limit ? { limit } : {}) }]);
  }
  // a static ability (CR 604). WP22 review (INTERFACE CHANGE): an ability-level template's value carries the condition and zones of the whole ability
  // (lower/util.ts#abilityLevel), read here as lower/ability.ts reads a printed one: tried first over all the sentences, and in a single sentence only
  if (sentences.length > 1) {
    const r = parseWhole(tokens, 'static', ue);
    const lv = r.ok && leftoverMarker(r.value) === null ? abilityLevel(r.value) : null;
    if (lv !== null && r.ok && isStaticEffects(lv.effects)) {
      record(used, r.d.templatesUsed, r.d.experimental);
      return done([{ kind: 'static', text, ...levelOf(lv), effects: lv.effects as StaticEffect[] }]);
    }
  }
  const effects: unknown[] = [];
  let level: ReturnType<typeof levelOf> = {};
  for (const s of sentences) {
    const r0 = parseWhole(s, 'static', ue);
    // std-rx9 (CR 607.2d, 608.2c): "the chosen type" of a quoted static ability is no choice of the object that has it; it keeps a placeholder of its own, which
    // only the ability that creates an emblem with it resolves (lower/links.ts#resolveEmblemChoices), so anywhere else the sentence stays manual
    const r = r0.ok ? { ...r0, value: quoteChosen(r0.value) } : r0;
    if (!r.ok || leftoverMarker(withoutQuotedLinks(r.value)) !== null) return null;
    record(used, r.d.templatesUsed, r.d.experimental);
    const lv = abilityLevel(r.value);
    if (lv !== null) {
      if (sentences.length !== 1) return null; // a condition stated in one sentence never silently covers another
      level = levelOf(lv);
      effects.push(...lv.effects);
      continue;
    }
    effects.push(...(Array.isArray(r.value) ? r.value : [r.value]));
  }
  return done(isStaticEffects(effects) ? [{ kind: 'static', text, ...level, effects: effects as StaticEffect[] }] : null);
}
