/**
 * Standard round 4, r4-refs (references and durations): folds of adjacent steps that Oracle writes as one idiom (render/fold.ts#foldAt tries
 * `foldR4RefsEarly` before the general choose-then-move fold and `foldR4Refs` after the folds of the earlier slices). A fold applies only when
 * every part is exactly what the idiom says (same player, bound names, nothing else in between).
 */
import type { EffectStep, ObjectFilter, ObjRef, PlayerRef } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { isPlayerRef } from './refs';
import { cloneState, playerKey, type RenderState } from './state';
import { countersText } from './steps-life';
import { bind } from './steps-util';
import { alt, ALT_CLOSE, ALT_OPEN, ALT_SEP, numWord, withArticle } from './text';

/** The zone words the noun phrase of a card in an unnamed player's graveyard ends with ("from a graveyard", the marked "from" / "in" group too). */
const GRAVEYARD_WORDS = new RegExp(`\\s+(?:${ALT_OPEN}from${ALT_SEP}in${ALT_CLOSE}|from|in) (?:a|1) graveyard$`);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The one description of a choice among one player's objects in one zone: `{anyOf: [F], controller | owner: P, zone?}` (nothing else), or null. */
function ownChoice(s: EffectStep | undefined, who: PlayerRef, side: 'controller' | 'owner', zone: 'battlefield' | 'graveyard'): ObjectFilter | null {
  if (s?.op !== 'chooseObjects' || s.min !== 1 || s.max !== 1 || s.as === undefined || s.guard !== undefined || s.random === true || s.groupLimit !== undefined) return null;
  if (!same(s.who, who) || s.from.ref !== 'each' || !('filter' in s.from)) return null;
  const f = s.from.filter;
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',');
  const want = zone === 'battlefield' ? `anyOf,${side}` : `anyOf,${side},zone`;
  if (keys !== want || f.anyOf?.length !== 1 || !same(f[side], who) || (zone === 'graveyard' && f.zone !== 'graveyard')) return null;
  return f.anyOf[0]!;
}

/** A plain exile of what `name` bound. */
const exilesBound = (s: EffectStep | undefined, name: string): boolean =>
  s?.op === 'move' && s.what.ref === 'bound' && s.what.name === name && Object.keys(s.to).length === 1 && s.to.zone === 'exile' && s.until === undefined
  && s.guard === undefined && s.as === undefined;

/**
 * "Target opponent exiles a creature they control and their graveyard." / "... exiles a nontoken creature they control, then they exile a nonland card from
 * their graveyard." (CR 406.1, 608.2c-d): one player chooses one object they control and exiles it, then exiles every card of their graveyard, or one card of
 * it they choose. One player only (a target or "that player"; the choice of a group of players is one per player, which one choice does not say).
 */
function exileTheyControlThenGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'chooseObjects' || a.who.ref === 'each' || a.who.ref === 'you') return null;
  const who = a.who;
  const f = ownChoice(a, who, 'controller', 'battlefield');
  if (f === null || !exilesBound(list[i + 1], a.as!)) return null;
  const c = list[i + 2];
  // ... and their graveyard
  const wholeGraveyard = c?.op === 'move' && c.what.ref === 'each' && 'filter' in c.what && Object.keys(c.to).length === 1 && c.to.zone === 'exile'
    && c.until === undefined && c.guard === undefined && c.as === undefined && same(c.what.filter, { zone: 'graveyard', owner: who });
  // ..., then they exile a <card> from their graveyard: the Filter hole read the zone and the owner ("a nonland card from their graveyard")
  const oneCard = !wholeGraveyard && c?.op === 'chooseObjects' && c.min === 1 && c.max === 1 && c.as !== undefined && c.guard === undefined && c.random !== true
    && c.groupLimit === undefined && same(c.who, who) && c.from.ref === 'each' && 'filter' in c.from && c.from.filter.zone === 'graveyard'
    && same(c.from.filter.owner, who) && c.from.filter.controller === undefined && exilesBound(list[i + 3], c.as) ? c : null;
  if (!wholeGraveyard && oneCard === null) return null;
  // the card's words, before anything is said (a fold that gives up leaves the state as it was)
  let card: string | null = null;
  if (oneCard !== null && oneCard.from.ref === 'each' && 'filter' in oneCard.from) {
    const words = K.np({ ...oneCard.from.filter, owner: undefined }, cloneState(st), { det: 'a' });
    const zoneWords = GRAVEYARD_WORDS.exec(words);
    if (zoneWords === null) return null;
    card = words.slice(0, zoneWords.index);
  }
  const key = playerKey(who) ?? 'x';
  const subj = K.player(who, st, 'subject').text;
  const first = `${K.np(f, st, { det: 'a' })} they control`;
  bind(st, a.as!, { nouns: K.nounsOf(f), plural: false });
  if (oneCard === null || card === null) return { clauses: [acting(key, `exile ${first} and their graveyard`, `${subj} exiles ${first} and their graveyard`)], consumed: 3 };
  if (oneCard.from.ref === 'each' && 'filter' in oneCard.from) bind(st, oneCard.as!, { nouns: K.nounsOf(oneCard.from.filter), plural: false });
  const second = `${card} from their graveyard`;
  return { clauses: [acting(key, `exile ${first}, then they exile ${second}`, `${subj} exiles ${first}, then they exile ${second}`)], consumed: 4 };
}

