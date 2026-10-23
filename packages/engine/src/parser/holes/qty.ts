/**
 * Hole grammars `Qty` (Quantity) and `Count` (design 6.3, model section 4 "Quantities"). Owner: WP6.
 *
 * Covers numbers and number words, `X`, "a"/"an", `twice`, `half ..., rounded up/down` (CR 107.1a: the rounding must be stated, otherwise no parse),
 * `that many` / `that much` (a marker, resolved by the anaphora pass), "the number of ..." and "for each ..." (counts; "cards in your hand" is `zoneSize`),
 * statistics of one object or of a set ("its power", "the greatest power among creatures you control", "the total mana value of ..."), life totals, counters,
 * devotion (CR 700.5), life totals (CR 119), counters (CR 122.1), the history counts the model has names for, and `plus`/`minus` chains (left to right).
 */
import type { ObjRef, ObjectFilter, PlayerRef, Quantity, ZoneName } from '../../types/ability';
import type { Color } from '../../types/mana';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, anaphorObj, anaphorQty, anyPhraseAt, dedupe, numberAt, phraseAt } from './core';
import { possessivePlayerAt } from './player';
import { excessQtyAt } from './excess';
import { voteQtyAt } from './vote';
import { isRoomsOnly } from '../../model/room-filter';
import { commanderQtyAt } from './commander-qty';
import { p2cst1QtyAt } from './p2cst1';
import { npAlts } from './filter';

const W_NUMBER_OF = P('the number of');
/** r3-choose (CR 115.1): "the total number of creatures those players control": one count over the permanents of several players (render/qty.ts says "total" only then). */
const W_TOTAL_NUMBER_OF = P('the total number of');
const W_TOTAL_MV_OF_TARGETS = P('the total mana value of the permanents ~ targets'); // std-costs-1
const W_FOR_EACH = P('for each');
const W_CARD_DISCARDED = P("card you've discarded this turn"); // r4-fxz
const DISCARDED_THIS_TURN = (): Quantity => ({ q: 'happenedCount', event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' });
const W_UNLOCKED_DOORS_AMONG = P('the number of unlocked doors among'); // cloud std-dsk
const W_BASIC_LAND_TYPES_AMONG = P('basic land types among'); // Standard round 6
const W_BASIC_LAND_TYPE_AMONG = P('basic land type among'); // p2-typechange-2
const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
const W_TWICE = P('twice');
const W_HALF = P('half');
// FAST4 T30: the words of the `plus` / `minus` chains (read by token below) are words of the grammar too (guard G2: "3 minus the number of cards in their hand")
P('plus'); P('minus');
const W_ROUNDED_UP = P('rounded up');
const W_ROUNDED_DOWN = P('rounded down');
const W_THAT_MANY = [P('that many'), P('that much')];
const W_THAT_AMOUNT_OF = P('that amount of'); // r5-fxb
const W_THE_DIFFERENCE = P('the difference'); // FAST5 T62
const W_DAMAGE_DEALT_TO = P('the amount of damage dealt to'); // std-rx29
const W_THIS_TURN = P('this turn'); // std-rx29
const W_DIFFERENCE_BETWEEN_CHOSEN = P('the difference between the chosen'); // std-rx29
const DIFFERENCE_HEADS = new Set(['creature', 'permanent', 'artifact', 'card']); // std-rx29: "the chosen creatures'", ...
P("creatures'"); P("permanents'"); P("artifacts'"); P("cards'"); // std-rx29: the plural possessive heads above are words of the grammar (guard G2)
const PLURAL_STAT_WORDS: [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('powers'), 'power'], [P('toughnesses'), 'toughness'], [P('mana values'), 'manaValue']]; // std-rx29
const W_LIFE_TOTAL = P("life total");
const W_STARTING_LIFE_TOTAL = P("your starting life total"); // FAST5 T60
const W_LIFE_TOTAL_AMONG: [string[], 'min' | 'max'][] = [[P('the highest life total among'), 'max'], [P('the greatest life total among'), 'max'], [P('the lowest life total among'), 'min']]; // p2-group-actions-1
const W_AMONG_PLAYERS: [string[], PlayerRef][] = [[P('all players'), { ref: 'each', who: 'player' }], [P('your opponents'), { ref: 'each', who: 'opponent' }]]; // p2-group-actions-1
const W_AMONG = P('among');
const W_DRAWN_THIS_WAY = P('the number of cards drawn this way'); // FAST5X E15
const W_COUNTERED_THIS_WAY = P('spell and ability countered this way'); // r4-moved
const W_SHUFFLED_THIS_WAY = P('the number of cards shuffled into your library this way'); // Cloud std-fin
const W_HEADS = P('the number of coins that came up heads'); // std-rx30
const W_COIN_HEADS = P('coin that comes up heads'); // std-rx30: after "for each"
const W_FLIP_WON = P('flip you won'); // p2-coinflip-2: after "for each"
const W_FLIP_WIN = P('flip you win'); // p2-coinflip-3: after "for each"
const W_WHICHEVER =[P('whichever is greater'), P('whichever is less')]; // FAST5X E15: "2 or the greatest power among ..., whichever is greater"
const W_MOST =[P('greatest'), P('highest'), P('least')]; // FAST5X E15: "the greatest power among ..."
const W_THE = P('the');
const W_GREATEST_NUMBER_OF = P('greatest number of'); // r5-cost
const W_TYPE_IN_COMMON = [P('that have a creature type in common'), P('that share a creature type')]; // r5-cost
const W_OF = P('of');
const W_DEVOTION = P('devotion to');
const W_COUNTER = [P('counter'), P('counters')];
const W_COUNTERS = P('counters');
const W_THE_RESULT = P('the result');
const W_DIFFERENTLY_NAMED = P('differently named'); // std-mkm (and std-sos, the same reading)
const W_YOUR_SPEED = P('your speed');
const W_LIFE_GAINED = [P('the amount of life you gained this turn'), P("the amount of life you've gained this turn")];
const W_LIFE_LOST = [P('the amount of life you lost this turn'), P("the amount of life you've lost this turn")]; // Cloud std-woe

type Stat = 'power' | 'toughness' | 'manaValue' | 'loyalty' | 'defense';
const STAT_WORDS: [string[], Stat][] = [[P('power'), 'power'], [P('toughness'), 'toughness'], [P('mana value'), 'manaValue'], [P('loyalty'), 'loyalty'], [P('defense'), 'defense']];

function statAt(ctx: HoleCtx, pos: number): { end: number; stat: Stat }[] {
  const out: { end: number; stat: Stat }[] = [];
  for (const [ws, stat] of STAT_WORDS) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, stat });
  }
  return out;
}

const each = (filter: ObjectFilter): { ref: 'each'; filter: ObjectFilter } => ({ ref: 'each', filter });

/** "cards in your hand" as a count of a zone (model `zoneSize`) when the filter says nothing else; otherwise the count of the matching objects. */
function countOf(filter: ObjectFilter): Quantity {
  const keys = Object.keys(filter).filter((k) => (filter as Record<string, unknown>)[k] !== undefined);
  const zone = filter.zone;
  const owner = filter.owner;
  if (keys.every((k) => k === 'isCard' || k === 'zone' || k === 'owner') && typeof zone === 'string' && zone !== 'any' && zone !== 'battlefield' && zone !== 'stack'
    && owner !== undefined && owner !== 'any' && owner !== 'opponent') {
    const who: PlayerRef = owner === 'you' ? { ref: 'you' } : owner;
    return { q: 'zoneSize', zone: zone as ZoneName, of: who };
  }
  return { q: 'count', of: each(filter) };
}

function colorList(ctx: HoleCtx, pos: number): { end: number; colors: Color[] }[] {
  const out: { end: number; colors: Color[] }[] = [];
  const walk = (p: number, acc: Color[]): void => {
    const w = ctx.toks[p]?.kind === 'WORD' ? ctx.toks[p]!.norm : undefined;
    const c = w === undefined ? undefined : ctx.vocab.colors.get(w);
    if (c === undefined || acc.includes(c)) return;
    const next = [...acc, c];
    out.push({ end: p + 1, colors: next });
    if (ctx.toks[p + 1]?.norm === 'and' || ctx.toks[p + 1]?.norm === ',') walk(p + 2, next);
  };
  walk(pos, []);
  return out;
}

/** Atoms of the quantity grammar (everything but `plus`/`minus` chains). */
const W_THE_CHOSEN_NUMBER = P('the chosen number'); // CLOUD std-misc

