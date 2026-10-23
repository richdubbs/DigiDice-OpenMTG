/**
 * The Ring tempts you (CR 701.54). Owner: MX3. The only code that writes `GameState.designations.ring`.
 *
 *  - CR 701.54a: each time the Ring tempts a player, that player chooses a creature they control; it becomes their Ring-bearer until another creature becomes
 *    their Ring-bearer or another player gains control of it. The same creature may be chosen again. With no creature, nothing is chosen (CR 701.54d: the Ring
 *    still tempts them).
 *  - CR 701.54b: Ring-bearer is a designation of a permanent (`RingState.bearer`), never a copiable value: it is not part of any characteristic.
 *  - CR 701.54c: a player who has no emblem named The Ring gets one before choosing. Its abilities are cumulative with the number of times the Ring has
 *    tempted that player: the first always, the second from two temptations on, the third from three, the fourth from four. The count never goes down, so the
 *    emblem's definition is replaced by the one for the new count each time the count grows (a new definition id, `emblemDef` hashes the abilities); its
 *    abilities are ordinary data (a static ability with a layer-4 type change and a "can't be blocked by" restriction, three triggered abilities) and work
 *    in the command zone through the machinery every emblem uses (CR 114.4: layers, trigger collection, the rule hooks).
 *  - CR 701.54d: "whenever the Ring tempts you" triggers whenever the player completes CR 701.54a, even if choosing was impossible: the action emits
 *    `actionPerformed` with verb `ringTempts` (the trigger event `{ev:'action', verb:'ringTempts'}`), naming the chosen creature when there is one ("whenever
 *    you choose a creature as your Ring-bearer" is the same event with an object).
 *  - CR 701.54e: "is your Ring-bearer" is true only for a permanent on the battlefield under your control with the designation (`isRingBearerOf`, the
 *    `ObjectFilter.ringBearer` field of rules/filter.ts and statics/match.ts).
 */
import type { AbilityDef, ObjRef } from '../types/ability';
import type { RingState } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';
import { charsOfObject } from '../rules/characteristics';
import type { Game } from './game';
import { emblemDef } from './emblems';
import { createEmblemObject } from './zones';

export { ringBearerOf, ringBearerPlayer, ringControlChanged, ringOf, timesTempted } from './ring-state';

/** The name of the emblem (CR 701.54c). */
export const RING_NAME = 'The Ring';

/** "Your Ring-bearer", relative to the controller of the emblem (CR 701.54e). */
const BEARER: ObjRef = { ref: 'each', filter: { ringBearer: 'you' } };

/** The four abilities of The Ring in the order CR 701.54c gives them; the emblem has the first `min(4, tempted)` of them (at least the first). */
export const RING_ABILITIES: readonly AbilityDef[] = [
  {
    kind: 'static',
    text: 'Your Ring-bearer is legendary and can\'t be blocked by creatures with greater power.',
    effects: [
      { s: 'continuous', affects: BEARER, mods: [{ layer: 4, supertypes: { add: ['Legendary'] } }] }, // CR 205.4, 613.1d
      {
        s: 'restrict', subject: BEARER, mode: 'cant', action: 'beBlockedBy', // CR 509.1b
        other: { types: ['Creature'], power: { op: '>', value: { q: 'stat', stat: 'power', of: BEARER } } },
      },
    ],
  },
  {
    kind: 'triggered',
    text: 'Whenever your Ring-bearer attacks, draw a card, then discard a card.',
    trigger: { on: [{ ev: 'attacks', attacker: { ringBearer: 'you' } }] }, // CR 508.1m
    effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }, { op: 'discard', who: { ref: 'you' }, count: 1 }] },
  },
  {
    kind: 'triggered',
    text: 'Whenever your Ring-bearer becomes blocked by a creature, the blocking creature\'s controller sacrifices it at end of combat.',
    trigger: { on: [{ ev: 'becomesBlocked', attacker: { ringBearer: 'you' }, by: { types: ['Creature'] } }] }, // CR 509.3c: once per blocking creature
    effect: {
      targets: [],
      steps: [{
        op: 'delay', when: { at: 'endOfCombat' }, // CR 603.7, 511.2
        do: [{
          op: 'sacrificeChoice', // CR 701.21a: the blocking creature's controller (as the delayed ability resolves) sacrifices it
          who: { ref: 'controllerOf', object: { ref: 'event', role: 'blocker' } },
          filter: { is: { ref: 'event', role: 'blocker' } },
          count: 1,
        }],
      }],
    },
  },
  {
    kind: 'triggered',
    text: 'Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.',
    trigger: { on: [{ ev: 'damage', source: { ringBearer: 'you' }, combat: true, recipient: { player: 'any' } }] }, // CR 510.2
    effect: { targets: [], steps: [{ op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: 3 }] },
  },
];

