/**
 * parseCard: Oracle text to ability model (design 6.1 steps 2-7, plus the lint and the exact render gate of step 8). Owner: WP17.
 * Contract: parser/types.ts#ParseCard. It NEVER throws: an exception inside a face becomes one manual ability with diagnostic `parser-error` (contract C1).
 *
 * Per face: preprocess and segment (WP5), then per ability: chart parse every unit (WP6) through the templates of `ParseOptions.templates`, lower
 * (parser/lower: ten passes, design 6.5), taint (parser/taint.ts, design 6.7), lint (G7) and gate (G6; lower/verify.ts). The character ledger of the face is
 * completed with what the templates consumed (G4: every non-space character is in exactly one entry). The capability degrade (G8) and the classification
 * need the engine's capability set and belong to cards/pipeline.ts (WP18).
 *
 * `BOOTSTRAP_TEMPLATES` (parser/templates/bootstrap.json) are the twelve seed templates of design 6.3 plus the minimum for Lightning Bolt, Giant Growth, Doom
 * Blade, Llanowar Elves, Serra Angel and Glorious Anthem; the template packages WP19-WP23 add the rest.
 */
import type { AbilityDef, Condition, CostDef, KeywordAbilityDef, ManualAbilityDef } from '../types/ability';
import { TARGETED_PLAYER_LINK } from '../types/ability';
import type { OracleCard } from '../types/card';
import type { Diagnostic, FaceParse, LedgerEntry, ParseCard, ParseOptions, ParseResult, Template } from './types';
import type { RenderContext } from '../render/api';
import bootstrap from './templates/bootstrap.json';
import { TEMPLATE_SET } from './template-set';
import { keywordRegistry } from '../keywords/registry';
import { DEFAULT_BUDGET } from './chart';
import type { HoleEnv } from './holes';
import { completeLedger, faceContexts, GENERATED_LEXICON, markLedger, normalizeText, type FaceContext } from './preprocess';
import { frontEnd, type AbilitySegment } from './segment';
import { lowerAbility, type FaceInfo } from './lower/ability';
import { parseQuoted } from './lower/quoted';
import type { UnitEnv } from './lower/units';
import { NOT_GATED, verifyAbility } from './lower/verify';
import { classifyAbility } from '../model/classify';
import { memoParse } from './parse-memo';
import type { AutomationLevel } from '../types/automation';
import { KICKER_MARK, faceKickerCosts, kickerNameOf } from './holes/p2cs1';

const RANK: Readonly<Record<AutomationLevel, number>> = { manual: 0, partial: 1, full: 2 };

/**
 * FAST3 T18: the one additional cost every cast of this face pays (CR 601.2b), from the static abilities lowered so far, or undefined: none, several, or one
 * that is optional (kicker), repeatable or one of a choice ("sacrifice a creature or pay {3}"), where what it paid is not known from the text alone.
 */
function spellAdditionalCost(abilities: readonly AbilityDef[]): CostDef | undefined {
  const costs = abilities.flatMap((a) => (a.kind === 'static' ? a.effects.flatMap((e) => (e.s === 'additionalCost' ? [e] : [])) : []));
  const c = costs[0];
  return costs.length === 1 && c !== undefined && c.optional !== true && c.repeatable !== true && c.choiceGroup === undefined ? c.cost : undefined;
}

/**
 * FAST5 T42 (CR 107.3a-b): does the card have an X its controller announces as it is cast? An {X} in the mana cost, or the one additional cost the engine
 * announces X for, "As an additional cost to cast this spell, pay X life" (Fix What's Broken; rules/cost.ts#costHasX reads the payLife amount, actions/cast.ts
 * announces it). Only that exact line: any other cost with an X is left to its own template, so an effect that reads X stays manual without one.
 */
