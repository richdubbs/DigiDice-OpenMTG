/**
 * The noun-phrase grammar (design 6.3) and the hole `Filter` (ObjectFilter). Owner: WP6.
 *
 *   NounPhrase ::= PreMod* Head PostMod*
 *   PreMod     ::= color list | "non" X | status (tapped, attacking, ...) | supertype | "another" | "other" | ...
 *   Head       ::= TypeRun [card|spell|token|permanent] | card | spell | token | permanent | ability
 *   PostMod    ::= "you control" | "an opponent controls" | PlayerNP "controls" | "with" Feature | "without" Feature | "named" NAME | "in"|"from"|"on" Zone
 *                | "of the chosen" X | "that" RelClause | "other than ~"
 *
 * Every function returns ALL parses (each prefix of the post-modifier chain is a parse of its own, so `{f:Filter} you control` and `{f:Filter}` both work).
 * An unknown adjective fails the phrase: nothing is skipped (G2). Post-modifiers distribute over a coordinated head ("artifact or creature you control"
 * is one filter) because that is the way Oracle text is written when the modifier is meant for both; the reading that attaches it to the last head only
 * is not produced.
 */
import type { NumberCmp, ObjectFilter, ObjRef, PlayerPred, Quantity, ZoneName } from '../../types/ability';
import type { Alt, HoleCtx, HoleFn } from './core';
import { attachedWithAt } from './trek9'; // trek-9
import { P, anaphorObj, anyPhraseAt, cmpAt, dedupe, mergeFilter, multiAt, normAt, numberAt, phraseAt, predOf } from './core';
import type { PlayerRef } from '../../types/ability';
import { MOVED_MARK, movedFragAt } from './moved-words';

export type HeadKind = 'type' | 'permanent' | 'card' | 'spell' | 'token' | 'ability' | 'stackObject' | 'mods'
  /** p2-replace-damage-2 (CR 120.3, 609.7): "source", the object a damage comes from, any object (a permanent, a spell, a card): a weak head (design 6.3 rule 2). */
  | 'source';

export interface NpAlt {
  end: number;
  filter: ObjectFilter;
  number: 'singular' | 'plural';
  head: HeadKind;
  weak: number;
  flags: string[];
}

export interface NpOptions {
  /** Accept modifiers only ("tapped", "red"): the predicate of "it's tapped". */
  bare?: boolean;
  /** FAST5 T42: also read "with different names" (a flag only a target phrase takes, parser/holes/object.ts); CLOUD std-ecl: and "that share a creature type". */
  differentNames?: boolean;
  /** FAST5 T59: the noun phrase without post-modifiers and without a coordination (the halves of "land creature or nonbasic land"). */
  preOnly?: boolean;
}

// ---------------------------------------------------------------------------
// pre-modifiers
// ---------------------------------------------------------------------------

const STATUS: Record<string, ObjectFilter> = {
  tapped: { tapped: true }, untapped: { tapped: false }, attacking: { attacking: true }, blocking: { blocking: true }, blocked: { blocked: true },
  unblocked: { blocked: false }, 'face-down': { faceDown: true }, 'face-up': { faceDown: false }, transformed: { transformed: true },
  multicolored: { multicolored: true }, monocolored: { monocolored: true }, colorless: { colorless: true }, activated: { stackKind: 'activatedAbility' },
  triggered: { stackKind: 'triggeredAbility' },
  loyalty: { stackKind: 'activatedAbility', loyaltyAbility: true }, // edhd36 (CR 606.2): "target loyalty ability"
  // M6-6 (CR 722.3a, 719.3b): the designations "prepared" ("if this creature isn't prepared") and "solved" ("as long as this Case is solved")
  prepared: { prepared: true }, solved: { solved: true },
  // FAST4 T33 (CR 700.9): "modified creatures you control" (counters, equipped, or enchanted by an Aura its controller controls)
  modified: { modified: true },
  // FAST5X E3 (CR 702.171b): "if this creature is saddled", "a saddled creature"
  saddled: { saddled: true },
  // std-rx31 (CR 712.1, 712.4): "If it's a double-faced card, you may transform it" (Nick Fury, Agent of S.H.I.E.L.D.)
  'double-faced': { doubleFaced: true },
  // FAST5X E12 (CR 701.60b): "target suspected creature", "if it's suspected"
  suspected: { suspected: true },
  // std-rx34 (CR 701.37b): "as long as ~ is monstrous" (the designation monstrosity gives)
  monstrous: { monstrous: true },
  // M12-3 (CR 701.15b): "whenever a goaded creature attacks"
  goaded: { goaded: true },
  // std-ry8 (CR 702.112b): "as long as ~ is renowned", "if it's renowned"
  renowned: { renowned: true },
  // std-costs-2 (CR 702.185a): "a warped creature card you own in exile" (a card warp's delayed triggered ability exiled)
  warped: { warped: true },
};
for (const w of Object.keys(STATUS)) P(w);
const NOT_LEGENDARY: ObjectFilter = { notSupertypes: ['Legendary'] }; // edh-zones-3
const NOT_HISTORIC: ObjectFilter = { notTypes: ['Artifact'], notSupertypes: ['Legendary'], notSubtypes: ['Saga'] }; // edh-zones-3
const HISTORIC: ObjectFilter = { anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] };
P('historic'); P('kicked'); P('attacking or blocking'); P('another'); P('other'); P('non');
/** FAST5X E1, CR 700.12: "outlaw" is the word for an object with the Assassin, Mercenary, Pirate, Rogue and/or Warlock creature types. */
export const OUTLAW_SUBTYPES: readonly string[] = ['Assassin', 'Mercenary', 'Pirate', 'Rogue', 'Warlock'];
P('outlaw');
const W_ATTACKING_EQUIPPED = P('attacking equipped'); // FAST4 T33
const W_EQUIPPED_ATTACKING = P('equipped attacking'); // std-hob
const W_ACTIVATED_OR_TRIGGERED = P('activated or triggered'); // FAST5 T45
const W_EACH_HAVE_TGP = P('each have toughness greater than their power'); // edh-next-76
const W_THATS = P("that's"); // FAST5 T57
const W_THAT_ARE_COLORS = P('that are'); // edh-c-45
const W_ISNT = [P("isn't"), P('is not')]; // edh-perms-7
const W_MIN_CARD_TYPES: readonly [readonly string[], number][] = [[P('with two or more card types'), 2], [P('with three or more card types'), 3], [P('with four or more card types'), 4]]; // edh-d-86
const W_NOT_ALL_COLORS = [P("that isn't all colors"), P("that aren't all colors"), P('that is not all colors'), P('that are not all colors')]; // edh-d-51
const W_ONE_OR_MORE_COLORS = P('one or more colors'); // CLOUD std-misc
const W_ARE_ONE_OR_MORE_COLORS = P('are one or more colors'); // edh-players-2
const W_OTHER_THAN_ATTACHED = [P('other than enchanted creature'), P('other than equipped creature')]; // FAST4 T33
const W_ATTACHED_TO = P('attached to'); // CLOUD std-msh
const W_THATS_ATTACHED_TO = [P("that's attached to"), P('that is attached to'), P('that are attached to')]; // edh-perms-2 (Sage's Reverie)
const W_BLOCKING = P('blocking'); // p2-combat-flow-1
/** edh-d-24 (CR 303.4a, 702.5a; Sovereigns of Lost Alara, Auratouched Mage): "an Aura card that could enchant it". */
const W_COULD_ENCHANT = [P('that could enchant')];
const W_THATS_BLOCKING = [P("that's blocking"), P('that is blocking')]; // edh-d-12
const W_BLOCKED_BY = P('blocked by'); // p2-combat-flow-1
const W_SELF_BLOCKING = [P('~ is blocking'), P('that ~ is blocking')]; // edh-c-34 (Wall of Corpses): "target creature this creature is blocking", the object itself
const W_IT_BLOCKING = [P("it's blocking"), P("that it's blocking"), P('it is blocking'), P('that it is blocking')]; // edh-top-3
const W_BLOCKING_OR_BLOCKED_BY = [P('blocking or blocked by'), P('blocking or being blocked by')]; // p2-combat-flow-1
const W_THATS_ATTACKING_OR_BLOCKING = [P("that's attacking or blocking"), P('that is attacking or blocking'), P('that are attacking or blocking')]; // edh-c-69
const W_ATTACKING_ALONE = [P("that's attacking alone"), P('that is attacking alone')]; // CLOUD std-msh (CR 506.5)
// p2-combat-flow-1 (CR 506.3, 508.1b): "target creature without flying that's attacking you" (Hunting Kavu): attacking you, the player (never a planeswalker you control)
const W_ATTACKING_YOU = [P("that's attacking you"), P('that is attacking you'), P('that are attacking you'), P('attacking you')];
// edh-next-23 (CR 303.4, 508.1b, 506.3; Curse of Hospitality): "creatures attacking enchanted player": attacking the player the source Aura is attached to (never a planeswalker they control)
const W_ATTACKING_ENCHANTED = [P("that's attacking enchanted player"), P('that is attacking enchanted player'), P('that are attacking enchanted player'), P('attacking enchanted player')];
const W_ATTACKING_YOU_OR_WALKER = [P("that's attacking you or a planeswalker you control"), P('that is attacking you or a planeswalker you control'), P('that are attacking you or a planeswalker you control'), P('attacking you or a planeswalker you control')]; // pc-combat-3
// edh-players-12 (CR 506.3, 508.1b; Within Range): "creatures attacking them / that player": attacking the player a group's step is read for (a pronoun, parser/lower/anaphora.ts#groupChooser)
const W_ATTACKING_THEM: [ReturnType<typeof P>, string][] = [
  [P('attacking them'), 'them'], [P("that's attacking them"), 'them'], [P('that is attacking them'), 'them'], [P('that are attacking them'), 'them'],
  [P('attacking that player'), 'that player'], [P("that's attacking that player"), 'that player'], [P('that is attacking that player'), 'that player'], [P('that are attacking that player'), 'that player'],
];
// edh-next-84 (CR 506.3, 508.1b, 508.5; Roar of Resistance): "creatures attacking your opponents and/or planeswalkers they control": a player who is an opponent or a planeswalker such a player controls
const W_ATTACKING_OPPONENT_OR_WALKER = [P('attacking your opponents and/or planeswalkers they control'), P('that are attacking your opponents and/or planeswalkers they control')];
const W_ATTACKING_OPPONENT = [P("that's attacking one of your opponents"), P('that is attacking one of your opponents'), P('that are attacking one of your opponents'), P('attacking your opponents'), P('attacking one of your opponents') /* edh-combat-7 (CR 508.1b; Blast-Furnace Hellkite, ruling 2022-10-14: whoever controls the creature) */]; // r4-static

/**
 * CLOUD std-msh (CR 301.5, 303.4): the one object "attached to <it>" may name in a description: this object, an object the sentence refers back to (an
 * anaphor, resolved by parser/lower/anaphora.ts) or the object the source is attached to ("enchanted creature"); never a target (a description is not
 * announced) nor a group.
 */
export function isAttachHost(v: unknown): v is ObjRef {
  if (v === null || typeof v !== 'object') return false;
  const r = v as { ref?: unknown; $anaphor?: { sort?: unknown; number?: unknown } };
  if (r.ref === 'self' || r.ref === 'attachedTo') return true;
  return r.ref === 'bound' && r.$anaphor !== undefined && r.$anaphor.sort === 'object' && r.$anaphor.number === 'singular';
}
/** std-ry5 (CR 303.4, 301.5): a description an Aura or Equipment may be "attached to a <it>": one card type of permanent, at most with its controller. */
function isAttachHostKind(f: ObjectFilter): boolean {
  const keys = Object.keys(f);
  if (!keys.every((k) => k === 'types' || k === 'controller')) return false;
  if (f.controller !== undefined && f.controller !== 'you' && f.controller !== 'opponent') return false;
  return f.types?.length === 1 && ['Creature', 'Land', 'Artifact', 'Enchantment', 'Planeswalker'].includes(f.types[0]!);
}
/** M11-4: the commander designation as an adjective or a noun (CR 903.3, 903.3d); "your commander" is a commander you own (CR 903.3e). */
const W_COMMANDER = P('commander');
const W_COMMANDERS = P('commanders');

/** "nonblack", "non-Human", "nonland": the excluded thing, by the vocabulary. */
function negated(ctx: HoleCtx, word: string): ObjectFilter | null {
  let rest: string;
  if (word.startsWith('non-')) rest = word.slice(4);
  else if (word.startsWith('non') && word.length > 3) rest = word.slice(3);
  else return null;
  const c = ctx.vocab.colors.get(rest);
  if (c !== undefined) return { notColors: [c] };
  const ty = ctx.vocab.types.get(rest);
  if (ty !== undefined && !ty.plural) return { notTypes: [ty.name] };
  const su = ctx.vocab.supertypes.get(rest);
  if (su !== undefined) return { notSupertypes: [su.name] };
  if (rest === 'token') return { token: false };
  if (rest === 'commander') return { commander: false }; // M11-4: "target noncommander creature" (CR 903.3: not a commander)
  if (rest === 'outlaw') return { notSubtypes: [...OUTLAW_SUBTYPES] }; // FAST5X E1, CR 700.12
  if (rest === 'attacking') return { attacking: false }; // CLOUD std-msh (CR 506.4): "another target nonattacking creature you control" (render/np.ts says it back)
  if (rest === 'blocking') return { blocking: false }; // CLOUD std-msh (CR 506.4): "nonblocking", the same for a blocking creature
  const st = ctx.vocab.subtypes.get(rest);
  if (st !== undefined && !st.plural) return { notSubtypes: [st.name] };
  return null;
}

const KW_LIST_CLOSERS = [P('and/or'), P(', or'), P(', and/or')]; // edh-b-2
const COLOR_SEPS = [P('or'), P(', or'), P(','), P('and/or'), P(', and/or')]; // edh-replace-2: "and/or" is "or" (CR 105.2)

function colorMod(ctx: HoleCtx, pos: number): { end: number; frag: ObjectFilter }[] {
  const out: { end: number; frag: ObjectFilter }[] = [];
  const walk = (p: number, acc: string[]): void => {
    const t = ctx.toks[p];
    const c = t !== undefined && t.kind === 'WORD' ? ctx.vocab.colors.get(t.norm) : undefined;
    if (c === undefined || acc.includes(c)) return;
    const next = [...acc, c];
    out.push({ end: p + 1, frag: { colors: next as never } });
    for (const sep of COLOR_SEPS) { const e = phraseAt(ctx, p + 1, sep); if (e >= 0) walk(e, next); }
    // edh-next-47 (CR 105.2, 205.2a; Soldevi Adnate): "a black or artifact creature": the colors, then "or" and a card type that another card type follows (the noun): an object of
    // the noun that is one of the colors or has the type (`anyOf`, each option beside the noun's own `types`, design 3.3)
    for (const sep of [P('or')]) {
      const e = phraseAt(ctx, p + 1, sep);
      const ty = e >= 0 && ctx.toks[e]?.kind === 'WORD' ? ctx.vocab.types.get(ctx.toks[e]!.norm) : undefined;
      const noun = e >= 0 && ctx.toks[e + 1]?.kind === 'WORD' ? ctx.vocab.types.get(ctx.toks[e + 1]!.norm) : undefined;
      if (ty !== undefined && !ty.plural && noun !== undefined && !noun.plural && ty.name !== noun.name) out.push({ end: e + 1, frag: { anyOf: [{ colors: next as never }, { types: [ty.name] }] } });
    }
  };
  walk(pos, []);
  return out;
}

/** std-blb: the tapped and combat statuses a list of alternatives may join ("target attacking, blocking, or tapped creature"). */
const LISTED_STATUS: readonly string[] = ['attacking', 'blocking', 'tapped', 'untapped', 'blocked', 'unblocked'];
const STATUS_CLASH: readonly (readonly string[])[] = [['tapped', 'untapped'], ['blocked', 'unblocked']];
const STATUS_LIST_SEPS = [P('or'), P(', or'), P(',')];
const W_OR = P('or');
const W_AND_OR_F134 = P('and/or'); // edh-next-134

/**
 * std-blb (CR 506.4, 508.1k, 509.1g, 110.5): "attacking or tapped creature", "attacking, blocking, or tapped creature": a status that any of two or three listed
 * statuses meets (an `anyOf`, each alternative ANDed with the rest of the description, design 3.3). Only the statuses of LISTED_STATUS, each once, never a
 * contradictory pair, and the list closed by "or" ("A, B, or C"; "A or B"); "attacking or blocking" stays the reading above (one reading, not two).
 */
function statusList(ctx: HoleCtx, pos: number): { end: number; frag: ObjectFilter }[] {
  const out: { end: number; frag: ObjectFilter }[] = [];
  const walk = (p: number, acc: string[], closed: boolean): void => {
    const t = ctx.toks[p];
    const w = t !== undefined && t.kind === 'WORD' ? t.norm : undefined;
    if (w === undefined || !LISTED_STATUS.includes(w) || acc.includes(w)) return;
    const next = [...acc, w];
    if (STATUS_CLASH.some(([a, b]) => next.includes(a!) && next.includes(b!))) return;
    if (closed) {
      if (next.length >= 2 && next.join() !== 'attacking,blocking') out.push({ end: p + 1, frag: { anyOf: next.map((s) => ({ ...STATUS[s]! })) } });
      return;
    }
    if (next.length >= 3) return;
    for (const sep of STATUS_LIST_SEPS) {
      const e = phraseAt(ctx, p + 1, sep);
      // "A, B, or C": a bare comma only between the first items of a list of three; the last item always comes after "or"
      if (e >= 0) walk(e, next, sep.includes(W_OR[0]!) && (sep.length === 2 ? next.length >= 2 : true));
    }
  };
  walk(pos, [], false);
  return out;
}

/** One pre-modifier at `pos`: all readings (end and the filter fragment it contributes). */
function modAt(ctx: HoleCtx, pos: number): { end: number; frag: ObjectFilter }[] {
  const out: { end: number; frag: ObjectFilter }[] = [];
  const t = ctx.toks[pos];
  // edh-next-7 (CR 208.1, 202.3; The Seedcore): "target 1/1 creature" is a creature whose power and toughness are those numbers (digits only: "X/X" and "*/*" stay manual)
  const pt = t !== undefined && t.kind === 'PT' ? /^(\d+)\/(\d+)$/.exec(t.norm) : null;
  if (pt !== null) {
    out.push({ end: pos + 1, frag: { power: { op: '==', value: Number(pt[1]) }, toughness: { op: '==', value: Number(pt[2]) } } });
    return out;
  }
  if (t === undefined || t.kind !== 'WORD') return out;
  const w = t.norm;
  if (w === 'colorless' || w === 'multicolored' || w === 'monocolored') out.push({ end: pos + 1, frag: STATUS[w]! });
  else {
    out.push(...colorMod(ctx, pos));
    const s = STATUS[w];
    if (s !== undefined && w !== 'colorless') out.push({ end: pos + 1, frag: s });
  }
  // edh-next-134 (CR 701.15b, 701.60b; Hot Pursuit): "all goaded and/or suspected creatures": a creature that is goaded, suspected or both (the two designations, either one)
  if (w === 'goaded' || w === 'suspected') {
    const other = w === 'goaded' ? 'suspected' : 'goaded';
    const e = phraseAt(ctx, pos + 1, W_AND_OR_F134);
    if (e >= 0 && ctx.toks[e]?.norm === other) out.push({ end: e + 1, frag: { anyOf: [{ ...STATUS[w]! }, { ...STATUS[other]! }] } });
  }
  // FAST4 T33 (CR 301.5): "target attacking equipped creature": an Equipment is attached to it. Only after "attacking": a bare "equipped creature" is the
  // object the source Equipment is attached to (parser/holes/object.ts), never a description
  const ae = phraseAt(ctx, pos, W_ATTACKING_EQUIPPED);
  if (ae >= 0) out.push({ end: ae, frag: { attacking: true, equipped: true } });
  // std-hob (CR 301.5): "each equipped attacking creature" (Dáin Ironfoot): the same description with the adjectives in the other order
  const ea = phraseAt(ctx, pos, W_EQUIPPED_ATTACKING);
  if (ea >= 0) out.push({ end: ea, frag: { attacking: true, equipped: true } });
  // FAST5 T39 (CR 303.4b): "enchanted creatures you control": an Aura is attached to each. Only before a PLURAL type or subtype: "enchanted creature" is the object the
  // source Aura is attached to (parser/holes/object.ts), never a description
  // FAST5 T49 (CR 301.5): the same for "equipped creatures you control" (an Equipment is attached to each), plural only
  if (w === 'enchanted' || w === 'equipped') {
    const nx = ctx.toks[pos + 1];
    const head = nx !== undefined && nx.kind === 'WORD' ? (ctx.vocab.types.get(nx.norm) ?? ctx.vocab.subtypes.get(nx.norm)) : undefined;
    if (head !== undefined && head.plural) out.push({ end: pos + 1, frag: w === 'enchanted' ? { enchanted: true } : { equipped: true } });
    // Standard round 4, r4-trig (CR 301.5, 303.4b; Swordsman, Sharp Scoundrel): ... and after the article "a" / "an" in the singular, "whenever an equipped creature you
    // control attacks" (a description: the article never starts the source's own host, which is "equipped creature" alone)
    const art = ctx.toks[pos - 1]?.norm;
    // std-ry6 (CR 303.4b, 115.1; Ramses Overdark): ... and "enchanted" after "target", "destroy target enchanted creature" (a target is always described; the source's
    // own host is never announced as a target, design 6.4). "target equipped creature" stays manual (FAST4 T33 pins it)
    // edh-next-64 (CR 303.4b; Estrid, the Masked, Preston Garvey): ... and after "each", "untap each enchanted permanent you control" (a group of every permanent an Aura is attached to)
    if (head !== undefined && !head.plural && (art === 'a' || art === 'an' || (art === 'target' && w === 'enchanted') || (art === 'each' && w === 'enchanted'))) out.push({ end: pos + 1, frag: w === 'enchanted' ? { enchanted: true } : { equipped: true } });
    // edh-c-75 (CR 303.4b, 115.1; Cut the Earthly Bond): ... and "target enchanted permanent", the bare noun "permanent" being no type (a target is always described)
    if (w === 'enchanted' && nx?.norm === 'permanent' && (art === 'target' || art === 'each')) out.push({ end: pos + 1, frag: { enchanted: true } });
  }
  // FAST5 T45 (CR 113.3b-c, 603.1): "target activated or triggered ability" is either kind of ability on the stack
  const aot = phraseAt(ctx, pos, W_ACTIVATED_OR_TRIGGERED);
  if (aot >= 0) out.push({ end: aot, frag: { anyOf: [{ stackKind: 'activatedAbility' }, { stackKind: 'triggeredAbility' }] } });
  const aob = phraseAt(ctx, pos, P('attacking or blocking'));
  if (aob >= 0) out.push({ end: aob, frag: { anyOf: [{ attacking: true }, { blocking: true }] } });
  out.push(...statusList(ctx, pos));
  const neg = negated(ctx, w);
  if (neg !== null) out.push({ end: pos + 1, frag: neg });
  if (w === 'historic') out.push({ end: pos + 1, frag: HISTORIC });
  if (w === 'kicked') out.push({ end: pos + 1, frag: { kicked: true } }); // edh-next-13 (CR 702.33d): "kicked spells"
  if (w === 'outlaw') out.push({ end: pos + 1, frag: { subtypes: [...OUTLAW_SUBTYPES] } }); // FAST5X E1, CR 700.12
  const su = ctx.vocab.supertypes.get(w);
  if (su !== undefined) out.push({ end: pos + 1, frag: { supertypes: [su.name] } });
  if (w === 'other') out.push({ end: pos + 1, frag: { other: true } });
  // M11-4 (m11 design 4.5): "commander creatures you control", "commander spells you cast": the object is a commander (CR 903.3, 903.3d)
  if (w === W_COMMANDER[0]) out.push({ end: pos + 1, frag: { commander: true } });
  return out;
}

// ---------------------------------------------------------------------------
// heads
// ---------------------------------------------------------------------------

interface Item { kind: 'type' | 'subtype'; name: string; plural: boolean }

function itemsAt(ctx: HoleCtx, pos: number): { end: number; item: Item }[] {
  const out: { end: number; item: Item }[] = [];
  const t = ctx.toks[pos];
  if (t === undefined || t.kind !== 'WORD') return out;
  const ty = ctx.vocab.types.get(t.norm);
  if (ty !== undefined) out.push({ end: pos + 1, item: { kind: 'type', name: ty.name, plural: ty.plural } });
  for (const m of multiAt(ctx, pos, ctx.vocab.subtypes)) {
    out.push({ end: m.end, item: { kind: 'subtype', name: m.entry.name, plural: m.entry.plural } });
    if (m.entry.both) out.push({ end: m.end, item: { kind: 'subtype', name: m.entry.name, plural: true } }); // Eldrazi, Merfolk: one spelling, both numbers
  }
  return out;
}

/** CR 205.2a-b: card types and subtypes of one noun phrase; coordination by "or" means any of, juxtaposition ("artifact creature") means all of. */
// FAST4 T31: ... and ", and/or" closing a list of three or more ("two target artifacts, creatures, and/or lands you control": any of the types, CR 205.2a)
const SEPS = [P(', and'), P(', or'), P('or'), P(','), P('and/or'), P('and'), P(', and/or')];