/** The abilities of a player's Ring after `tempted` temptations (CR 701.54c: cumulative). */
export function ringAbilitiesAt(tempted: number): AbilityDef[] {
  return RING_ABILITIES.slice(0, Math.max(1, Math.min(RING_ABILITIES.length, tempted)));
}

/** CR 701.54c: the emblem named The Ring with the abilities for `tempted` temptations, created or updated in the player's command zone. */
function updateEmblem(g: Game, player: PlayerId, r: RingState): void {
  const def = emblemDef(ringAbilitiesAt(r.tempted), RING_NAME); // an emblem named The Ring (CR 701.54c, 114.3)
  const have = r.emblem !== undefined ? g.s.objects[r.emblem] : undefined;
  if (have !== undefined && have.zone === 'command') {
    if (have.defId === def.id) return;
    g.addDef(def);
    have.defId = def.id; // the count never goes down (CR 701.54c): the emblem now has every ability of the new count
    return;
  }
  r.emblem = createEmblemObject(g, def, player);
  g.log(`${g.player(player).name} gets an emblem named The Ring.`, { rules: ['CR 701.54c', 'CR 114.2'], level: 'action' });
}

/** The creatures `player` controls that can be chosen as Ring-bearer (CR 701.54a; a phased-out permanent is treated as though it does not exist, CR 702.26b). */
function creaturesOf(g: Game, player: PlayerId): ObjectId[] {
  const s = g.s;
  return s.zones.battlefield.filter((id) => {
    const o = s.objects[id];
    if (!o || o.phasedOut) return false;
    const c = charsOfObject(s, o);
    return c.controller === player && c.types.includes('Creature');
  });
}

/**
 * CR 701.54a-d: the Ring tempts `player` once. The emblem first (CR 701.54c), then the choice of a creature they control (none when they control none), then
 * the count, the emblem's abilities for the new count, and the event. Returns the chosen Ring-bearer, if any.
 */
export function ringTempts(g: Game, player: PlayerId): ObjectId | undefined {
  const d = g.s.designations;
  const all = (d.ring ??= {});
  const r: RingState = (all[player] ??= { tempted: 0 });
  updateEmblem(g, player, r); // "before choosing a creature to be their Ring-bearer" (CR 701.54c)
  const options = creaturesOf(g, player);
  let chosen: ObjectId | undefined;
  if (options.length === 1) chosen = options[0];
  else if (options.length > 1) {
    chosen = g.choose({
      kind: 'chooseObjects', player, options, min: 1, max: 1, rules: ['CR 701.54a'],
      prompt: 'The Ring tempts you: choose a creature you control as your Ring-bearer.',
    }).ids[0];
  }
  if (chosen !== undefined) r.bearer = chosen; // replaces the previous Ring-bearer, or is the same one again (CR 701.54a)
  r.tempted += 1;
  updateEmblem(g, player, r);
  const name = g.player(player).name;
  g.log(
    chosen !== undefined
      ? `The Ring tempts ${name} (${r.tempted} time${r.tempted === 1 ? '' : 's'}): ${g.nameOf(chosen)} is ${name}'s Ring-bearer.`
      : `The Ring tempts ${name} (${r.tempted} time${r.tempted === 1 ? '' : 's'}): ${name} controls no creature, so there is no Ring-bearer to choose.`,
    { rules: ['CR 701.54a', 'CR 701.54d'], level: 'action' },
  );
  g.emit({ type: 'actionPerformed', verb: 'ringTempts', actor: player, ...(chosen !== undefined ? { objectId: chosen, zone: 'battlefield' as const } : {}) });
  return chosen;
}
