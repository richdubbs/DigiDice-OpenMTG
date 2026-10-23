/**
 * Choices made while resolving (CR 608.2d): `chooseObjects` and `chooseValue`. Owner: WP10 (part of the control family, handlers/control.ts).
 *
 * A player can't choose an option that is illegal or impossible (CR 608.2d): `chooseObjects` offers only objects that are still where the reference found
 * them, and clamps its counts to what exists (CR 609.3); nothing is asked when there is no real choice. Several choosers choose in APNAP order (CR 608.2e,
 * 101.4). A choice a linked ability reads later is stored on the source object (CR 607.2d), which forgets it when it changes zones (CR 400.7).
 */
import type { ChoiceKind, EffectStep, LinkId, ObjRef, PlayerRef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { LinkValue, ObjHandle } from '../../types/state';
import { randomIndex } from '../../core/manual';
import { canSee } from '../../core/view';
import { ALL_CREATURE_TYPES } from '../../rules/creature-types';
import { clone } from '../../util/clone';
import type { Binding, ExecCtx, StepHandler, StepResult } from '../api';
import { evalCount, evalQty } from '../eval';
import { groupStat } from '../../rules/targets';
import { charsOfObject, controllerOf } from '../../rules/characteristics';
import { currentObjs, filterCtxOf, linkValue, readInfo, resolveObjs, resolvePlayers } from '../refs';
import { matchesFilter } from '../../rules/filter';
import { askManual, notesOf } from '../manual';
import { performLink } from '../perform';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

const NOTHING: StepResult = { performed: false, count: 0 };

/** A binding of objects and players with the snapshot of each object as it is now (design 3.1 rule 3: what later reads use once it has moved). */
export function bindingOf(cx: ExecCtx, objects: ObjHandle[], players: PlayerId[] = []): Binding {
  const snapshots: Binding['snapshots'] = {};
  for (const h of objects) {
    const info = readInfo(cx, h);
    if (info) snapshots[h.id] = { ...info, object: clone(info.object) };
  }
  return { objects, players, snapshots };
}

/** CR 607.2d: what a linked ability remembers is kept on the source object, as long as it is still the object the ability belongs to (CR 400.7). The write is a performer's (design 8.5). */
export function rememberLink(cx: ExecCtx, link: LinkId, value: LinkValue): void {
  performLink(cx.g, cx.source, link, value);
}

const clampCount = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.floor(n) : hi));

/** `n` different objects of `pool` chosen at random with the game's RNG (design 8.8 rule 2). */
function atRandom(cx: ExecCtx, pool: ObjectId[], n: number): ObjectId[] {
  const left = [...pool];
  const out: ObjectId[] = [];
  for (let i = 0; i < n && left.length > 0; i++) out.push(left.splice(randomIndex(cx.g, left.length), 1)[0]!);
  return out;
}

/**
 * "Alice chooses Grizzly Bears." The names go only to the players who can see every chosen card (CR 400.2): for a card in a hand its owner, for a face-down
 * permanent its controller. Everyone else, the chooser included (a random pick from an opponent's hand is not a look at it), reads "chooses N cards".
 */
function logChoice(cx: ExecCtx, player: PlayerId, ids: ObjectId[]): void {
  const g = cx.g;
  const who = g.player(player).name;
  const names = ids.map((id) => g.nameOf(id)).join(', ') || 'nothing';
  const text = `${who} chooses ${names}.`;
  const sees = (viewer: PlayerId | null): boolean => ids.every((id) => { const o = g.s.objects[id]; return o === undefined || canSee(g.s, o, viewer); });
  if (sees(null)) {
    g.log(text, { rules: ['CR 608.2d'], level: 'action' });
    return;
  }
  const players = g.s.players.map((p) => p.id).filter((p) => sees(p));
  g.log(`${who} chooses ${ids.length} card${ids.length === 1 ? '' : 's'}.`, { rules: ['CR 608.2d', 'CR 400.2'], level: 'action', ...(players.length > 0 ? { privateText: { players, text } } : {}) });
}

