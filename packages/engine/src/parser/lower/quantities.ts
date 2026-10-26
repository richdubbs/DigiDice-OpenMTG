/**
 * Pass 5, quantities (design 6.5). Owner: WP17.
 *
 *  - "where X is ..." / "X is equal to ...": the defined quantity replaces every `{q:'X'}` of the sentence. It is evaluated when the step runs (CR 608.2h),
 *    so it is substituted, not fixed by a `let`. A template expresses the clause with the intermediate node
 *    `{"lower": "whereX", "value": <Qty>, "steps": <Effects>}` (the only intermediate form of this pass; it never reaches the model).
 *  - "that many" / "that much" (`{q:'eventAmount', $anaphor}` from the Qty hole): the unique-candidate rule of design 6.4 over the numbers the ability
 *    has seen so far: the amount of the triggering event (`{q:'eventAmount'}`, CR 603.4 context: damage dealt, life gained, cards drawn, ...) and the result
 *    count of an earlier step (`{q:'resultCount', step}`, "the number of cards discarded this way"). Zero or several: the sentence is manual.
 *  - "for each", "twice", "half ..., rounded down" are built by the Qty hole and the templates (`math`); nothing is left to do for them here.
 */
import { shieldShape } from '../taint';
import { patternsHaveAmount } from '../../model/lint-roles';
import type { EventPattern } from '../../types/ability';
import { COUNTED_OPS, stepsInOrder } from './mentions';
import { MOVED_MARK, MOVED_TO, movedBy, type MovedKind } from '../holes/moved-words';
import type { Draft, Rec, Unit } from './types';
import { clone, cloneDraft, freshName, isRec, rewrite, sequences, setManual, visit } from './util';

/** Replace `{q:'X'}` by `value` everywhere inside `v`. */
export function substituteX(v: unknown, value: unknown): unknown {
  return rewrite(v, (node) => (node['q'] === 'X' && Object.keys(node).length === 1 ? clone(value) : undefined));
}

/**
 * Expand the `whereX` intermediate nodes of a step list (they may only appear as steps). FAST5X E15: also in the step lists nested in a step (the `do` of a
 * reflexive trigger, "When you do, target creature gets -X/-X until end of turn, where X is ..."): the clause defines X for its own steps only, and the
 * quantity is read when they run (CR 608.2h, 603.12).
 * FAST5 T42: `values` collects the quantities of the step list's own clauses (not those of nested lists).
 */
function expandWhereX(steps: Rec[], values: unknown[] = []): Rec[] | null {
  const out: Rec[] = [];
  for (const s of steps) {
    if (s['lower'] === 'whereX') {
      if (!Array.isArray(s['steps']) || s['value'] === undefined) return null;
      values.push(s['value']);
      const inner = expandWhereX(s['steps'] as Rec[]);
      if (inner === null) return null;
      out.push(...(substituteX(inner, s['value']) as Rec[]));
    } else {
      const nested = expandNested(s);
      if (nested === null) return null;
      out.push(nested);
    }
  }
  return out;
}

/** A step with the `whereX` nodes of its nested step lists expanded (the step itself when it has none). */
function expandNested(step: Rec): Rec | null {
  let changed = false;
  const out: Rec = {};
  for (const [k, v] of Object.entries(step)) {
    if (Array.isArray(v) && v.some((x) => isRec(x) && x['lower'] === 'whereX')) {
      const e = expandWhereX(v as Rec[]);
      if (e === null) return null;
      out[k] = e;
      changed = true;
    } else if (isRec(v)) {
      const e = expandNested(v);
      if (e === null) return null;
      if (e !== v) changed = true;
      out[k] = e;
    } else if (Array.isArray(v) && v.some((x) => isRec(x))) {
      const items: unknown[] = [];
      for (const x of v) {
        if (!isRec(x)) { items.push(x); continue; }
        const e = expandNested(x);
        if (e === null) return null;
        if (e !== x) changed = true;
        items.push(e);
      }
      out[k] = items;
    } else out[k] = v;
  }
  return changed ? out : step;
}

interface NumberSource { ref: Rec; step?: { unit: Unit; path: string }; opaque?: boolean; keptOnly?: true }

/** FAST5X E15: the participle a "<things> <participle> this way" count names its step by (parser/holes/qty.ts). std-tdm: "destroyed this way". */
const PARTICIPLE_OF_OP: Readonly<Record<string, string>> = { draw: 'drawn', destroy: 'destroyed', counter: 'countered', flipCoin: 'flipped' }; // r4-moved: counter; std-rx30: flipCoin

/**
 * std-tdm (CR 701.8a, 608.2c): the noun of a "destroyed this way" count (parser/holes/qty.ts#destroyedThisWay) must name everything its destroy step can destroy, so
 * that the step's result count is the count: "permanent" always (only permanents are destroyed, CR 701.8a), a card type only when the step destroys objects of
 * that one type and nothing else ("destroy all creatures", "destroy all creatures with flying", a target creature). A narrower noun ("creature" after "destroy all
 * creatures and enchantments") would count a part of the result, which the model has no quantity for: no candidate, the sentence stays manual.
 */
function destroyedNounFits(step: Rec, head: unknown, d: Draft): boolean {
  if (head === 'permanent') return true;
  if (typeof head !== 'string') return false;
  const what = step['what'];
  const filter = !isRec(what) ? undefined : what['ref'] === 'each' ? what['filter'] : what['ref'] === 'target' ? d.targets.find((t) => t.id === what['id'])?.filter : undefined;
  const types = isRec(filter) && filter['anyOf'] === undefined ? filter['types'] : undefined;
  return Array.isArray(types) && types.length === 1 && String(types[0]).toLowerCase() === head;
}

/**
 * std-r9b (CR 608.2h, 400.3): a count of what was moved FROM a zone ("for each card exiled from their hand this way": `which.zone`, read as each card last existed
 * before it moved) never names a move of one target permanent, which was on the battlefield (a target with no zone of its own); any other move may have moved
 * such cards and stays a candidate.
 */
