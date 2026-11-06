/**
 * edh-d-88 (Commander coordinator D, must-finish band 5,001-10,000, group combat): the folds of its readings, called from render/fold.ts#foldAtPlain. A new fold-*.ts never imports a value
 * from fold.ts.
 *
 * `castHandOrGraveyardPayLife` (CR 601.2b, 601.2f, 118.9, 202.3, 608.2g; Anrakyr the Traveller): "you may cast an artifact spell from your hand or graveyard by paying life equal to its mana
 * value rather than paying its mana cost": you choose up to one nonland card of ONE description in your hand or graveyard (a land is never cast, CR 305.9), then cast it during the
 * resolution with the alternative cost of life equal to its mana value. Only that shape: one optional choice by you among your cards of those two zones, then the cast by you of exactly
 * that card with that cost and nothing else; the choice is read by nothing after.
 *
 * `losesIfOwnsExiledWithCounters` (CR 104.3e, 122.1, 406.1, 608.2c; Etrata, the Silencer): "That player loses the game if they own three or more exiled cards with hit counters on them":
 * one `if` whose condition counts the cards in exile owned by the player who loses (with at least one counter of the kind on each; a token is no card, CR 111.1), then that player's
 * loss. The owner of the cards counted is the same player as the one who loses ("they"); any other shape is left to the generic renderers.
 *
 * `spellsFromExileCostLess` (CR 601.2f, 118.7, 611.2a, 608.2h; Commander Liara Portyr): "spells you cast from exile this turn cost {X} less to cast, where X is the number of players being
 * attacked": one lasting effect until end of turn with ONE cost reduction of generic mana by a computed amount (fixed as the effect begins, CR 611.2c), for the spells its controller casts
 * from exile. The amount is X for the rest of the ability (render/steps-util.ts#markX: "Exile the top X cards of your library").
 *
 * `thosePlayersSacrificeReveal` (CR 701.21a, 608.2e, 608.2c, 701.20a; Vaevictis Asmadi, the Dire): "Those players sacrifice those permanents. Each player who sacrificed a permanent this way
 * reveals the top card of their library, then puts it onto the battlefield if it's a permanent card.": the permanents a group of targets names, each sacrificed by its controller at once, then
 * for each controller of a permanent sacrificed this way (as it last existed) the top card of their library revealed and put onto the battlefield under their control if it is a permanent
 * card. Only that exact shape (eff.edhd88.thosePlayersSacrifice.revealTopPutPermanent).
 *
 * `attacksDuringNextCombat` (CR 508.1d, 611.2a, 500.8; Trench Behemoth): "target creature an opponent controls attacks during its controller's next combat phase if able": one lasting attack
 * requirement on ONE object, through the next combat phase of that object's controller (`duringNextCombat` with `whose` its controller).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { isComputed, markX } from './steps-util';

const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;
const unread = (list: EffectStep[], from: number, name: string): boolean => !list.slice(from).some((x) => JSON.stringify(x).includes(`"name":"${name}"`));

function castHandOrGraveyardPayLife(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (Object.keys(b).sort().join() !== 'costChange,op,what,who' || b.who.ref !== 'you' || !isBound(b.what, a.as) || JSON.stringify(b.costChange) !== '{"kind":"set","life":"manaValue"}') return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() !== 'anyOf,isCard,notTypes,owner,zone') return null;
  if (JSON.stringify(f.zone) !== '["hand","graveyard"]' || f.owner !== 'you' || f.isCard !== true || JSON.stringify(f.notTypes) !== '["Land"]' || f.anyOf?.length !== 1) return null;
  const kind = f.anyOf[0]!;
  if (kind.zone !== undefined || kind.stackKind !== undefined || kind.owner !== undefined || kind.controller !== undefined || (kind.notTypes ?? []).includes('Land')) return null;
  if (!unread(list, i + 2, a.as)) return null;
  const spell = K.np({ ...kind, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' });
  const text = `you may cast ${spell} from your hand or graveyard by paying life equal to its mana value rather than paying its mana cost`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

function losesIfOwnsExiledWithCounters(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.guard !== undefined || s.else !== undefined || s.then.length !== 1 || Object.keys(s).sort().join() !== 'cond,op,then') return null;
  const lose = s.then[0]!;
  const c = s.cond;
  if (lose.op !== 'loseGame' || Object.keys(lose).sort().join() !== 'op,who' || c.cond !== 'exists' || typeof c.atLeast !== 'number' || c.atLeast < 2 || c.of.ref !== 'each' || !('filter' in c.of)) return null;
  const f = c.of.filter;
  if (Object.keys(f).sort().join() !== 'counters,isCard,owner,zone' || f.zone !== 'exile' || f.isCard !== true || JSON.stringify(f.owner) !== JSON.stringify(lose.who) || f.counters?.cmp !== undefined || typeof f.counters?.kind !== 'string') return null;
  // edh-d-88 review: one player only ("that player", "target opponent"): "each opponent loses the game if they own ..." counts each opponent's own cards, which one pooled count is not
  if (!['you', 'target', 'event', 'controllerOf', 'ownerOf', 'defending', 'active', 'iterating'].includes(lose.who.ref)) return null;
  const you = lose.who.ref === 'you';
  const who = K.player(lose.who, st, 'subject').text;
  const text = `${who} ${you ? 'lose' : 'loses'} the game if ${you ? 'you' : 'they'} own ${c.atLeast} or more exiled cards with ${f.counters.kind} counters on them`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

function spellsFromExileCostLess(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'effect' || s.guard !== undefined || s.as !== undefined || JSON.stringify(s.duration) !== '{"d":"endOfTurn"}' || s.effects.length !== 1) return null;
  const e = s.effects[0]!;
  if (e.s !== 'costMod' || JSON.stringify(e.applies) !== '{"spells":{"castFrom":"exile"},"caster":"you"}') return null;
  const c = e.change;
  if (Object.keys(c).sort().join() !== 'floor,generic,kind' || c.kind !== 'reduce' || c.floor !== 'zero' || c.generic === undefined || !isComputed(c.generic)) return null;
  const amount = K.qty(c.generic, st);
  markX(c.generic, st);
  const text = `spells you cast from exile this turn cost {X} less to cast, where X is ${amount}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

const REVEAL_PUT = '[{"op":"reveal","who":{"ref":"iterating"},"what":{"ref":"topCards","player":{"ref":"iterating"},"count":1},"as":"rev"},{"op":"if","cond":{"cond":"matches","object":{"ref":"bound","name":"rev"},"filter":{"types":["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"],"isCard":true}},"then":[{"op":"move","what":{"ref":"bound","name":"rev"},"to":{"zone":"battlefield","controller":{"ref":"iterating"}}}]}]';

function thosePlayersSacrificeReveal(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'sacrifice' || b?.op !== 'forEach' || a.byControllers !== true || a.guard !== undefined || b.guard !== undefined || a.as === undefined || b.gather !== undefined || b.inDirection !== undefined) return null;
  if (JSON.stringify(b.over) !== JSON.stringify({ ref: 'controllerOf', object: { ref: 'bound', name: a.as } }) || JSON.stringify(b.do) !== REVEAL_PUT || !unread(list, i + 2, a.as)) return null;
  if (a.what.ref !== 'target') return null;
  const what = K.obj(a.what, st, 'object').text;
  const text = `those players sacrifice ${what}. each player who sacrificed a permanent this way reveals the top card of their library, then puts it onto the battlefield if it's a permanent card`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

function attacksDuringNextCombat(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'effect' || s.guard !== undefined || s.as !== undefined || s.effects.length !== 1 || s.duration?.d !== 'duringNextCombat') return null;
  const e = s.effects[0]!;
  if (e.s !== 'restrict' || e.mode !== 'mustIfAble' || e.action !== 'attack' || Object.keys(e).sort().join() !== 'action,mode,s,subject') return null;
  const subject = e.subject as ObjRef;
  if (subject.ref !== 'target' || JSON.stringify(s.duration.whose) !== JSON.stringify({ ref: 'controllerOf', object: subject })) return null;
  const text = `${K.obj(subject, st, 'subject').text} attacks during its controller's next combat phase if able`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/** The folds of edh-d-88 (render/fold.ts#foldAtPlain). */
export function foldEdhD88(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return castHandOrGraveyardPayLife(list, i, st) ?? losesIfOwnsExiledWithCounters(list, i, st) ?? spellsFromExileCostLess(list, i, st) ?? thosePlayersSacrificeReveal(list, i, st) ?? attacksDuringNextCombat(list, i, st);
}