/**
 * audit-fix-1 (CR 609.7a, 113.7a; from memory, unverified): "a source of your choice" may be an object an ability on the stack refers to, even one that has left
 * its zone (a creature's dies trigger, a sacrificed creature's ability): the abilities on the stack whose source, as it is now or as it last existed, matches the
 * description (`from`'s filter, its zones aside), offered as that object. Only an `each` reference; any other offers no more (fail closed: refused by cap-walk).
 */
function abilitiesForSources(cx: ExecCtx, from: ObjRef): ObjHandle[] {
  if (from.ref !== 'each') return [];
  const s = cx.g.s;
  const ctx = filterCtxOf(cx);
  const out: ObjHandle[] = [];
  for (const id of s.zones.stack) {
    const o = s.objects[id];
    const src = o?.kind === 'ability' ? o.stack?.sourceId : undefined;
    if (src === undefined || src === id) continue;
    const now = s.objects[src];
    const lk = now === undefined ? s.lki[src] : undefined;
    const was = now ?? lk?.object;
    if (was === undefined) continue;
    if (matchesFilter(s, was, { ...from.filter, zone: 'any' }, lk?.chars ? { ...ctx, chars: lk.chars } : ctx)) out.push({ id, zone: 'stack' });
  }
  return out;
}

/** audit-fix-1 (CR 609.7a): what a chosen "source of your choice" binds: an ability on the stack its source (current, or last known), anything else itself. */
function sourceStoodFor(cx: ExecCtx, h: ObjHandle): ObjHandle[] {
  const s = cx.g.s;
  const o = s.objects[h.id];
  const src = o?.kind === 'ability' ? o.stack?.sourceId : undefined;
  if (src === undefined || src === h.id) return [h];
  const now = s.objects[src];
  if (now !== undefined) return [{ id: src, zone: now.zone }];
  const lk = s.lki[src];
  return lk === undefined ? [] : [{ id: src, zone: lk.leftZone }];
}

/** CR 608.2d, 609.3: choose among the objects a reference stands for; `random` picks with the game's RNG. Binds `as` to every chosen object. */
/** The value forms of the chooseObjects op this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them). */
export const OP_FORMS: readonly string[] = ['op:chooseObjects.groupLimit', 'op:chooseObjects.perPlayer', 'op:chooseObjects.perPlayer.ownChoice', 'op:chooseObjects.startingWith',
  'op:chooseObjects.eachCardType', 'op:chooseObjects.link',
  'op:chooseObjects.distinct', 'op:chooseObjects.damageSource' /* audit-fix-1: CR 609.7a */];

/** CR 205.2a: the card types, in the order a choice of one of each is offered. */
const EACH_CARD_TYPE = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery'] as const;

/**
 * std-library-3 (CR 205.2a, 608.2d): "For each card type, you may exile a card of that type from among them.": for each card type in turn, the chooser may take one
 * object of that type not taken yet, so a card of two types answers for one of them only (any set with a distinct type for each card can be taken so).
 */
function pickEachCardType(cx: ExecCtx, p: PlayerId, ids: readonly ObjectId[], max: number, prompt: string): ObjectId[] {
  const g = cx.g;
  const picked: ObjectId[] = [];
  for (const type of EACH_CARD_TYPE) {
    if (picked.length >= max) break;
    const pool = ids.filter((id) => !picked.includes(id) && g.s.objects[id] !== undefined && charsOfObject(g.s, g.s.objects[id]!).types.includes(type));
    if (pool.length === 0) continue;
    const one = g.choose({ kind: 'chooseObjects', player: p, options: pool, min: 0, max: 1, prompt: `${prompt}: ${type.toLowerCase()} (up to one)`, rules: ['CR 608.2d', 'CR 205.2a'] }).ids;
    if (one.length > 0) picked.push(one[0]!);
  }
  return picked;
}

/**
 * std-library-1 (CR 208.1, 608.2d): "any number of creature and/or Vehicle cards with different powers": the chooser takes the objects one at a time, each offered only
 * while no object taken before has its value of the statistic (as a search for cards with different names, effects/handlers/cards-library.ts#pickDifferentNames).
 */
