/**
 * Commander round edh-d-94: the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD94` before the other two-step folds). A fold applies only when every part
 * is exactly what the idiom says.
 *
 * `exileAllEachPlayerTokenByPower` (CR 406.1, 608.2c, 608.2h, 109.4, 111.2, 122.1; Oversimplify, eff.edhd94.exileAllCreatures.eachPlayerToken.countersTotalPowerTheyControlled): "Exile all
 * creatures. Each player creates a 0/0 ... token and puts a number of +1/+1 counters on it equal to the total power of creatures they controlled that were exiled this way.": the exile of
 * every creature (bound), then for each player the token and the counters, as many as the total power of the exiled creatures that player controlled as they last existed.
 *
 * `tapAllPayEnergyStunTapped` (CR 701.26a, 107.14, 118.12, 608.2c, 122.1d; Suppression Ray, eff.edhd94.tapAll.mayPayAnyEnergy.chooseUpToTappedThisWay.stunEach): "Tap all creatures target
 * player controls. You may pay any amount of {E}. If you do, choose up to that many creatures tapped this way. Put a stun counter on each of them.": the tap that names only what it
 * tapped (`changedOnly`), the payment, and in its `then` the choice of up to the amount paid among those creatures and a counter on each chosen one.
 *
 * `revealUntilWhenRevealed` (CR 701.20a, 401.4, 603.12, 202.3; Yuna's Whistle, eff.edhd94.revealUntil.putHandRestBottom.whenRevealedThisWay.countersMv): "Reveal cards from the top of your
 * library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order. When you reveal a creature card this way, put X
 * +1/+1 counters on target creature you control, where X is the mana value of that card.": the reveal, the found card's mana value fixed as it is revealed (`let`), the two moves, and the reflexive trigger that waits for the move of the found card.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { tokenText } from './steps-zones';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const keys = (o: object, allowed: readonly string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));

function exileAllEachPlayerTokenByPower(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'move' || b?.op !== 'forEach') return null;
  if (!keys(a, ['op', 'what', 'to', 'as']) || typeof a.as !== 'string' || !same(a.what, { ref: 'each', filter: { types: ['Creature'] } }) || !same(a.to, { zone: 'exile' })) return null;
  if (!keys(b, ['op', 'over', 'as', 'do']) || !same(b.over, { ref: 'each', who: 'player' }) || b.do.length !== 2) return null;
  const [c, p] = b.do;
  const each = { ref: 'bound', name: b.as };
  if (c?.op !== 'createToken' || p?.op !== 'putCounters') return null;
  if (!keys(c, ['op', 'who', 'count', 'token', 'as']) || typeof c.as !== 'string' || !same(c.who, each) || c.count !== 1) return null;
  if (!keys(p, ['op', 'on', 'kind', 'count']) || !same(p.on, { ref: 'bound', name: c.as }) || typeof p.kind !== 'string') return null;
  if (!same(p.count, { q: 'stat', stat: 'power', of: { ref: 'bound', name: a.as }, sum: true, by: each })) return null;
  if (c.token.power === undefined || typeof c.token.power !== 'number' || typeof c.token.toughness !== 'number') return null;
  const token = tokenText(c.token, 1, false, st);
  return {
    clauses: [plain(`exile all creatures. each player creates ${token} and puts a number of ${p.kind} counters on it equal to the total power of creatures they controlled that were exiled this way`, { standalone: true })],
    consumed: 2,
  };
}

function tapAllPayEnergyStunTapped(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'tap' || b?.op !== 'pay') return null;
  if (!keys(a, ['op', 'what', 'as', 'changedOnly']) || a.changedOnly !== true || typeof a.as !== 'string' || a.what.ref !== 'each' || !('filter' in a.what)) return null;
  const f = a.what.filter;
  if (!keys(f, ['types', 'controller']) || !same(f.types, ['Creature']) || typeof f.controller !== 'object' || f.controller === null || (f.controller as { ref?: string }).ref !== 'target') return null;
  if (!keys(b, ['op', 'who', 'cost', 'anyAmount', 'as', 'then']) || b.anyAmount !== true || typeof b.as !== 'string' || !same(b.who, { ref: 'you' }) || !same(b.cost, { other: [{ kind: 'payEnergy', amount: 1 }] })) return null;
  const [c, p] = b.then ?? [];
  if ((b.then ?? []).length !== 2 || c?.op !== 'chooseObjects' || p?.op !== 'putCounters') return null;
  if (!keys(c, ['op', 'who', 'from', 'min', 'max', 'as']) || !same(c.who, { ref: 'you' }) || !same(c.from, { ref: 'bound', name: a.as }) || c.min !== 0 || !same(c.max, { q: 'resultCount', step: b.as })) return null;
  if (!keys(p, ['op', 'on', 'kind', 'count']) || !same(p.on, { ref: 'bound', name: c.as }) || p.count !== 1 || typeof p.kind !== 'string') return null;
  const whose = K.player(f.controller as never, st, 'subject').text;
  return {
    clauses: [plain(`tap all creatures ${whose} controls. you may pay any amount of {e}. if you do, choose up to that many creatures tapped this way. put a ${p.kind} counter on each of them`, { standalone: true })],
    consumed: 2,
  };
}

function revealUntilWhenRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, v, b, c, r] = [list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]];
  if (a?.op !== 'revealUntil' || v?.op !== 'let' || b?.op !== 'move' || c?.op !== 'move' || r?.op !== 'reflexive') return null;
  if (!keys(a, ['op', 'who', 'filter', 'as', 'revealed']) || !same(a.who, { ref: 'you' }) || !same(a.filter, { types: ['Creature'] }) || typeof a.as !== 'string' || typeof a.revealed !== 'string') return null;
  const hit = { ref: 'bound', name: a.as };
  if (!keys(v, ['op', 'name', 'value']) || !same(v.value, { q: 'stat', stat: 'manaValue', of: hit })) return null;
  if (!keys(b, ['op', 'what', 'to', 'as']) || !same(b.what, hit) || !same(b.to, { zone: 'hand' }) || typeof b.as !== 'string') return null;
  if (!keys(c, ['op', 'what', 'to']) || !same(c.what, { ref: 'each', filter: { is: { ref: 'bound', name: a.revealed }, not: { is: hit }, zone: 'library' } }) || !same(c.to, { zone: 'library', position: 'bottom', order: 'random' })) return null;
  if (!keys(r, ['op', 'when', 'targets', 'do']) || r.modes !== undefined || !same(r.when, { did: b.as }) || r.targets.length !== 1 || r.do.length !== 1) return null;
  const p = r.do[0]!;
  const spec = r.targets[0]!;
  if (p.op !== 'putCounters' || !keys(p, ['op', 'on', 'kind', 'count']) || !same(p.on, { ref: 'target', id: spec.id }) || typeof p.kind !== 'string' || !same(p.count, { q: 'var', name: v.name })) return null;
  if (spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1) return null;
  const target = K.specPhrase(spec, st);
  return {
    clauses: [plain(`reveal cards from the top of your library until you reveal a creature card. put that card into your hand and the rest on the bottom of your library in a random order. when you reveal a creature card this way, put x ${p.kind} counters on ${target}, where x is the mana value of that card`, { standalone: true })],
    consumed: 5,
  };
}

/**
 * `chooseCounterKindPutOnOthers` (CR 122.1, 122.6, 608.2c; Contractual Safeguard, eff.edhd94.chooseCounterKindOnYours.putOnEachOther): "Choose a kind of counter on a creature you control.
 * Put a counter of that kind on each other creature you control.": the choice of the creature and of a kind of counter on it, then one counter of that kind on each other creature you control.
 */
