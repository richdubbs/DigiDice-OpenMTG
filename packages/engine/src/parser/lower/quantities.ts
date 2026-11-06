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
function expandWhereX(steps: Rec[], values: unknown[] = [], flags?: { announced?: boolean }): Rec[] | null {
  const out: Rec[] = [];
  for (const s of steps) {
    if (s['lower'] === 'whereX') {
      if (!Array.isArray(s['steps']) || s['value'] === undefined) return null;
      values.push(s['value']);
      if (s['announced'] === true) {
        // edh-next-39 (CR 602.2b, 601.2c, 608.2h): X may be only the number of targets; an X inside an instruction would be read as it resolves (review fix: checked before X is replaced)
        if (JSON.stringify(s['steps']).includes('"q":"X"')) return null;
        if (flags !== undefined) flags.announced = true;
      }
      const inner = expandWhereX(s['steps'] as Rec[]);
      if (inner === null) return null;
      out.push(...(substituteX(inner, s['value']) as Rec[]));
    } else {
      const nested = expandNested(s, values, flags);
      if (nested === null) return null;
      out.push(nested);
    }
  }
  return out;
}

/** edh-next-124: the value of the one "where X is" clause of a step list that is one reflexive trigger (`do` holding exactly one `whereX` node, at its top level); undefined otherwise. */
function reflexiveWhereX(steps: readonly Rec[]): unknown {
  const only = steps.length === 1 ? steps[0] : undefined;
  if (!isRec(only) || only['op'] !== 'reflexive' || !Array.isArray(only['do'])) return undefined;
  const clauses = (only['do'] as unknown[]).filter((x) => isRec(x) && x['lower'] === 'whereX') as Rec[];
  if (clauses.length !== 1 || JSON.stringify(only['do']).split('"lower":"whereX"').length !== 2) return undefined;
  return clauses[0]!['value'];
}