function shape(groups: Item[][]): ObjectFilter | null {
  if (groups.length === 1) {
    const g = groups[0]!;
    const types = g.filter((i) => i.kind === 'type').map((i) => i.name);
    const subs = g.filter((i) => i.kind === 'subtype').map((i) => i.name);
    // std-rx32 (CR 205.3m): two subtypes said together, "a Spider Hero card": an object that has both
    if (subs.length > 2 || (subs.length === 2 && (subs[0] === subs[1] || g.length !== subs.length + types.length)) || new Set(types).size !== types.length) return null;
    const f: ObjectFilter = {};
    if (types.length === 1) f.types = types;
    if (types.length > 1) f.allTypes = types;
    if (subs.length === 1) f.subtypes = subs;
    if (subs.length === 2) f.allSubtypes = subs;
    return f;
  }
  // FAST5 T61: "artifact creature and/or Vehicle": the things that are an artifact creature, or a Vehicle (CR 205.2a, 205.3; one noun phrase per alternative: the
  // card types of the first all belong to one object, as in "artifact creature"), in either order
  if (groups.length === 2) {
    const multi = groups.findIndex((g) => g.length >= 2 && g.every((i) => i.kind === 'type'));
    const other = groups[1 - (multi < 0 ? 0 : multi)]!;
    if (multi >= 0 && other.length === 1 && other[0]!.kind === 'subtype') {
      const types = groups[multi]!.map((i) => i.name);
      if (new Set(types).size === types.length) return { anyOf: multi === 0 ? [{ allTypes: types }, { subtypes: [other[0]!.name] }] : [{ subtypes: [other[0]!.name] }, { allTypes: types }] };
    }
  }
  // std-re (CR 205.3m, 205.2a): "Vampire or Wizard creature card", "Ninja or Rogue creatures": subtypes joined by "or" before one card type that every one of them
  // goes with (the card type said once, after the last subtype): an object of that type with any of the subtypes (`subtypes` is "any of")
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]!;
    const lead = groups.slice(0, -1);
    if (last.length === 2 && last[0]!.kind === 'subtype' && last[1]!.kind === 'type' && lead.every((g) => g.length === 1 && g[0]!.kind === 'subtype')) {
      const subs = [...lead.map((g) => g[0]!.name), last[0]!.name];
      if (new Set(subs).size === subs.length) return { types: [last[1]!.name], subtypes: subs };
    }
  }
  // std-cardcopy-1 (CR 205.2a, 205.3j): "instant, sorcery, and/or Tamiyo planeswalker cards" (The Tale of Tamiyo): instant or sorcery card types first, then one
  // subtype with the permanent type it belongs to: any of the lead types, or that subtype of that type. Only lead types an object of the last type can never also
  // be (instant, sorcery), so the last type word cannot be read as said once for every item, as "Vampire or Wizard creature" above
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]!;
    const lead = groups.slice(0, -1);
    if (last.length === 2 && last[0]!.kind === 'subtype' && last[1]!.kind === 'type' && PERMANENT_TYPES.includes(last[1]!.name)
      && lead.every((g) => g.length === 1 && g[0]!.kind === 'type' && (g[0]!.name === 'Instant' || g[0]!.name === 'Sorcery'))) {
      const leadTypes = lead.map((g) => g[0]!.name);
      if (new Set(leadTypes).size === leadTypes.length) return { anyOf: [{ types: leadTypes }, { types: [last[1]!.name], subtypes: [last[0]!.name] }] };
    }
  }
  if (groups.some((g) => g.length !== 1)) return null;
  const kind = groups[0]![0]!.kind;
  // FAST2 T10: "creature or Vehicle": a card type or a subtype, any of the two (CR 205.2a, 205.3; a Vehicle is an artifact, so it is not "creature Vehicle")
  if (groups.length === 2 && groups[0]![0]!.kind === 'type' && groups[1]![0]!.kind === 'subtype') {
    return { anyOf: [{ types: [groups[0]![0]!.name] }, { subtypes: [groups[1]![0]!.name] }] };
  }
  // FAST4 T28: ... and the subtype first, "Vehicles and/or creatures" (the same set, in Oracle's order: CR 205.2a, 205.3)
  if (groups.length === 2 && groups[0]![0]!.kind === 'subtype' && groups[1]![0]!.kind === 'type') {
    return { anyOf: [{ subtypes: [groups[0]![0]!.name] }, { types: [groups[1]![0]!.name] }] };
  }
  // FAST5 T40: three or more names, card types and subtypes mixed, "creature, Spacecraft, or Planet" (Loading Zone): any of the types, or any of the subtypes (CR 205.2a,
  // 205.3), as one alternative per kind in the order the kinds first appear
  if (groups.length >= 3 && groups.some((g) => g[0]!.kind !== kind) && groups.every((g) => g[0]!.kind === 'type' || g[0]!.kind === 'subtype')) {
    const all = groups.map((g) => g[0]!);
    if (new Set(all.map((i) => i.name)).size !== all.length) return null;
    const alts: ObjectFilter[] = [];
    for (const k of ['type', 'subtype'] as const) {
      const names = all.filter((i) => i.kind === k).map((i) => i.name);
      if (names.length > 0) alts.push(k === 'type' ? { types: names } : { subtypes: names });
    }
    return { anyOf: all[0]!.kind === 'type' ? alts : alts.reverse() };
  }
  if (groups.some((g) => g[0]!.kind !== kind)) return null;
  const names = groups.map((g) => g[0]!.name);
  if (new Set(names).size !== names.length) return null;
  return kind === 'type' ? { types: names } : { subtypes: names };
}

const BARE_HEADS: [string[], string[], HeadKind][] = [
  [P('permanent'), P('permanents'), 'permanent'], [P('card'), P('cards'), 'card'], [P('spell'), P('spells'), 'spell'],
  [P('token'), P('tokens'), 'token'], [P('ability'), P('abilities'), 'ability'],
  [P('source'), P('sources'), 'source'], // p2-replace-damage-2: "another red source you control", "an instant or sorcery source" (only where a pattern allows the head)
];

const W_PERMANENT_CARD = P('permanent card');
const W_PERMANENT_CARDS = P('permanent cards');
const W_PERMANENT_SPELL = P('permanent spell'); // std-lci
const W_PERMANENT_SPELLS = P('permanent spells');
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];
const W_SPELL_OR_ABILITY = P('spell or ability');
const W_SPELLS_OR_ABILITIES = P('spells or abilities');
const W_SPELLS_AND_OR_ABILITIES = P('spells and/or abilities'); // edh-d-51
// MX3 (CR 701.54b, 701.54e): "a Ring-bearer", "Ring-bearers": a permanent with the Ring-bearer designation (of any player; "you control" may follow)
const W_SUSPENDED_CARD = P('suspended card'); // p2-modal-1
const W_SUSPENDED_CARDS = P('suspended cards');
const W_RING_BEARER = P('ring-bearer');
const W_RING_BEARERS = P('ring-bearers');
const W_OUTLAW = P('outlaw'); // FAST5X E20 (CR 700.12): the noun
const W_OUTLAWS = P('outlaws');

/**
 * `or`: FAST5 T59, the head is two descriptions joined by "or": only who controls or owns them may follow (a "with ..." after it may belong to the second one only).
 * `list`: FAST5X E27, a list of several kinds ("artifact, enchantment, or creature", "creature or Vehicle"), any of which the object is (see `shape`).
 */
// edh-next-125: `postAll`, a coordination whose post-modifier of mana value goes with both halves ("non-Equipment artifact and non-Aura enchantment you control with
// mana value 4 or greater": no half is a bare noun the comparison could belong to alone)
interface HeadAlt { end: number; frag: ObjectFilter; number: 'singular' | 'plural'; head: HeadKind; or?: true; list?: true; postAll?: true }

function headWord(ctx: HoleCtx, pos: number, allow: HeadKind[]): { end: number; head: HeadKind; plural: boolean }[] {
  const out: { end: number; head: HeadKind; plural: boolean }[] = [];
  for (const [s, p, head] of BARE_HEADS) {
    if (!allow.includes(head)) continue;
    const a = phraseAt(ctx, pos, s);
    if (a >= 0) out.push({ end: a, head, plural: false });
    const b = phraseAt(ctx, pos, p);
    if (b >= 0) out.push({ end: b, head, plural: true });
  }
  return out;
}

