/**
 * Hole grammar `Cost` (CostDef), design 6.3 and corpus analysis 7.4. Owner: WP6.
 *
 *   CostList ::= CostPart { ("," | "," "and" | "and") CostPart }
 *   CostPart ::= MANA | {T} | {Q} | loyalty (+N, -N, 0) | "sacrifice" ... | "discard" ... | "exile" ... "from" Zone | "pay" Qty "life" | "pay" {E}...
 *              | "tap" Count "untapped" NP | "remove" Count kind "counter(s)" "from" ... | "put" ... "on" ... | "return" ... "to" ... "hand"
 *              | "reveal" ... "from your hand" | "mill" Qty | forage | collect evidence N | blight N | waterbend {N}
 * Rules: CR 118.1-118.3 (costs), CR 601.2g-h and 602.2 (paying), CR 606.4 (loyalty costs), CR 107.5 and 107.14 ({T}/{Q} and {E}), CR 701.21a (sacrifice), CR 701.9 (discard),
 * CR 701.17 (mill), CR 702.122 (crew: tap creatures with total power), CR 122.1 (counters). Returns every prefix of the list (the chart picks the one that ends at the colon or the end of the clause).
 */
import type { CostDef, CostPart, Count, ObjectFilter, Quantity, ZoneName } from '../../types/ability';
import type { ManaCost } from '../../types/mana';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, anyPhraseAt, canonicalJson, dedupe, numberAt, phraseAt } from './core';
import { npAlts } from './filter';

const W_SAC = P('sacrifice');
const W_DISCARD = P('discard');
const W_EXILE = P('exile');
const W_PAY = P('pay');
const W_LIFE = P('life');
const W_TAP = P('tap');
const W_REMOVE = P('remove');
const W_PUT = P('put');
const W_RETURN = P('return');
const W_REVEAL = P('reveal');
const W_MILL = P('mill');
const W_FROM = P('from');
const W_AND = P('and'); // std-library-1
const W_ON = P('on');
const W_AMONG = P('among');
const W_DIFFERENT_NAMES = P('with different names');
const W_YOUR_HAND = P('from your hand');
const W_AT_RANDOM = P('at random');
const W_YOUR_HAND_OBJ = P('your hand');
const W_ANY_NUMBER_OF = P('any number of');
const W_ALL = P('all'); // p2-counters-move-2
const W_COUNTER = [P('counter'), P('counters')];
const W_TO_HAND = [P("to its owner 's hand"), P("to their owner 's hand"), P("to your hand"), P("to their owners ' hands"), P("to their owner 's hands")];
const W_FORAGE = P('forage');
const W_EVIDENCE = P('collect evidence');
const W_WHERE_X_IS = P(', where x is'); // std-costs-1
const W_ONE_OR_MORE = P('one or more'); // std-costs-1, std-mana-1
const W_WITH_TOTAL_MV = P('with total mana value'); // std-costs-1
const W_BLIGHT = P('blight');
const W_WATERBEND = P('waterbend');
const W_TOTAL_POWER = P('with total power');
const W_OR_GREATER = [P('or greater'), P('or more')];
const SEPS = [P(', and'), P('and'), P(',')];
const W_LIFE_EQUAL_TO = P('life equal to');
const W_ENERGY_EQUAL_TO = P('an amount of {e} equal to'); // std-promote-3
const W_GET = P('get');
const W_POISON_COUNTERS = [P('poison counter'), P('poison counters')];

/** FAST5X E27 (CR 122.1f, 702.21a): "get N poison counters" as a cost: the paying player gets them. */
function getPoison(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_GET);
  if (e < 0) return out;
  const counts: { end: number; amount: Quantity }[] = [];
  const t = ctx.toks[e]?.norm;
  if (t === 'a' || t === 'an') counts.push({ end: e + 1, amount: 1 });
  for (const c of numCount(ctx, e)) counts.push({ end: c.end, amount: c.count as Quantity });
  for (const c of counts) {
    const w = anyPhraseAt(ctx, c.end, W_POISON_COUNTERS);
    if (w >= 0) out.push({ end: w, value: { part: { kind: 'getCounters', counter: 'poison', amount: c.amount } } satisfies Frag });
  }
  return out;
}

interface Frag { mana?: ManaCost; tap?: true; untap?: true; loyalty?: number; part?: CostPart; parts?: CostPart[] }

function isXQty(v: unknown): v is Quantity { return typeof v === 'number' || (typeof v === 'object' && v !== null && (v as { q?: string }).q === 'X'); }

/** "2", "X", "two" in front of a plural noun: a count (not the article). */
function numCount(ctx: HoleCtx, pos: number): { end: number; count: Count }[] {
  const t = ctx.toks[pos];
  if (t === undefined) return [];
  if (t.kind === 'X') return [{ end: pos + 1, count: { q: 'X' } }];
  const n = numberAt(ctx, pos);
  return n === undefined ? [] : [{ end: pos + 1, count: n }];
}

interface Counted { end: number; count: Count; filter: ObjectFilter; flags: string[] }

