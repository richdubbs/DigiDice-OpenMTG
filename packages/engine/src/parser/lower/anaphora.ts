/**
 * Pass 3, anaphora: the unique-candidate rule (design 6.4). Owner: WP17.
 *
 * A reference (`it`, `its`, `them`, `they`, `that creature`, `those cards`, `that player`, `its controller`, `the exiled card`) resolves to the mention that
 * is the ONLY one compatible by sort, grammatical number and head noun. Zero or several compatible mentions make the sentence manual (diagnostic
 * `unbound-reference`), and such a sentence is contagious (taint T2, design 6.7). There is no ranking and no "most recent" tie-break.
 *
 * The binding is written at the use: `{ref:'target', id}`, `{ref:'event', role}`, or `{ref:'bound', name}` with the name written as `as` on the producing
 * step. Property reads ("its power", "its controller") are read from last known information by the evaluators (CR 608.2h); a reference to an object that
 * was moved follows it only into a public zone (CR 400.7j, design 3.1), which is the evaluator's business, not the parser's.
 *
 * Numbers ("that many", "that much") are pass 5 (lower/quantities.ts). Sentences that no template parsed are scanned here too (`scanAnaphors`): an
 * unresolvable pronoun in a manual sentence is what makes it contagious, a resolvable one is not (Frost Breath, design 6.7).
 */
import type { AnaphorInfo } from '../holes/core';
import { EXILED_THIS_WAY, PUT_INTO_GRAVEYARD_THIS_WAY, REVEALED_THIS_WAY } from '../holes/filter';
import { MOVED_MARK } from '../holes/moved-words';
import type { EventPattern, ObjectFilter, TargetSpec } from '../../types/ability';
import { spanText, type Tok } from '../holes/tok';
import type { StepMention } from './mentions';
import { actedOn, mentionsAt, mentionsInside, movedCondMention, movedInside, riderCondMentions, stepsInOrder } from './mentions';
import { rebaseMovedSelf } from './moved-self';
import { chooseNode } from './choose';
import { perPlayerAmounts, severalPlayersAmount } from './targets';
import { actsOnlyOnNamed } from '../../model/cost-antecedent';
import { focusEffect, keepsFocus, shufflesYourLibrary, keptFocus, looksAtOneCard, notPutMove, notPutZone, revealsOneCard } from '../../model/focus';
import { CARD_TYPES, eventMentions, headsOfFilter } from './scope';
import type { Draft, Mention, Rec, Unit } from './types';
import { clone, cloneDraft, freshName, isRec, namesIn, rewrite, sequences, setManual, visit } from './util';
import { couldBeSource } from './targets';
import { eachOtherThanNamed } from './each-other-edhn134';

const PLAYER_HEADS = new Set(['player', 'opponent']);

/** CLOUD C8 (CR 601.2c, 601.2h, 400.7): the references to what a cost of the ability moved: read only, never a target's antecedent (costs are paid after targets). */
const COST_MOVED: ReadonlySet<string> = new Set(['costSacrificed', 'costDiscarded', 'costExiled', 'costTapped', 'costBeheld', 'costChosenObject', 'costReturned', 'costRevealed']);

/** FAST5 T59: the nouns of permanents, which a spell or ability on the stack is never called. */
const PERMANENT_NOUNS: ReadonlySet<string> = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'permanent']);

/** r4-refs: the keys whose value is always a player (a step's `who`; a description's or a destination's `controller` and `owner`). */
const PLAYER_KEYS: ReadonlySet<string> = new Set(['who', 'controller', 'owner', 'whose' /* r5-refs: a duration's player, "until the end of their next turn" (CR 611.2a) */]);

/** Can mention `m` be what anaphor `a` refers to? (sort, number, head noun, participle; design 6.4) */
export function compatible(a: AnaphorInfo, m: Mention): boolean {
  if (m.origin === 'opaque') return true; // a sentence that is not understood may have mentioned anything
  if (a.impulse === true) return false; // FAST5 T70: only the impulse idiom binds it (impulseIdiom), never the unique-candidate rule
  // LNK1 (CR 607.1): the player another ability targeted is named by "that player" only (Mention.linked)
  // edh-d-92 (CR 607.2a): ... and the card another ability exiled by "the exiled card" only (lower/ability.ts LINKED_EXILED_CARD)
  const linkedExiledCard = isRec(m.ref) && m.ref['ref'] === 'linked' && m.ref['link'] === 'exiled';
  if (m.linked === true && linkedExiledCard && !(a.sort === 'object' && a.head === 'card' && a.number === 'singular' && a.participle === 'exiled' && a.text === 'the exiled card')) return false;
  if (m.linked === true && !linkedExiledCard && !(a.sort === 'player' && a.head === 'player' && a.number === 'singular')) return false;
  if (m.headOnly === true && a.head === undefined && !(m.alsoThey === true && (a.text === 'they' || a.text === 'their' || (m.alsoThem === true && a.text === 'them')))) return false; // LNK1: "that player", never "they" (Mention.headOnly; r4-refs: Mention.alsoThey)
  if (m.implicit === true && a.head === undefined && a.sort !== 'number') return false; // PUSH1 T2: a bare pronoun needs a named antecedent (design 6.4)
  // p2-damage-1 (CR 608.2c; Repercussion): "that creature" names an object the text called a creature: a role the clause never names and whose pattern does not
  // describe its type ("Whenever a creature is dealt damage": the source of the damage) is no antecedent of a demonstrative of a permanent type
  if (m.implicit === true && a.head !== undefined && PERMANENT_NOUNS.has(a.head) && a.text.startsWith('that ') && m.heads.includes('*')) return false;
  if (m.namedSelf === true && a.head !== undefined && m.movedBy === undefined) return false; // FAST5 T76 (CR 201.5): the object a step of this ability itself names "~" is never "that creature" while it has not moved
  if (m.selfObject === true && a.head !== undefined) return false; // FAST2 T10: "that creature" is never the object itself while it has not moved (CR 201.5)
  if (m.handOnly === true && a.head !== 'hand') return false; // T46: a revealed or looked-at hand is only the "it" of "choose a card from it" (CR 701.20a, 701.20e)
  if (a.head === 'hand' && m.handOnly !== true) return false;
  // FAST5 T51 (CR 201.5): an object calls itself "this spell", never "that spell": the object a step or an "if" names as ~ is no antecedent of "that spell"
  if (a.head === 'spell' && m.sort !== 'number' && m.sort !== 'any' && isRec(m.ref) && m.ref['ref'] === 'self') return false;
  // FAST3 T18: what a cost sacrificed is only "the sacrificed creature"; std-rw8: what an optional payment sacrificed is also "that creature" (Mention.demonstrative); edh-players-4: "those cards" for the cards a mill milled; edh-players-4: "those cards" for the cards a mill milled
  if (m.participleOnly === true && a.participle === undefined && !(m.demonstrative === true && a.head !== undefined && (a.text.startsWith('that ') || a.text.startsWith('those ')))) return false;
  if (a.cardNoun === true && m.heads.includes('token') && !m.heads.includes('card')) return false; // edh-zones-12 (CR 108.2b): a token is no card
  if (a.notSelf === true && (m.selfObject === true || (isRec(m.ref) && m.ref['ref'] === 'self'))) return false; // FAST5X E17: "you controlled it" (CR 608.2h)
  if (a.sort === 'number' || m.sort === 'number') return a.sort === m.sort;
  if (m.otherPartyOnly === true && a.otherParty !== true && !(m.otherPartyThat === true && a.head === 'creature' && a.text === 'that creature')) return false; // edh-c-106; edh-d-25
  if (a.otherParty === true && !(m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'object')) return false; // edh-c-106 (CR 608.2c)
  const head = a.head;
  const playerWord = head !== undefined && PLAYER_HEADS.has(head);
  switch (a.sort) {
    case 'player':
      if (m.sort !== 'player' && m.sort !== 'any') return false;
      // FAST3 T14: the possessive "their" names one player too (Oracle's singular "they": "target player shuffles up to three target cards from their
      // graveyard"), as the "they" of the case 'any' below does
      if (a.text === 'their' && a.number === 'plural' && m.sort === 'player' && m.number === 'singular' && head === undefined) return true;
      break;
    case 'object':
      if (playerWord) { if (m.sort !== 'player' && m.sort !== 'any') return false; }
      else if (m.sort !== 'object' && m.sort !== 'any') return false;
      break;
    case 'set':
      // r3-choose (CR 115.1, 608.2c): "creatures those players control" after "Choose any number of target players.": a set of players, named by a player head
      if (playerWord) { if (m.sort !== 'player' && m.sort !== 'any') return false; break; }
      if (m.sort !== 'object' && m.sort !== 'any') return false;
      break;
    case 'any':
      // "they" / "their": a plural object, or a player (Oracle's singular "they" for a player)
      if (m.sort === 'player') return head === undefined || m.heads.includes(head);
      break;
  }
  if (a.sort === 'set' || a.sort === 'any') { if (m.number !== 'plural') return false; }
  // CLOUD C4: a template's "other" ("destroy all other creatures") leaves out the object or the objects an earlier instruction named, one or several
  // ("Create X 1/1 Soldier creature tokens. If X is 5 or more, destroy all other creatures.": the tokens just created, CR 608.2c, 109.2)
  else if (a.number !== m.number && !(a.text === 'other' && a.head === undefined) && !(m.alsoSingular === true && a.number === 'singular') && !(m.eachOne === true && a.number === 'singular' && (a.text === 'that player' || a.text === 'that opponent')) && !(a.both === true && m.number === 'singular' && m.sort === 'object')) return false; // edh-zones-9: "both cards" is made of single cards // STD-FRA: one target for each opponent may hold one object
  if (head !== undefined) {
    if (playerWord) { if (!m.heads.includes(head)) return false; }
    else {
      if (m.sort === 'player') return false;
      // FAST5 T59: a spell or ability on the stack is no "creature", "artifact", "permanent" ... whatever the wildcard head says ("Whenever a creature you control becomes the target
      // of a spell or ability an opponent controls, ... other than that creature": the creature, not the spell or ability that targets it; CR 115.1, 110.1)
      if (m.stackObject === true && PERMANENT_NOUNS.has(head) && !m.heads.includes(head)) return false;
      // edh-cast-8 (CR 115.1, 603.2; Unsettled Mariner): "Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls, counter that spell or
      // ability": the object that is targeted (the wildcard head of a player-or-permanent subject) is never the spell or ability that targets it
      if ((head === 'spell' || head === 'ability') && m.stackObject !== true && !m.heads.includes(head) && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'subject') return false;
      if (!m.heads.includes(head) && (head === 'rest' || head === 'rest-not-put' || head === 'rest-exiled' || head === 'rest-exiled-notcast' /* edh-d-96 */ || head === 'rest-notcast' || head === 'rest-notcast-revealed' || head === 'exiled-all' || head === 'revealed-all' || head === 'exiled-other' || !m.heads.includes('*'))) return false; // std-rh: so is "rest-not-put"; FAST5 T43: "the rest" is only what a choice among a group left (mentions.ts#restOf), never an unrestricted noun
      // FAST5X E19: "~" of a permanent's triggered ability is never "that spell", nor "that card" until a step moved it (CR 201.5)
      if (m.notHeads?.includes(head) === true && !(head === 'card' && m.movedBy !== undefined)) return false;
    }
  }
  // FAST4 T19: "that creature or planeswalker" needs a mention named by both heads (a target "creature or planeswalker"), never one of them only
  // edh-perms-15 (CR 115.1; Animation Module): "that permanent or player" is a target that may be an object or a player (sort `any`), callable by both heads
  if (m.orPlayerOnly === true && a.orHead !== 'player') return false; // edh-replace-7
  if (a.orHead === 'player') { if (m.sort !== 'any' || !m.heads.includes('player') || (a.head !== undefined && !m.heads.includes(a.head) && !m.heads.includes('*'))) return false; }
  else if (a.orHead !== undefined && (m.sort !== 'object' || (!m.heads.includes(a.orHead) && !m.heads.includes('*')))) return false;
  if (a.participle !== undefined && !(m.verbs ?? []).includes(a.participle)) return false;
  // std-rx10 (CR 115.1, 608.2c): "the creature you control" names the announced target described with the same controller, and nothing else
  if (a.controls !== undefined && (m.controls !== a.controls || !((m.verbs ?? []).includes('chosen') || m.origin === 'target'))) return false; // edh-c-86: an announced target of any sentence of the spell (Outmuscle), not only a "choose" sentence's
  return true;
}

export type Resolution = { ok: true; mention: Mention } | { ok: false; count: number; opaque?: boolean };

/** The unique-candidate rule. A candidate set that includes an opaque mention is unknown: never a resolution (design 6.4). */
export function resolveAnaphor(a: AnaphorInfo, mentions: readonly Mention[]): Resolution {
  const hits = mentions.filter((m) => compatible(a, m));
  // edh-c-109 (CR 608.2c, 115.1; family those-creatures-all-targets; Arm the Cathars): "Those creatures gain vigilance" after three single "target creature" phrases names ALL of them (the
  // objects the ability targeted): with no plural mention to take, the singular object targets of one head (two or more, each a target of this ability) are one group
  if (hits.length === 0 && a.sort === 'set' && a.number === 'plural' && a.head !== undefined && a.text.startsWith('those ')) {
    const singles = mentions.filter((m) => m.origin === 'target' && m.number === 'singular' && m.sort === 'object' && m.linked !== true && m.fallback !== true && m.heads.includes(a.head!));
    const refs = new Set(singles.map((m) => JSON.stringify(m.ref)));
    if (singles.length >= 2 && refs.size === singles.length && mentions.every((m) => singles.includes(m) || m.origin !== 'target' || m.sort !== 'object')) {
      const [first, ...more] = singles as [Mention, ...Mention[]];
      return { ok: true, mention: { ...first, number: 'plural', heads: first.heads.filter((h) => more.every((x) => x.heads.includes(h))), ref: { ref: 'union', of: singles.map((m) => clone(m.ref)) }, bindKey: 'those', parts: singles } };
    }
  }
  // the same referent reached twice (a target that a later step also touched) is one candidate
  const seen = new Map<string, Mention>();
  // edh-zones-16: a player named twice by the same reference (the opponent who controls a target and the player a reveal until of that target's controller is the instruction of) is one candidate
  for (const h of hits) seen.set(JSON.stringify(h.ref) + (h.sort === 'player' && h.origin !== 'opaque' ? '' : h.origin === 'step' ? `@${(h as StepMention).path}#${h.unit}` : h.origin === 'opaque' ? `#${h.unit}` : ''), h);
  const uniq = [...seen.values()];
  if (uniq.some((m) => m.origin === 'opaque')) return { ok: false, count: uniq.length, opaque: true };
  // edh-zones-9 (CR 608.2c; Sword of Hearth and Home): "both cards" names exactly two single cards that earlier instructions produced; with any other number of candidates it is unresolved
  if (a.both === true) {
    // (what an instruction of the ability produced or named: a target or a step's result, never the trigger's event object)
    const singles = uniq.filter((m) => m.number === 'singular' && m.sort === 'object' && m.linked !== true && m.fallback !== true && (m.origin === 'target' || m.origin === 'step'));
    if (singles.length !== 2) return { ok: false, count: singles.length };
    const [x, y] = singles as [Mention, Mention];
    return { ok: true, mention: { ...y, number: 'plural', heads: x.heads.filter((h) => y.heads.includes(h)), ref: { ref: 'union', of: [clone(x.ref), clone(y.ref)] }, bindKey: 'both', parts: [x, y] } };
  }
  // PUSH1 T2: a fallback mention (the object an activation cost names) is a candidate only when nothing else is
  // LNK1: ... and the player another ability targeted (Mention.linked, CR 607.1) only when nothing of this ability is, not even a fallback
  // MX5: a demonstrative names the object of its own enters trigger only when nothing else fits (Mention.selfEntered)
  // edh-players-11: ... and a `soleOnly` mention (Mention.soleOnly) is a candidate only when nothing else of this ability is
  const ownAll = uniq.filter((m) => m.linked !== true);
  const own = ownAll.some((m) => m.soleOnly !== true) ? ownAll.filter((m) => m.soleOnly !== true) : ownAll;
  // FAST5 T58: ... and so does a bare pronoun once the ability has targeted a compatible object ("When ~ enters, target permanent you control gains hexproof
  // until end of turn. Put a +1/+1 counter on it if it's a creature."): Oracle then names the object itself "~" or "this creature", never "it" (CR 201.5,
  // 115.1), so "it" is the target
  const targeted = a.head === undefined && own.some((m) => ((m.origin === 'target' || m.forTarget === true) && m.fallback !== true && m.selfEntered !== true) // std-rx11: forTarget
    // edh-c-77 (CR 201.5, 701.20a; Coralhelm Chronicler): ... and the card a "reveal a card from among them" chose and revealed ("When ~ enters, look at ... You may reveal a card with a kicker ability from among them and put it into your hand.")
    || (m.origin === 'step' && m.fallback !== true && m.selfEntered !== true && (m.verbs ?? []).includes('chosen') && (m.verbs ?? []).includes('revealed')));
  // p2-refs-2: ~ named only by a condition about its own cast (Mention.condSelf) is a candidate only when nothing else is
  // edh-perms-12 (CR 201.5, 115.1; Phelia): ... and so is the object of its own event that leaves it where it is ('selfObject': "Whenever ~ attacks"), for a bare pronoun after a
  // target: "exile up to one other target nonland permanent. ... If it entered under your control" is the target, the permanent itself would be "~" or "this creature"
  const revealedChoice = own.some((m) => m.origin === 'step' && m.fallback !== true && m.selfEntered !== true && (m.verbs ?? []).includes('chosen') && (m.verbs ?? []).includes('revealed'));
  const chosenExiled = own.filter((m) => m.origin === 'step' && m.fallback !== true && m.selfEntered !== true && m.number === 'singular' && m.sort === 'object' && (m.verbs ?? []).includes('chosen') && isRec(m.ref) && m.ref['ref'] === 'bound' && m.ref['name'] === 'exiled').length === 1; // edh-d-66
  const demote = (m: Mention): boolean => (m.selfEntered === true && (a.head !== undefined || targeted)) || (m.enteredObject === true && a.head !== undefined && a.text.startsWith('that ') && own.some((x) => x.origin === 'target' && x.onBattlefield === true)) || m.condSelf === true || (targeted && m.selfObject === true && m.origin === 'event')
    // edh-next-41 (CR 608.2c, 701.20a; Radagast the Brown, Conjurer's Mantle): "Whenever Radagast or another nontoken creature you control enters, ... You may reveal a creature card ... from among those cards and put it
    // into your hand." / "Whenever equipped creature attacks, ... You may reveal a card that shares a creature type with that creature ... and put it into your hand.": a bare "it" after the card a reveal chose is
    // that card, never the creature the trigger's event is about (the same reading as edh-c-77's for the object itself)
    || (a.head === undefined && a.text === 'it' && m.origin === 'event' && revealedChoice && isRec(m.ref) && (m.ref['role'] === 'subject' || m.ref['role'] === 'attacker'))
    // edh-d-66 (CR 608.2c, 601.2i; The Master, Formed Anew): "When you cast this spell, you may exile a creature you control and put a takeover counter on it.": a bare "it" after an instruction
    // that chose and exiled an object of the ability is that object, never the spell the cast trigger is about (Oracle says "that spell" or "this spell" for the spell)
    || (a.head === undefined && a.text === 'it' && m.origin === 'event' && chosenExiled && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'spell')
;
  const demoted = own.filter((m) => m.fallback !== true && demote(m));
  const primary = own.filter((m) => m.fallback !== true && !demote(m));
  const fallbacks = own.filter((m) => m.fallback === true);
  let pool = primary.length > 0 ? primary : demoted.length > 0 ? own : fallbacks.length > 0 ? fallbacks : uniq;
  // edh-c-19 (CR 120.3, 608.2c; Palazzo Archers): "~ deals damage equal to its power" among several candidates is the source itself (AnaphorInfo.selfFirst)
  // (coordinator A, 2026-10-31, CR 208.1, 208.3: a noncreature permanent has no power; the source is that "its" only when it is a creature or a Vehicle, which has a
  // power while it is one; edh-fix-3's enchantment stays manual)
  if (a.selfFirst === true && pool.length > 1) {
    const selves = pool.filter((m) => (m.selfObject === true || (isRec(m.ref) && m.ref['ref'] === 'self')) && m.heads.some((h) => h === 'creature' || h === 'vehicle'));
    if (selves.length === 1) pool = selves;
  }
  // edh-next-76 (CR 201.5, 608.2c; Cyclonus, the Saboteur): "Whenever ~ deals combat damage to a player, ... If ~'s power is 5 or greater, convert it.": the object of the
  // trigger's own event ('selfObject') and the "~" a later condition names are one object, the ability's source; a bare "it" is that one candidate, not two
  if (pool.length === 2 && a.head === undefined) {
    const selfM = pool.filter((m) => isRec(m.ref) && m.ref['ref'] === 'self' && m.origin === 'event');
    const evSelf = pool.filter((m) => m.selfObject === true && m.origin === 'event' && m.sort !== 'player');
    if (selfM.length === 1 && evSelf.length === 1 && selfM[0] !== evSelf[0]) pool = [selfM[0]!];
  }
  // FAST5X E25 (CR 109.5): "its controller" names the source only when nothing else fits (AnaphorInfo.selfLast)
  if (a.selfLast === true && pool.length > 1) {
    const others = pool.filter((m) => !(m.selfObject === true || (isRec(m.ref) && m.ref['ref'] === 'self')));
    if (others.length > 0) pool = others;
  }
  // cmd1 (CR 608.2f): inside "for each opponent, ..." the demonstrative of the iterated noun ("that opponent") names the opponent of the iteration (Mention.iterates):
  // the idiom says so, not a ranking ("Whenever ~ attacks a player, for each opponent, create a token that's tapped and attacking that opponent")
  if (pool.length > 1 && a.head !== undefined) {
    // pc-keywords-mana-3 (CR 608.2f): and "that player" inside "each opponent faces a villainous choice -- That player ...": the player of the iteration, whatever else the ability mentions
    const it = pool.filter((m) => m.iterates !== undefined && (m.iterates === a.head || (a.head === 'player' && a.text === 'that player')));
    if (it.length === 1) return { ok: true, mention: it[0]! };
  }
  // edh-perms-23 (CR 608.2c, 111.1; Brudiclad, Telchor Engineer): "Create a token. Then you may choose a token you control. If you do, each other token you control becomes a copy of
  // that token.": "that token" is the token the sentence before chose, not the token an earlier sentence created (the chosen one is the later, nearer mention); only when every
  // other candidate is a token created in an earlier sentence
  if (pool.length > 1 && a.head === 'token' && a.text.startsWith('that ')) {
    const chosen = pool.filter((m) => m.origin === 'step' && (m.verbs ?? []).includes('chosen'));
    if (chosen.length === 1 && pool.every((m) => m === chosen[0] || (m.origin === 'step' && (m.verbs ?? []).includes('created') && m.unit < chosen[0]!.unit))) return { ok: true, mention: chosen[0]! };
  }
  // std-rx12 (CR 111.1, 608.2c; Iroh, Tea Master): Oracle names an object "that token" only after its own words called it a token ("create a 1/1 white Ally creature
  // token ... on that token"); a permanent of a description that never says token ("target permanent you control", the wildcard head) is no such antecedent when
  // exactly one candidate says it. Only the head "token"
  if (pool.length > 1 && a.head === 'token') {
    const said = pool.filter((m) => m.heads.includes('token'));
    if (said.length === 1) return { ok: true, mention: said[0]! };
  }
  // std-costs-6 (CR 601.2c, 702.194b): "the chosen card" after "Choose target X. If this spell was cast using teamwork, instead choose target Y.": the one object of
  // the announcement that is made (a singular union, mentions.ts#insteadChosenGroup) and not either target alone
  if (pool.length > 1) {
    const group = pool.filter((m) => m.number === 'singular' && isRec(m.ref) && m.ref['ref'] === 'union' && Array.isArray(m.ref['of']) && (m.verbs ?? []).includes('chosen'));
    const of = group.length === 1 ? ((group[0]!.ref as Record<string, unknown>)['of'] as unknown[]).map((r) => JSON.stringify(r)) : [];
    if (of.length > 0 && pool.every((m) => m === group[0] || of.includes(JSON.stringify(m.ref)))) return { ok: true, mention: group[0]! };
  }
  // edh-zones-16 (CR 608.2c, 701.20a; Wild Magic Surge): "Destroy target permanent an opponent controls. Its controller reveals cards from the top of their library until they reveal a permanent
  // card that shares a card type with that permanent. They put that card onto the battlefield ...": the permanent that was destroyed is no "card" Oracle would call "that card" (it names
  // it "that permanent", CR 400.7); with the card a reveal stopped at as the other candidate, "that card" is the revealed one
  if (pool.length === 2 && a.head === 'card' && a.text === 'that card') {
    // edh-zones-26 (CR 608.2c, 701.13a; Tibalt's Trickery): the card an exile-until stopped at is "that card" beside a countered spell (a spell is not called a card while it is on the stack)
    const revealed = pool.filter((m) => m.origin === 'step' && m.number === 'singular' && ((m.verbs ?? []).includes('revealed') || (m.verbs ?? []).includes('exiled')));
    const gone = pool.filter((m) => m.origin === 'target' && ((m.verbs ?? []).includes('destroyed') || (m.verbs ?? []).includes('exiled') || m.heads.includes('spell')) && !(m.verbs ?? []).includes('revealed'));
    if (revealed.length === 1 && gone.length === 1) return { ok: true, mention: revealed[0]! };
  }
  // edh-d-78 (CR 608.2c, 701.21a, 701.23; Transmute Artifact): "Sacrifice an artifact. If you do, search your library for an artifact card. If that card's mana value is ...": the sacrificed
  // permanent is a card in a graveyard only; Oracle calls it "the sacrificed artifact" (as the destroyed permanent of edh-zones-16 is "that permanent"), so "that card" is the card the search found
  if (pool.length === 2 && a.head === 'card' && a.text === 'that card') {
    const found = pool.filter((m) => m.origin === 'step' && m.number === 'singular' && (m.verbs ?? []).includes('found'));
    const sacrificed = pool.filter((m) => m.origin === 'step' && (m.verbs ?? []).includes('sacrificed') && !(m.verbs ?? []).includes('found'));
    if (found.length === 1 && sacrificed.length === 1) return { ok: true, mention: found[0]! };
  }
  // edhn78 (CR 608.2c, 400.7, 406.3; Astral Slide): "Whenever a player cycles a card, you may exile target creature. If you do, return that card to the battlefield": "that card" is the target
  // the sentence before exiled (a card in exile now, the nearest mention), never the card the trigger's own event is about; only when every other candidate is such an event object
  if (pool.length > 1 && ((a.head === 'card' && a.text === 'that card') || (a.head === undefined && a.text === 'its'))) {
    const exiledTarget = pool.filter((m) => m.origin === 'target' && (m.verbs ?? []).includes('exiled') && m.number === 'singular');
    if (exiledTarget.length === 1 && pool.every((m) => m === exiledTarget[0] || m.origin === 'event')) return { ok: true, mention: exiledTarget[0]! };
  }
  // edh-next-87 (CR 608.2c, 201.5, 701.21a; Angelic Renewal): "Whenever a creature is put into your graveyard from the battlefield, you may sacrifice this enchantment. If you do, return that card to the battlefield.":
  // the object the ability sacrificed by its own name ("this enchantment", Mention.namedSelf) is never "that card" (Oracle would say "it"); "that card" is the card the trigger's event is about
  if (pool.length > 1 && a.head === 'card' && a.text === 'that card') {
    const named = pool.filter((m) => m.namedSelf === true && m.origin === 'event' && (m.verbs ?? []).includes('sacrificed'));
    const rest = pool.filter((m) => !named.includes(m));
    if (named.length > 0 && rest.length === 1 && rest[0]!.origin === 'event') return { ok: true, mention: rest[0]! };
  }
  // edh-top-8 (CR 608.2c, 608.2d; Gix, Yawgmoth Praetor): "its controller may pay 1 life. If they do, they draw a card.": the subject "they" is the player whose option the sentence before was
  // (Mention.optionActor), beside the players the event itself names (the player dealt damage), never beside another player of the ability's own instructions
  if (pool.length > 1 && a.head === undefined && a.participle === undefined && (a.text === 'they' || a.text === 'their')) {
    const actors = pool.filter((m) => m.optionActor === true);
    if (actors.length === 1 && pool.every((m) => m === actors[0] || m.origin === 'event')) return { ok: true, mention: actors[0]! };
  }
  // edh-d-69 (CR 608.2c, 701.20a; Sauron's Ransom): "Choose an opponent. They look at the top four cards of your library and separate them into ...": the subject "they" is the chosen
  // player, never the cards that very instruction looks at (the bound name `looked`, made by the look step the subject performs)
  if (pool.length > 1 && a.head === undefined && a.participle === undefined && a.text === 'they') {
    const chosen = pool.filter((m) => m.sort === 'player' && isRec(m.ref) && m.ref['ref'] === 'bound' && m.ref['name'] === 'chosenPlayer');
    if (chosen.length === 1 && pool.every((m) => m === chosen[0] || (isRec(m.ref) && m.ref['ref'] === 'bound' && m.ref['name'] === 'looked'))) return { ok: true, mention: chosen[0]! };
  }
  // edh-c-77: ... "its controller" (AnaphorInfo.selfLast) inside a delayed trigger of an event that names a description of its object: that object, never a target of the sentence that created it
  if (pool.length > 1 && a.selfLast === true && a.head === undefined) {
    const mine = pool.filter((m) => m.delayOwn === true);
    if (mine.length === 1) return { ok: true, mention: mine[0]! };
  }
  // edh-d-61 (CR 603.7c, 201.5; Golden Guardian): "{2}: This creature fights another target creature you control. When this creature dies this turn, return it to the battlefield transformed": a bare "it"
  // in the body of a delayed trigger whose event names the ability's own object is that object, beside the target of the sentence that created the trigger
  if (pool.length > 1 && a.text === 'it' && a.head === undefined && a.selfLast !== true) {
    const mine = pool.filter((m) => m.delayOwnSelf === true);
    if (mine.length === 1) return { ok: true, mention: mine[0]! };
  }
  // edh-d-97 (CR 608.2c, 608.2d; Sin Prodder ruling 2016-04-08): "Any opponent may ... If a player does, ~ deals damage to that player ...": "that player" is the one opponent who did it
  // (lower/mentions.ts#anyOneDidOf), never the player the trigger's event names ("your upkeep": you)
  if (pool.length > 1 && a.text === 'that player') {
    const doer = pool.filter((m) => m.origin === 'step' && m.bindKey === 'didAs' && m.number === 'singular');
    if (doer.length === 1 && pool.every((m) => m === doer[0] || m.origin === 'event')) return { ok: true, mention: doer[0]! };
  }
  return pool.length === 1 ? { ok: true, mention: pool[0]! } : { ok: false, count: pool.length };
}

/** The diagnostic text of a failed resolution. */
export function unresolvedReason(a: AnaphorInfo, r: { count: number; opaque?: boolean }): string {
  if (r.opaque) return `"${a.text}" may refer to something a part that is not understood mentions (design 6.4)`;
  return `"${a.text}" has ${r.count === 0 ? 'no' : r.count} compatible antecedent${r.count === 1 ? '' : 's'} (design 6.4)`;
}

/** The surface words of the pronouns whose AnaphorInfo text is canonical (parser/holes: "its controller", "its power" and "it's" are all "it"). */
const SURFACE: Readonly<Record<string, readonly string[]>> = {
  it: ['it', 'its', "it's", 'itself'],
  them: ['them', 'themselves'],
  they: ['they', 'their', 'theirs', "they're", 'them', "they've"], // p2-damage-2: "cards they've drawn this turn"
  their: ['their', 'theirs'],
};

/** Token indices where the words of `text` (or, for a pronoun, any of its surface forms) start in the unit. */
function occurrences(tokens: readonly Tok[], text: string): number[] {
  const want = text.toLowerCase();
  const forms = SURFACE[want];
  if (forms !== undefined) return tokens.flatMap((t, i) => (forms.includes(t.norm.toLowerCase()) ? [i] : []));
  const out: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j <= Math.min(tokens.length, i + 4); j++) if (spanText(tokens, i, j).toLowerCase() === want) { out.push(i); break; }
  }
  return out;
}

/**
 * FAST5 T76 (design 6.4: pronouns look back): the object itself, named by "~" / "this creature" only AFTER the pronoun in the sentence, is no antecedent of it
 * ("it endures X, where X is the number of counters on this creature": "it" is the creature that entered, the counters are read afterwards). Only the mention the
 * sentence itself makes of the object (a step's own quantity or condition), never the one a trigger gives it.
 */
function withoutLaterSelf(a: AnaphorInfo, mentions: readonly Mention[], tokens: readonly Tok[], unit: number): readonly Mention[] {
  if (a.head !== undefined) return mentions;
  const selfAt = tokens.flatMap((t, i) => (t.kind === 'SELF' ? [i] : []));
  if (selfAt.length === 0 || !mentions.some((m) => m.unit === unit && m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'self')) return mentions;
  const at = occurrences(tokens, a.text);
  if (at.length === 0 || !selfAt.every((p) => at.every((q) => q < p))) return mentions;
  return mentions.filter((m) => !(m.unit === unit && m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'self' && m.pos === undefined));
}

/**
 * edh-perms-14 (design 6.4: pronouns look back; Deekah, Cori-Steel Cutter): the spell a cast trigger is about, named in the sentence only AFTER the pronoun by "that spell"
 * ("create a Fractal token. Put X +1/+1 counters on it, where X is that spell's mana value"), is no antecedent of the pronoun: Oracle names it where it is meant. Only a bare
 * pronoun, and only when another mention stays compatible (nothing that resolved before changes: the pronoun never loses its only candidate).
 */
function withoutLaterSpell(a: AnaphorInfo, mentions: readonly Mention[], tokens: readonly Tok[], unit: number): readonly Mention[] {
  if (a.head !== undefined) return mentions;
  const isSpell = (m: Mention): boolean => m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'spell';
  if (!mentions.some(isSpell)) return mentions;
  const thatSpell = tokens.flatMap((t, i) => (t.norm.toLowerCase() === 'that' && tokens[i + 1]?.norm.toLowerCase() === 'spell' ? [i] : []));
  const at = occurrences(tokens, a.text);
  if (thatSpell.length === 0 || at.length === 0 || !thatSpell.every((p) => at.every((q) => q < p))) return mentions;
  const kept = mentions.filter((m) => !isSpell(m));
  return kept.some((m) => m.unit <= unit && compatible(a, m)) ? kept : mentions;
}

/**
 * edh-next-124 (design 6.4; CR 115.4, 608.2c; Minsc & Boo, Timeless Heroes): "Sacrifice a creature. When you do, ~ deals X damage to any target, where X is that creature's power.": "any
 * target" of the sentence itself is no antecedent of "that creature" (Oracle names an object or player any target chose "that permanent or player", "it", never by one card type),
 * when an earlier sentence's creature stays compatible (nothing that resolved before changes: the anaphor never loses its only candidate).
 */