function pickDistinct(cx: ExecCtx, p: PlayerId, ids: readonly ObjectId[], min: number, max: number, stat: 'power' | 'toughness' | 'manaValue', prompt: string): ObjectId[] {
  const g = cx.g;
  const value = (id: ObjectId): number => groupStat(g.s, { kind: 'object', id }, stat);
  const words = stat === 'manaValue' ? 'mana value' : stat;
  const picked: ObjectId[] = [];
  let pool = [...ids];
  while (picked.length < max && pool.length > 0) {
    const need = picked.length < min ? 1 : 0;
    const one = g.choose({
      kind: 'chooseObjects', player: p, options: pool, min: need, max: 1,
      prompt: `${prompt}: one with a ${words} different from the others (${picked.length + 1} of up to ${max})`, rules: ['CR 608.2d', 'CR 208.1'],
    }).ids;
    if (one.length === 0) break;
    picked.push(one[0]!);
    const taken = value(one[0]!);
    pool = pool.filter((id) => id !== one[0] && value(id) !== taken);
  }
  return picked;
}

/**
 * std-rx30 (CR 101.4, 608.2d): "Starting with you, each player chooses up to one permanent with mana value 3 or greater from among permanents your opponents control."
 * Each player of `who` in turn order beginning with `startingWith` (the next player in turn order after each, CR 101.4's turn order, not APNAP), each seeing the
 * choices made before, chooses `min`..`max` objects among `from` as it is when that player chooses; every object chosen, once, is bound by `as`.
 */
function chooseInTurn(cx: ExecCtx, st: Step<'chooseObjects'>, first: PlayerRef): StepResult {
  const g = cx.g;
  const group = resolvePlayers(cx, st.who);
  const [start] = resolvePlayers(cx, first);
  const seats = g.s.players.map((p) => p.id);
  const at = start === undefined ? 0 : Math.max(0, seats.indexOf(start));
  const players = [...seats.slice(at), ...seats.slice(0, at)].filter((p) => group.includes(p));
  const source = notesOf(cx).sourceName;
  const chosen: ObjHandle[] = [];
  for (const p of players) {
    const pool: ObjHandle[] = [];
    for (const h of currentObjs(cx, resolveObjs(cx, st.from))) if (!pool.some((x) => x.id === h.id)) pool.push(h);
    const ids = pool.map((h) => h.id);
    const max = clampCount(evalCount(st.max, { cx }), 0, ids.length);
    const min = clampCount(evalCount(st.min, { cx }), 0, max);
    const picked = max === 0 ? [] : min === ids.length ? [...ids]
      : g.choose({ kind: 'chooseObjects', player: p, prompt: `${source}: ${st.span ?? 'choose'}`, options: ids, min, max, rules: ['CR 608.2d', 'CR 101.4'] }).ids;
    logChoice(cx, p, picked);
    for (const id of picked) if (!chosen.some((h) => h.id === id)) chosen.push(pool.find((h) => h.id === id)!);
  }
  cx.bindings.set(st.as, bindingOf(cx, chosen));
  return chosen.length > 0 ? { performed: true, count: chosen.length } : NOTHING;
}

/**
 * C6 (CR 608.2c, 101.4): "For each player, choose a creature with power 2 or less that player controls": for each player of `perPlayer` in APNAP order, the chooser
 * picks among the objects of `from` that player controls (on the battlefield; owns, elsewhere), read with that player as `{ref:'iterating'}` ("the greatest power among
 * creatures that player controls"). A player with fewer such objects than `min` gives all of them (CR 608.2d: no choice to make). Every object chosen is bound by `as`.
 */
