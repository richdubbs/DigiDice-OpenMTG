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
import { P, cmpAt, anaphorObj, anaphorQty, anyPhraseAt, dedupe, numberAt, phraseAt } from './core';
import { possessivePlayerAt } from './player';
import { excessQtyAt } from './excess';
import { voteQtyAt } from './vote';
import { isRoomsOnly } from '../../model/room-filter';
import { commanderQtyAt } from './commander-qty';
import { edhpm8QtyAt } from './edhpm8';
import { p2cst1QtyAt } from './p2cst1';
import { pcc1QtyAt } from './pccounters1';
import { edhp9QtyAt } from './edhp9';
import { pcc3QtyAt } from './pccounters3';
import { edhn8QtyAt } from './edhn8';
import { edhn24QtyAt } from './edhn24';
import { edhn31QtyAt } from './edhn31';
import { edhn38QtyAt } from './edhn38';
import { edhn95QtyAt } from './edhn95';
import { edhn110QtyAt } from './edhn110';
import { edhd70QtyAt } from './edhd70';
import { edhd88QtyAt } from './edhd88'; // edh-d-88
import { edhn58QtyAt } from './edhn58';
import { edhn94QtyAt } from './edhn94';
import { edhd75QtyAt } from './edhd75';
import { npAlts } from './filter';
import { revealedThisWayCount } from './edhz18';
import { revealedDrawnCount, revealedGreatestMv } from './trek17';
import { MOVED_MARK } from './moved-words';