/** A step with the `whereX` nodes of its nested step lists expanded (the step itself when it has none). */
function expandNested(step: Rec, values?: unknown[], flags?: { announced?: boolean }): Rec | null {
  let changed = false;
  const out: Rec = {};
  for (const [k, v] of Object.entries(step)) {
    if (Array.isArray(v) && v.some((x) => isRec(x) && x['lower'] === 'whereX')) {
      // edhn115 (CR 608.2d, 107.3, 608.2h; Venerable Warsinger): "you may return target ... mana value X or less ..., where X is ...": the clause of a "may" step's own instructions defines
      // the X of the targets lowered from this sentence too, so its value is collected as the sentence's own (only for the `do` of a `may`, never another nested list)
      const own = step['op'] === 'may' && k === 'do';
      const e = expandWhereX(v as Rec[], own ? values : undefined, own ? flags : undefined);
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

interface NumberSource { ref: Rec; step?: { unit: Unit; path: string }; opaque?: boolean; keptOnly?: true; revealOnly?: true; tappedOnly?: true; goadedOnly?: true; lifeLostBy?: Rec }

/** FAST5X E15: the participle a "<things> <participle> this way" count names its step by (parser/holes/qty.ts). std-tdm: "destroyed this way". */
const PARTICIPLE_OF_OP: Readonly<Record<string, string>> = { draw: 'drawn', destroy: 'destroyed', counter: 'countered', flipCoin: 'flipped', pay: 'paid', reveal: 'revealed', revealUntil: 'revealed', phaseOut: 'phased', tap: 'tapped' }; // edh-d-39: phaseOut // r4-moved: counter; std-rx30: flipCoin; edh-top-6: pay (join forces)

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
 * edh-next-94 (CR 701.26a, 608.2c; Angel's Trumpet, Guild Summit): the noun of a "tapped this way" count (parser/holes/edhn94.ts) names everything its tap step can tap: the one card type
 * (or the one subtype) the step's description requires, whether the step names a described set, a target, or the set an earlier step of the ability bound by name ("choose any number of
 * untapped Gates, then tap them"). A noun the description does not require (a count of a part of what was tapped) has no candidate: the sentence stays manual.
 */
function tappedNounFits(step: Rec, head: unknown, d: Draft, unitSteps: readonly Rec[]): boolean {
  if (typeof head !== 'string') return false;
  const namesHead = (f0: unknown): boolean => {
    const one = isRec(f0) && Array.isArray(f0['anyOf']) && f0['anyOf'].length === 1 ? f0['anyOf'][0] : undefined;
    const f = one !== undefined ? one : f0;
    if (!isRec(f) || f['anyOf'] !== undefined || (one !== undefined && (f0 as Rec)['types'] !== undefined)) return false;
    const types = f['types'];
    const subs = f['subtypes'];
    return (Array.isArray(types) && types.length === 1 && String(types[0]).toLowerCase() === head) || (Array.isArray(subs) && subs.length === 1 && String(subs[0]).toLowerCase() === head);
  };
  const filterOf = (what: unknown, depth: number): unknown => {
    if (!isRec(what) || depth > 3) return undefined;
    if (what['ref'] === 'each') return what['filter'];
    if (what['ref'] === 'target') return d.targets.find((t) => t.id === what['id'])?.filter;
    if (what['ref'] === 'bound' && typeof what['name'] === 'string') {
      const makers = stepsInOrder(unitSteps as Rec[]).filter((x) => x.step['as'] === what['name'] && x.step !== step);
      if (makers.length !== 1) return undefined;
      const m = makers[0]!.step;
      return m['op'] === 'chooseObjects' ? m['from'] !== undefined && isRec(m['from']) && m['from']['ref'] === 'each' ? m['from']['filter'] : undefined : filterOf(m['what'], depth + 1);
    }
    return undefined;
  };
  return namesHead(filterOf(step['what'], 0));
}

/**
 * edh-d-39 (CR 702.26b, 608.2c; Out of Time): the noun of a "that phased out this way" count names everything its phase-out step can phase out: "permanent" always, a card type
 * only when the step phases out objects of that one type (a described set, a target, or the set an earlier step of the ability bound by name, "untap all creatures, then those
 * creatures phase out"). Anything else leaves the sentence manual (a narrower noun would count a part of the result).
 */
function phasedNounFits(step: Rec, head: unknown, d: Draft, unitSteps: readonly Rec[]): boolean {
  if (head === 'permanent') return true;
  if (typeof head !== 'string') return false;
  const typesOf = (what: unknown, depth: number): unknown => {
    if (!isRec(what) || depth > 3) return undefined;
    if (what['ref'] === 'each') return isRec(what['filter']) && what['filter']['anyOf'] === undefined ? what['filter']['types'] : undefined;
    if (what['ref'] === 'target') { const f = d.targets.find((t) => t.id === what['id'])?.filter; return isRec(f) && f['anyOf'] === undefined ? f['types'] : undefined; }
    if (what['ref'] === 'bound' && typeof what['name'] === 'string') {
      const makers = stepsInOrder(unitSteps as Rec[]).filter((x) => x.step['as'] === what['name'] && x.step !== step);
      return makers.length === 1 ? typesOf(makers[0]!.step['what'], depth + 1) : undefined;
    }
    return undefined;
  };
  const types = typesOf(step['what'], 0);
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
 * edh-players-23 (review): the instruction of a number source varies in how many it does ("any number", "one or more", "all", the whole hand), so "that many" after it is a number worth naming; a fixed
 * count ("a Food") is never counted with "that many" in printed text.
 */
function variesStep(at: { unit: Unit; path: string }): boolean {
  const top = at.unit.steps[Number(at.path.split('/')[1])];
  const text = JSON.stringify(top ?? {});
  return /"max":"any"|"count":"(hand|all|any)"/.test(text);
}

/**
 * The numbers available before step `beforeStep` of `seq[at]`. A sentence that is not understood (an E1 shield aside) and a trigger clause that is not
 * understood may have produced a number too: they are opaque sources, so "that many" after them never resolves (design 6.4).
 */
function numberSources(d: Draft, seq: readonly Unit[], at: number, beforeStep: number, prefix: readonly Unit[], nodePath?: string, lifeFallback = false, withTapped = false): NumberSource[] {
  // p2-mana-1: the counters a cost removed (lower/ability.ts#counterCostMentions) are read by "for each <kind> counter removed this way" only, never by "that many"
  const out: NumberSource[] = d.mentions.filter((m) => (m.sort === 'number' && !(m.verbs ?? []).some((v) => v.startsWith('cost:removed:'))) || m.origin === 'opaque').map((m) => ({ ref: m.ref, ...(m.origin === 'opaque' ? { opaque: true } : {}) }));
  const counted = sacrificedCount(d.condition);
  if (counted !== null) out.push({ ref: counted });
  const real = unitSources(seq, at, beforeStep, prefix, nodePath);
  const plain = [...out, ...real.filter((x) => x.tappedOnly !== true && x.goadedOnly !== true)];
  const found = withTapped ? [...out, ...real] : plain; // edh-next-94: a tap step counts only for "tapped this way" (withTapped), and never stops the life-lost fallback
  if (plain.length > 0 || !lifeFallback) return found;
  const lost = lifeLostSources(d, seq, at, beforeStep, prefix);
  return lost.length > 0 ? lost : found;
}

/**
 * edh-next-15 (CR 119.3, 608.2h; Foul-Tongue Shriek): "Target opponent loses 1 life for each attacking creature you control. You gain that much life.": when nothing else is a number
 * the sentence could mean, "that much" is the life the player of that earlier loss of life lost (`{q:'lifeLost', who}`, the life actually lost). Only when it is the one number there
 * is (a unit that already read "that much" some other way keeps that reading) and only for one loss of life.
 */
function lifeLostSources(d: Draft, seq: readonly Unit[], at: number, beforeStep: number, prefix: readonly Unit[]): NumberSource[] {
  const losses: NumberSource[] = [];
  for (const u of [...prefix, ...seq.slice(0, at + 1)]) {
    if (u.manual) return [];
    for (const { step, path } of stepsInOrder(u.steps)) {
      if (u === seq[at] && Number(path.split('/')[1]) >= beforeStep) continue;
      const who = step['who'];
      if (step['op'] === 'loseLife' && isRec(who) && (who['ref'] === 'you' || (who['ref'] === 'target' && d.targets.find((t) => t.id === who['id'])?.max === 1))) losses.push({ ref: {}, step: { unit: u, path }, lifeLostBy: clone(step['who'] as Rec) });
    }
  }
  return losses.length === 1 ? losses : [];
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
  // edh-d-93 (CR 603.4, 700.4, 608.2h; Feast of the Victorious Dead): "if one or more creatures died this turn, you gain that much life": the creatures put into a graveyard from the battlefield
  // this turn (one event each, tokens included), counted as the ability resolves (the ruling: creatures that die in response count too). Only a subject of card types alone and "one or more".
  const times = c['times'];
  const sub = isRec(ev) ? ev['subject'] : undefined;
  if (isRec(ev) && ev['ev'] === 'zoneChange' && ev['from'] === 'battlefield' && ev['to'] === 'graveyard' && Object.keys(ev).length === 4 && isRec(sub) && Object.keys(sub).length === 1 && Array.isArray(sub['types'])
    && (times === undefined || (isRec(times) && times['op'] === '>=' && times['value'] === 1))) return { q: 'happenedCount', event: clone(ev), scope: 'turn' };
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

/**
 * edh-next-138 (CR 603.4, 608.2h; Desert Warfare): the intervening "if you control five or more Deserts" states a number, the count of those permanents (`exists` with `atLeast`, the words
 * "N or more"), and "that many" after it ("create that many 1/1 ... tokens") is that count, read as the ability resolves. The condition itself or one part of an "and"; two are not one antecedent.
 */
export function atLeastCount(c: Rec | undefined): Rec | null {
  if (!isRec(c)) return null;
  if (c['cond'] === 'exists') {
    const of = c['of'];
    return typeof c['atLeast'] === 'number' && c['atLeast'] >= 2 && isRec(of) && of['ref'] === 'each' && isRec(of['filter']) && Object.keys(c).length === 3 ? { q: 'count', of: clone(of) } : null;
  }
  if (c['cond'] !== 'all' || !Array.isArray(c['of'])) return null;
  const parts = (c['of'] as unknown[]).filter((x) => atLeastCount(x as Rec) !== null);
  return parts.length === 1 ? atLeastCount(parts[0] as Rec) : null;
}

/**
 * edhn63 (CR 122.1, 603.4, 603.10a; Reyhan, Last of the Abzan): the intervening "if it had one or more +1/+1 counters on it" (the object of the event) states a number, the
 * counters of that kind it had, and "that many" after it is that count as the object last existed. The condition itself or one part of an "and"; two are not one antecedent.
 */
export function eventCountersCount(c: Rec | undefined): Rec | null {
  if (!isRec(c)) return null;
  if (c['cond'] === 'matches') {
    const o = c['object'];
    const f = isRec(c['filter']) ? c['filter'] : undefined;
    const k = f !== undefined && isRec(f['counters']) ? f['counters'] : undefined;
    const cmp = k !== undefined && isRec(k['cmp']) ? k['cmp'] : undefined;
    // edh-next-84 (CR 122.1, 603.10a; Yuna, Grand Summoner): no comparison at all, "if it had one or more counters on it" (counters of any kind), is the same "at least one" (rules/filter.ts: a
    // `counters` test with no `cmp` asks for one or more); before, such a condition offered no number and "that many" fell to the event's amount (one object moved)
    if (!isRec(o) || o['ref'] !== 'event' || o['role'] !== 'subject' || f === undefined || k === undefined || Object.keys(f).length !== 1 || typeof k['kind'] !== 'string') return null;
    return cmp === undefined || (cmp['op'] === '>=' && cmp['value'] === 1) ? { q: 'counters', on: { ref: 'event', role: 'subject' }, kind: k['kind'] } : null;
  }
  if (c['cond'] !== 'all' || !Array.isArray(c['of'])) return null;
  const parts = (c['of'] as unknown[]).filter((x) => eventCountersCount(x as Rec) !== null);
  return parts.length === 1 ? eventCountersCount(parts[0] as Rec) : null;
}

/**
 * edh-perms-22 (CR 119.3, 603.4, 608.2h; Lathiel, the Bounteous Dawn): the intervening "if you gained life this turn" states a number, the life gained this turn, and "that many"
 * after it is that amount, read as the ability resolves. The condition itself or one part of an "and" of conditions; two such parts are not one antecedent (design 6.4).
 */
export function gainedLifeCount(c: Rec | undefined): Rec | null {
  if (!isRec(c)) return null;
  if (c['cond'] === 'happened') {
    const ev = c['event'];
    return c['scope'] === 'turn' && c['by'] === undefined && isRec(ev) && ev['ev'] === 'life' && ev['change'] === 'gain' && ev['player'] === 'you' && Object.keys(ev).length === 3 && Object.keys(c).length === 3 ? { q: 'lifeGainedThisTurn' } : null;
  }
  if (c['cond'] !== 'all' || !Array.isArray(c['of'])) return null;
  const parts = (c['of'] as unknown[]).filter((x) => gainedLifeCount(x as Rec) !== null);
  return parts.length === 1 ? gainedLifeCount(parts[0] as Rec) : null;
}

/**
 * edh-zones-24 (CR 603.7, 608.2c, 608.2h; Glimpse the Impossible): the instructions of a delayed triggered ability are done in order when it resolves, so inside one
 * ("At the beginning of the next end step, put them into your graveyard, then create a token for each card put into your graveyard this way") an instruction before
 * the one being read, in the same `delay` step, is a source of the numbers it uses. `nodePath` is the path of the node being read from the top of its unit's steps
 * ("/2/do/0/then/1/..."); the sources are then the steps of that `delay` before the step that holds the node (document order).
 */
function delaySteps(u: Unit, nodePath: string | undefined, beforeStep: number): { cut: number } | null {
  if (nodePath === undefined) return null;
  const top = (u.steps as Rec[])[beforeStep];
  // (only a delay of a step of the turn: an event-timed delayed trigger keeps trek-8's reading, where the number of its first instruction is the event's amount)
  if (top === undefined || top['op'] !== 'delay' || !isRec(top['when']) || top['when']['at'] !== 'step') return null;
  const all = stepsInOrder(u.steps);
  let cut = -1;
  all.forEach((x, k) => { if (nodePath === x.path || nodePath.startsWith(`${x.path}/`)) cut = k; }); // the deepest step that holds the node
  return cut < 0 ? null : { cut };
}

function unitSources(seq: readonly Unit[], at: number, beforeStep: number, prefix: readonly Unit[], nodePath?: string): NumberSource[] {
  const out: NumberSource[] = [];
  const units = [...prefix, ...seq.slice(0, at + 1)];
  for (const u of units) {
    if (u.manual) {
      if (u !== seq[at] && shieldShape(u.text) === null) out.push({ ref: {}, opaque: true });
      continue;
    }
    const all = stepsInOrder(u.steps);
    const inDelay = u === seq[at] ? delaySteps(u, nodePath, beforeStep) : null;
    all.forEach(({ step, path }, k) => {
      if (u === seq[at] && Number(path.split('/')[1]) >= beforeStep && !(inDelay !== null && Number(path.split('/')[1]) === beforeStep && k < inDelay.cut)) return;
      // r5-fxz (CR 701.25a, 701.22a): a surveil or a scry counts only for "card you put on top of your library" (`keptOnly`), never for "that many"
      // edh-mana-keywords-12 (CR 701.20a, 608.2c; Metalworker): a named reveal counts only for "for each card revealed this way" (`revealOnly`), never for "that many"
      if (step['op'] === 'reveal' && typeof step['as'] === 'string') { out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path }, revealOnly: true }); return; }
      // edh-c-103 (CR 701.20a, 608.2c; Madcap Experiment): the number of cards a reveal-until revealed (its result count), only for "the number of cards revealed this way"
      if (step['op'] === 'revealUntil' && typeof step['revealed'] === 'string') { out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path }, revealOnly: true }); return; }
      // edh-next-94 (CR 701.26a, 608.2c): a tap counts only for "<things> tapped this way" (`tappedOnly`), never for "that many"
      if (step['op'] === 'tap') { out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path }, tappedOnly: true }); return; }
      // edh-d-75 (CR 701.15a, 608.2c): a goad counts only for "<creatures> goaded this way" (`goadedOnly`), never for "that many"
      if (step['op'] === 'action' && step['action'] === 'goad') { out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path }, goadedOnly: true }); return; }
      if (step['op'] === 'surveil' || step['op'] === 'scry') { out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path }, keptOnly: true }); return; }
      // p2-c-dieroll-2 (CR 706.2, 608.2h; unverified cites): "Roll a six-sided die. If the result is 3 or less, you lose that much life.": the result of ONE die
      // rolled by you (no table: a table's rows read it themselves) is a number of its own; a second roll makes "that much" ambiguous (two candidates)
      if (step['op'] === 'rollDie') {
        const who = step['who'];
        if (step['table'] === undefined && (step['count'] === undefined || step['count'] === 1) && isRec(who) && who['ref'] === 'you' && Object.keys(who).length === 1) out.push({ ref: { q: 'dieResult' } });
        else out.push({ ref: {}, opaque: true });
        return;
      }
      // edh-replace-5 (CR 118.12, 608.2d, 608.2h): "you may pay any amount of {R}. When you do, it deals that much damage ...": the number of times a payment of a chosen number
      // of times (`pay.upTo`, `pay.anyAmount`) was made is its count (effects/handlers/pay.ts#payUpTo)
      // edh-next-32 (CR 608.2c, 118.12; Rampaging Aetherhood): in the sentence right after one that ends with such a payment ("you get {E}, then you may pay one or more {E}. If you do, put that many ..."), "that many" in its first instruction is that payment's own
      // count, the number the "if you do" is about, never an amount an instruction before the payment produced
      if (at > 0 && u === seq[at - 1] && beforeStep === 0 && step['op'] === 'pay' && (step['anyAmount'] === true || step['upTo'] !== undefined) && all[k + 1] === undefined) { out.length = 0; out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path } }); return; }
      if (step['op'] === 'pay' && (step['anyAmount'] === true || step['upTo'] !== undefined)) { out.push({ ref: { q: 'resultCount', step: '' }, step: { unit: u, path } }); return; }
      // edh-d-64 (CR 608.2d, 608.2c; By Invitation Only): "Choose a number between 0 and 13. Each player sacrifices that many creatures of their choice.": the number you chose with the words "Choose a number between ..." (link chosenNumber, eff.stdmisc.choose.number.between; not a random one, not the hidden choice of "any number of cards") is the amount "that many" names
      if (step['op'] === 'chooseValue' && step['what'] === 'number' && step['link'] === 'chosenNumber' && step['random'] === undefined && step['guard'] === undefined && isRec(step['who']) && step['who']['ref'] === 'you') { out.push({ ref: { q: 'chosenNumber', link: step['link'] } }); return; }
      if (typeof step['op'] !== 'string' || !COUNTED_OPS.has(step['op'])) return;
      // edh-perms-15 (CR 701.21a, 608.2h; RMS Titanic): "sacrifice it and create that many Treasure tokens": the sacrifice of one named object (itself, or the object an event or an earlier
      // instruction named) states no number, so it is no antecedent of "that many"; what counts is the amount of the event
      const sacrificed = step['what'];
      if (step['op'] === 'sacrifice' && isRec(sacrificed) && (sacrificed['ref'] === 'self' || sacrificed['ref'] === 'event') && step['count'] === undefined) return;
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
  // edh-perms-22 (CR 208.1, 608.2h; Conformer Shuriken): "If that creature has greater power than this creature, put a number of +1/+1 counters on this creature equal to the difference": the
  // power of the object the condition tests minus the power it must exceed (a `matches` whose whole filter is "power (or toughness) greater than a statistic of another object")
  if (condition !== undefined && condition['cond'] === 'matches' && isRec(condition['object']) && isRec(condition['filter'])) {
    const f = condition['filter'];
    const stat = Object.keys(f).length === 1 ? Object.keys(f)[0]! : '';
    const cmp = (stat === 'power' || stat === 'toughness' || stat === 'manaValue' /* edh-d-78: Transmute Artifact */) && isRec(f[stat]) ? f[stat] : undefined;
    if (cmp !== undefined && Object.keys(cmp).length === 2 && cmp['op'] === '>' && isRec(cmp['value']) && cmp['value']['q'] === 'stat' && cmp['value']['stat'] === stat && isRec(cmp['value']['of'])
      && JSON.stringify(cmp['value']['of']) !== JSON.stringify(condition['object'])) {
      return { q: 'math', op: '-', args: [{ q: 'stat', stat, of: clone(condition['object']) }, clone(cmp['value'])] };
    }
  }
  // pc-players-2 (CR 402.1, 119.1, 608.2h): "If that player has more cards in hand than you, draw cards equal to the difference": the bigger amount minus the smaller one
  // (`compare` with op `>`, the cards in a zone or the life of one player on each side)
  if (condition !== undefined && condition['cond'] === 'compare' && condition['op'] === '>' && isRec(condition['left']) && isRec(condition['right'])) {
    const [l, r] = [condition['left'], condition['right']];
    if (l['q'] === r['q'] && (l['q'] === 'zoneSize' || l['q'] === 'life') && l['zone'] === r['zone'] && isRec(l['of']) && isRec(r['of'])) return { q: 'math', op: '-', args: [clone(l), clone(r)] };
    // edh-d-78 (CR 202.3, 608.2h; Transmute Artifact): "If that card's mana value is greater than the sacrificed artifact's mana value, ... where X is the difference": the same statistic of two objects
    if (l['q'] === 'stat' && r['q'] === 'stat' && l['stat'] === 'manaValue' && r['stat'] === 'manaValue' && isRec(l['of']) && isRec(r['of'])) return { q: 'math', op: '-', args: [clone(l), clone(r)] };
  }
  // edh-cast-9 (CR 202.3, 601.2h, 608.2h; Ancient Cellarspawn): "if the amount of mana spent to cast it was less than its mana value, target opponent loses life equal to the difference":
  // the mana value minus the mana spent (`compare` with op `<`, the mana spent to cast a spell on the left, that spell's mana value on the right)
  if (condition !== undefined && condition['cond'] === 'compare' && condition['op'] === '<' && isRec(condition['left']) && isRec(condition['right'])) {
    const [l, r] = [condition['left'], condition['right']];
    if (l['q'] === 'spellManaSpent' && l['from'] === undefined && r['q'] === 'stat' && r['stat'] === 'manaValue' && JSON.stringify(l['of']) === JSON.stringify(r['of'])) return { q: 'math', op: '-', args: [clone(r), clone(l)] };
  }
  if (condition === undefined || condition['cond'] !== 'compare' || condition['op'] !== '<' || typeof condition['right'] !== 'number') return null;
  const left = condition['left'];
  // r4-mech (CR 608.2h, 202.3): also a statistic of one object ("If the discovered card's mana value is less than 10, create a number of ... equal to the difference")
  const stat = isRec(left) && left['q'] === 'stat' && isRec(left['of']);
  // edh-players-19 (CR 119.3, 603.4, 608.2h; Lolth, Spider Queen's emblem): "if that player lost less than 8 life this turn, they lose life equal to the difference": the number minus the
  // life that player lost this turn (`lifeLostThisTurn`, any player the "if" named)
  if (isRec(left) && left['q'] === 'lifeLostThisTurn' && isRec(left['of'])) return { q: 'math', op: '-', args: [condition['right'], clone(left)] };
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
    const { [MOVED_MARK]: kind, $attempted: attempted, ...which } = node['of']['filter'] as Rec;
    if (typeof kind !== 'string') return undefined;
    return { q: 'eventAmount', which, ...(attempted === true ? { attempted: true } : {}), $anaphor: { sort: 'number', number: 'singular', participle: `moved:${kind}`, text: `${kind} this way` } };
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
/** edh-c-21 (review): a count of objects a draw can't change (not the cards of a hand or a library), so counting it again after the draw gives the same number. */
function countUnchangedByDraw(q: Rec): boolean {
  const of = q['of'];
  const f = isRec(of) && isRec(of['filter']) ? of['filter'] : undefined;
  if (!isRec(of) || of['ref'] !== 'each' || f === undefined) return false;
  const z = f['zone'];
  return z === undefined || z === 'battlefield' || z === 'graveyard';
}

