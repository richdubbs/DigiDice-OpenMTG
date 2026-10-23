/**
 * The `redirect` replacement body (CR 614.9; m6 design 3.2). Owner: M6-1 (new file of W1). The prevention body itself, with its additional steps (CR 615.5),
 * is effects/bodies/m5.ts.
 *
 *   redirect  "All damage that would be dealt to you is dealt to enchanted creature instead" (Pariah): the damage is dealt to `to` instead, by the same source
 *             and with the same combat flag (CR 614.9). If the new recipient is not a player still in the game, nor a creature, planeswalker or battle on
 *             the battlefield, the damage is not redirected (CR 614.9: "the effect does nothing"). With `amount` (a shield's budget: "the next N damage that
 *             would be dealt to ~ this turn is dealt to target creature instead") at most what is left of the budget is redirected; the rest is still dealt
 *             to the original recipient, as its own damage event proposed in this proposal's branch (CR 614.5).
 */
import type { Game } from '../core/game';
import type { ReplacementBody } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { ObjHandle } from '../types/state';
import { charsOfObject } from '../rules/characteristics';
import type { Proposed } from './api';
import { evalQty } from './eval';
import { replacementCtx } from './instead';
import { proposeNested } from './nested';
import { setShieldLeft } from './perform-events';
import { resolveRecipients } from './refs';
import type { BodyKinds } from './registries';
import type { Candidate } from './replacements';

type Damage = Extract<Proposed, { ev: 'damage' }>;
type Redirect = Extract<ReplacementBody, { b: 'redirect' }>;

const RECIPIENT_TYPES = ['Creature', 'Planeswalker', 'Battle'];

/** CR 614.9: the one new recipient, or null when there is none that could be dealt the damage. */
function newRecipient(g: Game, e: Damage, b: Redirect, c: Candidate): ObjHandle | PlayerId | null {
  const r = resolveRecipients(replacementCtx(g, e, c), b.to);
  const all: (ObjHandle | PlayerId)[] = [...r.objects, ...r.players];
  if (all.length !== 1) return null; // nothing, or not one recipient: not redirected
  const to = all[0]!;
  if (typeof to === 'string') return g.s.players.some((p) => p.id === to && !p.hasLost) ? to : null;
  const o = g.s.objects[to.id];
  if (!o || o.zone !== 'battlefield' || to.zone !== 'battlefield') return null;
  return charsOfObject(g.s, o).types.some((t) => RECIPIENT_TYPES.includes(t)) ? to : null;
}

const sameRecipient = (a: ObjHandle | PlayerId, b: ObjHandle | PlayerId): boolean => (typeof a === 'string' || typeof b === 'string' ? a === b : a.id === b.id);

/** What is left of a "the next N damage ... is dealt to X instead" shield (CR 615.7 by analogy, CR 614.9), or undefined for a redirect without a budget. */
function budgetLeft(g: Game, b: Redirect, c: Candidate): number | undefined {
  if (b.amount === undefined || c.recId === undefined) return undefined;
  const rec = g.s.continuousEffects.find((r) => r.id === c.recId);
  if (!rec) return 0;
  if (rec.usesLeft !== undefined) return rec.usesLeft;
  if (typeof b.amount === 'number') return b.amount;
  const src = g.s.objects[c.source.id] ?? g.s.lki[c.source.id]?.object;
  return src ? Math.max(0, Math.floor(evalQty(replacementCtx(g, { ev: 'draw', player: c.controller }, c), b.amount) ?? 0)) : 0;
}

export function applyRedirect(g: Game, e: Damage, b: Redirect, c: Candidate): Proposed | null {
  if (b.amount !== undefined && c.recId === undefined) return e; // a budget belongs to a shield (the walker names body:redirect.amount); never redirect all of it
  const to = newRecipient(g, e, b, c);
  const name = (x: ObjHandle | PlayerId): string => (typeof x === 'string' ? g.player(x).name : g.nameOf(x.id));
  if (to === null || sameRecipient(to, e.to)) {
    if (to === null) g.log(`${c.sourceName}: the damage can't be redirected (no player or permanent that could be dealt it).`, { rules: ['CR 614.9'], level: 'info' });
    return e;
  }
  const budget = budgetLeft(g, b, c);
  if (budget !== undefined && c.recId !== undefined) {
    const moved = Math.min(budget, e.amount);
    if (moved <= 0) return e;
    setShieldLeft(g, c.recId, budget - moved);
    g.log(`${moved} damage ${g.nameOf(e.source.id)} would deal to ${name(e.to)} is dealt to ${name(to)} instead (${c.sourceName}).`, { rules: ['CR 614.9'], level: 'action' });
    if (moved === e.amount) return { ...e, to };
    proposeNested(g, { ...e, to, amount: moved }); // the redirected part, in this proposal's branch (CR 614.5)
    return { ...e, amount: e.amount - moved };
  }
  g.log(`The damage ${g.nameOf(e.source.id)} would deal to ${name(e.to)} is dealt to ${name(to)} instead (${c.sourceName}).`, { rules: ['CR 614.9'], level: 'action' });
  return { ...e, to };
}

export const PREVENT_BODY_KINDS: Pick<BodyKinds, 'redirect'> = {
  redirect: {
    capabilities: ['redirect', 'redirect.amount'],
    fits: (_g, e) => e.ev === 'damage',
    apply: (g, e, b, c) => (e.ev === 'damage' ? applyRedirect(g, e, b, c) : e),
  },
};
