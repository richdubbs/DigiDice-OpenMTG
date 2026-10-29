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
import { P, anaphorObj, anyPhraseAt, cmpAt, dedupe, mergeFilter, multiAt, phraseAt, predOf } from './core';
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
const HISTORIC: ObjectFilter = { anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] };
P('historic'); P('attacking or blocking'); P('another'); P('other'); P('non');
/** FAST5X E1, CR 700.12: "outlaw" is the word for an object with the Assassin, Mercenary, Pirate, Rogue and/or Warlock creature types. */
export const OUTLAW_SUBTYPES: readonly string[] = ['Assassin', 'Mercenary', 'Pirate', 'Rogue', 'Warlock'];
P('outlaw');
const W_ATTACKING_EQUIPPED = P('attacking equipped'); // FAST4 T33
const W_EQUIPPED_ATTACKING = P('equipped attacking'); // std-hob
const W_ACTIVATED_OR_TRIGGERED = P('activated or triggered'); // FAST5 T45
const W_THATS = P("that's"); // FAST5 T57
const W_ONE_OR_MORE_COLORS = P('one or more colors'); // CLOUD std-misc
const W_OTHER_THAN_ATTACHED = [P('other than enchanted creature'), P('other than equipped creature')]; // FAST4 T33
const W_ATTACHED_TO = P('attached to'); // CLOUD std-msh
const W_BLOCKING = P('blocking'); // p2-combat-flow-1
const W_BLOCKED_BY = P('blocked by'); // p2-combat-flow-1
const W_BLOCKING_OR_BLOCKED_BY = [P('blocking or blocked by'), P('blocking or being blocked by')]; // p2-combat-flow-1
const W_ATTACKING_ALONE = [P("that's attacking alone"), P('that is attacking alone')]; // CLOUD std-msh (CR 506.5)
// p2-combat-flow-1 (CR 506.3, 508.1b): "target creature without flying that's attacking you" (Hunting Kavu): attacking you, the player (never a planeswalker you control)
const W_ATTACKING_YOU = [P("that's attacking you"), P('that is attacking you'), P('that are attacking you'), P('attacking you')];
const W_ATTACKING_YOU_OR_WALKER = [P("that's attacking you or a planeswalker you control"), P('that is attacking you or a planeswalker you control'), P('that are attacking you or a planeswalker you control'), P('attacking you or a planeswalker you control')]; // pc-combat-3
const W_ATTACKING_OPPONENT = [P("that's attacking one of your opponents"), P('that is attacking one of your opponents'), P('that are attacking one of your opponents')]; // r4-static

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

const COLOR_SEPS = [P('or'), P(', or'), P(',')];

function colorMod(ctx: HoleCtx, pos: number): { end: number; frag: ObjectFilter }[] {
  const out: { end: number; frag: ObjectFilter }[] = [];
  const walk = (p: number, acc: string[]): void => {
    const t = ctx.toks[p];
    const c = t !== undefined && t.kind === 'WORD' ? ctx.vocab.colors.get(t.norm) : undefined;
    if (c === undefined || acc.includes(c)) return;
    const next = [...acc, c];
    out.push({ end: p + 1, frag: { colors: next as never } });
    for (const sep of COLOR_SEPS) { const e = phraseAt(ctx, p + 1, sep); if (e >= 0) walk(e, next); }
  };
  walk(pos, []);
  return out;
}