function withoutAnyTargetAsCreature(a: AnaphorInfo, mentions: readonly Mention[], unit: number): readonly Mention[] {
  if (a.head !== 'creature' || a.orHead !== undefined || a.number !== 'singular' || !/^that creature\b/i.test(a.text)) return mentions;
  const anyHere = (m: Mention): boolean => m.sort === 'any' && m.origin === 'target' && m.unit === unit;
  if (!mentions.some(anyHere)) return mentions;
  const kept = mentions.filter((m) => !anyHere(m));
  return kept.some((m) => m.unit < unit && m.sort === 'object' && compatible(a, m)) ? kept : mentions;
}

/**
 * Design 6.4: pronouns look back. A target of the sentence itself is a candidate only if the phrase of the target comes before the pronoun. The pronoun
 * is located by its words in the sentence; when it occurs both before and after the target phrase (or cannot be found), its place is unknown and so is
 * the candidate set (null: the reference is unresolved).
 */
function lookBack(a: AnaphorInfo, all: readonly Mention[], tokens: readonly Tok[], unit: number): Mention[] | null {
  const mentions = withoutAnyTargetAsCreature(a, withoutLaterSpell(a, withoutLaterSelf(a, all, tokens, unit), tokens, unit), unit);
  if (!mentions.some((m) => m.pos !== undefined && compatible(a, m))) return [...mentions];
  const at = occurrences(tokens, a.text);
  if (at.length === 0) return null;
  const out: Mention[] = [];
  for (const m of mentions) {
    if (m.pos === undefined || !compatible(a, m)) { out.push(m); continue; }
    // edh-top-3 (CR 115.1, 509.1h; Tinder Wall): a pronoun inside the target's own words ("target creature it's blocking") is neither before nor after the phrase
    const outside = m.len === undefined ? at : at.filter((p) => p < m.pos! || p >= m.pos! + m.len!);
    if (outside.length === 0) return null;
    const before = outside.filter((p) => p < m.pos!).length;
    if (before === outside.length) continue; // every use of these words precedes the target phrase: not an antecedent
    if (before > 0) return null; // the same words before and after the target phrase: the place of this one is unknown
    out.push(m);
  }
  return out;
}

/** The reference to write for a resolved mention; a step mention gets an `as` name on its step if it has none. */
function bind(m: Mention, d: Draft): Rec {
  // edh-zones-9: "both cards", each of the two cards by the reference that names it as the sentence before left it (a target that was moved is its new object, CR 400.7)
  if (m.bindKey === 'both' && m.parts !== undefined) return { ref: 'union', of: m.parts.map((p) => bindMoved(p, d) ?? bind(p, d)) };
  if (m.origin !== 'step') return clone(m.ref);
  // trek-7 (CR 406.1, 608.2c; lower/mentions.ts#exiledRestOf): "the rest" of the cards an `exileUntil` exiled: every card it exiled (`exiled`) less the one it stopped at
  // (`as`), still in exile; the step gets both names now that a reference reads them
  // edh-zones-15 (CR 406.1, 601.2a; lower/mentions.ts#exiledNotCastOf): "the exiled cards that weren't cast this way": every card an `exileUntil` exiled that is still in exile
  if (m.bindKey === 'exiledNotCast') {
    const sm = m as StepMention;
    const at = stepsInOrder(sm.unitRef.steps).find((s) => s.path === sm.path);
    if (at === undefined) return clone(m.ref);
    if (typeof at.step['exiled'] !== 'string') at.step['exiled'] = freshName(d, 'exiledCards');
    return { ref: 'each', filter: { is: { ref: 'bound', name: at.step['exiled'] }, zone: 'exile' } };
  }
  // edh-top-9 (CR 406.1, 608.2c; lower/mentions.ts#exiledAllOf): "a nonland card exiled this way": every card the `exileUntil` exiled, under its `exiled` name
  if (m.bindKey === 'exiledAll') {
    const sm = m as StepMention;
    const at = stepsInOrder(sm.unitRef.steps).find((s) => s.path === sm.path);
    if (at === undefined) return clone(m.ref);
    if (typeof at.step['exiled'] !== 'string') at.step['exiled'] = freshName(d, 'exiledCards');
    return { ref: 'bound', name: at.step['exiled'] };
  }
  if (m.bindKey === 'exiledRest') {
    const sm = m as StepMention;
    const at = stepsInOrder(sm.unitRef.steps).find((s) => s.path === sm.path);
    if (at === undefined) return clone(m.ref);
    if (typeof at.step['as'] !== 'string') at.step['as'] = freshName(d, 'hit');
    if (typeof at.step['exiled'] !== 'string') at.step['exiled'] = freshName(d, 'exiledCards');
    return { ref: 'each', filter: { is: { ref: 'bound', name: at.step['exiled'] }, not: { is: { ref: 'bound', name: at.step['as'] } }, zone: 'exile' } };
  }
  // edh-zones-26 (CR 608.2c; lower/mentions.ts#isGatheringRepeat): the cards the runs of an optional repeat exiled, one group; the repeat gathers what its body's step bound each run
  if (m.bindKey === 'repeatGather') {
    const sm = m as StepMention;
    const at = stepsInOrder(sm.unitRef.steps).find((x) => x.path === sm.path);
    const body = at !== undefined && Array.isArray(at.step['do']) ? at.step['do'][0] : undefined;
    if (at === undefined || !isRec(body)) return clone(m.ref);
    if (typeof body['as'] !== 'string') body['as'] = freshName(d, 'run');
    if (!isRec(at.step['gather'])) at.step['gather'] = { as: freshName(d, 'exiledAll'), of: body['as'] };
    return { ref: 'bound', name: String((at.step['gather'] as Rec)['as']) };
  }
  if (m.ref['ref'] === 'each') return clone(m.ref); // FAST5 T43: "the rest" of a choice is the group less the chosen cards, written out (lower/mentions.ts#restOf)
  // r5-refs: the player of an option named through an object ("its controller may ..."): that reference itself, never a name of the option (lower/mentions.ts)
  if (m.sort === 'player' && m.ref['ref'] !== 'bound') return clone(m.ref);
  const sm = m as StepMention;
  const at = stepsInOrder(sm.unitRef.steps).find((s) => s.path === sm.path);
  if (at === undefined) return clone(m.ref);
  // edh-top-15 (CR 701.3d): the permanent an unattach let go of, under the step's own `hostAs` (lower/mentions.ts#hostOf)
  if (m.bindKey === 'hostAs') return { ref: 'bound', name: String(at.step['hostAs']) };
  // C6 (CR 101.3): the players of a group who can't, named by the step's `cantAs` (lower/mentions.ts#cantOf)
  if (m.bindKey === 'cantAs' || m.bindKey === 'cantOpp') {
    if (typeof at.step['cantAs'] !== 'string') at.step['cantAs'] = freshName(d, 'cant');
    if (m.bindKey === 'cantOpp') return { ref: 'otherOf', of: { ref: 'bound', name: at.step['cantAs'] }, than: { ref: 'you' } }; // edh-next-114
    return { ref: 'bound', name: at.step['cantAs'] };
  }
  // edh-players-11 (CR 608.2c, 101.4): the players of a group `may` who did it, under the step's `as` (effects/handlers/control.ts#bindDoers)
  if (m.bindKey === 'didAs' || m.bindKey === 'didOpp') {
    if (typeof at.step['as'] !== 'string') at.step['as'] = freshName(d, 'did');
    const doers = { ref: 'bound', name: at.step['as'] };
    return m.bindKey === 'didAs' ? doers : { ref: 'otherOf', of: doers, than: { ref: 'you' } };
  }
  // std-rx32 (CR 608.2f): the objects a loop's body made, all of them: the loop gathers them under the body step's name (lower/mentions.ts#StepMention.gathered)
  if (sm.gathered !== undefined) {
    const loop = stepsInOrder(sm.unitRef.steps).find((s) => s.path === sm.gathered);
    if (loop === undefined) return clone(m.ref);
    if (typeof at.step['as'] !== 'string') at.step['as'] = freshName(d, 'made');
    loop.step['gather'] = at.step['as'];
    return { ref: 'bound', name: at.step['as'] };
  }
  if (typeof at.step['as'] !== 'string') {
    const op = String(at.step['op']);
    at.step['as'] = freshName(d, op === 'createToken' ? 'token' : op === 'search' ? 'found' : op === 'chooseObjects' ? 'chosen' : looksAtOneCard(at.step) ? 'seen' : 'them'); // LOOK1: one card
  }
  return { ref: 'bound', name: at.step['as'] };
}

/**
 * WP20 INTERFACE CHANGE (review): candidates that are not mentions of the discourse model, because they are bound by the clause itself (CR 608.2c reads each
 * instruction for each object or player it names). Two shapes, both found on real cards that were automated with the wrong antecedent:
 *  - an "it"/"its" inside a comparison of a filter ("for each creature you control with toughness greater than its power"): the filtered object is a
 *    candidate (it is what the comparison is about), so the source is not the unique one;
 *  - a player pronoun ("they", "their", "that player") inside a step whose subject is a set of players ("each opponent loses 1 life for each creature they
 *    control"): each player of that set in turn is a candidate, so a trigger's event player is not the unique one.
 * Either makes the reference ambiguous: the sentence is manual (design 6.4: no ranking), never bound to the wrong antecedent.
 */
function implicitCandidate(root: unknown, path: string, a: AnaphorInfo): string | null {
  let cur: unknown = root;
  let inFilter = false;
  let filterQuantity = false;
  let step: Rec | null = null;
  let namesGroup = false; // combined copy: the pronoun is the `than` of an "every player but one" group ("each of that player's opponents"): it defines the group, no player of it
  for (const k of path.split('/').slice(1)) {
    if (isRec(cur)) {
      if (typeof cur['op'] === 'string' && /^[a-z]/i.test(cur['op'])) step = cur; // an effect step (a comparison's op is a symbol)
      if (cur['ref'] === 'otherOf' && k === 'than') namesGroup = true;
      if (inFilter && typeof cur['q'] === 'string') filterQuantity = true;
      if (k === 'filter') inFilter = true;
      cur = cur[k];
    } else if (Array.isArray(cur)) cur = cur[Number(k)];
    else break;
  }
  if (a.sort === 'object' && a.head === undefined && filterQuantity) return 'the object the filter compares is a candidate too (CR 608.2c, design 6.4)';
  const playerWord = (a.sort === 'player' || a.sort === 'any') && (a.head === undefined || PLAYER_HEADS.has(a.head));
  // C6: so is a subject that is a group of players of another kind: "each player who controls the most ...", "each opponent who can't ..." (CR 608.2c)
  const groupOf = (v: Rec): boolean => v['ref'] === 'controlsMost' || v['ref'] === 'controlsAny' || v['ref'] === 'otherOf' || (isRec(v['$anaphor']) && v['$anaphor']['participle'] === 'cant');
  const eachPlayer = step !== null && Object.values(step).some((v) => isRec(v) && (v['ref'] === 'eachWho' || (v['ref'] === 'each' && typeof v['who'] === 'string') || (groupOf(v) && a.participle !== 'cant')));
  if (playerWord && eachPlayer && !namesGroup) return 'each player of the subject is a candidate too (CR 608.2c, design 6.4)';
  return null;
}

/** edh-players-12: the amount of each step a group's player pronoun is read for (groupChooser). */
const GROUP_AMOUNT_KEY: Readonly<Record<string, string>> = { loseLife: 'amount', gainLife: 'amount', damage: 'amount', draw: 'count', discard: 'count', createToken: 'count' /* edh-c-27: Waiting in the Weeds */ };
const GROUP_AMOUNT_WORDS: ReadonlySet<string> = new Set(['they', 'their', 'them', 'that player']);

/**
 * C6 (CR 608.2e, 101.4, 701.21a): "Each opponent sacrifices a creature with the greatest power among creatures they control" / "... that player controls": a player
 * pronoun in the filter of a sacrifice whose subject is a group of players (`who: {ref:'each'}`) is each of those players in turn, the one choosing (the engine binds
 * them as `{ref:'iterating'}` while they choose, effects/handlers/zones-remove.ts#asChooser). Only "they", "their" and "that player" there; anywhere else in such a
 * step the subject's players stay an ambiguity (implicitCandidate).
 */
function groupChooser(root: unknown, path: string, a: AnaphorInfo, others: readonly Mention['origin'][] = []): boolean {
  if (!GROUP_AMOUNT_WORDS.has(a.text) || a.participle !== undefined) return false;
  const old = a.text !== 'them'; // (the readings below keep their own words)
  if (!((a.sort === 'player' && a.head === 'player') || (a.sort === 'any' && a.head === undefined) || (a.sort === 'player' && a.text === 'their' && a.head === undefined))) return false;
  let cur: unknown = root;
  let step: Rec | null = null;
  let under: string | null = null;
  for (const k of path.split('/').slice(1)) {
    if (isRec(cur)) {
      if (typeof cur['op'] === 'string' && /^[a-z]/i.test(cur['op']) && cur['q'] === undefined) { step = cur; under = k; } // (r5-refs: a quantity's `op` is no step)
      cur = cur[k];
    } else if (Array.isArray(cur)) cur = cur[Number(k)];
    else return false;
  }
  if (step === null) return false;
  // edh-players-12 (CR 608.2e, 101.4, 107.1a): "Each opponent loses life equal to the number of creatures attacking them / cards that player has drawn this turn" (Within
  // Range, Molten Psyche): a player pronoun in the AMOUNT of a lose/gain-life, draw, discard or damage step whose subject is a group of players (`each`, nothing else
  // said of it) is each of those players in turn; the engine reads the amount for each of them (effects/handlers/lifedamage.ts, cards-draw.ts, `readFor`). Never
  // when the sentence has another player the pronoun could mean (a target, the player of the trigger): it stays an ambiguity (design 6.4),
  // and only for a group that is just "each opponent / each player".
  // ('they', 'their', 'them' are the subject's own words; only a target or a sentence not understood could be meant instead, "that player" also a player of the trigger's event)
  if (!others.some((o) => o !== 'event' || a.text === 'that player')) {
    const key = GROUP_AMOUNT_KEY[String(step['op'])];
    const group = step['op'] === 'damage' ? step['to'] : step['who'];
    if (key !== undefined && under === key && isRec(group) && group['ref'] === 'each' && (group['who'] === 'opponent' || group['who'] === 'player') && Object.keys(group).length === 2) return true;
    // edh-next-143 (CR 608.2d, 608.2e; Khorvath's Fury): ... and the players an earlier "For each player, choose friend or foe." chose the word for ("each foe equal to the number of cards in their hand")
    if (key !== undefined && under === key && isRec(group) && group['ref'] === 'chose' && Object.keys(group).length === 3) return true;
  }
  if (!old) return false;
  // "for each player, choose a creature that player controls" (CR 608.2c, 101.4): the choice for each player binds that player while its objects are read
  if (step['op'] === 'chooseObjects' && under === 'from' && isRec(step['perPlayer'])) return true;
  // r5-refs (CR 608.2e, 101.4): ... and in its count ("sacrifices half the creatures they control of their choice": half of that player's creatures), read for each player
  return step['op'] === 'sacrificeChoice' && (under === 'filter' || under === 'count') && isRec(step['who']) && (step['who']['ref'] === 'eachWho' || (step['who']['ref'] === 'each' && typeof step['who']['who'] === 'string'));
}

/**
 * Design 3.1 rule 4: a reference that acts on an object an earlier step moved ("exile target creature, then return it") names the moving step with `as`
 * and uses `{ref:'bound'}` (a binding is re-based onto the new object in a public zone, CR 400.7j; a target or self handle is not). Null when the moving
 * step cannot be found (the plain reference is kept).
 */
function bindMoved(m: Mention, d: Draft): Rec | null {
  const mv = m.movedBy;
  if (mv === undefined) return null;
  const at = stepsInOrder(mv.unitRef.steps).find((s) => s.path === mv.path);
  if (at === undefined) return null;
  if (typeof at.step['as'] !== 'string') at.step['as'] = freshName(d, 'moved');
  return { ref: 'bound', name: at.step['as'] };
}

/**
 * Paths (in `rewrite`'s scheme) of the anaphor markers that are what a step acts on, not a property read ("return it" vs "its controller"); the object an
 * `effect` step's effects apply to ("it gets +2/+2") acts on it too (mentions.ts#actedOn, WP21 review).
 */
function actingPaths(value: unknown): Set<string> {
  const out = new Set<string>();
  visit(value, (node, path) => {
    if (typeof node['op'] !== 'string') return;
    for (const [k, v] of actedOn(node)) if (isRec(v) && isRec(v['$anaphor'])) out.add(`${path}${k}`);
    // FAST5X E29 (CR 400.7, 601.3): the card a play or cast permission names is the card as an earlier instruction left it ("Exile target card from your
    // graveyard. Until the end of your next turn, you may cast that card.": the card in exile, the new object the move made, not the target in the graveyard)
    if (node['op'] === 'effect' && Array.isArray(node['effects'])) {
      node['effects'].forEach((e, i) => {
        if (isRec(e) && e['s'] === 'permit' && isRec(e['of']) && isRec(e['of']['is']) && isRec(e['of']['is']['$anaphor'])) out.add(`${path}/effects/${i}/of/is`);
        // p2-replace-events-2 (CR 400.7, 614.1a): so is the object a replacement effect created by an instruction is about ("Return target creature card from your
        // graveyard to the battlefield. If that creature would leave the battlefield, exile it instead of putting it anywhere else.": the permanent the move made)
        const subj = isRec(e) && e['s'] === 'replace' && isRec(e['replaces']) ? e['replaces']['subject'] : undefined;
        if (isRec(subj) && isRec(subj['is']) && isRec(subj['is']['$anaphor'])) out.add(`${path}/effects/${i}/replaces/subject/is`);
      });
    }
    // std-rx16 (CR 400.7, 608.2f): so are the cards of "For each of those cards, its owner may play it ..." (a permission for each card of the group in turn): the
    // cards an earlier instruction moved, as it left them ("Exile up to X target creatures.": the cards in exile, not the targets on the battlefield)
    if (node['op'] === 'forEach' && isRec(node['over']) && isRec(node['over']['$anaphor']) && typeof node['as'] === 'string' && Array.isArray(node['do'])) {
      const each = JSON.stringify({ is: { ref: 'bound', name: node['as'] } });
      const permits = node['do'].every((x) => isRec(x) && x['op'] === 'effect' && Array.isArray(x['effects'])
        && x['effects'].every((e) => isRec(e) && e['s'] === 'permit' && JSON.stringify(e['of']) === each));
      if (permits) out.add(`${path}/over`);
    }
  });
  return out;
}

/**
 * FAST2 T10: the object an `attach` step attaches, when the anaphor at `path` is where it goes ("attach ~ to it"): an object is never attached to itself
 * (CR 301.5c, 303.4d), so that object is no antecedent of this pronoun. T55 (the other direction): when the anaphor is the object attached ("Attach it to
 * U.S.Agent"), what it is attached to is no antecedent of it. Null for any other position, or when the other object is itself an anaphor.
 */
function attachedObject(root: unknown, path: string, resolved?: ReadonlyMap<string, Rec>): Rec | null {
  let cur: unknown = root;
  let step: Rec | null = null;
  let side: 'to' | 'what' = 'to';
  const keys = path.split('/').slice(1);
  keys.forEach((k, i) => {
    if (isRec(cur)) {
      if (cur['op'] === 'attach' && i === keys.length - 1 && (k === 'to' || k === 'what')) { step = cur; side = k; }
      cur = cur[k];
    } else if (Array.isArray(cur)) cur = cur[Number(k)];
  });
  const other = step === null ? undefined : (step as Rec)[side === 'to' ? 'what' : 'to'];
  // std-rx32: the other side said as a reference word this rewrite already resolved ("Attach it to the chosen creature": "it" is resolved first)
  if (isRec(other) && isRec(other['$anaphor']) && resolved !== undefined) return resolved.get(`${path.slice(0, path.lastIndexOf('/'))}/${side === 'to' ? 'what' : 'to'}`) ?? null;
  return isRec(other) && !isRec(other['$anaphor']) ? other : null;
}

/**
 * std-hob (CR 301.5, 303.4, 301.6, 701.3b): is the anaphor at `path` the object an `attach` step attaches ("attach it to target creature you control")? Only an
 * Aura, an Equipment or a Fortification is attached, so a creature that is none of them (and cannot become one) is no antecedent of that pronoun.
 */
function attachedWhat(root: unknown, path: string): boolean {
  let cur: unknown = root;
  const keys = path.split('/').slice(1);
  let hit = false;
  keys.forEach((k, i) => {
    if (isRec(cur)) {
      if (cur['op'] === 'attach' && i === keys.length - 1 && k === 'what') hit = true;
      cur = cur[k];
    } else if (Array.isArray(cur)) cur = cur[Number(k)];
  });
  return hit;
}

/**
 * FAST4 T33: the subject of a block requirement or restriction, when the anaphor at `path` is the creature it blocks (`other: {is: it}`, "you may have target
 * creature block it this turn if able"): a creature never blocks itself (CR 509.1a: blockers are the defending player's creatures, attackers the active
 * player's), so that subject is no antecedent of this pronoun. Null for any other position, or when the subject is itself an anaphor.
 */
function blockSubject(root: unknown, path: string): Rec | null {
  const keys = path.split('/').slice(1);
  if (keys.length < 2 || keys[keys.length - 1] !== 'is' || keys[keys.length - 2] !== 'other') return null;
  let cur: unknown = root;
  for (const k of keys.slice(0, -2)) cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
  if (!isRec(cur) || cur['s'] !== 'restrict' || cur['action'] !== 'block') return null;
  const subject = cur['subject'];
  return isRec(subject) && !isRec(subject['$anaphor']) ? subject : null;
}

/**
 * std-cardcopy-5 (CR 707.2, 613.1a): the object a copy effect changes, when the anaphor at `path` is what it becomes a copy of ("Until end of turn, target token you
 * control becomes a copy of it, except it has flying."): an object never becomes a copy of itself, so a target it affects is no antecedent of this pronoun. Only a
 * target (the object itself is "~"). Null for any other position.
 */
function copySubject(root: unknown, path: string): Rec | null {
  const keys = path.split('/').slice(1);
  if (keys[keys.length - 1] !== 'copyOf' || keys.length < 4) return null;
  let cur: unknown = root;
  for (const k of keys.slice(0, -3)) cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
  if (!isRec(cur) || cur['s'] !== 'continuous') return null;
  const affects = cur['affects'];
  return isRec(affects) && affects['ref'] === 'target' && !isRec(affects['$anaphor']) ? affects : null;
}

/** edh-perms-13: is the anaphor at `path` what a copy effect copies (a `copyOf` of a continuous effect, the `what` of a `copy` step)? */
function copiesIt(root: unknown, path: string): boolean {
  const keys = path.split('/').slice(1);
  const last = keys[keys.length - 1];
  if (last === 'copyOf') return true;
  return last === 'what' && stepAt(root, path)?.['op'] === 'copy';
}

/**
 * edh-perms-13 (CR 707.2, 613.1a; Sunfrill Imitator): the object a copy effect makes a copy of, when the anaphor at `path` is the object that becomes the copy ("you may have it
 * become a copy of another target Dinosaur you control"): an object never becomes a copy of itself, so a target it is a copy of is no antecedent of this pronoun. Only a target.
 * Null for any other position.
 */
function copyOfTarget(root: unknown, path: string): Rec | null {
  const keys = path.split('/').slice(1);
  if (keys[keys.length - 1] !== 'affects' || keys.length < 3) return null;
  let cur: unknown = root;
  for (const k of keys.slice(0, -1)) cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
  if (!isRec(cur) || cur['s'] !== 'continuous' || !Array.isArray(cur['mods'])) return null;
  for (const m of cur['mods']) {
    const of = isRec(m) ? m['copyOf'] : undefined;
    if (isRec(of) && of['ref'] === 'target' && !isRec(of['$anaphor'])) return of;
  }
  return null;
}

/**
 * r5-fxb (CR 120.1, 608.2c): the source of a damage step, when the anaphor at `path` is what that step deals the damage to ("Target creature you control deals
 * damage equal to its power to that permanent."): a source dealing damage to itself is "itself" in Oracle wording, never "that permanent" or "it", so that
 * source is no antecedent of this pronoun. Only a target as the source (the object itself is no mention of its own step, lower/mentions.ts#mentionsAt). Null for
 * any other position.
 */
function damageSource(root: unknown, path: string): Rec | null {
  const keys = path.split('/').slice(1);
  if (keys[keys.length - 1] !== 'to') return null;
  let cur: unknown = root;
  for (const k of keys.slice(0, -1)) cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
  if (!isRec(cur) || cur['op'] !== 'damage') return null;
  const source = cur['source'];
  return isRec(source) && source['ref'] === 'target' && !isRec(source['$anaphor']) ? source : null;
}

/**
 * p2-damage-2 (CR 701.14a, 701.14c): the target creature that fights, when the anaphor at `path` is the creature it fights ("Target creature you control fights that
 * creature.", Time to Feed): Oracle says "fights itself" of a creature that fights itself, so a demonstrative there is never the fighter. Null for any other position.
 */
function fightSubject(root: unknown, path: string): Rec | null {
  const keys = path.split('/').slice(1);
  if (keys[keys.length - 1] !== 'b') return null;
  let cur: unknown = root;
  for (const k of keys.slice(0, -1)) cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
  if (!isRec(cur) || cur['op'] !== 'fight' || cur['pairs'] === true) return null;
  const a = cur['a'];
  return isRec(a) && a['ref'] === 'target' && !isRec(a['$anaphor']) ? a : null;
}

/**
 * r5-fxb (CR 120.1, 208.1, 608.2h; as ownSourceMention for ~): the target source of a damage step, when the anaphor at `path` is a property read in that step's
 * amount ("Target creature you control deals damage equal to its power to that permanent": "its" is the subject of the clause). Null for any other position.
 */
function damageAmountSource(root: unknown, path: string, acting: ReadonlySet<string>, resolved?: ReadonlyMap<string, Rec>): Rec | null {
  if (acting.has(path) || !/\/amount(\/|$)/.test(path)) return null;
  const step = stepAt(root, path);
  let source = step?.['source'];
  // std-rx32 (CR 120.1, 608.2h): a source said as a reference word that already names one target ("The creature you control deals damage equal to its power to
  // the creature an opponent controls", after "Choose target creature you control and target creature an opponent controls"): that target
  if (isRec(source) && isRec(source['$anaphor']) && resolved !== undefined) source = resolved.get(`${path.slice(0, path.lastIndexOf('/amount'))}/source`);
  // edh-replace-2 (CR 120.1, 208.1, 608.2h): or the object itself ("Whenever an opponent casts a noncreature spell, this creature deals damage equal to its power to that player."):
  // "its" is the subject of the clause, the source, and not the spell the trigger is about
  return step !== null && step['op'] === 'damage' && isRec(source) && (source['ref'] === 'target' || source['ref'] === 'self') && !isRec(source['$anaphor']) ? source : null;
}

/** Cloud std-fin: is `path` the `what` of an unattach (`{op:'attach', to: null}`, CR 701.3d)? */
function unattachWhat(value: unknown, path: string): boolean {
  const s = stepAt(value, path);
  return s !== null && s['op'] === 'attach' && s['to'] === null && path.endsWith('/what');
}

/** FAST2 T10: ops whose object is always a permanent (CR 701.8a destroy, 701.21a sacrifice); FAST5 T37: counters put on "it" (a spell or ability on the stack is not what it means). */
/** Cloud std-eoe: more ops that act on permanents only (CR 701.26a tap and untap), for Mention.leftBattlefield (not for spells on the stack: PERMANENT_ACTIONS keeps that rule). */
const ON_PERMANENTS: ReadonlySet<string> = new Set(['tap', 'untap']);
const PERMANENT_ACTIONS: ReadonlySet<string> = new Set(['destroy', 'sacrifice', 'putCounters', 'phaseOut', 'phaseIn' /* edhn102 */]); // edh-d-39: a spell on the stack does not phase out (CR 702.26b: permanents only) // FAST5 T37: "put a +1/+1 counter on it" (CR 122.1) puts counters on the permanent, not on the spell or ability that targeted it

/**
 * FAST4 T27: is `path` the `affects` of a continuous effect (`{s:'continuous'}`) inside an `effect` step? Such an effect, created by a resolving spell or
 * ability, modifies only objects on the battlefield (CR 611.2c), never a spell or ability on the stack.
 */
function continuousAffects(root: unknown, path: string): boolean {
  const keys = path.split('/').slice(1);
  if (keys[keys.length - 1] !== 'affects') return false;
  let cur: unknown = root;
  for (const k of keys.slice(0, -1)) cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
  return isRec(cur) && cur['s'] === 'continuous' && stepAt(root, path)?.['op'] === 'effect';
}

/** The innermost effect step on `path` (the step a reference at that path belongs to), or null. */
function stepAt(root: unknown, path: string): Rec | null {
  let cur: unknown = root;
  let step: Rec | null = null;
  for (const k of path.split('/').slice(1)) {
    if (isRec(cur)) {
      if (typeof cur['op'] === 'string' && /^[a-z]/i.test(cur['op'])) step = cur;
      cur = cur[k];
    } else if (Array.isArray(cur)) cur = cur[Number(k)];
    else break;
  }
  return step;
}

/**
 * FAST3 T18: the source of a damage step is a candidate for a pronoun that READS a property in the amount of that same step ("~ deals damage equal to its
 * power to any target": "its" may be ~, the subject of the clause; CR 608.2h reads it as it last existed). The discourse model leaves a step's own objects out
 * (lower/mentions.ts#mentionsAt), which is right for what the step acts on ("~ deals 1 damage to it": never ~, that would be "itself") but not for a property
 * read. Only the object itself as source (`{ref:'self'}`): another source is a mention already. Null for any other position.
 */
function ownSourceMention(root: unknown, path: string, acting: ReadonlySet<string>, d: Draft): Mention | null {
  if (acting.has(path)) return null;
  // CLOUD std-fdn (CR 122.1, 107.3a, 608.2h): the same for the X of counters put on the object itself, "Put X +1/+1 counters on this creature, where X is its
  // power" (Heroes' Bane): "its" reads the object the counters go on. The value of X is resolved in its own `whereX` node (lower/quantities.ts), before the step
  if (isRec(root) && root['lower'] === 'whereX' && /^\/value(\/|$)/.test(path) && Array.isArray(root['steps'])) {
    const steps = root['steps'] as unknown[];
    const last = steps[steps.length - 1];
    if (steps.length !== 1 || !isRec(last) || last['op'] !== 'putCounters' || !isRec(last['on']) || last['on']['ref'] !== 'self') return null;
  } else {
    const step = stepAt(root, path);
    if (step === null || !/\/amount(\/|$)/.test(path) || step['op'] !== 'damage' || !isRec(step['source']) || step['source']['ref'] !== 'self') return null;
  }
  // a trigger of the object's own event already names it ("When ~ dies, ... its power": the event's subject, as it last existed): no second mention of it
  if ((d.trigger?.on ?? []).some((p) => JSON.stringify(p).includes('"self":true'))) return null;
  return { sort: 'object', number: 'singular', heads: [...new Set([...d.selfHeads, 'permanent', 'card', 'source'])], ref: { ref: 'self' }, origin: 'event', unit: -1 };
}

/** Is `m` the same referent as `f` (a step mention is told by where its step is, any other by its reference)? */
function sameReferent(m: Mention, f: Mention): boolean {
  if (m.origin === 'step' || f.origin === 'step') return m.origin === f.origin && (m as StepMention).path === (f as StepMention).path && m.unit === f.unit;
  return m.origin !== 'opaque' && f.origin !== 'opaque' && JSON.stringify(m.ref) === JSON.stringify(f.ref);
}

/** The steps (outermost first) that the step at `path` of `steps` is nested in (stepsInOrder's path scheme). */
function containersOf(steps: readonly Rec[], path: string): Rec[] {
  const out: Rec[] = [];
  const keys = path.split('/').slice(1);
  let cur: unknown = steps;
  keys.forEach((k, i) => {
    cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
    if (i < keys.length - 1 && isRec(cur) && typeof cur['op'] === 'string') out.push(cur);
  });
  return out;
}

/** Does the sentence begin "If you do," or "When you do," (the sentences the folding passes put into one scope with the instruction before it)? */
const startsIfYouDo = (u: Unit): boolean => (u.tokens[0]?.norm === 'if' || u.tokens[0]?.norm === 'when') && u.tokens[1]?.norm === 'you' && (u.tokens[2]?.norm === 'do' || (u.tokens[0]?.norm === 'if' && u.tokens[2]?.norm === 'pay' && u.tokens[3]?.norm === ','));

/**
 * edh-zones-1 (CR 608.2c, 110.2a; Chaos Warp): "If it's a permanent card, they put it onto the battlefield." / "..., that player puts it onto the battlefield.": the one "they"
 * (or "that player") is the subject of "put", the player who puts the card (a player is no antecedent of "it"), so the sentence still refers back to one object. The player word
 * stands once, directly before "put"/"puts", and there is no "them".
 */
function playerPutsIt(u: Unit, refs: ReadonlySet<string>): boolean {
  if (refs.size !== 2 || !refs.has('it')) return false;
  const w = u.tokens.map((t) => t.norm);
  if (w.includes('them')) return false;
  const once = (word: string[]): boolean => {
    const at = w.findIndex((x, i) => word.every((y, k) => w[i + k] === y));
    return at >= 0 && !w.some((x, i) => i > at && word.every((y, k) => w[i + k] === y));
  };
  if (refs.has('they')) return w.filter((x) => x === 'they').length === 1 && once(['they', 'put']);
  return refs.has('that player') && once(['that', 'player', 'puts']);
}

/**
 * edh-d-95 (CR 608.2c, 400.7; Summoner's Sending): "Put a +1/+1 counter on it if the exiled card's mana value is 4 or greater.": the second reference is a participle phrase ("the exiled
 * card"), which names only the object an earlier instruction moved that way (Mention.participleOnly; design 6.4), never the token the sentence before made: the sentence still goes on
 * about one object for its bare "it". Only "it" and one "the <participle> <noun>" of a move of the ability, the participle phrase after the pronoun.
 */
function itBesideParticiple(u: Unit, refs: ReadonlySet<string>): boolean {
  if (refs.size !== 2 || !refs.has('it')) return false;
  const other = [...refs].find((r) => r !== 'it')!;
  const m = /^the (exiled|sacrificed|discarded|milled|destroyed|returned|revealed) (card|creature|permanent|artifact|enchantment|land)$/.exec(other);
  if (m === null) return false;
  const w = u.tokens.map((t) => t.norm);
  const itAt = w.indexOf('it');
  const otherAt = w.findIndex((x, i) => x === 'the' && w[i + 1] === m[1] && w[i + 2] === m[2]);
  return itAt >= 0 && otherAt > itAt && w.filter((x) => x === 'it').length === 1;
}

/**
 * edh-cast-15 (CR 608.2c; Rundvelt Hordemaster): "If it's a Goblin creature card, you may cast that card until the end of your next turn.": the condition's "it" and the "that card" of the
 * cast are the one card the sentence before exiled. Only that idiom: an "If it's ..." sentence with exactly one more reference, "cast that card" / "play that card".
 */
