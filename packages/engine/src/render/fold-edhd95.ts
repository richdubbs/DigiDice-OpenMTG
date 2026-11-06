/**
 * edh-d-95 (EDHREC band 5,001-10,000, group counters): the folds of its templates (parser/templates/zz-cloud/edh-d-95.json), called from render/fold.ts#foldAt. A new fold-*.ts never
 * imports a value from fold.ts.
 *
 * `eachPlayerMayPlayOwnExiled` (CR 608.2c, 601.3, 305.1, 611.2a, 400.3; Rocco, Street Chef): "Until your next end step, each player may play the card they exiled this way." One lasting
 * effect of one part: each player's permission to play the one card an earlier exile of the ability ("each player exiles the top card of their library") put into exile that they own
 * (`ownOnly`, statics/play-permits.ts#namedObjects). Only that exact effect, of the cards an exile of this ability moved (template eff.edhd95.eachPlayer.mayPlayOwnExiledCard).
 *
 * `groupConnives` (CR 701.50a, 701.50c; Change of Plans): "Each of X target creatures you control connive." One connive for each object of a group, one at a time (CR 701.50c), by its
 * controller (template eff.edhd95.group.connive): a `forEach` whose one step is that object's connive. Only a group of targets (one target spec of several objects).
 *
 * `mayHaveAnyNumberPhaseOut` (CR 702.26b, 608.2d; Change of Plans): "You may have any number of them phase out." The controller's choice of any number (zero too: the "may") of the objects
 * a pronoun names, then those phase out (template eff.edhd95.mayHave.anyNumberOfThem.phaseOut): exactly that choice and that phasing.
 *
 * `nextSpellFollowers` (CR 611.2, 101.2, 614.1c, 122.6; Savage Summoning): "The next creature spell you cast this turn can be cast as though it had flash. That spell can't be countered. That
 * creature enters with an additional +1/+1 counter on it.": more riders on the same next spell (the same player, the same description), each said in a sentence of its own after the first
 * (templates rid.edhd95.nextSpell.*): "that spell can't be countered", and for a creature spell "that creature enters with an additional <kind> counter on it". Only those two followers.
 */
import type { EffectStep } from '../types/ability';
import { alt } from './text';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const EACH_PLAYER = { ref: 'each', who: 'player' };

function eachPlayerMayPlayOwnExiled(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.duration === undefined) return null;
  const [p] = e.effects;
  if (p?.s !== 'permit' || p.action !== 'play' || !same(p.who, EACH_PLAYER) || p.ownOnly !== true) return null;
  const { s: _s, who: _w, action: _a, of, ownOnly: _own, ...rest } = p;
  const is = of?.is as { ref?: string; name?: string } | undefined;
  if (Object.keys(rest).length > 0 || of === undefined || Object.keys(of).length !== 1 || is?.ref !== 'bound' || typeof is.name !== 'string' || Object.keys(is).length !== 2) return null;
  if (st.info.get(`b:${is.name}`)?.thisWay !== 'exiled this way') return null;
  return { clauses: [plain(`${K.dur(e.duration, st)}, each player may play the card they exiled this way`)], consumed: 1 };
}

function groupConnives(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'forEach' || e.guard !== undefined || e.do.length !== 1 || e.over.ref !== 'target' || Object.keys(e).some((k) => !['op', 'over', 'as', 'do', 'src', 'span'].includes(k))) return null;
  const spec = st.specs.get(String((e.over as { id?: string }).id));
  if (spec === undefined || (spec.max === 1 && spec.min === 1)) return null;
  const [c] = e.do;
  const me = { ref: 'bound', name: e.as };
  if (c?.op !== 'action' || c.action !== 'connive' || c.guard !== undefined || c.as !== undefined || c.n !== undefined || !same(c.subject, me) || !same(c.who, { ref: 'controllerOf', object: me })) return null;
  if (Object.keys(c).some((k) => !['op', 'action', 'who', 'subject', 'src', 'span'].includes(k))) return null;
  const who = K.obj(e.over, st, 'subject');
  if (!who.plural) return null;
  // (Oracle says the group of targets as "each of X target creatures you control": the target phrase with "each of", as the spec's own words)
  return { clauses: [plain(alt(`${who.text} connive`, `each of ${who.text} connive`))], consumed: 1 };
}

function mayHaveAnyNumberPhaseOut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'phaseOut' || a.guard !== undefined || b.guard !== undefined || a.min !== 0 || a.max !== 'any' || !same(a.who, { ref: 'you' })) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'from', 'min', 'max', 'as', 'src', 'span'].includes(k)) || Object.keys(b).some((k) => !['op', 'what', 'src', 'span'].includes(k))) return null;
  if (!same(b.what, { ref: 'bound', name: a.as })) return null;
  const from = K.obj(a.from, st, 'object');
  if (!from.plural) return null;
  return { clauses: [plain(`you may have any number of ${from.text} phase out`, { closesScope: true })], consumed: 2 };
}

function nextSpellFollowers(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'nextSpell' || a.guard !== undefined || a.as !== undefined || a.rider === 'enters') return null;
  const followers: string[] = [];
  for (let k = i + 1; k < list.length; k++) {
    const b = list[k];
    if (b?.op !== 'nextSpell' || b.guard !== undefined || b.as !== undefined || !same(b.who, a.who) || !same(b.filter, a.filter) || b.lasting !== undefined) break;
    if (b.rider === 'cantBeCountered' && Object.keys(b).every((x) => ['op', 'who', 'filter', 'rider', 'src', 'span'].includes(x))) followers.push("that spell can't be countered");
    else if (b.rider === 'enters' && b.counters?.length === 1 && b.counters[0]!.count === 1 && JSON.stringify(a.filter?.types) === '["Creature"]'
      && Object.keys(b).every((x) => ['op', 'who', 'filter', 'rider', 'counters', 'src', 'span'].includes(x))) followers.push(`that creature enters with an additional ${b.counters[0]!.kind} counter on it`);
    else break;
  }
  if (followers.length === 0) return null;
  return { clauses: [K.clause(a, st), ...followers.map((f) => plain(f, { standalone: true }))], consumed: 1 + followers.length };
}

export function foldEdhD95(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerMayPlayOwnExiled(list, i, st) ?? groupConnives(list, i, st) ?? mayHaveAnyNumberPhaseOut(list, i, st) ?? nextSpellFollowers(list, i, st);
}
