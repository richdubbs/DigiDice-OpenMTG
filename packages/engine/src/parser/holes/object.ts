/**
 * Hole grammars `Obj`, `Objs` and `Recipient` (design 6.3). Owner: WP6.
 *
 * `Obj` is one object reference: `~`, a pronoun or "that creature" (anaphor marker), "enchanted creature" (`attachedTo`), "the top card of your library",
 * or a target phrase (a `$target` marker with min/max, see core.ts). `Objs` adds sets: "each creature you control", "all other creatures", bare plurals
 * ("creatures you control"), "two target creatures", "them", unions of determiner-led phrases. `Recipient` is what damage and similar steps are aimed
 * at: a player, an object, "any target", "target player or planeswalker". Rules: CR 115.1 and 115.4 (targets, "any target"), CR 601.2c (variable numbers of targets),
 * CR 608.2c-h ("it" and "that creature" refer to earlier objects, resolved by the anaphora pass), CR 303.4 / 301.5 ("enchanted", "equipped").
 */
import type { ObjectFilter, PlayerPred, PlayerRef, Quantity } from '../../types/ability';
import type { Alt, HoleCtx, HoleFn, TargetPhrase } from './core';
import { P, anyPhraseAt, anaphorObj, anaphorQty, cmpAt, dedupe, linkedObj, mergeFilter, numberAt, phraseAt, spanOf, targetRef } from './core';
import type { NpAlt } from './filter';
import { EXILED_THIS_WAY, REVEALED_THIS_WAY, featureAt, headNounAt, npAlts, postModAt } from './filter';
import { targetDets } from './target';
import type { TargetDet } from './target';
import { voteObjsAt } from './vote';
import { typedCardsExiledThisWay } from './edhc2';
import { bareCardsExiledThisWay } from './edhn108';
import { thatCardFromGraveyard } from './edhz5'; // edh-zones-5

const W_IT = P('it');
const W_THEIR_HAND = P('their hand');
// FAST5 T41: a character card's own pronoun ("Whenever ~ attacks alone, he gets +2/+0", "Put a +1/+1 counter on Crossbones. He deals 2 damage to each opponent"): Oracle uses "he" and "she" for the character the card is, so it is the object itself; the render gate accepts them only for the object itself on a legendary creature (render/refs.ts)
const W_HE = [P('he'), P('she')];
// FAST5 T61: "him" and "her", the object forms of the same pronouns: the object itself ("Put a +1/+1 counter on her"; render/refs.ts#selfAgain accepts them for a legendary creature only)
const W_HER = [P('her'), P('him')];
const W_THEM = P('them');
const W_THAT_ATTACKING_CREATURE = P('that attacking creature');
const W_THAT = P('that');
const PERMANENT_CARD_TYPES: readonly string[] = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker']; // edh-replace-4: what "permanent card" means (CR 110.1, 300.1)
const W_THAT_CARD = P('that card');
const W_THAT_TARGET = P('that target'); // edh-c-9
const W_BOTH_CARDS = P('both cards'); // edh-zones-9
const W_THOSE = P('those');
const W_THE_TOKENS = P('the tokens'); // edhn95
const W_THE_OTHER_CREATURES = P('the other creatures'); // std-mkm
const W_CARDS_EXILED_THIS_WAY = P('cards exiled this way'); // r5-moved
const W_SPELL_OR_ABILITY = P('spell or ability');
const W_FROM_SINGLE_GRAVEYARD = P('from a single graveyard');
const W_FROM_YOUR_GRAVEYARD = P('from your graveyard'); // Cloud std-eoe
const W_FROM_GRAVEYARDS = P('from graveyards'); // edh-top-16
/** FAST5 T66 (CR 115.1): "with total mana value 6 or less" after a plural target phrase, and the statistic each wording sums. */
const W_WITH_TOTAL = P('with total');
/** FAST5 T66 (CR 205.2a, 115.1): "two target nonland permanents that share a card type". */
const W_SHARE_CARD_TYPE = P('that share a card type');
const W_SHARE_PERMANENT_TYPE = P('that share a permanent type'); // edh-next-54 (CR 110.4)
const W_OF_EACH_CARD_TYPE = P('of each card type'); // std-cardcopy-7
/** CLOUD std-tmt (CR 115.1, 110.2): "two target creatures controlled by different players". */
const W_CONTROLLED_BY_DIFFERENT_PLAYERS = [P('controlled by different players'), P('with different controllers') /* edh-next-84 (Cloud's Limit Break) */];
const W_CONTROLLED_BY_THE_SAME_OPPONENT = P('controlled by the same opponent'); // std-rx30
const W_CONTROLLED_BY_THE_SAME_PLAYER = P('controlled by the same player'); // edh-c-74
const W_WITH_EQUAL_TOUGHNESS = P('with equal toughness'); // edh-next-126
const W_CHOSEN_AT_RANDOM = P('chosen at random'); // p2-damage-2
/** edh-d-87 (Bladegriff Prototype). */
const W_OF_THAT_PLAYERS_CHOICE_ANY_OPPONENT = P("of that player 's choice that one of your opponents controls");
const W_OF_THEIR_CHOICE = P('of their choice'); // edh-c-103
const W_OF_AN_OPPONENTS_CHOICE = P("of an opponent 's choice"); // edh-d-74
const W_OF_AN_OPPONENTS_CHOICE_THEY_CONTROL = P("of an opponent 's choice they control"); // edh-next-146
const W_WITH_THE_GREATEST = (stat: string): string[] => P(`with the greatest ${stat}`); // edh-c-14
const GROUP_STATS: readonly [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('mana value'), 'manaValue'], [P('power'), 'power'], [P('toughness'), 'toughness']];
const W_THE = P('the');
/** trek-13 (CR 607.2a; The Best of Both Worlds): the creature another ability of the face assimilated, read through the link `assimilated` (parser/parse.ts#linkAssimilated). */
const W_ASSIMILATED_WITH_SELF = [P('the borg assimilated with ~'), P('the creature assimilated with ~')];
const W_USED_TO_CRAFT_IT = [P('the exiled card used to craft it'), P('the exiled cards used to craft it') /* std-craft-1 */, P('the exiled cards used to craft ~') /* std-craft-1 */]; // std-rh
/** std-rx10 (CR 608.2c): the controller words of "the creature you control" after a sentence that announced targets of both sides, with the `controls` they mean. */
const W_CONTROLS: [string[], 'you' | 'notYou' | 'opponent'][] = [[P('you control'), 'you'], [P("you don't control"), 'notYou'], [P('an opponent controls'), 'opponent']];
const W_EACH = P('each');
const W_ALL = P('all');
const W_EVERY = P('every');
const W_OTHER = P('other');
const W_ANY_TARGET = P('any target');
const W_THAT_ISNT = P("that isn't"); // FAST4 T34
const W_THAT_WAS_DEALT_DAMAGE = P('that was dealt damage this turn'); // edh-next-86 (Needle Drop)
const W_ANY_OTHER_TARGET = P('any other target');
const W_ANOTHER_TARGET = P('another target'); // edh-c-53
const W_A_THIRD_TARGET = P('a third target'); // edh-c-53
/** MX3 (CR 701.54e): "your Ring-bearer", the permanent that is your Ring-bearer now (one or none). */
const W_YOUR_RING_BEARER = P('your ring-bearer');
const W_TOP = P('the top');
const TOP_CARD_TYPES: Record<string, string> = { creature: 'Creature', artifact: 'Artifact', enchantment: 'Enchantment', land: 'Land', instant: 'Instant', sorcery: 'Sorcery', planeswalker: 'Planeswalker' }; // edhn78
const W_BOTTOM = P('the bottom'); // edh-next-43
const W_EACH_OF_THOSE_OPPONENTS_LIBRARIES = P("each of those opponents' libraries"); // edh-top-6
const W_THAT_MANY_FROM_TOP = P('that many cards from the top of'); // std-lci
const W_OF = P('of');
const W_LIBRARY = P('library');
const W_GRAVEYARD_WORD = P('graveyard'); // edh-c-73
const W_CARD = [P('card'), P('cards')];
const W_AND_OR = [P('and'), P('or')];
const W_OR = P('or');
/** p2-modal-1 (CR 702.62b): a suspended card, a card in exile with suspend and a time counter on it (a card with no time counter is not suspended). */
export const SUSPENDED_CARD: ObjectFilter = { zone: 'exile', isCard: true, keyword: 'suspend', counters: { kind: 'time' } };
const W_OR_SUSPENDED_CARD = P('or suspended card');
const W_FROM_BATTLEFIELD_AND_OR = P('from the battlefield and/or'); // std-rx30
/** FAST4 T19: the heads "that X or Y" may join: permanent card types (CR 110.4). */
const OR_HEADS: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

const W_ARTIFACT_CREATURE = P('artifact creature');
const ATTACHED = ['enchanted', 'equipped', 'fortified'];
for (const w of ATTACHED) P(w);
// FAST4 T33: 'blocking', "the blocking creature" of a block trigger (the blocker, CR 509.1; lower/scope.ts gives that role the verb)
// CLOUD C8: 'tapped', "the tapped creature" of a cost that taps one (lower/ability.ts#tappedMentions, CR 602.2b)
const PARTICIPLES = ['exiled', 'sacrificed', 'revealed', 'discarded', 'returned', 'destroyed', 'chosen', 'countered', 'milled', 'created', 'cloaked', 'manifested', 'blocking', 'amassed', 'blighted' /* CLOUD std-ecl */, 'tapped' /* CLOUD C8 */, 'discovered' /* r4-mech */];
for (const w of PARTICIPLES) P(w);

export const spec = (f: ObjectFilter, head: NpAlt['head']): { kind: TargetPhrase['kind']; filter?: ObjectFilter } => {
  const g: ObjectFilter = { ...f };
  let kind: TargetPhrase['kind'] = 'object';
  if (head === 'spell') { kind = 'spell'; if (g.zone === 'stack') delete g.zone; delete g.stackKind; }
  else if (head === 'ability') { kind = 'ability'; if (g.zone === 'stack') delete g.zone; if (g.stackKind === 'ability') delete g.stackKind; }
  else if (head === 'stackObject') { kind = 'stackObject'; if (g.zone === 'stack') delete g.zone; }
  return Object.keys(g).length === 0 ? { kind } : { kind, filter: g };
};

// ---------------------------------------------------------------------------
// target phrases
// ---------------------------------------------------------------------------

const W_SPELL_OR_PERMANENT = P('spell or permanent');
const W_SPELL_OR = P('spell or'); // FAST5 T59
const W_OR_SPELL = P('or spell'); // std-rw6
/** M6-8: "target spell or permanent" (CR 115.1, 612.1): an object on the stack that is not an ability, or a permanent. Singular only. */
export const SPELL_OR_PERMANENT: ObjectFilter = { zone: ['stack', 'battlefield'] };
/** FAST5 T66 (CR 115.1, 612.1, 304.1): "target spell or nonland permanent": a spell (never a land: a land is played, not cast) or a permanent that is not a land. Singular only. */
const W_SPELL_OR_NONLAND_PERMANENT = P('spell or nonland permanent');
export const SPELL_OR_NONLAND_PERMANENT: ObjectFilter = { zone: ['stack', 'battlefield'], notTypes: ['Land'] };
/** edh-d-96 (CR 115.1, 400.1, 608.2b; Endless Detour): "target spell, nonland permanent, or card in a graveyard": a spell or nonland permanent (as T66's), or a card in any graveyard. Singular only. */
const W_SPELL_NONLAND_PERMANENT_OR_GRAVEYARD_CARD = P('spell , nonland permanent , or card in a graveyard');
export const SPELL_NONLAND_PERMANENT_OR_GRAVEYARD_CARD: ObjectFilter = { zone: ['stack', 'battlefield', 'graveyard'], anyOf: [{ ...SPELL_OR_NONLAND_PERMANENT }, { zone: 'graveyard', isCard: true }] };

/** edh-cast-2 (CR 115.1, 109.4, 608.2b): the controller said after "spell or nonland permanent" holds for both halves, a spell and a permanent (Sink into Stupor). */
const W_OPPONENT_CONTROLS = P('an opponent controls');
const W_YOU_DONT_CONTROL = P("you don't control");

const W_ACTIVATED_ABILITY = P('activated ability');
const W_TRIGGERED_ABILITY = P('triggered ability');
const W_COMMA_OR = P(', or');
const W_COMMA = P(',');

/** cloud std-spm (CR 113.3b-c, 115.1): one item of a list of things on the stack: "<description> spell", "activated ability", "triggered ability". */
function stackItemsAt(ctx: HoleCtx, pos: number): { end: number; item: ObjectFilter }[] {
  const out: { end: number; item: ObjectFilter }[] = [];
  const a = phraseAt(ctx, pos, W_ACTIVATED_ABILITY);
  if (a >= 0) out.push({ end: a, item: { stackKind: 'activatedAbility' } });
  const t = phraseAt(ctx, pos, W_TRIGGERED_ABILITY);
  if (t >= 0) out.push({ end: t, item: { stackKind: 'triggeredAbility' } });
  for (const n of npAlts(ctx, pos, { preOnly: true })) {
    if (n.number !== 'singular' || n.head !== 'spell' || n.flags.length > 0) continue;
    const { zone, ...f } = n.filter; // every item is on the stack (the target kind says so)
    if (zone !== 'stack' || f.stackKind !== 'spell' || f.anyOf !== undefined) continue;
    out.push({ end: n.end, item: f });
  }
  return out;
}

/**
 * cloud std-spm (CR 115.1, 113.3b-c, 601.2c, 701.6a): "target instant spell, sorcery spell, or triggered ability", "target spell, activated ability, or triggered
 * ability", "target triggered ability or colorless spell": one object on the stack that is any of the listed spells or kinds of ability. Oracle's list ("A or B",
 * "A, B, or C"), with at least one spell and at least one kind of ability: a list of one head noun is the noun phrase's ("instant or sorcery spell", "activated or
 * triggered ability"), and "spell or ability" is any object on the stack.
 */
function stackItemLists(ctx: HoleCtx, pos: number): { end: number; items: ObjectFilter[] }[] {
  const out: { end: number; items: ObjectFilter[] }[] = [];
  const walk = (p: number, items: ObjectFilter[], last: boolean): void => {
    for (const it of stackItemsAt(ctx, p)) {
      const list = [...items, it.item];
      if (last) {
        // edh-cast-15 (CR 115.1, 601.2c; Subtlety): or two or more kinds of spell, "target creature spell or planeswalker spell"
        if ((list.some((x) => x.stackKind === 'spell') && list.some((x) => x.stackKind !== 'spell')) || (list.length >= 2 && list.every((x) => x.stackKind === 'spell'))) out.push({ end: it.end, items: list });
        continue;
      }
      if (list.length > 5) continue;
      const commaOr = phraseAt(ctx, it.end, W_COMMA_OR);
      if (commaOr >= 0 && list.length >= 2) walk(commaOr, list, true);
      const or = phraseAt(ctx, it.end, W_OR);
      if (or >= 0 && list.length === 1) walk(or, list, true);
      const comma = phraseAt(ctx, it.end, W_COMMA);
      if (comma >= 0 && commaOr < 0) walk(comma, list, false);
    }
  };
  walk(pos, [], false);
  return out;
}