/**
 * "a creature", "another creature you control", "two untapped Elves", "X cards", "any number of creatures": the object phrase of a cost part and how many.
 * Singular phrases need an article, plural ones a number (a bare noun is not a cost object).
 */
function counted(ctx: HoleCtx, pos: number): Counted[] {
  const out: Counted[] = [];
  const t = ctx.toks[pos]?.norm;
  if (t === 'a' || t === 'an') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular') out.push({ end: n.end, count: 1, filter: n.filter, flags: n.flags });
  if (t === 'another') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular') out.push({ end: n.end, count: 1, filter: { ...n.filter, other: true }, flags: n.flags });
  for (const c of numCount(ctx, pos)) for (const n of npAlts(ctx, c.end)) if (n.number === 'plural') out.push({ end: n.end, count: c.count, filter: n.filter, flags: n.flags });
  const an = phraseAt(ctx, pos, W_ANY_NUMBER_OF);
  if (an >= 0) for (const n of npAlts(ctx, an)) if (n.number === 'plural') out.push({ end: n.end, count: 'any', filter: n.filter, flags: n.flags });
  return out;
}

const nonEmpty = (f: ObjectFilter): ObjectFilter | undefined => (Object.keys(f).length === 0 ? undefined : f);

function without(f: ObjectFilter, ...keys: (keyof ObjectFilter)[]): ObjectFilter {
  const g: ObjectFilter = { ...f };
  for (const k of keys) delete g[k];
  return g;
}

const W_SAC_OR = P('or');

function sacrifice(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_SAC);
  if (e < 0) return out;
  if (ctx.toks[e]?.kind === 'SELF') out.push({ end: e + 1, value: { part: { kind: 'sacrifice', filter: { self: true }, count: 1, self: true } } satisfies Frag });
  // r4-static (CR 201.5a, 701.21a): "Sacrifice Blazing Torch" in an ability the Equipment grants: the granting object itself (types: ObjRef grantor)
  if (ctx.toks[e]?.kind === 'GRANTOR') out.push({ end: e + 1, value: { part: { kind: 'sacrifice', filter: { is: { ref: 'grantor' } }, count: 1 } } satisfies Frag });
  // std-mana-1 (CR 601.2b, 118.3): "Sacrifice one or more artifacts": an announced count, at least one
  const oom = phraseAt(ctx, e, W_ONE_OR_MORE);
  if (oom >= 0) for (const n of npAlts(ctx, oom)) if (n.number === 'plural') out.push({ end: n.end, value: { part: { kind: 'sacrifice', filter: n.filter, count: 'any', atLeast: 1 } } satisfies Frag });
  for (const c of counted(ctx, e)) {
    out.push({ end: c.end, value: { part: { kind: 'sacrifice', filter: c.filter, count: c.count } } satisfies Frag });
    // r3-cost (CR 118.3, 201.2): "sacrifice three artifact tokens with different names"
    const named = typeof c.count === 'number' && c.count > 1 ? phraseAt(ctx, c.end, W_DIFFERENT_NAMES) : -1;
    if (named >= 0) out.push({ end: named, value: { part: { kind: 'sacrifice', filter: c.filter, count: c.count, distinctNames: true } } satisfies Frag });
    // cmd1 (CR 701.21a, 118.3): "Sacrifice another creature or an artifact": ONE permanent that is either, each description with its own article (the "another"
    // is the creature's only: an artifact may be the source itself)
    const or = c.count === 1 ? phraseAt(ctx, c.end, W_SAC_OR) : -1;
    if (or < 0) continue;
    for (const d of counted(ctx, or)) {
      if (d.count !== 1) continue;
      out.push({ end: d.end, value: { part: { kind: 'sacrifice', filter: { anyOf: [c.filter, d.filter] }, count: 1 } } satisfies Frag, ...(c.flags.length + d.flags.length > 0 ? { flags: [...c.flags, ...d.flags] } : {}) });
    }
  }
  return out;
}

function discard(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_DISCARD);
  if (e < 0) return out;
  if (ctx.toks[e]?.kind === 'SELF') out.push({ end: e + 1, value: { part: { kind: 'discard', count: 1, self: true } } satisfies Frag });
  const hand = phraseAt(ctx, e, W_YOUR_HAND_OBJ);
  if (hand >= 0) out.push({ end: hand, value: { part: { kind: 'discard', count: 'any', hand: true } } satisfies Frag });
  for (const c of counted(ctx, e)) {
    const f = nonEmpty(without(c.filter, 'isCard'));
    const base = { kind: 'discard', count: c.count, ...(f ? { filter: f } : {}) } as const;
    out.push({ end: c.end, value: { part: base } satisfies Frag });
    const r = phraseAt(ctx, c.end, W_AT_RANDOM);
    if (r >= 0) out.push({ end: r, value: { part: { ...base, random: true } } satisfies Frag });
  }
  return out;
}

