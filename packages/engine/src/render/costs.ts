/**
 * Costs as text (WP2): "{2}{R}, {T}, Sacrifice a creature", "+2", "-3", "Pay 2 life". Mana first, then {T}/{Q}, then the other parts in their order
 * (design 2: `CostDef`). A loyalty cost prints as its sign and number.
 */
import type { Count, CostDef, CostPart, ObjectFilter, Quantity } from '../types/ability';
import { formatManaCost } from '../types/mana';
import { K } from './kernel';
import { countParts } from './qty';
import { withVariants, type RenderState } from './state';
import { alt, ALT_OPEN, capFirst, COLOR_WORD, conj, joinList, lowerFirst, numWord, NoRenderer, pluralize, signed, withArticle, type Person } from './text';

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
/** edh-next-141: the nouns of what an `unattach` cost of another permanent unattached (render/refs.ts, costUnattached). */
export const COST_UNATTACHED = 'cost:unattached';
/** edh-d-101: the one object an `exileFrom` part exiled came from the battlefield (render/refs.ts: also "that card"). */
export const COST_EXILED_FROM_BATTLEFIELD = 'cost:exiled:battlefield';
/** edh-d-2 (CR 400.7): the cost moved ~ itself (sacrifice, discard, exile, return, put into the library): a later move of "it" is no step on a named object (model/cost-antecedent.ts). */
export const COST_SELF_MOVED = 'cost:selfMoved';

