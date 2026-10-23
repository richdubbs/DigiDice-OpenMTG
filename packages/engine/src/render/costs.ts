/**
 * Costs as text (WP2): "{2}{R}, {T}, Sacrifice a creature", "+2", "-3", "Pay 2 life". Mana first, then {T}/{Q}, then the other parts in their order
 * (design 2: `CostDef`). A loyalty cost prints as its sign and number.
 */
import type { Count, CostDef, CostPart, ObjectFilter, Quantity } from '../types/ability';
import { formatManaCost } from '../types/mana';
import { K } from './kernel';
import { countParts } from './qty';
import { withVariants, type RenderState } from './state';
import { alt, capFirst, COLOR_WORD, conj, joinList, lowerFirst, numWord, NoRenderer, pluralize, signed, withArticle, type Person } from './text';

/** "a creature", "two creatures", "any number of creatures", "X creatures" for a cost that picks things. */
function counted(f: ObjectFilter, count: Count, st: RenderState, extra: Partial<Parameters<typeof K.np>[2]> = {}): string {
  if (count === 'any') return K.np(f, st, { det: 'none', plural: true, count: 'any number of', ...extra });
  if (typeof count === 'number') {
    if (count === 1) return K.np(f, st, { det: 'a', ...extra });
    return K.np(f, st, { det: 'none', plural: true, count: numWord(count), ...extra });
  }
  return K.np(f, st, { det: 'none', plural: true, count: K.qty(count, st), ...extra });
}

function counterWord(kind: string, n: Parameters<typeof K.qty>[0] | 'all', st: RenderState): string {
  if (n === 'all') return kind === 'any' ? 'all counters' : `all ${kind} counters`;
  const one = typeof n === 'number' && n === 1;
  const noun = kind === 'any' ? 'counter' : `${kind} counter`;
  if (one) return withArticle(noun);
  const count = typeof n === 'number' ? numWord(n) : K.qty(n, st);
  return `${count} ${pluralize(noun)}`;
}

const ACTION_COST: Record<string, string> = {
  exert: 'Exert', collectEvidence: 'Collect evidence', forage: 'Forage', blight: 'Blight', waterbend: 'Waterbend', behold: 'Behold', airbend: 'Airbend', earthbend: 'Earthbend',
  discover: 'Discover', cycle: 'Cycle', harness: 'Harness', endure: 'Endure',
};

/** The key of the object an activation cost names (a fallback antecedent, render/refs.ts#obj). */
export const COST_SELF = 'cost:self';
/** FAST3 T18: the key of what a `sacrifice` part of the cost sacrificed (ObjRef `costSacrificed`, "the sacrificed creature"; render/refs.ts#obj). */
export const COST_SACRIFICED = 'cost:sacrificed';
/** CLOUD C8: the key of what a `discard` part of the cost discarded (ObjRef `costDiscarded`, "the discarded card"; render/refs.ts#obj). */
export const COST_DISCARDED = 'cost:discarded';
/** CLOUD C8: the key of what an `exileFrom` part of the cost exiled (ObjRef `costExiled`, "the exiled card"; render/refs.ts#obj). */
export const COST_EXILED = 'cost:exiled';