function exile(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_EXILE);
  if (e < 0) return out;
  if (ctx.toks[e]?.kind === 'SELF') {
    const after = e + 1;
    let zoneEnd = -1;
    for (const z of ctx.call('Zone', phraseAt(ctx, after, W_FROM) >= 0 ? after + 1 : -1)) {
      const zv = z.value as { zone: ZoneName; owner?: unknown };
      if (zv.owner === 'you') { out.push({ end: z.end, value: { part: { kind: 'exileFrom', zone: zv.zone, count: 1, self: true } } satisfies Frag }); zoneEnd = z.end; }
    }
    // "exile ~" with no zone: the ability functions on the battlefield unless it says otherwise (CR 113.6)
    if (zoneEnd < 0) out.push({ end: after, value: { part: { kind: 'exileFrom', zone: 'battlefield', count: 1, self: true } } satisfies Frag, flags: ['assumed:zone=battlefield'] });
    const hand = phraseAt(ctx, after, W_YOUR_HAND); // kept for symmetry with the Zone hole: "from your hand"
    if (hand >= 0 && zoneEnd < 0) out.push({ end: hand, value: { part: { kind: 'exileFrom', zone: 'hand', count: 1, self: true } } satisfies Frag });
    // std-library-1 (CR 118.3, 113.6k, 201.2): "Exile this card and two other cards named Say Its Name from your graveyard" (Say Its Name): ~ and N OTHER cards of
    // your graveyard, the zone said once after both; two parts (the source's own, then the others'), so the ability functions in the graveyard. Only "other" cards
    // (never the source a second time) of your own graveyard
    const and = phraseAt(ctx, after, W_AND);
    if (and >= 0) {
      for (const c of counted(ctx, and)) {
        if (c.filter.zone !== 'graveyard' || c.filter.owner !== 'you' || c.filter.other !== true || c.count === 1) continue;
        const f = nonEmpty(without(c.filter, 'isCard', 'zone', 'owner'));
        out.push({ end: c.end, value: { parts: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, self: true }, { kind: 'exileFrom', zone: 'graveyard', count: c.count, ...(f ? { filter: f } : {}) }] } satisfies Frag });
      }
    }
  }
  // std-costs-1 (CR 118.3, 107.3a, 202.3; Fabrication Foundry): "Exile one or more other artifacts you control with total mana value X": permanents you control,
  // at least one, whose mana values add up to exactly X (announced with the ability)
  const oneOrMore = phraseAt(ctx, e, W_ONE_OR_MORE);
  if (oneOrMore >= 0) for (const n of npAlts(ctx, oneOrMore)) {
    if (n.number !== 'plural' || n.filter.controller !== 'you' || n.filter.zone !== undefined) continue;
    const tm = phraseAt(ctx, n.end, W_WITH_TOTAL_MV);
    if (tm < 0 || ctx.toks[tm]?.kind !== 'X') continue;
    out.push({ end: tm + 1, value: { part: { kind: 'exileFrom', zone: 'battlefield', count: 'any', atLeast: 1, filter: n.filter, totalManaValue: { q: 'X' } } } satisfies Frag, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
  }
  // std-control-3 (CR 201.5a, 406.1): "Exile The Dominion Bracelet" in an ability the Equipment grants: the granting object, from the battlefield (as "Sacrifice ¤")
  if (ctx.toks[e]?.kind === 'GRANTOR') out.push({ end: e + 1, value: { part: { kind: 'exileFrom', zone: 'battlefield', count: 1, filter: { is: { ref: 'grantor' }, controller: 'you' } } } satisfies Frag });
  for (const c of counted(ctx, e)) {
    const z: ZoneName = (c.filter.zone as ZoneName | undefined) ?? 'battlefield';
    if (Array.isArray(c.filter.zone) || c.filter.zone === 'any') continue;
    if (c.filter.zone === undefined && c.flags.includes('zone-unstated')) continue; // "exile a card": from where?
    if (c.filter.owner !== undefined && c.filter.owner !== 'you') continue; // only your own cards can be exiled as a cost from a hidden or owned zone
    // the part has no owner field, so "from a graveyard" (any graveyard) would silently read as "from your graveyard" (CR 400.3): only "your" parses
    if (z !== 'battlefield' && c.filter.owner !== 'you') continue;
    const f = nonEmpty(without(c.filter, 'isCard', 'zone', ...(z === 'battlefield' ? [] : (['owner'] as const))));
    out.push({ end: c.end, value: { part: { kind: 'exileFrom', zone: z, count: c.count, ...(f ? { filter: f } : {}) } } satisfies Frag });
    // std-cardcopy-7 (CR 118.3, 107.4): "Exile any number of black cards from your graveyard with fifteen or more black mana symbols among their mana costs" (Baron
    // Helmut Zemo): the cards chosen have together at least that many mana symbols of the color (`total`); only "any number of" cards from your graveyard
    const w = c.count === 'any' && z === 'graveyard' ? phraseAt(ctx, c.end, W_WITH) : -1;
    if (w >= 0) for (const n of ctx.call('Count', w)) {
      const om = phraseAt(ctx, n.end, W_OR_MORE);
      const color = om >= 0 ? COLOR_LETTER[ctx.toks[om]?.norm ?? ''] : undefined;
      const e2 = color !== undefined ? phraseAt(ctx, om + 1, W_SYMBOLS_AMONG_COSTS) : -1;
      if (e2 >= 0 && typeof n.value === 'number') out.push({ end: e2, value: { part: { kind: 'exileFrom', zone: z, count: 'any', ...(f ? { filter: f } : {}), symbolTotal: { color: color!, atLeast: n.value } } } satisfies Frag });
    }
  }
  return out;
}

const W_WITH = P('with'); // std-cardcopy-7
const W_OR_MORE = P('or more');
const W_SYMBOLS_AMONG_COSTS = P('mana symbols among their mana costs');
const COLOR_LETTER: Readonly<Record<string, 'W' | 'U' | 'B' | 'R' | 'G'>> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function pay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_PAY);
  if (e < 0) return out;
  for (const q of ctx.call('Qty', e)) {
    if (phraseAt(ctx, q.end, W_LIFE) >= 0) out.push({ end: q.end + 1, value: { part: { kind: 'payLife', amount: q.value as Quantity } } satisfies Frag });
    if (ctx.toks[q.end]?.norm === '{e}') out.push({ end: q.end + 1, value: { part: { kind: 'payEnergy', amount: q.value as Quantity } } satisfies Frag });
  }
  // FAST5X E27 (CR 119.4, 702.21a): "pay life equal to ~'s power" (the amount is read when the cost is paid, CR 608.2h)
  const eq = phraseAt(ctx, e, W_LIFE_EQUAL_TO);
  if (eq >= 0) for (const q of ctx.call('Qty', eq)) if (typeof q.value === 'object') out.push({ end: q.end, value: { part: { kind: 'payLife', amount: q.value as Quantity } } satisfies Frag });
  // std-promote-3 (CR 107.14, 608.2h): "pay an amount of {E} equal to its mana value", the same as after "pay" in `symbols` below
  const ee = phraseAt(ctx, e, W_ENERGY_EQUAL_TO);
  if (ee >= 0) for (const q of ctx.call('Qty', ee)) if (typeof q.value === 'object') out.push({ end: q.end, value: { part: { kind: 'payEnergy', amount: q.value as Quantity } } satisfies Frag });
  let p = e;
  while (ctx.toks[p]?.norm === '{e}') p++;
  if (p > e) out.push({ end: p, value: { part: { kind: 'payEnergy', amount: p - e } } satisfies Frag });
  return out;
}