function itThenThatCard(u: Unit, refs: ReadonlySet<string>): boolean {
  if (refs.size !== 2 || !refs.has('it') || !refs.has('that card')) return false;
  const w = u.tokens.map((t) => t.norm);
  const at = w.findIndex((x, i) => x === 'that' && w[i + 1] === 'card');
  if (at <= 0 || w.filter((x, i) => x === 'that' && w[i + 1] === 'card').length !== 1) return false;
  // edh-next-25 (CR 608.2c; Matter Reshaper): the same two words as one card with another verb, and with the condition last: "You may put that card onto the battlefield if it's a permanent card."
  const verb = w[at - 1] === 'cast' || w[at - 1] === 'play' || w[at - 1] === 'put';
  // edh-d-87 (CR 608.2c, 208.1; Sapling of Colfenor): or a characteristic of that card, "If it's a creature card, you gain life equal to that card's toughness, ...": the possessive names the
  // same one card the condition tests
  const possessive = w[at + 2] === "'s" && (w[at + 3] === 'toughness' || w[at + 3] === 'power' || w[at + 3] === 'mana');
  if (w[0] === 'if' && (w[1] === "it's" || w[1] === 'it')) return verb || possessive;
  if (w[0] === 'you' && w[1] === 'may' && verb) {
    const cond = w.indexOf('if', at);
    return cond > at && (w[cond + 1] === "it's" || w[cond + 1] === 'it') && w.filter((x) => x === 'if').length === 1;
  }
  return false;
}

/**
 * The distinct things a sentence refers back to, by its words: "it", "it's" and "itself" are one; "them" and "they" are one; each "that X" is its own; "its" and "their" read a
 * property and add none. `objectsOnly` (Cloud std-fin) leaves out the words that can name only a player ("that player's library"): no object pronoun can mean one.
 */
function referenceWords(tokens: readonly Tok[], objectsOnly = false): Set<string> {
  const out = new Set<string>();
  // (the "it" of "for as long as it remains exiled", the duration's own word for the object the permission names, is left out by sentenceReferences below, LOOK2)
  for (const a of scanAnaphors(tokens)) {
    if (a.sort === 'number' || a.text === 'its' || a.text === 'their' || a.text === 'theirs') continue;
    if (objectsOnly && a.sort === 'player') continue;
    out.add(['it', "it's", 'itself'].includes(a.text) ? 'it' : ['them', 'they', "they're", 'themselves'].includes(a.text) ? 'they' : a.text);
  }
  return out;
}

/** The subjects of a "for as long as <subject> remain(s) exiled" duration (parser/holes/dur.ts, `remainsExiled`), each with its verb. */
const EXILED_SUBJECTS: readonly (readonly string[])[] = [['it', 'remains'], ['that', 'card', 'remains'], ['they', 'remain'], ['those', 'cards', 'remain']];

/**
 * LOOK2 (CR 611.2b, 400.7): the reference words of a sentence (referenceWords) less the subject of its "for as long as it remains exiled" duration. That duration
 * (parser/holes/dur.ts, `{d:'remainsExiled'}`) lasts while the objects of the permission it ends stay in exile (core/durations.ts#namedStillExiled; model/cap-walk.ts
 * allows it on object permissions only, render/dur.ts writes it as fixed words), so its "it" names what the permission names, nothing of its own: "You may play that
 * card for as long as it remains exiled." refers back to one thing. Only when a step of the sentence has that duration. `objectsOnly` as for referenceWords (Cloud std-fin).
 */
function sentenceReferences(u: Unit, objectsOnly = false): Set<string> {
  let exiledFor = false;
  let capped = false;
  let anyType = false;
  visit([u.steps, u.rider?.patch], (n) => { if (n['d'] === 'remainsExiled') exiledFor = true; if (n['op'] === 'cast' && n['maxManaValue'] !== undefined) capped = true; if (n['s'] === 'permit' && n['anyManaType'] === true) anyType = true; });
  // edh-top-10 (CR 122.2, 608.2c; Strixhaven Stadium): "Then if it has ten or more point counters on it, remove them all": "them" are the counters the condition counts (template
  // eff.edht10.thenIf.removeThemAll.and), not an object the instruction goes on about
  let removeAll = false;
  visit([u.steps], (n) => { if (n['op'] === 'removeCounters' && n['count'] === 'all') removeAll = true; });
  const w1 = u.tokens.map((t) => t.norm);
  const removeThem = removeAll ? w1.findIndex((x, i) => x === 'remove' && w1[i + 1] === 'them' && w1[i + 2] === 'all') : -1;
  if (removeThem >= 0) return referenceWords([...u.tokens.slice(0, removeThem + 1), ...u.tokens.slice(removeThem + 2)], objectsOnly);
  // std-exile-play-1-2 (CR 609.4b): "..., and mana of any type can be spent to cast that spell" names the spell the permission lets the player cast, the rider's own words
  // (render/stat.ts#anyTypeRider), nothing of its own: those words go
  let toks = u.tokens;
  const w0 = toks.map((t) => t.norm);
  const rider = anyType ? w0.findIndex((x, i) => x === 'spent' && w0[i + 1] === 'to' && w0[i + 2] === 'cast') : -1;
  const said = rider < 0 ? 0 : ['that', 'spell'].every((y, k) => w0[rider + 3 + k] === y) || ['those', 'spells'].every((y, k) => w0[rider + 3 + k] === y) ? 2 : w0[rider + 3] === 'it' || w0[rider + 3] === 'them' ? 1 : 0;
  if (said > 0) toks = [...toks.slice(0, rider + 3), ...toks.slice(rider + 3 + said)];
  const w = toks.map((t) => t.norm);
  // std-rq (CR 601.2, 202.3): "You may cast it without paying its mana cost if that spell's mana value is 8 or less": "that spell" is the spell the cast makes, the cast's
  // own words (template eff.stdrq.cast.free.maxManaValue), nothing of its own
  const at = capped ? w.findIndex((x, i) => x === 'if' && w[i + 1] === 'that' && w[i + 2] === 'spell') : -1;
  if (at >= 0) return referenceWords([...toks.slice(0, at + 1), ...toks.slice(at + 3)], objectsOnly);
  // std-mana-1 (CR 611.2b): a leading duration of the object kind, "For as long as that land has a blight counter on it, it loses ...": the duration names its
  // object with its own demonstrative (resolved on its own by the unique-candidate rule, parser/holes/dur.ts `whileObject`), so its words up to the comma are not
  // a second thing the instruction refers back to (as the subject of "for as long as it remains exiled" below)
  let whileObject = false;
  visit([u.steps], (n) => { if (n['d'] === 'whileObject') whileObject = true; });
  const comma = whileObject && w[0] === 'for' && w[1] === 'as' && w[2] === 'long' && w[3] === 'as' && w[4] === 'that' ? w.indexOf(',') : -1;
  if (comma > 0) return referenceWords(toks.slice(comma + 1), objectsOnly);
  for (let i = 0; exiledFor && i + 2 < w.length; i++) {
    if (w[i] !== 'as' || w[i + 1] !== 'long' || w[i + 2] !== 'as') continue;
    const s = EXILED_SUBJECTS.find((x) => x.every((y, k) => w[i + 3 + k] === y) && w[i + 3 + x.length] === 'exiled');
    if (s !== undefined) return referenceWords([...toks.slice(0, i + 3), ...toks.slice(i + 2 + s.length)], objectsOnly); // the subject's words go, its verb stays
  }
  // std-copy-6 (CR 113.1, 603.2): "that ability" names the triggered or activated ability of the trigger event, never an object the discourse is on (an ability
  // has no counters and is not made by an instruction): "Then if it has four or more quest counters on it, you may copy that ability." refers back to one thing
  const out = referenceWords(toks, objectsOnly);
  out.delete('that ability');
  return out;
}

/**
 * FAST5 T76, the focus rule (CR 608.2c, 111.1, 122.1; model/focus.ts): "Create a 1/1 Goblin creature token. It gains haste until end of turn. Sacrifice it at the
 * beginning of the next end step." / "Put a +1/+1 counter on ~. It can't be blocked this turn." The bare pronoun of the first instruction of a sentence that
 * names no target of its own means the one object the sentences before it left the discourse on: the token a creating instruction made, or the object an
 * instruction put counters on, kept by the instructions after it that act only on it. That is the focus of Oracle's wording (the object itself is "~", never
 * "it", once something else is the thing being worked on), a typed rule rather than "the nearest noun wins". Every one of these holds, or the unique-candidate
 * rule of design 6.4 stays the only one:
 *  - the previous sentence is understood and ends with exactly such an instruction, done for sure: top level, or inside an option / payment / "if you do" whose
 *    following sentence the "If you do" folding puts into the same scope ("You may exile ~. If you do, return it ...");
 *  - the sentence refers back to one thing only (not "If that enchantment is an Aura, you may attach it to the token"), has no "~" before the pronoun and no mention
 *    of its own (a condition "If ~ was kicked, it deals ..." names its own antecedent), and no target of its own;
 *  - the pronoun is bare (or "that card" for a card the previous sentence moved, never the object itself, CR 201.5), and the object is still a compatible
 *    candidate after the filters of its position (a spell on the stack is no permanent that "gains haste").
 * The renderer says the same (render/steps.ts#clausesOf, render/refs.ts#candidateCheck: `RenderState.focus`).
 */
export function focusAt(seq: readonly Unit[], at: number, mentions: readonly Mention[]): Mention | undefined {
  const u = seq[at];
  const prev = seq[at - 1];
  if (u === undefined || prev === undefined || prev.manual !== undefined) return undefined;
  // edh-perms-17 (CR 608.2c, 508.4; Echoing Assault): a rider that only patches the instruction before it ("The token enters tapped and attacking that player.") adds no
  // instruction of its own: the focus is still the one the sentence before the rider left ("Create a token that's a copy of ... The token enters tapped and attacking. Sacrifice it ...")
  if (prev.rider !== undefined) return prev.steps.length === 0 && at >= 2 ? focusAt([...seq.slice(0, at - 1), u], at - 1, mentions) : undefined;
  // std-promote-4 (design 6.4, model/focus.ts#keepsFocus): a sentence that only puts counters on you ("You get {E}{E}.") keeps the focus of the sentence before it
  if (prev.steps.length > 0 && prev.steps.every(keepsFocus)) return focusAt([...seq.slice(0, at - 1), u], at - 1, mentions);
  // edh-top-7 (CR 701.24a, 608.2c; Hoarding Broodlord): "Search your library for a card, exile it face down, then shuffle. For as long as that card remains exiled, you may play it.":
  // shuffling a library works on no object, so the instruction before the trailing shuffle is the one the next sentence goes on about
  const ordered = stepsInOrder(prev.steps);
  while (ordered.length > 1 && shufflesYourLibrary(ordered.at(-1)!.step) && !ordered.at(-1)!.path.slice(1).includes('/')) ordered.pop();
  const last = ordered.at(-1);
  if (last === undefined) return undefined;
  // a sentence that refers back to more than one thing ("If that enchantment is an Aura, you may attach it to the token") is left to the unique-candidate rule
  // (std-exile-play-1-2, CR 608.2c: after a choice of exactly one object, "That player exiles it" refers back to one object; the player is no candidate of "it")
  const chose = last.step['op'] === 'chooseObjects' && last.step['min'] === 1 && last.step['max'] === 1;
  const refs = sentenceReferences(u, chose);
  // edh-top-10 (design 6.4, CR 608.2c; Strixhaven Stadium): "Put a point counter on ~. Then if it has ten or more point counters on it, ... that player loses the game.": "that player" names a
  // player, which no object pronoun can mean; a sentence whose only other reference is the bare "it" still goes on about the one object the instruction before it worked on
  if (refs.size > 1 && !playerPutsIt(u, refs) && !itThenThatCard(u, refs) && !itBesideParticiple(u, refs) && !(refs.has('it') && sentenceReferences(u, true).size === 1)) return undefined;
  // the instruction must have happened: inside a condition or an option it did only if the condition held / the player chose it, and then only the sentences the
  // "If you do" folding puts into the same scope may name it ("You may exile ~. If you do, return it ..."; "If you do, create a token. It gains haste.")
  const boxes = containersOf(prev.steps, last.path);
  // (r4-refs, CR 603.12, 603.4: or the condition that is all a reflexive trigger does, "When you do, if it has four or more quest counters on it, put a +1/+1 counter on
  // target creature you control. It gains trample until end of turn.": the next sentence is more of that condition's instructions, lower/conditions.ts#foldReflexive)
  const reflexiveIf = (b: Rec): boolean => b['op'] === 'if' && b['else'] === undefined && boxes.some((r) => r['op'] === 'reflexive' && Array.isArray(r['do']) && r['do'].length === 1 && r['do'][0] === b);
  const sameScope = boxes.every((b) => b['op'] === 'may' || b['op'] === 'pay' || b['op'] === 'reflexive' || (b['op'] === 'if' && isRec(b['cond']) && b['cond']['cond'] === 'did') || reflexiveIf(b));
  // edh-next-105 (CR 603.7, 608.2c; Moira and Teshar): "Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead ...": a delayed trigger decides
  // nothing about whether its instruction was given (it is given for certain, when the delay is created), so the sentence after it still goes on about the object it names
  const onlyDelay = boxes.length > 0 && boxes.every((b) => b['op'] === 'delay');
  if (boxes.length > 0 && !onlyDelay && !(sameScope && (startsIfYouDo(u) || startsIfYouDo(prev)))) {
    // Cloud std-fin: ... unless what it worked on is a name an earlier instruction bound, there whether or not it happened (model/focus.ts#keptFocus)
    const kept = keptFocus(prev.steps[prev.steps.length - 1]);
    // edh-c-37 (Kinship): the card a look inside the last `may` made is a step mention of that look (model/focus.ts#keptFocus)
    // edh-next-138 (Baral and Kari Zev): and the token(s) made directly in the branch of an `if` on "if you do" / "if you don't" (model/focus.ts#keptFocus)
    if (kept !== null && kept.kind === 'makes' && (boxes.every((b) => b['op'] === 'may') || (boxes.length === 1 && boxes[0]!['op'] === 'if' && isRec(boxes[0]!['cond']) && boxes[0]!['cond']['cond'] === 'did' && last.step['op'] === 'createToken'))) return mentions.find((m) => m.origin === 'step' && (m as StepMention).unitRef === prev && (m as StepMention).path === last.path);
    if (kept === null || kept.kind !== 'object') return undefined;
    return mentions.find((m) => m.sort !== 'number' && m.sort !== 'player' && m.origin !== 'opaque' && JSON.stringify(m.ref) === JSON.stringify(kept.on));
  }
  const fx = focusEffect(last.step);
  if (fx === null) return undefined;
  if (fx.kind === 'makes') return mentions.find((m) => m.origin === 'step' && (m as StepMention).unitRef === prev && (m as StepMention).path === last.path);
  // ("that card" for a binding the instruction moved into exile or a graveyard: movedCardFocus below, LOOK2; Cloud std-fin's copy of that rule is merged into it)
  const same = mentions.find((m) => m.sort !== 'number' && m.sort !== 'player' && m.origin !== 'opaque' && JSON.stringify(m.ref) === JSON.stringify(fx.on));
  if (same !== undefined || fx.on['ref'] !== 'bound') return same;
  // edh-next-105 (CR 608.2c, 400.7; Moira and Teshar): "Return target ... card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end
  // step.": the sentence before worked on the object the move made (a bound name, as the parser rewrote "it"), which the pool still holds as the move's target (`movedBy`);
  // exactly one such mention is the focus
  const made = mentions.filter((m) => m.sort !== 'number' && m.sort !== 'player' && m.origin !== 'opaque' && m.movedBy !== undefined
    && stepsInOrder(m.movedBy.unitRef.steps).some((s) => s.path === m.movedBy!.path && s.step['as'] === fx.on['name']));
  return made.length === 1 ? made[0] : undefined;
}

/**
 * Cloud std-fin (CR 608.2c; the focus rule above within one sentence): "Destroy target permanent. Exile ~, then return it to the battlefield." The bare pronoun of an
 * instruction that is not the first of its sentence means the one named object the instruction RIGHT BEFORE it, in the same sentence, worked on (exiled, moved, put
 * counters on, ...; model/focus.ts), exactly as the focus of the sentence before decides it for a first instruction. The renderer already reads the focus per
 * instruction (render/steps.ts#clausesOf). Only when that instruction is a top-level step of the sentence (an instruction inside a condition or an option happened
 * only if it held), the sentence refers back to one object only ("that player's library" names a player, never an object) and names no target of its own; it decides
 * between several compatible candidates only. What the instruction made is the focus too: "look at the top card of that player's library, then exile it face down"; of
 * an object it worked on, only one it moved to another zone.
 */
export function focusWithin(u: Unit, i: number, mentions: readonly Mention[]): Mention | undefined {
  if (i < 1 || sentenceReferences(u, true).size > 1 || (u.targetIds?.length ?? 0) > 0) return undefined;
  const fx = focusEffect(u.steps[i - 1]);
  if (fx === null) return undefined;
  // what that instruction made (a token, the one card looked at): its own mention, as focusAt reads it for the sentence before
  if (fx.kind === 'makes') return mentions.find((m) => m.origin === 'step' && (m as StepMention).unitRef === u && (m as StepMention).path === `/${i - 1}`);
  // ... or the object it MOVED to another zone ("Exile ~, then return it": CR 400.7, the card in exile is a new object the sentence goes on about)
  // std-cardcopy-2 (CR 608.2d): or the one object it chose ("choose a creature ... and create a token that's a copy of it", model/focus.ts#chosenOne)
  const prev = u.steps[i - 1]?.['op'];
  if (prev === 'move' || prev === 'chooseObjects') return mentions.find((m) => m.sort !== 'number' && m.sort !== 'player' && m.origin !== 'opaque' && JSON.stringify(m.ref) === JSON.stringify(fx.on));
  // std-typechange-1 (CR 608.2c): ... or the one object it tapped or untapped where it is, when the two instructions are joined by "and" ("When this Aura enters, tap
  // enchanted creature and remove all counters from it": the creature the sentence just tapped, not the Aura that is the trigger's subject). Only a tap or untap of
  // "enchanted creature", "equipped creature" or "~" (no group, no binding of an earlier sentence), and only right before a bare pronoun of the next instruction
  // p2-refs-3 (CR 608.2c, 122.1): ... or put counters on ("put a +1/+1 counter on ~ and untap it", Gwenna, Eyes of Gaea; "... and it deals 1 damage to each opponent",
  // Brallin, Skyshark Rider): the object stays where it is, as a tapped one does
  // edh-next-76 (CR 701.3d, 608.2c; Elbrus, the Binding Blade): ... or the one object it unattached, "unattach ~, then transform it" (the object itself, where it is)
  if (prev === 'attach' && u.steps[i - 1]?.['to'] === null && isRec(fx.on) && fx.on['ref'] === 'self') return mentions.find((m) => m.sort !== 'number' && m.sort !== 'player' && m.origin !== 'opaque' && JSON.stringify(m.ref) === JSON.stringify(fx.on));
  return isRec(fx.on) && (fx.on['ref'] === 'attachedTo' || fx.on['ref'] === 'self') && (prev === 'tap' || prev === 'untap' || prev === 'putCounters') && joinedByAnd(u, i)
    ? mentions.find((m) => m.sort !== 'number' && m.sort !== 'player' && m.origin !== 'opaque' && JSON.stringify(m.ref) === JSON.stringify(fx.on))
    : undefined;
}

/**
 * edh-d-95 (CR 608.2c; the focusWithin rule one level down): for a pronoun at `path` inside the step list `then` / `do` / `else` of the top-level step `value`, at index
 * k > 0 of that list, a pattern matching the path of the mention of what the step at k - 1 created (a token, model/focus.ts kind 'makes'), as lower/mentions.ts#mentionsInside
 * names it (`/<top>/<list>/<k - 1>`); null otherwise. Only when the sentence refers back to one object only and names no target of its own (as focusWithin).
 */
function nestedMadeFocus(value: unknown, path: string, u: Unit): RegExp | null {
  const m = /^\/(then|do|else)\/(\d+)\//.exec(path);
  if (m === null || !isRec(value) || sentenceReferences(u, true).size > 1 || (u.targetIds?.length ?? 0) > 0) return null;
  const list = value[m[1]!];
  const k = Number(m[2]);
  if (!Array.isArray(list) || k < 1 || k >= list.length) return null;
  const prev = list[k - 1];
  if (!isRec(prev) || prev['op'] !== 'createToken' || focusEffect(prev)?.kind !== 'makes') return null;
  return new RegExp(`^/\\d+/${m[1]}/${k - 1}$`);
}

/**
 * edh-b-9 (CR 701.3a, 608.2c; Field-Tested Frying Pan): "create a Food token, then create a 1/1 Halfling creature token and attach this Equipment to it." The "~" before the "it" is
 * the thing attached, never the host: an Equipment (or Aura) is not attached to itself, so it is no antecedent the sentence names for the pronoun, and the focus (the token the
 * instruction right before made) decides between the tokens.
 */
function attachesSelf(u: Unit): boolean {
  return u.steps.some((s) => s['op'] === 'attach' && isRec(s['what']) && s['what']['ref'] === 'self' && isRec(s['to']) && '$anaphor' in s['to']);
}

/** p2-refs-3: does the condition test the object itself, "if ~ is ..." / "if ~ isn't ..." (`matches` on {ref:'self'}, or its negation)? */
function testsSelf(c: Rec): boolean {
  const m = c['cond'] === 'not' && isRec(c['of']) ? c['of'] : c;
  return m['cond'] === 'matches' && JSON.stringify(m['object']) === '{"ref":"self"}';
}

/** edh-perms-6: does the condition test the enchanted or equipped object, "if equipped creature is a Vampire" (`matches` on {ref:'attachedTo'}, or its negation)? */
function testsAttached(c: Rec): boolean {
  const m = c['cond'] === 'not' && isRec(c['of']) ? c['of'] : c;
  return m['cond'] === 'matches' && JSON.stringify(m['object']) === '{"ref":"attachedTo"}';
}

/** std-typechange-1: is instruction `i` of the sentence joined to the one before it by a bare "and" (no "then", no comma), the sentence having exactly two instructions? */
function joinedByAnd(u: Unit, i: number): boolean {
  if (i !== 1 || u.steps.length !== 2) return false;
  const words = u.tokens.map((t) => t.norm);
  return words.filter((w) => w === 'and').length === 1 && !words.includes('then') && !words.includes(',') && !words.includes(';');
}

/**
 * LOOK1 (CR 608.2c; the focus rule, focusAt): "Look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. Otherwise, put it into
 * your hand." An "Otherwise" rider gives the `if` of the sentence before it its `else`, whose instruction follows the condition, not the `then` branch: it begins with the
 * focus that `if` began with, as the renderer's `else` branch inherits it (render/steps.ts#clausesOf). Only for an `else` of one instruction (the rider's own steps are no
 * mentions, so a pronoun after an object the rider itself creates would be guessed), added to a sentence whose one step is that `if`, with no target in either sentence
 * and one reference word in the rider.
 */
function elseFocus(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): Mention | undefined {
  const prev = seq[at - 1];
  const patch = u.rider?.patch;
  const added = isRec(patch) && Object.keys(patch).length === 1 && isRec(patch['else']) && Object.keys(patch['else']).length === 1 ? patch['else']['@new'] : undefined;
  if (u.rider?.attachTo !== 'if' || !Array.isArray(added) || added.length !== 1 || prefix.length > 0 || prev === undefined || prev.steps.length !== 1 || prev.steps[0]?.['op'] !== 'if') return undefined;
  if ((u.targetIds?.length ?? 0) > 0 || (prev.targetIds?.length ?? 0) > 0 || sentenceReferences(u).size > 1) return undefined;
  const pool = withoutFallback(mentionsAt(d, seq, at - 1, 0, prefix));
  // r4-refs (CR 608.2c; Cloud std-eoe's chosenFocus): "Choose target creature an opponent controls. If it's tapped, put a stun counter on it. Otherwise, tap it.": the
  // `if` began with the target the sentence before it announced, so its `else` does too
  return focusAt(seq, at - 1, pool) ?? chosenFocus(seq, at - 1, pool);
}

/** LOOK3: the move a "you don't put the card ..." sentence names, in the sentence before it (`prev`, at `path` of its steps). */
interface NotPut { move: Rec; prev: Unit; path: string }

/**
 * LOOK3 (CR 608.2c; the focus rule, focusAt): "Look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. If you don't put
 * the card onto the battlefield, put it into your hand." The sentence's condition names the card the instruction before it would have moved (model/focus.ts#notPutMove,
 * the move lower/conditions.ts#resolveDid names): the sentence is about that card. Only for a sentence that is that one `if` (zz-cloud/look3.json) right after an
 * understood sentence; the move, or null.
 */
function notPutContext(u: Unit, seq: readonly Unit[], at: number): NotPut | null {
  const zone = notPutZone(u.steps[0]);
  const prev = seq[at - 1];
  if (zone === undefined || u.steps.length !== 1 || prev === undefined || prev.manual !== undefined || prev.rider !== undefined) return null;
  const move = notPutMove(prev.steps[prev.steps.length - 1], zone);
  const path = move === null ? undefined : stepsInOrder(prev.steps).find((x) => x.step === move)?.path;
  return move === null || path === undefined ? null : { move, prev, path };
}

/**
 * edh-next-142 (CR 608.2c, 701.20a, 400.7; Omnath, Locus of All): "You may reveal that card if C. If you do, ... and put it into your hand. If you don't reveal it, put it into your hand.": the
 * sentence is about the card the ONE reveal of yours earlier in the ability names, and in it the move of that card in the sentence right before (the "If you do" branch) was NOT performed (the
 * card is still where it was, bindMoved does not apply). Only for a sentence that is that one `if` (parser/holes/cond.ts, W_DIDNT_REVEAL_IT) right after an understood sentence.
 */
function notRevealedContext(u: Unit, seq: readonly Unit[], at: number): NotPut | null {
  const s = u.steps[0];
  const c = isRec(s) && s['op'] === 'if' && s['guard'] === undefined ? s['cond'] : undefined;
  const prev = seq[at - 1];
  if (!isRec(c) || c['cond'] !== 'did' || c['$step'] !== 'revealThisWay' || c['not'] !== true || u.steps.length !== 1 || prev === undefined || prev.manual !== undefined || prev.rider !== undefined) return null;
  const reveals = seq.slice(0, at).flatMap((x) => (x.manual !== undefined ? [] : stepsInOrder(x.steps))).filter(({ step }) => step['op'] === 'reveal' && isRec(step['who']) && step['who']['ref'] === 'you' && isRec(step['what']) && step['what']['ref'] === 'bound');
  if (reveals.length !== 1) return null;
  const what = JSON.stringify(reveals[0]!.step['what']);
  const moves = stepsInOrder(prev.steps).filter(({ step }) => step['op'] === 'move' && JSON.stringify(step['what']) === what);
  if (moves.length > 1) return null;
  return moves.length === 1 ? { move: moves[0]!.step, prev, path: moves[0]!.path } : { move: reveals[0]!.step, prev, path: '' };
}

/**
 * LOOK3: inside that sentence the move was NOT performed, so the card is where it was: a move into a hidden zone ("If you don't put the card into your hand, you may put
 * it into your graveyard") does not give it that move's name (bindMoved, CR 400.7); the mention is as it was before the move.
 */
function notPutPool(notPut: NotPut | null, pool: Mention[]): Mention[] {
  if (notPut === null) return pool;
  return pool.map((m) => {
    if (m.movedBy === undefined || m.movedBy.unitRef !== notPut.prev || m.movedBy.path !== notPut.path) return m;
    const { movedBy: _notMoved, ...rest } = m;
    return rest;
  });
}

/** LOOK3: the focus of that sentence, the object the move would have moved (a bare pronoun of the sentence is that card, never the trigger's object); one reference word only. */
function notPutFocus(notPut: NotPut | null, u: Unit, mentions: readonly Mention[]): Mention | undefined {
  if (notPut === null || referenceWords(u.tokens).size > 1) return undefined;
  const what = JSON.stringify(notPut.move['what']);
  return mentions.find((m) => m.sort !== 'number' && m.sort !== 'player' && m.origin !== 'opaque' && JSON.stringify(m.ref) === what);
}

/**
 * Cloud std-eoe (CR 115.1, 608.2c; lower/choose.ts): the one target the sentence right before announced and did nothing else with ("Choose up to one target
 * creature."): the focus of the sentence after it. Undefined when that sentence is not such a sentence or announced several targets.
 */
function chosenFocus(seq: readonly Unit[], at: number, mentions: readonly Mention[]): Mention | undefined {
  const prev = seq[at - 1];
  // edh-d-87 (CR 608.2c, 608.2d; Kamiz, Obscura Oculus): "Then choose another attacking creature with lesser power. That creature gains double strike until end of turn.": a sentence that only
  // has you choose exactly one object (no target, no other instruction) is the focus of the sentence after it, as a chosen target is
  const only = prev !== undefined && prev.manual === undefined && (prev.targetIds?.length ?? 0) === 0 && prev.steps.length === 1 ? prev.steps[0] : undefined;
  if (only !== undefined && only['op'] === 'chooseObjects' && only['min'] === 1 && only['max'] === 1 && isRec(only['who']) && only['who']['ref'] === 'you' && typeof only['as'] === 'string'
    && only['perPlayer'] === undefined && only['startingWith'] === undefined && only['random'] === undefined) {
    return mentions.find((m) => m.origin === 'step' && (m as StepMention).unitRef === prev && (m as StepMention).path === '/0');
  }
  if (prev === undefined || prev.manual !== undefined || chooseNode(prev) === null || prev.targetIds?.length !== 1) return undefined;
  const id = prev.targetIds[0];
  return mentions.find((m) => m.origin === 'target' && isRec(m.ref) && m.ref['ref'] === 'target' && m.ref['id'] === id);
}

/**
 * r4-refs (design 6.4, CR 608.2c): is `m` a target of the sentence `u` whose phrase comes after the last reference word of the sentence? Pronouns look back, so such a
 * target is the antecedent of none of them.
 */
function targetAfter(u: Unit, m: Mention): boolean {
  if (m.origin !== 'target' || !isRec(m.ref) || m.ref['ref'] !== 'target' || typeof m.ref['id'] !== 'string') return false;
  const at = u.targetPos?.[m.ref['id']];
  if (at === undefined) return false;
  const words = scanAnaphors(u.tokens).filter((x) => x.sort !== 'number').flatMap((x) => occurrences(u.tokens, x.text));
  return words.length > 0 && words.every((w) => w < at);
}

/** r4-refs: does every target phrase of the sentence come after its last reference word (targetAfter)? Then the focus of the sentence before may decide its pronouns. */
function targetsAfterReferences(u: Unit): boolean {
  const at = Object.values(u.targetPos ?? {});
  if (at.length === 0 || at.length !== (u.targetIds?.length ?? 0)) return false;
  const words = scanAnaphors(u.tokens).filter((x) => x.sort !== 'number').flatMap((x) => occurrences(u.tokens, x.text));
  return words.length > 0 && words.every((w) => at.every((t) => w < t));
}

/** Does the sentence say "~" (the object itself) before the first word of the pronoun? */
/** p2-refs-3: how many "~" come before the first occurrence of the reference word. */
function selfCountBefore(tokens: readonly Tok[], a: AnaphorInfo): number {
  const at = occurrences(tokens, a.text)[0];
  return at === undefined ? 0 : tokens.slice(0, at).filter((t) => t.kind === 'SELF').length;
}

/**
 * edh-c-37 (CR 205.3m, 608.2c; Kinship): the "~" of "If it shares a creature type with ~" is what the comparison is made with, not the thing the pronoun goes on about: the sentence
 * names it, yet the "it" of "you may reveal it" is still the card the focus is on. Only the object itself, and only right after "shares ... with".
 */
function sharedWithSelf(u: Unit, m: Mention): boolean {
  if (!isRec(m.ref) || m.ref['ref'] !== 'self') return false;
  const w = u.tokens.map((t) => t.norm);
  const sh = w.indexOf('shares');
  return sh >= 0 && w[w.indexOf('with', sh) + 1] === '~' && u.tokens[w.indexOf('with', sh) + 1]?.kind === 'SELF';
}

function selfBefore(tokens: readonly Tok[], a: AnaphorInfo): boolean {
  const at = occurrences(tokens, a.text);
  const self = tokens.findIndex((t) => t.kind === 'SELF');
  return self >= 0 && at.length > 0 && self < at[0]!;
}

/**
 * LOOK2 (CR 400.7, 608.2c; the focus rule, focusAt): did the last instruction of the sentence before move the focus, a binding (the card looked at, found or chosen),
 * into exile or a graveyard? A move to a public zone re-bases the binding onto the new object (design 3.1 rule 2, CR 400.7j), so the binding never gets the `movedBy`
 * a moved target or "~" gets (lower/mentions.ts#mentionsAt), yet it is "that card" there as an exiled target is: "Look at the top card of that player's library, then
 * exile it face down. You may play that card for as long as it remains exiled." (the card in exile, never the Vehicle that dealt the damage). Not the battlefield or
 * the stack, where the new object is a permanent or a spell (CR 110.1, 112.1); a move to a hand or a library is not re-based and sets `movedBy` already.
 */
function movedCardFocus(prev: Unit | undefined, focus: Mention | undefined): boolean {
  const last = prev === undefined ? undefined : stepsInOrder(prev.steps).at(-1)?.step;
  if (focus === undefined || focus.origin !== 'step' || last === undefined || last['op'] !== 'move' || !isRec(last['what']) || !isRec(last['to'])) return false;
  // edh-cast-15 (CR 400.7, 608.2c; Rundvelt Hordemaster): or the one top card of a library the instruction exiled ("Exile the top card of your library. If it's a Goblin creature card, you may cast
  // that card ..."): the card in exile, never the object of the trigger (a dying creature is "that creature" or "it" in its own sentence)
  const top = last['what']['ref'] === 'topCards' && last['what']['count'] === 1 && last['to']['zone'] === 'exile' && isRec(focus.ref) && focus.ref['ref'] === 'bound' && focus.ref['name'] === (typeof last['as'] === 'string' ? last['as'] : '');
  return top || (last['what']['ref'] === 'bound' && sameJson(last['what'], focus.ref) && (last['to']['zone'] === 'exile' || last['to']['zone'] === 'graveyard'));
}

/**
 * r3-dig (CR 701.20a, 608.2c; the focus rule, focusAt): is the focus the card(s) a `revealUntil` of the sentence before stopped at ("Reveal cards from the top of your
 * library until you reveal a creature card. Put that card into your hand ...")? Revealing moves nothing (CR 701.20b): the card is still a card in the library, and Oracle
 * calls it "that card" there, never the object of a trigger (a creature card that died is "that creature" or "it" in its own sentence).
 */
function revealedFocus(focus: Mention | undefined): boolean {
  if (focus === undefined || focus.origin !== 'step') return false;
  const sm = focus as StepMention;
  return stepsInOrder(sm.unitRef.steps).find((s) => s.path === sm.path)?.step['op'] === 'revealUntil';
}