function choosePerPlayer(cx: ExecCtx, st: Step<'chooseObjects'>, groups: PlayerRef): StepResult {
  const g = cx.g;
  const order = g.apnap();
  const players = resolvePlayers(cx, groups).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)); // CR 101.4
  // Standard round 5, r5-refs (CR 101.4, 608.2d): "Each player chooses any number of creatures they control with total power 4 or less": the chooser may be the player of
  // the iteration itself (`who: {ref:'iterating'}`), read while that player is iterating; anyone else is read once
  const own = st.who.ref === 'iterating';
  const fixedChooser = own ? [] : resolvePlayers(cx, st.who);
  const source = notesOf(cx).sourceName;
  const chosen: ObjHandle[] = [];
  const before = cx.iterating;
  try {
    for (const q of players) {
      cx.iterating = q;
      const pool: ObjHandle[] = [];
      for (const h of currentObjs(cx, resolveObjs(cx, st.from))) {
        const o = g.s.objects[h.id];
        if (o === undefined || pool.some((x) => x.id === h.id)) continue;
        if (h.zone === 'battlefield' ? controllerOf(g.s, o) === q : o.owner === q) pool.push(h);
      }
      const ids = pool.map((h) => h.id);
      for (const p of own ? [q] : fixedChooser) {
        const max = clampCount(evalCount(st.max, { cx }), 0, ids.length);
        const min = clampCount(evalCount(st.min, { cx }), 0, max);
        // r5-refs (CR 608.2d, 115.1): a limit on a statistic summed over the objects chosen together, as in a choice of one chooser (FAST5 T66)
        const limit = st.groupLimit === undefined ? undefined : {
          stat: st.groupLimit.stat, op: st.groupLimit.cmp.op, value: evalCount(st.groupLimit.cmp.value, { cx }),
          values: Object.fromEntries(ids.map((id) => [id, groupStat(g.s, { kind: 'object', id }, st.groupLimit!.stat)])),
        };
        let picked: ObjectId[];
        if (max === 0) picked = [];
        else if (st.random) picked = atRandom(cx, ids, max);
        else if (min === ids.length && limit === undefined) picked = [...ids]; // no choice to make
        else {
          picked = g.choose({
            kind: 'chooseObjects', player: p, prompt: `${source}: ${st.span ?? 'choose'} (${g.player(q).name})`, options: ids, min, max, ...(limit !== undefined ? { limit } : {}),
            rules: ['CR 608.2c', 'CR 608.2d', 'CR 101.4'],
          }).ids;
        }
        logChoice(cx, p, picked);
        for (const id of picked) if (!chosen.some((h) => h.id === id)) chosen.push(pool.find((h) => h.id === id)!);
      }
    }
  } finally {
    if (before === undefined) delete cx.iterating;
    else cx.iterating = before;
  }
  cx.bindings.set(st.as, bindingOf(cx, chosen));
  return chosen.length > 0 ? { performed: true, count: chosen.length } : NOTHING;
}

export const chooseObjectsHandler: StepHandler<Step<'chooseObjects'>> = (cx, st) => {
  if (st.perPlayer !== undefined) return choosePerPlayer(cx, st, st.perPlayer); // C6
  if (st.startingWith !== undefined) return chooseInTurn(cx, st, st.startingWith); // std-rx30
  const pool: ObjHandle[] = [];
  for (const h of currentObjs(cx, resolveObjs(cx, st.from))) if (!pool.some((x) => x.id === h.id)) pool.push(h);
  if (st.damageSource === true) for (const h of abilitiesForSources(cx, st.from)) if (!pool.some((x) => x.id === h.id)) pool.push(h); // audit-fix-1
  const ids = pool.map((h) => h.id);
  const chosen: ObjHandle[] = [];
  const source = notesOf(cx).sourceName;
  for (const p of resolvePlayers(cx, st.who)) {
    const max = clampCount(evalCount(st.max, { cx }), 0, ids.length);
    const min = clampCount(evalCount(st.min, { cx }), 0, max);
    let picked: ObjectId[];
    if (max === 0) picked = [];
    else if (st.random) picked = atRandom(cx, ids, max);
    else if (st.eachCardType === true) picked = pickEachCardType(cx, p, ids, max, `${source}: ${st.span ?? 'choose'}`); // std-library-3
    else if (st.distinct !== undefined) picked = pickDistinct(cx, p, ids, min, max, st.distinct, `${source}: ${st.span ?? 'choose'}`); // std-library-1
    else if (min === ids.length && st.groupLimit === undefined) picked = [...ids]; // no choice to make
    else {
      // FAST5 T66 (CR 608.2d, 115.1): "up to two creature cards with total mana value 4 or less": the objects chosen together keep the total; the limit is read as the
      // choice is offered (a quantity is fixed now, CR 608.2h) and is part of the decision, so an answer that breaks it is rejected
      const limit = st.groupLimit === undefined ? undefined : {
        stat: st.groupLimit.stat, op: st.groupLimit.cmp.op, value: evalCount(st.groupLimit.cmp.value, { cx }),
        values: Object.fromEntries(ids.map((id) => [id, groupStat(cx.g.s, { kind: 'object', id }, st.groupLimit!.stat)])),
      };
      picked = cx.g.choose({
        kind: 'chooseObjects', player: p, prompt: `${source}: ${st.span ?? (min === max ? `choose ${max}` : `choose ${min} to ${max}`)}`,
        options: ids, min, max, ...(limit !== undefined ? { limit } : {}), rules: ['CR 608.2d'],
      }).ids;
    }
    logChoice(cx, p, picked);
    for (const id of picked) if (!chosen.some((h) => h.id === id)) chosen.push(pool.find((h) => h.id === id)!);
  }
  cx.bindings.set(st.as, st.damageSource === true ? { ...bindingOf(cx, chosen.flatMap((h) => sourceStoodFor(cx, h))), keepsLeft: true } : bindingOf(cx, chosen));
  // std-control-1 (CR 607.2d, 400.7): "When the chosen creature leaves the battlefield, ...": the source remembers what was chosen for its linked ability (nothing
  // chosen: the link is cleared, so an earlier choice is never read again)
  if (st.link !== undefined) rememberLink(cx, st.link, { objects: chosen });
  return chosen.length > 0 ? { performed: true, count: chosen.length } : NOTHING;
};

