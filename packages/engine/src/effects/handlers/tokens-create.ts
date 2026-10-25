/**
 * The `createToken` op (CR 111, 701.7): "Create two 1/1 white Soldier creature tokens" (Raise the Alarm), "create a Treasure token", "each player creates a ...".
 * Owner: WP14.
 *
 * Stages (design 8.6): evaluate the count and the token's quantities once (CR 608.2h: an X/X token); build its definition (token-defs.ts) and add it with
 * `Game.addDef` (an id from its canonical JSON, so the same token shares one definition); one `createToken` proposal per player, in APNAP order (CR 101.4: the
 * active player's tokens get their timestamps first, CR 613.7m), carrying how each token enters (tapped, with counters, attached: `enter`); the created tokens
 * are found in the events the performer emitted; `link` and `as` bind them (CR 607.2a, design 3.1: "tokens created this way").
 * Tokens created "tapped and attacking" become attacking creatures (CR 508.4, zones-util.ts#enterAttacking).
 */
import type { EffectStep } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import type { DestinationFacts, ExecCtx, StepHandler, StepResult } from '../api';
import { evalQty } from '../eval';
import { propose } from '../propose';
import { resolvePlayers } from '../refs';
import { tokenAttachment } from './tokens-attach';
import { tokenCardDef, type TokenSpec } from './token-defs';
import { actOn, addToLink, bindAs, byHand, did, enterAttacking, enteringAttacking, NOTHING, wholeNumber } from './zones-util';

/** cmd1: the `feature:` names of this handler: a token put onto the battlefield attacking a named player (`attacking: {defender}`, CR 508.4). */
export const TOKEN_FEATURES: readonly string[] = ['createToken.attackingWhom'];

type CreateToken = Extract<EffectStep, { op: 'createToken' }>;

/** The players named by `who`, in APNAP order (CR 101.4). */
export function inApnapOrder(cx: ExecCtx, players: PlayerId[]): PlayerId[] {
  const order = cx.g.apnap();
  // M12-2 (m12 design E27): a player who left the game is not in the APNAP order and gets no token (CR 800.4b, 800.4d); before, they sorted first
  const named = cx.g.s.options.multiplayer !== undefined ? [...new Set(players)].filter((p) => order.includes(p)) : [...new Set(players)];
  return named.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** The tokens a `createToken` proposal created: the `zoneChanged` events "from nowhere" the performer emitted since `mark` (core/zones.ts#createToken). */
export function tokensCreatedSince(cx: ExecCtx, mark: number): ObjHandle[] {
  const out: ObjHandle[] = [];
  for (const e of cx.g.events.slice(mark)) {
    if (e.type !== 'zoneChanged' || e.from !== null || e.to !== 'battlefield' || !e.newId) continue;
    const o = cx.g.s.objects[e.newId];
    if (o && o.kind === 'token' && !out.some((h) => h.id === o.id)) out.push({ id: o.id, zone: o.zone });
  }
  return out;
}

export const createToken: StepHandler<CreateToken> = (cx, st) => enteringAttacking(cx, st.attacking, () => createTokenStep(cx, st)); // trek-8 review (CR 508.4): zones-util.ts#enteringAttacking
const createTokenStep: StepHandler<CreateToken> = (cx, st) => {
  const g = cx.g;
  // Integration fix (CR 608.2c, 603.7c): a create that makes no token ("for each Aura and Equipment attached to ~, create ..." with none attached) still binds
  // its name, to no token, so "those tokens" of a later step or a delayed trigger stands for nothing (design 3.1 rule 6), as run.ts#recordSkipped does
  const none = (): StepResult => {
    bindAs(cx, st.as, []);
    return NOTHING;
  };
  const n = wholeNumber(cx, st.count);
  if (n === undefined || n === 0) return none();

  // The token's characteristics, evaluated now (CR 608.2h). A power or toughness that fails to determine creates nothing (CR 608.2b).
  const { power, toughness, ...rest } = st.token;
  const spec: TokenSpec = { ...rest };
  if (power !== undefined) {
    const p = evalQty(cx, power);
    if (p === undefined) return none();
    spec.power = Math.floor(p);
  }
  if (toughness !== undefined) {
    const t = evalQty(cx, toughness);
    if (t === undefined) return none();
    spec.toughness = Math.floor(t);
  }
  const def = tokenCardDef(spec);
  if ('reason' in def) return byHand(cx, st, def.reason);

  // How each token enters (CR 111.4, 614.1c): tapped, with counters, attached to an object.
  const enter: DestinationFacts = {};
  if (st.tapped) enter.tapped = true;
  const counters = (st.counters ?? []).map((c) => ({ kind: c.kind, count: wholeNumber(cx, c.count) ?? 0 })).filter((c) => c.count > 0);
  if (counters.length > 0) enter.counters = counters;

  // What each player's token enters attached to, decided before any token is created (design 8.6 stage 3). The token's controller is the player who creates
  // it (CR 111.2), which is who "you" of its enchant ability is (CR 303.4f).
  const players = inApnapOrder(cx, resolvePlayers(cx, st.who));
  const host = st.attachTo ? actOn(cx, st.attachTo).find((h) => h.zone === 'battlefield') ?? null : undefined;
  const attachTo = new Map<PlayerId, ObjectId | null>();
  for (const p of players) {
    const where = st.attachTo ? tokenAttachment(cx, def, p, host) : null;
    if (where === 'manual') return byHand(cx, st, `the engine can't tell what the ${def.name} token may enchant (CR 303.4f)`);
    if (where === 'none') {
      g.log(`No ${def.name} token is created for ${g.player(p).name}: there is nothing it can legally enchant.`, { rules: ['CR 303.4g', 'CR 303.4i'], level: 'info' });
      continue;
    }
    attachTo.set(p, where);
  }
  if (attachTo.size === 0) {
    bindAs(cx, st.as, []); // merge wave 8 (audit D1): the name stands for the tokens only (below), here none
    return NOTHING;
  }

  g.addDef(def); // copy-on-write, frozen (ARCHITECTURE "Engine principles" 2); the performer finds it by id
  const created: ObjHandle[] = [];
  for (const [p, where] of attachTo) {
    const mark = g.events.length;
    const facts: DestinationFacts = { ...enter, ...(where !== null ? { attachTo: where } : {}) };
    const ok = propose(g, { ev: 'createToken', player: p, count: n, token: def.id, ...(Object.keys(facts).length > 0 ? { enter: facts } : {}) }); // CR 111.2: the creator owns and controls it
    if (ok) created.push(...tokensCreatedSince(cx, mark));
  }
  // CR 508.4: "tapped and attacking"; cmd1: "... attacking that opponent" names the player they attack (zones-util.ts#enterAttacking)
  if (st.attacking) enterAttacking(cx, created.map((h) => h.id), st.attacking);
  addToLink(cx, st.link, created); // CR 607.2a: added to what earlier resolutions created
  // Merge wave 8 (audit D1, CR 111.1, 608.2c, 122.1): the name a token creation binds ("it", "that token", "them") stands for the tokens it created, never for
  // the players who created them: bound with them, "Put X +1/+1 counters on it" also put the counters on the player (effects/refs.ts#resolveRecipients)
  bindAs(cx, st.as, created);
  return did(created.length);
};