/**
 * Cloud std-fin: where a pronoun was said, in the step it is resolved in: the first place (in the order of the step, which is the order of the text) where an anaphor of
 * the same words is written. A template writes the words of one hole in several instructions ("Its controller may search their library for a basic land card, put it onto
 * the battlefield tapped, then shuffle": "its" is the player of the option and of each instruction in it); the copies were said once, BEFORE the instructions of the option,
 * so what those instructions produce is never their antecedent (lower/mentions.ts#mentionsInside walks from this path).
 */
function saidAt(value: unknown, a: AnaphorInfo): string | undefined {
  let at: string | undefined;
  visit(value, (node, path) => {
    if (at !== undefined) return false;
    if (isRec(node['$anaphor']) && (node['$anaphor'] as Rec)['text'] === a.text) { at = path; return false; }
    return undefined;
  });
  return at;
}

/**
 * Cloud std-fin: bind() names a step by its path in the unit's steps, which are the ORIGINAL steps while resolveIn rewrites a copy of one of them; an instruction of the
 * step's own list named that way (mentionsInside) was already copied without its new `as`. Copies every `as` of `orig` the rewritten tree `out` lacks, node for node (the
 * rewrite keeps the shape; only the anaphor nodes, which hold no `as`, are replaced).
 */
function carryNames(orig: unknown, out: unknown): void {
  if (Array.isArray(orig) && Array.isArray(out)) { orig.forEach((x, k) => carryNames(x, out[k])); return; }
  if (!isRec(orig) || !isRec(out)) return;
  if (typeof orig['as'] === 'string' && out['as'] === undefined) out['as'] = orig['as'];
  for (const [k, x] of Object.entries(orig)) if (k !== 'as') carryNames(x, out[k]);
}

/** The mentions that the earlier instructions of a pronoun's own list of instructions give it (lower/mentions.ts#mentionsInside and #movedInside). */
type Inside = (path: string, a: AnaphorInfo, resolvedAt: (path: string) => Rec | undefined) => Mention[];

/** Resolve the object and player anaphors inside `value` against `mentions`; null (and `u.manual` set) when one does not resolve. */
function resolveIn(value: unknown, mentions: readonly Mention[], u: Unit, d: Draft, accept: (m: Mention) => boolean = () => true, focus?: Mention, movedCard = false, inside?: Inside, chosen?: Mention, condObj?: Mention, said?: Map<string, Rec>): unknown {
  let ok = true;
  const acting = actingPaths(value);
  const resolved = new Map<string, Rec>(); // r3-fx: the references this rewrite gave the pronouns before (for mentionsInside: what an earlier instruction of the list moved)
  let condSubject: Mention | undefined; // std-r8
  const out = rewrite(value, (node, path) => {
    // FAST5 T50: a delayed trigger that waits for an event, wherever it is nested (in an "if", a "may"), resolves its instructions against its own event
    if (ok && isEventDelay(node)) {
      // r3-refs (CR 603.7, 608.2c): what an earlier instruction of the delayed trigger's own instructions made is named by a later one ("whenever you attack this
      // turn, create a 1/1 red Warrior creature token, then tap it"): mentionsInside walks the trigger's `do` list like any other list of instructions
      const r = resolveEventDelay(node, mentions, u, d, inside === undefined ? undefined : (p, a, got) => inside(`${path}/do${p}`, a, (q) => got(q)));
      if (r === null) ok = false;
      return r ?? node;
    }
    if (!ok || !isRec(node['$anaphor'])) return undefined;
    const a = node['$anaphor'] as unknown as AnaphorInfo;
    if (a.sort === 'number') return undefined; // pass 5
    if (groupChooser(value, path, a, mentions.filter((m) => (m.sort === 'player' || m.sort === 'any') && m.origin !== 'step' && m.bareOnly !== true).map((m) => m.origin))) return { ref: 'iterating' }; // C6; edh-players-12
    // Standard round 4, r4-refs (CR 608.2c; as saidAt for a list): "Its controller searches their library for a basic land card, puts it onto the battlefield tapped ...,
    // then shuffles": a template writes the words of its "its controller" in each instruction, but they were said once, before the instructions, so a later instruction's
    // copy names what the first one named, never what an earlier instruction of the sentence found
    const saidKey = a.selfLast === true && said !== undefined ? JSON.stringify(a) : undefined;
    if (saidKey !== undefined && said!.has(saidKey)) return clone(said!.get(saidKey));
    const implicit = implicitCandidate(value, path, a);
    if (implicit !== null) {
      ok = false;
      u.manual = { code: 'unbound-reference', reason: `"${a.text}" is ambiguous: ${implicit}`, unresolved: true };
      return undefined;
    }
    const attached = attachedObject(value, path, resolved) ?? blockSubject(value, path) ?? damageSource(value, path) ?? copySubject(value, path) ?? copyOfTarget(value, path) ?? fightSubject(value, path); // std-cardcopy-5: nor become a copy of itself // FAST4 T33: nor does a creature block itself; r5-fxb: nor deal damage to itself
    // Cloud std-fin (CR 608.2c): what the earlier instructions of the pronoun's own list of instructions produced (lower/mentions.ts#mentionsInside)
    // (r3-fx: an object an earlier instruction of that list moved is the moved copy only, not also the mention from before the move)
    const extra = inside === undefined ? [] : inside(path, a, (p) => resolved.get(p));
    const movedHere = extra.filter((m) => m.movedBy !== undefined && m.sort !== 'number').map((m) => JSON.stringify(m.ref));
    const here0 = extra.length === 0 ? mentions : [...mentions.filter((m) => m.sort === 'number' || !movedHere.includes(JSON.stringify(m.ref))), ...extra];
    // r4-moved: the card a "this way" condition on a discard names, inside the branch of that condition only (lower/mentions.ts#movedCondMention)
    const inBranch = condObj !== undefined && /^\/(then|do)\//.test(path);
    const here = inBranch ? [...here0, condObj] : here0;
    let pool = attached === null ? here : here.filter((m) => m.sort === 'number' || JSON.stringify(m.ref) !== JSON.stringify(attached));
    // edh-perms-13 (CR 707.2, 707.10; Court of Vantress): what a copy effect copies ("you may have ~ become a copy of it", "create a token that's a copy of it") is the object the
    // sentence before named, never a token a copy step made in another sentence (the other branch of "If you're the monarch, ... If you're not the monarch, ..."); copying a copy
    // is said with "that token"
    if (a.head === undefined && a.participle === undefined && copiesIt(value, path)) {
      pool = pool.filter((m) => m.sort === 'number' || !(m.origin === 'step' && m.heads.includes('token') && m.heads.includes('copy')));
    }
    // std-hob: a creature that is no Aura, Equipment or Fortification is never what "attach it" attaches (CR 301.5, 303.4, 301.6): the object itself is no antecedent
    if (d.animates !== true && d.selfHeads.includes('creature') && !['equipment', 'aura', 'fortification'].some((h) => d.selfHeads.includes(h)) && attachedWhat(value, path)) {
      pool = pool.filter((m) => m.sort === 'number' || !(isRec(m.ref) && m.ref['ref'] === 'self'));
    }
    // std-rx32 (CR 301.5c, 303.4d, 701.3a): nor is a target described as a creature and nothing an attachment could be ("Choose target creature you control and target
    // Equipment. ... Attach it to the chosen creature.", Stolen Uniform): an Equipment or Aura that is a creature is never attached, so "it" is the Equipment
    if (attachedWhat(value, path)) {
      pool = pool.filter((m) => m.sort === 'number' || m.origin !== 'target' || !m.heads.includes('creature') || ['equipment', 'aura', 'fortification', 'artifact', 'enchantment'].some((h) => m.heads.includes(h)));
    }
    // FAST2 T10: "sacrifice it", "destroy it" act on a permanent (CR 701.8a, 701.21a): a spell or ability on the stack is no antecedent there
    // Cloud std-eoe (CR 400.7): nor is a group that a destroy or sacrifice step put into graveyards, for an instruction that acts on permanents ("Untap them", a continuous effect)
    if (acting.has(path) && (PERMANENT_ACTIONS.has(String(stepAt(value, path)?.['op'])) || ON_PERMANENTS.has(String(stepAt(value, path)?.['op'])) || continuousAffects(value, path))) pool = pool.filter((m) => m.leftBattlefield !== true);
    if (acting.has(path) && PERMANENT_ACTIONS.has(String(stepAt(value, path)?.['op']))) pool = pool.filter((m) => m.stackObject !== true);
    // edh-c-14 (CR 701.50a): a connive is done by a permanent, in its subject and in its `who` (the controller of that permanent): Illuminator Virtuoso's "it connives" is never the spell that targeted it
    if ((acting.has(path) || path.endsWith('/who/object')) && stepAt(value, path)?.['op'] === 'action' && stepAt(value, path)?.['action'] === 'connive') pool = pool.filter((m) => m.stackObject !== true);
    // edh-perms-14 (CR 301.5, 303.4, 701.3a; Cori-Steel Cutter: "create a Monk token. You may attach this Equipment to it."): what an attachment is attached to is a permanent, so a spell or
    // an ability on the stack (the spell a cast trigger is about) is no antecedent of the pronoun at the `to` of an attach
    if (acting.has(path) && path.endsWith('/to') && stepAt(value, path)?.['op'] === 'attach') pool = pool.filter((m) => m.stackObject !== true && !(m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'spell'));
    // std-craft-2 (CR 707.10, 602.2): what "copy it" copies as a spell is a spell or an ability on the stack: after "whenever you activate an ability", the ability, never
    // the object whose ability it is (the event's source, or ~); only a tie-break: when more than one candidate is left and at least one of them is a spell or an
    // ability, so a reading that resolved before stays as it was ("Exile ... card ... Copy it.": a card, CR 707.12, keeps its candidates)
    if (acting.has(path) && path.endsWith('/what') && stepAt(value, path)?.['op'] === 'copy' && stepAt(value, path)?.['result'] === 'spell') {
      const onStack = (m: Mention): boolean => m.sort === 'number' || m.origin === 'opaque' || m.stackObject === true || m.heads.includes('spell') || m.heads.includes('ability');
      const live = pool.filter((m) => m.sort !== 'number' && compatible(a, m));
      if (live.length > 1 && live.some((m) => m.origin !== 'opaque' && onStack(m))) pool = pool.filter(onStack);
    }
    // edh-cast-12 (CR 707.10, 707.2; Increasing Vengeance: "Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead."):
    // "that spell" is the spell the earlier sentence named, never the copy that sentence's instruction makes (Oracle calls a copy "the copy" or "that copy"). Only a tie-break: the
    // copy a step made is dropped when another object that is a spell is left
    if (acting.has(path) && a.head === 'spell' && path.endsWith('/what') && stepAt(value, path)?.['op'] === 'copy' && stepAt(value, path)?.['result'] === 'spell') {
      const keep = pool.filter((m) => !(m.origin === 'step' && m.heads.includes('copy')));
      if (keep.length > 0 && keep.length < pool.length) pool = keep;
    }
    // edh-next-129 (CR 707.10, 115.7; Chef's Kiss: "Copy it, then reselect the targets at random for the spell and the copy."): "the spell" whose targets are reselected beside the copy is
    // the spell copied, never the copy the instruction before made (Oracle calls that one "the copy"). Only a tie-break, as edh-cast-12's: the copy is dropped when another spell is left
    if (a.head === 'spell' && /\/what\/of\/\d+$/.test(path) && stepAt(value, path)?.['op'] === 'chooseNewTargets') {
      const keep = pool.filter((m) => !(m.origin === 'step' && m.heads.includes('copy')));
      if (keep.length > 0 && keep.length < pool.length) pool = keep;
    }
    // std-rw9 (CR 701.21a, 115.4): what "sacrifice it" names is a permanent its controller controls, so a target that may be a player ("any other target") is no
    // antecedent there: "Target creature you control deals damage equal to its power to any other target. Then sacrifice it." (Burn Together) sacrifices the creature
    if (acting.has(path) && stepAt(value, path)?.['op'] === 'sacrifice') pool = pool.filter((m) => !(m.origin === 'target' && m.sort === 'any'));
    // Cloud std-fin (CR 701.3d, 301.5c, 303.4d): what "unattach it" moves is an attached Aura, Equipment or Fortification, never a creature (an Equipment or Aura that
    // is a creature is never attached), so a creature named before is no antecedent there ("You may attach an Equipment you control to that creature. If you do,
    // unattach it ..."); render/refs.ts#candidateCheck says the same (RenderState.attachmentOnly)
    else if (acting.has(path) && unattachWhat(value, path)) pool = pool.filter((m) => m.sort === 'number' || !m.heads.includes('creature'));
    // FAST4 T27: ... and so does the continuous effect of a resolving ability ("it gets +0/+2 until end of turn"): it modifies only objects on the battlefield
    // (CR 611.2c)
    else if (acting.has(path) && continuousAffects(value, path)) pool = pool.filter((m) => m.stackObject !== true);
    // edh-next-131 (CR 608.2c; Arna Kennerüd, Skycaptain): "for each nontoken permanent attached to it, ...": a reference inside the range of a loop (`forEach` over) names something before the loop,
    // never the loop's own element, which that range defines
    const inOver = path.lastIndexOf('/over/');
    const loop = inOver >= 0 ? stepAt(value, path.slice(0, inOver + '/over'.length)) : null;
    if (loop !== null && loop['op'] === 'forEach' && typeof loop['as'] === 'string') pool = pool.filter((m) => !(isRec(m.ref) && m.ref['ref'] === 'bound' && m.ref['name'] === loop['as']));
    // (only a bare pronoun: Oracle names ~ "it", never "that card" or "that creature", CR 201.5)
    // Standard round 4, r4-refs (CR 608.2c, 109.4, 108.3): "they" as the player who does an instruction ("They discard that card.", the step's `who`), or who controls
    // or owns the objects a description names ("a face-up exiled card they own"), names a player, never the objects an earlier step revealed or chose: only player
    // mentions are its candidates there
    if (a.sort === 'any' && PLAYER_KEYS.has(path.slice(path.lastIndexOf('/') + 1)) && stepAt(value, path) !== null) pool = pool.filter((m) => m.sort === 'number' || m.sort === 'player' || m.origin === 'opaque');
    // edh-players-10 (CR 608.2c; Sylvan Offering): a second "Choose an opponent." names the player anew: "that player" is the latest one chosen
    const lastChosen = Math.max(-1, ...pool.filter((m) => m.rebinds === 'chosenPlayer' && m.unit < u.index).map((m) => m.unit));
    if (pool.some((m) => m.rebinds === 'chosenPlayer' && m.unit < lastChosen)) pool = pool.filter((m) => m.rebinds !== 'chosenPlayer' || m.unit >= lastChosen);
    const own = a.head === undefined && a.participle === undefined ? ownSourceMention(value, path, acting, d) : null;
    if (own !== null && !pool.some((m) => m.sort !== 'number' && isRec(m.ref) && m.ref['ref'] === 'self')) pool = [...pool, own];
    const looked = lookBack(a, pool, u.tokens, u.index);
    // edh-players-4 (CR 503.1, 603.3a; Mention.bareOnly): "that player" is never the active player of "At the beginning of YOUR end step" (the controller, Oracle's "you") when another
    // player is named ("Then target opponent may have you draw a card. If that player doesn't, ..."); with no other player named it keeps reading as it did
    // edh-players-10 (CR 503.1, 603.3a; Astarion, the Decadent): nor is it "they" / "their" / "them": Oracle says "you" for the controller ("At the beginning of your end step, target opponent loses life equal to the amount of life they lost")
    const cands = looked !== null && (a.head !== undefined || ((a.sort === 'any' || a.sort === 'player') && (a.text === 'they' || a.text === 'their' || a.text === 'them'))) && looked.some((m) => m.bareOnly === true && compatible(a, m)) && looked.some((m) => m.bareOnly !== true && m.sort !== 'number' && m.origin !== 'opaque' && compatible(a, m))
      ? looked.filter((m) => m.bareOnly !== true) : looked;
    // trek-15 (CR 608.2c, 603.2; Vengeance Mission): "Whenever a creature dies, ... Target opponent loses 1 life. That player loses 2 life instead if ...": the trigger's text names no
    // player (the creature has no controller or owner in "a creature"), so the player role of its event is no phrase "that player" can echo; "that player" is the player an earlier sentence targets
    // edh-c-8 (CR 608.2c, 603.2; Bala Ged Thief): the same for "Whenever this creature or another Ally you control enters, target player reveals ... That player discards that card.": every event is a
    // zone change of objects "you control" (or ~ itself), so the player its event names is "you" (Oracle's word for the controller), never "that player"
    const eventNamesNoPlayer = d.trigger !== undefined && d.trigger.on.length >= 1 && d.trigger.on.every((p) => p.ev === 'zoneChange')
      && d.trigger.on.every((p) => { const sub = p.subject as unknown as Rec; return sub['owner'] === undefined && (sub['controller'] === undefined || sub['controller'] === 'you') && (sub['self'] !== true || d.trigger!.on.length > 1); });
    const named = cands !== null && a.text === 'that player' && eventNamesNoPlayer && cands.some((m) => m.origin === 'target' && m.sort === 'player' && compatible(a, m))
      ? cands.filter((m) => !(m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'player'))
      : cands;
    // edh-next-87 (CR 608.2c, 115.1; Deathbringer Liege): "Whenever you cast a black spell, you may destroy target creature if it's tapped.": a bare "it" in the very sentence that names a target
    // of the ability is that target; the object the trigger's own event is about (the spell cast, the creature that died) would be "that spell" / "that creature" in Oracle. Only the
    // pronoun of the target's own sentence (a later sentence keeps both candidates), and only when exactly one target of that sentence is compatible
    const targetOfSentence = named !== null && a.head === undefined && a.text === 'it' && named.filter((m) => m.origin === 'target' && m.unit === u.index && compatible(a, m)).length === 1;
    const namedIt = targetOfSentence ? named!.filter((m) => !(m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'event' && (m.ref['role'] === 'object' || m.ref['role'] === 'subject' || m.ref['role'] === 'spell'))) : named;
    let r: Resolution = namedIt === null ? { ok: false, count: 0, opaque: true } : resolveAnaphor(a, namedIt);
    // edh-perms-23 (CR 608.2c, 111.1, 707.2; Hazel of the Rootbloom): "Create a token that's a copy of target token you control. If that token is a Squirrel, instead create two
    // tokens that are copies of it.": in the CONDITION of an "if", "that token" is the target token, not the copy the sentence before made of it (Oracle's words name what the copy
    // was made of); only when the other candidate is the token copy of exactly that target, and the target says "token" itself (a wildcard target is not such a token)
    if (!r.ok && !r.opaque && r.count === 2 && a.head === 'token' && a.text.startsWith('that ') && /\/cond(\/|$)/.test(path) && named !== null) {
      const hits = named.filter((m) => compatible(a, m));
      const target = hits.filter((m) => m.origin === 'target' && m.heads.includes('token') && isRec(m.ref) && m.ref['ref'] === 'target');
      const made = hits.filter((m) => m.origin === 'step' && (m.verbs ?? []).includes('created'));
      const step = (made[0] as unknown as { unitRef?: { steps?: unknown[] } } | undefined)?.unitRef?.steps?.[0];
      if (hits.length === 2 && target.length === 1 && made.length === 1 && isRec(step) && step['op'] === 'copy' && step['result'] === 'token' && JSON.stringify(step['what']) === JSON.stringify(target[0]!.ref)) r = { ok: true, mention: target[0]! };
    }
    // edh-next-131 (CR 608.2c, 111.1, 707.2; Krothuss, Lord of the Deep): the same in the condition of "If that creature is a Kraken, ..., create two of those tokens instead." right after "create a tapped and
    // attacking token that's a copy of another target attacking creature": "that creature" is the target creature, not the token copy the sentence before made of it (Oracle's words name what the copy
    // was made of); only when the other candidate is the token copy of exactly that target
    if (!r.ok && !r.opaque && r.count === 2 && a.head === 'creature' && a.text === 'that creature' && /\/cond(\/|$)/.test(path) && named !== null) {
      const hits = named.filter((m) => compatible(a, m));
      const target = hits.filter((m) => m.origin === 'target' && m.heads.includes('creature') && isRec(m.ref) && m.ref['ref'] === 'target');
      const made = hits.filter((m) => m.origin === 'step' && (m.verbs ?? []).includes('created'));
      const step = (made[0] as unknown as { unitRef?: { steps?: unknown[] } } | undefined)?.unitRef?.steps?.[0];
      if (hits.length === 2 && target.length === 1 && made.length === 1 && isRec(step) && step['op'] === 'copy' && step['result'] === 'token' && JSON.stringify(step['what']) === JSON.stringify(target[0]!.ref)) r = { ok: true, mention: target[0]! };
    }
    // edh-c-67 (CR 608.2c, 120.3, 201.5; Acolyte of the Inferno): "Whenever ~ becomes blocked by a creature, it deals 2 damage to that creature.": a bare "it" that is the source of damage
    // dealt "to that <noun>" is not the object that noun names (a source that damaged itself is said "itself"), so of several candidates it is the object itself, the one other
    // object the words can mean (unique-candidate rule, design 6.4). Only in a trigger of the object's own event, when "~" is not said before the pronoun
    const dmgToThat = (): boolean => {
      if (!path.endsWith('/source')) return false;
      const st = stepAt(value, path);
      return st !== null && st['op'] === 'damage' && isRec(st['source']) && isRec(st['source']['$anaphor']) && isRec(st['to']) && isRec(st['to']['$anaphor']) && typeof st['to']['$anaphor']['head'] === 'string'
        && st['to']['$anaphor']['text'] === `that ${st['to']['$anaphor']['head']}`;
    };
    // edh-next-107 (CR 509.1h, 506.3, 608.2c; Simian Sling): "Whenever this creature or equipped creature becomes blocked, it deals 1 damage to defending player.": the trigger never
    // names the blocking creature (no `by` in any event), so a bare "it" is the creature that became blocked (the attacker role of every event), never the blocker the engine also
    // records as a role; exactly those two event mentions, only as the source of damage
    if (!r.ok && !r.opaque && r.count === 2 && cands !== null && a.head === undefined && a.participle === undefined && a.orHead === undefined && a.sort !== 'player' && path.endsWith('/source')
      && (d.trigger?.on ?? []).length > 0 && (d.trigger?.on ?? []).every((p) => p.ev === 'becomesBlocked' && p.by === undefined)) {
      const att = cands.filter((m) => m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'attacker' && compatible(a, m));
      const blk = cands.filter((m) => m.origin === 'event' && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === 'blocker');
      if (att.length === 1 && blk.length === 1 && cands.length === 2) r = { ok: true, mention: att[0]! };
    }
    if (!r.ok && !r.opaque && r.count > 1 && cands !== null && a.head === undefined && a.participle === undefined && a.orHead === undefined && a.sort !== 'player' && !selfBefore(u.tokens, a)
      && (d.trigger?.on ?? []).length > 0 && (d.trigger?.on ?? []).every((p) => JSON.stringify(p).includes('"self":true')) && dmgToThat() && !cands.some((m) => m.origin === 'opaque')) {
      // (the object itself is the event's role whose pattern is `self`: the attacker of "becomes blocked", the blocker of "blocks", the subject of a zone change)
      const selfRoles = new Set((d.trigger?.on ?? []).flatMap((p) => (['attacker', 'blocker', 'subject', 'source'] as const).filter((k) => isRec((p as unknown as Rec)[k]) && ((p as unknown as Rec)[k] as Rec)['self'] === true)));
      const isSelf = (m: Mention): boolean => isRec(m.ref) && (m.ref['ref'] === 'self' || (m.ref['ref'] === 'event' && typeof m.ref['role'] === 'string' && selfRoles.has(m.ref['role'] as never)));
      const mine = cands.filter((m) => m.sort !== 'number' && isSelf(m) && compatible(a, m));
      const f = mine.length === 1 ? mine[0] : undefined;
      if (f !== undefined) r = { ok: true, mention: f };
    }
    // r5-fxb: "its" in the amount of damage a target deals is that target (damageAmountSource), among several compatible candidates
    const ownTarget = a.head === undefined && a.participle === undefined && a.orHead === undefined ? damageAmountSource(value, path, acting, resolved) : null;
    if (!r.ok && !r.opaque && r.count > 1 && ownTarget !== null && cands !== null) {
      const f = cands.find((m) => m.sort !== 'number' && JSON.stringify(m.ref) === JSON.stringify(ownTarget) && compatible(a, m));
      // edh-fix-3 (design 6.4): the object itself is the owner of "its power" only when no other candidate could have a power: the others are spells (a noncreature spell has none),
      // never a creature ("Whenever a creature enters, ~ deals damage equal to its power": ~ or the creature, so it stays manual)
      const noPowerElse = ownTarget['ref'] !== 'self' || cands.every((m) => m === f || m.sort === 'number' || !compatible(a, m) || ((m.stackObject === true || m.heads.includes('spell')) && !m.heads.includes('creature')));
      if (f !== undefined && noPowerElse) r = { ok: true, mention: f };
    }
    // FAST5 T76: the focus of the sentence before (focusAt) decides between several compatible candidates for a bare pronoun, or for "that card" after the instruction
    // that moved it (CR 400.7: the moved object is a card in its new zone; "that creature" and the other nouns keep the unique-candidate rule, design 6.4); LOOK2: a
    // binding that instruction moved into exile or a graveyard is such a card too (movedCardFocus)
    if (!r.ok && !r.opaque && r.count > 1 && focus !== undefined && cands !== null && (a.head === undefined || (a.head === 'card' && (focus.movedBy !== undefined || movedCard) && !(isRec(focus.ref) && focus.ref['ref'] === 'self'))) && a.participle === undefined && a.orHead === undefined && a.sort !== 'player') {
      const f = cands.find((m) => sameReferent(m, focus) && compatible(a, m));
      // ... unless the sentence itself names another object the pronoun could look back to ("If ~ was kicked, it deals 2 damage to another target creature": ~ is named before
      // the pronoun, in the sentence's own condition, and is what it means): a mention of this sentence, or a "~" before the pronoun, keeps the unique-candidate rule
      // (Cloud std-fin: with the focus of an instruction of the same sentence, focusWithin, what the instructions before that one produced is the sentence's past, as an earlier
      // sentence is for focusAt: "create a Treasure token, then look at the top card of that player's library and exile it face down")
      const within = focus.origin === 'step' && focus.unit === u.index;
      // (r4-refs, design 6.4: pronouns look back: a target the sentence names only AFTER every one of its reference words is no antecedent of them, "When you do, if it has
      // four or more quest counters on it, put a +1/+1 counter on target creature you control.", targetAfter)
      const sentenceNamed = cands.some((m) => m.unit === u.index && m.sort !== 'number' && !sameReferent(m, focus) && compatible(a, m) && !(within && m.origin === 'step') && !targetAfter(u, m) && !sharedWithSelf(u, m)) || (!(isRec(focus.ref) && focus.ref['ref'] === 'self') && selfBefore(u.tokens, a) && !attachesSelf(u));
      if (f !== undefined && !sentenceNamed && !cands.some((m) => m.origin === 'opaque')) r = { ok: true, mention: f };
    }
    // edh-d-95 (CR 608.2c, 111.1; G'raha Tia, Scion Reborn): focusWithin one level down: "If you do, create a 1/1 colorless Hero creature token and put X +1/+1 counters on it.":
    // inside the branch of the condition (or the option), the bare pronoun of an instruction that is not the first of that list means the token(s) the instruction RIGHT BEFORE
    // it in the same list created (model/focus.ts, kind 'makes'), exactly as focusWithin reads it at the top level of a sentence. Only a bare pronoun, a sentence that refers
    // back to one object only and names no target of its own, and only to decide between several compatible candidates (the trigger's spell or the object itself)
    if (!r.ok && !r.opaque && r.count > 1 && cands !== null && a.head === undefined && a.participle === undefined && a.orHead === undefined && a.sort !== 'player' && !cands.some((m) => m.origin === 'opaque')) {
      const made = nestedMadeFocus(value, path, u);
      const f = made === null ? undefined : cands.find((m) => m.origin === 'step' && (m as StepMention).unitRef === u && made.test((m as StepMention).path) && compatible(a, m));
      if (f !== undefined) r = { ok: true, mention: f };
    }
    // Cloud std-eoe (CR 115.1, 608.2c; lower/choose.ts): the sentence right after "Choose up to one target creature." is about the target it announced: "that
    // creature", "it" mean that target among several compatible candidates (the attacking creature of the trigger, the object itself), unless the sentence names
    // another one itself or says "~" before the pronoun
    if (!r.ok && !r.opaque && r.count > 1 && chosen !== undefined && cands !== null && a.participle === undefined && a.orHead === undefined && a.sort !== 'player') {
      const f = cands.find((m) => sameReferent(m, chosen) && compatible(a, m));
      const sentenceNamed = cands.some((m) => m.unit === u.index && m.sort !== 'number' && !sameReferent(m, chosen) && compatible(a, m)) || selfBefore(u.tokens, a);
      if (f !== undefined && !sentenceNamed && !cands.some((m) => m.origin === 'opaque')) r = { ok: true, mention: f };
    }
    // r4-moved (CR 608.2c, 603.12): inside the branch of "If you discard a land card this way, ..." / "When you discard a card this way, ...", a bare pronoun or "that
    // card" among several compatible candidates is the card the condition names, the noun phrase right before it in its own sentence, unless the branch names another
    // object of its own (a mention of this sentence) or "~" comes before the pronoun
    if (inBranch && !r.ok && !r.opaque && r.count > 1 && cands !== null && (a.head === undefined || a.head === 'card') && a.participle === undefined && a.orHead === undefined && a.sort !== 'player') {
      const f = cands.find((m) => sameReferent(m, condObj) && compatible(a, m));
      const sentenceNamed = cands.some((m) => m.unit === u.index && m.sort !== 'number' && !sameReferent(m, condObj) && compatible(a, m)) || selfBefore(u.tokens, a);
      if (f !== undefined && !sentenceNamed && !cands.some((m) => m.origin === 'opaque')) r = { ok: true, mention: f };
    }
    // p2-typechange-1 (CR 603.4, 608.2c): the intervening "if" of the trigger is about the object itself alone ("When an opponent casts an enchantment spell, if this
    // permanent is an enchantment, it becomes a 5/5 Treefolk creature."): a bare pronoun of the first sentence of the effect, which names no target and no "~" of its
    // own before the pronoun, is that object, the one the condition just named (the trigger's event object, the spell, is the other candidate)
    if (!r.ok && !r.opaque && r.count > 1 && cands !== null && interveningSelf(d) && u.index === 0 && (u.targetIds?.length ?? 0) === 0 && a.head === undefined && a.participle === undefined
      && a.orHead === undefined && a.sort !== 'player' && !selfBefore(u.tokens, a) && !cands.some((m) => m.origin === 'opaque')) {
      const f = cands.find((m) => m.sort !== 'number' && isRec(m.ref) && m.ref['ref'] === 'self' && compatible(a, m));
      if (f !== undefined) r = { ok: true, mention: f };
    }
    // edh-c-66 (CR 603.4, 608.2c, 303.4; Volition Reins): the same for the intervening "if" about the enchanted or equipped object ("When ~ enters, if enchanted permanent is tapped, untap it."):
    // a bare pronoun of the first sentence of the effect, which names no target and no "~" of its own before the pronoun, is that object, not the Aura or Equipment itself
    if (!r.ok && !r.opaque && r.count > 1 && cands !== null && interveningAttached(d) && u.index === 0 && (u.targetIds?.length ?? 0) === 0 && a.head === undefined && a.participle === undefined
      && a.orHead === undefined && a.sort !== 'player' && !selfBefore(u.tokens, a) && !cands.some((m) => m.origin === 'opaque')) {
      const f = cands.find((m) => m.sort !== 'number' && isRec(m.ref) && m.ref['ref'] === 'attachedTo' && compatible(a, m));
      if (f !== undefined) r = { ok: true, mention: f };
    }
    // std-r8 (CR 608.2c; as the r4-moved rule above): inside the `then` branch of "If that creature is a Turtle, double the number of +1/+1 counters on it", a bare
    // pronoun among several compatible candidates is the one object the condition tests, which its own "that <noun>" named without ambiguity, unless the branch names
    // another object of its own or "~" comes before the pronoun
    // p2-refs-3 (CR 608.2c, 201.5; Answered Prayers): ... and the object itself when the condition tests ~ by its own words ("If this enchantment isn't a creature, it
    // becomes a 3/3 Angel creature ..."), the same rule for a test written {ref:'self'} rather than with a reference word
    const selfTested = isRec(value) && value['op'] === 'if' && isRec(value['cond']) && testsSelf(value['cond']) ? cands?.find((m) => m.sort !== 'number' && isRec(m.ref) && m.ref['ref'] === 'self') : undefined;
    // edh-perms-6 (CR 608.2c, 301.5a, 303.4a; Blade of the Bloodchief): ... and the enchanted or equipped object when the condition tests it ("If equipped creature is a Vampire, put
    // two +1/+1 counters on it instead."), the same rule for a test written {ref:'attachedTo'}
    const attachedTested = isRec(value) && value['op'] === 'if' && isRec(value['cond']) && testsAttached(value['cond']) ? cands?.find((m) => m.sort !== 'number' && isRec(m.ref) && m.ref['ref'] === 'attachedTo') : undefined;
    const tested = /^\/then\//.test(path) && a.head === undefined ? condSubject ?? selfTested ?? attachedTested : undefined;
    if (tested !== undefined && !r.ok && !r.opaque && r.count > 1 && cands !== null && a.participle === undefined && a.orHead === undefined && a.sort !== 'player') {
      const f = cands.find((m) => sameReferent(m, tested) && compatible(a, m));
      // (p2-refs-3: the "~" of a condition that tests ~ itself is the tested object, not another one; only when it is the one "~" before the pronoun)
      const selfOnlyTested = selfTested !== undefined && tested === selfTested && selfCountBefore(u.tokens, a) === 1;
      const sentenceNamed = cands.some((m) => m.unit === u.index && m.sort !== 'number' && !sameReferent(m, tested) && compatible(a, m)) || (selfBefore(u.tokens, a) && !selfOnlyTested);
      if (f !== undefined && !sentenceNamed && !cands.some((m) => m.origin === 'opaque')) r = { ok: true, mention: f };
    }
    // edh-d-93 (CR 608.2c, 701.21a, 303.4; Reality Acid): "When this Aura leaves the battlefield, enchanted permanent's controller sacrifices it.": a bare "it" that is what a player sacrifices, where that
    // player is the controller of an object the same sentence names ("<X>'s controller sacrifices it"), is that object X: the controller can only be told to sacrifice what they control, and the
    // possessive is the one object of the sentence. Only a sacrifice of exactly that one object, only when X is one of the candidates, and only when no "~" comes before the pronoun.
    if (!r.ok && !r.opaque && r.count > 1 && cands !== null && a.text === 'it' && a.head === undefined && a.participle === undefined && a.orHead === undefined && a.sort !== 'player'
      && path === '/filter/is' && isRec(value) && value['op'] === 'sacrificeChoice' && value['count'] === 1 && isRec(value['filter']) && Object.keys(value['filter']).length === 1
      && isRec(value['who']) && value['who']['ref'] === 'controllerOf' && isRec(value['who']['object']) && !selfBefore(u.tokens, a) && !cands.some((m) => m.origin === 'opaque')) {
      const owner = value['who']['object'] as Rec;
      const f = cands.find((m) => m.sort !== 'number' && sameReferent(m, { ref: owner } as never) && compatible(a, m));
      const sentenceNamed = cands.some((m) => m.unit === u.index && m.sort !== 'number' && !sameReferent(m, { ref: owner } as never) && compatible(a, m));
      if (f !== undefined && !sentenceNamed) r = { ok: true, mention: f };
    }
    // edh-c-113 (CR 608.2c; Hog-Monkey Rampage): a bare "it" in an instruction's own trailing condition ("Put a +1/+1 counter on the creature you control if it has power 4 or greater")
    // with several compatible candidates is the object that instruction acts on, when this rewrite resolved that object ("the creature you control" is the first target, not the
    // second): the object the sentence just named. Only the pronoun "it", only in the step's own guard, and only when that object is one of the candidates.
    if (!r.ok && !r.opaque && r.count > 1 && cands !== null && a.text === 'it' && path.startsWith('/guard/') && isRec(value) && a.head === undefined && a.participle === undefined && a.orHead === undefined && a.sort !== 'player') {
      const rawOn = value['on'];
      const own = resolved.get('/on') ?? (isRec(rawOn) && !isRec(rawOn['$anaphor']) && rawOn['ref'] === 'target' ? rawOn : undefined);
      const f = own === undefined ? undefined : cands.find((m) => m.sort !== 'number' && isRec(m.ref) && JSON.stringify(m.ref) === JSON.stringify(own) && compatible(a, m));
      if (f !== undefined && !cands.some((m) => m.origin === 'opaque')) r = { ok: true, mention: f };
    }
    // std-rx23 (CR 608.2c, 301.5a, 303.4a): a bare "it" in an instruction's own trailing condition with no antecedent at all ("At the beginning of your upkeep,
    // put a +1/+1 counter on equipped creature if it's black.") is the enchanted or equipped object that instruction acts on: nothing else is named before it.
    // Only for no candidate (a sentence with one or more candidates keeps the rules above), so no reference that resolved before changes
    const guarded = !r.ok && !r.opaque && r.count === 0 && a.head === undefined && a.participle === undefined && a.orHead === undefined && a.sort !== 'player' ? guardedAttached(value, path) : null;
    if (guarded !== null) {
      resolved.set(path, guarded);
      return guarded;
    }
    if (!r.ok || !accept(r.mention)) {
      ok = false;
      // FAST5 T43: "the rest" with no choice among a group to refer to (the sentence before it is not understood) is a manual step like any sentence no template reads,
      // not a contagious one: it names no object an automated step could have produced (a group looked at is read in the library, nothing else)
      // CLOUD C4: neither is a template's "other" ("destroy all other creatures" with no single earlier object to leave out), as the hole's own "other" is not
      // (anaphoricOther): the words name no object an automated step produced, only which objects the group leaves out
      u.manual = { code: 'unbound-reference', reason: r.ok ? `"${a.text}" refers to something not known when targets are chosen (CR 601.2c)` : unresolvedReason(a, r), ...(a.head === 'rest' || (a.text === 'other' && a.head === undefined) ? {} : { unresolved: true }) };
      return undefined;
    }
    // FAST3 T18: what a cost sacrificed has left the battlefield: its last known information can be read (CR 608.2h), but nothing can act on it (CR 400.7)
    // CLOUD C8: so, for now, is what a cost discarded, exiled or tapped (read only: "the discarded card's mana value", CR 400.7j, 608.2h): an instruction acting on it stays manual
    // std-cardcopy-7 (CR 707.2, 707.12, 400.7j): a copy of the cards a cost exiled ("Exile any number of black cards from your graveyard ...: Copy those exiled cards.") reads
    // their copiable values only: the cards are in exile (`costExiled` names them there, effects/refs.ts), nothing moves them
    // edh-perms-18 (review; CR 608.2c): "the creature exiled this way" names what the exile actually moved: when that exile sits inside a "may", an "if", a payment or an "unless"
    // (a nested step), it may not have happened, and the target handle would be read anyway: manual
    if (/^the \S+ (exiled|sacrificed) this way$/.test(a.text) && r.mention.movedBy !== undefined && r.mention.movedBy.path.split('/').filter((x) => x !== '').length > 1) {
      ok = false;
      u.manual = { code: 'unbound-reference', reason: `"${a.text}" follows an exile that may not have happened (CR 608.2c)`, unresolved: true };
      return undefined;
    }
    // edh-next-131 (CR 707.2, 608.2h; God-Pharaoh's Gift): ... also the token copy inside the "If you do" of the optional payment that exiled it ("you may exile a creature card from your graveyard. If you
    // do, create a token that's a copy of that card, ..."): the copy reads the card in exile, nothing moves it
    const copiesCostExiled = r.mention.ref['ref'] === 'costExiled' && ((path === '/what' && isRec(value) && value['op'] === 'copy')
      || (/^\/then\/0\/what$/.test(path) && isRec(value) && value['op'] === 'if' && stepAt(value, path)?.['op'] === 'copy' && stepAt(value, path)?.['result'] === 'token'));
    // edh-perms-18 (CR 707.2, 608.2h, 400.7; Cleaver Skaab): a token copy of the creature a cost sacrificed uses its copiable values as it last existed (the `copy` handler reads them
    // from last known information, effects/handlers/tokens-copy.ts#copyAsTokens); nothing acts on the sacrificed object itself
    const copiesCostSacrificed = r.mention.ref['ref'] === 'costSacrificed' && path === '/what' && isRec(value) && value['op'] === 'copy' && value['result'] === 'token';
    // trek-21 (CR 400.7j, 602.2b; The Guardian of Forever): "that card" the cost sacrificed is the new object in the graveyard, which a move of the effect may act on
    const cardOfCost = r.mention.ref['ref'] === 'costSacrificed' && r.mention.ref['card'] === true && path.endsWith('/what') && isRec(value) && (value['op'] === 'move' || (value['op'] === 'delay' && path.startsWith('/do/')));
    // edh-d-94 (CR 400.7j, 702.62a; Jhoira of the Ghitu): the card a cost exiled is found in exile by the ability's effects: an instruction may put counters on it or make it gain an
    // ability ("Put four time counters on the exiled card. If it doesn't have suspend, it gains suspend."): `costExiled` names it only while it is still in exile (effects/refs.ts#actedCostExiled)
    const actsOnCostExiled = r.mention.ref['ref'] === 'costExiled' && r.mention.ref['self'] === undefined && isRec(value) && ((value['op'] === 'putCounters' && path === '/on') || (value['op'] === 'if' && /^\/then\/\d+\/effects\/\d+\/affects$/.test(path)));
    // edh-d-101 (CR 400.7, 406.3, 601.2, 305.1; Primordial Mist): "that card" a cost exiled from the battlefield is the new object in exile, which a permission of the effect ("You may
    // play that card this turn") lets its controller play: nothing moves it as the effect resolves, the permission names the card where it is
    const permitsCostExiled = r.mention.ref['ref'] === 'costExiled' && r.mention.ref['self'] === undefined && u.index === 0 /* review: the effect's first sentence ("Draw a card. You may cast that card" means the drawn card) */ && isRec(value) && value['op'] === 'effect' && /^\/effects\/\d+\/of\/is$/.test(path)
      && Array.isArray(value['effects']) && (value['effects'] as unknown[]).every((e) => isRec(e) && e['s'] === 'permit');
    if (COST_MOVED.has(String(r.mention.ref['ref'])) && acting.has(path) && !actsOnCostExiled && !copiesCostExiled && !copiesCostSacrificed && !cardOfCost && !permitsCostExiled) {
      ok = false;
      u.manual = { code: 'unbound-reference', reason: `"${a.text}" names an object a cost moved: only its last known information can be read (CR 400.7, 608.2h)`, unresolved: true };
      return undefined;
    }
    // std-r8: the object an `if`'s own test names by "that <noun>" (`cond: 'matches'`, its only reference word), for the pronouns of its branch (above)
    if (path === '/cond/object' && a.head !== undefined && isRec(value) && value['op'] === 'if' && isRec(value['cond']) && value['cond']['cond'] === 'matches' && countAnaphors(value['cond']) === 1) condSubject = r.mention;
    const ref = (acting.has(path) ? bindMoved(r.mention, d) : null) ?? bind(r.mention, d);
    if (isRec(ref)) resolved.set(path, ref);
    if (saidKey !== undefined && isRec(ref)) said!.set(saidKey, ref);
    return ref;
  });
  return ok ? out : null;
}