function atoms(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const t = ctx.toks[pos];
  if (t === undefined) return out;

  // numbers, number words, "a"/"an", X
  const n = numberAt(ctx, pos, true);
  if (n !== undefined) out.push({ end: pos + 1, value: n });
  if (t.kind === 'X') out.push({ end: pos + 1, value: { q: 'X' } });

  // FAST5 T62 (CR 603.4, 608.2h): "the difference" between the number an intervening "if" compares ("if you have fewer than four cards in hand") and the amount
  // counted: a marker the quantities pass binds to the trigger's condition (lower/quantities.ts), or leaves the sentence manual
  const diff = phraseAt(ctx, pos, W_THE_DIFFERENCE);
  if (diff >= 0) out.push({ end: diff, value: anaphorQty({ sort: 'number', number: 'singular', text: 'the difference' }) });
  out.push(...differenceBetween(ctx, pos));

  // std-rx29 (CR 208.1, 107.1b, 608.2h; Spry and Mighty): "the difference between the chosen creatures' powers": the greatest power of the group an earlier choice of
  // the ability chose less its least (of two objects the one less the other, never below 0; of one object or none, 0). Only the participle "chosen" and a plural
  // possessive head ("creatures'"), as Oracle prints it; the anaphora pass binds both halves to that choice or leaves the sentence manual
  const db = phraseAt(ctx, pos, W_DIFFERENCE_BETWEEN_CHOSEN);
  const owner = db >= 0 ? ctx.toks[db]?.norm : undefined;
  const head = owner !== undefined && /^[a-z]+s'$/.test(owner) && DIFFERENCE_HEADS.has(owner.slice(0, -2)) ? owner.slice(0, -2) : undefined;
  if (head !== undefined) {
    for (const [ws, stat] of PLURAL_STAT_WORDS) {
      const e = phraseAt(ctx, db + 1, ws);
      if (e < 0) continue;
      const group = (): ObjRef => anaphorObj({ sort: 'object', number: 'plural', head, participle: 'chosen', text: `the chosen ${head}s` }) as ObjRef;
      out.push({ end: e, value: { q: 'math', op: '-', args: [{ q: 'stat', stat, of: group(), agg: 'max' }, { q: 'stat', stat, of: group(), agg: 'min' }] } });
    }
  }

  // CLOUD std-misc (CR 608.2c-d): "the chosen number": the number an earlier "Choose a number ..." of the same ability chose (parser/lower/links.ts replaces the
  // placeholder link; with no such choice it survives and the sentence is manual)
  const cn = phraseAt(ctx, pos, W_THE_CHOSEN_NUMBER);
  if (cn >= 0) out.push({ end: cn, value: { q: 'chosenNumber', link: '$link' } });

  // that many / that much
  const tm = anyPhraseAt(ctx, pos, W_THAT_MANY);
  if (tm >= 0) out.push({ end: tm, value: anaphorQty({ sort: 'number', number: 'singular', text: ctx.toks[pos + 1]!.norm === 'much' ? 'that much' : 'that many' }) });
  // r5-fxb (CR 120.3, 603.2): "deals that amount of damage to ...": "that much" before the word "damage" only (Fear of Burning Alive)
  const ta = phraseAt(ctx, pos, W_THAT_AMOUNT_OF);
  if (ta >= 0 && ctx.toks[ta]?.norm === 'damage') out.push({ end: ta, value: anaphorQty({ sort: 'number', number: 'singular', text: 'that much' }) });

  // FAST5X E15 (CR 121.2, 608.2c): "the number of cards drawn this way": what an earlier draw step of the ability drew (its result count, which a replaced
  // draw is not part of, CR 614.11); the quantities pass binds it to the one draw step before it, or leaves the sentence manual
  const drawn = phraseAt(ctx, pos, W_DRAWN_THIS_WAY);
  if (drawn >= 0) out.push({ end: drawn, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'drawn', text: 'the number of cards drawn this way' }) });
  // r4-moved (CR 701.6a, 608.2c): "for each spell and ability countered this way": what an earlier counter step of the ability countered, spells and abilities (its
  // result count); the quantities pass binds it to the one counter step before it, or leaves the sentence manual
  const countered = phraseAt(ctx, pos, W_COUNTERED_THIS_WAY);
  if (countered >= 0) out.push({ end: countered, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'countered', text: 'spell and ability countered this way' }) });
  // Cloud std-fin (CR 701.24a, 608.2c): "the number of cards shuffled into your library this way": what the move into your library right before it moved (its result count);
  // the quantities pass binds it to such a move, or leaves the sentence manual
  const shuffled = phraseAt(ctx, pos, W_SHUFFLED_THIS_WAY);
  if (shuffled >= 0) out.push({ end: shuffled, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'shuffled', text: 'the number of cards shuffled into your library this way' }) });
  // std-rx30 (CR 705.1, 608.2c): "the number of coins that came up heads": what an earlier flip of several coins of the ability came up (its result count, the coins that
  // came up heads when nobody calls them, r4-mech); the quantities pass binds it to the one flip step before it, or leaves the sentence manual
  const heads = phraseAt(ctx, pos, W_HEADS);
  if (heads >= 0) out.push({ end: heads, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'flipped', text: 'the number of coins that came up heads' }) });
  // ... and "for each coin that comes up heads" (Ral Zarek), the same count said per coin (only right after the words "for each" in front of this hole)
  const coin = ctx.toks[pos - 1]?.norm === 'each' && ctx.toks[pos - 2]?.norm === 'for' ? phraseAt(ctx, pos, W_COIN_HEADS) : -1;
  if (coin >= 0) out.push({ end: coin, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'flipped', text: 'coin that comes up heads' }) });
  // p2-coinflip-2 (CR 705.2, 608.2c): "for each flip you won" (Crazed Firecat), the flips an earlier "flip a coin until you lose a flip" of the ability won (its result count);
  // the quantities pass binds it to such a flip only (lower/quantities.ts: participle `flippedWon`), or leaves the sentence manual
  const flipWon = ctx.toks[pos - 1]?.norm === 'each' && ctx.toks[pos - 2]?.norm === 'for' ? phraseAt(ctx, pos, W_FLIP_WON) : -1;
  if (flipWon >= 0) out.push({ end: flipWon, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'flippedWon', text: 'flip you won' }) });
  // p2-coinflip-3 (CR 705.2): "for each flip you win" (Goblin Traprunner), the flips won of an earlier flip of several coins, which the quantities pass then has called
  const flipWin = ctx.toks[pos - 1]?.norm === 'each' && ctx.toks[pos - 2]?.norm === 'for' ? phraseAt(ctx, pos, W_FLIP_WIN) : -1;
  if (flipWin >= 0) out.push({ end: flipWin, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'flippedWin', text: 'flip you win' }) });

  // twice Q
  if (phraseAt(ctx, pos, W_TWICE) >= 0) for (const a of atoms(ctx, pos + 1)) out.push({ end: a.end, value: { q: 'math', op: '*', args: [2, a.value as Quantity] }, ...(a.weak ? { weak: a.weak } : {}) });

  // half Q, rounded up|down  (CR 107.1a: rounding is always stated)
  if (phraseAt(ctx, pos, W_HALF) >= 0) {
    for (const a of atoms(ctx, pos + 1)) {
      const up = phraseAt(ctx, a.end, W_ROUNDED_UP) >= 0 ? phraseAt(ctx, a.end, W_ROUNDED_UP) : phraseAt(ctx, a.end + 1, W_ROUNDED_UP);
      const down = phraseAt(ctx, a.end, W_ROUNDED_DOWN) >= 0 ? phraseAt(ctx, a.end, W_ROUNDED_DOWN) : phraseAt(ctx, a.end + 1, W_ROUNDED_DOWN);
      const comma = ctx.toks[a.end]?.norm === ',';
      if (up >= 0 && (comma || up === a.end + 2)) out.push({ end: up, value: { q: 'math', op: 'ceilDiv', args: [a.value as Quantity, 2] } });
      if (down >= 0 && (comma || down === a.end + 2)) out.push({ end: down, value: { q: 'math', op: 'floorDiv', args: [a.value as Quantity, 2] } });
    }
  }

  // the number of <Filter>  /  for each <Filter>
  const nOf = phraseAt(ctx, pos, W_NUMBER_OF);
  if (nOf >= 0) {
    for (const f of ctx.call('Filter', nOf)) out.push({ end: f.end, value: countOf(f.value as ObjectFilter), ...(f.weak ? { weak: f.weak } : {}), ...(f.flags ? { flags: f.flags } : {}) });
    out.push(...historyCounts(ctx, nOf));
    out.push(...enteredCounts(ctx, nOf));
    out.push(...distinctCounts(ctx, nOf));
    out.push(...counterCounts(ctx, nOf));
    // std-mkm (CR 201.2, 111.4): "the number of differently named creature tokens you control" (Audience with Trostani): the different names among the set (a
    // token's name is its subtypes plus "Token" when the effect gives none). std-sos read the same words the same way in distinctCounts ("the number of
    // differently named lands you control", Emil, Vastlands Roamer), and so did cloud std-eoe (differentlyNamedCounts); merge lines CD and wave 3 keep this one reading
    const dn = phraseAt(ctx, nOf, W_DIFFERENTLY_NAMED);
    if (dn >= 0) for (const f of ctx.call('Filter', dn)) out.push({ end: f.end, value: { q: 'distinct', what: 'names', among: each(f.value as ObjectFilter) }, ...(f.flags ? { flags: f.flags } : {}) });
    // Standard round 6 (CR 305.6, 205.3i): domain, "the number of basic land types among lands you control" (Fblthp, Knows the Way): for each of the five basic land
    // types, one if a land of the set has it (FAST3 T12's sum, render/qty.ts#domainOf); only a description of lands with no subtype of its own. Weak (design 6.3
    // rule 2): a template that spells the words out (sta.t12.cda.pt.domain, "for each basic land type among ...") keeps the sentence
    const bl = phraseAt(ctx, nOf, W_BASIC_LAND_TYPES_AMONG);
    if (bl >= 0) for (const f of ctx.call('Filter', bl)) if (landsOnly(f.value as ObjectFilter)) out.push({ end: f.end, value: domain(f.value as ObjectFilter), weak: (f.weak ?? 0) + 1, ...(f.flags ? { flags: f.flags } : {}) });
  }
  // std-costs-1 (CR 601.2c, 601.2f, 202.3; Urgent Necropsy): "the total mana value of the permanents ~ targets": the spell's own targets that are permanents, added
  // up (`spellTargetTotal`; model/lint-nodes.ts allows it only in an additional cost of the spell, which actions/cast.ts reads once the targets are chosen)
  const tt = phraseAt(ctx, pos, W_TOTAL_MV_OF_TARGETS);
  if (tt >= 0) out.push({ end: tt, value: { q: 'spellTargetTotal', stat: 'manaValue' } });
  const total = phraseAt(ctx, pos, W_TOTAL_NUMBER_OF);
  if (total >= 0) for (const f of ctx.call('Filter', total)) out.push({ end: f.end, value: countOf(f.value as ObjectFilter), ...(f.weak ? { weak: f.weak } : {}), ...(f.flags ? { flags: f.flags } : {}) });
  // cloud std-dsk (CR 709.5c, 709.5j): "the number of unlocked doors among Rooms you control" (only a description of Rooms and who controls them)
  const ud = phraseAt(ctx, pos, W_UNLOCKED_DOORS_AMONG);
  if (ud >= 0) for (const f of ctx.call('Filter', ud)) if (isRoomsOnly(f.value as ObjectFilter)) out.push({ end: f.end, value: { q: 'unlockedDoors', among: each(f.value as ObjectFilter) }, ...(f.flags ? { flags: f.flags } : {}) });
  if (nOf >= 0) out.push(...opponentCounts(ctx, nOf, true));
  out.push(...partySizeAt(ctx, pos, nOf));
  // p2-typechange-2 (CR 305.6, 205.3i): domain after "for each" (in this hole or written by a template in front of it), "for each basic land type among lands you
  // control" (Might of Alara): the same sum as "the number of basic land types among lands you control" above; weak like it
  const feb = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' ? pos : phraseAt(ctx, pos, W_FOR_EACH);
  const bt = feb >= 0 ? phraseAt(ctx, feb, W_BASIC_LAND_TYPE_AMONG) : -1;
  if (bt >= 0) for (const f of ctx.call('Filter', bt)) if (landsOnly(f.value as ObjectFilter)) out.push({ end: f.end, value: domain(f.value as ObjectFilter), weak: (f.weak ?? 0) + 1, ...(f.flags ? { flags: f.flags } : {}) });
  const fe = phraseAt(ctx, pos, W_FOR_EACH);
  if (fe >= 0) out.push(...opponentCounts(ctx, fe, false));
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') out.push(...opponentCounts(ctx, pos, false)); // std-rk: "draw a card for each {n:Qty}"
  if (fe >= 0) for (const f of ctx.call('Filter', fe)) out.push({ end: f.end, value: { ...(countOf(f.value as ObjectFilter) as object), $forEach: true }, ...(f.flags ? { flags: f.flags } : {}) });
  if (fe >= 0) out.push(...enteredCounts(ctx, fe));
  // std-ry10 (CR 700.4, 603.10a): "for each creature that died this turn" (Canopy Stalker), also where a template wrote "for each" before the hole: the turn's
  // history count that "the number of creatures that died this turn" reads (historyCounts). Weak (design 6.3 rule 2): the fixed "draw a card for each <f> that
  // died this turn" templates keep their sentences
  const feDied = fe >= 0 ? fe : ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' ? pos : -1;
  if (feDied >= 0) {
    for (const f of ctx.call('Filter', feDied)) {
      const e = phraseAt(ctx, f.end, W_THAT_DIED_THIS_TURN);
      if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: f.value as ObjectFilter, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }, weak: (f.weak ?? 0) + 1, ...(f.flags ? { flags: f.flags } : {}) });
    }
  }
  // std-rx14 (CR 603.6a, 400.7; Geralf, the Fleshwright): the same history count where a template wrote "for each" before the hole ("put a +1/+1 counter on it for each
  // {n:Qty}", as std-rk's opponent counts above). Not "each other ...": other than which object is the template's to say (eff.stdrx14.counter.forEachOtherEnteredThisTurn)
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' && ctx.toks[pos]?.norm !== 'other') {
    // only the entered reading: "that left the battlefield ..." after "for each" has std-lci's own template (eff.stdlci.counters.put.forEachLeftUnderYourControl)
    out.push(...enteredCounts(ctx, pos).filter((a) => (a.value as { event?: { to?: string } }).event?.to === 'battlefield'));
  }
  // r4-fxz (CR 701.9a, 608.2h): "for each card you've discarded this turn" (FAST5 T61's count, render/qty.ts#happened): the cards you discarded this turn
  // (wave 7 merge: r4-trig read the same words after "for each" to the same JSON; this one reading is kept, r4-trig's copy removed)
  // r4-fxz (CR 202.3, 608.2h): "for each different mana value among nonland permanents you control": the number of different mana values among them (a token's
  // 0 is one of them)
  const dmv = phraseAt(ctx, pos, P('different mana value among'));
  if (dmv >= 0) for (const f of ctx.call('Filter', dmv)) out.push({ end: f.end, value: { q: 'distinct', what: 'manaValues', among: each(f.value as ObjectFilter) }, ...(f.flags ? { flags: f.flags } : {}) });
  // r4-fxz (CR 404.1, 608.2h): "for each graveyard with seven or more cards in it": the players whose graveyard holds that many cards (each player has one;
  // std-hob's countPlayers sizeIs, render/qty.ts)
  const gw = phraseAt(ctx, pos, P('graveyard with'));
  const gn = gw >= 0 ? numberAt(ctx, gw) : undefined;
  const gm = gn !== undefined ? phraseAt(ctx, gw + 1, P('or more cards in it')) : -1;
  if (gn !== undefined && gm >= 0) out.push({ end: gm, value: { q: 'countPlayers', of: { ref: 'each', who: 'player' }, sizeIs: { zone: 'graveyard', op: '>=', n: gn } } as Quantity });
  const discarded = phraseAt(ctx, pos, W_CARD_DISCARDED);
  if (discarded >= 0) out.push({ end: discarded, value: DISCARDED_THIS_TURN() });

  // statistics of objects
  out.push(...objectStats(ctx, pos));

  // life totals
  out.push(...lifeTotals(ctx, pos));

  // devotion
  const yd = phraseAt(ctx, pos, P('your'));
  if (yd >= 0) {
    const dv = phraseAt(ctx, yd, W_DEVOTION);
    if (dv >= 0) for (const c of colorList(ctx, dv)) out.push({ end: c.end, value: { q: 'devotion', to: c.colors, of: { ref: 'you' } } });
  }
  if (phraseAt(ctx, pos, W_THE_RESULT) >= 0) out.push({ end: pos + 2, value: { q: 'dieResult' } });
  if (phraseAt(ctx, pos, W_YOUR_SPEED) >= 0) out.push({ end: pos + 2, value: { q: 'speed' } });
  // FAST4 T26: "the amount of life you gained this turn" (CR 119.3: the life the controller gained this turn; read as the step runs, CR 608.2h)
  for (const ws of W_LIFE_GAINED) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { q: 'lifeGainedThisTurn' } }); }
  // Cloud std-woe (CR 119.3, 120.3a): "the amount of life you lost this turn", every loss of the controller this turn, damage included (read as the step runs, CR 608.2h)
  for (const ws of W_LIFE_LOST) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { q: 'lifeLostThisTurn', of: { ref: 'you' } } }); }
  // std-rx29 (CR 120.1, 120.3, 400.7, 603.10a; Tangled Colony): "the amount of damage dealt to it this turn": this turn's damage to one object, added up (`happenedCount`
  // with `sum`), read from the history, so also for an object that has just left the battlefield (either id of the object, rules/history.ts#factsMatchFilter). The
  // object is any Obj reading; the history answers only the source itself or a fixed object (rules/history.ts#unanswerable: anything else needs the engine)
  const ddTo = phraseAt(ctx, pos, W_DAMAGE_DEALT_TO);
  if (ddTo >= 0) {
    for (const o of ctx.call('Obj', ddTo)) {
      const e = phraseAt(ctx, o.end, W_THIS_TURN);
      if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'damage', recipient: { object: { is: o.value as ObjRef } } }, scope: 'turn', sum: 'amount' }, ...(o.flags ? { flags: o.flags } : {}) });
    }
  }
  // FAST4 T34 (CR 601.2h; converge): "the number of colors of mana spent to cast ~" (the spell itself, `colorsSpent`)
  const cs = phraseAt(ctx, pos, W_COLORS_SPENT);
  if (cs >= 0 && ctx.toks[cs]?.kind === 'SELF') out.push({ end: cs + 1, value: { q: 'colorsSpent' } });
  // FAST5 T42 (CR 601.2h; Astelli Reclaimer): "the amount of mana spent to cast ~" (the spell itself, `manaSpent`)
  const ms = phraseAt(ctx, pos, W_MANA_SPENT);
  if (ms >= 0 && ctx.toks[ms]?.kind === 'SELF') out.push({ end: ms + 1, value: { q: 'manaSpent' } });
  // FAST5 T51 (CR 601.2h): "the amount of mana spent to cast it" (the object itself: it enters with that many counters, the pronoun is checked by the template)
  // and "the number of colors of mana spent to cast that spell" / "each color of mana spent to cast that spell" (the spell of a cast trigger, `spellColorsSpent`;
  // the marker `$spell` makes the sentence manual anywhere else, parser/lower/anaphora.ts#castSpellMarker)
  const thatSpell = (): Alt['value'] => anaphorObj({ sort: 'object', number: 'singular', head: 'spell', text: 'that spell' });
  const msThat = ms >= 0 ? phraseAt(ctx, ms, W_THAT_SPELL) : -1; // "the amount of mana spent to cast that spell": E19's `of` names it (the anaphor must resolve to the cast event's spell)
  if (msThat >= 0) out.push({ end: msThat, value: { q: 'spellManaSpent', of: thatSpell() } });
  // Standard round 3, r3-trig (CR 700.2, 601.2b): "the number of times you chose a mode for that spell" (the spell of a cast trigger: the marker `$spell` makes it manual
  // anywhere else, as for spellColorsSpent; lower/ability.ts#triggered resolves it in a modal header)
  const mc = phraseAt(ctx, pos, W_MODES_CHOSEN);
  const mcThat = mc >= 0 ? phraseAt(ctx, mc, W_THAT_SPELL) : -1;
  if (mcThat >= 0) out.push({ end: mcThat, value: { q: 'modesChosen', $spell: thatSpell() } });
  const csThat = cs >= 0 ? phraseAt(ctx, cs, W_THAT_SPELL) : -1;
  if (csThat >= 0) out.push({ end: csThat, value: { q: 'spellColorsSpent', $spell: thatSpell() } });
  // r4-repl (CR 601.2h): "... where X is the number of colors of mana spent to cast it" after "that creature" (Wildgrowth Archaic): the same spell of the cast trigger,
  // named by a pronoun (the marker `$spell` checks it, as for "that spell")
  if (cs >= 0 && ctx.toks[cs]?.norm === 'it') out.push({ end: cs + 1, value: { q: 'spellColorsSpent', $spell: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) } });
  const ec = phraseAt(ctx, pos, W_EACH_COLOR_SPENT);
  const ecThat = ec >= 0 ? phraseAt(ctx, ec, W_THAT_SPELL) : -1;
  if (ecThat >= 0) out.push({ end: ecThat, value: { q: 'spellColorsSpent', $spell: thatSpell() } });
  // FAST5X E16 (CR 120.4a, 608.2c): "the excess damage dealt [to that creature] this way", "that excess damage"
  out.push(...excessQtyAt(ctx, pos));
  // M12-3 (CR 119.3, 608.2c): "the life lost this way": the life the loseLife instruction RIGHT BEFORE made its players lose, summed (`$step` is resolved by
  // parser/lower/conditions.ts#resolveLifeLost, as excess damage's is)
  const ll = phraseAt(ctx, pos, W_LIFE_LOST_THIS_WAY);
  if (ll >= 0) out.push({ end: ll, value: { q: 'lifeLost', step: '', $step: 'previous' } as never });
  out.push(...voteQtyAt(ctx, pos)); // M12-3 (CR 701.38a-b): "the number of money votes"
  // Standard round 4, r4-trig: ... and right after the words "for each" in front of this hole ("put a +1/+1 counter on that creature for each card you've discarded this turn")
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const d = phraseAt(ctx, pos, P("card you've discarded this turn"));
    if (d >= 0) out.push({ end: d, value: { q: 'happenedCount', event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' } });
    // std-rm (CR 121.1, 601.2i): "for each card you've drawn this turn", "for each spell you've cast this turn" (the history counts of "the number of ..." above, said
    // with the singular noun), and "for each spell you've cast this turn from anywhere other than your hand" (Surge of Brilliance: the cast history's `notFrom`)
    const drawn = phraseAt(ctx, pos, P("card you've drawn this turn"));
    if (drawn >= 0) out.push({ end: drawn, value: { q: 'cardsDrawnThisTurn' } });
    const cast = phraseAt(ctx, pos, P("spell you've cast this turn"));
    if (cast >= 0) {
      out.push({ end: cast, value: { q: 'spellsCastThisTurn' } });
      const nh = phraseAt(ctx, cast, P('from anywhere other than your hand'));
      if (nh >= 0) out.push({ end: nh, value: { q: 'happenedCount', event: { ev: 'cast', player: 'you', notFrom: 'hand' }, scope: 'turn' } });
    }
    // std-rm (CR 122.1): "for each experience counter you have" (the singular noun; the number of them, as "the number of experience counters you have")
    for (const k of ctx.call('CounterKind', pos)) {
      const c = phraseAt(ctx, k.end, P('counter'));
      if (c >= 0) out.push(...playerHasCounters(ctx, c, k.value as string, k.weak));
    }
  }
  out.push(...destroyedThisWay(ctx, pos)); // std-tdm (CR 701.8a, 608.2c): "for each permanent destroyed this way", "the number of creatures destroyed this way"
  out.push(...milledThisWayCount(ctx, pos)); // std-rx35 (CR 701.17a, 608.2c): "for each creature card milled this way"
  // std-rx20 (CR 120.3, 608.2c): "the damage dealt this way": the damage the damage instruction RIGHT BEFORE dealt (`$step` is resolved by
  // parser/lower/conditions.ts#resolveDamageDealt, as the life lost this way is)
  const dd = phraseAt(ctx, pos, W_DAMAGE_DEALT_THIS_WAY);
  if (dd >= 0) out.push({ end: dd, value: { q: 'damageDealt', step: '', $step: 'previous' } as never });
  out.push(...countersRemovedAt(ctx, pos)); // std-rx14 (CR 122.1, 608.2c): "for each lore counter removed this way", "the number of counters removed this way"
  out.push(...commanderQtyAt(ctx, pos)); // CMD2 (CR 903.3d): "the greatest mana value of a commander you own on the battlefield or in the command zone"
  out.push(...p2cst1QtyAt(ctx, pos)); // p2-cost-statics-1 (CR 601.2i, 508.1): "for each spell your opponents have cast this turn", "for each creature you attacked with this turn"

  return out;
}

const W_THAT_DIED_THIS_TURN = P('that died this turn'); // std-ry10
const W_CREATURES_IN_YOUR_PARTY = P('creatures in your party'); // std-ry10
const W_CREATURE_IN_YOUR_PARTY = P('creature in your party'); // std-ry10

/**
 * std-ry10 (CR 700.8): the size of your party, "the number of creatures in your party" and "for each creature in your party" (also with the words "for each"
 * written by a template in front of this hole): up to one each of Cleric, Rogue, Warrior and Wizard among the creatures you control (FAST5 T38's `partySize`,
 * statics/party.ts; render/qty.ts already says it so). Only "your" party. Weak (design 6.3 rule 2): T38's fixed "costs {N} less to cast for each creature in your
 * party" keeps its sentence.
 */
function partySizeAt(ctx: HoleCtx, pos: number, nOf: number): Alt[] {
  const value: Quantity = { q: 'partySize', of: { ref: 'you' } };
  const ends: number[] = [];
  if (nOf >= 0) ends.push(phraseAt(ctx, nOf, W_CREATURES_IN_YOUR_PARTY));
  const fe = phraseAt(ctx, pos, W_FOR_EACH);
  if (fe >= 0) ends.push(phraseAt(ctx, fe, W_CREATURE_IN_YOUR_PARTY));
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') ends.push(phraseAt(ctx, pos, W_CREATURE_IN_YOUR_PARTY));
  return ends.filter((e) => e >= 0).map((end) => ({ end, value, weak: 1 }));
}

const W_OPPONENTS_YOU_HAVE = P('opponents you have');
const W_OPPONENT_YOU_HAVE = P('opponent you have'); // std-rx20
const W_WHO_CONTROL = [P('opponents who control'), P('opponent who controls')];
const W_MORE_FEWER: [string[], '>' | '<'][] = [[P('more'), '>'], [P('fewer'), '<']];
const W_THAN_YOU = P('than you');

/**
 * std-rk (CR 102.3, 608.2h): counted opponents of the controller. After "the number of": "the number of opponents you have" (every opponent; render/qty.ts already
 * says a count of each opponent so). After "the number of" (plural) or "for each" (singular): "the number of opponents who control more lands than you", "for each
 * opponent who controls fewer creatures than you": the opponents who control more (fewer) permanents of the description than you do, each opponent judged alone
 * (`countPlayers.controlsVs`, the count the condition "an opponent controls more lands than you" compares with 1, parser/holes/cond.ts). Only a description of
 * permanents that says nothing of their controller, zone or card-ness (the comparison supplies the controller).
 */
function opponentCounts(ctx: HoleCtx, pos: number, plural: boolean): Alt[] {
  const out: Alt[] = [];
  const opponents: PlayerRef = { ref: 'each', who: 'opponent' };
  if (plural) {
    const h = phraseAt(ctx, pos, W_OPPONENTS_YOU_HAVE);
    // weak (design 6.3 rule 2): FAST3 T17's fixed template "create a number of <tokens> equal to the number of opponents you have" keeps its sentence
    if (h >= 0) out.push({ end: h, value: { q: 'countPlayers', of: opponents }, weak: 1 });
  } else {
    // std-rx20 (CR 102.3, 608.2h): after "for each": "for each opponent you have" (every opponent of the controller), as "the number of opponents you have"
    const h = phraseAt(ctx, pos, W_OPPONENT_YOU_HAVE);
    if (h >= 0) out.push({ end: h, value: { q: 'countPlayers', of: opponents } });
  }
  const w = phraseAt(ctx, pos, W_WHO_CONTROL[plural ? 0 : 1]!);
  if (w < 0) return out;
  // std-rx12 (CR 102.3, 108.4): "the number of opponents who control an artifact", "for each opponent who controls a creature": the opponents who control one or more
  // permanents of a description said with one article (`countPlayers.controlsIs`), each opponent judged alone; the same description limits as the comparison below
  const art = ctx.toks[w]?.norm;
  if (art === 'a' || art === 'an') {
    for (const n of npAlts(ctx, w + 1)) {
      const f = n.filter;
      if (n.number !== 'singular' || f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.isCard !== undefined || f.stackKind !== undefined) continue;
      out.push({ end: n.end, value: { q: 'countPlayers', of: opponents, controlsIs: { filter: f, op: '>=', n: 1 } }, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  for (const [ws, op] of W_MORE_FEWER) {
    const m = phraseAt(ctx, w, ws);
    if (m < 0) continue;
    for (const n of npAlts(ctx, m)) {
      const f = n.filter;
      if (n.number !== 'plural' || f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.isCard !== undefined || f.stackKind !== undefined) continue;
      const than = phraseAt(ctx, n.end, W_THAN_YOU);
      if (than < 0) continue;
      out.push({ end: than, value: { q: 'countPlayers', of: opponents, controlsVs: { filter: f, op, than: { ref: 'you' } } }, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  return out;
}

/**
 * std-rl (CR 903.3, 903.3d): "the greatest mana value among your commanders" (Tangleweave Armor) reads every commander you own wherever it is, in the command
 * zone too (the designation stays with the card in every zone); a bare "your commanders" elsewhere is the permanents (parser/holes/filter.ts#yourCommanderAt).
 */
function commandersAnywhere(f: ObjectFilter): ObjectFilter {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return keys.length === 2 && f.commander === true && f.owner === 'you' ? { ...f, zone: 'any' } : f;
}

const W_DESTROYED_THIS_WAY = P('destroyed this way');
/** std-tdm: the permanent nouns a "destroyed this way" count is said with, singular for the plural form (CR 110.1, 205.2a: permanents and their card types). */
const DESTROYED_NOUNS: Readonly<Record<string, string>> = {
  permanents: 'permanent', creatures: 'creature', artifacts: 'artifact', enchantments: 'enchantment', lands: 'land', planeswalkers: 'planeswalker', battles: 'battle',
};
const DESTROYED_SINGULAR: ReadonlySet<string> = new Set(Object.values(DESTROYED_NOUNS));

/**
 * std-tdm (CR 701.8a, 608.2c): what an earlier destroy step of the ability destroyed, its result count (a destroyed permanent that was indestructible or regenerated
 * is not destroyed, CR 702.12b, 701.19a): "Draw a card for each permanent destroyed this way" (the singular noun, only right after the words "for each" in front
 * of this hole) and "the number of creatures destroyed this way". A number anaphor with the participle `destroyed` and the noun as its head: the quantities pass
 * binds it to the one destroy step before it, and only when that noun names everything the step can destroy ("permanent", or the one card type of a step that
 * destroys every object of that type; parser/lower/quantities.ts), or leaves the sentence manual.
 */
function destroyedThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const word = (i: number): string | undefined => (ctx.toks[i]?.kind === 'WORD' ? ctx.toks[i]!.norm : undefined);
  const one = word(pos);
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' && one !== undefined && DESTROYED_SINGULAR.has(one)) {
    const e = phraseAt(ctx, pos + 1, W_DESTROYED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'destroyed', head: one, text: `${one} destroyed this way` }) });
  }
  const n = phraseAt(ctx, pos, W_NUMBER_OF);
  const many = n >= 0 ? word(n) : undefined;
  const head = many !== undefined && Object.hasOwn(DESTROYED_NOUNS, many) ? DESTROYED_NOUNS[many] : undefined;
  if (head !== undefined) {
    const e = phraseAt(ctx, n + 1, W_DESTROYED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'destroyed', head, text: `the number of ${many} destroyed this way` }) });
  }
  return out;
}
const W_MILLED_THIS_WAY = P('milled this way');

/**
 * std-rx35 (CR 701.17a, 608.2c): "You gain 1 life for each creature card milled this way" (Gorging Vulture), "For each creature card milled this way, create ...": the
 * number of the cards a mill step of an earlier sentence of the ability put into a graveyard that are of that description, counted where they are (the `milled`
 * group anaphor with `zone: 'any'`, as std-tla's "a land card was milled this way" reads it, parser/holes/cond.ts#milledThisWayCond). Only right after the words
 * "for each" in front of this hole, one singular description of a card with no controller, owner or zone, and only after a mill (the discourse model says an
 * earlier sentence milled).
 */
function milledThisWayCount(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.discourse?.milled !== true || ctx.toks[pos - 2]?.norm !== 'for' || ctx.toks[pos - 1]?.norm !== 'each') return [];
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated')) continue;
    if (n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined || n.filter.is !== undefined) continue;
    const e = phraseAt(ctx, n.end, W_MILLED_THIS_WAY);
    if (e < 0) continue;
    const group = anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'milled', text: 'milled this way' });
    out.push({ end: e, value: { q: 'count', of: { ref: 'each', filter: { ...n.filter, is: group, zone: 'any' } } } as unknown as Quantity });
  }
  return out;
}
const W_LIFE_LOST_THIS_WAY = P('the life lost this way');
const W_DAMAGE_DEALT_THIS_WAY = P('the damage dealt this way'); // std-rx20
const W_COUNTER_REMOVED_THIS_WAY = P('counter removed this way');
const W_COUNTERS_REMOVED_THIS_WAY = P('counters removed this way');