function targetObjects(ctx: HoleCtx, pos: number, onlySingular: boolean): Alt[] {
  const out: Alt[] = [];
  for (const d of targetDets(ctx, pos)) {
    if (onlySingular && d.number !== 'singular') continue;
    // cloud std-spm: a list of spells and kinds of ability, one target on the stack (see stackItemLists)
    if (d.number === 'singular' && !d.eachOf) {
      for (const l of stackItemLists(ctx, d.end)) {
        const phrase: TargetPhrase = { kind: 'stackObject', filter: { anyOf: l.items }, min: d.min, max: d.max, text: spanOf(ctx, pos, l.end), ...(d.another ? { another: true } : {}) };
        out.push({ end: l.end, value: targetRef(phrase) });
      }
    }
    const sp = d.number === 'singular' && !d.eachOf ? phraseAt(ctx, d.end, W_SPELL_OR_PERMANENT) : -1;
    if (sp >= 0) {
      const phrase: TargetPhrase = { kind: 'object', filter: { zone: ['stack', 'battlefield'] }, min: d.min, max: d.max, text: spanOf(ctx, pos, sp), ...(d.another ? { another: true } : {}) };
      out.push({ end: sp, value: targetRef(phrase) });
      // edh-c-46 (CR 115.1, 202.3, 608.2b; Divide by Zero): "target spell or permanent with mana value 1 or greater": a spell's or permanent's mana value is the one compared, so the
      // comparison holds for both halves (read only for the mana value; other post-modifiers would hold for one half only)
      if (ctx.toks[sp]?.norm === 'with') {
        for (const f of featureAt(ctx, sp + 1, false)) {
          const keys = Object.keys(f.frag);
          if (keys.length !== 1 || keys[0] !== 'manaValue') continue;
          out.push({ end: f.end, value: targetRef({ ...phrase, filter: { ...SPELL_OR_PERMANENT, ...f.frag }, text: spanOf(ctx, pos, f.end) }) });
        }
      }
    }
    // FAST5 T59 (CR 115.1, 608.2b): "target spell or creature" (Fatehold Charm): a spell on the stack (not an ability), or a permanent on the battlefield of that description. The
    // spell is any spell, so each half names its own zone; singular only, and the description is read without post-modifiers (they would hold for one half only)
    // (FAST5 batch 9 integration: "spell or nonland permanent" is T66's exact filter below, one reading only)
    const so = d.number === 'singular' && !d.eachOf && phraseAt(ctx, d.end, W_SPELL_OR_NONLAND_PERMANENT) < 0 ? phraseAt(ctx, d.end, W_SPELL_OR) : -1;
    if (so >= 0) {
      for (const n of npAlts(ctx, so, { preOnly: true })) {
        if (n.number !== 'singular' || (n.head !== 'type' && n.head !== 'permanent') || n.flags.length > 0 || n.filter.zone !== undefined || Object.keys(n.filter).length === 0) continue;
        const phrase: TargetPhrase = {
          kind: 'object', filter: { zone: ['stack', 'battlefield'], anyOf: [{ stackKind: 'spell', zone: 'stack' }, { ...n.filter, zone: 'battlefield' }] },
          min: d.min, max: d.max, text: spanOf(ctx, pos, n.end), ...(d.another ? { another: true } : {}),
        };
        out.push({ end: n.end, value: targetRef(phrase) });
      }
    }
    // edh-c-88 (CR 115.1, 105.2, 608.2b; Aether Gust): "target spell or permanent that's red or green": one target, a spell or a permanent with one of those colors (a color is a
    // characteristic of both halves, so the words after "permanent" hold for both; a color BEFORE "permanent" would hold for one half only and is no reading of this)
    if (d.number === 'singular' && !d.eachOf && ctx.toks[d.end + 2]?.norm === 'permanent' && phraseAt(ctx, d.end, W_SPELL_OR) >= 0) {
      for (const n of npAlts(ctx, d.end + 2)) {
        if (n.number !== 'singular' || n.head !== 'permanent' || n.flags.length > 0 || Object.keys(n.filter).join() !== 'colors') continue;
        const phrase: TargetPhrase = { kind: 'object', filter: { zone: ['stack', 'battlefield'], colors: n.filter.colors }, min: d.min, max: d.max, text: spanOf(ctx, pos, n.end), ...(d.another ? { another: true } : {}) };
        out.push({ end: n.end, value: targetRef(phrase) });
      }
    }
    // std-rw6 (CR 115.1, 608.2b): "target creature or spell" (Aang, Swift Savior), T59's two halves in the other order: a permanent of that description on the
    // battlefield, or a spell on the stack (not an ability). The same filter as T59's, so both orders give the same JSON; singular only, and the description is
    // read without post-modifiers (they would hold for one half only)
    if (d.number === 'singular' && !d.eachOf) {
      for (const n of npAlts(ctx, d.end, { preOnly: true })) {
        if (n.number !== 'singular' || (n.head !== 'type' && n.head !== 'permanent') || n.flags.length > 0 || n.filter.zone !== undefined || Object.keys(n.filter).length === 0) continue;
        const os = phraseAt(ctx, n.end, W_OR_SPELL);
        if (os < 0) continue;
        const phrase: TargetPhrase = {
          kind: 'object', filter: { zone: ['stack', 'battlefield'], anyOf: [{ stackKind: 'spell', zone: 'stack' }, { ...n.filter, zone: 'battlefield' }] },
          min: d.min, max: d.max, text: spanOf(ctx, pos, os), ...(d.another ? { another: true } : {}),
        };
        out.push({ end: os, value: targetRef(phrase) });
      }
    }
    // edh-d-96 (CR 115.1, 400.1, 608.2b; Endless Detour): "target spell, nonland permanent, or card in a graveyard": one target, any one of the three (no words after it: they would hold for one half only)
    const sng = d.number === 'singular' && !d.eachOf ? phraseAt(ctx, d.end, W_SPELL_NONLAND_PERMANENT_OR_GRAVEYARD_CARD) : -1;
    if (sng >= 0) out.push({ end: sng, value: targetRef({ kind: 'object', filter: { ...SPELL_NONLAND_PERMANENT_OR_GRAVEYARD_CARD, anyOf: SPELL_NONLAND_PERMANENT_OR_GRAVEYARD_CARD.anyOf!.map((x) => ({ ...x })) }, min: d.min, max: d.max, text: spanOf(ctx, pos, sng), ...(d.another ? { another: true } : {}) }) });
    const sn = d.number === 'singular' && !d.eachOf ? phraseAt(ctx, d.end, W_SPELL_OR_NONLAND_PERMANENT) : -1;
    if (sn >= 0) {
      const phrase: TargetPhrase = { kind: 'object', filter: { ...SPELL_OR_NONLAND_PERMANENT }, min: d.min, max: d.max, text: spanOf(ctx, pos, sn), ...(d.another ? { another: true } : {}) };
      out.push({ end: sn, value: targetRef(phrase) });
      // edh-cast-2 (CR 115.1, 109.4, 608.2b): "target spell or nonland permanent an opponent controls" / "you don't control": a spell controlled by that player, or a nonland
      // permanent they control (the controller is both halves': a spell has a controller on the stack, CR 601.2a, 108.4)
      for (const [w, who] of [[W_OPPONENT_CONTROLS, { controller: 'opponent' as const }], [W_YOU_DONT_CONTROL, { not: { controller: 'you' as const } }]] as const) {
        const e = phraseAt(ctx, sn, w);
        if (e < 0) continue;
        out.push({ end: e, value: targetRef({ ...phrase, filter: { ...SPELL_OR_NONLAND_PERMANENT, ...who }, text: spanOf(ctx, pos, e) }) });
      }
    }
    // std-rx30 (CR 115.1, 400.1, 608.2b): "target instant or sorcery card from your graveyard or exiled card with flashback you own" (Sorceress's Schemes): one target,
    // a card of either description, each in its own zone (the zones are the filter's, each half keeps its own); singular only, both halves cards with a stated zone
    if (d.number === 'singular' && !d.eachOf) {
      for (const a of npAlts(ctx, d.end)) {
        if (a.number !== 'singular' || a.head !== 'card' || typeof a.filter.zone !== 'string' || a.flags.length > 0) continue;
        const or = phraseAt(ctx, a.end, W_OR);
        if (or < 0) continue;
        // (the second half may name its zone by the participle "exiled", as FAST5X E2's "target exiled card with warp" below)
        const exiled = ctx.toks[or]?.norm === W_EXILED;
        for (const b0 of npAlts(ctx, exiled ? or + 1 : or)) {
          const b = exiled && b0.filter.zone === undefined ? { ...b0, filter: { ...b0.filter, zone: 'exile' as const }, flags: b0.flags.filter((x) => x !== 'zone-unstated') } : b0;
          if (b.number !== 'singular' || b.head !== 'card' || typeof b.filter.zone !== 'string' || b.filter.zone === a.filter.zone || b.filter.zone === 'any' || a.filter.zone === 'any' || b.flags.length > 0) continue;
          const phrase: TargetPhrase = { kind: 'object', filter: { zone: [a.filter.zone, b.filter.zone], anyOf: [a.filter, b.filter] }, min: d.min, max: d.max, text: spanOf(ctx, pos, b.end), ...(d.another ? { another: true } : {}) };
          out.push({ end: b.end, value: targetRef(phrase) });
        }
      }
    }
    // edh-zones-4 (CR 115.1, 400.1, 608.2b): "target Dragon creature card or Ugin planeswalker card from your graveyard" (Haven of the Spirit Dragon): one target, a card of either
    // description in the one zone the words after the second half name (they say where both are: the zone and its owner are the filter's, each half keeps its own words)
    if (d.number === 'singular' && !d.eachOf) {
      for (const a of npAlts(ctx, d.end)) {
        if (a.number !== 'singular' || a.head !== 'card' || a.filter.zone !== undefined || a.flags.some((x) => x !== 'zone-unstated')) continue;
        const or = phraseAt(ctx, a.end, W_OR);
        if (or < 0) continue;
        for (const b of npAlts(ctx, or)) {
          if (b.number !== 'singular' || b.head !== 'card' || typeof b.filter.zone !== 'string' || b.filter.zone === 'battlefield' || b.filter.zone === 'any' || b.flags.length > 0) continue;
          const { zone, owner, controller, ...second } = b.filter;
          const where = { zone, ...(owner !== undefined ? { owner } : {}), ...(controller !== undefined ? { controller } : {}) };
          const phrase: TargetPhrase = { kind: 'object', filter: { ...where, anyOf: [a.filter, second] }, min: d.min, max: d.max, text: spanOf(ctx, pos, b.end), ...(d.another ? { another: true } : {}) };
          out.push({ end: b.end, value: targetRef(phrase) });
        }
      }
    }
    // p2-modal-1 (CR 702.62b, 115.1; unverified cites): "target permanent or suspended card", "target permanent with a time counter on it or suspended card" (Fury Charm,
    // Timebender): a permanent of the first description, or a suspended card (a card in exile that has suspend and a time counter on it), each in its own zone
    if (d.number === 'singular' && !d.eachOf) {
      for (const a of npAlts(ctx, d.end)) {
        if (a.number !== 'singular' || a.head === 'card' || a.head === 'spell' || a.head === 'ability' || a.head === 'stackObject' || (a.filter.zone !== undefined && a.filter.zone !== 'battlefield') || a.flags.length > 0) continue;
        const e = phraseAt(ctx, a.end, W_OR_SUSPENDED_CARD);
        if (e < 0) continue;
        const phrase: TargetPhrase = { kind: 'object', filter: { zone: ['battlefield', 'exile'], anyOf: [{ ...a.filter, zone: 'battlefield' }, { ...SUSPENDED_CARD }] }, min: d.min, max: d.max, text: spanOf(ctx, pos, e), ...(d.another ? { another: true } : {}) };
        out.push({ end: e, value: targetRef(phrase) });
      }
    }
    // std-rx30 (CR 115.1, 400.1): "up to X other target creatures from the battlefield and/or creature cards from graveyards" (Aurelia's Vindicator): several targets,
    // each a permanent of the first description or a card of the second in its zone (plural phrases only; the first half names no zone of its own)
    if (d.number === 'plural' && !d.eachOf) {
      for (const a of npAlts(ctx, d.end)) {
        if (a.number !== 'plural' || a.head === 'card' || a.filter.zone !== undefined || a.filter.controller !== undefined || a.filter.owner !== undefined || a.flags.some((x) => x !== 'zone-unstated')) continue;
        const bf = phraseAt(ctx, a.end, W_FROM_BATTLEFIELD_AND_OR);
        if (bf < 0) continue;
        for (const b of npAlts(ctx, bf)) {
          if (b.number !== 'plural' || b.head !== 'card' || typeof b.filter.zone !== 'string' || b.filter.zone === 'battlefield' || b.filter.zone === 'any' || b.flags.length > 0) continue;
          const phrase: TargetPhrase = { kind: 'object', filter: { zone: ['battlefield', b.filter.zone], anyOf: [{ ...a.filter, zone: 'battlefield' }, b.filter] }, min: d.min, max: d.max, text: spanOf(ctx, pos, b.end), ...(d.another ? { another: true } : {}) };
          out.push({ end: b.end, value: targetRef(phrase) });
        }
      }
    }
    for (const n of npAlts(ctx, d.end, { differentNames: true })) {
      // std-rx32 (CR 115.1, 205.3m): Oracle's plural of "Equipment" is "Equipment" ("attach any number of target Equipment you control to target creature you
      // control", Thorin, Mountain-king): a plural target phrase whose noun is that one word
      const equipment = d.number === 'plural' && n.number === 'singular' && JSON.stringify(n.filter.subtypes) === '["Equipment"]' && /\bequipment\b/.test(spanOf(ctx, d.end, n.end).toLowerCase());
      if (n.number !== d.number && !equipment) continue;
      // FAST5 T42 (CR 201.2, 115.1): "up to six target creature cards with different names": a plural phrase of several targets whose set must have different names
      const differentNames = n.flags.includes('different-names');
      if (differentNames && (d.number !== 'plural' || d.eachOf)) continue;
      // edh-top-3 (CR 202.3, 115.1): "any number of target creature cards that each have a different mana value X or less": a plural phrase of several targets
      const differentMv = n.flags.includes('different-mv');
      if (differentMv && (d.number !== 'plural' || d.eachOf || differentNames)) continue;
      // CLOUD std-ecl (CR 205.3m, 702.73a, 115.1, 601.2c): "two target creature cards that share a creature type from your graveyard": the set chosen has a creature
      // type in common (exactly two targets, like "that share a card type" below)
      const sharedCreatureType = n.flags.includes('shared-creature-type');
      const chosenCreatureType = n.flags.includes('chosen-creature-type'); // edh-d-59 (Aphetto Dredging): "of the creature type of your choice" takes any number of targets
      if (sharedCreatureType && (d.number !== 'plural' || d.eachOf || differentNames || (!chosenCreatureType && (d.min !== 2 || d.max !== 2)))) continue;
      const s = spec(n.filter, n.head);
      const phrase: TargetPhrase = {
        kind: s.kind, ...(s.filter ? { filter: s.filter } : {}), min: d.min, max: d.max, text: spanOf(ctx, pos, n.end), ...(d.another ? { another: true } : {}), ...(differentNames ? { differentNames: true } : {}), ...(differentMv ? { differentManaValues: true } : {}),
        ...(sharedCreatureType ? { sharedCreatureType: true } : {}),
      };
      const flags = (d.eachOf ? [...n.flags, 'each-of'] : n.flags).filter((x) => x !== 'different-names' && x !== 'different-mv' && x !== 'shared-creature-type' && x !== 'chosen-creature-type' && x !== 'linked-exiled-target'); // std-rx5
      out.push({ end: n.end, value: targetRef(phrase), ...(n.weak || d.weak ? { weak: (n.weak ?? 0) + (d.weak ?? 0) } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // FAST5 T66 (CR 115.1, 601.2c): "up to two target creatures with total mana value 6 or less": the targets chosen together stay within a total (plural phrases of
      // several targets only; the limit is a rule of the set, checked as the targets are announced)
      const wt = n.number === 'plural' && !d.eachOf && !differentNames && !differentMv ? phraseAt(ctx, n.end, W_WITH_TOTAL) : -1;
      if (wt >= 0) {
        for (const [words, stat] of GROUP_STATS) {
          const e = phraseAt(ctx, wt, words);
          if (e < 0) continue;
          for (const c of cmpAt(ctx, e)) {
            const limited: TargetPhrase = { ...phrase, text: spanOf(ctx, pos, c.end), groupLimit: { stat, cmp: c.cmp } };
            const weak = (n.weak ?? 0) + (c.weak ?? 0);
            out.push({ end: c.end, value: targetRef(limited), ...(weak > 0 ? { weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
            // Cloud std-eoe (CR 115.1, 404.1): "up to three target creature cards with total mana value 3 or less from your graveyard": the zone said after the
            // limit is the zone of the cards (only cards whose zone is not stated before it, and only your graveyard, as the plain phrase reads it)
            const yg = n.head === 'card' && n.filter.zone === undefined && n.filter.owner === undefined ? phraseAt(ctx, c.end, W_FROM_YOUR_GRAVEYARD) : -1;
            if (yg >= 0) {
              const inYard: TargetPhrase = { ...limited, filter: { ...(limited.filter ?? {}), zone: 'graveyard', owner: 'you' }, text: spanOf(ctx, pos, yg) };
              const fl = flags.filter((x) => x !== 'zone-unstated');
              out.push({ end: yg, value: targetRef(inYard), ...(weak > 0 ? { weak } : {}), ...(fl.length > 0 ? { flags: fl } : {}) });
            }
            // edh-top-16 (CR 115.1, 404.1; Ancient Brass Dragon): "... with total mana value X or less from graveyards": the cards of any graveyard, as the plain phrase "target creature cards from graveyards" reads it
            const ag = n.head === 'card' && n.filter.zone === undefined && n.filter.owner === undefined ? phraseAt(ctx, c.end, W_FROM_GRAVEYARDS) : -1;
            if (ag >= 0) {
              const inYards: TargetPhrase = { ...limited, filter: { ...(limited.filter ?? {}), zone: 'graveyard' }, text: spanOf(ctx, pos, ag) };
              const fl = flags.filter((x) => x !== 'zone-unstated');
              out.push({ end: ag, value: targetRef(inYards), ...(weak > 0 ? { weak } : {}), ...(fl.length > 0 ? { flags: fl } : {}) });
            }
            // std-library-1 (CR 115.1, 404.1, 400.3): "... with total mana value X or less from that player's graveyard" (Fire Lord Sozin): the same zone after the
            // limit, in the graveyard of another player the sentence names ("that player's", "target opponent's"); "your graveyard" keeps the reading above
            if (n.head === 'card' && n.filter.zone === undefined && n.filter.owner === undefined && ctx.toks[c.end]?.norm === 'from' && yg < 0) {
              for (const z of ctx.call('Zone', c.end + 1)) {
                const zv = z.value as { zone: string; owner?: PlayerPred };
                if (zv.zone !== 'graveyard' || zv.owner === undefined || zv.owner === 'you') continue;
                const inYard: TargetPhrase = { ...limited, filter: { ...(limited.filter ?? {}), zone: 'graveyard', owner: zv.owner }, text: spanOf(ctx, pos, z.end) };
                const fl = flags.filter((x) => x !== 'zone-unstated');
                out.push({ end: z.end, value: targetRef(inYard), ...(weak > 0 ? { weak } : {}), ...(fl.length > 0 ? { flags: fl } : {}) });
              }
            }
          }
        }
      }
      // FAST5 T66 (CR 205.2a, 115.1, 601.2c): "two target nonland permanents that share a card type": the set chosen has a card type in common (exactly two targets)
      const sh = n.number === 'plural' && !d.eachOf && !differentNames && !differentMv && d.min === 2 && d.max === 2 ? phraseAt(ctx, n.end, W_SHARE_CARD_TYPE) : -1;
      if (sh >= 0) out.push({ end: sh, value: targetRef({ ...phrase, text: spanOf(ctx, pos, sh), sharedCardType: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // edh-next-54 (CR 110.4, 205.2a; Role Reversal): "two target permanents that share a permanent type": the type in common is a permanent type (Kindred is not one)
      const shp = n.number === 'plural' && !d.eachOf && !differentNames && !differentMv && d.min === 2 && d.max === 2 && n.head === 'permanent' ? phraseAt(ctx, n.end, W_SHARE_PERMANENT_TYPE) : -1;
      if (shp >= 0) out.push({ end: shp, value: targetRef({ ...phrase, text: spanOf(ctx, pos, shp), sharedCardType: true, sharedPermanentType: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // CLOUD std-tmt (CR 115.1, 601.2c, 110.2): "two other target creatures controlled by different players": no two targets of the set have one controller (plural
      // phrases of several targets of permanents whose controller is not named otherwise)
      const dc = n.number === 'plural' && !d.eachOf && !differentNames && !differentMv && s.kind === 'object' && n.head !== 'card' && n.filter.controller === undefined && n.filter.owner === undefined
        && n.filter.zone === undefined ? anyPhraseAt(ctx, n.end, W_CONTROLLED_BY_DIFFERENT_PLAYERS) : -1;
      if (dc >= 0) out.push({ end: dc, value: targetRef({ ...phrase, text: spanOf(ctx, pos, dc), differentControllers: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // std-rx30 (CR 115.1, 601.2c, 110.2): "two target creatures controlled by the same opponent": every target of the set has one controller, an opponent (the same
      // plural phrases of several targets as above)
      const so = dc < 0 && n.number === 'plural' && !d.eachOf && !differentNames && !differentMv && s.kind === 'object' && n.head !== 'card' && n.filter.controller === undefined && n.filter.owner === undefined
        && n.filter.zone === undefined ? phraseAt(ctx, n.end, W_CONTROLLED_BY_THE_SAME_OPPONENT) : -1;
      if (so >= 0) out.push({ end: so, value: targetRef({ ...phrase, filter: { ...(phrase.filter ?? {}), controller: 'opponent' }, text: spanOf(ctx, pos, so), sameController: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // edh-c-74 (CR 115.1, 601.2c, 110.2; Incriminate): "two target creatures controlled by the same player": the same set, whoever that player is (any player, you included)
      const sp = dc < 0 && so < 0 && n.number === 'plural' && !d.eachOf && !differentNames && !differentMv && s.kind === 'object' && n.head !== 'card' && n.filter.controller === undefined && n.filter.owner === undefined
        && n.filter.zone === undefined ? phraseAt(ctx, n.end, W_CONTROLLED_BY_THE_SAME_PLAYER) : -1;
      if (sp >= 0) out.push({ end: sp, value: targetRef({ ...phrase, text: spanOf(ctx, pos, sp), sameController: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // edh-next-126 (CR 115.1, 601.2c, 208.1; V.A.T.S.): "any number of target creatures with equal toughness": the targets chosen together all have the same toughness (plural phrases of
      // several targets of permanents; the rule of the set is checked as the targets are announced and again as the spell resolves)
      const et = n.number === 'plural' && !d.eachOf && !differentNames && !differentMv && s.kind === 'object' && n.head !== 'card' && n.filter.zone === undefined ? phraseAt(ctx, n.end, W_WITH_EQUAL_TOUGHNESS) : -1;
      if (et >= 0) out.push({ end: et, value: targetRef({ ...phrase, text: spanOf(ctx, pos, et), equalToughness: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // std-cardcopy-7 (CR 115.1, 601.2c, 205.2a): "up to one target nonland card of each card type from your graveyard" (Uldaros Theorix): up to one target for EACH card
      // type, the set chosen one of each type; only "up to one" of cards whose zone is not stated before the words, and only your graveyard after them
      const oe = n.number === 'singular' && n.head === 'card' && !d.eachOf && d.min === 0 && d.max === 1 && n.filter.zone === undefined && n.filter.owner === undefined ? phraseAt(ctx, n.end, W_OF_EACH_CARD_TYPE) : -1;
      const oy = oe >= 0 ? phraseAt(ctx, oe, W_FROM_YOUR_GRAVEYARD) : -1;
      if (oy >= 0) {
        const fl = flags.filter((x) => x !== 'zone-unstated');
        out.push({ end: oy, value: targetRef({ ...phrase, filter: { ...(phrase.filter ?? {}), zone: 'graveyard', owner: 'you' }, text: spanOf(ctx, pos, oy), perCardType: true }), ...(n.weak ? { weak: n.weak } : {}), ...(fl.length > 0 ? { flags: fl } : {}) });
      }
      // p2-damage-2 (CR 601.2c, 603.3d): "it fights target creature an opponent controls chosen at random" (Scab-Clan Giant): one target of a permanent the game picks at
      // random among the legal ones (TargetSpec.random); only one target of a plain phrase
      const ar = n.number === 'singular' && d.number === 'singular' && !d.eachOf && !differentNames && !differentMv && d.min === 1 && d.max === 1 && s.kind === 'object' && n.head !== 'card' ? phraseAt(ctx, n.end, W_CHOSEN_AT_RANDOM) : -1;
      if (ar >= 0) out.push({ end: ar, value: targetRef({ ...phrase, text: spanOf(ctx, pos, ar), random: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // edh-c-103 (CR 601.2c, 601.7, 603.3d; The Abyss): "destroy target nonartifact creature that player controls of their choice": the player "that player" names chooses the one target,
      // among the permanents they control (TargetSpec.chooser, the same reference as the controller; lower/ability.ts reads it as the active player in a step trigger); only one target of a plain phrase
      const ctl = n.filter.controller as { ref?: string; $anaphor?: { sort?: string; text?: string } } | undefined;
      const oc = n.number === 'singular' && d.number === 'singular' && !d.eachOf && !differentNames && !differentMv && d.min === 1 && d.max === 1 && s.kind === 'object' && n.head !== 'card'
        && ctl !== undefined && typeof ctl === 'object' && ctl.ref === 'bound' && ctl.$anaphor?.sort === 'player' && ctl.$anaphor.text === 'that player' ? phraseAt(ctx, n.end, W_OF_THEIR_CHOICE) : -1;
      if (oc >= 0) out.push({ end: oc, value: targetRef({ ...phrase, text: spanOf(ctx, pos, oc), chooser: JSON.parse(JSON.stringify(ctl)) as PlayerRef }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // edh-d-87 (CR 601.2c, 601.7a, 603.3d; Bladegriff Prototype, rulings 2020-11-10): "destroy target nonland permanent of that player's choice that one of your opponents controls": the player
      // "that player" names chooses the one target, a permanent ANY opponent of the controller controls (TargetSpec.chooser, the controller `opponent`); the controller still controls the
      // ability. If that player has left the game, another opponent the controller picks chooses (`chooserElse`). Only one target of a plain phrase with no controller of its own
      const tp = n.number === 'singular' && d.number === 'singular' && !d.eachOf && !differentNames && !differentMv && d.min === 1 && d.max === 1 && s.kind === 'object' && n.head !== 'card'
        && n.filter.controller === undefined && n.filter.zone === undefined ? phraseAt(ctx, n.end, W_OF_THAT_PLAYERS_CHOICE_ANY_OPPONENT) : -1;
      if (tp >= 0) {
        const chooser = anaphorObj({ sort: 'player', number: 'singular', head: 'player', text: 'that player' }) as unknown as PlayerRef;
        out.push({ end: tp, value: targetRef({ ...phrase, filter: { ...(phrase.filter ?? {}), controller: 'opponent' }, text: spanOf(ctx, pos, tp), chooser, chooserElse: 'anOpponent' }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      }
      // edh-next-146 (CR 601.7, 601.7a, 115.1; Arena): "target creature of an opponent's choice they control": an opponent (the controller decides which, among those who could) chooses the
      // one target among the creatures they control (TargetSpec.chooser + chooserControls); only one target of a plain phrase whose controller is not said before the words
      const ocOpp = n.number === 'singular' && d.number === 'singular' && !d.eachOf && !differentNames && !differentMv && d.min === 1 && d.max === 1 && s.kind === 'object' && n.head !== 'card'
        && n.filter.controller === undefined && n.filter.owner === undefined && n.filter.zone === undefined ? phraseAt(ctx, n.end, W_OF_AN_OPPONENTS_CHOICE_THEY_CONTROL) : -1;
      if (ocOpp >= 0) out.push({ end: ocOpp, value: targetRef({ ...phrase, filter: { ...(phrase.filter ?? {}), controller: 'opponent' }, text: spanOf(ctx, pos, ocOpp), chooser: { ref: 'anOpponent' }, chooserControls: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // edh-c-14 (CR 208.1, 115.1, 608.2d; Triumph of Gerrard): "target creature you control with the greatest power": one target creature you control whose power is at least that of every
      // creature you control (the tied greatest), the same filter as "... with the greatest power among creatures you control"; only a plain "creature you control" and one target
      const gp = n.number === 'singular' && d.number === 'singular' && !d.eachOf && !differentNames && !differentMv && d.min === 1 && d.max === 1 && s.kind === 'object'
        && n.filter.controller === 'you' && n.filter.types?.length === 1 && n.filter.types[0] === 'Creature' && Object.keys(n.filter).filter((k) => (n.filter as Record<string, unknown>)[k] !== undefined).length === 2
        ? phraseAt(ctx, n.end, W_WITH_THE_GREATEST('power')) : -1;
      if (gp >= 0) {
        const among: ObjectFilter = { types: ['Creature'], controller: 'you' };
        const greatest: TargetPhrase = { ...phrase, filter: { ...(phrase.filter ?? {}), power: { op: '>=', value: { q: 'stat', stat: 'power', of: { ref: 'each', filter: among }, agg: 'max' } } }, text: spanOf(ctx, pos, gp) };
        out.push({ end: gp, value: targetRef(greatest), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      }
      // edh-c-87 (CR 202.3, 208.1, 115.1, 608.2d; Culling Scales): "target nonland permanent with the lowest mana value" (also greatest / highest / least of power, toughness, mana value): one
      // target whose statistic is at most (at least) that of every permanent of the same description (the tied extreme; a controller said by the noun keeps the older reading above or none)
      const xt = n.number === 'singular' && d.number === 'singular' && !d.eachOf && !d.another && !differentNames && !differentMv && d.min === 1 && d.max === 1 && s.kind === 'object' && n.head === 'permanent'
        && n.filter.controller === undefined && n.filter.owner === undefined && n.filter.zone === undefined && Object.keys(n.filter).filter((k) => (n.filter as Record<string, unknown>)[k] !== undefined).every((k) => k === 'types' || k === 'notTypes')
        ? extremeAt(ctx, n.end) : null;
      // only the mana value: a noncreature permanent has no power or toughness (CR 208.3), so a set of permanents has no greatest power (the reviewer's played check)
      if (xt !== null && xt.stat === 'manaValue') {
        const among: ObjectFilter = { ...n.filter };
        const field = xt.stat;
        const qty = { q: 'stat', stat: field, of: { ref: 'each', filter: among }, agg: xt.agg } as Quantity;
        const extreme: TargetPhrase = { ...phrase, filter: { ...(phrase.filter ?? {}), [field]: { op: xt.agg === 'max' ? '>=' : '<=', value: qty } }, text: spanOf(ctx, pos, xt.end) };
        out.push({ end: xt.end, value: targetRef(extreme), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      }
      // FAST3 T14: "up to three target cards from a single graveyard": cards of one player's graveyard (CR 115.1, 404.1); only after a plural "cards" whose
      // zone is not stated yet, so the words add the zone and the restriction and nothing else
      const sg = n.number === 'plural' && n.head === 'card' && n.filter.zone === undefined && n.filter.owner === undefined ? phraseAt(ctx, n.end, W_FROM_SINGLE_GRAVEYARD) : -1;
      if (sg >= 0) {
        const single: TargetPhrase = { ...phrase, filter: { ...(phrase.filter ?? {}), zone: 'graveyard' }, text: spanOf(ctx, pos, sg), sameOwner: true };
        const fl = flags.filter((x) => x !== 'zone-unstated');
        out.push({ end: sg, value: targetRef(single), ...(n.weak ? { weak: n.weak } : {}), ...(fl.length > 0 ? { flags: fl } : {}) });
      }
    }
    // FAST5X E2 (CR 406.1, 115.1): "target exiled card with warp": a card in exile (the participle stands for the zone, as "the exiled card" names an object
    // there); only before a card head whose zone is not stated otherwise
    if (ctx.toks[d.end]?.norm === W_EXILED) {
      for (const n of npAlts(ctx, d.end + 1)) {
        if (n.number !== d.number || n.head !== 'card' || n.filter.zone !== undefined) continue;
        const s = spec({ ...n.filter, zone: 'exile' }, n.head);
        const phrase: TargetPhrase = { kind: s.kind, ...(s.filter ? { filter: s.filter } : {}), min: d.min, max: d.max, text: spanOf(ctx, pos, n.end), ...(d.another ? { another: true } : {}) };
        const flags = (d.eachOf ? [...n.flags, 'each-of'] : n.flags).filter((x) => x !== 'zone-unstated');
        out.push({ end: n.end, value: targetRef(phrase), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      }
    }
    // edh-b-8 (CR 406.3, 708.2, 115.1; Pull from Eternity): "target face-up exiled card": the same, with the card's exile status first (a face-down exiled card has no face to read)
    const fu = ctx.toks[d.end]?.norm;
    if ((fu === 'face-up' || fu === 'face-down') && ctx.toks[d.end + 1]?.norm === W_EXILED) {
      for (const n of npAlts(ctx, d.end + 2)) {
        if (n.number !== d.number || n.head !== 'card' || n.filter.zone !== undefined || n.filter.faceDown !== undefined) continue;
        const s = spec({ ...n.filter, zone: 'exile', faceDown: fu === 'face-down' }, n.head);
        const phrase: TargetPhrase = { kind: s.kind, ...(s.filter ? { filter: s.filter } : {}), min: d.min, max: d.max, text: spanOf(ctx, pos, n.end), ...(d.another ? { another: true } : {}) };
        const flags = (d.eachOf ? [...n.flags, 'each-of'] : n.flags).filter((x) => x !== 'zone-unstated');
        out.push({ end: n.end, value: targetRef(phrase), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      }
    }
  }
  return out;
}
const W_EXILED = 'exiled';
const EXTREME_WORDS: [string[], 'max' | 'min'][] = [[['with', 'the', 'greatest'], 'max'], [['with', 'the', 'highest'], 'max'], [['with', 'the', 'lowest'], 'min'], [['with', 'the', 'least'], 'min']];
const EXTREME_STATS: [string[], 'power' | 'toughness' | 'manaValue'][] = [[['power'], 'power'], [['toughness'], 'toughness'], [['mana', 'value'], 'manaValue']];
/** edh-c-87: "with the lowest mana value" and its kin at `pos`: the statistic, whether the greatest (max) or the least (min) is meant, and where the words end; or null. */
function extremeAt(ctx: HoleCtx, pos: number): { stat: 'power' | 'toughness' | 'manaValue'; agg: 'max' | 'min'; end: number } | null {
  for (const [ws, agg] of EXTREME_WORDS) {
    for (const [ss, stat] of EXTREME_STATS) {
      const words = [...ws, ...ss];
      if (words.every((w, i) => ctx.toks[pos + i]?.norm === w)) return { stat, agg, end: pos + words.length };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// single objects
// ---------------------------------------------------------------------------

function selfAndPronouns(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  if (ctx.toks[pos]?.kind === 'SELF') out.push({ end: pos + 1, value: { ref: 'self' } });
  // r4-static (CR 201.5a): the outer card's name inside a quoted ability, the object that grants it (front/selfref.ts)
  if (ctx.toks[pos]?.kind === 'GRANTOR') out.push({ end: pos + 1, value: { ref: 'grantor' } });
  if (phraseAt(ctx, pos, W_IT) >= 0) out.push({ end: pos + 1, value: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) });
  if (W_HE.some((w) => phraseAt(ctx, pos, w) >= 0)) out.push({ end: pos + 1, value: { ref: 'self' } });
  if (W_HER.some((w) => phraseAt(ctx, pos, w) >= 0)) out.push({ end: pos + 1, value: { ref: 'self' } });
  // edh-zones-9 (CR 608.2c; Sword of Hearth and Home): "both cards", the two single cards two earlier instructions produced (lower/anaphora.ts#resolveAnaphor)
  if (phraseAt(ctx, pos, W_BOTH_CARDS) >= 0) out.push({ end: pos + 2, value: anaphorObj({ sort: 'object', number: 'plural', head: 'card', both: true, text: 'both cards' }) });
  // edh-c-9 (CR 115.1, 608.2c; Lithomantic Barrage): "that target" is the object the sentence before chose as its target, as "it" is (no head noun: any kind of object)
  const thatTarget = phraseAt(ctx, pos, W_THAT_TARGET);
  if (thatTarget >= 0) out.push({ end: thatTarget, value: anaphorObj({ sort: 'object', number: 'singular', text: 'that target' }) });
  // edh-c-48 (CR 608.2c; Seifer, Balamb Rival): "that attacking creature" is the attacking creature the trigger's event named, as "that creature" is (the attacker of a combat event)
  const thatAttacker = phraseAt(ctx, pos, W_THAT_ATTACKING_CREATURE);
  if (thatAttacker >= 0) out.push({ end: thatAttacker, value: anaphorObj({ sort: 'object', number: 'singular', head: 'creature', text: 'that attacking creature' }) });
  const that = phraseAt(ctx, pos, W_THAT);
  if (that >= 0) for (const h of headNounAt(ctx, that)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  // trek-12 (CR 608.2c, 400.7; Q, Stacking the Deck): "That nonland card gains ..." after "exile cards from the top of your library until you exile a nonland card":
  // "that card" with its card description said again (one card type, or "non-" one card type), as std-exile-play-1-1's "the exiled nonland card" below. The renderer
  // names the one card an exile-until stopped at "that nonland card" only for that step's own description (render/steps-cards.ts#exileUntil), so no other antecedent fits
  if (that >= 0) {
    for (const n of npAlts(ctx, that)) {
      const keys = Object.keys(n.filter).filter((k) => (n.filter as Record<string, unknown>)[k] !== undefined && k !== 'isCard');
      let oneType = keys.length === 1 && ((keys[0] === 'notTypes' && n.filter.notTypes!.length === 1) || (keys[0] === 'types' && n.filter.types!.length === 1));
      // edh-replace-4 (CR 608.2c, 110.4; Court of Ardenvale, Emeria Shepherd): "that permanent card", "that nonland permanent card": the description of a target "permanent card" said again
      // (the permanent card types, with at most one type left out)
      const permTypes = n.filter.types?.length === PERMANENT_CARD_TYPES.length && PERMANENT_CARD_TYPES.every((t) => n.filter.types!.includes(t));
      if (!oneType && permTypes && keys.every((k) => k === 'types' || k === 'notTypes') && (n.filter.notTypes === undefined || n.filter.notTypes.length === 1)) oneType = true;
      if (n.number === 'singular' && n.head === 'card' && oneType) out.push({ end: n.end, value: anaphorObj({ sort: 'object', number: 'singular', head: 'card', text: spanOf(ctx, pos, n.end).toLowerCase() }) });
    }
  }
  // FAST3 T14: "that spell or ability" (what targeted the object, CR 115.1, 115.2): an object on the stack, named by both of its heads
  const sa = that >= 0 ? phraseAt(ctx, that, W_SPELL_OR_ABILITY) : -1;
  if (sa >= 0) out.push({ end: sa, value: anaphorObj({ sort: 'object', number: 'singular', head: 'spell', text: spanOf(ctx, pos, sa).toLowerCase() }) });
  // FAST4 T19: "that creature or planeswalker" (the object of a target "creature or planeswalker", CR 115.1, 608.2c): an anaphor named by BOTH heads, so only
  // a mention that can be called either (lower/anaphora.ts#compatible, `orHead`) is its antecedent; two different permanent types, both singular ("that spell
  // or ability" is the FAST3 T14 reading above, never this one)
  if (that >= 0) {
    for (const h of headNounAt(ctx, that)) {
      if (h.plural) continue;
      const or = phraseAt(ctx, h.end, W_OR);
      if (or < 0) continue;
      for (const h2 of headNounAt(ctx, or)) {
        // Standard round 5, r5-trig (CR 702.122b, 702.171c; Canyon Vaulter): also "that Mount or Vehicle", the permanent a creature saddled or crewed
        const mountOrVehicle = h.head === 'mount' && h2.head === 'vehicle';
        // edh-perms-24 (CR 608.2c; Clockspinning): "that permanent or card", the object of a target "permanent or suspended card"
        const permanentOrCard = h.head === 'permanent' && h2.head === 'card';
        if (h2.plural || h2.head === h.head || (!mountOrVehicle && !permanentOrCard && (!OR_HEADS.has(h.head) || !OR_HEADS.has(h2.head)))) continue;
        out.push({ end: h2.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, orHead: h2.head, text: spanOf(ctx, pos, h2.end).toLowerCase() }) });
      }
    }
  }
  // std-rh (CR 702.167c, 607.2a; Jadeheart Attendant): "the exiled card used to craft it" is the card the craft cost exiled, which the transformed permanent remembers in its own
  // link store (zones-move.ts `remember`, link 'craft'): read as `{ref:'linked', link:'craft'}` (effects/refs.ts)
  // std-craft-1 (CR 702.167c; Mastercraft Raptor, Sunbird Effigy): the plural, "the exiled cards used to craft it / this creature", is the same remembered set when the
  // craft cost exiled several cards (one or more materials); the link holds every card that cost exiled, and only those still in exile count (CR 400.7)
  for (const w of W_USED_TO_CRAFT_IT) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { ref: 'linked', link: 'craft' } });
  }
  for (const w of W_ASSIMILATED_WITH_SELF) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { ref: 'linked', link: 'assimilated' } });
  }
  // std-costs-2 (CR 608.2c, 115.1): "Return each chosen creature to your hand" after a sentence that only announced targets ("Choose any number of target creatures you
  // own."): every one of them, as "the chosen creatures" names them (the plural anaphor with the participle; lower/mentions.ts gives it to announced targets only)
  const eachChosen = phraseAt(ctx, pos, W_EACH_CHOSEN);
  if (eachChosen >= 0) for (const h of headNounAt(ctx, eachChosen)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'chosen', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  // edh-perms-12 (CR 608.2c, 101.4; Druid of Purification): "Destroy each permanent chosen this way." after each player's choice: every permanent the `chooseObjects` step
  // chose (the participle `chosen`, lower/mentions.ts), as "the chosen permanents" names them
  const eachNoun = phraseAt(ctx, pos, W_EACH_THIS);
  if (eachNoun >= 0) for (const h of headNounAt(ctx, eachNoun)) if (!h.plural) {
    const e = phraseAt(ctx, h.end, W_CHOSEN_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'chosen', text: spanOf(ctx, pos, e).toLowerCase() }) });
  }
  // std-cardcopy-7 (CR 608.2c, 400.7): "Copy those exiled cards." (Baron Helmut Zemo): the cards an earlier exile of the ability (here its cost) exiled, several
  // objects, as "the exiled cards" below
  const those = phraseAt(ctx, pos, W_THOSE);
  if (those >= 0 && ctx.toks[those]?.norm === 'exiled') for (const h of headNounAt(ctx, those + 1)) if (h.plural && h.head === 'card') out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'exiled', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  const the = phraseAt(ctx, pos, W_THE);
  if (the >= 0) {
    // edh-perms-15 (CR 111.1, 608.2c; Determined Iteration): "the token created this way", the one token an earlier instruction (populate, a token creation) made
    for (const h of headNounAt(ctx, the)) {
      const e = !h.plural && h.head === 'token' ? phraseAt(ctx, h.end, W_CREATED_THIS_WAY) : -1;
      if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'object', number: 'singular', head: 'token', participle: 'created', text: spanOf(ctx, pos, e).toLowerCase() }) });
    }
    // edh-perms-18 (CR 608.2c, 608.2h; Astarion's Thirst): "the creature exiled this way", the one object an earlier instruction of the ability exiled or sacrificed, the participle after the noun
    for (const h of headNounAt(ctx, the)) {
      const pw = ctx.toks[h.end]?.norm;
      if (h.plural || h.head === 'token' || pw === undefined || (pw !== 'exiled' && pw !== 'sacrificed' && pw !== 'tapped' /* edh-c-71: "the creature tapped this way" (Keldon Battlewagon), the object a tap cost tapped */ && pw !== 'returned' /* edh-c-76: "the card returned this way" (Morgue Burst, CR 608.2c) */)) continue;
      const e = phraseAt(ctx, h.end + 1, W_THIS_WAY_OBJ);
      if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, participle: pw, text: spanOf(ctx, pos, e).toLowerCase() }) });
    }
    // edh-d-92 (CR 701.47c, 608.2c; Widespread Brutality): "the Army you amassed", the Army an earlier amass of the ability chose, as "the amassed Army" (the participle
    // "amassed" of parser/lower/mentions.ts names only that choice)
    const yam = phraseAt(ctx, the, W_ARMY_YOU_AMASSED);
    if (yam >= 0) out.push({ end: yam, value: anaphorObj({ sort: 'object', number: 'singular', head: 'army', participle: 'amassed', text: spanOf(ctx, pos, yam).toLowerCase() }) });
    const part = ctx.toks[the]?.norm;
    if (part !== undefined && PARTICIPLES.includes(part)) {
      // edh-next-26 (CR 607.2a, 603.4, 608.2c; Smirking Spelljacker): after an intervening "if" that counts the cards exiled with ~, the first sentence's "the exiled card" is the linked exile (holes/core.ts#Discourse.linkedCond)
      if (part === 'exiled' && ctx.discourse?.linkedCond === true) { for (const h of headNounAt(ctx, the + 1)) if (!h.plural && h.head === 'card') out.push({ end: h.end, value: { ref: 'linked', link: 'exiled' } }); }
      else {
        // edh-next-146 (CR 607.2d; Dauntless Bodyguard: "Sacrifice this creature: The chosen creature gains indestructible until end of turn."): with no earlier choice in the ability (no Discourse
        // `chose` / `chosenObject`), "the chosen <noun>" is the object another ability of the face chose (the link placeholder below, parser/parse.ts#linkChosenObject); the anaphor is then the
        // weaker reading, the mirror of the rule below (after such a choice the link placeholder is the weaker one)
        const noChoice = part === 'chosen' && ctx.discourse?.chose !== true && ctx.discourse?.chosenObject !== true;
        for (const h of headNounAt(ctx, the + 1)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, participle: part, text: spanOf(ctx, pos, h.end).toLowerCase() }), ...(noChoice ? { weak: 1 } : {}) });
      }
      // std-exile-play-1-1 (CR 608.2c, 400.7): "the exiled nonland card" ("... until they exile a nonland card. ... you may cast the exiled nonland card", Black Widow, Super
      // Spy): the one card an earlier exile of the ability exiled, its card type said again; only one card type, or "non-" one card type, before "card"
      if (part === 'exiled') {
        for (const n of npAlts(ctx, the + 1)) {
          const keys = Object.keys(n.filter).filter((k) => (n.filter as Record<string, unknown>)[k] !== undefined && k !== 'isCard');
          const oneType = keys.length === 1 && ((keys[0] === 'notTypes' && n.filter.notTypes!.length === 1) || (keys[0] === 'types' && n.filter.types!.length === 1));
          if (n.number === 'singular' && n.head === 'card' && oneType) out.push({ end: n.end, value: anaphorObj({ sort: 'object', number: 'singular', head: 'card', participle: part, text: spanOf(ctx, pos, n.end).toLowerCase() }) });
        }
      }
    }
    // r3-choose (CR 608.2c, 607.2): after a sentence of the same ability that only announced targets (holes/core.ts#Discourse.chose: "Choose target artifact card in your
    // graveyard. ... return the chosen card to the battlefield"), the anaphor above names it and the link placeholder is the weaker reading (it left the sentence two readings, G5)
    const weak = ctx.discourse?.chose === true || ctx.discourse?.chosenObject === true ? { weak: 1 } : {}; // edh-next-60: also after "Choose a creature you control."
    if (part === 'chosen') for (const h of headNounAt(ctx, the + 1)) if (!h.plural) out.push({ end: h.end, value: linkedObj(), ...weak });
    // C6 (CR 608.2c): "Destroy the chosen permanents." after "for each opponent, choose an artifact or land that player controls": what that choice chose (a
    // `chooseObjects` step answers to the participle, lower/mentions.ts); unresolved, manual
    if (part === 'chosen') for (const h of headNounAt(ctx, the + 1)) if (h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'chosen', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // r4-moved (CR 608.2c, 400.7): "Exile X target artifacts and/or creatures. Return the exiled cards to the battlefield ...": what an earlier instruction of the
    // ability exiled, several objects (the participle names the mention the move marked, lower/mentions.ts; the unique-candidate rule decides, design 6.4)
    if (part === 'exiled') for (const h of headNounAt(ctx, the + 1)) if (h.plural && h.head === 'card') out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'exiled', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // edh-c-8 (CR 608.2c, 608.2h; Corpse Cobble): "the sacrificed creatures", the objects a cost of any number sacrificed (lower/ability.ts#costGroupMentions), read as they last existed
    if (part === 'sacrificed') for (const h of headNounAt(ctx, the + 1)) if (h.plural && h.head !== 'token') out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'sacrificed', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // edh-c-44 (CR 601.2b, 608.2c, 608.2h; Nahiri's Wrath): "the discarded cards", the cards a cost of any number discarded (lower/ability.ts#costGroupMentions)
    if (part === 'discarded') for (const h of headNounAt(ctx, the + 1)) if (h.plural && h.head === 'card') out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'discarded', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // "the creature": Oracle's second mention of an object named just before ("Sacrifice the creature at the beginning of the next end step", CR 608.2c;
    // WP23). An anaphor like "that creature": the unique-candidate rule decides (design 6.4).
    for (const h of headNounAt(ctx, the)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // edh-c-106 (CR 608.2c, 509.1, 120.3; Venomous Fangs, Venom): "the other creature" of a trigger on a two-party event ("Whenever enchanted creature deals damage to a
    // creature", "blocks or becomes blocked by a creature"): the party that is not the event's subject (the event's `object` role), never the subject itself or an earlier step's object
    if (ctx.toks[the]?.norm === 'other') for (const h of headNounAt(ctx, the + 1)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, otherParty: true, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // std-rx10 (CR 115.1, 608.2c): "Choose target creature you control and target creature you don't control. Put a +1/+1 counter on the creature you control.": after a
    // sentence that only announced targets, the target that phrase described, picked out by its controller (lower/anaphora.ts#compatible, `controls`); nowhere else
    // edh-c-86 (Outmuscle, CR 115.1, 608.2c): the same after any sentence that announced the target, not only a "choose" sentence ("Put a +1/+1 counter on target creature you control, then it fights target creature you don't control. ... the creature you control gains indestructible"); the mention must still be an announced target of that controller (compatible, `controls`), else the sentence stays manual
    {
      for (const h of headNounAt(ctx, the)) {
        if (h.plural) continue;
        for (const [w, controls] of W_CONTROLS) {
          const e = phraseAt(ctx, h.end, w);
          if (e >= 0 && (ctx.discourse?.chose === true || phraseAt(ctx, e, P('this way')) < 0 && phraseAt(ctx, e, P('is dealt')) < 0)) out.push({ end: e, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, controls, text: spanOf(ctx, pos, e).toLowerCase() }), ...(ctx.discourse?.chose === true ? {} : { weak: 1 }) }); // weak outside a "choose" sentence: another reading of the same words (Rhino's Rampage: "the creature an opponent controls this way") keeps its sentence
        }
      }
    }
  }
  const rb = phraseAt(ctx, pos, W_YOUR_RING_BEARER);
  if (rb >= 0) out.push({ end: rb, value: { ref: 'each', filter: { ringBearer: 'you' } } });
  const att = ctx.toks[pos]?.norm;
  if (att !== undefined && ATTACHED.includes(att)) for (const h of headNounAt(ctx, pos + 1)) if (!h.plural) out.push({ end: h.end, value: { ref: 'attachedTo' } });
  // edh-c-70 (CR 303.4, 303.4a): "enchanted artifact creature", what an "Enchant artifact creature" Aura is attached to (Domineer); the attached object, as with "enchanted creature"
  if (att === 'enchanted') { const e = phraseAt(ctx, pos + 1, W_ARTIFACT_CREATURE); if (e >= 0) out.push({ end: e, value: { ref: 'attachedTo' } }); }
  return out;
}

/** "the top card of your library", "the top three cards of your library": ordered, top first. */
function topCards(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // edh-next-43 (CR 404.1; Phyrexian Furnace): "the bottom card of target player's graveyard", the card put there first; one card, any one player's graveyard
  const bottom = phraseAt(ctx, pos, W_BOTTOM);
  const bc = bottom >= 0 ? phraseAt(ctx, bottom, P('card')) : -1;
  const bo = bc >= 0 ? phraseAt(ctx, bc, W_OF) : -1;
  if (bo >= 0) for (const pl of ctx.call('Player', bo)) {
    if (ctx.toks[pl.end]?.norm === "'s" && phraseAt(ctx, pl.end + 1, W_GRAVEYARD_WORD) >= 0) out.push({ end: pl.end + 2, value: { ref: 'topCards', player: pl.value as PlayerRef, count: 1, zone: 'graveyard', fromBottom: true } });
    // edh-next-123 (CR 401.1, 401.2; Arvinox, the Mind Flail): "the bottom card of each opponent's library", the last card of that library (one card from each)
    const r = pl.value as PlayerRef;
    if (r.ref !== 'you' && ctx.toks[pl.end]?.norm === "'s" && phraseAt(ctx, pl.end + 1, W_LIBRARY) >= 0) out.push({ end: pl.end + 2, value: { ref: 'topCards', player: r, count: 1, fromBottom: true } });
  }
  if (bo >= 0 && ctx.toks[bo]?.norm === 'your' && phraseAt(ctx, bo + 1, W_LIBRARY) >= 0) out.push({ end: bo + 2, value: { ref: 'topCards', player: { ref: 'you' }, count: 1, fromBottom: true } }); // edh-next-123: "the bottom card of your library"
  const top = phraseAt(ctx, pos, W_TOP);
  if (top < 0) return out;
  const tail = (p: number, count: Quantity, plural: boolean): void => {
    for (const w of W_CARD) {
      const isPlural = w[w.length - 1] === 'cards';
      if (isPlural !== plural) continue;
      const e = phraseAt(ctx, p, w);
      const of = e >= 0 ? phraseAt(ctx, e, W_OF) : -1;
      if (of < 0) continue;
      // edh-top-6 (CR 401.2, 603.2c, 608.2c; Breeches, Brazen Plunderer): "the top card of each of those opponents' libraries": the opponents a damage trigger's event dealt damage to (a plural
      // anaphor, resolved by the mention of the event's recipients, lower/scope.ts), one card from each library
      if (!plural) {
        const eo = phraseAt(ctx, of, W_EACH_OF_THOSE_OPPONENTS_LIBRARIES);
        if (eo >= 0) out.push({ end: eo, value: { ref: 'topCards', player: anaphorObj({ sort: 'player', number: 'plural', head: 'opponent', text: 'those opponents' }), count } });
      }
      // edh-c-73 (CR 404.1, 401.2; Soldevi Digger): "the top card of your graveyard", the card put there last (one card, your own graveyard only)
      if (!plural && count === 1 && ctx.toks[of]?.norm === 'your' && phraseAt(ctx, of + 1, W_GRAVEYARD_WORD) >= 0) out.push({ end: of + 2, value: { ref: 'topCards', player: { ref: 'you' }, count, zone: 'graveyard' } });
      // "your library" is written with the possessive "your"; every other owner is a player followed by 's
      if (ctx.toks[of]?.norm === 'your' && phraseAt(ctx, of + 1, W_LIBRARY) >= 0) out.push({ end: of + 2, value: { ref: 'topCards', player: { ref: 'you' }, count } });
      for (const pl of ctx.call('Player', of)) {
        const r = pl.value as PlayerRef;
        if (r.ref !== 'you' && (ctx.toks[pl.end]?.norm === "'s") && phraseAt(ctx, pl.end + 1, W_LIBRARY) >= 0) out.push({ end: pl.end + 2, value: { ref: 'topCards', player: r, count } });
      }
    }
  };
  tail(top, 1, false);
  // edhn78 (CR 404.1, 401.2; Shallow Grave): "the top creature card of your graveyard": the card put there last among the cards of that type (your own graveyard only)
  const typeWord = ctx.toks[top]?.norm ?? '';
  const cardType = TOP_CARD_TYPES[typeWord];
  if (cardType !== undefined) {
    const e = phraseAt(ctx, top + 1, P('card of your graveyard'));
    if (e >= 0) out.push({ end: e, value: { ref: 'topCards', player: { ref: 'you' }, count: 1, zone: 'graveyard', matching: { types: [cardType] } } });
  }
  for (const q of ctx.call('Qty', top)) if (q.end === top + 1 && ctx.toks[top]?.norm !== 'a' && ctx.toks[top]?.norm !== 'an') tail(q.end, q.value as Quantity, true);
  return out;
}

const W_ALL_BUT_BOTTOM = P('all but the bottom card of');

/**
 * std-rg (CR 401.1, 401.2): "all but the bottom card of each opponent's library" (Jace, Reality Sculptor): every card of the library except the bottom one, for each
 * player the owner phrase names (`topCards` with `allButBottom`).
 */
function allButBottom(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const of = phraseAt(ctx, pos, W_ALL_BUT_BOTTOM);
  if (of < 0) return out;
  const value = (player: PlayerRef): Alt['value'] => ({ ref: 'topCards', player, count: 0, allButBottom: 1 });
  if (ctx.toks[of]?.norm === 'your' && phraseAt(ctx, of + 1, W_LIBRARY) >= 0) out.push({ end: of + 2, value: value({ ref: 'you' }) });
  for (const pl of ctx.call('Player', of)) {
    const r = pl.value as PlayerRef;
    if (r.ref !== 'you' && ctx.toks[pl.end]?.norm === "'s" && phraseAt(ctx, pl.end + 1, W_LIBRARY) >= 0) out.push({ end: pl.end + 2, value: value(r) });
  }
  return out;
}

/**
 * std-lci (CR 401.2, 608.2c): "that many cards from the top of your library" (Gishath, Sun's Avatar; Ojer Kaslem): the top cards of that library, as many as
 * the number an earlier part of the ability names ("that many": the trigger's amount or a step's result, resolved by the anaphora pass); "the top N cards" is
 * `topCards`.
 */
function thatManyFromTop(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const of = phraseAt(ctx, pos, W_THAT_MANY_FROM_TOP);
  if (of < 0) return out;
  const count = anaphorQty({ sort: 'number', number: 'singular', text: 'that many' }) as Quantity;
  if (ctx.toks[of]?.norm === 'your' && phraseAt(ctx, of + 1, W_LIBRARY) >= 0) out.push({ end: of + 2, value: { ref: 'topCards', player: { ref: 'you' }, count } });
  for (const pl of ctx.call('Player', of)) {
    const r = pl.value as PlayerRef;
    if (r.ref !== 'you' && ctx.toks[pl.end]?.norm === "'s" && phraseAt(ctx, pl.end + 1, W_LIBRARY) >= 0) out.push({ end: pl.end + 2, value: { ref: 'topCards', player: r, count } });
  }
  return out;
}

/**
 * std-rx28 (CR 701.4a, 601.2b; Monstrous Emergence): "the creature you chose or the card you revealed" is what the spell's additional behold cost chose or revealed
 * (`{ref:'costBeheld'}`); the lint keeps it to a spell whose face has such a cost (model/lint-card.ts), so anywhere else the sentence is manual.
 */
const W_CHOSE_OR_REVEALED = P('the creature you chose or the card you revealed');
const costBeheld = (ctx: Parameters<HoleFn>[0], pos: number): Alt[] => {
  const e = phraseAt(ctx, pos, W_CHOSE_OR_REVEALED);
  const r = phraseAt(ctx, pos, W_THE_RETURNED_CREATURE);
  const c = phraseAt(ctx, pos, W_CHOSEN_CREATURE_OR_CARD);
  return [...(e >= 0 ? [{ end: e, value: { ref: 'costBeheld' } }] : []), ...(r >= 0 ? [{ end: r, value: { ref: 'costReturned' } }] : []), ...(c >= 0 ? [{ end: c, value: { ref: 'costChosenObject' } }] : [])];
};
/**
 * std-costs-2 (CR 601.2b; Close Encounter): "the chosen creature or card" is what the spell's additional cost "choose a creature you control or a warped creature card
 * you own in exile" chose (`{ref:'costChosenObject'}`); only in a spell whose face has such a cost (parser/parse.ts#costReadersWithoutCost, model/lint-nodes.ts).
 */
const W_CHOSEN_CREATURE_OR_CARD = P('the chosen creature or card');
/** std-costs-2: "each chosen <noun>" (the group of announced targets, holes/object.ts#anaphoricObjects). */
const W_EACH_CHOSEN = P('each chosen');
const W_EACH_THIS = P('each'); // edh-perms-12
const W_CHOSEN_THIS_WAY = P('chosen this way'); // edh-perms-12
const W_CREATED_THIS_WAY = P('created this way'); // edh-perms-15
const W_THIS_WAY_OBJ = P('this way'); // edh-perms-18
const W_ARMY_YOU_AMASSED = P('army you amassed'); // edh-d-92
/** std-rx28 (CR 702.188a; Scarlet Spider, Ben Reilly): "the returned creature" of web-slinging, `{ref:'costReturned'}`; only on a face with that keyword (model/lint-card.ts). */
const W_THE_RETURNED_CREATURE = P('the returned creature');

export const obj: HoleFn = (ctx, pos) => {
  const all = dedupe([...selfAndPronouns(ctx, pos), ...topCards(ctx, pos).filter((a) => (a.value as { count: Quantity }).count === 1), ...targetObjects(ctx, pos, true), ...costBeheld(ctx, pos)]);
  // std-rx28: "the returned creature" is web-slinging's returned creature, never also an anaphor of the same words (a static ability resolves none, and Oracle prints
  // the words only there)
  const r = phraseAt(ctx, pos, W_THE_RETURNED_CREATURE);
  return r < 0 ? all : all.filter((a) => a.end !== r || (a.value as { ref?: string }).ref === 'costReturned');
};

// ---------------------------------------------------------------------------
// sets
// ---------------------------------------------------------------------------

const eachRef = (filter: ObjectFilter): Alt['value'] => ({ ref: 'each', filter });

function quantified(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const add = (lead: readonly string[], plainSingularOk: boolean): void => {
    const p = phraseAt(ctx, pos, lead);
    if (p < 0) return;
    const starts: { at: number; other: boolean }[] = [{ at: p, other: false }];
    const o = phraseAt(ctx, p, W_OTHER);
    if (o >= 0) starts.push({ at: o, other: true });
    for (const s of starts) {
      for (const n of npAlts(ctx, s.at)) {
        if (!plainSingularOk && n.number === 'singular') continue;
        const f = s.other ? mergeFilter(n.filter, { other: true }) : n.filter;
        if (f === null) continue;
        out.push({ end: n.end, value: eachRef(f), ...(n.weak ? { weak: n.weak } : {}), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
      }
    }
  };
  add(W_EACH, true);
  add(W_ALL, false);
  add(W_EVERY, true);
  return out;
}

function barePlurals(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'plural' || n.head === 'ability' || n.head === 'spell') continue;
    out.push({ end: n.end, value: eachRef(n.filter), ...(n.weak ? { weak: n.weak } : {}), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
  }
  return out;
}

function pluralPronouns(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  if (phraseAt(ctx, pos, W_THEM) >= 0) {
    // edh-zones-14 (CR 607.2a, 603.4, 608.2c; Valakut Exploration): after an intervening "if" that counts the cards exiled with ~, the first sentence's "them" is those cards (holes/core.ts#Discourse)
    if (ctx.discourse?.linkedCond === true) out.push({ end: pos + 1, value: { ref: 'linked', link: 'exiled' } });
    else out.push({ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', text: 'them' }) });
  }
  // edh-perms-10 (CR 608.2c; Semester's End): "return each of them to the battlefield under its owner's control": the same group "them" names, each of its objects one by one
  // edh-c-94 (CR 608.2c, 115.1; Winter Blast: "~ deals 2 damage to each of those creatures with flying"): the objects of the group that match a description, the
  // creatures an earlier sentence announced as targets that have flying. Only with a description after the noun ("each of those creatures" alone stays unread).
  const eachOfThose = phraseAt(ctx, pos, W_EACH_OF_THOSE);
  if (eachOfThose >= 0) {
    for (const h of headNounAt(ctx, eachOfThose)) {
      if (!h.plural) continue;
      for (const n of npAlts(ctx, eachOfThose)) {
        // ("each of those creatures you don't control" is the part of the group a player controls or owns, parser/holes/object.ts#group: not this reading)
        if (n.number !== 'plural' || n.end <= h.end || Object.keys(n.filter).some((k) => !DESCRIBES_THOSE.has(k))) continue;
        const group = anaphorObj({ sort: 'set', number: 'plural', head: h.head, text: spanOf(ctx, pos, h.end).toLowerCase().replace(/^each of /, '') });
        out.push({ end: n.end, value: eachRef({ ...n.filter, is: group as never }), weak: 1 });
      }
    }
  }
  const eachOfThem = phraseAt(ctx, pos, W_EACH_OF_THEM);
  if (eachOfThem >= 0) out.push({ end: eachOfThem, value: anaphorObj({ sort: 'set', number: 'plural', text: 'them' }), weak: 1 });
  const those = phraseAt(ctx, pos, W_THOSE);
  if (those >= 0) for (const h of headNounAt(ctx, those)) if (h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'set', number: 'plural', head: h.head, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  // edhn95 (CR 608.2c, 111.1; Life of the Party: "The tokens are goaded for the rest of the game."): "the tokens" are the tokens an earlier step created, as "those tokens" are (the
  // anaphora pass binds it only to a group with the head "token", or the sentence stays manual)
  const theTokens = phraseAt(ctx, pos, W_THE_TOKENS);
  if (theTokens >= 0) out.push({ end: theTokens, value: anaphorObj({ sort: 'set', number: 'plural', head: 'token', text: 'the tokens' }) });
  // std-mkm (CR 603.2c, 608.2c): "the other creatures" after a trigger of "one or more other creatures" (Frantic Scapegoat: "you may suspect one of the other
  // creatures"): the plural group named before, other than the source; only creatures ("the other cards" of a dig is the rest of a group, the `Rest` hole)
  const other = phraseAt(ctx, pos, W_THE_OTHER_CREATURES);
  if (other >= 0) out.push({ end: other, value: anaphorObj({ sort: 'set', number: 'plural', head: 'creature', text: 'the other creatures' }) });
  // r5-dig (CR 701.20a, 608.2c): "If this spell was bargained, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand." after
  // "You may reveal up to two creature cards from among them.": the cards an earlier reveal step of the ability revealed (the participle `revealed` of
  // lower/mentions.ts), never another group; unresolved, the sentence stays manual
  // pc-exile-play-1 (CR 608.2c, 406.1; Dream Pillager, Stolen Strategy): "those exiled cards" are the cards the instruction before exiled, as "those cards" are
  const exiledCards = phraseAt(ctx, pos, W_THOSE_EXILED_CARDS);
  if (exiledCards >= 0) out.push({ end: exiledCards, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', text: 'those exiled cards' }), weak: 1 });
  const revealed = phraseAt(ctx, pos, W_THE_REVEALED_CARDS);
  if (revealed >= 0) out.push({ end: revealed, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'revealed', text: 'the revealed cards' }) });
  return out;
}
const W_EACH_OF_THEM = P('each of them'); // edh-perms-10
const W_EACH_OF_THOSE = P('each of those'); // edh-c-94
/** edh-c-94: what "each of those creatures with ..." may say about the creatures themselves (never who controls or owns them: that is the part of the group, parser/holes/object.ts#group). */
const DESCRIBES_THOSE: ReadonlySet<string> = new Set(['types', 'subtypes', 'keyword', 'notKeyword', 'colors', 'notColors', 'power', 'toughness', 'manaValue', 'tapped', 'attacking', 'blocking', 'supertypes', 'token']);
const W_THE_REVEALED_CARDS = P('the revealed cards');
const W_THOSE_EXILED_CARDS = P('those exiled cards');

/** Determiner-led phrases that may be joined into a union ("target creature and target artifact", "each creature and each artifact"). */
function ledPhrases(ctx: HoleCtx, pos: number): Alt[] {
  return [...targetObjects(ctx, pos, false), ...quantified(ctx, pos)];
}

/** The target phrase inside an object reference (a `target` marker), or undefined. */
const phraseOf = (v: unknown): TargetPhrase | undefined => {
  const t = typeof v === 'object' && v !== null && (v as { ref?: unknown }).ref === 'target' ? (v as { $target?: unknown }).$target : undefined;
  return t === undefined ? undefined : (t as TargetPhrase);
};

/**
 * FAST5 T42 (CR 115.1, 400.1): "up to one target creature card, up to one target Mount card, and up to one target Vehicle card from your graveyard": the zone said once after
 * the last card phrase is the zone of every card phrase before it that names none (Rise from the Wreck). Only a graveyard or exile (public zones, CR 404.2, 406.1) said
 * of a target card. Returns the parts with the zone filled in, and whether a card phrase is left without a zone (a union that can never be automated: weak).
 */
function sharedZone(parts: unknown[]): { parts: unknown[]; unstated: boolean } {
  const lastFilter = phraseOf(parts[parts.length - 1])?.filter;
  const zone = lastFilter?.zone;
  const share = lastFilter?.isCard === true && (zone === 'graveyard' || zone === 'exile');
  let unstated = false;
  const out = parts.map((v, i) => {
    const ph = phraseOf(v);
    if (ph === undefined || ph.kind !== 'object' || ph.filter?.isCard !== true || ph.filter.zone !== undefined) return v;
    if (!share || i === parts.length - 1) { unstated = true; return v; }
    return targetRef({ ...ph, filter: { ...ph.filter, zone, ...(lastFilter.owner !== undefined ? { owner: lastFilter.owner } : {}) } });
  });
  return { parts: out, unstated };
}

function unions(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const walk = (p: number, parts: unknown[], depth: number): void => {
    if (depth > 4) return; // edh-d-59 (Reconstruct History): up to five card phrases (was four)
    for (const a of ledPhrases(ctx, p)) {
      const next = [...parts, a.value];
      if (next.length > 1) {
        const shared = sharedZone(next);
        out.push({ end: a.end, value: { ref: 'union', of: shared.parts }, ...(shared.unstated ? { weak: 1 } : {}) });
      }
      for (const sep of W_AND_OR) { const e = phraseAt(ctx, a.end, sep); if (e >= 0) walk(e, next, depth + 1); }
      if (ctx.toks[a.end]?.norm === ',') walk(a.end + 1, next, depth + 1);
      // FAST4 T25: the serial comma before the last of three or more, "up to one target artifact, up to one target creature, and up to one target land"
      if (next.length >= 2 && ctx.toks[a.end]?.norm === ',' && ctx.toks[a.end + 1]?.norm === 'and') walk(a.end + 2, next, depth + 1);
    }
  };
  walk(pos, [], 0);
  return out;
}

/**
 * edh-c-58 (CR 109.1, 205.3m, 608.2c; Rise of the Hobgoblins): "red creatures and white creatures you control": two plural groups of one noun, the control phrase at the
 * end of the second naming both (the first has no controller of its own). The union of the two groups, each checked against the same controller.
 */
function pluralPair(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const a of npAlts(ctx, pos)) {
    if (a.number !== 'plural' || a.head === 'ability' || a.head === 'spell' || a.filter.controller !== undefined || a.filter.zone !== undefined || a.filter.owner !== undefined) continue;
    const e = phraseAt(ctx, a.end, [W_AND_OR[0]![0]!]);
    if (e < 0) continue;
    for (const b of npAlts(ctx, e)) {
      if (b.number !== 'plural' || b.head !== a.head || b.filter.controller !== 'you' || b.filter.zone !== undefined || b.filter.owner !== undefined) continue;
      out.push({ end: b.end, value: { ref: 'union', of: [eachRef({ ...a.filter, controller: 'you' }), eachRef(b.filter)] }, weak: 1, ...(a.flags.length + b.flags.length > 0 ? { flags: [...a.flags, ...b.flags] } : {}) });
    }
  }
  return out;
}

const W_SAME_NAME_CARDS = P('and all other cards with the same name as that card');

/**
 * FAST5 T42 (CR 201.2, 115.1, 608.2c): "target creature card and all other cards with the same name as that card from your graveyard" (Rat King, Verminister): one target
 * card, and with it every card in that graveyard that shares its name (a union: the target is in the set whichever way "other" reads). The zone at the end
 * is the zone of both parts. Only a graveyard (public, CR 404.2); the target is named by its own marker in the second part, so no pronoun is left to guess.
 */
function sameNameCards(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const d of targetDets(ctx, pos)) {
    if (d.number !== 'singular' || d.another || d.eachOf || d.min !== 1 || d.max !== 1) continue;
    for (const n of npAlts(ctx, d.end)) {
      if (n.number !== 'singular' || n.head !== 'card' || n.filter.zone !== undefined || n.filter.owner !== undefined) continue;
      const e = phraseAt(ctx, n.end, W_SAME_NAME_CARDS);
      if (e < 0 || ctx.toks[e]?.norm !== 'from') continue;
      for (const z of ctx.call('Zone', e + 1)) {
        const zv = z.value as { zone: string; owner?: unknown };
        if (zv.zone !== 'graveyard') continue;
        const where = { zone: 'graveyard', ...(zv.owner !== undefined ? { owner: zv.owner } : {}) };
        const sp = spec({ ...n.filter, ...where } as ObjectFilter, n.head);
        const phrase: TargetPhrase = { kind: sp.kind, ...(sp.filter ? { filter: sp.filter } : {}), min: 1, max: 1, text: spanOf(ctx, pos, n.end) };
        const flags = n.flags.filter((x) => x !== 'zone-unstated');
        const set = { ref: 'each', filter: { ...where, isCard: true, sharesWith: { with: targetRef(phrase), quality: 'name' } } };
        out.push({ end: z.end, value: { ref: 'union', of: [targetRef(phrase), set] }, ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      }
    }
  }
  return out;
}

/** FAST5 T42: the `Targets` hole: a target phrase only (parser/types.ts#HoleType). */
export const targetPhrases: HoleFn = (ctx, pos) => targetObjects(ctx, pos, false);

/** MX2: the `Pair` hole: one target phrase naming exactly two objects ("two target creatures"); see parser/types.ts#HoleType. */
export const pair: HoleFn = (ctx, pos) => targetObjects(ctx, pos, false).filter((a) => {
  const t = (a.value as { $target?: TargetPhrase }).$target;
  return t !== undefined && t.min === 2 && t.max === 2;
});

/**
 * FAST5 T66: the `OppTarget` hole, "up to one target nonland permanent that player controls" in a sentence that starts "for each opponent," (CR 115.1, 601.2c, 608.2f):
 * ONE target spec, at most one target for each opponent, each controlled by that opponent (`TargetSpec.perOpponent`). "That player" is the opponent the target is for,
 * known when the targets are chosen (the targets are chosen one opponent at a time), so it is no anaphor; the filter names no controller of its own.
 */
const W_THAT_PLAYER_CONTROLS = P('that player controls');
/** r5-cost: "for each opponent, tap up to one target nonland permanent that opponent controls": the same opponent, named as such. */
const W_THAT_OPPONENT_CONTROLS = P('that opponent controls');
const W_FROM_THAT_PLAYERS_GRAVEYARD = P("from that player 's graveyard"); // trek-13
/**
 * edh-next-138 (CR 115.1, 601.2c, 608.2f; Welcome to . . .): "for each opponent, up to one target noncreature artifact they control becomes ...": "they" is the opponent the
 * target is for, as "that player" (the targets are chosen one opponent at a time), in a sentence for each opponent only.
 */
const W_THEY_CONTROL = P('they control');
/** edh-top-6: "for each player, choose up to one target creature card in that player's graveyard" (Afterlife from the Loam): "in", as the same graveyard. */
const W_IN_THAT_PLAYERS_GRAVEYARD = P("in that player 's graveyard");
export const oppTarget: HoleFn = (ctx, pos) => perPlayerTarget(ctx, pos, 'opponent');
/**
 * edh-players-10 (CR 115.1, 601.2c, 601.2d; Windgrace's Judgment): the `AnyOppTarget` hole, "target nonland permanent that player controls" after "for any number of opponents,": the
 * caster chooses any number of opponents and a target for each, so a target phrase of one target (never "up to one") that is a target for each opponent chosen. The spec is
 * `OppTarget`'s with min 0: an opponent without a target is no chosen opponent.
 */
export const anyOppTarget: HoleFn = (ctx, pos) => perPlayerTarget(ctx, pos, 'opponent', true);
/**
 * edh-d-96 (CR 115.1, 601.2c, 122.1f; Geth's Summons): the `PoisonOppTarget` hole, `OppTarget`'s phrase after the words "for each opponent who has N or more poison counters as you cast ~ , put"
 * (the template spells them; N is read back from them): a target for each opponent who has at least N poison counters as the spell is cast (`perOpponentPoison`). Nothing anywhere else.
 */
const POISON_LEAD = ['or', 'more', 'poison', 'counters', 'as', 'you', 'cast', '~', ',', 'put'];
export const poisonOppTarget: HoleFn = (ctx, pos) => {
  const at = pos - POISON_LEAD.length;
  if (at < 3 || POISON_LEAD.some((w, i) => ctx.toks[at + i]?.norm !== w) || ctx.toks[at - 3]?.norm !== 'who' || ctx.toks[at - 2]?.norm !== 'has') return [];
  const n = numberAt(ctx, at - 1);
  if (n === undefined || n < 1) return [];
  return oppTarget(ctx, pos).flatMap((a) => {
    const t = (a.value as { $target?: TargetPhrase }).$target;
    return t === undefined ? [] : [{ ...a, value: { ...(a.value as object), $target: { ...t, perOpponentPoison: n } } }];
  });
};
/** r5-fxb: the `PlayerTarget` hole, the same in a sentence that starts "for each player," (`TargetSpec.perPlayer`; the filter names no controller, CR 115.1, 601.2c). */
export const playerTarget: HoleFn = (ctx, pos) => perPlayerTarget(ctx, pos, 'player');
function perPlayerTarget(ctx: Parameters<HoleFn>[0], pos: number, each: 'opponent' | 'player', anyNumber = false): Alt[] {
  const out: Alt[] = [];
  for (const d of targetDets(ctx, pos)) {
    if (anyNumber && (d.min !== 1 || d.another)) continue; // edh-players-10: only the bare "target"
    // std-rx30 (CR 109.2, 115.1): "for each player, choose up to one other target artifact or creature that player controls" (Kitesail Larcenist): "other" is other than
    // this object, as in any target phrase (only "for each player,": r5-cost's "that opponent controls" keeps its own reading)
    if (d.number !== 'singular' || d.eachOf || (d.another && each !== 'player') || d.max !== 1) continue;
    for (const n of npAlts(ctx, d.end)) {
      if (n.number !== 'singular' || n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined) continue;
      // (r5-cost: "that opponent controls" only in a sentence for each opponent; merge wave 8 with r5-fxb's "for each player,")
      // trek-13 (CR 115.1, 601.2c, 404.1; Assimilate the Wounded): "for each opponent, ... up to one target creature card from that player's graveyard that was put there from the
      // battlefield this turn": one target card at most in each opponent's graveyard (owner, never controller: a card in a graveyard has none, CR 108.3), optionally limited by
      // when and from where it was put there
      // edh-top-6 (CR 115.1, 601.2c, 404.1; Afterlife from the Loam): and for each PLAYER, "in that player's graveyard" (`perPlayer`, a card there is its owner's: perPlayerKey)
      const gy = n.filter.isCard === true ? Math.max(each === 'opponent' ? phraseAt(ctx, n.end, W_FROM_THAT_PLAYERS_GRAVEYARD) : -1, each === 'player' ? phraseAt(ctx, n.end, W_IN_THAT_PLAYERS_GRAVEYARD) : -1) : -1;
      if (gy >= 0) {
        const gyTails: { end: number; frag: ObjectFilter }[] = [{ end: gy, frag: {} }];
        for (const pm of postModAt(ctx, gy)) if (Object.keys(pm.frag).length > 0 && Object.keys(pm.frag).every((k) => k === 'putThereThisTurn' || k === 'putThereFrom' || k === 'putThereThisCombat') && (pm.flags ?? []).length === 0) gyTails.push({ end: pm.end, frag: pm.frag });
        for (const tail of gyTails) {
          const filter = mergeFilter({ ...n.filter, zone: 'graveyard', ...(each === 'opponent' ? { owner: 'opponent' as const } : {}) }, tail.frag);
          if (filter === null) continue;
          const s = spec(filter, n.head);
          if (s.kind !== 'object') continue;
          const phrase: TargetPhrase = { kind: 'object', ...(s.filter ? { filter: s.filter } : {}), min: anyNumber ? 0 : d.min, max: d.max, text: spanOf(ctx, pos, tail.end), ...(each === 'opponent' ? { perOpponent: true } : { perPlayer: true }), ...(d.another ? { another: true } : {}) };
          const flags = n.flags.filter((x) => x !== 'zone-unstated'); // the zone is said by "from that player's graveyard"
          out.push({ end: tail.end, value: targetRef(phrase), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
        }
        continue;
      }
      const e0 = Math.max(phraseAt(ctx, n.end, W_THAT_PLAYER_CONTROLS), each === 'opponent' ? Math.max(phraseAt(ctx, n.end, W_THAT_OPPONENT_CONTROLS), phraseAt(ctx, n.end, W_THEY_CONTROL)) : -1);
      if (e0 < 0) continue;
      // trek-8 (CR 115.1, 601.2c, 202.3): and a feature said after "that player controls" ("up to one target creature that player controls with mana value 3 or less"):
      // a "with" description, never another controller, owner or zone
      const tails: { end: number; frag: ObjectFilter; weak?: number }[] = [{ end: e0, frag: {} }];
      for (const pm of postModAt(ctx, e0)) {
        const keys = Object.keys(pm.frag);
        if (keys.length > 0 && keys.every((k) => k === 'manaValue' || k === 'power' || k === 'toughness' || k === 'manaValueParity') && (pm.flags ?? []).length === 0) tails.push({ end: pm.end, frag: pm.frag, ...(pm.weak ? { weak: pm.weak } : {}) });
      }
      for (const tail of tails) {
        const filter = mergeFilter(each === 'opponent' ? { ...n.filter, controller: 'opponent' } : n.filter, tail.frag);
        if (filter === null) continue;
        const s = spec(filter, n.head);
        if (s.kind !== 'object') continue;
        const e = tail.end;
        const phrase: TargetPhrase = { kind: 'object', ...(s.filter ? { filter: s.filter } : {}), min: anyNumber ? 0 : d.min, max: d.max, text: spanOf(ctx, pos, e), ...(each === 'opponent' ? { perOpponent: true } : { perPlayer: true }), ...(d.another ? { another: true } : {}) };
        const weak = Math.max(n.weak ?? 0, tail.weak ?? 0);
        out.push({ end: e, value: targetRef(phrase), ...(weak > 0 ? { weak } : {}), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
      }
    }
  }
  return dedupe(out);
}

const W_ITS_COUNTERS = [P('its counters'), P('those counters')];
const W_S_COUNTERS = P("'s counters");

/**
 * FAST5X E21: the `CountersOf` hole, the object whose counters (every kind) are put on another object (CR 122.5, 122.8): "its counters" and "those counters"
 * (the counters of the object an earlier phrase named, "if it had counters on it": the pronoun "it", resolved by the anaphora pass, design 6.4) and
 * "<object>'s counters" ("~'s counters"). The value is the object reference.
 */
export const countersOf: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  // the anaphor's text is the words as written, so the anaphora pass finds the pronoun in the sentence (lower/anaphora.ts#lookBack): "those counters" is one object's
  const [its, those] = W_ITS_COUNTERS;
  if (phraseAt(ctx, pos, its!) >= 0) out.push({ end: pos + 2, value: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) });
  if (phraseAt(ctx, pos, those!) >= 0) out.push({ end: pos + 2, value: anaphorObj({ sort: 'object', number: 'singular', text: 'those counters' }) });
  for (const o of ctx.call('Obj', pos)) {
    const e = phraseAt(ctx, o.end, W_S_COUNTERS);
    if (e >= 0) out.push({ end: e, value: o.value, ...(o.flags ? { flags: o.flags } : {}) });
  }
  return dedupe(out);
};

/** FAST3 T18: the `Group` hole: only "them" / "those <nouns>", a group an earlier phrase named (resolved by the anaphora pass, design 6.4). */
export const group: HoleFn = (ctx, pos) => {
  const out = pluralPronouns(ctx, pos);
  // r5-moved (CR 608.2c, 400.7, 611.2a): "cards exiled this way" as a group, "Until the end of your next turn, you may play cards exiled this way" (Hex Magic): what an earlier
  // move of the ability put into exile (the participle-only verb of lower/mentions.ts, std-lci's `EXILED_THIS_WAY`); unresolved, manual
  const ex = phraseAt(ctx, pos, W_CARDS_EXILED_THIS_WAY);
  if (ex >= 0) out.push({ end: ex, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: EXILED_THIS_WAY, text: 'cards exiled this way' }) });
  // FAST5 T59 (CR 608.2c, 109.4): "each of those creatures you don't control" (Lost in the Maze): the part of the group that player controls, or does not: the objects the
  // group names (`is`), narrowed by who controls or owns them. Only a named group ("those <nouns>") and only those two post-modifiers.
  for (const g of pluralPronouns(ctx, pos)) {
    const info = (g.value as { $anaphor?: { head?: string } }).$anaphor;
    if (info?.head === undefined) continue;
    for (const pm of postModAt(ctx, g.end)) {
      const keys = Object.keys(pm.frag);
      const who = keys.length === 1 && (keys[0] === 'controller' || keys[0] === 'owner' || (keys[0] === 'not' && Object.keys((pm.frag.not as object) ?? {}).every((k) => k === 'controller' || k === 'owner')));
      if (who) out.push({ end: pm.end, value: { ref: 'each', filter: { is: g.value, ...pm.frag } } });
    }
  }
  return out;
};

/**
 * T46: the `HandCard` hole: "<description> card from it", the cards of a hand an earlier sentence revealed or looked at (CR 701.20a, 701.20e, 402.3): "You choose
 * a nonland card from it". The value is the group those cards form, `{ref:'each', filter}` with the filter `{anyOf:[description], is: <the hand>, zone:'any'}`; the
 * hand is an anaphor with the head `hand`, which only the hand's mention answers to (lower/anaphora.ts#compatible, lower/mentions.ts#handOf), so "it" here never
 * names a permanent, a target or the source. "from it" states the zone (a hand), so the flag `zone-unstated` of the noun phrase goes (parser/lower/normalize.ts).
 */
export const handCard: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.filter.zone !== undefined || ctx.toks[n.end]?.norm !== 'from') continue;
    // std-rx30 (CR 701.20a; Cloak and Dagger, Entwined): "from their hand" after "They reveal their hand." names the same revealed hand
    const end = phraseAt(ctx, n.end + 1, W_IT) >= 0 ? n.end + 2 : phraseAt(ctx, n.end + 1, W_THEIR_HAND) >= 0 ? n.end + 3 : -1;
    if (end < 0) continue;
    const is = anaphorObj({ sort: 'set', number: 'plural', head: 'hand', text: end === n.end + 2 ? 'it' : 'their hand' });
    const filter = Object.keys(n.filter).length === 0 ? { is, zone: 'any' } : { anyOf: [n.filter], is, zone: 'any' };
    const flags = n.flags.filter((f) => f !== 'zone-unstated');
    out.push({ end, value: { ref: 'each', filter }, weak: n.weak, flags });
    // std-ry10 (CR 202.3, 701.20a): the mana value said after the zone, "a nonland card from it with mana value 3 or less" (Inquisition of Kozilek, Appetite for
    // Brains): the same card description with the comparison added. Only a mana value comparison (a card in a hand has one, CR 202.3)
    for (const pm of postModAt(ctx, end)) {
      if (Object.keys(pm.frag).some((k) => k !== 'manaValue') || pm.frag.manaValue === undefined) continue;
      const desc = mergeFilter(n.filter, pm.frag);
      if (desc === null) continue;
      out.push({ end: pm.end, value: { ref: 'each', filter: { anyOf: [desc], is, zone: 'any' } }, weak: n.weak + (pm.weak ?? 0), flags: [...flags, ...(pm.flags ?? [])] });
    }
  }
  return out;
};

/**
 * edh-c-104: the `HandCardPlural` hole: "<description> cards from it" (plural), the cards of a hand an earlier sentence revealed or looked at (CR 701.20a, 701.20e, 402.3):
 * "choose two cards from it" (Agonizing Memories). The same group as `HandCard` (the hand an anaphor with the head `hand`); only "from it", only plural cards, no zone of their own.
 */
export const handCardPlural: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'plural' || n.head !== 'card' || n.filter.zone !== undefined || n.filter.controller !== undefined || n.filter.owner !== undefined || ctx.toks[n.end]?.norm !== 'from') continue;
    const end = phraseAt(ctx, n.end + 1, W_IT) >= 0 ? n.end + 2 : -1;
    if (end < 0) continue;
    const is = anaphorObj({ sort: 'set', number: 'plural', head: 'hand', text: 'it' });
    const filter = Object.keys(n.filter).length === 0 ? { is, zone: 'any' } : { anyOf: [n.filter], is, zone: 'any' };
    out.push({ end, value: { ref: 'each', filter }, weak: n.weak, flags: n.flags.filter((f) => f !== 'zone-unstated') });
  }
  return out;
};

/**
 * edh-c-8: the `HandCardBare` hole: "[from it] a <description> card" of the hand an earlier sentence revealed (the first card of a list names the hand with "from it" in front) (CR 701.20a, 701.20e, 402.3): "You choose from it
 * a nonland card with mana value 3 or less and a card with mana value 4 or greater" (Distended Mindbender). The value is the group of `HandCard` (`{anyOf:[description], is: <the hand>, zone:'any'}`);
 * the template's own "from it" states the zone, so the flag `zone-unstated` goes. Only one singular card noun phrase with no controller, owner or zone.
 */
const W_FROM_IT = P('from it');
export const handCardBare: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const fromIt = phraseAt(ctx, pos, W_FROM_IT); // the first card names the hand ("from it"), a second one after "and" only says the card
  const start = fromIt >= 0 ? fromIt : pos;
  const art = ctx.toks[start]?.norm;
  if (art !== 'a' && art !== 'an') return out;
  for (const n of npAlts(ctx, start + 1)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.filter.zone !== undefined || n.filter.controller !== undefined || n.filter.owner !== undefined) continue;
    // the card after "and" has no "it" of its own to resolve: it is a card of the hand the reveal bound as `them` (a name nothing else binds is refused by the lint)
    const is = fromIt >= 0 ? anaphorObj({ sort: 'set', number: 'plural', head: 'hand', text: 'it' }) : { ref: 'bound' as const, name: 'them' };
    const filter = Object.keys(n.filter).length === 0 ? { is, zone: 'any' } : { anyOf: [n.filter], is, zone: 'any' };
    out.push({ end: n.end, value: { ref: 'each', filter }, weak: n.weak, flags: n.flags.filter((f) => f !== 'zone-unstated') });
  }
  return out;
};

/**
 * T46: the `ChosenCard` hole: "that card" naming the card a player chose (a `chooseObjects` step answers to the participle `chosen`, lower/mentions.ts), nothing else:
 * "That player discards that card" discards the chosen card of their hand (CR 701.9a), and never a card some other phrase named.
 */
const W_THE_CHOSEN_CARD = P('the chosen card');
export const chosenCard: HoleFn = (ctx, pos) => (phraseAt(ctx, pos, W_THAT_CARD) >= 0
  ? [{ end: pos + 2, value: anaphorObj({ sort: 'object', number: 'singular', head: 'card', participle: 'chosen', text: 'that card' }) }]
  // edh-d-26 (CR 701.9a, 608.2c; Vendilion Clique): "that player reveals the chosen card, ...": Oracle's other name for the card a player chose
  : phraseAt(ctx, pos, W_THE_CHOSEN_CARD) >= 0 ? [{ end: pos + 3, value: anaphorObj({ sort: 'object', number: 'singular', head: 'card', participle: 'chosen', text: 'the chosen card' }) }]
  // Standard round 4, r4-refs (CR 701.9a, 608.2c): "If you do, they discard it.": the bare pronoun for the card chosen, which names nothing else here (the participle
  // keeps every other mention out)
  : phraseAt(ctx, pos, W_IT) >= 0 ? [{ end: pos + 1, value: anaphorObj({ sort: 'object', number: 'singular', participle: 'chosen', text: 'it' }) }] : []);
/** FAST5 T49: the `They` hole: the word "they" naming a group an earlier sentence named, a plural anaphor like "them" (resolved by the anaphora pass, design 6.4). */
export const they: HoleFn = (ctx, pos) => (phraseAt(ctx, pos, P('they')) >= 0 ? [{ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', text: 'they' }) }] : []);

/** edh-top-6: the `TheyAre` hole, the contraction "they're" read as the pronoun "they" (as `ItIs` reads "it's"); a template spells out what follows: "{o:TheyAre} {st:PluralSubtype} in addition to their other types". */
export const theyAre: HoleFn = (ctx, pos) => (phraseAt(ctx, pos, P("they're")) >= 0 ? [{ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', text: 'they' }) }] : []);

const W_CARDS = P('cards');

/** r3-dig: the `TypedThose` hole, "those land cards" (see parser/types.ts#HoleType): one singular card type word between "those" and "cards". */
export const typedThose: HoleFn = (ctx, pos) => {
  const at = phraseAt(ctx, pos, W_THOSE);
  const t = at >= 0 ? ctx.toks[at] : undefined;
  // edh-d-102 (CR 110.4, 608.2c; Auspicious Starrix): or "permanent", "those permanent cards" after "until you exile X permanent cards" (lower/mentions.ts gives that step the head)
  if (t !== undefined && t.kind === 'WORD' && t.norm === 'permanent' && phraseAt(ctx, at + 1, W_CARDS) >= 0) return [{ end: at + 2, value: anaphorObj({ sort: 'set', number: 'plural', head: 'permanent', text: spanOf(ctx, pos, at + 2).toLowerCase() }) }];
  const ty = t !== undefined && t.kind === 'WORD' ? ctx.vocab.types.get(t.norm) : undefined;
  if (ty === undefined || ty.plural || phraseAt(ctx, at + 1, W_CARDS) < 0) return [];
  return [{ end: at + 2, value: anaphorObj({ sort: 'set', number: 'plural', head: ty.name.toLowerCase(), text: spanOf(ctx, pos, at + 2).toLowerCase() }) }];
};

/** FAST5 T76: the `Them` hole: "them" or "those <plural noun>" naming a group an earlier sentence named, and nothing else (the pronoun readings of `Objs`). */
export const them: HoleFn = (ctx, pos) => [...pluralPronouns(ctx, pos), ...theExiledCards(ctx, pos), ...typedCardsExiledThisWay(ctx, pos) /* edh-cast-2 */, ...bareCardsExiledThisWay(ctx, pos) /* edh-next-108 */, ...theChosenGroup(ctx, pos) /* trek-22 */];

const W_THE_CHOSEN = P('the chosen');
/**
 * trek-22 (CR 115.1, 608.2c; T'Pring, Never Parted): "the chosen creatures" after a sentence that only announced two targets ("Choose another target creature you control and target creature an opponent controls."):
 * the group those targets are (lower/mentions.ts#announcedGroup gives it the participle `chosen`), as the group `Them` names for "those creatures". Only a plural noun.
 */
function theChosenGroup(ctx: HoleCtx, pos: number): Alt[] {
  const the = phraseAt(ctx, pos, W_THE_CHOSEN);
  const out: Alt[] = [];
  if (the >= 0) for (const h of headNounAt(ctx, the)) if (h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'chosen', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  return out;
}

const W_THE_EXILED_CARDS = P('the exiled cards');
/**
 * std-rj (CR 406.1, 608.2c; Doom Reigns Supreme): "You may cast up to two spells from among the exiled cards without paying their mana costs." after "target opponent exiles the top five
 * cards of their library": the cards an earlier exile step of the ability exiled (the participle `exiled` of lower/mentions.ts), never another group. Only the `Them` hole reads
 * it (the templates that pick among a group of exiled cards); unresolved, the sentence stays manual.
 */
function theExiledCards(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_THE_EXILED_CARDS);
  const out: Alt[] = e >= 0 ? [{ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'exiled', text: 'the exiled cards' }) }] : [];
  // pc-exile-play-2 (CR 608.2c, 406.1; Fevered Suspicion): "those nonland cards" after "exile cards from the top of their library until they exile a nonland card"
  const n = phraseAt(ctx, pos, W_THOSE_NONLAND_CARDS);
  if (n >= 0) out.push({ end: n, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', text: 'those nonland cards' }), weak: 1 });
  return out;
}
const W_THOSE_NONLAND_CARDS = P('those nonland cards');

export const objs: HoleFn = (ctx, pos) => dedupe([
  ...voteObjsAt(ctx, pos), // M12-3 (CR 701.38a): "each permanent with the most votes or tied for most votes"
  ...ctx.call('Obj', pos), ...targetObjects(ctx, pos, false), ...quantified(ctx, pos), ...barePlurals(ctx, pos), ...pluralPronouns(ctx, pos), ...topCards(ctx, pos), ...thatCardFromGraveyard(ctx, pos), ...thatManyFromTop(ctx, pos), ...allButBottom(ctx, pos), ...unions(ctx, pos), ...sameNameCards(ctx, pos), ...pluralPair(ctx, pos),
]);

// ---------------------------------------------------------------------------
// recipients
// ---------------------------------------------------------------------------

const W_TARGETS = P('targets');
const W_UP_TO = P('up to');
const PLURAL_ANY: [string[], number, number | 'any'][] = [
  [P('one or two'), 1, 2], [P('one , two , or three'), 1, 3], [P('any number of'), 0, 'any'], [P('one or more'), 1, 'any'],
];

/**
 * "one or two targets", "any number of targets", "up to three targets", "two targets", "X targets": the plural of "any target" (CR 115.4), the recipients
 * of divided damage (CR 601.2d: Fire // Ice, Fireball). Each is ONE target spec with a variable number of targets (CR 601.2c). WP20 INTERFACE CHANGE.
 */
function anyTargetsPlural(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const push = (p: number, min: number | Quantity, max: number | 'any' | Quantity): void => {
    const e = phraseAt(ctx, p, W_TARGETS);
    if (e >= 0) out.push({ end: e, value: targetRef({ kind: 'anyTarget', min, max, text: spanOf(ctx, pos, e) }) });
  };
  for (const [ws, min, max] of PLURAL_ANY) { const e = phraseAt(ctx, pos, ws); if (e >= 0) push(e, min, max); }
  // a number of at least two, or X (a single target is "any target")
  const count = (p: number): { end: number; value: number | Quantity } | null => {
    if (ctx.toks[p]?.kind === 'X') return { end: p + 1, value: { q: 'X' } };
    const n = numberAt(ctx, p);
    return n !== undefined && n >= 2 ? { end: p + 1, value: n } : null;
  };
  const upTo = phraseAt(ctx, pos, W_UP_TO);
  const u = upTo >= 0 ? count(upTo) : null;
  if (u) push(u.end, 0, u.value);
  const c = count(pos);
  if (c) push(c.end, c.value, c.value);
  // FAST4 T25: "each of up to three targets" (Jaya's Immolating Inferno): the same targets named one by one (as "each of up to two target creatures",
  // parser/holes/target.ts); only in front of a count of two or more or "up to N", never a single target
  const eachOf = phraseAt(ctx, pos, W_EACH_OF_T);
  if (eachOf >= 0) {
    const ue = phraseAt(ctx, eachOf, W_UP_TO);
    const uc = ue >= 0 ? count(ue) : null;
    if (uc) push(uc.end, 0, uc.value);
    const cc = count(eachOf);
    if (cc) push(cc.end, cc.value, cc.value);
    // std-sos (CR 115.4, 601.2c): "each of one or two targets" (Prismari Charm, Storm of Steel): the same plural counts as above, named one by one
    for (const [ws, min, max] of PLURAL_ANY) { const e = phraseAt(ctx, eachOf, ws); if (e >= 0) push(e, min, max); }
  }
  return out;
}
const W_EACH_OF_T = P('each of');
const W_OTHER_THAN_T = P('other than');

function mixedTargets(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [...anyTargetsPlural(ctx, pos)];
  const anyT = phraseAt(ctx, pos, W_ANY_TARGET);
  if (anyT >= 0) out.push({ end: anyT, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, text: spanOf(ctx, pos, anyT) }) });
  // edh-d-74 (CR 115.1, 601.2c, 601.7a; Karplusan Minotaur): "any target of an opponent's choice": one target chosen by an opponent of the controller (TargetSpec.chooser; the controller picks which
  // opponent decides in a game with several, CR 601.7a)
  const anyOpp = anyT >= 0 ? phraseAt(ctx, anyT, W_OF_AN_OPPONENTS_CHOICE) : -1;
  if (anyOpp >= 0) out.push({ end: anyOpp, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, text: spanOf(ctx, pos, anyOpp), chooser: { ref: 'anOpponent' } }) });
  // edh-c-39 (CR 115.1, 115.4, 601.2c, 603.3d; Goblin Test Pilot): "any target chosen at random": one target, a creature, planeswalker, battle or player, that the game picks at random among the legal ones as
  // the ability is put on the stack (TargetSpec.random; the ruling: every legal target has an equal chance, the source itself is one)
  const anyRandom = anyT >= 0 ? phraseAt(ctx, anyT, W_CHOSEN_AT_RANDOM) : -1;
  if (anyRandom >= 0) out.push({ end: anyRandom, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, text: spanOf(ctx, pos, anyRandom), random: true }) });
  // FAST4 T34 (CR 115.4): "any target that isn't a Dragon": a creature, planeswalker or battle that is not one, or a player (no player is a Dragon); the
  // filter narrows the objects only (rules/targets.ts#targetOptions). Only one creature type after "a" / "an".
  const isnt = anyT >= 0 ? phraseAt(ctx, anyT, W_THAT_ISNT) : -1;
  const art = isnt >= 0 ? ctx.toks[isnt]?.norm : undefined;
  if (art === 'a' || art === 'an') {
    for (const n of npAlts(ctx, isnt + 1)) {
      const f = n.filter;
      // CMD2 (CR 115.4, 903.3): "any target that isn't a commander" (a player is never a commander, CR 903.3: only cards are)
      if (n.number === 'singular' && n.flags.length === 0 && f.commander === true && Object.entries(f).every(([k, v]) => v === undefined || k === 'commander')) {
        out.push({ end: n.end, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, filter: { commander: false }, text: spanOf(ctx, pos, n.end) }) });
        continue;
      }
      if (n.number !== 'singular' || n.flags.length > 0 || (f.subtypes?.length ?? 0) !== 1 || Object.entries(f).some(([k, v]) => v !== undefined && k !== 'subtypes')) continue;
      out.push({ end: n.end, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, filter: { notSubtypes: [...f.subtypes!] }, text: spanOf(ctx, pos, n.end) }) });
    }
  }
  // edh-next-86 (CR 115.4, 120.1; Needle Drop): "any target that was dealt damage this turn": a creature, planeswalker or battle dealt damage this turn, or a player dealt damage this turn
  const wasDealt = anyT >= 0 ? phraseAt(ctx, anyT, W_THAT_WAS_DEALT_DAMAGE) : -1;
  if (wasDealt >= 0) out.push({ end: wasDealt, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, filter: { dealtDamageThisTurn: true }, players: { who: 'any', dealtDamage: true }, text: spanOf(ctx, pos, wasDealt) }) });
  // edh-top-15 (CR 115.4, 608.2b; Toralf, God of Fury): "any target other than that permanent": a creature, planeswalker, battle or player, never the one object the sentence names with a pronoun or
  // "that <noun>" (an anaphor the lowering pass resolves); the filter narrows the objects only (rules/targets.ts#targetOptions), a player is always allowed
  const otherThan = anyT >= 0 ? phraseAt(ctx, anyT, W_OTHER_THAN_T) : -1;
  if (otherThan >= 0) {
    for (const o of ctx.call('Obj', otherThan)) {
      const v = o.value as { $anaphor?: { sort?: string; number?: string } } | null;
      if (v === null || typeof v !== 'object' || v.$anaphor === undefined || v.$anaphor.sort !== 'object' || v.$anaphor.number !== 'singular') continue;
      out.push({ end: o.end, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, filter: { not: { is: o.value as never } }, text: spanOf(ctx, pos, o.end) }), ...(o.flags ? { flags: o.flags } : {}) });
    }
  }
  const anyO = phraseAt(ctx, pos, W_ANY_OTHER_TARGET);
  if (anyO >= 0) out.push({ end: anyO, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, text: spanOf(ctx, pos, anyO), another: true }) });
  // edh-c-53 (CR 115.3, 115.4, 601.2c; Cone of Flame): "1 damage to any target, 2 damage to another target, and 3 damage to a third target": a bare "another target" / "a third target"
  // is any target other than the earlier ones of the sequence (`another`: distinctFrom them, lower/targets.ts#specOf); with none before it the lowering reads "other than this object", the
  // same as "any other target"
  for (const w of [W_ANOTHER_TARGET, W_A_THIRD_TARGET]) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, text: spanOf(ctx, pos, e), another: true }) });
  }
  const player = (d: TargetDet, p: number): { end: number; who: 'any' | 'opponent' }[] => {
    const r: { end: number; who: 'any' | 'opponent' }[] = [];
    const a = phraseAt(ctx, p, P('player'));
    if (a >= 0) r.push({ end: a, who: 'any' });
    const b = phraseAt(ctx, p, P('opponent'));
    if (b >= 0) r.push({ end: b, who: 'opponent' });
    return d.number === 'singular' ? r : [];
  };
  for (const d of targetDets(ctx, pos)) {
    if (d.number !== 'singular' || d.eachOf) continue; // the mixed forms have no "each of" reading
    // "target player or planeswalker", "target opponent or planeswalker"
    for (const pl of player(d, d.end)) {
      const or = phraseAt(ctx, pl.end, P('or'));
      if (or < 0) continue;
      for (const n of npAlts(ctx, or)) {
        if (n.number !== 'singular' || n.head === 'spell' || n.head === 'ability') continue;
        out.push({
          end: n.end,
          value: targetRef({ kind: 'objectOrPlayer', filter: n.filter, players: { who: pl.who }, min: d.min, max: d.max, text: spanOf(ctx, pos, n.end), ...(d.another ? { another: true } : {}) }),
          ...(n.flags.length > 0 ? { flags: n.flags } : {}),
        });
      }
    }
    // edh-players-11 (CR 115.1, 115.4; All Will Be One): "target opponent, creature an opponent controls, or planeswalker an opponent controls": a player, or an object of either of
    // two descriptions (a list of three, the serial comma), as one target; each description is a singular noun phrase of one kind
    for (const pl of player(d, d.end)) {
      if (ctx.toks[pl.end]?.norm !== ',') continue;
      for (const a of npAlts(ctx, pl.end + 1)) {
        if (a.number !== 'singular' || a.head === 'spell' || a.head === 'ability' || a.flags.length > 0 || ctx.toks[a.end]?.norm !== ',') continue;
        const or = phraseAt(ctx, a.end + 1, P('or'));
        if (or < 0) continue;
        for (const b of npAlts(ctx, or)) {
          if (b.number !== 'singular' || b.head === 'spell' || b.head === 'ability' || b.flags.length > 0) continue;
          out.push({ end: b.end, value: targetRef({ kind: 'objectOrPlayer', filter: { anyOf: [a.filter, b.filter] }, players: { who: pl.who }, min: d.min, max: d.max, text: spanOf(ctx, pos, b.end), ...(d.another ? { another: true } : {}) }) });
        }
      }
    }
    // "target creature or player"
    for (const n of npAlts(ctx, d.end)) {
      if (n.number !== 'singular' || n.head === 'spell' || n.head === 'ability') continue;
      // edh-c-109 (CR 115.1; Price of Betrayal): a list of kinds closes with the serial comma, "target artifact, creature, planeswalker, or opponent"
      const serial = (n.filter.types?.length ?? 0) > 1 && ctx.toks[n.end]?.norm === ',';
      const or = phraseAt(ctx, serial ? n.end + 1 : n.end, P('or'));
      if (or < 0) continue;
      for (const pl of player(d, or)) {
        out.push({
          end: pl.end,
          value: targetRef({ kind: 'objectOrPlayer', filter: n.filter, players: { who: pl.who }, min: d.min, max: d.max, text: spanOf(ctx, pos, pl.end), ...(d.another ? { another: true } : {}) }),
        });
      }
    }
  }
  return out;
}

/**
 * FAST3 T18: a recipient "them" may be a group of objects or ONE player (Oracle's singular "they": "At the beginning of each player's upkeep, ~ deals 1 damage
 * to them", CR 120.1): the anaphor of "they" (sort `any`), which the unique-candidate rule resolves to a plural object or a player (lower/anaphora.ts#compatible).
 * Everywhere else ("destroy them") "them" stays a group of objects.
 */
const recipientThem = (a: Alt, pos: number): Alt => {
  const m = (a.value as { $anaphor?: { sort?: string; text?: string; head?: string } }).$anaphor;
  // the bare word only ("each of them" is a group)
  return m !== undefined && a.end === pos + 1 && m.text === 'them' && m.sort === 'set' && m.head === undefined ? { ...a, value: anaphorObj({ sort: 'any', number: 'plural', text: 'them' }) } : a;
};

/**
 * std-rx19 (CR 506.2, 508.1b; Mage Slayer, Fathom Fleet Swordjack): "the player or planeswalker it's attacking" is the defender of the trigger's attack, the
 * `defender` role of an "attacks" event (a player, or the planeswalker or battle that creature attacks). Outside an attack trigger the role is not exposed and
 * the lint refuses it (model/lint-roles.ts, design 6.4), so the sentence stays manual.
 */
// p2-combat-flow-1 (Raid Bombardment): "the player or planeswalker that creature is attacking", the same defender after a trigger on "a creature ... attacks"
const W_ATTACKED = [P("the player or planeswalker it's attacking"), P('the player or planeswalker that creature is attacking')];
const attacked = (ctx: Parameters<HoleFn>[0], pos: number): Alt[] =>
  W_ATTACKED.flatMap((w) => { const e = phraseAt(ctx, pos, w); return e >= 0 ? [{ end: e, value: { ref: 'event', role: 'defender' } }] : []; });

const W_OR_PLAYER_ANAPHOR = P('or player');
/**
 * edh-perms-15 (CR 115.1, 608.2c; Animation Module): "that permanent or player", the one target "permanent or player" an earlier sentence announced (a mixed target, sort `any`):
 * an anaphor of head `<noun>` and second head `player` (lower/anaphora.ts#compatible, `orHead`).
 */
const thatObjectOrPlayer = (ctx: Parameters<HoleFn>[0], pos: number): Alt[] => {
  const that = phraseAt(ctx, pos, W_THAT);
  if (that < 0) return [];
  const out: Alt[] = [];
  for (const h of headNounAt(ctx, that)) {
    if (h.plural) continue;
    const e = phraseAt(ctx, h.end, W_OR_PLAYER_ANAPHOR);
    if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, orHead: 'player', text: spanOf(ctx, pos, e).toLowerCase() }) });
  }
  return out;
};

export const recipient: HoleFn = (ctx, pos) => dedupe([...mixedTargets(ctx, pos), ...thatObjectOrPlayer(ctx, pos), ...ctx.call('Player', pos), ...ctx.call('Objs', pos).map((a) => recipientThem(a, pos)), ...attacked(ctx, pos)]);

/** PUSH1 T2 (INTERFACE CHANGE): the `AnyTarget` hole, ONE target that may be an object or a player ("any target", "target creature or player"; CR 115.4). */
export const anyTarget: HoleFn = (ctx, pos) =>
  mixedTargets(ctx, pos).filter((a) => {
    const t = (a.value as { $target?: { min?: unknown; max?: unknown } }).$target;
    return t !== undefined && t.min === 1 && t.max === 1;
  });


const W_ITS = P("it's");

/**
 * FAST5 T47 (INTERFACE CHANGE, hole `ItIs`): the contraction "it's", read as the pronoun "it" (a singular object an earlier sentence named, resolved by the
 * unique-candidate rule of lower/anaphora.ts like `Obj`'s "it"). A template spells out what follows: "{o:ItIs} an enchantment".
 */
export const itIs: HoleFn = (ctx, pos) =>
  phraseAt(ctx, pos, W_ITS) >= 0 ? [{ end: pos + 1, value: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) }] : [];

const W_ITS_POSS = P('its');

/**
 * edh-c-39 (hole `Its`): the possessive pronoun "its" read as the pronoun "it" (the singular object an earlier clause named, resolved by the unique-candidate rule of
 * lower/anaphora.ts like `Obj`'s "it"). A template spells out what follows: "switch {o:Its} power and toughness {d:Dur}" (Valakut Fireboar, CR 613.4d).
 */
export const itsPoss: HoleFn = (ctx, pos) =>
  phraseAt(ctx, pos, W_ITS_POSS) >= 0 ? [{ end: pos + 1, value: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) }] : [];

const W_EACH_OF_UP_TO = P('each of up to');
const W_OTHER_TARGETS = P('other targets');

/**
 * FAST4 T34 (INTERFACE CHANGE, hole `OtherTargets`): "each of up to two other targets" after a first target ("~ deals 4 damage to any target and 3 damage to
 * each of up to two other targets"): ONE spec of any targets (CR 115.4) with up to N targets (CR 601.2c), each other than the targets named before it (CR
 * 115.3, `another`). Only that phrase: a literal count of two or more.
 */
export const otherTargets: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_EACH_OF_UP_TO);
  if (e < 0) return out;
  const n = numberAt(ctx, e);
  if (n === undefined || n < 2) return out;
  const end = phraseAt(ctx, e + 1, W_OTHER_TARGETS);
  if (end >= 0) out.push({ end, value: targetRef({ kind: 'anyTarget', min: 0, max: n, text: spanOf(ctx, pos, end), another: true }), flags: ['each-of'] });
  return out;
};

const W_THE_REST = [P('the rest'), P('the other'), P('the rest of the cards'), P('the rest of those cards'), P('the rest of the cards revealed this way') /* edh-c-65: Aethermage's Touch */]; // edh-zones-13: the last, Winota; edh-perms-17: the rest of those cards (Armored Skyhunter)
const W_ALL_OTHER_REVEALED = P('all other cards revealed this way'); // p2-zone-moves-2
const W_REST_OF_EXILED = P('the rest of the exiled cards'); // std-library-3
const W_REST_OF_REVEALED = P('the rest of the revealed cards'); // pc-zones-1
const W_OTHER_CARDS_EXILED_THIS_WAY = P('the other cards exiled this way'); // edh-top-8
const W_EXILED_NOT_CAST = P("the exiled cards that weren't cast this way"); // edh-zones-15
const W_ALL_EXILED_NOT_CAST = P("all cards exiled this way that weren't cast"); // edh-d-96 (Epic Experiment)
// std-rh (CR 608.2c, 701.20e; Genesis Wave): "all cards revealed this way that weren't put onto the battlefield" is the cards of the revealed group that a choice among it did not
// put there: the head "rest-not-put" is only given to "the rest" of a choice whose chosen cards are all put onto the battlefield (lower/mentions.ts#restOf), never to the rest
// after an optional put of one card ("You may put that card onto the battlefield", where a card not put is among them; fail closed)
const W_REST_NOT_PUT = P("all cards revealed this way that weren't put onto the battlefield");
const W_REVEALED_NOT_CAST = P('all revealed cards not cast this way'); // edh-d-35
const W_ALL_REVEALED = [P('all cards revealed this way'), P('the revealed cards') /* edh-d-87: Trepanation Blade, "That player puts the revealed cards into their graveyard" */]; // edh-next-96

/**
 * FAST5 T43 (INTERFACE CHANGE, hole `Rest`): "the rest" (or "the other", one card left) of a group after a choice among it, and nothing else: the plural anaphor
 * whose head noun is "rest" (lower/mentions.ts#restOf makes its only antecedent, the choice among a group; lower/anaphora.ts resolves it by the unique-candidate
 * rule, CR 608.2c). Written by the templates that put the cards a player did not pick somewhere ("Put the rest on the bottom of your library").
 */
export const rest: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const ws of W_THE_REST) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest', text: 'the rest' }) });
  }
  // std-library-3 (CR 608.2c, 406.1): "Then put the rest of the exiled cards into your hand." (Portent of Calamity): what a choice among a group of exiled cards (one cast
  // from among them) left in exile (lower/mentions.ts#restOf, head "rest-exiled")
  const exiled = phraseAt(ctx, pos, W_REST_OF_EXILED);
  if (exiled >= 0) out.push({ end: exiled, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest-exiled', text: 'the rest of the exiled cards' }) });
  // edh-top-8 (CR 608.2c, 406.1; Plargg and Nassari): "You may cast up to two spells from among the other cards exiled this way ...", after "An opponent chooses a nonland card exiled this way.": the cards of the
  // group that choice did not pick, still in exile (head "exiled-other": lower/mentions.ts#restOf only; edh-top-9: never the rest of an exile-until's own stop, exiledRestOf)
  const otherExiled = phraseAt(ctx, pos, W_OTHER_CARDS_EXILED_THIS_WAY);
  if (otherExiled >= 0) out.push({ end: otherExiled, value: anaphorObj({ sort: 'set', number: 'plural', head: 'exiled-other', text: 'the other cards exiled this way' }) });
  // edh-zones-15 (CR 406.1, 608.2c; lower/mentions.ts#exiledNotCastOf, head "rest-notcast"): the cards an exile-until exiled that were not cast (Chaos Wand)
  const notCast = phraseAt(ctx, pos, W_EXILED_NOT_CAST);
  if (notCast >= 0) out.push({ end: notCast, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest-notcast', text: "the exiled cards that weren't cast this way" }) });
  // edh-d-96 (CR 406.1, 601.2a, 608.2c; Epic Experiment): "Then put all cards exiled this way that weren't cast into your graveyard." after a free cast of chosen cards from among a group of exiled cards:
  // the cards of the group the cast left in exile (lower/mentions.ts#restOf gives the head "rest-exiled-notcast" only when a step casts the chosen cards)
  const allNotCast = phraseAt(ctx, pos, W_ALL_EXILED_NOT_CAST);
  if (allNotCast >= 0) out.push({ end: allNotCast, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest-exiled-notcast', text: "all cards exiled this way that weren't cast" }) });
  // edh-zones-26 (CR 406.1, 601.2a, 608.2c; Tibalt's Trickery): "Then they put the exiled cards on the bottom of their library in a random order." after the exile-until and the cast of the card it
  // stopped at: the same cards, those the exile left in exile (the card cast left exile for the stack)
  const exiledCards = phraseAt(ctx, pos, W_THE_EXILED_CARDS);
  // (only before "on the bottom": "the exiled cards" elsewhere is std-rj's reading, 'among the exiled cards'; two readings would be a guard G5 ambiguity)
  if (exiledCards >= 0 && ctx.toks[exiledCards]?.norm === 'on' && ctx.toks[exiledCards + 2]?.norm === 'bottom') out.push({ end: exiledCards, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest-notcast', text: 'the exiled cards' }) });
  // pc-zones-1 (CR 608.2c, 701.20a): "the rest of the revealed cards" is "the rest" again (Kruphix's Insight): the cards of the revealed group a choice among it left
  const revealed = phraseAt(ctx, pos, W_REST_OF_REVEALED);
  if (revealed >= 0) out.push({ end: revealed, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest', text: 'the rest of the revealed cards' }) });
  // p2-zone-moves-2 (CR 608.2c, 701.20a): "Put that card into your hand and all other cards revealed this way into your graveyard." (Hermit Druid): the rest of a
  // group a reveal revealed, the card the sentence named first left out (the same anaphor as "the rest")
  const others = phraseAt(ctx, pos, W_ALL_OTHER_REVEALED);
  if (others >= 0) out.push({ end: others, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest', text: 'all other cards revealed this way' }) });
  // edh-d-35 (CR 701.20a, 601.2a, 608.2c; lower/mentions.ts#revealedNotCastOf, head "rest-notcast-revealed"): every card a reveal-until revealed that is still in the library (a card that was cast left it for the stack)
  const revealedNotCast = phraseAt(ctx, pos, W_REVEALED_NOT_CAST);
  if (revealedNotCast >= 0) out.push({ end: revealedNotCast, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest-notcast-revealed', text: 'all revealed cards not cast this way' }) });
  // edh-next-96 (CR 701.20a, 608.2c; lower/mentions.ts#revealedAllOf, head "revealed-all"; Mind Funeral, Trepanation Blade): every card a reveal-until revealed, the cards it stopped at included
  // (only after the third-person verb of another player, "That player puts all cards revealed this way ...": the imperative "put all cards revealed this way" of a reveal of yours is read by the older templates)
  for (const ws of ctx.toks[pos - 1]?.norm === 'puts' ? W_ALL_REVEALED : []) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'revealed-all', text: ws.join(' ') }) });
  }
  const notPut = phraseAt(ctx, pos, W_REST_NOT_PUT); // std-rh
  if (notPut >= 0) out.push({ end: notPut, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest-not-put', text: "all cards revealed this way that weren't put onto the battlefield" }) });
  return out;
};

const W_THOSE_CARDS = P('those cards');
const W_THE_MILLED_CARDS = P('the milled cards');

/**
 * FAST5 T43 (INTERFACE CHANGE, hole `Seen`): "them" or "those cards" for the cards of a library a player looked at or revealed ("look at the top four cards of your
 * library ... put one of them into your hand", CR 701.20a, 701.20e): the plural anaphor whose antecedent must be such a group, still in the library
 * (lower/mentions.ts gives the look and the reveal of the top cards the participle "seen"), never the cards a mill, a search or an exile put somewhere else.
 */
export const seen: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  // FAST5 T75: after a mill (and no look) the group is the milled cards, which the `Milled` hole names; two readings of the same words are never offered
  if (ctx.discourse?.milled === true && ctx.discourse.seen !== true) return out;
  // edh-cast-10: after a look at a hand and no look at a library, the group is the `SeenInHand` hole's (two readings of one sentence would be guard G5)
  if (ctx.discourse?.handLook === true && ctx.discourse.seen !== true) return out;
  // edh-zones-27: after an exile of the top cards (and no look), the group is the `ExiledTop` hole's, never a second reading of "them" (guard G5)
  if (ctx.discourse?.exiledTop === true && ctx.discourse.seen !== true && ctx.discourse.milled !== true) return out;
  if (phraseAt(ctx, pos, W_THEM) >= 0) out.push({ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', participle: 'seen', text: 'them' }) });
  const e = phraseAt(ctx, pos, W_THOSE_CARDS);
  if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'seen', text: 'those cards' }) });
  // edh-zones-13 (CR 701.20a; Atraxa, Grand Unifier): "the revealed cards" is the group an earlier reveal of the top cards of a library revealed (the same group)
  const rv = phraseAt(ctx, pos, W_THE_REVEALED_CARDS);
  if (rv >= 0) out.push({ end: rv, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'seen', text: 'the revealed cards' }), weak: 1 });
  return out;
};

/**
 * edh-players-11 (hole `ExiledTop`): "them" or "those cards" for the cards "Exile the top N cards of your library" put into exile (CR 406.1, 608.2c, 400.7j): the
 * plural anaphor with the participle `exiledTop`, which only that step's mention (lower/mentions.ts) answers. NOT `Seen`: the `Seen` templates fix `zone: 'library'`,
 * and these cards are in exile now (a template reads them with `zone: 'any'`).
 */
// edh-zones-27: and only after a sentence of the ability that exiled such cards (holes/core.ts#Discourse.exiledTop), as `Milled` reads only after a mill: nothing else has the participle
export const exiledTop: HoleFn = (ctx, pos) => (ctx.discourse?.exiledTop === true ? participleGroup(ctx, pos, 'exiledTop') : []);

/**
 * edh-cast-10 (INTERFACE CHANGE, hole `SeenInHand`): "those cards" for the cards of a hand an earlier step looked at ("Look at that player's hand. You may cast a spell from among
 * those cards without paying its mana cost.", CR 701.20e, 608.2c, 402.3; Silent-Blade Oni): the plural anaphor whose antecedent must be such a look (lower/mentions.ts gives a look at
 * a hand the participle "seen-in-hand" and no other mention has it), so the cards are in that hand: never a group of library cards (`Seen`) or any other.
 */
export const seenInHand: HoleFn = (ctx, pos) => {
  if (ctx.discourse?.handLook !== true) return [];
  const e = phraseAt(ctx, pos, W_THOSE_CARDS);
  return e >= 0 ? [{ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'seen-in-hand', text: 'those cards' }) }] : [];
};

/** The plural anaphor of a group an earlier step produced, named only by its participle (`milled`, `found`): "them" or "those cards". */
function participleGroup(ctx: HoleCtx, pos: number, participle: string): Alt[] {
  const out: Alt[] = [];
  if (phraseAt(ctx, pos, W_THEM) >= 0) out.push({ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', participle, text: 'them' }) });
  const e = phraseAt(ctx, pos, W_THOSE_CARDS);
  if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle, text: 'those cards' }) });
  return out;
}

/**
 * FAST5 T75 (INTERFACE CHANGE, hole `Milled`): "them", "those cards" or "the milled cards" for the cards a `mill` step of an earlier sentence put into a graveyard ("Mill four cards. You may
 * put a land card from among them into your hand.", CR 701.17a, 608.2c): the plural anaphor whose antecedent must be such a mill (lower/mentions.ts gives the
 * mill the participle "milled" and no other word names it, so no other pronoun gets a new candidate). The cards are in a graveyard now: a template reads them with `zone: 'any'`.
 */
export const milled: HoleFn = (ctx, pos) => {
  if (ctx.discourse?.milled !== true) return [];
  const out = participleGroup(ctx, pos, 'milled');
  // "You may put a permanent card from among the milled cards into your hand": the same group, named by what happened to it
  const e = phraseAt(ctx, pos, W_THE_MILLED_CARDS);
  if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'milled', text: 'the milled cards' }) });
  // std-tla: "... from among the cards milled this way into your hand" (Ravenous Gigamole): the same group again, named by the step that made it
  const w = phraseAt(ctx, pos, W_THE_CARDS_MILLED_THIS_WAY);
  if (w >= 0) out.push({ end: w, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'milled', text: 'the cards milled this way' }) });
  return out;
};
const W_THE_CARDS_MILLED_THIS_WAY = P('the cards milled this way');
const W_MILLED_THIS_WAY = P('milled this way');

/**
 * std-tla (INTERFACE CHANGE, hole `MilledThisWay`): "milled this way" after a card noun phrase, "You may put a land card milled this way into your hand." (CR 701.17a,
 * 608.2c): the cards a `mill` step of an earlier sentence put into a graveyard, the plural anaphor of `milled` (its antecedent must be such a mill: lower/mentions.ts gives
 * the mill the participle "milled" and no other word names it). The template places the noun phrase; this hole reads only the three words.
 */
export const milledThisWay: HoleFn = (ctx, pos) => {
  if (ctx.discourse?.milled !== true) return [];
  const e = phraseAt(ctx, pos, W_MILLED_THIS_WAY);
  return e >= 0 ? [{ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'milled', text: 'milled this way' }) }] : [];
};

/**
 * std-ro (INTERFACE CHANGE, hole `RevealedThisWay`): "revealed this way" after a card noun phrase, "Put all land cards revealed this way into your hand" (CR 701.20a,
 * 608.2c): the top cards of a library a `reveal` step of an earlier sentence revealed, still in that library (lower/mentions.ts gives only such a reveal the
 * participle "revealed this way": a look, a reveal until a card is found or a revealed hand is never its antecedent). The template places the noun phrase.
 */
export const revealedThisWay: HoleFn = (ctx, pos) => {
  if (ctx.discourse?.seen !== true && ctx.discourse?.revealedUntil !== true) return []; // edh-zones-22: or a counted reveal until
  const e = phraseAt(ctx, pos, W_REVEALED_THIS_WAY);
  return e >= 0 ? [{ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: REVEALED_THIS_WAY, text: 'revealed this way' }) }] : [];
};
const W_REVEALED_THIS_WAY = P(REVEALED_THIS_WAY);

