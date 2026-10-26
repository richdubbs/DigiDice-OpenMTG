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
import { P, anaphorObj, anaphorQty, cmpAt, dedupe, linkedObj, mergeFilter, numberAt, phraseAt, spanOf, targetRef } from './core';
import type { NpAlt } from './filter';
import { EXILED_THIS_WAY, REVEALED_THIS_WAY, headNounAt, npAlts, postModAt } from './filter';
import { targetDets } from './target';
import type { TargetDet } from './target';
import { voteObjsAt } from './vote';

const W_IT = P('it');
const W_THEIR_HAND = P('their hand');
// FAST5 T41: a character card's own pronoun ("Whenever ~ attacks alone, he gets +2/+0", "Put a +1/+1 counter on Crossbones. He deals 2 damage to each opponent"): Oracle uses "he" and "she" for the character the card is, so it is the object itself; the render gate accepts them only for the object itself on a legendary creature (render/refs.ts)
const W_HE = [P('he'), P('she')];
// FAST5 T61: "him" and "her", the object forms of the same pronouns: the object itself ("Put a +1/+1 counter on her"; render/refs.ts#selfAgain accepts them for a legendary creature only)
const W_HER = [P('her'), P('him')];
const W_THEM = P('them');
const W_THAT = P('that');
const W_THAT_CARD = P('that card');
const W_THOSE = P('those');
const W_THE_OTHER_CREATURES = P('the other creatures'); // std-mkm
const W_CARDS_EXILED_THIS_WAY = P('cards exiled this way'); // r5-moved
const W_SPELL_OR_ABILITY = P('spell or ability');
const W_FROM_SINGLE_GRAVEYARD = P('from a single graveyard');
const W_FROM_YOUR_GRAVEYARD = P('from your graveyard'); // Cloud std-eoe
/** FAST5 T66 (CR 115.1): "with total mana value 6 or less" after a plural target phrase, and the statistic each wording sums. */
const W_WITH_TOTAL = P('with total');
/** FAST5 T66 (CR 205.2a, 115.1): "two target nonland permanents that share a card type". */
const W_SHARE_CARD_TYPE = P('that share a card type');
const W_OF_EACH_CARD_TYPE = P('of each card type'); // std-cardcopy-7
/** CLOUD std-tmt (CR 115.1, 110.2): "two target creatures controlled by different players". */
const W_CONTROLLED_BY_DIFFERENT_PLAYERS = P('controlled by different players');
const W_CONTROLLED_BY_THE_SAME_OPPONENT = P('controlled by the same opponent'); // std-rx30
const W_CHOSEN_AT_RANDOM = P('chosen at random'); // p2-damage-2
const GROUP_STATS: readonly [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('mana value'), 'manaValue'], [P('power'), 'power'], [P('toughness'), 'toughness']];
const W_THE = P('the');
const W_USED_TO_CRAFT_IT = [P('the exiled card used to craft it'), P('the exiled cards used to craft it') /* std-craft-1 */, P('the exiled cards used to craft ~') /* std-craft-1 */]; // std-rh
/** std-rx10 (CR 608.2c): the controller words of "the creature you control" after a sentence that announced targets of both sides, with the `controls` they mean. */
const W_CONTROLS: [string[], 'you' | 'notYou' | 'opponent'][] = [[P('you control'), 'you'], [P("you don't control"), 'notYou'], [P('an opponent controls'), 'opponent']];
const W_EACH = P('each');
const W_ALL = P('all');
const W_EVERY = P('every');
const W_OTHER = P('other');
const W_ANY_TARGET = P('any target');
const W_THAT_ISNT = P("that isn't"); // FAST4 T34
const W_ANY_OTHER_TARGET = P('any other target');
/** MX3 (CR 701.54e): "your Ring-bearer", the permanent that is your Ring-bearer now (one or none). */
const W_YOUR_RING_BEARER = P('your ring-bearer');
const W_TOP = P('the top');
const W_THAT_MANY_FROM_TOP = P('that many cards from the top of'); // std-lci
const W_OF = P('of');
const W_LIBRARY = P('library');
const W_CARD = [P('card'), P('cards')];
const W_AND_OR = [P('and'), P('or')];
const W_OR = P('or');
/** p2-modal-1 (CR 702.62b): a suspended card, a card in exile with suspend and a time counter on it (a card with no time counter is not suspended). */
export const SUSPENDED_CARD: ObjectFilter = { zone: 'exile', isCard: true, keyword: 'suspend', counters: { kind: 'time' } };
const W_OR_SUSPENDED_CARD = P('or suspended card');
const W_FROM_BATTLEFIELD_AND_OR = P('from the battlefield and/or'); // std-rx30
/** FAST4 T19: the heads "that X or Y" may join: permanent card types (CR 110.4). */
const OR_HEADS: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

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
        if (list.some((x) => x.stackKind === 'spell') && list.some((x) => x.stackKind !== 'spell')) out.push({ end: it.end, items: list });
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
    const sn = d.number === 'singular' && !d.eachOf ? phraseAt(ctx, d.end, W_SPELL_OR_NONLAND_PERMANENT) : -1;
    if (sn >= 0) {
      const phrase: TargetPhrase = { kind: 'object', filter: { ...SPELL_OR_NONLAND_PERMANENT }, min: d.min, max: d.max, text: spanOf(ctx, pos, sn), ...(d.another ? { another: true } : {}) };
      out.push({ end: sn, value: targetRef(phrase) });
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
      // CLOUD std-ecl (CR 205.3m, 702.73a, 115.1, 601.2c): "two target creature cards that share a creature type from your graveyard": the set chosen has a creature
      // type in common (exactly two targets, like "that share a card type" below)
      const sharedCreatureType = n.flags.includes('shared-creature-type');
      if (sharedCreatureType && (d.number !== 'plural' || d.eachOf || differentNames || d.min !== 2 || d.max !== 2)) continue;
      const s = spec(n.filter, n.head);
      const phrase: TargetPhrase = {
        kind: s.kind, ...(s.filter ? { filter: s.filter } : {}), min: d.min, max: d.max, text: spanOf(ctx, pos, n.end), ...(d.another ? { another: true } : {}), ...(differentNames ? { differentNames: true } : {}),
        ...(sharedCreatureType ? { sharedCreatureType: true } : {}),
      };
      const flags = (d.eachOf ? [...n.flags, 'each-of'] : n.flags).filter((x) => x !== 'different-names' && x !== 'shared-creature-type' && x !== 'linked-exiled-target'); // std-rx5
      out.push({ end: n.end, value: targetRef(phrase), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // FAST5 T66 (CR 115.1, 601.2c): "up to two target creatures with total mana value 6 or less": the targets chosen together stay within a total (plural phrases of
      // several targets only; the limit is a rule of the set, checked as the targets are announced)
      const wt = n.number === 'plural' && !d.eachOf && !differentNames ? phraseAt(ctx, n.end, W_WITH_TOTAL) : -1;
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
      const sh = n.number === 'plural' && !d.eachOf && !differentNames && d.min === 2 && d.max === 2 ? phraseAt(ctx, n.end, W_SHARE_CARD_TYPE) : -1;
      if (sh >= 0) out.push({ end: sh, value: targetRef({ ...phrase, text: spanOf(ctx, pos, sh), sharedCardType: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // CLOUD std-tmt (CR 115.1, 601.2c, 110.2): "two other target creatures controlled by different players": no two targets of the set have one controller (plural
      // phrases of several targets of permanents whose controller is not named otherwise)
      const dc = n.number === 'plural' && !d.eachOf && !differentNames && s.kind === 'object' && n.head !== 'card' && n.filter.controller === undefined && n.filter.owner === undefined
        && n.filter.zone === undefined ? phraseAt(ctx, n.end, W_CONTROLLED_BY_DIFFERENT_PLAYERS) : -1;
      if (dc >= 0) out.push({ end: dc, value: targetRef({ ...phrase, text: spanOf(ctx, pos, dc), differentControllers: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
      // std-rx30 (CR 115.1, 601.2c, 110.2): "two target creatures controlled by the same opponent": every target of the set has one controller, an opponent (the same
      // plural phrases of several targets as above)
      const so = dc < 0 && n.number === 'plural' && !d.eachOf && !differentNames && s.kind === 'object' && n.head !== 'card' && n.filter.controller === undefined && n.filter.owner === undefined
        && n.filter.zone === undefined ? phraseAt(ctx, n.end, W_CONTROLLED_BY_THE_SAME_OPPONENT) : -1;
      if (so >= 0) out.push({ end: so, value: targetRef({ ...phrase, filter: { ...(phrase.filter ?? {}), controller: 'opponent' }, text: spanOf(ctx, pos, so), sameController: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
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
      const ar = n.number === 'singular' && d.number === 'singular' && !d.eachOf && !differentNames && d.min === 1 && d.max === 1 && s.kind === 'object' && n.head !== 'card' ? phraseAt(ctx, n.end, W_CHOSEN_AT_RANDOM) : -1;
      if (ar >= 0) out.push({ end: ar, value: targetRef({ ...phrase, text: spanOf(ctx, pos, ar), random: true }), ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
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
  }
  return out;
}
const W_EXILED = 'exiled';

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
  const that = phraseAt(ctx, pos, W_THAT);
  if (that >= 0) for (const h of headNounAt(ctx, that)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  // trek-12 (CR 608.2c, 400.7; Q, Stacking the Deck): "That nonland card gains ..." after "exile cards from the top of your library until you exile a nonland card":
  // "that card" with its card description said again (one card type, or "non-" one card type), as std-exile-play-1-1's "the exiled nonland card" below. The renderer
  // names the one card an exile-until stopped at "that nonland card" only for that step's own description (render/steps-cards.ts#exileUntil), so no other antecedent fits
  if (that >= 0) {
    for (const n of npAlts(ctx, that)) {
      const keys = Object.keys(n.filter).filter((k) => (n.filter as Record<string, unknown>)[k] !== undefined && k !== 'isCard');
      const oneType = keys.length === 1 && ((keys[0] === 'notTypes' && n.filter.notTypes!.length === 1) || (keys[0] === 'types' && n.filter.types!.length === 1));
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
        if (h2.plural || h2.head === h.head || (!mountOrVehicle && (!OR_HEADS.has(h.head) || !OR_HEADS.has(h2.head)))) continue;
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
  // std-costs-2 (CR 608.2c, 115.1): "Return each chosen creature to your hand" after a sentence that only announced targets ("Choose any number of target creatures you
  // own."): every one of them, as "the chosen creatures" names them (the plural anaphor with the participle; lower/mentions.ts gives it to announced targets only)
  const eachChosen = phraseAt(ctx, pos, W_EACH_CHOSEN);
  if (eachChosen >= 0) for (const h of headNounAt(ctx, eachChosen)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'chosen', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  // std-cardcopy-7 (CR 608.2c, 400.7): "Copy those exiled cards." (Baron Helmut Zemo): the cards an earlier exile of the ability (here its cost) exiled, several
  // objects, as "the exiled cards" below
  const those = phraseAt(ctx, pos, W_THOSE);
  if (those >= 0 && ctx.toks[those]?.norm === 'exiled') for (const h of headNounAt(ctx, those + 1)) if (h.plural && h.head === 'card') out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'exiled', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
  const the = phraseAt(ctx, pos, W_THE);
  if (the >= 0) {
    const part = ctx.toks[the]?.norm;
    if (part !== undefined && PARTICIPLES.includes(part)) {
      for (const h of headNounAt(ctx, the + 1)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, participle: part, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
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
    const weak = ctx.discourse?.chose === true ? { weak: 1 } : {};
    if (part === 'chosen') for (const h of headNounAt(ctx, the + 1)) if (!h.plural) out.push({ end: h.end, value: linkedObj(), ...weak });
    // C6 (CR 608.2c): "Destroy the chosen permanents." after "for each opponent, choose an artifact or land that player controls": what that choice chose (a
    // `chooseObjects` step answers to the participle, lower/mentions.ts); unresolved, manual
    if (part === 'chosen') for (const h of headNounAt(ctx, the + 1)) if (h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'chosen', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // r4-moved (CR 608.2c, 400.7): "Exile X target artifacts and/or creatures. Return the exiled cards to the battlefield ...": what an earlier instruction of the
    // ability exiled, several objects (the participle names the mention the move marked, lower/mentions.ts; the unique-candidate rule decides, design 6.4)
    if (part === 'exiled') for (const h of headNounAt(ctx, the + 1)) if (h.plural && h.head === 'card') out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'plural', head: h.head, participle: 'exiled', text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // "the creature": Oracle's second mention of an object named just before ("Sacrifice the creature at the beginning of the next end step", CR 608.2c;
    // WP23). An anaphor like "that creature": the unique-candidate rule decides (design 6.4).
    for (const h of headNounAt(ctx, the)) if (!h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
    // std-rx10 (CR 115.1, 608.2c): "Choose target creature you control and target creature you don't control. Put a +1/+1 counter on the creature you control.": after a
    // sentence that only announced targets, the target that phrase described, picked out by its controller (lower/anaphora.ts#compatible, `controls`); nowhere else
    if (ctx.discourse?.chose === true) {
      for (const h of headNounAt(ctx, the)) {
        if (h.plural) continue;
        for (const [w, controls] of W_CONTROLS) {
          const e = phraseAt(ctx, h.end, w);
          if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'object', number: 'singular', head: h.head, controls, text: spanOf(ctx, pos, e).toLowerCase() }) });
        }
      }
    }
  }
  const rb = phraseAt(ctx, pos, W_YOUR_RING_BEARER);
  if (rb >= 0) out.push({ end: rb, value: { ref: 'each', filter: { ringBearer: 'you' } } });
  const att = ctx.toks[pos]?.norm;
  if (att !== undefined && ATTACHED.includes(att)) for (const h of headNounAt(ctx, pos + 1)) if (!h.plural) out.push({ end: h.end, value: { ref: 'attachedTo' } });
  return out;
}

/** "the top card of your library", "the top three cards of your library": ordered, top first. */
function topCards(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const top = phraseAt(ctx, pos, W_TOP);
  if (top < 0) return out;
  const tail = (p: number, count: Quantity, plural: boolean): void => {
    for (const w of W_CARD) {
      const isPlural = w[w.length - 1] === 'cards';
      if (isPlural !== plural) continue;
      const e = phraseAt(ctx, p, w);
      const of = e >= 0 ? phraseAt(ctx, e, W_OF) : -1;
      if (of < 0) continue;
      // "your library" is written with the possessive "your"; every other owner is a player followed by 's
      if (ctx.toks[of]?.norm === 'your' && phraseAt(ctx, of + 1, W_LIBRARY) >= 0) out.push({ end: of + 2, value: { ref: 'topCards', player: { ref: 'you' }, count } });
      for (const pl of ctx.call('Player', of)) {
        const r = pl.value as PlayerRef;
        if (r.ref !== 'you' && (ctx.toks[pl.end]?.norm === "'s") && phraseAt(ctx, pl.end + 1, W_LIBRARY) >= 0) out.push({ end: pl.end + 2, value: { ref: 'topCards', player: r, count } });
      }
    }
  };
  tail(top, 1, false);
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
  if (phraseAt(ctx, pos, W_THEM) >= 0) out.push({ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', text: 'them' }) });
  const those = phraseAt(ctx, pos, W_THOSE);
  if (those >= 0) for (const h of headNounAt(ctx, those)) if (h.plural) out.push({ end: h.end, value: anaphorObj({ sort: 'set', number: 'plural', head: h.head, text: spanOf(ctx, pos, h.end).toLowerCase() }) });
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
    if (depth > 3) return;
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
export const oppTarget: HoleFn = (ctx, pos) => perPlayerTarget(ctx, pos, 'opponent');
/** r5-fxb: the `PlayerTarget` hole, the same in a sentence that starts "for each player," (`TargetSpec.perPlayer`; the filter names no controller, CR 115.1, 601.2c). */
export const playerTarget: HoleFn = (ctx, pos) => perPlayerTarget(ctx, pos, 'player');
function perPlayerTarget(ctx: Parameters<HoleFn>[0], pos: number, each: 'opponent' | 'player'): Alt[] {
  const out: Alt[] = [];
  for (const d of targetDets(ctx, pos)) {
    // std-rx30 (CR 109.2, 115.1): "for each player, choose up to one other target artifact or creature that player controls" (Kitesail Larcenist): "other" is other than
    // this object, as in any target phrase (only "for each player,": r5-cost's "that opponent controls" keeps its own reading)
    if (d.number !== 'singular' || d.eachOf || (d.another && each !== 'player') || d.max !== 1) continue;
    for (const n of npAlts(ctx, d.end)) {
      if (n.number !== 'singular' || n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined) continue;
      // (r5-cost: "that opponent controls" only in a sentence for each opponent; merge wave 8 with r5-fxb's "for each player,")
      const e0 = Math.max(phraseAt(ctx, n.end, W_THAT_PLAYER_CONTROLS), each === 'opponent' ? phraseAt(ctx, n.end, W_THAT_OPPONENT_CONTROLS) : -1);
      if (e0 < 0) continue;
      // trek-8 (CR 115.1, 601.2c, 202.3): and a feature said after "that player controls" ("up to one target creature that player controls with mana value 3 or less"):
      // a "with" description, never another controller, owner or zone
      const tails: { end: number; frag: ObjectFilter; weak?: number }[] = [{ end: e0, frag: {} }];
      for (const pm of postModAt(ctx, e0)) {
        const keys = Object.keys(pm.frag);
        if (keys.length > 0 && keys.every((k) => k === 'manaValue' || k === 'power' || k === 'toughness') && (pm.flags ?? []).length === 0) tails.push({ end: pm.end, frag: pm.frag, ...(pm.weak ? { weak: pm.weak } : {}) });
      }
      for (const tail of tails) {
        const filter = mergeFilter(each === 'opponent' ? { ...n.filter, controller: 'opponent' } : n.filter, tail.frag);
        if (filter === null) continue;
        const s = spec(filter, n.head);
        if (s.kind !== 'object') continue;
        const e = tail.end;
        const phrase: TargetPhrase = { kind: 'object', ...(s.filter ? { filter: s.filter } : {}), min: d.min, max: d.max, text: spanOf(ctx, pos, e), ...(each === 'opponent' ? { perOpponent: true } : { perPlayer: true }), ...(d.another ? { another: true } : {}) };
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
 * T46: the `ChosenCard` hole: "that card" naming the card a player chose (a `chooseObjects` step answers to the participle `chosen`, lower/mentions.ts), nothing else:
 * "That player discards that card" discards the chosen card of their hand (CR 701.9a), and never a card some other phrase named.
 */
export const chosenCard: HoleFn = (ctx, pos) => (phraseAt(ctx, pos, W_THAT_CARD) >= 0
  ? [{ end: pos + 2, value: anaphorObj({ sort: 'object', number: 'singular', head: 'card', participle: 'chosen', text: 'that card' }) }]
  // Standard round 4, r4-refs (CR 701.9a, 608.2c): "If you do, they discard it.": the bare pronoun for the card chosen, which names nothing else here (the participle
  // keeps every other mention out)
  : phraseAt(ctx, pos, W_IT) >= 0 ? [{ end: pos + 1, value: anaphorObj({ sort: 'object', number: 'singular', participle: 'chosen', text: 'it' }) }] : []);
/** FAST5 T49: the `They` hole: the word "they" naming a group an earlier sentence named, a plural anaphor like "them" (resolved by the anaphora pass, design 6.4). */
export const they: HoleFn = (ctx, pos) => (phraseAt(ctx, pos, P('they')) >= 0 ? [{ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', text: 'they' }) }] : []);

const W_CARDS = P('cards');

/** r3-dig: the `TypedThose` hole, "those land cards" (see parser/types.ts#HoleType): one singular card type word between "those" and "cards". */
export const typedThose: HoleFn = (ctx, pos) => {
  const at = phraseAt(ctx, pos, W_THOSE);
  const t = at >= 0 ? ctx.toks[at] : undefined;
  const ty = t !== undefined && t.kind === 'WORD' ? ctx.vocab.types.get(t.norm) : undefined;
  if (ty === undefined || ty.plural || phraseAt(ctx, at + 1, W_CARDS) < 0) return [];
  return [{ end: at + 2, value: anaphorObj({ sort: 'set', number: 'plural', head: ty.name.toLowerCase(), text: spanOf(ctx, pos, at + 2).toLowerCase() }) }];
};

/** FAST5 T76: the `Them` hole: "them" or "those <plural noun>" naming a group an earlier sentence named, and nothing else (the pronoun readings of `Objs`). */
export const them: HoleFn = (ctx, pos) => [...pluralPronouns(ctx, pos), ...theExiledCards(ctx, pos)];

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
  ...ctx.call('Obj', pos), ...targetObjects(ctx, pos, false), ...quantified(ctx, pos), ...barePlurals(ctx, pos), ...pluralPronouns(ctx, pos), ...topCards(ctx, pos), ...thatManyFromTop(ctx, pos), ...allButBottom(ctx, pos), ...unions(ctx, pos), ...sameNameCards(ctx, pos),
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

function mixedTargets(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [...anyTargetsPlural(ctx, pos)];
  const anyT = phraseAt(ctx, pos, W_ANY_TARGET);
  if (anyT >= 0) out.push({ end: anyT, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, text: spanOf(ctx, pos, anyT) }) });
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
  const anyO = phraseAt(ctx, pos, W_ANY_OTHER_TARGET);
  if (anyO >= 0) out.push({ end: anyO, value: targetRef({ kind: 'anyTarget', min: 1, max: 1, text: spanOf(ctx, pos, anyO), another: true }) });
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
    // "target creature or player"
    for (const n of npAlts(ctx, d.end)) {
      if (n.number !== 'singular' || n.head === 'spell' || n.head === 'ability') continue;
      const or = phraseAt(ctx, n.end, P('or'));
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

export const recipient: HoleFn = (ctx, pos) => dedupe([...mixedTargets(ctx, pos), ...ctx.call('Player', pos), ...ctx.call('Objs', pos).map((a) => recipientThem(a, pos)), ...attacked(ctx, pos)]);

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

const W_THE_REST = [P('the rest'), P('the other')];
const W_REST_OF_EXILED = P('the rest of the exiled cards'); // std-library-3
const W_REST_OF_REVEALED = P('the rest of the revealed cards'); // pc-zones-1
// std-rh (CR 608.2c, 701.20e; Genesis Wave): "all cards revealed this way that weren't put onto the battlefield" is the cards of the revealed group that a choice among it did not
// put there: the head "rest-not-put" is only given to "the rest" of a choice whose chosen cards are all put onto the battlefield (lower/mentions.ts#restOf), never to the rest
// after an optional put of one card ("You may put that card onto the battlefield", where a card not put is among them; fail closed)
const W_REST_NOT_PUT = P("all cards revealed this way that weren't put onto the battlefield");

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
  // pc-zones-1 (CR 608.2c, 701.20a): "the rest of the revealed cards" is "the rest" again (Kruphix's Insight): the cards of the revealed group a choice among it left
  const revealed = phraseAt(ctx, pos, W_REST_OF_REVEALED);
  if (revealed >= 0) out.push({ end: revealed, value: anaphorObj({ sort: 'set', number: 'plural', head: 'rest', text: 'the rest of the revealed cards' }) });
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
  if (phraseAt(ctx, pos, W_THEM) >= 0) out.push({ end: pos + 1, value: anaphorObj({ sort: 'set', number: 'plural', participle: 'seen', text: 'them' }) });
  const e = phraseAt(ctx, pos, W_THOSE_CARDS);
  if (e >= 0) out.push({ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'seen', text: 'those cards' }) });
  return out;
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
  if (ctx.discourse?.seen !== true) return [];
  const e = phraseAt(ctx, pos, W_REVEALED_THIS_WAY);
  return e >= 0 ? [{ end: e, value: anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: REVEALED_THIS_WAY, text: 'revealed this way' }) }] : [];
};
const W_REVEALED_THIS_WAY = P(REVEALED_THIS_WAY);

/**
 * FAST5 T75 (INTERFACE CHANGE, hole `Found`): "them" or "those cards" for the cards a `search` step of an earlier sentence found and revealed, still in the library
 * ("Search your library for up to two Forest cards and reveal them. Put one of them onto the battlefield tapped ...", CR 701.23a, 701.20a): the plural anaphor whose
 * antecedent must be such a search (the participle "found" of lower/mentions.ts), never another group.
 */
export const found: HoleFn = (ctx, pos) => participleGroup(ctx, pos, 'found');

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