/**
 * std-rx14 (CR 122.1, 608.2c; Garnet, Princess of Alexandria): the counters the removeCounters instruction RIGHT BEFORE actually removed, summed over the objects
 * (`{q:'countersRemoved', $step}`, resolved by parser/lower/conditions.ts#resolveCountersRemoved as "the life lost this way" is): "for each lore counter removed this
 * way" right after "for each" in front of this hole (singular), "the number of [lore] counters removed this way" (plural). With a kind, only counters of that kind.
 */
function countersRemovedAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const at = (p: number, words: string[]): void => {
    const bare = phraseAt(ctx, p, words);
    if (bare >= 0) out.push({ end: bare, value: { q: 'countersRemoved', step: '', $step: 'previous' } as never });
    for (const k of ctx.call('CounterKind', p)) {
      const e = phraseAt(ctx, k.end, words);
      if (e >= 0) out.push({ end: e, value: { q: 'countersRemoved', step: '', $step: 'previous', kind: k.value } as never });
    }
  };
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') at(pos, W_COUNTER_REMOVED_THIS_WAY);
  const nOf = phraseAt(ctx, pos, W_NUMBER_OF);
  if (nOf >= 0) at(nOf, W_COUNTERS_REMOVED_THIS_WAY);
  return out;
}
const W_COLORS_SPENT = P('the number of colors of mana spent to cast');
const W_MANA_SPENT = P('the amount of mana spent to cast');
const W_EACH_COLOR_SPENT = P('each color of mana spent to cast');
const W_THAT_SPELL = P('that spell');
const W_MODES_CHOSEN = P('the number of times you chose a mode for'); // Standard round 3, r3-trig