function part(p: CostPart, st: RenderState): string {
  // PUSH1 T2 (design 6.4: cost objects are mentions): a cost that names ~ makes it a FALLBACK antecedent: the effect may call it "it" when nothing else was
  // named (parser/lower/ability.ts#costMentions; render/refs.ts#obj)
  if ('self' in p && p.self === true) st.mentioned.add(COST_SELF);
  if ('self' in p && p.self === true && ['sacrifice', 'discard', 'exileFrom', 'returnToHand', 'putIntoLibrary'].includes(p.kind)) st.mentioned.add(COST_SELF_MOVED);
  switch (p.kind) {
    case 'sacrifice':
      if (p.self) return 'Sacrifice ~';
      // FAST3 T18: what "the sacrificed creature" of the effect may be called (render/refs.ts#obj, `costSacrificed`)
      st.info.set(COST_SACRIFICED, { nouns: K.nounsOf(p.filter), plural: p.count !== 1 });
      // edh-next-147 (CR 118.3, 701.21a; Phyrexian Dreadnought): "sacrifice any number of creatures with total power 12 or greater" (a threshold part, rules/cost-pick.ts)
      if (p.totalPower !== undefined) {
        if (p.count !== 'any' || p.distinctNames === true || p.atLeast !== undefined || p.all === true || p.half !== undefined) throw new NoRenderer('a sacrifice of total power with a count');
        return `Sacrifice ${counted(p.filter, 'any', st)} with total power ${p.totalPower} or greater`;
      }
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
      // edh-next-45 (CR 601.2b, 118.3; Soulblast): "Sacrifice all creatures you control"
      if (p.half !== undefined) {
        if (p.count !== 'any' || p.atLeast !== undefined || p.distinctNames === true || p.all === true || p.filter.controller !== 'you') throw new NoRenderer('a sacrifice of half other than a plain description you control');
        return `Sacrifice half the ${K.np(p.filter, st, { det: 'none', plural: true })}, rounded up`;
      }
      if (p.all === true) {
        if (p.count !== 'any' || p.atLeast !== undefined || p.distinctNames === true) throw new NoRenderer('a sacrifice of all other than a plain description');
        return `Sacrifice all ${K.np(p.filter, st, { det: 'none', plural: true })}`;
      }
      // edh-next-144 (CR 601.2b, 118.3; Baba Lysaga, Night Witch): "Sacrifice up to three permanents"
      if (p.atMost !== undefined) {
        if (p.count !== 'any' || p.atLeast !== undefined || p.distinctNames === true || p.all === true || p.half !== undefined || p.atMost < 2) throw new NoRenderer('a sacrifice of up to N other than a plain description');
        return `Sacrifice up to ${numWord(p.atMost)} ${K.np({ ...p.filter, controller: p.filter.controller === 'you' ? undefined : p.filter.controller }, st, { det: 'none', plural: true })}`;
      }
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
      // edh-c-41 (CR 119.4, 107.1a; Lurking Evil): "Pay half your life, rounded up" (the amount is read as the cost is paid)
      if (typeof p.amount === 'object' && p.amount.q === 'math' && p.amount.op === 'ceilDiv' && p.amount.args.length === 2 && p.amount.args[1] === 2
        && typeof p.amount.args[0] === 'object' && p.amount.args[0].q === 'life' && JSON.stringify(p.amount.args[0].of) === '{"ref":"you"}') return 'Pay half your life, rounded up';
      // FAST5X E27 (CR 119.4): a computed amount is "Pay life equal to ~'s power" (Oracle's wording); a number or X is "Pay 3 life"
      // edh-next-145 (CR 119.4, 118.3; Hand of Vecna): a number of life for each counted thing, "Pay 1 life for each card in your hand" (also said "Pay life equal to the number of ...")
      if (typeof p.amount === 'object' && (p.amount.q !== 'math' || (p.amount.op === '*' && p.amount.args.length === 2 && typeof p.amount.args[0] === 'number'))) {
        const n = p.amount.q === 'math' ? (p.amount.args[0] as number) : 1;
        const counted = p.amount.q === 'math' ? p.amount.args[1]! : p.amount;
        // a zone's size: "for each card in your hand" (your own hand, graveyard or library)
        const zoneOne = typeof counted === 'object' && counted.q === 'zoneSize' && counted.agg === undefined && JSON.stringify(counted.of) === '{"ref":"you"}' && ['hand', 'graveyard', 'library'].includes(counted.zone) ? { plural: `cards in your ${counted.zone}`, singular: `card in your ${counted.zone}` } : null;
        const per = zoneOne ?? countParts(counted, st);
        if (per !== null && n >= 1) return alt(`Pay life equal to ${K.qty(p.amount, st)}`, `Pay ${K.qty(p.amount, st)} life`, `Pay ${numWord(n)} life for each ${per.singular}`);
      }
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
      // edh-next-40 (CR 701.9a, 118.3; Sanctum of Shattered Heights, family discard-card-or-card): one card of either of two descriptions is also said with "card" after each, "Discard a land card or Shrine card"
      const two = hasFilter && p.count === 1 && f.anyOf?.length === 2 && Object.keys(f).length === 1
        ? `${K.np({ ...f.anyOf[0]!, isCard: true, zone: 'hand' }, st, { det: 'a', noZone: true })} or ${K.np({ ...f.anyOf[1]!, isCard: true, zone: 'hand' }, st, { det: 'none', noZone: true })}` : null;
      const cards = two !== null && noun !== null ? alt(noun, two) : noun ?? (p.count === 1 ? 'a card' : typeof p.count === 'number' ? `${numWord(p.count)} cards` : p.count === 'any' ? 'any number of cards' : `${K.qty(p.count, st)} cards`);
      return `Discard ${cards}${p.random ? ' at random' : ''}${p.sameName === true ? ' with the same name' : ''}${p.distinctNames === true ? ' with different names' : ''}`; // edh-c-111 (Sphinx of the Chimes); edh-next-90 (Ormos, Archive Keeper)
    }
    case 'exileFrom': {
      // FAST5X E13: "Exile ~" and "Exile a creature you control" name no zone: an ability functions on the battlefield (CR 113.6, 602.2)
      if (p.orGraveyard) throw new NoRenderer("craft's materials (CR 702.167a) are written by the craft keyword line, never as a cost of their own");
      // CLOUD C8: what "the exiled card" (or "the exiled creature", a permanent exiled from the battlefield) of the effect may be called (render/refs.ts#obj, `costExiled`)
      if (!p.self) st.info.set(COST_EXILED, { nouns: p.zone === 'battlefield' ? K.nounsOf(p.filter ?? {}) : ['card'], plural: p.count !== 1 });
      // edh-d-101 (CR 400.7; Primordial Mist): one permanent exiled from the battlefield is a card in exile, "that card" (render/refs.ts, `costExiled`)
      if (!p.self && p.zone === 'battlefield' && p.count === 1) st.mentioned.add(COST_EXILED_FROM_BATTLEFIELD);
      if (p.zone === 'battlefield' && p.self) return 'Exile ~';
      // std-costs-1 (CR 118.3, 107.3a): "Exile one or more other artifacts you control with total mana value X" (Fabrication Foundry)
      if (p.zone === 'battlefield' && p.totalManaValue !== undefined && p.atLeast === 1 && p.count === 'any') {
        return `Exile one or more ${K.np(p.filter ?? {}, st, { det: 'none', plural: true })} with total mana value ${K.qty(p.totalManaValue, st)}`;
      }
      // edh-d-101 (CR 708.9, 406.3; Primordial Mist): "Exile a face-down permanent you control face up" (`faceUp`, one face-down permanent only)
      if (p.zone === 'battlefield' && p.faceUp === true) {
        if (p.count !== 1 || p.filter?.faceDown !== true || p.atLeast !== undefined) throw new NoRenderer('"face up" on an exile cost other than of one face-down permanent');
        return `Exile ${counted(p.filter, p.count, st)} face up`;
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
      // edh-d-100 (CR 118.3, 202.3; The Capitoline Triad): "Exile any number of historic cards from your graveyard with total mana value 30 or greater"
      // edh-d-100 (CR 118.3, 205.2a; Nethergoyf): "Exile any number of other cards from your graveyard with four or more card types among them"
      if (p.typesAmong !== undefined) {
        if (p.count !== 'any' || p.zone !== 'graveyard') throw new NoRenderer('a card types threshold other than for any number of cards from your graveyard');
        return `Exile ${counted(f, p.count, st, { noZone: true })} from ${zone} with ${numWord(p.typesAmong.atLeast)} or more card types among them`;
      }
      if (p.mvTotal !== undefined) {
        if (p.count !== 'any' || p.zone !== 'graveyard') throw new NoRenderer('a total mana value threshold other than for any number of cards from your graveyard');
        return `Exile ${counted(f, p.count, st, { noZone: true })} from ${zone} with total mana value ${p.mvTotal.atLeast} or greater`;
      }
      return `Exile ${counted(f, p.count, st, { noZone: true })} from ${zone}`;
    }
    case 'putIntoLibrary': { // trek-9 (CR 118.3, 401.4; parser/holes/trek9.ts#putSelfIntoLibrary): "Put ~ from your graveyard on the bottom of your library"
      if (p.zone === 'battlefield') { if (p.position !== 'bottom') throw new NoRenderer('a cost that puts ~ from the battlefield on top of its owner\'s library'); return "Put ~ on the bottom of its owner's library"; } // edh-d-34 (Timestream Navigator)
      if (p.zone !== 'graveyard') throw new NoRenderer('a cost that puts ~ into a library from a zone other than your graveyard');
      return p.position === 'top' ? 'Put ~ from your graveyard on top of your library' : 'Put ~ from your graveyard on the bottom of your library';
    }
    case 'tapUntapped': return `Tap ${counted({ ...p.filter, tapped: false, other: p.other === true || p.filter.other }, p.count, st)}`;
    case 'untapTapped': return `Untap ${counted({ ...p.filter, tapped: true }, p.count, st)}`; // p2-cost-parts-1 (CR 701.26b)
    case 'moveCards': { // edh-d-54 (CR 118.3, 400.3, 401.4; Void Attendant, Hidden Retreat): the two wordings the cost hole reads, one card each
      if (p.count !== 1) throw new NoRenderer('a cost that moves several cards');
      if (p.from === 'exile' && p.to === 'graveyard' && JSON.stringify(p.filter) === '{"owner":"opponent"}') return "Put a card an opponent owns from exile into that player's graveyard";
      if (p.from === 'hand' && p.to === 'libraryTop' && p.filter === undefined) return 'Put a card from your hand on top of your library';
      // edh-d-94 (CR 118.3, 607.2a; Shelob, Dread Weaver): "Put a creature card exiled with ~ into its owner's graveyard": a card of the object's linked exile set
      if (p.from === 'exile' && p.to === 'graveyard' && p.filter?.is?.ref === 'linked' && p.filter.is.link === 'exiled' && p.filter.owner === undefined && p.filter.controller === undefined) {
        return `Put ${K.np({ ...p.filter, zone: 'exile', isCard: true }, st, { det: 'a' })} into its owner's graveyard`;
      }
      throw new NoRenderer('a cost that moves cards in another form');
    }
    case 'tapPower': {
      const n = K.qty(p.power, st);
      return `Tap any number of untapped ${K.np({ ...p.filter, other: p.other === true || p.filter.other }, st, { det: 'none', plural: true })} with total power ${alt(`${n} or greater`, `${n} or more`)}`;
    }
    case 'removeCounters': {
      // r3-cost (CR 118.3): "Remove two +1/+1 counters from among artifacts you control"
      // edh-d-45 (CR 107.1c, 118.3; Hierophant Bio-Titan): "Remove any number of +1/+1 counters from among creatures you control" (the number announced as the cost is, actions/cast-costs.ts#withAnnouncedCount)
      if (p.among === true && p.anyNumber === true) return `Remove any number of ${pluralize(p.counter === 'any' ? 'counter' : `${p.counter} counter`)} from among ${K.np(p.filter!, st, { det: 'none', plural: true })}`;
      if (p.among === true) return `Remove ${counterWord(p.counter, p.count, st)} from among ${K.np(p.filter!, st, { det: 'none', plural: true })}`;
      // edhd68 (CR 702.62b; Rift Elemental, parser/holes/cost.ts#counterHolders): "a permanent you control or suspended card you own"
      const halves = p.filter?.anyOf;
      const what = p.self ? '~' : halves !== undefined && halves.length === 2 && Object.keys(p.filter!).sort().join() === 'anyOf,zone' ? `${K.np(halves[0]!, st, { det: 'a' })} or ${K.np(halves[1]!, st, { det: 'none' })}` : p.filter ? K.np(p.filter, st, { det: 'a' }) : '~';
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
    case 'unattach': // edh-top-15 (CR 701.3d; Sunforger, Toralf's Hammer): "Unattach ~", or the Equipment that granted the ability ("Unattach ¤")
    {
      if (p.self) return 'Unattach ~';
      // edh-next-141 (CR 701.3d, 301.5; Captain America, First Avenger): "Unattach an Equipment from ~": one Equipment attached to the source itself, which the effect calls "that Equipment"
      if (JSON.stringify(p.filter) === JSON.stringify({ subtypes: ['Equipment'], attachedToObject: { ref: 'self' } }) && p.count === 1) {
        st.info.set(COST_UNATTACHED, { nouns: ['equipment'], plural: false });
        return 'Unattach an Equipment from ~';
      }
      const text = `Unattach ${K.np(p.filter, st, { det: 'none' })}`;
      st.mentioned.delete('grantor'); // naming it in a cost is no antecedent for the effect (a fallback only: parser/lower/ability.ts#costMentionsOf)
      st.mentioned.add(COST_SELF); // the granting object a quoted "Unattach ¤" names is "it" the same way (refs.ts, grantor)
      return text;
    }
    case 'returnToHand':
      if (p.self) return alt("Return ~ to its owner's hand", 'Return ~ to your hand');
    {
      // family owner-zone (render/equivalence.ts, CR 400.3); M6-5a: several permanents go to "their owner's hand" (Oracle's wording for a plural count)
      const whose = p.count === 1 ? ["its owner's", 'your'] : ["its owner's", 'your', "their owner's", "their owners'"];
      return `Return ${counted(p.filter, p.count, st)} to ${alt(...whose)} hand`;
    }
    case 'reveal': {
      if (p.hand === true) return 'Reveal your hand'; // edh-next-117
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
      // edh-next-144 (CR 701.4a; family behold-reveal-first; Dragon's Fire): the two ways in the other order, "reveal a Dragon card from your hand or choose a Dragon you control"
      return alt(plainBehold, `Choose ${withArticle(noun)} you control or reveal ${withArticle(noun)} card from your hand`, `Reveal ${withArticle(noun)} card from your hand or choose ${withArticle(noun)} you control`);
    }
    // std-costs-2 (CR 601.2b): "choose a creature you control or a warped creature card you own in exile" (Close Encounter): one object, of any of the filters
    case 'chooseObject': {
      if (p.count !== 1 || p.filters.length < 2) throw new NoRenderer('a chosen-object cost of other than one object of two or more descriptions');
      return `Choose ${joinList(p.filters.map((f) => K.np(f, st, { det: 'a' })), 'or')}`;
    }
    case 'addMana': return `Add ${p.mana.map((t) => `{${t}}`).join('')}`; // edh-mana-keywords-12 (CR 702.24a): the cost of Braid of Fire's cumulative upkeep
    case 'draw': return `Draw ${typeof p.count === 'number' ? (p.count === 1 ? 'a card' : `${numWord(p.count)} cards`) : `${K.qty(p.count, st)} cards`}`; // edh-c-48 (CR 702.24a): Psychic Vortex's cumulative upkeep
    case 'mill': return `Mill ${typeof p.count === 'number' ? numWord(p.count) : K.qty(p.count, st)} ${p.count === 1 ? 'card' : 'cards'}`;
    // CMD5 (family energy-count-words, CR 107.14): Oracle writes a large fixed amount as a number word ("Pay six {E}", "Pay eight {E}"); the symbols stay a reading
    case 'revealChosen': return p.what === 'player' ? 'reveal the player you chose' : 'reveal the creature type you chose'; // std-combat-5 (CR 608.2d); edh-next-135 (Stalking Leonin)
    case 'rollDie': return `Roll a d${p.sides}`; // edh-d-49 (CR 706.2, 118.3; Clay Golem)
    case 'payEnergy':
      // std-promote-3 (CR 107.14, 608.2h): a computed amount is "Pay an amount of {E} equal to its mana value" (Oracle's wording, as `payLife` above); X stays "Pay X {E}"
      if (typeof p.amount === 'object' && p.amount.q !== 'X') return alt(`Pay an amount of {E} equal to ${K.qty(p.amount, st)}`, `Pay ${K.qty(p.amount, st)} {E}`);
      return `Pay ${typeof p.amount === 'number' ? (p.amount >= 4 ? alt('{E}'.repeat(p.amount), `${numWord(p.amount)} {E}`) : '{E}'.repeat(p.amount)) : `${K.qty(p.amount, st)} {E}`}`;
    case 'action': {
      const word = ACTION_COST[p.action] ?? capFirst(p.action.replace(/([A-Z])/g, ' $1').toLowerCase());
      if (p.action === 'exert') { st.mentioned.add(COST_SELF); return 'Exert ~'; } // edh-c-91 (CR 701.43a; parser/lower/ability.ts#costMentionsOf): the creature a cost exerts is a fallback antecedent too (Fervent Paincaster)
      // FAST5X E10: "waterbend {N}" names its cost as mana symbols (CR 701.67a: "Waterbend [cost]")
      if (p.action === 'waterbend' && p.arg !== undefined) return `${word} {${K.qty(p.arg, st)}}`;
      // std-costs-1 (CR 701.59a, 107.3): a computed amount is "Collect evidence X, where X is <it>" (Urgent Necropsy)
      if (p.action === 'collectEvidence' && typeof p.arg === 'object' && p.arg.q !== 'X') return `${word} X, where X is ${K.qty(p.arg, st)}`;
      return p.arg === undefined ? word : `${word} ${K.qty(p.arg, st)}`;
    }
    // FAST5X E27 (CR 122.1f, 702.21a): "Get five poison counters"
    case 'getCounters': return `Get ${counterWord(p.counter, p.amount, st)}`;
    // edh-cast-14 (CR 118.1, 119.3; Invigorate): "have an opponent gain 3 life" as a cost
    // edh-d-74 (CR 702.24a; Wall of Shards): a cumulative upkeep says "An opponent gains 1 life."
    case 'opponentGainsLife': return alt(`Have an opponent gain ${K.qty(p.amount, st)} life`, `An opponent gains ${K.qty(p.amount, st)} life`);
    // edh-d-74 (CR 701.13a, 705.1; Thought Lash, Karplusan Minotaur): "Exile the top card of your library", "Flip a coin"
    case 'exileTop': return `Exile the top ${p.count === 1 ? 'card' : `${K.qty(p.count, st)} cards`} of your library`;
    case 'flipCoin': return 'Flip a coin';
    // FAST5X E27 (CR 601.2b, 118.12a): a choice between costs, each written as an instruction: "Pay {3} or discard a card", "Discard a card or pay {2}"
    case 'oneOf': {
      if (p.options.length < 2) throw new NoRenderer('a choice between fewer than two costs');
      const said = capFirst(p.options.map((o) => costVerbs(o, st, 'you')).join(' or '));
      // edh-d-88 (CR 107.14, 702.151a; Razorfield Ripper, family pay-mana-or-energy): "Pay {2} or {E}{E}{E}": after a mana option, an energy option shares the verb "pay"
      const [m, e] = p.options;
      const energy = e !== undefined && Object.keys(e).join() === 'other' && e.other?.length === 1 && e.other[0]!.kind === 'payEnergy' && typeof e.other[0]!.amount === 'number' && e.other[0]!.amount < 4 ? e.other[0]!.amount : null;
      const tail = ` or pay ${'{E}'.repeat(energy ?? 0)}`;
      if (p.options.length === 2 && m !== undefined && Object.keys(m).join() === 'mana' && energy !== null && said.toLowerCase().endsWith(tail.toLowerCase())) {
        return alt(said, `${said.slice(0, -tail.length)} or ${'{E}'.repeat(energy)}`);
      }
      return said;
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
  // edhd36 (CR 107.3, 118.12; Thassa's Intervention): "unless its controller pays twice {X}" is a payment of {X}{X}: X is announced once and paid twice
  if (c.mana !== undefined && c.mana.length > 0) out.push(c.mana.length === 2 && c.mana.every((m) => m.kind === 'variable' && m.name === 'X') ? alt(formatManaCost(c.mana), 'twice {x}') : formatManaCost(c.mana));
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
    // edh-cast-7 (CR 701.9a, 118.3; Foil): "Discard an Island card and another card": a discard of one card of a description and a discard of one more card, one verb
    // (parser/holes/cost.ts#discard); each object pays one part, so the second is a different card
    if (p.kind === 'discard' && q?.kind === 'discard' && p.filter !== undefined && p.count === 1 && q.count === 1 && q.filter === undefined
      && p.self !== true && p.hand !== true && p.random !== true && q.self !== true && q.hand !== true && q.random !== true) {
      out.push(`${part(p, st)} and another card`);
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
    // edh-c-14 (CR 118.3, 122.1; The Filigree Sylex; family remove-counters-and-self-it): "Remove ten oil counters from among permanents you control and sacrifice ~": counters taken from
    // among permanents (not from ~ alone) and then the sacrifice of ~ itself, said with "and" and the name
    if (p.kind === 'removeCounters' && p.among === true && q?.kind === 'sacrifice' && q.self === true && q.count === 1 && q.atLeast === undefined && q.distinctNames !== true) {
      out.push(alt(`${part(p, st)}, ${part(q, st)}`, `${part(p, st)} and sacrifice ~`));
      i++;
      continue;
    }
    // edh-mana-keywords-6 (CR 701.21a, 118.3; family sacrifice-two-permanents-and): "Sacrifice a Swamp and a Forest" (Jarad, Golgari Lich Lord): two single-permanent parts
    // said with one verb (parser/holes/cost.ts#sacrifice)
    const plain = (x: CostPart | undefined): x is Extract<CostPart, { kind: 'sacrifice' }> =>
      x?.kind === 'sacrifice' && x.self !== true && x.count === 1 && x.atLeast === undefined && x.distinctNames !== true && x.filter.other === undefined && x.filter.anyOf === undefined;
    // edh-perms-12 (Mount Doom): the first part may be the object itself, "Sacrifice ~ and a legendary artifact"
    const selfPart = (x: CostPart | undefined): x is Extract<CostPart, { kind: 'sacrifice' }> => x?.kind === 'sacrifice' && x.self === true && x.count === 1 && x.atLeast === undefined && x.distinctNames !== true;
    // edh-perms-18 (Glass-Cast Heart): ... and a fixed number of another description, "Sacrifice ~ and thirteen Blood tokens"
    const manyPart = (x: CostPart | undefined): x is Extract<CostPart, { kind: 'sacrifice' }> =>
      x?.kind === 'sacrifice' && x.self !== true && typeof x.count === 'number' && x.count > 1 && x.atLeast === undefined && x.distinctNames !== true && x.filter.other === undefined && x.filter.anyOf === undefined && x.filter.controller === undefined;
    // edh-next-125 (CR 118.3, 406.1; family exile-self-and-others; Mechtitan Core): "Exile this Vehicle and four other artifact creatures and/or Vehicles you control": the object itself
    // and a fixed number of OTHER permanents you control, two exile parts said with one verb (parser/holes/cost.ts#exile)
    if (p?.kind === 'exileFrom' && p.zone === 'battlefield' && p.self === true && p.count === 1 && q?.kind === 'exileFrom' && q.zone === 'battlefield' && q.self !== true && typeof q.count === 'number'
      && q.atLeast === undefined && q.totalManaValue === undefined && q.symbolTotal === undefined && q.filter?.other === true && q.filter.controller === 'you') {
      out.push(alt(`${part(p, st)}, ${part(q, st)}`, `Exile ~ and ${counted(q.filter, q.count, st)}`));
      i++;
      continue;
    }
    if (selfPart(p) && manyPart(q)) {
      out.push(alt(`${part(p, st)}, ${part(q, st)}`, `Sacrifice ~ and ${counted(q.filter, q.count as number, st)}`));
      i++;
      continue;
    }
    const noun = (f: ObjectFilter): string => counted({ ...f, controller: f.controller === 'you' ? undefined : f.controller }, 1, st);
    // edh-c-40 (CR 701.21a, 118.3; family sacrifice-three-permanents-list; Dragon's Herald, Demon's Herald): three single-permanent parts, "Sacrifice a black creature, a red creature, and a green creature"
    const third = rest[i + 2];
    if (plain(p) && plain(q) && plain(third)) {
      out.push(alt(`${part(p, st)}, ${part(q, st)}, ${part(third, st)}`, `Sacrifice ${noun(p.filter)}, ${noun(q.filter)}, and ${noun(third.filter)}`));
      i += 2;
      continue;
    }
    // edh-next-90 (Magus of the Order): "Sacrifice ~ and another green creature": the second part is one other permanent
    if (selfPart(p) && q?.kind === 'sacrifice' && q.self !== true && q.count === 1 && q.atLeast === undefined && q.distinctNames !== true && q.filter.other === true && q.filter.anyOf === undefined) {
      out.push(alt(`${part(p, st)}, ${part(q, st)}`, `Sacrifice ~ and ${counted(q.filter, 1, st)}`));
      i++;
      continue;
    }
    if ((plain(p) || selfPart(p)) && plain(q)) {
      out.push(alt(`${part(p, st)}, ${part(q, st)}`, `Sacrifice ${p.self === true ? '~' : noun(p.filter)} and ${noun(q.filter)}`,
        ...(p.self === true && q.filter.controller === 'you' ? [`Sacrifice ~ and ${counted(q.filter, 1, st)}`] : []))); // edh-perms-12: "Sacrifice this land and a creature you control" (Great Hall of Starnheim)
      i++;
      continue;
    }
    out.push(part(p, st));
  }
  return out;
}

export function cost(c: CostDef, st: RenderState): string {
  // edh-next-147 (CR 601.2b, 602.2b; Crystal Shard): a choice between two whole activation costs of several parts each (parser/lower/activation.ts#wholeAlternatives),
  // "{3}, {T} or {U}, {T}": each cost written as an activation cost, joined by "or"
  const only = c.other?.length === 1 && Object.keys(c).length === 1 ? c.other[0]! : undefined;
  if (only?.kind === 'oneOf' && only.options.length === 2 && only.options.every((o) => (o.mana !== undefined && o.mana.length > 0 ? 1 : 0) + (o.tap === true ? 1 : 0) + (o.untap === true ? 1 : 0) + (o.loyalty !== undefined ? 1 : 0) + (o.other?.length ?? 0) >= 2)) return only.options.map((o) => cost(o, st)).join(' or ');
  const parts = costParts(c, st);
  // edh-next-45 (CR 118.3, 119.4, 702.24a; Infernal Darkness, family mana-and-life-cost): a mana cost and a payment of a fixed amount of life alone are also "Pay {B} and 1 life"
  if (c.mana !== undefined && c.other?.length === 1 && c.other[0]!.kind === 'payLife' && typeof c.other[0]!.amount === 'number' && Object.keys(c).length === 2 && parts.length === 2) {
    return alt(parts.join(', '), `Pay ${parts[0]!} and ${c.other[0]!.amount} life`);
  }
  return parts.join(', ');
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
  const bits = costParts(c, st).map((p0) => {
    // edh-next-6 (CR 701.9a, 118.12; Perplex): a hand discarded by another player is "their hand", not "your hand"
    const p = person !== 'you' && p0 === 'Discard your hand' ? 'Discard their hand' : p0;
    const phrase = /^[{+\-0-9]/.test(p) || (p.startsWith(ALT_OPEN) && p.includes('twice {x}') /* edhd36: pays twice {X} */) ? `pay ${p}` : lowerFirst(p);
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
    // edh-d-3 (CR 118.12a, 700.8; Concerted Defense): the party's size is counted too: "for each creature in your party" (parser/templates/zz-cloud/edh-d-3.json)
    if (JSON.stringify(times.args[1]) === '{"q":"partySize","of":{"ref":"you"}}') return `${conj('pay', person)} {${times.args[0]}} plus an additional {1} for each creature in your party`;
  }
  const each = countParts(times, st);
  // FAST5X E15 (CR 118.12a, 107.3): "pays mana equal to the greatest power among creatures you control": {1} that many times is that much generic mana
  const generic1 = c.mana !== undefined && c.mana.length === 1 && c.mana[0]!.kind === 'generic' && c.mana[0]!.amount === 1 && Object.keys(c).length === 1;
  // std-rx25 (CR 118.12a, 107.3a; family pays-x-where): "pays {X}, where X is the greatest power among creatures you control" is the same generic payment
  const fresh = generic1 && typeof times === 'object' ? alt(`${conj('pay', person)} mana equal to ${K.qty(times, st)}`, `${conj('pay', person)} {x}, where x is ${K.qty(times, st)}`) : null;
  // edh-next-48 (CR 107.14, 118.12a, 608.2c; Aether Spike): "pays {1} for each {E} paid this way": one payment of the cost for each energy counter the earlier payment of any amount of {E} made
  if (typeof times === 'object' && times.q === 'resultCount' && K.qty(times, st) === 'the amount of {E} paid this way') return alt(`${text} ${K.qty(times, st)} times`, `${text} for each {E} paid this way`);
  if (each === null) return fresh === null ? `${text} ${K.qty(times, st)} times` : alt(`${text} ${K.qty(times, st)} times`, fresh);
  return alt(`${text} ${K.qty(times, st)} times`, `${text} for each ${each.singular}`, ...(fresh === null ? [] : [fresh]));
}