/**
 * "Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn." (CR 608.2c, 611.2c): the
 * group a count counted is "those creatures" of the next sentence; the model writes the same description in both steps (the grant affects the creatures that
 * match it as the spell resolves, as the count read them). Only a draw of one card per object of a group of creatures, then a grant of abilities to the same
 * group and nothing else.
 */
function drawForEachThoseGain(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'effect' || a.who.ref !== 'you' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  const n = a.count;
  if (typeof n !== 'object' || n === null || !('q' in n) || n.q !== 'count' || n.of.ref !== 'each' || !('filter' in n.of)) return null;
  const group = n.of.filter;
  if (b.effects.length !== 1) return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || e.affects.ref !== 'each' || !('filter' in e.affects) || !same(e.affects.filter, group) || e.mods.length === 0 || !e.mods.every((m) => m.layer === 6 || m.layer === '7c')) return null;
  const nouns = K.nounsOf(group);
  if (!nouns.includes('creature')) return null;
  const first = K.clause(a, st);
  const name = '$r4refs.counted';
  bind(st, name, { nouns, plural: true });
  const second = K.clause({ ...b, effects: [{ ...e, affects: { ref: 'bound', name } }] }, st);
  return { clauses: [first, { ...second, breakBefore: true }], consumed: 2 };
}

/**
 * "Choose up to one target creature, then airbend all other creatures." (CR 115.1, 109.2, 701.65a, unverified): the one instruction acts on every object of a
 * description but the target (`{anyOf: [G], not: {is: <target>}}`), which the sentence announces first; with no target chosen, on all of them.
 */
function chooseTargetThenAllOther(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'action' || a.action !== 'airbend' || a.who.ref !== 'you' || a.guard !== undefined || a.subject === undefined) return null;
  const subj = a.subject as ObjRef;
  if (subj.ref !== 'each' || !('filter' in subj)) return null;
  const f = subj.filter;
  const t = f.not?.is;
  if (Object.keys(f).sort().join(',') !== 'anyOf,not' || f.anyOf?.length !== 1 || t === undefined || t.ref !== 'target' || Object.keys(f.not!).length !== 1) return null;
  const target = K.obj(t, st, 'object').text;
  const rest = K.np(f.anyOf[0]!, st, { det: 'none', plural: true });
  return { clauses: [plain(`choose ${target}, then airbend all other ${rest}`)], consumed: 1 };
}

/**
 * "Until your next turn, your opponents can't cast spells from anywhere other than their hands." (CR 601.3, 611.2a): a lasting "can't cast" of every spell not cast
 * from a hand, for a group of players, the duration said first (Oracle's order) or last.
 */
function lastingCastOnlyFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.effects.length !== 1) return null;
  const r = a.effects[0]!;
  if (r.s !== 'restrict' || r.mode !== 'cant' || r.action !== 'cast' || r.when !== undefined || r.max !== undefined || r.otherPlayer !== undefined || !same(r.other, { not: { castFrom: 'hand' } })) return null;
  const who = r.subject as PlayerRef;
  if (who.ref !== 'each' || who.who !== 'opponent') return null;
  const dur = K.dur(a.duration, st);
  const body = "your opponents can't cast spells from anywhere other than their hands";
  return { clauses: [plain(alt(`${dur}, ${body}`, `${body} ${dur}`), { standalone: true })], consumed: 1 };
}

/**
 * "Then if there are seven or more time counters on it, remove those counters and it deals 20 damage to you." (CR 122.1, 608.2c): the counters the condition
 * counted, all of that kind on that object, are "those counters" of the first instruction of the condition's instructions.
 */
function ifCountersRemoveThose(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'if' || a.else !== undefined || a.guard !== undefined || a.then.length !== 2) return null; // one instruction after the removal (FAST5 T70 says longer lists)
  const c = a.cond;
  if (c.cond !== 'compare' || c.op !== '>=' || typeof c.right !== 'number' || typeof c.left !== 'object' || c.left === null || !('q' in c.left) || c.left.q !== 'counters') return null;
  const left = c.left;
  const r = a.then[0]!;
  if (r.op !== 'removeCounters' || r.count !== 'all' || r.kind !== left.kind || !same(r.from, left.on) || r.guard !== undefined || r.upTo === true) return null;
  const cond = K.cond(c, st);
  const rest = K.steps(a.then.slice(1), st);
  return { clauses: [plain(`if ${cond}, remove those counters and ${rest}`, { standalone: true, leadThen: true })], consumed: 1 };
}

/**
 * "You may put a face-up exiled card they own into their graveyard." (CR 406.3, 404.1, 608.2d): you choose up to one face-up card in exile that one player owns
 * and it goes to its owner's graveyard. The owner is said as the subject of "own" ("they own", "that player owns").
 */
function mayPutFaceUpExiledIntoGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.as === undefined || a.guard !== undefined || a.random === true) return null;
  if (b.what.ref !== 'bound' || b.what.name !== a.as || !same(b.to, { zone: 'graveyard' }) || b.until !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  if (Object.keys(f).sort().join(',') !== 'faceDown,isCard,owner,zone' || f.zone !== 'exile' || f.faceDown !== false || f.isCard !== true || typeof f.owner !== 'object') return null;
  const p = K.player(f.owner, st, 'subject');
  const owns = p.they === true ? alt(`${p.text} ${p.person === 'pl' ? 'own' : 'owns'}`, 'they own') : `${p.text} ${p.person === 'pl' ? 'own' : 'owns'}`;
  bind(st, a.as, { nouns: ['card'], plural: false, optional: true });
  return { clauses: [plain(`you may put a face-up exiled card ${owns} into their graveyard`, { closesScope: true })], consumed: 2 };
}

/**
 * "Sacrifice ~ and it deals 3 damage to each opponent." / "If eight or more mana was spent to cast that spell, sacrifice ~ and it deals that much damage to each
 * opponent." (CR 701.21a, 120.3, 608.2h): the object deals the damage as it last existed. The amount is a number, or "that much" for the mana spent to cast the
 * spell the condition around it compared (parser/lower/quantities.ts#spentManaAmount reads "that much" so only there).
 */
function sacrificeSelfAndItDeals(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  // (the last two instructions of their list: a longer list, "sacrifice ~, it deals 2 damage to each opponent, and you gain 2 life", is cloud std-fra's fold)
  if (a?.op !== 'sacrifice' || b?.op !== 'damage' || list.length !== i + 2 || a.what.ref !== 'self' || b.source.ref !== 'self' || a.guard !== undefined || b.guard !== undefined) return null;
  if (b.divided !== undefined || (b.also ?? []).length > 0 || b.unpreventable === true || b.perSource === true || b.as !== undefined) return null;
  const n = b.amount;
  const amount = typeof n === 'number' ? `${n}` : typeof n === 'object' && n !== null && 'q' in n && n.q === 'spellManaSpent' ? 'that much' : null;
  if (amount === null) return null;
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  const to = isPlayerRef(b.to as ObjRef | PlayerRef, st) ? K.player(b.to as PlayerRef, st, 'object').text : K.obj(b.to as ObjRef, st, 'object', { prefer: 'each' }).text;
  return { clauses: [plain(`sacrifice ${self} and it deals ${amount} damage to ${to}`)], consumed: 2 };
}