export function cardHasXCost(card: OracleCard): boolean {
  // r3-cost (CR 107.3, 601.2b): and "..., blight X. X can't be greater than ..." (Soul Immolation; rules/cost.ts#costHasX reads the blight amount)
  const lines = (t: unknown): boolean => typeof t === 'string' && (/^as an additional cost to cast (?:this spell|~|[^,.\n]+), pay x life\.?$/im.test(t)
    || /^as an additional cost to cast (?:this spell|~|[^,.\n]+), blight x\.(?: x can't be greater than [^.\n]+\.)?(?: \([^)\n]*\))?$/im.test(t)
    // r5-cost (CR 701.67a, 107.3a): "..., waterbend {X}." (Crashing Wave; rules/cost.ts#costHasX reads the waterbend amount)
    || /^as an additional cost to cast (?:this spell|~|[^,.\n]+), waterbend \{x\}\.(?: \([^)\n]*\))?$/im.test(t)
    // std-ry4 (CR 107.3a, 601.2b, 601.2f): the other cost parts whose count is X ("discard X cards [at random]", "sacrifice X lands", "exile X creature cards from
    // your graveyard", "return X Swamps you control to their owner's hand") and a sacrifice whose filter reads X ("an artifact or creature with mana value X"):
    // rules/cost.ts#costHasX sees the X of a part's count or filter, so the cast announces it like the X of a mana cost
    || /^as an additional cost to cast (?:this spell|~), (?:discard x [a-z ]*cards(?: at random)?|sacrifice x [a-z ]+|exile x [a-z ]*cards from your graveyard|return x [a-z ]+ you control to their owner's hand|sacrifice an? [a-z ]+ with mana value x)\.$/im.test(t));
  try {
    return /\{X\}/.test(card.mana_cost ?? '') || (card.card_faces ?? []).some((f) => /\{X\}/.test(f.mana_cost ?? ''))
      || lines(card.oracle_text) || (card.card_faces ?? []).some((f) => lines(f.oracle_text));
  } catch {
    return false;
  }
}

/**
 * CLOUD std-dft (CR 107.3a, 702.29a): does a cycling or typecycling cost of the card have an X ("Cycling {X}{2}{W}")? The X announced for it is the X of the
 * card's "when you cycle ~" ability (triggers/stack.ts), which the lint then accepts there (model/lint-nodes.ts#cyclesSelf). Only a line that starts with the
 * keyword: a reminder or another ability that names cycling says nothing about the cost.
 */
export function cyclingHasX(card: OracleCard): boolean {
  const line = (t: unknown): boolean => typeof t === 'string' && /^(?:[a-z]+ )?[a-z]*cycling (?:\{[^}\s]+\})*\{X\}/im.test(t);
  try {
    return line(card.oracle_text) || (card.card_faces ?? []).some((f) => line(f.oracle_text));
  } catch {
    return false;
  }
}

/** Version of the parser output (stored in CardAutomation.compilerVersion by the pipeline; caches key on it). */
export const PARSER_VERSION = 'm5-wp17.1';

/** The bootstrap template set (design 15.2 WP17). */
export const BOOTSTRAP_TEMPLATES: readonly Template[] = Object.freeze(bootstrap as Template[]);

/** `ParseOptions.keywords` from the keyword registry (WP3): names, aliases, parameter names and reminder text of every keyword. */
export function registryKeywords(): ParseOptions['keywords'] {
  return keywordRegistry.names().map((n) => {
    const d = keywordRegistry.get(n)!;
    // FAST1 T4: an implemented wrapper keyword of an activated ability (exhaust, CR 702.177a) says which restrictions it gives (segment.ts, lower/ability.ts)
    const m = d.modifies;
    const wraps = m?.kind === 'activated' && d.status === 'implemented'
      ? { ...(m.limit ? { limit: { ...m.limit } } : {}), ...(m.sorcerySpeed ? { sorcerySpeed: true } : {}), ...(m.onlyIf ? { onlyIf: JSON.parse(JSON.stringify(m.onlyIf)) } : {}), ...(m.zone ? { zone: [...m.zone] } : {}), ...(m.reducedByManaCost ? { reducedByManaCost: true as const } : {}) }
      : undefined;
    // FAST5X-4: an implemented keyword that grants the ability after its dash while a condition holds (max speed, CR 702.178a)
    const grants = m?.kind === 'grant' && d.status === 'implemented' ? (JSON.parse(JSON.stringify(m.while)) as Condition) : undefined;
    return { name: d.name, aliases: [...(d.aliases ?? [])], params: d.params.map((p) => p.name), reminder: d.reminder, ...(wraps ? { wraps } : {}), ...(grants ? { grants } : {}) };
  });
}

let defaultKeywords: ParseOptions['keywords'] | undefined;

/**
 * ParseOptions with the checked-in lexicon, the registry's keywords and the committed template set (parser/template-set.ts#TEMPLATE_SET, every file under
 * parser/templates; W3b: it was the bootstrap set until then, pass `templates: [...BOOTSTRAP_TEMPLATES]` for that). `capabilities` defaults to an empty set: a template that
 * `needs` a capability is then skipped and its sentences stay manual with `needs-engine` (the pipeline passes ENGINE_CAPABILITIES).
 */
export function defaultParseOptions(over: Partial<ParseOptions> = {}): ParseOptions {
  defaultKeywords ??= registryKeywords();
  return { templates: [...TEMPLATE_SET], lexicon: GENERATED_LEXICON, capabilities: new Set(), keywords: defaultKeywords, ...over };
}

/** Card type and subtype words of the face as printed ("Creature", "Elf"), for the renderer (RenderContext.selfTypes). */
function printedTypes(ctx: FaceContext): string[] {
  return ctx.typeLine.split(/\s+/).filter((w) => w !== '' && w !== '—' && w !== '--' && w !== '-' && w !== '//');
}

function errorFace(text: string, e: unknown): FaceParse {
  const message = e instanceof Error ? e.message : String(e);
  const ability: AbilityDef = { kind: 'manual', text, reason: `parser-error: ${message}`, shape: 'unknown', prov: { by: 'fallback' } };
  let ledger: LedgerEntry[] = [];
  // the ledger is in normalized coordinates (design 6.2): the whole face is manual
  try { ledger = completeLedger(normalizeText(text).text, [], `parser-error: ${message}`); } catch { ledger = []; }
  return { abilities: [ability], ledger, diagnostics: [{ level: 'manual', code: 'parser-error', message }], gate: [NOT_GATED], templatesUsed: [], experimental: [] };
}

/** FAST5 T59: the card types of a permanent (CR 110.4): a spell of one becomes a permanent whose abilities read what its costs exiled (CR 607.2q). */
const PERMANENT_CARD_TYPES: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

/** The link a "the exiled card" template reads (parser/templates/effect/flow.json, `fl.linked.*`). */
export const EXILED_LINK = 'exiled';
/**
 * FAST5X E26: the keywords whose expansion exiles a card and records it under `EXILED_LINK` (CR 607.2a): hideaway (CR 702.75a, keywords/data/hideaway.json;
 * a test pins the expansion's link).
 */
export const EXILED_LINK_KEYWORDS: ReadonlySet<string> = new Set(['hideaway']);

/** Visit every object node of a JSON value; `fn` may return false to skip the node's children. */
function walkJson(v: unknown, fn: (n: Record<string, unknown>) => boolean | void): void {
  if (Array.isArray(v)) { v.forEach((x) => walkJson(x, fn)); return; }
  if (v === null || typeof v !== 'object') return;
  const n = v as Record<string, unknown>;
  if (fn(n) === false) return;
  for (const x of Object.values(n)) walkJson(x, fn);
}

const exilesWithoutLink = (n: Record<string, unknown>): boolean =>
  (n['op'] === 'move' && n['link'] === undefined && typeof n['to'] === 'object' && n['to'] !== null && (n['to'] as Record<string, unknown>)['zone'] === 'exile')
  // std-rs (CR 607.2a): "each opponent exiles cards from the top of their library until they exile a nonland card": every card it exiled is exiled with ~
  || (n['op'] === 'exileUntil' && n['link'] === undefined)
  // FAST5X E11 (CR 607.2q): the cost "behold a Goblin and exile it" of the spell the permanent was (core/resolve.ts puts what it exiled in the link store)
  || (n['kind'] === 'behold' && n['exile'] === true && n['link'] === undefined)
  // std-cardcopy-3 (CR 614.12a, 607.2a): "As ~ enters, exile up to X creature cards from your graveyard": the enters replacement's exile (`body.exileCards`)
  || (n['b'] === 'enters' && typeof n['exileCards'] === 'object' && n['exileCards'] !== null && (n['exileCards'] as Record<string, unknown>)['link'] === undefined);

/** std-ru (CR 614.1a, 607.2a): a replacement effect whose body sends the moved object to exile instead (`modify` with a destination in exile), with no link yet. */
const replacementExilesWithoutLink = (n: Record<string, unknown>): boolean => {
  if (n['s'] !== 'replace' || typeof n['body'] !== 'object' || n['body'] === null) return false;
  const b = n['body'] as Record<string, unknown>;
  const d = b['destination'] as Record<string, unknown> | undefined;
  return b['b'] === 'modify' && b['link'] === undefined && d !== undefined && d !== null && d['zone'] === 'exile';
};

/** std-ru: a copy of an ability whose exiling replacement body records what it exiled under the link "exiled" (CR 607.2a, design 3.9). */
function withReplacementExiledLink(def: AbilityDef): AbilityDef {
  const copy = JSON.parse(JSON.stringify(def)) as AbilityDef;
  walkJson(copy, (n) => { if (replacementExilesWithoutLink(n)) (n['body'] as Record<string, unknown>)['link'] = EXILED_LINK; });
  return copy;
}

/**
 * FAST5 T59 (CR 607.2q): the cost parts of an additional cost that exile cards ("As an additional cost to cast this spell, exile a creature you control") with no link yet. The permanent
 * the spell becomes reads what they exiled ("When this creature leaves the battlefield, put each card exiled with it into its owner's hand").
 */
/**
 * std-rx27 (CR 607.2a, 701.59a): the collect evidence parts without a link in the cost of an activated ability ("Collect evidence 6: ..."): the cards it exiles are
 * "exiled with" the object (Kylox's Voltstrider), when nothing else on the face exiles (linkExiled).
 */
function evidenceCostParts(n: Record<string, unknown>): Record<string, unknown>[] {
  if (n['kind'] !== 'activated') return [];
  const other = (n['cost'] as { other?: unknown } | undefined)?.other;
  return Array.isArray(other) ? (other as Record<string, unknown>[]).filter((p) => p['kind'] === 'action' && p['action'] === 'collectEvidence' && p['link'] === undefined) : [];
}

function exileCostParts(n: Record<string, unknown>): Record<string, unknown>[] {
  if (n['s'] !== 'additionalCost') return [];
  const other = (n['cost'] as { other?: unknown } | undefined)?.other;
  return Array.isArray(other) ? (other as Record<string, unknown>[]).filter((p) => p['kind'] === 'exileFrom' && p['link'] === undefined) : [];
}

/**
 * CR 607.2a: an ability that instructs a player to exile cards and an ability that refers to "the exiled card" are linked. The consumer is written by a
 * template as `{ref:'linked', link:'exiled'}`; the producer is the ONE `move` to exile in the face's OTHER abilities, which gets `link: 'exiled'` (the link
 * store of the object, design 3.9). With no such instruction, or several, the consumer cannot know what it reads: those abilities are returned in
 * `unlinked` (they become manual; never a guess). Pure: changed abilities are copies. WP23.
 */
/** std-rx28: the abilities that read `costBeheld` with no behold additional cost on the face, or `costReturned` with no web-slinging or sneak on it. */
function costReadersWithoutCost(abilities: readonly AbilityDef[]): number[] {
  const beholds = abilities.some((a) => a.kind === 'static' && a.effects.some((e) => e.s === 'additionalCost' && (e.cost.other ?? []).some((p) => p.kind === 'behold')));
  const returns = abilities.some((a) => a.kind === 'keyword' && (a.keyword === 'web-slinging' || a.keyword === 'sneak'));
  // std-costs-2: and `costChosenObject` with no additional cost that chooses an object
  const chooses = abilities.some((a) => a.kind === 'static' && a.effects.some((e) => e.s === 'additionalCost' && (e.cost.other ?? []).some((p) => p.kind === 'chooseObject')));
  const out: number[] = [];
  abilities.forEach((a, i) => {
    let bad = false;
    walkJson(a, (n) => { if ((n['ref'] === 'costBeheld' && !beholds) || (n['ref'] === 'costReturned' && !returns) || (n['ref'] === 'costChosenObject' && !chooses)) bad = true; });
    if (bad) out.push(i);
  });
  return out;
}

export function linkExiled(abilities: readonly AbilityDef[], permanentFace = true): { producers: Map<number, AbilityDef>; unlinked: number[]; consumers: number[] } {
  const consumers: number[] = [];
  abilities.forEach((a, i) => {
    let reads = false;
    walkJson(a, (n) => { if (n['ref'] === 'linked' && n['link'] === EXILED_LINK) reads = true; });
    if (reads) consumers.push(i);
  });
  const producers = new Map<number, AbilityDef>();
  if (consumers.length === 0) return { producers, unlinked: [], consumers };
  // CR 607.2a links two abilities: the instruction that exiles is in another ability than the one that reads "the exiled card"
  const found: number[] = [];
  abilities.forEach((a, i) => { if (!consumers.includes(i)) walkJson(a, (n) => { if (exilesWithoutLink(n)) found.push(i); }); });
  if (abilities.some((a, i) => consumers.includes(i) && mentionsExile(a))) return { producers, unlinked: consumers, consumers };
  // FAST5 T59 (CR 607.2q): an additional cost of a permanent spell that exiles cards is an instruction that exiles too; the cards it exiled are linked as the instruction's are
  const costs: number[] = [];
  if (permanentFace) abilities.forEach((a, i) => { if (!consumers.includes(i)) walkJson(a, (n) => { if (exileCostParts(n).length > 0) costs.push(i); }); });
  // std-rx27 (CR 607.2a, 701.59a): an activated ability's collect evidence cost, when no instruction or spell cost of the face exiles
  const evidence: number[] = [];
  if (permanentFace && found.length === 0 && costs.length === 0 && !abilities.some((a) => a.kind === 'keyword' && EXILED_LINK_KEYWORDS.has(a.keyword))) abilities.forEach((a, i) => { if (!consumers.includes(i) && evidenceCostParts(a as unknown as Record<string, unknown>).length > 0) evidence.push(i); });
  if (evidence.length === 1) {
    const copy = JSON.parse(JSON.stringify(abilities[evidence[0]!])) as AbilityDef;
    for (const part of evidenceCostParts(copy as unknown as Record<string, unknown>)) part['link'] = EXILED_LINK;
    producers.set(evidence[0]!, copy);
    return { producers, unlinked: [], consumers };
  }
  // FAST5X E26 (CR 702.75a, 607.2a): a hideaway keyword is the instruction that exiles: its expansion (keywords/data/hideaway.json) records the card it exiles
  // face down under this link itself, so the keyword line needs no rewrite; it must be the face's only exiling instruction as well
  const keywordProducers = abilities.filter((a, i) => !consumers.includes(i) && a.kind === 'keyword' && EXILED_LINK_KEYWORDS.has(a.keyword)).length;
  if (keywordProducers > 0) return { producers, unlinked: keywordProducers === 1 && found.length === 0 && costs.length === 0 ? [] : consumers, consumers };
  // r5-refs (CR 607.2a): every card the one exiling ability exiled is "exiled with ~", whichever of its instructions exiled it ("target opponent exiles a creature
  // they control, then they exile a card from their graveyard"): one ABILITY that exiles, not one instruction
  // std-ru (CR 607.2a, 614.1a): with no instruction that exiles, the ONE replacement effect of the face's other abilities that exiles instead ("If a card you
  // didn't control would be put into an opponent's graveyard from anywhere, exile it instead": Valgavoth, Terror Eater) is what exiles the cards "exiled with ~"
  if (found.length === 0 && costs.length === 0) {
    const replacing: number[] = [];
    abilities.forEach((a, i) => { if (!consumers.includes(i)) walkJson(a, (n) => { if (replacementExilesWithoutLink(n)) replacing.push(i); }); });
    if (replacing.length !== 1) return { producers, unlinked: consumers, consumers };
    producers.set(replacing[0]!, withReplacementExiledLink(abilities[replacing[0]!]!));
    return { producers, unlinked: [], consumers };
  }
  // std-cardcopy-9 (CR 607.2a): several abilities that exile are all linked to "cards exiled with ~" (Koh, the Face Stealer: its enters and its dies triggers);
  // "the exiled card" (a bare link reference) still needs exactly one, as the card it names must be one
  if (new Set(found).size > 1 && !consumers.every((i) => readsOnlyExiledWith(abilities[i]!))) return { producers, unlinked: consumers, consumers };
  for (const i of new Set([...found, ...costs])) producers.set(i, withExiledLink(abilities[i]!));
  return { producers, unlinked: [], consumers };
}

/**
 * Does the ability name the exile zone anywhere (an instruction or cost that exiles, a card in exile)? std-rx5 (CR 607.2a): not counting the filter that only
 * picks among what the linked instruction exiled, "target creature card exiled with ~" (`{zone:'exile', is:{ref:'linked', link:'exiled'}}`, parser/holes/filter.ts).
 */
function mentionsExile(a: AbilityDef): boolean {
  let found = false;
  walkJson(a, (n) => {
    const is = n['is'] as Record<string, unknown> | undefined;
    if (n['zone'] === 'exile' && is?.['ref'] === 'linked' && is['link'] === EXILED_LINK) return false;
    if (n['zone'] === 'exile') found = true;
    return undefined;
  });
  return found;
}

/** std-cardcopy-2: does the node hold a layer-6 grant of "this card's other abilities" (`otherAbilitiesOfCard`)? */
const grantsOtherAbilities = (n: Record<string, unknown>): boolean => n['layer'] === 6 && n['otherAbilitiesOfCard'] === true;

/**
 * std-cardcopy-2 (CR 611.2a, 613.1f): "It gains this card's other abilities." (Symbiote Spider-Man): the grant's `add` is a copy of every OTHER ability of the face,
 * written here once all of them are lowered. Only when each of them is understood in full (no manual ability, no manual step): an ability that is not understood
 * cannot be granted, so the reader is returned in `unlinked` (it becomes manual; never a guess). The copies drop their source ranges and provenance, as a quoted
 * ability has none. Pure: changed abilities are copies.
 */
export function fillOtherAbilities(abilities: readonly AbilityDef[]): { producers: Map<number, AbilityDef>; unlinked: number[]; consumers: number[] } {
  const consumers: number[] = [];
  abilities.forEach((a, i) => { let g = false; walkJson(a, (n) => { if (grantsOtherAbilities(n)) g = true; }); if (g) consumers.push(i); });
  const producers = new Map<number, AbilityDef>();
  if (consumers.length !== 1) return { producers, unlinked: consumers, consumers };
  const at = consumers[0]!;
  const others = abilities.filter((_, i) => i !== at);
  let understood = others.length > 0;
  for (const o of others) { if (o.kind === 'manual') understood = false; walkJson(o, (n) => { if (n['op'] === 'manual') understood = false; }); }
  if (!understood) return { producers, unlinked: consumers, consumers };
  const copies = others.map((o) => { const c = JSON.parse(JSON.stringify(o)) as Record<string, unknown>; delete c['src']; delete c['prov']; return c as unknown as AbilityDef; });
  const def = JSON.parse(JSON.stringify(abilities[at])) as AbilityDef;
  walkJson(def, (n) => { if (grantsOtherAbilities(n)) n['add'] = JSON.parse(JSON.stringify(copies)); });
  producers.set(at, def);
  return { producers, unlinked: [], consumers };
}

/** r5-moved: its linked readings of "the exiled card(s)" (zz-cloud/r5-moved.json); an unlinked reader falls back to the reading it had without them (applyLink; the walk is r3-refs' `readsExiledLink`, merge wave 8). */
const R5MOVED_LINKED: ReadonlySet<string> = new Set(['eff.r5moved.linked.put.hand', 'eff.r5moved.linked.return.hands',
  // p2-refs-1 (CR 607.2a): the plural returns "to their owner's hand", "to the battlefield [tapped] under their owner's / owners' control"
  'eff.p2refs1.linked.return.hand.owner', 'eff.p2refs1.linked.return.battlefield.owners', 'eff.p2refs1.linked.return.battlefield.tapped.owners',
]);

const UNLINKED_EXILED = `unlinked: "the exiled card" needs exactly one instruction on this face that exiles (CR 607.2a)`;

/** r3-refs: does the ability read "the exiled card" (the CR 607.2a link)? */
function readsExiledLink(a: AbilityDef): boolean {
  let reads = false;
  walkJson(a, (n) => { if (n['ref'] === 'linked' && n['link'] === EXILED_LINK) reads = true; });
  return reads;
}

/** CLOUD std-msh: does the ability read "the exiled card" (the CR 607.2a link) while it exiles something itself (linkExiled never links such a reader)? */
function readsOwnExile(a: AbilityDef): boolean {
  let reads = false;
  walkJson(a, (n) => { if (n['ref'] === 'linked' && n['link'] === EXILED_LINK) reads = true; });
  return reads && mentionsExile(a);
}

/**
 * std-cardcopy-9 (CR 607.2a): every read of the link "exiled" in the ability is the description "<cards> exiled with ~" (a filter in exile whose `is` is the link,
 * parser/holes/filter.ts), never "the exiled card" itself.
 */
function readsOnlyExiledWith(a: AbilityDef): boolean {
  let all = 0;
  let described = 0;
  walkJson(a, (n) => {
    if (n['ref'] === 'linked' && n['link'] === EXILED_LINK) all++;
    const is = n['is'] as Record<string, unknown> | undefined;
    if (n['zone'] === 'exile' && is?.['ref'] === 'linked' && is['link'] === EXILED_LINK) described++;
    return undefined;
  });
  return all > 0 && all === described;
}

/** A copy of an ability whose `move` to exile records what it exiled under the link "exiled" (CR 607.2a, design 3.9). */
export function withExiledLink(def: AbilityDef): AbilityDef {
  const copy = JSON.parse(JSON.stringify(def)) as AbilityDef;
  walkJson(copy, (n) => {
    if (exilesWithoutLink(n)) {
      if (n['b'] === 'enters') (n['exileCards'] as Record<string, unknown>)['link'] = EXILED_LINK; // std-cardcopy-3: the link of the enters replacement's exile
      else n['link'] = EXILED_LINK;
    }
    for (const part of exileCostParts(n)) part['link'] = EXILED_LINK; // FAST5 T59 (CR 607.2q)
  });
  return copy;
}

/** "target player", "target opponent" (one player). */
const ONE_TARGET_PLAYER = /\btarget (?:player|opponent)\b/gi;
/** Targets that may be players too: several target players, "any target", "target player or planeswalker", "target creature or player". */
const OTHER_PLAYER_TARGET = /\btarget (?:players|opponents)\b|\bany (?:other )?target\b|\bor player\b|\bplayer or\b/i;

/**
 * LNK1 (CR 607.1): may a "that player" of segment `s` with no antecedent of its own be the player another ability of the face targets? Only when `s` names
 * no target player itself and the face's other abilities name exactly one target player between them, and nothing else that may target a player. A cheap
 * look at the words: `linkTargetedPlayer` checks the lowered abilities afterwards (exactly one such target spec), and the gate checks the text.
 */
export function playerLinkable(s: AbilitySegment, all: readonly AbilitySegment[]): boolean {
  if (!/\bthat player\b/i.test(s.text) || (s.text.match(ONE_TARGET_PLAYER) ?? []).length > 0 || OTHER_PLAYER_TARGET.test(s.text)) return false;
  const others = all.filter((o) => o !== s);
  if (others.some((o) => OTHER_PLAYER_TARGET.test(o.text))) return false;
  return others.reduce((n, o) => n + (o.text.match(ONE_TARGET_PLAYER) ?? []).length, 0) === 1;
}

const readsTargetedPlayer = (a: AbilityDef): boolean => {
  let reads = false;
  walkJson(a, (n) => { if (n['ref'] === 'linked' && n['link'] === TARGETED_PLAYER_LINK) reads = true; });
  return reads;
};

/** Every target spec of an ability that may be a player (the specs of its effect, its modes, a reflexive trigger's), as [the spec node]. */
function playerSpecs(a: AbilityDef): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  walkJson(a, (n) => {
    if (typeof n['id'] === 'string' && typeof n['text'] === 'string' && (n['kind'] === 'player' || n['kind'] === 'objectOrPlayer' || n['kind'] === 'anyTarget')) out.push(n);
  });
  return out;
}

