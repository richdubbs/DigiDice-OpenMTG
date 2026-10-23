/**
 * std-exile-play-1-3: the folds of its templates (parser/templates/zz-cloud/std-exile-play-1-3.json), called from render/fold.ts#foldAt.
 *
 * `eachOpponentExilesFromHandMayPlay`: "each opponent exiles a card from their hand and may play that card for as long as it remains exiled. Each spell cast this
 * way costs {1} more to cast. Each land played this way enters tapped." (CR 608.2d, 101.4, 406.1, 601.3, 601.2f, 614.1c): one opponent at a time chooses a card
 * in their own hand (`chooseObjects` by that opponent), exiles it, and gets a permission to play that card (`who` that opponent, `of` the chosen card), with
 * the riders on the permission (statics/play-permits.ts#namedPermitIncrease, #namedPermitLandTapped). Only that exact body, read by nothing after it.
 */
import type { EffectStep } from '../types/ability';
import { formatManaCost } from '../types/mana';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachOpponentExilesFromHandMayPlay(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || !same(f.over, { ref: 'each', who: 'opponent' }) || f.do.length !== 3) return null;
  const [c, m, e] = f.do as [EffectStep, EffectStep, EffectStep];
  const me = { ref: 'bound', name: f.as };
  if (c.op !== 'chooseObjects' || c.guard !== undefined || !same(c.who, me) || c.min !== 1 || c.max !== 1 || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined) return null;
  if (!same(c.from, { ref: 'each', filter: { zone: 'hand', owner: me } })) return null;
  const card = { ref: 'bound', name: c.as };
  if (m.op !== 'move' || m.guard !== undefined || m.until !== undefined || m.as !== undefined || !same(m.what, card) || !same(m.to, { zone: 'exile' })) return null;
  if (e.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1) return null;
  const p = e.effects[0]!;
  if (p.s !== 'permit' || p.action !== 'play' || !same(p.who, me) || !same(p.of, { is: card })) return null;
  const { s: _s, who: _w, action: _a, of: _o, costChange, landsEnterTapped, ...rest } = p;
  if (Object.keys(rest).length > 0 || (landsEnterTapped !== undefined && landsEnterTapped !== true)) return null;
  let increase = '';
  if (costChange !== undefined) {
    const cc = costChange as unknown as Record<string, unknown>;
    if (costChange.kind !== 'increase' || costChange.mana === undefined || costChange.mana.length === 0 || Object.keys(cc).some((k) => cc[k] !== undefined && k !== 'kind' && k !== 'mana')) return null;
    increase = `. each spell cast this way costs ${formatManaCost(costChange.mana)} more to cast`;
  }
  if (JSON.stringify(list.slice(i + 1)).includes(`"name":"${c.as}"`) || JSON.stringify(list.slice(i + 1)).includes(`"name":"${f.as}"`)) return null;
  const tapped = landsEnterTapped === true ? '. each land played this way enters tapped' : '';
  return { clauses: [plain(`each opponent exiles a card from their hand and may play ${alt('that card', 'it')} ${K.dur(e.duration, st)}${increase}${tapped}`)], consumed: 1 };
}

const EACH_PLAYER = { ref: 'each', who: 'player' };

/**
 * "Until your next turn, players may play cards they exiled this way, and they can't play cards from their hand." (Memory Vessel; CR 601.3, 305.1, 400.3, 611.2a,
 * 101.2): one lasting effect of three parts: each player's permission to play the cards an earlier exile of the ability put into exile that they own (`ownOnly`,
 * statics/play-permits.ts#namedObjects), and for each player the restrictions on casting spells from their hand (`castFrom` hand) and on playing lands from their
 * hand (a land in the hand). Only that exact effect, of the cards an exile of this ability moved.
 */
function playersMayPlayOwnExiledCantPlayFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 3) return null;
  const [p, rc, rl] = e.effects;
  if (p?.s !== 'permit' || p.action !== 'play' || !same(p.who, EACH_PLAYER) || p.ownOnly !== true) return null;
  const { s: _s, who: _w, action: _a, of, ownOnly: _own, ...rest } = p;
  const is = of?.is as { ref?: string; name?: string } | undefined;
  if (Object.keys(rest).length > 0 || of === undefined || Object.keys(of).length !== 1 || is?.ref !== 'bound' || typeof is.name !== 'string' || Object.keys(is).length !== 2) return null;
  if (st.info.get(`b:${is.name}`)?.thisWay !== 'exiled this way') return null;
  if (!same(rc, { s: 'restrict', subject: EACH_PLAYER, mode: 'cant', action: 'cast', other: { castFrom: 'hand' } })) return null;
  if (!same(rl, { s: 'restrict', subject: EACH_PLAYER, mode: 'cant', action: 'playLand', other: { zone: 'hand' } })) return null;
  return { clauses: [plain(`${K.dur(e.duration, st)}, players may play cards they exiled this way, and they can't play cards from their hand`)], consumed: 1 };
}

export function foldStdExile3(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachOpponentExilesFromHandMayPlay(list, i, st) ?? playersMayPlayOwnExiledCantPlayFromHand(list, i, st);
}
