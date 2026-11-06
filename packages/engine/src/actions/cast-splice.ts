/**
 * Splice (CR 702.47; edh-next-69): "Splice onto Arcane {1}{R}" is a static ability of a card in a player's HAND (CR 702.47a, 113.6): as that player casts a spell of
 * the subtype (or types) it names, they may reveal the card from their hand and pay its splice cost as an additional cost (CR 601.2b, 601.2f, 118.8); the card's
 * text (except its splice ability) is added to the spell (CR 702.47b), after the spell's own text. The spliced card stays in the hand: it is not cast, and nothing
 * happens to it whatever becomes of the spell (CR 702.47c). The added instructions are part of the spell, so they take targets as the spell is announced
 * (CR 601.2c) and a copy of the spell has them too (CR 707.10).
 *
 * The engine keeps the added spell abilities with the spell (`StackInfo.splice`, a copy of what the card said as the spell was cast, CR 702.47b), announces their
 * targets after the spell's own and plays them after the spell's own steps (effects/run.ts#spellPlan). A card is spliceable only when everything it has besides its
 * splice ability is a plain spell ability (no modes, no manual instruction, no other keyword): anything else could not be added faithfully, so the card is not
 * offered (fail closed).
 */
import type { CostDef, EffectProgram, KeywordAbilityDef, ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { CostsPaid } from '../types/state';
import type { Game } from '../core/game';
import { matchesFilter } from '../rules/filter';
import { filterCtxOutside } from '../rules/filter-env';
import { charsOfObject } from '../rules/characteristics';
import { addPlans, manaCostText, planFromCostDefs, type CostPlan, type CostX } from '../rules/cost';
import { deny } from '../rules/denial';
import { objectsIn } from '../core/zones';
import { renamed } from '../rules/mode-instances';
import { programsDenial } from './announce';
import type { AnnounceEnv } from './announce-cond';

/** One card in the caster's hand that may be spliced onto the spell being cast. */
export interface SpliceOption {
  card: ObjectId;
  name: string;
  cost: CostDef;
  /** The spell abilities of the card, in printed order (a copy of its text, CR 702.47b). */
  programs: EffectProgram[];
  /** The text of those abilities, for the log and the stack. */
  text: string;
}

/** What the spell on the stack remembers of a spliced card (`StackInfo.splice`). */
export interface SplicedText {
  name: string;
  text: string;
  programs: EffectProgram[];
}

/** The splice keyword instance of a card, when it has exactly one with a cost and a filter. */
function spliceKeyword(keywords: readonly KeywordAbilityDef[]): (KeywordAbilityDef & { cost: CostDef; filter: ObjectFilter }) | null {
  const all = keywords.filter((k) => k.keyword === 'splice');
  const one = all[0];
  if (all.length !== 1 || one === undefined || one.cost === undefined || one.filter === undefined) return null;
  return one as KeywordAbilityDef & { cost: CostDef; filter: ObjectFilter };
}

/**
 * CR 702.47a: the cards in `player`'s hand that may be spliced onto the spell `spellId` (already on the stack, so its characteristics are the ones the filter
 * judges), in the order of the hand. The spell itself is no candidate (it left the hand).
 */
export function spliceOptions(g: Game, player: PlayerId, spellId: ObjectId): SpliceOption[] {
  const spell = g.s.objects[spellId];
  if (spell === undefined) return [];
  const out: SpliceOption[] = [];
  for (const card of objectsIn(g, 'hand', player)) {
    const id = card.id;
    if (id === spellId) continue;
    const c = charsOfObject(g.s, card);
    const kw = spliceKeyword(c.keywords);
    if (kw === null) continue;
    // CR 702.47a: the spell must be of the kind the splice ability names
    if (!matchesFilter(g.s, spell, kw.filter, filterCtxOutside(g.s, { controller: player, sourceId: id }))) continue;
    // CR 702.47b: the text of the card is added; only a card whose whole text is plain spell abilities can be added faithfully
    const programs: EffectProgram[] = [];
    const texts: string[] = [];
    let plain = true;
    for (const a of c.abilities) {
      if (a.def.kind === 'keyword' && a.def.keyword === 'splice') continue;
      if (a.def.kind === 'spell' && a.def.effect.modes === undefined) {
        programs.push(a.def.effect);
        texts.push(a.def.text);
      } else plain = false;
    }
    if (!plain || programs.length === 0) continue;
    // the spliced text's targets are its own (CR 115.3, 702.47b): their ids are renamed so that none meets an id of the spell (`t0` of both) or of another spliced card
    const copy = (JSON.parse(JSON.stringify(programs)) as EffectProgram[]).map((p, i) => renamed(p, `splice.${id}.${i}`));
    out.push({ card: id, name: c.name, cost: kw.cost, programs: copy, text: texts.join(' ') });
  }
  return out;
}

export interface SpliceEnv {
  g: Game;
  player: PlayerId;
  name: string;
  spellName: string;
  stackId: ObjectId;
  /** The spell's own programs (as chosen modes will make them). */
  programs: EffectProgram[];
  paid: CostsPaid;
  aenv: AnnounceEnv;
  /** The costs announced so far; the chosen splice costs are added. */
  costs: CostDef[];
  basePlan: (x: CostX) => CostPlan;
  payable: (plan: CostPlan) => boolean;
}

/**
 * CR 601.2b, 702.47a: for each card in hand that may be spliced onto the spell, the caster chooses whether to reveal it and pay its splice cost. Only a splice
 * that leaves the whole cost payable and every target of the added text choosable is offered (CR 601.2c, 601.2f). The chosen cards are returned in the order
 * chosen: their text is added in that order (CR 702.47b).
 */
export function announceSplice(env: SpliceEnv): { options: SpliceOption[]; texts: SplicedText[] } {
  const { g, player, name, spellName, stackId, paid, aenv, costs, basePlan, payable } = env;
  const chosen: SpliceOption[] = [];
  const texts: SplicedText[] = [];
  const taken = new Set<ObjectId>();
  // CR 702.47a: a card revealed this way is revealed once (a card with its own copy in hand may be spliced for each copy; each copy is a card of its own)
  for (;;) {
    const candidates = spliceOptions(g, player, stackId).filter((o) => !taken.has(o.card));
    const fits = (o: SpliceOption): boolean => {
      const withIt = [...costs, o.cost];
      const programs = [...env.programs, ...texts.flatMap((t) => t.programs), ...o.programs];
      const trial = { ...paid, additional: [...(paid.additional ?? []), 'splice'] };
      return payable(addPlans(basePlan('unannounced'), planFromCostDefs(withIt, 'unannounced')))
        && programsDenial(g.s, programs, player, stackId, deny(''), stackId, { ...aenv, costsPaid: trial }) === null;
    };
    const offered = candidates.filter(fits);
    if (offered.length === 0) break;
    const costText = (o: SpliceOption): string => (o.cost.mana !== undefined && (o.cost.other?.length ?? 0) === 0 ? manaCostText(o.cost.mana) : 'its splice cost');
    const pick = offered.length === 1 ? offered[0]! : undefined;
    let o: SpliceOption | undefined;
    if (pick !== undefined) {
      const yes = g.choose({
        kind: 'yesNo', player, prompt: `Reveal ${pick.name} and splice it onto ${spellName} (pay ${costText(pick)})?`,
        yesLabel: 'Splice it', noLabel: 'Don\'t splice it', cancellable: true, rules: ['CR 702.47a', 'CR 601.2b', 'CR 118.8'],
      }).yes;
      if (yes) o = pick;
    } else {
      const ids = g.choose({
        kind: 'chooseObjects', player, prompt: `You may reveal a card with splice from your hand and splice it onto ${spellName}.`,
        options: offered.map((x) => x.card), min: 0, max: 1, cancellable: true, rules: ['CR 702.47a', 'CR 601.2b'],
      }).ids;
      o = offered.find((x) => x.card === ids[0]);
    }
    if (o === undefined) break;
    taken.add(o.card);
    chosen.push(o);
    texts.push({ name: o.name, text: o.text, programs: o.programs });
    costs.push(o.cost);
    (paid.additional ??= []).push('splice');
    g.log(`${name} reveals ${o.name} from their hand and splices it onto ${spellName}.`, { rules: ['CR 702.47a', 'CR 702.47b'], level: 'info' });
  }
  return { options: chosen, texts };
}