const W_NUMBER_OF = P('the number of');
const W_CARDS_EXILED_WITH_SELF = [P('cards exiled with ~'), P('cards exiled with it')]; // edh-perms-11
const W_EXILED_WITH_SELF_OR_IT = [P('exiled with ~'), P('exiled with it')]; // edhn102
/** r3-choose (CR 115.1): "the total number of creatures those players control": one count over the permanents of several players (render/qty.ts says "total" only then). */
const W_TOTAL_NUMBER_OF = P('the total number of');
const W_TOTAL_MV_OF_TARGETS = P('the total mana value of the permanents ~ targets'); // std-costs-1
const W_FOR_EACH = P('for each');
const W_CARD_DISCARDED = P("card you've discarded this turn"); // r4-fxz
const DISCARDED_THIS_TURN = (): Quantity => ({ q: 'happenedCount', event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' });
const W_UNLOCKED_DOORS_AMONG = P('the number of unlocked doors among'); // cloud std-dsk
const W_PLAYERS_BEING_ATTACKED = P('players being attacked'); // edh-c-6
const W_PLAYER_BEING_ATTACKED = P('player being attacked'); // edh-next-42
const W_BASIC_LAND_TYPES_AMONG = P('basic land types among'); // Standard round 6
const W_BASIC_LAND_TYPE_AMONG = P('basic land type among'); // p2-typechange-2
const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
const W_TWICE = P('twice');
const W_HALF = P('half');
// FAST4 T30: the words of the `plus` / `minus` chains (read by token below) are words of the grammar too (guard G2: "3 minus the number of cards in their hand")
P('plus'); P('minus');
const W_ROUNDED_UP = P('rounded up');
const W_ROUNDED_DOWN = P('rounded down');
const W_BASE_POWER_Q = P('base power'); // edh-next-133
const W_THAT_MANY = [P('that many'), P('that much')];
const W_THAT_AMOUNT_OF = P('that amount of'); // r5-fxb
const W_THAT_NUMBER_OF = P('that number of'); // edh-next-84 (Yuna, Grand Summoner)
const W_THE_DIFFERENCE = P('the difference'); // FAST5 T62
const W_DAMAGE_DEALT_TO = P('the amount of damage dealt to'); // std-rx29
const isOpponents = (v: unknown): boolean => typeof v === 'object' && v !== null && (v as PlayerRef).ref === 'each' && (v as { who?: unknown }).who === 'opponent' && Object.keys(v).length === 2; // edh-players-16
const W_DAMAGE_DEALT_TO_PLAIN = P('the damage dealt to'); // edh-players-16
const W_DAMAGE_ALREADY_DEALT_TO = P('the damage already dealt to'); // edh-c-51 (Final Punishment)
const W_THIS_TURN = P('this turn'); // std-rx29
const W_DIFFERENCE_BETWEEN_CHOSEN = P('the difference between the chosen'); // std-rx29
const DIFFERENCE_HEADS = new Set(['creature', 'permanent', 'artifact', 'card']); // std-rx29: "the chosen creatures'", ...
P("creatures'"); P("permanents'"); P("artifacts'"); P("cards'"); // std-rx29: the plural possessive heads above are words of the grammar (guard G2)
const PLURAL_STAT_WORDS: [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('powers'), 'power'], [P('toughnesses'), 'toughness'], [P('mana values'), 'manaValue']]; // std-rx29
const W_LIFE_TOTAL = P("life total");
const W_STARTING_LIFE_TOTAL = P("your starting life total"); // FAST5 T60
const W_LIFE_TOTAL_AMONG: [string[], 'min' | 'max'][] = [[P('the highest life total among'), 'max'], [P('the greatest life total among'), 'max'], [P('the lowest life total among'), 'min']]; // p2-group-actions-1
const W_AMONG_PLAYERS: [string[], PlayerRef][] = [[P('all players'), { ref: 'each', who: 'player' }], [P('players'), { ref: 'each', who: 'player' }], [P('your opponents'), { ref: 'each', who: 'opponent' }]]; // p2-group-actions-1; 'among players' edh-next-14
const W_AMONG = P('among');
const W_MOST_CARDS_IN_HAND = P('the number of cards in the hand of the opponent with the most cards in hand'); // edh-c-59 (CR 402.1; Adamaro, First to Desire)
const W_DRAWN_THIS_WAY = P('the number of cards drawn this way'); // FAST5X E15
const W_CARD_DRAWN_THIS_WAY = P('card drawn this way'); // edh-perms-20
const W_CARD_REVEALED_THIS_WAY = P('card revealed this way'); // edh-mana-keywords-12
const W_CARDS_REVEALED_THIS_WAY = P('the number of cards revealed this way'); // edh-c-43
const W_COUNTERED_THIS_WAY = P('spell and ability countered this way'); // r4-moved
const W_SHUFFLED_THIS_WAY = P('the number of cards shuffled into your library this way'); // Cloud std-fin
const W_MANA_PAID_THIS_WAY = P('the total amount of mana paid this way'); // edh-top-6
const W_HEADS = P('the number of coins that came up heads'); // std-rx30
const W_COIN_HEADS = P('coin that comes up heads'); // std-rx30: after "for each"
const W_FLIP_WON = P('flip you won'); // p2-coinflip-2: after "for each"
const W_FLIP_WIN = P('flip you win'); // p2-coinflip-3: after "for each"
const W_WHICHEVER =[P('whichever is greater'), P('whichever is less')]; // FAST5X E15: "2 or the greatest power among ..., whichever is greater"
const W_POWER_AND_OR_TOUGHNESS = P('power and/or toughness'); // edh-c-5
const W_AMONG_THEM = P('among them'); // edh-next-99
const W_MOST =[P('greatest'), P('highest'), P('least')]; // FAST5X E15: "the greatest power among ..."
const W_THE = P('the');
const W_GREATEST_NUMBER_OF = P('greatest number of'); // r5-cost
const W_YOU_CONTROLLED_AS_YOU_CAST = P('you controlled as you cast'); // edh-next-126
const W_A_PLAYER_CONTROLS = P('a player controls'); // edh-next-21
const W_TYPE_IN_COMMON = [P('that have a creature type in common'), P('that share a creature type')]; // r5-cost
const W_OF = P('of');
const W_THEY_EXILED = P('they exiled'); // edh-players-21
const W_THIS_WAY_Q = P('this way'); // edh-next-127
const OWN_EXILED = 'ownExiled'; // edh-players-21: the name eff.edhp21.exile.ownPerPlayer.* gives the creatures its players exiled
const THEY_EXILED_NOUNS: ReadonlySet<string> = new Set(['creature', 'permanent', 'artifact', 'enchantment', 'land']); // edh-players-21
const W_DEVOTION = P('devotion to');
const W_COUNTER = [P('counter'), P('counters')];
const W_COUNTERS = P('counters');
const W_THE_RESULT = P('the result');
const W_THAT_RESULT = P('that result'); // edh-mana-keywords-10
const W_THE_OTHER_RESULT = P('the other result');
const W_DIFFERENTLY_NAMED = P('differently named'); // std-mkm (and std-sos, the same reading)
const W_YOUR_SPEED = P('your speed');
const W_UNSPENT_MANA_YOU_HAVE = P('the amount of unspent mana you have'); // edh-next-42 (CR 106.4; Glissa Sunseeker)
const W_LIFE_GAINED = [P('the amount of life you gained this turn'), P("the amount of life you've gained this turn")];
const W_LIFE_LOST = [P('the amount of life you lost this turn'), P("the amount of life you've lost this turn"), P('the life you lost this turn'), P("the life you've lost this turn") /* edh-players-10 */]; // Cloud std-woe
/** edh-players-10 (CR 119.3, 120.3a; Astarion, the Decadent): the life a player named before lost this turn, "the amount of life they lost this turn" / "the life that player lost this turn". */
const W_LIFE_LOST_THEY: [string[], PlayerRefMaker][] = [
  [P('the amount of life they lost this turn'), () => anaphorObj({ sort: 'any', number: 'plural', text: 'they' })],
  [P('the life they lost this turn'), () => anaphorObj({ sort: 'any', number: 'plural', text: 'they' })],
  [P('the amount of life that player lost this turn'), () => anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' })],
  [P('the life that player lost this turn'), () => anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' })],
  [P('the amount of life that opponent lost this turn'), () => anaphorObj({ sort: 'player', number: 'singular', head: 'opponent', text: 'that opponent' })],
  [P('the life that opponent lost this turn'), () => anaphorObj({ sort: 'player', number: 'singular', head: 'opponent', text: 'that opponent' })],
];
type PlayerRefMaker = () => Alt['value'];
const W_LIFE_LOST_OPPONENTS = [P('the amount of life your opponents lost this turn'), P('the amount of life your opponents have lost this turn'), P('the total amount of life your opponents lost this turn') /* edh-zones-11 (Florian) */, P('the total life lost by your opponents this turn') /* edh-c-12 (Cryptborn Horror) */, P('the total amount of life your opponents have lost this turn') /* edh-next-141 (Abaddon the Despoiler) */]; // edh-cast-3
const W_LIFE_LOST_ALL = [P('the total life lost by all players this turn'), P('the total amount of life lost by all players this turn')]; // edh-b-5 (CR 119.3; Tainted Sigil)
const W_ONE_LIFE_YOU_GAINED = P('1 life you gained this turn'); // edh-next-9 (CR 119.3, 601.2f; Licia, Sanguine Tribune): after "for each"
const W_ONE_LIFE_OPPONENTS = P('1 life your opponents have lost this turn'); // edh-cast-3: after "for each"
const W_ONE_LIFE_YOU_GAINED_THAT = P('1 life you gained'); // edh-d-3 (CR 119.3, 603.2; Cradle of Vitality): the gain that triggered the ability, after "for each"
/** edh-cast-3 (CR 120.1, 120.3, 601.2f; Chandra's Incinerator): "the total amount of noncombat damage dealt to your opponents this turn", with the kind of damage it counts. */
const W_DAMAGE_TO_OPPONENTS: [string[], boolean | undefined][] = [
  [P('the total amount of noncombat damage dealt to your opponents this turn'), false],
  [P('the total amount of combat damage dealt to your opponents this turn'), true],
  [P('the total amount of damage dealt to your opponents this turn'), undefined],
];

const W_TOTAL_MV_OTHER_SPELLS = P("the total mana value of other spells you've cast this turn"); // edh-cast-12

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
const W_LAST_NOTED_LIFE = P('the last noted life total for ~'); // edh-next-144
const W_ALL_HANDS = [P("the total number of cards in all players' hands"), P("the number of cards in all players' hands")]; // edh-b-6

function atoms(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const t = ctx.toks[pos];
  if (t === undefined) return out;

  // edh-b-6 (CR 402.1, 608.2h; Realm Seekers): every card in every hand, "the total number of cards in all players' hands" (render/qty.ts, FAST4 T29's count)
  const ah = anyPhraseAt(ctx, pos, W_ALL_HANDS);
  if (ah >= 0) out.push({ end: ah, value: { q: 'count', of: each({ zone: 'hand' }) } });

  // numbers, number words, "a"/"an", X
  const n = numberAt(ctx, pos, true);
  if (n !== undefined) out.push({ end: pos + 1, value: n });
  if (t.kind === 'X') out.push({ end: pos + 1, value: { q: 'X' } });

  // FAST5 T62 (CR 603.4, 608.2h): "the difference" between the number an intervening "if" compares ("if you have fewer than four cards in hand") and the amount
  // counted: a marker the quantities pass binds to the trigger's condition (lower/quantities.ts), or leaves the sentence manual
  const diff = phraseAt(ctx, pos, W_THE_DIFFERENCE);
  if (diff >= 0) out.push({ end: diff, value: anaphorQty({ sort: 'number', number: 'singular', text: 'the difference' }) });
  out.push(...differenceBetween(ctx, pos));
  // edh-b-9 (CR 119.1, 608.2c; Profane Transfusion): "the difference between those players' life totals": the greatest life total of the group an earlier instruction named less
  // its least (of two players the one less the other, never below 0; the anaphora pass binds the group or leaves the sentence manual)
  const dtp = phraseAt(ctx, pos, W_DIFFERENCE_THOSE_PLAYERS_LIFE);
  if (dtp >= 0) {
    const of = anaphorObj({ sort: 'player', number: 'plural', head: 'player', text: 'those players' }) as unknown as PlayerRef;
    out.push({ end: dtp, value: { q: 'math', op: '-', args: [{ q: 'life', of, agg: 'max' }, { q: 'life', of, agg: 'min' }] } });
  }

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
  // edh-next-138 (CR 614.12a, 607.2d, 119.4; Phyrexian Processor): "the life paid as ~ entered": the amount "As ~ enters, pay any amount of life." paid, kept by the object under the link
  // `lifePaid` (effects/bodies/m5.ts; parser/parse.ts#linkChosen checks that another ability of the face makes it)
  const lp = phraseAt(ctx, pos, W_LIFE_PAID_AS_ENTERED);
  if (lp >= 0) out.push({ end: lp, value: { q: 'chosenNumber', link: 'lifePaid' } });
  // edh-next-144 (CR 119.1, 607.2d; Sigarda's Splendor): "the last noted life total for ~": the life total a "note your life total" of the same object kept last (the link notedLife;
  // with no such note on the face the link has no producer and the card stays manual, parser/parse.ts)
  const nl = phraseAt(ctx, pos, W_LAST_NOTED_LIFE);
  if (nl >= 0) out.push({ end: nl, value: { q: 'chosenNumber', link: 'notedLife' } });

  // that many / that much
  const tm = anyPhraseAt(ctx, pos, W_THAT_MANY);
  if (tm >= 0) out.push({ end: tm, value: anaphorQty({ sort: 'number', number: 'singular', text: ctx.toks[pos + 1]!.norm === 'much' ? 'that much' : 'that many' }) });
  // edh-next-84 (CR 608.2h, 122.1; Yuna, Grand Summoner): "put that number of +1/+1 counters": "that number of" before a noun says what "that many" says (the same anaphor); the renderer
  // offers the wording only where counters are put (render/steps-life.ts#countersText), so any other use fails the render gate and stays manual
  const tn = phraseAt(ctx, pos, W_THAT_NUMBER_OF);
  if (tn >= 0) out.push({ end: tn, value: anaphorQty({ sort: 'number', number: 'singular', text: 'that many' }) });
  // edh-c-1 (CR 119.3, 603.2; Hurska Sweet-Tooth): "the amount of life you gained" (not "... this turn", which is the turn's total above): the life of the gain that triggered the ability, "that much"
  const lg = phraseAt(ctx, pos, P('the amount of life you gained'));
  if (lg >= 0 && ctx.toks[lg]?.norm !== 'this') out.push({ end: lg, value: anaphorQty({ sort: 'number', number: 'singular', text: 'that much' }) });
  // r5-fxb (CR 120.3, 603.2): "deals that amount of damage to ...": "that much" before the word "damage" only (Fear of Burning Alive)
  const ta = phraseAt(ctx, pos, W_THAT_AMOUNT_OF);
  if (ta >= 0 && ctx.toks[ta]?.norm === 'damage') out.push({ end: ta, value: anaphorQty({ sort: 'number', number: 'singular', text: 'that much' }) });

  // edh-replace-2 (CR 120.2, 603.2c, 510.2; Quartzwood Crasher): "the amount of damage those creatures dealt to that player" after a "one or more creatures ... deal combat damage to a
  // player" trigger: the total the batch dealt (triggers/context.ts sums the amounts of a group, as for "that much"); only with "those creatures", the batch's many sources
  // ... and "that damage" (Broodcaller Scourge: "a permanent card with mana value less than or equal to that damage"): the damage the trigger's event dealt, as "that much" is
  const thatDamage = phraseAt(ctx, pos, W_THAT_DAMAGE);
  if (thatDamage >= 0) out.push({ end: thatDamage, value: anaphorQty({ sort: 'number', number: 'singular', text: 'that much' }), weak: 1 }); // weak (design 6.3 rule 2): r4-cost's "less than or equal to that damage" template keeps its sentence (Buster Sword)
  // edh-next-55 (CR 120.3, 603.2c, 608.2h; Sword of Hours): "the damage dealt" (not "dealt to ...") after a damage trigger: the damage the trigger's event dealt, as "that damage" is
  const dealtPlain = phraseAt(ctx, pos, P('the damage dealt'));
  if (dealtPlain >= 0 && ctx.toks[dealtPlain]?.norm !== 'to') out.push({ end: dealtPlain, value: { q: 'eventAmount' } as never, weak: 1 }); // (the event's amount itself, never the number of an instruction before: "roll a d12. If the result is greater than the damage dealt")
  const dealtBatch = anyPhraseAt(ctx, pos, W_DAMAGE_THOSE_DEALT);
  if (dealtBatch >= 0) out.push({ end: dealtBatch, value: anaphorQty({ sort: 'number', number: 'singular', text: 'that much' }) });

  // FAST5X E15 (CR 121.2, 608.2c): "the number of cards drawn this way": what an earlier draw step of the ability drew (its result count, which a replaced
  // draw is not part of, CR 614.11); the quantities pass binds it to the one draw step before it, or leaves the sentence manual
  const drawn = phraseAt(ctx, pos, W_DRAWN_THIS_WAY);
  if (drawn >= 0) out.push({ end: drawn, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'drawn', text: 'the number of cards drawn this way' }) });
  // edh-perms-20 (CR 121.2, 608.2c; Communal Brewing): "for each card drawn this way", the same count said with "for each"
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const each = phraseAt(ctx, pos, W_CARD_DRAWN_THIS_WAY);
    if (each >= 0) out.push({ end: each, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'drawn', text: 'card drawn this way' }) });
  }
  // edh-mana-keywords-12 (CR 701.20a, 608.2c; Metalworker): "for each card revealed this way", what an earlier reveal step of the ability revealed (its result count)
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const revealed = phraseAt(ctx, pos, W_CARD_REVEALED_THIS_WAY);
    if (revealed >= 0) out.push({ end: revealed, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'revealed', text: 'card revealed this way' }) });
  }
  // edh-c-43 (CR 701.20a, 608.2c; Scent of Nightshade, Scent of Cinder): "the number of cards revealed this way", the same count said as a number
  const revealedNumber = phraseAt(ctx, pos, W_CARDS_REVEALED_THIS_WAY);
  if (revealedNumber >= 0) out.push({ end: revealedNumber, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'revealed', text: 'the number of cards revealed this way' }) });
  // r4-moved (CR 701.6a, 608.2c): "for each spell and ability countered this way": what an earlier counter step of the ability countered, spells and abilities (its
  // result count); the quantities pass binds it to the one counter step before it, or leaves the sentence manual
  const countered = phraseAt(ctx, pos, W_COUNTERED_THIS_WAY);
  if (countered >= 0) out.push({ end: countered, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'countered', text: 'spell and ability countered this way' }) });
  // Cloud std-fin (CR 701.24a, 608.2c): "the number of cards shuffled into your library this way": what the move into your library right before it moved (its result count);
  // the quantities pass binds it to such a move, or leaves the sentence manual
  const shuffled = phraseAt(ctx, pos, W_SHUFFLED_THIS_WAY);
  if (shuffled >= 0) out.push({ end: shuffled, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'shuffled', text: 'the number of cards shuffled into your library this way' }) });
  // edh-top-6 (CR 118.12, 608.2c; join forces, Minds Aglow): "the total amount of mana paid this way": the total of an earlier payment of any amount of mana by a group of players (its result
  // count, effects/handlers/pay.ts); the quantities pass binds it to the one such payment before it, or leaves the sentence manual
  // edh-next-32 (CR 107.14, 118.12, 608.2c; Localized Destruction): "the amount of {E} paid this way": the same for a payment of any amount of energy
  const energyPaid = phraseAt(ctx, pos, P('the amount of {e} paid this way'));
  if (energyPaid >= 0) out.push({ end: energyPaid, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'paid', text: 'the amount of {E} paid this way' }) });
  // edh-next-48 (CR 107.14, 118.12, 608.2c; Aether Spike): "for each {E} paid this way" counts the same payment (the template names the "for each")
  const energyPaidEach = phraseAt(ctx, pos, P('{e} paid this way'));
  if (energyPaidEach >= 0) out.push({ end: energyPaidEach, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'paid', text: '{E} paid this way' }) });
  const manaPaid = phraseAt(ctx, pos, W_MANA_PAID_THIS_WAY);
  if (manaPaid >= 0) out.push({ end: manaPaid, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'paid', text: 'the total amount of mana paid this way' }) });
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

  // edh-replace-1 (CR 107.1, 120.3; Crackle with Power): "five times X", a whole number of two or more times a quantity (twice is the word above; edh-players-4: "two times X" is the same quantity). Weak (design 6.3 rule 2):
  // a template that spells "N times" out keeps its sentence
  if (t.kind === 'WORD') {
    const times = numberAt(ctx, pos);
    if (times !== undefined && Number.isInteger(times) && times >= 2 && ctx.toks[pos + 1]?.norm === 'times') {
      for (const a of atoms(ctx, pos + 2)) out.push({ end: a.end, value: { q: 'math', op: '*', args: [times, a.value as Quantity] }, weak: (a.weak ?? 0) + 1 });
    }
  }

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
    // edh-perms-11 (CR 607.2a, 608.2h; Unlicensed Hearse): "the number of cards exiled with ~" / "... with it": the cards the object's linked exiling ability exiled
    // (parser/parse.ts#linkExiled finds the producer; none or several makes the ability manual, as the condition "a card is exiled with ~" of parser/holes/cond.ts)
    const xw = anyPhraseAt(ctx, nOf, W_CARDS_EXILED_WITH_SELF);
    if (xw >= 0) out.push({ end: xw, value: { q: 'count', of: { ref: 'linked', link: 'exiled' } } });
    for (const f of ctx.call('Filter', nOf)) out.push({ end: f.end, value: countOf(f.value as ObjectFilter), ...(f.weak ? { weak: f.weak } : {}), ...(f.flags ? { flags: f.flags } : {}) });
    // edhn102 (CR 607.2a, 608.2h; Creeping Inn): "the number of creature cards exiled with ~": of the cards the object's linked exiling ability exiled (parse.ts#linkExiled finds the one producer), those of the
    // description, still in exile (the same description as the target phrase "target creature card exiled with ~", parser/holes/filter.ts, std-rx5); only a TYPED description of cards (a bare "cards exiled with ~" is edh-perms-11's count of the link itself) with no zone or owner of its own
    for (const f of ctx.call('Filter', nOf)) {
      const fv = f.value as ObjectFilter;
      const e = anyPhraseAt(ctx, f.end, W_EXILED_WITH_SELF_OR_IT);
      if (e >= 0 && fv.isCard === true && (fv.types ?? []).length > 0 && fv.zone === undefined && fv.is === undefined && fv.controller === undefined && fv.owner === undefined && fv.anyOf === undefined) out.push({ end: e, value: countOf({ ...fv, zone: 'exile', is: { ref: 'linked', link: 'exiled' } }) });
    }
    // edh-perms-20 (CR 701.17a, 608.2c; The Wise Mothman): "the number of nonland cards milled this way": a count of a description of cards the Filter hole read, marked `$moved` (kind
    // `milled`, parser/holes/moved-words.ts) for lower/quantities.ts, which reads it only in an ability that triggers on that very mill (milledBatchAmount); anywhere else the marker
    // stays and the sentence is manual. Only here, not in the Filter hole: "if a land card was milled this way" is another reading (parser/holes/cond.ts#milledThisWayCond)
    for (const f of ctx.call('Filter', nOf)) {
      const e = phraseAt(ctx, f.end, W_MILLED_THIS_WAY_COUNT);
      if (e >= 0 && (f.value as ObjectFilter).isCard === true) out.push({ end: e, value: countOf({ ...(f.value as ObjectFilter), [MOVED_MARK]: 'milled' } as ObjectFilter), ...(f.weak ? { weak: f.weak } : {}) });
    }
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
    // edh-c-6 (CR 506.2, 506.3; Pack Attack): "the number of players being attacked": the players a creature now in combat attacks (`ref: attacked`, edh-combat-6), counted
    const pba = phraseAt(ctx, nOf, W_PLAYERS_BEING_ATTACKED);
    if (pba >= 0) out.push({ end: pba, value: { q: 'countPlayers', of: { ref: 'attacked' } } });
    const bl = phraseAt(ctx, nOf, W_BASIC_LAND_TYPES_AMONG);
    if (bl >= 0) for (const f of ctx.call('Filter', bl)) if (landsOnly(f.value as ObjectFilter)) out.push({ end: f.end, value: domain(f.value as ObjectFilter), weak: (f.weak ?? 0) + 1, ...(f.flags ? { flags: f.flags } : {}) });
  }
  // std-costs-1 (CR 601.2c, 601.2f, 202.3; Urgent Necropsy): "the total mana value of the permanents ~ targets": the spell's own targets that are permanents, added
  // up (`spellTargetTotal`; model/lint-nodes.ts allows it only in an additional cost of the spell, which actions/cast.ts reads once the targets are chosen)
  const tt = phraseAt(ctx, pos, W_TOTAL_MV_OF_TARGETS);
  if (tt >= 0) out.push({ end: tt, value: { q: 'spellTargetTotal', stat: 'manaValue' } });
  const total = phraseAt(ctx, pos, W_TOTAL_NUMBER_OF);
  if (total >= 0) out.push(...counterCounts(ctx, total).filter((a) => { const on = (a.value as { on?: { ref?: string; who?: string } }).on; return on?.ref === 'each' && on.who === 'player'; })); // edh-next-26 (Vault 12)
  if (total >= 0) for (const f of ctx.call('Filter', total)) out.push({ end: f.end, value: countOf(f.value as ObjectFilter), ...(f.weak ? { weak: f.weak } : {}), ...(f.flags ? { flags: f.flags } : {}) });
  // cloud std-dsk (CR 709.5c, 709.5j): "the number of unlocked doors among Rooms you control" (only a description of Rooms and who controls them)
  const ud = phraseAt(ctx, pos, W_UNLOCKED_DOORS_AMONG);
  if (ud >= 0) for (const f of ctx.call('Filter', ud)) if (isRoomsOnly(f.value as ObjectFilter)) out.push({ end: f.end, value: { q: 'unlockedDoors', among: each(f.value as ObjectFilter) }, ...(f.flags ? { flags: f.flags } : {}) });
  if (nOf >= 0) out.push(...opponentCounts(ctx, nOf, true));
  out.push(...partySizeAt(ctx, pos, nOf));
  // edh-next-33 (CR 702.140d, 730.2; Insatiable Hemophage, Archipelagore): "the number of times ~ has mutated"
  if (nOf >= 0) { const tm = phraseAt(ctx, nOf, W_TIMES_SELF_MUTATED); if (tm >= 0) out.push({ end: tm, value: { q: 'timesMutated' } }); }
  // p2-typechange-2 (CR 305.6, 205.3i): domain after "for each" (in this hole or written by a template in front of it), "for each basic land type among lands you
  // control" (Might of Alara): the same sum as "the number of basic land types among lands you control" above; weak like it
  const feb = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' ? pos : phraseAt(ctx, pos, W_FOR_EACH);
  const bt = feb >= 0 ? phraseAt(ctx, feb, W_BASIC_LAND_TYPE_AMONG) : -1;
  if (bt >= 0) for (const f of ctx.call('Filter', bt)) if (landsOnly(f.value as ObjectFilter)) out.push({ end: f.end, value: domain(f.value as ObjectFilter), weak: (f.weak ?? 0) + 1, ...(f.flags ? { flags: f.flags } : {}) });
  // edh-next-56 (CR 607.2a, 608.2h; The Kenriths' Royal Funeral): "for each card exiled with ~" / "... with it": the count "the number of cards exiled with ~" reads (edh-perms-11), counted as the cost is worked out
  if (feb >= 0) { const lw = anyPhraseAt(ctx, feb, [P('card exiled with ~'), P('card exiled with it')]); if (lw >= 0) out.push({ end: lw, value: { q: 'count', of: { ref: 'linked', link: 'exiled' } } }); }
  const fe = phraseAt(ctx, pos, W_FOR_EACH);
  // edh-next-42 (CR 506.2, 506.3; Amber Gristle O'Maul): "for each player being attacked", the count of edh-c-6's "the number of players being attacked" (`ref: attacked`)
  if (feb >= 0) { const pba1 = phraseAt(ctx, feb, W_PLAYER_BEING_ATTACKED); if (pba1 >= 0) out.push({ end: pba1, value: { q: 'countPlayers', of: { ref: 'attacked' } } }); }
  if (fe >= 0) out.push(...opponentCounts(ctx, fe, false));
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') out.push(...opponentCounts(ctx, pos, false)); // std-rk: "draw a card for each {n:Qty}"
  if (fe >= 0) for (const f of ctx.call('Filter', fe)) out.push({ end: f.end, value: { ...(countOf(f.value as ObjectFilter) as object), $forEach: true }, ...(f.flags ? { flags: f.flags } : {}) });
  if (fe >= 0) out.push(...enteredCounts(ctx, fe));
  if (feb >= 0) out.push(...distinctCounts(ctx, feb, true)); // edh-b-7: "for each card type among those cards"
  // edh-d-85 (CR 122.1, 122.3; Blitzball Stadium): "for each kind of counter on it": the kinds of counter on one object (each kind once, however many of it), the same count
  // as r4-static's "different kinds of counters among" a group, over one object
  if (feb >= 0) { const kc = phraseAt(ctx, feb, W_KIND_OF_COUNTER_ON); if (kc >= 0) for (const o of ctx.call('Obj', kc)) out.push({ end: o.end, value: { q: 'distinct', what: 'counterKinds', among: o.value as never }, ...(o.flags ? { flags: o.flags } : {}) }); }
  // std-ry10 (CR 700.4, 603.10a): "for each creature that died this turn" (Canopy Stalker), also where a template wrote "for each" before the hole: the turn's
  // history count that "the number of creatures that died this turn" reads (historyCounts). Weak (design 6.3 rule 2): the fixed "draw a card for each <f> that
  // died this turn" templates keep their sentences
  const feDied = fe >= 0 ? fe : ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' ? pos : -1;
  if (feDied >= 0) {
    for (const f of ctx.call('Filter', feDied)) {
      const typed = spellsYouCast(ctx, f); // edh-top-7
      if (typed !== null) out.push(typed);
      const e = phraseAt(ctx, f.end, W_THAT_DIED_THIS_TURN);
      if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: f.value as ObjectFilter, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }, weak: (f.weak ?? 0) + 1, ...(f.flags ? { flags: f.flags } : {}) });
      // pc-tokens-3 (CR 700.4, 400.3; Fresh Meat, Caller of the Claw): "for each creature put into your graveyard from the battlefield this turn" (see historyCounts)
      const fv = f.value as ObjectFilter;
      // edh-b-7 (CR 701.21a; The Balrog, Durin's Bane): "for each permanent sacrificed this turn" (see historyCounts)
      const sa = phraseAt(ctx, f.end, W_SACRIFICED_THIS_TURN);
      if (sa >= 0 && fv.isCard === undefined && fv.stackKind === undefined && fv.zone === undefined && fv.controller === undefined && fv.owner === undefined) {
        out.push({ end: sa, value: { q: 'happenedCount', event: { ev: 'action', verb: 'sacrifice', ...(isPermanentOnly(fv) ? {} : { object: fv }) }, scope: 'turn' }, weak: (f.weak ?? 0) + 1, ...(f.flags ? { flags: f.flags } : {}) });
      }
      const py = phraseAt(ctx, f.end, W_PUT_INTO_YOUR_GRAVEYARD_FROM_BATTLEFIELD_THIS_TURN);
      if (py >= 0 && fv.isCard === undefined && fv.stackKind === undefined && fv.zone === undefined && fv.controller === undefined && fv.owner === undefined) {
        out.push({ end: py, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { ...fv, owner: 'you' }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }, ...(f.weak ? { weak: f.weak } : {}), ...(f.flags ? { flags: f.flags } : {}) });
      }
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
  // edh-c-47 (CR 202.1, 608.2h; Embodiment of Agonies): "for each different mana cost among nonland cards in your graveyard": each distinct mana cost once (an object with no mana cost adds none)
  const dmc = phraseAt(ctx, pos, P('different mana cost among'));
  if (dmc >= 0) for (const f of ctx.call('Filter', dmc)) out.push({ end: f.end, value: { q: 'distinct', what: 'manaCosts', among: each(f.value as ObjectFilter) }, ...(f.flags ? { flags: f.flags } : {}) });
  // edh-next-13 (CR 208.1, 608.2h; Golden Ratio): "for each different power among creatures you control": the number of different powers among them (each value once)
  const dpw = phraseAt(ctx, pos, P('different power among'));
  if (dpw >= 0) for (const f of ctx.call('Filter', dpw)) out.push({ end: f.end, value: { q: 'distinct', what: 'powers', among: each(f.value as ObjectFilter) }, ...(f.flags ? { flags: f.flags } : {}) });
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
  out.push(...mostCardsInHand(ctx, pos)); // edh-c-59

  // devotion
  const yd = phraseAt(ctx, pos, P('your'));
  if (yd >= 0) {
    const dv = phraseAt(ctx, yd, W_DEVOTION);
    if (dv >= 0) for (const c of colorList(ctx, dv)) out.push({ end: c.end, value: { q: 'devotion', to: c.colors, of: { ref: 'you' } } });
  }
  // edh-c-9 (CR 700.5; Springjack Shepherd): "for each white mana symbol in the mana costs of permanents you control" is your devotion to that color (one color, after "for each")
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    for (const c of ctx.call('Color', pos)) {
      const e = phraseAt(ctx, c.end, W_MANA_SYMBOL_IN_COSTS);
      if (e >= 0) out.push({ end: e, value: { q: 'devotion', to: [c.value as Color], of: { ref: 'you' } } });
    }
  }
  // edh-c-37 (CR 107.4, 202.1; Umbra Stalker, Heartlash Cinder): "the number of black mana symbols in the mana costs of cards in your graveyard": the mana symbols of one color in the
  // mana costs of a group (`symbolsAmong`); for permanents you control it is devotion (700.5), which edh-c-9's reading above says for "for each"
  const nsym = phraseAt(ctx, pos, W_NUMBER_OF);
  if (nsym >= 0) {
    for (const c of ctx.call('Color', nsym)) {
      const e = phraseAt(ctx, c.end, W_MANA_SYMBOLS_IN_COSTS_OF);
      if (e < 0) continue;
      for (const o of ctx.call('Objs', e)) out.push({ end: o.end, value: { q: 'symbolsAmong', color: c.value as Color, of: o.value as ObjRef } });
    }
  }
  if (phraseAt(ctx, pos, W_THE_RESULT) >= 0) out.push({ end: pos + 2, value: { q: 'dieResult' } });
  // edh-mana-keywords-10 (CR 706.2, 608.2h; Reckless Endeavor): "damage equal to that result" and "equal to the other result" after "Roll two d12 and choose one result"
  // edh-mana-keywords-10 (CR 706.2, 608.2h; Luck Bobblehead): "Create a tapped Treasure token for each even result": the dice of the roll before with an even (odd) result
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    if (phraseAt(ctx, pos, P('even result')) >= 0) out.push({ end: pos + 2, value: { q: 'diceResults', match: 'even' } });
    if (phraseAt(ctx, pos, P('odd result')) >= 0) out.push({ end: pos + 2, value: { q: 'diceResults', match: 'odd' } });
    if (phraseAt(ctx, pos, P('different result')) >= 0) out.push({ end: pos + 2, value: { q: 'diceResults', match: 'distinct' } }); // edh-next-55 (CR 706.2; Circuits Act): the different numbers the dice came up
  }
  if (phraseAt(ctx, pos, W_THAT_RESULT) >= 0) out.push({ end: pos + 2, value: { q: 'dieResult' }, weak: 1 });
  // edh-next-55 (CR 706.2, 608.2h; Pair o' Dice Lost): "where X is the total of those results": the total of the dice just rolled (the roll's result is that total when several dice are rolled)
  if (phraseAt(ctx, pos, P('the total of those results')) >= 0) out.push({ end: pos + 5, value: { q: 'dieResult' }, weak: 1 });
  if (phraseAt(ctx, pos, W_THE_OTHER_RESULT) >= 0) out.push({ end: pos + 3, value: { q: 'dieResultOther' } });
  if (phraseAt(ctx, pos, W_YOUR_SPEED) >= 0) out.push({ end: pos + 2, value: { q: 'speed' } });
  // edh-top-15 (CR 120.10; Toralf, God of Fury): "damage equal to the excess": the excess part of the damage the trigger's event was (lint-nodes.ts: only a trigger on a damage event with `excess`)
  if (phraseAt(ctx, pos, P('the excess')) >= 0) out.push({ end: pos + 2, value: { q: 'eventExcess' } });
  // FAST4 T26: "the amount of life you gained this turn" (CR 119.3: the life the controller gained this turn; read as the step runs, CR 608.2h)
  // edh-next-42 (CR 106.4, 608.2h; Glissa Sunseeker): "the amount of unspent mana you have": the mana in your mana pool (FAST5X E19's `unspentMana`, any type)
  { const e = phraseAt(ctx, pos, W_UNSPENT_MANA_YOU_HAVE); if (e >= 0) out.push({ end: e, value: { q: 'unspentMana' } }); }
  for (const ws of W_LIFE_GAINED) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { q: 'lifeGainedThisTurn' } }); }
  // Cloud std-woe (CR 119.3, 120.3a): "the amount of life you lost this turn", every loss of the controller this turn, damage included (read as the step runs, CR 608.2h)
  for (const ws of W_LIFE_LOST) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { q: 'lifeLostThisTurn', of: { ref: 'you' } } }); }
  // edh-players-10: weak (design 6.3 rule 2): eff.t34.eachOpponentLosesLifeLostThisTurn ("each opponent loses life equal to the life they lost this turn") keeps its own sentence
  for (const [ws, who] of W_LIFE_LOST_THEY) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { q: 'lifeLostThisTurn', of: who() as PlayerRef }, weak: 1 }); }
  // edh-cast-3 (CR 119.3, 120.3a, 601.2f; Rakdos, Lord of Riots): the life ALL the opponents lost this turn, added up ("1 life" is one unit of it: "for each 1 life your opponents
  // have lost this turn"); damage dealt to the opponents this turn, added up from the history (Chandra's Incinerator; CR 120.1: every damage entry to an opponent)
  for (const ws of W_LIFE_LOST_OPPONENTS) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { q: 'lifeLostTotal', of: { ref: 'each', who: 'opponent' } } }); }
  for (const ws of W_LIFE_LOST_ALL) { const e = phraseAt(ctx, pos, ws); if (e >= 0) out.push({ end: e, value: { q: 'lifeLostTotal', of: { ref: 'each', who: 'player' } } }); }
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const g = phraseAt(ctx, pos, W_ONE_LIFE_YOU_GAINED);
    if (g >= 0) out.push({ end: g, value: { q: 'lifeGainedThisTurn' } });
    const e = phraseAt(ctx, pos, W_ONE_LIFE_OPPONENTS);
    if (e >= 0) out.push({ end: e, value: { q: 'lifeLostTotal', of: { ref: 'each', who: 'opponent' } } });
    // edh-d-3: "for each 1 life you gained" (not "... this turn"): one unit of the life of the gain that triggered the ability, "that much" (as the edh-c-1 reading of "the amount of life you gained")
    const gt = phraseAt(ctx, pos, W_ONE_LIFE_YOU_GAINED_THAT);
    if (gt >= 0 && ctx.toks[gt]?.norm !== 'this') out.push({ end: gt, value: anaphorQty({ sort: 'number', number: 'singular', text: 'that much' }) });
  }
  for (const [ws, combat] of W_DAMAGE_TO_OPPONENTS) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'damage', recipient: { player: 'opponent' }, ...(combat !== undefined ? { combat } : {}) }, scope: 'turn', sum: 'amount' } });
  }
  // edh-next-96 (CR 202.3, 202.3e, 601.2i, 608.2h; Rootha, Mastering the Moment): "the greatest mana value among instant and sorcery spells you've cast this turn": the largest mana value
  // (as each became cast, with its announced X) of the spells of the description cast this turn (`happenedCount` per source, summed by mana value; rules/history.ts#maxHistoryPerSource)
  const greatest = phraseAt(ctx, pos, P('the greatest mana value among'));
  if (greatest >= 0) {
    for (const f of ctx.call('Filter', greatest)) {
      const typed = spellsYouCast(ctx, f);
      if (typed !== null) out.push({ ...typed, value: { ...(typed.value as object), per: 'source', sum: 'manaValue' } });
    }
    // edh-d-95 (CR 202.3, 608.2h, 603.2c; Amzu, Swarm's Hunger): "the greatest mana value among those cards": the largest mana value of the objects a plural pronoun names (the cards of the
    // trigger's batch, "whenever one or more cards leave your graveyard"), each read as it last existed; of none, 0 (effects/eval.ts, `agg`)
    for (const g of ctx.call('Them', greatest)) {
      const v = g.value as { $anaphor?: { number?: string; participle?: string } };
      // (review: a plural pronoun or "those <noun>" only, never "cards exiled this way", which the older reading of a group in exile already reads: two readings, G5)
      if (v.$anaphor?.number !== 'plural' || v.$anaphor.participle !== undefined || /this way/.test(JSON.stringify(v))) continue;
      out.push({ end: g.end, value: { q: 'stat', stat: 'manaValue', of: g.value, agg: 'max' } as unknown as Quantity });
    }
  }
  // edh-cast-12 (CR 202.3, 202.3e, 601.2i, 608.2h; Call Forth the Tempest): "the total mana value of other spells you've cast this turn": the mana values of the
  // spells you cast this turn added up, as each became cast, without the spell that is resolving (the history's `castManaValue`)
  {
    const e = phraseAt(ctx, pos, W_TOTAL_MV_OTHER_SPELLS);
    if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'cast', player: 'you', spell: { not: { self: true } } }, scope: 'turn', by: 'you', sum: 'manaValue' } });
  }
  // edh-players-16 (CR 120.1, 120.3, 120.4; Knollspine Dragon): "the damage dealt to target opponent this turn", "the damage dealt to your opponents this turn": the same sum, said
  // without "amount of"; a player (the Player hole: a target, "you", the opponents) is the recipient of every damage entry of the turn (a creature that was dealt damage is none)
  const ddPlayer = Math.max(phraseAt(ctx, pos, W_DAMAGE_DEALT_TO_PLAIN), phraseAt(ctx, pos, W_DAMAGE_ALREADY_DEALT_TO)); // edh-c-51 (CR 120.1; Final Punishment): "already" says only that it is the damage so far this turn
  if (ddPlayer >= 0) {
    for (const r of ctx.call('Player', ddPlayer)) {
      const rv = r.value as { ref?: string };
      if (rv.ref !== 'you' && rv.ref !== 'target' && !isOpponents(r.value) && !(rv.ref === 'bound' && '$anaphor' in (rv as object))) continue; // edh-c-51: "that player" (an anaphor: the lowering binds it to the target player of the sentence) // a target, you, or all your opponents: not "an opponent" (a choice) or "each player"
      const e = phraseAt(ctx, r.end, W_THIS_TURN);
      if (e >= 0) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'damage', recipient: { player: isOpponents(r.value) ? 'opponent' : r.value as PlayerRef } }, scope: 'turn', sum: 'amount' } });
    }
  }
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
  // edh-d-90 (CR 106.3, 605.1a, 605.3b; Tyvar the Bellicose): "the amount of mana ~ produced", in a trigger on the activation of a mana ability of the object: the mana that activation added
  // (`manaProduced`, the triggering event's mana; model/lint-roles.ts keeps it to such a trigger)
  const mp = phraseAt(ctx, pos, W_AMOUNT_OF_MANA);
  const mpEnd = mp >= 0 && ctx.toks[mp]?.kind === 'SELF' ? phraseAt(ctx, mp + 1, W_PRODUCED) : -1;
  if (mpEnd >= 0) out.push({ end: mpEnd, value: { q: 'manaProduced' } });
  // edh-zones-26 (CR 107.4h, 601.2h; Search for Glory): "{S} spent to cast ~" after "for each", "the amount of {S} spent to cast ~" (the spell itself, `snowSpent`)
  for (const [e0, ok] of [[phraseAt(ctx, pos, W_SNOW_SPENT), ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each'], [phraseAt(ctx, pos, W_AMOUNT_SNOW_SPENT), true]] as const) {
    if (e0 >= 0 && ok && ctx.toks[e0]?.kind === 'SELF') out.push({ end: e0 + 1, value: { q: 'snowSpent' } });
  }
  // FAST5 T51 (CR 601.2h): "the amount of mana spent to cast it" (the object itself: it enters with that many counters, the pronoun is checked by the template)
  // and "the number of colors of mana spent to cast that spell" / "each color of mana spent to cast that spell" (the spell of a cast trigger, `spellColorsSpent`;
  // the marker `$spell` makes the sentence manual anywhere else, parser/lower/anaphora.ts#castSpellMarker)
  const thatSpell = (): Alt['value'] => anaphorObj({ sort: 'object', number: 'singular', head: 'spell', text: 'that spell' });
  const msThat = ms >= 0 ? phraseAt(ctx, ms, W_THAT_SPELL) : -1; // "the amount of mana spent to cast that spell": E19's `of` names it (the anaphor must resolve to the cast event's spell)
  if (msThat >= 0) out.push({ end: msThat, value: { q: 'spellManaSpent', of: thatSpell() } });
  // edh-next-138 (CR 601.2h, 113.6k; Prossh, Skyraider of Kher): "where X is the amount of mana spent to cast it" in a cast trigger of the spell itself ("When you cast this spell, create X ...
  // tokens"): the pronoun names the cast event's spell (E19's `of`; any other antecedent has no reading, model/cap-walk.ts). Weak: T51's own templates read the words of an object that enters
  if (ms >= 0 && ctx.toks[ms]?.norm === 'it') out.push({ end: ms + 1, value: { q: 'spellManaSpent', of: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) }, weak: 1 });
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
  // edh-c-27 (CR 601.2h, 105.1; Sweep the Skies): "for each color of mana spent to cast ~" (the spell itself) counts the colors of mana spent, as converge does (`colorsSpent`)
  const ecSelf = phraseAt(ctx, pos, W_COLOR_SPENT);
  if (ecSelf >= 0 && ctx.toks[ecSelf]?.kind === 'SELF' && ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') out.push({ end: ecSelf + 1, value: { q: 'colorsSpent' } });
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
    // edh-c-1 (CR 702.29a, 701.9a, 608.2h; Hollow One): cycling is discarding the card as a cost, so "cycled or discarded" is the same discard count
    const d = anyPhraseAt(ctx, pos, [P("card you've discarded this turn"), P("card you've cycled or discarded this turn")]);
    if (d >= 0) out.push({ end: d, value: { q: 'happenedCount', event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' } });
    // edh-c-1 (CR 119.3, 608.2c; Blood Tyrant): "for each 1 life lost this way": one for each point of the life the loseLife instruction right before made its players lose
    const lifeLostEach = phraseAt(ctx, pos, P('1 life lost this way'));
    if (lifeLostEach >= 0) out.push({ end: lifeLostEach, value: { q: 'lifeLost', step: '', $step: 'previous' } as never });
    // std-rm (CR 121.1, 601.2i): "for each card you've drawn this turn", "for each spell you've cast this turn" (the history counts of "the number of ..." above, said
    // with the singular noun), and "for each spell you've cast this turn from anywhere other than your hand" (Surge of Brilliance: the cast history's `notFrom`)
    // trek-7 (CR 700.2): "for each dilemma you've faced this turn" (the singular noun, as the counts above)
    const dilemma = anyPhraseAt(ctx, pos, W_DILEMMA_YOU_FACED_THIS_TURN);
    if (dilemma >= 0) out.push({ end: dilemma, value: FACED_DILEMMAS_THIS_TURN() });
    const drawn = phraseAt(ctx, pos, P("card you've drawn this turn"));
    if (drawn >= 0) out.push({ end: drawn, value: { q: 'cardsDrawnThisTurn' } });
    // edh-cast-8 (CR 121.1, 608.2h; Heliod, the Radiant Dawn): "for each card your opponents have drawn this turn": every draw of the turn by an opponent of the ability's controller
    const oppDrawn = phraseAt(ctx, pos, P('card your opponents have drawn this turn'));
    if (oppDrawn >= 0) out.push({ end: oppDrawn, value: { q: 'happenedCount', event: { ev: 'draw', player: 'opponent' }, scope: 'turn' } });
    const cast = phraseAt(ctx, pos, P("spell you've cast this turn"));
    if (cast >= 0) {
      out.push({ end: cast, value: { q: 'spellsCastThisTurn' } });
      const nh = phraseAt(ctx, cast, P('from anywhere other than your hand'));
      if (nh >= 0) out.push({ end: nh, value: { q: 'happenedCount', event: { ev: 'cast', player: 'you', notFrom: 'hand' }, scope: 'turn' } });
    }
    // edh-cast-9 (CR 601.2i, 608.2h; Rug of Smothering): "for each spell they've cast this turn": the casts of the turn by a player named before ("they": the player who
    // cast the spell that triggered the ability), one history entry each (the same count as "the number of noncreature spells they've cast this turn", FAST4 T34)
    const theyCast = phraseAt(ctx, pos, P("spell they've cast this turn"));
    if (theyCast >= 0) out.push({ end: theyCast, value: { q: 'happenedCount', event: { ev: 'cast' }, scope: 'turn', by: anaphorObj({ sort: 'any', number: 'plural', text: 'they' }) as PlayerRef } });
    // std-rm (CR 122.1): "for each experience counter you have" (the singular noun; the number of them, as "the number of experience counters you have")
    for (const k of ctx.call('CounterKind', pos)) {
      const c = phraseAt(ctx, k.end, P('counter'));
      if (c >= 0) out.push(...playerHasCounters(ctx, c, k.value as string, k.weak));
      // edh-c-2 (CR 122.1; Scroll of the Masters): "for each lore counter on ~" (the singular noun, as "the number of lore counters on ~")
      if (c >= 0) out.push(...countersOnAt(ctx, c, k.value as string).map((a) => ({ ...a, weak: (a.weak ?? 0) + (k.weak ?? 0) + 1 })));
      // edh-c-101 (CR 122.1; Chong and Lily, Nomads): "for each lore counter among Sagas you control" (the singular noun, as "the number of counters among ...")
      if (c >= 0) out.push(...countersAmongAt(ctx, c, k.value as string).map((a) => ({ ...a, weak: (a.weak ?? 0) + (k.weak ?? 0) + 1 })));
    }
    // pc-keywords-mana-1 (CR 122.1; Nardole, Resourceful Cyborg: "Add {U} for each counter on ~"): the singular noun with no kind, the counters of every kind on the object
    // (the same count as "the number of counters on ~", `kind: 'any'`)
    const bare = phraseAt(ctx, pos, P('counter'));
    if (bare >= 0) out.push(...countersOnAt(ctx, bare, 'any'));
  }
  out.push(...timesKicked(ctx, pos)); // pc-zones-3 (CR 702.33d): "the number of times ~ was kicked"
  out.push(...devouredCount(ctx, pos)); // edh-c-35 (CR 702.82c): "for each creature it devoured"
  out.push(...phasedThisWay(ctx, pos)); // edh-d-39 (CR 702.26b, 608.2c): "for each creature that phased out this way"
  out.push(...destroyedThisWay(ctx, pos)); // std-tdm (CR 701.8a, 608.2c): "for each permanent destroyed this way", "the number of creatures destroyed this way"
  out.push(...milledThisWayCount(ctx, pos)); // std-rx35 (CR 701.17a, 608.2c): "for each creature card milled this way"
  // std-rx20 (CR 120.3, 608.2c): "the damage dealt this way": the damage the damage instruction RIGHT BEFORE dealt (`$step` is resolved by
  // parser/lower/conditions.ts#resolveDamageDealt, as the life lost this way is)
  const dd = phraseAt(ctx, pos, W_DAMAGE_DEALT_THIS_WAY);
  if (dd >= 0) out.push({ end: dd, value: { q: 'damageDealt', step: '', $step: 'previous' } as never });
  { const rt = phraseAt(ctx, pos, W_TIMES_RESOLVED); if (rt >= 0) out.push({ end: rt, value: { q: 'resolvedThisTurn' } }); } // edh-c-89 (CR 608.2, 113.7a; Bronze Cudgels): the quantity of FAST5X E17
  out.push(...countersRemovedAt(ctx, pos)); // std-rx14 (CR 122.1, 608.2c): "for each lore counter removed this way", "the number of counters removed this way"
  out.push(...commanderQtyAt(ctx, pos)); // CMD2 (CR 903.3d): "the greatest mana value of a commander you own on the battlefield or in the command zone"
  out.push(...p2cst1QtyAt(ctx, pos)); // p2-cost-statics-1 (CR 601.2i, 508.1): "for each spell your opponents have cast this turn", "for each creature you attacked with this turn"
  out.push(...edhpm8QtyAt(ctx, pos)); // edh-perms-8 (CR 111.1): "the number of tokens you created this turn"
  out.push(...pcc1QtyAt(ctx, pos)); // pc-counters-1 (CR 119.3, 122.1): "for each player who lost life this turn", "the number of opponents who lost life this turn"
  out.push(...edhn24QtyAt(ctx, pos)); // edh-next-24 (CR 105.1): "the number of colors that spell is"
  out.push(...edhn31QtyAt(ctx, pos)); // edh-next-31 (CR 105.1): "for each of its colors"
  out.push(...edhn58QtyAt(ctx, pos)); // edh-next-58 (CR 205.2a, 701.21a): "for each card type among permanents you've sacrificed this turn"
  out.push(...edhn38QtyAt(ctx, pos)); // edh-next-38 (CR 701.22a): "the number of cards looked at while scrying this way"
  out.push(...edhn95QtyAt(ctx, pos)); // edh-next-95 (CR 104.2a): "the number of players who have lost the game", "for each player who has lost the game"
  out.push(...edhn110QtyAt(ctx, pos)); // edh-next-110 (CR 122.6): "for each +1/+1 counter you've put on creatures under your control this turn"
  out.push(...edhd70QtyAt(ctx, pos)); // edh-d-70 (CR 107.14): "for each {E} you've paid or lost this turn" (parser/holes/edhd70.ts)
  out.push(...edhd88QtyAt(ctx, pos)); // edh-d-88 (CR 107.14, 122.1): "the amount of {E} you have" (parser/holes/edhd88.ts)
  out.push(...edhn8QtyAt(ctx, pos)); // edh-next-8 (CR 205.3m, 122.1): "for each creature type among creatures you control", "for each counter among players and permanents"
  out.push(...pcc3QtyAt(ctx, pos)); // pc-counters-3 (CR 603.10a, 700.4): "the power of the creature that died"
  out.push(...edhp9QtyAt(ctx, pos)); // edh-players-9 (CR 102.3, 121.1, 120.2a): "for each opponent who drew two or more cards this turn", "the number of opponents that were dealt combat damage this turn"
  out.push(...revealedThisWayCount(ctx, pos)); // edh-zones-18 (CR 701.20a, 608.2c): "for each nonland card revealed this way"
  out.push(...edhn94QtyAt(ctx, pos)); // edh-next-94 (CR 701.26a, 608.2c): "the number of creatures tapped this way", "for each Gate tapped this way"
  out.push(...edhd75QtyAt(ctx, pos)); // edh-d-75 (CR 701.15a, 608.2c): "for each creature goaded this way", "the total power of creatures goaded this way"
  out.push(...revealedDrawnCount(ctx, pos), ...revealedGreatestMv(ctx, pos)); // trek-17 (CR 701.20a, 121.1, 608.2c): the same after a draw; "the greatest mana value among cards revealed this way"

  return out;
}

const W_THAT_DIED_THIS_TURN = P('that died this turn'); // std-ry10
const W_TIMES_SELF_MUTATED = P('times ~ has mutated'); // edh-next-33
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
const W_YOUR_OPPONENTS_WITH = P('your opponents with'); // edh-b-6
const W_CARDS_IN_HAND_Q = [P('cards in hand'), P('card in hand')]; // edh-b-6
const W_OPPONENT_YOU_HAVE = P('opponent you have'); // std-rx20
const W_OPPONENT_LIFE_HALF_START = P('opponent whose life total is less than half their starting life total'); // edh-next-83
const W_OPPONENT_DEALT_DAMAGE = P('opponent dealt damage'); // edh-replace-5
const W_OPPONENTS_DEALT_THIS_WAY = P('opponents dealt damage this way'); // edh-players-18
const W_PLAYERS_IN_GAME = P('players in the game'); // edh-zones-16
const W_MORE_ONLY = P('more'); // edh-d-37
const W_WHO_CONTROL = [P('opponents who control'), P('opponent who controls')];
const W_MORE_FEWER: [string[], '>' | '<'][] = [[P('more'), '>'], [P('fewer'), '<']];
const W_THAN_YOU = P('than you');
const W_PLAYERS_WHO_CONTROL = [P('players who control'), P('player who controls')]; // edh-next-22
const W_WHO_HAVE = [P('opponents who have'), P('opponent who has')]; // edh-players-21
const W_MORE_LESS_LIFE: [string[], '>' | '<'][] = [[P('more life than you'), '>'], [P('less life than you'), '<']]; // edh-d-42
const W_MORE_CARDS_HAND = [P('more cards in hand than you'), P('more cards in their hand than you')]; // edh-players-21

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
  const comparisons = (from: number): void => {
    for (const [ws, op] of W_MORE_FEWER) {
      const m = phraseAt(ctx, from, ws);
      if (m < 0) continue;
      for (const n of npAlts(ctx, m)) {
        const f = n.filter;
        if (n.number !== 'plural' || f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.isCard !== undefined || f.stackKind !== undefined) continue;
        const than = phraseAt(ctx, n.end, W_THAN_YOU);
        if (than < 0) continue;
        out.push({ end: than, value: { q: 'countPlayers', of: opponents, controlsVs: { filter: f, op, than: { ref: 'you' } } }, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
      }
    }
    // edh-d-37 (CR 102.3, 608.2h; Surveyor's Scope): "the number of players who control at least two more lands than you": the opponents who control that many more of the description than you
    // do (`controlsVs.by`, as the condition "an opponent controls at least four more creatures than you", edh-c-58)
    for (const c of cmpAt(ctx, from)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 2) continue;
      const m = phraseAt(ctx, c.end, W_MORE_ONLY);
      if (m < 0) continue;
      for (const n of npAlts(ctx, m)) {
        const f = n.filter;
        if (n.number !== 'plural' || f.controller !== undefined || f.owner !== undefined || f.zone !== undefined || f.isCard !== undefined || f.stackKind !== undefined) continue;
        const than = phraseAt(ctx, n.end, W_THAN_YOU);
        if (than < 0) continue;
        out.push({ end: than, value: { q: 'countPlayers', of: opponents, controlsVs: { filter: f, op: '>=', than: { ref: 'you' }, by: c.cmp.value } }, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
      }
    }
  };
  if (plural) {
    const h = phraseAt(ctx, pos, W_OPPONENTS_YOU_HAVE);
    // weak (design 6.3 rule 2): FAST3 T17's fixed template "create a number of <tokens> equal to the number of opponents you have" keeps its sentence
    if (h >= 0) out.push({ end: h, value: { q: 'countPlayers', of: opponents }, weak: 1 });
    // edh-b-6 (CR 402.1, 102.3, 608.2h; Wolfcaller's Howl): "the number of your opponents with four or more cards in hand": the opponents whose hand holds at least (at most) that
    // many cards, each judged alone (`countPlayers.sizeIs`, as "opponents who have four or more cards in hand")
    const ow = phraseAt(ctx, pos, W_YOUR_OPPONENTS_WITH);
    if (ow >= 0) for (const c of cmpAt(ctx, ow)) {
      if (typeof c.cmp.value !== 'number' || (c.cmp.op !== '>=' && c.cmp.op !== '<=')) continue;
      const e = anyPhraseAt(ctx, c.end, W_CARDS_IN_HAND_Q);
      if (e >= 0) out.push({ end: e, value: { q: 'countPlayers', of: opponents, sizeIs: { zone: 'hand', op: c.cmp.op, n: c.cmp.value } } });
    }
    // edh-zones-16 (CR 102.1; Open the Way): "the number of players in the game": every player still in it, you included
    const pg = phraseAt(ctx, pos, W_PLAYERS_IN_GAME);
    if (pg >= 0) out.push({ end: pg, value: { q: 'countPlayers', of: { ref: 'each', who: 'player' } } });
    // edh-players-18 (CR 603.2c, 102.3, 608.2h; Hordewing Skaab): "the number of opponents dealt damage this way" in a damage trigger: the opponents the event's damage was dealt to
    // (as "for each opponent dealt damage" below; model/lint-roles.ts refuses it for any other event)
    const dt = phraseAt(ctx, pos, W_OPPONENTS_DEALT_THIS_WAY);
    if (dt >= 0) out.push({ end: dt, value: { q: 'countPlayers', of: { ref: 'event', role: 'recipient' } } });
  } else {
    // std-rx20 (CR 102.3, 608.2h): after "for each": "for each opponent you have" (every opponent of the controller), as "the number of opponents you have"
    const h = phraseAt(ctx, pos, W_OPPONENT_YOU_HAVE);
    if (h >= 0) out.push({ end: h, value: { q: 'countPlayers', of: opponents } });
    // edh-next-83 (CR 119.1, 103.4, 102.3, 608.2h; Anya, Merciless Angel): "for each opponent whose life total is less than half their starting life total": the opponents,
    // each judged alone, whose life total is below half of the starting life total (`countPlayers.lifeIs.halfStarting`; 20 in a two-player game, 20 in Commander's 40)
    const lh = phraseAt(ctx, pos, W_OPPONENT_LIFE_HALF_START);
    if (lh >= 0) out.push({ end: lh, value: { q: 'countPlayers', of: opponents, lifeIs: { op: '<', n: 0, halfStarting: true } } });
    // edh-replace-5 (CR 603.2c, 102.3, 608.2h; Malcolm, Keen-Eyed Navigator): "for each opponent dealt damage" in a damage trigger: the opponents the event's damage was dealt to
    // (the recipients of the batch; model/lint-roles.ts refuses it for any other event)
    const dd = phraseAt(ctx, pos, W_OPPONENT_DEALT_DAMAGE);
    if (dd >= 0) out.push({ end: dd, value: { q: 'countPlayers', of: { ref: 'event', role: 'recipient' } } });
    // edh-players-14 (CR 506.3, 508.1; Rose, Cutthroat Raider): "for each opponent you attacked [this turn]": the different opponents the turn's attackers were declared against
    // (Raid evaluates the whole turn, ruling of Rose); the same count as "the number of opponents you attacked this turn"
    const at = anyPhraseAt(ctx, pos, W_OPPONENT_YOU_ATTACKED);
    if (at >= 0) out.push({ end: at, value: { q: 'opponentsAttacked', scope: 'turn' } });
  }
  // edh-players-21 (CR 402.1, 102.3, 608.2h; Consuming Tide): "for each opponent who has more cards in their hand than you", "the number of opponents who have more cards in hand than
  // you": the opponents whose hand is bigger than yours, each opponent judged alone (`countPlayers.sizeVs`, as the condition "an opponent has more cards in hand than you")
  const hv = phraseAt(ctx, pos, W_WHO_HAVE[plural ? 0 : 1]!);
  if (hv >= 0) {
    const more = anyPhraseAt(ctx, hv, W_MORE_CARDS_HAND);
    if (more >= 0) out.push({ end: more, value: { q: 'countPlayers', of: opponents, sizeVs: { zone: 'hand', op: '>', than: { ref: 'you' } } } });
  }
  // edh-d-42 (CR 119.1, 102.3, 608.2h; Great Unclean One): "for each opponent who has less life than you", "the number of opponents who have more life than you": the opponents whose life
  // total compares so with yours, each judged alone (`countPlayers.lifeVs`, as the condition "an opponent has more life than you")
  const lw = phraseAt(ctx, pos, W_WHO_HAVE[plural ? 0 : 1]!);
  if (lw >= 0) for (const [ws, op] of W_MORE_LESS_LIFE) {
    const e = phraseAt(ctx, lw, ws);
    if (e >= 0) out.push({ end: e, value: { q: 'countPlayers', of: opponents, lifeVs: { op, than: { ref: 'you' } } } });
  }
  const w = phraseAt(ctx, pos, W_WHO_CONTROL[plural ? 0 : 1]!);
  // edh-next-22 (CR 102.3, 608.2h; Oreskos Explorer): "the number of players who control more lands than you": a player never controls more than themselves, so the players are the
  // opponents who do (the comparison with you only; the same count as above)
  const wp = phraseAt(ctx, pos, W_PLAYERS_WHO_CONTROL[plural ? 0 : 1]!);
  if (wp >= 0) comparisons(wp);
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
  comparisons(w);
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

const W_PHASED_THIS_WAY = P('that phased out this way');
/**
 * edh-d-39 (CR 702.26b, 608.2c; Out of Time): "Put a time counter on ~ for each creature that phased out this way", "the number of creatures that phased out this way": what an
 * earlier phase-out step of the ability phased out (its result count; the quantities pass binds it to the ONE phaseOut step before it and checks that the noun names everything the
 * step phases out, lower/quantities.ts#phasedNounFits).
 */
function phasedThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const word = (i: number): string | undefined => (ctx.toks[i]?.kind === 'WORD' ? ctx.toks[i]!.norm : undefined);
  const one = word(pos);
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' && one !== undefined && DESTROYED_SINGULAR.has(one)) {
    const e = phraseAt(ctx, pos + 1, W_PHASED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'phased', head: one, text: `${one} that phased out this way` }) });
  }
  const n = phraseAt(ctx, pos, W_NUMBER_OF);
  const many = n >= 0 ? word(n) : undefined;
  const head = many !== undefined && Object.hasOwn(DESTROYED_NOUNS, many) ? DESTROYED_NOUNS[many] : undefined;
  if (head !== undefined) {
    const e = phraseAt(ctx, n + 1, W_PHASED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'phased', head, text: `the number of ${many} that phased out this way` }) });
  }
  return out;
}
const W_TIMES_KICKED = [P('the number of times ~ was kicked'), P('the number of times it was kicked')];
/**
 * pc-zones-3 (CR 702.33d, 702.33c; Marshal's Anthem): "the number of times ~ was kicked" is the kicks paid as the object was cast (`kickCount`, read from the cast record of the
 * ability's own object like "if ~ was kicked", parser/lower/anaphora.ts); multikicker or two kicker costs count each payment.
 */