/** std-blb: the tapped and combat statuses a list of alternatives may join ("target attacking, blocking, or tapped creature"). */
const LISTED_STATUS: readonly string[] = ['attacking', 'blocking', 'tapped', 'untapped', 'blocked', 'unblocked'];
const STATUS_CLASH: readonly (readonly string[])[] = [['tapped', 'untapped'], ['blocked', 'unblocked']];
const STATUS_LIST_SEPS = [P('or'), P(', or'), P(',')];
const W_OR = P('or');

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
  if (t === undefined || t.kind !== 'WORD') return out;
  const w = t.norm;
  if (w === 'colorless' || w === 'multicolored' || w === 'monocolored') out.push({ end: pos + 1, frag: STATUS[w]! });
  else {
    out.push(...colorMod(ctx, pos));
    const s = STATUS[w];
    if (s !== undefined && w !== 'colorless') out.push({ end: pos + 1, frag: s });
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
    if (head !== undefined && !head.plural && (art === 'a' || art === 'an' || (art === 'target' && w === 'enchanted'))) out.push({ end: pos + 1, frag: w === 'enchanted' ? { enchanted: true } : { equipped: true } });
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
interface HeadAlt { end: number; frag: ObjectFilter; number: 'singular' | 'plural'; head: HeadKind; or?: true; list?: true }

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
        if (f.subtypes !== undefined && f.subtypes.length === 1 && f.types === undefined) {
          for (const [ws, plural] of [[W_PERMANENT_CARD, false], [W_PERMANENT_CARDS, true]] as const) {
            const e = phraseAt(ctx, it.end, ws);
            if (e >= 0) out.push({ end: e, frag: { ...f, types: PERMANENT_TYPES }, number: plural ? 'plural' : 'singular', head: 'card' });
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
  for (const [ws, plural] of [[W_SPELL_OR_ABILITY, false], [W_SPELLS_OR_ABILITIES, true]] as const) {
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
const W_WITHOUT = P('without');
const W_EACH_WITH = P('each with'); // Cloud r3-repl
const W_NAMED = P('named');
const W_THAT = P('that');
/** FAST5 T68 (CR 303.4b): an Aura the ability's controller controls is attached to the object (ObjectFilter.enchantedBy), plural and singular wordings. */
const W_ENCHANTED_BY_YOUR_AURA = [P('that are enchanted by auras you control'), P("that's enchanted by an aura you control"), P('that is enchanted by an aura you control')];
const W_DEALT_DAMAGE_BY_SELF = P('dealt damage by ~ this turn');
const W_CREWED_BY_SELF = P('crewed by ~ this turn'); // Standard round 5, r5-trig
/** FAST4 T19: the participle of the objects a damage step dealt damage to (lower/mentions.ts gives the step's mention this verb). */
export const DEALT_DAMAGE_THIS_WAY = 'dealt damage this way';
/** Cloud std-eoe: the participle of the cards a destroy or sacrifice step put into graveyards (lower/mentions.ts, render/np.ts). */
export const PUT_INTO_GRAVEYARD_THIS_WAY = 'put into a graveyard this way';
const W_PUT_INTO_A_GRAVEYARD_THIS_WAY = P('put into a graveyard this way');
const W_PUT_INTO_YOUR_GRAVEYARD_THIS_WAY = P('put into your graveyard this way');
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
const W_SAME_NAME_AS = P('the same name as');
const KINDS: [string[], 'creatureType' | 'color' | 'cardType' | 'name' | 'landType'][] = [
  [P('creature type'), 'creatureType'], [P('color'), 'color'], [P('card type'), 'cardType'], [P('name'), 'name'], [P('land type'), 'landType'],
];
const W_OF_THAT_TYPE = P('of that type'); // FAST5 T67
const W_MV_CHOSEN_QUALITY = P('with mana value of the chosen quality'); // Cloud std-eoe
const CHOSEN: [string[], 'color' | 'creatureType' | 'cardType' | 'landType' | 'cardName'][] = [
  // CLOUD C5 (CR 607.2d): "the chosen type" is the type the linked ability chose, of whatever kind (lower/links.ts reads '$chosenType' against the producer)
  [P('type'), '$chosenType' as never], [P('creature type'), 'creatureType'], [P('color'), 'color'], [P('card type'), 'cardType'], [P('land type'), 'landType'], [P('basic land type'), 'landType'],
  [P('card name'), 'cardName'],
];

function plainPlayerForm(ctx: HoleCtx, pos: number): { end: number; pred: PlayerPred; neg: boolean; verb: 'control' | 'own' }[] {
  const out: { end: number; pred: PlayerPred; neg: boolean; verb: 'control' | 'own' }[] = [];
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
const W_MV_POWER_OR_TOUGHNESS = P('mana value , power , or toughness'); // std-rx5
const W_LESSER_MANA_VALUE = P('lesser mana value');
const W_EQUAL_OR_LESSER_MANA_VALUE = P('equal or lesser mana value'); // std-rx28
const W_DIFFERENT_NAMES = P('different names');
const W_SHARE_A_CREATURE_TYPE = P('share a creature type'); // CLOUD std-ecl
const W_NO_ABILITIES = P('no abilities');
/** std-sos (CR 107.3, 202.1): "a spell with {X} in its mana cost", "cards with {X} in their mana costs" (Oracle also prints the plural "in their mana cost"). */
/** Standard round 5, r5-trig (CR 107.4): "blue mana symbols in its mana cost", per color. */
const W_COLOR_SYMBOLS_IN_COST: readonly (readonly ['W' | 'U' | 'B' | 'R' | 'G', string[]])[] = [
  ['W', P('white mana symbols in its mana cost')], ['U', P('blue mana symbols in its mana cost')], ['B', P('black mana symbols in its mana cost')],
  ['R', P('red mana symbols in its mana cost')], ['G', P('green mana symbols in its mana cost')],
];
const W_X_IN_MANA_COST = [P('{x} in its mana cost'), P('{x} in their mana costs'), P('{x} in their mana cost')];
const W_NO_COUNTERS = P('no counters on it'); // FAST5 T59
const W_A_BASIC_LAND_TYPE = P('a basic land type'); // edh-zones-1
const W_THE_MOST = P('the greatest'); // FAST5X E15: "with the greatest power among ..."
const W_POWER_GREATER_THAN_BASE = [P('power greater than its base power'), P('power greater than their base power')]; // std-rx11
const W_CHOSEN_NAME = [P('the chosen name'), P('that name')]; // CLOUD std-misc

/** "with <feature>" / "that has <feature>" (positive) or "without <feature>" (negated). */
export function featureAt(ctx: HoleCtx, pos: number, negate: boolean): { end: number; frag: ObjectFilter; weak?: number }[] {
  const out: { end: number; frag: ObjectFilter; weak?: number }[] = [];
  const wrap = (f: ObjectFilter): ObjectFilter => (negate ? { not: f } : f);
  // keyword list: "flying", "flying or reach"
  const kwWalk = (p: number, acc: string[]): void => {
    for (const m of multiAt(ctx, p, ctx.vocab.keywords)) {
      const names = [...acc, m.entry.name];
      if (negate) out.push({ end: m.end, frag: { notKeyword: names.length === 1 ? names[0]! : names } });
      else out.push({ end: m.end, frag: { keyword: names.length === 1 ? names[0]! : names } });
      // p2-attack-block-1 (CR 702.9b, 702.17b): "without flying or reach" is a creature with neither (`notKeyword` with both: rules/filter.ts excludes an object
      // with any of them), as render/np.ts says it
      { const e = phraseAt(ctx, m.end, P('or')); if (e >= 0) kwWalk(e, names); }
    }
  };
  kwWalk(pos, []);
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
  // std-hob (CR 201.2): "a legendary card with the same name as a legendary permanent you control": the name of any one object of that description (rules/filter.ts:
  // `sharesWith` reads a set as "some object of it")
  const sameT = same >= 0 ? ctx.toks[same]?.norm : undefined;
  if (same >= 0 && (sameT === 'a' || sameT === 'an')) {
    for (const n of npAlts(ctx, same + 1)) {
      if (n.number !== 'singular' || n.flags.some((x) => x !== 'zone-unstated')) continue;
      out.push({ end: n.end, frag: { sharesWith: { with: { ref: 'each', filter: n.filter }, quality: 'name' } }, ...(n.weak ? { weak: n.weak } : {}) });
    }
  }
  // FAST5X E15 (CR 208.1, 202.3): "with the greatest power among creatures they control": a value at least the greatest one of the set (at most the least
  // one), so the matching objects are the tied greatest; the player who chooses picks among them (CR 608.2d). Only "with", never "without". The set takes
  // every word it can ("among creatures they control"): a shorter set would leave "they control" to the outer noun, a different reading (guard G5).
  if (!negate && phraseAt(ctx, pos, W_THE_MOST) >= 0) {
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
  // CLOUD std-misc (CR 607.2d, 608.2c-d; The Clone Saga, Ancient Vendetta): "with the chosen name", "with that name": the card name an earlier "Choose a card name."
  // of the same ability chose (the links pass, parser/lower/links.ts, replaces the placeholder; with no such choice it survives and the sentence is manual). Only "with".
  const chosenName = negate ? -1 : anyPhraseAt(ctx, pos, W_CHOSEN_NAME);
  if (chosenName >= 0) out.push({ end: chosenName, frag: { chosen: { link: '$link', quality: 'cardName' } } });
  // power / toughness / mana value with a comparison
  const stats: [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('power'), 'power'], [P('toughness'), 'toughness'], [P('mana value'), 'manaValue']];
  // Standard round 4, r4-trig (CR 208.1): "toughness greater than its power" is the object's own comparison (below), never a comparison with what "its" names
  const ownTgp = negate ? -1 : phraseAt(ctx, pos, P('toughness greater than its power'));
  for (const [ws, field] of stats) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) for (const c of cmpAt(ctx, e)) if (!(field === 'toughness' && c.end === ownTgp)) out.push({ end: c.end, frag: wrap({ [field]: c.cmp }), ...(c.weak ? { weak: c.weak } : {}) });
  }
  // FAST5 T42 (CR 113.1): "creature cards with no abilities" (Rise from the Wreck): not one ability of any kind; a keyword is an ability (rules/filter.ts#hasAbilityOfKind),
  // a card with an ability of unknown kind is unevaluable there, so it is never offered as having none
  const noAbilities = negate ? -1 : phraseAt(ctx, pos, W_NO_ABILITIES);
  if (noAbilities >= 0) out.push({ end: noAbilities, frag: { not: { anyOf: [{ hasAbility: 'activated' }, { hasAbility: 'triggered' }, { hasAbility: 'static' }] } } });
  // FAST5 T42 (CR 202.3): "with lesser mana value" (Jackdaw Savior, Clement, the Worrywort): a mana value lower than that of the object the trigger's event is about
  // (the creature that died or entered, role `subject`); only "with", and only where the ability has such an event (otherwise the sentence is manual)
  const lesser = negate ? -1 : phraseAt(ctx, pos, W_LESSER_MANA_VALUE);
  if (lesser >= 0) out.push({ end: lesser, frag: { manaValue: { op: '<', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'subject' } } } } });
  // std-rx28 (CR 202.3, 601.2i; Kellan, the Kid): "with equal or lesser mana value" in the effect of a cast trigger: a mana value at most that of the spell the
  // trigger's cast event is about (role `spell`); only "with". Where the ability has no such event (a dies or enters trigger, a spell) the lint refuses the role
  // (model/lint-roles.ts), so the sentence stays manual (fail closed)
  const eqLesser = negate ? -1 : phraseAt(ctx, pos, W_EQUAL_OR_LESSER_MANA_VALUE);
  if (eqLesser >= 0) out.push({ end: eqLesser, frag: { manaValue: { op: '<=', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } } } } });
  // CLOUD std-msh (CR 202.3, 208.1): "with greater mana value than that creature" (Evil's Thrall), "with greater power than ~": more than the statistic of one object
  // the sentence names (this object, or one it refers back to); only "with"
  for (const [w, op] of [['greater', '>'], ['lesser', '<']] as const) {
    if (negate || ctx.toks[pos]?.norm !== w) continue;
    for (const [ws, stat] of [[P('mana value than'), 'manaValue'], [P('power than'), 'power'], [P('toughness than'), 'toughness']] as const) {
      const e = phraseAt(ctx, pos + 1, ws);
      if (e >= 0) for (const o of ctx.call('Obj', e)) if (isAttachHost(o.value) && (o.value as { ref?: string }).ref !== 'attachedTo') out.push({ end: o.end, frag: { [stat]: { op, value: { q: 'stat', stat, of: o.value } } } as ObjectFilter });
    }
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
  // std-rx10 (CR 208.1; Meek Attack): "with total power and toughness 5 or less", the sum of the object's own power and toughness; only "with"
  const tpt = negate ? -1 : phraseAt(ctx, pos, P('total power and toughness'));
  if (tpt >= 0) for (const c of cmpAt(ctx, tpt)) out.push({ end: c.end, frag: { totalPowerToughness: c.cmp } });
  // std-rx11 (CR 208.1, 613.4; Kutzil, Malamet Exemplar; Ms. Marvel, Elastic Ally): "with power greater than its base power" (its own power against its own base
  // power); "their" after a plural noun; only "with"
  const pgb = negate ? -1 : anyPhraseAt(ctx, pos, W_POWER_GREATER_THAN_BASE);
  if (pgb >= 0) out.push({ end: pgb, frag: { powerGreaterThanBase: true } });
  // FAST4 T25: "with power or toughness 4 or greater" (Repel Calamity): either statistic meets the one comparison (CR 208.1); only "with", never "without"
  const pot = negate ? -1 : phraseAt(ctx, pos, W_POWER_OR_TOUGHNESS);
  if (pot >= 0) for (const c of cmpAt(ctx, pot)) out.push({ end: c.end, frag: { anyOf: [{ power: c.cmp }, { toughness: c.cmp }] } });
  // std-rx5 (CR 202.3, 208.1): "with mana value, power, or toughness equal to the chosen number" (Talion, the Kindly Lord): any of the three meets the one comparison
  const mpt = negate ? -1 : phraseAt(ctx, pos, W_MV_POWER_OR_TOUGHNESS);
  if (mpt >= 0) for (const c of cmpAt(ctx, mpt)) out.push({ end: c.end, frag: { anyOf: [{ manaValue: c.cmp }, { power: c.cmp }, { toughness: c.cmp }] } });
  // FAST5 T45 (CR 115.9a): "a spell with a single target" (the number of times anything was chosen as a target); only "with", never "without"
  const st1 = negate ? -1 : phraseAt(ctx, pos, P('a single target'));
  if (st1 >= 0) out.push({ end: st1, frag: { targetCount: { op: '==', value: 1 } } });
  // abilities by kind
  const abil: [string[], 'activated' | 'triggered' | 'mana' | 'static'][] = [[P('an activated ability'), 'activated'], [P('a triggered ability'), 'triggered'], [P('a mana ability'), 'mana']];
  for (const [ws, v] of abil) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: wrap({ hasAbility: v }) }); }
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
  // FAST5 T41 (CR 122.1): "creatures you control with counters on them": a counter of any kind on each (plural, no article)
  if (!negate) { const anyOnThem = phraseAt(ctx, pos, W_COUNTERS_ON_THEM); if (anyOnThem >= 0) out.push({ end: anyOnThem, frag: { counters: { kind: 'any' } } }); }
  // FAST4 T27 (CR 122.1): "a creature with a counter on it": a counter of any kind (kind 'any', rules/filter.ts)
  const anyCounter = phraseAt(ctx, pos, P('a counter on it'));
  if (anyCounter >= 0) out.push({ end: anyCounter, frag: wrap({ counters: { kind: 'any' } }) });
  if (phraseAt(ctx, pos, P('no')) >= 0) counterCmp(pos + 1, { op: '==', value: 0 });
  // FAST5 T59 (CR 122.1): "creature with no counters on it" (Heartless Act): not one counter of any kind (the sum over every kind is 0, rules/filter.ts)
  const noAnyCounter = negate ? -1 : phraseAt(ctx, pos, W_NO_COUNTERS);
  if (noAnyCounter >= 0) out.push({ end: noAnyCounter, frag: { counters: { kind: 'any', cmp: { op: '==', value: 0 } } } });
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
  return out;
}

