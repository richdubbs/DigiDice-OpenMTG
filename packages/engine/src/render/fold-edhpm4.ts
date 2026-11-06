/**
 * edh-perms-4 (Commander lane edh-perms): the folds of its templates (parser/templates/zz-cloud/edh-perms-4.json), called from render/fold.ts#foldAt. CR cites from the
 * Comprehensive Rules of 2026-09-25 unless marked unverified.
 *
 * `putAndAttachSelf` (CR 303.4a, 303.4f, 701.3a, 607.2a, 400.7; Animate Dead, Dance of the Dead, Necromancy): "Return enchanted creature card to the battlefield under your
 * control and attach ~ to it." / "Put enchanted creature card onto the battlefield tapped under your control and attach ~ to it." / "Put target creature card from a
 * graveyard onto the battlefield under your control and attach ~ to it.": the move of a card to the battlefield under your control that the Aura remembers under its link
 * `putWith`, then the attach of the Aura itself to the object that link remembers. Only that exact pair (no guard, name, duration or other link).
 *
 * `linkedControllerSacrifices` (CR 607.2a, 701.21a, 109.4, 603.10a; Animate Dead): "that creature's controller sacrifices it.": the controller of the permanent the Aura put onto the battlefield (its link
 * `putWith`) sacrifices that permanent, one step with nothing else on it.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const LINK = 'putWith';
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function putAndAttachSelf(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const a = list[i + 1];
  if (m?.op !== 'move' || a?.op !== 'attach' || m.link !== LINK || m.guard !== undefined || m.until !== undefined || m.remember !== undefined || m.as !== undefined) return null;
  if (a.guard !== undefined || a.as !== undefined || !same(a.what, { ref: 'self' }) || !same(a.to, { ref: 'linked', link: LINK })) return null;
  const to = m.to as { zone?: string; tapped?: boolean; controller?: unknown } & Record<string, unknown>;
  if (to.zone !== 'battlefield' || !same(to.controller, { ref: 'you' }) || Object.keys(to).some((k) => k !== 'zone' && k !== 'tapped' && k !== 'controller') || (to.tapped !== undefined && to.tapped !== true)) return null;
  const tapped = to.tapped === true ? ' tapped' : '';
  let what: string;
  let verb: string;
  if (m.what.ref === 'each') {
    // the card the Aura is attached to, in a graveyard: "enchanted creature card" (parser/holes/edhpm4.ts#enchantedCard)
    const f = m.what.filter;
    if (!('types' in f) || f.types?.length !== 1 || f.isCard !== true || f.zone !== 'graveyard' || f.attachedToSource !== true || Object.keys(f).length !== 4) return null;
    what = `enchanted ${f.types[0]!.toLowerCase()} card`;
    verb = tapped === '' ? 'return' : 'put';
    if (verb === 'return') return { clauses: [plain(`return ${what} to the battlefield under your control and attach ~ to it`, { standalone: true })], consumed: 2 };
  } else if (m.what.ref === 'target' && tapped === '') {
    what = K.obj(m.what, st, 'object').text;
    verb = 'put';
  } else return null;
  return { clauses: [plain(`${verb} ${what} onto the battlefield${tapped} under your control and attach ~ to it`, { standalone: true })], consumed: 2 };
}

function linkedControllerSacrifices(list: EffectStep[], i: number): Folded | null {
  const s = list[i];
  if (s?.op !== 'sacrificeChoice' || s.guard !== undefined || s.as !== undefined || s.cantAs !== undefined || s.exploit !== undefined || s.mode !== undefined || s.keepTypes !== undefined || s.keepFilter !== undefined || s.chooser !== undefined) return null;
  const linked = { ref: 'linked', link: LINK };
  if (!same(s.who, { ref: 'controllerOf', object: linked }) || !same(s.filter, { is: linked }) || s.count !== 1) return null;
  return { clauses: [plain(alt("that creature's controller sacrifices it", "that permanent's controller sacrifices it"), { standalone: true })], consumed: 1 };
}

export function foldEdhPm4(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putAndAttachSelf(list, i, st) ?? linkedControllerSacrifices(list, i);
}