/**
 * std-rx23: the object a step acts on when it is the enchanted or equipped object (`{ref:'attachedTo'}` as the step's `on` or `what`) and `path` is inside that
 * step's own `guard` ("put a +1/+1 counter on equipped creature if it's black"); null otherwise.
 */
function guardedAttached(value: unknown, path: string): Rec | null {
  if (!isRec(value) || !path.startsWith('/guard/') || typeof value['op'] !== 'string') return null;
  for (const k of ['on', 'what']) {
    const v = value[k];
    if (isRec(v) && v['ref'] === 'attachedTo' && Object.keys(v).length === 1) return { ref: 'attachedTo' };
  }
  return null;
}

/** std-r8: the number of reference words (`$anaphor` nodes) inside a value. */
function countAnaphors(v: unknown): number {
  let n = 0;
  visit(v, (x) => { if (isRec(x['$anaphor'])) n++; });
  return n;
}

/**
 * PUSH1 T2 review (design 6.4): the object an activation cost names (a `fallback` mention, lower/ability.ts#costMentions) is a candidate only in the first
 * instruction of the effect, and only when that instruction introduces no object of its own (model/cost-antecedent.ts): anywhere else a discarded, drawn,
 * milled, searched or sacrificed card the discourse model does not track may be what the pronoun means, and binding it to ~ would be a silent wrong guess.
 */
const withoutFallback = (mentions: Mention[]): Mention[] => mentions.filter((m) => m.fallback !== true);
const costWindow = (u: Unit, at: number, i: number, prefix: readonly Unit[], all: readonly Mention[] = []): boolean => prefix.length === 0 && at === 0 && i === 0 && actsOnlyOnNamed(u.steps[0], !all.some((m) => m.selfMoved === true));

/**
 * FAST5 T67 (CR 111.1, 608.2c, 608.2h, 201.5): "Whenever ~ enters or attacks, create a number of 1/1 ... tokens equal to its power." The object itself in a
 * disjunction of its own events (lower/scope.ts, FAST3 T18: a `selfObject` fallback) may be what a pronoun in the COUNT of the first instruction's token
 * creation means: the number is read before the step creates anything, and nothing was introduced before it. Only when every pronoun of the step is in its
 * count (never in the token's description or where it is attached), and never for the object an activation cost names (the renderer's cost rule,
 * model/cost-antecedent.ts, stays as it is).
 */
function countWindow(u: Unit, at: number, i: number, prefix: readonly Unit[]): boolean {
  if (prefix.length > 0 || at !== 0 || i !== 0) return false;
  // edh-players-20 (CR 121.1, 201.5; Titan of Littjara): and the count of a draw, "you may draw a card for each other creature you control that shares a creature type with it"
  // (read before anything is drawn); the `may` of the player around it holds the same step
  const first = u.steps[0];
  const s = first !== undefined && first['op'] === 'may' && Array.isArray(first['do']) && first['do'].length === 1 && isRec(first['do'][0]) ? first['do'][0] : first;
  if (s === undefined || (s['op'] !== 'createToken' && s['op'] !== 'draw') || s['guard'] !== undefined || !actsOnlyOnNamed(s['count'])) return false;
  let outside = false;
  for (const [k, v] of Object.entries(s)) if (k !== 'count') visit(v, (n) => { if ('$anaphor' in n) outside = true; });
  return !outside;
}
const ownEventFallbacks = (mentions: Mention[]): Mention[] => mentions.filter((m) => m.fallback !== true || m.selfObject === true);

/**
 * edh-d-71 (CR 602.2b, 608.2h, 122.1, 400.7; Lost Isle Calling): "{4}{U}{U}, Exile this enchantment: Draw a card for each verse counter on this enchantment. If it had seven or more
 * verse counters on it, take an extra turn after this one." The "it" of a condition on the COUNTERS something had is the object the cost moved away (its last known information):
 * only a permanent has counters, so no card an earlier instruction drew, and none the discourse model does not track, can be what the pronoun means. Only when the cost moved the
 * object itself (`selfMoved`), the instructions before it only draw, gain or lose life or act on objects already named, and every pronoun of the step is in the condition.
 */
function countersHadWindow(u: Unit, seq: readonly Unit[], at: number, i: number, prefix: readonly Unit[], all: readonly Mention[]): boolean {
  if (prefix.length > 0 || !all.some((m) => m.selfMoved === true && m.fallback === true)) return false;
  const step = u.steps[i];
  const cond = step !== undefined && step['op'] === 'if' && step['guard'] === undefined && step['else'] === undefined ? step['cond'] : undefined;
  if (!isRec(cond) || cond['cond'] !== 'matches' || !isRec(cond['object']) || !('$anaphor' in cond['object']) || !isRec(cond['filter']) || cond['filter']['counters'] === undefined) return false;
  let outside = false;
  for (const [k, v] of Object.entries(step!)) if (k !== 'cond') visit(v, (n) => { if ('$anaphor' in n) outside = true; });
  if (outside) return false;
  const quiet = (x: Rec): boolean => x['op'] === 'draw' || x['op'] === 'gainLife' || x['op'] === 'loseLife' || actsOnlyOnNamed(x, false);
  const before = [...seq.slice(0, at).flatMap((x) => (x.manual !== undefined ? [{ op: 'manual' } as Rec] : x.steps)), ...u.steps.slice(0, i)];
  return before.every(quiet);
}

/**
 * std-costs-1 (CR 201.5, 608.2c; Rottenmouth Viper): "Whenever ~ enters or attacks, put a blight counter on it. Then for each blight counter on it, ...": the object itself
 * in a disjunction of its own events stays what a bare pronoun means in a LATER instruction when every instruction before it acted only on objects already named
 * (model/cost-antecedent.ts#actsOnlyOnNamed: nothing was introduced that the pronoun could mean instead) and the pronoun is read before the instruction does
 * anything: in the count of a repeat ("for each blight counter on it"), or in an instruction that itself acts only on named objects.
 */
function laterOwnEventWindow(u: Unit, seq: readonly Unit[], at: number, i: number, prefix: readonly Unit[]): boolean {
  if (prefix.length > 0 || (at === 0 && i === 0)) return false;
  const before = [...seq.slice(0, at), u];
  for (const v of before) {
    if (v.manual !== undefined) return false;
    const steps = v === u ? v.steps.slice(0, i) : v.steps;
    if (!steps.every((st) => actsOnlyOnNamed(st))) return false;
  }
  const s = u.steps[i];
  if (s === undefined || s['guard'] !== undefined) return false;
  if (actsOnlyOnNamed(s)) return true;
  if (s['op'] !== 'repeat') return false;
  let outside = false;
  for (const [k, v] of Object.entries(s)) if (k !== 'times') visit(v, (n) => { if ('$anaphor' in n) outside = true; });
  return !outside;
}

/**
 * edh-b-9 (CR 701.3a, 201.5, 608.2c; Armory Automaton): "Whenever ~ enters or attacks, you may attach any number of target Equipment to it." The object itself in a
 * disjunction of its own events is what the pronoun of the host means when the first instruction attaches objects it names or targets itself (no pronoun in what is
 * attached): the Equipment cannot be the host it is attached to, and nothing else was introduced before the instruction, and the trigger names no other object (an event mention) the pronoun could mean.
 */
function attachHostWindow(u: Unit, at: number, i: number, prefix: readonly Unit[]): boolean {
  if (prefix.length > 0 || at !== 0 || i !== 0) return false;
  const first = u.steps[0];
  const s = first !== undefined && first['op'] === 'may' && Array.isArray(first['do']) && first['do'].length === 1 && isRec(first['do'][0]) ? first['do'][0] : first;
  if (s === undefined || s['op'] !== 'attach' || s['guard'] !== undefined || !isRec(s['to']) || !('$anaphor' in s['to'])) return false;
  let inWhat = false;
  visit(s['what'], (n) => { if ('$anaphor' in n) inWhat = true; });
  return !inWhat;
}

/**
 * FAST5 T76 (CR 701.63a, 201.5): "Whenever ~ enters or attacks, it endures 2." The object itself in a disjunction of its own events may be what the pronoun of the first
 * instruction means when that instruction is the endure action and nothing else: it names the permanent and introduces no object a pronoun before it could mean.
 * edh-c-14 (CR 701.50a, 201.5; Scurrilous Sentry, Illuminator Virtuoso): the same for "it connives" ("Whenever ~ enters or attacks, it connives.", "Whenever ~ becomes the
 * target of a spell you control, it connives."): the connive action alone, whose one subject is the pronoun.
 */
function endureWindow(u: Unit, at: number, i: number, prefix: readonly Unit[]): boolean {
  const s = u.steps[0];
  return prefix.length === 0 && at === 0 && i === 0 && u.steps.length === 1 && s !== undefined && s['op'] === 'action' && (s['action'] === 'endure' || s['action'] === 'connive') && s['guard'] === undefined;
}

/**
 * FAST2 T10, the search idiom (CR 701.23a): "Search your library for a basic land card, [reveal it,] put it onto the battlefield tapped": the "it" (or "that
 * card") of the move right after a search for one card, in the same sentence, is the card found. The idiom says so, not a ranking of antecedents: Oracle
 * names the object itself "~" there, never "it" (render/fold.ts#searchThenMove writes the idiom the same way, so the gate checks it).
 */
function searchIdiom(steps: Rec[], i: number, d: Draft): void {
  const prev = steps[i - 1];
  const cur = steps[i];
  if (prev === undefined || cur === undefined || prev['op'] !== 'search' || cur['op'] !== 'move' || cur['until'] !== undefined) return;
  const what = cur['what'];
  if (!isRec(what) || !isRec(what['$anaphor'])) return;
  const a = what['$anaphor'] as unknown as AnaphorInfo;
  // edh-c-60 (Rites of Spring): "Discard any number of cards. Search your library for up to that many basic land cards, reveal them, put them into your hand, then shuffle.": the "them" of the move
  // right after a search for several cards (the amount is "that many", reading the discards) is the cards found, not the cards discarded before the search
  // edh-d-28 (Fervent Mastery): ... with or without the reveal ("Search your library for up to three cards, put them into your hand, shuffle, then discard three cards at random." after a sentence that discarded cards)
  const several = prev['max'] !== 1 && a.number === 'plural' && a.text === 'them';
  if (prev['max'] !== 1 && !several) return;
  if (a.participle !== undefined || (several ? a.sort !== 'set' : a.sort !== 'object' || a.number !== 'singular' || !(a.text === 'it' || a.text === 'that card'))) return;
  if (typeof prev['as'] !== 'string') prev['as'] = freshName(d, 'found');
  steps[i] = { ...cur, what: { ref: 'bound', name: prev['as'] } };
}

/** The keys of a step that hold a list of instructions (lower/mentions.ts#stepsInOrder). */
const INNER_LISTS: readonly string[] = ['then', 'else', 'do', 'otherwise', 'onWin', 'onLose'];

/**
 * Cloud std-fin: the search idiom inside a list of instructions of a step ("If you do, search your library for an enchantment card, put that card onto the battlefield,
 * then shuffle": the branch of the "if" searches and moves), as searchIdiom reads it in a sentence's own instructions: the idiom names the card found whatever else the
 * sentence mentions.
 */
function searchIdiomInside(step: unknown, d: Draft): void {
  if (!isRec(step)) return;
  for (const k of INNER_LISTS) {
    const list = step[k];
    if (!Array.isArray(list)) continue;
    for (let j = 1; j < list.length; j++) if (isRec(list[j])) searchIdiom(list as Rec[], j, d);
    for (const s of list) searchIdiomInside(s, d);
  }
}

/**
 * edh-d-79 (CR 400.7, 712.14a; Grist, Voracious Larva): "Exile ~, then return it to the battlefield transformed under its owner's control." inside a trigger that also names another
 * creature ("Whenever ~ or another creature you control enters"): the "it" of the move right after the source's own exile is the source as exiled, not the creature of the event. Only
 * the source exiled by itself and then returned to the battlefield transformed under its owner's control; every other "it" keeps the ranking of antecedents.
 */
function flickerSelfIdiom(steps: Rec[], i: number, d: Draft): void {
  const prev = steps[i - 1];
  const cur = steps[i];
  if (prev === undefined || cur === undefined || prev['op'] !== 'move' || cur['op'] !== 'move' || cur['until'] !== undefined || prev['guard'] !== undefined || cur['guard'] !== undefined) return;
  if (JSON.stringify(prev['what']) !== '{"ref":"self"}' || JSON.stringify(prev['to']) !== '{"zone":"exile"}') return;
  const what = cur['what'];
  if (!isRec(what) || !isRec(what['$anaphor'])) return;
  const a = what['$anaphor'] as unknown as AnaphorInfo;
  if (a.participle !== undefined || a.sort !== 'object' || a.number !== 'singular' || a.text !== 'it') return;
  if (JSON.stringify(cur['to']) !== '{"zone":"battlefield","controller":"owner","transformed":true}') return;
  if (typeof prev['as'] !== 'string') prev['as'] = freshName(d, 'moved');
  steps[i] = { ...cur, what: { ref: 'bound', name: prev['as'] } };
}

function flickerSelfIdiomInside(step: unknown, d: Draft): void {
  if (!isRec(step)) return;
  for (const k of INNER_LISTS) {
    const list = step[k];
    if (!Array.isArray(list)) continue;
    for (let j = 1; j < list.length; j++) if (isRec(list[j])) flickerSelfIdiom(list as Rec[], j, d);
    for (const x of list) flickerSelfIdiomInside(x, d);
  }
}

/**
 * LOOK1, the look idiom (CR 701.20e, 608.2c): "Whenever a creature you control deals combat damage to a player, look at the top card of that player's library, then exile
 * it face down.": the "it" (or "that card") of the move right after a look at the top card of one library (model/focus.ts#looksAtOneCard), in the same sentence, is the
 * card looked at, as the search idiom's is the card found (searchIdiom), never the creature of the trigger's event. The renderer's focus after the look says the same
 * (render/steps.ts#clausesOf), so the gate checks it.
 */
/**
 * r4-dig (CR 701.20a-b, 608.2c): a reveal of the top card of ONE player's library, the shown card staying on top (a revealed top card is one mention, lower/mentions.ts):
 * "Whenever ~ attacks, reveal the top card of your library and put it into your hand." The look idiom below reads its "it" as it reads a look's.
 */
function revealsOneTopCard(step: Rec): boolean {
  const what = step['what'];
  return step['op'] === 'reveal' && step['to'] === undefined && isRec(what) && what['ref'] === 'topCards' && what['count'] === 1 && isRec(what['player'])
    && (what['player']['ref'] === 'you' || what['player']['ref'] === 'target');
}

function lookIdiom(steps: Rec[], i: number, d: Draft): void {
  const prev = steps[i - 1];
  const cur = steps[i];
  if (prev === undefined || cur === undefined || !(looksAtOneCard(prev) || revealsOneTopCard(prev)) || prev['guard'] !== undefined || cur['op'] !== 'move' || cur['until'] !== undefined) return;
  const what = cur['what'];
  if (!isRec(what) || !isRec(what['$anaphor'])) return;
  const a = what['$anaphor'] as unknown as AnaphorInfo;
  if (a.sort !== 'object' || a.number !== 'singular' || a.participle !== undefined || !(a.text === 'it' || a.text === 'that card')) return;
  // r4-dig: after a reveal, the bare "it" only ("reveal the top card of your library and put that card into your hand" keeps its reading: the revealed card is that
  // sentence's only candidate for "that card", lower/mentions.ts)
  if (prev['op'] === 'reveal' && a.text !== 'it') return;
  // (a reveal's card is named as the unique-candidate rule names it, "them", so a sentence it already read keeps its JSON)
  if (typeof prev['as'] !== 'string') prev['as'] = freshName(d, prev['op'] === 'reveal' ? 'them' : 'seen');
  steps[i] = { ...cur, what: { ref: 'bound', name: prev['as'] } };
}

/**
 * FAST4 T31, the impulse idiom (CR 611.2c, 400.7): "Exile the top card of your library. You may play that card this turn." / "Mill a card. You may play it
 * this turn.": the "it" (or "that card") of a play permission that begins the sentence right after an instruction that put exactly one card from the top of a
 * library into exile or a graveyard is that card. The idiom says so, not a ranking of antecedents (the object itself is "~" there, never "that card"; Oracle
 * never means another card); render/steps-zones.ts#bindMoved and render/steps-cards.ts (mill) write the same reference, so the gate checks it.
 */
/**
 * r5-dig (CR 611.2c, 400.7, 608.2c): "Whenever you cast a spell with mana value 4 or greater, you may exile the top card of your library. If you do, you may play that
 * card until you exile another card with ~." The impulse idiom for a permission that is the whole "If you do" sentence after an optional exile of exactly one top
 * card: "that card" (or "it") is the card the optional move exiled, never the spell of the trigger (the spell is "that spell"; Oracle never means another card).
 * Only a `may` of you whose only instruction is that move, and an "if you do" (not "if you don't") whose only instruction is the permission.
 */
function ifYouDoImpulse(u: Unit, seq: Unit[], at: number, i: number, d: Draft): void {
  const cur = u.steps[i];
  const prevUnit = at > 0 ? seq[at - 1] : undefined;
  const last = prevUnit?.steps[prevUnit.steps.length - 1];
  if (i !== 0 || cur === undefined || last === undefined || cur['op'] !== 'if' || cur['else'] !== undefined || cur['guard'] !== undefined) return;
  const cond = cur['cond'];
  if (!isRec(cond) || cond['cond'] !== 'did' || cond['not'] === true || !Array.isArray(cur['then']) || cur['then'].length !== 1) return;
  const permit = (cur['then'] as unknown[])[0];
  if (!isRec(permit) || permit['op'] !== 'effect' || !Array.isArray(permit['effects']) || permit['effects'].length !== 1 || permit['guard'] !== undefined) return;
  const e = permit['effects'][0];
  if (!isRec(e) || e['s'] !== 'permit' || e['action'] !== 'play' || !isRec(e['of']) || Object.keys(e['of']).length !== 1) return;
  const is = e['of']['is'];
  if (!isRec(is) || !isRec(is['$anaphor'])) return;
  const a = is['$anaphor'] as unknown as AnaphorInfo;
  if (a.sort !== 'object' || a.number !== 'singular' || a.participle !== undefined || !(a.text === 'it' || a.text === 'that card')) return;
  if (last['op'] !== 'may' || !Array.isArray(last['do']) || last['do'].length !== 1 || last['otherwise'] !== undefined || last['guard'] !== undefined || !isRec(last['who']) || last['who']['ref'] !== 'you') return;
  const move = (last['do'] as unknown[])[0];
  if (!isRec(move) || move['op'] !== 'move' || move['until'] !== undefined || move['guard'] !== undefined) return;
  const what = move['what'];
  const to = move['to'];
  if (!isRec(what) || what['ref'] !== 'topCards' || what['count'] !== 1 || !isRec(what['player']) || what['player']['ref'] !== 'you' || !isRec(to) || to['zone'] !== 'exile' || to['faceDown'] === true) return;
  // (named as bind() names a move's objects, so a sentence the unique-candidate rule already read keeps its JSON)
  if (typeof move['as'] !== 'string') move['as'] = freshName(d, 'them');
  u.steps[i] = { ...cur, then: [{ ...permit, effects: [{ ...e, of: { is: { ref: 'bound', name: move['as'] } } }] }] };
}

function impulseIdiom(u: Unit, seq: Unit[], at: number, i: number, d: Draft): 'folded' | void {
  const cur = u.steps[i];
  const prevUnit = at > 0 ? seq[at - 1] : undefined;
  const last = prevUnit?.steps[prevUnit.steps.length - 1];
  // FAST5 T76: "If there are four or more card types among cards in your graveyard, exile the top card of your library. You may play it until the end of your next turn.":
  // the exile is the plain `then` of a condition, so the card exists only if it held and the permission joins that branch (a name bound in a branch is not visible after
  // it, model/lint-flow.ts), as the permission of an optional exile does below (impulseFlagged)
  // r5-dig (CR 603.7, 611.2c, 400.7): "Until end of turn, whenever a creature you control dies, exile the top card of your library. You may play it until the end of your
  // next turn.": the exile is the last instruction of a delayed triggered ability (CR 603.7: it is created with all its instructions), so the permission is one of its
  // instructions too, for the card that trigger exiled (`delay.do`), as for the plain `then` of a condition above
  const branchKey = last === undefined ? undefined : last['op'] === 'if' ? 'then' : last['op'] === 'delay' ? 'do' : undefined;
  const wrapped = last !== undefined && branchKey !== undefined && Array.isArray(last[branchKey]) && (last[branchKey] as Rec[]).length > 0 && last['else'] === undefined && last['otherwise'] === undefined && last['guard'] === undefined;
  const prev = wrapped ? (last[branchKey!] as Rec[])[(last[branchKey!] as Rec[]).length - 1] : last;
  if (i !== 0 || cur === undefined || prev === undefined || cur['op'] !== 'effect' || !Array.isArray(cur['effects']) || cur['effects'].length !== 1) return;
  const e = cur['effects'][0];
  if (!isRec(e) || e['s'] !== 'permit' || e['action'] !== 'play' || !isRec(e['of']) || Object.keys(e['of']).length !== 1) return;
  const is = e['of']['is'];
  if (!isRec(is) || !isRec(is['$anaphor'])) return;
  const a = is['$anaphor'] as unknown as AnaphorInfo;
  if (a.sort !== 'object' || a.number !== 'singular' || a.participle !== undefined || !(a.text === 'it' || a.text === 'that card')) return;
  const to = isRec(prev['to']) ? prev['to'] : undefined;
  const what = isRec(prev['what']) ? prev['what'] : undefined;
  // one card of one player's library ("each player's" would be several cards: never "that card")
  const onePlayer = (p: unknown): boolean => isRec(p) && (p['ref'] === 'you' || p['ref'] === 'target');
  const topCard = prev['op'] === 'move' && what?.['ref'] === 'topCards' && what['count'] === 1 && onePlayer(what['player']) && to !== undefined && (to['zone'] === 'exile' || to['zone'] === 'graveyard')
    && to['faceDown'] !== true && prev['until'] === undefined && prev['guard'] === undefined;
  const milled = prev['op'] === 'mill' && prev['count'] === 1 && onePlayer(prev['who']) && prev['guard'] === undefined;
  // std-exile-play-1-1 (CR 701.20e, 406.3, 611.2c): "its controller looks at the top card of that opponent's library and exiles it face down. They may play that card
  // ..." (Gonti, Night Minister): the card a look at the top card of one library (the event's player too) bound, then exiled (face down: the player who looked at it
  // may still see it, effects/handlers/zones-move.ts), right before the permission; not in a branch
  const before = !wrapped && prevUnit !== undefined ? prevUnit.steps[prevUnit.steps.length - 2] : undefined;
  const lookAt = isRec(before?.['at']) ? (before!['at'] as Rec) : undefined;
  const looked = before !== undefined && before['op'] === 'look' && typeof before['as'] === 'string' && before['guard'] === undefined && lookAt?.['ref'] === 'topCards' && lookAt['count'] === 1
    && (onePlayer(lookAt['player']) || (isRec(lookAt['player']) && lookAt['player']['ref'] === 'event')) && prev['op'] === 'move' && what?.['ref'] === 'bound' && what['name'] === before['as']
    && to !== undefined && to['zone'] === 'exile' && prev['until'] === undefined && prev['guard'] === undefined;
  // std-exile-play-1-1 (CR 608.2c, 406.3): after "its controller looks at the top card of that opponent's library and exiles it face down", the "They" of "They may play
  // that card" is the player who looked (the one who may see the face-down card), named as the look names them: the idiom says so, as it does for the card. Only
  // that form (a "you may play that card" after a look of yours is read by the unique-candidate rule, as before)
  const who = isRec(e['who']) ? (e['who'] as Rec) : undefined;
  const they = isRec(who?.['$anaphor']) && (who!['$anaphor'] as Rec)['text'] === 'they';
  const lookerThey = they && looked && isRec(before!['who']) && ['controllerOf', 'ownerOf'].includes(String((before!['who'] as Rec)['ref']));
  // edh-next-73 (CR 701.23a, 701.24, 406.3, 611.2a, 400.7; Thada Adel, Acquisitor): "Search that player's library for an artifact card and exile it. Then that player shuffles. Until end of
  // turn, you may play that card.": the "that card" of a play permission that begins the sentence right after the shuffle that closes a search for exactly one card whose found card the
  // sentence before exiled is that card (the idiom says so, not a ranking of antecedents: Oracle never means another card there; render/steps-zones.ts writes it the same way)
  const unit2 = at > 1 ? seq[at - 2] : undefined;
  const move2 = unit2?.steps[unit2.steps.length - 1];
  const search2 = unit2?.steps[unit2.steps.length - 2];
  const searchedExile = !wrapped && last?.['op'] === 'shuffle' && last['guard'] === undefined && move2 !== undefined && move2['op'] === 'move' && move2['until'] === undefined && move2['guard'] === undefined
    && isRec(move2['what']) && move2['what']['ref'] === 'bound' && isRec(move2['to']) && move2['to']['zone'] === 'exile' && move2['to']['faceDown'] !== true
    && search2 !== undefined && search2['op'] === 'search' && search2['max'] === 1 && search2['guard'] === undefined && typeof search2['as'] === 'string' && move2['what']['name'] === search2['as']
    && isRec(e['who']) && e['who']['ref'] === 'you';
  if (!topCard && !milled && !lookerThey && !searchedExile) return;
  if (searchedExile) {
    u.steps[i] = { ...cur, effects: [{ ...e, of: { is: clone(move2!['what']) } }] };
    return;
  }
  if (typeof prev['as'] !== 'string') prev['as'] = freshName(d, 'impulse');
  const permit = { ...cur, effects: [{ ...e, of: { is: { ref: 'bound', name: prev['as'] } }, ...(lookerThey ? { who: clone(before!['who']) } : {}) }] };
  if (wrapped) {
    last[branchKey!] = [...(last[branchKey!] as Rec[]), permit];
    return 'folded';
  }
  u.steps[i] = permit;
}

/**
 * FAST5 T70, the impulse idiom for the flagged anaphors of the `Impulse` and `Impulses` holes (CR 611.2c, 400.7): "Exile the top two cards of your library. You
 * may play those cards this turn." / "You may exile the top card of your library. Until end of turn, you may play that card.": the "them", "those cards", "it"
 * or "that card" of a play permission that begins the sentence right after an instruction that put cards from the top of a library into exile (or milled one
 * card; the instruction may be the optional one of a `may`, and the amount of a "where X is" sentence) is exactly those cards. The idiom says so, not a ranking
 * of antecedents (Oracle never means another card there; the object itself is "~" and the trigger's spell is "that spell"), so the flagged anaphor is no mention's
 * candidate (`compatible`) and a sentence the idiom does not fit stays manual: a target moved to exile or any other antecedent is never guessed.
 * The step names what it moved (`as`) and the permission names that binding, which the effect handler fixes as the permission is created (effects/handlers/lasting-fix.ts).
 */
