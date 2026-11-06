/**
 * edh-c-24 (coordinator C, EDHREC ranks 20,001-20,500): the folds of its templates (parser/templates/zz-cloud/edh-c-24.json), called from render/fold.ts#foldAt.
 *
 * `groupsOpposed` (CR 611.2c, 613.4c; eff.edhv24.pump.groupsOpposed; Zealous Persecution): "Until end of turn, creatures you control get +1/+1 and creatures your
 * opponents control get -1/-1.": ONE resolved effect with two continuous power and toughness changes on two groups and one duration. Only that shape.
 */
import type { EffectStep, ObjectFilter, PlayerRef } from '../types/ability';
import { plain } from './clause';
import { K } from './kernel';
import { dur } from './dur';
import type { Folded } from './fold';
import { continuous } from './mods';
import type { RenderState } from './state';
import { alt } from './text';

function groupsOpposed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.as !== undefined || a.effects.length !== 2 || a.duration.d !== 'endOfTurn' || Object.keys(a).sort().join(',') !== 'duration,effects,op') return null;
  const [x, y] = a.effects as [typeof a.effects[0], typeof a.effects[0]];
  for (const e of [x, y]) {
    if (e.s !== 'continuous' || e.affects.ref !== 'each' || e.mods.length !== 1 || e.mods[0]!.layer !== '7c' || e.cda === true) return null;
  }
  if (x.s !== 'continuous' || y.s !== 'continuous') return null;
  const first = continuous(x, st, undefined, false);
  const second = continuous(y, st, undefined, false);
  const d = dur(a.duration, st);
  return { clauses: [plain(alt(`${first} and ${second} ${d}`, `${d}, ${first} and ${second}`), { standalone: true })], consumed: 1 };
}

/**
 * `shuffleCardsFromGraveyard` (CR 701.24a, 400.3, 404.1; eff.edhv24.shuffle.cardsFromGraveyardInto.playerLibrary; Repopulate): "Shuffle all creature cards from target
 * player's graveyard into that player's library.": the cards of one description in that player's graveyard move to their library (the owner is the player), then
 * that player shuffles. Only that pair.
 */
function shuffleCardsFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const sh = list[i + 1];
  if (m?.op !== 'move' || sh?.op !== 'shuffle' || m.guard !== undefined || m.as !== undefined || sh.guard !== undefined || sh.as !== undefined || sh.ifSearched !== undefined) return null;
  if (m.until !== undefined || m.link !== undefined || m.remember !== undefined || Object.keys(m).sort().join(',') !== 'op,to,what') return null;
  const w = m.what;
  if (w.ref !== 'each' || !('filter' in w)) return null;
  const f = w.filter as ObjectFilter;
  if (Object.keys(f).sort().join(',') !== 'anyOf,isCard,owner,zone' || f.zone !== 'graveyard' || f.isCard !== true || f.anyOf?.length !== 1 || f.owner === undefined || typeof f.owner !== 'object') return null;
  const owner = f.owner as PlayerRef;
  if (owner.ref !== 'target') return null;
  const to = m.to;
  if (to.zone !== 'library' || Object.keys(to).sort().join(',') !== 'owner,zone' || JSON.stringify(to.owner) !== JSON.stringify(owner) || JSON.stringify(sh.who) !== JSON.stringify(owner)) return null;
  const cards = K.np({ ...f.anyOf[0]!, zone: 'graveyard' }, st, { det: 'none', plural: true, noZone: true });
  const who = K.player(owner, st, 'possessive').text;
  return { clauses: [plain(`shuffle all ${cards} from ${who} graveyard into that player's library`, { standalone: true })], consumed: 2 };
}

/**
 * `attacksYouThisTurn` (CR 508.1d, 611.2a; eff.edhv24.obj.attacksYou.thisTurn; Alluring Siren): "Target creature an opponent controls attacks you this turn if able.": a
 * requirement of one object to attack its controller's controller (the player the effect is for) for the rest of the turn (`mustIfAble` attack with `otherPlayer` you,
 * the end of the turn). Only that shape.
 */
function attacksYouThisTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || a.guard !== undefined || a.as !== undefined || a.effects.length !== 1 || a.duration.d !== 'endOfTurn' || Object.keys(a).sort().join(',') !== 'duration,effects,op') return null;
  const r = a.effects[0]!;
  if (r.s !== 'restrict' || r.mode !== 'mustIfAble' || r.action !== 'attack' || r.otherPlayer === undefined || (r.otherPlayer.ref !== 'you' && r.otherPlayer.ref !== 'target') || r.other !== undefined || r.max !== undefined || r.min !== undefined || r.when !== undefined) return null;
  if (Object.keys(r).filter((k) => !['s', 'subject', 'mode', 'action', 'otherPlayer'].includes(k) && (r as unknown as Record<string, unknown>)[k] !== undefined).length > 0) return null;
  const sub = K.obj(r.subject as never, st, 'subject');
  // edh-c-90 (CR 508.1d, 115.1; eff.edhv90.obj.attacksPlayer.thisTurn; Dulcet Sirens): the player is a target the effect names, "Target creature attacks target opponent this turn if able."
  const whom = r.otherPlayer.ref === 'you' ? 'you' : K.player(r.otherPlayer, st, 'object').text;
  return { clauses: [plain(`${sub.text} ${sub.plural ? 'attack' : 'attacks'} ${whom} ${dur(a.duration, st)} if able`, { standalone: true })], consumed: 1 };
}

export function foldEdhV24(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return groupsOpposed(list, i, st) ?? shuffleCardsFromGraveyard(list, i, st) ?? attacksYouThisTurn(list, i, st);
}