function part(p: CostPart, st: RenderState): string {
  // PUSH1 T2 (design 6.4: cost objects are mentions): a cost that names ~ makes it a FALLBACK antecedent: the effect may call it "it" when nothing else was
  // named (parser/lower/ability.ts#costMentions; render/refs.ts#obj)
  if ('self' in p && p.self === true) st.mentioned.add(COST_SELF);
  switch (p.kind) {
    case 'sacrifice':
      if (p.self) return 'Sacrifice ~';
      // FAST3 T18: what "the sacrificed creature" of the effect may be called (render/refs.ts#obj, `costSacrificed`)
      st.info.set(COST_SACRIFICED, { nouns: K.nounsOf(p.filter), plural: p.count !== 1 });
      if (p.count === 1 && p.filter.other === true && (p.filter.controller === undefined || p.filter.controller === 'you')) {
        // std-tdm (CR 701.21a, 118.3; family sacrifice-other-than-self): one other permanent is also "a creature [you control] ... other than ~" (only what you
        // control can be sacrificed, so "you control" says nothing more)
        const g: ObjectFilter = { ...p.filter, other: undefined, controller: undefined };
        const [another, plainOther, yoursOther] = withVariants(st, [
          (v) => `Sacrifice ${counted({ ...p.filter, controller: undefined }, p.count, v)}`,
          (v) => `Sacrifice ${K.np(g, v, { det: 'a' })} other than ~`,
          (v) => `Sacrifice ${K.np({ ...g, controller: 'you' }, v, { det: 'a' })} other than ~`,
        ]);
        return alt(another!, plainOther!, yoursOther!);
      }
      // r3-cost (CR 201.2): "... with different names"; cmd1 (CR 701.21a): "Sacrifice another creature or an artifact" (parser/holes/cost.ts#sacrifice): one
      // permanent of either description, each with its article
      // std-mana-1 (CR 601.2b): "Sacrifice one or more artifacts"
      if (p.atLeast !== undefined) {
        if (p.count !== 'any' || p.atLeast !== 1 || p.distinctNames === true) throw new NoRenderer('a sacrifice of N or more other than one or more');
        return `Sacrifice one or more ${K.np({ ...p.filter, controller: p.filter.controller === 'you' ? undefined : p.filter.controller }, st, { det: 'none', plural: true })}`;
      }
      const whole = `Sacrifice ${counted({ ...p.filter, controller: p.filter.controller === 'you' ? undefined : p.filter.controller }, p.count, st)}${p.distinctNames === true ? ' with different names' : ''}`;
      if (p.count === 1 && p.filter.anyOf?.length === 2 && Object.keys(p.filter).every((k) => k === 'anyOf' || (p.filter as Record<string, unknown>)[k] === undefined)) {
        const [a, b] = p.filter.anyOf as [ObjectFilter, ObjectFilter];
        return alt(whole, `Sacrifice ${counted(a, 1, st)} or ${counted(b, 1, st)}`);
      }
      return whole;
    case 'payLife':
      // FAST5X E27 (CR 119.4): a computed amount is "Pay life equal to ~'s power" (Oracle's wording); a number or X is "Pay 3 life"
      if (typeof p.amount === 'object' && p.amount.q !== 'X') return alt(`Pay life equal to ${K.qty(p.amount, st)}`, `Pay ${K.qty(p.amount, st)} life`);
      return `Pay ${K.qty(p.amount, st)} life`;
    case 'discard': {
      if (p.self) return alt('Discard ~', 'Discard this card');
      // CLOUD C8: how many "the discarded card" of the effect names (render/refs.ts#obj, `costDiscarded`)
      st.info.set(COST_DISCARDED, { nouns: ['card'], plural: p.hand === true || p.count !== 1 });
      if (p.hand) return 'Discard your hand';
      const f: ObjectFilter = p.filter ?? {};
      const hasFilter = Object.values(f).some((v) => v !== undefined);
      const noun = hasFilter ? counted({ ...f, zone: 'hand' }, p.count, st, { noZone: true }) : null;
      const cards = noun ?? (p.count === 1 ? 'a card' : typeof p.count === 'number' ? `${numWord(p.count)} cards` : p.count === 'any' ? 'any number of cards' : `${K.qty(p.count, st)} cards`);
      return `Discard ${cards}${p.random ? ' at random' : ''}`;
    }
    case 'exileFrom': {
      // FAST5X E13: "Exile ~" and "Exile a creature you control" name no zone: an ability functions on the battlefield (CR 113.6, 602.2)
      if (p.orGraveyard) throw new NoRenderer("craft's materials (CR 702.167a) are written by the craft keyword line, never as a cost of their own");
      // CLOUD C8: what "the exiled card" (or "the exiled creature", a permanent exiled from the battlefield) of the effect may be called (render/refs.ts#obj, `costExiled`)
      if (!p.self) st.info.set(COST_EXILED, { nouns: p.zone === 'battlefield' ? K.nounsOf(p.filter ?? {}) : ['card'], plural: p.count !== 1 });
      if (p.zone === 'battlefield' && p.self) return 'Exile ~';
      // std-costs-1 (CR 118.3, 107.3a): "Exile one or more other artifacts you control with total mana value X" (Fabrication Foundry)
      if (p.zone === 'battlefield' && p.totalManaValue !== undefined && p.atLeast === 1 && p.count === 'any') {
        return `Exile one or more ${K.np(p.filter ?? {}, st, { det: 'none', plural: true })} with total mana value ${K.qty(p.totalManaValue, st)}`;
      }
      if (p.zone === 'battlefield' && p.atLeast === undefined) return `Exile ${counted(p.filter ?? {}, p.count, st)}`;
      const zone = p.zone === 'graveyard' ? 'your graveyard' : p.zone === 'hand' ? 'your hand' : p.zone === 'library' ? 'your library' : 'your exile';
      if (p.self && p.zone === 'stack') return 'Exile ~'; // r5-mech: the resolving spell exiles itself (CR 608.2m, 608.2n)
      if (p.self) return `Exile ~ from ${zone}`;
      const f: ObjectFilter = { ...(p.filter ?? {}), zone: p.zone };
      // std-cardcopy-7 (CR 118.3, 107.4): "Exile any number of black cards from your graveyard with fifteen or more black mana symbols among their mana costs"
      if (p.symbolTotal !== undefined) {
        if (p.count !== 'any' || p.zone !== 'graveyard') throw new NoRenderer('a total of mana symbols other than for any number of cards from your graveyard');
        return `Exile ${counted(f, p.count, st, { noZone: true })} from ${zone} with ${numWord(p.symbolTotal.atLeast)} or more ${COLOR_WORD[p.symbolTotal.color]} mana symbols among their mana costs`;
      }
      return `Exile ${counted(f, p.count, st, { noZone: true })} from ${zone}`;
    }
    case 'tapUntapped': return `Tap ${counted({ ...p.filter, tapped: false, other: p.other === true || p.filter.other }, p.count, st)}`;
    case 'untapTapped': return `Untap ${counted({ ...p.filter, tapped: true }, p.count, st)}`; // p2-cost-parts-1 (CR 701.26b)
    case 'tapPower': {
      const n = K.qty(p.power, st);
      return `Tap any number of untapped ${K.np({ ...p.filter, other: p.other === true || p.filter.other }, st, { det: 'none', plural: true })} with total power ${alt(`${n} or greater`, `${n} or more`)}`;
    }
    case 'removeCounters': {
      // r3-cost (CR 118.3): "Remove two +1/+1 counters from among artifacts you control"
      if (p.among === true) return `Remove ${counterWord(p.counter, p.count, st)} from among ${K.np(p.filter!, st, { det: 'none', plural: true })}`;
      const what = p.self ? '~' : p.filter ? K.np(p.filter, st, { det: 'a' }) : '~';
      // std-rx5 (CR 107.1c): as many as the payer chooses, the ability's X (types/ability.ts CostPart `anyNumber`)
      if (p.anyNumber === true) return `Remove any number of ${pluralize(p.counter === 'any' ? 'counter' : `${p.counter} counter`)} from ${what}`;
      // p2-counters-move-2 (CR 118.3, 107.3a): every counter of that kind on ~, the ability's X with no choice (types/ability.ts CostPart `all`)
      if (p.all === true) {
        if (!p.self || p.counter === 'any' || p.anyNumber === true) throw new NoRenderer('"remove all counters" other than of one kind from ~');
        return `Remove all ${pluralize(`${p.counter} counter`)} from ~`;
      }
      return `Remove ${counterWord(p.counter, p.count, st)} from ${what}`;
    }
    case 'putCounters': {
      const what = p.self ? '~' : p.filter ? K.np(p.filter, st, { det: 'a' }) : '~';
      return `Put ${counterWord(p.counter, p.count, st)} on ${what}`;
    }
    case 'returnToHand':
      if (p.self) return alt("Return ~ to its owner's hand", 'Return ~ to your hand');
    {
      // family owner-zone (render/equivalence.ts, CR 400.3); M6-5a: several permanents go to "their owner's hand" (Oracle's wording for a plural count)
      const whose = p.count === 1 ? ["its owner's", 'your'] : ["its owner's", 'your', "their owner's", "their owners'"];
      return `Return ${counted(p.filter, p.count, st)} to ${alt(...whose)} hand`;
    }
    case 'reveal': {
      if (p.self) return 'Reveal ~ from your hand';
      const f: ObjectFilter = { ...(p.filter ?? {}), zone: 'hand' };
      // FAST4 T24 (family reveal-in-hand): "Reveal a white card in your hand" reveals a card from your hand (morph costs, CR 702.37a, 701.20a)
      return `Reveal ${counted(f, p.count, st, { noZone: true })} ${alt('from', 'in')} your hand`;
    }
    // FAST5X E11 (CR 701.4a): "Behold a Kithkin", "Behold an Elf and exile it" (Champions of Lorwyn)
    case 'behold': {
      const plainBehold = `Behold ${counted(p.filter, p.count, st, { noZone: true })}${p.exile ? ' and exile it' : ''}`;
      // r3-cost (CR 701.4a; family behold-spelled-out): one object of a quality is also what beholding is, "choose a creature you control or reveal a creature card
      // from your hand" (Monstrous Emergence)
      const types = Object.keys(p.filter).filter((k) => (p.filter as Record<string, unknown>)[k] !== undefined);
      if (p.count !== 1 || p.exile || p.link !== undefined || !types.every((k) => k === 'types' || k === 'subtypes')) return plainBehold;
      const noun = K.np(p.filter, st, { det: 'none' });
      return alt(plainBehold, `Choose ${withArticle(noun)} you control or reveal ${withArticle(noun)} card from your hand`);
    }
    // std-costs-2 (CR 601.2b): "choose a creature you control or a warped creature card you own in exile" (Close Encounter): one object, of any of the filters
    case 'chooseObject': {
      if (p.count !== 1 || p.filters.length < 2) throw new NoRenderer('a chosen-object cost of other than one object of two or more descriptions');
      return `Choose ${joinList(p.filters.map((f) => K.np(f, st, { det: 'a' })), 'or')}`;
    }
    case 'mill': return `Mill ${typeof p.count === 'number' ? numWord(p.count) : K.qty(p.count, st)} ${p.count === 1 ? 'card' : 'cards'}`;
    // CMD5 (family energy-count-words, CR 107.14): Oracle writes a large fixed amount as a number word ("Pay six {E}", "Pay eight {E}"); the symbols stay a reading
    case 'revealChosen': return 'reveal the creature type you chose'; // std-combat-5 (CR 608.2d)
    case 'payEnergy':
      // std-promote-3 (CR 107.14, 608.2h): a computed amount is "Pay an amount of {E} equal to its mana value" (Oracle's wording, as `payLife` above); X stays "Pay X {E}"
      if (typeof p.amount === 'object' && p.amount.q !== 'X') return alt(`Pay an amount of {E} equal to ${K.qty(p.amount, st)}`, `Pay ${K.qty(p.amount, st)} {E}`);
      return `Pay ${typeof p.amount === 'number' ? (p.amount >= 4 ? alt('{E}'.repeat(p.amount), `${numWord(p.amount)} {E}`) : '{E}'.repeat(p.amount)) : `${K.qty(p.amount, st)} {E}`}`;
    case 'action': {
      const word = ACTION_COST[p.action] ?? capFirst(p.action.replace(/([A-Z])/g, ' $1').toLowerCase());
      if (p.action === 'exert') return 'Exert ~';
      // FAST5X E10: "waterbend {N}" names its cost as mana symbols (CR 701.67a: "Waterbend [cost]")
      if (p.action === 'waterbend' && p.arg !== undefined) return `${word} {${K.qty(p.arg, st)}}`;
      // std-costs-1 (CR 701.59a, 107.3): a computed amount is "Collect evidence X, where X is <it>" (Urgent Necropsy)
      if (p.action === 'collectEvidence' && typeof p.arg === 'object' && p.arg.q !== 'X') return `${word} X, where X is ${K.qty(p.arg, st)}`;
      return p.arg === undefined ? word : `${word} ${K.qty(p.arg, st)}`;
    }
    // FAST5X E27 (CR 122.1f, 702.21a): "Get five poison counters"
    case 'getCounters': return `Get ${counterWord(p.counter, p.amount, st)}`;
    // FAST5X E27 (CR 601.2b, 118.12a): a choice between costs, each written as an instruction: "Pay {3} or discard a card", "Discard a card or pay {2}"
    case 'oneOf': {
      if (p.options.length < 2) throw new NoRenderer('a choice between fewer than two costs');
      return capFirst(p.options.map((o) => costVerbs(o, st, 'you')).join(' or '));
    }
    case 'manual': return p.text;
    default: throw new NoRenderer(`cost part ${(p as { kind: string }).kind}`);
  }
}

