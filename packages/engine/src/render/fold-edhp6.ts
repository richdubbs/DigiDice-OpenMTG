/**
 * edh-players-6 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-6.json), called from render/fold.ts#foldAt. CR cites from
 * memory, unverified.
 *
 * `eachOpponentMillsEqualHand` (CR 701.17a, 608.2f; Folio of Fancies): a forEach over each opponent whose one instruction is that opponent milling as many cards as the
 * cards in their own hand: "Each opponent mills cards equal to the number of cards in their hand." Only that exact shape.
 *
 * `eachOpponentLosesForEachInGraveyard` (CR 119.3, 608.2f; One Ring to Rule Them All): a forEach over each opponent whose one instruction is that opponent losing N life for
 * each object of a description in their own graveyard: "Each opponent loses 1 life for each creature card in that player's graveyard." Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const ITERATING = JSON.stringify({ ref: 'iterating' });
const OPPONENTS = JSON.stringify({ ref: 'each', who: 'opponent' });

function eachOpponentMillsEqualHand(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.as === undefined || s.gather !== undefined || JSON.stringify(s.over) !== OPPONENTS || s.do.length !== 1) return null;
  const [only] = s.do;
  if (only?.op !== 'mill' || only.guard !== undefined || only.as !== undefined || JSON.stringify(only.who) !== ITERATING) return null;
  if (JSON.stringify(only.count) !== JSON.stringify({ q: 'zoneSize', zone: 'hand', of: { ref: 'iterating' } })) return null;
  return { clauses: [plain('each opponent mills cards equal to the number of cards in their hand')], consumed: 1 };
}

function eachOpponentLosesForEachInGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.as === undefined || s.gather !== undefined || JSON.stringify(s.over) !== OPPONENTS || s.do.length !== 1) return null;
  const [only] = s.do;
  if (only?.op !== 'loseLife' || only.guard !== undefined || only.as !== undefined || JSON.stringify(only.who) !== ITERATING) return null;
  const a = only.amount;
  if (typeof a !== 'object' || a.q !== 'math' || a.op !== '*' || a.args.length !== 2 || typeof a.args[0] !== 'number') return null;
  const c = a.args[1];
  if (typeof c !== 'object' || c.q !== 'count' || c.of.ref !== 'each' || !('filter' in c.of)) return null;
  const { zone, owner, ...rest } = c.of.filter;
  // the player is the loop's own: `iterating`, or the name the loop gives each opponent (what the pronoun "that player" resolves to)
  if (zone !== 'graveyard' || (JSON.stringify(owner) !== ITERATING && JSON.stringify(owner) !== JSON.stringify({ ref: 'bound', name: s.as }))) return null;
  // one card type, "creature card" (a description with more is not said here)
  if (Object.keys(rest).length !== 2 || rest.isCard !== true || rest.types?.length !== 1) return null;
  const said = `${K.np({ types: rest.types }, st, { det: 'none' })} card`;
  return { clauses: [plain(`each opponent loses ${a.args[0]} life for each ${said} in that player's graveyard`)], consumed: 1 };
}

/**
 * `eachOpponentMayElse` (CR 608.2d, 608.2e, 101.4; Professor Onyx, Fandaniel, Braids): each opponent in turn may do something and, when they don't, loses life (Braids: and you
 * draw a card): "Each opponent may discard a card. If they don't, they lose 3 life." / "Each opponent may sacrifice a nontoken creature of their choice. Each opponent who
 * doesn't loses 2 life for each instant and sorcery card in your graveyard." / "...For each opponent who doesn't, that player loses 2 life and you draw a card." The
 * `may` of the group with an `otherwise` that is one life loss by that player (an amount or a multiple of a count), then perhaps your draw. Only that exact shape.
 */
