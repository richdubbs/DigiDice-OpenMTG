/**
 * p2-intervening-1 ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms) for intervening "if" clauses (CR 603.4) the grammar could not state.
 * Every reading gives the same JSON an existing reading gives for another wording (render/cond.ts prints both), or a value the engine already evaluates:
 *  - "no creatures are on the battlefield" (as "there are no creatures on the battlefield", CR 603.4);
 *  - "you have four or more creature cards in your graveyard", "twenty or more creature cards are in your graveyard" (as "there are N or more ... in your
 *    graveyard", CR 404.1);
 *  - "~ has counters on it", "~ has loyalty counters on it" (as "~ has a counter on it", CR 122.1) ("there are no arrowhead counters on ~" is
 *    p2-counters-state-1's reading, parser/holes/cond.ts#thereAre);
 *  - "you lost life last turn", "an opponent lost life last turn" (M6-4's scope `lastTurn`, CR 119.3, 500.1) and "you didn't lose life this turn";
 *  - "you have a card in hand" (one or more, CR 402.1), "that player has no cards in hand", "defending player has two or fewer cards in hand";
 *  - "you control exactly one creature" (the number of them, CR 603.4);
 *  - "you attacked with creatures with total power 6 or greater this combat" (pack tactics: the declaration's total power, CR 508.1, 208.1);
 *  - "that player controls more lands than you", "defending player controls more lands than you" (the two counts, CR 603.4);
 *  - "you control the artifact with the greatest mana value or tied for the greatest mana value" (as Cloud std-fin's power form, CR 202.3);
 *  - "you didn't cast it from your hand", "it wasn't cast" (the cast record of the object, CR 601.2a, 400.7d), "no mana was spent to cast it" (CR 601.2h);
 *  - "there are thirty or more counters among artifacts and creatures you control" (every kind, CR 122.1);
 *  - "a player discarded a card this turn", "no creatures attacked this turn", "~ dealt damage to an opponent this turn" (the turn's history, CR 603.4);
 *  - "it's not that player's turn" (CR 500.1), "that player controls a nonblack, nonland permanent", "you have 200 or more cards in your library" (CR 401.1);
 *  - "that spell was kicked" (the cast record of the spell a cast trigger names, CR 702.33d), "it doesn't have the same name as another creature you control or a
 *    creature card in your graveyard" (CR 201.2).
 */
import type { Condition, EventPattern, NumberCmp, ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, anaphorObj, cmpAt, mergeFilter, phraseAt } from './core';
import { npAlts } from './filter';

/** parser/holes/cond.ts#spentObjects, passed in by cond.ts (no import back: design 5.4, no cycles). */
type SpentObjects = (ctx: HoleCtx, pos: number) => { end: number; value: never; flags?: string[] }[];

const exists = (filter: ObjectFilter, atLeast?: Quantity): Condition => ({ cond: 'exists', of: { ref: 'each', filter }, ...(atLeast !== undefined ? { atLeast } : {}) });
const compare = (left: Quantity, op: NumberCmp['op'], right: Quantity): Condition => ({ cond: 'compare', left, op, right });
const flagsOf = (f: readonly string[] | undefined): { flags?: string[] } => (f !== undefined && f.length > 0 ? { flags: [...f] } : {});

const W_NO = P('no');
const W_ARE_ON_THE_BATTLEFIELD = P('are on the battlefield');
const W_YOU_HAVE = P('you have');
const W_ARE_IN_YOUR_GRAVEYARD = P('are in your graveyard');
const W_HAS = P('has');
const W_COUNTERS_ON_IT = P('counters on it');
const W_LOST_LIFE_LAST_TURN = P('lost life last turn');
const W_LIFE_LOSERS: readonly [string[], 'you' | 'opponent'][] = [[P('you'), 'you'], [P('an opponent'), 'opponent']];
const W_DIDNT_LOSE_LIFE = [P("you didn't lose life this turn"), P('you did not lose life this turn'), P("you haven't lost life this turn")];
const W_A_CARD_IN_HAND = [P('a card in hand'), P('a card in your hand')];
const W_CARDS_IN_HAND = [P('cards in hand'), P('cards in their hand')];
const W_YOU_CONTROL_EXACTLY = P('you control exactly');

/** "no creatures are on the battlefield": no permanent of the description (any controller), CR 603.4. */
function noneOnBattlefield(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const no = phraseAt(ctx, pos, W_NO);
  if (no < 0) return;
  for (const n of npAlts(ctx, no)) {
    if (n.number !== 'plural' || n.filter.zone !== undefined || n.filter.controller !== undefined || n.filter.owner !== undefined) continue;
    const e = phraseAt(ctx, n.end, W_ARE_ON_THE_BATTLEFIELD);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: exists(n.filter) }, ...flagsOf(n.flags) });
  }
}

