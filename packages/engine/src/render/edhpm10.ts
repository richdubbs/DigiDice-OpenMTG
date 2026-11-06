/**
 * edh-perms-10 (Commander lane edh-perms): the sentence after a move that gives the moved cards extra counters depending on what they are (CR 614.1c, 608.2c).
 *
 *   "If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it."                       (`countersIf`: one entry, a mana value at most N)
 *   "If it enters as a creature, it enters with an additional +1/+1 counter on it."                                       (one entry, a creature)
 *   "Each of them enters with an additional +1/+1 counter on it if it's a creature and an additional loyalty counter on it if it's a planeswalker."
 *                                                                                                                         (a creature entry and a planeswalker entry, several cards)
 * Parser riders: zz-cloud/edh-perms-10.json. Anything else is refused (`NoRenderer`): the move then stays a manual step.
 */
import type { Destination, ObjectFilter } from '../types/ability';
import { NoRenderer, alt, numWord } from './text';

type Entries = NonNullable<Destination['countersIf']>;

const keysOf = (f: object): string => Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',');
const onlyTypes = (f: object, t: string): boolean => keysOf(f) === 'types' && JSON.stringify((f as { types?: string[] }).types) === JSON.stringify([t]);

/** One counters entry as the words "<n> additional <kind> counter(s)": a whole number of one kind. */
function additional(e: Entries[number]): { one: boolean; words: string; kind: string } {
  const c = e.counters.length === 1 ? e.counters[0]! : undefined;
  if (c === undefined || typeof c.count !== 'number' || !Number.isInteger(c.count) || c.count < 1 || typeof c.kind !== 'string') throw new NoRenderer('counters a moved card enters with that are not one whole number of one kind');
  return { one: c.count === 1, words: c.count === 1 ? 'an additional' : `${numWord(c.count)} additional`, kind: c.kind };
}

/** The sentence that follows the move (no final period). `plural`: the move acts on several objects. */
export function countersIfSentence(entries: Entries, plural: boolean, cond?: { say: (c: NonNullable<Entries[number]['when']>) => string; creature: boolean; np?: (f: ObjectFilter) => string; qty?: (q: unknown) => string }): string {
  if (entries.length === 1) {
    const e = entries[0]!;
    const a = additional(e);
    const noun = a.one ? `${a.kind} counter` : `${a.kind} counters`;
    // edh-c-6 (CR 614.1c, 608.2c, 601.2h; rid.edhv6.entersWith.if.cond; Vigor Mortis): "If {G} was spent to cast this spell, that creature enters with an additional +1/+1 counter on it."
    // (`when`, a condition of the resolving ability, with no description of the moved card)
    if (e.when !== undefined) {
      if (plural || keysOf(e.if) !== '' || cond === undefined || !cond.creature) throw new NoRenderer('counters a moved card enters with if a condition holds, other than for one creature');
      return `if ${cond.say(e.when)}, that creature enters with ${a.words} ${noun} on it`;
    }
    // edh-next-70 (CR 614.1c, 608.2c, 122.6; rid.edhn70.eachOfThem.entersWithAdditional; Aberrant Return): every moved card enters with the counters, no description of it ("Each of them enters with an additional -1/-1 counter on it.")
    if (keysOf(e.if) === '') return plural ? `each of them enters with ${a.words} ${noun} on it` : `it enters with ${a.words} ${noun} on it`;
    if (plural) throw new NoRenderer('several moved cards entering with counters if one of them matches');
    // edh-c-86 (CR 614.1c, 608.2c, 700.12; rid.edhv86.entersWith.ifSubtype; Heroic Return): "If a Hero enters this way, it enters with two additional +1/+1 counters on it." (one subtype of the moved card)
    if (keysOf(e.if) === 'subtypes' && (e.if as { subtypes?: string[] }).subtypes?.length === 1 && cond?.np !== undefined) return `if ${cond.np(e.if)} enters this way, it enters with ${a.words} ${noun} on it`;
    if (keysOf(e.if) === 'manaValue') {
      const mv = (e.if as { manaValue?: { op: string; value: unknown } }).manaValue;
      if (mv !== undefined && mv.op === '<=' && typeof mv.value === 'number') return `if that card has mana value ${mv.value} or less, it enters with ${a.words} ${noun} on it`;
    }
    // edh-next-32 (CR 614.1c, 608.2c; Recommission, What Must Be Done; family counters-if-creature-wordings): one creature entry is also said "If a creature enters this way, it enters with ..." and
    // "It enters with ... if it's a creature"; "if it enters as a creature" is only said for one counter (its parser rider takes no other count)
    if (onlyTypes(e.if, 'Creature')) {
      const thisWay = `if a creature enters this way, it enters with ${a.words} ${noun} on it`;
      const itsA = `it enters with ${a.words} ${noun} on it if it's a creature`;
      return a.one ? alt(`if it enters as a creature, it enters with ${a.words} ${noun} on it`, thisWay, itsA) : alt(thisWay, itsA);
    }
  }
  if (entries.length === 2 && plural) {
    const [c, p] = entries as [Entries[number], Entries[number]];
    if (onlyTypes(c.if, 'Creature') && onlyTypes(p.if, 'Planeswalker')) {
      const ac = additional(c);
      const ap = additional(p);
      if (ac.one && ap.one) return `each of them enters with ${ac.words} ${ac.kind} counter on it if it's a creature and ${ap.words} ${ap.kind} counter on it if it's a planeswalker`;
    }
  }
  // trek-21 (CR 614.1c, 608.2c, 122.6; rid.trek21.entersWith.xCreatureSpacecraft; Chief Montgomery Scott): one card, a creature entry and a Spacecraft entry that both give X counters of a
  // kind, X one quantity said after the sentence ("... where X is the number of differently named lands you control")
  if (entries.length === 2 && !plural && cond?.qty !== undefined) {
    const [c, p] = entries as [Entries[number], Entries[number]];
    const cc = c.counters.length === 1 ? c.counters[0]! : undefined;
    const pc = p.counters.length === 1 ? p.counters[0]! : undefined;
    if (onlyTypes(c.if, 'Creature') && keysOf(p.if) === 'subtypes' && JSON.stringify((p.if as { subtypes?: string[] }).subtypes) === JSON.stringify(['Spacecraft']) && c.when === undefined && p.when === undefined
      && cc !== undefined && pc !== undefined && typeof cc.count === 'object' && JSON.stringify(cc.count) === JSON.stringify(pc.count)) {
      return `it enters with X additional ${cc.kind} counters on it if it's a creature and X additional ${pc.kind} counters on it if it's a spacecraft, where X is ${cond.qty(cc.count)}`;
    }
  }
  throw new NoRenderer('counters a moved card enters with that depend on what it is, in a form no card prints');
}