/** "the number of spells you've cast this turn", "the number of creatures that died this turn", ... (history quantities of the model). */
function historyCounts(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const spells = phraseAt(ctx, pos, P("spells you've cast this turn"));
  if (spells >= 0) out.push({ end: spells, value: { q: 'spellsCastThisTurn' } });
  // STD-OTJ (CR 601.2i, 608.2h): "the number of other spells you've cast this turn": the spells you cast this turn that are not the ability's own source (the
  // spell that is resolving was itself cast this turn; a copy of it was not cast, so nothing is skipped for a copy)
  const others = phraseAt(ctx, pos, P("other spells you've cast this turn"));
  if (others >= 0) out.push({ end: others, value: { q: 'happenedCount', event: { ev: 'cast', player: 'you', spell: { not: { self: true } } }, scope: 'turn', by: 'you' } });
  // r4-fxz: "the number of cards you've discarded this turn" (as "for each card you've discarded this turn" above)
  const disc = phraseAt(ctx, pos, P("cards you've discarded this turn"));
  if (disc >= 0) out.push({ end: disc, value: DISCARDED_THIS_TURN() });
  const cards = phraseAt(ctx, pos, P("cards you've drawn this turn"));
  if (cards >= 0) out.push({ end: cards, value: { q: 'cardsDrawnThisTurn' } });
  // p2-damage-2 (CR 121.1, 608.2h): "the number of cards they've drawn this turn" (Cerebral Vortex): the draws of the turn of a player named before ("they", the
  // Player hole's pronoun), one history entry per card drawn (triggers/history.ts)
  const theirs = phraseAt(ctx, pos, P("cards they've drawn this turn"));
  if (theirs >= 0) out.push({ end: theirs, value: { q: 'happenedCount', event: { ev: 'draw', player: anaphorObj({ sort: 'any', number: 'plural', text: 'they' }) as PlayerRef }, scope: 'turn' } });
  const life = phraseAt(ctx, pos, P("life you've gained this turn"));
  if (life >= 0) out.push({ end: life, value: { q: 'lifeGainedThisTurn' } });
  // FAST5X E22 (CR 700.11): "the number of times you descended this turn" = the permanent cards put into your graveyard from anywhere this turn
  const desc = phraseAt(ctx, pos, P('times you descended this turn'));
  if (desc >= 0) out.push({ end: desc, value: { q: 'descendedThisTurn' } });
  for (const f of ctx.call('Filter', pos)) {
    const e = phraseAt(ctx, f.end, P('that died this turn'));
    if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: f.value as ObjectFilter, from: 'battlefield', to: 'graveyard' }, scope: 'turn' } });
    // r5-moved (CR 700.4, 603.10a): "the number of artifacts that were put into graveyards from the battlefield this turn" (Anzrag's Rampage): the same zone changes of the
    // turn's history, said of permanents that do not "die" (only a permanent kind: no card, spell, zone, controller or owner of its own)
    const filter = f.value as ObjectFilter;
    // std-rc (CR 700.4, 603.10a, 406.1): "the number of creatures that died under your control this turn", "... that were exiled under your opponents' control this
    // turn" (Vren, the Relentless): the turn's zone changes from the battlefield, the controller judged as the permanent last existed there (as "left the battlefield
    // under your control", enteredCounts). Only a permanent kind (no card, spell, zone, controller or owner of its own); weak (design 6.3 rule 2), so the fixed
    // "for each <f> that died under your control this turn" templates of r4-static and r4-repl keep their sentences
    if (filter.isCard === undefined && filter.stackKind === undefined && filter.zone === undefined && filter.controller === undefined && filter.owner === undefined) {
      for (const [ws, to] of [[W_DIED_UNDER, 'graveyard'], [W_EXILED_UNDER, 'exile']] as const) {
        const u = phraseAt(ctx, f.end, ws);
        if (u < 0) continue;
        for (const [who, controller] of [[W_YOUR_CONTROL_THIS_TURN, 'you'], [W_OPPONENTS_CONTROL_THIS_TURN, 'opponent']] as const) {
          const e = anyPhraseAt(ctx, u, who);
          if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { ...filter, controller }, from: 'battlefield', to }, scope: 'turn' }, weak: 1 });
        }
      }
    }
    const pg = phraseAt(ctx, f.end, W_PUT_INTO_GRAVEYARDS_FROM_BATTLEFIELD_THIS_TURN);
    if (pg >= 0 && filter.isCard === undefined && filter.stackKind === undefined && filter.zone === undefined && filter.controller === undefined && filter.owner === undefined) {
      out.push({ end: pg, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: filter, from: 'battlefield', to: 'graveyard' }, scope: 'turn' } });
    }
    // std-r7 (CR 701.21a, 608.2h): "the number of permanents you've sacrificed this turn", "... Foods you've sacrificed this turn" (Obsessive Pursuit): your
    // sacrifices of the turn (one action entry per permanent, rules/history.ts; FAST5 T63's condition reads the same events). The description is judged as the
    // permanent last existed on the battlefield; plain "permanents" describes nothing more. Only a permanent kind (no card, spell, zone, controller or owner)
    const sac = anyPhraseAt(ctx, f.end, W_YOU_SACRIFICED_THIS_TURN);
    if (sac >= 0 && filter.isCard === undefined && filter.stackKind === undefined && filter.zone === undefined && filter.controller === undefined && filter.owner === undefined) {
      const object = isPermanentOnly(filter) ? {} : { object: filter };
      out.push({ end: sac, value: { q: 'happenedCount', event: { ev: 'action', verb: 'sacrifice', actor: 'you', ...object }, scope: 'turn' }, ...(f.flags ? { flags: f.flags } : {}) });
    }
  }
  return out;
}

