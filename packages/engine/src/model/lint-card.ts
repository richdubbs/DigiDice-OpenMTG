/**
 * Card-wide checks (model/api.ts#ValidateCardAbilities): what no single ability can decide. Owner: WP1.
 *
 *  - `unlinked` (CR 607.1-607.2): a consumer of a link ({ref:'linked'}, a `chosen` filter or condition, a chosen color or type) needs a producer
 *    (`move.link`, `createToken.link`, `chooseValue.link`, `enters.choose[].link`, LNK1: `TargetSpec.link`) on the same card; a producer nobody reads is a warning.
 *  - the same keyword ability twice with identical parameters is a warning (`duplicate-name`).
 *  - face structure: at least one face; all spell-effect lines of one face are ONE spell ability (design D25, CR 113.3a).
 *
 * Abilities nested inside another node (granted abilities, tokens' abilities) keep their links in a fresh namespace (CR 607.5) and are skipped here.
 */
import type { AbilityDef } from '../types/ability';
import type { Issue } from './api';
import { canonicalize } from './canonical';
import { ABILITY_DEFS, walkAbility } from './walk';

export interface LinkUse {
  link: string;
  path: string;
  /** Producer: the kind of value a `chooseValue` / `enters.choose` makes (a color, a creature type, ...). */
  what?: string;
  /** Consumer: the qualities that can read it (a chosen type is read as a card type or a creature type, ...). */
  reads?: readonly string[];
}

/**
 * FAST5X E26 (CR 607.2a, 702.75a): the links a keyword's expansion produces (hideaway records the card it exiles face down under "exiled"), by keyword name. The
 * keyword library is not readable from model/ (design 5.4), so model/capabilities.ts installs the table from the expansions, as it does the keyword manuals.
 */
let KEYWORD_LINKS: ReadonlyMap<string, readonly string[]> = new Map();
export function installKeywordLinks(entries: Iterable<readonly [string, readonly string[]]>): void {
  KEYWORD_LINKS = new Map(entries);
}

export function collectLinks(def: AbilityDef, base: string, producers: LinkUse[], consumers: LinkUse[]): void {
  if (def.kind === 'keyword') for (const link of KEYWORD_LINKS.get(def.keyword) ?? []) producers.push({ link, path: base }); // FAST5X E26: hideaway
  walkAbility(def, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    const v = n.value;
    const add = (list: LinkUse[], link: unknown, extra: Partial<LinkUse> = {}): void => {
      if (typeof link === 'string') list.push({ link, path: n.path, ...extra });
    };
    switch (n.def) {
      case 'EffectStep':
        add(producers, v['link'], v['op'] === 'chooseValue' && typeof v['what'] === 'string' ? { what: v['what'] } : {});
        break;
      case 'ReplacementBody.choose':
        add(producers, v['link'], typeof v['what'] === 'string' ? { what: v['what'] } : {});
        break;
      case 'ReplacementBody': // std-ru (CR 607.2a): "exile it instead" with a link records what it exiled (effects/bodies/m5.ts#linkAfterMove)
        if (v['b'] === 'modify') add(producers, v['link']);
        // std-cardcopy-3 (CR 614.12a, 607.2a): "As ~ enters, exile up to X creature cards from your graveyard" keeps the cards it exiled (effects/bodies/m5.ts#exileAsEnters)
        if (v['b'] === 'enters' && typeof v['exileCards'] === 'object' && v['exileCards'] !== null) add(producers, (v['exileCards'] as Record<string, unknown>)['link']);
        break;
      case 'TargetSpec': // LNK1: the targets an ability affected (CR 607.1, "that player" of another ability)
        add(producers, v['link']);
        break;
      case 'AdditionalCostDef': { // std-costs-2: an additional cost that chooses a creature type as it is announced (CR 601.2b, 607.2d)
        const ct = v['chooseType'];
        if (ct !== null && typeof ct === 'object' && !Array.isArray(ct)) add(producers, (ct as Record<string, unknown>)['link'], { what: String((ct as Record<string, unknown>)['what']) });
        break;
      }
      case 'CostPart': // FAST5X E11: "behold a Goblin and exile it" (CR 607.2q: the exiled card, read by the permanent the spell becomes)
        if (v['kind'] === 'behold' || v['kind'] === 'exileFrom') add(producers, v['link']); // FAST5 T59: "exile a creature you control" as an additional cost too
        if (v['kind'] === 'action' && v['action'] === 'collectEvidence') add(producers, v['link']); // std-rx27: an activated ability's collect evidence (CR 607.2a)
        break;
      case 'ObjRef':
      case 'PlayerRef':
        if (v['ref'] === 'linked') add(consumers, v['link']);
        break;
      case 'ObjectFilter.chosen':
        add(consumers, v['link'], typeof v['quality'] === 'string' ? { reads: [v['quality']] } : {});
        break;
      case 'Condition':
        if (v['cond'] === 'chosen') add(consumers, v['link']);
        break;
      case 'ManaProduction':
        if (v['kind'] === 'chosen') add(consumers, v['link'], { reads: ['color'] });
        break;
      case 'Modification.colors':
        add(consumers, v['chosen'], { reads: ['color'] });
        break;
      case 'TypeChange':
        // the slot says which class of type is set: card types, creature or land types (subtypes), supertypes (never chosen)
        add(consumers, v['chosen'], { reads: n.slot === 'types' ? ['cardType'] : n.slot === 'subtypes' ? ['creatureType', 'landType'] : [] });
        break;
      default:
    }
    return undefined;
  }, { path: base });
}