function fromZoneFits(step: Rec, which: unknown, d: Draft, unitSteps: readonly Rec[] = []): boolean {
  const zone = isRec(which) ? which['zone'] : undefined;
  if (typeof zone !== 'string' || zone === 'battlefield') return true;
  const what = step['what'];
  // std-costs-1 (CR 608.2h, 400.3; Deadly Cover-Up): the move of what an earlier step of the same sentence chose or found ("exile a card from an opponent's
  // graveyard", "search its owner's graveyard, hand, and library for ... and exile them") moved cards only from the zones that step looked in: a card chosen from
  // a graveyard was never in a hand. A step of another shape, or one not found, stays a candidate.
  if (isRec(what) && what['ref'] === 'bound') {
    const from = stepsInOrder(unitSteps as Rec[]).map((x) => x.step).find((x) => x['as'] === what['name'] && x !== step);
    if (from?.['op'] === 'search' && typeof from['zone'] === 'string') return [from['zone'], ...(Array.isArray(from['alsoZones']) ? from['alsoZones'] : [])].includes(zone);
    const fromFilter = from?.['op'] === 'chooseObjects' && isRec(from['from']) && (from['from'] as Rec)['ref'] === 'each' ? (from['from'] as Rec)['filter'] : undefined;
    if (isRec(fromFilter) && typeof fromFilter['zone'] === 'string') return fromFilter['zone'] === zone;
    return true;
  }
  if (!isRec(what) || what['ref'] !== 'target') return true;
  const spec = d.targets.find((t) => t.id === what['id']);
  return spec === undefined || spec.kind !== 'object' || spec.filter?.zone !== undefined;
}

/**
 * The numbers available before step `beforeStep` of `seq[at]`. A sentence that is not understood (an E1 shield aside) and a trigger clause that is not
 * understood may have produced a number too: they are opaque sources, so "that many" after them never resolves (design 6.4).
 */
function numberSources(d: Draft, seq: readonly Unit[], at: number, beforeStep: number, prefix: readonly Unit[]): NumberSource[] {
  // p2-mana-1: the counters a cost removed (lower/ability.ts#counterCostMentions) are read by "for each <kind> counter removed this way" only, never by "that many"
  const out: NumberSource[] = d.mentions.filter((m) => (m.sort === 'number' && !(m.verbs ?? []).some((v) => v.startsWith('cost:removed:'))) || m.origin === 'opaque').map((m) => ({ ref: m.ref, ...(m.origin === 'opaque' ? { opaque: true } : {}) }));
  const counted = sacrificedCount(d.condition);
  if (counted !== null) out.push({ ref: counted });
  return [...out, ...unitSources(seq, at, beforeStep, prefix)];
}

/**
 * FAST5X E22 (CR 603.4, 701.21a): the intervening "if" "you sacrificed one or more permanents this turn" counts what it is about, and "that much" after it
 * ("... this creature deals that much damage to any target", Sawblade Skinripper) is that count: the permanents you sacrificed this turn, read as the
 * ability resolves (CR 608.2h). Only this history: the count of the sacrifices themselves (one per permanent); a gain of life or any event with an amount
 * of its own is not offered here.
 */
export function sacrificedCount(c: Rec | undefined): Rec | null {
  if (!isRec(c) || c['cond'] !== 'happened' || c['scope'] !== 'turn' || c['by'] !== undefined) return null;
  const ev = c['event'];
  if (!isRec(ev) || ev['ev'] !== 'action' || ev['verb'] !== 'sacrifice' || ev['actor'] !== 'you' || Object.keys(ev).length !== 3) return null;
  return { q: 'happenedCount', event: clone(ev), scope: 'turn' };
}

/**
 * std-rx1 (CR 603.4, 608.2h): the intervening "if" "you control a prime number of lands" (Zimone, All-Questioning: "..., create Primo, ..., then put that many
 * +1/+1 counters on it") states a number, the count of those permanents, and "that many" after it is that count, read as the ability resolves. The condition
 * itself or one part of an "and" of conditions; two such counts are not one antecedent (design 6.4). Null for any other condition.
 */
export function primeCount(c: Rec | undefined): Rec | null {
  if (!isRec(c)) return null;
  if (c['cond'] === 'prime') return isRec(c['of']) ? clone(c['of'] as Rec) : null;
  if (c['cond'] !== 'all' || !Array.isArray(c['of'])) return null;
  const counts = (c['of'] as unknown[]).filter((x) => isRec(x) && x['cond'] === 'prime');
  return counts.length === 1 ? primeCount(counts[0] as Rec) : null;
}

function unitSources(seq: readonly Unit[], at: number, beforeStep: number, prefix: readonly Unit[]): NumberSource[] {
  const out: NumberSource[] = [];
  const units = [...prefix, ...seq.slice(0, at + 1)];
  for (const u of units) {
    if (u.manual) {
      if (u !== seq[at] && shieldShape(u.text) === null) out.push({ ref: {}, opaque: true });
      continue;
    }
    const all = stepsInOrder(u.steps);
    all.forEach(({ step, path }, k) => {
      if (u === seq[at] && Number(path.split('/')[1]) >= beforeStep) return;
      // r5-fxz (CR 701.25a, 701.22a): a surveil or a scry counts only for "card you put on top of your library" (`keptOnly`), never for "that many"
      if (step['op'] === 'surveil' || step['op'] === 'scry') { out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path }, keptOnly: true }); return; }
      // p2-c-dieroll-2 (CR 706.2, 608.2h; unverified cites): "Roll a six-sided die. If the result is 3 or less, you lose that much life.": the result of ONE die
      // rolled by you (no table: a table's rows read it themselves) is a number of its own; a second roll makes "that much" ambiguous (two candidates)
      if (step['op'] === 'rollDie') {
        const who = step['who'];
        if (step['table'] === undefined && (step['count'] === undefined || step['count'] === 1) && isRec(who) && who['ref'] === 'you' && Object.keys(who).length === 1) out.push({ ref: { q: 'dieResult' } });
        else out.push({ ref: {}, opaque: true });
        return;
      }
      if (typeof step['op'] !== 'string' || !COUNTED_OPS.has(step['op'])) return;
      // r4-fxz (CR 608.2c, 701.21a): "Sacrifice any number of permanents you control, then draw that many cards": a choice whose chosen objects the very next
      // instruction acts on (a counted one) is not a number of its own: "that many" is what that instruction did (the permanents sacrificed)
      const next = all[k + 1]?.step;
      // Merge wave 8 (audit D2, CR 701.9a): also "Discard any number of cards" (eff.c7.discard.anyNumber), whose discard acts on the chosen cards by its `filter.is`
      const chosen = step['op'] === 'chooseObjects' && typeof step['as'] === 'string' ? step['as'] : undefined;
      const actsOn = (x: unknown): boolean => isRec(x) && x['ref'] === 'bound' && x['name'] === chosen;
      if (chosen !== undefined && isRec(next) && typeof next['op'] === 'string' && COUNTED_OPS.has(next['op']) && (actsOn(next['what']) || (isRec(next['filter']) && actsOn(next['filter']['is'])))
        && (u !== seq[at] || Number(all[k + 1]!.path.split('/')[1]) < beforeStep)) return;
      out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path } });
    });
  }
  return out;
}

