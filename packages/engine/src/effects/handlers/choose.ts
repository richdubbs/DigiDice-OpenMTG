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
import { PLANESWALKER_TYPES } from '../../statics/subtypes'; // edh-d-94
import { clone } from '../../util/clone';
import type { Binding, ExecCtx, StepHandler, StepResult } from '../api';
import { evalCount, evalQty } from '../eval';
import { groupStat } from '../../rules/targets';
import { charsOfObject, controllerOf } from '../../rules/characteristics';
import { currentObjs, filterCtxOf, isCurrent, linkValue, readInfo, resolveObjs, resolvePlayers, resolveRecipients } from '../refs';
import { countersOn } from './counters-read';
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
export const OP_FORMS: readonly string[] = ['op:chooseObjects.unchosen' /* edh-next-135 (CR 608.2d): #chooseInTurn */, 'op:chooseObjects.groupLimit', 'op:chooseObjects.perPlayer', 'op:chooseObjects.perPlayer.ownChoice', 'op:chooseObjects.startingWith',
  'op:chooseObjects.eachCardType', 'op:chooseObjects.link',
  'op:chooseObjects.eachColorPair', // edh-next-142
  'op:chooseObjects.distinct', 'op:chooseObjects.damageSource' /* audit-fix-1: CR 609.7a */, 'op:chooseValue.mostLife' /* edh-players-8: CR 119.1, 608.2d */, 'op:chooseValue.counterKind' /* edh-perms-15: CR 122.1, 608.2d */, 'op:chooseValue.manaTypeSpent' /* edh-mana-keywords-12: CR 106.1, 607.2d */, 'op:chooseValue.lifeTotal' /* edh-next-144: CR 119.1, 607.2d */, 'op:chooseValue.random' /* edh-zones-26: CR 608.2d */, 'op:chooseValue.random.opponent' /* edh-c-14: CR 608.2d */, 'op:chooseValue.random.player' /* edh-d-20: CR 608.2d */, 'op:chooseValue.controlsMore' /* edh-d-46: CR 109.4, 608.2d */, 'op:chooseValue.excludeBound' /* edhn110: CR 608.2d */, 'op:chooseValue.secretReveal' /* edh-next-120: CR 608.2d */, 'op:chooseValue.counterKindNotOn', 'op:chooseValue.random.counterKind' /* edh-next-128: CR 122.1, 608.2d */, 'op:chooseValue.notAttackedLastCombat' /* edh-next-129: CR 506.1, 608.2d */, 'op:chooseValue.random.option' /* edh-next-129: CR 608.2d */, 'op:chooseValue.secret.player' /* edh-next-135: CR 608.2d, a secretly chosen player is hidden as a value is */, 'op:chooseValue.forEachPlayer' /* edh-next-143: CR 608.2d */, 'op:chooseValue.colors' /* edh-next-140: CR 105.1, 608.2d */,
  'op:chooseValue.counterKind.among', // edh-d-89: CR 122.1, 608.2d (a counter on any one of a group)
  'op:chooseObjects.cardTypesAtLeast', // edh-d-85: CR 205.2a, 608.2d
];

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

/** edh-next-142 (CR 105.5): the ten color pairs in the order the rulings list them (Niv-Mizzet Reborn, 2019-05-03). */
const COLOR_PAIRS: readonly (readonly [string, string])[] = [['W', 'U'], ['W', 'B'], ['U', 'B'], ['U', 'R'], ['B', 'R'], ['B', 'G'], ['R', 'G'], ['R', 'W'], ['G', 'W'], ['G', 'U']];
const COLOR_NAME: Readonly<Record<string, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/**
 * edh-next-142 (CR 105.5, 105.2b, 608.2d; Niv-Mizzet Reborn, rulings 2019-05-03): "For each color pair, choose a card that's exactly those colors from among them.": for each pair in turn, one of the
 * objects that are exactly those two colors (read now), when there is one; the chooser must take one if they can ("you choose as many cards as you can").
 */