/**
 * CLOUD C8 (CR 601.2b, 400.7j): a spell reads what its own additional cost discarded or exiled (`{ref:'costDiscarded'}`, `{ref:'costExiled'}`: "the discarded card",
 * "the exiled card's power") only when the face states such a cost, as the static ability "As an additional cost to cast this spell, discard a card" (the cost is
 * an ability of its own, CR 601.2b, so model/lint-nodes.ts cannot see it from the spell). Without one the reference names nothing: an error, never a silent 0.
 */
function costReferenceIssues(abilities: readonly AbilityDef[], fi: number, issues: Issue[]): void {
  const parts = abilities.flatMap((a) => (a.kind === 'static' ? a.effects.flatMap((e) => (e.s === 'additionalCost' ? e.cost.other ?? [] : [])) : []));
  const pays = (kind: string): boolean => parts.some((p) => p.kind === kind && !('self' in p && p.self === true));
  const READS: Readonly<Record<string, string>> = { costDiscarded: 'discard', costExiled: 'exileFrom', costBeheld: 'behold' /* std-rx28 */, costChosenObject: 'chooseObject' /* std-costs-2 */, costRevealed: 'reveal' /* p2-refs-1 */ };
  // std-rx28 (CR 702.188a, 702.190b): "the returned creature" of a face whose web-slinging or sneak cost returns a creature, in any ability of that face
  const returns = abilities.some((a) => a.kind === 'keyword' && (a.keyword === 'web-slinging' || a.keyword === 'sneak'));
  abilities.forEach((a, ai) => {
    walkAbility(a, (n) => {
      if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
      if (n.def === 'ObjRef' && n.value['ref'] === 'costReturned' && !returns) {
        issues.push({ path: n.path, code: 'executable-gap', severity: 'error', message: `{ref:'costReturned'} needs web-slinging or sneak on that face (CR 702.188a, 702.190b)` });
      }
      return undefined;
    }, { path: `/faces/${fi}/abilities/${ai}` });
  });
  abilities.forEach((a, ai) => {
    if (a.kind !== 'spell') return;
    walkAbility(a, (n) => {
      if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
      const r = n.def === 'ObjRef' ? n.value['ref'] : undefined;
      const kind = typeof r === 'string' ? READS[r] : undefined;
      if (kind !== undefined && n.value['self'] !== true && !pays(kind)) {
        issues.push({ path: n.path, code: 'executable-gap', severity: 'error', message: `{ref:'${String(r)}'} in a spell needs an additional cost of that face that ${kind === 'discard' ? 'discards' : kind === 'behold' ? 'beholds' : kind === 'reveal' ? 'reveals' : 'exiles'} a card (CR 601.2b, 400.7j, 701.4a)` });
      }
      return undefined;
    }, { path: `/faces/${fi}/abilities/${ai}` });
  });
}

export function lintCard(faces: { abilities: AbilityDef[] }[]): Issue[] {
  const issues: Issue[] = [];
  if (!Array.isArray(faces) || faces.length === 0) {
    issues.push({ path: '/faces', code: 'executable-gap', severity: 'error', message: 'a card has at least one face' });
    return issues;
  }
  const producers: LinkUse[] = [];
  const consumers: LinkUse[] = [];
  faces.forEach((face, fi) => {
    const abilities = Array.isArray(face.abilities) ? face.abilities : [];
    const seen = new Map<string, number>();
    let spells = 0;
    abilities.forEach((a, ai) => {
      const base = `/faces/${fi}/abilities/${ai}`;
      if (a.kind === 'spell' && ++spells > 1) {
        issues.push({ path: base, code: 'executable-gap', severity: 'error', message: 'all spell-effect lines of a face are one spell ability (CR 113.3a, design D25)' });
      }
      if (a.kind === 'keyword') {
        const key = JSON.stringify({ ...canonicalize(a), text: undefined, src: undefined, prov: undefined });
        const first = seen.get(key);
        if (first !== undefined) {
          issues.push({ path: base, code: 'duplicate-name', severity: 'warning', message: `keyword "${a.keyword}" appears twice with the same parameters (also abilities/${first})` });
        } else seen.set(key, ai);
      }
      collectLinks(a, base, producers, consumers);
    });
    costReferenceIssues(abilities, fi, issues); // CLOUD C8
  });
  const produced = new Set(producers.map((p) => p.link));
  const consumed = new Set(consumers.map((c) => c.link));
  for (const c of consumers) {
    if (!produced.has(c.link)) {
      issues.push({ path: c.path, code: 'unlinked', severity: 'error', message: `link "${c.link}" is read here but no ability of this card produces it (CR 607.1)` });
      continue;
    }
    // CR 607.2d: a chosen color is read as a color, a chosen creature type as a creature type; every producer that says what it chose must be readable so
    const kinds = producers.filter((p) => p.link === c.link).map((p) => p.what);
    if (c.reads !== undefined && kinds.every((k) => k !== undefined) && !kinds.some((k) => c.reads!.includes(k!))) {
      issues.push({ path: c.path, code: 'unlinked', severity: 'error', message: `link "${c.link}" holds ${[...new Set(kinds)].join(' / ')}, which cannot be read as ${c.reads.join(' / ') || 'this'} (CR 607.2d)` });
    }
  }
  for (const p of producers) {
    if (!consumed.has(p.link)) {
      issues.push({ path: p.path, code: 'unlinked', severity: 'warning', message: `link "${p.link}" is produced here but no ability of this card reads it (CR 607.1)` });
    }
  }
  return issues;
}