/**
 * FAST5 T75 (INTERFACE CHANGE, hole `Found`): "them" or "those cards" for the cards a `search` step of an earlier sentence found and revealed, still in the library
 * ("Search your library for up to two Forest cards and reveal them. Put one of them onto the battlefield tapped ...", CR 701.23a, 701.20a): the plural anaphor whose
 * antecedent must be such a search (the participle "found" of lower/mentions.ts), never another group.
 */
// edh-next-136: only after a sentence of the ability that searched (holes/core.ts#Discourse.searched); with no discourse (a sentence read alone) as before
export const found: HoleFn = (ctx, pos) => (ctx.discourse !== undefined && ctx.discourse.searched !== true ? [] : participleGroup(ctx, pos, 'found'));

/**
 * FAST5 T70 (INTERFACE CHANGE, hole `Impulse`): "it" or "that card" for the one card an earlier instruction exiled from the top of a library ("Exile the top card
 * of your library. Until end of turn, you may play that card", CR 611.2c, 400.7). An anaphor flagged `impulse`: the unique-candidate rule never resolves it, the impulse idiom
 * (lower/anaphora.ts#impulseIdiom) binds it to the instruction that exiled the card, and a sentence where that idiom does not apply stays manual.
 */
export const impulse: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  if (phraseAt(ctx, pos, W_IT) >= 0) out.push({ end: pos + 1, value: anaphorObj({ sort: 'object', number: 'singular', text: 'it', impulse: true }) });
  if (phraseAt(ctx, pos, W_THAT_CARD) >= 0) out.push({ end: pos + 2, value: anaphorObj({ sort: 'object', number: 'singular', head: 'card', text: 'that card', impulse: true }) });
  return out;
};