const W_ENCHANTED_PERMANENT = [P('enchanted creature'), P('enchanted land'), P('enchanted artifact'), P('enchanted permanent')]; // p2-cost-parts-1

function tapUntapped(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_TAP);
  if (e < 0) return out;
  // r4-static (CR 201.5a, 701.26a): "Tap Fishing Pole" in an ability the Equipment grants: the granting object, untapped (types: ObjRef grantor)
  if (ctx.toks[e]?.kind === 'GRANTOR') out.push({ end: e + 1, value: { part: { kind: 'tapUntapped', filter: { is: { ref: 'grantor' } }, count: 1 } } satisfies Frag });
  // p2-cost-parts-1 (CR 303.4, 701.26a, 602.2b): "Tap enchanted creature" in an Aura's ability: the permanent the Aura is attached to, untapped
  const ench = anyPhraseAt(ctx, e, W_ENCHANTED_PERMANENT);
  if (ench >= 0) out.push({ end: ench, value: { part: { kind: 'tapUntapped', filter: { is: { ref: 'attachedTo' } }, count: 1 } } satisfies Frag });
  for (const c of counted(ctx, e)) {
    if (c.filter.tapped !== false) continue; // "untapped" must be stated
    const other = c.filter.other === true;
    const f = without(c.filter, 'tapped', 'other');
    out.push({ end: c.end, value: { part: { kind: 'tapUntapped', filter: f, count: c.count, ...(other ? { other: true } : {}) } } satisfies Frag });
    // crew style: "tap any number of untapped creatures you control with total power N or greater"
    if (c.count === 'any') {
      const tp = phraseAt(ctx, c.end, W_TOTAL_POWER);
      if (tp >= 0) for (const q of ctx.call('Qty', tp)) {
        const g = anyPhraseAt(ctx, q.end, W_OR_GREATER);
        if (g >= 0) out.push({ end: g, value: { part: { kind: 'tapPower', filter: f, power: q.value as Quantity, ...(other ? { other: true } : {}) } } satisfies Frag });
      }
    }
  }
  return out;
}

const W_UNTAP = P('untap'); // p2-cost-parts-1

/**
 * p2-cost-parts-1 (CR 118.3, 701.26b, 602.2b): "Untap a tapped creature you control", "Untap two tapped blue creatures you control": tapped permanents you control,
 * a fixed count; "tapped" and "you control" must be stated (only your own permanents pay a cost, and an untapped one can't be untapped).
 */