const W_YOU_SACRIFICED_THIS_TURN = [P("you've sacrificed this turn"), P('you sacrificed this turn')]; // std-r7
const W_DIED_UNDER = P('that died under'); // std-rc
const W_EXILED_UNDER = P('that were exiled under'); // std-rc
const W_YOUR_CONTROL_THIS_TURN = [P('your control this turn')]; // std-rc
const W_OPPONENTS_CONTROL_THIS_TURN = [P("your opponents' control this turn"), P("an opponent 's control this turn")]; // std-rc
/** std-r7: "permanents" with nothing else said (every permanent qualifies). */
const isPermanentOnly = (f: ObjectFilter): boolean => Object.entries(f).every(([k, v]) => v === undefined || (k === 'types' && Array.isArray(v) && v.length === 1 && v[0] === 'Permanent'));

const W_PUT_INTO_GRAVEYARDS_FROM_BATTLEFIELD_THIS_TURN = P('that were put into graveyards from the battlefield this turn'); // r5-moved
const W_ENTERED_UNDER_YOUR_CONTROL = P('that entered the battlefield under your control this turn');
/** std-lci (CR 603.10a, 700.4): "for each creature that left the battlefield under your control this turn" and without the controller. */
const W_LEFT_UNDER_YOUR_CONTROL = P('that left the battlefield under your control this turn');
const W_LEFT_THIS_TURN = P('that left the battlefield this turn');