// ---- chooseValue ------------------------------------------------------------------------------------------------------------------------------------

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
/** CR 105.1: the five colors, by letter or by name ("white" or "W"). */
const COLOR_WORDS: Record<string, (typeof COLORS)[number]> = { w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
/** CR 205.2a. */
const CARD_TYPES = ['Artifact', 'Battle', 'Conspiracy', 'Creature', 'Dungeon', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Phenomenon', 'Plane', 'Planeswalker', 'Scheme', 'Sorcery', 'Vanguard'];
/** CR 205.3i, spelled as rules/filter.ts spells them. */
const LAND_TYPES = ['Cave', 'Desert', 'Forest', 'Gate', 'Island', 'Lair', 'Locus', 'Mine', 'Mountain', 'Plains', 'Planet', 'Power-Plant', 'Sphere', 'Swamp', 'Tower', 'Town', 'Urza’s'];

const NAME_LISTS: Partial<Record<ChoiceKind, readonly string[]>> = { creatureType: [...ALL_CREATURE_TYPES], cardType: CARD_TYPES, landType: LAND_TYPES };

/**
 * M6-8: the values `exclude` keeps from being offered: fixed values, and the value chosen for a link earlier in this resolution ("one color word with another":
 * the second word is another one). A link nobody chose excludes nothing.
 */
function excludedValues(cx: ExecCtx, st: Step<'chooseValue'>): string[] {
  return (st.exclude ?? []).flatMap((x) => (typeof x === 'string' ? [x] : linkValue(cx, x.chosen)?.values ?? []));
}

/**
 * Cloud std-woe (CR 608.2d): the players a player choice never offers: `'you'` is the controller of the spell or ability ("choose another player"), a link the players
 * chosen for it earlier in this resolution. Null for any other value (it names no player: the choice is settled by hand).
 */
function excludedPlayers(cx: ExecCtx, st: Step<'chooseValue'>): PlayerId[] | null {
  const out: PlayerId[] = [];
  for (const x of st.exclude ?? []) {
    if (x === 'you') out.push(cx.controller);
    else if (typeof x === 'string') return null;
    else out.push(...(linkValue(cx, x.chosen)?.players ?? []));
  }
  return out;
}

/**
 * Wave 8 review of r5-fxz (CR 608.2d: "The player can't choose an option that's illegal or impossible"): the link of a choice between two instructions of one
 * sentence, "A or B" (parser/templates/zz-cloud/r5-fxz.json, eff.r5fxz.instructionChoice.orUnlock; render/fold-r5fxz.ts#INSTRUCTION_CHOICE_LINK, the same word).
 * Only that link: a value other abilities read later (CR 607.2d) is never narrowed by what this resolution can do.
 */
export const INSTRUCTION_CHOICE_LINK = 'instructionChoice';

/** Every step list of a program, nested ones included (`then`, `else`, `do`, the modes' programs): where a step's siblings are found. */
function stepLists(v: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(v)) {
    if (v.some((x) => typeof x === 'object' && x !== null && 'op' in x)) out.push(v);
    for (const x of v) stepLists(x, out);
  } else if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) stepLists(x, out);
  }
  return out;
}