function headAt(ctx: HoleCtx, pos: number): HeadAlt[] {
  const out: HeadAlt[] = [];
  // a run of types/subtypes, with an optional generic head word after it
  const walk = (p: number, done: Item[][], cur: Item[], depth: number): void => {
    if (depth > 20) return; // FAST5 T68: a list of up to 21 names ("Other Spiders, Boars, Bats, ... and Wolves you control get +1/+1", 18 creature types); was 9
    for (const it of itemsAt(ctx, p)) {
      const cur2 = [...cur, it.item];
      const groups = [...done, cur2];
      const f = shape(groups);
      if (f !== null) {
        const list = groups.length > 1 ? { list: true as const } : {};
        out.push({ end: it.end, frag: f, number: it.item.plural ? 'plural' : 'singular', head: 'type', ...list });
        for (const h of headWord(ctx, it.end, ['card', 'spell', 'token', 'permanent', 'source'])) out.push({ end: h.end, frag: f, number: h.plural ? 'plural' : 'singular', head: h.head, ...list });
        // FAST2 T10: "a Goblin permanent card": a card with the subtype and a permanent type (CR 110.4, 205.3), as "permanent card" alone (below)
        // edh-c-86 (Celestial Gatekeeper): also a list of subtypes joined by "or" / "and/or" (any of them), "Bird and/or Cleric permanent cards"
        if (f.subtypes !== undefined && f.subtypes.length >= 1 && f.types === undefined && (f.subtypes.length === 1 || (f.allTypes === undefined && f.allSubtypes === undefined && f.anyOf === undefined))) {
          for (const [ws, plural] of [[W_PERMANENT_CARD, false], [W_PERMANENT_CARDS, true]] as const) {
            const e = phraseAt(ctx, it.end, ws);
            if (e >= 0) out.push({ end: e, frag: { ...f, types: PERMANENT_TYPES }, number: plural ? 'plural' : 'singular', head: 'card' });
          }
        }
        // edh-cast-8 (CR 110.4b, 205.3; Archmage of Echoes): "a Faerie or Wizard permanent spell": a spell with any of the subtypes (one or several joined by "or") and a permanent
        // type (a Tribal instant has the subtype and is no permanent spell, a land is never cast, CR 305.9)
        if (f.subtypes !== undefined && f.subtypes.length >= 1 && f.types === undefined && f.allTypes === undefined && f.allSubtypes === undefined && f.anyOf === undefined) {
          for (const [ws, plural] of [[W_PERMANENT_SPELL, false], [W_PERMANENT_SPELLS, true]] as const) {
            const e = phraseAt(ctx, it.end, ws);
            if (e >= 0) out.push({ end: e, frag: { ...f, types: PERMANENT_TYPES }, number: plural ? 'plural' : 'singular', head: 'spell' });
          }
        }
      }
      walk(it.end, done, cur2, depth + 1);
      for (const s of SEPS) {
        const e = phraseAt(ctx, it.end, s);
        if (e >= 0) walk(e, groups, [], depth + 1);
      }
    }
  };
  walk(pos, [], [], 0);
  // edh-d-11 (CR 205.4a, 205.3m, 205.2a; Narfi, Betrayer King): "snow and Zombie creatures": a supertype, then "and"/"or" and subtypes with a card type said once: creatures that
  // have the supertype or are one of the subtypes (the supertype belongs to the first half only; "legendary and Elf creatures")
  {
    const sw = ctx.toks[pos];
    const sup = sw !== undefined && sw.kind === 'WORD' ? ctx.vocab.supertypes.get(sw.norm) : undefined;
    if (sup !== undefined) {
      for (const sep of [P('and'), P('or'), P('and/or')]) {
        const e = phraseAt(ctx, pos + 1, sep);
        if (e < 0) continue;
        for (const h of headAt(ctx, e)) {
          const f = h.frag;
          if (h.head !== 'type' || h.number !== 'plural' || h.list === true || h.or === true || Object.keys(f).length !== 2 || f.types?.length !== 1 || f.subtypes === undefined || f.subtypes.length !== 1) continue;
          out.push({ end: h.end, frag: { types: f.types, anyOf: [{ supertypes: [sup.name] }, { subtypes: f.subtypes }] }, number: h.number, head: 'type' });
        }
      }
    }
  }
  // edhd60 (CR 205.4, 205.3m, 700.6-style any-of; Nashi, Moon's Legacy): "legendary or Rat card": a supertype, "or", then ONE subtype with the generic head "card" (singular): a card that is legendary or has the subtype
  {
    const sw = ctx.toks[pos];
    const sup = sw !== undefined && sw.kind === 'WORD' ? ctx.vocab.supertypes.get(sw.norm) : undefined;
    const e = sup !== undefined ? phraseAt(ctx, pos + 1, P('or')) : -1;
    if (sup !== undefined && e >= 0) {
      for (const h of headAt(ctx, e)) {
        const f = h.frag;
        if (h.head !== 'card' || h.number !== 'singular' || h.list === true || h.or === true || Object.keys(f).join() !== 'subtypes' || f.subtypes?.length !== 1) continue;
        out.push({ end: h.end, frag: { anyOf: [{ supertypes: [sup.name] }, { subtypes: f.subtypes }] }, number: 'singular', head: 'card' });
      }
    }
  }
  for (const h of headWord(ctx, pos, ['permanent', 'card', 'spell', 'token', 'ability', 'source'])) out.push({ end: h.end, frag: {}, number: h.plural ? 'plural' : 'singular', head: h.head });
  // 'permanent card': a card of a permanent type (CR 110.4)
  for (const [ws, plural] of [[W_PERMANENT_CARD, false], [W_PERMANENT_CARDS, true]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { types: PERMANENT_TYPES }, number: plural ? 'plural' : 'singular', head: 'card' });
  }
  // std-lci: 'permanent spell': a spell of a permanent type (CR 110.4b: it becomes a permanent as it resolves; a land is never cast, CR 305.9)
  for (const [ws, plural] of [[W_PERMANENT_SPELL, false], [W_PERMANENT_SPELLS, true]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { types: PERMANENT_TYPES }, number: plural ? 'plural' : 'singular', head: 'spell' });
  }
  for (const [ws, plural] of [[W_SPELL_OR_ABILITY, false], [W_SPELLS_OR_ABILITIES, true], [W_SPELLS_AND_OR_ABILITIES, true]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: {}, number: plural ? 'plural' : 'singular', head: 'stackObject' });
  }
  // M11-4 (m11 design 4.5): "a commander", "commanders you control", "target commander": an object that is a commander (CR 903.3; 903.3d: controlling one
  // is a permanent on the battlefield, one "in" a zone is a card there). The noun names no card type, so it is the generic head of a permanent.
  for (const [ws, plural] of [[W_COMMANDER, false], [W_COMMANDERS, true]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { commander: true }, number: plural ? 'plural' : 'singular', head: 'permanent' });
  }
  // p2-modal-1 (CR 702.62b; unverified cite): "each suspended card": a card in exile that has suspend and a time counter on it (the zone is part of the word)
  for (const [ws, plural] of [[W_SUSPENDED_CARD, false], [W_SUSPENDED_CARDS, true]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { zone: 'exile', keyword: 'suspend', counters: { kind: 'time' } }, number: plural ? 'plural' : 'singular', head: 'card' });
  }
  for (const [ws, plural] of [[W_RING_BEARER, false], [W_RING_BEARERS, true]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { ringBearer: 'any' }, number: plural ? 'plural' : 'singular', head: 'permanent' });
  }
  // FAST5X E20 (CR 700.12, 700.12a; also FAST5 T62's "another outlaw you control"): "an outlaw", "outlaws you control" as a noun: an object with any of the five outlaw creature types (with "you control",
  // only permanents: the battlefield zone of a type head)
  for (const [ws, plural] of [[W_OUTLAW, false], [W_OUTLAWS, true]] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { subtypes: [...OUTLAW_SUBTYPES] }, number: plural ? 'plural' : 'singular', head: 'type' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// post-modifiers
// ---------------------------------------------------------------------------

type Frag = { end: number; frag: ObjectFilter; flags?: string[]; weak?: number };

const W_WITH = P('with');
const W_AND_WITH = P('and with'); // edh-next-126
const W_THAT_HAS = P('that has'); // edh-b-4
const W_THAT_DOESNT_HAVE = P("that doesn't have"); // edh-c-52
const W_WITHOUT = P('without');
const W_THAT_DONT_HAVE = P("that don't have"); // edh-next-92
const W_EACH_WITH = P('each with'); // Cloud r3-repl
const W_NAMED = P('named');
const W_NOT_NAMED = P('not named'); // edh-zones-13
const W_THAT = P('that');
const W_BARE_DEALT_DAMAGE = P('dealt damage this turn'); // edh-c-61
const W_YOU_CONTROLLED_ATTACHED = P('you controlled that was attached to'); // edh-perms-20
const W_NOT_LEGENDARY = P('not legendary'); // edh-zones-3
const W_LEGENDARY_WORD = P('legendary'); // edh-next-116
const W_NOT_HISTORIC = P('not historic'); // edh-zones-3
/** FAST5 T68 (CR 303.4b): an Aura the ability's controller controls is attached to the object (ObjectFilter.enchantedBy), plural and singular wordings. */
const W_ENCHANTED_BY_YOUR_AURA = [P('that are enchanted by auras you control'), P('that are enchanted by an aura you control'), P("that's enchanted by an aura you control"), P('that is enchanted by an aura you control')];
const W_DEALT_DAMAGE_BY_SELF = P('dealt damage by ~ this turn');
const W_DEALT_DAMAGE_BY_EQUIPPED = P('dealt damage by equipped creature this turn'); // edh-c-113
const W_DEALT_DAMAGE_BY_YOUR_SOURCE = P('dealt damage this turn by a source you controlled'); // edh-c-48
const W_DEALT_DAMAGE_THIS_TURN_BY = [P('dealt damage this turn by a'), P('dealt damage this turn by an')]; // edh-next-130
const W_YOU_CONTROLLED = P('you controlled'); // edh-next-130
const W_CREWED_BY_SELF = P('crewed by ~ this turn'); // Standard round 5, r5-trig
/** FAST4 T19: the participle of the objects a damage step dealt damage to (lower/mentions.ts gives the step's mention this verb). */
export const DEALT_DAMAGE_THIS_WAY = 'dealt damage this way';
/** trek-22: the participle of the creatures a fight step made fight (lower/mentions.ts gives the step's mention this verb; render/np.ts says it "that fought this way"). */
export const FOUGHT_THIS_WAY = 'fought this way';
/** Cloud std-eoe: the participle of the cards a destroy or sacrifice step put into graveyards (lower/mentions.ts, render/np.ts). */
export const PUT_INTO_GRAVEYARD_THIS_WAY = 'put into a graveyard this way';
const W_PUT_INTO_A_GRAVEYARD_THIS_WAY = P('put into a graveyard this way');
const W_PUT_INTO_GRAVEYARDS_THIS_WAY = P('put into graveyards this way'); // edh-next-127 (Danse Macabre): the plural, cards of several players' graveyards
const W_PUT_INTO_YOUR_GRAVEYARD_THIS_WAY = P('put into your graveyard this way');
const W_PUT_INTO_THEIR_GRAVEYARD_THIS_WAY = P('put into their graveyard this way'); // edh-c-100 (Coerced Confession)
const W_DEALT_DAMAGE_THIS_WAY = P(DEALT_DAMAGE_THIS_WAY);
/** std-lci: the participle of the objects an earlier step of the ability exiled ("for each card exiled this way"; lower/mentions.ts gives exiling moves this verb). */
export const EXILED_THIS_WAY = 'exiled this way';
/** std-ro: the participle of the top cards of a library a reveal step revealed ("put all land cards revealed this way into your hand"; lower/mentions.ts gives such a reveal this verb). */
export const REVEALED_THIS_WAY = 'revealed this way';
/** std-lci's post-modifier "exiled this way" (`{zone: 'exile', is: <the exiled-this-way anaphor>}`, postModAt below). */
const exiledThisWayFrag = (f: ObjectFilter): boolean => {
  const is = (f as Record<string, unknown>)['is'];
  const a = typeof is === 'object' && is !== null ? (is as Record<string, unknown>)['$anaphor'] : undefined;
  return typeof a === 'object' && a !== null && (a as Record<string, unknown>)['participle'] === EXILED_THIS_WAY;
};
const W_EXILED_THIS_WAY = P(EXILED_THIS_WAY);
const W_EXILED_WITH_SELF = P('exiled with ~'); // std-rx5
const W_EXILED_WITH_IT = P('exiled with it'); // std-cardcopy-3
const W_COUNTERS = [P('counter'), P('counters')];
const W_ON_IT = [P('on it'), P('on them'), P('on ~')];
/** FAST4 T33: the bare plural of a counter post-modifier, "creatures you control with +1/+1 counters on them" (one or more, CR 122.1). */
const W_COUNTERS_ON_THEM = P('counters on them');
/** FAST5X E21 (CR 122.1): no counter of any kind on the object, "with no counters on it". */
const W_NO_COUNTERS_ON = [P('no counters on it'), P('no counters on them')];
const W_ONE_OR_MORE_COUNTERS_ON_IT = P('one or more counters on it');
const W_COUNTERS_ON_IT_ANY = P('counters on it'); // r4-static
const W_SHARES = [P('shares'), P('share')];
const W_EACH_CREATURE_TAPPED_THIS_WAY = P('each creature tapped this way'); // edh-next-145
const W_SAME_NAME_AS = P('the same name as');
const W_SAME_MV_AS = P('the same mana value as'); // edh-b-14
const W_SAME_MV = P('the same mana value'); // edh-next-139
const W_DIFFERENT_NAME_THAN = P('a different name than'); // edh-zones-26
const KINDS: [string[], 'creatureType' | 'color' | 'cardType' | 'name' | 'landType' | 'permanentType'][] = [
  [P('creature type'), 'creatureType'], [P('color'), 'color'], [P('card type'), 'cardType'], [P('name'), 'name'], [P('land type'), 'landType'], [P('permanent type'), 'permanentType'],
];
const W_OF_THAT_TYPE = P('of that type'); // FAST5 T67
const W_OF_THAT_COLOR = P('of that color'); // edh-players-8
const W_EVEN_MV = [P('even mana value'), P('even mana values'), P('an even mana value')]; // edh-cast-4; edh-players-10: "with an even mana value" (Desecrate Reality); edh-zones-13: the article (Gyruda)
const W_ODD_MV = [P('odd mana value'), P('odd mana values'), P('an odd mana value')]; // edh-cast-4; edh-players-10; edh-zones-13: the article
const W_MV_CHOSEN_QUALITY = P('with mana value of the chosen quality'); // Cloud std-eoe
const W_MV_NOT_CHOSEN_QUALITY = P('without mana value of the chosen quality'); // edh-c-78 (Ashling's Prerogative)
const W_POWER_CHOSEN_QUALITY = P('with power of the chosen quality'); // edh-d-95 (Zimone's Hypothesis)
const W_MV_THAT_QUALITY = P('with mana value of that quality'); // edh-next-40 (Twins of Discord)
const CHOSEN: [string[], 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName' | 'landOrNonland'][] = [
  // CLOUD C5 (CR 607.2d): "the chosen type" is the type the linked ability chose, of whatever kind (lower/links.ts reads '$chosenType' against the producer)
  [P('type'), '$chosenType' as never], [P('creature type'), 'creatureType'], [P('color'), 'color'], [P('card type'), 'cardType'], [P('land type'), 'landType'], [P('basic land type'), 'landType'],
  [P('card name'), 'cardName'],
  [P('kind'), 'landOrNonland'], // edh-zones-16 (CR 205.2a): "a card of the chosen kind" after "choose land or nonland"
];

const W_YOUR_TEAM = P('your team'); // edh-next-35
function plainPlayerForm(ctx: HoleCtx, pos: number): { end: number; pred: PlayerPred; neg: boolean; verb: 'control' | 'own' }[] {
  const out: { end: number; pred: PlayerPred; neg: boolean; verb: 'control' | 'own' }[] = [];
  // edh-next-35 (CR 102.3, 810.1; Thrasher Brute, Khorvath Brightflame; family team-controls beside edh-c-68's condition): "Warriors your team controls": the game has no team of several
  // players (CR 810 is not played, as edh-c-17 and edh-c-68 read "your team"), so your team is you, and its controller phrase is "you control"
  const team = phraseAt(ctx, pos, W_YOUR_TEAM);
  if (team >= 0 && (ctx.toks[team]?.norm === 'control' || ctx.toks[team]?.norm === 'controls')) out.push({ end: team + 1, pred: 'you', neg: false, verb: 'control' });
  for (const p of ctx.call('Player', pos)) {
    const ref = p.value as PlayerRef;
    const pred = predOf(ref);
    for (const [word, verb] of [['control', 'control'], ['controls', 'control'], ['own', 'own'], ['owns', 'own']] as const) {
      if (ctx.toks[p.end]?.norm === word) out.push({ end: p.end + 1, pred, neg: false, verb });
    }
    const n = ctx.toks[p.end]?.norm;
    if (n === "don't" || n === "doesn't") {
      const v = ctx.toks[p.end + 1]?.norm;
      if (v === 'control') out.push({ end: p.end + 2, pred, neg: true, verb: 'control' });
      if (v === 'own') out.push({ end: p.end + 2, pred, neg: true, verb: 'own' });
    }
  }
  return out;
}

const W_POWER_OR_TOUGHNESS = P('power or toughness');
const W_BASE_POWER_OR_TOUGHNESS = P('base power or toughness'); // edh-perms-11
const W_BASE_POWER = P('base power'); // edh-next-23
const W_BASE_POWER_AND_TOUGHNESS = P('base power and toughness'); // edh-next-19
const W_MV_POWER_OR_TOUGHNESS = P('mana value , power , or toughness'); // std-rx5
const W_LESSER_MANA_VALUE = P('lesser mana value');
const W_LESSER_POWER = P('lesser power'); // edh-c-86
const W_LESSER_TOUGHNESS = P('lesser toughness'); // edh-next-86 (Colfenor, the Last Yew)
const W_EQUAL_OR_LESSER_TOUGHNESS = P('equal or lesser toughness'); // edh-next-103 (Bane, Lord of Darkness)
const W_LESSER_MANA_VALUE_THAN_DIED = P('lesser mana value than the creature that died'); // edh-c-45
const W_EQUAL_OR_LESSER_MANA_VALUE = P('equal or lesser mana value'); // std-rx28
const W_POWER_LESS_THAN_OWN = P("power less than ~ 's"); // edh-next-32
const W_EQUAL_OR_LESSER_POWER = P('equal or lesser power'); // edh-next-32
const W_MV_AT_MOST_OF = P('mana value less than or equal to'); // edh-next-126
const W_MV_AT_MOST_CONTROLLER_GRAVEYARD = P("mana value less than or equal to the number of cards in its controller 's graveyard"); // edh-cast-12
const W_THAT_SPELLS_MANA_VALUE = P("that spell 's mana value"); // edh-c-66
const W_DIFFERENT_NAMES = P('different names');
const W_SHARE_A_CREATURE_TYPE = P('share a creature type'); // CLOUD std-ecl
const W_OF_THE_CREATURE_TYPE_OF_YOUR_CHOICE = P('of the creature type of your choice'); // edh-d-59 (Aphetto Dredging)
const W_OF_THE_OTHER_TYPE = P('of the other type'); // edh-d-96 (Gale, Waterdeep Prodigy)
const W_EACH_HAVE_A_DIFFERENT_MV = P('each have a different mana value'); // edh-top-3
const W_HAVE_A_DIFFERENT_MV = P('have a different mana value'); // edh-top-3
const W_NO_ABILITIES = P('no abilities');
const W_ABILITIES = P('abilities'); // edh-d-22
/** std-sos (CR 107.3, 202.1): "a spell with {X} in its mana cost", "cards with {X} in their mana costs" (Oracle also prints the plural "in their mana cost"). */
/** Standard round 5, r5-trig (CR 107.4): "blue mana symbols in its mana cost", per color. */
const W_COLOR_SYMBOLS_IN_COST: readonly (readonly ['W' | 'U' | 'B' | 'R' | 'G' | 'colored', string[]])[] = [
  ['W', P('white mana symbols in its mana cost')], ['U', P('blue mana symbols in its mana cost')], ['B', P('black mana symbols in its mana cost')],
  ['R', P('red mana symbols in its mana cost')], ['G', P('green mana symbols in its mana cost')],
  ['colored', P('colored mana symbols in its mana cost')], // edh-next-142 (CR 105.1, 107.4; Omnath, Locus of All): symbols of any color
];
const W_X_IN_MANA_COST = [P('{x} in its mana cost'), P('{x} in their mana costs'), P('{x} in their mana cost'), P('a mana cost that contains {x}') /* edh-next-74: Unbound Flourishing */];
const W_NO_COUNTERS = P('no counters on it'); // FAST5 T59
const W_A_BASIC_LAND_TYPE = P('a basic land type'); // edh-zones-1
const W_THE_MOST = P('the greatest'); // FAST5X E15: "with the greatest power among ..."
const W_THE_LEAST = P('the least'); // edh-next-23 (CR 208.1, 608.2d; Witch-king, Bringer of Ruin): "with the least power among ..."
const W_POWER_GREATER_THAN_BASE = [P('power greater than its base power'), P('power greater than their base power')]; // std-rx11
const W_CHOSEN_NAME = [P('the chosen name'), P('that name')]; // CLOUD std-misc

const BASIC_WALKS: ReadonlySet<string> = new Set(['plainswalk', 'islandwalk', 'swampwalk', 'mountainwalk', 'forestwalk']); // edh-combat-2

/** "with <feature>" / "that has <feature>" (positive) or "without <feature>" (negated). */
/** The features of `featureAtAll` that stand alone: a bare "with the greatest <stat>" needs its noun phrase to fill the set it compares with (`fillHeadSet`), so other readers never see it. */
export function featureAt(ctx: HoleCtx, pos: number, negate: boolean): { end: number; frag: ObjectFilter; weak?: number }[] {
  return featureAtAll(ctx, pos, negate).filter((f) => !JSON.stringify(f.frag).includes(HEAD_SET));
}

function featureAtAll(ctx: HoleCtx, pos: number, negate: boolean): { end: number; frag: ObjectFilter; weak?: number }[] {
  const out: { end: number; frag: ObjectFilter; weak?: number }[] = [];
  const wrap = (f: ObjectFilter): ObjectFilter => (negate ? { not: f } : f);
  // keyword list: "flying", "flying or reach"
  const kwWalk = (p: number, acc: string[], canEmit = true): void => {
    // edh-combat-2 (CR 702.14a; Stormtide Leviathan): "without flying or islandwalk": a landwalk by its land word ("islandwalk": a landwalk whose quality is that basic land
    // type; statics/match.ts#hasNamedKeyword), the five basic land types only
    const walkWord = ctx.toks[p]?.kind === 'WORD' ? ctx.toks[p]!.norm : '';
    const walks: { end: number; entry: { name: string } }[] = BASIC_WALKS.has(walkWord) ? [{ end: p + 1, entry: { name: walkWord } }] : [];
    for (const m of [...multiAt(ctx, p, ctx.vocab.keywords), ...walks]) {
      const names = [...acc, m.entry.name];
      if (negate) { if (canEmit) out.push({ end: m.end, frag: { notKeyword: names.length === 1 ? names[0]! : names } }); }
      else if (canEmit) out.push({ end: m.end, frag: { keyword: names.length === 1 ? names[0]! : names } });
      // p2-attack-block-1 (CR 702.9b, 702.17b): "without flying or reach" is a creature with neither (`notKeyword` with both: rules/filter.ts excludes an object
      // with any of them), as render/np.ts says it
      { const e = phraseAt(ctx, m.end, P('or')); if (e >= 0) kwWalk(e, names); }
      // edh-b-2 (CR 702; Henrika Domnathi): "with flying, deathtouch, and/or lifelink" is a list closed by "or" / "and/or" (any of them); a list with commas only ("flying, deathtouch")
      // is no filter of its own (it has to be closed), "and" is not "or" (fail closed)
      // edh-c-78 (CR 702, 205.3; Grand Master of Flowers): "without first strike, double strike, or vigilance" is the same list closed by ", or": a creature with none of them (`notKeyword`)
      {
        for (const sep of KW_LIST_CLOSERS) { const e = phraseAt(ctx, m.end, sep); if (e >= 0) kwWalk(e, names); }
        const comma = phraseAt(ctx, m.end, P(','));
        if (comma >= 0) kwWalk(comma, names, false);
      }
    }
  };
  kwWalk(pos, []);
  // edh-c-14 (CR 702.29a, 702.29f; Zenith Flare): "cards with a cycling ability": cycling and every typecycling ("Any effect that looks for a card with cycling will find a card with typecycling")
  if (!negate) { const cyc = anyPhraseAt(ctx, pos, [P('a cycling ability'), P('cycling abilities') /* edh-next-90: Herald of the Forgotten, plural cards */]); if (cyc >= 0) out.push({ end: cyc, frag: { keyword: ['cycling', 'typecycling'] } }); }
  // edh-c-77 (CR 702.33a, 702.33c; Coralhelm Chronicler, ruling 2020-09-25 "A kicker ability includes the multikicker variant"): "cards with a kicker ability": kicker or multikicker
  if (!negate) { const kick = phraseAt(ctx, pos, P('a kicker ability')); if (kick >= 0) out.push({ end: kick, frag: { keyword: ['kicker', 'multikicker'] } }); }
  // edh-c-57 (CR 702.37a; Master of the Veil): "creature with a morph ability" is the keyword filter morph ("with morph")
  if (!negate) { const mo = phraseAt(ctx, pos, P('a morph ability')); if (mo >= 0) out.push({ end: mo, frag: { keyword: ['morph', 'megamorph'] } }); }  // (CR 702.37b: megamorph is a variant of the morph ability)
  // trek-9 (CR 301.5, 303.4): "with a Communicator attached to them"
  if (!negate) for (const a of attachedWithAt(ctx, pos)) out.push(a);
  // edh-zones-1 (CR 205.3i, 305.6; Boseiju, Who Endures): "a land card with a basic land type" is a land that has Plains, Island, Swamp, Mountain or Forest among its
  // land types (any of the five; a land that gained one counts, a nonbasic land such as a Gate does not). Only "with"; "without" has no reading (render/np.ts says it)
  const basicType = negate ? -1 : phraseAt(ctx, pos, W_A_BASIC_LAND_TYPE);
  if (basicType >= 0) out.push({ end: basicType, frag: { subtypes: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] } });
  // FAST3 T18: "with the same name as that creature" (CR 201.2: objects share a name; a nameless face-down object shares none): the `sharesWith` of
  // "that shares a name with it", the object named by an Obj ("that creature", "target creature"); only "with", never "without"
  const same = negate ? -1 : phraseAt(ctx, pos, W_SAME_NAME_AS);
  if (same >= 0) for (const o of ctx.call('Obj', same)) out.push({ end: o.end, frag: { sharesWith: { with: o.value as never, quality: 'name' } } });
  // edh-b-14 (CR 202.3; Mists of Lórien): "with the same mana value as that permanent": the mana value of the object an Obj names; only "with"
  const sameMv = negate || ctx.toks[pos - 1]?.norm !== 'with' ? -1 : phraseAt(ctx, pos, W_SAME_MV_AS); // only after "with": "it has the same mana value as" is a condition (edh-cast-9)
  if (sameMv >= 0) for (const o of ctx.call('Obj', sameMv)) out.push({ end: o.end, frag: { sharesWith: { with: o.value as never, quality: 'manaValue' } } });
  // edh-next-139 (CR 202.3, 603.2, 608.2c; Boxing Ring): "Whenever a creature you control enters, it fights up to one target creature you don't control with the same mana value.": the comparison
  // left unsaid is with the fighter, the sentence's "it", which in a trigger's first sentence is the object of the triggering event (`{ref:'event', role:'subject'}`; outside a triggered
  // ability the lint refuses that reference). Only in a sentence "it fights ...", after "with" and at its end
  const sameMvBare = negate || ctx.toks[pos - 1]?.norm !== 'with' || ctx.toks[0]?.norm !== 'it' || ctx.toks[1]?.norm !== 'fights' || ctx.discourse?.first !== true ? -1 : phraseAt(ctx, pos, W_SAME_MV); // review fix: the first sentence only (no earlier sentence of the ability)
  if (sameMvBare >= 0 && sameMvBare === ctx.toks.length) out.push({ end: sameMvBare, frag: { sharesWith: { with: { ref: 'event', role: 'subject' } as never, quality: 'manaValue' } } });
  // edh-zones-26 (CR 201.2; Tibalt's Trickery): "a nonland card with a different name than that spell": the object shares no name with the object named by an Obj; only "with"
  const diffName = negate ? -1 : phraseAt(ctx, pos, W_DIFFERENT_NAME_THAN);
  if (diffName >= 0) for (const o of ctx.call('Obj', diffName)) out.push({ end: o.end, frag: { not: { sharesWith: { with: o.value as never, quality: 'name' } } }, ...(o.flags ? { flags: o.flags } : {}) });
  // edh-next-126 (CR 201.2; Light-Paws, Emperor's Voice): "with a different name than each Aura you control": the object shares a name with none of the permanents of that description
  // (rules/filter.ts: `sharesWith` reads a set as "some object of it", so its negation is "each of them has another name"); "each" and a singular description only
  if (diffName >= 0 && ctx.toks[diffName]?.norm === 'each') {
    for (const n of npAlts(ctx, diffName + 1)) {
      if (n.number !== 'singular' || n.flags.some((x) => x !== 'zone-unstated')) continue;
      out.push({ end: n.end, frag: { not: { sharesWith: { with: { ref: 'each', filter: n.filter }, quality: 'name' } } }, ...(n.weak ? { weak: n.weak } : {}) });
    }
  }
  // std-hob (CR 201.2): "a legendary card with the same name as a legendary permanent you control": the name of any one object of that description (rules/filter.ts:
  // `sharesWith` reads a set as "some object of it")
  const sameT = same >= 0 ? ctx.toks[same]?.norm : undefined;
  if (same >= 0 && (sameT === 'a' || sameT === 'an')) {
    for (const n of npAlts(ctx, same + 1)) {
      if (n.number !== 'singular' || n.flags.some((x) => x !== 'zone-unstated')) continue;
      if (JSON.stringify(n.filter).includes('"text":"their"')) continue; // edh-next-32: "a card in their graveyard" is the object's own ObjectFilter.nameInGraveyard (below), not a set whose owner is a pronoun
      out.push({ end: n.end, frag: { sharesWith: { with: { ref: 'each', filter: n.filter }, quality: 'name' } }, ...(n.weak ? { weak: n.weak } : {}) });
    }
    // edh-next-112 (CR 607.2a, 201.2; Circu, Dimir Lobotomist): and "a card exiled with ~", the cards the source's linked exile holds (the flag the target phrase reading marks, asked for here)
    for (const n of npAlts(ctx, same + 1, { differentNames: true })) {
      if (n.number !== 'singular' || !n.flags.includes('linked-exiled-target') || n.flags.some((x) => x !== 'zone-unstated' && x !== 'linked-exiled-target')) continue;
      out.push({ end: n.end, frag: { sharesWith: { with: { ref: 'each', filter: n.filter }, quality: 'name' } }, ...(n.weak ? { weak: n.weak } : {}) });
    }
  }
  // FAST5X E15 (CR 208.1, 202.3): "with the greatest power among creatures they control": a value at least the greatest one of the set (at most the least
  // one), so the matching objects are the tied greatest; the player who chooses picks among them (CR 608.2d). Only "with", never "without". The set takes
  // every word it can ("among creatures they control"): a shorter set would leave "they control" to the outer noun, a different reading (guard G5).
  if (!negate && (phraseAt(ctx, pos, W_THE_MOST) >= 0 || phraseAt(ctx, pos, W_THE_LEAST) >= 0)) {
    const sets = ctx.call('Qty', pos).filter((q) => {
      const v = q.value as Quantity;
      return typeof v === 'object' && v.q === 'stat' && v.agg !== undefined && (v.stat === 'power' || v.stat === 'toughness' || v.stat === 'manaValue');
    });
    const longest = Math.max(...sets.map((q) => q.end));
    for (const q of sets) {
      if (q.end !== longest) continue;
      const v = q.value as Extract<Quantity, { q: 'stat' }>;
      out.push({ end: q.end, frag: { [v.stat]: { op: v.agg === 'max' ? '>=' : '<=', value: v } } });
    }
  }
  // edh-c-83 (CR 208.1, 202.3, 608.2d; Favor of the Mighty): "each creature with the greatest mana value": the set compared with is the noun phrase itself (the creatures, here those that
  // the other words describe too), said with no "among": a placeholder set (`HEAD_SET`) that the noun phrase fills with its own description (`fillHeadSet`). Only "with", only "the greatest"
  if (!negate && phraseAt(ctx, pos, W_THE_MOST) >= 0) {
    for (const [ws, field] of [[P('power'), 'power'], [P('toughness'), 'toughness'], [P('mana value'), 'manaValue']] as const) {
      const e = phraseAt(ctx, phraseAt(ctx, pos, W_THE_MOST), ws);
      if (e < 0 || ctx.toks[e]?.norm === 'among') continue;
      out.push({ end: e, frag: { [field]: { op: '>=', value: { q: 'stat', stat: field, of: { ref: 'each', filter: { [HEAD_SET]: true } as never }, agg: 'max' } } }, weak: 1 });
    }
  }
  // CLOUD std-misc (CR 607.2d, 608.2c-d; The Clone Saga, Ancient Vendetta): "with the chosen name", "with that name": the card name an earlier "Choose a card name."
  // of the same ability chose (the links pass, parser/lower/links.ts, replaces the placeholder; with no such choice it survives and the sentence is manual). Only "with".
  const chosenName = negate ? -1 : anyPhraseAt(ctx, pos, W_CHOSEN_NAME);
  if (chosenName >= 0) out.push({ end: chosenName, frag: { chosen: { link: '$link', quality: 'cardName' } } });
  // power / toughness / mana value with a comparison
  const stats: [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('power'), 'power'], [P('toughness'), 'toughness'], [P('mana value'), 'manaValue']];
  // Standard round 4, r4-trig (CR 208.1): "toughness greater than its power" is the object's own comparison (below), never a comparison with what "its" names
  const ownTgp = negate ? -1 : phraseAt(ctx, pos, P('toughness greater than its power'));
  const ownPet = negate ? -1 : phraseAt(ctx, pos, P('power equal to its toughness')); // edh-next-32: the object's own comparison (below)
  const ownGy = negate ? -1 : phraseAt(ctx, pos, W_MV_AT_MOST_CONTROLLER_GRAVEYARD); // edh-cast-12: the object's own comparison (below), never a quantity with an "its" to resolve
  for (const [ws, field] of stats) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) for (const c of cmpAt(ctx, e)) if (!(field === 'toughness' && c.end === ownTgp) && !(field === 'power' && c.end === ownPet) && !(field === 'manaValue' && c.end === ownGy)) out.push({ end: c.end, frag: wrap({ [field]: c.cmp }), ...(c.weak ? { weak: c.weak } : {}) });
  }
  // edh-next-32 (CR 208.1, 109.1; Mirko, Obsessive Theorist, Body Launderer): the object's own power stands for "its power" in two shortened comparisons: "power less than Mirko's" (the
  // possessive alone) and "equal or lesser power" (not more than the object's)
  const ownPower = { q: 'stat', stat: 'power', of: { ref: 'self' } } as const;
  const lessThanOwn = phraseAt(ctx, pos, W_POWER_LESS_THAN_OWN);
  if (lessThanOwn >= 0) out.push({ end: lessThanOwn, frag: wrap({ power: { op: '<', value: ownPower } }) });
  const equalOrLesser = negate ? -1 : phraseAt(ctx, pos, W_EQUAL_OR_LESSER_POWER);
  if (equalOrLesser >= 0) out.push({ end: equalOrLesser, frag: { power: { op: '<=', value: ownPower } } });
  // edh-perms-8 (CR 202.3; Kozilek's Unsealing): "with mana value 4, 5, or 6", "with mana value 1 or 2": any one of several exact mana values (numbers separated by
  // commas, the last after "or"; a list that does not end with "or" is not read, the comma then ends the clause)
  // edh-next-86 (CR 208.1; Sarkhan's Unsealing): the same list of exact values for power and toughness ("a creature spell with power 4, 5, or 6")
  for (const [listWord, listField] of [[P('mana value'), 'manaValue'], [P('power'), 'power'], [P('toughness'), 'toughness']] as const) {
  const mvList = negate ? -1 : phraseAt(ctx, pos, listWord);
  if (mvList >= 0) {
    const nums: number[] = [];
    for (let p = mvList; ; ) {
      const n = numberAt(ctx, p);
      if (n === undefined) break;
      nums.push(n);
      const sep = normAt(ctx, p + 1) === ',' && normAt(ctx, p + 2) === 'or' ? 2 : normAt(ctx, p + 1) === 'or' ? 1 : normAt(ctx, p + 1) === ',' ? 0 : -1;
      if (sep < 0) break;
      if (sep === 0) { p += 2; continue; }
      const last = numberAt(ctx, p + 1 + sep);
      if (last !== undefined && new Set([...nums, last]).size === nums.length + 1 && nums.length >= 1) {
        out.push({ end: p + 2 + sep, frag: { anyOf: [...nums, last].map((v) => ({ [listField]: { op: '==', value: v } })) } as never });
      }
      break;
    }
  }
  }
  // edh-cast-4 (CR 202.3; Void Winnower): "with even mana value(s)", "with odd mana value(s)": the parity of the mana value (zero is even)
  for (const [ws, parity] of [[W_EVEN_MV, 'even'], [W_ODD_MV, 'odd']] as const) for (const w of ws) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, frag: wrap({ manaValueParity: parity }) }); }
  // FAST5 T42 (CR 113.1): "creature cards with no abilities" (Rise from the Wreck): not one ability of any kind; a keyword is an ability (rules/filter.ts#hasAbilityOfKind),
  // a card with an ability of unknown kind is unevaluable there, so it is never offered as having none
  const noAbilities = negate ? -1 : phraseAt(ctx, pos, W_NO_ABILITIES);
  if (noAbilities >= 0) out.push({ end: noAbilities, frag: { not: { anyOf: [{ hasAbility: 'activated' }, { hasAbility: 'triggered' }, { hasAbility: 'static' }] } } });
  // edh-d-22 (CR 113.1; Jasmine Boreal of the Seven): "creatures with abilities": at least one ability of some kind (the opposite of "no abilities"; same kinds)
  const withAbilities = negate ? -1 : phraseAt(ctx, pos, W_ABILITIES);
  if (withAbilities >= 0) out.push({ end: withAbilities, frag: { anyOf: [{ hasAbility: 'activated' }, { hasAbility: 'triggered' }, { hasAbility: 'static' }] } });
  // FAST5 T42 (CR 202.3): "with lesser mana value" (Jackdaw Savior, Clement, the Worrywort): a mana value lower than that of the object the trigger's event is about
  // (the creature that died or entered, role `subject`); only "with", and only where the ability has such an event (otherwise the sentence is manual)
  const lesser = negate ? -1 : phraseAt(ctx, pos, W_LESSER_MANA_VALUE);
  if (lesser >= 0) out.push({ end: lesser, frag: { manaValue: { op: '<', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'subject' } } } } });
  // edh-c-86 (CR 208.1; Rangers of Ithilien, Gyrus, Shadowfax): "with lesser power" is a power lower than that of the object the trigger's event is about (the object itself in its own enters or attacks trigger), as "with lesser mana value" above; no event, no reading (an ability with none leaves it unresolved: manual)
  const lesserPower = negate || ctx.discourse === undefined ? -1 : phraseAt(ctx, pos, W_LESSER_POWER); // (only in an instruction of an effect: in a trigger's event pattern the event's subject is not yet known, No Quarter)
  if (lesserPower >= 0) out.push({ end: lesserPower, frag: { power: { op: '<', value: { q: 'stat', stat: 'power', of: { ref: 'event', role: 'subject' } } } } });
  // edh-next-86 (CR 208.1, 603.10a; Colfenor, the Last Yew): "with lesser toughness" is a toughness lower than that of the object the trigger's event is about, as "lesser power" above
  const lesserToughness = negate || ctx.discourse === undefined ? -1 : phraseAt(ctx, pos, W_LESSER_TOUGHNESS);
  if (lesserToughness >= 0) out.push({ end: lesserToughness, frag: { toughness: { op: '<', value: { q: 'stat', stat: 'toughness', of: { ref: 'event', role: 'subject' } } } } });
  // edh-next-103 (CR 208.1, 603.10a; Bane, Lord of Darkness): "with equal or lesser toughness" is a toughness at most that of the object the trigger's event is about (the creature that died), as "lesser toughness" above
  const equalOrLesserToughness = negate || ctx.discourse === undefined ? -1 : phraseAt(ctx, pos, W_EQUAL_OR_LESSER_TOUGHNESS);
  if (equalOrLesserToughness >= 0) out.push({ end: equalOrLesserToughness, frag: { toughness: { op: '<=', value: { q: 'stat', stat: 'toughness', of: { ref: 'event', role: 'subject' } } } } });
  // edh-c-45 (CR 202.3, 700.4; Death's Oasis): "with lesser mana value than the creature that died": the same comparison, the creature that died being the event's subject (render/np.ts says it
  // so only in a trigger about a creature dying)
  const lesserDied = negate ? -1 : phraseAt(ctx, pos, W_LESSER_MANA_VALUE_THAN_DIED);
  if (lesserDied >= 0) out.push({ end: lesserDied, frag: { manaValue: { op: '<', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'subject' } } } } });
  // std-rx28 (CR 202.3, 601.2i; Kellan, the Kid): "with equal or lesser mana value" in the effect of a cast trigger: a mana value at most that of the spell the
  // trigger's cast event is about (role `spell`); only "with". Where the ability has no such event (a dies or enters trigger, a spell) the lint refuses the role
  // (model/lint-roles.ts), so the sentence stays manual (fail closed)
  const eqLesser = negate ? -1 : phraseAt(ctx, pos, W_EQUAL_OR_LESSER_MANA_VALUE);
  if (eqLesser >= 0) out.push({ end: eqLesser, frag: { manaValue: { op: '<=', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } } } } });
  // edh-c-66 (CR 202.3, 601.2i; Celestial Kirin): "with that spell's mana value" is the mana value of the spell the cast trigger's event is about (role `spell`), as
  // "with mana value equal to that spell's mana value" says; only "with". Where the ability has no such event the lint refuses the role (model/lint-roles.ts), so the sentence stays manual
  const thatSpellMv = negate ? -1 : phraseAt(ctx, pos, W_THAT_SPELLS_MANA_VALUE);
  if (thatSpellMv >= 0) out.push({ end: thatSpellMv, frag: { manaValue: { op: '==', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } } } } });
  // edh-cast-12 (CR 202.3, 404.1, 608.2b; Drown in the Loch): "with mana value less than or equal to the number of cards in its controller's graveyard": "its" is the object
  // described, so the comparison is the object's own (ObjectFilter.manaValueVsGraveyard) and names no antecedent; only "with"
  const mvGy = negate ? -1 : phraseAt(ctx, pos, W_MV_AT_MOST_CONTROLLER_GRAVEYARD);
  if (mvGy >= 0) out.push({ end: mvGy, frag: { manaValueVsGraveyard: { op: '<=', of: 'controller' } } });
  // edh-next-32 (CR 201.2, 404.1; Dragonlord Kolaghan): "with the same name as a card in their graveyard": the object's own name against its controller's graveyard; only "with"
  const nameGy = negate ? -1 : phraseAt(ctx, pos, P('the same name as a card in their graveyard'));
  if (nameGy >= 0) out.push({ end: nameGy, frag: { nameInGraveyard: { of: 'controller' } } });
  // edh-next-126 (CR 202.3, 608.2h; Light-Paws, Emperor's Voice): "with mana value less than or equal to that Aura": at most the mana value of one object the sentence names (an
  // object it refers back to), as "with lesser mana value than that creature" is less than it; only right after "with"
  const mvAtMostOf = negate || ctx.toks[pos - 1]?.norm !== 'with' ? -1 : phraseAt(ctx, pos, W_MV_AT_MOST_OF);
  if (mvAtMostOf >= 0) {
    for (const o of ctx.call('Obj', mvAtMostOf)) {
      if (isAttachHost(o.value) && (o.value as { ref?: string }).ref === 'bound') out.push({ end: o.end, frag: { manaValue: { op: '<=', value: { q: 'stat', stat: 'manaValue', of: o.value } } } as ObjectFilter });
    }
  }
  // CLOUD std-msh (CR 202.3, 208.1): "with greater mana value than that creature" (Evil's Thrall), "with greater power than ~": more than the statistic of one object
  // the sentence names (this object, or one it refers back to); only "with"
  for (const [w, op] of [['greater', '>'], ['lesser', '<']] as const) {
    if (negate || ctx.toks[pos]?.norm !== w) continue;
    for (const [ws, stat] of [[P('mana value than'), 'manaValue'], [P('power than'), 'power'], [P('toughness than'), 'toughness']] as const) {
      const e = phraseAt(ctx, pos + 1, ws);
      if (e >= 0) for (const o of ctx.call('Obj', e)) if (isAttachHost(o.value) && (o.value as { ref?: string }).ref !== 'attachedTo') out.push({ end: o.end, frag: { [stat]: { op, value: { q: 'stat', stat, of: o.value } } } as ObjectFilter });
    }
  }
  // edh-players-15 (CR 208.1; Éowyn, Fearless Knight): "with greater power" (nothing after it) is more power than this object's own (the object whose ability it is); only "with"
  if (!negate && ctx.toks[pos]?.norm === 'greater' && ctx.toks[pos + 1]?.norm === 'power' && ctx.toks[pos + 2]?.norm !== 'than' && ctx.toks[pos + 2]?.norm !== 'or') {
    // ($greaterBare: lower/links.ts#lowerLinks keeps the reading only in a triggered ability of a creature, where "greater power" is more than that creature's; elsewhere the marker leaves the sentence manual)
    out.push({ end: pos + 2, frag: { power: { op: '>', value: { q: 'stat', stat: 'power', of: { ref: 'self' }, $greaterBare: true } } } as never, weak: 1 }); // weak (design 6.3 rule 2): the templates that own "with greater power" (zz-fast3/t16.json, "~ can't be blocked by creatures with greater power") keep it
  }
  // Standard round 4, r4-trig (CR 702.100a-b, 208.1; Hulkling, Burgeoning Bruiser and evolve's own words): "greater power or toughness than ~" is more power than
  // that object's power OR more toughness than its toughness, each statistic compared with its own (the filter keyword evolve expands to, keywords/data/evolve.json);
  // only "greater", and only "with" / "has" (never "without")
  if (!negate && ctx.toks[pos]?.norm === 'greater') {
    const e = phraseAt(ctx, pos + 1, P('power or toughness than'));
    if (e >= 0) {
      for (const o of ctx.call('Obj', e)) {
        if (!isAttachHost(o.value) || (o.value as { ref?: string }).ref === 'attachedTo') continue;
        const of = o.value as ObjRef;
        out.push({ end: o.end, frag: { anyOf: [{ power: { op: '>', value: { q: 'stat', stat: 'power', of } } }, { toughness: { op: '>', value: { q: 'stat', stat: 'toughness', of } } }] } });
      }
    }
  }
  // Standard round 4, r4-trig (CR 208.1; Fecund Greenshell): "with toughness greater than its power" (its own two values); only "with"
  const tgp = negate ? -1 : phraseAt(ctx, pos, P('toughness greater than its power'));
  if (tgp >= 0) out.push({ end: tgp, frag: { toughnessGreaterThanPower: true } });
  // edh-next-32 (CR 208.1; Symmetry Matrix): "with power equal to its toughness" (its own two values, never a comparison with what "its" names); only "with"
  const pet = negate ? -1 : phraseAt(ctx, pos, P('power equal to its toughness'));
  if (pet >= 0) out.push({ end: pet, frag: { powerEqualsToughness: true } });
  // std-rx10 (CR 208.1; Meek Attack): "with total power and toughness 5 or less", the sum of the object's own power and toughness; only "with"
  const tpt = negate ? -1 : phraseAt(ctx, pos, P('total power and toughness'));
  if (tpt >= 0) for (const c of cmpAt(ctx, tpt)) out.push({ end: c.end, frag: { totalPowerToughness: c.cmp } });
  // edh-next-112 (CR 208.1, 201.2; Wild Pair): "with the same total power and toughness" as the creature the trigger's event is about: its power plus its toughness, equal; only "with" and only the bare
  // wording (the event's subject; a spell or a trigger with no subject reads nothing there)
  const stpt = negate ? -1 : phraseAt(ctx, pos, P('the same total power and toughness'));
  if (stpt >= 0) {
    const of = { ref: 'event', role: 'subject' } as ObjRef;
    out.push({ end: stpt, frag: { totalPowerToughness: { op: '==', value: { q: 'math', op: '+', args: [{ q: 'stat', stat: 'power', of }, { q: 'stat', stat: 'toughness', of }] } } } as never });
  }
  // std-rx11 (CR 208.1, 613.4; Kutzil, Malamet Exemplar; Ms. Marvel, Elastic Ally): "with power greater than its base power" (its own power against its own base
  // power); "their" after a plural noun; only "with"
  const pgb = negate ? -1 : anyPhraseAt(ctx, pos, W_POWER_GREATER_THAN_BASE);
  if (pgb >= 0) out.push({ end: pgb, frag: { powerGreaterThanBase: true } });
  // edh-perms-11 (CR 208.1, 613.4a-b; Sword of the Squeak): "with base power or toughness 1": either base value (after layer 7b) meets the one comparison; only "with"
  const bpt = negate ? -1 : phraseAt(ctx, pos, W_BASE_POWER_OR_TOUGHNESS);
  if (bpt >= 0) for (const c of cmpAt(ctx, bpt)) out.push({ end: c.end, frag: { basePowerOrToughness: c.cmp } });
  // edh-next-23 (CR 208.1, 613.4a-b; Rapid Augmenter): "with base power 1": the base power alone (never beside "base power or toughness", which is read above); only "with"
  const bp1 = negate || bpt >= 0 ? -1 : phraseAt(ctx, pos, W_BASE_POWER);
  if (bp1 >= 0) for (const c of cmpAt(ctx, bp1)) out.push({ end: c.end, frag: { basePower: c.cmp } });
  // edh-next-19 (CR 208.1, 613.4b; Duskana, the Rage Mother): "with base power and toughness 2/2": both base values (after layer 7b) are those numbers (digits only); only "with"
  const bpat = negate ? -1 : phraseAt(ctx, pos, W_BASE_POWER_AND_TOUGHNESS);
  if (bpat >= 0) {
    const t = ctx.toks[bpat];
    const m = t !== undefined && t.kind === 'PT' ? /^(\d+)\/(\d+)$/.exec(t.norm) : null;
    if (m !== null) out.push({ end: bpat + 1, frag: { basePowerAndToughness: { power: Number(m[1]), toughness: Number(m[2]) } } });
  }
  // FAST4 T25: "with power or toughness 4 or greater" (Repel Calamity): either statistic meets the one comparison (CR 208.1); only "with", never "without"
  const pot = negate ? -1 : phraseAt(ctx, pos, W_POWER_OR_TOUGHNESS);
  if (pot >= 0) for (const c of cmpAt(ctx, pot)) out.push({ end: c.end, frag: { anyOf: [{ power: c.cmp }, { toughness: c.cmp }] } });
  // std-rx5 (CR 202.3, 208.1): "with mana value, power, or toughness equal to the chosen number" (Talion, the Kindly Lord): any of the three meets the one comparison
  const mpt = negate ? -1 : phraseAt(ctx, pos, W_MV_POWER_OR_TOUGHNESS);
  if (mpt >= 0) for (const c of cmpAt(ctx, mpt)) out.push({ end: c.end, frag: { anyOf: [{ manaValue: c.cmp }, { power: c.cmp }, { toughness: c.cmp }] } });
  // FAST5 T45 (CR 115.9a): "a spell with a single target" (the number of times anything was chosen as a target); only "with", never "without"
  const st1 = negate ? -1 : phraseAt(ctx, pos, P('a single target'));
  if (st1 >= 0) out.push({ end: st1, frag: { targetCount: { op: '==', value: 1 } } });
  // edh-next-121 (CR 115.9a, 115.1; Wyll's Reversal): "target spell or ability with one or more targets": it chose at least one target; only "with", never "without"
  const st2 = negate ? -1 : phraseAt(ctx, pos, P('one or more targets'));
  if (st2 >= 0) out.push({ end: st2, frag: { targetCount: { op: '>=', value: 1 } } });
  // abilities by kind
  const abil: [string[], 'activated' | 'triggered' | 'mana' | 'static'][] = [[P('an activated ability'), 'activated'], [P('a triggered ability'), 'triggered'], [P('a mana ability'), 'mana']];
  for (const [ws, v] of abil) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: wrap({ hasAbility: v }) }); }
  // edh-d-4 (CR 605.1a; Midnight Arsonist): "artifacts without mana abilities" (the plural, negative only: "with mana abilities" is not printed)
  // edhd36 (CR 605.1a; Power Sink): and positive, "tap all lands with mana abilities they control"
  const manaPlural = phraseAt(ctx, pos, P('mana abilities'));
  if (manaPlural >= 0) out.push({ end: manaPlural, frag: wrap({ hasAbility: 'mana' }) });
  // edh-perms-8 (CR 602.1, 107.5; Magewright's Stone): "an activated ability with {T} in its cost": an activated ability whose cost has the tap symbol (positive only)
  const tapAbil = negate ? -1 : phraseAt(ctx, pos, P('an activated ability with {t} in its cost'));
  if (tapAbil >= 0) out.push({ end: tapAbil, frag: { hasAbility: 'activated', abilityTapCost: true } });
  // edh-c-44 (CR 602.1, 605.1a; Ravager Wurm): "an activated ability that isn't a mana ability" (positive only)
  const notMana = negate ? -1 : phraseAt(ctx, pos, P("an activated ability that isn't a mana ability"));
  if (notMana >= 0) out.push({ end: notMana, frag: { hasAbility: 'activated', abilityNotMana: true } });
  // counters: "a +1/+1 counter on it", "three or more +1/+1 counters on it", "no +1/+1 counters on it"
  const counterCmp = (p: number, cmp: NumberCmp | null): void => {
    if (p < 0) return;
    for (const k of ctx.call('CounterKind', p)) {
      const c = anyPhraseAt(ctx, k.end, W_COUNTERS);
      if (c < 0) continue;
      const on = anyPhraseAt(ctx, c, W_ON_IT);
      const end = on >= 0 ? on : c;
      const counters: { kind: string; cmp?: NumberCmp } = { kind: k.value as string };
      if (cmp !== null) counters.cmp = cmp;
      out.push({ end, frag: wrap({ counters }), ...{} });
    }
  };
  counterCmp(phraseAt(ctx, pos, P('a')) >= 0 ? pos + 1 : -1, null);
  counterCmp(phraseAt(ctx, pos, P('an')) >= 0 ? pos + 1 : -1, null);
  // FAST4 T33 (CR 122.1): "creatures you control with +1/+1 counters on them": one or more counters of that kind (no article, plural, only with "on them")
  if (!negate) for (const k of ctx.call('CounterKind', pos)) { const e = phraseAt(ctx, k.end, W_COUNTERS_ON_THEM); if (e >= 0) out.push({ end: e, frag: { counters: { kind: k.value as string } } }); }
  // edh-c-53 (CR 122.1; Cinderslash Ravager): "permanents you control with oil counters on it": one or more counters of that kind (singular "it", bare plural)
  if (!negate) for (const k of ctx.call('CounterKind', pos)) { const e = phraseAt(ctx, k.end, W_COUNTERS_ON_IT_ANY); if (e >= 0) out.push({ end: e, frag: { counters: { kind: k.value as string } } }); }
  // FAST5 T41 (CR 122.1): "creatures you control with counters on them": a counter of any kind on each (plural, no article)
  if (!negate) { const anyOnThem = phraseAt(ctx, pos, W_COUNTERS_ON_THEM); if (anyOnThem >= 0) out.push({ end: anyOnThem, frag: { counters: { kind: 'any' } } }); }
  // FAST4 T27 (CR 122.1): "a creature with a counter on it": a counter of any kind (kind 'any', rules/filter.ts)
  const anyCounter = phraseAt(ctx, pos, P('a counter on it'));
  if (anyCounter >= 0) out.push({ end: anyCounter, frag: wrap({ counters: { kind: 'any' } }) });
  if (phraseAt(ctx, pos, P('no')) >= 0) counterCmp(pos + 1, { op: '==', value: 0 });
  // FAST5 T59 (CR 122.1): "creature with no counters on it" (Heartless Act): not one counter of any kind (the sum over every kind is 0, rules/filter.ts)
  const noAnyCounter = negate ? -1 : phraseAt(ctx, pos, W_NO_COUNTERS);
  if (noAnyCounter >= 0) out.push({ end: noAnyCounter, frag: { counters: { kind: 'any', cmp: { op: '==', value: 0 } } } });
  // edh-d-48 (CR 122.1; Ayara's Oathsworn): "exactly four +1/+1 counters on it": exactly that many counters of the kind (a number, never a bare number)
  const exactly = phraseAt(ctx, pos, P('exactly'));
  if (exactly >= 0 && !negate) for (const q of ctx.call('Qty', exactly)) if (typeof q.value === 'number') counterCmp(q.end, { op: '==', value: q.value });
  // an explicit comparison ("three or more"); a bare number is not read as "exactly"
  for (const c of cmpAt(ctx, pos)) if (c.cmp.op !== '==') counterCmp(c.end, c.cmp);
  // r4-static (CR 122.1): "three or more counters on it" (Warden of the Inner Sky): counters of any kind together, every counter on it counts (rules/filter.ts)
  // ("one or more counters on it" is FAST5X E21's reading below, a counter of any kind)
  if (!negate) for (const c of cmpAt(ctx, pos)) {
    const oneOrMore = c.cmp.op === '>=' && c.cmp.value === 1;
    const e = c.cmp.op === '==' || oneOrMore ? -1 : phraseAt(ctx, c.end, W_COUNTERS_ON_IT_ANY);
    if (e >= 0) out.push({ end: e, frag: wrap({ counters: { kind: 'any', cmp: c.cmp } }) });
  }
  // FAST5X E21 (CR 122.1): counters of any kind on one object: "with no counters on it" (none of any kind) and "with one or more counters on it" (at
  // least one of any kind, the same as "a counter on it")
  for (const w of W_NO_COUNTERS_ON) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, frag: wrap({ counters: { kind: 'any', cmp: { op: '==', value: 0 } } }) }); }
  // edhn63 (CR 122.1; Cleopatra, Exiled Pharaoh): "a legendary creature with counters on it": a counter of any kind, as "one or more counters on it"
  if (!negate) { const bare = phraseAt(ctx, pos, W_COUNTERS_ON_IT_ANY); if (bare >= 0) out.push({ end: bare, frag: { counters: { kind: 'any' } } }); }
  if (!negate) {
    const oneOrMore = phraseAt(ctx, pos, W_ONE_OR_MORE_COUNTERS_ON_IT);
    if (oneOrMore >= 0) out.push({ end: oneOrMore, frag: { counters: { kind: 'any' } } });
  }
  // std-sos (CR 107.3, 202.1): "with {X} in its mana cost": the mana cost has the symbol {X} (rules/filter.ts reads `manaCostHasX` from the printed cost; the
  // spending restrictions of parser/holes/spend.ts read the same words into the same field). Only "with", never "without" (Oracle prints none)
  if (!negate) for (const w of W_X_IN_MANA_COST) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, frag: { manaCostHasX: true } }); }
  // Standard round 5, r5-trig (CR 107.4, 202.1; Namor the Sub-Mariner): "with one or more blue mana symbols in its mana cost": the symbols of that color in its mana cost
  // (an explicit "N or more"; only "with")
  if (!negate) for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
    for (const [color, w] of W_COLOR_SYMBOLS_IN_COST) {
      const e = phraseAt(ctx, c.end, w);
      if (e >= 0) out.push({ end: e, frag: { manaSymbols: { color, cmp: c.cmp as NumberCmp } } });
    }
  }
  // edh-zones-6 (CR 202.1, 202.1b; Urza's Saga): "with mana cost {0} or {1}": the printed cost is exactly one of the listed ones (a land has none); only "with"
  if (!negate) {
    const at = phraseAt(ctx, pos, P('mana cost'));
    if (at >= 0) {
      const costs: string[] = [];
      let p = at;
      for (;;) {
        let cost = '';
        while (ctx.toks[p]?.kind === 'MANA' && ctx.toks[p]!.norm !== '{e}') cost += ctx.toks[p++]!.norm.toUpperCase();
        if (cost === '' || costs.includes(cost)) break;
        costs.push(cost);
        if (phraseAt(ctx, p, P('or')) >= 0) p++;
        else break;
      }
      if (costs.length > 0 && costs.length <= 2 && costs.every((c) => /^(\{[0-9WUBRGCSX]\})+$/.test(c))) out.push({ end: p, frag: { manaCostIs: costs } });
    }
  }
  return out;
}