/**
 * "Until end of turn, creatures you control with toughness greater than their power assign combat damage equal to their toughness rather than their power."
 * (CR 510.1a, 510.1c, 611.2c): the rule of FAST5 T60's static ability for a group, for a while (a rule, not a change of characteristics, so it reads the
 * group as it is when damage is assigned).
 */
function lastingToughnessDamage(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.effects.length !== 1 || a.duration.d !== 'endOfTurn') return null;
  const r = a.effects[0]!;
  if (r.s !== 'rule' || r.rule !== 'combatDamageUsesToughness' || r.onlyIf !== 'toughnessGreaterThanPower' || r.of === undefined) return null;
  const f = r.of as ObjectFilter;
  if (Object.keys(f).sort().join(',') !== 'anyOf,controller' || f.controller !== 'you' || f.anyOf?.length !== 1) return null;
  const group = K.np(f.anyOf[0]!, st, { det: 'none', plural: true });
  return { clauses: [plain(`until end of turn, ${group} you control with toughness greater than their power assign combat damage equal to their toughness rather than their power`, { standalone: true })], consumed: 1 };
}

/**
 * "Its controller searches their library for a basic land card, puts it onto the battlefield tapped with a stun counter on it, then shuffles." (CR 701.23a, 122.6,
 * 110.2): another player's search of their own library for one card, put onto the battlefield under their control tapped with counters, then their shuffle.
 */
function playerSearchesTappedWithCounters(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const sh = list[i + 2];
  if (a?.op !== 'search' || b?.op !== 'move' || sh?.op !== 'shuffle' || a.who.ref === 'you') return null;
  if (!same(sh.who, a.who) || !same(b.to.controller, a.who) || a.guard !== undefined || b.guard !== undefined || sh.guard !== undefined || sh.as !== undefined) return null;
  if (a.as === undefined || a.max !== 1 || a.min !== undefined || a.zone !== 'library' || a.owner !== undefined || a.reveal !== undefined || a.differentNames !== undefined || a.and !== undefined || a.alsoZones !== undefined) return null;
  if (b.what.ref !== 'bound' || b.what.name !== a.as || b.as !== undefined || b.until !== undefined || b.to.zone !== 'battlefield' || b.to.tapped !== true) return null;
  const counters = b.to.counters;
  // std-rl (CR 701.23a, 110.2): also with no counters, "Target player searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles."
  const bare = counters === undefined && Object.keys(b.to).sort().join(',') === 'controller,tapped,zone';
  if (!bare && (counters === undefined || counters.length !== 1 || Object.keys(b.to).sort().join(',') !== 'controller,counters,tapped,zone')) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const ca = K.clause(a, st);
  const key = playerKey(a.who) ?? 'x';
  const c = counters?.[0];
  const rest = c === undefined ? 'onto the battlefield tapped' : `onto the battlefield tapped with ${countersText(c.count, c.kind, st)} on it`;
  const text = `${ca.sub}, puts it ${rest}, then shuffles`;
  // std-rl: the imperative after "may" ("Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle")
  const imp = `${ca.imp}, put ${alt('it', 'that card')} ${rest}, then shuffle`;
  return { clauses: [acting(key, imp, text, { standalone: true })], consumed: 3 };
}

/**
 * "At the beginning of each player's draw step, that player loses 3 life, searches their library for a card, puts it into their hand, then shuffles." (CR 119.3,
 * 701.23a): another player loses life, then searches their own library for any one card, puts it into their hand and shuffles.
 */
function playerLosesSearchesHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [l, a, b, sh] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (l?.op !== 'loseLife' || a?.op !== 'search' || b?.op !== 'move' || sh?.op !== 'shuffle' || l.who.ref === 'you') return null;
  if (!same(a.who, l.who) || !same(sh.who, l.who) || l.guard !== undefined || a.guard !== undefined || b.guard !== undefined || sh.guard !== undefined || l.as !== undefined || sh.as !== undefined) return null;
  if (typeof l.amount !== 'number' || a.as === undefined || a.max !== 1 || a.min !== undefined || a.zone !== 'library' || a.owner !== undefined || a.reveal !== undefined || a.alsoZones !== undefined
    || a.differentNames !== undefined || a.and !== undefined || Object.keys(a.filter).length !== 0) return null;
  if (b.what.ref !== 'bound' || b.what.name !== a.as || b.as !== undefined || b.until !== undefined || !same(b.to, { zone: 'hand' })) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const subj = K.player(l.who, st, 'subject');
  const key = playerKey(l.who) ?? 'x';
  const text = `${subj.text} loses ${l.amount} life, searches their library for a card, puts it into their hand, then shuffles`;
  return { clauses: [acting(key, text, text, { standalone: true })], consumed: 4 };
}

/**
 * "Create a 2/2 Wizard creature token, then put a +1/+1 counter on each other Wizard token you control." (CR 111.1, 122.1, 109.2, 608.2c): "other" leaves out
 * the token just created (`not: {is: <the tokens>}`, the template's "other" anaphor that the anaphora pass resolved).
 */
function tokenThenCountersOnEachOther(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'createToken' || b?.op !== 'putCounters' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (b.on.ref !== 'each' || !('filter' in b.on)) return null;
  const f = b.on.filter;
  // (lower/anaphora.ts#foldOtherAnaphor writes the one description of `{anyOf: [G], not}` with the `not` beside its fields)
  if (!same(f.not, { is: { ref: 'bound', name: a.as } })) return null;
  const { not: _not, ...rest } = f;
  const g = Object.keys(rest).length === 1 && rest.anyOf?.length === 1 ? rest.anyOf[0]! : rest.anyOf === undefined ? rest : null;
  if (g === null) return null;
  const first = K.clause(a, st);
  const group = K.np(g, st, { det: 'none' });
  const second = `put ${countersText(b.count, b.kind, st)} on each other ${group}`;
  return { clauses: [{ ...first, imp: `${first.imp}, then ${second}`, sub: `${first.sub}, then ${second}`, standalone: true }], consumed: 2 };
}

/**
 * "Each of them is a 1/1 Spirit in addition to its other types." (CR 205.1b, 613.1d, 613.4b): a lasting change of a group named before (a binding), adding
 * creature types and setting the base power and toughness, said of each one.
 */
function eachOfThemIs(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.duration.d !== 'permanent' || a.effects.length !== 1) return null;
  const e = a.effects[0]!;
  if (e.s !== 'continuous' || e.affects.ref !== 'bound' || e.mods.length !== 2) return null;
  const [m4, m7] = e.mods as unknown as [Record<string, unknown>, Record<string, unknown>];
  const subs = (m4['subtypes'] as { add?: string[] } | undefined)?.add;
  if (m4['layer'] !== 4 || Object.keys(m4).length !== 2 || subs === undefined || subs.length === 0 || Object.keys(m4['subtypes'] as object).length !== 1) return null;
  if (m7['layer'] !== '7b' || typeof m7['power'] !== 'number' || typeof m7['toughness'] !== 'number' || Object.keys(m7).length !== 3) return null;
  const them = K.obj(e.affects, st, 'object');
  if (!them.plural) return null;
  const desc = `${m7['power']}/${m7['toughness']} ${subs.join(' ')}`;
  return { clauses: [plain(`each of ${them.text} is ${withArticle(desc)} in addition to its other types`)], consumed: 1 };
}

/**
 * "Choose a card name. Search target opponent's graveyard, hand, and library for up to four cards with that name and exile them. Then that player shuffles."
 * (CR 701.23a, 201.2, 607.2d): you search another player's three zones for up to N cards with the name chosen before and exile what you find; the owner of the
 * library then shuffles it (the shuffle is said as a sentence of its own, "Then that player shuffles.").
 */