/**
 * FAST5 T41 (CR 608.2h): the result count of an earlier step whose amount IS another candidate is that same number, not a second one: in "you draw that many
 * cards and lose that much life" the second "that much" is the amount of the event (what "that many" already meant), and the cards drawn (the first step,
 * `count` = the amount of the event) are that same number. Only a candidate whose own amount is exactly another candidate's reference is dropped.
 */
function sameNumberOnce(srcs: NumberSource[]): NumberSource[] {
  return srcs.filter((s) => {
    if (!s.step) return true;
    const target = stepsInOrder(s.step.unit.steps).find((x) => x.path === s.step!.path)?.step;
    const amount = target?.['count'] ?? target?.['amount'];
    return !(isRec(amount) && srcs.some((o) => o !== s && !o.step && !o.opaque && JSON.stringify(amount) === JSON.stringify(o.ref)));
  });
}

/**
 * FAST5 T62 (CR 603.4): the quantity "the difference" stands for after the intervening "if" `condition`: the number it compares an amount with, minus that amount, for
 * "fewer than N" (`compare` with op `<`, a number on the right and your cards in a zone or your life on the left; r4-mech: or a statistic of one object). Null for any
 * other condition.
 */
export function differenceOf(condition: Rec | undefined): Rec | null {
  // pc-players-2 (CR 402.1, 119.1, 608.2h): "If that player has more cards in hand than you, draw cards equal to the difference": the bigger amount minus the smaller one
  // (`compare` with op `>`, the cards in a zone or the life of one player on each side)
  if (condition !== undefined && condition['cond'] === 'compare' && condition['op'] === '>' && isRec(condition['left']) && isRec(condition['right'])) {
    const [l, r] = [condition['left'], condition['right']];
    if (l['q'] === r['q'] && (l['q'] === 'zoneSize' || l['q'] === 'life') && l['zone'] === r['zone'] && isRec(l['of']) && isRec(r['of'])) return { q: 'math', op: '-', args: [clone(l), clone(r)] };
  }
  if (condition === undefined || condition['cond'] !== 'compare' || condition['op'] !== '<' || typeof condition['right'] !== 'number') return null;
  const left = condition['left'];
  // r4-mech (CR 608.2h, 202.3): also a statistic of one object ("If the discovered card's mana value is less than 10, create a number of ... equal to the difference")
  const stat = isRec(left) && left['q'] === 'stat' && isRec(left['of']);
  if (!isRec(left) || (!stat && ((left['q'] !== 'zoneSize' && left['q'] !== 'life') || !isRec(left['of']) || left['of']['ref'] !== 'you'))) return null;
  return { q: 'math', op: '-', args: [condition['right'], clone(left)] };
}

/**
 * FAST5 T78 (CR 118.12, 119.4, 608.2h): "You may pay life equal to its power. If you do, put that many +1/+1 counters on it." The "that many" of an "if you do" sentence
 * right after a payment of life is the life that was paid (the `let` variable the payment reads, template eff.t78.may.payLifeEqual.thatMany), not the amount of the
 * triggering event: it is the one candidate, so the amount of a triggering zone change or life change is not offered beside it. Null when the sentence is not that.
 */
