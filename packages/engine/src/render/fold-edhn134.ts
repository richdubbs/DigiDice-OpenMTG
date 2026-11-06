/**
 * edh-next-134 (MUST-FINISH round, group control): the folds of its templates (parser/templates/zz-cloud/edh-next-134.json), called from render/fold.ts#foldAt.
 *
 * `goadedWhileHere` (CR 701.15a-b, 611.2b; family goaded-while-here-leads; Hot Pursuit; eff.edhn134.whileHere.alsoGoaded): one object goaded by you for as long as the source remains on
 * the battlefield, "As long as this enchantment remains on the battlefield, that creature is also goaded." (after another instruction gave the creature a designation, "also"), as
 * well as the plain "that creature is goaded for as long as ~ remains on the battlefield" (render/stat.ts#lasting, the wording it had before).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import { alt } from './text';
import type { RenderState } from './state';
import { cloneState } from './state';
import { bind } from './steps-util';
import { lasting } from './stat';
import { isEventSubjectChooserSpec, specPhrase } from './refs';

function goadedWhileHere(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'effect' || s.guard !== undefined || s.duration?.d !== 'whileSource' || s.duration.as !== 'onBattlefield' || s.effects.length !== 1) return null;
  const e = s.effects[0] as unknown as Record<string, unknown>;
  if (e['s'] !== 'restrict' || e['goad'] !== true || e['mode'] !== 'mustIfAble' || e['action'] !== 'attack' || Object.keys(e).length !== 5) return null;
  const subject = e['subject'] as ObjRef;
  // one target object only ("that creature"): a group is said with a plural verb by the older wording (render/stat.ts), never here
  if (subject.ref !== 'target' || st.specs.get(subject.id)?.max !== 1) return null;
  const plainForm = lasting(`${K.obj(subject, cloneState(st), 'subject').text} is goaded`, s.duration, cloneState(st));
  const o = K.obj(subject, st, 'subject').text;
  return { clauses: [plain(alt(plainForm, `as long as ~ remains on the battlefield, ${o} is also goaded`), { standalone: true })], consumed: 1 };
}

/**
 * `chooseThenExchange` (CR 701.12a-b, 603.3d; Confusion in the Ranks; eff.edhn134.itsControllerChoosesTarget.sharesCardType.exchangeControl): the exchange of control of the triggering
 * event's object and the one target its controller chose, "its controller chooses target permanent another player controls that shares a card type with it. Exchange control of those
 * permanents." Only that exact shape (refs.ts#isEventSubjectChooserSpec).
 */
function chooseThenExchange(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'exchange' || s.what !== 'control' || s.guard !== undefined || s.as !== undefined) return null;
  if (JSON.stringify(s.a) !== '{"ref":"event","role":"subject"}' || s.b.ref !== 'target') return null;
  const spec = st.specs.get(s.b.id);
  if (spec === undefined || !isEventSubjectChooserSpec(spec)) return null;
  return { clauses: [plain(`its controller chooses ${specPhrase(spec, st)}. exchange control of those permanents`, { standalone: true })], consumed: 1 };
}

/**
 * `villainousSacrificeOrSteal` (CR 701.55a, 701.21a, 613.1b, 508.4; Midnight Crusader Shuttle; eff.edhn134.villainous.sacrificeOrStealAttacking): "<player> faces a villainous choice --
 * That player sacrifices a creature of their choice, or you gain control of a creature of your choice that player controls until end of turn. If you gain control of a creature this way,
 * tap it, and it's attacking that player." Only that exact shape (the steps the template builds).
 */
function villainousSacrificeOrSteal(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'may' || s.villainous !== true || s.guard !== undefined || s.as !== undefined || s.anyOne !== undefined || s.gather !== undefined || s.otherwise === undefined) return null;
  const who = JSON.stringify(s.who);
  const expectDo = `[{"op":"sacrificeChoice","who":${who},"filter":{"types":["Creature"]},"count":1}]`;
  const [c, e, t] = s.otherwise as [EffectStep?, EffectStep?, EffectStep?];
  if (JSON.stringify(s.do) !== expectDo || s.otherwise.length !== 3 || c?.op !== 'chooseObjects' || e?.op !== 'effect' || t?.op !== 'tap' || typeof c.as !== 'string') return null;
  const name = c.as;
  if (JSON.stringify(c) !== `{"op":"chooseObjects","who":{"ref":"you"},"from":{"ref":"each","filter":{"types":["Creature"],"controller":${who}}},"min":1,"max":1,"as":"${name}"}`) return null;
  if (JSON.stringify(e) !== `{"op":"effect","duration":{"d":"endOfTurn"},"effects":[{"s":"continuous","affects":{"ref":"bound","name":"${name}"},"mods":[{"layer":2,"controller":{"ref":"you"}}]}]}`) return null;
  if (JSON.stringify(t) !== `{"op":"tap","what":{"ref":"bound","name":"${name}"},"attacking":{"defender":${who}}}`) return null;
  const p = K.player(s.who, st, 'subject');
  if (p.person !== 'sg') return null;
  const text = `${p.text} faces a villainous choice -- that player sacrifices a creature of their choice, or you gain control of a creature of your choice that player controls until end of turn. if you gain control of a creature this way, tap it, and it's attacking that player`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * `forEachVoteVoterChooses` (CR 701.38a, 701.38d, 608.2d, 608.2f; Elrond of the White Council; eff.edhn134.forEachVote.voterChoosesTheyControl): "For each fellowship vote, the voter
 * chooses a creature they control.": one iteration per vote cast for the word, in which its voter chooses one object of a description they control; every object chosen, over all the
 * iterations, is "each creature chosen this way" later (the loop's `gather`). Only that shape.
 */
function forEachVoteVoterChooses(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.over.ref !== 'votedFor' || f.guard !== undefined || f.as !== 'voter' || f.gather === undefined || f.do.length !== 1) return null;
  const a = f.do[0]!;
  if (a.op !== 'chooseObjects' || a.as !== f.gather || JSON.stringify(a.who) !== '{"ref":"bound","name":"voter"}' || a.min !== 1 || a.max !== 1 || a.random === true || a.guard !== undefined
    || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.link !== undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter.anyOf?.length !== 1 || Object.keys(a.from.filter).sort().join() !== 'anyOf,controller'
    || JSON.stringify(a.from.filter.controller) !== '{"ref":"bound","name":"voter"}') return null;
  const kind = a.from.filter.anyOf[0]!;
  const nouns = K.nounsOf(kind);
  bind(st, f.gather, { nouns, plural: true, thisWay: 'chosen this way', alts: nouns.map((n) => `each ${n} chosen this way`) });
  return { clauses: [plain(`for each ${f.over.votes.choice} vote, the voter chooses ${K.np(kind, st, { det: 'a' })} they control`, { standalone: true })], consumed: 1 };
}

/** The folds of edh-next-134 (render/fold.ts#foldAt). */
export function foldEdhN134(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return goadedWhileHere(list, i, st) ?? chooseThenExchange(list, i, st) ?? villainousSacrificeOrSteal(list, i, st) ?? forEachVoteVoterChooses(list, i, st);
}