/** FAST5X E10: a waterbend cost (CR 701.67a) is written where mana is, before {T} ("Waterbend {3}, {T}: ..."). */
const isWaterbend = (p: CostPart): boolean => p.kind === 'action' && p.action === 'waterbend';

/** p2-cost-parts-1: a part on ~ itself as said after "and" with "it" ("sacrifice it", "exile it", "return it to its owner's hand"), or null. */
function selfItPhrase(q: CostPart): string | null {
  if (q.kind === 'sacrifice' && q.self === true) return 'sacrifice it';
  if (q.kind === 'exileFrom' && q.self === true && q.zone === 'battlefield' && q.link === undefined) return 'exile it';
  if (q.kind === 'returnToHand' && q.self === true) return "return it to its owner's hand";
  return null;
}

/** The parts of a cost in the order they are written: mana, loyalty, waterbend, {T}, {Q}, then the other parts. */
export function costParts(c: CostDef, st: RenderState): string[] {
  const out: string[] = [];
  if (c.mana !== undefined && c.mana.length > 0) out.push(formatManaCost(c.mana));
  // T55 (CR 606.4): a loyalty cost inside quotes is written in brackets, "[−2]: Create ..." (Oracle's wording of an ability a permanent or token has), as well as bare
  // std-r9 (CR 606.4): or "−X" (`loyaltyX`, the minus sign normalized)
  const lv = c.loyaltyX === true ? '-X' : c.loyalty === undefined ? undefined : c.loyalty === 0 ? '0' : signed(c.loyalty);
  if (lv !== undefined) out.push(st.depth > 0 ? alt(`[${lv}]`, lv) : lv);
  for (const p of c.other ?? []) if (isWaterbend(p)) out.push(part(p, st));
  if (c.tap === true) out.push('{T}');
  if (c.untap === true) out.push('{Q}');
  const rest = (c.other ?? []).filter((p) => !isWaterbend(p));
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i]!;
    const q = rest[i + 1];
    // std-library-1 (CR 118.3, 201.2): "Exile ~ and two other cards named Say Its Name from your graveyard" (Say Its Name): the source's own part and the other cards'
    // of the same graveyard, one verb, the zone said once (parser/holes/cost.ts#exile)
    if (p.kind === 'exileFrom' && p.zone === 'graveyard' && p.self === true && q?.kind === 'exileFrom' && q.zone === 'graveyard' && q.self !== true && q.filter?.other === true
      && q.count !== 1 && q.atLeast === undefined && q.orGraveyard === undefined && q.link === undefined && p.link === undefined) {
      st.info.set(COST_EXILED, { nouns: ['card'], plural: true });
      out.push(`Exile ~ and ${counted({ ...q.filter, zone: 'graveyard' }, q.count, st, { noZone: true })} from your graveyard`);
      i++;
      continue;
    }
    // p2-cost-parts-1 (CR 118.3; family remove-counters-and-self-it): "Remove three quest counters from ~ and sacrifice it" (also "and exile it", "and return it to
    // its owner's hand"): a part on ~ and a second part on ~ said with "it" (parser/holes/cost.ts#selfThenIt)
    const it = p.kind === 'removeCounters' && p.self === true && p.among === undefined && p.anyNumber === undefined && q !== undefined ? selfItPhrase(q) : null;
    if (it !== null) {
      const first = part(p, st);
      out.push(alt(`${first}, ${part(q!, st)}`, `${first} and ${it}`));
      i++;
      continue;
    }
    out.push(part(p, st));
  }
  return out;
}