function paidLifeAmount(seq: readonly Unit[], at: number, top: number, prefix: readonly Unit[], step: Rec): Rec | null {
  const cond = step['cond'];
  if (step['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['not'] === true) return null;
  const u = seq[at]!;
  let prev: Rec | undefined;
  if (top > 0) prev = u.steps[top - 1];
  else {
    const before = [...prefix, ...seq.slice(0, at)].filter((x) => x.manual !== undefined || x.steps.length > 0);
    const p = before[before.length - 1];
    if (p === undefined || p.manual) return null;
    prev = p.steps[p.steps.length - 1];
  }
  const parts = isRec(prev) && prev['op'] === 'pay' && isRec(prev['cost']) ? prev['cost']['other'] : undefined;
  if (!Array.isArray(parts) || parts.length !== 1 || !isRec(parts[0]) || parts[0]['kind'] !== 'payLife') return null;
  const amount = parts[0]['amount'];
  return isRec(amount) && amount['q'] === 'var' && typeof amount['name'] === 'string' ? clone(amount) : null;
}

/**
 * Cloud std-spm (CR 119.3, 608.2c): "If you lost life this way, draw that many cards": the "that many" of an `if` whose condition is the life one player lost this
 * way is that life (the condition's amount; lower/conditions.ts#resolveLifeLost names its step for this copy too). It is the one candidate, as the life paid of
 * `paidLifeAmount` is: the amount of a triggering event is not offered beside it. Null when the sentence is not that.
 */
function lostLifeAmount(step: Rec): Rec | null {
  const cond = step['cond'];
  if (step['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'compare' || cond['op'] !== '>' || cond['right'] !== 0) return null;
  const left = cond['left'];
  return isRec(left) && left['q'] === 'lifeLost' && left['who'] !== undefined ? clone(left) : null;
}

/**
 * std-rj (CR 119.3, 608.2h; Caustic Bronco): "You lose life equal to that card's mana value if this creature isn't saddled. Otherwise, each opponent loses that much life.":
 * the "that much" of the `else` of an `if` whose one instruction is a loss or gain of life of a computed amount is that amount (the one candidate: the number of cards an
 * earlier step moved is not what the text counts). Null when the step is not that.
 */
function elseSameLifeAmount(step: Rec): Rec | null {
  const then = step['then'];
  if (step['op'] !== 'if' || !Array.isArray(then) || then.length !== 1 || !isRec(then[0]) || (then[0]['op'] !== 'loseLife' && then[0]['op'] !== 'gainLife')) return null;
  const amount = then[0]['amount'];
  if (!isRec(amount) || typeof amount['q'] !== 'string' || amount['$anaphor'] !== undefined || ['X', 'var', 'eventAmount', 'resultCount'].includes(amount['q'])) return null;
  return JSON.stringify(amount).includes('$anaphor') ? null : clone(amount);
}

/**
 * Standard round 4, r4-refs (CR 601.2h, 608.2h): "If eight or more mana was spent to cast that spell, sacrifice ~ and it deals that much damage to each opponent":
 * the "that much" of an `if` whose condition compares the mana spent to cast a spell is that mana (the condition's amount), the one candidate, as the life lost of
 * `lostLifeAmount` is. Null when the sentence is not that.
 */
function spentManaAmount(step: Rec): Rec | null {
  const cond = step['cond'];
  if (step['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'compare' || (cond['op'] !== '>=' && cond['op'] !== '>')) return null;
  const left = cond['left'];
  return isRec(left) && left['q'] === 'spellManaSpent' ? clone(left) : null;
}

/**
 * Cloud C7 (CR 608.2c, 608.2h): "for each creature destroyed this way" / "the number of cards exiled this way" is a count of a description the Filter hole marked
 * `$moved` (parser/holes/moved-words.ts): the number anaphor of that kind of instruction, with the rest of the description as `which`, which resolveNumbers binds
 * to the ONE earlier instruction of that kind. Only a count of every such object (`{q:'count', of:{ref:'each', filter}}`) is rewritten; a marker anywhere else
 * stays and the sentence is manual (lower/normalize.ts).
 */
function movedCounts(v: unknown): unknown {
  return rewrite(v, (node) => {
    if (node['q'] !== 'count' || !isRec(node['of']) || node['of']['ref'] !== 'each' || !isRec(node['of']['filter'])) return undefined;
    const { [MOVED_MARK]: kind, ...which } = node['of']['filter'] as Rec;
    if (typeof kind !== 'string') return undefined;
    return { q: 'eventAmount', which, $anaphor: { sort: 'number', number: 'singular', participle: `moved:${kind}`, text: `${kind} this way` } };
  });
}

/** Cloud r3-moved: the kinds whose moved cards are read in the zone the instruction put them, unchanged by the move (a card's own characteristics, CR 400.7j, 109.2). */
const GROUP_ZONE: Readonly<Partial<Record<MovedKind, 'graveyard'>>> = { discarded: 'graveyard' };

/**
 * Cloud r3-moved (CR 608.2c, 608.2h, 400.7, 701.9a): what ONE earlier instruction moved, named as a set of objects and not counted: "the greatest mana value among
 * cards discarded this way", "for each card type among cards discarded this way", "Put up to one land card discarded this way onto the battlefield". Cloud C7's
 * marker (parser/holes/moved-words.ts) left on a description that is no count (movedCounts took those) names the cards that instruction bound by its `as`
 * (effects/handlers/cards-draw.ts#discardHandler binds the cards it discarded, where they went): the set itself when the description says nothing but "cards" (a
 * `stat` or a `distinct` reads it), else those of them that fit the rest of it and are still in the graveyard it put them in (`is` the binding: a card that left
 * is a new object, CR 400.7). Only a discard, whose cards keep their characteristics in the graveyard; the ONE earlier instruction of that kind, every earlier
 * sentence understood, as for a count (resolveNumbers). Anything else keeps the marker: the sentence is manual.
 */
function movedGroups(u: Unit, seq: readonly Unit[], at: number, d: Draft, prefix: readonly Unit[]): void {
  u.steps = (u.steps as unknown[]).map((top, i) => rewrite(top, (node) => {
    if (node['ref'] !== 'each' || !isRec(node['filter'])) return undefined;
    const { [MOVED_MARK]: kind, ...which } = node['filter'] as Rec;
    const zone = typeof kind === 'string' ? GROUP_ZONE[kind as MovedKind] : undefined;
    if (zone === undefined || which['zone'] !== undefined || which['is'] !== undefined || which['owner'] !== undefined) return undefined;
    const srcs = unitSources(seq, at, i, prefix).filter((x) => {
      if (x.opaque) return true;
      const step = x.step === undefined ? undefined : stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)?.step;
      return step !== undefined && movedBy(step, kind as MovedKind);
    });
    if (srcs.length !== 1 || srcs[0]!.opaque || srcs[0]!.step === undefined) return undefined;
    const target = stepsInOrder(srcs[0]!.step.unit.steps).find((y) => y.path === srcs[0]!.step!.path)!.step;
    if (typeof target['as'] !== 'string') target['as'] = freshName(d, String(target['op']));
    const bound = { ref: 'bound', name: target['as'] };
    const plain = Object.keys(which).every((k) => k === 'isCard') && which['isCard'] === true;
    return plain ? bound : { ref: 'each', filter: { ...which, is: bound, zone } };
  }) as Rec);
}

/** std-rq: a description of moved objects that says nothing but "card(s)" (`which` {} or `{isCard: true}`). */
const plainCards = (which: unknown): boolean => which === undefined || (isRec(which) && Object.entries(which).every(([k, v]) => k === 'isCard' && v === true));

/** std-rq (CR 603.2c, 603.10): the trigger is one discard event of one or more cards ("Whenever you discard one or more cards"), nothing else. */
function discardBatchTrigger(d: Draft): boolean {
  const on = d.trigger?.on ?? [];
  const ev = on[0] as Rec | undefined;
  return d.trigger?.batch === true && on.length === 1 && isRec(ev) && ev['ev'] === 'action' && ev['verb'] === 'discard' && Object.keys(ev).every((k) => k === 'ev' || k === 'verb' || k === 'actor');
}

/**
 * Cloud r3-moved (CR 602.2b, 601.2b, 601.2h, 608.2c, 608.2h): the count of what ONE part of the ability's cost moved (lower/ability.ts#costGroupMentions), when the
 * description counted says nothing the cost's own description does not ("cards exiled this way" after "Exile any number of cards from your graveyard", "creatures
 * sacrificed this way" after "sacrifice any number of creatures"): all of them, as the cost references read them (effects/refs.ts). Null for anything else.
 */
function costCount(d: Draft, kind: string, which: unknown): Rec | null {
  const found = d.mentions.filter((m) => m.costPart?.kind === kind);
  const m = found[0];
  if (found.length !== 1 || m === undefined || !isRec(which)) return null;
  const own = m.costPart!.filter as Rec;
  const implied = Object.entries(which).every(([k, v]) => (k === 'isCard' && v === true && kind !== 'sacrificed') || JSON.stringify(own[k]) === JSON.stringify(v));
  return implied ? { q: 'count', of: { ...m.ref } } : null;
}

/**
 * std-ra (CR 603.12, 608.2c): a plain "that many" in the instructions of a reflexive step whose `when` is a condition on what the instruction right before moved
 * (parser/holes/moved.ts: `did` with `which` and the kind's `$op` or `to`): the participle of that kind and the description, so resolveNumbers counts those
 * objects of the ONE earlier instruction of that kind. Null anywhere else.
 */
function movedReflexive(step: Rec, path: string, node: Rec): { participle: string; kind: MovedKind; which: Rec } | null {
  const a = node['$anaphor'] as Rec;
  if (step['op'] !== 'reflexive' || !path.startsWith('/do/') || a['text'] !== 'that many' || a['participle'] !== undefined) return null;
  const when = step['when'];
  if (!isRec(when) || when['cond'] !== 'did' || when['not'] === true || !isRec(when['which'])) return null;
  const op = when['$op'];
  const to = when['to'];
  const kind = op === 'discard' ? 'discarded' : op === 'sacrifice' ? 'sacrificed' : op === undefined ? (Object.entries(MOVED_TO).find(([, z]) => z === to)?.[0]) : undefined;
  return kind === undefined ? null : { participle: `moved:${kind}`, kind: kind as MovedKind, which: when['which'] };
}

/**
 * trek-8 (CR 603.7, 603.2c, 608.2h): "that many" / "that much" inside the instructions of an event-timed delayed trigger ("Whenever it deals combat damage to a
 * player this turn, you draw that many cards", The Inner Light) is the amount of the event that triggers it (damage dealt), read as the delayed trigger resolves
 * (`{q:'eventAmount'}`, the delayed trigger keeps its event, effects/handlers/lasting.ts#delay): what the sentences before it did happened in another resolution,
 * so none of their numbers is a candidate (resolveNumbers uses this only when no candidate exists). Undefined when `step` is no such delay, the instruction is not
 * in its `do`, the phrase is a participle one ("cards discarded this way") or the unit is a batch trigger ("one or more": the amount is the whole batch's); null
 * when the delayed event has no amount.
 */
function delayedEventAmount(step: Rec, path: string, anaphor: Rec, u: Unit): Rec | null | undefined {
  // (only in the first instruction of the delayed trigger: after "..., mill three cards, then draw that many cards" the number is what an instruction of the trigger made)
  if (step['op'] !== 'delay' || !/^\/do\/0(\/|$)/.test(path) || anaphor['participle'] !== undefined || u.flags.includes('batch')) return undefined;
  const when = step['when'];
  if (!isRec(when) || when['at'] !== 'event' || !isRec(when['event'])) return undefined;
  return patternsHaveAmount([when['event'] as unknown as EventPattern]) ? { q: 'eventAmount' } : null;
}

function resolveNumbers(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): boolean {
  let ok = true;
  let failure = '';
  // rewritten in place, in order: a name given to an earlier step of the SAME sentence lands on the step that is kept (CR 608.2c)
  u.steps = (u.steps as unknown[]).map(movedCounts) as Rec[]; // Cloud C7
  movedGroups(u, seq, at, d, prefix); // Cloud r3-moved: what is left of the marker after the counts
  const steps = u.steps;
  for (let i = 0; i < steps.length && ok; i++) {
    steps[i] = rewrite(steps[i], (node, path) => {
      if (!ok || !isRec(node['$anaphor']) || (node['$anaphor'] as Rec)['sort'] !== 'number') return undefined;
      // FAST5 T62 (CR 603.4, 608.2h): "the difference" of "if you have fewer than four cards in hand, draw cards equal to the difference": four minus the cards in
      // hand, read as the effect resolves; it names the intervening "if" of this ability, so without one of that shape the sentence is manual
      if ((node['$anaphor'] as Rec)['text'] === 'the difference') {
        // std-blb (CR 608.2c, 608.2h): or the condition of the `if` step whose branch it is in ("Then if you have fewer than three cards in hand, draw cards
        // equal to the difference"); when both an intervening "if" and that step's condition have the shape, the reference is not unique (design 6.4). (Cloud std-fin
        // wrote the same reading of the step's own condition; merged into this one.)
        const own = steps[i]!['op'] === 'if' && isRec(steps[i]!['cond']) && path.startsWith('/then/') ? differenceOf(steps[i]!['cond'] as Rec) : null;
        const trig = differenceOf(d.condition);
        const diff = own !== null && trig !== null ? null : (own ?? trig);
        if (diff === null) { ok = false; failure = '"the difference" needs an intervening "if" that compares an amount with a number (CR 603.4)'; return undefined; }
        return diff;
      }
      const paidLife = paidLifeAmount(seq, at, i, prefix, steps[i]!);
      const lostLife = lostLifeAmount(steps[i]!);
      const spent = path.startsWith('/then/') ? spentManaAmount(steps[i]!) : null; // r4-refs
      const sameLife = path.startsWith('/else/') ? elseSameLifeAmount(steps[i]!) : null; // std-rj
      const primed = primeCount(d.condition); // std-rx1: the number an intervening "if" states is the one candidate
      const all = paidLife !== null ? [{ ref: paidLife }] : lostLife !== null ? [{ ref: lostLife }] : spent !== null ? [{ ref: spent }] : primed !== null ? [{ ref: primed }] : sameLife !== null ? [{ ref: sameLife }]
        : sameNumberOnce(numberSources(d, seq, at, i, prefix));
      // FAST5X E16 (CR 120.10, 608.2c): "If <that creature> is dealt excess damage this way, add that much {R}": the excess amount the `if` asks about is a
      // number of the sentence too (lower/conditions.ts names its step later)
      const c = steps[i]!['op'] === 'if' && isRec(steps[i]!['cond']) ? (steps[i]!['cond'] as Rec) : undefined;
      if (c !== undefined && c['cond'] === 'compare' && isRec(c['left']) && (c['left'] as Rec)['q'] === 'excessDamage') all.push({ ref: c['left'] as Rec });
      // FAST5X E15: "the number of cards drawn this way" counts what a step of that verb did, nothing else (an opaque source stays: it may be one)
      // std-ra (CR 603.12, 608.2c, 608.2h): inside a reflexive trigger that waits for what the instruction right before moved ("When you discard one or more nonland
      // cards this way, tap up to that many target creatures"), "that many" is how many of those objects it moved: the count of `which` of that ONE instruction,
      // read as each last existed (not every card it moved: a land discarded with them is not counted)
      const reflexiveMoved = movedReflexive(steps[i]!, path, node);
      const participle = reflexiveMoved?.participle ?? (node['$anaphor'] as Rec)['participle'];
      const head = (node['$anaphor'] as Rec)['head'];
      const kept = participle === 'moved:top';
      const srcs0 = all.filter((s) => kept || s.keptOnly !== true).filter((s) => {
        if (typeof participle !== 'string') return true;
        if (s.opaque) return true;
        if (!s.step) return false;
        const step = stepsInOrder(s.step.unit.steps).find((x) => x.path === s.step!.path)?.step;
        const op = step?.['op'];
        // Cloud std-fin: "the number of cards shuffled into your library this way" counts a move into a library (shuffled after it)
        if (participle === 'shuffled') return op === 'move' && isRec(step?.['to']) && (step['to'] as Rec)['zone'] === 'library';
        // p2-coinflip-2 (CR 705.2): "for each flip you won" counts the wins of a flip whose flips are called: only "flip a coin until you lose a flip" (its count is the
        // flips won; a plain flip of several coins counts the coins that came up heads, r4-mech)
        if (participle === 'flippedWon') return op === 'flipCoin' && step?.['untilLose'] === true;
        // p2-coinflip-3 (CR 705.2): "for each flip you win" counts the wins of a flip of several coins by you, with no instructions of its own (it becomes called below)
        if (participle === 'flippedWin') return op === 'flipCoin' && typeof step?.['count'] === 'number' && step['untilLose'] === undefined && step['onWin'] === undefined && step['onLose'] === undefined && isRec(step['who']) && (step['who'] as Rec)['ref'] === 'you';
        // Cloud C7 (CR 608.2c, 608.2h): "for each creature destroyed this way" counts what ONE earlier instruction of that kind moved (parser/holes/moved.ts)
        if (participle.startsWith('moved:')) return step !== undefined && movedBy(step, participle.slice('moved:'.length) as MovedKind) && fromZoneFits(step, node['which'], d, s.step.unit.steps);
        // std-tdm: a "destroyed this way" count also needs a noun that fits the destroy step (destroyedNounFits)
        return typeof op === 'string' && PARTICIPLE_OF_OP[op] === participle && (participle !== 'destroyed' || destroyedNounFits(step!, head, d));
      });
      const text = String((node['$anaphor'] as Rec)['text']);
      // p2-zone-moves-1 (CR 701.9a, 608.2c): "that player discards all the cards in their hand, then draws that many cards" (Shocker) after a trigger with an amount of
      // its own (the damage): the "then" instruction right after a discard of the whole hand, in the same sentence, can only count the cards that discard discarded
      const wheel = srcs0.length > 1 && !srcs0.some((x) => x.opaque) && text === 'that many' && i > 0 && steps[i]!['op'] === 'draw' && steps[i - 1]!['op'] === 'discard'
        && steps[i - 1]!['count'] === 'hand' && JSON.stringify(steps[i - 1]!['who']) === JSON.stringify(steps[i]!['who'])
        ? srcs0.filter((x) => x.step?.unit === u && x.step.path === `/${i - 1}`) : [];
      const srcs = wheel.length === 1 ? wheel : srcs0;
      // Cloud r3-moved (CR 602.2b, 601.2h, 608.2c): no instruction of the ability is of that kind, but its cost is: "{T}, Exile any number of cards from your graveyard:
      // ... where X is the number of cards exiled this way" counts what the cost moved (Cloud C8's cost references)
      if (srcs.length === 0 && typeof participle === 'string' && participle.startsWith('moved:')) {
        const cost = costCount(d, participle.slice('moved:'.length), node['which']);
        if (cost !== null) return cost;
        // std-rq (CR 603.2c, 603.10, 608.2c): no instruction of the ability discards, but it triggers on a discard of one or more cards ("Whenever you discard one or
        // more cards, target creature gets +2/+0 until end of turn for each card discarded this way"): "this way" is the triggering discard, its amount the cards
        // discarded (as "that many" reads it, eventAmount). Only every card of it: a narrower description ("nonland card discarded this way") is not that amount.
        if (participle === 'moved:discarded' && plainCards(node['which']) && discardBatchTrigger(d) && all.some((s) => !s.step && !s.opaque && isRec(s.ref) && s.ref['q'] === 'eventAmount')) return { q: 'eventAmount' };
      }
      // trek-8 (CR 603.7, 603.2c, 608.2h): in the instructions of an event-timed delayed trigger, when nothing before supplies a number ("Whenever it deals combat
      // damage to a player this turn, you draw that many cards"), the number is the delayed trigger's own event's amount (read as it resolves). A candidate that
      // exists is never overridden (G10: every reading that parsed before is the same).
      if (srcs.length === 0) {
        const delayed = delayedEventAmount(steps[i]!, path, node['$anaphor'] as Rec, u);
        if (delayed !== undefined && delayed !== null) return delayed;
      }
      if (srcs.length !== 1 || srcs[0]!.opaque) {
        ok = false;
        failure = srcs.some((x) => x.opaque) ? `"${text}" may count something a part that is not understood produced (design 6.4)` : `"${text}" has ${srcs.length === 0 ? 'no' : srcs.length} candidate amounts (design 6.4)`;
        return undefined;
      }
      const src = srcs[0]!;
      if (!src.step) return clone(src.ref);
      const target = stepsInOrder(src.step.unit.steps).find((x) => x.path === src.step!.path)!.step;
      if (typeof target['as'] !== 'string') target['as'] = freshName(d, String(target['op']));
      if (participle === 'flippedWin') target['called'] = true; // p2-coinflip-3 (CR 705.2): its flips are called, so they are won or lost; its count is the flips won
      // Cloud C7: the description of the moved objects counted (`which`, read as each last existed: effects/eval.ts)
      const which = reflexiveMoved?.which ?? node['which'];
      return { q: 'resultCount', step: target['as'], ...(isRec(which) ? { which: clone(which) } : {}) };
    }) as Rec;
  }
  if (!ok) setManual(u, { code: 'unbound-reference', reason: failure, unresolved: true });
  return ok;
}

/**
 * r5-fxz (CR 701.9a, 608.2c): "for each of those opponents who didn't discard a card with mana value 4 or greater": the `didNot` of a player count names the ONE earlier
 * discard of the ability (`step: ''` from the template, parser/templates/zz-cloud/r5-fxz.json); none, two, or an earlier part that is not understood (it may be
 * one) and the sentence is manual.
 */
function resolveDidNot(u: Unit, seq: readonly Unit[], at: number, prefix: readonly Unit[], d: Draft): void {
  let failure: string | null = null;
  u.steps = u.steps.map((step, i) => rewrite(step, (node) => {
    const dn = node['didNot'];
    if (node['q'] !== 'countPlayers' || !isRec(dn) || dn['step'] !== '') return undefined;
    const found: Rec[] = [];
    let opaque = false;
    for (const v of [...prefix, ...seq.slice(0, at + 1)]) {
      if (v.manual) { if (v !== u) opaque = true; continue; }
      for (const { step: x, path } of stepsInOrder(v.steps)) {
        if (v === u && Number(path.split('/')[1]) >= i) continue;
        if (x['op'] === dn['op']) found.push(x);
      }
    }
    if (opaque || found.length !== 1) { failure = `"who didn't ${String(dn['op'])}" names ${opaque ? 'something a part that is not understood may do' : found.length === 0 ? 'no earlier instruction' : 'several earlier instructions'} (design 6.4)`; return undefined; }
    const target = found[0]!;
    if (typeof target['as'] !== 'string') target['as'] = freshName(d, String(target['op']));
    return { ...node, didNot: { ...dn, step: target['as'] } };
  }) as Rec);
  if (failure !== null) setManual(u, { code: 'unbound-reference', reason: failure, unresolved: true });
}

/**
 * Merge wave 8 (audit D2, CR 601.2c, 603.3d, 603.12, 608.2c): the number anaphor of a target spec of this sentence ("up to that many target creatures",
 * parser/holes/target.ts), by the unique-candidate rule of design 6.4 over the numbers known as the targets are chosen. The ability's own targets are chosen as
 * it is put on the stack, before any of its instructions did anything (CR 601.2c, 603.3d): the numbers that are not the result of one of its steps (the
 * triggering event's amount: the life gained, the damage dealt). A target of a reflexive trigger (the `reflexive` step of this sentence that names it) is
 * chosen as that trigger is put on the stack, after the instructions before it (CR 603.12): their result counts are numbers too ("you may discard any number
 * of cards. When you do, up to that many target creatures ..." is the cards discarded). No candidate or several: the sentence is manual.
 */
function resolveTargetNumbers(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): void {
  for (const id of u.targetIds ?? []) {
    const k = d.targets.findIndex((t) => t.id === id);
    if (u.manual || k < 0 || !JSON.stringify(d.targets[k]).includes('"$anaphor"')) continue;
    const refl = u.steps.findIndex((st) => st['op'] === 'reflexive' && JSON.stringify(st['do'] ?? null).includes(`"id":${JSON.stringify(id)}`));
    let failure = '';
    const spec = rewrite(d.targets[k], (node) => {
      if (failure !== '' || !isRec(node['$anaphor']) || (node['$anaphor'] as Rec)['sort'] !== 'number') return undefined;
      const text = String((node['$anaphor'] as Rec)['text']);
      // std-ra (CR 603.12, 608.2c): a reflexive trigger that waits for what the instruction right before moved ("When you discard one or more nonland cards this
      // way, tap up to that many target creatures"): that many of those objects, of the ONE earlier instruction of that kind (movedReflexive)
      const moved = refl >= 0 ? movedReflexive(u.steps[refl]!, '/do/', node) : null;
      const all = refl >= 0 ? sameNumberOnce(numberSources(d, seq, at, refl, prefix)) : numberSources(d, seq, at, 0, prefix).filter((x) => x.step === undefined);
      const srcs = moved === null ? all : all.filter((x) => {
        if (x.opaque) return true;
        const step = x.step === undefined ? undefined : stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)?.step;
        return step !== undefined && movedBy(step, moved.kind);
      });
      if (srcs.length !== 1 || srcs[0]!.opaque) {
        failure = srcs.some((x) => x.opaque) ? `"${text}" may count something a part that is not understood produced (design 6.4)` : `"${text}" has ${srcs.length === 0 ? 'no' : srcs.length} candidate amounts (design 6.4)`;
        return undefined;
      }
      const src = srcs[0]!;
      if (!src.step) return clone(src.ref);
      const target = stepsInOrder(src.step.unit.steps).find((x) => x.path === src.step!.path)!.step;
      if (typeof target['as'] !== 'string') target['as'] = freshName(d, String(target['op']));
      return { q: 'resultCount', step: target['as'], ...(moved !== null ? { which: clone(moved.which) } : {}) };
    });
    if (failure !== '') { setManual(u, { code: 'unbound-reference', reason: failure, unresolved: true }); return; }
    d.targets[k] = spec as (typeof d.targets)[number];
  }
}

/** Pass 5. */
export function lowerQuantities(input: Draft): Draft {
  const d = cloneDraft(input);
  sequences(d).forEach((seq, si) => {
    const prefix = si === 0 ? [] : d.units;
    let carried: unknown; // r3-cost: the X the sentence before defined ("where X is ...")
    seq.forEach((u, i) => {
      if (u.manual) { carried = undefined; return; }
      const values: unknown[] = [];
      const expanded = expandWhereX(u.steps, values);
      if (expanded === null) { setManual(u, { code: 'lint', reason: 'malformed "where X is" clause' }); return; }
      // r3-cost (CR 107.3, 608.2h): "Exile the top X cards of their library, where X is the amount of damage dealt. You may cast any number of spells with mana value
      // X or less from among them ..." (Kotis, the Fangkeeper): the X the sentence right before defined is the X of a sentence that defines none of its own
      u.steps = values.length === 0 && carried !== undefined && JSON.stringify(expanded).includes('{"q":"X"}') ? substituteX(expanded, carried) as Rec[] : expanded;
      carried = values.length === 1 ? values[0] : undefined;
      // FAST5 T42 (CR 107.3, 608.2h): the X of "return target card with mana value X or less ..., where X is the amount of mana spent to cast ~" is in the filter of the
      // target spec lowered from this very sentence; "where X is" defines it there too (the sentence's one X, so only when the sentence defines one value)
      if (values.length === 1) {
        for (const id of u.targetIds ?? []) {
          const at = d.targets.findIndex((t) => t.id === id);
          if (at >= 0) d.targets[at] = substituteX(d.targets[at], values[0]) as (typeof d.targets)[number];
        }
      }
      if (resolveNumbers(u, seq, i, d, prefix)) resolveTargetNumbers(u, seq, i, d, prefix);
      if (!u.manual) resolveDidNot(u, seq, i, prefix, d); // r5-fxz
      if (!u.manual) u.steps = selfDamageHistory(u.steps, d) as Rec[];
      if (!u.manual && unansweredDamageHistory(u.steps)) setManual(u, { code: 'needs-engine', reason: 'the damage dealt this turn to an object other than the source has no answer in the history (CR 400.7)' });
      if (!u.manual) u.steps = groupDrawsOwnDiscards(u.steps); // p2-zone-moves-1
    });
  });
  return d;
}

/**
 * p2-zone-moves-1 (CR 701.9a, 121.2, 608.2e): "Each player discards their hand, then draws that many cards" (Windfall's family, Whirlpool Whelm style wheels): the
 * same group of players discards, then draws; "that many" of each drawing player is the number of cards THAT player discarded, not the group's total. A draw by a
 * group whose count is the result of a discard by the same group, earlier in the same sentence's steps, reads the discarded cards that player owned (a player
 * discards only cards they own, CR 701.9a; `{ref:'iterating'}` is the drawing player, effects/handlers/cards-draw.ts#drawHandler). Nothing else is changed.
 */
function groupDrawsOwnDiscards(steps: Rec[]): Rec[] {
  const discards = new Map<string, string>();
  return steps.map((step) => {
    const who = step['who'];
    if (step['op'] === 'discard' && typeof step['as'] === 'string' && isRec(who) && who['ref'] === 'each') discards.set(step['as'], JSON.stringify(who));
    if (step['op'] !== 'draw' || !isRec(who) || who['ref'] !== 'each' || !isRec(step['count'])) return step;
    // (also inside a computed count, "that many cards minus one"; never the greatest count of any one player, `maxPerOwner`, which is the same for every player)
    const count = rewrite(step['count'], (node) => (node['q'] === 'resultCount' && node['which'] === undefined && node['maxPerOwner'] === undefined
      && discards.get(String(node['step'])) === JSON.stringify(who) ? { ...node, which: { owner: { ref: 'iterating' } } } : undefined));
    return { ...step, count };
  });
}

/**
 * std-rx29 (CR 603.6c, 603.10a, 400.7; Tangled Colony): in a trigger on the object's own zone change ("When this creature dies, ... the amount of damage dealt to it
 * this turn"), the object of the event is the source itself, so a history question about it (`happenedCount` of damage to it, parser/holes/qty.ts) asks about the
 * source, which the history answers by either id of the object (rules/history.ts#factsMatchFilter); about another event object the history has no answer (the card
 * stays manual, unansweredDamageHistory below).
 */
function selfDamageHistory(steps: unknown, d: Draft): unknown {
  const on = d.trigger?.on ?? [];
  if (on.length === 0 || !on.every((ev) => ev.ev === 'zoneChange' && JSON.stringify(ev.subject) === '{"self":true}')) return steps;
  return rewrite(steps, (node) => {
    if (node['q'] !== 'happenedCount' || !isRec(node['event']) || node['event']['ev'] !== 'damage') return undefined;
    const r = node['event']['recipient'];
    const o = isRec(r) && isRec(r['object']) ? r['object'] : undefined;
    if (o === undefined || JSON.stringify(o) !== '{"is":{"ref":"event","role":"subject"}}') return undefined;
    return { ...clone(node), event: { ...clone(node['event']), recipient: { object: { is: { ref: 'self' } } } } };
  });
}

/**
 * std-rx29 (CR 400.7, 603.10a): a history question about the damage dealt to an object the history cannot name: anything but the source or a fixed object
 * (rules/history.ts#isAnswerableIs), such as the creature of another creature's dies trigger, a new object whose damage was dealt to the permanent it was. The
 * capability walker never sees it (rules/history.ts#historyPatternForms reads no quantity), so the sentence is manual here.
 */
function unansweredDamageHistory(steps: unknown): boolean {
  let found = false;
  visit(steps, (node) => {
    if (node['q'] !== 'happenedCount' || !isRec(node['event']) || node['event']['ev'] !== 'damage') return;
    const r = node['event']['recipient'];
    const is = isRec(r) && isRec(r['object']) ? r['object']['is'] : undefined;
    if (isRec(is) && !((is['ref'] === 'self' && Object.keys(is).length === 1) || (is['ref'] === 'fixed' && 'objects' in is))) found = true;
  });
  return found;
}
