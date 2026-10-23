/**
 * std-library-2 (lane std-library): the folds of its templates (parser/templates/zz-cloud/std-library-2.json), called from render/fold.ts#foldAt. As every fold,
 * one applies only when every part is exactly what the idiom says (same players, bound names, nothing else in between).
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

/**
 * "If you sacrificed a permanent this way, you may return another permanent card from your graveyard to your hand." (Deadly Brew; CR 608.2c, 608.2d, 109.2,
 * 701.21a, 400.7): a choice of one card, then its move to your hand, where the card is any one of the description but those an earlier sacrifice of the ability put
 * there (parser/lower/targets.ts#otherNotSource writes `not: {is: <the sacrifice's binding>}` for "another"). Only when the name is bound by a sacrifice
 * (render/steps-zones.ts#sacrificeChoice records it as `r:<name>`, kind `sacrificed`) and the move is exactly that card to its owner's hand. audit-fix-1: only the
 * card YOU sacrificed is excluded (a sacrifice by you, or each player's with `which: {controller: 'you'}`).
 */
function returnAnotherThanSacrificed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.random !== undefined || a.groupLimit !== undefined
    || a.perPlayer !== undefined || a.startingWith !== undefined || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  const not = f.not;
  if (f.other !== undefined || not === undefined || Object.keys(not).length !== 1 || not.is?.ref !== 'bound') return null;
  const info = st.info.get(`r:${not.is.name}`);
  if (info?.moved !== 'sacrificed') return null;
  // audit-fix-1 (CR 701.21a, 608.2h; unverified): "another" is other than what YOU sacrificed: the binding is a sacrifice by you alone, or each player's with only
  // the ones you controlled as they were sacrificed (`which`); any other sacrificer, or every player's sacrificed cards, is not this sentence
  const which = JSON.stringify(not.is.which ?? null);
  const yours = (info.sacrificedBy === '{"ref":"you"}' && which === 'null') || (info.sacrificedBy === '{"ref":"each","who":"player"}' && which === '{"controller":"you"}');
  if (!yours) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || JSON.stringify(b.what) !== JSON.stringify({ ref: 'bound', name: a.as })) return null;
  if (JSON.stringify(b.to) !== '{"zone":"hand"}') return null;
  const text = `return ${K.np({ ...f, not: undefined, other: true }, st, { det: 'a' })} to your hand`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

/**
 * "Each player may put any number of creature cards from their hand onto the battlefield." (Worlds Within Worlds; CR 101.4, 608.2d, 608.2e, 110.2a): each player in
 * APNAP order chooses any number of the described cards in their own hand, then every card chosen is put onto the battlefield at the same time, each under its
 * owner's control (the player who put it). Exactly the two steps of template eff.stdlibrary2.eachPlayer.may.putAny.fromHand.bf.
 */
function eachPlayerMayPutAnyFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.min !== 0 || a.max !== 'any') return null;
  if (!same(a.who, ITERATING) || !same(a.perPlayer, { ref: 'each', who: 'player' }) || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (f.anyOf?.length !== 1 || f.zone !== 'hand' || !same(f.owner, ITERATING) || Object.keys(f).some((k) => !['anyOf', 'zone', 'owner'].includes(k))) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  if (!same(b.to, { zone: 'battlefield', controller: 'owner' })) return null;
  const kind = f.anyOf[0]!;
  bind(st, a.as, { nouns: [...K.nounsOf(kind), 'card'], plural: true });
  const cards = K.np({ ...kind, isCard: true, zone: 'hand' }, st, { det: 'none', plural: true, noZone: true });
  return { clauses: [plain(`each player may put any number of ${cards} from their hand onto the battlefield`, { standalone: true })], consumed: 2 };
}


const PREVENTED = { q: 'preventedAmount' };

/**
 * "The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented this way, ~ deals that much damage to that
 * source's controller and you draw that many cards." (New Way Forward; CR 609.7a, 615.1, 615.5, 615.8, 603.12, 608.2h): the source chosen as the spell resolves, then
 * a one-use shield that prevents all the damage it would deal to you; the prevention is named (`as`), and its additional instruction is a reflexive triggered
 * ability on it that deals the damage prevented to the source's controller and draws you that many cards. Exactly the steps of template
 * eff.stdlibrary2.prevent.nextSourceOfChoice.you.whenPrevented.damageDraw.
 */
function sourceOfChoiceWhenPrevented(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined || c.perPlayer !== undefined) return null;
  if (c.damageSource !== true || c.startingWith !== undefined) return null; // audit-fix-1 (CR 609.7a): the source choice's own reading
  if (!same(c.from, { ref: 'each', filter: { zone: ['battlefield', 'stack', 'command'] } })) return null; // render/fold.ts#SOURCE_CHOICE_ZONES (audit-fix-1: the command zone)
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || !same(r.shield, { uses: 1 })) return null;
  if (!same(r.replaces, { ev: 'damage', source: { is: { ref: 'bound', name: c.as } }, recipient: { player: 'you' } })) return null;
  const body = r.body;
  if (body.b !== 'prevent' || body.amount !== 'all' || body.as === undefined || body.then?.length !== 1 || Object.keys(body).length !== 4) return null;
  const rf = body.then[0]!;
  if (rf.op !== 'reflexive' || rf.guard !== undefined || rf.as !== undefined || rf.modes !== undefined || rf.targets.length !== 0 || !same(rf.when, { did: body.as }) || rf.do.length !== 2) return null;
  const [dmg, draw] = rf.do;
  if (!same(dmg, { op: 'damage', source: { ref: 'self' }, to: { ref: 'controllerOf', object: { ref: 'bound', name: c.as } }, amount: PREVENTED })) return null;
  if (!same(draw, { op: 'draw', who: { ref: 'you' }, count: PREVENTED })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null;
  const dur = K.dur(e.duration, st);
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  const text = `the next time a source of your choice would deal damage to you${dur ? ` ${dur}` : ''}, prevent that damage. when damage is prevented this way, ${self} deals that much damage to that source's controller and you draw that many cards`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/** The folds of std-library-2 (render/fold.ts#foldAt). */
export function foldStdLibrary2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return returnAnotherThanSacrificed(list, i, st) ?? eachPlayerMayPutAnyFromHand(list, i, st) ?? sourceOfChoiceWhenPrevented(list, i, st);
}