/** A description of cards in your graveyard with something more than "cards" (bare "N or more cards are in your graveyard" is FAST5 T53's `graveyardSize`). */
const describedCards = (f: ObjectFilter): boolean => Object.keys(f).some((k) => !['isCard', 'zone', 'owner'].includes(k) && f[k as keyof ObjectFilter] !== undefined);

/** "you have four or more creature cards in your graveyard", "twenty or more creature cards are in your graveyard" (CR 404.1): N or more such cards there. */
function cardsInGraveyard(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const have = phraseAt(ctx, pos, W_YOU_HAVE);
  if (have >= 0) for (const c of cmpAt(ctx, have)) {
    if (c.cmp.op !== '>=') continue;
    for (const n of npAlts(ctx, c.end)) {
      const f = n.filter;
      if (n.number !== 'plural' || f.zone !== 'graveyard' || f.owner !== 'you' || f.isCard !== true || f.controller !== undefined || !describedCards(f)) continue;
      out.push({ end: n.end, value: exists(f, c.cmp.value), ...flagsOf(n.flags) });
    }
  }
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=') continue;
    for (const n of npAlts(ctx, c.end)) {
      const f = n.filter;
      if (n.number !== 'plural' || f.zone !== undefined || f.owner !== undefined || f.controller !== undefined || f.isCard !== true || !describedCards(f)) continue;
      const e = phraseAt(ctx, n.end, W_ARE_IN_YOUR_GRAVEYARD);
      const g = e >= 0 ? mergeFilter(f, { zone: 'graveyard', owner: 'you' }) : null;
      if (g) out.push({ end: e, value: exists(g, c.cmp.value), ...flagsOf(n.flags) });
    }
  }
}

/** "~ has counters on it", "~ has loyalty counters on it" (one or more, CR 122.1); "there are no arrowhead counters on ~" is cond.ts#thereAre's (p2-counters-state-1). */
function selfCounters(ctx: HoleCtx, pos: number, out: Alt[]): void {
  if (ctx.toks[pos]?.kind === 'SELF') {
    const h = phraseAt(ctx, pos + 1, W_HAS);
    if (h >= 0) {
      const any = phraseAt(ctx, h, W_COUNTERS_ON_IT);
      if (any >= 0) out.push({ end: any, value: { cond: 'matches', object: { ref: 'self' }, filter: { counters: { kind: 'any' } } } });
      for (const k of ctx.call('CounterKind', h)) {
        const e = phraseAt(ctx, k.end, W_COUNTERS_ON_IT);
        if (e >= 0) out.push({ end: e, value: { cond: 'matches', object: { ref: 'self' }, filter: { counters: { kind: k.value as string } } } });
      }
    }
  }
}

/** "you lost life last turn", "an opponent lost life last turn" (the previous turn's history, CR 500.1, 119.3); "you didn't lose life this turn". */
function lifeHistory(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const [w, player] of W_LIFE_LOSERS) {
    const s = phraseAt(ctx, pos, w);
    const e = s >= 0 ? phraseAt(ctx, s, W_LOST_LIFE_LAST_TURN) : -1;
    if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'life', change: 'loss', player }, scope: 'lastTurn' } as Condition });
  }
  for (const w of W_DIDNT_LOSE_LIFE) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'you' }, scope: 'turn' } } as Condition });
  }
}