function timesKicked(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_TIMES_KICKED) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { q: 'kickCount' } as Quantity });
  }
  return out;
}

/**
 * std-tdm (CR 701.8a, 608.2c): what an earlier destroy step of the ability destroyed, its result count (a destroyed permanent that was indestructible or regenerated
 * is not destroyed, CR 702.12b, 701.19a): "Draw a card for each permanent destroyed this way" (the singular noun, only right after the words "for each" in front
 * of this hole) and "the number of creatures destroyed this way". A number anaphor with the participle `destroyed` and the noun as its head: the quantities pass
 * binds it to the one destroy step before it, and only when that noun names everything the step can destroy ("permanent", or the one card type of a step that
 * destroys every object of that type; parser/lower/quantities.ts), or leaves the sentence manual.
 */
const W_DIED_THIS_WAY = P('that died this way'); // edh-c-61
function destroyedThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const word = (i: number): string | undefined => (ctx.toks[i]?.kind === 'WORD' ? ctx.toks[i]!.norm : undefined);
  const one = word(pos);
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' && one !== undefined && DESTROYED_SINGULAR.has(one)) {
    const e = phraseAt(ctx, pos + 1, W_DESTROYED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'destroyed', head: one, text: `${one} destroyed this way` }) });
  }
  // edh-d-52 (CR 701.8a, 700.4, 608.2h; Mogg Infestation): "For each creature that died this way, ..." (the singular, right after "for each"), as edh-c-61's plural below
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each' && one === 'creature') {
    const e = phraseAt(ctx, pos + 1, W_DIED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'destroyed', head: 'creature', died: true, text: 'creature that died this way' } as never) });
  }
  const n = phraseAt(ctx, pos, W_NUMBER_OF);
  const many = n >= 0 ? word(n) : undefined;
  const head = many !== undefined && Object.hasOwn(DESTROYED_NOUNS, many) ? DESTROYED_NOUNS[many] : undefined;
  if (head !== undefined) {
    const e = phraseAt(ctx, n + 1, W_DESTROYED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'destroyed', head, text: `the number of ${many} destroyed this way` }) });
    // edh-c-61 (CR 701.8a, 700.4; Hellfire): "the number of creatures that died this way" after a destroy: a destroyed creature is put into its owner's graveyard from the battlefield, so it died (creatures only)
    const d = many === 'creatures' ? phraseAt(ctx, n + 1, W_DIED_THIS_WAY) : -1;
    if (d >= 0) out.push({ end: d, value: anaphorQty({ sort: 'number', number: 'singular', participle: 'destroyed', head, died: true, text: `the number of ${many} that died this way` } as never) });
  }
  return out;
}
const W_LIFE_PAID_AS_ENTERED = P('the life paid as ~ entered'); // edh-next-138
const W_CREATURE_DEVOURED = P('creature it devoured');
const W_CREATURES_DEVOURED = P('creatures it devoured');
/**
 * edh-c-35 (CR 702.82c; Tar Fiend, Marrow Chomper): the permanents a creature with devour sacrificed as it entered, "for each creature it devoured" (right after "for each") and "the
 * number of creatures it devoured": the number kept under the link `devoured` (effects/bodies/m5.ts), read by `chosenNumber`.
 */