function untapTapped(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_UNTAP);
  if (e < 0) return out;
  for (const c of counted(ctx, e)) {
    if (c.filter.tapped !== true || c.filter.controller !== 'you' || typeof c.count !== 'number' || c.filter.other !== undefined || c.filter.zone !== undefined) continue;
    out.push({ end: c.end, value: { part: { kind: 'untapTapped', filter: without(c.filter, 'tapped'), count: c.count } } satisfies Frag, ...(c.flags.length > 0 ? { flags: c.flags } : {}) });
  }
  return out;
}

/** Target of "from ..." / "on ...": `~` or an article-led object phrase. */
function counterHolders(ctx: HoleCtx, pos: number): { end: number; self: boolean; filter?: ObjectFilter }[] {
  const out: { end: number; self: boolean; filter?: ObjectFilter }[] = [];
  if (ctx.toks[pos]?.kind === 'SELF') out.push({ end: pos + 1, self: true });
  for (const c of counted(ctx, pos)) if (c.count === 1) out.push({ end: c.end, self: false, filter: c.filter });
  return out;
}

/** r3-cost: "among <permanents>" after "from" (a plural noun phrase: "among artifacts you control", "among creatures you control"). */
function amongHolders(ctx: HoleCtx, pos: number): { end: number; filter: ObjectFilter }[] {
  const a = phraseAt(ctx, pos, W_AMONG);
  if (a < 0) return [];
  return ctx.call('Filter', a).map((f) => ({ end: f.end, filter: f.value as ObjectFilter }));
}

const W_AND_SACRIFICE_IT = P('and sacrifice it'); // p2-cost-parts-1
const W_AND_RETURN_IT = P('and return it'); // p2-cost-parts-1

/**
 * p2-cost-parts-1 (CR 118.3, 602.2b, 701.21a): after a part paid with ~ itself ("Remove three quest counters from ~"), "and sacrifice it", "and exile it" and
 * "and return it to its owner's hand": a second part on ~, "it" being the one object the cost names. Only after a part on ~ (the caller checks).
 */
function selfThenIt(ctx: HoleCtx, pos: number): { end: number; part: CostPart }[] {
  const out: { end: number; part: CostPart }[] = [];
  const s = phraseAt(ctx, pos, W_AND_SACRIFICE_IT);
  if (s >= 0) out.push({ end: s, part: { kind: 'sacrifice', filter: { self: true }, count: 1, self: true } });
  const x = phraseAt(ctx, pos, W_AND_EXILE_IT);
  if (x >= 0) out.push({ end: x, part: { kind: 'exileFrom', zone: 'battlefield', count: 1, self: true } });
  const r = phraseAt(ctx, pos, W_AND_RETURN_IT);
  const h = r >= 0 ? anyPhraseAt(ctx, r, W_TO_HAND) : -1;
  if (h >= 0) out.push({ end: h, part: { kind: 'returnToHand', filter: { self: true }, count: 1, self: true } });
  return out;
}