/**
 * LNK1 (CR 607.1, 607.2): "that player" in one ability that reads `{ref:'linked', link: TARGETED_PLAYER_LINK}` (lower/anaphora.ts, Mention.linked) is the player
 * another ability of this face targeted. The producer is the ONE target spec that may be a player in the face's OTHER abilities: a one-player spec ("target
 * player", "target opponent"), which gets `link` (the engine remembers the player it affected, effects/run.ts#rememberTargets). With none, several, a spec of
 * several players or one that may be an object, the reader cannot know whom it means: it is returned in `unlinked` (it becomes manual; never a guess).
 * Pure: changed abilities are copies.
 */
export function linkTargetedPlayer(abilities: readonly AbilityDef[]): { producers: Map<number, AbilityDef>; unlinked: number[]; consumers: number[] } {
  const consumers = abilities.flatMap((a, i) => (readsTargetedPlayer(a) ? [i] : []));
  const producers = new Map<number, AbilityDef>();
  if (consumers.length === 0) return { producers, unlinked: [], consumers };
  if (consumers.some((i) => playerSpecs(abilities[i]!).length > 0)) return { producers, unlinked: consumers, consumers };
  const found = abilities.flatMap((a, i) => (consumers.includes(i) ? [] : playerSpecs(a).map((spec) => ({ i, spec }))));
  const one = found.length === 1 ? found[0]! : undefined;
  if (one === undefined || one.spec['kind'] !== 'player' || one.spec['max'] !== 1 || one.spec['link'] !== undefined) return { producers, unlinked: consumers, consumers };
  producers.set(one.i, withPlayerLink(abilities[one.i]!, String(one.spec['id'])));
  return { producers, unlinked: [], consumers };
}