function pickEachColorPair(cx: ExecCtx, p: PlayerId, ids: readonly ObjectId[], max: number, prompt: string): ObjectId[] {
  const g = cx.g;
  const picked: ObjectId[] = [];
  for (const [a, b] of COLOR_PAIRS) {
    if (picked.length >= max) break;
    const pool = ids.filter((id) => {
      if (picked.includes(id) || g.s.objects[id] === undefined) return false;
      const colors = charsOfObject(g.s, g.s.objects[id]!).colors;
      return colors.length === 2 && colors.includes(a as never) && colors.includes(b as never);
    });
    if (pool.length === 0) continue;
    const one = g.choose({ kind: 'chooseObjects', player: p, options: pool, min: 1, max: 1, prompt: `${prompt}: a ${COLOR_NAME[a]} and ${COLOR_NAME[b]} card`, rules: ['CR 608.2d', 'CR 105.5'] }).ids;
    if (one.length > 0) picked.push(one[0]!);
  }
  return picked;
}

/**
 * std-library-1 (CR 208.1, 608.2d): "any number of creature and/or Vehicle cards with different powers": the chooser takes the objects one at a time, each offered only
 * while no object taken before has its value of the statistic (as a search for cards with different names, effects/handlers/cards-library.ts#pickDifferentNames).
 */