function lastStepOf(unit: Unit | undefined): Rec | undefined {
  let s: Rec | undefined = unit?.steps[unit.steps.length - 1];
  for (let guard = 0; s !== undefined && guard < 4; guard++) {
    if (s['lower'] === 'whereX' && Array.isArray(s['steps'])) s = (s['steps'] as Rec[])[(s['steps'] as Rec[]).length - 1];
    else break;
  }
  return s;
}

/** std-lci: the object target `id` of the ability may be several cards (its spec allows more than one). */
function severalTargets(d: Draft, id: unknown): boolean {
  const t = d.targets.find((x) => x.id === id);
  return t !== undefined && t.kind === 'object' && t.max !== 1;
}

/**
 * std-exile-play-1-2 (CR 603.7, 608.2c, 611.2c): "When that creature dies this turn, exile a number of cards from the top of your library equal to its power, then choose a
 * card exiled this way. Until the end of your next turn, you may play that card." (End-Blaze Epiphany): the choice of exactly one of the cards a move of the same
 * delayed triggered ability exiled from the top of your library is its last instruction, so "that card" of a play permission that is the whole next sentence is the
 * chosen card, and the permission is one of the delayed ability's instructions (the card exists only when it triggers, CR 603.7a; a name bound in it is not visible
 * after it, model/lint-flow.ts). Only that shape: "that card" or "it", one permission, a delay with no other branch, the choice by you from exactly the moved cards.
 */
function delayedChoiceIdiom(u: Unit, seq: Unit[], at: number, i: number): 'folded' | void {
  const cur = u.steps[i];
  if (i !== 0 || at === 0 || u.steps.length !== 1 || cur === undefined || cur['op'] !== 'effect' || !Array.isArray(cur['effects']) || cur['effects'].length !== 1) return;
  const e = cur['effects'][0];
  if (!isRec(e) || e['s'] !== 'permit' || (e['action'] !== 'play' && e['action'] !== 'cast') || !isRec(e['of']) || Object.keys(e['of']).length !== 1) return;
  const is = e['of']['is'];
  if (!isRec(is) || !isRec(is['$anaphor'])) return;
  const a = is['$anaphor'] as unknown as AnaphorInfo;
  if (a.sort !== 'object' || a.number !== 'singular' || a.participle !== undefined || !(a.text === 'it' || a.text === 'that card')) return;
  const last = seq[at - 1]?.steps[(seq[at - 1]?.steps.length ?? 0) - 1];
  if (last === undefined || last['op'] !== 'delay' || !Array.isArray(last['do']) || last['guard'] !== undefined || last['else'] !== undefined) return;
  const branch = last['do'] as Rec[];
  const [move, choice] = [branch[branch.length - 2], branch[branch.length - 1]];
  if (move === undefined || choice === undefined || choice['op'] !== 'chooseObjects' || choice['min'] !== 1 || choice['max'] !== 1 || typeof choice['as'] !== 'string') return;
  if (!isRec(choice['who']) || choice['who']['ref'] !== 'you' || choice['guard'] !== undefined) return;
  const from = isRec(choice['from']) && choice['from']['ref'] === 'each' && isRec(choice['from']['filter']) ? choice['from']['filter'] as Rec : undefined;
  const pool = isRec(from?.['is']) ? from!['is'] as Rec : undefined;
  if (from === undefined || from['zone'] !== 'exile' || Object.keys(from).length !== 2 || pool?.['ref'] !== 'bound' || typeof move['as'] !== 'string' || pool['name'] !== move['as']) return;
  const what = isRec(move['what']) ? move['what'] : undefined;
  const to = isRec(move['to']) ? move['to'] : undefined;
  if (move['op'] !== 'move' || what?.['ref'] !== 'topCards' || !isRec(what['player']) || what['player']['ref'] !== 'you' || to?.['zone'] !== 'exile' || to['faceDown'] === true
    || move['until'] !== undefined || move['guard'] !== undefined) return;
  last['do'] = [...branch, { ...cur, effects: [{ ...e, of: { is: { ref: 'bound', name: choice['as'] } } }] }];
  return 'folded';
}

function impulseFlagged(u: Unit, seq: Unit[], at: number, i: number, d: Draft): 'folded' | void {
  const cur = u.steps[i];
  if (i !== 0 || at === 0 || cur === undefined || cur['op'] !== 'effect' || !Array.isArray(cur['effects']) || cur['effects'].length !== 1) return;
  const e = cur['effects'][0];
  if (!isRec(e) || e['s'] !== 'permit' || e['action'] !== 'play' || !isRec(e['of']) || Object.keys(e['of']).length !== 1) return;
  const is = e['of']['is'];
  if (!isRec(is) || !isRec(is['$anaphor'])) return;
  const a = is['$anaphor'] as unknown as AnaphorInfo;
  if (a.impulse !== true) return;
  // std-lci (CR 106.1, 608.2c): an instruction that only adds mana names no card ("Exile any number of target cards from your graveyard. Add {R} for each card
  // exiled this way. You may play those cards this turn."), so the permission still follows the exile
  const manaOnly = (unit: Unit | undefined): boolean => unit !== undefined && unit.steps.length > 0 && unit.steps.every((s) => s['op'] === 'addMana');
  const before = at >= 2 && manaOnly(seq[at - 1]) ? at - 2 : at - 1;
  const last = lastStepOf(seq[before]);
  if (last === undefined) return;
  // "You may exile the top card of your library. Until end of turn, you may play that card.": the exile is the controller's own optional instruction, so the card
  // exists only if they did it. The permission is part of that option (a name bound in a `may` is not visible after it, model/lint-flow.ts): it joins the `do` of
  // the `may` right after the move that named the card (render/steps-flow.ts#mayImpulse writes the two sentences), and this sentence has no step of its own
  const optional = last['op'] === 'may' && Array.isArray(last['do']) && last['do'].length === 1 && isRec(last['do'][0]) && last['otherwise'] === undefined && last['as'] === undefined
    && isRec(last['who']) && last['who']['ref'] === 'you';
  // r4-dig (CR 608.2c, 611.2c, 400.7): "If you do, exile the top X cards of your library, where X is .... You may play those cards this turn." (or after any plain
  // "If C, exile ..."): the exile is the plain `then` of a condition, so the cards exist only if it held; the permission joins that branch, as the singular idiom
  // does (impulseIdiom, FAST5 T76). The branch's last instruction may be the steps of a "where X is" clause
  // r5-dig (CR 603.7): or the `do` of a delayed triggered ability ("Until end of turn, whenever ..., exile the top two cards of your library. You may play them ...")
  const branchKey = last['op'] === 'if' ? 'then' : last['op'] === 'delay' ? 'do' : undefined;
  const wrapped = !optional && branchKey !== undefined && Array.isArray(last[branchKey]) && (last[branchKey] as Rec[]).length > 0 && last['else'] === undefined && last['otherwise'] === undefined
    && last['guard'] === undefined;
  const branch = wrapped ? (last[branchKey!] as Rec[]) : undefined;
  const branchLast = branch !== undefined ? lastStepOf({ steps: [branch[branch.length - 1]!] } as unknown as Unit) : undefined;
  if (wrapped && branchLast === undefined) return;
  const prev = optional ? (last['do'] as Rec[])[0]! : branchLast ?? last;
  const to = isRec(prev['to']) ? prev['to'] : undefined;
  const what = isRec(prev['what']) ? prev['what'] : undefined;
  const plain = prev['until'] === undefined && prev['guard'] === undefined;
  const players = (p: unknown): boolean => isRec(p) && (p['ref'] === 'you' || p['ref'] === 'target' || (p['ref'] === 'each' && typeof p['who'] === 'string'));
  const topMove = prev['op'] === 'move' && what?.['ref'] === 'topCards' && players(what['player']) && to !== undefined && to['zone'] === 'exile' && to['faceDown'] !== true && plain;
  const milled = prev['op'] === 'mill' && a.number === 'singular' && prev['count'] === 1 && players(prev['who']) && plain;
  // std-lci (CR 400.7, 608.2c): "those cards" right after a move of several target cards into exile is what the move exiled (an illegal target is not moved,
  // CR 608.2b); the target spec says how many, so the singular stays with the unique-candidate rule
  const targets = prev['op'] === 'move' && what?.['ref'] === 'target' && a.number === 'plural' && to !== undefined && to['zone'] === 'exile' && to['faceDown'] !== true && plain
    && severalTargets(d, what['id']);
  // r4-dig (CR 608.2c, 611.2c, 400.7): "Exile the top two cards of your library. Choose one of them. Until end of turn, you may play that card.": "that card" right
  // after a choice of exactly one card from among the cards a move exiled from the top of a library (the sentence before the choice) is the chosen card
  const pool = isRec(prev['from']) && isRec(prev['from']['filter']) && isRec(prev['from']['filter']['is']) ? prev['from']['filter']['is'] as Rec : undefined;
  const before2 = before >= 1 ? lastStepOf(seq[before - 1]) : undefined;
  const chosen = !optional && branch === undefined && prev['op'] === 'chooseObjects' && a.number === 'singular' && prev['min'] === 1 && prev['max'] === 1 && plain
    && isRec(prev['who']) && prev['who']['ref'] === 'you' && typeof prev['as'] === 'string' && pool?.['ref'] === 'bound' && before2 !== undefined && before2['op'] === 'move'
    && before2['as'] === pool['name'] && isRec(before2['what']) && before2['what']['ref'] === 'topCards' && isRec(before2['to']) && before2['to']['zone'] === 'exile'
    && before2['to']['faceDown'] !== true && before2['until'] === undefined && before2['guard'] === undefined;
  if (chosen) {
    u.steps[i] = { ...cur, effects: [{ ...e, of: { is: { ref: 'bound', name: prev['as'] } } }] };
    return;
  }
  if (!topMove && !milled && !targets) return;
  // the number must agree with the count of cards: "that card" is one card, "those cards" more than one or an amount not known yet (CR 608.2c)
  if (topMove && (a.number === 'singular') !== (what!['count'] === 1)) return;
  if (typeof prev['as'] !== 'string') prev['as'] = freshName(d, 'impulse');
  const permit = { ...cur, effects: [{ ...e, of: { is: { ref: 'bound', name: prev['as'] } } }] };
  if (branch !== undefined) {
    last[branchKey!] = [...branch, permit];
    return 'folded';
  }
  if (!optional) {
    u.steps[i] = permit;
    return;
  }
  last['do'] = [prev, permit];
  return 'folded';
}

/**
 * M6-5 (m6 design 3.8): a cast-history condition of the ability's own object written with a pronoun inside an instruction ("sacrifice it unless it escaped",
 * CR 702.138b): `wasCast` and `kickCount` read the cast record of the ability's own object only, so the pronoun's antecedent (`$self`, resolved above with the
 * rest of the step) must be that object; then the marker goes. Any other antecedent keeps it, and the sentence stays manual (lower/util.ts#leftoverMarker).
 * The same rule as lower/ability.ts#resolveCondAnaphors for an intervening "if".
 */
export function ownCastHistory(value: unknown, castTrigger = false): unknown {
  return rewrite(value, (node) => {
    const spell = castSpellMarker(node, castTrigger);
    if (spell !== null) return spell === 'drop' ? withoutKey(node, '$spell') : undefined;
    if (!('$self' in node) || (node['cond'] !== 'wasCast' && node['cond'] !== 'compare')) return undefined;
    const { $self, ...rest } = node;
    return isRec($self) && $self['ref'] === 'self' && Object.keys($self).length === 1 ? rest : undefined;
  });
}

/**
 * FAST5 T51 (CR 601.2h): `spellManaSpent` (hole Cond / Qty, marker `$spell`) reads the mana spent on the spell of the triggering `cast` event, so the pronoun or
 * "that spell" of "the mana spent to cast that spell" must be that spell: the marker goes when it resolved to the `spell` role of a trigger whose events are all
 * casts. 'drop': remove it; 'keep': leave it (the sentence stays manual, lower/util.ts#leftoverMarker); null: this node has no such marker.
 */
export function castSpellMarker(node: Rec, castTrigger: boolean): 'drop' | 'keep' | null {
  if (!('$spell' in node)) return null;
  const s = node['$spell'];
  return castTrigger && isRec(s) && s['ref'] === 'event' && s['role'] === 'spell' && Object.keys(s).length === 2 ? 'drop' : 'keep';
}

export const withoutKey = (node: Rec, key: string): Rec => Object.fromEntries(Object.entries(node).filter(([k]) => k !== key));

/** Is every event of the trigger a cast (a spell cast, CR 601.2i)? */
export const castOnly = (on: readonly { ev: string }[] | undefined): boolean => on !== undefined && on.length > 0 && on.every((p) => p.ev === 'cast');

/**
 * FAST3 T14, the "unless" idiom (CR 118.12a): "[counter / destroy / ...] X unless its controller pays {2}": the "its" names X, the object of the one instruction
 * the payment can prevent ("counter that spell or ability unless its controller pays {2}": the spell or ability, not the object it targeted). The idiom says
 * so, not a ranking of antecedents; where X was the only candidate before, the reading is unchanged.
 */
function unlessIdiom(steps: Rec[], i: number): void {
  const cur = steps[i];
  if (cur === undefined || cur['op'] !== 'pay' || cur['then'] !== undefined || !Array.isArray(cur['else']) || cur['else'].length !== 1) return;
  const who = cur['who'];
  let inner = cur['else'][0];
  // edhd36 (CR 118.12a; Complicate): "you may counter target spell unless its controller pays {1}": the instruction the payment prevents is inside your option
  if (isRec(inner) && inner['op'] === 'may' && Array.isArray(inner['do']) && inner['do'].length === 1) inner = inner['do'][0];
  if (!isRec(who) || who['ref'] !== 'controllerOf' || !isRec(inner) || !isRec(inner['what'])) return;
  const obj = who['object'];
  if (!isRec(obj) || !isRec(obj['$anaphor'])) return;
  const a = obj['$anaphor'] as unknown as AnaphorInfo;
  if (a.sort !== 'object' || a.number !== 'singular' || a.text !== 'it' || a.head !== undefined) return;
  const what = inner['what'] as Rec;
  if (what['ref'] === 'each' || what['ref'] === 'union') return; // "its" names one object
  // edh-c-94 (CR 118.12a, 608.2h; Essence Vortex): and the "its" of the payment itself, "unless its controller pays life equal to its toughness", is that same object
  const sameIt = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(sameIt);
    if (!isRec(n)) return n;
    const an = n['$anaphor'];
    if (isRec(an) && (an as unknown as AnaphorInfo).sort === 'object' && (an as unknown as AnaphorInfo).number === 'singular' && (an as unknown as AnaphorInfo).head === undefined && ((an as unknown as AnaphorInfo).text === 'its' || (an as unknown as AnaphorInfo).text === 'it')) return clone(what);
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, sameIt(v)]));
  };
  steps[i] = { ...cur, who: { ...who, object: clone(what) }, ...(isRec(cur['cost']) ? { cost: sameIt(cur['cost']) as Rec } : {}) };
}

/**
 * FAST5 T50 (CR 603.7, 603.7c): a delayed triggered ability that waits for an event has an event of its own. Its `when` is fixed as it is created, so its
 * pronouns read the mentions of the sentence; its instructions run when it triggers, so their pronouns read the roles of ITS event ("put a +1/+1 counter on
 * it" = the creature that attacked) and what was fixed at creation (a target, a bound name, the object itself), never the roles of the event that triggered the
 * ability that created it (`{ref:'event'}` inside the delay means the delay's event, effects/handlers/lasting.ts#delay). Null when one does not resolve.
 */
function resolveEventDelay(step: Rec, mentions: readonly Mention[], u: Unit, d: Draft, inside?: Inside): Rec | null {
  const when = resolveIn(step['when'], mentions, u, d);
  if (when === null) return null;
  const event = (when as Rec)['event'] as EventPattern;
  const own = eventMentions([event], u.flags.includes('batch'), d.selfHeads);
  // "When that creature dies this turn, its controller ...": the object the event is about IS the one the `when` names (`{is: R}`), and R is a mention already (a
  // target, a bound name), so it is not a second candidate for the same object. The event's role stays: it is read as the object last was when the event happened
  // (the look-back information of the event, CR 603.10a, 608.2h), which a handle fixed as the delayed trigger was created cannot give once the object has left
  const named = [...eventObjectRefs(event)].filter(([role]) => own.some((m) => m.sort !== 'number' && isRec(m.ref) && m.ref['ref'] === 'event' && m.ref['role'] === role)).map(([, ref]) => ref);
  const outer = mentions.filter((m) => m.sort === 'number' || !(isRec(m.ref) && (m.ref['ref'] === 'event' || named.some((r) => sameJson(r, m.ref)))));
  // std-rx11 (CR 603.7c, 201.5): the event's object that IS a target of the creating ability stands for that target (Mention.forTarget)
  const targetRoles = new Set([...eventObjectRefs(event)].filter(([, ref]) => isRec(ref) && ref['ref'] === 'target').map(([role]) => role));
  // edh-c-77 (CR 603.7c, 109.5; Mage Hunters' Onslaught): the object the delayed trigger's own event is about, said by its description ("Whenever a creature blocks this turn,
  // its controller loses 1 life"), is what "its controller" names, beside a target of the creating sentence (Mention.delayOwn)
  const selfNamed = new Set([...eventObjectRefs(event)].filter(([, ref]) => isRec(ref) && ref['ref'] === 'self').map(([role]) => role)); // edh-d-61: the event's object is the ability's own object ("When ~ dies this turn, ...")
  const own2 = own.map((m) => (m.sort !== 'number' && isRec(m.ref) && m.ref['ref'] === 'event' && targetRoles.has(String(m.ref['role'])) ? { ...m, forTarget: true } : m.sort === 'object' && m.number === 'singular' && isRec(m.ref) && m.ref['ref'] === 'event' && m.implicit !== true ? { ...m, delayOwn: true, ...(selfNamed.has(String(m.ref['role'])) ? { delayOwnSelf: true } : {}) } : m));
  const body = resolveIn(step['do'], [...outer, ...own2], u, d, undefined, undefined, false, inside);
  return body === null ? null : { ...step, when, do: body };
}

/** The roles of an event whose object the pattern names by reference alone (`{is: R}`, with at most a controller test): role -> R. */
function eventObjectRefs(event: EventPattern): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const f = (event as { subject?: unknown; source?: unknown });
  const named = (v: unknown): unknown => (isRec(v) && isRec(v['is']) && Object.keys(v).every((k) => k === 'is' || k === 'controller') ? v['is'] : undefined);
  if (event.ev === 'zoneChange' && named(f.subject) !== undefined) out.set('subject', named(f.subject));
  if (event.ev === 'damage' && named(f.source) !== undefined) out.set('source', named(f.source));
  // edh-next-145 (CR 603.7c, 120.3; Arcbond): "Whenever that creature is dealt damage this turn, it deals that much damage to ...": the damaged object (role `object`) IS the creature the `when` names
  const rcp = (event as { recipient?: unknown }).recipient;
  if (event.ev === 'damage' && isRec(rcp) && Object.keys(rcp).length === 1 && named(rcp['object']) !== undefined) out.set('object', named(rcp['object']));
  // edh-d-69 (CR 603.7c, 508.1; Okoye, Mighty and Adored): "Whenever that creature attacks the monarch this turn, it gains double strike": the attacker IS the creature the `when` names (the same rule as a creature that dies)
  if (event.ev === 'attacks' && named((event as { attacker?: unknown }).attacker) !== undefined) { out.set('attacker', named((event as { attacker?: unknown }).attacker)); out.set('subject', named((event as { attacker?: unknown }).attacker)); }
  return out;
}
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const isEventDelay = (s: unknown): s is Rec => isRec(s) && s['op'] === 'delay' && isRec(s['when']) && s['when']['at'] === 'event' && Array.isArray(s['do']);
const holdsEventDelay = (step: unknown): boolean => { let found = false; visit(step, (n) => { if (isEventDelay(n)) found = true; }); return found; };

/**
 * std-combat-1 (CR 603.12, 608.2c, 400.7; Gilgamesh, Master-at-Arms): the objects a reflexive trigger "When you put one or more Equipment onto the battlefield this way,
 * ..." names (`did` with `which`, `to: 'battlefield'` and `$actor: 'you'`, parser/holes/moved.ts) are the objects the ONE earlier move of the ability put onto the
 * battlefield, a move of a choice it bound (`what: {ref:'bound'}`, the binding follows the objects into their new zone): inside the reflexive trigger's instructions a
 * bare "them" among several candidates (the cards looked at, the cards chosen) is those objects (lower/anaphora.ts#resolveIn, the r4-moved rule). Only the reflexive
 * form (never an "if"), every earlier sentence understood, exactly one such move, and its objects' mention in the pool; anything else gives none.
 */
function putThisWayMention(u: Unit, i: number, seq: readonly Unit[], at: number, prefix: readonly Unit[], pool: readonly Mention[]): Mention | null {
  const s = u.steps[i];
  const cond = isRec(s) && s['op'] === 'reflexive' ? s['when'] : undefined;
  if (!isRec(cond) || cond['cond'] !== 'did' || cond['$step'] !== 'previous' || cond['not'] === true || cond['to'] !== 'battlefield' || cond['$actor'] !== 'you' || !isRec(cond['which'])) return null;
  const moves: Rec[] = [];
  for (const x of [...prefix, ...seq.slice(0, at)]) {
    if (x.manual !== undefined) return null;
    for (const { step } of stepsInOrder(x.steps)) if (step['op'] === 'move' && isRec(step['to']) && step['to']['zone'] === 'battlefield' && step['until'] === undefined) moves.push(step);
  }
  const what = moves.length === 1 ? moves[0]!['what'] : undefined;
  if (!isRec(what) || what['ref'] !== 'bound' || typeof what['name'] !== 'string' || what['name'] === '') return null;
  const found = pool.filter((m) => m.sort === 'object' && m.number === 'plural' && sameJson(m.ref, what));
  return found.length === 1 ? found[0]! : null;
}

/**
 * p2-dig-2 (CR 701.20a, 608.2c): the card an "if" on a reveal names, "If a land card is revealed this way, put it onto the battlefield tapped." (Galadriel of Lothlórien;
 * parser/holes/cond.ts#revealedThisWayCond): the one card revealed on top of a library, named by the condition's own noun phrase, so inside the branch of that condition
 * (lower/anaphora.ts#resolveIn, the r4-moved rule) a bare pronoun among several candidates (the reveal's card, this object) is that card. Only an `if` whose condition is
 * exactly that `matches` of the participle "revealed this way", and only when the pool holds exactly one singular card revealed this way.
 */
function revealedCondMention(u: Unit, i: number, pool: readonly Mention[]): Mention | null {
  const s = u.steps[i];
  const cond = isRec(s) && s['op'] === 'if' ? s['cond'] : undefined;
  if (!isRec(cond) || cond['cond'] !== 'matches') return null;
  const is = cond['object'];
  if (!isRec(is) || !isRec(is['$anaphor']) || is['$anaphor']['participle'] !== REVEALED_THIS_WAY || is['$anaphor']['number'] !== 'singular') return null;
  const found = pool.filter((m) => m.sort === 'object' && m.number === 'singular' && (m.verbs ?? []).includes(REVEALED_THIS_WAY));
  return found.length === 1 ? found[0]! : null;
}

/**
 * edh-d-95 (CR 602.2b, 608.2c, 608.2h; Shilgengar, Sire of Famine): the creature a cost sacrificed, as an "if" on it names it, "Sacrifice another creature: Create a Blood token. If you
 * sacrificed an Angel this way, create a number of Blood tokens equal to its toughness instead.": the condition's own noun phrase ("an Angel") names the one permanent the cost sacrificed
 * (`matches` of `{ref:'costSacrificed'}`, read from last known information), so inside the branch of that condition (lower/anaphora.ts#resolveIn, the r4-moved rule) a bare pronoun among
 * several candidates (the token the sentence before made) is that creature. Only an `if` whose condition is exactly that `matches`, and only when the pool holds the cost's one sacrificed
 * permanent (lower/ability.ts#sacrificedMentions: a cost with ONE sacrifice part of one permanent): the copy is the same referent, said by a bare pronoun in the branch only.
 */
function sacrificedCondMention(u: Unit, i: number, pool: readonly Mention[]): Mention | null {
  const s = u.steps[i];
  const cond = isRec(s) && s['op'] === 'if' ? s['cond'] : undefined;
  if (!isRec(cond) || cond['cond'] !== 'matches' || !isRec(cond['object']) || Object.keys(cond['object']).length !== 1 || cond['object']['ref'] !== 'costSacrificed' || !isRec(cond['filter'])) return null;
  return sacrificedCopy(cond['filter'] as ObjectFilter, u, pool);
}

/**
 * edh-d-95: the same for the condition of an "instead" rider, still unresolved ("If you sacrificed an Angel this way, ... instead": `did` of the previous `sacrifice`, which only the
 * cost can be when no instruction of the ability before it sacrifices anything; lower/conditions.ts#resolveDid makes it the `matches` of `{ref:'costSacrificed'}`).
 */
function sacrificedRiderMention(patch: Rec, u: Unit, seq: readonly Unit[], at: number, prefix: readonly Unit[], pool: readonly Mention[]): Mention | null {
  const cond = patch['op'] === 'if' ? patch['cond'] : undefined;
  if (!isRec(cond) || cond['cond'] !== 'did' || cond['$step'] !== 'previous' || cond['$op'] !== 'sacrifice' || cond['not'] === true || !isRec(cond['which'])) return null;
  if ([...prefix, ...seq.slice(0, at)].some((x) => x.manual !== undefined || /"op":"sacrifice(Choice)?"/.test(JSON.stringify(x.steps)))) return null;
  return sacrificedCopy(cond['which'] as ObjectFilter, u, pool);
}

function sacrificedCopy(filter: ObjectFilter, u: Unit, pool: readonly Mention[]): Mention | null {
  const found = pool.filter((m) => m.sort === 'object' && m.number === 'singular' && isRec(m.ref) && Object.keys(m.ref).length === 1 && m.ref['ref'] === 'costSacrificed' && m.participleOnly === true && m.demonstrative !== true);
  if (found.length !== 1) return null;
  const { participleOnly: _p, demonstrative: _d, soleOnly: _s, ...rest } = found[0]!;
  return { ...rest, heads: [...new Set([...headsOfFilter(filter, 'battlefield'), ...found[0]!.heads])], unit: u.index };
}

function resolveUnit(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): boolean {
  // the steps are rewritten in place, in order: a name that bind() gives to an earlier step of the SAME sentence lands on the step that is kept (CR 608.2c)
  u.steps = [...u.steps];
  const said = new Map<string, Rec>(); // r4-refs: the "its controller" a template wrote in several instructions (resolveIn)
  for (let i = 0; i < u.steps.length; i++) {
    searchIdiom(u.steps, i, d);
    lookIdiom(u.steps, i, d); // LOOK1
    searchIdiomInside(u.steps[i], d); // Cloud std-fin
    flickerSelfIdiom(u.steps, i, d); // edh-d-79
    flickerSelfIdiomInside(u.steps[i], d); // edh-d-79
    unlessIdiom(u.steps, i);
    ifYouDoImpulse(u, seq, at, i, d); // r5-dig
    if (impulseIdiom(u, seq, at, i, d) === 'folded') { u.steps.splice(i, 1); i--; continue; } // FAST5 T76: the permission joined the `then` of the condition before it
    if (delayedChoiceIdiom(u, seq, at, i) === 'folded') { u.steps.splice(i, 1); i--; continue; } // std-exile-play-1-2: the permission joined the delayed ability before it
    if (impulseFlagged(u, seq, at, i, d) === 'folded') { u.steps.splice(i, 1); i--; continue; } // FAST5 T70: the permission joined the `may` before it
    const all = voteWorld(u, seq, at, flipWorld(u, seq, at, mentionsAt(d, seq, at, i, prefix))); // edh-cast-7; edh-next-130
    // edh-next-25 (design 6.4, CR 608.2c; Hidetsugu and Kairi): a sentence whose only targets are players ("Target opponent loses life equal to its mana value.") names no object an
    // object pronoun could mean, so it still goes on about the one object the instruction before it worked on (a player is never "it", the focus rule's own filter); this also skips lateFocus for such sentences ("Create a token. It deals 1 damage to target player." is the token)
    const playerTargetsOnly = (u.targetIds ?? []).every((id) => d.targets.find((t) => t.id === id)?.kind === 'player');
    const notPut = i === 0 && at > 0 && (u.targetIds?.length ?? 0) === 0 && prefix.length === 0 ? notPutContext(u, seq, at) ?? notRevealedContext(u, seq, at) : null; // LOOK3; edh-next-142: notRevealedContext
    const pool = notPutPool(notPut, costWindow(u, at, i, prefix, all) || countersHadWindow(u, seq, at, i, prefix, all) ? all : countWindow(u, at, i, prefix) || endureWindow(u, at, i, prefix) || (attachHostWindow(u, at, i, prefix) && all.some((m) => m.plainOwn === true)) || laterOwnEventWindow(u, seq, at, i, prefix) ? ownEventFallbacks(all) : withoutFallback(all));
    // FAST5 T76: the first instruction of a sentence with no target of its own (focusAt); LOOK3: the card a "you don't put the card ..." condition names; Cloud std-fin:
    // a later instruction of the sentence, the instruction right before it (focusWithin)
    // (r4-refs: with targets after every reference word, the focus decides only when ~ is no candidate besides it: "When you do, attach it to target creature you
    // control" on an Equipment that created an Equipment token stays ambiguous, std-hob's pinned case)
    const isSelf = (m: Mention | undefined): boolean => m !== undefined && isRec(m.ref) && m.ref['ref'] === 'self';
    const lateFocus = (m: Mention | undefined): Mention | undefined => (m === undefined || isSelf(m) || !pool.some((x) => isSelf(x)) ? m : undefined);
    const focus = i === 0 && at > 0 && playerTargetsOnly && prefix.length === 0 ? notPutFocus(notPut, u, pool) ?? focusAt(seq, at, pool)
      : i === 0 && at > 0 && targetsAfterReferences(u) && prefix.length === 0 ? lateFocus(notPutFocus(notPut, u, pool) ?? focusAt(seq, at, pool))
      : i > 0 && prefix.length === 0 ? focusWithin(u, i, pool) : undefined;
    // (std-r8, CR 701.20a, 608.2c, 110.1: "that card" is also the one card the instruction right before looked at or revealed on top of a library, still a card there,
    // model/focus.ts#revealsOneCard: "Reveal the top card of your library and put that card into your hand"; never after a move put it onto the battlefield)
    const seenBefore = i > 0 ? u.steps[i - 1] : stepsInOrder(seq[at - 1]?.steps ?? []).at(-1)?.step;
    const movedCard = (i === 0 && (movedCardFocus(seq[at - 1], focus) || revealedFocus(focus))) || (focus !== undefined && (looksAtOneCard(seenBefore) || revealsOneCard(seenBefore))); // LOOK2: "that card" after the move of a binding (the focus of the sentence before only); r3-dig: or the card revealed
    // Cloud std-eoe: the first instruction right after "Choose up to one target creature." (chosenFocus)
    const chosen = i === 0 && at > 0 ? chosenFocus(seq, at, pool) : undefined;
    const condObj = movedCondMention(u, i, seq, at, prefix) ?? putThisWayMention(u, i, seq, at, prefix, pool) ?? revealedCondMention(u, i, pool) ?? sacrificedCondMention(u, i, pool) ?? undefined; // r4-moved; std-combat-1; p2-dig-2; edh-d-95
    const step = resolveIn(u.steps[i], pool, u, d, undefined, focus, movedCard, (path, a, got) => [...mentionsInside(u, i, saidAt(u.steps[i], a) ?? path, pool, d), ...movedInside(u, i, path, pool, got)], chosen, condObj, said); // Cloud std-fin: mentionsInside; r3-fx: movedInside; r4-refs: said
    if (step === null) {
      // FAST5 T50: a sentence the event-delay template read but whose pronouns have no unique antecedent is a sentence that is not understood, exactly as before
      // the template existed: it is contagious only if the pronouns of its own words (`scanAnaphors`) have none either
      if (holdsEventDelay(u.steps[i]) && u.manual !== undefined) { delete u.manual.unresolved; scanUnresolved(u, withoutFallback(mentionsAt(d, seq, at, Infinity, prefix))); }
      return false;
    }
    carryNames(u.steps[i], step); // a name bind() gave to an earlier instruction of the same list (mentionsInside) lands on the rewritten step
    u.steps[i] = ownCastHistory(step, castOnly(d.trigger?.on)) as Rec;
  }
  if (u.rider) {
    // LOOK1: an "Otherwise" keeps the focus; Cloud std-eoe: it never sees what the `then` branch moved or made (otherwiseWorld)
    // (std-r8, CR 701.20a, 608.2c: the `else` follows the condition, so the card looked at or revealed right before the `if` is still a card on top of the library:
    // "that card" names it as the focus, "Otherwise, you may put that card on the bottom of your library")
    const ef = elseFocus(u, seq, at, d, prefix);
    const beforeIf = stepsInOrder(seq[at - 2]?.steps ?? []).at(-1)?.step;
    const world = otherwiseWorld(u, seq, at, withoutFallback(mentionsAt(d, seq, at, Infinity, prefix)));
    // p2-refs-2 (CR 608.2c): what the patch's own condition names is a candidate too ("If this spell was kicked, it deals 4 damage ... instead": ~)
    // edh-d-86 (CR 608.2c, 614.15-like; Anax, Hardened in the Forge): a rider that REPLACES the instruction before it ("If the creature had power 4 or greater, create two of those
    // tokens instead") is judged before that instruction is performed, so what that instruction makes (the token it would create) is never an antecedent of the rider's words
    const prevUnit = seq[at - 1];
    const replaced = u.rider.patch['@replace'] === true && prevUnit !== undefined && prevUnit.steps.length > 0 ? { unit: prevUnit.index, path: `/${prevUnit.steps.length - 1}` } : undefined;
    const pool = [...world, ...riderCondMentions(u.rider.patch, u.index, d, world)];
    let patchIn: Rec = u.rider.patch;
    if (replaced !== undefined && isRec(patchIn['cond'])) {
      const cond = resolveIn(patchIn['cond'], pool.filter((m) => !(m.origin === 'step' && m.unit === replaced.unit && (m as StepMention).path === replaced.path)), u, d);
      if (cond === null) return false;
      patchIn = { ...patchIn, cond };
    }
    // edh-d-95 (Shilgengar, Sire of Famine): the creature the cost sacrificed, which the rider's own condition names, for a bare pronoun of its branch (sacrificedRiderMention)
    const sacrificed = sacrificedRiderMention(u.rider.patch, u, seq, at, prefix, pool);
    const patch = resolveIn(patchIn, pool, u, d, undefined, ef, ef !== undefined && (looksAtOneCard(beforeIf) || revealsOneCard(beforeIf)), undefined, undefined, sacrificed ?? undefined);
    if (patch === null) return false;
    u.rider = { ...u.rider, patch: ownCastHistory(patch, castOnly(d.trigger?.on)) as Rec };
  }
  return true;
}