function counters(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const handle = (lead: readonly string[], prep: readonly string[], kind: 'removeCounters' | 'putCounters'): void => {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) return;
    const countAt: { end: number; count: Quantity }[] = [];
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') countAt.push({ end: e + 1, count: 1 });
    for (const c of numCount(ctx, e)) countAt.push({ end: c.end, count: c.count as Quantity });
    // std-rx5 (CR 107.1c, 602.2b): "Remove any number of +1/+1 counters from ~": as many as the payer chooses (the ability's X, `anyNumber`), only from ~ itself
    if (kind === 'removeCounters') {
      // p2-counters-move-2 (CR 118.3, 107.3a, 602.2b): "Remove all charge counters from ~": every counter of that kind on ~ itself, the ability's X with no choice (`all`)
      const al = phraseAt(ctx, e, W_ALL);
      if (al >= 0) {
        for (const k of ctx.call('CounterKind', al)) {
          const w = phraseAt(ctx, k.end, P('counters'));
          const pe = w >= 0 ? phraseAt(ctx, w, prep) : -1;
          if (pe >= 0 && ctx.toks[pe]?.kind === 'SELF') {
            out.push({ end: pe + 1, value: { part: { kind, counter: k.value as string, count: { q: 'X' }, self: true, all: true } } satisfies Frag, ...(k.weak ? { weak: k.weak } : {}) });
          }
        }
      }
      const an = phraseAt(ctx, e, W_ANY_NUMBER_OF);
      if (an >= 0) {
        for (const k of ctx.call('CounterKind', an)) {
          const w = phraseAt(ctx, k.end, P('counters'));
          const pe = w >= 0 ? phraseAt(ctx, w, prep) : -1;
          if (pe >= 0 && ctx.toks[pe]?.kind === 'SELF') {
            out.push({ end: pe + 1, value: { part: { kind, counter: k.value as string, count: { q: 'X' }, self: true, anyNumber: true } } satisfies Frag, ...(k.weak ? { weak: k.weak } : {}) });
          }
        }
      }
    }
    for (const c of countAt) {
      for (const k of ctx.call('CounterKind', c.end)) {
        const w = anyPhraseAt(ctx, k.end, W_COUNTER);
        const pe = w >= 0 ? phraseAt(ctx, w, prep) : -1;
        if (pe < 0) continue;
        for (const h of counterHolders(ctx, pe)) {
          const base = { kind, counter: k.value as string, count: c.count } as const;
          const part: CostPart = h.self ? { ...base, self: true } : { ...base, ...(h.filter ? { filter: h.filter } : {}) };
          out.push({ end: h.end, value: { part } satisfies Frag, ...(k.weak ? { weak: k.weak } : {}) });
          // p2-cost-parts-1 (CR 118.3, 602.2b): "Remove three quest counters from ~ and sacrifice it": two parts on ~ itself, the second said with "it"
          if (h.self && kind === 'removeCounters') for (const t of selfThenIt(ctx, h.end)) out.push({ end: t.end, value: { parts: [part, t.part] } satisfies Frag, ...(k.weak ? { weak: k.weak } : {}) });
        }
        // r3-cost (CR 118.3, 122.1): "remove two +1/+1 counters from among artifacts you control": that many in all, from any of them
        if (kind === 'removeCounters') for (const h of amongHolders(ctx, pe)) out.push({ end: h.end, value: { part: { kind, counter: k.value as string, count: c.count, filter: h.filter, among: true } } satisfies Frag, ...(k.weak ? { weak: k.weak } : {}) });
      }
      // CLOUD std-ecl (CR 122.1, 118.3): "Remove two counters from this creature" names no kind: counters of any kinds, the payer's choice (counter 'any')
      if (kind !== 'removeCounters') continue;
      const w = anyPhraseAt(ctx, c.end, W_COUNTER);
      const pe = w >= 0 ? phraseAt(ctx, w, prep) : -1;
      if (pe < 0) continue;
      for (const h of counterHolders(ctx, pe)) {
        const base = { kind, counter: 'any', count: c.count } as const;
        const part: CostPart = h.self ? { ...base, self: true } : { ...base, ...(h.filter ? { filter: h.filter } : {}) };
        out.push({ end: h.end, value: { part } satisfies Frag });
      }
      for (const h of amongHolders(ctx, pe)) out.push({ end: h.end, value: { part: { kind, counter: 'any', count: c.count, filter: h.filter, among: true } } satisfies Frag }); // r3-cost
    }
  };
  handle(W_REMOVE, W_FROM, 'removeCounters');
  handle(W_PUT, W_ON, 'putCounters');
  return out;
}

function returnToHand(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_RETURN);
  if (e < 0) return out;
  const tail = (p: number): number => anyPhraseAt(ctx, p, W_TO_HAND);
  if (ctx.toks[e]?.kind === 'SELF') { const t = tail(e + 1); if (t >= 0) out.push({ end: t, value: { part: { kind: 'returnToHand', filter: { self: true }, count: 1, self: true } } satisfies Frag }); }
  for (const c of counted(ctx, e)) { const t = tail(c.end); if (t >= 0) out.push({ end: t, value: { part: { kind: 'returnToHand', filter: c.filter, count: c.count } } satisfies Frag }); }
  return out;
}

function reveal(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_REVEAL);
  if (e < 0) return out;
  if (ctx.toks[e]?.kind === 'SELF') { const t = phraseAt(ctx, e + 1, W_YOUR_HAND); if (t >= 0) out.push({ end: t, value: { part: { kind: 'reveal', zone: 'hand', count: 1, self: true } } satisfies Frag }); }
  for (const c of counted(ctx, e)) {
    const t = phraseAt(ctx, c.end, W_YOUR_HAND);
    if (t < 0) continue;
    const f = nonEmpty(without(c.filter, 'isCard'));
    out.push({ end: t, value: { part: { kind: 'reveal', zone: 'hand', count: c.count, ...(f ? { filter: f } : {}) } } satisfies Frag });
  }
  return out;
}

const W_BEHOLD = P('behold');
const W_AND_EXILE_IT = P('and exile it');

/** A quality as "behold" names it (CR 701.4a): only types, subtypes and supertypes ("a Dragon", "a Gamma creature", "a legendary creature"). */
function quality(f: ObjectFilter): ObjectFilter | null {
  const g = without(f, 'isCard', 'zone');
  return Object.keys(g).length > 0 && Object.keys(g).every((k) => k === 'types' || k === 'subtypes' || k === 'supertypes') ? g : null;
}

/**
 * FAST5X E11 (CR 701.4a): "behold a Kithkin" (reveal a Kithkin card from your hand or choose a Kithkin you control) and "behold a Goblin and exile it" (exile
 * the card or permanent beheld; the Champions of Lorwyn link it to "the exiled card", CR 607.2a). One fixed count; the quality is a type, subtype or supertype.
 */