/**
 * FAST5 T65 (CR 603.6a, 603.4): "for each land that entered the battlefield under your control this turn", "the number of creatures that entered the battlefield
 * under your control this turn": the zone changes of the turn's history (`happenedCount` of a `zoneChange` to the battlefield by an object you control as it
 * entered; the same events as the condition of parser/holes/cond.ts#zoneHistory). Only a permanent kind (no card, spell, zone or controller of its own).
 */
function enteredCounts(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const f of ctx.call('Filter', pos)) {
    const filter = f.value as ObjectFilter;
    if (filter.isCard !== undefined || filter.stackKind !== undefined || filter.zone !== undefined || filter.controller !== undefined || filter.owner !== undefined) continue;
    const extra = { ...(f.weak ? { weak: f.weak } : {}), ...(f.flags ? { flags: f.flags } : {}) };
    const e = phraseAt(ctx, f.end, W_ENTERED_UNDER_YOUR_CONTROL);
    if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { ...filter, controller: 'you' }, to: 'battlefield' }, scope: 'turn' }, ...extra });
    // std-lci (CR 603.10a, 700.4): the objects that left the battlefield this turn (to any zone), under your control as they last existed there, or anyone's
    const l = phraseAt(ctx, f.end, W_LEFT_UNDER_YOUR_CONTROL);
    if (l >= 0) out.push({ end: l, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { ...filter, controller: 'you' }, from: 'battlefield' }, scope: 'turn' }, ...extra });
    const a = phraseAt(ctx, f.end, W_LEFT_THIS_TURN);
    if (a >= 0) out.push({ end: a, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: filter, from: 'battlefield' }, scope: 'turn' }, ...extra });
  }
  return out;
}