export function cost(c: CostDef, st: RenderState): string {
  return costParts(c, st).join(', ');
}

/**
 * A cost as the verb phrases of an instruction, for a subject of this person: "pay {3}", "sacrifice a creature", "pay 2 life and discard a card".
 * Used wherever a cost is a thing a player does ("you may pay {2}", "unless that player sacrifices a creature", "as an additional cost, discard a card").
 */
export function costVerbs(c: CostDef, st: RenderState, person: Person, times?: Quantity): string {
  // r5-mech (CR 118.3, 608.2c): a resolving spell that exiles itself and named cards from your graveyard, "exile ~ and four cards named Sphinx's Approach from your
  // graveyard" (parser/templates/zz-cloud/r5-mech.json): one verb, the zone said once
  const o = c.other;
  if (times === undefined && o?.length === 2 && Object.keys(c).length === 1 && o[0]!.kind === 'exileFrom' && o[0]!.zone === 'stack' && o[0]!.self === true
    && o[1]!.kind === 'exileFrom' && o[1]!.zone === 'graveyard' && o[1]!.self !== true && o[1]!.filter !== undefined && Object.keys(o[1]!.filter).join() === 'name') {
    st.info.set(COST_EXILED, { nouns: ['card'], plural: o[1]!.count !== 1 });
    return `${conj('exile', person)} ~ and ${counted({ ...o[1]!.filter, zone: 'graveyard' }, o[1]!.count, st, { noZone: true })} from your graveyard`;
  }
  const bits = costParts(c, st).map((p) => {
    const phrase = /^[{+\-0-9]/.test(p) ? `pay ${p}` : lowerFirst(p);
    const [w, ...rest] = phrase.split(' ');
    return [conj(w!, person), ...rest].join(' ');
  });
  // FAST5 T44 (CR 118.1): consecutive payments also read as one: "pay {1}{B} and 2 life" (Oracle states the verb once for a mana payment and a life payment)
  const merged: string[] = [];
  for (const b of bits) {
    const prev = merged[merged.length - 1];
    const m = /^(pays?) (.+)$/.exec(b);
    const pm = prev === undefined ? null : /^(pays?) (.+)$/.exec(prev);
    if (m && pm) merged[merged.length - 1] = `${pm[1]} ${pm[2]} and ${m[2]}`;
    else merged.push(b);
  }
  const text = merged.length < bits.length && bits.length === 2 ? alt(joinList(bits), joinList(merged)) : joinList(bits);
  if (times === undefined) return text;
  // FAST3 T14: a payment repeated once per counted object reads "pays {1} for each artifact you control" (CR 118.12a; the count is taken when the payment is
  // made, CR 608.2h): paying the cost that many times is paying it once for each of them
  // FAST5 T59 (CR 118.12a, 107.1): "pays {2} plus an additional {1} for each Faerie you control": {1} paid (2 + the number counted) times, a fixed number of
  // generic mana plus one for each object counted (parser/templates/zz-fast5/t59.json)
  const gen1 = c.mana !== undefined && c.mana.length === 1 && c.mana[0]!.kind === 'generic' && c.mana[0]!.amount === 1 && Object.keys(c).length === 1;
  if (gen1 && typeof times === 'object' && times.q === 'math' && times.op === '+' && times.args.length === 2 && typeof times.args[0] === 'number') {
    const counted = countParts(times.args[1]!, st);
    if (counted !== null) return `${conj('pay', person)} {${times.args[0]}} plus an additional {1} for each ${counted.singular}`;
  }
  const each = countParts(times, st);
  // FAST5X E15 (CR 118.12a, 107.3): "pays mana equal to the greatest power among creatures you control": {1} that many times is that much generic mana
  const generic1 = c.mana !== undefined && c.mana.length === 1 && c.mana[0]!.kind === 'generic' && c.mana[0]!.amount === 1 && Object.keys(c).length === 1;
  // std-rx25 (CR 118.12a, 107.3a; family pays-x-where): "pays {X}, where X is the greatest power among creatures you control" is the same generic payment
  const fresh = generic1 && typeof times === 'object' ? alt(`${conj('pay', person)} mana equal to ${K.qty(times, st)}`, `${conj('pay', person)} {x}, where x is ${K.qty(times, st)}`) : null;
  if (each === null) return fresh === null ? `${text} ${K.qty(times, st)} times` : alt(`${text} ${K.qty(times, st)} times`, fresh);
  return alt(`${text} ${K.qty(times, st)} times`, `${text} for each ${each.singular}`, ...(fresh === null ? [] : [fresh]));
}