export function playerOfSharing(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  for (const s of W_SHARES) {
    const sh = phraseAt(ctx, pos, s);
    if (sh < 0) continue;
    const a = phraseAt(ctx, sh, P('a')) >= 0 ? sh + 1 : phraseAt(ctx, sh, P('an')) >= 0 ? sh + 1 : -1;
    if (a < 0) continue;
    for (const [ws, quality] of KINDS) {
      const e = phraseAt(ctx, a, ws);
      const w = e >= 0 ? phraseAt(ctx, e, P('with')) : -1;
      if (w < 0) continue;
      for (const o of ctx.call('Obj', w)) out.push({ end: o.end, frag: { sharesWith: { with: o.value as never, quality } }, ...(o.flags ? { flags: o.flags } : {}) });
      // edh-next-145 (CR 205.3m, 602.2b, 608.2c; Cryptic Gateway): "shares a creature type with each creature tapped this way": with every creature the ability's tap cost tapped
      // (`costTapped`; model/lint-nodes.ts keeps it to an activated ability whose cost taps untapped creatures)
      const eachTapped = phraseAt(ctx, w, W_EACH_CREATURE_TAPPED_THIS_WAY);
      if (eachTapped >= 0 && quality !== 'name') out.push({ end: eachTapped, frag: { sharesWith: { with: { ref: 'costTapped' }, quality, each: true } } });
      // pc-keywords-mana-2 (CR 903.3d, 903.3e, 205.3m; Path of Ancestry): "shares a creature type with your commander": a commander you own (either one with two), the set form of
      // `sharesWith` ("some object of it", rules/filter.ts) over the commander wherever it is (the command zone most of the time, CR 903.6); no commander, no match
      // edh-zones-5 (CR 105.2c, 205.2, 608.2b; Ringsight): "a card that shares a color with a legendary creature you control": with some one object of a described set ("a <noun phrase>",
      // as std-hob's "the same name as a legendary permanent you control"; rules/filter.ts reads a set as "some object of it", so a colorless card shares no color with anything)
      const wt = ctx.toks[w]?.norm;
      if ((wt === 'a' || wt === 'an') && quality !== 'name') {
        for (const n of npAlts(ctx, w + 1)) {
          if (n.number !== 'singular' || n.flags.some((x) => x !== 'zone-unstated')) continue;
          out.push({ end: n.end, frag: { sharesWith: { with: { ref: 'each', filter: n.filter }, quality } }, ...(n.weak ? { weak: n.weak } : {}) });
        }
      }
      for (const c of yourCommanderAt(ctx, w)) if (c.number === 'singular') out.push({ end: c.end, frag: { sharesWith: { with: { ref: 'each', filter: { ...c.filter, zone: ['battlefield', 'command', 'stack', 'exile', 'hand', 'graveyard', 'library'] } }, quality } } });
    }
  }
  return out;
}

/** edh-combat-2: an Aura (CR 303.4b) or an Equipment (CR 301.5) is attached to it; src/render/np.ts says it "that's enchanted or equipped". */
const ENCHANTED_OR_EQUIPPED: ObjectFilter = { anyOf: [{ enchanted: true }, { equipped: true }] };

/** edh-c-18 (CR 509.1h): a creature that blocked or was blocked; render/np.ts says it "that blocked or was blocked this turn". */
const BLOCKED_OR_WAS_BLOCKED: ObjectFilter = { anyOf: [{ blockedThisTurn: true }, { wasBlockedThisTurn: true }] };

const REL: [string[], ObjectFilter][] = [
  // edh-next-100 (CR 601.2a, 707.10; Wash Away): "target spell that wasn't cast from its owner's hand": not cast from a hand (a copy of a spell was never cast, so it counts); render/np.ts says it
  [P("wasn't cast from its owner 's hand"), { not: { castFrom: 'hand' } }],
  [P('was dealt damage this turn'), { dealtDamageThisTurn: true }], [P('were dealt damage this turn'), { dealtDamageThisTurn: true }],
  // edh-c-61 (CR 120.1, 120.3; Giant Shark): the perfect, "a creature that has been dealt damage this turn" (family dealt-damage-participle)
  [P('has been dealt damage this turn'), { dealtDamageThisTurn: true }], [P('have been dealt damage this turn'), { dealtDamageThisTurn: true }],
  [P('dealt damage this turn'), { dealtDamageAsSourceThisTurn: true }], // std-mkm (CR 120.1): "a creature that dealt damage this turn" (the object as the damage's source)
  // edh-players-9 (CR 120.1, 510.2): "a creature that dealt combat damage to you this turn" (Witch-king of Angmar), "... dealt damage to you this turn": to the controller
  [P('dealt damage to you this turn'), { dealtDamageToYouThisTurn: 'any' }], [P('dealt combat damage to you this turn'), { dealtDamageToYouThisTurn: 'combat' }],
  [P('attacked this turn'), { attackedThisTurn: true }], [P('blocked this turn'), { blockedThisTurn: true }],
  // edh-next-139 (CR 701.14a, 400.7; Boxing Ring): "a creature that fought this turn": this object fought this turn (by any effect; as this object)
  [P('fought this turn'), { foughtThisTurn: true }],
  // edh-c-18 (CR 509.1h, 506.4; Heat Stroke): "creatures that blocked or were blocked this turn": was declared as a blocker, or became blocked
  [P('was blocked this turn'), { wasBlockedThisTurn: true }], [P('were blocked this turn'), { wasBlockedThisTurn: true }],
  [P('blocked or was blocked this turn'), BLOCKED_OR_WAS_BLOCKED], [P('blocked or were blocked this turn'), BLOCKED_OR_WAS_BLOCKED],
  // p2-damage-2 (CR 508.1a): "creatures that player controls that didn't attack this turn" (Kratos, God of War): never declared as an attacker this turn
  [P("didn't attack this turn"), { attackedThisTurn: false }],
  // edh-next-89 (CR 508.1a, 400.7; The Fifth Doctor): "each creature you control that didn't attack or enter this turn": both negations on one object
  [P("didn't attack or enter this turn"), { attackedThisTurn: false, enteredThisTurn: false }],
  // p2-damage-3 (CR 303.4b): "all creatures that aren't enchanted" (Winds of Rath), "target creature that isn't enchanted" (Brainspoil): no Aura is attached to it
  [P("isn't enchanted"), { enchanted: false }], [P("aren't enchanted"), { enchanted: false }],
  // edh-c-20 (CR 303.4b; Infiltrator's Magemark): "creatures you control that are enchanted": an Aura is attached to each (plural only)
  [P('are enchanted'), { enchanted: true }],
  // edh-combat-2 (CR 303.4b, 301.5; Halvar, God of Battle): "creatures you control that are enchanted or equipped": an Aura or an Equipment is attached to it (either one)
  [P('is enchanted or equipped'), ENCHANTED_OR_EQUIPPED], [P('are enchanted or equipped'), ENCHANTED_OR_EQUIPPED],
  // edh-next-8 (CR 301.5; Hexgold Hoverwings, Long-Lost Lances): "creatures you control that are equipped", an Equipment is attached to each (the adjective "equipped creatures you control" says the same)
  [P('are equipped'), { equipped: true }],
  [P('is enchanted'), { enchanted: true }], // edh-c-55 (CR 303.4b; Necromancer's Magemark): "a creature you control that is enchanted" (the plural "that are enchanted" is edh-c-20's)
  [P('entered the battlefield this turn'), { enteredThisTurn: true }], [P('entered this turn'), { enteredThisTurn: true }],
  // edh-b-4 (CR 400.7; Let the Galaxy Burn): "each creature that didn't enter this turn": no entry onto the battlefield this turn (render/np.ts says it for `enteredThisTurn: false`)
  [P("didn't enter the battlefield this turn"), { enteredThisTurn: false }], [P("didn't enter this turn"), { enteredThisTurn: false }],
  // r3-choose (CR 400.7): "a card in your graveyard that was put there from anywhere this turn" (render/np.ts says it only after a named zone)
  [P('was put there from anywhere this turn'), { putThereThisTurn: true }], [P('were put there from anywhere this turn'), { putThereThisTurn: true }],
  // r5-fxz (CR 400.7): "... that were put there from the battlefield this turn" (Supper for Spiders); "that was put there this turn" is from anywhere
  [P('was put there from the battlefield this turn'), { putThereThisTurn: true, putThereFrom: 'battlefield' }], [P('were put there from the battlefield this turn'), { putThereThisTurn: true, putThereFrom: 'battlefield' }],
  // edh-c-61 (CR 400.3, 700.4; Fell Shepherd): "creature cards that were put into your graveyard from the battlefield this turn": the cards you own that were put there from the battlefield this turn (family put-into-your-graveyard-from-battlefield)
  [P('was put into your graveyard from the battlefield this turn'), { zone: 'graveyard', owner: 'you', putThereThisTurn: true, putThereFrom: 'battlefield' }], [P('were put into your graveyard from the battlefield this turn'), { zone: 'graveyard', owner: 'you', putThereThisTurn: true, putThereFrom: 'battlefield' }],
  // edh-next-116 (CR 400.7, 506.1; Storrev, Devkarin Lich): "a creature card in your graveyard that wasn't put there this combat"
  [P("wasn't put there this combat"), { putThereThisCombat: false }], [P("weren't put there this combat"), { putThereThisCombat: false }], [P('was put there this combat'), { putThereThisCombat: true }], [P('were put there this combat'), { putThereThisCombat: true }],
  [P('was put there this turn'), { putThereThisTurn: true }], [P('were put there this turn'), { putThereThisTurn: true }],
  // edh-zones-22 (CR 400.7, 404.1, 701.17a; Captain N'ghathrod): "... a card in an opponent's graveyard that was put there from their library this turn": the card's owner's library
  [P('was put there from their library this turn'), { putThereThisTurn: true, putThereFrom: 'library' }], [P('were put there from their library this turn'), { putThereThisTurn: true, putThereFrom: 'library' }],
  // edh-next-59 (CR 400.7, 404.1; Banon, the Returners' Leader): "... in your graveyard that were put there from anywhere other than the battlefield this turn"
  [P('were put there from anywhere other than the battlefield this turn'), { putThereThisTurn: true, putThereFrom: 'notBattlefield' }],
  // edh-top-13 (CR 701.17a, 400.7; Tato Farmer): "a land card in a graveyard that was milled this turn": put into a graveyard from a library this turn (not any card put there from a library: Scryfall ruling 2024-03-08, a card put into a graveyard from a library without the word "mill" is not milled)
  // edh-d-85 (CR 701.9a, 400.7, 404.1; Ghost of Ramirez DePietro): "a card in a graveyard that was discarded or put there from a library this turn" (either move this turn)
  [P('was discarded or put there from a library this turn'), { putThereThisTurn: true, putThereFrom: 'discardOrLibrary' }],
  [P('was milled this turn'), { putThereThisTurn: true, putThereFrom: 'mill' }], [P('were milled this turn'), { putThereThisTurn: true, putThereFrom: 'mill' }],
  // edh-d-102 (CR 701.9a, 702.29a, 400.7; Shadow of the Grave, ruling 2017-04-18): "all cards in your graveyard that you cycled or discarded this turn": a card its owner discarded this turn, for any
  // reason (cycling discards the card); a madness card put into the graveyard from exile after it was discarded counts too
  [P('you cycled or discarded this turn'), { putThereThisTurn: true, putThereFrom: 'discard' }], [P('you discarded this turn'), { putThereThisTurn: true, putThereFrom: 'discard' }],
  // FAST5X E3 (CR 702.171c): "a creature that saddled it this turn" ("it" is the Mount with the ability: only its own abilities say it)
  [P('saddled it this turn'), { saddledThisTurn: { ref: 'self' } }], [P('saddled ~ this turn'), { saddledThisTurn: { ref: 'self' } }],
  // r5-static (CR 201.2a, 708.2a): "creatures that don't have a name" (a face-down creature has none)
  [P("don't have a name"), { nameless: true }], [P("doesn't have a name"), { nameless: true }],
  // r5-fxb (CR 702.122): "target creature that crewed it this turn" ("it" is the Vehicle with the ability: only its own abilities say it)
  [P('crewed it this turn'), { crewedThisTurn: { ref: 'self' } }], [P('crewed ~ this turn'), { crewedThisTurn: { ref: 'self' } }],
  // r5-fxb (CR 603.10a, 301.5): "an Equipment that was attached to ~" (~ has left the battlefield: its last known information)
  [P('was attached to ~'), { wasAttachedTo: { ref: 'self' } }],
  // edh-zones-3 (CR 205.4a, 700.6): "all nonland permanents that aren't legendary" (Urza's Ruinous Blast), "each nonland permanent that's not historic" (Desynchronization): not
  // legendary; not historic is none of an artifact, a legendary permanent or a Saga (the negation of the three kinds `historic` lists)
  ...['isn\'t', 'aren\'t', 'is not', 'are not'].flatMap((neg): [string[], ObjectFilter][] => [[P(`${neg} legendary`), NOT_LEGENDARY], [P(`${neg} historic`), NOT_HISTORIC]]),
  [P('targets ~'), { targets: { ref: 'self' } }], [P('target ~'), { targets: { ref: 'self' } }], [P('targets you'), { targets: { ref: 'you' } }],
];

const W_TARGETS_A = P('targets');
/** edh-d-92: the controller phrases a targeted noun may end with ("a creature you don't control"). */
const CONTROL_TAILS = [P("you don't control"), P('you control'), P('an opponent controls'), P('your opponents control')];
const W_ONE_OR_MORE = P('one or more'); // std-rx28
const W_OR_PLAYER = P('or player'); // std-rx28

/** The keys an item of "that are ..." may carry: kinds of card or permanent only (the head word "cards" adds `isCard`, which the outer noun phrase already says). */
// p2-pt-3 (CR 111.1): and tokens, "creatures you control that are Zombies and/or tokens" (a token is a kind of permanent here)
const ARE_ITEM_KEYS = new Set(['types', 'subtypes', 'allTypes', 'anyOf', 'isCard', 'token']);
const W_AN_ADVENTURE = P('an adventure');
const W_ARE_SEPS = [P(', and/or'), P('and/or'), P(', and'), P(', or'), P('or'), P(',')];

/**
 * FAST5 T49 (CR 205.2a, 715.1): "that are instant cards, sorcery cards, and/or have an Adventure", "that are creatures and/or Vehicles": one of several kinds
 * of card or permanent, or a card that has an Adventure. A list of kinds (each a plural noun phrase of card types or subtypes, or "have an Adventure") any of
 * which the object is, as `anyOf`.
 */
function areList(ctx: HoleCtx, pos: number): Frag[] {
  if (ctx.toks[pos]?.norm !== 'are') return [];
  const out: Frag[] = [];
  const items = (p: number): { end: number; f: ObjectFilter[] }[] => {
    const r: { end: number; f: ObjectFilter[] }[] = [];
    if (ctx.toks[p]?.norm === 'have') { const e = phraseAt(ctx, p + 1, W_AN_ADVENTURE); if (e >= 0) r.push({ end: e, f: [{ adventure: true }] }); }
    for (const n of npAlts(ctx, p)) {
      if (n.number !== 'plural' || n.head === 'ability' || n.head === 'spell') continue;
      if (Object.keys(n.filter).some((k) => !ARE_ITEM_KEYS.has(k))) continue;
      const { isCard: _isCard, ...kinds } = n.filter;
      if (Object.keys(kinds).length === 0) continue;
      r.push({ end: n.end, f: kinds.anyOf !== undefined && Object.keys(kinds).length === 1 ? kinds.anyOf : [kinds] });
    }
    return r;
  };
  const walk = (p: number, acc: ObjectFilter[], depth: number): void => {
    for (const it of items(p)) {
      const next = [...acc, ...it.f];
      if (next.length >= 2) out.push({ end: it.end, frag: { anyOf: next } });
      if (depth < 4) for (const sep of W_ARE_SEPS) {
        const e = phraseAt(ctx, it.end, sep);
        if (e < 0) continue;
        walk(e, next, depth + 1);
        // edh-d-102 (CR 205.2a, 715.1; Candlekeep Inspiration): "that are instant cards, are sorcery cards, and/or have an Adventure": the verb said again before a later kind
        if (ctx.toks[e]?.norm === 'are' && ctx.toks[e + 1]?.norm !== 'have') walk(e + 1, next, depth + 1);
      }
    }
  };
  walk(pos + 1, [], 0);
  return out;
}

const W_KIND_SEPS = [P(', or'), P('or'), P(','), P(', and/or'), P('and/or')]; // edh-next-68 (Solemn Doomguide): "that's a Cleric, Rogue, Warrior, and/or Wizard" ("and/or" is "or", CR 205.3m)