/** std-control-1: the link of "the chosen creature" in another ability of the face than the choice (`{ref:'linked', link: CHOSEN_OBJECT_LINK}`, CR 607.2d). */
export const CHOSEN_OBJECT_LINK = 'chosen';
/** std-control-1: the link of "the chosen player" another ability of the face chose as an opponent ("As ~ enters / transforms into ~, choose an opponent."). */
export const CHOSEN_OPPONENT_LINK = 'opponent';

const readsLink = (a: AbilityDef, link: string): boolean => {
  let reads = false;
  walkJson(a, (n) => { if (n['ref'] === 'linked' && n['link'] === link) reads = true; });
  return reads;
};

/** The top-level steps of an ability's effect (no nested ones: a choice inside a condition or a "may" may not be made). */
const topSteps = (a: AbilityDef): Record<string, unknown>[] => (a.kind === 'triggered' || a.kind === 'activated' || a.kind === 'spell' ? (a.effect.steps as unknown as Record<string, unknown>[]) : []);

/**
 * std-control-1 (CR 607.2d, 400.7): "the chosen creature" in one ability (`{ref:'linked', link: CHOSEN_OBJECT_LINK}`, "When the chosen creature leaves the battlefield,
 * transform ~.") is the object another ability of this face chose ("When ~ enters, choose a creature an opponent controls."). The producer is the ONE top-level choice
 * of one object (`chooseObjects` with `max` 1, no `link`, chosen by you) in the face's OTHER abilities, which gets `link` (effects/handlers/choose.ts remembers it on
 * the source). With none or several, the reader cannot know what it reads: it is returned in `unlinked` (it becomes manual). Pure: changed abilities are copies.
 */
export function linkChosenObject(abilities: readonly AbilityDef[]): { producers: Map<number, AbilityDef>; unlinked: number[]; consumers: number[] } {
  const consumers = abilities.flatMap((a, i) => (readsLink(a, CHOSEN_OBJECT_LINK) ? [i] : []));
  const producers = new Map<number, AbilityDef>();
  if (consumers.length === 0) return { producers, unlinked: [], consumers };
  const one = (n: Record<string, unknown>): boolean => n['op'] === 'chooseObjects' && n['max'] === 1 && n['link'] === undefined && n['perPlayer'] === undefined && n['startingWith'] === undefined
    && n['random'] === undefined && n['guard'] === undefined && JSON.stringify(n['who']) === '{"ref":"you"}';
  let anyChoice = 0;
  abilities.forEach((a, i) => { if (!consumers.includes(i)) walkJson(a, (n) => { if (n['op'] === 'chooseObjects') anyChoice++; }); });
  const found = abilities.flatMap((a, i) => (consumers.includes(i) ? [] : topSteps(a).filter(one).map((step) => ({ i, step }))));
  if (found.length !== 1 || anyChoice !== 1) return { producers, unlinked: consumers, consumers };
  const copy = JSON.parse(JSON.stringify(abilities[found[0]!.i])) as AbilityDef;
  for (const s of topSteps(copy)) if (one(s)) s['link'] = CHOSEN_OBJECT_LINK;
  producers.set(found[0]!.i, copy);
  return { producers, unlinked: [], consumers };
}

/**
 * std-control-1 (CR 607.2d, 614.12a, 712.20): "the chosen player" in one ability (`{ref:'linked', link: CHOSEN_OPPONENT_LINK}`, "When the chosen player loses the game, you
 * win the game.") is the opponent another ability of this face chose: the ONE "As ~ enters, choose an opponent." (`enters.choose`) or "As ~ transforms into ~, choose an
 * opponent." (a `during` body's `chooseValue`) with that link. Nothing to rewrite (the producer's template writes the link); with none or several, the readers are unlinked.
 */
export function linkChosenOpponent(abilities: readonly AbilityDef[]): { producers: Map<number, AbilityDef>; unlinked: number[]; consumers: number[] } {
  const consumers = abilities.flatMap((a, i) => (readsLink(a, CHOSEN_OPPONENT_LINK) ? [i] : []));
  const producers = new Map<number, AbilityDef>();
  if (consumers.length === 0) return { producers, unlinked: [], consumers };
  let made = 0;
  abilities.forEach((a, i) => walkJson(a, (n) => {
    if (n['b'] === 'enters' && Array.isArray(n['choose'])) for (const c of n['choose'] as Record<string, unknown>[]) if (c['link'] === CHOSEN_OPPONENT_LINK) made += consumers.includes(i) ? 2 : 1;
    if (n['op'] === 'chooseValue' && n['link'] === CHOSEN_OPPONENT_LINK) made += consumers.includes(i) || n['what'] !== 'opponent' ? 2 : 1;
  }));
  return { producers, unlinked: made === 1 ? [] : consumers, consumers };
}

/** A copy of an ability whose target spec `id` remembers the player it affects under TARGETED_PLAYER_LINK (CR 607.1). */
export function withPlayerLink(def: AbilityDef, id: string): AbilityDef {
  const copy = JSON.parse(JSON.stringify(def)) as AbilityDef;
  walkJson(copy, (n) => { if (n['id'] === id && n['kind'] === 'player' && typeof n['text'] === 'string') n['link'] = TARGETED_PLAYER_LINK; });
  return copy;
}