/**
 * p2-typechange-1: is the trigger's intervening "if" one condition about the object itself (`matches` of `self`, CR 603.4)? TREK-6: "if this Spacecraft isn't a creature" is
 * the same test denied (`not` of the `matches`), still about the object alone (Romulan Bird-of-Prey: "..., if this Spacecraft isn't a creature, put two charge counters on it.").
 */
function interveningSelf(d: Draft): boolean {
  let c: unknown = d.condition;
  while (isRec(c) && c['cond'] === 'not') c = c['of'];
  return isRec(c) && c['cond'] === 'matches' && isRec(c['object']) && c['object']['ref'] === 'self' && Object.keys(c['object']).length === 1;
}

/** edh-c-66: is the trigger's intervening "if" one condition about the enchanted or equipped object alone (`matches` of `attachedTo`, CR 603.4)? */
function interveningAttached(d: Draft): boolean {
  const c = d.condition;
  return isRec(c) && c['cond'] === 'matches' && isRec(c['object']) && c['object']['ref'] === 'attachedTo' && Object.keys(c['object']).length === 1;
}

/** The nearest earlier sentence of the sequence that kept instructions (a sentence folded into the one before it keeps none). */
function prevWithSteps(seq: readonly Unit[], at: number): Unit | undefined {
  for (let k = at - 1; k >= 0; k--) {
    const p = seq[k]!;
    if (p.manual !== undefined) return undefined;
    if (p.steps.length > 0) return p;
  }
  return undefined;
}

/**
 * r3-refs (CR 603.7, 603.7c, 608.2c): may the sentence `seq[at]` be more instructions of an event-timed delayed trigger that ends the sentence before it? Only a
 * plain sentence: no target, no rider, no condition of its own, and the delayed trigger is the last instruction of that sentence (nothing comes between them).
 */
function foldableIntoDelay(u: Unit, seq: readonly Unit[], at: number): boolean {
  if (at === 0 || u.rider !== undefined || (u.targetIds?.length ?? 0) > 0 || u.steps.length === 0) return false;
  const prev = prevWithSteps(seq, at);
  const last = prev?.steps[prev.steps.length - 1];
  return last !== undefined && isEventDelay(last) && prev!.rider === undefined && !u.steps.some((st) => holdsEventDelay(st));
}

/**
 * r3-refs (CR 603.7, 603.7c, 608.2c): "Whenever you attack this turn, create two 1/1 red Warrior creature tokens that are tapped and attacking. Sacrifice them at the
 * beginning of the next end step." / "Whenever a creature you control attacks alone this turn, put three +1/+1 counters on it. It gains trample ... until end of
 * turn." A sentence right after a delayed trigger that waits for an event, whose pronoun has no antecedent outside that trigger (the T50 rule: what the trigger's
 * instructions make and the roles of its event exist only when it triggers, lower/mentions.ts#mentionsAt), but exactly one inside it, continues the trigger's
 * instructions: they are the only reading in which the pronoun names anything. Its instructions join the trigger's `do` and resolve there, against the trigger's
 * event and what its earlier instructions made (mentionsInside), exactly as an instruction of the trigger's own sentence does; the sentence keeps no instructions.
 * A sentence that resolves outside the trigger is never folded (its reading is unchanged), and one that resolves nowhere stays manual. `steps` are the sentence's
 * instructions before the failed resolution. True when folded.
 */
function foldIntoDelay(u: Unit, steps: Rec[], seq: Unit[], at: number, d: Draft, prefix: Unit[]): boolean {
  const prev = prevWithSteps(seq, at)!;
  const k = prev.steps.length - 1;
  const delay = prev.steps[k]!;
  const candidate: Rec = { ...delay, do: [...(delay['do'] as Rec[]), ...clone(steps)] };
  const tmp: Unit = { ...prev, steps: [...prev.steps.slice(0, k), candidate] };
  const pool = withoutFallback(mentionsAt(d, seq, at, 0, prefix));
  const saved = u.manual;
  const r = resolveEventDelay(candidate, pool, u, d, (p, a, got) => [...mentionsInside(tmp, k, `/do${p}`, pool), ...movedInside(tmp, k, `/do${p}`, pool, got)]);
  if (r === null) { u.manual = saved; return false; }
  carryNames(candidate, r);
  prev.steps = [...prev.steps.slice(0, k), r];
  u.steps = [];
  u.manual = undefined;
  return true;
}

/**
 * std-rx11 (CR 603.7): is `seq[at]` only "If you do / don't, X." (an `if` on the `did` of the instruction before it, nothing else), right after a sentence whose last
 * instruction is an event-timed delayed trigger? lower/conditions.ts#absorbIntoDelay moves such a sentence into the trigger's instructions.
 */
const PUBLIC_DEST: ReadonlySet<string> = new Set(['battlefield', 'graveyard', 'exile']);

function didAfterEventDelay(u: Unit, seq: readonly Unit[], at: number): boolean {
  if (!foldableIntoDelay(u, seq, at) || u.steps.length !== 1) return false;
  const s = u.steps[0]!;
  const cond = s['cond'];
  return s['op'] === 'if' && isRec(cond) && cond['cond'] === 'did' && cond['$step'] !== undefined && cond['which'] === undefined && s['else'] === undefined && s['guard'] === undefined;
}

/**
 * std-rx11 (CR 603.7, 400.7, 608.2c): "Whenever that creature deals combat damage this turn, you may exile it. If you do, return it to the battlefield under its owner's
 * control." The "if you do" sentence is resolved as the last instruction of the delayed trigger before it (as foldIntoDelay resolves a folded sentence: the trigger's
 * event, what its earlier instructions made or moved), so "it" after the exile is the exiled card (a binding of the exile, CR 400.7), not the target the trigger was
 * created for. The sentence keeps its resolved instruction; lower/conditions.ts moves it into the trigger. False when a reference has no unique antecedent there.
 */
function resolveInDelay(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): boolean {
  const prev = prevWithSteps(seq, at)!;
  const k = prev.steps.length - 1;
  const delay = prev.steps[k]!;
  const inner = delay['do'] as Rec[];
  const candidate: Rec = { ...delay, do: [...inner, ...clone(u.steps)] };
  const tmp: Unit = { ...prev, steps: [...prev.steps.slice(0, k), candidate] };
  const pool = withoutFallback(mentionsAt(d, seq, at, 0, prefix));
  // the object of the trigger's event that one of its own instructions moved to a public zone ("you may exile it"): the sentence names the moved card (bindMoved)
  const event = (delay['when'] as Rec)['event'] as EventPattern;
  const own = eventMentions([event], u.flags.includes('batch'), d.selfHeads);
  const targetRoles = new Set([...eventObjectRefs(event)].filter(([, ref]) => isRec(ref) && ref['ref'] === 'target').map(([role]) => role)); // Mention.forTarget
  const moved: Mention[] = [];
  for (const { step, path } of stepsInOrder(inner)) {
    const what = step['what'];
    const to = step['to'];
    if (step['op'] !== 'move' || !isRec(what) || what['ref'] !== 'event' || !isRec(to) || !PUBLIC_DEST.has(String(to['zone']))) continue;
    const m = own.find((x) => x.sort !== 'number' && sameJson(x.ref, what));
    if (m !== undefined) moved.push({ ...m, movedBy: { unitRef: tmp, path: `/${k}/do${path}` }, ...(targetRoles.has(String(what['role'])) ? { forTarget: true } : {}) });
  }
  const r = resolveEventDelay(candidate, pool, u, d, (p, a, got) => [...mentionsInside(tmp, k, `/do${p}`, pool), ...movedInside(tmp, k, `/do${p}`, pool, got), ...(p.startsWith(`/${inner.length}/`) ? moved : [])]);
  if (r === null) return false;
  carryNames(candidate, r);
  const body = r['do'] as Rec[];
  // the trigger's own instructions are unchanged (a name a binding gave to one of them, `as`, is carried onto it above); the sentence keeps the resolved tail
  prev.steps = [...prev.steps.slice(0, k), { ...delay, do: body.slice(0, inner.length) }];
  u.steps = body.slice(inner.length);
  return true;
}

/**
 * Cloud std-eoe (CR 608.2c, 608.2d): "If it's suspected, exile it. Otherwise, suspect it.": the "otherwise" sentence (a rider that becomes the `else` of the
 * condition right before it, template fl.otherwise) happens only when that condition was false, so nothing its instructions did happened then: an object they
 * moved is where it was (no `movedBy`: "it" is the target again, not the exiled card), and what they made or chose is no antecedent.
 */
function otherwiseWorld(u: Unit, seq: readonly Unit[], at: number, mentions: Mention[]): Mention[] {
  const patch = u.rider?.patch;
  const prev = seq[at - 1];
  if (!isRec(patch) || patch['else'] === undefined || prev === undefined || prev.manual !== undefined) return mentions; // (the patch of "$patchPrevious")
  const k = prev.steps.length - 1;
  // edh-c-104 (CR 608.2c, 608.2d; Bogardan Phoenix): "Exile it if it had a death counter on it. Otherwise, return it ...": the sentence before is one step with the condition as its
  // `guard` (a trailing "if"), whose whole step happens only when the condition holds, as the `then` of an `if` does
  const guarded = k >= 0 && prev.steps[k]!['op'] !== 'if' && isRec(prev.steps[k]!['guard']) && isRec(patch['else']) && patch['else']['@new'] !== undefined // (only the "otherwise" rider, never an "instead" one)
    && isRec(prev.steps[k]!['what']) && prev.steps[k]!['what']['ref'] === 'event'; // (and only a move of the trigger's own object: "exile it if ...")
  if (k < 0 || (prev.steps[k]!['op'] !== 'if' && !guarded)) return mentions;
  const inThen = (path: string): boolean => (guarded ? path === `/${k}` || path.startsWith(`/${k}/`) : path === `/${k}/then` || path.startsWith(`/${k}/then/`));
  return mentions.flatMap((m): Mention[] => {
    if (m.origin === 'step' && (m as StepMention).unitRef === prev && inThen((m as StepMention).path)) return [];
    if (m.movedBy !== undefined && m.movedBy.unitRef === prev && inThen(m.movedBy.path)) {
      const { movedBy: _moved, ...rest } = m;
      return [rest as Mention];
    }
    return [m];
  });
}

/**
 * edh-cast-7 (CR 705.2, 608.2c; Krark, the Thumbless): "If you lose the flip, return that spell to its owner's hand. If you win the flip, copy that spell, ...": the two
 * results of one coin flip exclude each other (CR 705.2: a player wins or loses), so what the sentence of the other result moved or made did not happen when this one runs.
 * Like otherwiseWorld, this sentence never sees it: an object the other branch moved is where it was (no `movedBy`), and what it made or chose is no antecedent; "that spell"
 * is the trigger's spell again, not a name only the other branch binds (which would copy nothing when the flip was won).
 */
function flipWorld(u: Unit, seq: readonly Unit[], at: number, mentions: Mention[]): Mention[] {
  const resultOf = (x: Unit): boolean | undefined => {
    const s = x.steps.length === 1 ? x.steps[0] : undefined;
    const c = s !== undefined && s['op'] === 'if' ? s['cond'] : undefined;
    return isRec(c) && c['cond'] === 'flip' && typeof c['won'] === 'boolean' ? c['won'] : undefined;
  };
  const mine = resultOf(u);
  if (mine === undefined) return mentions;
  const other = new Set(seq.slice(0, at).filter((x) => x !== u && resultOf(x) === !mine));
  if (other.size === 0) return mentions;
  return mentions.flatMap((m): Mention[] => {
    if (m.origin === 'step' && other.has((m as StepMention).unitRef)) return [];
    if (m.movedBy !== undefined && other.has(m.movedBy.unitRef)) {
      const { movedBy: _moved, ...rest } = m;
      return [rest as Mention];
    }
    return [m];
  });
}

/**
 * edh-next-130 (CR 701.38a, 608.2c; Split Decision): "If denial gets more votes, counter the spell. If duplication gets more votes or the vote is tied, copy the spell.": the two results of
 * one vote exclude each other when one is "A gets more votes than B" and the other "B gets more votes [or the vote is tied]" (the choices swapped, at most one of the two comparisons
 * admitting the tie), so what the sentence of the other result moved or made did not happen when this one runs (as flipWorld): "the spell" is the target again.
 */
function voteWorld(u: Unit, seq: readonly Unit[], at: number, mentions: Mention[]): Mention[] {
  const resultOf = (x: Unit): { step: string; a: string; b: string; tie: boolean } | undefined => {
    const s = x.steps.length === 1 ? x.steps[0] : undefined;
    const c = s !== undefined && s['op'] === 'if' ? s['cond'] : undefined;
    if (!isRec(c) || c['cond'] !== 'compare' || (c['op'] !== '>' && c['op'] !== '>=')) return undefined;
    const l = c['left'];
    const r = c['right'];
    if (!isRec(l) || !isRec(r) || l['q'] !== 'votes' || r['q'] !== 'votes' || typeof l['step'] !== 'string' || l['step'] !== r['step'] || typeof l['choice'] !== 'string' || typeof r['choice'] !== 'string') return undefined;
    // (before the names are given, "the vote before" is `$vote: 'previous'` and "the other choice" `$other`)
    if (l['$vote'] !== r['$vote'] || l['choice'] === '') return undefined;
    return { step: `${l['step']}|${String(l['$vote'] ?? '')}`, a: l['choice'], b: r['$other'] === true ? '' : r['choice'], tie: c['op'] === '>=' };
  };
  const mine = resultOf(u);
  if (mine === undefined) return mentions;
  const other = new Set(seq.slice(0, at).filter((x) => {
    const o = x !== u ? resultOf(x) : undefined;
    // the choices swapped, or each against "the other" (a vote of two choices)
    return o !== undefined && o.step === mine.step && o.a !== mine.a && ((o.a === mine.b && o.b === mine.a) || (o.b === '' && mine.b === '')) && !(o.tie && mine.tie);
  }));
  if (other.size === 0) return mentions;
  return mentions.flatMap((m): Mention[] => {
    if (m.origin === 'step' && other.has((m as StepMention).unitRef)) return [];
    if (m.movedBy !== undefined && other.has(m.movedBy.unitRef)) {
      const { movedBy: _moved, ...rest } = m;
      return [rest as Mention];
    }
    return [m];
  });
}

/**
 * Anaphors inside the target specs the unit introduced ("target artifact that player controls"): targets are chosen as the ability is put on the stack
 * (CR 601.2c), so the antecedent must be known then: an event role of the trigger or a target of an earlier sentence, never a step result, never a target
 * of the same sentence. A spec that cannot be resolved is not announced and its sentence is manual (contagious: it holds a target nobody announces).
 */
function resolveSpecs(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): boolean {
  const ids = u.targetIds ?? [];
  if (!ids.some((id) => JSON.stringify(d.targets.find((t) => t.id === id) ?? null).includes('"$anaphor"'))) return true;
  const every = mentionsAt(d, seq, at, 0, prefix);
  const all = every.filter((m) => m.pos === undefined);
  const mentions = prefix.length === 0 && at === 0 ? all : withoutFallback(all); // targets are chosen before anything resolves (CR 601.2c)
  for (const [j, id] of ids.entries()) {
    const k = d.targets.findIndex((t) => t.id === id);
    if (k < 0) continue;
    // FAST3 T14: a target of the same sentence announced BEFORE this one is an antecedent too ("target player shuffles up to three target cards from their
    // graveyard into their library": the cards are chosen after the player, CR 601.2c, 115.1; rules/targets.ts#TargetEnv reads the chosen player); a later
    // one never is, and lookBack keeps a pronoun from naming a target phrase that comes after it (design 6.4)
    const earlier = new Set(ids.slice(0, j));
    const same = every.filter((m) => m.pos !== undefined && m.origin === 'target' && isRec(m.ref) && earlier.has(String((m.ref as Rec)['id'])));
    // FAST3 T18: never what the cost sacrificed: costs are paid after targets are chosen (CR 601.2c, 601.2h)
    // CLOUD C8: nor what it discarded, exiled or tapped
    // edh-c-67 (CR 115.1, 201.5, 608.2c; Steadfast Armasaur): "~ deals damage equal to its toughness to target creature blocking or blocked by it.": a pronoun in a target of a sentence that
    // names "~" before every pronoun is ~ when nothing else in the pool could be it (the object itself is known when the ability is put on the stack, CR 601.2c). Only an
    // ability of a permanent (an instant or sorcery is no creature), and only when the pool has no object candidate at all
    const firstIt = u.tokens.findIndex((t) => t.norm === 'it');
    const selfFirst = firstIt > 0 && u.tokens.slice(0, firstIt).some((t) => t.kind === 'SELF') && !u.tokens.slice(firstIt).some((t) => t.kind === 'SELF');
    const lone = selfFirst && d.selfHeads.includes('creature') && ![...mentions, ...same].some((m) => m.sort !== 'number' && m.sort !== 'player');
    const selfPool: Mention[] = lone ? [{ sort: 'object', number: 'singular', heads: ['*'], ref: { ref: 'self' }, origin: 'event', unit: u.index, namedSelf: true } as Mention] : [];
    // edh-next-134 (CR 603.12, 603.3d, 701.47c; Grishnákh, Brash Instigator): the targets of a reflexive trigger ("amass Orcs 2. When you do, gain control of target creature
    // ... with power less than or equal to the amassed Army's power") are chosen when IT is put on the stack, after the instruction it waits for resolved: what that
    // instruction produced (the Army it amassed) is known then. Only a step mention of the sentence right before, only for a unit that is one "When you do" trigger
    // (effects/handlers/lasting.ts#reflexive bakes the bound object into the target spec, bakeBound)
    // edh-next-132 (CR 603.12, 603.3d, 601.2c; Espers to Magicite): the targets of a reflexive trigger ("When you do, choose up to one target creature card exiled this way") are chosen as it is put
    // on the stack, after the instructions before it were carried out: what an earlier sentence's instruction did is known then (a step of an EARLIER unit only, never of the reflexive sentence itself)
    const reflexiveOf = u.steps.length === 1 && u.steps[0]?.['op'] === 'reflexive' ? u.index - 1 : null;
    const reflexiveUnit = u.steps.length === 1 && isRec(u.steps[0]) && (u.steps[0] as Rec)['op'] === 'reflexive';
    const knownThen = (m: Mention): boolean => m.origin === 'event' || m.origin === 'target' || (reflexiveOf !== null && m.origin === 'step' && m.unit === reflexiveOf && Array.isArray(m.verbs) && m.verbs.includes('amassed'))
      || (reflexiveUnit && m.origin === 'step' && m.unit < u.index);
    const spec = resolveIn(d.targets[k], [...mentions, ...same, ...selfPool], u, d, (m) => knownThen(m) && !COST_MOVED.has(String(m.ref['ref'])));
    if (spec === null) return false;
    d.targets[k] = spec as TargetSpec;
  }
  return true;
}

// ---------------------------------------------------------------------------
// pronouns in text no template parsed
// ---------------------------------------------------------------------------

const GENERIC_HEADS = new Set([...CARD_TYPES, 'permanent', 'card', 'spell', 'token', 'ability', 'player', 'opponent', 'source']);
const PARTICIPLES = new Set(['exiled', 'sacrificed', 'revealed', 'discarded', 'returned', 'destroyed', 'chosen', 'countered', 'milled', 'created', 'amassed', 'blighted' /* CLOUD std-ecl */, 'discovered' /* r4-mech */]);

const singularOf = (w: string): { head: string; plural: boolean } => {
  if (GENERIC_HEADS.has(w)) return { head: w, plural: false };
  if (w.endsWith('ies') && GENERIC_HEADS.has(`${w.slice(0, -3)}y`)) return { head: `${w.slice(0, -3)}y`, plural: true };
  if (w.endsWith('s') && GENERIC_HEADS.has(w.slice(0, -1))) return { head: w.slice(0, -1), plural: true };
  if (w.endsWith('es') && GENERIC_HEADS.has(w.slice(0, -2))) return { head: w.slice(0, -2), plural: true };
  return { head: w.endsWith('s') ? w.slice(0, -1) : w, plural: w.endsWith('s') };
};

/** The pronouns and demonstrative noun phrases of a sentence no template parsed (design 6.7, T2: an unresolved one makes the program manual). */
export function scanAnaphors(tokens: readonly Tok[]): AnaphorInfo[] {
  const out: AnaphorInfo[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i]!.norm;
    const next = tokens[i + 1];
    if (w === 'it' || w === "it's" || w === 'its') out.push({ sort: 'object', number: 'singular', text: w });
    else if (w === 'them') out.push({ sort: 'set', number: 'plural', text: w });
    else if (w === 'they' || w === 'their' || w === "they're" || w === 'theirs') out.push({ sort: 'any', number: 'plural', text: w });
    else if ((w === 'that' || w === 'those') && next !== undefined && next.kind === 'WORD') {
      if (next.norm === 'many' || next.norm === 'much') { out.push({ sort: 'number', number: 'singular', text: `${w} ${next.norm}` }); i++; continue; }
      const h = singularOf(next.norm);
      // a demonstrative only when the next word is a noun the rules use ("that creature", "those cards", "that Goblin"); "creatures that attacked" is a relative clause
      const noun = GENERIC_HEADS.has(h.head) || /^[A-Z]/.test(next.text);
      if (!noun) continue;
      const isPlayer = h.head === 'player' || h.head === 'opponent';
      out.push({ sort: w === 'those' ? 'set' : isPlayer ? 'player' : 'object', number: w === 'those' ? 'plural' : 'singular', head: h.head, text: `${w} ${next.norm}` });
      i++;
    } else if (w === 'the' && next !== undefined && PARTICIPLES.has(next.norm) && tokens[i + 2]?.kind === 'WORD') {
      const h = singularOf(tokens[i + 2]!.norm);
      out.push({ sort: h.plural ? 'set' : 'object', number: h.plural ? 'plural' : 'singular', head: h.head, participle: next.norm, text: `the ${next.norm} ${tokens[i + 2]!.norm}` });
      i += 2;
    }
  }
  return out;
}

const ABILITY_KINDS: ReadonlySet<string> = new Set(['spell', 'activated', 'triggered', 'static', 'keyword', 'chapter', 'classLevel', 'levelBracket', 'manual']);

/**
 * r4-static: the value with the spell filter of each cast event that says "another" left out (anaphoricOther). Wave 7 merge: also r4-fxz's "you've cast another
 * spell this turn" (a `happened` cast event inside a condition), which r4-fxz read with a copy of this function that left out only the spell's `other`.
 */
function withoutCastOther(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutCastOther);
  if (!isRec(v)) return v;
  if (v['ev'] === 'cast' && isRec(v['spell']) && v['spell']['other'] === true) { const { spell: _spell, ...rest } = v; return rest; }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutCastOther(x)]));
}

/**
 * std-combat-2 (CR 109.2, design 6.4): the value without the `other` of each existence test of a group the player controls whose filter states only subtypes the
 * source has ("if you control another Lizard" on a Lizard: `{cond:'exists', of:{ref:'each', filter:{subtypes:['Lizard'], controller:'you', other:true}}}`).
 */
function withoutKindredOther(v: unknown, selfHeads: readonly string[]): unknown {
  if (Array.isArray(v)) return v.map((x) => withoutKindredOther(x, selfHeads));
  if (!isRec(v)) return v;
  const of = isRec(v['of']) ? v['of'] : undefined;
  const f = of !== undefined && of['ref'] === 'each' && Object.keys(of).length === 2 ? of['filter'] : undefined;
  if (v['cond'] === 'exists' && of !== undefined && isRec(f) && f['other'] === true && f['controller'] === 'you' && Array.isArray(f['subtypes']) && f['subtypes'].length > 0
    && f['subtypes'].every((t) => typeof t === 'string' && selfHeads.includes(t.toLowerCase()))
    && Object.keys(f).every((k) => k === 'subtypes' || k === 'controller' || k === 'other')) {
    const { other: _other, ...rest } = f;
    return { ...v, of: { ...of, filter: rest } };
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutKindredOther(x, selfHeads)]));
}

/** Does the value hold an object filter with `other: true` ("other creatures", "each other", "all other"), outside the abilities nested in it? */
function hasOther(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasOther);
  if (!isRec(v)) return false;
  if (typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return false; // a granted ability's "other" is about the object that has it
  if (v['other'] === true) return true;
  return Object.values(v).some(hasOther);
}

/** CLOUD C4: does the value hold a template's "other" anaphor (`{ref:'bound', name:'', $anaphor:{text:'other'}}`, parser/chart.ts `$anaphor`)? */
function hasOtherAnaphor(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasOtherAnaphor);
  if (!isRec(v)) return false;
  if (isRec(v['$anaphor']) && v['$anaphor']['text'] === 'other') return true;
  return Object.values(v).some(hasOtherAnaphor);
}

/** CLOUD C4: the filters whose `not` holds a template's "other" anaphor (the groups "all other <filter>" describes), without that `not`. */
function otherAnaphorGroups(v: unknown): Rec[] {
  const out: Rec[] = [];
  visit(v, (n) => {
    if (isRec(n['not']) && hasOtherAnaphor(n['not'])) { const { not: _not, ...rest } = n; out.push(rest); }
  });
  return out;
}

/**
 * Wave 3 merge (Cloud C7 with Cloud std-eoe; CR 608.2c, 608.2h): the Filter hole reads "<cards> put into a graveyard this way" and "... into your graveyard this way"
 * twice: as std-eoe's participle anaphor (the cards an earlier destroy or sacrifice of a group put into graveyards, lower/mentions.ts; it outranks the other reading
 * in the chart, holes/filter.ts#postModAt) and as C7's count marker `$moved` (weak: a count of what ONE earlier mill or move into a graveyard moved,
 * lower/quantities.ts#movedCounts, read with the cards' last known information). In a count (`{q:'count', of:{ref:'each', filter}}`) of a unit that has no such
 * destroy or sacrifice to refer to, the count is C7's: the description gets back the marker C7's reading wrote in place of the anaphor and the zone it stated ("Mill
 * X cards. Target player loses 2 life for each creature card put into your graveyard this way.", Liliana's Indignation), so both families keep their readings.
 */
function graveyardCountsAsMoved(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): void {
  const holds = (v: unknown): boolean => JSON.stringify(v ?? null).includes(PUT_INTO_GRAVEYARD_THIS_WAY);
  if (!holds(u.steps) && !holds(u.rider?.patch)) return;
  if (mentionsAt(d, seq, at, Infinity, prefix).some((m) => m.verbs?.includes(PUT_INTO_GRAVEYARD_THIS_WAY) === true && m.viaDestroy !== true)) return; // (edh-zones-22: a destroy's targets name no group here; only a move of them reads them)
  const asMoved = (v: unknown): unknown => rewrite(v, (node) => {
    // edh-mana-keywords-7 (CR 701.8a, 608.2c; Terastodon): or the group a `forEach` goes over ("For each permanent put into a graveyard this way, its controller creates ..."),
    // which lower/quantities.ts#movedGroups binds to the ONE earlier destroy of targets (only those that went to a graveyard)
    const group = node['op'] === 'forEach' && isRec(node['over']) && node['over']['ref'] === 'each' && isRec(node['over']['filter']);
    if (!group && (node['q'] !== 'count' || !isRec(node['of']) || node['of']['ref'] !== 'each' || !isRec(node['of']['filter']))) return undefined;
    const holder = (group ? node['over'] : node['of']) as Rec;
    const f = holder['filter'] as Rec;
    const is = f['is'];
    if (!isRec(is) || !isRec(is['$anaphor']) || (is['$anaphor'] as Rec)['participle'] !== PUT_INTO_GRAVEYARD_THIS_WAY || f['zone'] !== 'graveyard') return undefined;
    const filter: Rec = {};
    for (const [k, x] of Object.entries(f)) {
      if (k === 'is') filter[MOVED_MARK] = 'graveyard';
      else if (k !== 'zone') filter[k] = x;
    }
    return group ? { ...node, over: { ...holder, filter } } : { ...node, of: { ...holder, filter } };
  });
  u.steps = asMoved(u.steps) as Rec[];
  if (u.rider) u.rider = { ...u.rider, patch: asMoved(u.rider.patch) as Rec };
}

/**
 * Cloud r3-moved (CR 602.2b, 608.2c): "{T}, Exile any number of cards from your graveyard: ... where X is the number of cards exiled this way". The Filter hole reads
 * "<cards> exiled this way" twice, as std-lci's participle anaphor (what an earlier move of the ability put into exile, `{is: <anaphor>, zone: 'exile'}`; it outranks
 * the other reading in the chart) and as C7's count marker `$moved` (weak). In a count of a unit with no such move to refer to, in an ability whose COST exiled
 * (lower/ability.ts#costGroupMentions), the count is C7's, as graveyardCountsAsMoved does for a graveyard: the description gets back the marker without the zone the
 * anaphor stated, and lower/quantities.ts#costCount counts what the cost exiled. Anything else keeps std-lci's reading.
 */
function exiledCountsOfCost(u: Unit, seq: Unit[], at: number, d: Draft, prefix: Unit[]): void {
  if (!d.mentions.some((m) => m.costPart?.kind === 'exiled')) return;
  const holds = (v: unknown): boolean => JSON.stringify(v ?? null).includes(`"participle":"${EXILED_THIS_WAY}"`);
  if (!holds(u.steps)) return;
  if (mentionsAt(d, seq, at, Infinity, prefix).some((m) => m.verbs?.includes(EXILED_THIS_WAY) === true)) return;
  u.steps = rewrite(u.steps, (node) => {
    if (node['q'] !== 'count' || !isRec(node['of']) || node['of']['ref'] !== 'each' || !isRec(node['of']['filter'])) return undefined;
    const f = node['of']['filter'] as Rec;
    const is = f['is'];
    if (!isRec(is) || !isRec(is['$anaphor']) || (is['$anaphor'] as Rec)['participle'] !== EXILED_THIS_WAY || f['zone'] !== 'exile') return undefined;
    const filter: Rec = {};
    for (const [k, x] of Object.entries(f)) {
      if (k === 'is') filter[MOVED_MARK] = 'exiled';
      else if (k !== 'zone') filter[k] = x;
    }
    return { ...node, of: { ...node['of'], filter } };
  }) as Rec[];
}

/**
 * CLOUD C4: a template's group "all other <filter>" is written `{anyOf: [<the Filter hole's value>], not: {is: <the "other" anaphor>}}` (a build cannot add a
 * field to a hole's value); one alternative and no `not` of its own is that filter with the `not` beside it, the same set (design 3.3: the fields are ANDed),
 * so the type list keeps its own words ("artifacts and creatures").
 */
function foldOtherAnaphor(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(foldOtherAnaphor);
  if (!isRec(v)) return v;
  const out: Rec = {};
  for (const [k, x] of Object.entries(v)) out[k] = foldOtherAnaphor(x);
  const any = out['anyOf'];
  const not = out['not'];
  if (Array.isArray(any) && any.length === 1 && isRec(any[0]) && !('not' in any[0]) && isRec(not) && Object.keys(out).length === 2 && hasOtherAnaphor(not)) return { ...any[0], not };
  return out;
}

/**
 * CLOUD std-msh (CR 109.2): is every "other" of the value the description in a test on ONE object the sentence refers back to ("if that creature is another
 * Hero": `{cond:'matches', object: <singular object anaphor>, filter: {..., other: true}}`), and is there at least one such test?
 */
function otherOnlyInSelfTests(v: unknown): boolean {
  let tests = 0;
  let loose = false;
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!isRec(x)) return;
    if (typeof x['kind'] === 'string' && ABILITY_KINDS.has(x['kind'])) return;
    const obj = x['object'];
    const a = isRec(obj) ? obj['$anaphor'] : undefined;
    if (x['cond'] === 'matches' && isRec(x['filter']) && x['filter']['other'] === true && isRec(a) && a['sort'] === 'object' && a['number'] === 'singular') {
      tests++;
      const { other: _other, ...rest } = x['filter'];
      walk(rest);
      return;
    }
    if (x['other'] === true) loose = true;
    Object.values(x).forEach(walk);
  };
  walk(v);
  return tests > 0 && !loose;
}

/**
 * Does the value name a group of objects (`{ref:'each', filter}`; with `withoutOther`, one whose filter is not an "other" group) or a target? r4-refs: with
 * `outsideCounts`, a group named only to be counted (inside a quantity, "where X is the number of Towns you control") does not count when it shares no card type
 * or subtype with the `others` groups ("other creatures ..., where X is the number of Towns": they can't be the group "other" leaves out; "other Rats ...,
 * where X is the number of Rats you control" stays manual).
 */