function eachOpponentMayElse(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'may' || m.guard !== undefined || m.as !== undefined || m.anyOne !== undefined || m.villainous !== undefined || JSON.stringify(m.who) !== OPPONENTS || m.otherwise === undefined || m.do.length !== 1) return null;
  const [lose, draw, ...rest] = m.otherwise;
  if (lose?.op !== 'loseLife' || lose.guard !== undefined || lose.as !== undefined || JSON.stringify(lose.who) !== ITERATING || rest.length > 0) return null;
  if (draw !== undefined && (draw.op !== 'draw' || draw.guard !== undefined || draw.as !== undefined || JSON.stringify(draw.who) !== JSON.stringify({ ref: 'you' }) || draw.count !== 1)) return null;
  const head = K.steps([{ ...m, otherwise: undefined }], st);
  const a = lose.amount;
  // an amount that is a number of life for each object counted ("2 life for each instant and sorcery card in your graveyard")
  let amount = K.qty(a, st);
  let each = '';
  if (typeof a === 'object' && a.q === 'math' && a.op === '*' && a.args.length === 2 && typeof a.args[0] === 'number' && typeof a.args[1] === 'object' && a.args[1].q === 'count') {
    amount = String(a.args[0]);
    each = ` for each ${K.np(a.args[1].of.ref === 'each' && 'filter' in a.args[1].of ? a.args[1].of.filter : {}, st, { det: 'none', forEach: true })}`;
    if (draw !== undefined) return null;
  }
  const tail = draw !== undefined
    ? `for each opponent who doesn't, that player loses ${amount} life and you draw a card`
    : alt(`if they don't, they lose ${amount} life${each}`, `each opponent who doesn't loses ${amount} life${each}`);
  return { clauses: [plain(`${head}. ${tail}`, { standalone: true })], consumed: 1 };
}

/**
 * `sacrificeThenEachOpponentMaySameType` (CR 608.2d, 608.2e, 205.2a, 608.2h; Braids, Arisen Nightmare): "You may sacrifice an artifact, creature, enchantment, land, or
 * planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that player loses N life and
 * you draw a card." Exactly the two steps of template eff.edhp6.sacrifice.eachOpponentMaySameType.
 */
function sacrificeThenEachOpponentMaySameType(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'may' || b?.op !== 'if' || a.guard !== undefined || b.guard !== undefined || b.else !== undefined || a.as === undefined || b.then.length !== 1) return null;
  if (JSON.stringify(a.who) !== JSON.stringify({ ref: 'you' }) || a.otherwise !== undefined || a.do.length !== 1 || JSON.stringify(b.cond) !== JSON.stringify({ cond: 'did', step: a.as })) return null;
  const [sac] = a.do;
  if (sac?.op !== 'sacrificeChoice' || typeof sac.as !== 'string' || sac.count !== 1 || JSON.stringify(sac.who) !== JSON.stringify({ ref: 'you' })
    || JSON.stringify(sac.filter) !== JSON.stringify({ types: ['Artifact', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] })) return null;
  const [m] = b.then;
  if (m?.op !== 'may' || m.guard !== undefined || m.as !== undefined || JSON.stringify(m.who) !== OPPONENTS || m.otherwise === undefined || m.do.length !== 1) return null;
  const [theirs] = m.do;
  if (theirs?.op !== 'sacrificeChoice' || theirs.count !== 1 || JSON.stringify(theirs.who) !== ITERATING || theirs.as !== undefined
    || JSON.stringify(theirs.filter) !== JSON.stringify({ sharesWith: { with: { ref: 'bound', name: sac.as }, quality: 'cardType' } })) return null;
  const [lose, draw, ...rest] = m.otherwise;
  if (lose?.op !== 'loseLife' || draw?.op !== 'draw' || rest.length > 0 || JSON.stringify(lose.who) !== ITERATING || JSON.stringify(draw.who) !== JSON.stringify({ ref: 'you' }) || draw.count !== 1
    || lose.guard !== undefined || draw.guard !== undefined || lose.as !== undefined || draw.as !== undefined) return null;
  const text = `you may sacrifice an artifact, creature, enchantment, land, or planeswalker. if you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. for each opponent who doesn't, that player loses ${K.qty(lose.amount, st)} life and you draw a card`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

export function foldEdhP6(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachOpponentMillsEqualHand(list, i, st) ?? eachOpponentLosesForEachInGraveyard(list, i, st) ?? sacrificeThenEachOpponentMaySameType(list, i, st) ?? eachOpponentMayElse(list, i, st);
}