/** "you have a card in hand" (one or more); "that player has no cards in hand", "defending player has two or fewer cards in hand" (CR 402.1). */
function handSize(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const have = phraseAt(ctx, pos, W_YOU_HAVE);
  if (have >= 0) for (const w of W_A_CARD_IN_HAND) {
    const e = phraseAt(ctx, have, w);
    if (e >= 0) out.push({ end: e, value: compare({ q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, '>=', 1) });
  }
  for (const p of namedPlayers(ctx, pos)) {
    const v = p.value;
    const h = phraseAt(ctx, p.end, W_HAS);
    if (h < 0) continue;
    const size: Quantity = { q: 'zoneSize', zone: 'hand', of: v as never };
    const no = phraseAt(ctx, h, W_NO);
    if (no >= 0) for (const w of W_CARDS_IN_HAND) { const e = phraseAt(ctx, no, w); if (e >= 0) out.push({ end: e, value: compare(size, '==', 0), ...flagsOf(p.flags) }); }
    for (const c of cmpAt(ctx, h)) {
      if (c.cmp.op === '==') continue;
      for (const w of W_CARDS_IN_HAND) { const e = phraseAt(ctx, c.end, w); if (e >= 0) out.push({ end: e, value: compare(size, c.cmp.op, c.cmp.value), ...flagsOf(p.flags) }); }
    }
  }
}

/** "you control exactly one creature": the number of permanents of the description you control is that number (CR 603.4). */
function controlExactly(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const e = phraseAt(ctx, pos, W_YOU_CONTROL_EXACTLY);
  if (e < 0) return;
  for (const q of ctx.call('Qty', e)) {
    if (typeof q.value !== 'number') continue;
    for (const n of npAlts(ctx, q.end)) {
      if (n.number !== (q.value === 1 ? 'singular' : 'plural') || n.filter.controller !== undefined || n.filter.zone !== undefined) continue;
      const f = mergeFilter(n.filter, { controller: 'you' });
      if (f) out.push({ end: n.end, value: compare({ q: 'count', of: { ref: 'each', filter: f } }, '==', q.value), ...flagsOf(n.flags) });
    }
  }
}

const W_ATTACKED_WITH_TOTAL_POWER = [P('you attacked with creatures with total power'), P("you've attacked with creatures with total power")];
const W_THIS_COMBAT = P('this combat');

/**
 * Pack tactics (CR 508.1, 208.1, 603.4): "you attacked with creatures with total power 6 or greater this combat": the attackers you declared in this combat had at
 * least that total power as they were declared (the history entry of each attacker keeps its declaration's `totalPower`, triggers/normalize.ts; the same fact
 * r3-trig's "whenever you attack with creatures with total power N or greater" reads). A later change of power does not matter. Only "or greater" / "or more".
 */
function packTactics(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const w of W_ATTACKED_WITH_TOTAL_POWER) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      const end = phraseAt(ctx, c.end, W_THIS_COMBAT);
      const event: EventPattern = { ev: 'attacks', attacker: { controller: 'you' }, power: c.cmp };
      if (end >= 0) out.push({ end, value: { cond: 'happened', event, scope: 'combat' } as Condition });
    }
  }
}

const W_CONTROLS = P('controls');
const W_MORE = P('more');
const W_THAN_YOU = P('than you');
/** The player an earlier part of the ability named (an anaphor the lowering resolves) or the defending player (CR 506.2); never "you" or a group. */
function namedPlayers(ctx: HoleCtx, pos: number): { end: number; value: Record<string, unknown>; flags?: string[] }[] {
  const out: { end: number; value: Record<string, unknown>; flags?: string[] }[] = [];
  for (const p of ctx.call('Player', pos)) {
    const v = p.value as Record<string, unknown> | null;
    if (v !== null && typeof v === 'object' && ('$anaphor' in v || (v['ref'] === 'defending' && Object.keys(v).length === 1))) out.push({ end: p.end, value: v, ...flagsOf(p.flags) });
  }
  return out;
}

/** "that player controls more lands than you", "defending player controls more lands than you"; "that player controls a nonblack, nonland permanent". */
function namedPlayerControls(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const p of namedPlayers(ctx, pos)) {
    const c = phraseAt(ctx, p.end, W_CONTROLS);
    if (c < 0) continue;
    const more = phraseAt(ctx, c, W_MORE);
    if (more >= 0) for (const n of npAlts(ctx, more)) {
      if (n.number !== 'plural' || n.filter.controller !== undefined || n.filter.zone !== undefined) continue;
      const than = phraseAt(ctx, n.end, W_THAN_YOU);
      const theirs = than >= 0 ? mergeFilter(n.filter, { controller: p.value as never }) : null;
      const mine = than >= 0 ? mergeFilter(n.filter, { controller: 'you' }) : null;
      if (theirs && mine) out.push({ end: than, value: compare({ q: 'count', of: { ref: 'each', filter: theirs } }, '>', { q: 'count', of: { ref: 'each', filter: mine } }), ...flagsOf([...(p.flags ?? []), ...n.flags]) });
    }
    // the positive "defending player controls an Island" is the templates' of rst.t16.cantattack.unless.defending.controls (parser/holes/cond.ts#control, guard G5):
    // only the player an earlier part of the ability named here
    const t = ctx.toks[c]?.norm;
    if ((t === 'a' || t === 'an') && '$anaphor' in p.value) for (const n of npAlts(ctx, c + 1)) {
      if (n.number !== 'singular' || n.filter.controller !== undefined || n.filter.zone !== undefined) continue;
      const f = mergeFilter(n.filter, { controller: p.value as never });
      if (f) out.push({ end: n.end, value: exists(f), ...flagsOf([...(p.flags ?? []), ...n.flags]) });
    }
  }
}