function searchPlayersZonesForChosenName(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, sh] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'search' || b?.op !== 'move' || a.who.ref !== 'you' || a.owner === undefined || a.guard !== undefined || b.guard !== undefined) return null;
  if (a.zone !== 'graveyard' || !same(a.alsoZones, ['hand', 'library']) || a.allZones !== true || (a.min ?? 0) !== 0 || a.reveal !== undefined || a.and !== undefined || a.differentNames !== undefined) return null;
  if (Object.keys(a.filter).length !== 1) return null;
  // std-r9b (CR 701.23a, 201.2, 608.2h): "... for any number of cards with the same name as that creature and exile them": the name of one object named before
  const named = a.filter.sharesWith?.quality === 'name' && a.filter.sharesWith.with.ref !== 'each' ? a.filter.sharesWith.with : undefined;
  if (named ? a.max !== 'any' : typeof a.max !== 'number' || a.filter.chosen?.quality !== 'cardName') return null;
  if (b.what.ref !== 'bound' || b.what.name !== a.as || !same(b.to, { zone: 'exile' }) || b.until !== undefined) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  // std-r9b (CR 701.24a, 121.1, 608.2h): "That player shuffles, then draws a card for each card exiled from their hand this way": the only reader of what the exile
  // moved is a draw by the same player right after the shuffle, of one card per card that was in a hand as it last existed
  const dr = list[i + 3];
  const drawsPerHandCard = named !== undefined && b.as !== undefined && dr?.op === 'draw' && same(dr.who, a.owner) && dr.guard === undefined && dr.as === undefined
    && same(dr.count, { q: 'resultCount', step: b.as, which: { zone: 'hand', isCard: true } });
  if (b.as !== undefined && (!drawsPerHandCard || list.slice(i + 4).some((x) => JSON.stringify(x).includes(`"${b.as}"`)))) return null;
  const whose = K.player(a.owner, st, 'possessive').text;
  // std-costs-1 (CR 201.2, 608.2c; family search-same-name-that-name): the name of one object named before is also "that name" (Deadly Cover-Up)
  const names = named ? [`the same name as ${K.obj(named, st, 'object').text}`, ...(named.ref === 'bound' ? ['that name'] : [])] : ['that name', 'the chosen name'];
  const cards = `${named ? 'any number of' : `up to ${numWord(a.max as number)}`} cards with ${alt(...names)}`;
  const clauses = [plain(`search ${whose} graveyard, ${alt('hand, and library', 'hand and library')} for ${cards} and exile them`)];
  const shuffles = sh?.op === 'shuffle' && same(sh.who, a.owner) && sh.guard === undefined && sh.as === undefined && sh.ifSearched === undefined;
  if (drawsPerHandCard && !shuffles) return null;
  if (shuffles) {
    const p = K.player(a.owner, st, 'subject');
    const draws = drawsPerHandCard ? ', then draws a card for each card exiled from their hand this way' : '';
    clauses.push(plain(`${drawsPerHandCard ? '' : alt('then ', '')}${p.text} shuffles${draws}`, { breakBefore: true }));
  }
  return { clauses, consumed: shuffles ? (drawsPerHandCard ? 4 : 3) : 2 };
}

/** The folds that go before the general choose-then-move and search-then-move folds (render/fold.ts#foldAt), which would say these steps as separate sentences. */
export function foldR4RefsEarly(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileTheyControlThenGraveyard(list, i, st) ?? mayPutFaceUpExiledIntoGraveyard(list, i, st) ?? playerSearchesTappedWithCounters(list, i, st) ?? playerLosesSearchesHand(list, i, st) ?? searchPlayersZonesForChosenName(list, i, st);
}

/** The other folds, tried after every fold of the earlier slices (so a shape one of them says keeps its readings). */
export function foldR4Refs(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawForEachThoseGain(list, i, st) ?? chooseTargetThenAllOther(list, i, st) ?? lastingCastOnlyFromHand(list, i, st) ?? ifCountersRemoveThose(list, i, st) ?? sacrificeSelfAndItDeals(list, i, st) ?? lastingToughnessDamage(list, i, st) ?? tokenThenCountersOnEachOther(list, i, st) ?? eachOfThemIs(list, i, st);
}