/** FAST5 T70 (INTERFACE CHANGE, hole `Impulses`): "them" or "those cards" for the cards an earlier instruction exiled from the top of a library; see `impulse`. */
export const impulses: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  if (phraseAt(ctx, pos, W_THEM) >= 0) out.push({ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', text: 'them', impulse: true }) });
  const e = phraseAt(ctx, pos, W_THOSE_CARDS);
  if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', text: 'those cards', impulse: true }) });
  return out;
};

/** edh-top-1 (CR 608.2c, 111.1): "that token" and nothing else of `Obj` (a pronoun or "that creature" could name a target a step of the same resolution moved, CR 400.7). */
export const thatToken: HoleFn = (ctx, pos) =>
  obj(ctx, pos).filter((a) => {
    const v = a.value as { $anaphor?: { head?: string; text?: string } } | null;
    return v?.$anaphor?.head === 'token' && v.$anaphor.text === 'that token';
  });

/**
 * edh-mana-keywords-10 (CR 608.2c, 400.7j, 603.7c; The Deck of Many Things): "that creature" of "When that creature dies, ..." right after an instruction that put one creature
 * card onto the battlefield: the object that instruction put there (the binding is re-based to the new object, CR 400.7j), nothing else of `Obj`.
 */
export const thatCreature: HoleFn = (ctx, pos) =>
  obj(ctx, pos).filter((a) => {
    const v = a.value as { $anaphor?: { head?: string; text?: string } } | null;
    return v?.$anaphor?.head === 'creature' && v.$anaphor.text === 'that creature';
  });