function pickDistinct(cx: ExecCtx, p: PlayerId, ids: readonly ObjectId[], min: number, max: number, stat: 'power' | 'toughness' | 'manaValue' | 'name', prompt: string): ObjectId[] {
  const g = cx.g;
  // edh-zones-4 (CR 201.2, 608.2d): a name is not one number: two objects share a name when they have one in common (a split or double-faced card has several), as in a search for different names
  const values = (id: ObjectId): (string | number)[] => (stat === 'name' ? charsOfObject(g.s, g.s.objects[id]!).names : [groupStat(g.s, { kind: 'object', id }, stat)]);
  const words = stat === 'manaValue' ? 'mana value' : stat;
  const picked: ObjectId[] = [];
  let pool = [...ids];
  while (picked.length < max && pool.length > 0) {
    const need = picked.length < min ? 1 : 0;
    const one = g.choose({
      kind: 'chooseObjects', player: p, options: pool, min: need, max: 1,
      prompt: `${prompt}: one with a ${words} different from the others (${picked.length + 1} of up to ${max})`, rules: stat === 'name' ? ['CR 608.2d', 'CR 201.2'] : ['CR 608.2d', 'CR 208.1'],
    }).ids;
    if (one.length === 0) break;
    picked.push(one[0]!);
    const taken = values(one[0]!);
    pool = pool.filter((id) => id !== one[0] && !values(id).some((v) => taken.includes(v)));
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
    for (const h of currentObjs(cx, resolveObjs(cx, st.from))) if (!pool.some((x) => x.id === h.id) && !(st.unchosen === true && chosen.some((x) => x.id === h.id))) pool.push(h); // edh-next-135: "that hasn't been chosen"
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
    else if (st.eachColorPair === true) picked = pickEachColorPair(cx, p, ids, max, `${source}: ${st.span ?? 'choose'}`); // edh-next-142
    else if (st.eachCardType === true) picked = pickEachCardType(cx, p, ids, max, `${source}: ${st.span ?? 'choose'}`); // std-library-3
    else if (st.distinct !== undefined) picked = pickDistinct(cx, p, ids, min, max, st.distinct, `${source}: ${st.span ?? 'choose'}`); // std-library-1
    else if (min === ids.length && st.groupLimit === undefined && st.cardTypesAtLeast === undefined) picked = [...ids]; // no choice to make
    else {
      // FAST5 T66 (CR 608.2d, 115.1): "up to two creature cards with total mana value 4 or less": the objects chosen together keep the total; the limit is read as the
      // choice is offered (a quantity is fixed now, CR 608.2h) and is part of the decision, so an answer that breaks it is rejected
      const limit = st.groupLimit === undefined ? undefined : {
        stat: st.groupLimit.stat, op: st.groupLimit.cmp.op, value: evalCount(st.groupLimit.cmp.value, { cx }),
        values: Object.fromEntries(ids.map((id) => [id, groupStat(cx.g.s, { kind: 'object', id }, st.groupLimit!.stat)])),
      };
      // edh-d-85 (CR 205.2a, 608.2d): "with four or more card types among them": each option's card types, read now; a nonempty answer must have that many among them
      const typesAtLeast = st.cardTypesAtLeast === undefined ? undefined : { n: st.cardTypesAtLeast, types: Object.fromEntries(ids.map((id) => [id, [...charsOfObject(cx.g.s, cx.g.s.objects[id]!).types]])) };
      picked = cx.g.choose({
        kind: 'chooseObjects', player: p, prompt: `${source}: ${st.span ?? (min === max ? `choose ${max}` : `choose ${min} to ${max}`)}${typesAtLeast !== undefined ? ` (none, or ${typesAtLeast.n} or more card types among them)` : ''}`,
        options: ids, min, max, ...(limit !== undefined ? { limit } : {}), ...(typesAtLeast !== undefined ? { typesAtLeast } : {}), rules: ['CR 608.2d'],
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
const COLOR_NAMES: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }; // edh-next-140
/** CR 205.2a. */
const CARD_TYPES = ['Artifact', 'Battle', 'Conspiracy', 'Creature', 'Dungeon', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Phenomenon', 'Plane', 'Planeswalker', 'Scheme', 'Sorcery', 'Vanguard'];
/** CR 205.3i, spelled as rules/filter.ts spells them. */
export const LAND_TYPES = ['Cave', 'Desert', 'Forest', 'Gate', 'Island', 'Lair', 'Locus', 'Mine', 'Mountain', 'Plains', 'Planet', 'Power-Plant', 'Sphere', 'Swamp', 'Tower', 'Town', 'Urza’s'];

const NAME_LISTS: Partial<Record<ChoiceKind, readonly string[]>> = { creatureType: [...ALL_CREATURE_TYPES], cardType: CARD_TYPES, landType: LAND_TYPES, planeswalkerType: PLANESWALKER_TYPES /* edh-d-94: CR 205.3j */ };

/**
 * edh-next-129 (CR 506.1, 508.1, 500.8; Territorial Hellkite, rulings 2017-08-25): the players the source object (this very object: one that left and came back is a new one, CR 400.7)
 * attacked as players (not a planeswalker or battle of theirs) during `who`'s last combat: the latest combat phase begun during a turn of `who`, other than the combat now under way.
 * Read from the game's history (`step` entries of the beginning of combat, `attacks` entries of the attackers).
 */
function attackedLastCombat(cx: ExecCtx, who: PlayerId): PlayerId[] {
  const s = cx.g.s;
  const now = { turn: s.turn.number, combat: s.combat?.number ?? 0 };
  const began = s.history.filter((h) => h.ev === 'step' && h.facts['step'] === 'beginCombat' && h.actor === who && !(h.turn === now.turn && h.combat === now.combat));
  const last = began[began.length - 1];
  if (last === undefined) return [];
  return s.history.flatMap((h) => (h.ev === 'attacks' && h.turn === last.turn && h.combat === last.combat && h.subject === cx.source.id && h.facts['defenderKind'] === 'player' && typeof h.facts['defendingPlayer'] === 'string' ? [h.facts['defendingPlayer'] as PlayerId] : []));
}

/**
 * M6-8: the values `exclude` keeps from being offered: fixed values, and the value chosen for a link earlier in this resolution ("one color word with another":
 * the second word is another one). A link nobody chose excludes nothing.
 */
function excludedValues(cx: ExecCtx, st: Step<'chooseValue'>): string[] {
  return (st.exclude ?? []).flatMap((x) => (typeof x === 'string' ? [x] : 'chosen' in x ? linkValue(cx, x.chosen)?.values ?? [] : []));
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
    else if ('bound' in x) out.push(...(cx.bindings.get(x.bound)?.players ?? [])); // edhn110 (CR 608.2d): the players an earlier choice of this resolution bound
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
    // edh-d-88 (CR 608.2d, 701.40g; Staff Room): "turn that creature face up or ...": turning face up an object no longer face down (or gone) is impossible, so that option is not offered
    if (first?.op === 'changeFace' && first.to === 'faceUp' && s.then.length === 1) {
      if (!currentObjs(cx, resolveObjs(cx, first.what)).some((h) => cx.g.s.objects[h.id]?.faceDown === true)) out.push(s.cond.equals);
      continue;
    }
    if (first?.op !== 'chooseObjects' || typeof first.min !== 'number' || first.min < 1 || first.random === true) continue;
    if (currentObjs(cx, resolveObjs(cx, first.from)).length === 0) out.push(s.cond.equals);
  }
  return out.length >= (st.options ?? []).length ? [] : out;
}

/** LNK1 (FAST4 audit note): the default prompt of a choice in words, with its article ("choose an option", not "choose a option"). */
const CHOICE_WORDS: Readonly<Record<ChoiceKind, string>> = {
  color: 'a color', creatureType: 'a creature type', cardType: 'a card type', landType: 'a land type', cardName: 'a card name', number: 'a number',
  player: 'a player', opponent: 'an opponent', option: 'an option', oddEven: 'odd or even', landOrNonland: 'land or nonland', lifeTotal: 'your life total' /* edh-next-144 */, manaTypeSpent: 'the type of mana spent',
  planeswalkerType: 'a planeswalker type', // edh-d-94 (CR 205.3j)
};
export const choicePrompt = (what: ChoiceKind | 'counterKind'): string => `choose ${what === 'counterKind' ? 'a counter' : CHOICE_WORDS[what] ?? `a ${what}`}`;

/** One player's choice. Returns the value as text (a color letter, a type, a name, a number, `odd`/`even`, an option) or a player. */
function chooseOne(cx: ExecCtx, st: Step<'chooseValue'>, player: PlayerId, about?: PlayerId): { value?: string; values?: string[]; player?: PlayerId; none?: true } | null {
  const g = cx.g;
  const prompt = `${notesOf(cx).sourceName}: ${st.span ?? choicePrompt(st.what)}${about !== undefined ? ` (for ${g.player(about).name})` : ''}`; // edh-next-143: a choice made for one player of `forEachPlayer`
  const rules = st.link ? ['CR 608.2d', 'CR 607.2d'] : ['CR 608.2d'];
  const excluded = excludedValues(cx, st);
  switch (st.what) {
    case 'color': {
      const listed = new Set((st.options ?? []).map((o) => COLOR_WORDS[o.trim().toLowerCase()]));
      const not = new Set(excluded.map((o) => COLOR_WORDS[o.trim().toLowerCase()]));
      const options = (st.options ? COLORS.filter((c) => listed.has(c)) : [...COLORS]).filter((c) => !not.has(c));
      if (options.length === 0) return null; // options that name no color: settled by hand, never a decision no answer satisfies
      // edh-next-140 (CR 105.1, 608.2d; Scuttlemutt: "the color or colors of your choice"): with `min`/`max`, one or more different colors at once (ruling 2019-07-12: one or more of the five
      // colors, never "colorless")
      if (st.min !== undefined || st.max !== undefined) {
        const lo = st.min === undefined ? 1 : evalQty(cx, st.min);
        const hi = st.max === undefined ? options.length : evalQty(cx, st.max);
        if (lo === undefined || hi === undefined || lo < 1 || hi < lo) return null;
        const ids = g.choose({ kind: 'chooseOption', player, prompt: `${prompt} (one or more)`, min: Math.min(lo, options.length), max: Math.min(hi, options.length), options: options.map((c) => ({ id: c, label: COLOR_NAMES[c] ?? c })), rules }).ids;
        const picked = options.filter((c) => ids.includes(c));
        return picked.length === 0 ? null : { value: picked.join(', '), values: picked };
      }
      return { value: g.choose({ kind: 'chooseColor', player, prompt, options, rules }).color };
    }
    case 'creatureType': case 'cardType': case 'landType': case 'cardName': case 'planeswalkerType': { // edh-d-94: planeswalkerType
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
      // edh-zones-26 (CR 608.2d; Tibalt's Trickery): "Choose 1, 2, or 3 at random": nobody chooses, the game picks a whole number of the range with its random generator
      if (st.random === true) return { value: String(Math.floor(lo) + randomIndex(g, Math.floor(hi) - Math.floor(lo) + 1)) };
      return { value: String(g.choose({ kind: 'chooseNumber', player, prompt, min: lo, max: hi, rules }).n) };
    }
    case 'player': case 'opponent': {
      const skip = excludedPlayers(cx, st);
      if (skip === null) return null; // M6-8: a value that names no player: settled by hand (as for numbers)
      let ps = (st.what === 'opponent' ? g.opponents(player).map((p) => p.id) : g.apnap()).filter((id) => !skip.includes(id));
      // edh-players-8 (CR 119.1, 608.2d; The Black Gate): "a player with the most life or tied for most life": the highest life total among the players of the game, whoever may be chosen
      if (st.mostLife === true) {
        const top = Math.max(...g.apnap().map((id) => g.player(id).life));
        ps = ps.filter((id) => g.player(id).life === top);
      }
      // edh-d-46 (CR 109.4, 608.2d; Boreas Charger): "choose an opponent who controls more lands than you": only the opponents who control more such permanents than the chooser; none to choose leaves the choice empty (the later steps do nothing)
      if (st.controlsMore !== undefined) {
        const found = resolveObjs(cx, { ref: 'each', filter: { ...st.controlsMore, zone: 'battlefield' } }).filter((h) => !g.s.objects[h.id]?.phasedOut);
        const count = (id: PlayerId): number => found.filter((h) => controllerOf(g.s, h.id) === id).length;
        const mine = count(player);
        ps = ps.filter((id) => count(id) > mine);
        if (ps.length === 0) return { none: true };
      }
      // edh-next-129 (CR 506.1, 508.1, 608.2d; Territorial Hellkite): never an opponent this source attacked during the chooser's last combat
      if (st.notAttackedLastCombat === true) {
        const attacked = attackedLastCombat(cx, player);
        ps = ps.filter((id) => !attacked.includes(id));
        if (ps.length === 0) return { none: true };
      }
      // edhn110 (CR 608.2d; Gluntch, the Bestower): every player was chosen before: nothing is chosen ("you won't choose a third player", ruling 2022-06-10), not a choice settled by hand
      if (ps.length === 0) return (st.exclude ?? []).some((x) => typeof x === 'object' && 'bound' in x) ? { none: true } : null;
      // edh-c-14 (CR 608.2d; Ruhan of the Fomori, Raving Dead): "Choose an opponent at random": nobody chooses, the game picks one of the players with its random generator
      if (st.random === true) return { player: ps[randomIndex(g, ps.length)]! };
      const pick = ps.length === 1 ? ps[0]! : g.choose({ kind: 'chooseOption', player, prompt, min: 1, max: 1, options: ps.map((id) => ({ id, label: g.player(id).name })), rules }).ids[0]!;
      return { player: pick };
    }
    case 'counterKind': {
      // edh-next-128 (CR 122.1, 608.2d; Crystalline Giant, rulings 2020-04-17): "choose a kind of counter at random that ~ doesn't have on it from among <kinds>": the listed kinds the
      // object has no counter of now (a keyword granted another way does not count); none left: nothing is chosen (the later steps that read the choice do nothing)
      if (st.counterNotOn !== undefined) {
        if (st.counterOn !== undefined || st.options === undefined || st.options.length === 0) return null;
        const on = currentObjs(cx, resolveObjs(cx, st.counterNotOn));
        if (on.length === 0) return { none: true }; // review (CR 608.2b-c): the object is gone: no kind is chosen and no counter is put
        if (on.length !== 1) return null; // several objects: settled by hand, never a guess
        const has = countersOn(cx, on[0]!);
        const left = st.options.filter((k) => (has[k] ?? 0) <= 0 && !excluded.includes(k));
        if (left.length === 0) return { none: true };
        if (st.random === true) return { value: left[randomIndex(g, left.length)]! };
        if (left.length === 1) return { value: left[0]! };
        const id = g.choose({ kind: 'chooseOption', player, prompt, min: 1, max: 1, options: left.map((o, i) => ({ id: String(i), label: o })), rules }).ids[0]!;
        return { value: left[Number(id)]! };
      }
      // edh-perms-15 (CR 122.1, 608.2d; Ichormoon Gauntlet): "choose a counter on target permanent or player": one of the kinds of counter the holder has now (none: nothing to choose, nothing happens)
      const r = st.counterOn === undefined ? { objects: [], players: [] } : resolveRecipients(cx, st.counterOn);
      const live = [...r.objects, ...r.players].filter((h) => (typeof h === 'string' ? !g.player(h).hasLost : isCurrent(cx, h)));
      // edh-d-89 (CR 122.1, 608.2d; Aven Courier): "choose a counter on a permanent you control": a kind of counter that any one of the group has (each kind once)
      const group = st.counterOn !== undefined && (st.counterOn as { ref?: string }).ref === 'each';
      const holder = live[0];
      const kinds = group ? [...new Set(live.flatMap((h) => Object.keys(countersOn(cx, h))))].sort() : holder === undefined ? [] : Object.keys(countersOn(cx, holder));
      if (kinds.length === 0) return { none: true };
      if (kinds.length === 1) return { value: kinds[0]! };
      const id = g.choose({ kind: 'chooseOption', player, prompt, min: 1, max: 1, options: kinds.map((o, i) => ({ id: String(i), label: o })), rules }).ids[0]!;
      return { value: kinds[Number(id)]! };
    }
    case 'lifeTotal': // edh-next-144 (CR 119.1, 607.2d; Sigarda's Splendor): "note your life total": nobody chooses; the number is the player's life total now
      return { value: String(g.player(player).life) };
    case 'manaTypeSpent': {
      // edh-mana-keywords-12 (CR 106.1, 602.2b, 607.2d; Jeweled Amulet + ruling 2008-10-01): "Note the type of mana spent to pay this activation cost." The type of the mana spent on the cost of this
      // ability (white, blue, black, red, green or colorless): one type is noted; none spent (the cost was free) notes nothing, and the earlier note stays. Mana of several types spent (a cost
      // increase) has no single "type of mana spent": settled by hand, never a guess.
      const spent = cx.stack?.costsPaid.manaSpent ?? [];
      const types = [...new Set(spent.map((u) => u.type))];
      if (types.length === 0) return { none: true };
      return types.length === 1 ? { value: types[0]! } : null;
    }
    case 'oddEven': case 'option': case 'landOrNonland': {
      const impossible = st.what === 'option' ? impossibleInstructions(cx, st) : [];
      const options = (st.what === 'oddEven' ? ['odd', 'even'] : st.what === 'landOrNonland' ? ['land', 'nonland'] : st.options ?? []).filter((o) => !excluded.includes(o) && !impossible.includes(o));
      if (options.length === 0) return null;
      if (impossible.length > 0 && options.length === 1) return { value: options[0]! }; // the one possible instruction: no real choice (CR 608.2d)
      // edh-next-129 (CR 608.2d; Blitzwing, Adaptive Assailant): "choose flying or indestructible at random": nobody chooses, the game picks one of the listed options
      if (st.random === true && st.what === 'option') return { value: options[randomIndex(g, options.length)]! };
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
  if (st.forEachPlayer !== undefined) return chooseForEachPlayer(cx, st, st.forEachPlayer);
  const values: string[] = [];
  const players: PlayerId[] = [];
  const byPlayer: Record<PlayerId, string> = {}; // edh-players-13 (CR 608.2d): what each chooser chose
  const revealed: [PlayerId, string][] = []; // edh-next-120: the secret choices to reveal once every player has chosen
  let unresolved = false;
  for (const p of resolvePlayers(cx, st.who)) {
    const r = chooseOne(cx, st, p);
    if (r?.none === true) { // edh-perms-15: a counter can't be chosen from nothing (CR 608.2d): the choice is made of nothing and the later steps that read it do nothing
      if (st.link) cx.choices?.set(st.link, { values: [] });
      continue;
    }
    if (!r) {
      unresolved = true;
      continue;
    }
    if (r.values !== undefined) { // edh-next-140: several colors at once, each a value of the link
      values.push(...r.values);
      byPlayer[p] = r.values[0]!;
    } else if (r.value !== undefined) {
      values.push(r.value);
      byPlayer[p] = r.value;
    }
    if (r.player !== undefined) players.push(r.player);
    // std-combat-5 (CR 608.2d): a secret choice is named to its chooser only; the others read that a choice was made
    if (st.secret === true) g.log(`${g.player(p).name} secretly chooses ${choicePrompt(st.what).replace(/^choose /, '')}.`, { rules: ['CR 608.2d'], level: 'action', privateText: { players: [p], text: `${g.player(p).name} secretly chooses ${r.value ?? g.player(r.player!).name}.` } });
    else if (st.what === 'lifeTotal') g.log(`${g.player(p).name} notes their life total (${r.value}).`, { rules: ['CR 119.1', 'CR 607.2d'], level: 'action' }); // edh-next-144
    else g.log(`${g.player(p).name} chooses ${r.value ?? g.player(r.player!).name}.`, { rules: ['CR 608.2d'], level: 'action' });
    if (st.reveal === true && st.secret === true) revealed.push([p, r.value ?? g.player(r.player!).name]);
  }
  // edh-next-120 (CR 608.2d; Wheel of Misfortune, Prisoner's Dilemma): "..., then the choices are revealed": once every player has chosen in secret, all the choices are revealed
  // at once (a chooser saw only their own while choosing), and from then on they are known to everyone (the link keeps no `secret`)
  for (const [p, v] of revealed) g.log(`${g.player(p).name} reveals ${v}.`, { rules: ['CR 608.2d'], level: 'action' });
  cx.bindings.set(st.as, { objects: [], players, snapshots: {} }); // bound before any manual prompt (design 3.1 rule 6)
  if (st.link && values.length + players.length > 0) {
    const choosers = resolvePlayers(cx, st.who);
    // std-combat-5: who knows a secret choice; edh-players-13: with several choosers (a group, even of one player in a two-player game), what each chose (the `chose` player reference)
    // edh-next-135 (CR 608.2d; Stalking Leonin): a secret choice of a player is known to its chooser only, as a secret value is
    const value = players.length > 0 ? { players, ...(st.secret === true && st.reveal !== true ? { secret: choosers } : {}) } : { values, ...(choosers.length > 1 || st.who.ref === 'each' ? { byPlayer } : {}), ...(st.secret === true && st.reveal !== true ? { secret: choosers } : {}) };
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

/**
 * edh-next-143 (CR 608.2d, 101.4; Pir's Whim, Khorvath's Fury; rulings 2018-06-08): "For each player, choose friend or foe.": the one chooser makes a choice among the listed words
 * FOR each player of `forEachPlayer` (APNAP order, the chooser included: "you make this choice for yourself as well as each other player"), and the link remembers the word chosen
 * for each of them (`byPlayer`, read by the `chose` player reference: "each friend", "each foe"). A choice that can't be made leaves the rest to the players by hand.
 */
function chooseForEachPlayer(cx: ExecCtx, st: Step<'chooseValue'>, over: PlayerRef): { performed: boolean; count: number } {
  const g = cx.g;
  const choosers = resolvePlayers(cx, st.who);
  if (choosers.length !== 1 || st.what !== 'option' || st.options === undefined || st.options.length === 0) {
    const r = askManual(cx, st.span ?? choicePrompt(st.what), 'a choice for each player needs one chooser and a list of words');
    return { performed: r.performed, count: r.count };
  }
  const chooser = choosers[0]!;
  const values: string[] = [];
  const byPlayer: Record<PlayerId, string> = {};
  for (const p of resolvePlayers(cx, over)) {
    const r = chooseOne(cx, st, chooser, p);
    if (r?.value === undefined) continue;
    values.push(r.value);
    byPlayer[p] = r.value;
    g.log(`${g.player(chooser).name} chooses ${r.value} for ${g.player(p).name}.`, { rules: ['CR 608.2d'], level: 'action' });
  }
  cx.bindings.set(st.as, { objects: [], players: [], snapshots: {} });
  if (st.link) {
    const value = { values, byPlayer };
    rememberLink(cx, st.link, value);
    cx.choices?.set(st.link, value);
  }
  return { performed: values.length > 0, count: values.length };
}
