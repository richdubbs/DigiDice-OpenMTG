/**
 * edh-d-89 (Commander coordinator D, band 5,001-10,000, group combat): the fold of its template eff.edhd89.attackersUntapAllTheyControl (parser/templates/zz-cloud/edh-d-89.json), called from
 * render/fold.ts#foldAt.
 *
 * `attackersUntapAllTheyControl` (CR 701.26a, 508.1a, 303.4; Curse of Bounty): "Whenever enchanted player is attacked, ... Each opponent attacking that player untaps all nonland permanents they
 * control.": the untap of every permanent of a description that one of the opponents attacking enchanted player controls (`eachWho`, ATTACKING_ENCHANTED_PLAYER, read as the effect resolves).
 * Only in a trigger of an attack on enchanted player, where "that player" is that player.
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { ATTACKING_ENCHANTED_PLAYER } from './fold-pccombat1';
import { K } from './kernel';
import type { RenderState } from './state';

function attackersUntapAllTheyControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const u = list[i];
  if (u?.op !== 'untap' || u.guard !== undefined || u.what.ref !== 'each' || !('filter' in u.what)) return null;
  if (Object.keys(u).some((k) => !['op', 'what'].includes(k))) return null;
  const f = u.what.filter;
  if (Object.keys(f).length !== 2 || f.anyOf?.length !== 1 || JSON.stringify(f.controller) !== JSON.stringify(ATTACKING_ENCHANTED_PLAYER)) return null;
  // "that player" is the enchanted player only in a trigger of an attack on it ("whenever enchanted player is attacked")
  const trig = st.trigger ?? [];
  if (trig.length !== 1 || trig[0]!.ev !== 'attacks' || JSON.stringify((trig[0] as { defender?: unknown }).defender) !== '{"ref":"enchantedPlayer"}') return null;
  const what = K.np(f.anyOf[0]!, st, { det: 'none', plural: true });
  return { clauses: [plain(`each opponent attacking that player untaps all ${what} they control`, { standalone: true })], consumed: 1 };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `milledMayPutEitherOntoBattlefield` (CR 701.17a, 701.17c, 608.2c-d, 400.7j; Eivor, Wolf-Kissed; template eff.edhd89.milled.put.eitherOr.bf): "you mill that many cards. You may put a Saga card
 * and/or a land card from among them onto the battlefield.": you mill, then choose up to one milled card of the first description and up to one OTHER milled card of the second (found in the
 * graveyard they moved to), and put what was chosen onto the battlefield under your control. Only that exact shape, with nothing after it reading any of the three names.
 */
function milledMayPutEitherOntoBattlefield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [m, a, b, c] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (m?.op !== 'mill' || a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || c?.op !== 'move' || m.as === undefined || a.as === undefined || b.as === undefined) return null;
  if (m.guard !== undefined || !same(m.who, { ref: 'you' })) return null;
  const one = (x: typeof a): boolean => same(x.who, { ref: 'you' }) && x.min === 0 && x.max === 1 && x.random !== true && x.guard === undefined && x.distinct === undefined && x.groupLimit === undefined && x.perPlayer === undefined && x.startingWith === undefined;
  if (!one(a) || !one(b)) return null;
  if (c.guard !== undefined || c.as !== undefined || c.until !== undefined || c.link !== undefined || c.remember !== undefined || !same(c.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (!same(c.what, { ref: 'union', of: [{ ref: 'bound', name: a.as }, { ref: 'bound', name: b.as }] })) return null;
  const fa = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  const fb = b.from.ref === 'each' && 'filter' in b.from ? b.from.filter : null;
  const milled = { ref: 'bound', name: m.as };
  if (fa === null || Object.keys(fa).length !== 3 || fa.zone !== 'any' || !same(fa.is, milled) || fa.anyOf?.length !== 1) return null;
  if (fb === null || Object.keys(fb).length !== 4 || fb.zone !== 'any' || !same(fb.is, milled) || fb.anyOf?.length !== 1 || !same(fb.not, { is: { ref: 'bound', name: a.as } })) return null;
  if (list.slice(i + 4).some((x) => [m.as, a.as, b.as].some((n) => JSON.stringify(x).includes(`"name":"${n}"`)))) return null;
  const np = (f: ObjectFilter): string => K.np({ ...f, zone: 'graveyard' }, st, { det: 'a', noZone: true });
  const mill = K.steps([m], st);
  return { clauses: [plain(`${mill}. you may put ${np(fa.anyOf[0]!)} and/or ${np(fb.anyOf[0]!)} from among them onto the battlefield`, { standalone: true })], consumed: 4 };
}

export function foldEdhD89(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return attackersUntapAllTheyControl(list, i, st) ?? milledMayPutEitherOntoBattlefield(list, i, st);
}