const W_YOU_CONTROL_THE = P('you control the');
const W_GREATEST_MV_OR_TIED = P('with the greatest mana value or tied for the greatest mana value');
/** "you control the artifact with the greatest mana value or tied for the greatest mana value": you control one, and the greatest among yours is at least the greatest among all. */
function greatestManaValue(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const e = phraseAt(ctx, pos, W_YOU_CONTROL_THE);
  if (e < 0) return;
  for (const n of npAlts(ctx, e)) {
    if (n.number !== 'singular' || n.filter.controller !== undefined || n.filter.zone !== undefined) continue;
    const end = phraseAt(ctx, n.end, W_GREATEST_MV_OR_TIED);
    const mine = end >= 0 ? mergeFilter(n.filter, { controller: 'you' }) : null;
    if (!mine) continue;
    const max = (filter: ObjectFilter): Quantity => ({ q: 'stat', stat: 'manaValue', of: { ref: 'each', filter }, agg: 'max' });
    out.push({ end, value: { cond: 'all', of: [exists(mine), compare(max(mine), '>=', max(n.filter))] }, ...flagsOf(n.flags) });
  }
}

const W_DIDNT_CAST_IT_FROM_HAND = [P("you didn't cast it from your hand"), P('you did not cast it from your hand')];
const W_IT_WASNT_CAST = [P("it wasn't cast"), P('it was not cast')];
const W_NO_MANA_SPENT = P('no mana was spent to cast');
/**
 * "you didn't cast it from your hand", "it wasn't cast" (CR 601.2a, 400.7d): the cast record of the object the pronoun names (`$self`, resolved as "it was cast" is:
 * the source itself, or the object that entered of an enters trigger, parser/lower/ability.ts#resolveCondAnaphors). "no mana was spent to cast it" (CR 601.2h): the
 * mana spent on the spell named, zero. The last two are weak (design 6.3 rule 2): FAST5 T51's "it wasn't cast or no mana was spent to cast it" keeps its own reading.
 */
function castRecord(ctx: HoleCtx, pos: number, out: Alt[], spentObjects: SpentObjects): void {
  const it = (): unknown => anaphorObj({ sort: 'object', number: 'singular', text: 'it' });
  for (const w of W_DIDNT_CAST_IT_FROM_HAND) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'wasCast', from: 'hand', $self: it() } } as unknown as Condition });
  }
  for (const w of W_IT_WASNT_CAST) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, weak: 1, value: { cond: 'not', of: { cond: 'wasCast', $self: it() } } as unknown as Condition });
  }
  const nm = phraseAt(ctx, pos, W_NO_MANA_SPENT);
  if (nm >= 0) for (const o of spentObjects(ctx, nm)) out.push({ end: o.end, weak: 1, value: compare({ q: 'spellManaSpent', of: o.value }, '==', 0), ...flagsOf(o.flags) });
}

const W_THERE_ARE = P('there are');
const W_COUNTERS_AMONG = P('counters among');
/** "there are thirty or more counters among artifacts and creatures you control": the counters of every kind on all of them, added up (CR 122.1). */
function countersAmong(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const e = phraseAt(ctx, pos, W_THERE_ARE);
  if (e < 0) return;
  for (const c of cmpAt(ctx, e)) {
    if (c.cmp.op !== '>=') continue;
    const am = phraseAt(ctx, c.end, W_COUNTERS_AMONG);
    if (am >= 0) for (const n of npAlts(ctx, am)) {
      if (n.number !== 'plural') continue;
      out.push({ end: n.end, value: compare({ q: 'counters', on: { ref: 'each', filter: n.filter }, kind: 'any' }, '>=', c.cmp.value), ...flagsOf(n.flags) });
    }
  }
}

const W_A_PLAYER_DISCARDED = P('a player discarded a card this turn');
const W_ATTACKED_THIS_TURN = P('attacked this turn');
const W_DEALT_DAMAGE_TO_AN_OPPONENT = P('dealt damage to an opponent this turn');
/** "a player discarded a card this turn", "no creatures attacked this turn", "~ dealt damage to an opponent this turn" (the turn's history, CR 603.4). */
function turnHistory(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const d = phraseAt(ctx, pos, W_A_PLAYER_DISCARDED);
  if (d >= 0) out.push({ end: d, value: { cond: 'happened', event: { ev: 'action', verb: 'discard' }, scope: 'turn' } as Condition });
  const no = phraseAt(ctx, pos, W_NO);
  if (no >= 0) for (const n of npAlts(ctx, no)) {
    if (n.number !== 'plural' || n.filter.controller !== undefined || n.filter.zone !== undefined || JSON.stringify(n.filter) !== JSON.stringify({ types: ['Creature'] })) continue;
    const e = phraseAt(ctx, n.end, W_ATTACKED_THIS_TURN);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'happened', event: { ev: 'attacks', attacker: n.filter }, scope: 'turn' } } as Condition });
  }
  if (ctx.toks[pos]?.kind === 'SELF') {
    const e = phraseAt(ctx, pos + 1, W_DEALT_DAMAGE_TO_AN_OPPONENT);
    if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'damage', source: { self: true }, recipient: { player: 'opponent' } }, scope: 'turn' } as Condition });
  }
}