/**
 * std-re (CR 205.3m, 111.1): "each creature you control that's a Wolf or a Werewolf", "... that's a token or a Rabbit": a singular object that is one of two or
 * three kinds, each a subtype or "token" with its own article ("a Zombie or Mutant" leaves out the later ones), as `anyOf` (the singular of `areList`; card types
 * after "that's" are not read here).
 */
function thatsKinds(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  const item = (p: number, first: boolean): { end: number; f: ObjectFilter }[] => {
    const art = ctx.toks[p]?.norm;
    const q = art === 'a' || art === 'an' ? p + 1 : first ? -1 : p;
    if (q < 0) return [];
    if (ctx.toks[q]?.kind === 'WORD' && ctx.toks[q]!.norm === 'token') return [{ end: q + 1, f: { token: true } }];
    return multiAt(ctx, q, ctx.vocab.subtypes).filter((m) => !m.entry.plural || m.entry.both === true).map((m) => ({ end: m.end, f: { subtypes: [m.entry.name] } }));
  };
  // `closed`: the separator before this item was "or" (", or"), which ends the list
  const walk = (p: number, acc: ObjectFilter[], closed: boolean): void => {
    for (const it of item(p, acc.length === 0)) {
      if (acc.some((a) => JSON.stringify(a) === JSON.stringify(it.f))) continue;
      const next = [...acc, it.f];
      if (closed) { out.push({ end: it.end, frag: { anyOf: next } }); continue; }
      // p2-pt-2 (CR 205.3m): up to five kinds, "that's a Cat, Elemental, Nightmare, Dinosaur, or Beast" (was three)
      if (next.length < 5) for (const sep of W_KIND_SEPS) { const e = phraseAt(ctx, it.end, sep); if (e >= 0) walk(e, next, sep !== W_KIND_SEPS[2]); }
    }
  };
  walk(pos, [], false);
  return out;
}

const W_A_AN = [P('a'), P('an')];

/**
 * edh-zones-19 (CR 205.2a, 205.3; Ao, the Dawn Sky): "each permanent you control that's a creature or Vehicle": a permanent that is one of a card type and a subtype
 * (a mix of the two, `anyOf`, the kinds thatsKinds and thatsCardTypes each read alone), the second kind without an article. Two items only, the type first.
 */
function thatsTypeOrSubtype(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  for (const ws of W_A_AN) {
    const p = phraseAt(ctx, pos, ws);
    if (p < 0) continue;
    const ty = ctx.toks[p]?.kind === 'WORD' ? ctx.vocab.types.get(ctx.toks[p]!.norm) : undefined;
    if (ty === undefined || ty.plural) continue;
    const q = phraseAt(ctx, p + 1, P('or'));
    if (q < 0) continue;
    const art = ctx.toks[q]?.norm;
    const from = art === 'a' || art === 'an' ? q + 1 : q;
    for (const m of multiAt(ctx, from, ctx.vocab.subtypes)) {
      if (m.entry.plural && m.entry.both !== true) continue;
      out.push({ end: m.end, frag: { anyOf: [{ types: [ty.name] }, { subtypes: [m.entry.name] }] } });
    }
  }
  return out;
}


/**
 * edh-d-76 (CR 205.2a, 202.3; Desdemona, Freedom's Edge): "target creature card in your graveyard that's an artifact or that has mana value 3 or less": a card type or a mana value
 * comparison after "that's" (`anyOf` of the two, the shared words in front; the type first). One card type, a singular article, and "that has mana value" for the second option.
 */
function thatsTypeOrMv(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  for (const ws of W_A_AN) {
    const p = phraseAt(ctx, pos, ws);
    if (p < 0) continue;
    const ty = ctx.toks[p]?.kind === 'WORD' ? ctx.vocab.types.get(ctx.toks[p]!.norm) : undefined;
    if (ty === undefined || ty.plural) continue;
    const q = phraseAt(ctx, p + 1, P('or that has mana value'));
    if (q < 0) continue;
    for (const c of cmpAt(ctx, q)) out.push({ end: c.end, frag: { anyOf: [{ types: [ty.name] }, { manaValue: c.cmp }] } });
  }
  return out;
}

/**
 * edh-zones-12 (CR 205.2a, 700.6; family card-thats-types; Mizzix's Mastery): "target card that's an instant or sorcery" is a card with either of two or more card
 * types after "that's" (the singular only; one type alone, a subtype or a generic head word after the article are other readings and stay manual here). Weak
 * (design 6.3 rule 2): a template that already spells the words out keeps its sentence.
 */
function thatsCardTypes(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  for (const ws of W_A_AN) {
    const p = phraseAt(ctx, pos, ws);
    if (p < 0) continue;
    for (const h of headAt(ctx, p)) {
      if (h.head !== 'type' || h.number !== 'singular' || h.frag.types === undefined || h.frag.types.length < 2 || Object.keys(h.frag).some((k) => k !== 'types')) continue;
      out.push({ end: h.end, frag: { types: h.frag.types }, weak: 1 });
    }
  }
  return out;
}


const W_CARD_WORD = P('card');
const W_A_CARD_THAT_HAS_AN_ADVENTURE = P('a card that has an adventure');
/**
 * edh-d-17 (CR 205.2a, 715.1; Sailors' Bane): "each card you own in exile and in your graveyard that's an instant card, a sorcery card, or a card that has an Adventure": a card that is
 * one of a list of card types, each said with its own article and "card", the list closed by ", or" and ending in "a card that has an Adventure" (or in a third card type). Weak
 * (design 6.3 rule 2): a template that spells the words out keeps its sentence. Not for fewer than three items (two card types are `thatsCardTypes`).
 */
function thatsCardList(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  const item = (p: number): { end: number; f: ObjectFilter }[] => {
    const r: { end: number; f: ObjectFilter }[] = [];
    const adv = phraseAt(ctx, p, W_A_CARD_THAT_HAS_AN_ADVENTURE);
    if (adv >= 0) r.push({ end: adv, f: { adventure: true } });
    for (const ws of W_A_AN) {
      const a = phraseAt(ctx, p, ws);
      if (a < 0) continue;
      for (const h of headAt(ctx, a)) {
        if (h.head !== 'type' || h.number !== 'singular' || h.frag.types?.length !== 1 || Object.keys(h.frag).some((k) => k !== 'types')) continue;
        const c = phraseAt(ctx, h.end, W_CARD_WORD);
        if (c >= 0) r.push({ end: c, f: { types: h.frag.types } });
      }
    }
    return r;
  };
  const walk = (p: number, acc: ObjectFilter[]): void => {
    for (const it of item(p)) {
      if (acc.some((x) => JSON.stringify(x) === JSON.stringify(it.f))) continue;
      const next = [...acc, it.f];
      if (next.length >= 2) {
        for (const ws of [P(', or'), P('or')]) { const e = phraseAt(ctx, it.end, ws); if (e >= 0) for (const last of item(e)) { const all = [...next, last.f]; if (all.length >= 3 && !acc.some((x) => x.adventure === true) && it.f.adventure !== true && new Set(all.map((x) => JSON.stringify(x))).size === all.length) out.push({ end: last.end, frag: { anyOf: all }, weak: 1 }); } }
      }
      if (next.length < 3 && it.f.adventure !== true) { const e = phraseAt(ctx, it.end, P(',')); if (e >= 0) walk(e, next); }
    }
  };
  walk(pos, []);
  return out;
}

const W_OR_ARE_NAMED = P('or are named');

/**
 * r5-mech (CR 201.2, 205.3m): "cards ... that are Oozes or are named Slime Against Humanity": a card that has the subtype (one plural noun phrase of subtypes
 * only, as `areList` reads them) or has that name, one of the two (`anyOf`).
 */
function areOrNamed(ctx: HoleCtx, pos: number): Frag[] {
  if (ctx.toks[pos]?.norm !== 'are') return [];
  const out: Frag[] = [];
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'plural' || n.head === 'ability' || n.head === 'spell' || n.flags.some((x) => x !== 'zone-unstated')) continue;
    const { isCard: _isCard, ...kinds } = n.filter;
    if (Object.keys(kinds).length !== 1 || kinds.subtypes === undefined) continue;
    const e = phraseAt(ctx, n.end, W_OR_ARE_NAMED);
    if (e < 0) continue;
    for (const nm of ctx.call('Name', e)) out.push({ end: nm.end, frag: { anyOf: [kinds, { name: nm.value as string }] }, weak: nm.weak ?? 0 });
  }
  return out;
}

const W_DOESNT_SHARE = [P("doesn't share"), P("don't share")]; // edh-next-41

/**
 * edh-next-41 (CR 205.3m, 608.2c; Radagast the Brown): "a creature card that doesn't share a creature type with a creature you control": no creature type of the object is a
 * creature type of any object of the described set (`not` of the set form of `sharesWith`, rules/filter.ts reads a set as "some object of it"; a changeling shares every
 * creature type, a card with no creature type shares none). Only the creature type (the one quality the cards print this way) and a singular noun phrase after "a" / "an".
 */
function notSharesCreatureType(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  for (const ws of W_DOESNT_SHARE) {
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    const a = phraseAt(ctx, e, P('a'));
    if (a < 0) continue;
    const k = phraseAt(ctx, a, P('creature type'));
    const w = k >= 0 ? phraseAt(ctx, k, P('with')) : -1;
    const t = w >= 0 ? ctx.toks[w]?.norm : undefined;
    if (t !== 'a' && t !== 'an') continue;
    for (const n of npAlts(ctx, w + 1)) {
      if (n.number !== 'singular' || n.flags.some((x) => x !== 'zone-unstated')) continue;
      out.push({ end: n.end, frag: { not: { sharesWith: { with: { ref: 'each', filter: n.filter }, quality: 'creatureType' } } }, ...(n.weak ? { weak: n.weak } : {}) });
      // edh-next-130 (CR 205.3m; Volo, Guide to Monsters): "... with a creature you control or a creature card in your graveyard": with no object of EITHER description (the set of both)
      const or = anyPhraseAt(ctx, n.end, [P('or a'), P('or an')]);
      if (or >= 0) for (const m of npAlts(ctx, or)) {
        if (m.number !== 'singular' || m.flags.some((x) => x !== 'zone-unstated')) continue;
        const weak = (n.weak ?? 0) + (m.weak ?? 0);
        out.push({ end: m.end, frag: { not: { sharesWith: { with: { ref: 'each', filter: { anyOf: [n.filter, m.filter] } }, quality: 'creatureType' } } }, ...(weak ? { weak } : {}) });
      }
    }
  }
  return out;
}

const W_DOESNT_HAVE_SAME_NAME_AS = [P("doesn't have the same name as"), P("don't have the same name as")];

/**
 * cloud std-dsk (CR 201.2, 709.5): "a Room card that doesn't have the same name as a Room you control": no name of the object is a name of any object of the
 * described set (`not` of the set form of `sharesWith`, rules/filter.ts reads a set as "some object of it"; a Room permanent has only the names of its unlocked
 * halves, rules/base-parts/room.ts). The description compared with is one singular noun phrase after "a" / "an".
 */
function notSameNameAs(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  for (const ws of W_DOESNT_HAVE_SAME_NAME_AS) {
    const e = phraseAt(ctx, pos, ws);
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    // r5-static (CR 201.2a): "... that don't have the same name as ~" (the object itself)
    if (t === '~') out.push({ end: e + 1, frag: { not: { sharesWith: { with: { ref: 'self' }, quality: 'name' } } } });
    // std-rx32 (CR 201.2): "... that doesn't have the same name as another permanent you control" (Yenna, Redtooth Regent): the object itself is not compared with
    if (t !== 'a' && t !== 'an' && t !== 'another') continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.flags.some((x) => x !== 'zone-unstated')) continue;
      out.push({ end: n.end, frag: { not: { sharesWith: { with: { ref: 'each', filter: n.filter }, quality: 'name', ...(t === 'another' ? { other: true as const } : {}) } } }, ...(n.weak ? { weak: n.weak } : {}) });
    }
  }
  return out;
}

const W_YOUVE_PUT_ONE_OR_MORE = P("you've put one or more");
const W_COUNTERS_ON_THIS_TURN = P('counters on this turn');
const W_YOUVE_PUT_A_COUNTER_ON_THIS_TURN = P("you've put a counter on this turn"); // trek-14

/**
 * edh-c-27 (CR 105.2, 205.2a; Glistening Deluge): "creatures that are green and/or white": the objects that are any of the colors listed ("and/or" is "or", the same filter as
 * "green or white creatures", `colors`); plural only ("that are"), the colors by name.
 */
function areColors(ctx: HoleCtx, pos: number): Frag[] {
  if (ctx.toks[pos]?.norm !== 'are') return [];
  return colorMod(ctx, pos + 1).filter((c) => (c.frag.colors?.length ?? 0) >= 2).map((c) => ({ end: c.end, frag: c.frag }));
}

function relClause(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  out.push(...areList(ctx, pos)); // FAST5 T49
  out.push(...areColors(ctx, pos)); // edh-c-27
  out.push(...areOrNamed(ctx, pos)); // r5-mech
  for (const [ws, f] of REL) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: f }); }
  // std-rx12 (CR 122.6, 400.7): "each creature you control that you've put one or more +1/+1 counters on this turn" (Kid Loki): counters of that kind you put on it
  // this turn (the history's `by`, as CLOUD std-msh's "you've put one or more +1/+1 counters on ~ this turn")
  const putOn = phraseAt(ctx, pos, W_YOUVE_PUT_ONE_OR_MORE);
  if (putOn >= 0) {
    for (const k of ctx.call('CounterKind', putOn)) {
      const e = phraseAt(ctx, k.end, W_COUNTERS_ON_THIS_TURN);
      if (e >= 0) out.push({ end: e, frag: { countersPutThisTurn: { kind: k.value as never, by: 'you' } } });
    }
  }
  // trek-14 (CR 122.6, 400.7; La Forge, Thoughtful as Ever): "each permanent you control that you've put a counter on this turn": a counter of any kind you put on it this turn
  const putAny = phraseAt(ctx, pos, W_YOUVE_PUT_A_COUNTER_ON_THIS_TURN);
  if (putAny >= 0) out.push({ end: putAny, frag: { countersPutThisTurn: { kind: 'any', by: 'you' } } });
  out.push(...playerOfSharing(ctx, pos));
  for (const verb of ['has', 'have']) {
    if (ctx.toks[pos]?.norm === verb) for (const f of featureAtAll(ctx, pos + 1, false)) out.push({ end: f.end, frag: f.frag });
  }
  // r4-static (CR 715.1): "target card that has an Adventure" (Edgewall Inn), FAST5 T49's adventurer card
  if (ctx.toks[pos]?.norm === 'has') { const e = phraseAt(ctx, pos + 1, W_AN_ADVENTURE); if (e >= 0) out.push({ end: e, frag: { adventure: true } }); }
  // std-re (CR 715.1): and the plural, "put all cards that have an Adventure from among the milled cards into your hand" (Seek Thrills); weak (design 6.3 rule 2),
  // so r4-cost's fixed "<spells> you cast that have an Adventure cost {1} less to cast" keeps its sentence
  if (ctx.toks[pos]?.norm === 'have') { const e = phraseAt(ctx, pos + 1, W_AN_ADVENTURE); if (e >= 0) out.push({ end: e, frag: { adventure: true }, weak: 1 }); }
  out.push(...notSameNameAs(ctx, pos)); // cloud std-dsk
  out.push(...notSharesCreatureType(ctx, pos)); // edh-next-41
  out.push(...controlForms(ctx, pos));
  // CLOUD C5 (CR 607.2d, 608.2c): "Destroy all creatures that aren't of the chosen type" (Kindred Dominance): not of the type the linked choice chose
  const neg = ctx.toks[pos]?.norm;
  if (neg === "aren't" || neg === "isn't") for (const c of chosenOf(ctx, pos + 1)) out.push({ end: c.end, frag: { not: { chosen: c.value as NonNullable<ObjectFilter['chosen']> } } });
  // edhd60 (CR 707.10, 601.2a; Errant, Street Artist): "a spell that wasn't cast": a spell on the stack that was never cast (a copy put on the stack; a copy of a card that is cast WAS cast, CR 707.12)
  // D bundle 23: not before "from" ("that wasn't cast from its owner's hand" is edh-next-100's castFrom reading, Wash Away; read both and the sentence was ambiguous)
  { const wc = phraseAt(ctx, pos, P("wasn't cast")); if (wc >= 0 && ctx.toks[wc]?.norm !== 'from') out.push({ end: wc, frag: { uncast: true } }); }
  // FAST4 T23 (CR 115.9b): "a spell that targets a creature": one of its targets is an object of that description (rules/filter.ts reads `targets`)
  const tg = phraseAt(ctx, pos, W_TARGETS_A);
  // FAST5 T45 (CR 115.9c): "a spell that targets only a single creature you control", "that targets only ~": exactly one different target, and it is that
  const to = tg >= 0 ? phraseAt(ctx, tg, P('only')) : -1;
  if (to >= 0) {
    const sa = phraseAt(ctx, to, P('a single'));
    if (sa >= 0) for (const n of npAlts(ctx, sa)) if (n.number === 'singular' && n.head !== 'spell' && n.head !== 'ability' && n.filter.zone === undefined) out.push({ end: n.end, frag: { targetsOnly: { ref: 'each', filter: n.filter } } });
    // edh-next-74 (CR 115.9c, 115.1; Radiate, Radiant Performer): "a single permanent or player": one different target, a permanent or any player
    if (sa >= 0) {
      const sp = phraseAt(ctx, sa, P('permanent or player'));
      if (sp >= 0) out.push({ end: sp, frag: { targetsOnly: { ref: 'each', filter: { zone: 'battlefield' } }, targetsOnlyPlayer: true } });
    }
    const se = phraseAt(ctx, to, P('~'));
    if (se >= 0) out.push({ end: se, frag: { targetsOnly: { ref: 'self' } } });
  }
  if (tg >= 0) {
    const art = ctx.toks[tg]?.norm;
    // edh-d-92 (CR 115.9b; Legolas, Master Archer): "a spell that targets a creature you don't control": the controller phrase after the targeted noun belongs to that noun (the
    // relative clause "that targets ..." holds it), never to the spell ("a spell [that targets a creature] you don't control" is no reading: the caster's own spell): a shorter noun
    // phrase that stops right before such a phrase is left out
    const ctlAfter = (from: number, alts: readonly { end: number }[]): boolean => alts.some((m) => m.end > from && CONTROL_TAILS.some((w) => phraseAt(ctx, from, w) === m.end));
    if (art === 'a' || art === 'an') { const ns = npAlts(ctx, tg + 1); for (const n of ns) if (n.number === 'singular' && n.head !== 'spell' && n.head !== 'ability' && n.filter.zone === undefined && !ctlAfter(n.end, ns)) out.push({ end: n.end, frag: { targets: { ref: 'each', filter: n.filter } } }); }
    // Standard round 4, r4-trig (CR 115.9b, 102.3; Danitha, Spear of Agony): "a spell that targets an opponent or a creature an opponent controls": one of its targets
    // is such a player or such an object (either description, `anyOf`); also a player alone ("that targets an opponent")
    const one = (p: number): { end: number; frag: ObjectFilter }[] => {
      const r: { end: number; frag: ObjectFilter }[] = [];
      for (const [ws, who] of [[P('an opponent'), 'opponent'], [P('a player'), 'player']] as const) { const e = phraseAt(ctx, p, ws); if (e >= 0) r.push({ end: e, frag: { targets: { ref: 'each', who } } }); }
      const a = ctx.toks[p]?.norm;
      if (a === 'a' || a === 'an') for (const n of npAlts(ctx, p + 1)) if (n.number === 'singular' && n.head !== 'spell' && n.head !== 'ability' && n.filter.zone === undefined) r.push({ end: n.end, frag: { targets: { ref: 'each', filter: n.filter } } });
      // edh-cast-1 (CR 115.9b; Siren Stormtamer): "a spell or ability that targets you or a creature you control": you, the controller of the ability, as one of the two options
      // (a bare "targets you" is read elsewhere; only an `or` pair uses this)
      const you = phraseAt(ctx, p, P('you'));
      if (you >= 0) r.push({ end: you, frag: { targets: { ref: 'you' } } });
      return r;
    };
    const isYou = (x: { frag: ObjectFilter }): boolean => (x.frag.targets as { ref?: string }).ref === 'you';
    // std-rx28 (CR 115.9b; Storm, Windrider): "a spell that targets one or more creatures": one of its targets is such an object, as "a creature" (the plural names the
    // group the effect calls "those creatures", parser/lower/scope.ts#eventMentions)
    const more = phraseAt(ctx, tg, W_ONE_OR_MORE);
    if (more >= 0) for (const n of npAlts(ctx, more)) if (n.number === 'plural' && n.head !== 'spell' && n.head !== 'ability' && n.filter.zone === undefined) out.push({ end: n.end, frag: { targets: { ref: 'each', filter: n.filter } } });
    const firsts = one(tg);
    for (const x of firsts) {
      const player = (x.frag.targets as { who?: string }).who !== undefined || isYou(x);
      if (player && !isYou(x)) out.push(x);
      const or = phraseAt(ctx, x.end, P('or'));
      if (or >= 0) for (const y of one(or)) if (player !== ((y.frag.targets as { who?: string }).who !== undefined || isYou(y))) out.push({ end: y.end, frag: { anyOf: [x.frag, y.frag] } });
      // std-rx28 (CR 115.9b; Ertha Jo, Frontier Mentor): "that targets a creature or player", the article of the player left out after an object
      const orPlayer = player ? -1 : phraseAt(ctx, x.end, W_OR_PLAYER);
      if (orPlayer >= 0) out.push({ end: orPlayer, frag: { anyOf: [x.frag, { targets: { ref: 'each', who: 'player' } }] } });
    }
  }
  // edh-zones-13 (CR 608.2c; Pyre of Heroes): "a creature card that shares a creature type with the sacrificed creature and has mana value equal to 1 plus ..." (Birthing Ritual,
  // Descendants' Fury): "and has / have" goes on with the same relative clause, one more feature of the same object. Weak (design 6.3 rule 2): any template that spells the
  // clause out keeps its sentence.
  const more: Frag[] = [];
  for (const e of out) {
    if (ctx.toks[e.end]?.norm !== 'and' || e.frag.sharesWith === undefined) continue;
    for (const verb of ['has', 'have']) {
      if (ctx.toks[e.end + 1]?.norm !== verb) continue;
      // ... and "that creature" in it is the creature the clause just named, "the sacrificed creature" (the same reference, resolved once with it)
      const withRef = e.frag.sharesWith.with as unknown as Record<string, unknown>;
      const withAna = withRef['$anaphor'] as Record<string, unknown> | undefined;
      const same = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(same);
        if (typeof v !== 'object' || v === null) return v;
        const o = v as Record<string, unknown>;
        const a = o['$anaphor'] as Record<string, unknown> | undefined;
        if (withAna !== undefined && a !== undefined && a['sort'] === 'object' && a['number'] === 'singular' && a['participle'] === undefined && a['head'] !== undefined && a['head'] === withAna['head'] && String(a['text']).startsWith('that ')) return JSON.parse(JSON.stringify(withRef));
        return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, same(x)]));
      };
      for (const f of featureAtAll(ctx, e.end + 2, false)) {
        const merged = mergeFilter(e.frag, same(f.frag) as ObjectFilter);
        if (merged !== null) more.push({ end: f.end, frag: merged, weak: (e.weak ?? 0) + (f.weak ?? 0) + 1 });
      }
    }
  }
  out.push(...more);
  return out;
}


/** CR 109.4 (controller) and CR 108.3 (owner): "you control", "an opponent owns", "you don't control" (not in team games' sense of "opponent"). */
function controlForms(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  for (const f of plainPlayerForm(ctx, pos)) {
    const base: ObjectFilter = f.verb === 'control' ? { controller: f.pred } : { owner: f.pred };
    out.push({ end: f.end, frag: f.neg ? { not: base } : base });
    // r4-mech (CR 108.3, 109.4): "creatures you control but don't own": controlled by that player and owned by another
    if (f.verb === 'control' && !f.neg) {
      const e = phraseAt(ctx, f.end, W_BUT_DONT_OWN);
      if (e >= 0) out.push({ end: e, frag: { controller: f.pred, not: { owner: f.pred } } });
    }
  }
  // p2-damage-3 (CR 109.4, 115.1): "each creature that player or that planeswalker's controller controls" after "target player or planeswalker" (Searing Blaze, Chandra's
  // Fury): controlled by the targeted player, or by the controller of the targeted planeswalker (one of the two is the target; the other names nobody)
  const pp = phraseAt(ctx, pos, W_THAT_PLAYER_OR_PLANESWALKERS_CONTROLLER);
  if (pp >= 0) {
    const player = anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }) as PlayerRef;
    const walker = anaphorObj({ sort: 'object', number: 'singular', head: 'planeswalker', text: 'that planeswalker' }) as ObjRef;
    out.push({ end: pp, frag: { anyOf: [{ controller: player }, { controller: { ref: 'controllerOf', object: walker } }] } });
  }
  // edh-b-10 (CR 108.3): "owned by an opponent" / "owned by another player" (Kothophed): the owner is that player (another player is an opponent, CR 102.2)
  const ownedBy = phraseAt(ctx, pos, W_OWNED_BY);
  if (ownedBy >= 0) {
    if (ctx.toks[ownedBy]?.norm === 'another' && ctx.toks[ownedBy + 1]?.norm === 'player') out.push({ end: ownedBy + 2, frag: { owner: 'opponent' } });
    else for (const p of ctx.call('Player', ownedBy)) if (predOf(p.value as PlayerRef) === 'opponent' && ctx.toks[ownedBy]?.norm === 'an') out.push({ end: p.end, frag: { owner: 'opponent' } });
  }
  // edh-next-134 (CR 510.2, 120.1, 109.4; Admiral Beckett Brass): "controlled by a player who was dealt combat damage by three or more Pirates this turn": the controller was dealt
  // combat damage this turn by N or more different sources of a description (rules/history.ts#combatDamageSourcesToPlayerThisTurn). Only "N or more" with N of two or more, and a plain
  // description of the sources (no controller of their own, nothing that reads the history)
  const dealtBy = phraseAt(ctx, pos, W_CONTROLLED_BY_PLAYER_DEALT_COMBAT_BY);
  const atLeast = dealtBy >= 0 ? numberAt(ctx, dealtBy) : undefined;
  if (atLeast !== undefined && atLeast >= 2 && ctx.toks[dealtBy + 1]?.norm === 'or' && ctx.toks[dealtBy + 2]?.norm === 'more') {
    for (const f of ctx.call('Filter', dealtBy + 3)) {
      const by = f.value as ObjectFilter;
      if (!Object.keys(by).every((k) => k === 'types' || k === 'subtypes' || k === 'colors' || k === 'supertypes')) continue;
      const e = phraseAt(ctx, f.end, W_THIS_TURN_F134);
      if (e >= 0) out.push({ end: e, frag: { controllerDealtCombatDamageBy: { atLeast, by } } });
    }
  }
  // edh-c-73 (CR 108.3, 109.4; Telim'Tor's Edict): "target permanent you own or control": owned by you, or controlled by you (either one)
  const ooc = phraseAt(ctx, pos, W_YOU_OWN_OR_CONTROL);
  if (ooc >= 0) out.push({ end: ooc, frag: { anyOf: [{ owner: 'you' }, { controller: 'you' }] } });
  // r4-copy (CR 108.3, 109.4): "target permanent you own but don't control" (Coveted Falcon): owned by you and controlled by another player
  const ob = phraseAt(ctx, pos, W_YOU_OWN_BUT_DONT_CONTROL);
  if (ob >= 0) out.push({ end: ob, frag: { owner: 'you', not: { controller: 'you' } } });
  // edh-c-69 (CR 108.3, 109.4; Obelisk of Undoing): "target permanent you both own and control": owned and controlled by you (the same filter as "you own and control")
  const both = phraseAt(ctx, pos, W_YOU_BOTH_OWN_AND_CONTROL_F);
  if (both >= 0) out.push({ end: both, frag: { owner: 'you', controller: 'you' } });
  // edh-c-54 (CR 108.3, 109.4, 102.2; Conjured Currency): "target permanent you neither own nor control": owned by another player and controlled by another player (another player is an opponent)
  const neither = phraseAt(ctx, pos, W_YOU_NEITHER_OWN_NOR_CONTROL);
  if (neither >= 0) out.push({ end: neither, frag: { owner: 'opponent', controller: 'opponent' } });
  return out;
}
const W_YOU_BOTH_OWN_AND_CONTROL_F = P('you both own and control'); // edh-c-69
const W_BUT_DONT_OWN = P("but don't own");
const W_OWNED_BY = P('owned by'); // edh-b-10
const W_CONTROLLED_BY_PLAYER_DEALT_COMBAT_BY = P('controlled by a player who was dealt combat damage by'); // edh-next-134
const W_THIS_TURN_F134 = P('this turn'); // edh-next-134
const W_THAT_PLAYER_OR_PLANESWALKERS_CONTROLLER = P("that player or that planeswalker 's controller controls"); // p2-damage-3
const W_YOU_OWN_BUT_DONT_CONTROL = P("you own but don't control");
const W_YOU_OWN_OR_CONTROL = P('you own or control'); // edh-c-73
const W_YOU_NEITHER_OWN_NOR_CONTROL = P('you neither own nor control'); // edh-c-54
const W_YOU_OWN_IN_EXILE_AND_GY = P('you own in exile and in your graveyard'); // r5-mech