/**
 * The options of an instruction choice whose instruction is impossible now (CR 608.2d): its branch (the `if` that reads the choice, beside the choice) starts by
 * choosing at least one object from a set with nothing in it ("return an enchantment card from your graveyard to your hand" with none there; "unlock a locked
 * door of a Room you control" with no such Room). When every option is impossible none is removed (whichever is chosen, nothing happens).
 */
function impossibleInstructions(cx: ExecCtx, st: Step<'chooseValue'>): string[] {
  if (st.link !== INSTRUCTION_CHOICE_LINK) return [];
  const siblings = stepLists(cx.program).find((l) => l.includes(st)) as EffectStep[] | undefined;
  if (siblings === undefined) return [];
  const out: string[] = [];
  for (const s of siblings) {
    if (s.op !== 'if' || s.cond.cond !== 'chosen' || s.cond.link !== st.link || s.else !== undefined) continue;
    const first = s.then[0];
    if (first?.op !== 'chooseObjects' || typeof first.min !== 'number' || first.min < 1 || first.random === true) continue;
    if (currentObjs(cx, resolveObjs(cx, first.from)).length === 0) out.push(s.cond.equals);
  }
  return out.length >= (st.options ?? []).length ? [] : out;
}

/** LNK1 (FAST4 audit note): the default prompt of a choice in words, with its article ("choose an option", not "choose a option"). */
const CHOICE_WORDS: Readonly<Record<ChoiceKind, string>> = {
  color: 'a color', creatureType: 'a creature type', cardType: 'a card type', landType: 'a land type', cardName: 'a card name', number: 'a number',
  player: 'a player', opponent: 'an opponent', option: 'an option', oddEven: 'odd or even',
};
export const choicePrompt = (what: ChoiceKind): string => `choose ${CHOICE_WORDS[what] ?? `a ${what}`}`;

/** One player's choice. Returns the value as text (a color letter, a type, a name, a number, `odd`/`even`, an option) or a player. */
function chooseOne(cx: ExecCtx, st: Step<'chooseValue'>, player: PlayerId): { value?: string; player?: PlayerId } | null {
  const g = cx.g;
  const prompt = `${notesOf(cx).sourceName}: ${st.span ?? choicePrompt(st.what)}`;
  const rules = st.link ? ['CR 608.2d', 'CR 607.2d'] : ['CR 608.2d'];
  const excluded = excludedValues(cx, st);
  switch (st.what) {
    case 'color': {
      const listed = new Set((st.options ?? []).map((o) => COLOR_WORDS[o.trim().toLowerCase()]));
      const not = new Set(excluded.map((o) => COLOR_WORDS[o.trim().toLowerCase()]));
      const options = (st.options ? COLORS.filter((c) => listed.has(c)) : [...COLORS]).filter((c) => !not.has(c));
      if (options.length === 0) return null; // options that name no color: settled by hand, never a decision no answer satisfies
      return { value: g.choose({ kind: 'chooseColor', player, prompt, options, rules }).color };
    }
    case 'creatureType': case 'cardType': case 'landType': case 'cardName': {
      // Card names come from the whole Oracle index, which the UI searches (decisions.ts#ChooseNameDecision); the types from the closed lists of CR 205.
      const listed = st.options ?? NAME_LISTS[st.what];
      if (!listed && excluded.length > 0) return null; // M6-8: a card name "other than ..." over the whole index can't be offered exactly: settled by hand
      const options = listed && excluded.length > 0 ? listed.filter((o) => !excluded.includes(o)) : listed;
      if (options && options.length === 0) return null;
      // std-rx28 (CR 201.3): "choose a land card name" (Petrified Hamlet) names only such a card (ChooseNameDecision.cardKind)
      const kind = st.what === 'cardName' && st.cardKind !== undefined ? { cardKind: st.cardKind } : {};
      return { value: g.choose({ kind: 'chooseName', player, prompt, what: st.what, ...(options ? { options: [...options] } : {}), ...kind, rules }).name };
    }
    case 'number': {
      if (excluded.length > 0) return null; // M6-8: no number choice excludes values: settled by hand, never a value the card forbids
      const lo = st.min === undefined ? 0 : evalQty(cx, st.min);
      const hi = st.max === undefined ? 1000 : evalQty(cx, st.max);
      if (lo === undefined || hi === undefined || hi < lo) return null; // the range fails to determine (CR 608.2b)
      return { value: String(g.choose({ kind: 'chooseNumber', player, prompt, min: lo, max: hi, rules }).n) };
    }
    case 'player': case 'opponent': {
      const skip = excludedPlayers(cx, st);
      if (skip === null) return null; // M6-8: a value that names no player: settled by hand (as for numbers)
      const ps = (st.what === 'opponent' ? g.opponents(player).map((p) => p.id) : g.apnap()).filter((id) => !skip.includes(id));
      if (ps.length === 0) return null;
      const pick = ps.length === 1 ? ps[0]! : g.choose({ kind: 'chooseOption', player, prompt, min: 1, max: 1, options: ps.map((id) => ({ id, label: g.player(id).name })), rules }).ids[0]!;
      return { player: pick };
    }
    case 'oddEven': case 'option': {
      const impossible = st.what === 'option' ? impossibleInstructions(cx, st) : [];
      const options = (st.what === 'oddEven' ? ['odd', 'even'] : st.options ?? []).filter((o) => !excluded.includes(o) && !impossible.includes(o));
      if (options.length === 0) return null;
      if (impossible.length > 0 && options.length === 1) return { value: options[0]! }; // the one possible instruction: no real choice (CR 608.2d)
      const id = g.choose({ kind: 'chooseOption', player, prompt, min: 1, max: 1, options: options.map((o, i) => ({ id: String(i), label: o })), rules }).ids[0]!;
      return { value: options[Number(id)]! };
    }
  }
}