function behold(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_BEHOLD);
  if (e < 0) return out;
  for (const c of counted(ctx, e)) {
    // CLOUD std-ecl (CR 701.4a): "Behold three Elementals" (Kindle the Inner Flame's flashback cost): that many different objects of the quality, each a permanent
    // you control or a card revealed from your hand (rules/cost-pick.ts picks `count` of them); "and exile it" only for one
    if (typeof c.count !== 'number' || c.count < 1) continue;
    const q = quality(c.filter);
    if (q === null) continue;
    const flags = c.flags.filter((f) => f !== 'zone-unstated');
    out.push({ end: c.end, value: { part: { kind: 'behold', filter: q, count: c.count } } satisfies Frag, ...(flags.length > 0 ? { flags } : {}) });
    if (c.count !== 1) continue;
    const x = phraseAt(ctx, c.end, W_AND_EXILE_IT);
    if (x >= 0) out.push({ end: x, value: { part: { kind: 'behold', filter: q, count: 1, exile: true } } satisfies Frag, ...(flags.length > 0 ? { flags } : {}) });
  }
  return out;
}

function actionsAndMill(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const m = phraseAt(ctx, pos, W_MILL);
  if (m >= 0) for (const q of ctx.call('Qty', m)) {
    const c = anyPhraseAt(ctx, q.end, [P('card'), P('cards')]);
    if (c >= 0) out.push({ end: c, value: { part: { kind: 'mill', count: q.value as Quantity } } satisfies Frag });
  }
  const fo = phraseAt(ctx, pos, W_FORAGE);
  if (fo >= 0) out.push({ end: fo, value: { part: { kind: 'action', action: 'forage' } } satisfies Frag });
  for (const [lead, action] of [[W_EVIDENCE, 'collectEvidence'], [W_BLIGHT, 'blight']] as const) {
    const e = phraseAt(ctx, pos, lead);
    if (e >= 0) for (const c of numCount(ctx, e)) if (isXQty(c.count)) out.push({ end: c.end, value: { part: { kind: 'action', action, arg: c.count } } satisfies Frag });
  }
  // std-costs-1 (CR 701.59a, 107.3, 601.2f; Urgent Necropsy): "collect evidence X, where X is the total mana value of the permanents ~ targets": the one computed
  // amount the cast path reads as the total cost is determined (rules/cost.ts, actions/cast.ts#withTargetTotals); any other quantity is not read here
  const ev = phraseAt(ctx, pos, W_EVIDENCE);
  const wx = ev >= 0 && ctx.toks[ev]?.kind === 'X' ? phraseAt(ctx, ev + 1, W_WHERE_X_IS) : -1;
  if (wx >= 0) for (const q of ctx.call('Qty', wx)) {
    if ((q.value as { q?: unknown } | null)?.q !== 'spellTargetTotal') continue;
    out.push({ end: q.end, value: { part: { kind: 'action', action: 'collectEvidence', arg: q.value as Quantity } } satisfies Frag, ...(q.flags ? { flags: q.flags } : {}) });
  }
  const wb = phraseAt(ctx, pos, W_WATERBEND);
  if (wb >= 0) for (const mc of ctx.call('ManaCost', wb)) {
    const cost = mc.value as ManaCost;
    if (cost.length === 1 && cost[0]!.kind === 'generic') out.push({ end: mc.end, value: { part: { kind: 'action', action: 'waterbend', arg: cost[0]!.amount } } satisfies Frag });
    // r5-cost (CR 701.67a, 107.3a): "waterbend {X}", X announced with the cost it is part of (an activated ability's, CR 602.2b; a spell's additional cost, 601.2b)
    if (cost.length === 1 && cost[0]!.kind === 'variable' && cost[0]!.name === 'X') out.push({ end: mc.end, value: { part: { kind: 'action', action: 'waterbend', arg: { q: 'X' } } } satisfies Frag });
  }
  return out;
}

function symbols(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const t = ctx.toks[pos];
  if (t === undefined) return out;
  for (const m of ctx.call('ManaCost', pos)) out.push({ end: m.end, value: { mana: m.value as ManaCost } satisfies Frag });
  if (t.kind === 'TAP') out.push({ end: pos + 1, value: (t.norm === '{t}' ? { tap: true } : { untap: true }) satisfies Frag });
  if (t.kind === 'MOD' && /^[+-]\d+$/.test(t.norm)) out.push({ end: pos + 1, value: { loyalty: Number(t.norm) } satisfies Frag });
  if (t.kind === 'NUM' && t.norm === '0' && ctx.toks[pos + 1]?.norm === ':') out.push({ end: pos + 1, value: { loyalty: 0 } satisfies Frag });
  // std-rx33 (CR 107.14, 118.3): "you may pay {E}{E}": the template read "pay", so the cost is the run of energy symbols alone; only right after "pay" (an
  // activation cost prints "Pay {E}{E}", which `pay` reads from the verb)
  if (t.norm === '{e}' && ctx.toks[pos - 1]?.norm === 'pay') {
    let p = pos;
    while (ctx.toks[p]?.norm === '{e}') p++;
    out.push({ end: p, value: { part: { kind: 'payEnergy', amount: p - pos } } satisfies Frag });
  }
  // std-promote-3 (CR 107.14, 118.3, 608.2h): "... unless you pay an amount of {E} equal to its mana value" (Satya, Aetherflux Genius): as many energy counters as
  // the quantity, read when the cost is paid; only right after "pay", and only a quantity the sentence states (never a bare number)
  const eq = ctx.toks[pos - 1]?.norm === 'pay' ? phraseAt(ctx, pos, W_ENERGY_EQUAL_TO) : -1;
  if (eq >= 0) for (const q of ctx.call('Qty', eq)) if (typeof q.value === 'object') out.push({ end: q.end, value: { part: { kind: 'payEnergy', amount: q.value as Quantity } } satisfies Frag });
  // T55 (CR 606.4): inside quotes a loyalty cost is bracketed, "[−2]: Create ..." / "[0]: ..." (a permanent or token that has the ability)
  if (t.kind === 'PUNCT' && t.norm === '[' && ctx.toks[pos + 2]?.norm === ']') {
    const n = ctx.toks[pos + 1]!;
    if (n.kind === 'MOD' && /^[+-]\d+$/.test(n.norm)) out.push({ end: pos + 3, value: { loyalty: Number(n.norm) } satisfies Frag });
    else if (n.kind === 'NUM' && n.norm === '0') out.push({ end: pos + 3, value: { loyalty: 0 } satisfies Frag });
  }
  return out;
}