function zoneForms(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  const prep = ctx.toks[pos]?.norm;
  if (prep !== 'in' && prep !== 'from' && prep !== 'on') return out;
  for (const z of ctx.call('Zone', pos + 1)) {
    const zv = z.value as { zone: ZoneName; owner?: PlayerPred };
    const frag: ObjectFilter = { zone: zv.zone };
    if (zv.owner !== undefined) frag.owner = zv.owner;
    out.push({ end: z.end, frag });
    // r4-fxz (CR 400.1, 404.1, 402.1): "a land card from your hand or graveyard": a card in either of two zones of the same player ("and/or" is the same for one
    // card); render/np.ts#zonePhrase says the list
    const or = ctx.toks[z.end]?.norm;
    const second = OWN_ZONE_WORD[ctx.toks[z.end + 1]?.norm ?? ''];
    if (prep === 'from' && zv.owner !== undefined && (or === 'or' || or === 'and/or') && second !== undefined && second !== zv.zone && OWN_ZONE_WORD[zv.zone] !== undefined) {
      out.push({ end: z.end + 2, frag: { zone: [zv.zone, second], owner: zv.owner } });
    }
    // edh-next-75 (CR 400.1, 404.1, 408.1; Campfire): "commanders you own from the command zone and from your graveyard": a card in the command zone or in your own graveyard
    // (the owner is the first reading's, stated with the noun: "you own"); the command zone first, as Oracle prints it
    if (prep === 'from' && zv.zone === 'command' && zv.owner === undefined) {
      const and = phraseAt(ctx, z.end, P('and from'));
      if (and >= 0) for (const z2 of ctx.call('Zone', and)) {
        const z2v = z2.value as { zone: ZoneName; owner?: PlayerPred };
        if (z2v.zone === 'graveyard' && z2v.owner === 'you') out.push({ end: z2.end, frag: { zone: ['command', 'graveyard'], owner: 'you' } });
      }
    }
  }
  return out;
}
/** r4-fxz: the zones a player owns that "your hand or graveyard" lists (in the order Oracle prints them). */
const OWN_ZONE_WORD: Readonly<Record<string, ZoneName>> = { hand: 'hand', graveyard: 'graveyard', library: 'library' };

/**
 * FAST5 T45 (CR 113.7a): "from an artifact source", "from a colorless source": the source of an ability on the stack, described by one card type or by being
 * colorless (rules/filter.ts#abilitySourceMatches). Nothing else is read: a longer description is a longer phrase another template has to own.
 */
function abilitySourceForms(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  // edhd36 (CR 606.2, 113.7a; Verdant Command): "loyalty ability of a planeswalker": the source of the ability is a planeswalker (only this wording)
  if (ctx.toks[pos]?.norm === 'of' && (ctx.toks[pos + 1]?.norm === 'a' || ctx.toks[pos + 1]?.norm === 'an') && ctx.toks[pos + 2]?.norm === 'planeswalker') out.push({ end: pos + 3, frag: { abilitySource: { types: ['Planeswalker'] } } });
  // edh-next-131 (CR 113.7a, 205.4a, 903.3, 109.2; The Peregrine Dynamo): "from another legendary source that's not a commander": a legendary source other than the object that has the
  // ability, that is not a commander (rules/filter.ts#abilitySourceMatches reads the source as it is, or as it last existed); only these exact words
  const W131 = ['from', 'another', 'legendary', 'source', "that's", 'not', 'a', 'commander'];
  if (W131.every((w, k) => ctx.toks[pos + k]?.norm === w)) out.push({ end: pos + W131.length, frag: { abilitySource: { supertypes: ['Legendary'], other: true, not: { commander: true } } } });
  if (ctx.toks[pos]?.norm !== 'from') return out;
  const art = ctx.toks[pos + 1]?.norm;
  if (art !== 'a' && art !== 'an') return out;
  const word = ctx.toks[pos + 2];
  if (word !== undefined) {
    // edhd43 (CR 113.7a, 205.2; Green Slime): "from an artifact or enchantment source": a source of either card type
    if (ctx.toks[pos + 3]?.norm === 'or' && ctx.toks[pos + 5]?.norm === 'source' && word.kind === 'WORD') {
      const a = ctx.vocab.types.get(word.norm);
      const b = ctx.toks[pos + 4]?.kind === 'WORD' ? ctx.vocab.types.get(ctx.toks[pos + 4]!.norm) : undefined;
      if (a !== undefined && b !== undefined && !a.plural && !b.plural && a.name !== b.name) out.push({ end: pos + 6, frag: { abilitySource: { types: [a.name, b.name] } } });
    }
  }
  if (word === undefined || word.kind !== 'WORD' || ctx.toks[pos + 3]?.norm !== 'source') return out;
  if (word.norm === 'colorless') out.push({ end: pos + 4, frag: { abilitySource: { colorless: true } } });
  const ty = ctx.vocab.types.get(word.norm);
  if (ty !== undefined && !ty.plural) out.push({ end: pos + 4, frag: { abilitySource: { types: [ty.name] } } });
  // edhd36 (CR 113.7a, 205.2; Dissonant Wave): "from a noncreature source": a source that is not of the card type
  const non = word.norm.startsWith('non') ? ctx.vocab.types.get(word.norm.slice(3)) : undefined;
  if (non !== undefined && !non.plural) out.push({ end: pos + 4, frag: { abilitySource: { notTypes: [non.name] } } });
  return out;
}

const W_EXCEPT_FOR = [P('except for'), P('except'), P('other than')]; // edh-replace-6: "creatures other than Werewolves and Wolves" (Moonmist), the same kinds list
const W_AND_OR_EXCEPT = [P('and'), P('or')];
/**
 * edh-perms-9 (CR 205.2a, 205.3, 111.1; Elspeth Tirel): "all other permanents except for lands and tokens": the objects that are none of the kinds listed, the same filter
 * as the negations before the noun ("nonland, nontoken permanents"). Plural bare card types, creature types and "tokens" only (nothing else is a kind that a list of
 * exceptions can exclude here), two or three of them joined by "and" (or a comma and "and"). The phrase is weak (design 6.3 rule 2): the reading of "except" before
 * "chosen this way" and the commander exception keep their sentences.
 */
function exceptForList(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  const lead = anyPhraseAt(ctx, pos, W_EXCEPT_FOR);
  if (lead < 0) return out;
  const walk = (p: number, kinds: ObjectFilter[]): void => {
    for (const a of npAlts(ctx, p, { preOnly: true })) {
      if (a.number !== 'plural' || a.flags.length > 0 || (a.head !== 'type' && a.head !== 'token')) continue;
      const keys = Object.keys(a.filter).filter((k) => (a.filter as Record<string, unknown>)[k] !== undefined);
      const plain = a.head === 'token' ? keys.length === 1 && a.filter.token === true : keys.length === 1 && (keys[0] === 'types' || keys[0] === 'subtypes') && (a.filter[keys[0] as 'types' | 'subtypes'] ?? []).length === 1;
      if (!plain) continue;
      const next = [...kinds, a.filter];
      const frag: ObjectFilter = {};
      for (const k of next) {
        if (k.token === true) frag.token = false;
        if (k.types !== undefined) frag.notTypes = [...(frag.notTypes ?? []), ...k.types];
        if (k.subtypes !== undefined) frag.notSubtypes = [...(frag.notSubtypes ?? []), ...k.subtypes];
      }
      if (next.length >= 2) out.push({ end: a.end, frag, weak: 1 });
      if (next.length < 3) {
        for (const sep of W_AND_OR_EXCEPT) { const e = phraseAt(ctx, a.end, sep); if (e >= 0) walk(e, next); }
        if (ctx.toks[a.end]?.norm === ',') { walk(a.end + 1, next); if (ctx.toks[a.end + 1]?.norm === 'and') walk(a.end + 2, next); }
      }
    }
  };
  walk(lead, []);
  return out;
}

/**
 * edh-next-93 (CR 115.9b, 608.2c; Bane's Contingency): the "targets ..." clause of a relative clause read at `pos` (the word "targets"), for a condition about an object ("If that spell
 * targets a commander you control"): the same readings as "a spell that targets ...", only those that say what is targeted (`targets`, `targetsOnly`).
 */
export function targetsClauseAt(ctx: HoleCtx, pos: number): Frag[] {
  if (ctx.toks[pos]?.norm !== 'targets') return [];
  return relClause(ctx, pos).filter((f) => f.frag.targets !== undefined || f.frag.targetsOnly !== undefined || (f.frag.anyOf?.length ?? 0) > 0 && f.frag.anyOf!.every((x) => x.targets !== undefined));
}

/** One post-modifier at `pos`, as other holes read it (a bare "with the greatest <stat>" is left to the noun phrase that fills its set, `postModAtAll`). */
export function postModAt(ctx: HoleCtx, pos: number): Frag[] {
  return postModAtAll(ctx, pos).filter((f) => !JSON.stringify(f.frag).includes(HEAD_SET));
}