/** "the number of colors among ...", "... creature types among ...". */
function distinctCounts(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // CLOUD std-misc (CR 208.1): "the number of different powers among creatures you control"
  const kinds: [string[], 'colors' | 'cardTypes' | 'creatureTypes' | 'landTypes' | 'powers' | 'planeswalkerTypes'][] = [[P('colors'), 'colors'], [P('card types'), 'cardTypes'], [P('creature types'), 'creatureTypes'], [P('land types'), 'landTypes'], [P('different powers'), 'powers'],
    [P('planeswalker types'), 'planeswalkerTypes'] /* r5-fxb (CR 205.3j) */];
  for (const [ws, what] of kinds) {
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    const a = phraseAt(ctx, e, W_AMONG);
    if (a < 0) continue;
    for (const f of ctx.call('Filter', a)) out.push({ end: f.end, value: { q: 'distinct', what, among: each(f.value as ObjectFilter) } });
    // std-craft-1 (CR 702.167c, 105.1; Sunbird Effigy): "the number of colors among the exiled cards used to craft it", the set the craft cost exiled (holes/object.ts)
    if (what === 'colors') for (const o of ctx.call('Obj', a)) {
      const v = o.value as { ref?: string; link?: string };
      if (v.ref === 'linked' && v.link === 'craft') out.push({ end: o.end, value: { q: 'distinct', what, among: o.value as never } });
    }
  }
  // r4-mech (CR 105.1, 105.2a): "the number of different color pairs among permanents you control that are exactly two colors": the words "that are exactly two
  // colors" belong to the count (an object of any other number of colors adds no pair), never to the description
  const cp = phraseAt(ctx, pos, W_COLOR_PAIRS_AMONG);
  if (cp >= 0) for (const f of ctx.call('Filter', cp)) {
    const e = phraseAt(ctx, f.end, W_EXACTLY_TWO_COLORS);
    if (e >= 0) out.push({ end: e, value: { q: 'distinct', what: 'colorPairs', among: each(f.value as ObjectFilter) } });
  }
  return out;
}
const W_COLOR_PAIRS_AMONG = P('different color pairs among');
const W_EXACTLY_TWO_COLORS = P('that are exactly two colors');

/** "the number of +1/+1 counters on ~", "... counters on target creature". */
function counterCounts(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const on = (e: number, kind: string): void => {
    const o = phraseAt(ctx, e, P('on'));
    if (o < 0) return;
    for (const r of ctx.call('Obj', o)) out.push({ end: r.end, value: { q: 'counters', on: r.value as never, kind }, ...(r.flags ? { flags: r.flags } : {}) });
    // r4-fxb (CR 122.1, 208.1): "the number of +1/+1 counters on lands you control" (Toph, the Blind Bandit): the counters on every object of a group, added up
    // (effects/eval.ts and statics/match.ts sum them); only a described group of permanents
    for (const r of ctx.call('Objs', o)) {
      const v = r.value as { ref?: string; filter?: { zone?: string } };
      if (v.ref === 'each' && v.filter !== undefined && (v.filter.zone === undefined || v.filter.zone === 'battlefield')) out.push({ end: r.end, value: { q: 'counters', on: r.value as never, kind }, ...(r.flags ? { flags: r.flags } : {}) });
    }
    for (const r of ctx.call('Player', o)) out.push({ end: r.end, value: { q: 'counters', on: r.value as never, kind } });
  };
  for (const k of ctx.call('CounterKind', pos)) {
    const c = anyPhraseAt(ctx, k.end, W_COUNTER);
    if (c < 0) continue;
    on(c, k.value as string);
    out.push(...playerHasCounters(ctx, c, k.value as string, k.weak));
  }
  const c = anyPhraseAt(ctx, pos, W_COUNTER);
  if (c >= 0) on(c, 'any');
  return out;
}

const W_DIFFERENCE_BETWEEN = P('the difference between'); // std-rx16
const W_AND = P('and');

/** std-rx16: the larger of two quantities minus the smaller, never below zero (`max(a, b) - min(a, b)`; render/qty.ts#differenceBetweenOf reads it back). */
export const differenceBetweenQty = (a: Quantity, b: Quantity): Quantity => ({ q: 'math', op: '-', args: [{ q: 'math', op: 'max', args: [a, b] }, { q: 'math', op: 'min', args: [a, b] }] });

/**
 * std-rx16 (CR 208.1, 202.3, 107.1): "the difference between its power and toughness" (Doran, Besieged by Time), "the difference between that creature's power and
 * its toughness", "the difference between that spell's mana value and that card's mana value": the larger of two statistics of single objects minus the smaller (a
 * difference is never negative). Only statistics of one object each ("its power", "~'s toughness", "the power of that creature"); "<object>'s power and toughness"
 * names both statistics of the one object.
 */
function differenceBetween(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const db = phraseAt(ctx, pos, W_DIFFERENCE_BETWEEN);
  if (db < 0) return out;
  const single = (v: unknown): v is Extract<Quantity, { q: 'stat' }> => {
    const s = v as { q?: string; sum?: boolean; agg?: string; of?: { ref?: string } };
    return s.q === 'stat' && s.sum !== true && s.agg === undefined && s.of?.ref !== 'each';
  };
  for (const a of objectStats(ctx, db)) {
    if (!single(a.value)) continue;
    const and = phraseAt(ctx, a.end, W_AND);
    if (and < 0) continue;
    const flags = a.flags ? { flags: a.flags } : {};
    // "<object>'s power and toughness": the second statistic of the same object
    for (const s of statAt(ctx, and)) if (s.stat !== a.value.stat) out.push({ end: s.end, value: differenceBetweenQty(a.value, { ...a.value, stat: s.stat }), ...flags });
    for (const b of objectStats(ctx, and)) if (single(b.value)) out.push({ end: b.end, value: differenceBetweenQty(a.value, b.value), ...flags, ...(b.flags ? { flags: [...(a.flags ?? []), ...b.flags] } : {}) });
  }
  return out;
}

const W_HAS_OR_HAVE = [P('has'), P('have')];

/**
 * std-rm (CR 122.1, 122.1f): the counters of a named kind a player has, "the number of experience counters you have", "for each poison counter they have" (the
 * words after the counter noun, `pos`; effects/eval.ts and statics/match.ts read the player's counters, poison from its own total). Only a named kind: "the
 * number of counters you have" names none. A kind the lexicon does not list stays weak (misc.ts#counterKind).
 */