function chooseCounterKindPutOnOthers(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseValue' || c?.op !== 'putCounters') return null;
  const mine = { types: ['Creature'], controller: 'you' };
  if (!keys(a, ['op', 'who', 'from', 'min', 'max', 'as']) || !same(a.who, { ref: 'you' }) || a.min !== 1 || a.max !== 1 || !same(a.from, { ref: 'each', filter: { ...mine, counters: { kind: 'any' } } })) return null;
  const holder = { ref: 'bound', name: a.as };
  if (!keys(b, ['op', 'who', 'what', 'counterOn', 'as', 'link']) || b.what !== 'counterKind' || !same(b.who, { ref: 'you' }) || !same(b.counterOn, holder) || typeof b.link !== 'string') return null;
  if (!keys(c, ['op', 'on', 'kind', 'count', 'kindOfChoice']) || c.kind !== '' || c.count !== 1 || c.kindOfChoice !== b.link || !same(c.on, { ref: 'each', filter: { ...mine, not: { is: holder } } })) return null;
  return { clauses: [plain('choose a kind of counter on a creature you control. put a counter of that kind on each other creature you control', { standalone: true })], consumed: 3 };
}

/** The folds of edh-d-94 (render/fold.ts#foldAt). */
export function foldEdhD94(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileAllEachPlayerTokenByPower(list, i, st) ?? tapAllPayEnergyStunTapped(list, i, st) ?? revealUntilWhenRevealed(list, i, st) ?? chooseCounterKindPutOnOthers(list, i, st);
}