function postModAtAll(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  out.push(...controlForms(ctx, pos));
  out.push(...zoneForms(ctx, pos));
  // r5-mech (CR 108.3, 406.1, 404.1): "cards you own in exile and in your graveyard": owned by you, in either zone (Crackling Drake, Beacon Bolt, Serpentine Curve)
  const exGy = phraseAt(ctx, pos, W_YOU_OWN_IN_EXILE_AND_GY);
  if (exGy >= 0) out.push({ end: exGy, frag: { owner: predOf({ ref: 'you' }), zone: ['exile', 'graveyard'] } });
  out.push(...abilitySourceForms(ctx, pos)); // FAST5 T45
  const w = phraseAt(ctx, pos, W_WITH);
  if (w >= 0) for (const f of featureAtAll(ctx, w, false)) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  // edh-next-126 (CR 202.3, 201.2; Light-Paws, Emperor's Voice): "an Aura card with mana value less than or equal to that Aura and with a different name than each Aura you control": "and
  // with" adds a second feature of the same object (both must hold). Weak (design 6.3 rule 2): a template that spells the second clause out keeps its sentence.
  if (w >= 0) {
    for (const f of featureAtAll(ctx, w, false)) {
      const aw = phraseAt(ctx, f.end, W_AND_WITH);
      if (aw < 0) continue;
      for (const g of featureAtAll(ctx, aw, false)) {
        const merged = mergeFilter(f.frag, g.frag);
        if (merged !== null) out.push({ end: g.end, frag: merged, weak: (f.weak ?? 0) + (g.weak ?? 0) + 1 });
      }
    }
  }
  // Cloud r3-repl: "up to two target creature cards each with mana value 2 or less" (Dewdrop Cure): "each with" after a plural noun is "with", a property of each
  // object (not of the set: "with different names" keeps its own reading above)
  const eachWith = phraseAt(ctx, pos, W_EACH_WITH);
  if (eachWith >= 0) for (const f of featureAtAll(ctx, eachWith, false)) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  // FAST5 T42 (CR 201.2): "creature cards with different names": not a property of one card but of the set chosen, so it adds nothing to the filter and leaves the flag
  // `different-names`; only the target phrase that can state it (parser/holes/object.ts) takes the flag, anything else is manual (parser/lower/normalize.ts)
  if (w >= 0) { const dn = phraseAt(ctx, w, W_DIFFERENT_NAMES); if (dn >= 0) out.push({ end: dn, frag: {}, flags: ['different-names'] }); }
  // edh-b-4 (CR 122.1; Slurrk, All-Ingesting): "each creature you control that has a +1/+1 counter on it": one object with a counter of a kind on it, the same as "with" (a counter alone)
  const thatHas = phraseAt(ctx, pos, W_THAT_HAS);
  if (thatHas >= 0) for (const f of featureAtAll(ctx, thatHas, false)) if (f.frag.counters !== undefined && Object.keys(f.frag).length === 1) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  // edh-c-52 (CR 122.1; Coiling Stalker): "target creature you control that doesn't have a +1/+1 counter on it": no counter of the kind on it, the same as "without a +1/+1 counter on it"
  const thatDoesnt = phraseAt(ctx, pos, W_THAT_DOESNT_HAVE);
  if (thatDoesnt >= 0) for (const f of featureAt(ctx, thatDoesnt, true)) if (f.frag.not?.counters !== undefined && Object.keys(f.frag).length === 1) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  // edh-next-92 (CR 702, 205.3; Path of Mettle): "each creature that doesn't have first strike, double strike, vigilance, or haste" / "creatures that don't have flying": the same none-of-them
  // filter as "without <keywords>" (`notKeyword`), said as a relative clause
  for (const w2 of [W_THAT_DOESNT_HAVE, W_THAT_DONT_HAVE]) {
    const td = phraseAt(ctx, pos, w2);
    if (td >= 0) for (const f of featureAt(ctx, td, true)) if (f.frag.notKeyword !== undefined && Object.keys(f.frag).length === 1) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  }
  // edh-c-20 (CR 208.1; Gilt-Leaf Winnower): "target non-Elf creature whose power and toughness aren't equal"
  const pne = phraseAt(ctx, pos, P("whose power and toughness aren't equal"));
  if (pne >= 0) out.push({ end: pne, frag: { powerNotEqualToughness: true } });
  const wo = phraseAt(ctx, pos, W_WITHOUT);
  if (wo >= 0) for (const f of featureAtAll(ctx, wo, true)) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  const nm = phraseAt(ctx, pos, W_NAMED);
  if (nm >= 0) for (const n of ctx.call('Name', nm)) out.push({ end: n.end, frag: { name: n.value as string }, weak: n.weak ?? 0 });
  // edh-zones-13 (CR 201.2; Tiamat, Burning-Rune Demon): "Dragon cards not named Tiamat": none of the objects has that name (ObjectFilter.notName), one name
  const nnm = phraseAt(ctx, pos, W_NOT_NAMED);
  if (nnm >= 0) for (const n of ctx.call('Name', nnm)) out.push({ end: n.end, frag: { notName: n.value as string }, weak: n.weak ?? 0 });
  for (const ws of W_ENCHANTED_BY_YOUR_AURA) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { enchantedBy: 'you' } }); } // FAST5 T68
  out.push(...exceptForList(ctx, pos)); // edh-perms-9
  const th = phraseAt(ctx, pos, W_THAT);
  if (th >= 0) out.push(...relClause(ctx, th));
  // edh-c-61 (CR 120.1, 120.3; Inflame): the bare participle, "each creature dealt damage this turn": was dealt damage (the same filter as "that was dealt damage this turn")
  const bareDealt = phraseAt(ctx, pos, W_BARE_DEALT_DAMAGE);
  if (bareDealt >= 0) out.push({ end: bareDealt, frag: { dealtDamageThisTurn: true } });
  // edh-perms-20 (CR 603.10a, 608.2h, 303.4; Hateful Eidolon): "an Aura you controlled that was attached to it": an Aura that was attached to the object as it left the battlefield (its last
  // known information, LastKnown.attached.ids) and that its controller then, you, controlled; it may have gone to a graveyard since, so it is looked for in every zone
  const yca = phraseAt(ctx, pos, W_YOU_CONTROLLED_ATTACHED);
  if (yca >= 0 && ctx.toks[yca]?.norm === 'it') out.push({ end: yca + 1, frag: { controller: 'you', zone: 'any', wasAttachedTo: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) as ObjRef } });
  // CLOUD std-ecl (CR 205.3m, 115.1): "two target creature cards that share a creature type from your graveyard": like "with different names", a property of the SET
  // chosen, so it adds nothing to the filter and leaves the flag `shared-creature-type` that only a target phrase of exactly two takes (parser/holes/object.ts)
  // edh-d-59 (CR 205.3m, 115.1, 601.2c; Aphetto Dredging): "up to three target creature cards of the creature type of your choice from your graveyard": one creature type is chosen and every target
  // has it, which is a creature type in common (`TargetSpec.sharedCreatureType`, a changeling has every type); unlike "that share a creature type" it takes any number of targets
  // edh-d-96 (CR 304.1, 307.1, 603.10a; Gale, Waterdeep Prodigy): "target card of the other type from your graveyard" in the effect of a cast trigger whose spell is "an instant or sorcery
  // spell": of instant and sorcery, the type the triggering spell does not have (`sharesWith` quality `otherSpellType`, read against the event's spell). Only in an instruction of an effect
  // (a trigger's own pattern has no event yet); where the ability has no cast event the lint refuses the role (model/lint-roles.ts), so the sentence stays manual
  const oot = ctx.discourse === undefined ? -1 : phraseAt(ctx, pos, W_OF_THE_OTHER_TYPE);
  if (oot >= 0) out.push({ end: oot, frag: { sharesWith: { with: { ref: 'event', role: 'spell' }, quality: 'otherSpellType' } } });
  const oct = phraseAt(ctx, pos, W_OF_THE_CREATURE_TYPE_OF_YOUR_CHOICE);
  if (oct >= 0) out.push({ end: oct, frag: {}, flags: ['shared-creature-type', 'chosen-creature-type'] });
  if (th >= 0) { const sc = phraseAt(ctx, th, W_SHARE_A_CREATURE_TYPE); if (sc >= 0) out.push({ end: sc, frag: {}, flags: ['shared-creature-type'] }); }
  // edh-top-3 (CR 202.3, 115.1): "target creature cards that each have a different mana value X or less" (Agadeem's Awakening): the comparison is the filter of each card, and
  // "a different mana value" a property of the SET chosen (flag `different-mv`, taken only by the target phrase of parser/holes/object.ts, like "with different names")
  if (th >= 0) for (const ws of [W_EACH_HAVE_A_DIFFERENT_MV, W_HAVE_A_DIFFERENT_MV]) { const e = phraseAt(ctx, th, ws); if (e >= 0) for (const c of cmpAt(ctx, e)) out.push({ end: c.end, frag: { manaValue: c.cmp }, flags: ['different-mv'], ...(c.weak ? { weak: c.weak } : {}) }); }
  // edh-next-76 (CR 208.1; Catapult Fodder): "three or more creatures that each have toughness greater than their power": each creature's own two values (the plural of "with toughness greater than its power")
  if (th >= 0) { const e = phraseAt(ctx, th, W_EACH_HAVE_TGP); if (e >= 0) out.push({ end: e, frag: { toughnessGreaterThanPower: true } }); }
  // FAST5 T57 (CR 105.2): "target creature or planeswalker that's green or blue": the colors after the nouns say what the colors before them do (one of them; an
  // object that is several colors has each of them); the reading of the other postmodifiers and of "that" is unchanged
  const ths = phraseAt(ctx, pos, W_THATS);
  if (ths >= 0) for (const c of colorMod(ctx, ths)) out.push({ end: c.end, frag: c.frag });
  // edh-c-45 (CR 105.2; Sanctifier en-Vec): the plural, "exile all cards that are black or red from all graveyards", reads the colors as "all black or red cards" (the renderer says both, np.ts)
  const thatAre = phraseAt(ctx, pos, W_THAT_ARE_COLORS);
  if (thatAre >= 0) for (const c of colorMod(ctx, thatAre)) out.push({ end: c.end, frag: c.frag });
  // edh-zones-3 (CR 700.6): "that's not historic" / "that's not legendary" (the contraction of "that is not")
  if (ths >= 0) { const nl = phraseAt(ctx, ths, W_NOT_LEGENDARY); if (nl >= 0) out.push({ end: nl, frag: NOT_LEGENDARY }); const nh = phraseAt(ctx, ths, W_NOT_HISTORIC); if (nh >= 0) out.push({ end: nh, frag: NOT_HISTORIC }); }
  if (ths >= 0) out.push(...thatsKinds(ctx, ths)); // std-re
  if (ths >= 0) out.push(...thatsCardTypes(ctx, ths)); // edh-zones-12
  if (ths >= 0) out.push(...thatsTypeOrSubtype(ctx, ths)); // edh-zones-19
  if (ths >= 0) out.push(...thatsTypeOrMv(ctx, ths)); // edh-d-76
  if (ths >= 0) out.push(...thatsCardList(ctx, ths)); // edh-d-17
  // edh-d-51 (CR 105.2; Iridian Maelstrom): "each creature that isn't all colors": fewer than all five colors (`allColors: false`)
  for (const ws of W_NOT_ALL_COLORS) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { allColors: false } }); }
  // edh-d-86 (CR 205.2a; Rendmaw, Creaking Nest): "a card with two or more card types": at least that many card types (`minCardTypes`), two to four
  for (const [ws, n] of W_MIN_CARD_TYPES) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { minCardTypes: n } }); }
  // edh-perms-7 (CR 205.3m; Swarmyard Massacre): "each creature that isn't an Insect, Rat, Spider, or Squirrel": none of the creature types listed (`notSubtypes`)
  if (th >= 0) {
    for (const ws of W_ISNT) {
      const e = phraseAt(ctx, th, ws);
      if (e < 0) continue;
      // edh-cast-8 (CR 205.3m; Heliod, the Radiant Dawn): one kind, "enchantment card that isn't a God"
      const art = ctx.toks[e]?.norm;
      if (art === 'a' || art === 'an') for (const m of multiAt(ctx, e + 1, ctx.vocab.subtypes)) if (!m.entry.plural) out.push({ end: m.end, frag: { notSubtypes: [m.entry.name] }, weak: 1 });
      for (const k of thatsKinds(ctx, e)) {
        const any = k.frag.anyOf;
        if (any !== undefined && any.every((a) => Object.keys(a).length === 1 && a.subtypes?.length === 1)) out.push({ end: k.end, frag: { notSubtypes: any.map((a) => a.subtypes![0]!) }, weak: 1 }); // weak (design 6.3 rule 2): a template that already spells out "that isn't a A, B, or C" (Summon: Leviathan) keeps its sentence
      }
    }
  }
  // edh-combat-2 (CR 303.4b, 301.5; Reyav, Master Smith): "a creature you control that's enchanted or equipped"
  if (ths >= 0) { const oe = phraseAt(ctx, ths, P('enchanted or equipped')); if (oe >= 0) out.push({ end: oe, frag: ENCHANTED_OR_EQUIPPED }); }
  // edh-c-55 (CR 303.4b; Necromancer's Magemark): "a creature you control that's enchanted" (not the start of "enchanted or equipped")
  if (ths >= 0) { const en = phraseAt(ctx, ths, P('enchanted')); if (en >= 0 && ctx.toks[en]?.norm !== 'or') out.push({ end: en, frag: { enchanted: true } }); }
  // CLOUD std-msh (CR 506.5): "target creature you control that's attacking alone" (Crowd of True Believers): attacking, and no other creature is
  for (const ws of W_ATTACKING_ALONE) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attackingAlone: true } }); }
  // edh-c-69 (CR 506.4, 509.1; Gideon's Defeat): "target white creature that's attacking or blocking": the same filter as "attacking or blocking white creature"
  for (const ws of W_THATS_ATTACKING_OR_BLOCKING) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { anyOf: [{ attacking: true }, { blocking: true }] } }); }
  // r4-static (CR 508.1b, 102.3): "each creature that's attacking one of your opponents" (Oviya): attacking a player who is an opponent (rules/filter.ts reads the
  // defender as a player, never a planeswalker or battle)
  for (const ws of W_ATTACKING_OPPONENT) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: 'opponent' } } }); }
  for (const ws of W_ATTACKING_OPPONENT_OR_WALKER) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: 'opponent', orPlaneswalker: true } } }); }
  // p2-combat-flow-1 (CR 506.3, 508.1b): "that's attacking you": attacking the player you (rules/filter.ts reads the defender as a player, as above)
  for (const ws of W_ATTACKING_YOU) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: 'you' } } }); }
  for (const ws of W_ATTACKING_ENCHANTED) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: { ref: 'enchantedPlayer' } } } }); }
  // pc-combat-3 (CR 506.3, 508.1b; Soul Snare): "target creature that's attacking you or a planeswalker you control": attacking you, or a planeswalker you control
  for (const ws of W_ATTACKING_YOU_OR_WALKER) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: 'you', orPlaneswalker: true } } }); }
  // edh-players-12 (CR 506.3, 508.1b): "creatures attacking them": the player is a pronoun (parser/lower/anaphora.ts#groupChooser reads it for a group's step, else it stays manual)
  for (const [ws, text] of W_ATTACKING_THEM) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: anaphorObj({ sort: 'player', number: 'singular', head: 'player', text }) as PlayerRef } } }); }
  // CLOUD std-misc (CR 105.2; Ancient Cornucopia): "a spell that's one or more colors" is a spell that is not colorless
  if (ths >= 0) { const oc = phraseAt(ctx, ths, W_ONE_OR_MORE_COLORS); if (oc >= 0) out.push({ end: oc, frag: { colorless: false } }); }
  // edh-players-2 (CR 105.2; All Is Dust): the plural, "permanents that are one or more colors", is the same filter (the renderer already says both)
  if (th >= 0) { const oc = phraseAt(ctx, th, W_ARE_ONE_OR_MORE_COLORS); if (oc >= 0) out.push({ end: oc, frag: { colorless: false } }); }
  // Cloud std-eoe (CR 202.3): "with mana value of the chosen quality": the parity an earlier "Choose odd or even." of the same ability chose (parser/lower/links.ts)
  const mq = phraseAt(ctx, pos, W_MV_CHOSEN_QUALITY);
  if (mq >= 0) out.push({ end: mq, frag: { chosen: { link: '$link', quality: 'oddEven' } } });
  // edh-next-40 (CR 202.3; Twins of Discord): "with mana value of that quality" is the same parity ("Whenever you attack, choose odd or even. Creatures with mana value of that quality can't block this turn.")
  const tq = phraseAt(ctx, pos, W_MV_THAT_QUALITY);
  if (tq >= 0) out.push({ end: tq, frag: { chosen: { link: '$link', quality: 'oddEven' } } });
  // edh-c-78 (CR 202.3; Ashling's Prerogative): "without mana value of the chosen quality": the other parity
  const nmq = phraseAt(ctx, pos, W_MV_NOT_CHOSEN_QUALITY);
  if (nmq >= 0) out.push({ end: nmq, frag: { not: { chosen: { link: '$link', quality: 'oddEven' } } } });
  // edh-d-95 (CR 208.1, 607.2d; Zimone's Hypothesis): "with power of the chosen quality": the parity of the power, of the one earlier "choose odd or even" (parser/lower/links.ts reads it from that choice)
  const pq = phraseAt(ctx, pos, W_POWER_CHOSEN_QUALITY);
  if (pq >= 0) out.push({ end: pq, frag: { chosen: { link: '$link', quality: 'oddEvenPower' } } });
  const ch = phraseAt(ctx, pos, P('of the chosen'));
  if (ch >= 0) for (const [ws, quality] of CHOSEN) { const e = phraseAt(ctx, ch, ws); if (e >= 0) out.push({ end: e, frag: { chosen: { link: '$link', quality } } }); }
  // FAST5 T67 (CR 608.2c-d): "for each creature you control of that type": the type an earlier "Choose a creature type." of the same ability chose. The kind
  // ('$type': creature, card or land type) and the link are the earlier choice's (parser/lower/links.ts); with no such choice the placeholder makes it manual
  const tt = phraseAt(ctx, pos, W_OF_THAT_TYPE);
  if (tt >= 0) out.push({ end: tt, frag: { chosen: { link: '$link', quality: '$type' as never } } }); // the placeholder kind is replaced by the links pass
  // edh-players-8 (CR 607.2d, 608.2c-d; Skrelv): "creatures of that color": the color an earlier "Choose a color." of the same ability chose (the link and kind are the earlier choice's,
  // parser/lower/links.ts; with no such choice the placeholder makes it manual)
  const tc = phraseAt(ctx, pos, W_OF_THAT_COLOR);
  if (tc >= 0) out.push({ end: tc, frag: { chosen: { link: '$link', quality: 'color' } } });
  const ot = phraseAt(ctx, pos, P('other than ~'));
  if (ot >= 0) out.push({ end: ot, frag: { other: true } });
  // FAST5 T59 (CR 115.3, 608.2c): "target creature you control other than that creature" (Pawpatch Recruit): not the object an earlier phrase or the trigger's event
  // named (the anaphor, resolved by parser/lower/anaphora.ts); only "that <noun>", a demonstrative naming one object
  const otherThan = phraseAt(ctx, pos, P('other than'));
  // r4-static (CR 201.5a, 109.2): "an artifact other than Dire Blunderbuss" inside an ability the Equipment grants: not the granting object (front/selfref.ts)
  if (otherThan >= 0 && ctx.toks[otherThan]?.kind === 'GRANTOR') out.push({ end: otherThan + 1, frag: { not: { is: { ref: 'grantor' } } } });
  if (otherThan >= 0 && ctx.toks[otherThan]?.norm === 'that') {
    for (const o of ctx.call('Obj', otherThan)) {
      const info = (o.value as { $anaphor?: { sort?: string; number?: string; head?: string } }).$anaphor;
      if (info?.sort === 'object' && info.number === 'singular' && info.head !== undefined) out.push({ end: o.end, frag: { not: { is: o.value as ObjRef } } });
      // edh-perms-18 (CR 109.2, 608.2c; Sorin of House Markov): "a white permanent other than that creature or ~": not that object and not the source itself (FAST5 T78's reading as a hole;
      // weak, design 6.3 rule 2: t78's own template keeps its sacrifice sentence)
      if (info?.sort === 'object' && info.number === 'singular' && info.head !== undefined && ctx.toks[o.end]?.norm === 'or' && ctx.toks[o.end + 1]?.kind === 'SELF') {
        out.push({ end: o.end + 2, frag: { not: { anyOf: [{ is: o.value as ObjRef }, { self: true }] } }, weak: 1 });
      }
    }
  }
  // edh-d-12 (CR 205.4a, 205.2, 109.2; Surgical Extraction): "target card in a graveyard other than a basic land card": not an object that is one of the plain kind said after
  // "other than a/an" (card types, supertypes and subtypes only, one noun, no further modifier); the whole filter before it holds. Weak (design 6.3 rule 2): the readings of "other than
  // that <noun>" and of the attached host keep their sentences.
  if (otherThan >= 0 && (ctx.toks[otherThan]?.norm === 'a' || ctx.toks[otherThan]?.norm === 'an')) {
    for (const a of npAlts(ctx, otherThan + 1, { preOnly: true })) {
      if (a.number !== 'singular' || a.flags.some((x) => x !== 'zone-unstated')) continue;
      const keys = Object.keys(a.filter).filter((k) => (a.filter as Record<string, unknown>)[k] !== undefined);
      if (keys.length === 0 || keys.some((k) => k !== 'types' && k !== 'supertypes' && k !== 'subtypes' && k !== 'isCard')) continue;
      const { isCard: _card, ...kind } = a.filter; // a card of the described kind (a graveyard holds no token, CR 111.7)
      out.push({ end: a.end, frag: { not: kind }, weak: 1 });
    }
  }
  // FAST4 T33: "target creature you control other than enchanted creature": not the object the source is attached to (CR 303.4, 301.5)
  for (const ws of W_OTHER_THAN_ATTACHED) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attachedToSource: false } }); }
  // CLOUD std-msh (CR 301.5, 303.4): "the number of Equipment attached to ~", "each Aura attached to it": attached to that one object as the filter is read
  // (`attachedToObject`, FAST4 T22's field, rules/filter.ts)
  // edh-perms-2 (CR 301.5, 303.4; Sage's Reverie): also said with the relative pronoun, "each Aura you control that's attached to a creature"
  const att = anyPhraseAt(ctx, pos, [W_ATTACHED_TO, ...W_THATS_ATTACHED_TO]);
  if (att >= 0) for (const o of ctx.call('Obj', att)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { attachedToObject: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
  // edh-d-24 (CR 303.4a, 702.5a, 702.5d; Sovereigns of Lost Alara, Auratouched Mage): "an Aura card that could enchant that creature": the Aura's enchant restriction accepts that one permanent
  // as the filter is read (`couldEnchant`, rules/filter.ts; no Aura with an enchant restriction the engine does not understand matches)
  for (const ws of W_COULD_ENCHANT) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) for (const o of ctx.call('Obj', e)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { couldEnchant: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
  }
  // p2-combat-flow-1 (CR 509.1g, 506.4): "each creature blocking it" (Plague Wight): blocking that one object as the filter is read (`blockingObject`, FAST3 T18's
  // field, rules/filter.ts); the same hosts as "attached to it" (this object, an object named earlier, enchanted or equipped creature)
  const blk = phraseAt(ctx, pos, W_BLOCKING);
  // edh-d-12 (CR 509.1g, 506.4; Labyrinth Raptor): the relative clause, "a creature that's blocking it" / "each creature that is blocking this creature": the same filter as the participle
  for (const ws of W_THATS_BLOCKING) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) for (const o of ctx.call('Obj', e)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { blockingObject: o.value }, weak: (o.weak ?? 0) + 1, ...(o.flags ? { flags: o.flags } : {}) });
  }
  // weak (design 6.3 rule 2): FAST3 T18's "for each creature blocking it" templates keep their sentences
  if (blk >= 0) for (const o of ctx.call('Obj', blk)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { blockingObject: o.value }, weak: (o.weak ?? 0) + 1, ...(o.flags ? { flags: o.flags } : {}) });
  // p2-combat-flow-1 (CR 509.1g-h): "all creatures blocked by ~" (Wall of Nets), "each creature blocking or blocked by ~" (Kjeldoran Frostbeast), same hosts
  const bby = phraseAt(ctx, pos, W_BLOCKED_BY);
  if (bby >= 0) for (const o of ctx.call('Obj', bby)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { blockedByObject: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
  // edh-top-3 (CR 509.1g-h, 506.4; Tinder Wall): "target creature it's blocking": the attacking creature that object blocks, as the filter is read (`blockedByObject`); "it" is the
  // object a pronoun names (resolved by the anaphora pass like any "it")
  for (const ws of W_SELF_BLOCKING) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { blockedByObject: { ref: 'self' } } }); }
  for (const ws of W_IT_BLOCKING) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { blockedByObject: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) as ObjRef } }); }
  for (const ws of W_BLOCKING_OR_BLOCKED_BY) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) for (const o of ctx.call('Obj', e)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { blockingOrBlockedBy: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
  }
  // p2-damage-2 (CR 303.4, 702.5d): "the number of Curses attached to them" (Curse of Thirst): attached to a player (an Aura with enchant player), as the filter is read
  // (the Player hole has no "them": here it is a player's pronoun, as "they" is, and an object "them" is a group, never one host above)
  if (att >= 0) for (const p of ctx.call('Player', att)) if (p.value !== null && typeof p.value === 'object') out.push({ end: p.end, frag: { attachedToPlayer: p.value as PlayerRef }, ...(p.flags ? { flags: p.flags } : {}) });
  if (att >= 0 && ctx.toks[att]?.norm === 'them') out.push({ end: att + 1, frag: { attachedToPlayer: anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'them' }) as PlayerRef } });
  // std-ry5 (CR 303.4, 301.5): "target Aura attached to a creature [you control]", "an Aura attached to a land": attached to any one permanent of a plain
  // description (a card type and at most its controller), as the filter is read (`attachedToObject` naming every such permanent, rules/filter.ts)
  const article = att >= 0 ? ctx.toks[att]?.norm : undefined;
  if (att >= 0 && (article === 'a' || article === 'an')) {
    // a host without its controller is weak: "Aura attached to a creature you control" says whose creature, not whose Aura (design 6.3 rule 2)
    for (const f of ctx.call('Filter', att + 1)) {
      const host = f.value as ObjectFilter;
      if (!isAttachHostKind(host)) continue;
      const weak = (f.weak ?? 0) + (host.controller === undefined ? 1 : 0);
      out.push({ end: f.end, frag: { attachedToObject: { ref: 'each', filter: host } }, ...(weak ? { weak } : {}), ...(f.flags ? { flags: f.flags } : {}) });
    }
  }
  // edh-perms-14 (CR 303.4, 301.5; Umbra Mystic): "Auras attached to permanents you control" / "Equipment attached to creatures you control": attached to any one of a plural description
  // of permanents (at most a card type, and the controller), the same field as the singular host above
  if (att >= 0 && article !== 'a' && article !== 'an') {
    for (const f of ctx.call('Filter', att)) {
      const host = f.value as ObjectFilter;
      if (host.controller === undefined || !Object.keys(host).every((k) => k === 'types' || k === 'controller') || (host.types !== undefined && !isAttachHostKind({ ...host }))) continue;
      out.push({ end: f.end, frag: { attachedToObject: { ref: 'each', filter: host } }, ...(f.weak ? { weak: f.weak } : {}), ...(f.flags ? { flags: f.flags } : {}) });
    }
  }
  // FAST3 T14: "a creature dealt damage by ~ this turn" (Sengir Vampire): damaged this turn by the object itself (CR 120.1)
  const dd = phraseAt(ctx, pos, W_DEALT_DAMAGE_BY_SELF);
  if (dd >= 0) out.push({ end: dd, frag: { dealtDamageBySourceThisTurn: true } });
  // edh-c-113 (CR 120.1, 301.5, 400.7; Unscythe, Killer of Kings): "a creature dealt damage by equipped creature this turn": by the creature the Equipment is attached to
  const de = phraseAt(ctx, pos, W_DEALT_DAMAGE_BY_EQUIPPED);
  if (de >= 0) out.push({ end: de, frag: { dealtDamageByAttachedThisTurn: true } });
  // edh-c-48 (CR 120.1, 400.7; Kumano Faces Kakkazan): "a creature dealt damage this turn by a source you controlled": damaged this turn by a source its controller controlled
  const dy = phraseAt(ctx, pos, W_DEALT_DAMAGE_BY_YOUR_SOURCE);
  if (dy >= 0) out.push({ end: dy, frag: { dealtDamageByYourSourceThisTurn: true } });
  // edh-next-130 (CR 120.1, 400.7, 603.10a; Shelob, Child of Ungoliant): "another creature dealt damage this turn by a Spider you controlled": damaged this turn by a source of that
  // subtype (at most a card type with it) that "you" controlled as it dealt the damage (the `source.` facts of the damage entry). A bare head only: the controller is the past tense
  // "you controlled", never "you control"
  const dt = anyPhraseAt(ctx, pos, W_DEALT_DAMAGE_THIS_TURN_BY);
  if (dt >= 0) {
    for (const m of multiAt(ctx, dt, ctx.vocab.subtypes)) {
      if (m.entry.plural && !m.entry.both) continue;
      let q = m.end;
      const tt = ctx.toks[q];
      const ty = tt !== undefined && tt.kind === 'WORD' ? ctx.vocab.types.get(tt.norm) : undefined;
      const types = ty !== undefined && !(ty.plural && !ty.both) ? [ty.name] : undefined;
      if (types !== undefined) q++;
      const e = phraseAt(ctx, q, W_YOU_CONTROLLED);
      if (e >= 0) out.push({ end: e, frag: { dealtDamageThisTurnBy: { subtypes: [m.entry.name], ...(types ? { types } : {}), controller: 'you' } } });
    }
  }
  // Standard round 5, r5-trig (CR 702.122c; Balthier and Fran): "a Vehicle crewed by ~ this turn": its crew cost was paid this turn by tapping the object itself
  const cb = phraseAt(ctx, pos, W_CREWED_BY_SELF);
  if (cb >= 0) out.push({ end: cb, frag: { crewedBySourceThisTurn: true } });
  // FAST4 T19: "a creature dealt damage this way" (CR 608.2c): one of what an earlier damage step of the ability actually dealt damage to (effects/handlers/
  // lifedamage.ts binds exactly those, CR 120.3): an anaphor only that step answers (lower/mentions.ts, a participle-only mention); unresolved, manual
  const tw = phraseAt(ctx, pos, W_DEALT_DAMAGE_THIS_WAY);
  if (tw >= 0) out.push({ end: tw, frag: { is: anaphorObj({ sort: 'set', number: 'plural', participle: DEALT_DAMAGE_THIS_WAY, text: DEALT_DAMAGE_THIS_WAY }) as ObjRef } });
  // std-lci (CR 608.2c, 400.7): "for each card exiled this way": one of what an earlier step of the ability moved to exile (the step's binding follows the cards
  // into exile, a public zone); an anaphor only that step answers (lower/mentions.ts, a participle-only mention); unresolved, manual
  // std-rx5 (CR 607.2a): "target creature card exiled with ~" (The Darkness Crystal): one of the cards the object's linked exiling instruction exiled, in exile
  // (`{ref:'linked', link:'exiled'}`, parse.ts#linkExiled finds the one producer; with none or several the ability is manual)
  const xw = phraseAt(ctx, pos, W_EXILED_WITH_SELF);
  // only in a target phrase (the flag `linked-exiled-target`, as "with different names"): the older readings of "cards exiled with ~" elsewhere keep their sentences
  if (xw >= 0) out.push({ end: xw, frag: { zone: 'exile', is: { ref: 'linked', link: 'exiled' } }, flags: ['linked-exiled-target'] });
  // std-cardcopy-3 (CR 607.2a): "target creature card exiled with it" (Mimeoplasm, Revered One): Oracle says "it" for the object itself, the same cards (as the
  // templates of "a creature card exiled with ( it | ~ )" read it, FAST5 T64); only in a target phrase, as above
  const xi = phraseAt(ctx, pos, W_EXILED_WITH_IT);
  if (xi >= 0) out.push({ end: xi, frag: { zone: 'exile', is: { ref: 'linked', link: 'exiled' } }, flags: ['linked-exiled-target'] });
  const ew = phraseAt(ctx, pos, W_EXILED_THIS_WAY);
  if (ew >= 0) out.push({ end: ew, frag: { zone: 'exile', is: anaphorObj({ sort: 'set', number: 'plural', participle: EXILED_THIS_WAY, text: EXILED_THIS_WAY }) as ObjRef } }); // the zone the participle says
  // Cloud C7 (CR 608.2c, 608.2h): "creature destroyed this way", "cards exiled this way": what an earlier instruction of that kind moved (parser/holes/moved-words.ts);
  // only a count of it is understood (lower/quantities.ts), the marker anywhere else makes the sentence manual
  out.push(...movedFragAt(ctx, pos));
  // C6 (CR 608.2c): "all creatures they control not chosen this way", "all creatures except creatures chosen this way": without what an earlier choice of the ability
  // chose (the anaphor only a `chooseObjects` step answers, lower/mentions.ts verb "chosen"); unresolved, manual
  const chosen = (): ObjRef => anaphorObj({ sort: 'set', number: 'plural', participle: 'chosen', text: CHOSEN_THIS_WAY }) as ObjRef;
  const nc = phraseAt(ctx, pos, W_NOT_CHOSEN_THIS_WAY);
  if (nc >= 0) out.push({ end: nc, frag: { not: { is: chosen() } } });
  const ex = phraseAt(ctx, pos, W_EXCEPT);
  if (ex >= 0) {
    for (const n of npAlts(ctx, ex, { preOnly: true })) {
      if (n.number !== 'plural') continue;
      const e = phraseAt(ctx, n.end, W_CHOSEN_THIS_WAY);
      if (e >= 0) out.push({ end: e, frag: { not: { ...n.filter, is: chosen() } } });
    }
    }
  // Cloud std-eoe (CR 608.2c, 400.7, 701.8a): "a creature card put into a graveyard this way" / "... into your graveyard this way": one of the cards an earlier destroy
  // or sacrifice step of the ability put into a graveyard (effects/handlers/zones-remove.ts binds the new objects), still in a graveyard; the same participle-only
  // mention answers it (lower/mentions.ts), unresolved it is manual
  for (const [ws, owner] of [[W_PUT_INTO_A_GRAVEYARD_THIS_WAY, undefined], [W_PUT_INTO_GRAVEYARDS_THIS_WAY, undefined] /* edh-next-127 */, [W_PUT_INTO_THEIR_GRAVEYARD_THIS_WAY, undefined], [W_PUT_INTO_YOUR_GRAVEYARD_THIS_WAY, 'you']] as const) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { is: anaphorObj({ sort: 'set', number: 'plural', participle: PUT_INTO_GRAVEYARD_THIS_WAY, text: PUT_INTO_GRAVEYARD_THIS_WAY }) as ObjRef, zone: 'graveyard', ...(owner ? { owner } : {}) } });
  }
  return out;
}

/** C6: the participle phrase of what an earlier choice of the ability chose. */
export const CHOSEN_THIS_WAY = 'chosen this way';
const W_CHOSEN_THIS_WAY = P(CHOSEN_THIS_WAY);
const W_NOT_CHOSEN_THIS_WAY = P('not chosen this way');
const W_EXCEPT = P('except');

// ---------------------------------------------------------------------------
// the noun phrase
// ---------------------------------------------------------------------------

const MAX_POST = 4;
/** FAST5 T42: the zones whose objects have no controller (CR 109.4). */
const OWNED_ONLY_ZONES: ReadonlySet<string> = new Set(['hand', 'library', 'graveyard', 'exile']);
const MAX_PRE = 6;

/** All parses of a noun phrase starting at `pos` (see the file comment). */
export function npAlts(ctx: HoleCtx, pos: number, opts: NpOptions = {}): NpAlt[] {
  return ctx.memo(`${opts.bare === true ? 'np-bare' : 'np'}${opts.differentNames === true ? '-dn' : ''}${opts.preOnly === true ? '-pre' : ''}`, pos, () => computeNp(ctx, pos, opts));
}

function computeNp(ctx: HoleCtx, pos: number, opts: NpOptions): NpAlt[] {
  const out: NpAlt[] = [];
  const dedup = new Set<string>();
  const emit = (a: NpAlt): void => {
    // FAST5 T42: "with different names" says something about a SET of targets: only a target phrase (parser/holes/object.ts) asks for it; in a cost or a filter it would be dropped
    if (a.flags.includes('different-names') && opts.differentNames !== true) return;
    if (a.flags.includes('different-mv') && opts.differentNames !== true) return; // edh-top-3: the same for "that each have a different mana value X or less"
    if (a.flags.includes('shared-creature-type') && opts.differentNames !== true) return; // CLOUD std-ecl: the same for "that share a creature type"
    if (a.flags.includes('linked-exiled-target') && opts.differentNames !== true) return; // std-rx5: "target creature card exiled with ~"
    // edh-next-132 (CR 122.2, 608.2c; Altaïr Ibn-La'Ahad): "card from your graveyard with a memory counter on it" read as a card that HAS the counter is weak (design 6.3 rule 2): a card in a
    // graveyard, hand or library has no counters (they don't stay on an object that changes zones), so the words are the counter an instruction puts on the card it moves
    // (template eff.edhz27.exile.withOneCounter); lower/normalize.ts#countersOffBattlefield refuses this reading of a target anyway
    const zs = a.filter.zone === undefined ? [] : [a.filter.zone].flat();
    if (a.filter.counters !== undefined && zs.length > 0 && zs.every((z) => z === 'graveyard' || z === 'hand' || z === 'library')) a = { ...a, weak: (a.weak ?? 0) + 2 }; // two: below a phrase the template's own Obj marks weak ("up to one target ...")
    const k = `${a.end}|${a.number}|${a.head}|${JSON.stringify(a.filter)}`;
    if (dedup.has(k)) return;
    dedup.add(k);
    out.push(a);
  };

  // post-modifier chains from a head
  const finishHead = (h: HeadAlt, pre: ObjectFilter): void => {
    // FAST4 T28: "Vehicles and/or creatures" (a subtype, then a card type) takes only words Oracle applies to both nouns: "other" before them, who controls
    // or owns them after. "Walls and/or creatures with flying" means Walls, and creatures with flying (Elven Riders): one filter cannot say that, no reading
    const subtypeFirst = isSubtypeFirst(h.frag);
    if (subtypeFirst && Object.keys(pre).some((k) => k !== 'other')) return;
    const base = mergeFilter(pre, h.frag);
    if (base === null) return;
    const post = (end: number, f0: ObjectFilter, flags: string[], weak: number, depth: number, afterTargetsOnly = false): void => {
      // edh-zones-10 (CR 110.4, 608.2c; Cloudstone Curio): "another permanent you control that shares a permanent type with it": "another" is another than the object "it" names, which shares
      // every permanent type with itself, so that object is left out of the set compared with (`sharesWith.other`); render/np.ts refuses the filter unless "another" is said too
      const f: ObjectFilter = f0.sharesWith?.quality === 'permanentType' ? { ...f0, sharesWith: { ...f0.sharesWith, other: true } } : f0;
      const final = fillHeadSet(finalize(f, h.head));
      if (final === null) return;
      const fl = [...flags];
      // Cloud C7: "card exiled this way" states where the card is (where the instruction moved it, parser/holes/moved-words.ts)
      if (h.head === 'card' && final.zone === undefined && (final as Record<string, unknown>)[MOVED_MARK] === undefined) fl.push('zone-unstated');
      // FAST5 T42 (CR 109.4): only an object on the battlefield or the stack has a controller, so "you control" beside a hand, library, graveyard or exile zone is the
      // less likely reading ("... less than or equal to the number of lands you control from your hand": the lands you control, the card from your hand)
      const odd = final.controller !== undefined && typeof final.zone === 'string' && OWNED_ONLY_ZONES.has(final.zone) ? 1 : 0;
      emit({ end, filter: final, number: h.number, head: h.head, weak: weak + odd, flags: fl });
      if (depth >= MAX_POST || opts.preOnly === true) return;
      const pms = postModAtAll(ctx, end);
      for (const pm of pms) {
        // std-r7 (CR 400.1, 205.2a, 205.3): ... and the zone the cards are in, "target Vehicle or creature card from your graveyard": a zone says where every noun of the list is
        if (subtypeFirst && Object.keys(pm.frag).some((k) => k !== 'controller' && k !== 'owner' && k !== 'zone')) continue;
        if (h.or === true && Object.keys(pm.frag).some((k) => k !== 'controller' && k !== 'owner' && (h.postAll !== true || k !== 'manaValue'))) continue; // FAST5 T59: "legendary creature or creature with mana value one"
        // FAST5X E27 review (CR 115.1, 601.2c): a keyword after a list of kinds belongs to the last noun only: "target artifact, enchantment, or creature with
        // flying" (Vivien Reid, Broken Wings) is an artifact, an enchantment, or a creature with flying. One filter would ask the keyword of every kind (no
        // plain artifact could be targeted). A list of card types reads as `anyOf` [the other types, the last type with the keyword]; any other list (subtypes,
        // or card types and subtypes mixed) has no reading.
        if (h.list === true && (pm.frag.keyword !== undefined || pm.frag.notKeyword !== undefined)) {
          const split = keywordOnLastType(f, h.frag, pm.frag);
          if (split !== null) post(pm.end, split, [...flags, ...(pm.flags ?? [])], weak + (pm.weak ?? 0), depth + 1);
          continue;
        }
        // FAST5 T45: "that targets only a single creature you control": "you control" belongs to the creature, never to the spell after it
        // CLOUD std-msh (CR 115.9b): the same after "that targets a creature you control" (Mockingbird, Ace Agent): the creature's controller, not the spell's
        // edh-next-133 (CR 115.9c, 109.2; Ivy, Gleeful Spellthief): "a spell that targets only a single creature other than ~": "other than ~" is the creature's too (a spell is never ~ on the battlefield)
        if (afterTargetsOnly && Object.keys(pm.frag).every((k) => k === 'controller' || k === 'owner' || k === 'other')) continue;
        // Wave-2 merge (std-lci and Cloud C7): std-lci's "<cards> exiled this way" (the exile's binding, counted in exile) reads a CARD noun; after a permanent noun,
        // "the number of creatures exiled this way" (Overwrite the Multiverse), the objects are described as they were when exiled (CR 608.2c, 608.2h), which is
        // C7's reading (`$moved`, parser/holes/moved-words.ts): a creature card counted in exile would miss an animated land that was exiled as a creature
        if (h.head !== 'card' && exiledThisWayFrag(pm.frag)) continue;
        // ... and after a card noun the words are std-lci's alone: C7's marker for the same words ("creature cards exiled this way") would tie with it outside a count
        // ("the greatest power among creature cards exiled this way", Szat's Will: a marker that is not a count is never understood); "put into exile this way" stays C7's
        if (h.head === 'card' && (pm.frag as Record<string, unknown>)[MOVED_MARK] === 'exiled' && pms.some((q) => q.end === pm.end && exiledThisWayFrag(q.frag))) continue;
        // edh-next-138 (CR 608.2c, 608.2h; The Hunger Tide Rises): "a creature card with mana value less than or equal to the number of creatures sacrificed this way": "<participle> this way"
        // right after a comparison with a count belongs to the counted objects (the nearer noun), never to the card the comparison describes
        if ((pm.frag as Record<string, unknown>)[MOVED_MARK] !== undefined && (['manaValue', 'power', 'toughness'] as const).some((k) => { const c = f[k] as { value?: unknown } | undefined; return c !== undefined && typeof c.value === 'object' && c.value !== null && (c.value as { q?: unknown }).q === 'count'; })) continue;
        const merged = mergeFilter(f, pm.frag);
        // FAST5 T42: a zone or player the description already has, said again, is the less likely reading ("target permanent card in your graveyard with mana value
        // less than or equal to the number of permanent cards in your graveyard": the second "in your graveyard" belongs to the counted cards)
        const again = (['zone', 'owner', 'controller'] as const).some((k) => pm.frag[k] !== undefined && f[k] !== undefined) ? 1 : 0;
        // std-hob: "a card with the same name as a creature you control": "you control" belongs to the creature the name is compared with (the nearer noun), not to the card
        if (f.sharesWith?.with.ref === 'each' && (pm.frag.controller !== undefined || pm.frag.owner !== undefined)) continue;
        if (f.not?.sharesWith?.with.ref === 'each' && (pm.frag.controller !== undefined || pm.frag.owner !== undefined)) continue; // cloud std-dsk: "that doesn't have the same name as a Room you control"
        if (merged !== null) post(pm.end, merged, [...flags, ...(pm.flags ?? [])], weak + (pm.weak ?? 0) + again, depth + 1, pm.frag.targetsOnly !== undefined || pm.frag.targets !== undefined || (pm.frag.anyOf?.some((x) => x.targets !== undefined) ?? false)); // r4-trig: targets alternatives too
      }
    };
    // p2-replace-damage-2 (design 6.3 rule 2): a "source" head is a weak reading, so a template that spells the word out keeps its sentence
    post(h.end, base, [], h.head === 'source' ? 1 : 0, 0);
  };

  // pre-modifier chains
  const pre = (p: number, f: ObjectFilter, depth: number, sawMod: boolean): void => {
    for (const h of headAt(ctx, p)) finishHead(h, f);
    if (opts.bare === true && sawMod) emit({ end: p, filter: finalize(f, 'mods'), number: 'plural', head: 'mods', weak: 0, flags: [] });
    if (depth >= MAX_PRE) return;
    for (const m of modAt(ctx, p)) {
      const merged = mergeFilter(f, m.frag);
      if (merged !== null) pre(m.end, merged, depth + 1, true);
      // "noncreature, nonland permanent": a comma between consecutive negations
      // edh-b-3 (CR 205.3, 700.8; Power Word Kill): "non-Angel, non-Demon, non-Devil, non-Dragon creature": the comma chain goes on while the next one is a negation too
      const commaChain = (prev: typeof m, acc: ObjectFilter, d: number): void => {
        if (ctx.toks[prev.end]?.norm !== ',') return;
        for (const m2 of modAt(ctx, prev.end + 1)) {
          const merged2 = mergeFilter(acc, m2.frag);
          // Standard round 3, r3-trig (CR 111.1, 205.3): "nontoken, non-Angel creature" (`token: false` is the negation "nontoken")
          if (merged2 !== null && isNegation(prev.frag)) {
            pre(m2.end, merged2, d + 2, true);
            if (d + 2 < MAX_PRE) commaChain(m2, merged2, d + 2); // edh-b-3 + edh-next-8 (Victim of Night, Power Word Kill): the chain goes on while each next modifier is a negation too
          }
        }
      };
      if (merged !== null) commaChain(m, merged, depth);
    }
  };
  pre(pos, {}, 0, false);
  // FAST5 T59: two noun phrases of their own modifiers joined by "or" ("land creature or nonbasic land", "noncreature artifact or noncreature enchantment",
  // "creature or legendary spell"); only a reading the plain type coordination above cannot say (it keeps every span it reads)
  if (opts.preOnly !== true && opts.bare !== true) {
    const covered = new Set(out.map((a) => `${a.end}|${a.number}`));
    for (const c of [...orPhrases(ctx, pos), ...listPhrases(ctx, pos)]) {
      const before = out.length;
      finishHead(c, {});
      // a span the plain grammar already reads stays its reading (the coordination of card types alone, "Vehicles and/or creatures", ...)
      for (let i = out.length - 1; i >= before; i--) if (covered.has(`${out[i]!.end}|${out[i]!.number}`)) out.splice(i, 1);
    }
    // cloud std-spm: "Spider and legendary creature" (Ultimate Spider-Man), the same for "and" (see andPhrases)
    for (const c of andPhrases(ctx, pos)) {
      const before = out.length;
      finishHead(c, {});
      for (let i = out.length - 1; i >= before; i--) if (covered.has(`${out[i]!.end}|${out[i]!.number}`)) out.splice(i, 1);
    }
  }
  return out;
}