function namesObjects(v: unknown, withoutOther = false, outsideCounts = false, others: readonly Rec[] = [], kindApart = false): boolean {
  if (Array.isArray(v)) return v.some((x) => namesObjects(x, withoutOther, outsideCounts, others, kindApart));
  if (!isRec(v)) return false;
  if (typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return false;
  if (outsideCounts && typeof v['q'] === 'string' && others.length > 0 && collectFilters(v).every((f) => others.every((o) => !sharesKind(f, o) || offFieldOf(f, o)))) return false;
  // edh-next-84 (CR 109.2, 608.2c; Ashcoat of the Shadow Swarm): "Other Rats you control get +X/+X until end of turn, where X is the number of Rats you control": the Rats are COUNTED
  // (a number, the whole group of the same description with ~ in it), they are no group "other" could leave out: "other" is other than ~ (one candidate)
  if (outsideCounts && v['q'] === 'count' && others.length > 0 && collectFilters(v).length > 0 && collectFilters(v).every((f) => others.every((o) => sameGroupApartFromOther(f, o)))) return false;
  // (r4-refs: an "other" group is also one whose every alternative says "other", `{controller: 'you', anyOf: [{other: true, types: [...]}]}`, C7's "any number of other
  // creatures")
  const otherGroup = (f: Rec): boolean => f['other'] === true || (Array.isArray(f['anyOf']) && f['anyOf'].length > 0 && f['anyOf'].every((x) => isRec(x) && x['other'] === true));
  if (v['ref'] === 'each' && isRec(v['filter']) && !(withoutOther && otherGroup(v['filter']))) {
    // (Standard round P, CR 109.4, 109.2; Dread Cacodemon: "destroy all creatures your opponents control, then tap all other creatures you control"): a group whose
    // controller is never the controller of any "other" group (opponents' and yours) cannot share an object with it, so it is no candidate for that "other"
    if (others.length > 0 && others.every((o) => controllersDisjoint(v['filter'] as Rec, o))) return false;
    // (edh-next-96, CR 113.1, 112.1, 405.1; Summary Dismissal: "Exile all other spells and counter all abilities."): a group of abilities on the stack shares no object with the
    // "other" group of spells on the stack (an ability is no spell), so it is no candidate for that "other"
    if (others.length > 0 && others.every((o) => stackKindsDisjoint(v['filter'] as Rec, o))) return false;
    // (edh-next-144, CR 109.2, 400.1, 608.2c; In Search of Greatness: "you may cast a permanent spell from your hand with mana value equal to 1 plus the greatest mana value among other
    // permanents you control"): cards in a zone other than the battlefield whose own description holds every "other" group (a bound on them, read while they are still there) are
    // never among those permanents, so they are no candidate for that "other"
    const vf = v['filter'] as Rec;
    if (others.length > 0 && others.every((o) => offFieldOf(vf, o) && JSON.stringify(vf).includes(JSON.stringify(o)))) return false;
    // (edh-perms-11, CR 109.2, 608.2c, design 6.4; Ajani, the Greathearted: "Put a +1/+1 counter on each creature you control and a loyalty counter on each other planeswalker you control."):
    // every "other" group can be the source itself (a planeswalker's "each other planeswalker"), and a group of another kind (creatures) is no set that "other planeswalker" could
    // leave out: said of the kind it names, "other" is other than ~, one candidate (`kindApart`, set by the sentence check only)
    if (kindApart && others.length > 0 && others.every((o) => onlyPlaneswalkers(o) && onlyCreatureTypes(v['filter'] as Rec))) return false;
    return true;
  }
  if (v['ref'] === 'target' && !withoutOther) return true;
  return Object.values(v).some((x) => namesObjects(x, withoutOther, outsideCounts, others, kindApart));
}

/** The filters of the groups (`{ref:'each', filter}`) inside a value; with `onlyOther`, those of the "other" groups (an `anyOf` one contributes its alternatives). */
function collectFilters(v: unknown, onlyOther = false): Rec[] {
  if (Array.isArray(v)) return v.flatMap((x) => collectFilters(x, onlyOther));
  if (!isRec(v)) return [];
  const own: Rec[] = [];
  if (v['ref'] === 'each' && isRec(v['filter'])) {
    const f = v['filter'];
    const alts = Array.isArray(f['anyOf']) ? f['anyOf'].filter(isRec) : [];
    if (!onlyOther) own.push(f);
    else if (f['other'] === true) own.push(f);
    else if (alts.length > 0 && alts.every((x) => x['other'] === true)) own.push(...alts);
  }
  return [...own, ...Object.values(v).flatMap((x) => collectFilters(x, onlyOther))];
}

/** std-r8: does every "other" of the value describe objects on the battlefield (a filter with no zone, or the battlefield's)? */
function otherOnBattlefieldOnly(v: unknown): boolean {
  let some = false;
  let only = true;
  visit(v, (x) => {
    if (!isRec(x) || x['other'] !== true) return;
    some = true;
    if (x['zone'] !== undefined && x['zone'] !== 'battlefield') only = false;
  });
  return some && only;
}

/**
 * std-r8 (CR 400.1, 109.2): do the steps name objects only as groups of cards in a zone other than the battlefield (a graveyard, a hand, a library, exile), and put
 * nothing onto the battlefield? Then none of what they name is a permanent afterwards.
 */
function namesOnlyOffField(steps: unknown): boolean {
  let offOnly = true;
  visit(steps, (x) => {
    if (!isRec(x)) return;
    if (isRec(x['to']) && x['to']['zone'] === 'battlefield') offOnly = false;
    if (x['op'] === 'createToken' || x['op'] === 'copy') offOnly = false;
  });
  if (!offOnly) return false;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!isRec(v)) return v;
    if (v['ref'] === 'each' && isRec(v['filter']) && typeof v['filter']['zone'] === 'string' && v['filter']['zone'] !== 'battlefield') return { ref: 'offField' };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]));
  };
  return !namesObjects(strip(steps));
}

/** std-r8 (CR 400.1): are `f`'s objects cards in a zone other than the battlefield, and `o`'s objects permanents (no zone, or the battlefield's)? Then none is both. */
function offFieldOf(f: Rec, o: Rec): boolean {
  return typeof f['zone'] === 'string' && f['zone'] !== 'battlefield' && (o['zone'] === undefined || o['zone'] === 'battlefield');
}

/** edh-next-96 (CR 113.1): are both filters of the stack, one of spells and the other of abilities (activated, triggered or any)? No object is both a spell and an ability. */
function stackKindsDisjoint(a: Rec, b: Rec): boolean {
  if (a['zone'] !== 'stack' || b['zone'] !== 'stack') return false;
  const isAbility = (k: unknown): boolean => k === 'ability' || k === 'activatedAbility' || k === 'triggeredAbility' || k === 'finalChapterAbility';
  return (a['stackKind'] === 'spell' && isAbility(b['stackKind'])) || (b['stackKind'] === 'spell' && isAbility(a['stackKind']));
}

/** Std-rp: are two filters' controllers "you" and "opponent" (CR 109.4, 102.2: you are never your own opponent), so no object is matched by both? */
function controllersDisjoint(a: Rec, b: Rec): boolean {
  const pair = [a['controller'], b['controller']].sort().join(' ');
  return pair === 'opponent you';
}

/**
 * trek-9 (CR 109.2, 608.2c, design 6.4; Starfleet Communicator: "draw X cards, then you may put up to X land cards from your hand onto the battlefield tapped, where X is
 * the number of other creatures you control with a Communicator attached to them"): the cards an instruction takes from a zone other than the battlefield, the NUMBER of
 * which that same instruction's count bounds (`max`, `count`), are no antecedent of an "other" that is only COUNTED there. The count is known before any card is chosen,
 * so the cards are still in that zone when "other" is applied: they are never among the objects it counts, and "other" is other than ~. It holds for the whole sentence
 * only when EVERY "other" group is counted (inside a quantity, never acted on: "then tap all other creatures" is another thing) and every count is the same group
 * (the one `where X is` defines, used at each X); then the source group of such an instruction is taken out of what `namesObjects` looks at. The kind of the cards is not
 * looked at (a land card may be a creature card, a Zombie is a creature): the argument is where they are, not what they are.
 */
function withoutSizedOffFieldSources(parts: unknown): unknown {
  const groups = collectFilters(parts, true);
  if (groups.length === 0) return parts;
  const key = (f: Rec): string => JSON.stringify(f);
  const counted: Rec[] = [];
  const walkCounted = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walkCounted); return; }
    if (!isRec(v)) return;
    if (typeof v['q'] === 'string' && isRec(v['of'])) { counted.push(...collectFilters(v['of'], true)); return; }
    Object.values(v).forEach(walkCounted);
  };
  walkCounted(parts);
  if (counted.length !== groups.length || new Set(counted.map(key)).size !== 1) return parts;
  const only = key(counted[0]!);
  const isOnly = (n: unknown): boolean => {
    const fs = collectFilters(n, true);
    return fs.length > 0 && fs.every((f) => key(f) === only);
  };
  // `x`: the `{q:'X'}` of the steps in hand is the count of that group (the `whereX` node of the sentence defines it, lower/quantities.ts substitutes it at each use)
  const bounded = (n: unknown, x: boolean): boolean => isOnly(n) || (x && isRec(n) && n['q'] === 'X' && Object.keys(n).length === 1);
  const strip = (v: unknown, x: boolean): unknown => {
    if (Array.isArray(v)) return v.map((e) => strip(e, x));
    if (!isRec(v)) return v;
    const inner = v['lower'] === 'whereX' ? isOnly(v['value']) : x;
    const from = v['from'];
    const own = isRec(from) && from['ref'] === 'each' && isRec(from['filter']) && typeof from['filter']['zone'] === 'string' && from['filter']['zone'] !== 'battlefield'
      && (bounded(v['max'], x) || bounded(v['count'], x));
    return Object.fromEntries(Object.entries(v).filter(([k]) => !(own && k === 'from')).map(([k, e]) => [k, strip(e, k === 'steps' ? inner : x)]));
  };
  return strip(parts, false);
}

/** edh-perms-11: does the filter name card types and only Planeswalker (and no subtype)? */
function onlyPlaneswalkers(f: Rec): boolean {
  return Array.isArray(f['types']) && f['types'].length === 1 && f['types'][0] === 'Planeswalker' && f['subtypes'] === undefined;
}
/** edh-perms-11: does the filter name card types, none of them Planeswalker, and no subtype ("each creature you control")? */
function onlyCreatureTypes(f: Rec): boolean {
  return Array.isArray(f['types']) && f['types'].length > 0 && !f['types'].includes('Planeswalker') && f['subtypes'] === undefined;
}

/** edh-next-84: are `f` and `o` the same description, `o` being the "other" form of it (equal but for `other`)? */
function sameGroupApartFromOther(f: Rec, o: Rec): boolean {
  const { other: _a, ...fa } = f;
  const { other: _b, ...ob } = o;
  return f['other'] !== true && Array.isArray(f['types'] ?? f['subtypes']) && JSON.stringify(fa) === JSON.stringify(ob);
}

/** Could two filters' objects overlap by kind: a card type or subtype in common, or either says neither (no way to tell them apart)? */
function sharesKind(a: Rec, b: Rec): boolean {
  const kinds = (f: Rec): string[] => [...(Array.isArray(f['types']) ? f['types'] : []), ...(Array.isArray(f['subtypes']) ? f['subtypes'] : [])].map((x) => String(x).toLowerCase());
  const ka = kinds(a);
  const kb = kinds(b);
  if (ka.length === 0 || kb.length === 0) return true;
  return ka.some((k) => kb.includes(k));
}

/** Is there an "other" filter that is not inside a union with a target ("target creature and each other creature ...": the target is in the set anyway)? */
/** edh-b-14: every "other" of the parts is a group inside a union with the target `id` that shares a name with that target (and there is at least one). */
function otherSharesNameWithTarget(v: unknown, id: string, controlledByTargetsController = false): boolean {
  let seen = false;
  const walk = (x: unknown, covered: boolean): boolean => {
    if (Array.isArray(x)) return x.every((y) => walk(y, covered));
    if (!isRec(x)) return true;
    if (typeof x['kind'] === 'string' && ABILITY_KINDS.has(x['kind'])) return true;
    if (x['ref'] === 'union' && Array.isArray(x['of'])) {
      const withTarget = covered || x['of'].some((y) => isRec(y) && y['ref'] === 'target' && y['id'] === id);
      return x['of'].every((y) => walk(y, withTarget));
    }
    if (x['other'] === true) {
      seen = true;
      const sw = x['sharesWith'];
      // ("that permanent" is still an unresolved anaphor here: with one target, it names that target)
      // edh-next-42 (CR 109.2, 201.2; Deputy of Detention): or, when the one target is controlled by an opponent, a group controlled by that target's controller ("that player controls"):
      // ~ is controlled by the ability's controller, so it is never one of the opponent's permanents the group names
      if (controlledByTargetsController) {
        const c = x['controller'];
        if (!(isRec(c) && ((c['ref'] === 'controllerOf' && isRec(c['object']) && c['object']['ref'] === 'target' && c['object']['id'] === id) || isRec(c['$anaphor'])))) return false;
      }
      return covered && isRec(sw) && sw['quality'] === 'name' && isRec(sw['with']) && ((sw['with']['ref'] === 'target' && sw['with']['id'] === id) || (sw['with']['ref'] === 'bound' && isRec(sw['with']['$anaphor'])));
    }
    return Object.values(x).every((y) => walk(y, covered));
  };
  return walk(v, false) && seen;
}

function bareOther(v: unknown, covered = false): boolean {
  if (Array.isArray(v)) return v.some((x) => bareOther(x, covered));
  if (!isRec(v)) return false;
  if (typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return false;
  if (v['ref'] === 'union' && Array.isArray(v['of'])) {
    const withTarget = covered || v['of'].some((x) => isRec(x) && x['ref'] === 'target');
    return v['of'].some((x) => bareOther(x, withTarget));
  }
  if (v['other'] === true && !covered) return true;
  return Object.values(v).some((x) => bareOther(x, covered));
}

/**
 * r4-moved (CR 109.2, 608.2c, 608.2h): "When this land enters, return a land you control to its owner's hand. If another Desert was returned this way, surveil 1.": the
 * description in a "this way" condition (parser/holes/moved.ts: `did` with `which`, of the instruction right before) is of the objects that instruction moved, which are
 * never other than themselves, so its "another" is other than ~ (as it last existed) when nothing else was named before: every earlier sentence understood, with no
 * target. The condition's `which.other` is then left out of the check below; any other "other" of the sentence is checked as before.
 */
function movedOtherIsSelf(earlier: readonly Unit[]): boolean {
  return earlier.every((e) => e.manual === undefined && (e.targetIds?.length ?? 0) === 0);
}
function withoutMovedOther(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutMovedOther);
  if (!isRec(v)) return v;
  const out: Rec = {};
  for (const [k, x] of Object.entries(v)) out[k] = withoutMovedOther(x);
  if (v['cond'] === 'did' && v['$step'] === 'previous' && isRec(v['which']) && v['which']['other'] === true) {
    const { other: _o, ...which } = v['which'];
    out['which'] = which;
  }
  return out;
}

/** edh-next-51: the `other` of a `delay` step's own event subject ("whenever another creature dies"), left out; everything else in the value stays (anaphoricOther). */
function withoutDelayEventOther(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutDelayEventOther);
  if (!isRec(v)) return v;
  const out: Rec = {};
  for (const [k, x] of Object.entries(v)) out[k] = withoutDelayEventOther(x);
  if (v['op'] === 'delay' && isRec(v['when']) && v['when']['at'] === 'event' && isRec(v['when']['event']) && isRec(v['when']['event']['subject']) && v['when']['event']['subject']['other'] === true) {
    const w = v['when'] as Rec; const ev = w['event'] as Rec; const { other: _o, ...subject } = ev['subject'] as Rec;
    out['when'] = { ...w, event: { ...ev, subject } };
  }
  return out;
}

/**
 * WP22 review (INTERFACE CHANGE of this WP17 pass, design 6.4, CR 608.2c): the object hole reads "other" as "other than the source" (`other: true`). When
 * a target or a group was named before it (an earlier sentence, or one not understood, which may have; or a target or another group of the same
 * sentence), "Other creatures you control get +1/+1" may mean other than THAT, and nothing here resolves it, so the sentence is manual (unique-candidate
 * rule: two possible antecedents). A spell is never among the permanents it affects, so in a spell "other" never means "other than the source": manual too,
 * except "target X and each other X ...", where the target is in the set either way, so excluding it or not gives the same objects. The reason, or null.
 */
function anaphoricOther(u: Unit, seq: readonly Unit[], i: number, d: Draft, prefix: readonly Unit[]): string | null {
  const earlierUnits = [...prefix, ...seq.slice(0, i)];
  // edh-players-7 (CR 109.2, 115.3; Massacre Girl): "Whenever a creature dies this turn, each creature other than ~ gets -1/-1 until end of turn." names what the group
  // leaves out (the source itself, `~`), so there is no second candidate for "other" however many groups earlier sentences named: every "other" word of the sentence
  // is the phrase "other than ~" (the Filter hole reads it as `other: true`, holes/filter.ts)
  if (explicitOtherThanSelf(u)) return null;

  const parts0: unknown[] = movedOtherIsSelf(earlierUnits) ? (withoutMovedOther([u.steps, u.rider?.patch]) as unknown[]) : [u.steps, u.rider?.patch];
  // edh-next-51 (CR 109.2, 603.7, 608.2c; Electric Seaweed): the "another" of a delayed trigger's own event ("until end of turn, whenever another creature dies, this creature deals 1 damage to
  // each non-Wall creature") is other than the source of that trigger, and nothing earlier named a second candidate (no target, every earlier sentence understood): the group the effect names is not
  // an antecedent of an event's "another", so it leaves the check (any other "other" of the sentence is checked as before)
  const parts: unknown[] = (u.targetIds?.length ?? 0) === 0 && earlierUnits.every((e) => e.manual === undefined && (e.targetIds?.length ?? 0) === 0) ? (withoutDelayEventOther(parts0) as unknown[]) : parts0;
  // CLOUD C4 (CR 608.2c, 109.2): a template's own "other" marker ("If X is 5 or more, destroy all other creatures" after "destroy target creature", the anaphor `text`
  // "other") names the object an earlier sentence named; when this object could be one of the group too (a creature's "all other creatures"), "other" may mean
  // other than ~ as well (two candidates): manual. A spell, or an artifact's "all other creatures", is never in the group (targets.ts#couldBeSource)
  const heads = d.animates === true ? [...d.selfHeads, 'creature'] : d.selfHeads;
  if (otherAnaphorGroups(parts).some((f) => couldBeSource(f, heads))) return '"other" may refer to ~ as well as to what an earlier sentence named (design 6.4: two candidates); not resolved';
  if (!hasOther(parts)) return null;
  // One mechanism for "you've cast another <kind> spell this turn" (wave 7 merge of r4-fxz and r4-static; CR 601.2i, 109.2, 400.7, 707.10): the "other" of a cast
  // in the turn's history is other than this spell, the same object on the stack as when it was cast (a copy was not cast, so the original is another spell),
  // when that is the only "other" of the sentence and no target of the ability is a spell on the stack (which "another spell" could also mean):
  // - r4-static: in an instant or sorcery;
  // - r4-fxz: in any ability with no target and no earlier sentence that is not understood (lower/verify.ts refuses it where the source is not that spell:
  //   a permanent's ability; a cast trigger that functions only on the stack, Sage of the Skies, is that spell)
  const castOther = JSON.stringify(withoutCastOther(parts)) !== JSON.stringify(parts);
  if (castOther && !hasOther(withoutCastOther(parts)) && d.targets.every((t) => !isRec(t.filter) || !JSON.stringify(t.filter).includes('"stack"'))) {
    if (d.selfHeads.includes('instant') || d.selfHeads.includes('sorcery')) return null;
    if ((u.targetIds?.length ?? 0) === 0 && [...prefix, ...seq.slice(0, i)].every((e) => e.manual === undefined)) return null;
  }
  // std-combat-2 (CR 109.2, 608.2c, design 6.4): "choose target creature. If that creature's power is 2 or less or if you control another Lizard, ..." printed on a
  // Lizard: a test that you control a permanent of a subtype the source has is the kindred check "another of your kind"; read as "other than that creature", the
  // source itself would pass it, so its "another" is other than ~. Only when every "other" of the sentence is such a test (otherwise the checks below decide)
  if (!hasOther(withoutKindredOther(parts, d.selfHeads))) return null;
  // CLOUD std-msh (CR 109.2, design 6.4): "Put a +1/+1 counter on target creature. If that creature is another Hero, put two +1/+1 counters on it instead.":
  // the object a test refers back to is never other than itself, so with that one earlier target and nothing else named before or in the sentence,
  // "another" has one candidate left, this object (the unique-candidate rule holds)
  const earlier = [...prefix, ...seq.slice(0, i)];
  if (otherOnlyInSelfTests(parts) && (u.targetIds?.length ?? 0) === 0 && !namesObjects(parts)
    && earlier.every((e) => e.manual === undefined && !namesObjects(e.steps, true))
    && earlier.reduce((n, e) => n + (e.targetIds?.length ?? 0), 0) === 1) return null;
  // (std-r8, CR 109.2, 400.1: cards an earlier sentence names only in a zone other than the battlefield, with nothing put onto the battlefield, are never among the
  // permanents of an "other" group of the battlefield: "You may exile one or more creature cards from your graveyard. When you do, each other creature gets -X/-X")
  const offField = otherOnBattlefieldOnly(parts);
  // edh-next-31 (CR 109.2, 608.2c; Tori D'Avenant, Aragorn and Arwen): an earlier understood sentence that names no target and only "other" groups ("all other attacking creatures you
  // control get +1/+1 ... Other red attacking creatures you control gain trample") names nothing a second "other" could leave out: those groups are themselves "other than ~", so the
  // later sentence's "other" is the same one, other than ~
  const namesOnlyOther = (e: Unit): boolean => e.manual === undefined && (e.targetIds?.length ?? 0) === 0 && !namesObjects(e.steps, true) && collectFilters(e.steps, true).length > 0;
  const named = [...prefix, ...seq.slice(0, i)].find((e) => e.manual !== undefined || (e.targetIds?.length ?? 0) > 0 || (namesObjects(e.steps) && !namesOnlyOther(e) && !(offField && namesOnlyOffField(e.steps))));
  if (named) return `"other" may refer to what the earlier sentence "${named.text}" named, not to ~ (design 6.4: two candidates); not resolved`;
  // (r4-refs, CR 109.2: a group the sentence names only to count it, "Other creatures you control get +X/+X until end of turn, where X is the number of Towns you
  // control", is no group "other" leaves out: it says how much, not which objects; one that could share objects with the "other" group stays a candidate)
  const otherGroups = collectFilters(parts, true);
  const kindApart = otherGroups.length > 0 && otherGroups.every((f) => couldBeSource(f, heads)); // edh-perms-11: see namesObjects
  if (namesObjects(withoutSizedOffFieldSources(parts), true, true, otherGroups, kindApart)) return '"other" may refer to a group the same sentence names, not to ~ (design 6.4: two candidates); not resolved';
  const spell = d.selfHeads.includes('instant') || d.selfHeads.includes('sorcery');
  if ((u.targetIds?.length ?? 0) > 0) {
    if (spell && !bareOther(parts)) return null;
    // edh-b-14 (CR 201.2, 608.2c; Detention Sphere): "exile target nonland permanent not named ~ and all other permanents with the same name as that permanent" on a permanent: the target is
    // in the set either way, and ~ is never in it, because the one target is not named like ~ and the others share the target's name (`notName` on the target, `sharesWith` name with it)
    const tgt = d.targets.filter((t) => u.targetIds?.includes(t.id));
    if (!spell && tgt.length === 1 && isRec(tgt[0]!.filter) && typeof tgt[0]!.filter['notName'] === 'string' && otherSharesNameWithTarget(parts, tgt[0]!.id)) return null;
    if (!spell && tgt.length === 1 && isRec(tgt[0]!.filter) && tgt[0]!.filter['controller'] === 'opponent' && otherSharesNameWithTarget(parts, tgt[0]!.id, true)) return null; // edh-next-42 (Deputy of Detention)
    // (Standard round I, CR 109.2, 109.4: a target that is controlled by an opponent is never in a group of objects "you control": "When ~ enters, each other Bird you control
    // deals damage equal to its power to target creature an opponent controls", the target is no candidate for "other", which is other than ~)
    if (otherGroupsApartFromTargets(parts, d.targets.filter((t) => u.targetIds?.includes(t.id)))) return null;
    // p2-modal-1 (CR 109.2, 109.1, 102.1; unverified cites): a target that is a player is no object, so never one of a group of objects: "Put a +1/+1 counter on each other
    // creature target player controls" (Splinter & Leo) has one candidate left for "other", this object
    if (d.targets.filter((t) => u.targetIds?.includes(t.id)).every((t) => t.kind === 'player')) return null;
    return '"other" may refer to the target of the same sentence, not to ~ (design 6.4: two candidates); not resolved';
  }
  // edh-next-85 (CR 608.2c, 109.2, 405.1; Reverse the Polarity): "Counter all other spells." in an instant or sorcery: the group is spells on the stack, and the spell that is
  // resolving is itself one of them (it stays on the stack until its last step), so "other" has one candidate, other than this spell (`other: true` on the stack filter, which
  // statics/match.ts compares with the source's id). A sentence that also names a target, or an "other" of anything but spells on the stack, keeps the refusal below
  if (spell && (u.targetIds?.length ?? 0) === 0 && otherGroups.length > 0 && otherGroups.every((f) => f['zone'] === 'stack' && f['stackKind'] === 'spell')) return null;
  return spell ? '"other" in a spell refers to something the spell named, never to the spell itself (CR 608.2c); not resolved' : null;
}

/**
 * edh-next-31 (CR 109.2, 608.2c, 700.4; Chain Assassination, rulings of 2024-07-05: "If the target creature is a legal target but isn't destroyed, ... you'll still draw a card if
 * another creature died this turn"): in an instant or sorcery, the "another" of "if another creature died this turn" after a sentence with one object target is other than THAT
 * target (a spell is never among the creatures that died, so "other than the source" would say nothing). The history pattern's `other: true` becomes `not: {is: target}`
 * (rules/history.ts reads a target of the resolving ability through the environment). Only a sentence with no target of its own, every earlier sentence understood, and
 * exactly one object target before it; any other case keeps the check of `anaphoricOther` (manual in a spell).
 */
function happenedOtherIsTarget(u: Unit, seq: readonly Unit[], i: number, d: Draft, prefix: readonly Unit[]): void {
  if (!d.selfHeads.includes('instant') && !d.selfHeads.includes('sorcery')) return;
  if ((u.targetIds?.length ?? 0) > 0) return;
  const earlier = [...prefix, ...seq.slice(0, i)];
  if (earlier.some((e) => e.manual !== undefined)) return;
  const ids = earlier.flatMap((e) => e.targetIds ?? []);
  if (ids.length !== 1) return;
  const t = d.targets.find((x) => x.id === ids[0]);
  if (t === undefined || t.kind !== 'object') return;
  const fix = (v: unknown): unknown => rewrite(v, (n) => {
    const ev = n['event'];
    if (n['cond'] !== 'happened' || !isRec(ev) || ev['ev'] !== 'zoneChange' || !isRec(ev['subject']) || ev['subject']['other'] !== true) return undefined;
    const { other: _o, ...subject } = ev['subject'];
    return { ...n, event: { ...ev, subject: { ...subject, not: { is: { ref: 'target', id: t.id } } } } };
  });
  u.steps = fix(u.steps) as Rec[];
}

/** edh-players-7: every "other" / "another" word of the sentence is followed by "than ~" (the source named outright), and there is at least one. */
function explicitOtherThanSelf(u: Unit): boolean {
  let seen = false;
  for (let i = 0; i < u.tokens.length; i++) {
    const w = u.tokens[i]!.norm;
    if (w !== 'other' && w !== 'another') continue;
    if (u.tokens[i + 1]?.norm !== 'than' || u.tokens[i + 2]?.kind !== 'SELF') return false;
    seen = true;
  }
  return seen;
}

/**
 * Standard round I (CR 109.2, 109.4): every "other" group of the value is of objects the player controls ("you") and every target is of objects an opponent
 * controls (or the other way round), so no target is in any group: "other" can only be other than the source. False when there is no group or a filter is of
 * another kind (a group of unstated control, a nested ability, a target of any control).
 */
function otherGroupsApartFromTargets(parts: unknown, targets: readonly TargetSpec[]): boolean {
  const controls: unknown[] = [];
  const walk = (v: unknown, inherited: unknown): void => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, inherited)); return; }
    if (!isRec(v)) return;
    if (typeof v['kind'] === 'string' && ABILITY_KINDS.has(v['kind'])) return;
    const here = v['controller'] ?? inherited; // a group written as `{anyOf:[{...other:true}], controller:'you'}` has its control one level up
    if (v['other'] === true) { controls.push(here); return; }
    Object.values(v).forEach((x) => walk(x, here));
  };
  walk(parts, undefined);
  if (controls.length === 0 || targets.length === 0) return false;
  const control = (f: unknown): unknown => (isRec(f) && !('anyOf' in f) && !('not' in f) ? f['controller'] : undefined);
  const apart = (a: unknown, b: unknown): boolean => (a === 'you' && b === 'opponent') || (a === 'opponent' && b === 'you');
  return controls.every((c) => targets.every((t) => t.kind === 'object' && apart(c, control(t.filter))));
}

/** The pronouns of a manual sentence's own words: one without a unique antecedent among `mentions` makes the sentence contagious (design 6.7 T2). */
function scanUnresolved(u: Unit, mentions: readonly Mention[]): void {
  if (u.manual === undefined) return;
  for (const a of scanAnaphors(u.tokens)) {
    if (a.sort === 'number') continue; // "that many"/"that much" are modifier words (T2) anyway
    const r = resolveAnaphor(a, mentions);
    if (!r.ok) { u.manual = { ...u.manual, unresolved: true, reason: `${u.manual.reason}; ${unresolvedReason(a, r)}` }; break; }
  }
}

/** Pass 3. Sentences are processed in text order; a modal bullet sees the units before the bullets (the header) and the earlier sentences of its own bullet. */
export function lowerAnaphora(input: Draft): Draft {
  const d = cloneDraft(input);
  for (const u of sequences(d).flat()) for (const n of namesIn(u.steps)) if (!d.names.includes(n)) d.names.push(n);
  rebaseMovedSelf(d); // "~" after the trigger moved the source (CR 400.7e-f; WP21 review)
  // edh-players-10 (CR 608.2c; Sylvan Offering): "Choose an opponent. ... Choose an opponent. ...": the second choice is a binding of its own (no two steps share a name); the
  // mention it gives (Mention.rebinds) is the only one left for "that player" after it
  const chosenSeen = new Set<string>();
  for (const u of sequences(d).flat()) {
    for (const st of u.steps) {
      const name = st['as'];
      if (st['op'] !== 'chooseValue' || (st['what'] !== 'opponent' && st['what'] !== 'player') || typeof name !== 'string') continue;
      if (chosenSeen.has(name)) st['as'] = freshName(d, name);
      chosenSeen.add(name);
    }
  }
  sequences(d).forEach((seq, si) => {
    const prefix = si === 0 ? [] : d.units;
    const all = seq;
    all.forEach((u, k) => {
      // p2-c-dieroll-1 (CR 706.3a): only one row of a die-roll table happens, so a row's pronouns read the sentences before the table and its own row's, never
      // another row's (Unit.row; lower/die-roll.ts)
      const seq = u.row === undefined ? all : all.filter((x) => x.row === undefined || x.row.index === u.row!.index);
      const i = u.row === undefined ? k : seq.indexOf(u);
      if (u.manual) {
        // a manual sentence: its pronouns must still have exactly one antecedent, or it is contagious
        if (u.manual.unresolved) return;
        // PUSH1 T2 review: what a sentence that is not understood did before its pronoun is unknown, so the cost object is never its fallback (design 6.4)
        scanUnresolved(u, withoutFallback(mentionsAt(d, seq, i, Infinity, prefix)));
        return;
      }
      happenedOtherIsTarget(u, seq, i, d, prefix); // edh-next-31
      const other = anaphoricOther(u, seq, i, d, prefix);
      if (other !== null) {
        setManual(u, { code: 'unbound-reference', reason: other });
        return;
      }
      u.steps = foldOtherAnaphor(u.steps) as Rec[];
      graveyardCountsAsMoved(u, seq, i, d, prefix); // wave 3 merge: C7's count of "<cards> put into a graveyard this way" where std-eoe's reference has no antecedent
      exiledCountsOfCost(u, seq, i, d, prefix); // Cloud r3-moved: C7's count of "cards exiled this way" where std-lci's reference has none and the cost exiled
      if (!resolveSpecs(u, seq, i, d, prefix)) {
        const info = u.manual!;
        u.manual = undefined;
        setManual(u, info);
        delete u.targetIds; // a spec that still names an unknown antecedent cannot be announced
        delete u.targetPos;
        return;
      }
      // std-rx11 (CR 603.7, 400.7): "If you do, X." right after an event-timed delayed trigger becomes more of its instructions (lower/conditions.ts#absorbIntoDelay):
      // its pronouns are read there, against the trigger's event and what its instructions moved, never against the sentences outside it
      if (didAfterEventDelay(u, seq, i)) {
        if (!resolveInDelay(u, seq, i, d, prefix)) setManual(u, { code: 'unbound-reference', reason: '"if you do" after a delayed trigger: a reference with no unique antecedent inside it (CR 603.7, 608.2c)', unresolved: true });
        return;
      }
      const before = foldableIntoDelay(u, seq, i) ? { steps: clone(u.steps), names: [...d.names] } : null;
      if (!resolveUnit(u, seq, i, d, prefix)) {
        const info = u.manual!;
        u.manual = undefined;
        // r3-refs: a sentence whose pronoun names only what the delayed trigger right before it made or was triggered by is more of that trigger's instructions
        if (before !== null && info.unresolved === true && foldIntoDelay(u, before.steps, seq, i, d, prefix)) return;
        setManual(u, info);
      }
      // STD-OTJ (CR 601.2c, 608.2c): once "their" is resolved to the target, an amount that reads each of several player targets is one amount per player (lower/targets.ts)
      else if (u.manual === undefined && (u.targetIds?.length ?? 0) > 0) {
        perPlayerAmounts(u, d.targets.filter((s) => u.targetIds!.includes(s.id)), d); // Cloud std-eoe: one player at a time, where it can be said so
        const several = severalPlayersAmount(u, d.targets.filter((s) => u.targetIds!.includes(s.id)));
        if (several !== null) { setManual(u, { code: 'ambiguous', reason: several }); delete u.targetIds; delete u.targetPos; }
      }
    });
  });
  movedSourceExcluded(d); // r5-dig
  eachOtherThanNamed(d); // edh-next-134
  return d;
}

/**
 * r5-dig (CR 400.7, 608.2h, 109.2): "Put target creature card from a graveyard onto the battlefield under your control. That creature deals damage equal to its
 * power to each other creature." A target handle is never re-based after a move (effects/refs.ts#rebase), so "each other creature" written as "not the target"
 * (eff.r5dig.damage.equal.eachOtherCreature) would not leave out the permanent the card became, and it would be dealt damage too.
 * edh-d-98 (CR 400.7, 608.2c, 608.2h; Too Greedily, Too Deep, ruling 2023-06-16): such a damage step is rewritten to name what the move put onto the battlefield: the move
 * binds the new permanent (`as`, effects/handlers/zones-util.ts#bindMoved: only what entered the battlefield), and the damage step's source, its amount's object and its
 * excluded object are that bound object (a card that did not enter deals no damage). Only a move of that one target to the battlefield, in an earlier sentence of the same
 * sequence, the damage step being its sentence's only step; any other shape stays not understood (fail closed).
 */
function movedSourceExcluded(d: Draft): void {
  for (const seq of sequences(d)) {
    const moved = new Map<string, Record<string, unknown>>();
    for (const u of seq) {
      if (u.manual) continue;
      let bad = false;
      const walk = (list: unknown): void => {
        if (!Array.isArray(list)) return;
        for (const st of list) {
          if (!isRec(st)) continue;
          const what = st['what'];
          if (st['op'] === 'move' && isRec(what) && what['ref'] === 'target' && typeof what['id'] === 'string') moved.set(what['id'], st);
          const src = st['source'];
          const to = st['to'];
          const not = isRec(to) && to['ref'] === 'each' && isRec(to['filter']) && isRec(to['filter']['not']) ? to['filter']['not']['is'] : undefined;
          if (st['op'] === 'damage' && isRec(src) && src['ref'] === 'target' && typeof src['id'] === 'string' && moved.has(src['id']) && JSON.stringify(not) === JSON.stringify(src)) {
            const mv = moved.get(src['id'])!;
            const dest = mv['to'];
            const one = Array.isArray(u.steps) && u.steps.length === 1 && u.steps[0] === st;
            if (one && isRec(dest) && dest['zone'] === 'battlefield' && (mv['as'] === undefined || typeof mv['as'] === 'string')) {
              const name = typeof mv['as'] === 'string' ? mv['as'] : `entered_${src['id']}`;
              mv['as'] = name;
              const key = JSON.stringify(src);
              const swapped = JSON.parse(JSON.stringify(st, (_k, v: unknown) => (isRec(v) && JSON.stringify(v) === key ? { ref: 'bound', name } : v))) as Record<string, unknown>;
              for (const k of Object.keys(st)) delete st[k];
              Object.assign(st, swapped);
            } else bad = true;
          }
          for (const k of ['then', 'else', 'do', 'otherwise']) walk(st[k]);
        }
      };
      walk(u.steps);
      if (bad) setManual(u, { code: 'unbound-reference', reason: '"each other" leaves out a target an earlier instruction moved: the target handle still names the object it was, not the permanent it became (CR 400.7)' });
    }
  }
}