/** CLOUD C5: the choices "As ~ enters, choose a <kind>." makes (parser/templates/effect/replace.json#rep.enters.choose.*: their links), by the words of the kind. */
const ENTERS_CHOICES: Readonly<Record<string, { link: string; what: string }>> = {
  color: { link: 'color', what: 'color' }, 'creature type': { link: 'type', what: 'creatureType' }, 'card type': { link: 'cardType', what: 'cardType' },
  'basic land type': { link: 'landType', what: 'landType' },
  'odd or even': { link: 'oddEven', what: 'oddEven' }, // r3-choose (CR 202.3, 607.2d): "As ~ enters, choose odd or even." (rep.r3choose.enters.choose.oddEven)
  // std-rx6 (CR 201.3, 607.2d): "As ~ enters, choose a card name." and "..., look at an opponent's hand, then choose any card name." (zz-cloud/std-rx6.json)
  'card name': { link: 'cardName', what: 'cardName' },
  'nonland card name': { link: 'cardName', what: 'cardName' }, // std-rx28 (CR 201.3): "As ~ enters, choose a nonland card name." (Skyseer's Chariot)
};
/** std-rx5 (CR 614.12a, 607.2d): "As ~ enters, choose a number between 1 and 10." (rep.stdrx5.enters.choose.numberBetween), read as "the chosen number". */
const ENTERS_NUMBER = { link: 'chosenNumber', what: 'number' };
// std-re (CR 205.3m, 607.2d): "choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk" (eff.cost.enters.choose.lorwynTribe) chooses a creature
// type too, from that list: "the chosen type" of the face's other abilities reads it as it reads "choose a creature type"
// std-rx28 (CR 205.2a, 607.2d): "..., then choose a card type other than creature." (Arachne, Psionic Weaver) chooses a card type too
const ENTERS_CHOICE = /(?:^|\. )As (?:~|it|this [a-z]+) enters(?: the battlefield)?, (?:look at an opponent's hand, then )?choose (?:an? (color|creature type|card type|basic land type|card name|nonland card name)(?: other than creature)?|any (card name|nonland card name)|(odd or even)|(elemental, elf, faerie, giant, goblin, kithkin, merfolk, or treefolk)|(a number between \d+ and \d+))\.(?:$| )/i;
/** std-rx28: "When ~ enters, choose a [land | nonland] card name." (eff.stdrx28.choose.landCardName: link `cardName`, as an entering choice of a card name), the whole ability. */
const ENTERS_TRIGGER_NAME = /^When (?:~|this [a-z]+) enters(?: the battlefield)?, choose a (?:non)?land card name\.$/i;
/** std-costs-2: an additional cost that starts with choosing a creature type (AdditionalCostDef.chooseType). */
const COST_TYPE_CHOICE = /^As an additional cost to cast ~, you may choose a creature type and /i;
/** std-rD (CR 205.2a, 614.12a): "As ~ enters, choose artifact, creature, enchantment, instant, or sorcery." is a card type choice too (rep.stdrd.enters.choose.cardTypeList). */
const CARD_TYPE_WORD = '(?:artifact|battle|creature|enchantment|instant|kindred|land|planeswalker|sorcery)';
const ENTERS_TYPE_LIST = new RegExp(`(?:^|\\. )As (?:~|it|this [a-z]+) enters(?: the battlefield)?, choose ${CARD_TYPE_WORD}(?:(?:, ${CARD_TYPE_WORD})+,| ) ?or ${CARD_TYPE_WORD}\\.(?:$| )`, 'i');

/** std-combat-5: "secretly choose <creature type>, <creature type>, or <creature type>." as a sentence of another ability. */
const SECRET_TYPE_CHOICE = /(?:^|\. |, )(?:[Tt]hen )?secretly choose [A-Z][a-z]+(?:, [A-Z][a-z]+)*,? or [A-Z][a-z]+\.(?:$| )/;

/**
 * CLOUD C5 (CR 607.2d, 614.12a): the choices the OTHER abilities of the face make as the object enters ("As ~ enters, choose a color."), which "the chosen color"
 * of segment `s` reads (FaceInfo.choices, lower/links.ts#resolveFaceChoices). A cheap look at the words; `linkChosen` checks the lowered abilities afterwards.
 */
export function faceChoices(s: AbilitySegment, all: readonly AbilitySegment[]): { link: string; what: string }[] {
  return all.filter((o) => o !== s).flatMap((o) => {
    const m = ENTERS_CHOICE.exec(o.text);
    if (m) return [m[5] !== undefined ? ENTERS_NUMBER : ENTERS_CHOICES[m[4] !== undefined ? 'creature type' : (m[1] ?? m[2] ?? m[3])!.toLowerCase()]!];
    // std-rx28 (CR 603.2, 607.2d): "When ~ enters, choose a land card name." (Petrified Hamlet): its effect's choice is "the chosen name" of the face's other abilities
    if (ENTERS_TRIGGER_NAME.test(o.text)) return [{ link: 'cardName', what: 'cardName' }];
    // std-costs-2 (CR 601.2b, 607.2d): "As an additional cost to cast ~, you may choose a creature type and ..." (eff.stdcosts2.additional.chooseType.behold, link
    // `costType`): the spell's "the chosen type" reads the type chosen as that cost was announced
    if (COST_TYPE_CHOICE.test(o.text)) return [{ link: 'costType', what: 'creatureType' }];
    // std-combat-5 (CR 608.2d, 607.2d): "... Then secretly choose Human, Merfolk, or Goblin." (eff.stdcombat5.secretlyChoose.creatureTypeList, link `type`): "the chosen type" of
    // the face's other abilities reads it, as it reads "As ~ enters, choose a creature type"
    if (SECRET_TYPE_CHOICE.test(o.text)) return [ENTERS_CHOICES['creature type']!];
    return ENTERS_TYPE_LIST.test(o.text) ? [ENTERS_CHOICES['card type']!] : [];
  });
}

/**
 * CLOUD C5 (CR 607.2d): every ability `readers` names reads `chosen` links; each such link must be made by exactly one "As ~ enters, choose ..." (`enters.choose`)
 * of ANOTHER ability of the face, of a kind its quality can read. Otherwise the reader is returned in `unlinked` (it becomes manual; never a guess).
 */
export function linkChosen(abilities: readonly AbilityDef[], readers: readonly number[]): { producers: Map<number, AbilityDef>; unlinked: number[]; consumers: number[] } {
  const made: { i: number; link: string; what: string; cost?: true }[] = [];
  abilities.forEach((a, i) => walkJson(a, (n) => {
    if (n['b'] === 'enters' && Array.isArray(n['choose'])) for (const c of n['choose'] as Record<string, unknown>[]) made.push({ i, link: String(c['link']), what: String(c['what']) });
    // std-costs-2 (CR 601.2b, 607.2d): an additional cost that chooses a creature type as it is announced (AdditionalCostDef.chooseType)
    const ct = n['s'] === 'additionalCost' ? n['chooseType'] : undefined;
    if (ct !== null && typeof ct === 'object' && !Array.isArray(ct)) made.push({ i, link: String((ct as Record<string, unknown>)['link']), what: String((ct as Record<string, unknown>)['what']), cost: true });
  }));
  const consumers: number[] = [];
  const unlinked: number[] = [];
  for (const i of readers) {
    const reads: { link: string; quality: string }[] = [];
    let ownNumberChoice = false;
    walkJson(abilities[i], (n) => { if (n['op'] === 'chooseValue' && n['what'] === 'number') ownNumberChoice = true; });
    walkJson(abilities[i], (n) => {
      const c = n['chosen'];
      if (c !== null && typeof c === 'object' && !Array.isArray(c) && typeof (c as Record<string, unknown>)['quality'] === 'string') reads.push(c as { link: string; quality: string });
      // std-rx5 (CR 607.2d): "the chosen number" another ability chose as the object entered (not one this ability chooses itself, lower/links.ts)
      if (n['q'] === 'chosenNumber' && typeof n['link'] === 'string' && !ownNumberChoice) reads.push({ link: n['link'], quality: 'number' });
    });
    const fromFace = reads.filter((r) => made.some((m) => m.link === r.link));
    if (fromFace.length === 0) continue;
    consumers.push(i);
    const ok = fromFace.every((r) => {
      const by = made.filter((m) => m.link === r.link);
      // std-costs-2: a cost that chooses a type reads it itself too ("behold two creatures of that type"); any other producer is another ability
      return by.length === 1 && (by[0]!.i !== i || by[0]!.cost === true) && by[0]!.what === r.quality;
    });
    if (!ok) unlinked.push(i);
  }
  return { producers: new Map(), unlinked, consumers };
}

/** One lowering and verification of an ability segment (see parseFace). `refused`: the reason the lint or the gate demoted an ability, or null. */
interface Attempt {
  abilities: AbilityDef[];
  gate: FaceParse['gate'];
  diagnostics: Diagnostic[];
  claims: LedgerEntry[];
  templates: string[];
  experimental: string[];
  refused: string | null;
  /** Per ability (same order): lint and gate a changed form of it again, as its verification did (WP23: the CR 607 producer with its link). */
  reverify: ((def: AbilityDef) => ReturnType<typeof verifyAbility>)[];
}

/**
 * PUSH1 T2 review: the template-set version (`Template.since`) from which an experimental template inside a quoted ability caps its card at partial
 * (design 6.9). Version-1 templates were never recorded inside quotes, and guard G10 keeps the cards they made full (see `attempt` in parseFace).
 */
const QUOTED_CAP_SINCE = 2;

/** How many reduced template sets a refused ability is lowered with (guard G10 fallback, parseFace). */
const MAX_RETRIES = 8;

/**
 * The automated parts of abilities (W3b, guard G10 inside the parser): the trigger, the cost, every target spec and every step that is not manual (with its
 * sub-steps), as canonical-enough JSON with target ids blanked (a target of a formerly manual sentence renumbers the later ones). A part list "covers"
 * another when it holds each of its parts (as a multiset).
 */
export function automatedParts(defs: readonly AbilityDef[]): string[] {
  const out: string[] = [];
  const norm = (v: unknown): string => JSON.stringify(v, (k, x: unknown) => (k === 'text' || k === 'span' || k === 'prov' || k === 'reason' || k === 'sentence' ? undefined : x)).replace(/"id":"t\d+"/g, '"id":"t"');
  const program = (p: unknown): void => {
    if (p === null || typeof p !== 'object') return;
    const prog = p as { targets?: unknown[]; steps?: unknown[]; modes?: { options?: { program?: unknown }[] } };
    for (const t of prog.targets ?? []) out.push(`target:${norm(t)}`);
    for (const st of prog.steps ?? []) if (st !== null && typeof st === 'object' && (st as { op?: unknown }).op !== 'manual') out.push(`step:${norm(st)}`);
    for (const o of prog.modes?.options ?? []) program(o.program);
  };
  for (const d of defs) {
    const r = d as unknown as Record<string, unknown>;
    if (r['trigger'] !== undefined) out.push(`trigger:${norm(r['trigger'])}`);
    // the cost part by part: a manual part that becomes understood ("Exert ~") is a gain, not a change of what was understood
    const cost = r['cost'];
    if (cost !== null && typeof cost === 'object') {
      for (const [k, v] of Object.entries(cost as Record<string, unknown>)) {
        if (v === undefined) continue;
        if (k !== 'other' || !Array.isArray(v)) { out.push(`cost.${k}:${norm(v)}`); continue; }
        for (const part of v) if (part === null || typeof part !== 'object' || (part as { kind?: unknown }).kind !== 'manual') out.push(`cost.other:${norm(part)}`);
      }
    }
    if (d.kind === 'keyword' || d.kind === 'static') out.push(`${d.kind}:${norm(d)}`);
    program(r['effect']);
  }
  return out;
}

const isManualStep = (v: unknown): boolean => v !== null && typeof v === 'object' && !Array.isArray(v) && (v as { op?: unknown }).op === 'manual';

/**
 * Does `now` keep what `old` understood? Every field of `old` is kept in `now` (fields `now` adds are things it understood more: "Otherwise, ..." as the
 * `else` of the step before); a manual step of `old` inside a list matches any run of one or more steps of `now` (the sentence it stood for, understood
 * or not); everything else must be equal.
 */
function keeps(old: unknown, now: unknown): boolean {
  if (isManualStep(old)) return true;
  if (Array.isArray(old)) {
    if (!Array.isArray(now)) return false;
    const seq = (i: number, j: number): boolean => {
      if (i === old.length) return j === now.length;
      if (isManualStep(old[i])) {
        for (let k = j + 1; k <= now.length; k++) if (seq(i + 1, k)) return true;
        return false;
      }
      return j < now.length && keeps(old[i], now[j]) && seq(i + 1, j + 1);
    };
    return seq(0, 0);
  }
  if (old !== null && typeof old === 'object') {
    if (now === null || typeof now !== 'object' || Array.isArray(now)) return false;
    const o = old as Record<string, unknown>;
    const n = now as Record<string, unknown>;
    return Object.keys(o).every((k) => o[k] === undefined || keeps(o[k], n[k]));
  }
  return old === now;
}

/** Does `have` keep every part of `need` (each matched by a distinct part of the same kind that keeps it, `keeps`)? */
export function covers(have: readonly string[], need: readonly string[]): boolean {
  const split = (p: string): [string, unknown] => {
    const i = p.indexOf(':');
    return [p.slice(0, i), JSON.parse(p.slice(i + 1)) as unknown];
  };
  const pool = have.map(split);
  const used = new Array<boolean>(pool.length).fill(false);
  for (const p of need) {
    const [tag, value] = split(p);
    const at = pool.findIndex(([t, v], i) => !used[i] && t === tag && keeps(value, v));
    if (at < 0) return false;
    used[at] = true;
  }
  return true;
}

/**
 * p2-counters-state-1 (CR 702.33f): the `kicker@<cost>` markers of "kicked with its {1}{R} kicker" (parser/holes/p2cs1.ts) become the name the cast record gives
 * that kicker cost of the face ("kicker", "kicker:2"), in what the gate and the lint read (the abilities and their gate forms). A cost the face does not print
 * keeps its marker, which the renderer refuses (the ability stays manual).
 */
function resolveKickerCosts<T extends { abilities: AbilityDef[]; gateForms: (AbilityDef | undefined)[] }>(res: T, costs: readonly string[]): T {
  let found = false;
  const fix = <V>(v: V): V => {
    if (Array.isArray(v)) return v.map(fix) as V;
    if (v === null || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      if (k === 'kicked' && typeof x === 'string' && x.startsWith(KICKER_MARK)) {
        found = true;
        out[k] = kickerNameOf(costs, x.slice(KICKER_MARK.length)) ?? x;
      } else out[k] = fix(x);
    }
    return out as V;
  };
  const abilities = fix(res.abilities);
  return found ? { ...res, abilities, gateForms: fix(res.gateForms) } : res;
}

function parseFace(ctx: FaceContext, opts: ParseOptions, cardHasX: boolean, cyclingX = false): FaceParse {
  const seg = frontEnd(ctx, opts);
  const face: FaceInfo = { pre: seg.pre, selfHeads: [...ctx.types, ...ctx.subtypes].map((w) => w.toLowerCase()), ...(/(^|[:.]\s+)(until end of turn,\s+)?\s*~ becomes an? (?!copy)[^.:]*\bcreature\b/i.test(seg.pre.parse) ? { animates: true } : {}) };
  // p2-counters-state-1 (CR 702.33f): the face's kicker costs, for "kicked with its {1}{R} kicker" (parser/holes/p2cs1.ts) in the parser and the renderer
  const kickerCosts = faceKickerCosts(ctx.text);
  const renderCtx: RenderContext = { selfNames: [ctx.name, ...ctx.otherNames], selfTypes: printedTypes(ctx), ...(kickerCosts.length > 0 ? { kickerCosts } : {}) };
  const text = seg.pre.normalized;
  let ledger = seg.ledger;
  const diagnostics: Diagnostic[] = [...seg.diagnostics];
  const abilities: AbilityDef[] = [];
  /** The segment each ability came from (same order), for the ledger of the CR 607 linking below. */
  const owners: AbilitySegment[] = [];
  /** Per ability (same order): lint and gate a changed form of it again, as the first verification did (the CR 607 producer with its link). */
  const reverify: ((def: AbilityDef) => ReturnType<typeof verifyAbility>)[] = [];
  const gate: FaceParse['gate'] = [];
  const templatesUsed: string[] = [];
  const experimental: string[] = [];
  /** Per ability (same order): the experimental templates its segment's lowering used. */
  const experimentalBy: string[][] = [];
  /** The stable templates of the set (design 6.9), for `preferStable`. */
  const stableOnly = opts.templates.filter((t) => t.status !== 'experimental');

  /**
   * r3-refs (CR 607.2a): may another ability of the face be the producer that linkExiled looks for, for a reader in segment `s`? An ability lowered before it that
   * exiles (a move to exile, an exiling cost, hideaway), or a later segment whose text says "exile". A cheap upper bound: linkExiled decides afterwards.
   */
  const exileProducerPossible = (s: AbilitySegment): boolean => {
    const at = seg.abilities.indexOf(s);
    if (at < 0 || seg.abilities.slice(at + 1).some((o) => /\bexile/i.test(o.text))) return true;
    let found = false;
    for (const a of abilities) {
      if (a.kind === 'keyword' && EXILED_LINK_KEYWORDS.has(a.keyword)) found = true;
      walkJson(a, (n) => { if (exilesWithoutLink(n) || exileCostParts(n).length > 0) found = true; });
    }
    return found;
  };

  /** Lower one ability segment with a template set and run the lint and the gate (G7, G6) on what it built. `refused`: one of its abilities was demoted. */
  const attempt = (s: AbilitySegment, templates: Template[]): Attempt => {
    const o: ParseOptions = templates === opts.templates ? opts : { ...opts, templates };
    // the chart budget is per ability (design 6.3 rule 4); quoted abilities inside it share it
    const ue: UnitEnv = { opts: o, env: { lexicon: o.lexicon, keywords: o.keywords }, budget: { limit: o.budget ?? DEFAULT_BUDGET, used: 0 } };
    // PUSH1 T2 review (INTERFACE CHANGE): the templates of the quoted abilities it grants count as templates of this ability (design 6.9: an experimental
    // one caps the card at partial; lower/quoted.ts#QuotedUse)
    const quoted: { templates: string[]; experimental: string[] } = { templates: [], experimental: [] };
    const useQuoted = (ts: readonly string[], xs: readonly string[]): void => {
      for (const t of ts) if (!quoted.templates.includes(t)) quoted.templates.push(t);
      for (const t of xs) if (!quoted.experimental.includes(t)) quoted.experimental.push(t);
    };
    const env: HoleEnv = { lexicon: o.lexicon, keywords: o.keywords, ...(o.cardNames ? { cardNames: o.cardNames } : {}), subParser: (tokens) => parseQuoted(tokens, ue, face.selfHeads, face.pre.normalized, useQuoted) };
    ue.env = env;
    const res = resolveKickerCosts(lowerAbility(s, face, ue), kickerCosts);
    const union = (a: readonly string[], b: readonly string[]): string[] => [...a, ...b.filter((t) => !a.includes(t))];
    // guard G10: before this change no quoted template was recorded, so the experimental templates of template-set version 1 made a few cards full through
    // a quote (Dual Casting, Sixth Sense, ...); those cards keep that level until their templates are reviewed (a known gap), every later one caps (design 6.9)
    const capped = quoted.experimental.filter((id) => (o.templates.find((t) => t.id === id)?.since ?? QUOTED_CAP_SINCE) >= QUOTED_CAP_SINCE);
    const out: Attempt = { abilities: [], gate: [], diagnostics: [], claims: res.claims, templates: union(res.templates, quoted.templates), experimental: union(res.experimental, capped), refused: null, reverify: [] };
    const lines = s.text.split('\n');
    res.abilities.forEach((a, k) => {
      const labelled: AbilityDef = s.label ? { ...a, label: s.label.text } : a;
      const oracle = res.oracles?.[k] ?? (a.kind === 'keyword' ? [(a as KeywordAbilityDef).text] : lines); // T35: a station row is gated against its own line
      const gateForm = res.gateForms[k];
      const kept = res.kept[k];
      let v = verifyAbility(labelled, oracle, { ...renderCtx, oracleLines: oracle }, { cardHasX, cyclingX, layout: ctx.layout, ...(gateForm ? { gateForm } : {}), ...(kept ? { kept } : {}) });
      // CLOUD std-msh (guard G10, CR 607.2a): an ability that reads "the exiled card" and itself exiles can never be linked (linkExiled: the instruction that exiles
      // must be in another ability; the face-wide link would make the whole ability manual, its trigger, cost and targets with it). It is refused here as the lint
      // refuses, so its fallbacks (the effect as one manual step) and the G10 retry (`retried`) apply, and a newer template's sentence is manual again
      // r3-refs (guard G10, CR 607.2a): a reader of "the exiled card" that one of this slice's templates read (zz-cloud/r3-refs.json, "put a card exiled with ~ into its
      // owner's hand"), on a face where no other ability can be its producer (none lowered before it exiles, and no later ability's text says "exile"), is refused the same
      // way, so the G10 retry gives the ability the form it had before the template existed instead of the face-wide link making all of it manual (Wall of Mourning).
      // A reader through an older template keeps WP23's reading (the face-wide link makes it a manual ability)
      const newReader = readsExiledLink(v.def) && res.templates.some((id) => id.startsWith('eff.r3refs.')) && !exileProducerPossible(s);
      const ownExile = v.def.kind !== 'manual' && (readsOwnExile(v.def) || newReader);
      if (ownExile) {
        const d = v.def;
        const shape = d.kind === 'triggered' ? 'triggered' : d.kind === 'activated' ? 'activated' : d.kind === 'spell' ? 'spell' : 'static';
        v = { ...v, def: { kind: 'manual', text: d.text, ...(d.src ? { src: d.src } : {}), prov: { by: 'fallback' }, reason: UNLINKED_EXILED, shape } as ManualAbilityDef };
      }
      const refused = v.def.kind === 'manual' && a.kind !== 'manual';
      let fallback: { kept?: unknown } | undefined;
      // a refused ability falls back to the first less automated form that passes (AbilityResult.fallbacks): never less than "not understood" (G10)
      if (refused) for (const fb of res.fallbacks[k]?.() ?? []) {
        const fl: AbilityDef = s.label ? { ...fb.def, label: s.label.text } : fb.def;
        const w = verifyAbility(fl, oracle, { ...renderCtx, oracleLines: oracle }, { cardHasX, cyclingX, layout: ctx.layout, ...(fb.kept ? { kept: fb.kept } : {}) });
        const ok = fb.def.kind === 'manual' ? w.def.kind === 'manual' && w.def.effect !== undefined && !readsOwnExile(w.def) : w.def.kind !== 'manual' && !readsOwnExile(w.def);
        if (!ok) continue;
        v = { def: w.def, gate: w.gate, diagnostics: [...v.diagnostics, ...w.diagnostics, { level: 'info', code: 'gate-mismatch', message: `fallback (design 6.6): ${fb.def.kind === 'manual' ? fb.def.reason : 'the effect is one manual step'}` }] };
        fallback = fb;
        break;
      }
      const droppedKept = a.kind === 'manual' && a.effect !== undefined && v.def.kind === 'manual' && v.def.effect === undefined;
      if (refused || droppedKept) {
        // refused by the lint or the gate (or a kept effect dropped): its text is manual in the ledger too (also after a fallback: conservatively, all of it).
        // W3 integration: `refused` is the refusal of the ability as lowered, before WP19's fallback (AbilityResult.fallbacks), so WP22's retry without the
        // template (`retried` below, guard G10) is tried first; when no retry is accepted, this attempt (with its fallback) is kept.
        const reason = v.def.kind === 'manual' ? (v.def as ManualAbilityDef).reason : ownExile ? `${UNLINKED_EXILED}: it is one manual step (design 6.6)` : 'the render gate refused the effect: it is one manual step (design 6.6)';
        out.refused ??= reason;
        out.claims = [...out.claims.filter((c) => c.status !== 'consumed'), ...s.ranges.map((range) => ({ range, status: 'manual' as const, reason }))];
      }
      // W3 integration (WP23 + WP19 fallbacks): verified again the way the ability handed out was verified (a fallback form has no gate form of its own)
      const fbKept = fallback?.kept as typeof kept;
      out.reverify.push(fallback
        ? (d) => verifyAbility(d, oracle, { ...renderCtx, oracleLines: oracle }, { cardHasX, cyclingX, layout: ctx.layout, ...(fbKept ? { kept: fbKept } : {}) })
        : (d) => verifyAbility(d, oracle, { ...renderCtx, oracleLines: oracle }, { cardHasX, cyclingX, layout: ctx.layout, ...(gateForm ? { gateForm: withExiledLink(gateForm) } : {}), ...(kept ? { kept } : {}) }));
      out.abilities.push(v.def);
      out.gate.push(v.gate);
      out.diagnostics.push(...v.diagnostics);
    });
    out.diagnostics.push(...res.diagnostics);
    return out;
  };

  /**
   * WP22 INTERFACE CHANGE (review fix, guard G10, design 6.8 and 10.3: adding a template may change only formerly-manual units). When the lint or the gate
   * refuses an ability, it is lowered again without one of the templates it used, the latest-loaded first (a template package's or rules pack's additions come
   * after the bootstrap set); if none of those is accepted, templates are left out cumulatively, each time the latest-loaded one the last refused attempt
   * used (another template may take over the sentence and be refused too). The first result that both checks accept and that automates something is taken:
   * the sentence the refused template matched is a manual step again, as it was before that template existed, instead of the whole ability (its cost,
   * trigger and targets) becoming manual. Every result still passes the same lint and gate; nothing is accepted that those refuse.
   * W3b: every accepted result within the budget is collected (the single removals, then the cumulative one) and the one that automates most is taken
   * (`dominates`: a higher level, else every automated part of the other and more), the earliest on a tie: leaving out the template that read the first
   * sentence must not win over leaving out the two templates that both misread the second one (it would drop the first sentence's target).
   */
  const retried = (s: AbilitySegment, first: Attempt, base: Template[]): Attempt | null => {
    const latestUsed = (a: Attempt, skip: readonly Template[]): Template[] => base.filter((t) => a.templates.includes(t.id) && !skip.includes(t)).reverse();
    const accepted = (r: Attempt): boolean => r.refused === null && r.abilities.some((a) => a.kind !== 'manual');
    const done = (r: Attempt, without: readonly Template[]): Attempt => {
      const ids = without.map((t) => t.id).join(', ');
      // what the refused attempt found stays visible (as information: it no longer describes the ability handed out)
      for (const d of first.diagnostics) r.diagnostics.push({ ...d, level: 'info', message: `with ${ids}: ${d.message}` });
      r.diagnostics.push({ level: 'info', code: 'gate-mismatch', message: `lowered without ${ids} (guard G10): with it, ${first.refused}` });
      return r;
    };
    const found: { r: Attempt; without: Template[] }[] = [];
    let budget = MAX_RETRIES;
    for (const t of latestUsed(first, [])) {
      if (budget-- <= 0) break;
      const r = attempt(s, base.filter((x) => x !== t));
      if (accepted(r)) found.push({ r, without: [t] });
    }
    const without: Template[] = [];
    for (let last = first; budget-- > 0;) {
      const next = latestUsed(last, without)[0];
      if (next === undefined) break;
      without.push(next);
      last = attempt(s, base.filter((x) => !without.includes(x)));
      if (accepted(last)) {
        found.push({ r: last, without: [...without] });
        break;
      }
      if (last.refused === null) break; // accepted by the checks, but nothing is automated: the original refusal says more
    }
    if (found.length === 0) return null;
    let best = found[0]!;
    for (const c of found.slice(1)) if (dominates(c.r, best.r)) best = c;
    return done(best.r, best.without);
  };

  /**
   * One ability segment lowered with a template set, with the G10 retry of a refused ability (above). W3b: the retry is taken unless the refused attempt
   * (with its fallback, design 6.6) automates strictly more (`dominates`): leaving out a template must not take away a target or a step that the
   * fallback still had (Forgestoker-like lines: a damage sentence whose target the fallback announces).
   */
  const lowered = (s: AbilitySegment, base: Template[]): Attempt => {
    const r = attempt(s, base);
    if (r.refused === null) return r;
    const again = retried(s, r, base);
    return again === null || dominates(r, again) ? r : again;
  };
  const dominates = (x: Attempt, y: Attempt): boolean => {
    const lx = levelOf(x);
    const ly = levelOf(y);
    if (RANK[lx] !== RANK[ly]) return RANK[lx] > RANK[ly];
    const px = automatedParts(x.abilities);
    const py = automatedParts(y.abilities);
    return covers(px, py) && !covers(py, px);
  };

  /**
   * W3b (guard G10, design 6.9 and 10.4: an experimental template caps its card at partial and may not take automation away from a stable reading). An
   * ability whose lowering used an experimental template is lowered again with the stable templates only; the stable reading wins when it automates
   * more (its least automated ability is at a higher level, design 10.3) or when both are fully automated (then the card is not capped by a template
   * that adds nothing). Both readings passed the same lint and exact render gate; the stable one is what the parser gave before the experimental
   * template existed. The experimental reading stays visible as information.
   */
  const preferStable = (s: AbilitySegment, r: Attempt): Attempt => {
    if (r.experimental.length === 0 || stableOnly.length === opts.templates.length) return r;
    const st = lowered(s, stableOnly);
    if (st.abilities.length === 0 || r.abilities.length === 0) return r;
    const a = levelOf(r);
    const b = levelOf(st);
    // equal levels short of full: the experimental reading must keep every automated part of the stable one (G10), else the stable one stays
    const lost = RANK[a] === RANK[b] && a !== 'full' && !covers(automatedParts(r.abilities), automatedParts(st.abilities));
    if (!(RANK[b] > RANK[a] || (a === 'full' && b === 'full') || lost)) return r;
    st.diagnostics.push({ level: 'info', code: 'experimental', message: `lowered with the stable templates only (design 6.9, guard G10): with ${r.experimental.join(', ')} the ability was ${a}${lost ? ' and lost an automated part' : ''}, without them ${b}` });
    return st;
  };
  const levelOf = (r: Attempt): AutomationLevel => {
    let worst: AutomationLevel = 'full';
    for (const d of r.abilities) {
      const l = d.kind === 'manual' ? 'manual' : classifyAbility(d, opts.capabilities).level;
      if (RANK[l] < RANK[worst]) worst = l;
    }
    return worst;
  };

  const doAbility = (s: AbilitySegment): void => {
    const r = preferStable(s, lowered(s, opts.templates));
    abilities.push(...r.abilities);
    experimentalBy.push(...r.abilities.map(() => [...r.experimental]));
    owners.push(...r.abilities.map(() => s));
    reverify.push(...r.reverify);
    gate.push(...r.gate);
    diagnostics.push(...r.diagnostics);
    for (const t of r.templates) if (!templatesUsed.includes(t)) templatesUsed.push(t);
    for (const t of r.experimental) if (!experimental.includes(t)) experimental.push(t);
    for (const c of r.claims) ledger = markLedger(text, ledger, c.range, c.status, c.by, c.reason);
  };
  const choiceReaders: number[] = []; // CLOUD C5: the abilities lowered with FaceInfo.choices
  for (const s of seg.abilities) {
    // LNK1 (CR 607.1): "that player" may be the player another ability of this face targets (FaceInfo.linkedPlayer)
    if (playerLinkable(s, seg.abilities)) face.linkedPlayer = true;
    else delete face.linkedPlayer;
    // CLOUD C5 (CR 607.2d): "the chosen color" may be the color another ability of this face chose as the object entered (FaceInfo.choices)
    const choices = faceChoices(s, seg.abilities);
    if (choices.length > 0) face.choices = choices;
    else delete face.choices;
    const first = abilities.length;
    doAbility(s);
    if (choices.length > 0) for (let i = first; i < abilities.length; i++) choiceReaders.push(i);
    delete face.linkedPlayer;
    delete face.choices;
    // FAST3 T18: the spell's one mandatory additional cost, once its line is lowered (Oracle writes it first): "the sacrificed creature" of the spell line
    // names what it sacrificed (lower/ability.ts#sacrificedMentions, CR 601.2b); an optional, repeatable or either-or cost names nothing for sure
    if (s.spellStatic === true) {
      const c = spellAdditionalCost(abilities);
      if (c === undefined) delete face.spellCost;
      else face.spellCost = c;
    }
  }
  /** The producers of a CR 607 link linted and gated again WITH the link; the readers that cannot be linked become manual. */
  const applyLink = (linked: ReturnType<typeof linkExiled>, reason: string): void => {
    // the producer is linted and gated again WITH its link (WP23 review): a link the lint refuses makes the producer manual and the readers unlinked
    let unlinked = linked.unlinked;
    linked.producers.forEach((def, i) => {
      const before = abilities[i]!;
      const v = reverify[i]!(def);
      abilities[i] = v.def;
      gate[i] = v.gate;
      const refused = (v.def.kind === 'manual' && before.kind !== 'manual') || (before.kind === 'manual' && before.effect !== undefined && v.def.kind === 'manual' && v.def.effect === undefined);
      if (!refused) return;
      diagnostics.push(...v.diagnostics);
      for (const range of owners[i]!.ranges) ledger = markLedger(text, ledger, range, 'manual', undefined, (v.def as ManualAbilityDef).reason);
      unlinked = linked.consumers;
    });
    unlinked.forEach((i) => {
      // r5-moved (guard G10, CR 607.2a): a reader lowered with one of r5-moved's linked readings ("put the exiled card into its owner's hand", "return the exiled cards to their
      // owners' hands") that cannot be linked is lowered again without them: the reading it had before they existed (its trigger and the rest stay what they were).
      // Merge wave 8: only for an unlinked "exiled" link (CR 607.2a), never for "the chosen color" (CR 607.2d) or "that player" (CR 607.1)
      const s0 = owners[i]!;
      if (reason === UNLINKED_EXILED && readsExiledLink(abilities[i]!) && owners.filter((o) => o === s0).length === 1) {
        const again = lowered(s0, opts.templates.filter((t) => !R5MOVED_LINKED.has(t.id)));
        if (again.abilities.length === 1 && again.abilities[0]!.kind !== 'manual' && !readsExiledLink(again.abilities[0]!)) {
          abilities[i] = again.abilities[0]!;
          gate[i] = again.gate[0]!;
          diagnostics.push(...again.diagnostics, { level: 'info', code: 'unbound-reference', message: `lowered without ${[...R5MOVED_LINKED].join(', ')} (guard G10): ${reason}` });
          for (const c of again.claims) ledger = markLedger(text, ledger, c.range, c.status, c.by, c.reason);
          return;
        }
      }
      const a = abilities[i]!;
      // an activated reader keeps what was understood of its activation: the cost is still paid, the restrictions still apply (CR 602.2, 602.5; onlyIf attested)
      const act = a.kind === 'activated' ? {
        cost: a.cost, ...(a.sorcerySpeed ? { sorcerySpeed: true } : {}), ...(a.limit ? { limit: a.limit } : {}), ...(a.zone ? { zone: a.zone } : {}),
        ...(a.onlyIf ? { onlyIf: a.onlyIf.cond === 'ask' ? a.onlyIf : { cond: 'ask' as const, text: a.text } } : {}),
      } : {};
      abilities[i] = { kind: 'manual', text: a.text, ...(a.src ? { src: a.src } : {}), prov: { by: 'fallback' }, reason, shape: a.kind === 'triggered' ? 'triggered' : a.kind === 'activated' ? 'activated' : a.kind === 'spell' ? 'spell' : 'static', ...act };
      gate[i] = NOT_GATED;
      diagnostics.push({ level: 'manual', code: 'unbound-reference', message: `${reason}: "${a.text}"`, range: owners[i]!.range });
      for (const range of owners[i]!.ranges) ledger = markLedger(text, ledger, range, 'manual', undefined, reason);
    });
  };
  // CR 607.2a: "the exiled card" in one ability reads what another ability of this face exiled (WP23)
  applyLink(linkExiled(abilities, ctx.types.some((t) => PERMANENT_CARD_TYPES.has(t.toLowerCase()))), UNLINKED_EXILED);
  // CLOUD C5 (CR 607.2d): "the chosen color" in one ability is the color another ability of this face chose as the object entered
  applyLink(linkChosen(abilities, choiceReaders), `unlinked: "the chosen color" / "the chosen type" needs exactly one "As ~ enters, choose ..." of that kind on this face (CR 607.2d)`);
  // LNK1 (CR 607.1): "that player" in one ability is the player another ability of this face targeted
  applyLink(linkTargetedPlayer(abilities), `unlinked: "that player" needs exactly one target player in another ability on this face (CR 607.1)`);
  // std-control-1 (CR 607.2d): "the chosen creature" / "the chosen player" in one ability is what another ability of this face chose
  applyLink(linkChosenObject(abilities), `unlinked: "the chosen creature" needs exactly one choice of one object in another ability on this face (CR 607.2d)`);
  applyLink(linkChosenOpponent(abilities), `unlinked: "the chosen player" needs exactly one "choose an opponent" as ~ enters or transforms on this face (CR 607.2d)`);
  // std-rx28 (CR 701.4a, 702.188a): "the creature you chose or the card you revealed" and "the returned creature" read a cost of this face (a behold additional cost,
  // web-slinging or sneak); with no such cost the ability reads nothing and is manual (model/lint-card.ts#costReferenceIssues says the same card-wide)
  // std-cardcopy-2 (CR 611.2a, 613.1f): "It gains this card's other abilities" grants copies of the other abilities of this face, each understood in full
  applyLink(fillOtherAbilities(abilities), `unlinked: "this card's other abilities" needs every other ability of this face understood in full (CR 613.1f)`);
  applyLink({ producers: new Map(), consumers: [], unlinked: costReadersWithoutCost(abilities) }, `unlinked: "the creature you chose or the card you revealed" needs a behold cost, "the returned creature" web-slinging or sneak, on this face (CR 701.4a, 702.188a)`);
  for (const t of experimental) diagnostics.push({ level: 'info', code: 'experimental', message: `experimental template ${t}: the card is capped at partial (design 6.9)` });
  return { abilities, ledger, diagnostics, gate, templatesUsed, experimental, experimentalBy };

}

/** Contract C1: never throws. P1: the same card parsed again with the same options is answered from a short memo of frozen results (parser/parse-memo.ts). */
export const parseCard: ParseCard = (card: OracleCard, opts: ParseOptions): ParseResult => memoParse(card, withMeldNames(card, opts), parseFresh);

/** The options of one meld card per options object and card name: the same object every time, so the memo (parse-memo.ts) keeps working. */
const MELD_OPTIONS = new WeakMap<ParseOptions, Map<string, ParseOptions>>();

/**
 * MX2 (CR 712.4, 201.2): a meld card names its partner and its result ("a creature named Bruna, the Fading Light", "meld them into Brisela, Voice of
 * Nightmares"), names with commas or "and" that no run of capitalized words spells. Without a card-name index (the game path has none), the parser reads
 * exactly those two names, from the card's own related parts (Scryfall `all_parts`, as cards/faces.ts reads them): a `named` phrase naming anything else on a
 * meld card does not parse (fail closed). Any other card, or options that carry an index, are unchanged.
 */
function withMeldNames(card: OracleCard, opts: ParseOptions): ParseOptions {
  if (card === null || typeof card !== 'object' || opts.cardNames !== undefined || !Array.isArray(card.all_parts)) return opts;
  // M11-4 (CR 702.124j): "Partner with Toothy, Imaginary Friend" names the other card of the pair, which Scryfall lists as a `combo_piece` of the card: the same
  // reading of exactly the related names (parser/tokenize.ts reads a card name after "partner with" as one word when it is in the set)
  const partnerWith = card.layout !== 'meld' && typeof card.oracle_text === 'string' && /^Partner with /m.test(card.oracle_text);
  const parts = partnerWith ? ['combo_piece'] : ['meld_part', 'meld_result'];
  const names = card.layout !== 'meld' && !partnerWith
    ? namedComboPieces(card)
    : card.all_parts.filter((p) => parts.includes(p.component) && typeof p.name === 'string' && p.name !== card.name).map((p) => p.name);
  if (names.length === 0) return opts;
  let byCard = MELD_OPTIONS.get(opts);
  if (!byCard) MELD_OPTIONS.set(opts, (byCard = new Map()));
  let out = byCard.get(card.name);
  if (!out) byCard.set(card.name, (out = { ...opts, cardNames: new Set(names) }));
  return out;
}

/**
 * std-ry4 (CR 201.2, 201.3): "search your library and/or graveyard for a card named Eivor, Battle-Ready" (the Planeswalker-deck and story cards) names another
 * card, which Scryfall lists as a `combo_piece` of this one; a name with a comma or with words the lexicon lacks is spelled by no run of capitalized words.
 * The parser then reads exactly the related names that the text prints right after "named", as for the meld cards. Only when EVERY "named" of the card's
 * text is followed by one of them: with the index set, the Name hole reads nothing else, so a card naming any other card keeps the old reading.
 */
function namedComboPieces(card: OracleCard): string[] {
  const all = card.all_parts!.filter((p) => p.component === 'combo_piece' && typeof p.name === 'string' && p.name !== card.name).map((p) => p.name);
  if (all.length === 0) return [];
  const texts = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter((t): t is string => typeof t === 'string');
  const used = new Set<string>();
  for (const t of texts) {
    for (const m of t.matchAll(/\bnamed /g)) {
      // "named Dragonstorm Globe or Boulderborn Dragon": every name of the list, each one a combo piece
      for (let at = m.index! + m[0].length; ;) {
        const hit = all.filter((n) => t.startsWith(n, at)).sort((a, b) => b.length - a.length)[0];
        if (hit === undefined) return [];
        used.add(hit);
        const next = /^(?:,? or |, (?:and\/)?or |, )(?=[A-Z])/.exec(t.slice(at + hit.length));
        if (next === null) break;
        at += hit.length + next[0].length;
      }
    }
  }
  return [...used];
}

function parseFresh(card: OracleCard, opts: ParseOptions): ParseResult {
  let contexts: FaceContext[];
  try {
    contexts = faceContexts(card, opts);
  } catch (e) {
    return { faces: [errorFace(typeof card?.oracle_text === 'string' ? card.oracle_text : '', e)], parserVersion: PARSER_VERSION };
  }
  const cardHasX = cardHasXCost(card);
  const cyclingX = cyclingHasX(card);
  const faces = contexts.map((ctx) => {
    try {
      return parseFace(ctx, opts, cardHasX, cyclingX);
    } catch (e) {
      return errorFace(typeof ctx.text === 'string' ? ctx.text : '', e);
    }
  });
  return { faces, parserVersion: PARSER_VERSION };
}