/** edh-next-8: a modifier that only excludes ("nonland", "non-Vampire", "nonblack", "nontoken"). */
const isNegation = (f: ObjectFilter): boolean => Boolean(f.notTypes || f.notColors || f.notSupertypes || f.notSubtypes || f.token === false);
const W_OR_NP = P('or');
const W_ANDOR_NP = P('and/or'); // edh-zones-22
const W_AND_NP = P('and');
/** cloud std-spm: the modifiers the second half of `andPhrases` may have beside its one card type or subtype (CR 205.4a supertypes, CR 105.1 colors). */
const AND_HALF_KEYS: ReadonlySet<string> = new Set(['types', 'subtypes', 'supertypes', 'colors', 'notSupertypes']);

/**
 * cloud std-spm (CR 205.2a, 205.4a): "each Spider and legendary creature you control" (Ultimate Spider-Man): a bare card type or subtype and a type with a
 * supertype or a color of its own, joined by "and": the objects that are either one (the modifier after "and" belongs to the second noun only, as in "A or B",
 * FAST5 T59). edh-players-3 (CR 205.4a, 614.1c): the second half may also be a "non<supertype>" description ("creatures and nonbasic lands your opponents control": Thalia, Heretic Cathar).
 * The plain coordination of types ("Spider and Human", "artifact and creature") is the head grammar's, never this; what may follow the whole
 * coordination is who controls or owns them only (`or: true`, as for "or").
 */
function andPhrases(ctx: HoleCtx, pos: number): HeadAlt[] {
  const out: HeadAlt[] = [];
  for (const a of npAlts(ctx, pos, { preOnly: true })) {
    // edh-next-125 (CR 205.2a, 205.3g, 205.3h; Bello, Bard of the Brambles): "each non-Equipment artifact and non-Aura enchantment you control": two card types, each with a
    // "non-<subtype>" of its own, joined by "and": the objects that are either one (an artifact that is not an Equipment, or an enchantment that is not an Aura)
    if (a.head === 'type' && a.flags.length === 0 && typeNonSub(a.filter)) {
      const and2 = phraseAt(ctx, a.end, W_AND_NP);
      if (and2 >= 0) {
        for (const b of npAlts(ctx, and2, { preOnly: true })) {
          if (b.number !== a.number || b.head !== 'type' || b.flags.length > 0 || !typeNonSub(b.filter) || b.filter.types![0] === a.filter.types![0]) continue;
          out.push({ end: b.end, frag: { anyOf: [a.filter, b.filter] }, number: a.number, head: 'type', or: true, postAll: true });
        }
      }
    }
    if (a.head !== 'type' || a.flags.length > 0 || !plainKind(a.filter)) continue;
    const and = phraseAt(ctx, a.end, W_AND_NP);
    if (and < 0) continue;
    for (const b of npAlts(ctx, and, { preOnly: true })) {
      if (b.number !== a.number || b.head !== 'type' || b.flags.length > 0 || plainKind(b.filter)) continue;
      const keys = Object.keys(b.filter).filter((k) => (b.filter as Record<string, unknown>)[k] !== undefined);
      if (!keys.every((k) => AND_HALF_KEYS.has(k)) || (b.filter.supertypes === undefined && b.filter.colors === undefined && b.filter.notSupertypes === undefined)) continue;
      if ((b.filter.types?.length ?? 0) + (b.filter.subtypes?.length ?? 0) !== 1) continue;
      out.push({ end: b.end, frag: { anyOf: [a.filter, b.filter] }, number: a.number, head: 'type', or: true });
    }
  }
  return out;
}
/** edh-next-125: one card type with one "non-<subtype>" of its own and nothing else ("non-Aura enchantment", "non-Equipment artifact"). */
const typeNonSub = (f: ObjectFilter): boolean => f.types?.length === 1 && f.notSubtypes?.length === 1
  && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() === 'notSubtypes,types';
/** FAST5 T59: a description of several type words (card types and subtypes together, or more than one card type): "artifact creature", "Adventure instant". */
const multiKind = (f: ObjectFilter): boolean => f.allTypes !== undefined || (f.types !== undefined && f.subtypes !== undefined) || (f.subtypes?.length ?? 0) > 1;
/** FAST5 T59: a description that is one card type or one subtype and nothing else. */
const plainKind = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return keys.length === 1 && (keys[0] === 'types' || keys[0] === 'subtypes') && (f[keys[0] as 'types' | 'subtypes'] ?? []).length === 1;
};
const SHARED_HEAD_KEYS: Record<string, string[]> = { spell: ['stackKind', 'zone'], token: ['token'] };
/** edh-next-132: a token description of one card type and nothing else ("artifact tokens", "creature tokens"). */
const plainToken = (f: ObjectFilter): boolean => f.token === true && f.types?.length === 1
  && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() === 'token,types';

/**
 * FAST5 T59 (CR 205.2a, 700.6-ish "or"): "A or B" where A and B are noun phrases with modifiers of their own (design 6.3: a post-modifier after the whole
 * coordination holds for both, as for the plain coordination). Each half is a phrase of its own ("land creature or nonbasic land": a land creature, or a land
 * that is not basic), except that a bare card type before a generic head noun shares it ("creature or legendary spell": a creature spell or a legendary
 * spell, the way Oracle writes a counterspell's target, CR 601.2c). Returns head alternatives for the post-modifier chain of `computeNp`.
 */
function orPhrases(ctx: HoleCtx, pos: number): HeadAlt[] {
  const out: HeadAlt[] = [];
  for (const a of npAlts(ctx, pos, { preOnly: true })) {
    if (a.flags.length > 0) continue;
    // edh-zones-22 (CR 109.2, 205.2a; Sorin, Lord of Innistrad): "creatures and/or other planeswalkers" is the same coordination as "or" (a plural list of two descriptions), only when
    // the second half is a type said with "other" (the plain coordination of types has no place for "other" before one of them); any other "and/or" keeps its readings
    for (const [or, andOr] of [[phraseAt(ctx, a.end, W_OR_NP), false], [a.number === 'plural' || (a.head === 'type' && plainKind(a.filter)) ? phraseAt(ctx, a.end, W_ANDOR_NP) : -1, true]] as const) {
    if (or < 0) continue;
    for (const b of npAlts(ctx, or, { preOnly: true })) {
      // edh-next-93 (CR 205.2a, 205.4a; Kamahl's Druidic Vow): "land and/or legendary permanent cards": a bare card type, then "or" / "and/or" and a supertype with the
      // word "permanent": the objects that are that type, or a permanent with that supertype (every permanent type: a legendary sorcery card is no permanent card).
      // The plain type may be singular beside "permanent" (the head noun that follows, "cards", is the template's).
      if (b.head === 'permanent' && b.number === a.number && b.flags.length === 0 && a.head === 'type' && plainKind(a.filter) && a.filter.types !== undefined
        && Object.keys(b.filter).filter((k) => (b.filter as Record<string, unknown>)[k] !== undefined).join() === 'supertypes') {
        out.push({ end: b.end, frag: { anyOf: [a.filter, { ...b.filter, types: PERMANENT_TYPES }] }, number: a.number, head: 'type', or: true });
        continue;
      }
      if (b.number !== a.number || b.flags.length > 0) continue;
      // edh-next-125 (CR 205.2a, 205.3g, 205.3h; Dance of the Manse): also "artifact and/or non-Aura enchantment cards", the plural "and/or" of edh-d-21's "artifact or non-Aura
      // enchantment card" below (a card that is one of the two; "and/or" of a plural list is "or", CR 205.2a): only that shape, before the head noun "cards"
      const andOrNonCards = andOr && b.head === 'type' && typeNonSub(b.filter) && ctx.toks[b.end]?.norm === 'cards';
      // edh-next-132 (CR 111.1, 205.2a; Battle for Bretagard): "artifact tokens and/or creature tokens you control": two plural token descriptions of one card type each, each with the head
      // "tokens" said again: the tokens that are either one (as "artifact and/or creature tokens"); who controls them, after the second, holds for both (`or`)
      if (andOr && a.head === 'token' && b.head === 'token' && a.number === 'plural' && plainToken(a.filter) && plainToken(b.filter) && JSON.stringify(a.filter) !== JSON.stringify(b.filter)) {
        out.push({ end: b.end, frag: { anyOf: [a.filter, b.filter] }, number: 'plural', head: 'token', or: true });
        continue;
      }
      if (andOr && !andOrNonCards && !(b.head === 'type' && b.filter.other === true && b.filter.types?.length === 1)) continue;
      // "a Wizard or basic land card" is a card that is one of the two: the head noun "card" is shared, which the templates of searches and returns say themselves
      const next = ctx.toks[b.end]?.norm;
      if (next === 'card' || next === 'cards') {
        // edh-d-21 (lane type-change; CR 205.2a, 205.3m; Abuelo's Awakening): "artifact or non-Aura enchantment card": a card that is an artifact, or an enchantment that is not an Aura; the
        // head noun "card" is shared. Only a bare card type before a card type with a "non-<subtype>" of its own (anything else is the templates' own, as before)
        if (a.head === 'type' && b.head === 'type' && plainKind(a.filter) && a.filter.types !== undefined && b.filter.types?.length === 1 && b.filter.notSubtypes !== undefined && b.filter.subtypes === undefined
          && Object.keys(b.filter).filter((k) => (b.filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'notSubtypes,types') {
          for (const h of headWord(ctx, b.end, ['card'])) out.push({ end: h.end, frag: { anyOf: [a.filter, b.filter] }, number: h.plural ? 'plural' : 'singular', head: 'card' });
        }
        continue;
      }
      if (a.head === 'type' && b.head === 'type') {
        // "artifact creature or land" says nothing about whether "artifact" goes with the land (design 6.3: no reading is chosen): a half of several type words beside a bare type or subtype
        if ((multiKind(a.filter) && plainKind(b.filter)) || (multiKind(b.filter) && plainKind(a.filter))) continue;
        out.push({ end: b.end, frag: { anyOf: [a.filter, b.filter] }, number: a.number, head: 'type', or: true });
      } else if (a.head === 'type' && (b.head === 'spell' || b.head === 'token')) {
        // the head noun of the second half is the head of both
        const strip = SHARED_HEAD_KEYS[b.head]!;
        const rest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(b.filter)) {
          if (v === undefined) continue;
          if (strip.includes(k) && (k !== 'zone' || v === 'stack')) continue;
          rest[k] = v;
        }
        // "Adventure instant or sorcery spell": the subtype is said once and goes with both (the plain coordination of types distributes it), not with the first half only
        // edh-d-6 (CR 205.3k, 715.3a; Lucky Clover): "Adventure instant or sorcery spell": the instant and sorcery subtype (Adventure, Lesson, Arcane, Trap) goes with both card types
        if (multiKind(a.filter) && plainKind(rest as ObjectFilter)) {
          const t1 = a.filter.types?.[0];
          const t2 = (rest as ObjectFilter).types?.[0];
          if (b.head === 'spell' && a.filter.types?.length === 1 && a.filter.subtypes?.length === 1 && Object.keys(a.filter).filter((k) => (a.filter as Record<string, unknown>)[k] !== undefined).length === 2
            && ['Adventure', 'Lesson', 'Arcane', 'Trap'].includes(a.filter.subtypes[0]!) && (t1 === 'Instant' || t1 === 'Sorcery') && (t2 === 'Instant' || t2 === 'Sorcery') && t1 !== t2) {
            out.push({ end: b.end, frag: { types: [t1, t2], subtypes: a.filter.subtypes }, number: a.number, head: b.head, or: true });
          }
          continue;
        }
        if (Object.keys(rest).length > 0) out.push({ end: b.end, frag: { anyOf: [a.filter, rest as ObjectFilter] }, number: a.number, head: b.head, or: true });
        // CLOUD std-tmt (CR 111.1, 205.2a): a bare "token" after one card type shares no head noun: "another creature or token" is a creature, or a token of any type
        // (Ice Cream Kitty), a permanent either way
        else if (b.head === 'token' && plainKind(a.filter) && a.filter.types !== undefined) out.push({ end: b.end, frag: { anyOf: [a.filter, { token: true }] }, number: a.number, head: 'permanent', or: true });
      }
    }
    }
  }
  return out;
}

const W_LIST_COMMA = P(',');
/** std-lci: the words that close a list of three or more descriptions (", and" only for plural descriptions: "artifacts, enchantments, and nonbasic lands"). */
const W_LIST_LAST: readonly [string[], 'any' | 'plural'][] = [[P(', or'), 'any'], [P(', and/or'), 'plural'], [P(', and'), 'plural']];
const MAX_LIST = 8;

/**
 * std-lci (CR 205.2a, 205.3, 205.4a; 115.1): "creature, Vehicle, or nonbasic land", "artifact, enchantment, or tapped creature", "artifacts, enchantments, and
 * nonbasic lands": a list of three or more descriptions, each a noun phrase of its own modifiers (FAST5 T59's two halves joined by "or", extended to a list
 * whose items are separated by commas and closed by ", or"): the object is any one of them. One alternative per item, in the printed order. Only lists that
 * name kinds (card types and subtypes, with their own pre-modifiers): an item of several type words ("artifact creature") or a generic head ("nonland
 * permanent") has no reading, and a list followed by "card(s)" is the templates' own ("a basic Forest, Plains, or Island card"). As for "or", only who
 * controls or owns the objects may follow the whole list (`or: true`), and a span the plain grammar reads keeps its reading ("each tapped artifact,
 * creature, and land": "tapped" goes with all three, computeNp's covered set).
 */
function listPhrases(ctx: HoleCtx, pos: number): HeadAlt[] {
  const out: HeadAlt[] = [];
  const kindsAt = (p: number, number: 'singular' | 'plural' | undefined): NpAlt[] =>
    npAlts(ctx, p, { preOnly: true }).filter((a) => a.head === 'type' && a.flags.length === 0 && !multiKind(a.filter) && (number === undefined || a.number === number));
  const walk = (p: number, items: NpAlt[]): void => {
    if (items.length >= MAX_LIST) return;
    for (const a of kindsAt(p, items[0]?.number)) {
      const next = [...items, a];
      // ", or" / ", and/or" / ", and" before the last item: a list of three or more
      if (next.length >= 2) {
        for (const [ws, number] of W_LIST_LAST) {
          if (number === 'plural' && a.number !== 'plural') continue;
          const e = phraseAt(ctx, a.end, ws);
          if (e < 0) continue;
          // Standard round 3, r3-fx (CR 111.1, 205.2a): a bare "token" closing a list of card types, "an artifact, enchantment, or token": a permanent of one of the
          // types, or a token of any type (a permanent either way); only plain card types before it, nothing after it but what the rest of the phrase reads
          // (singular only: the plural "artifacts, enchantments, and/or tokens" is FAST5 T65's own wording, read by its templates)
          const tokenWord = ctx.toks[e]?.norm;
          if (a.number === 'singular' && tokenWord === 'token' && next.every((x) => plainKind(x.filter) && x.filter.types !== undefined && x.filter.subtypes === undefined)) {
            out.push({ end: e + 1, frag: { anyOf: [...next.map((x) => x.filter), { token: true }] }, number: a.number, head: 'permanent', or: true });
          }
          // edh-next-116 (CR 205.2a, 205.4a, 700.6-style any-of; Rob the Hoard): "artifact, enchantment, or legendary card": bare card types, then ", or" and the supertype
          // "legendary" with the shared head noun "card" (singular): a card that is one of the types or is legendary
          if (ws === W_LIST_LAST[0]![0] && a.number === 'singular' && next.every((x) => plainKind(x.filter) && x.filter.types !== undefined)) {
            const lg = phraseAt(ctx, e, W_LEGENDARY_WORD);
            if (lg >= 0) for (const h of headWord(ctx, lg, ['card'])) if (!h.plural) out.push({ end: h.end, frag: { anyOf: [...next.map((x) => x.filter), { supertypes: ['Legendary'] }] }, number: 'singular', head: 'card' });
          }
          for (const last of kindsAt(e, a.number)) {
            const all = [...next, last];
            const after = ctx.toks[last.end]?.norm;
            if (after === 'card' || after === 'cards') {
              // edh-d-21 (CR 205.2a, 205.3m; Excava, the Risen Past): "artifact, creature, or non-Aura enchantment card": bare card types, then one card type with a "non-<subtype>" of its own; "card" is shared
              if (all.slice(0, -1).every((x) => plainKind(x.filter) && x.filter.types !== undefined) && last.filter.types?.length === 1 && last.filter.notSubtypes !== undefined && last.filter.subtypes === undefined
                && Object.keys(last.filter).filter((k) => (last.filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'notSubtypes,types') {
                for (const h of headWord(ctx, last.end, ['card'])) out.push({ end: h.end, frag: { anyOf: all.map((x) => x.filter) }, number: h.plural ? 'plural' : 'singular', head: 'card' });
              }
              continue;
            }
            // a list of plain kinds is the plain coordination's (shape(), FAST5 T40): only a list with an item of its own modifiers is read here
            if (all.every((x) => plainKind(x.filter))) continue;
            out.push({ end: last.end, frag: { anyOf: all.map((x) => x.filter) }, number: a.number, head: 'type', or: true });
          }
        }
      }
      // "," before the next item (never ", or": the closing words are read above)
      const c = phraseAt(ctx, a.end, W_LIST_COMMA);
      const w = ctx.toks[c]?.norm;
      if (c >= 0 && w !== 'or' && w !== 'and' && w !== 'and/or') walk(c, next);
    }
  };
  walk(pos, []);
  return out;
}

/** FAST4 T28: the head "<subtype> and/or <card type>" of `shape` (a subtype first, then a card type, nothing else). */
/**
 * FAST5X E27 review (CR 115.1, 601.2c): `f` (a filter whose kinds are the list `head`, a list of two or more card types) with a keyword feature `kw` that
 * belongs to the last type only: { anyOf: [{ types: the other types }, { types: [the last type], ...kw }] } and the rest of `f`. Null for any other list.
 */
function keywordOnLastType(f: ObjectFilter, head: ObjectFilter, kw: ObjectFilter): ObjectFilter | null {
  const types = head.types;
  if (types === undefined || types.length < 2 || Object.keys(head).length !== 1 || f.anyOf !== undefined || f.allTypes !== undefined) return null;
  if (JSON.stringify(f.types) !== JSON.stringify(types)) return null;
  const last = mergeFilter({ types: [types[types.length - 1]!] }, kw);
  if (last === null) return null;
  const { types: _all, ...rest } = f;
  return { ...rest, anyOf: [{ types: types.slice(0, -1) }, last] };
}

function isSubtypeFirst(f: ObjectFilter): boolean {
  const a = f.anyOf;
  return Object.keys(f).length === 1 && a !== undefined && a.length === 2 && Object.keys(a[0]!).join() === 'subtypes' && Object.keys(a[1]!).join() === 'types';
}

/** CR 111.1: a "card" is never a token. CR 405.1 / 113.3: spells and abilities are objects on the stack; ability heads default to "an ability on the stack". */
/** edh-c-83: the marker of the set a bare "with the greatest <stat>" compares with (featureAt); the noun phrase that has it fills it (`fillHeadSet`). */
const HEAD_SET = '$headSet';

/**
 * edh-c-83 (CR 208.1, 202.3, 608.2d; Favor of the Mighty): "each creature with the greatest mana value" compares with the creatures themselves: the set is the whole description of the
 * noun phrase without that comparison ("creatures you control with the greatest power" compares with the creatures you control). A comparison nested anywhere else, or two of them,
 * has no reading (null). The description needs a card type (a bare "thing with the greatest power" names no set).
 */
function fillHeadSet(f: ObjectFilter): ObjectFilter | null {
  const keys = (['power', 'toughness', 'manaValue'] as const).filter((k) => JSON.stringify(f[k] ?? null).includes(HEAD_SET));
  if (keys.length === 0) return f;
  if (JSON.stringify(f).split(HEAD_SET).length !== 2 || keys.length !== 1) return null;
  const k = keys[0]!;
  const { [k]: own, ...rest } = f;
  if (rest.types === undefined || rest.types.length === 0 || rest.zone === 'stack' || rest.zone === 'graveyard' || rest.zone === 'hand' || rest.zone === 'library' || rest.zone === 'exile') return null;
  const value = JSON.parse(JSON.stringify((own as { value: unknown }).value)) as { of: { filter: Record<string, unknown> } };
  value.of.filter = rest as never;
  return { ...rest, [k]: { ...(own as object), value } } as ObjectFilter;
}

function finalize(f: ObjectFilter, head: HeadKind): ObjectFilter {
  const out: ObjectFilter = { ...f };
  if (head === 'card') out.isCard = true;
  if (head === 'stackObject' && out.zone === undefined) out.zone = 'stack';
  if (head === 'token') out.token = true;
  if (head === 'spell') { out.stackKind = 'spell'; if (out.zone === undefined) out.zone = 'stack'; }
  // std-copy-2 (CR 722.3a, 722.3d): only a permanent is prepared; "a prepared spell" is a prepare spell (Codie, Ravenous Codex)
  if (head === 'spell' && out.prepared === true) { delete out.prepared; out.prepareSpell = true; }
  if (head === 'ability') { if (out.stackKind === undefined) out.stackKind = 'ability'; if (out.zone === undefined) out.zone = 'stack'; }
  return out;
}

// ---------------------------------------------------------------------------
// the hole
// ---------------------------------------------------------------------------

/** `Filter`: a noun phrase with an optional article: "a creature", "another creature you control", "other creatures", "nonland permanents". */
/** CLOUD C5: the `Chosen` hole, "of the chosen color" / "of the chosen type" on its own: the `chosen` field of a filter with the link placeholder (CR 607.2d). */
export const chosenOf: HoleFn = (ctx, pos) => {
  const ch = phraseAt(ctx, pos, P('of the chosen'));
  if (ch < 0) return [];
  return CHOSEN.flatMap(([ws, quality]) => { const e = phraseAt(ctx, ch, ws); return e >= 0 ? [{ end: e, value: { link: '$link', quality } }] : []; });
};

export const filter: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const push = (n: NpAlt, extra?: ObjectFilter): void => {
    // std-rx20 (CR 110.4): the head "permanent" right before the word "card(s)" of a pattern ("search your library for a {f:Filter} card", Planar Bridge) is the
    // six permanent types, as the phrase "permanent card" is (headAt); read alone it would describe any card (no types). A filter with card types is no reading.
    if (n.head === 'permanent' && (ctx.toks[n.end]?.norm === 'card' || ctx.toks[n.end]?.norm === 'cards')) {
      if (n.filter.types !== undefined) return;
      n = { ...n, filter: { ...n.filter, types: PERMANENT_TYPES } };
    }
    const f = extra === undefined ? n.filter : mergeFilter(n.filter, extra);
    if (f === null) return;
    out.push({ end: n.end, value: f, ...(n.weak ? { weak: n.weak } : {}), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
  };
  for (const n of npAlts(ctx, pos)) push(n);
  const t = ctx.toks[pos]?.norm;
  if (t === 'a' || t === 'an') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular') push(n);
  if (t === 'another') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular') push(n, { other: true });
  if (t === 'other') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'plural') push(n, { other: true });
  for (const n of yourCommanderAt(ctx, pos)) out.push({ end: n.end, value: n.filter });
  return dedupe(out);
};

/**
 * M11-4 (CR 903.3, 903.3e; 702.124e: with two commanders, either one): "your commander" is a commander you own, "your commanders" all of them, wherever the
 * rest of the sentence says (alone: on the battlefield, "you control your commander", CR 903.3d). Only the bare noun: "your commander creature" is not Oracle's.
 */
export function yourCommanderAt(ctx: HoleCtx, pos: number): { end: number; filter: ObjectFilter; number: 'singular' | 'plural' }[] {
  if (ctx.toks[pos]?.norm !== 'your') return [];
  const out: { end: number; filter: ObjectFilter; number: 'singular' | 'plural' }[] = [];
  for (const [ws, number] of [[W_COMMANDER, 'singular'], [W_COMMANDERS, 'plural']] as const) {
    const e = phraseAt(ctx, pos + 1, ws);
    if (e >= 0) out.push({ end: e, filter: { commander: true, owner: 'you' }, number });
  }
  return out;
}


/** A single head noun (a card type, a subtype or a generic noun), for "that creature", "those cards", "the exiled card". */
export function headNounAt(ctx: HoleCtx, pos: number): { end: number; head: string; plural: boolean }[] {
  const out: { end: number; head: string; plural: boolean }[] = [];
  for (const it of itemsAt(ctx, pos)) out.push({ end: it.end, head: it.item.name.toLowerCase(), plural: it.item.plural });
  for (const h of headWord(ctx, pos, ['permanent', 'card', 'spell', 'token', 'ability', 'source' /* edh-mana-keywords-4: "that source's controller", the source of the damage (CR 120.3) */])) out.push({ end: h.end, head: h.head, plural: h.plural });
  return out;
}