function movedGroups(u: Unit, seq: readonly Unit[], at: number, d: Draft, prefix: readonly Unit[]): void {
  u.steps = (u.steps as unknown[]).map((top, i) => rewrite(top, (node, path) => {
    // edh-perms-20 (CR 608.2c, 608.2h, 701.21a; Shadowgrange Archfiend): "the greatest power among creatures sacrificed this way": the stat of the group the ONE earlier sacrifice
    // bound, each creature read as it last existed (the engine's stat reads the binding's last known information, effects/eval.ts#readSetOf); only a greatest/least/total
    // statistic, and only when the description adds nothing the sacrifice's own description does not say (whichFitsStep)
    // edh-next-138 (CR 608.2c, 608.2h, 701.8a; Convert to Slime ruling 2024-09-20: "the mana value of the destroyed permanents as they last existed on the battlefield"): and "the total mana value of
    // permanents destroyed this way": the group the ONE earlier destroy bound (only the permanents it destroyed: an indestructible or regenerated one is not one), each as it last existed
    const statKind = node['q'] === 'stat' && (node['agg'] !== undefined || node['sum'] === true) && isRec(node['of']) && node['of']['ref'] === 'each' && isRec(node['of']['filter']) ? node['of']['filter'][MOVED_MARK] : undefined;
    if (statKind === 'sacrificed' || statKind === 'destroyed') {
      const { [MOVED_MARK]: _kind, ...which } = (node['of'] as Rec)['filter'] as Rec;
      const srcs = unitSources(seq, at, i, prefix).filter((x) => x.opaque === true || (x.step !== undefined && movedBy(stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)!.step, statKind)));
      if (srcs.length !== 1 || srcs[0]!.opaque === true || srcs[0]!.step === undefined) return undefined;
      const target = stepsInOrder(srcs[0]!.step.unit.steps).find((y) => y.path === srcs[0]!.step!.path)!.step;
      if (statKind === 'sacrificed' ? target['op'] !== 'sacrificeChoice' || !whichFitsStep(which, { ref: 'each', filter: target['filter'] }, d) : target['op'] !== 'destroy' || target['guard'] !== undefined || !whichFitsStep(which, target['what'], d)) return undefined;
      if (typeof target['as'] !== 'string') target['as'] = freshName(d, String(target['op']));
      return { ...node, of: { ref: 'bound', name: target['as'] } };
    }
    if (node['ref'] !== 'each' || !isRec(node['filter'])) return undefined;
    const { [MOVED_MARK]: kind, ...which } = node['filter'] as Rec;
    // edh-mana-keywords-5 (CR 608.2c, 608.2h, 701.8a, 406.3; family for-each-this-way): the `over` of "For each creature exiled this way, its controller ..." is the group the ONE
    // earlier destroy or exile bound, each object read as it last existed (its controller is the one it had on the battlefield); only when the description adds nothing the
    // instruction's own description does not already say (the same card types), else the sentence stays manual
    // edh-mana-keywords-7 (CR 701.8a, 614.6; Terastodon): "for each permanent put into a graveyard this way" after a destroy is the same group, only those that went to a
    // graveyard (`boundTo`: one a replacement effect exiled instead is not one); any other earlier move or mill into a graveyard makes the sentence ambiguous (manual)
    const destroyedToYard = kind === 'graveyard';
    // edh-next-132 (CR 608.2c, 107.3; Red Sun's Twilight): or the one forEach of a top-level "if" ("If X is 5 or more, for each artifact destroyed this way, create a token ..."): the same group
    const ifForEach = path === '/then/0/over' && isRec(top) && top['op'] === 'if' && Array.isArray(top['then']) && top['then'].length === 1 && isRec(top['then'][0]) && top['then'][0]['op'] === 'forEach';
    if ((ifForEach || (path === '/over' && isRec(top) && top['op'] === 'forEach')) && (kind === 'destroyed' || kind === 'exiled' || destroyedToYard)) {
      const srcs = unitSources(seq, at, i, prefix).filter((x) => x.opaque === true || (x.step !== undefined && ((): boolean => {
        const step = stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)!.step;
        return movedBy(step, kind as MovedKind) || (destroyedToYard && step['op'] === 'destroy');
      })()));
      if (srcs.length !== 1 || srcs[0]!.opaque === true || srcs[0]!.step === undefined) return undefined;
      const target = stepsInOrder(srcs[0]!.step.unit.steps).find((y) => y.path === srcs[0]!.step!.path)!.step;
      if (destroyedToYard && target['op'] !== 'destroy') return undefined;
      if (!whichFitsStep(which, target['what'], d) || target['until'] !== undefined) return undefined;
      if (typeof target['as'] !== 'string') target['as'] = freshName(d, String(target['op']));
      if (destroyedToYard) target['boundTo'] = 'graveyard';
      return { ref: 'bound', name: target['as'] };
    }
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

/**
 * edh-mana-keywords-5 (CR 608.2c, 608.2h; family for-each-this-way): a description of moved objects ("creature" of "for each creature exiled this way") adds nothing to what
 * the instruction moved when the instruction's own description (its target spec's or its group's) has those card types and the words say no more than the types.
 */
function whichFitsStep(which: Rec, what: unknown, d: Draft): boolean {
  const keys = Object.keys(which);
  if (keys.some((k) => k !== 'types')) return false;
  let filter: unknown;
  // edh-next-138 (Convert to Slime): the union of several target specs, every one a target of the step ("permanents destroyed this way" after "Destroy up to one target artifact, up to one target
  // creature, and up to one target enchantment"): only a description that adds nothing
  if (isRec(what) && what['ref'] === 'union' && Array.isArray(what['of'])) return keys.length === 0 && (what['of'] as unknown[]).every((x) => isRec(x) && x['ref'] === 'target' && d.targets.some((t) => t.id === x['id']));
  if (isRec(what) && what['ref'] === 'each') filter = what['filter'];
  else if (isRec(what) && what['ref'] === 'target') {
    const tgt = d.targets.find((t) => t.id === what['id']);
    // edh-next-116 (CR 608.2c, 608.2h): "up to five target permanents" has no filter at all (every permanent): "for each permanent exiled this way" is then the same group
    filter = tgt === undefined ? undefined : (tgt.filter ?? (tgt.kind === 'object' ? {} : undefined));
  }
  if (!isRec(filter)) return false;
  if (keys.length === 0) return true; // "for each permanent exiled this way": every object the instruction moved
  const own = filter['types'];
  const mine = which['types'];
  return Array.isArray(own) && Array.isArray(mine) && own.length > 0 && own.every((t) => mine.includes(t));
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
 * edh-perms-20 (CR 603.2c, 701.17a, 608.2c; The Wise Mothman): the trigger is one mill event of one or more cards ("Whenever one or more nonland cards are milled"), and
 * `which` is exactly the cards it matches: "the number of nonland cards milled this way" is then the amount of the triggering batch (`eventAmount`, one count for each card
 * milled, triggers/context.ts). A narrower or wider description than the trigger's counts something else and stays manual.
 */
function scryTrigger(d: Draft): boolean {
  const on = d.trigger?.on ?? [];
  const ev = on[0] as Rec | undefined;
  return d.trigger?.batch !== true && on.length === 1 && isRec(ev) && ev['ev'] === 'action' && ev['verb'] === 'scry';
}
function milledBatchAmount(d: Draft, which: unknown): boolean {
  const on = d.trigger?.on ?? [];
  const ev = on[0] as Rec | undefined;
  if (d.trigger?.batch !== true || on.length !== 1 || !isRec(ev) || ev['ev'] !== 'action' || ev['verb'] !== 'mill' || !Object.keys(ev).every((k) => k === 'ev' || k === 'verb' || k === 'actor' || k === 'object')) return false;
  const norm = (v: unknown): string => JSON.stringify(Object.entries({ ...(isRec(v) ? v : {}), isCard: true }).sort(([a], [b]) => (a < b ? -1 : 1)));
  return isRec(which) && norm(which) === norm(ev['object']);
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
  if (step['op'] !== 'delay' || !/^\/do\/0(\/|$)/.test(path) || anaphor['participle'] !== undefined) return undefined;
  const when = step['when'];
  if (!isRec(when) || when['at'] !== 'event' || !isRec(when['event'])) return undefined;
  // edh-next-109 (CR 603.7, 508.1, 603.2c; Basri Ket): a delayed trigger on "one or more creatures attack" (a batch) has an amount too, the number of attackers; any other batch delay stays unread
  if (u.flags.includes('batch')) return (when['event'] as Rec)['ev'] === 'attacks' && patternsHaveAmount([when['event'] as unknown as EventPattern], true) ? { q: 'eventAmount' } : undefined;
  return patternsHaveAmount([when['event'] as unknown as EventPattern]) ? { q: 'eventAmount' } : null;
}

/** edh-c-62: the trigger is one cast of a spell with a mana value condition ("Whenever you cast a spell with mana value equal to ..."): the spell's mana value is the number "that much" names. */
function castManaValueTrigger(d: Draft): boolean {
  const on = d.trigger?.on ?? [];
  const ev = on[0] as Rec | undefined;
  return on.length === 1 && isRec(ev) && ev['ev'] === 'cast' && isRec(ev['spell']) && isRec((ev['spell'] as Rec)['manaValue']) && ((ev['spell'] as Rec)['manaValue'] as Rec)['op'] === '==';
}

function resolveNumbers(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): boolean {
  let ok = true;
  let failure = '';
  // rewritten in place, in order: a name given to an earlier step of the SAME sentence lands on the step that is kept (CR 608.2c)
  u.steps = (u.steps as unknown[]).map(movedCounts) as Rec[]; // Cloud C7
  movedGroups(u, seq, at, d, prefix); // Cloud r3-moved: what is left of the marker after the counts
  // edh-d-78 (CR 608.2c, 202.3; Transmute Artifact): "If it's greater, you may pay {X}, where X is the difference.": the marker condition `$greaterThanBefore` (parser/holes/cond.ts#itsGreater)
  // is the comparison of the `if` step right before it with `<=` turned into `>` (the same two amounts), resolved here because "the difference" below reads that condition. Another step
  // before it leaves the marker in place: lower/conditions.ts#resolveGreaterThanBefore makes the sentence manual
    u.steps = u.steps.map((st, i): Rec => {
    const c = st['op'] === 'if' ? st['cond'] : undefined;
    if (!isRec(c) || c['cond'] !== '$greaterThanBefore') return st;
    const before = i > 0 ? u.steps[i - 1] : [...prefix, ...seq.slice(0, at)].filter((x) => x.manual !== undefined || x.steps.length > 0).at(-1)?.steps.at(-1);
    const p = before?.['op'] === 'if' && before['else'] === undefined && before['guard'] === undefined ? before['cond'] : undefined;
    if (before === undefined || !isRec(p) || p['cond'] !== 'compare' || p['op'] !== '<=' || !isRec(p['left']) || !isRec(p['right'])) return st;
    return { ...st, cond: { cond: 'compare', left: clone(p['left']), op: '>', right: clone(p['right']) }, $greater: true } as Rec; // folded into the `else` of the `<=` `if` by lower/conditions.ts#foldGreaterAsElse
  });
  const steps = u.steps;
  const renamed: { at: string; name: string }[] = [];
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
      // edh-next-60 (CR 615.5, 608.2c; Gatta and Luzzu): "that many" in the additional steps of a prevention effect that is a step of an effect ("If damage would be dealt to that creature this turn, prevent
      // that damage and put that many +1/+1 counters on it") is the damage that application prevented (a static ability reads it in lower/static-anaphora.ts#resolvePreventedAmount)
      if (((node['$anaphor'] as Rec)['text'] === 'that many' || (node['$anaphor'] as Rec)['text'] === 'that much') && underPreventThen(steps[i]!, path)) return { q: 'preventedAmount' };
      const paidLife = paidLifeAmount(seq, at, i, prefix, steps[i]!);
      const lostLife = lostLifeAmount(steps[i]!);
      const spent = path.startsWith('/then/') ? spentManaAmount(steps[i]!) : null; // r4-refs
      const sameLife = path.startsWith('/else/') ? elseSameLifeAmount(steps[i]!) : null; // std-rj
      const primed = primeCount(d.condition) ?? gainedLifeCount(d.condition) ?? eventCountersCount(d.condition) ?? atLeastCount(d.condition); // edh-next-138: "if you control five or more Deserts" too // std-rx1: the number an intervening "if" states is the one candidate (edh-perms-22: the life gained this turn too)
      const all = paidLife !== null ? [{ ref: paidLife }] : lostLife !== null ? [{ ref: lostLife }] : spent !== null ? [{ ref: spent }] : primed !== null ? [{ ref: primed }] : sameLife !== null ? [{ ref: sameLife }]
        : sameNumberOnce(numberSources(d, seq, at, i, prefix, `/${i}${path}`, true, true));
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
      const srcs0 = all.filter((s) => kept || s.keptOnly !== true).filter((s) => participle === 'revealed' || s.revealOnly !== true).filter((s) => participle === 'tapped' || s.tappedOnly !== true).filter((s) => participle === 'goaded' || s.goadedOnly !== true).filter((s) => {
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
        if (participle.startsWith('moved:')) return step !== undefined && movedBy(step, participle.slice('moved:'.length) as MovedKind, true) && fromZoneFits(step, node['which'], d, s.step.unit.steps);
        // std-tdm: a "destroyed this way" count also needs a noun that fits the destroy step (destroyedNounFits)
        if (participle === 'goaded') return s.goadedOnly === true && head === 'creature'; // edh-d-75 (CR 701.15a): the ONE goad step before it
        return typeof op === 'string' && PARTICIPLE_OF_OP[op] === participle && (participle !== 'destroyed' || destroyedNounFits(step!, head, d)) && (participle !== 'phased' || phasedNounFits(step!, head, d, s.step.unit.steps)) && (participle !== 'tapped' || tappedNounFits(step!, head, d, s.step.unit.steps)); // edh-d-39
      });
      const text = String((node['$anaphor'] as Rec)['text']);
      // p2-zone-moves-1 (CR 701.9a, 608.2c): "that player discards all the cards in their hand, then draws that many cards" (Shocker) after a trigger with an amount of
      // its own (the damage): the "then" instruction right after a discard of the whole hand, in the same sentence, can only count the cards that discard discarded
      const wheel = srcs0.length > 1 && !srcs0.some((x) => x.opaque) && text === 'that many' && i > 0 && steps[i]!['op'] === 'draw' && steps[i - 1]!['op'] === 'discard'
        && steps[i - 1]!['count'] === 'hand' && JSON.stringify(steps[i - 1]!['who']) === JSON.stringify(steps[i]!['who'])
        ? srcs0.filter((x) => x.step?.unit === u && x.step.path === `/${i - 1}`) : [];
      // edh-players-16 (CR 608.2c, 608.2h; Neheb, Dreadhorde Champion): "Whenever ~ deals combat damage to a player, you may discard any number of cards. If you do, draw that many cards":
      // the "that many" of an "If you do" sentence that stands first in its unit is a number of what the "you may" instruction right before it did (the cards its discard discarded),
      // never the amount of the triggering event (the damage)
      const prevUnit = i === 0 && srcs0.length > 1 && !srcs0.some((x) => x.opaque) && (text === 'that many' || text === 'that much') && steps[i]!['op'] === 'if' && path.startsWith('/then/')
        && isRec(steps[i]!['cond']) && (steps[i]!['cond'] as Rec)['cond'] === 'did' ? [...prefix, ...seq.slice(0, at)].filter((x) => !x.manual).pop() : undefined;
      const mayLast = prevUnit === undefined ? undefined : (prevUnit.steps as Rec[]).length - 1;
      // (only when the number it did varies: "any number", "all the cards", "your hand", or edh-players-18's players of the triggering event counted: "you may draw cards equal to the number of
      // opponents dealt damage this way. If you do, discard that many cards" (Hordewing Skaab); a fixed "a card" is never counted with "that many" in printed text)
      const variesIn = (v: unknown): boolean => Array.isArray(v) ? v.some(variesIn) : isRec(v) && ((v['max'] === 'any') || v['count'] === 'hand' || v['count'] === 'all' || v['count'] === 'any' || (isRec(v['count']) && (v['count'] as Rec)['q'] === 'countPlayers' && isRec((v['count'] as Rec)['of']) && ((v['count'] as Rec)['of'] as Rec)['ref'] === 'event') || Object.values(v).some((x) => Array.isArray(x) && variesIn(x)));
      const ifYouDo = prevUnit === undefined || mayLast === undefined || mayLast < 0 || (prevUnit.steps as Rec[])[mayLast]!['op'] !== 'may' || !variesIn((prevUnit.steps as Rec[])[mayLast]!['do']) ? []
        : srcs0.filter((x) => x.step?.unit === prevUnit && x.step.path.startsWith(`/${mayLast}/do/`));
      // edh-players-23 (CR 603.12, 608.2c, 608.2h; Swashbuckler Extraordinaire): "Whenever you attack, you may sacrifice one or more Treasures. When you do, draw that many cards": the "that many" of a reflexive trigger's
      // instructions is the number the instruction it waits for did (the Treasures sacrificed), never the triggering event's amount (the creatures that attacked) when exactly one instruction of the ability supplies a number
      const reflexiveOwn = srcs0.length > 1 && !srcs0.some((x) => x.opaque) && steps[i]!['op'] === 'reflexive' && path.startsWith('/do/') ? srcs0.filter((x) => x.step !== undefined && variesStep(x.step)) : [];
      // edh-c-21 (CR 608.2c, 121.2, 701.9a; Last Stand): "Draw a card for each Island you control, then discard that many cards" after sentences with amounts of their own: the "then" instruction right
      // after a draw by the same player, in the same sentence, can only discard the number of cards that draw drew
      const drawThenDiscard = srcs0.length > 1 && !srcs0.some((x) => x.opaque) && text === 'that many' && i > 0 && steps[i]!['op'] === 'discard' && steps[i - 1]!['op'] === 'draw'
        && JSON.stringify(steps[i - 1]!['who']) === JSON.stringify(steps[i]!['who']) ? srcs0.filter((x) => x.step?.unit === u && x.step.path === `/${i - 1}`) : [];
      // edh-next-91 (CR 608.2c; Nantuko Cultivator): "you may discard any number of land cards. Put that many +1/+1 counters on ~ and draw that many cards": the second "that many" of one
      // sentence counts what the first one counted (the cards discarded), not the counters it put: a step of this sentence whose own count is a `resultCount` (a "that many" already read)
      // is no candidate when exactly one other amount remains
      // (and the "up to that many target creatures" of the same sentence, a target whose count is itself a "that many" not read yet, is the same number again: its opaque mention is no candidate)
      const targetMany = d.targets.some((t) => JSON.stringify(t).includes('"that many"'));
      const chainedMany = srcs0.length > 1 && (targetMany || !srcs0.some((x) => x.opaque)) && text === 'that many' && (i > 0 || targetMany)
        ? srcs0.filter((x) => !(targetMany && x.opaque === true) && !(x.step?.unit === u && isRec(stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)?.step?.['count']) && (stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)!.step['count'] as Rec)['q'] === 'resultCount')) : [];
      // edh-next-136 (CR 608.2c, 122.1; Chandra, Legacy of Fire): "Remove a loyalty counter from each of any number of permanents you control. Exile that many cards ...": the two numbers of that one
      // instruction are the permanents chosen and the counters removed from them; "that many" is the counters removed (a chosen permanent with no such counter loses none)
      const stepAt = (x: (typeof srcs0)[number]): Rec | undefined => (x.step === undefined ? undefined : stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)?.step);
      const removedOfChosen = srcs0.length === 2 && !srcs0.some((x) => x.opaque) && text === 'that many' ? (() => {
        const [c, r] = srcs0.map(stepAt);
        const ok = c?.['op'] === 'chooseObjects' && typeof c['as'] === 'string' && r?.['op'] === 'removeCounters' && r['count'] === 1 /* one counter from each: the permanents counted are the counters removed */ && isRec(r['from']) && (r['from'] as Rec)['ref'] === 'bound' && (r['from'] as Rec)['name'] === c['as']
          && srcs0[0]!.step?.unit === srcs0[1]!.step?.unit;
        return ok ? [srcs0[1]!] : [];
      })() : [];
      const srcs = ifYouDo.length === 1 ? ifYouDo : wheel.length === 1 ? wheel : reflexiveOwn.length === 1 ? reflexiveOwn : drawThenDiscard.length === 1 ? drawThenDiscard : chainedMany.length === 1 ? chainedMany : removedOfChosen.length === 1 ? removedOfChosen : srcs0;
      // Cloud r3-moved (CR 602.2b, 601.2h, 608.2c): no instruction of the ability is of that kind, but its cost is: "{T}, Exile any number of cards from your graveyard:
      // ... where X is the number of cards exiled this way" counts what the cost moved (Cloud C8's cost references)
      if (srcs.length === 0 && typeof participle === 'string' && participle.startsWith('moved:')) {
        const cost = costCount(d, participle.slice('moved:'.length), node['which']);
        if (cost !== null) return cost;
        // std-rq (CR 603.2c, 603.10, 608.2c): no instruction of the ability discards, but it triggers on a discard of one or more cards ("Whenever you discard one or
        // more cards, target creature gets +2/+0 until end of turn for each card discarded this way"): "this way" is the triggering discard, its amount the cards
        // discarded (as "that many" reads it, eventAmount). Only every card of it: a narrower description ("nonland card discarded this way") is not that amount.
        if (participle === 'moved:discarded' && plainCards(node['which']) && discardBatchTrigger(d) && all.some((s) => !s.step && !s.opaque && isRec(s.ref) && s.ref['q'] === 'eventAmount')) return { q: 'eventAmount' };
        // edh-perms-20 (CR 603.2c, 701.17a; The Wise Mothman): the same for the cards a mill trigger matched, "the number of nonland cards milled this way"
        if (participle === 'moved:milled' && milledBatchAmount(d, node['which']) && all.some((s) => !s.step && !s.opaque && isRec(s.ref) && s.ref['q'] === 'eventAmount')) return { q: 'eventAmount' };
      }
      // edh-next-38 (CR 701.22a, 603.2c; Celeborn the Wise): "the number of cards looked at while scrying this way" in an ability that triggers on a scry is the cards that scry looked at
      // (the event's amount, `eventAmount`); in no other ability it names a number (the marker stays: the sentence is manual)
      if (srcs.length === 0 && participle === 'scried' && scryTrigger(d) && all.some((s) => !s.step && !s.opaque && isRec(s.ref) && s.ref['q'] === 'eventAmount')) return { q: 'eventAmount' };
      // trek-8 (CR 603.7, 603.2c, 608.2h): in the instructions of an event-timed delayed trigger, when nothing before supplies a number ("Whenever it deals combat
      // damage to a player this turn, you draw that many cards"), the number is the delayed trigger's own event's amount (read as it resolves). A candidate that
      // exists is never overridden (G10: every reading that parsed before is the same).
      // edh-c-62 (CR 601.2i, 202.3, 608.2h; Imminent Doom): "Whenever you cast a spell with mana value equal to the number of doom counters on ~, ~ deals that much damage to any target": nothing
      // before supplies a number, and the trigger is a cast of a spell whose mana value the trigger compares: "that much" is that spell's mana value. A candidate that exists is never overridden.
      if (srcs.length === 0 && text === 'that much' && castManaValueTrigger(d)) return { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } };
      // edh-next-109 (CR 120.3, 608.2h; Kaya, Orzhov Usurper, ruling 2019-01-25): "~ deals damage to target player equal to <a computed number> and you gain that much life": with no number before it,
      // the "that much" of the instruction right after a damage instruction of the same sentence is the amount that instruction stated (not the damage dealt: it is what the gain
      // equals even if more or less damage is dealt); lower/conditions.ts#resolveDamageDealt names the step. Only an amount that is a computed quantity (a fixed number stays unread)
      if (srcs.length === 0 && text === 'that much' && i > 0 && steps[i - 1]!['op'] === 'damage' && steps[i - 1]!['perSource'] !== true && isRec(steps[i - 1]!['amount']) && !JSON.stringify(steps[i - 1]!['amount']).includes('"iterating"') /* an amount read per recipient has no one stated number */ && node['$anaphor'] !== undefined && (steps[i]!['op'] === 'gainLife' || steps[i]!['op'] === 'loseLife')) return { q: 'damageDealt', step: '', stated: true, $step: 'previous' };
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
      // edh-players-18 (CR 608.2c, 608.2h; Hordewing Skaab, ruling 2021-09-24): "that many" after "you may draw cards equal to the number of opponents dealt damage this way" is that NUMBER,
      // whatever another effect did to the draw: the same count of the triggering event's players (fixed once the event happened), never the cards the draw really drew
      if (ifYouDo.length === 1 && target['op'] === 'draw' && isRec(target['count']) && target['count']['q'] === 'countPlayers' && isRec(target['count']['of']) && target['count']['of']['ref'] === 'event') return clone(target['count']);
      // edh-d-52 (CR 608.2c, 608.2h; Horrid Shadowspinner, ruling: the power when the draw was chosen): "you may draw cards equal to its power. If you do, discard that many cards" repeats the draw's own count
      if (target['op'] === 'draw' && isRec(target['count']) && target['count']['q'] === 'stat' && steps[i]!['op'] === 'if' && isRec(steps[i]!['cond']) && (steps[i]!['cond'] as Rec)['cond'] === 'did' && path.startsWith('/then/') && text === 'that many') return clone(target['count']);
      // edh-c-21 (CR 608.2c, 121.1; Last Stand): "..., then discard that many cards" right after a draw of a count of the objects of a description is that count (the number the draw counted, as Hordewing Skaab's
      // ruling reads its draw), not the cards really drawn
      if (steps[i]!['op'] === 'discard' && i > 0 && src.step.unit === u && src.step.path === `/${i - 1}` && target['op'] === 'draw' && isRec(target['count']) && target['count']['q'] === 'count' && countUnchangedByDraw(target['count'])) return clone(target['count']);
      if (typeof target['as'] !== 'string') target['as'] = freshName(d, src.lifeLostBy !== undefined ? 'lost' : String(target['op']));
      // edh-zones-24: a source inside the step being rewritten (a delay's earlier instruction) is a copy of the one that is kept: the name is given to the kept step below
      if (src.step.unit === u && src.step.path.startsWith(`/${i}/`)) renamed.push({ at: src.step.path, name: target['as'] as string });
      if (src.lifeLostBy !== undefined) return { q: 'lifeLost', step: target['as'], who: src.lifeLostBy }; // edh-next-15 (lifeLostSources)
      if (participle === 'flippedWin') target['called'] = true; // p2-coinflip-3 (CR 705.2): its flips are called, so they are won or lost; its count is the flips won
      // edh-d-75 (CR 701.15a, 608.2c, ruling 2022-02-18; Kaima, Havoc Eater): the creatures a goad instruction goaded are the set it bound (also one already goaded by the player, CR 701.15d): their
      // number, or the total of their powers
      if (participle === 'goaded') {
        const bound = { ref: 'bound', name: target['as'] };
        return String((node['$anaphor'] as Rec)['text']).startsWith('the total power') ? { q: 'stat', stat: 'power', of: bound, sum: true } : { q: 'count', of: bound };
      }
      // Cloud C7: the description of the moved objects counted (`which`, read as each last existed: effects/eval.ts)
      const which = reflexiveMoved?.which ?? node['which'];
      // edh-c-17 (CR 122.1, 608.2c; Give // Take): "Remove all +1/+1 counters from target creature you control. Draw that many cards.": "that many" after the removal of every counter is the counters it removed (the
      // sum over the objects, std-rx14's `countersRemoved`), not the objects it acted on
      // edhn63 (Galloping Lizrog: "remove any number of +1/+1 counters from among creatures you control. If you do, put twice that many"): the counters a from-among removal took, however many it took
      if (target['op'] === 'removeCounters' && ((target['count'] === 'all' && target['upTo'] === undefined) || target['among'] === true) && !isRec(which)) return { q: 'countersRemoved', step: target['as'] };
      // edh-c-61 (CR 701.8a, 700.4; Hellfire): "the number of creatures that died this way" counts what the destroy sent to a graveyard (a replacement effect may exile it instead)
      const died = (node['$anaphor'] as Rec)['died'] === true && participle === 'destroyed';
      return { q: 'resultCount', step: target['as'], ...(isRec(which) ? { which: clone(which) } : died ? { which: {} } : {}), ...(died ? { to: 'graveyard' } : {}), ...(node['attempted'] === true && isRec(which) ? { attempted: true } : {}) };
    }) as Rec;
    for (const r of renamed.splice(0)) {
      let cur: unknown = steps[i];
      for (const seg of r.at.split('/').slice(2)) cur = isRec(cur) ? cur[seg] : Array.isArray(cur) ? cur[Number(seg)] : undefined;
      if (isRec(cur) && typeof cur['as'] !== 'string') cur['as'] = r.name;
    }
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
    // edh-perms-20 (CR 603.2c, 608.2c; The Wise Mothman): "up to X target creatures, where X is the number of nonland cards milled this way": the count the where-clause put into the target
    if (!u.manual && k >= 0 && JSON.stringify(d.targets[k]).includes('"$moved"')) d.targets[k] = movedCounts(d.targets[k]) as (typeof d.targets)[number];
    if (u.manual || k < 0 || !JSON.stringify(d.targets[k]).includes('"$anaphor"')) continue;
    const refl = u.steps.findIndex((st) => st['op'] === 'reflexive' && JSON.stringify(st['do'] ?? null).includes(`"id":${JSON.stringify(id)}`));
    let failure = '';
    const spec = rewrite(d.targets[k], (node) => {
      if (failure !== '' || !isRec(node['$anaphor']) || (node['$anaphor'] as Rec)['sort'] !== 'number') return undefined;
      const text = String((node['$anaphor'] as Rec)['text']);
      // std-ra (CR 603.12, 608.2c): a reflexive trigger that waits for what the instruction right before moved ("When you discard one or more nonland cards this
      // way, tap up to that many target creatures"): that many of those objects, of the ONE earlier instruction of that kind (movedReflexive)
      const moved = refl >= 0 ? movedReflexive(u.steps[refl]!, '/do/', node) : null;
      // edh-perms-20: a count of "<cards> <participle> this way" in the target of an ability that triggers on that very event is the amount of the event (the mill batch, or a plain discard
      // batch as std-rq reads it for a step); any other description is another count: manual
      const part = (node['$anaphor'] as Rec)['participle'];
      if (moved === null && typeof part === 'string' && part.startsWith('moved:')) {
        const batchOk = part === 'moved:milled' ? milledBatchAmount(d, node['which']) : part === 'moved:discarded' ? plainCards(node['which']) && discardBatchTrigger(d) : false;
        if (batchOk && refl < 0 && numberSources(d, seq, at, 0, prefix).some((x) => x.step === undefined && !x.opaque && isRec(x.ref) && x.ref['q'] === 'eventAmount')) return { q: 'eventAmount' };
        failure = `"${text}" counts what an instruction moved, and no instruction of the ability did (design 6.4)`;
        return undefined;
      }
      // edh-perms-22 (CR 603.4, 608.2h; Lathiel): the number an intervening "if you gained life this turn" states is a candidate too (its amount is read when the targets are announced)
      const stated = refl < 0 ? gainedLifeCount(d.condition) : null;
      const all = refl >= 0 ? sameNumberOnce(numberSources(d, seq, at, refl, prefix)) : [...numberSources(d, seq, at, 0, prefix).filter((x) => x.step === undefined), ...(stated !== null ? [{ ref: stated }] : [])];
      const srcs1 = moved === null ? all : all.filter((x) => {
        if (x.opaque) return true;
        const step = x.step === undefined ? undefined : stepsInOrder(x.step.unit.steps).find((y) => y.path === x.step!.path)?.step;
        return step !== undefined && movedBy(step, moved.kind);
      });
      // edh-players-23 (CR 603.12, 608.2c; Swashbuckler Extraordinaire): the number of a reflexive trigger's targets is the number the instruction it waits for did, never the triggering event's amount, when exactly one instruction of the ability supplies a number
      const reflexiveOwn = refl >= 0 && moved === null && srcs1.length > 1 && !srcs1.some((x) => x.opaque) ? srcs1.filter((x) => x.step !== undefined && variesStep(x.step)) : [];
      const srcs = reflexiveOwn.length === 1 ? reflexiveOwn : srcs1;
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

/**
 * edh-zones-2: steps that only look at, choose among, shuffle and move cards of a library (a move to a library or from one): nothing on the battlefield changes, so a
 * quantity of the battlefield read before them is the same after them (CR 608.2h).
 */
function libraryOnly(steps: readonly Rec[]): boolean {
  const inLibrary = (v: unknown): boolean => isRec(v) && (v['zone'] === 'library' || (isRec(v['filter']) && v['filter']['zone'] === 'library'));
  return steps.every((st) => {
    const op = st['op'];
    if (op === 'look' || op === 'shuffle') return true;
    if (op === 'chooseObjects') return isRec(st['from']) && inLibrary(st['from']);
    // a bound card counts only when a choice among library cards of this sentence made it (never a permanent bound earlier)
    const chosenInLibrary = (name: unknown): boolean => steps.some((c) => c['op'] === 'chooseObjects' && c['as'] === name && isRec(c['from']) && inLibrary(c['from']));
    if (op === 'move') return isRec(st['to']) && st['to']['zone'] === 'library' && isRec(st['what']) && ((st['what']['ref'] === 'bound' && chosenInLibrary(st['what']['name'])) || inLibrary(st['what']));
    return false;
  });
}

/** Pass 5. */
export function lowerQuantities(input: Draft): Draft {
  const d = cloneDraft(input);
  sequences(d).forEach((seq, si) => {
    const prefix = si === 0 ? [] : d.units;
    let carried: unknown; // r3-cost: the X the sentence before defined ("where X is ...")
    let carriedFromReflexive = false; // edh-next-124: that X is a reflexive trigger's
    seq.forEach((u, i) => {
      if (u.manual) { carried = undefined; return; }
      const values: unknown[] = [];
      const flags: { announced?: boolean } = {};
      const reflexiveX = reflexiveWhereX(u.steps);
      const expanded = expandWhereX(u.steps, values, flags);
      if (expanded === null) { setManual(u, { code: 'lint', reason: 'malformed "where X is" clause' }); return; }
      // edh-next-39 (CR 602.2b, 601.2c, 608.2h): "..., where X is Q as you activate this ability" fixes Q as the targets are announced, so X may be only the number of
      // targets: an X inside an instruction would be read as it resolves (a different number), so such a sentence stays manual (fail closed)
      if (flags.announced === true) {
        const inTargets = (u.targetIds ?? []).some((id) => /"(min|max)":\{"q":"X"\}/.test(JSON.stringify(d.targets.find((t) => t.id === id) ?? {})));
        if (!inTargets) { setManual(u, { code: 'lint', reason: '"as you activate this ability" after a "where X is" clause that is not only the number of targets' }); return; }
      }
      // r3-cost (CR 107.3, 608.2h): "Exile the top X cards of their library, where X is the amount of damage dealt. You may cast any number of spells with mana value
      // X or less from among them ..." (Kotis, the Fangkeeper): the X the sentence right before defined is the X of a sentence that defines none of its own
      const usesCarried = values.length === 0 && carried !== undefined && JSON.stringify(expanded).includes('{"q":"X"}');
      if (usesCarried && carriedFromReflexive) u.reflexiveX = true; // edh-next-124: the sentence joins the reflexive trigger that defined its X (lower/conditions.ts#foldReflexive)
      u.steps = usesCarried ? substituteX(expanded, carried) as Rec[] : expanded;
      // edh-zones-2 (CR 107.3, 608.2h; Thassa's Oracle): a devotion ("where X is your devotion to blue") stays defined for the sentences after, as long as they only
      // look at, choose among and move cards of a library (none of them can change a devotion, which counts mana symbols of permanents); any other definition ends
      // with the next sentence, as before (a count could change in between)
      carried = values.length === 1 ? values[0] : values.length === 0 && isRec(carried) && carried['q'] === 'devotion' && libraryOnly(u.steps) ? carried : undefined;
      carriedFromReflexive = false;
      // edh-next-124 (CR 603.12, 107.3, 608.2h; Minsc & Boo, Timeless Heroes): a sentence whose only step is a reflexive trigger with ONE "where X is" clause of its own ("When you do, ~ deals X
      // damage to any target, where X is that creature's power.") defines X for the sentence right after it too, which then is one of that trigger's instructions
      if (values.length === 0 && reflexiveX !== undefined) { carried = reflexiveX; carriedFromReflexive = true; }
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
    // edh-next-143 (CR 608.2d; Khorvath's Fury): also the players a "choose friend or foe" chose a word for ("Each friend discards all cards from their hand, then draws that many cards plus one")
    const group = isRec(who) && (who['ref'] === 'each' || who['ref'] === 'chose');
    if (step['op'] === 'discard' && typeof step['as'] === 'string' && group) discards.set(step['as'], JSON.stringify(who));
    if (step['op'] !== 'draw' || !group || !isRec(step['count'])) return step;
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
    if (isRec(is) && !((is['ref'] === 'self' && Object.keys(is).length === 1) || (is['ref'] === 'fixed' && 'objects' in is) || is['ref'] === 'target' /* edh-c-87: a target of this ability, resolved as it resolves (effects/eval.ts factsEnv.objectIds) */)) found = true;
  });
  return found;
}

/** edh-next-60: whether `path` (from `root`) goes through the `then` steps of a prevention body (`b: 'prevent'`). */
function underPreventThen(root: unknown, path: string): boolean {
  let cur: unknown = root;
  let inThen = false;
  for (const seg of path.split('/').filter((x) => x !== '')) {
    if (!isRec(cur) && !Array.isArray(cur)) return false;
    if (isRec(cur) && cur['b'] === 'prevent' && seg === 'then') inThen = true;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return inThen;
}