function playerOfSharing(ctx: HoleCtx, pos: number): Frag[] {
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
      // pc-keywords-mana-2 (CR 903.3d, 903.3e, 205.3m; Path of Ancestry): "shares a creature type with your commander": a commander you own (either one with two), the set form of
      // `sharesWith` ("some object of it", rules/filter.ts) over the commander wherever it is (the command zone most of the time, CR 903.6); no commander, no match
      for (const c of yourCommanderAt(ctx, w)) if (c.number === 'singular') out.push({ end: c.end, frag: { sharesWith: { with: { ref: 'each', filter: { ...c.filter, zone: ['battlefield', 'command', 'stack', 'exile', 'hand', 'graveyard', 'library'] } }, quality } } });
    }
  }
  return out;
}

const REL: [string[], ObjectFilter][] = [
  [P('was dealt damage this turn'), { dealtDamageThisTurn: true }], [P('were dealt damage this turn'), { dealtDamageThisTurn: true }],
  [P('dealt damage this turn'), { dealtDamageAsSourceThisTurn: true }], // std-mkm (CR 120.1): "a creature that dealt damage this turn" (the object as the damage's source)
  [P('attacked this turn'), { attackedThisTurn: true }], [P('blocked this turn'), { blockedThisTurn: true }],
  // p2-damage-2 (CR 508.1a): "creatures that player controls that didn't attack this turn" (Kratos, God of War): never declared as an attacker this turn
  [P("didn't attack this turn"), { attackedThisTurn: false }],
  // p2-damage-3 (CR 303.4b): "all creatures that aren't enchanted" (Winds of Rath), "target creature that isn't enchanted" (Brainspoil): no Aura is attached to it
  [P("isn't enchanted"), { enchanted: false }], [P("aren't enchanted"), { enchanted: false }],
  [P('entered the battlefield this turn'), { enteredThisTurn: true }], [P('entered this turn'), { enteredThisTurn: true }],
  // r3-choose (CR 400.7): "a card in your graveyard that was put there from anywhere this turn" (render/np.ts says it only after a named zone)
  [P('was put there from anywhere this turn'), { putThereThisTurn: true }], [P('were put there from anywhere this turn'), { putThereThisTurn: true }],
  // r5-fxz (CR 400.7): "... that were put there from the battlefield this turn" (Supper for Spiders); "that was put there this turn" is from anywhere
  [P('was put there from the battlefield this turn'), { putThereThisTurn: true, putThereFrom: 'battlefield' }], [P('were put there from the battlefield this turn'), { putThereThisTurn: true, putThereFrom: 'battlefield' }],
  [P('was put there this turn'), { putThereThisTurn: true }], [P('were put there this turn'), { putThereThisTurn: true }],
  // FAST5X E3 (CR 702.171c): "a creature that saddled it this turn" ("it" is the Mount with the ability: only its own abilities say it)
  [P('saddled it this turn'), { saddledThisTurn: { ref: 'self' } }], [P('saddled ~ this turn'), { saddledThisTurn: { ref: 'self' } }],
  // r5-static (CR 201.2a, 708.2a): "creatures that don't have a name" (a face-down creature has none)
  [P("don't have a name"), { nameless: true }], [P("doesn't have a name"), { nameless: true }],
  // r5-fxb (CR 702.122): "target creature that crewed it this turn" ("it" is the Vehicle with the ability: only its own abilities say it)
  [P('crewed it this turn'), { crewedThisTurn: { ref: 'self' } }], [P('crewed ~ this turn'), { crewedThisTurn: { ref: 'self' } }],
  // r5-fxb (CR 603.10a, 301.5): "an Equipment that was attached to ~" (~ has left the battlefield: its last known information)
  [P('was attached to ~'), { wasAttachedTo: { ref: 'self' } }],
  [P('targets ~'), { targets: { ref: 'self' } }], [P('target ~'), { targets: { ref: 'self' } }], [P('targets you'), { targets: { ref: 'you' } }],
];