function devouredCount(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const value = { q: 'chosenNumber', link: 'devoured' } as Quantity;
  if (ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each') {
    const e = phraseAt(ctx, pos, W_CREATURE_DEVOURED);
    if (e >= 0) out.push({ end: e, value });
  }
  const n = phraseAt(ctx, pos, W_NUMBER_OF);
  if (n >= 0) {
    const e = phraseAt(ctx, n, W_CREATURES_DEVOURED);
    if (e >= 0) out.push({ end: e, value });
  }
  return out;
}
const W_MILLED_THIS_WAY = P('milled this way');
const W_MILLED_THIS_WAY_COUNT = P('milled this way'); // edh-perms-20

/**
 * std-rx35 (CR 701.17a, 608.2c): "You gain 1 life for each creature card milled this way" (Gorging Vulture), "For each creature card milled this way, create ...": the
 * number of the cards a mill step of an earlier sentence of the ability put into a graveyard that are of that description, counted where they are (the `milled`
 * group anaphor with `zone: 'any'`, as std-tla's "a land card was milled this way" reads it, parser/holes/cond.ts#milledThisWayCond). Only right after the words
 * "for each" in front of this hole, one singular description of a card with no controller, owner or zone, and only after a mill (the discourse model says an
 * earlier sentence milled).
 */