/**
 * std-combat-5 (CR 608.2d, 607.2d, 118.3): "Reveal the creature type you chose" (A Killer Among Us): reveal the creature type the face's choice holds (its link `type`,
 * the link of "As ~ enters, choose a creature type" and of eff.stdcombat5.secretlyChoose.creatureTypeList).
 */
const W_REVEAL_CHOSEN_TYPE = P('reveal the creature type you chose');
function revealChosen(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_REVEAL_CHOSEN_TYPE);
  return e >= 0 ? [{ end: e, value: { part: { kind: 'revealChosen', link: 'type', what: 'creatureType' } } satisfies Frag }] : [];
}

function partAt(ctx: HoleCtx, pos: number): Alt[] {
  return [...symbols(ctx, pos), ...sacrifice(ctx, pos), ...discard(ctx, pos), ...exile(ctx, pos), ...pay(ctx, pos), ...tapUntapped(ctx, pos), ...counters(ctx, pos),
    ...returnToHand(ctx, pos), ...reveal(ctx, pos), ...actionsAndMill(ctx, pos), ...behold(ctx, pos), ...getPoison(ctx, pos),
    ...revealChosen(ctx, pos), // std-combat-5
    ...untapTapped(ctx, pos)]; // p2-cost-parts-1
}

function add(cost: CostDef, f: Frag): CostDef | null {
  const out: CostDef = { ...cost, ...(cost.other ? { other: [...cost.other] } : {}) };
  if (f.mana !== undefined) { if (out.mana !== undefined) return null; out.mana = f.mana; }
  if (f.tap) { if (out.tap) return null; out.tap = true; }
  if (f.untap) { if (out.untap) return null; out.untap = true; }
  if (f.loyalty !== undefined) { if (out.loyalty !== undefined) return null; out.loyalty = f.loyalty; }
  if (f.part !== undefined) out.other = [...(out.other ?? []), f.part];
  if (f.parts !== undefined) out.other = [...(out.other ?? []), ...f.parts]; // std-library-1: one phrase, two parts
  return out;
}

export const cost: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const walk = (p: number, acc: CostDef, weak: number, flags: string[], depth: number): void => {
    if (depth > 8) return;
    for (const a of partAt(ctx, p)) {
      const next = add(acc, a.value as Frag);
      if (next === null) continue;
      const w = weak + (a.weak ?? 0);
      const fl = [...flags, ...(a.flags ?? [])];
      out.push({ end: a.end, value: next, ...(w ? { weak: w } : {}), ...(fl.length > 0 ? { flags: fl } : {}) });
      const sep = anyPhraseAt(ctx, a.end, SEPS);
      if (sep >= 0) walk(sep, next, w, fl, depth + 1);
    }
  };
  walk(pos, {}, 0, [], 0);
  // a cost with the same canonical form from two routes is one parse
  return dedupe(out.filter((a, i) => out.findIndex((b) => b.end === a.end && canonicalJson(b.value) === canonicalJson(a.value)) === i));
};

/**
 * FAST5 T56: the `DiscardDesc` hole: the card a "discard" names, with its article and noun and nothing else: "a creature card", "an instant or sorcery card", "a creature
 * card with flying" (CR 701.9a, 118.12). The value is the filter of the cost part `discard` (no `isCard`, no `zone`: the cost looks in the payer's hand, rules/cost-pick.ts),
 * `{}` for "a card". Only a CARD noun counts ("a creature" is a permanent), and the flag `zone-unstated` of the noun phrase goes: a discard states its zone, the hand.
 */
export const discardDesc: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const t = ctx.toks[pos]?.norm;
  if (t !== 'a' && t !== 'an') return out;
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.filter.zone !== undefined) continue;
    const flags = n.flags.filter((f) => f !== 'zone-unstated');
    out.push({ end: n.end, value: without(n.filter, 'isCard'), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
  }
  return out;
};