/**
 * CR 608.2d, 607.2d: a color, a type, a card name, a number, a player, odd or even, or one of the listed options. A chosen player is in the binding `as`;
 * with `link` the value is remembered by the source for its linked abilities. (`vars` belong to `let` alone: the model has no `{q:'var'}` reader of a choice.)
 * A chooser with nothing to choose from does not stop the others: the choices made are kept and bound, then the rest is settled by hand, once.
 */
export const chooseValueHandler: StepHandler<Step<'chooseValue'>> = (cx, st) => {
  const g = cx.g;
  const values: string[] = [];
  const players: PlayerId[] = [];
  let unresolved = false;
  for (const p of resolvePlayers(cx, st.who)) {
    const r = chooseOne(cx, st, p);
    if (!r) {
      unresolved = true;
      continue;
    }
    if (r.value !== undefined) values.push(r.value);
    if (r.player !== undefined) players.push(r.player);
    // std-combat-5 (CR 608.2d): a secret choice is named to its chooser only; the others read that a choice was made
    if (st.secret === true) g.log(`${g.player(p).name} secretly chooses ${choicePrompt(st.what).replace(/^choose /, '')}.`, { rules: ['CR 608.2d'], level: 'action', privateText: { players: [p], text: `${g.player(p).name} secretly chooses ${r.value ?? g.player(r.player!).name}.` } });
    else g.log(`${g.player(p).name} chooses ${r.value ?? g.player(r.player!).name}.`, { rules: ['CR 608.2d'], level: 'action' });
  }
  cx.bindings.set(st.as, { objects: [], players, snapshots: {} }); // bound before any manual prompt (design 3.1 rule 6)
  if (st.link && values.length + players.length > 0) {
    const choosers = resolvePlayers(cx, st.who);
    const value = players.length > 0 ? { players } : { values, ...(st.secret === true ? { secret: choosers } : {}) }; // std-combat-5: who knows a secret choice
    rememberLink(cx, st.link, value);
    cx.choices?.set(st.link, value); // FAST3 T13: the rest of this resolution reads it even if the source has left (CR 608.2d)
  }
  const chosen = values.length + players.length;
  if (unresolved) {
    // Nothing to choose from (no option listed, no opponent, a range that can't be determined): the players settle it by hand, never a guess.
    const r = askManual(cx, st.span ?? choicePrompt(st.what), `nothing to choose from for "${st.what}"`);
    return { performed: chosen > 0 || r.performed, count: chosen + r.count };
  }
  return { performed: chosen > 0, count: chosen }; // design 3.1 rule 7: a chooser who resolves to nobody chose nothing
};