function milledThisWayCount(ctx: HoleCtx, pos: number): Alt[] {
  // edh-c-21 (CR 701.17a, 608.2c; Colossal Badger's Dig Deep): or the mill is an earlier instruction of the same sentence ("Mill four cards, then put a +1/+1 counter on that creature for each creature card milled this way")
  const milledEarlier = ctx.discourse?.milled === true || ctx.toks.slice(0, pos).some((t) => t.norm === 'mill' || t.norm === 'mills');
  if (!milledEarlier || ctx.toks[pos - 2]?.norm !== 'for' || ctx.toks[pos - 1]?.norm !== 'each') return [];
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
const W_THAT_DAMAGE = P('that damage'); // edh-replace-2
const W_DAMAGE_THOSE_DEALT = [P('the amount of damage those creatures dealt to that player'), P('the damage those creatures dealt to that player'), P('the amount of damage it dealt to that player'), P('the amount of damage ~ dealt to that player')]; // edh-replace-2; edh-d-11 (Mask of the Schemer): one creature's own damage, "it dealt"
const W_COUNTER_REMOVED_THIS_WAY = P('counter removed this way');
const W_COUNTERS_REMOVED_THIS_WAY = P('counters removed this way');
const W_TIMES_RESOLVED = P('the number of times this ability has resolved this turn'); // edh-c-89

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
const W_AMOUNT_OF_MANA = P('the amount of mana'); // edh-d-90
const W_PRODUCED = P('produced'); // edh-d-90
const W_SNOW_SPENT = P('{s} spent to cast'); // edh-zones-26
const W_AMOUNT_SNOW_SPENT = P('the amount of {s} spent to cast'); // edh-zones-26
const W_EACH_COLOR_SPENT = P('each color of mana spent to cast');
const W_COLOR_SPENT = P('color of mana spent to cast'); // edh-c-27
const W_THAT_SPELL = P('that spell');
const W_MODES_CHOSEN = P('the number of times you chose a mode for'); // Standard round 3, r3-trig

/**
 * edh-top-7 (CR 601.2i, 608.2h, 700.8; Rionya, Fire Dancer, Ral, Monsoon Mage, Sorcerer Class): "the number of instant and sorcery spells you've cast this turn", "for each instant and
 * sorcery spell you've cast this turn": the spells of the description you cast this turn (the turn's history of cast events, one entry for each; a copy is not cast, CR 707.10). Only a
 * spell description of card types (and "non" types) alone, said "spell(s)": no zone, no controller, no characteristic of its own.
 */
function spellsYouCast(ctx: HoleCtx, f: { end: number; value: unknown; flags?: string[] }): Alt | null {
  const filter = f.value as ObjectFilter;
  if (filter.stackKind !== 'spell' || filter.zone !== 'stack') return null;
  const { stackKind: _k, zone: _z, ...spell } = filter;
  if (Object.keys(spell).some((k) => k !== 'types' && k !== 'notTypes') || (spell.types ?? spell.notTypes) === undefined) return null;
  const e = phraseAt(ctx, f.end, P("you've cast this turn"));
  if (e < 0) return null;
  return { end: e, value: { q: 'happenedCount', event: { ev: 'cast', player: 'you', spell }, scope: 'turn', by: 'you' }, ...(f.flags ? { flags: f.flags } : {}) };
}

const W_CAST_BEFORE_THAT_SPELL = P('cast before that spell this turn'); // edh-next-147
/**
 * edh-next-147 (CR 601.2i, 603.4, 702.40a; Sentinel Tower): "the number of instant and sorcery spells cast before that spell this turn", in an ability triggered by a cast: the spells of
 * a card type (or several) cast this turn by any player BEFORE the triggering spell (the history's cast entries before its own, `beforeEvent`, as "you've cast before it this turn"
 * reads them, FAST5 T45), so a spell cast in response is not counted and the triggering spell is not counted either.
 */
function spellsCastBefore(ctx: HoleCtx, f: { end: number; value: unknown; flags?: string[] }): Alt | null {
  const filter = f.value as ObjectFilter;
  
  if (filter.stackKind !== 'spell' || filter.zone !== 'stack') return null;
  const { stackKind: _k, zone: _z, ...spell } = filter;
  if (Object.keys(spell).some((k) => k !== 'types' && k !== 'notTypes') || (spell.types ?? spell.notTypes) === undefined) return null;
  const e = phraseAt(ctx, f.end, W_CAST_BEFORE_THAT_SPELL);
  if (e < 0) return null;
  return { end: e, value: { q: 'happenedCount', event: { ev: 'cast', player: 'any', spell }, scope: 'turn', beforeEvent: true }, ...(f.flags ? { flags: f.flags } : {}) };
}

/** "the number of spells you've cast this turn", "the number of creatures that died this turn", ... (history quantities of the model). */
function historyCounts(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const spells = phraseAt(ctx, pos, P("spells you've cast this turn"));
  if (spells >= 0) out.push({ end: spells, value: { q: 'spellsCastThisTurn' } });
  // edh-next-88 (CR 601.2a, 601.2i, 608.2h; Impending Flux): "the number of spells you've cast from anywhere other than your hand this turn": the turn's cast events whose spell was not cast
  // from the hand (the cast event's `notFrom`, r5-trig), one history entry for each
  const notHand = phraseAt(ctx, pos, P("spells you've cast from anywhere other than your hand this turn"));
  if (notHand >= 0) out.push({ end: notHand, value: { q: 'happenedCount', event: { ev: 'cast', player: 'you', notFrom: 'hand' }, scope: 'turn', by: 'you' } });
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
  // edh-cast-8: "the number of cards your opponents have drawn this turn" (the same count as "for each card your opponents have drawn this turn")
  const oppCards = phraseAt(ctx, pos, P('cards your opponents have drawn this turn'));
  if (oppCards >= 0) out.push({ end: oppCards, value: { q: 'happenedCount', event: { ev: 'draw', player: 'opponent' }, scope: 'turn' } });
  // edh-players-12 (CR 121.1, 608.2h; Molten Psyche): "the number of cards that player has drawn this turn": a player pronoun (parser/lower/anaphora.ts#groupChooser: the players
  // of a group step, else the antecedent), one history entry per card drawn
  const thatDrawn = phraseAt(ctx, pos, P('cards that player has drawn this turn'));
  if (thatDrawn >= 0) out.push({ end: thatDrawn, value: { q: 'happenedCount', event: { ev: 'draw', player: anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }) as PlayerRef }, scope: 'turn' } });
  // edh-next-68 (CR 400.7, 404.1; Welcome the Dead): "the number of cards that were put into your graveyard from your hand or library this turn": every such move of this turn, counted from the
  // history (a card that left the graveyard again still counts)
  const handLib = phraseAt(ctx, pos, P('cards that were put into your graveyard from your hand or library this turn'));
  if (handLib >= 0) out.push({ end: handLib, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { isCard: true, owner: 'you' }, from: ['hand', 'library'], to: 'graveyard' }, scope: 'turn' } });
  const life = phraseAt(ctx, pos, P("life you've gained this turn"));
  if (life >= 0) out.push({ end: life, value: { q: 'lifeGainedThisTurn' } });
  // trek-7 (CR 700.2; Captain Benjamin Sisko): "the number of dilemmas you've faced this turn": the times you chose one or more modes for a spell or ability this turn
  // (the history's faceDilemma action entries, one for each choice, rules/crime.ts#emitDilemma)
  const dil = anyPhraseAt(ctx, pos, W_DILEMMAS_YOU_FACED_THIS_TURN);
  if (dil >= 0) out.push({ end: dil, value: FACED_DILEMMAS_THIS_TURN() });
  // trek-7 (CR 506.3, 508.1; Worf, Defiant Commander): "the number of opponents you attacked this turn": the different opponents that creatures you controlled were
  // declared attacking this turn (a planeswalker or battle attacked is not its player), read from the history as melee's count of one combat is
  const opp = anyPhraseAt(ctx, pos, W_OPPONENTS_YOU_ATTACKED_THIS_TURN);
  if (opp >= 0) out.push({ end: opp, value: { q: 'opponentsAttacked', scope: 'turn' } });
  // edh-next-98 (CR 506.3, 508.1; Dimir Strandcatcher): "the number of opponents being attacked" in an attack trigger: the different opponents that creatures you control were declared attacking
  // in this combat (the count of melee, q:opponentsAttacked without a scope)
  const being = phraseAt(ctx, pos, P('opponents being attacked'));
  if (being >= 0) out.push({ end: being, value: { q: 'opponentsAttacked', present: true } });
  // FAST5X E22 (CR 700.11): "the number of times you descended this turn" = the permanent cards put into your graveyard from anywhere this turn
  const desc = phraseAt(ctx, pos, P('times you descended this turn'));
  if (desc >= 0) out.push({ end: desc, value: { q: 'descendedThisTurn' } });
  for (const f of ctx.call('Filter', pos)) {
    const typed = spellsYouCast(ctx, f); // edh-top-7
    if (typed !== null) out.push(typed);
    const before = spellsCastBefore(ctx, f); // edh-next-147
    if (before !== null) out.push(before);
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
    // pc-tokens-3 (CR 700.4, 400.3, 603.10a; Fresh Meat, Caller of the Claw): "for each nontoken creature put into your graveyard from the battlefield this turn": the
    // turn's zone changes from the battlefield to a graveyard of the permanents you own (a card goes to its owner's graveyard, CR 400.3); only a permanent kind
    const py = phraseAt(ctx, f.end, W_PUT_INTO_YOUR_GRAVEYARD_FROM_BATTLEFIELD_THIS_TURN);
    if (py >= 0 && filter.isCard === undefined && filter.stackKind === undefined && filter.zone === undefined && filter.controller === undefined && filter.owner === undefined) {
      out.push({ end: py, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { ...filter, owner: 'you' }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' }, ...(f.flags ? { flags: f.flags } : {}) });
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
    // edh-b-7 (CR 701.21a, 608.2h; The Balrog, Durin's Bane): "for each permanent sacrificed this turn": the sacrifices of the turn by any player (the same history, no actor)
    const sacAny = phraseAt(ctx, f.end, W_SACRIFICED_THIS_TURN);
    if (sacAny >= 0 && filter.isCard === undefined && filter.stackKind === undefined && filter.zone === undefined && filter.controller === undefined && filter.owner === undefined) {
      const object = isPermanentOnly(filter) ? {} : { object: filter };
      out.push({ end: sacAny, value: { q: 'happenedCount', event: { ev: 'action', verb: 'sacrifice', ...object }, scope: 'turn' }, ...(f.flags ? { flags: f.flags } : {}), weak: 1 });
    }
  }
  return out;
}

const W_DILEMMAS_YOU_FACED_THIS_TURN = [P("dilemmas you've faced this turn"), P('dilemmas you faced this turn'), P('dilemmas you have faced this turn')]; // trek-7
const W_DILEMMA_YOU_FACED_THIS_TURN = [P("dilemma you've faced this turn"), P('dilemma you faced this turn'), P('dilemma you have faced this turn')]; // trek-7
const FACED_DILEMMAS_THIS_TURN = (): Quantity => ({ q: 'happenedCount', event: { ev: 'action', verb: 'faceDilemma', actor: 'you' }, scope: 'turn' });
const W_OPPONENT_YOU_ATTACKED = [P('opponent you attacked this turn'), P("opponent you've attacked this turn"), P('opponent you attacked')]; // edh-players-14: after "for each"
const W_OPPONENTS_YOU_ATTACKED_THIS_TURN = [P('opponents you attacked this turn'), P("opponents you've attacked this turn"), P('opponents you have attacked this turn')]; // trek-7
const W_SACRIFICED_THIS_TURN = P('sacrificed this turn'); // edh-b-7
const W_YOU_SACRIFICED_THIS_TURN = [P("you've sacrificed this turn"), P('you sacrificed this turn')]; // std-r7
const W_DIED_UNDER = P('that died under'); // std-rc
const W_EXILED_UNDER = P('that were exiled under'); // std-rc
const W_YOUR_CONTROL_THIS_TURN = [P('your control this turn')]; // std-rc
const W_OPPONENTS_CONTROL_THIS_TURN = [P("your opponents' control this turn"), P("an opponent 's control this turn")]; // std-rc
/** std-r7: "permanents" with nothing else said (every permanent qualifies). */
const isPermanentOnly = (f: ObjectFilter): boolean => Object.entries(f).every(([k, v]) => v === undefined || (k === 'types' && Array.isArray(v) && v.length === 1 && v[0] === 'Permanent'));

const W_PUT_INTO_YOUR_GRAVEYARD_FROM_BATTLEFIELD_THIS_TURN = P('put into your graveyard from the battlefield this turn'); // pc-tokens-3
const W_PUT_INTO_GRAVEYARDS_FROM_BATTLEFIELD_THIS_TURN = P('that were put into graveyards from the battlefield this turn'); // r5-moved
const W_ENTERED_UNDER_YOUR_CONTROL = P('that entered the battlefield under your control this turn');
const W_YOU_HAD_ENTER_UNDER_YOUR_CONTROL = P('you had enter the battlefield under your control this turn'); // edh-perms-11 (Gyome, Master Chef)
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
    // edh-perms-11 (CR 603.6a, 603.4; Gyome, Master Chef): "the number of nontoken creatures you had enter the battlefield under your control this turn": the same history as
    // "creatures that entered the battlefield under your control this turn" (Landfall's "you had a land enter ..." wording, as parser/holes/cond.ts reads it)
    const h = phraseAt(ctx, f.end, W_YOU_HAD_ENTER_UNDER_YOUR_CONTROL);
    if (h >= 0) out.push({ end: h, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { ...filter, controller: 'you' }, to: 'battlefield' }, scope: 'turn' }, ...extra });
    // std-lci (CR 603.10a, 700.4): the objects that left the battlefield this turn (to any zone), under your control as they last existed there, or anyone's
    const l = phraseAt(ctx, f.end, W_LEFT_UNDER_YOUR_CONTROL);
    if (l >= 0) out.push({ end: l, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { ...filter, controller: 'you' }, from: 'battlefield' }, scope: 'turn' }, ...extra });
    const a = phraseAt(ctx, f.end, W_LEFT_THIS_TURN);
    if (a >= 0) out.push({ end: a, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: filter, from: 'battlefield' }, scope: 'turn' }, ...extra });
  }
  return out;
}