const W_TARGETS_A = P('targets');
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
      if (depth < 4) for (const sep of W_ARE_SEPS) { const e = phraseAt(ctx, it.end, sep); if (e >= 0) walk(e, next, depth + 1); }
    }
  };
  walk(pos + 1, [], 0);
  return out;
}

const W_KIND_SEPS = [P(', or'), P('or'), P(',')];

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

function relClause(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  out.push(...areList(ctx, pos)); // FAST5 T49
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
  out.push(...playerOfSharing(ctx, pos));
  for (const verb of ['has', 'have']) {
    if (ctx.toks[pos]?.norm === verb) for (const f of featureAt(ctx, pos + 1, false)) out.push({ end: f.end, frag: f.frag });
  }
  // r4-static (CR 715.1): "target card that has an Adventure" (Edgewall Inn), FAST5 T49's adventurer card
  if (ctx.toks[pos]?.norm === 'has') { const e = phraseAt(ctx, pos + 1, W_AN_ADVENTURE); if (e >= 0) out.push({ end: e, frag: { adventure: true } }); }
  // std-re (CR 715.1): and the plural, "put all cards that have an Adventure from among the milled cards into your hand" (Seek Thrills); weak (design 6.3 rule 2),
  // so r4-cost's fixed "<spells> you cast that have an Adventure cost {1} less to cast" keeps its sentence
  if (ctx.toks[pos]?.norm === 'have') { const e = phraseAt(ctx, pos + 1, W_AN_ADVENTURE); if (e >= 0) out.push({ end: e, frag: { adventure: true }, weak: 1 }); }
  out.push(...notSameNameAs(ctx, pos)); // cloud std-dsk
  out.push(...controlForms(ctx, pos));
  // CLOUD C5 (CR 607.2d, 608.2c): "Destroy all creatures that aren't of the chosen type" (Kindred Dominance): not of the type the linked choice chose
  const neg = ctx.toks[pos]?.norm;
  if (neg === "aren't" || neg === "isn't") for (const c of chosenOf(ctx, pos + 1)) out.push({ end: c.end, frag: { not: { chosen: c.value as NonNullable<ObjectFilter['chosen']> } } });
  // FAST4 T23 (CR 115.9b): "a spell that targets a creature": one of its targets is an object of that description (rules/filter.ts reads `targets`)
  const tg = phraseAt(ctx, pos, W_TARGETS_A);
  // FAST5 T45 (CR 115.9c): "a spell that targets only a single creature you control", "that targets only ~": exactly one different target, and it is that
  const to = tg >= 0 ? phraseAt(ctx, tg, P('only')) : -1;
  if (to >= 0) {
    const sa = phraseAt(ctx, to, P('a single'));
    if (sa >= 0) for (const n of npAlts(ctx, sa)) if (n.number === 'singular' && n.head !== 'spell' && n.head !== 'ability' && n.filter.zone === undefined) out.push({ end: n.end, frag: { targetsOnly: { ref: 'each', filter: n.filter } } });
    const se = phraseAt(ctx, to, P('~'));
    if (se >= 0) out.push({ end: se, frag: { targetsOnly: { ref: 'self' } } });
  }
  if (tg >= 0) {
    const art = ctx.toks[tg]?.norm;
    if (art === 'a' || art === 'an') for (const n of npAlts(ctx, tg + 1)) if (n.number === 'singular' && n.head !== 'spell' && n.head !== 'ability' && n.filter.zone === undefined) out.push({ end: n.end, frag: { targets: { ref: 'each', filter: n.filter } } });
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
  // r4-copy (CR 108.3, 109.4): "target permanent you own but don't control" (Coveted Falcon): owned by you and controlled by another player
  const ob = phraseAt(ctx, pos, W_YOU_OWN_BUT_DONT_CONTROL);
  if (ob >= 0) out.push({ end: ob, frag: { owner: 'you', not: { controller: 'you' } } });
  return out;
}
const W_BUT_DONT_OWN = P("but don't own");
const W_THAT_PLAYER_OR_PLANESWALKERS_CONTROLLER = P("that player or that planeswalker 's controller controls"); // p2-damage-3
const W_YOU_OWN_BUT_DONT_CONTROL = P("you own but don't control");
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
  if (ctx.toks[pos]?.norm !== 'from') return out;
  const art = ctx.toks[pos + 1]?.norm;
  if (art !== 'a' && art !== 'an') return out;
  const word = ctx.toks[pos + 2];
  if (word === undefined || word.kind !== 'WORD' || ctx.toks[pos + 3]?.norm !== 'source') return out;
  if (word.norm === 'colorless') out.push({ end: pos + 4, frag: { abilitySource: { colorless: true } } });
  const ty = ctx.vocab.types.get(word.norm);
  if (ty !== undefined && !ty.plural) out.push({ end: pos + 4, frag: { abilitySource: { types: [ty.name] } } });
  return out;
}