function playerHasCounters(ctx: HoleCtx, pos: number, kind: string, weak: number | undefined): Alt[] {
  const out: Alt[] = [];
  for (const r of ctx.call('Player', pos)) {
    const h = anyPhraseAt(ctx, r.end, W_HAS_OR_HAVE);
    if (h >= 0) out.push({ end: h, value: { q: 'counters', on: r.value as never, kind }, ...(weak ? { weak } : {}) });
  }
  return out;
}

/** "its power", "~'s toughness", "target creature's mana value", "the power of that creature", "the greatest power among ...", "the total power of ...". */
function objectStats(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const t = ctx.toks[pos]?.norm;
  if (t === 'its') for (const s of statAt(ctx, pos + 1)) out.push({ end: s.end, value: { q: 'stat', stat: s.stat, of: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) } });
  // FAST4 T28 (CR 122.8): "put its +1/+1 counters on target creature you control": "its" counts the counters of the kind that follows (which stays in the
  // sentence for the template: "{n:Qty} {k:CounterKind} counters"); only a named kind, never "its counters" (every kind, which one count cannot say)
  if (t === 'its') {
    for (const k of ctx.call('CounterKind', pos + 1)) {
      if (phraseAt(ctx, k.end, W_COUNTERS) >= 0) out.push({ end: pos + 1, value: { q: 'counters', on: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }), kind: k.value as string } });
    }
  }
  for (const o of ctx.call('Obj', pos)) {
    if (ctx.toks[o.end]?.norm === "'s") for (const s of statAt(ctx, o.end + 1)) out.push({ end: s.end, value: { q: 'stat', stat: s.stat, of: o.value as never }, ...(o.flags ? { flags: o.flags } : {}) });
  }
  // std-rx29 (CR 208.1, 608.2h, 701.21a; Kylox, Visionary Inventor): "their total power": the total of a group the sentence names by a pronoun ("sacrifice any number of
  // other creatures, then ..., where X is their total power": the sacrificed creatures, read as they last existed); the anaphora pass binds it or the sentence is manual
  if (t === 'their' && ctx.toks[pos + 1]?.norm === 'total') {
    for (const s of statAt(ctx, pos + 2)) out.push({ end: s.end, value: { q: 'stat', stat: s.stat, of: anaphorObj({ sort: 'object', number: 'plural', text: 'their' }), sum: true } });
  }
  const the = phraseAt(ctx, pos, W_THE);
  if (the >= 0) {
    for (const s of statAt(ctx, the)) {
      const of = phraseAt(ctx, s.end, W_OF);
      if (of >= 0) for (const o of ctx.call('Obj', of)) out.push({ end: o.end, value: { q: 'stat', stat: s.stat, of: o.value as never } });
    }
    // FAST5X E15 (MX18; CR 208.1, 202.3): "the greatest / highest / least <stat> among <filter>", the `agg` of the model's `stat` quantity over the set
    const most = anyPhraseAt(ctx, the, W_MOST);
    if (most >= 0) {
      const agg = ctx.toks[the]?.norm === 'least' ? 'min' : 'max';
      for (const s of statAt(ctx, most)) {
        const among = phraseAt(ctx, s.end, W_AMONG);
        if (among >= 0) for (const f of ctx.call('Filter', among)) out.push({ end: f.end, value: { q: 'stat', stat: s.stat, of: each(commandersAnywhere(f.value as ObjectFilter)), agg } });
      }
    }
    // r5-cost (CR 205.3m): "the greatest number of creatures you control that have a creature type in common"
    const gn = phraseAt(ctx, the, W_GREATEST_NUMBER_OF);
    if (gn >= 0) {
      for (const f of ctx.call('Filter', gn)) {
        const e = anyPhraseAt(ctx, f.end, W_TYPE_IN_COMMON);
        if (e >= 0) out.push({ end: e, value: { q: 'mostSharingCreatureType', among: each(f.value as ObjectFilter) } });
      }
    }
    if (ctx.toks[the]?.norm === 'total') {
      for (const s of statAt(ctx, the + 1)) {
        const of = phraseAt(ctx, s.end, W_OF);
        if (of >= 0) for (const f of ctx.call('Filter', of)) out.push({ end: f.end, value: { q: 'stat', stat: s.stat, of: each(f.value as ObjectFilter), sum: true } });
        // r5-fxb (CR 208.1, 603.10a, 608.2h): "the total power of those creatures": a group the sentence refers to (the creatures a batch trigger saw die, read as
        // they last existed); a described group is the Filter reading above
        if (of >= 0) for (const o of ctx.call('Objs', of)) if ((o.value as { ref?: string }).ref !== 'each') out.push({ end: o.end, value: { q: 'stat', stat: s.stat, of: o.value as never, sum: true }, ...(o.flags ? { flags: o.flags } : {}) });
      }
    }
  }
  return out;
}

function lifeTotals(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const p of possessivePlayerAt(ctx, pos)) {
    if (p.ref.ref === 'each') continue; // the evaluator reads the life total of ONE player; "each opponent's life total" is not a number
    const e = phraseAt(ctx, p.end, W_LIFE_TOTAL);
    if (e >= 0) out.push({ end: e, value: { q: 'life', of: p.ref } });
  }
  // p2-group-actions-1 (CR 119.1): "the highest / greatest / lowest life total among all players / your opponents": over a set of players, the `agg` of their life totals
  for (const [ws, agg] of W_LIFE_TOTAL_AMONG) {
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    for (const [pw, of] of W_AMONG_PLAYERS) { const f = phraseAt(ctx, e, pw); if (f >= 0) out.push({ end: f, value: { q: 'life', of, agg } }); }
  }
  // FAST5 T60 (CR 103.4): "your starting life total"
  const sl = phraseAt(ctx, pos, W_STARTING_LIFE_TOTAL);
  if (sl >= 0) out.push({ end: sl, value: { q: 'startingLife' } });
  return out;
}

const mathOp = (op: '+' | '-', a: Quantity, b: Quantity): Quantity => ({ q: 'math', op, args: [a, b] });

export const qty: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const extend = (a: Alt, depth: number): void => {
    out.push(a);
    if (depth > 4) return;
    const t = ctx.toks[a.end]?.norm;
    if (t !== 'plus' && t !== 'minus') return;
    for (const b of atoms(ctx, a.end + 1)) {
      extend({ end: b.end, value: mathOp(t === 'plus' ? '+' : '-', a.value as Quantity, b.value as Quantity), weak: (a.weak ?? 0) + (b.weak ?? 0), ...(a.flags || b.flags ? { flags: [...(a.flags ?? []), ...(b.flags ?? [])] } : {}) }, depth + 1);
    }
  };
  for (const a of atoms(ctx, pos)) extend(a, 0);
  // FAST5X E15: "N or Q, whichever is greater" (the greater of the two numbers; "whichever is less", the lesser). Only a plain number first, as Oracle prints it.
  for (const a of atoms(ctx, pos)) {
    if (typeof a.value !== 'number' || ctx.toks[a.end]?.norm !== 'or') continue;
    for (const b of atoms(ctx, a.end + 1)) {
      if (ctx.toks[b.end]?.norm !== ',') continue;
      const e = anyPhraseAt(ctx, b.end + 1, W_WHICHEVER);
      if (e < 0) continue;
      const op = ctx.toks[e - 1]?.norm === 'greater' ? 'max' : 'min';
      out.push({ end: e, value: { q: 'math', op, args: [a.value, b.value as Quantity] }, ...(b.weak ? { weak: b.weak } : {}), ...(b.flags ? { flags: b.flags } : {}) });
    }
  }
  return dedupe(out);
};

const W_ANY_NUMBER = P('any number of');

/** A count of things: a number, `X`, a computed quantity, or "any number of" (unbounded). */
export const count: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const an = phraseAt(ctx, pos, W_ANY_NUMBER);
  if (an >= 0) out.push({ end: an, value: 'any' });
  for (const q of ctx.call('Qty', pos)) out.push(q);
  return dedupe(out);
};

/** Standard round 6: a description of lands (`types: ['Land']`) with nothing but who controls them ("lands you control"). */
function landsOnly(f: ObjectFilter): boolean {
  return Object.entries(f).every(([k, v]) => v === undefined || k === 'controller' || (k === 'types' && Array.isArray(v) && v.length === 1 && v[0] === 'Land'))
    && Array.isArray(f.types);
}

/** Standard round 6 (CR 305.6): domain over the lands of `f`, the sum of `min(1, count)` of those lands with each basic land type (FAST3 T12's JSON). */
function domain(f: ObjectFilter): Quantity {
  return { q: 'math', op: '+', args: BASIC_LAND_TYPES.map((t) => ({ q: 'math', op: 'min', args: [1, { q: 'count', of: { ref: 'each', filter: { ...f, subtypes: [t] } } }] }) as Quantity) };
}