/** "the number of colors among ...", "... creature types among ...". */
function distinctCounts(ctx: HoleCtx, pos: number, afterForEach = false): Alt[] {
  const out: Alt[] = [];
  // CLOUD std-misc (CR 208.1): "the number of different powers among creatures you control"
  const kinds: [string[], 'colors' | 'cardTypes' | 'creatureTypes' | 'landTypes' | 'powers' | 'planeswalkerTypes' | 'counterKinds' | 'permanentTypes' | 'manaValues'][] = [[P('different mana values'), 'manaValues'] /* edh-next-77 (CR 202.3, 608.2h; All-Seeing Arbiter): "the number of different mana values among cards in your graveyard" */, [P('permanent types'), 'permanentTypes'] /* edh-c-44 (CR 110.4, 205.2a; Korvold, Gleeful Glutton): "the number of permanent types among cards in your graveyard" */, [P('colors'), 'colors'], [P('card types'), 'cardTypes'], [P('card type'), 'cardTypes'] /* edh-b-7: "for each card type among those cards" */, [P('creature types'), 'creatureTypes'], [P('land types'), 'landTypes'], [P('different powers'), 'powers'], [P('different kinds of counters'), 'counterKinds'] /* edh-c-14 (CR 122.1; Perrie, the Pulverizer) */,
    [P('planeswalker types'), 'planeswalkerTypes'] /* r5-fxb (CR 205.3j) */];
  for (const [ws, what] of kinds) {
    if (afterForEach !== (ws[0] === 'card' && ws[1] === 'type')) continue; // edh-b-7: the singular "card type" only right after "for each", the plural only after "the number of"
    const e = phraseAt(ctx, pos, ws);
    if (e < 0) continue;
    const a = phraseAt(ctx, e, W_AMONG);
    if (a < 0) continue;
    // (combined copy, batch 8) the singular "for each card type among ..." (edh-b-7) is weak: r3-moved's narrower "draw a card for each card type among" keeps its sentences
    for (const f of ctx.call('Filter', a)) out.push({ end: f.end, value: { q: 'distinct', what, among: each(f.value as ObjectFilter) }, ...(afterForEach ? { weak: 1 } : {}) });
    // edh-b-7 (CR 205.2a, 608.2c; Polluted Cistern): "for each card type among those cards": the card types among the cards an earlier part of the ability or its trigger named
    if (what === 'cardTypes') for (const o of ctx.call('Objs', a)) {
      const v = o.value as { $anaphor?: { number?: string; text?: string } };
      if (v.$anaphor?.text === 'those cards') out.push({ end: o.end, value: { q: 'distinct', what, among: o.value as never }, ...(afterForEach ? { weak: 1 } : {}) });
    }
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
const W_MANA_SYMBOLS_IN_COSTS_OF = P('mana symbols in the mana costs of'); // edh-c-37
const W_MANA_SYMBOL_IN_COSTS = P('mana symbol in the mana costs of permanents you control'); // edh-c-9
const W_COLOR_PAIRS_AMONG = P('different color pairs among');
const W_KIND_OF_COUNTER_ON = P('kind of counter on'); // edh-d-85
const W_EXACTLY_TWO_COLORS = P('that are exactly two colors');

/** The counters (of `kind`) on the object, objects or player at `pos` after the word "on" (CR 122.1): "the number of +1/+1 counters on ~", "for each counter on ~". */
function countersOnAt(ctx: HoleCtx, e: number, kind: string): Alt[] {
  const out: Alt[] = [];
  const o = phraseAt(ctx, e, P('on'));
  if (o < 0) return out;
  for (const r of ctx.call('Obj', o)) out.push({ end: r.end, value: { q: 'counters', on: r.value as never, kind }, ...(r.flags ? { flags: r.flags } : {}) });
  // r4-fxb (CR 122.1, 208.1): "the number of +1/+1 counters on lands you control" (Toph, the Blind Bandit): the counters on every object of a group, added up
  // (effects/eval.ts and statics/match.ts sum them); only a described group of permanents
  for (const r of ctx.call('Objs', o)) {
    const v = r.value as { ref?: string; filter?: { zone?: string } };
    if (v.ref === 'each' && v.filter !== undefined && (v.filter.zone === undefined || v.filter.zone === 'battlefield')) out.push({ end: r.end, value: { q: 'counters', on: r.value as never, kind }, ...(r.flags ? { flags: r.flags } : {}) });
  }
  for (const r of ctx.call('Player', o)) out.push({ end: r.end, value: { q: 'counters', on: r.value as never, kind } });
  return out;
}

/** pc-counters-3 (CR 122.1): "the number of counters among creatures you control" (Maester Seymour): the same group sum as "on creatures you control" (countersOnAt). */
function countersAmongAt(ctx: HoleCtx, e: number, kind: string): Alt[] {
  const out: Alt[] = [];
  const k = kind;
  const o = phraseAt(ctx, e, P('among'));
  if (o < 0) return out;
  // edh-next-26 (CR 122.1, 122.1b; Vault 12: The Necropolis): "the total number of rad counters among players": the counters of that kind on every player, added up
  for (const w of [P('players'), P('all players')]) { const pe = phraseAt(ctx, o, w); if (pe >= 0 && k !== 'any') out.push({ end: pe, value: { q: 'counters', on: { ref: 'each', who: 'player' } as never, kind } }); }
  const group = ctx.call('Objs', o);
  for (const r of group) {
    const v = r.value as { ref?: string; filter?: { zone?: string } };
    // edh-next-70 (CR 122.1; Dimension X Pizzasaur: "mana value less than or equal to the number of counters among permanents you control"): "you control" belongs to the group the counters are
    // among (its longest reading), not to the creature the sentence goes on to describe; a shorter reading of the group is the weaker one
    const shorter = group.some((x) => x.end > r.end);
    if (v.ref === 'each' && v.filter !== undefined && (v.filter.zone === undefined || v.filter.zone === 'battlefield')) out.push({ end: r.end, value: { q: 'counters', on: r.value as never, kind }, ...(shorter ? { weak: 1 } : {}), ...(r.flags ? { flags: r.flags } : {}) });
  }
  return out;
}

/** "the number of +1/+1 counters on ~", "... counters on target creature". */
function counterCounts(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const k of ctx.call('CounterKind', pos)) {
    const c = anyPhraseAt(ctx, k.end, W_COUNTER);
    if (c < 0) continue;
    out.push(...countersOnAt(ctx, c, k.value as string), ...countersAmongAt(ctx, c, k.value as string));
    out.push(...playerHasCounters(ctx, c, k.value as string, k.weak));
  }
  const c = anyPhraseAt(ctx, pos, W_COUNTER);
  if (c >= 0) out.push(...countersOnAt(ctx, c, 'any'), ...countersAmongAt(ctx, c, 'any'));
  // edh-perms-11 (CR 122.1, 603.10a, 608.2h; Felisa, Fang of Silverquill): "the number of counters it had on it": the counters of every kind the object had as it last existed
  // (a creature that died; effects/eval.ts reads the object's last known information), the object named by "it" / "that creature"
  if (c >= 0) for (const o of ctx.call('Obj', c)) {
    const e = phraseAt(ctx, o.end, W_HAD_ON_IT);
    if (e >= 0) out.push({ end: e, value: { q: 'counters', on: o.value as never, kind: 'any' }, ...(o.flags ? { flags: o.flags } : {}) });
  }
  return out;
}
const W_HAD_ON_IT = P('had on it'); // edh-perms-11

const W_DIFFERENCE_BETWEEN = P('the difference between'); // std-rx16
const W_DIFFERENCE_THOSE_PLAYERS_LIFE = P("the difference between those players' life totals"); // edh-b-9
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
  // edh-c-19 (CR 120.3, 208.1, 608.2c; Palazzo Archers): "~ deals damage equal to its power to that creature": the "its" of the subject that deals the damage is that subject (`selfFirst`:
  // chosen only among several candidates, lower/anaphora.ts), never the creature the damage goes to
  const dealsSelf = ctx.toks[pos - 5]?.kind === 'SELF' && ctx.toks.slice(pos - 4, pos).map((x) => x.norm).join(' ') === 'deals damage equal to';
  if (t === 'its') for (const s of statAt(ctx, pos + 1)) out.push({ end: s.end, value: { q: 'stat', stat: s.stat, of: anaphorObj({ sort: 'object', number: 'singular', text: 'it', ...(dealsSelf ? { selfFirst: true } : {}) }) } });
  // edh-next-133 (CR 208.1, 613.4b, 608.2h; Curie, Emergent Intelligence): "draw cards equal to its base power", "~'s base power": the power of one permanent after layer 7b (printed, or as an
  // effect that sets it made it), before modifications and counters (`basePower`, std-rx29's quantity)
  // review fix: never after a comparison ("power greater than its base power" is std-rx11's filter, powerGreaterThanBase; a second reading would be ambiguous, guard G5)
  const afterThan = ctx.toks[pos - 1]?.norm === 'than';
  if (t === 'its' && !afterThan) { const b = phraseAt(ctx, pos + 1, W_BASE_POWER_Q); if (b >= 0) out.push({ end: b, value: { q: 'basePower', of: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) } as never }); }
  if (!afterThan) for (const o of ctx.call('Obj', pos)) {
    if (ctx.toks[o.end]?.norm !== "'s") continue;
    const b = phraseAt(ctx, o.end + 1, W_BASE_POWER_Q);
    if (b >= 0) out.push({ end: b, value: { q: 'basePower', of: o.value as never } as never, ...(o.flags ? { flags: o.flags } : {}) });
  }
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
      // edh-players-21 (CR 608.2h, 101.4; Olórin's Searing Light): "the power of the creature they exiled": the creature each player of the group exiled (their own choice; the player is
      // `iterating` while the amount is read for each of them, as the exile step's group `perPlayer`); the group exile step of eff.edhp21.exile.ownPerPlayer.* binds it under that name (the lint refuses any other ability: the name must be bound)
      // edh-next-127 (CR 701.21a, 608.2h, 101.4; Danse Macabre): "the toughness of the creature you sacrificed this way": of what an earlier each-player sacrifice put into graveyards (the group, its
      // participle `sacrificedByEach`, parser/lower/mentions.ts#sacrificedByEachOf), the one you controlled as it last existed; none is 0 (`sum`; the ruling of 2021-07-23 adds nothing then)
      if (of >= 0 && ctx.toks[of]?.norm === 'the' && ctx.toks[of + 1]?.kind === 'WORD' && THEY_EXILED_NOUNS.has(ctx.toks[of + 1]!.norm) && ctx.toks[of + 2]?.norm === 'you' && ctx.toks[of + 3]?.norm === 'sacrificed') {
        const e = phraseAt(ctx, of + 4, W_THIS_WAY_Q);
        if (e >= 0) out.push({ end: e, value: { q: 'stat', stat: s.stat, of: anaphorObj({ sort: 'object', number: 'plural', participle: 'sacrificedByEach', text: 'the creature you sacrificed this way' }), by: { ref: 'you' }, sum: true } as never });
      }
      if (of >= 0 && ctx.toks[of]?.norm === 'the' && ctx.toks[of + 1]?.kind === 'WORD' && THEY_EXILED_NOUNS.has(ctx.toks[of + 1]!.norm)) {
        const e = phraseAt(ctx, of + 2, W_THEY_EXILED);
        if (e >= 0) out.push({ end: e, value: { q: 'stat', stat: s.stat, of: { ref: 'bound', name: OWN_EXILED }, by: { ref: 'iterating' } } as never });
      }
    }
    // FAST5X E15 (MX18; CR 208.1, 202.3): "the greatest / highest / least <stat> among <filter>", the `agg` of the model's `stat` quantity over the set
    const most = anyPhraseAt(ctx, the, W_MOST);
    if (most >= 0) {
      const agg = ctx.toks[the]?.norm === 'least' ? 'min' : 'max';
      for (const s of statAt(ctx, most)) {
        const among = phraseAt(ctx, s.end, W_AMONG);
        if (among >= 0) for (const f of ctx.call('Filter', among)) out.push({ end: f.end, value: { q: 'stat', stat: s.stat, of: each(commandersAnywhere(f.value as ObjectFilter)), agg } });
        // edh-next-126 (CR 601.2i, 608.2h; Lifestream's Blessing): "the greatest power among creatures you controlled as you cast ~": the same statistic of the permanents you controlled,
        // read when the spell became cast (`asCast`); only a description with no controller of its own, and only "as you cast" the object itself
        if (among >= 0) {
          for (const f of ctx.call('Filter', among)) {
            const e = phraseAt(ctx, f.end, W_YOU_CONTROLLED_AS_YOU_CAST);
            const fv = f.value as ObjectFilter;
            if (e < 0 || ctx.toks[e]?.kind !== 'SELF' || fv.controller !== undefined || fv.zone !== undefined) continue;
            out.push({ end: e + 1, value: { q: 'asCast', value: { q: 'stat', stat: s.stat, of: each({ ...fv, controller: 'you' }), agg } } as never });
          }
        }
        // edh-next-116 (CR 208.1, 608.2h, 400.1; Skanos Dragonheart): "the greatest power among other Dragons you control and Dragon cards in your graveyard": two descriptions in two zones (the
        // second names its zone, the first none: the battlefield), one set; weak, a plain coordination of one description keeps its reading
        if (among >= 0) {
          for (const f1 of ctx.call('Filter', among)) {
            const andAt = phraseAt(ctx, f1.end, W_AND);
            if (andAt < 0) continue;
            const a = f1.value as ObjectFilter;
            if (a.zone !== undefined || a.anyOf !== undefined || a.controller === undefined) continue; // (review: a first group with no controller would reach every graveyard)
            for (const g of ctx.call('Filter', andAt)) {
              const b = g.value as ObjectFilter;
              if (b.zone !== 'graveyard' || b.anyOf !== undefined) continue;
              out.push({ end: g.end, value: { q: 'stat', stat: s.stat, of: each({ anyOf: [a.other === true ? (({ other: _o, ...rest }) => rest)(a) : a, b], zone: ['battlefield', 'graveyard'], ...(a.other === true ? { other: true } : {}) }), agg }, weak: true } as never); // ("other" excludes the object itself, as on a plain filter)
            }
          }
        }
        // edh-next-99 (CR 208.1, 608.2h, 603.2; Aloy, Savior of Meridian): "the greatest power among them": the group a pronoun names (the creatures a trigger's event is about); the anaphora pass binds it or the sentence is manual
        const amongThem = phraseAt(ctx, s.end, W_AMONG_THEM);
        if (amongThem >= 0) out.push({ end: amongThem, value: { q: 'stat', stat: s.stat, of: anaphorObj({ sort: 'object', number: 'plural', text: 'them' }), agg } as never });
      }
    }
    // edh-c-5 (CR 208.1, 107.3; Freelance Muscle): "the greatest power and/or toughness among other creatures you control": the greater of the greatest power and the greatest toughness
    // among the set (one number: a creature's power or its toughness, whichever is the largest of all of them)
    if (ctx.toks[the]?.norm !== 'least') {
      const pt = most >= 0 ? phraseAt(ctx, most, W_POWER_AND_OR_TOUGHNESS) : -1;
      const among = pt >= 0 ? phraseAt(ctx, pt, W_AMONG) : -1;
      if (among >= 0) {
        for (const f of ctx.call('Filter', among)) {
          const of = each(commandersAnywhere(f.value as ObjectFilter));
          out.push({ end: f.end, value: { q: 'math', op: 'max', args: [{ q: 'stat', stat: 'power', of, agg: 'max' }, { q: 'stat', stat: 'toughness', of, agg: 'max' }] } });
        }
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
    // edh-cast-3 (CR 109.4, 601.2f; Cavern-Hoard Dragon): "the greatest number of artifacts an opponent controls": the most one opponent controls (not the total of all of them);
    // only the singular "an opponent controls" says it (the plural "your opponents control" would be a total)
    if (gn >= 0) {
      for (const f of ctx.call('Filter', gn)) {
        const fv = f.value as ObjectFilter;
        if (fv.controller === 'opponent' && ctx.toks[f.end - 1]?.norm === 'controls' && ctx.toks[f.end - 2]?.norm === 'opponent' && ctx.toks[f.end - 3]?.norm === 'an') {
          out.push({ end: f.end, value: { q: 'mostByController', of: each(fv) }, ...(f.flags ? { flags: f.flags } : {}) });
        }
        // edh-next-21 (CR 109.4, 608.2h; Investigator's Journal): "the greatest number of creatures a player controls": the most one player (any player, you included) controls
        const aPlayer = fv.controller === undefined ? phraseAt(ctx, f.end, W_A_PLAYER_CONTROLS) : -1;
        if (aPlayer >= 0) out.push({ end: aPlayer, value: { q: 'mostByController', of: each(fv) }, ...(f.flags ? { flags: f.flags } : {}) });
      }
    }
    // edh-c-46 (CR 121.1, 608.2h; Thought Sponge): "the greatest number of cards an opponent has drawn this turn": the most draws any one opponent made this turn
    // (`per: 'player'` is the maximum over the players, `by` limits them to the controller's opponents)
    const mostOppDrawn = gn >= 0 ? phraseAt(ctx, gn, P('cards an opponent has drawn this turn')) : -1;
    if (mostOppDrawn >= 0) out.push({ end: mostOppDrawn, value: { q: 'happenedCount', event: { ev: 'draw' }, scope: 'turn', per: 'player', by: 'opponent' } });
    if (ctx.toks[the]?.norm === 'total') {
      for (const s of statAt(ctx, the + 1)) {
        const of = phraseAt(ctx, s.end, W_OF);
        if (of >= 0) for (const f of ctx.call('Filter', of)) out.push({ end: f.end, value: { q: 'stat', stat: s.stat, of: each(f.value as ObjectFilter), sum: true } });
        // edh-d-92 (CR 208.1, 700.4, 603.10a, 608.2h; Genesis of the Daleks): "the total power of Daleks that died this turn": the powers of the creatures of that description that died
        // this turn added up, each as it last existed on the battlefield (the turn's zone-change history, the entry's `power` fact; rules/history.ts#sumHistory `sum: 'power'`)
        if (of >= 0 && s.stat === 'power') for (const f of ctx.call('Filter', of)) {
          const fv = f.value as ObjectFilter;
          const e = phraseAt(ctx, f.end, W_THAT_DIED_THIS_TURN);
          if (e >= 0 && fv.isCard === undefined && fv.zone === undefined && fv.stackKind === undefined) out.push({ end: e, value: { q: 'happenedCount', event: { ev: 'zoneChange', subject: fv.types === undefined ? { ...fv, types: ['Creature'] } : fv, from: 'battlefield', to: 'graveyard' }, scope: 'turn', sum: 'power' } });
        }
        // r5-fxb (CR 208.1, 603.10a, 608.2h): "the total power of those creatures": a group the sentence refers to (the creatures a batch trigger saw die, read as
        // they last existed); a described group is the Filter reading above
        if (of >= 0) for (const o of ctx.call('Objs', of)) if ((o.value as { ref?: string }).ref !== 'each') out.push({ end: o.end, value: { q: 'stat', stat: s.stat, of: o.value as never, sum: true }, ...(o.flags ? { flags: o.flags } : {}) });
        // edh-zones-26 (CR 202.3, 608.2c; Dance with Calamity): "the total mana value of the cards exiled this way": the group a step of the ability moved, with its article
        const ofThe = of >= 0 ? phraseAt(ctx, of, P('the')) : -1;
        // edh-d-17 (CR 208.1, 608.2c, 701.21a; Reign of the Pit): and "the total power of the creatures sacrificed this way": the described group of the sacrifice, as without "the"
        if (ofThe >= 0) for (const f of ctx.call('Filter', ofThe)) if (JSON.stringify(f.value).includes('"sacrificed"')) out.push({ end: f.end, value: { q: 'stat', stat: s.stat, of: each(f.value as ObjectFilter), sum: true } });
        if (ofThe >= 0) for (const o of ctx.call('Objs', ofThe)) if (JSON.stringify(o.value).includes('this way') || (o.value as { $anaphor?: { participle?: string } }).$anaphor?.participle === 'discarded' /* edh-c-44 (CR 202.3, 601.2b, 608.2h; Nahiri's Wrath): "the total mana value of the discarded cards", the cards discarded to pay the spell's additional cost */) out.push({ end: o.end, value: { q: 'stat', stat: s.stat, of: o.value as never, sum: true }, ...(o.flags ? { flags: o.flags } : {}) });
      }
    }
  }
  return out;
}