const W_NOT_THAT_PLAYERS_TURN = [P("it's not that player 's turn"), P("it is not that player 's turn"), P("it isn't that player 's turn")];
const W_CARDS_IN_YOUR_LIBRARY = P('cards in your library');
/** "it's not that player's turn" (CR 500.1); "you have 200 or more cards in your library" (CR 401.1). */
function turnAndLibrary(ctx: HoleCtx, pos: number, out: Alt[]): void {
  for (const w of W_NOT_THAT_PLAYERS_TURN) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'turnOf', whose: anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }) as never } } });
  }
  const have = phraseAt(ctx, pos, W_YOU_HAVE);
  if (have >= 0) for (const c of cmpAt(ctx, have)) {
    if (c.cmp.op !== '>=') continue;
    const e = phraseAt(ctx, c.end, W_CARDS_IN_YOUR_LIBRARY);
    if (e >= 0) out.push({ end: e, value: compare({ q: 'zoneSize', zone: 'library', of: { ref: 'you' } }, '>=', c.cmp.value) });
  }
}

const W_THAT_SPELL_WAS_KICKED = P('that spell was kicked');
const W_IT_DOESNT_SHARE_NAME = [P("it doesn't have the same name as another"), P('it does not have the same name as another')];
const W_OR_A = [P('or a'), P('or an')];
/**
 * "that spell was kicked" (CR 702.33d): the cast record of the spell a cast trigger names (`$self`, resolved to the event's spell by parser/lower/ability.ts#
 * resolveCondAnaphors, or left as a marker and manual). "it doesn't have the same name as another creature you control or a creature card in your graveyard"
 * (CR 201.2): the object the pronoun names shares no name with any other object of the first description nor with any object of the second (two `matches`).
 */
function spellAndName(ctx: HoleCtx, pos: number, out: Alt[]): void {
  const k = phraseAt(ctx, pos, W_THAT_SPELL_WAS_KICKED);
  if (k >= 0) out.push({ end: k, value: { cond: 'wasCast', kicked: true, $self: anaphorObj({ sort: 'object', number: 'singular', head: 'spell', text: 'that spell' }) } as unknown as Condition });
  for (const w of W_IT_DOESNT_SHARE_NAME) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const a of npAlts(ctx, e)) {
      if (a.number !== 'singular' || a.flags.some((x) => x !== 'zone-unstated')) continue;
      for (const o of W_OR_A) {
        const b0 = phraseAt(ctx, a.end, o);
        if (b0 >= 0) for (const b of npAlts(ctx, b0)) {
          if (b.number !== 'singular' || b.flags.some((x) => x !== 'zone-unstated')) continue;
          const it = (): never => anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) as never;
          const none = (filter: ObjectFilter, other: boolean): Condition => ({ cond: 'matches', object: it(), filter: { not: { sharesWith: { with: { ref: 'each', filter }, quality: 'name', ...(other ? { other: true as const } : {}) } } } });
          out.push({ end: b.end, value: { cond: 'all', of: [none(a.filter, true), none(b.filter, false)] } });
        }
      }
    }
  }
}

export function p2iv1CondAt(ctx: HoleCtx, pos: number, spentObjects: SpentObjects): Alt[] {
  const out: Alt[] = [];
  noneOnBattlefield(ctx, pos, out);
  cardsInGraveyard(ctx, pos, out);
  selfCounters(ctx, pos, out);
  lifeHistory(ctx, pos, out);
  handSize(ctx, pos, out);
  controlExactly(ctx, pos, out);
  packTactics(ctx, pos, out);
  namedPlayerControls(ctx, pos, out);
  greatestManaValue(ctx, pos, out);
  castRecord(ctx, pos, out, spentObjects);
  countersAmong(ctx, pos, out);
  turnHistory(ctx, pos, out);
  turnAndLibrary(ctx, pos, out);
  spellAndName(ctx, pos, out);
  return out;
}
