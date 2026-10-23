/**
 * The announcement of a spell's additional costs (CR 601.2b, 118.8): the mandatory ones are always paid, the optional ones (kicker, multikicker, buyback,
 * entwine) are offered when they can be paid together with everything announced so far. Moved unchanged out of actions/cast.ts#castSpell by M6-0 (m6 design
 * 4.1, 4.2) so M6-5 can add the choice between grouped costs (`AdditionalCostDef.choiceGroup`, CR 601.2b) in its own file. Owner: M6-5 from W1.
 *
 * M6-5 (m6 design 3.8): "As an additional cost to cast this spell, sacrifice a creature or pay {3}" is two `additionalCost` statics sharing a `choiceGroup`:
 * exactly one of them is paid (none, when every cost of the group is optional and the player declines). The player chooses among the costs of the group
 * that can be paid with everything announced so far, at CR 601.2b, before modes, X and targets (601.2b-c); the chosen cost's name, if any, joins the cast
 * record like any other paid additional cost. `castCheck` refuses the cast when no cost of a mandatory group can be paid (`groupedCostsDenial`, CR 601.2h).
 */
import type { CostDef, CostPart, EffectProgram, ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { CostsPaid, GameObject, GameState } from '../types/state';
import { commanderTax, isCommander } from '../statics/commander';
import { IllegalAction, type Game } from '../core/game';
import { addPlans, manaCostText, planFromCostDefs, type CostPlan, type CostX } from '../rules/cost';
import { deny, type Denial } from '../rules/denial';
import type { AnnounceEnv } from './announce-cond';
import { modesDenial, programsDenial } from './announce';
import { isKickerName, type AdditionalOption } from './cast-options';
import { charsOfObject } from '../rules/characteristics';
import { ALL_CREATURE_TYPES } from '../rules/creature-types';

const ORDINALS = ['', 'first', 'second', 'third', 'fourth'];
/** How an additional cost is named to the player: "kicker", "second kicker" for "kicker:2" (CR 702.33f), "buyback", or "additional" for an unnamed one. */
export function costLabel(name: string | undefined): string {
  if (name === undefined) return 'additional';
  const m = /^(.+):(\d+)$/.exec(name);
  return m ? `${ORDINALS[Number(m[2])] ?? `#${m[2]}`} ${m[1]}` : name;
}

/** CR 601.2b, 118.8: the mandatory additional costs are paid with the spell: their definitions join `costs` and their names the cast record. M6-5: a cost of a choice group is announced by `announceGroupedCosts` instead. */
export function announceMandatoryCosts(additional: readonly AdditionalOption[], paid: CostsPaid, costs: CostDef[]): void {
  for (const o of additional) {
    if (o.optional || o.choiceGroup !== undefined) continue;
    costs.push(o.cost);
    if (o.name) (paid.additional ??= []).push(o.name);
  }
}

/**
 * M11-1 (m11 design 2), CR 903.8, 702.124d: the commander tax of a commander cast from the command zone, an additional cost of {2} (the variant's `tax`) for
 * each previous time its owner cast THAT commander from the command zone this game (a partner's casts don't count). An additional cost, so it is paid even
 * when the spell is cast without paying its mana cost or for an alternative cost (CR 118.9d), and cost increases and reductions apply to the total that
 * includes it (CR 601.2f). Null when nothing is owed (the first cast, a card cast from anywhere else, any card outside a Commander game).
 */
export function commanderTaxCost(s: GameState, o: GameObject): CostDef | null {
  if (o.zone !== 'command' || !isCommander(s, o)) return null;
  const n = commanderTax(s, o.cardId);
  if (n <= 0) return null;
  // CMD2 (CR 903.8, 119.4): "Rather than pay {2} for each previous time you've cast this spell from the command zone this game, pay 2 life that many times."
  // (Liesa, Shroud of Dusk): the card's own ability says how the tax is paid; the number of previous casts is the tax divided by the variant's {2}
  const lifeEach = taxAsLife(s, o);
  const tax = s.options.commander?.tax ?? 0;
  if (lifeEach !== undefined && tax > 0) return { other: [{ kind: 'payLife', amount: lifeEach * (n / tax) }] };
  return { mana: [{ kind: 'generic', amount: n }] };
}

/** CMD2: the life per previous cast of the commander's own `commanderTaxAsLife` rule (its printed abilities on the face being cast), or undefined. */
function taxAsLife(s: GameState, o: GameObject): number | undefined {
  const face = s.defs[o.defId]?.faces[o.face ?? 0];
  for (const a of face?.abilities ?? []) {
    if (a.kind !== 'static') continue;
    for (const e of a.effects) if (e.s === 'rule' && e.rule === 'commanderTaxAsLife' && typeof e.value === 'number') return e.value;
  }
  return undefined;
}

/** M6-5: the mandatory additional costs that are always paid (no choice group), for castCheck's "can it be paid at all" (CR 601.2h). */
export const ungroupedMandatoryCosts = (additional: readonly AdditionalOption[]): CostDef[] =>
  additional.filter((a) => !a.optional && a.choiceGroup === undefined).map((a) => a.cost);

/** M6-5: the choice groups of the spell's additional costs, in printed order; `optional` when every cost of the group is optional (none may be paid). */
export function costGroups(additional: readonly AdditionalOption[]): { group: string; options: AdditionalOption[]; optional: boolean }[] {
  const out: { group: string; options: AdditionalOption[]; optional: boolean }[] = [];
  for (const o of additional) {
    if (o.choiceGroup === undefined) continue;
    let g = out.find((x) => x.group === o.choiceGroup);
    if (g === undefined) out.push(g = { group: o.choiceGroup, options: [], optional: true });
    g.options.push(o);
    if (!o.optional) g.optional = false;
  }
  return out;
}

/**
 * M6-5, CR 601.2b, 601.2h: a spell with a mandatory choice group can be cast only if, for every such group, one of its costs can be paid together with the
 * rest (`payableWith` gets the costs chosen from the groups; the caller adds the base and ungrouped costs). Groups are few (one per card in print), so every
 * combination is tried. Null when castable.
 */
export function groupedCostsDenial(additional: readonly AdditionalOption[], payableWith: (chosen: CostDef[]) => boolean, spellName: string): Denial | null {
  const groups = costGroups(additional).filter((g) => !g.optional);
  if (groups.length === 0) return null;
  const search = (i: number, chosen: CostDef[]): boolean =>
    i === groups.length ? payableWith(chosen) : groups[i]!.options.some((o) => search(i + 1, [...chosen, o.cost]));
  return search(0, []) ? null : deny(`None of the additional costs ${spellName} offers to choose from can be paid.`, 'CR 601.2b', 'CR 601.2h');
}

const article = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
/** The noun of a cost part's filter for a prompt ("creature", "artifact or creature"); `fallback` when the filter names no type. */
function filterNoun(f: ObjectFilter | undefined, fallback: string): string {
  const types = f?.types ?? [];
  return types.length > 0 ? types.map((t) => t.toLowerCase()).join(' or ') : fallback;
}
function partLabel(p: CostPart): string {
  const many = (c: unknown): boolean => typeof c === 'number' && c !== 1;
  switch (p.kind) {
    case 'sacrifice': return p.self ? 'Sacrifice this' : many(p.count) ? `Sacrifice ${String(p.count)} ${filterNoun(p.filter, 'permanent')}s` : `Sacrifice ${article(filterNoun(p.filter, 'permanent'))}`;
    case 'discard': return p.hand ? 'Discard your hand' : many(p.count) ? `Discard ${String(p.count)} cards` : 'Discard a card';
    case 'payLife': return `Pay ${typeof p.amount === 'number' ? p.amount : 'X'} life`;
    case 'exileFrom':
      if (p.zone === 'battlefield' && !p.orGraveyard) return p.self ? 'Exile this' : `Exile ${many(p.count) ? `${String(p.count)} ${filterNoun(p.filter, 'permanent')}s` : article(filterNoun(p.filter, 'permanent'))} you control`; // FAST5X E13
      return `Exile ${many(p.count) ? `${String(p.count)} cards` : 'a card'} from your ${p.zone}`;
    case 'reveal': {
      const sub = (p.filter?.subtypes ?? []).join(' ');
      return `Reveal ${article(sub !== '' ? `${sub} card` : filterNoun(p.filter, 'card'))} from your hand`;
    }
    case 'tapUntapped': return `Tap ${article(`untapped ${filterNoun(p.filter, 'permanent')}`)} you control`;
    case 'untapTapped': return `Untap ${many(p.count) ? `${String(p.count)} tapped ${filterNoun(p.filter, 'permanent')}s` : article(`tapped ${filterNoun(p.filter, 'permanent')}`)} you control`; // p2-cost-parts-1
    // FAST5X E9 (CR 701.68a): "Blight 2" says how many -1/-1 counters; other actions keep their name
    case 'action': return p.action === 'blight' && typeof p.arg === 'number' ? `Blight ${p.arg} (put ${p.arg === 1 ? 'a -1/-1 counter' : `${p.arg} -1/-1 counters`} on a creature you control)` : p.action;
    // FAST5X E27 (CR 122.1f, 601.2b): "Get 2 poison counters"; a choice between costs, "{3} or Discard a card"
    case 'getCounters': return `Get ${typeof p.amount === 'number' ? p.amount : 'X'} poison counter${p.amount === 1 ? '' : 's'}`;
    case 'oneOf': return p.options.map(costOptionLabel).join(' or ');
    // FAST5X E11 (CR 701.4a): "Behold a Kithkin" (choose one you control or reveal one from your hand)
    case 'behold': {
      const q = [...(p.filter.supertypes ?? []).map((t) => t.toLowerCase()), ...(p.filter.subtypes ?? []), ...(p.filter.types ?? []).map((t) => t.toLowerCase())].join(' ');
      return `Behold ${article(q !== '' ? q : 'card')}${p.exile ? ' and exile it' : ''}`;
    }
    case 'chooseObject': return `Choose ${p.count === 1 ? 'one' : String(p.count)}: ${p.filters.map((f) => `${filterNoun(f, 'object')} (${String(f.zone)})`).join(' or ')}`; // std-costs-2 (CR 601.2b)
    default: return p.kind;
  }
}
/** A cost as an option label: "{3}", "Sacrifice a creature", "Pay 2 life, Discard a card". */
export function costOptionLabel(c: CostDef): string {
  const parts: string[] = [];
  if (c.mana && c.mana.length > 0) parts.push(manaCostText(c.mana));
  for (const p of c.other ?? []) parts.push(partLabel(p));
  return parts.length > 0 ? parts.join(', ') : '{0}';
}

/**
 * M6-5, CR 601.2b: for each choice group, the player chooses the one cost of the group to pay among those that can be paid with everything announced so far
 * (a group whose costs are all optional may be declined). One payable cost of a mandatory group is chosen without asking (there is nothing to choose).
 */
export function announceGroupedCosts(env: OptionalCostsEnv): void {
  const { g, player, spellName, paid, costs, basePlan, payable } = env;
  for (const grp of costGroups(env.additional)) {
    const fits = grp.options.filter((o) => payable(addPlans(basePlan('unannounced'), planFromCostDefs([...costs, o.cost], 'unannounced'))));
    if (fits.length === 0) {
      if (grp.optional) continue;
      throw new IllegalAction(`None of the additional costs of ${spellName} can be paid.`, ['CR 601.2b', 'CR 601.2h']);
    }
    let pick: AdditionalOption | undefined;
    if (fits.length === 1 && !grp.optional) {
      pick = fits[0]!;
      g.log(`${env.name} pays the only additional cost of ${spellName} that can be paid: ${costOptionLabel(pick.cost)}.`, { rules: ['CR 601.2b'], level: 'info' });
    } else {
      const ids = g.choose({
        kind: 'chooseOption', player, prompt: `Choose the additional cost to pay for ${spellName}.`, min: grp.optional ? 0 : 1, max: 1, cancellable: true,
        options: grp.options.map((o, i) => ({ id: String(i), label: costOptionLabel(o.cost), ...(fits.includes(o) ? {} : { disabled: "You can't pay this cost." }) })),
        rules: ['CR 601.2b', 'CR 118.8'],
      }).ids;
      const chosen = ids.length > 0 ? grp.options[Number(ids[0])] : undefined;
      if (chosen !== undefined && !fits.includes(chosen)) throw new IllegalAction(`That additional cost of ${spellName} can't be paid.`, ['CR 601.2b', 'CR 601.2h']);
      pick = chosen;
    }
    if (pick === undefined) continue;
    costs.push(pick.cost);
    if (pick.name) (paid.additional ??= []).push(pick.name);
  }
}

/**
 * FAST5X E1 (CR 601.2f): run `f` with the spell's cost record (`paid`, the object its stack info holds) showing the trial announcement `trial` (its additional
 * cost names and kicker count), then restore it: a cost reduction that reads what was announced ("if it's bargained") must see the cost being tried.
 */
function withTrialPaid<T>(paid: CostsPaid, trial: CostsPaid, f: () => T): T {
  const had = { additional: paid.additional, kicked: paid.kicked, counts: paid.counts };
  if (trial.additional !== undefined) paid.additional = trial.additional;
  if (trial.kicked !== undefined) paid.kicked = trial.kicked;
  if (trial.counts !== undefined) paid.counts = trial.counts; // std-costs-1
  try {
    return f();
  } finally {
    if (had.additional === undefined) delete paid.additional;
    else paid.additional = had.additional;
    if (had.kicked === undefined) delete paid.kicked;
    else paid.kicked = had.kicked;
    if (had.counts === undefined) delete paid.counts;
    else paid.counts = had.counts;
  }
}

/**
 * std-costs-1 (CR 601.2b): the optional cost with the number of its "any number" part fixed to `n` (`AdditionalCostDef.announceCount`); null when it has no such
 * part, or more than one.
 */
export function withAnnouncedCount(cost: CostDef, n: number): CostDef | null {
  const parts = cost.other ?? [];
  const at = parts.map((p, i) => ('count' in p && p.count === 'any' ? i : -1)).filter((i) => i >= 0);
  if (at.length !== 1) return null;
  return { ...cost, other: parts.map((p, i) => (i === at[0] ? ({ ...p, count: n } as typeof p) : p)) };
}

/** std-costs-1: the most objects an "any number" part could take: the permanents the player controls (the parts that count are sacrifices), at most 20. */
export function countCap(s: GameState, player: PlayerId): number {
  return Math.min(20, s.zones.battlefield.filter((id) => s.objects[id]?.controller === player).length);
}

/**
 * FAST5X E1 (CR 702.174a): the opponent the caster chooses for a gift. With one opponent there is nothing to choose; with several the caster picks one (part
 * of the cancellable announcement, CR 601.2b, 733.1).
 */
function chooseOpponent(g: Game, player: PlayerId, spellName: string): PlayerId {
  const opponents = g.opponents(player).map((p) => p.id);
  if (opponents.length === 1) return opponents[0]!;
  const ans = g.choose({
    kind: 'chooseOption', player, prompt: `Choose the opponent you promise the gift of ${spellName} to.`, min: 1, max: 1, cancellable: true,
    options: opponents.map((id) => ({ id, label: g.player(id).name })), rules: ['CR 702.174a', 'CR 601.2b'],
  });
  const id = ans.ids[0];
  if (id === undefined || !opponents.includes(id)) throw new IllegalAction('Choose one of your opponents.', ['CR 702.174a']);
  return id;
}

/** What the optional-cost announcement needs from the cast in progress (actions/cast.ts#castSpell). */
export interface OptionalCostsEnv {
  g: Game;
  player: PlayerId;
  /** The caster's name and the spell's name, for prompts and the log. */
  name: string;
  spellName: string;
  stackId: ObjectId;
  additional: readonly AdditionalOption[];
  programs: EffectProgram[];
  paid: CostsPaid;
  aenv: AnnounceEnv;
  /** The costs announced so far; the chosen optional costs are added (each payment once). */
  costs: CostDef[];
  basePlan: (x: CostX) => CostPlan;
  /** Could the player pay this plan once the modifiers and the payment options are applied (CR 601.2f-h)? */
  payable: (plan: CostPlan) => boolean;
}

/** std-costs-2 (CR 607.2d): remember `value` on the spell under `link` (undefined forgets it). */
function setLink(g: Game, id: ObjectId, link: string, value: string | undefined): void {
  const o = g.s.objects[id];
  if (o === undefined) return;
  const links = { ...(o.links ?? {}) };
  if (value === undefined) delete links[link];
  else links[link] = { values: [value] };
  o.links = links;
}

/**
 * std-costs-2 (CR 601.2b, 205.3m): the creature types of the cards in the player's hand and the creatures they control (the types a cost "of that type" can be paid
 * with: behold reveals or chooses those, CR 701.4a), each tried as the choice the cost starts with: the ones with which `fits` holds. The spell remembers none of
 * them afterwards.
 */
function payableTypes(env: OptionalCostsEnv, link: string, fits: () => boolean): string[] {
  const { g, player, stackId } = env;
  const s = g.s;
  const ids = [...(s.zones.hand[player] ?? []), ...s.zones.battlefield.filter((id) => s.objects[id]?.controller === player)];
  const seen = new Set<string>();
  for (const id of ids) {
    const o = s.objects[id];
    if (o === undefined) continue;
    for (const t of charsOfObject(s, o).subtypes) if (ALL_CREATURE_TYPES.has(t)) seen.add(t);
  }
  const before = s.objects[stackId]?.links?.[link]?.values?.[0];
  const out: string[] = [];
  try {
    for (const t of [...seen].sort()) {
      setLink(g, stackId, link, t);
      if (fits()) out.push(t);
    }
  } finally {
    setLink(g, stackId, link, before);
  }
  return out;
}

/**
 * CR 601.2b, 118.8: the optional additional costs (kicker, buyback, entwine; multikicker any number of times), each offered when it can be paid with what was
 * announced before (and the modes it may change, CR 601.4, 702.42a). CR 702.33d-f: every kicker payment counts towards `kicked` (M6-5a).
 */
export function announceOptionalCosts(env: OptionalCostsEnv): void {
  const { g, player, name, spellName, stackId, paid, aenv, costs, basePlan, payable } = env;
  announceGroupedCosts(env); // M6-5: the choice between grouped costs comes first (CR 601.2b), so the optional costs below are offered on top of it
  for (const o of env.additional) {
    if (!o.optional || o.choiceGroup !== undefined) continue;
    const kicker = isKickerName(o.name); // CR 702.33d-f: "kicker", "kicker:2", ... and multikicker are one "kicked" count (M6-5a fix)
    const label = costLabel(o.name);
    // FAST5X E9 INTERFACE CHANGE (additive), CR 118.8, 601.2b: an optional cost without a keyword name ("As an additional cost to cast this spell, you may
    // blight 1") is recorded as `additional`, so "if this spell's additional cost was paid" can read it (wasCast kicked 'additional')
    const recordName = o.name ?? 'additional';
    const fits = (n: number): boolean => {
      // FAST5X E1 (CR 702.174a): a cost that is choosing an opponent can be paid only when there is one to choose
      if (o.choosePlayer === 'opponent' && g.opponents(player).length === 0) return false;
      const trial = { ...paid, ...(kicker ? { kicked: (paid.kicked ?? 0) + n } : {}), additional: [...(paid.additional ?? []), ...(Array(n).fill(recordName) as string[])] };
      const withIt = [...costs, ...Array<CostDef>(n).fill(o.cost)];
      const trialEnv = { ...aenv, costsPaid: trial };
      // The number of modes an override asks for (entwine: all of them) must still be choosable and payable with this cost paid (CR 702.42a, 601.4).
      // FAST5X E1 (CR 601.2f): the total cost is judged as if this cost were announced, so a reduction that reads it ("This spell costs {2} less to cast if
      // it's bargained", statics/match.ts wasCast on the stack) applies to the trial too
      return withTrialPaid(paid, trial, () => payable(addPlans(basePlan('unannounced'), planFromCostDefs(withIt, 'unannounced')))
        && programsDenial(g.s, env.programs, player, stackId, deny(''), stackId, trialEnv) === null
        && modesDenial(g.s, env.programs, player, stackId, stackId, trialEnv, (modeCs) => payable(addPlans(basePlan('unannounced'), planFromCostDefs([...withIt, ...modeCs], 'unannounced')))) === null);
    };
    // std-costs-2 (CR 601.2b, 607.2d): a cost that starts with choosing a creature type can be paid when some type leaves it payable; only those types are offered
    const types = o.chooseType !== undefined ? payableTypes(env, o.chooseType.link, () => fits(1)) : undefined;
    // std-costs-1 (CR 601.2b, 601.2f): "you may sacrifice any number of ...", a number a cost reduction of the spell reads: the number is announced now (0 is not
    // paying the cost), and only numbers that leave the total cost payable are allowed
    if (o.announceCount === true && o.name !== undefined) {
      const costName = o.name;
      const fitsCount = (n: number): boolean => {
        const fixed = withAnnouncedCount(o.cost, n);
        if (fixed === null) return false;
        const trial = { ...paid, additional: [...(paid.additional ?? []), costName], counts: { ...(paid.counts ?? {}), [costName]: n } };
        const withIt = [...costs, fixed];
        return withTrialPaid(paid, trial, () => payable(addPlans(basePlan('unannounced'), planFromCostDefs(withIt, 'unannounced')))
          && programsDenial(g.s, env.programs, player, stackId, deny(''), stackId, { ...aenv, costsPaid: trial }) === null);
      };
      const allowed: number[] = [];
      for (let n = 1; n <= countCap(g.s, player); n++) if (fitsCount(n)) allowed.push(n);
      if (allowed.length === 0) {
        g.log(`${name} can't pay the ${label} cost of ${spellName}, so it is cast without it.`, { rules: ['CR 601.2b', 'CR 118.3'], level: 'info' });
        continue;
      }
      const n = g.choose({ kind: 'chooseNumber', player, prompt: `How many for the ${label} cost of ${spellName}? (0: don't pay it)`, min: 0, max: allowed[allowed.length - 1]!, cancellable: true, rules: ['CR 601.2b', 'CR 118.8'] }).n;
      if (n === 0) continue;
      if (!allowed.includes(n)) throw new IllegalAction(`With ${n} for the ${label} cost the total cost of ${spellName} can't be paid.`, ['CR 601.2b', 'CR 601.2h']);
      costs.push(withAnnouncedCount(o.cost, n)!);
      (paid.additional ??= []).push(costName);
      paid.counts = { ...(paid.counts ?? {}), [costName]: n };
      continue;
    }
    const max = o.repeatable ? 20 : 1;
    let times = 0;
    if (types !== undefined) times = types.length > 0 ? 1 : 0;
    else while (times < max && fits(times + 1)) times++;
    if (times === 0) {
      g.log(`${name} can't pay the ${label} cost of ${spellName}, so it is cast without it.`, { rules: ['CR 601.2b', 'CR 118.3'], level: 'info' });
      continue;
    }
    let n = 0;
    if (o.repeatable) {
      // M6-12: the rule of the repeatable cost (multikicker CR 702.33c; squad, replicate: CR 702.157a, 702.56a, by the keyword data's names)
      const rule = kicker ? ['CR 702.33c'] : o.name?.startsWith('squad') ? ['CR 702.157a'] : o.name?.startsWith('replicate') ? ['CR 702.56a'] : [];
      n = g.choose({ kind: 'chooseNumber', player, prompt: `How many times do you pay the ${label} cost for ${spellName}?`, min: 0, max: times, cancellable: true, rules: ['CR 601.2b', ...rule] }).n;
    } else {
      const gift = o.choosePlayer === 'opponent'; // FAST5X E1: gift (CR 702.174a; declaring the intention to pay it promises the gift, CR 702.174k)
      const yes = g.choose({
        kind: 'yesNo', player, prompt: gift ? `Promise an opponent a gift for ${spellName}?` : `Pay the ${label} cost for ${spellName}?`,
        yesLabel: kicker ? 'Kick it' : gift ? 'Promise the gift' : 'Pay it', noLabel: kicker ? 'Don\'t kick it' : gift ? 'Don\'t promise it' : 'Don\'t pay it', cancellable: true,
        rules: ['CR 601.2b', ...(kicker ? ['CR 702.33a'] : []), ...(gift ? ['CR 702.174a'] : []), 'CR 118.8'],
      }).yes;
      n = yes ? 1 : 0;
      if (yes && types !== undefined && o.chooseType !== undefined) {
        const type = types.length === 1 ? types[0]! : g.choose({ kind: 'chooseName', player, prompt: `${spellName}: choose a creature type`, what: 'creatureType', options: [...types], rules: ['CR 601.2b', 'CR 205.3m'] }).name;
        if (!types.includes(type)) throw new IllegalAction(`The ${label} cost of ${spellName} can't be paid with that creature type.`, ['CR 601.2b', 'CR 118.3']);
        setLink(g, stackId, o.chooseType.link, type);
        (paid.chosenTypes ??= {})[o.chooseType.link] = type;
        g.log(`${name} chooses ${type} for the ${label} cost of ${spellName}.`, { rules: ['CR 601.2b', 'CR 607.2d'], level: 'info' });
      }
      if (yes && gift && o.name !== undefined) {
        const chosen = chooseOpponent(g, player, spellName);
        (paid.chosenPlayers ??= {})[o.name] = chosen;
        g.log(`${name} promises ${g.player(chosen).name} a gift (${spellName}).`, { rules: ['CR 702.174a', 'CR 702.174k'], level: 'info' });
      }
    }
    for (let i = 0; i < n; i++) costs.push(o.cost);
    if (n > 0) {
      if (kicker) paid.kicked = (paid.kicked ?? 0) + n; // CR 702.33d: every kicker payment counts (a spell kicked only with its second kicker is kicked)
      (paid.additional ??= []).push(...(Array(n).fill(recordName) as string[]));
    }
  }
}