const W_AS_TURN_BEGAN = P('as the turn began'); // edh-next-19

function lifeTotals(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const p of possessivePlayerAt(ctx, pos)) {
    if (p.ref.ref === 'each') continue; // the evaluator reads the life total of ONE player; "each opponent's life total" is not a number
    const e = phraseAt(ctx, p.end, W_LIFE_TOTAL);
    if (e >= 0) out.push({ end: e, value: { q: 'life', of: p.ref } });
    // edh-next-19 (CR 119.1, 500.1; Sengir, the Dark Baron): "that player's life total as the turn began"
    const tb = e >= 0 ? phraseAt(ctx, e, W_AS_TURN_BEGAN) : -1;
    if (tb >= 0) out.push({ end: tb, value: { q: 'life', of: p.ref, atTurnStart: true } });
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

/** edh-c-59 (CR 402.1, 608.2h; Adamaro): the largest hand among the opponents, a count of cards (`zoneSize` over a group of players with `agg: 'max'`). */
function mostCardsInHand(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_MOST_CARDS_IN_HAND);
  return e >= 0 ? [{ end: e, value: { q: 'zoneSize', zone: 'hand', of: { ref: 'each', who: 'opponent' }, agg: 'max' } }] : [];
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
    // edh-next-39 (CR 107.3; Prophet of the Scarab): also two computed quantities, "the number of Zombies you control or the number of Zombie cards in your graveyard, whichever is greater"
    if (ctx.toks[a.end]?.norm !== 'or') continue;
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
export function landsOnly(f: ObjectFilter): boolean {
  return Object.entries(f).every(([k, v]) => v === undefined || k === 'controller' || (k === 'types' && Array.isArray(v) && v.length === 1 && v[0] === 'Land'))
    && Array.isArray(f.types);
}

/** Standard round 6 (CR 305.6): domain over the lands of `f`, the sum of `min(1, count)` of those lands with each basic land type (FAST3 T12's JSON). */
export function domain(f: ObjectFilter): Quantity {
  return { q: 'math', op: '+', args: BASIC_LAND_TYPES.map((t) => ({ q: 'math', op: 'min', args: [1, { q: 'count', of: { ref: 'each', filter: { ...f, subtypes: [t] } } }] }) as Quantity) };
}