/** One post-modifier at `pos`. */
export function postModAt(ctx: HoleCtx, pos: number): Frag[] {
  const out: Frag[] = [];
  out.push(...controlForms(ctx, pos));
  out.push(...zoneForms(ctx, pos));
  // r5-mech (CR 108.3, 406.1, 404.1): "cards you own in exile and in your graveyard": owned by you, in either zone (Crackling Drake, Beacon Bolt, Serpentine Curve)
  const exGy = phraseAt(ctx, pos, W_YOU_OWN_IN_EXILE_AND_GY);
  if (exGy >= 0) out.push({ end: exGy, frag: { owner: predOf({ ref: 'you' }), zone: ['exile', 'graveyard'] } });
  out.push(...abilitySourceForms(ctx, pos)); // FAST5 T45
  const w = phraseAt(ctx, pos, W_WITH);
  if (w >= 0) for (const f of featureAt(ctx, w, false)) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  // Cloud r3-repl: "up to two target creature cards each with mana value 2 or less" (Dewdrop Cure): "each with" after a plural noun is "with", a property of each
  // object (not of the set: "with different names" keeps its own reading above)
  const eachWith = phraseAt(ctx, pos, W_EACH_WITH);
  if (eachWith >= 0) for (const f of featureAt(ctx, eachWith, false)) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  // FAST5 T42 (CR 201.2): "creature cards with different names": not a property of one card but of the set chosen, so it adds nothing to the filter and leaves the flag
  // `different-names`; only the target phrase that can state it (parser/holes/object.ts) takes the flag, anything else is manual (parser/lower/normalize.ts)
  if (w >= 0) { const dn = phraseAt(ctx, w, W_DIFFERENT_NAMES); if (dn >= 0) out.push({ end: dn, frag: {}, flags: ['different-names'] }); }
  const wo = phraseAt(ctx, pos, W_WITHOUT);
  if (wo >= 0) for (const f of featureAt(ctx, wo, true)) out.push({ end: f.end, frag: f.frag, ...(f.weak ? { weak: f.weak } : {}) });
  const nm = phraseAt(ctx, pos, W_NAMED);
  if (nm >= 0) for (const n of ctx.call('Name', nm)) out.push({ end: n.end, frag: { name: n.value as string }, weak: n.weak ?? 0 });
  for (const ws of W_ENCHANTED_BY_YOUR_AURA) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { enchantedBy: 'you' } }); } // FAST5 T68
  const th = phraseAt(ctx, pos, W_THAT);
  if (th >= 0) out.push(...relClause(ctx, th));
  // CLOUD std-ecl (CR 205.3m, 115.1): "two target creature cards that share a creature type from your graveyard": like "with different names", a property of the SET
  // chosen, so it adds nothing to the filter and leaves the flag `shared-creature-type` that only a target phrase of exactly two takes (parser/holes/object.ts)
  if (th >= 0) { const sc = phraseAt(ctx, th, W_SHARE_A_CREATURE_TYPE); if (sc >= 0) out.push({ end: sc, frag: {}, flags: ['shared-creature-type'] }); }
  // FAST5 T57 (CR 105.2): "target creature or planeswalker that's green or blue": the colors after the nouns say what the colors before them do (one of them; an
  // object that is several colors has each of them); the reading of the other postmodifiers and of "that" is unchanged
  const ths = phraseAt(ctx, pos, W_THATS);
  if (ths >= 0) for (const c of colorMod(ctx, ths)) out.push({ end: c.end, frag: c.frag });
  if (ths >= 0) out.push(...thatsKinds(ctx, ths)); // std-re
  // CLOUD std-msh (CR 506.5): "target creature you control that's attacking alone" (Crowd of True Believers): attacking, and no other creature is
  for (const ws of W_ATTACKING_ALONE) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attackingAlone: true } }); }
  // r4-static (CR 508.1b, 102.3): "each creature that's attacking one of your opponents" (Oviya): attacking a player who is an opponent (rules/filter.ts reads the
  // defender as a player, never a planeswalker or battle)
  for (const ws of W_ATTACKING_OPPONENT) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: 'opponent' } } }); }
  // p2-combat-flow-1 (CR 506.3, 508.1b): "that's attacking you": attacking the player you (rules/filter.ts reads the defender as a player, as above)
  for (const ws of W_ATTACKING_YOU) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: 'you' } } }); }
  // pc-combat-3 (CR 506.3, 508.1b; Soul Snare): "target creature that's attacking you or a planeswalker you control": attacking you, or a planeswalker you control
  for (const ws of W_ATTACKING_YOU_OR_WALKER) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attacking: { defender: 'you', orPlaneswalker: true } } }); }
  // CLOUD std-misc (CR 105.2; Ancient Cornucopia): "a spell that's one or more colors" is a spell that is not colorless
  if (ths >= 0) { const oc = phraseAt(ctx, ths, W_ONE_OR_MORE_COLORS); if (oc >= 0) out.push({ end: oc, frag: { colorless: false } }); }
  // Cloud std-eoe (CR 202.3): "with mana value of the chosen quality": the parity an earlier "Choose odd or even." of the same ability chose (parser/lower/links.ts)
  const mq = phraseAt(ctx, pos, W_MV_CHOSEN_QUALITY);
  if (mq >= 0) out.push({ end: mq, frag: { chosen: { link: '$link', quality: 'oddEven' } } });
  const ch = phraseAt(ctx, pos, P('of the chosen'));
  if (ch >= 0) for (const [ws, quality] of CHOSEN) { const e = phraseAt(ctx, ch, ws); if (e >= 0) out.push({ end: e, frag: { chosen: { link: '$link', quality } } }); }
  // FAST5 T67 (CR 608.2c-d): "for each creature you control of that type": the type an earlier "Choose a creature type." of the same ability chose. The kind
  // ('$type': creature, card or land type) and the link are the earlier choice's (parser/lower/links.ts); with no such choice the placeholder makes it manual
  const tt = phraseAt(ctx, pos, W_OF_THAT_TYPE);
  if (tt >= 0) out.push({ end: tt, frag: { chosen: { link: '$link', quality: '$type' as never } } }); // the placeholder kind is replaced by the links pass
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
    }
  }
  // FAST4 T33: "target creature you control other than enchanted creature": not the object the source is attached to (CR 303.4, 301.5)
  for (const ws of W_OTHER_THAN_ATTACHED) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, frag: { attachedToSource: false } }); }
  // CLOUD std-msh (CR 301.5, 303.4): "the number of Equipment attached to ~", "each Aura attached to it": attached to that one object as the filter is read
  // (`attachedToObject`, FAST4 T22's field, rules/filter.ts)
  const att = phraseAt(ctx, pos, W_ATTACHED_TO);
  if (att >= 0) for (const o of ctx.call('Obj', att)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { attachedToObject: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
  // p2-combat-flow-1 (CR 509.1g, 506.4): "each creature blocking it" (Plague Wight): blocking that one object as the filter is read (`blockingObject`, FAST3 T18's
  // field, rules/filter.ts); the same hosts as "attached to it" (this object, an object named earlier, enchanted or equipped creature)
  const blk = phraseAt(ctx, pos, W_BLOCKING);
  // weak (design 6.3 rule 2): FAST3 T18's "for each creature blocking it" templates keep their sentences
  if (blk >= 0) for (const o of ctx.call('Obj', blk)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { blockingObject: o.value }, weak: (o.weak ?? 0) + 1, ...(o.flags ? { flags: o.flags } : {}) });
  // p2-combat-flow-1 (CR 509.1g-h): "all creatures blocked by ~" (Wall of Nets), "each creature blocking or blocked by ~" (Kjeldoran Frostbeast), same hosts
  const bby = phraseAt(ctx, pos, W_BLOCKED_BY);
  if (bby >= 0) for (const o of ctx.call('Obj', bby)) if (isAttachHost(o.value)) out.push({ end: o.end, frag: { blockedByObject: o.value }, ...(o.flags ? { flags: o.flags } : {}) });
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
  // FAST3 T14: "a creature dealt damage by ~ this turn" (Sengir Vampire): damaged this turn by the object itself (CR 120.1)
  const dd = phraseAt(ctx, pos, W_DEALT_DAMAGE_BY_SELF);
  if (dd >= 0) out.push({ end: dd, frag: { dealtDamageBySourceThisTurn: true } });
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
  for (const [ws, owner] of [[W_PUT_INTO_A_GRAVEYARD_THIS_WAY, undefined], [W_PUT_INTO_YOUR_GRAVEYARD_THIS_WAY, 'you']] as const) {
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
    if (a.flags.includes('shared-creature-type') && opts.differentNames !== true) return; // CLOUD std-ecl: the same for "that share a creature type"
    if (a.flags.includes('linked-exiled-target') && opts.differentNames !== true) return; // std-rx5: "target creature card exiled with ~"
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
    const post = (end: number, f: ObjectFilter, flags: string[], weak: number, depth: number, afterTargetsOnly = false): void => {
      const final = finalize(f, h.head);
      const fl = [...flags];
      // Cloud C7: "card exiled this way" states where the card is (where the instruction moved it, parser/holes/moved-words.ts)
      if (h.head === 'card' && final.zone === undefined && (final as Record<string, unknown>)[MOVED_MARK] === undefined) fl.push('zone-unstated');
      // FAST5 T42 (CR 109.4): only an object on the battlefield or the stack has a controller, so "you control" beside a hand, library, graveyard or exile zone is the
      // less likely reading ("... less than or equal to the number of lands you control from your hand": the lands you control, the card from your hand)
      const odd = final.controller !== undefined && typeof final.zone === 'string' && OWNED_ONLY_ZONES.has(final.zone) ? 1 : 0;
      emit({ end, filter: final, number: h.number, head: h.head, weak: weak + odd, flags: fl });
      if (depth >= MAX_POST || opts.preOnly === true) return;
      const pms = postModAt(ctx, end);
      for (const pm of pms) {
        // std-r7 (CR 400.1, 205.2a, 205.3): ... and the zone the cards are in, "target Vehicle or creature card from your graveyard": a zone says where every noun of the list is
        if (subtypeFirst && Object.keys(pm.frag).some((k) => k !== 'controller' && k !== 'owner' && k !== 'zone')) continue;
        if (h.or === true && Object.keys(pm.frag).some((k) => k !== 'controller' && k !== 'owner')) continue; // FAST5 T59: "legendary creature or creature with mana value one"
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
        if (afterTargetsOnly && Object.keys(pm.frag).every((k) => k === 'controller' || k === 'owner')) continue;
        // Wave-2 merge (std-lci and Cloud C7): std-lci's "<cards> exiled this way" (the exile's binding, counted in exile) reads a CARD noun; after a permanent noun,
        // "the number of creatures exiled this way" (Overwrite the Multiverse), the objects are described as they were when exiled (CR 608.2c, 608.2h), which is
        // C7's reading (`$moved`, parser/holes/moved-words.ts): a creature card counted in exile would miss an animated land that was exiled as a creature
        if (h.head !== 'card' && exiledThisWayFrag(pm.frag)) continue;
        // ... and after a card noun the words are std-lci's alone: C7's marker for the same words ("creature cards exiled this way") would tie with it outside a count
        // ("the greatest power among creature cards exiled this way", Szat's Will: a marker that is not a count is never understood); "put into exile this way" stays C7's
        if (h.head === 'card' && (pm.frag as Record<string, unknown>)[MOVED_MARK] === 'exiled' && pms.some((q) => q.end === pm.end && exiledThisWayFrag(q.frag))) continue;
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
      if (ctx.toks[m.end]?.norm === ',' && merged !== null) {
        for (const m2 of modAt(ctx, m.end + 1)) {
          const merged2 = mergeFilter(merged, m2.frag);
          // Standard round 3, r3-trig (CR 111.1, 205.3): "nontoken, non-Angel creature" (`token: false` is the negation "nontoken")
          if (merged2 !== null && (m.frag.notTypes || m.frag.notColors || m.frag.notSupertypes || m.frag.notSubtypes || m.frag.token === false)) pre(m2.end, merged2, depth + 2, true);
        }
      }
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

const W_OR_NP = P('or');
const W_AND_NP = P('and');
/** cloud std-spm: the modifiers the second half of `andPhrases` may have beside its one card type or subtype (CR 205.4a supertypes, CR 105.1 colors). */
const AND_HALF_KEYS: ReadonlySet<string> = new Set(['types', 'subtypes', 'supertypes', 'colors']);

/**
 * cloud std-spm (CR 205.2a, 205.4a): "each Spider and legendary creature you control" (Ultimate Spider-Man): a bare card type or subtype and a type with a
 * supertype or a color of its own, joined by "and": the objects that are either one (the modifier after "and" belongs to the second noun only, as in "A or B",
 * FAST5 T59). The plain coordination of types ("Spider and Human", "artifact and creature") is the head grammar's, never this; what may follow the whole
 * coordination is who controls or owns them only (`or: true`, as for "or").
 */
function andPhrases(ctx: HoleCtx, pos: number): HeadAlt[] {
  const out: HeadAlt[] = [];
  for (const a of npAlts(ctx, pos, { preOnly: true })) {
    if (a.head !== 'type' || a.flags.length > 0 || !plainKind(a.filter)) continue;
    const and = phraseAt(ctx, a.end, W_AND_NP);
    if (and < 0) continue;
    for (const b of npAlts(ctx, and, { preOnly: true })) {
      if (b.number !== a.number || b.head !== 'type' || b.flags.length > 0 || plainKind(b.filter)) continue;
      const keys = Object.keys(b.filter).filter((k) => (b.filter as Record<string, unknown>)[k] !== undefined);
      if (!keys.every((k) => AND_HALF_KEYS.has(k)) || (b.filter.supertypes === undefined && b.filter.colors === undefined)) continue;
      if ((b.filter.types?.length ?? 0) + (b.filter.subtypes?.length ?? 0) !== 1) continue;
      out.push({ end: b.end, frag: { anyOf: [a.filter, b.filter] }, number: a.number, head: 'type', or: true });
    }
  }
  return out;
}
/** FAST5 T59: a description of several type words (card types and subtypes together, or more than one card type): "artifact creature", "Adventure instant". */
const multiKind = (f: ObjectFilter): boolean => f.allTypes !== undefined || (f.types !== undefined && f.subtypes !== undefined) || (f.subtypes?.length ?? 0) > 1;
/** FAST5 T59: a description that is one card type or one subtype and nothing else. */
const plainKind = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return keys.length === 1 && (keys[0] === 'types' || keys[0] === 'subtypes') && (f[keys[0] as 'types' | 'subtypes'] ?? []).length === 1;
};
const SHARED_HEAD_KEYS: Record<string, string[]> = { spell: ['stackKind', 'zone'], token: ['token'] };

/**
 * FAST5 T59 (CR 205.2a, 700.6-ish "or"): "A or B" where A and B are noun phrases with modifiers of their own (design 6.3: a post-modifier after the whole
 * coordination holds for both, as for the plain coordination). Each half is a phrase of its own ("land creature or nonbasic land": a land creature, or a land
 * that is not basic), except that a bare card type before a generic head noun shares it ("creature or legendary spell": a creature spell or a legendary
 * spell, the way Oracle writes a counterspell's target, CR 601.2c). Returns head alternatives for the post-modifier chain of `computeNp`.
 */
function orPhrases(ctx: HoleCtx, pos: number): HeadAlt[] {
  const out: HeadAlt[] = [];
  for (const a of npAlts(ctx, pos, { preOnly: true })) {
    const or = phraseAt(ctx, a.end, W_OR_NP);
    if (or < 0 || a.flags.length > 0) continue;
    for (const b of npAlts(ctx, or, { preOnly: true })) {
      if (b.number !== a.number || b.flags.length > 0) continue;
      // "a Wizard or basic land card" is a card that is one of the two: the head noun "card" is shared, which the templates of searches and returns say themselves
      const next = ctx.toks[b.end]?.norm;
      if (next === 'card' || next === 'cards') continue;
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
        if (multiKind(a.filter) && plainKind(rest as ObjectFilter)) continue;
        if (Object.keys(rest).length > 0) out.push({ end: b.end, frag: { anyOf: [a.filter, rest as ObjectFilter] }, number: a.number, head: b.head, or: true });
        // CLOUD std-tmt (CR 111.1, 205.2a): a bare "token" after one card type shares no head noun: "another creature or token" is a creature, or a token of any type
        // (Ice Cream Kitty), a permanent either way
        else if (b.head === 'token' && plainKind(a.filter) && a.filter.types !== undefined) out.push({ end: b.end, frag: { anyOf: [a.filter, { token: true }] }, number: a.number, head: 'permanent', or: true });
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
          for (const last of kindsAt(e, a.number)) {
            const all = [...next, last];
            const after = ctx.toks[last.end]?.norm;
            if (after === 'card' || after === 'cards') continue;
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
  for (const h of headWord(ctx, pos, ['permanent', 'card', 'spell', 'token', 'ability'])) out.push({ end: h.end, head: h.head, plural: h.plural });
  return out;
}
