/** The event as the effect that a trigger starts sees it (EventContext, design 4.1). Owner: WP8. */
import type { ObjectId } from '../types/ids';
import type { ManaType } from '../types/mana';
import type { EventContext, LastKnown, RoleValue, SemEvent } from '../types/state';

const union = (a: RoleValue | undefined, b: RoleValue): RoleValue => {
  if (!a) return b;
  if ('objects' in a && 'objects' in b) return { objects: [...a.objects, ...b.objects.filter((h) => !a.objects.some((x) => x.id === h.id))] };
  if ('players' in a && 'players' in b) return { players: [...a.players, ...b.players.filter((p) => !a.players.includes(p))] };
  return a;
};

/** Events whose amount is how many of them there are (model/lint-roles.ts#AMOUNT_EVENTS without a number in the event). */
// FAST4 T26: an attack too, so a "one or more ... attack" batch of one attacker has the amount 1 (model/lint-roles.ts#patternsHaveAmount, CR 508.1, 603.2c)
// Standard round 5, r5-trig: and a change of state, "whenever you untap one or more permanents ..., put that many" (CR 502.3, 603.2c; model/lint-roles.ts)
const COUNTED: ReadonlySet<string> = new Set(['zoneChange', 'createToken', 'attacks', 'becomes']);

/**
 * AF2 (FINAL6 audit D1): does the effect keep this event's snapshot? Not for an object put onto the battlefield by an event the trigger does not look back at
 * (CR 603.10a: "enters" is not a look-back trigger; leaving a graveyard is, so a "leaves your graveyard" trigger keeps the snapshot of a card returned to the
 * battlefield). That snapshot is the object before it entered (a spell on the stack, a card in a graveyard): reading it would miss what applies only on the
 * battlefield (a CDA that counts itself, an anthem, the counters it entered with). Without it the effect reads the permanent as it is now, or its last known
 * information on the battlefield once it has left (effects/refs.ts#readInfo, CR 608.2h). Every other event keeps its snapshot.
 */
const keepsSnapshot = (e: SemEvent, looksBack: (e: SemEvent) => boolean): boolean => !(e.ev === 'zoneChange' && e.data['to'] === 'battlefield' && !looksBack(e));

/**
 * The event as the effect sees it (EventContext): the roles of the matched events (united for a batched trigger), "that much", and the snapshots.
 * AF2 INTERFACE CHANGE (additive): `looksBack` says whether the trigger looks back at an event (triggers/lookback.ts#lookBackApplies of a pattern that matched
 * it, as trigger matching decides); without it no event that put an object onto the battlefield is looked back at (`keepsSnapshot`).
 */
export function contextOf(group: readonly SemEvent[], extraBefore: Record<ObjectId, LastKnown> = {}, looksBack: (e: SemEvent) => boolean = () => false): EventContext {
  const roles: EventContext['roles'] = {};
  const before: Record<ObjectId, LastKnown> = { ...extraBefore };
  let amount: number | undefined;
  let excess: number | undefined;
  let spellsBefore: number | undefined;
  let modesChosen: number | undefined;
  let loyaltyRemoved: number | undefined;
  let manaSpent: number | undefined;
  let produced: ManaType[] | undefined;
  let manaFrom: Record<string, number> | undefined;
  let x: number | undefined;
  let ballots: EventContext['ballots'];
  let counterKinds: Record<string, number> | undefined;
  let dieHighest: number | undefined;
  let crewers: number | undefined; // edh-d-89 (CR 702.122e)
  // edh-next-97 (CR 700.4): every object of the batch left the battlefield for a graveyard (a zone change from the battlefield is the only event that has the fact)
  const fromBf = group.filter((e) => e.ev === 'zoneChange' && e.data['from'] === 'battlefield');
  const died = fromBf.length > 0 && fromBf.length === group.length ? fromBf.every((e) => e.data['to'] === 'graveyard') : undefined;
  for (const e of group) {
    for (const [role, v] of Object.entries(e.roles) as [keyof EventContext['roles'], RoleValue][]) roles[role] = union(roles[role], v);
    if (keepsSnapshot(e, looksBack)) Object.assign(before, e.before);
    if (typeof e.data['amount'] === 'number') amount = (amount ?? 0) + e.data['amount'];
    if (e.ev === 'counters' && typeof e.data['kind'] === 'string' && typeof e.data['amount'] === 'number') { counterKinds ??= {}; counterKinds[e.data['kind']] = (counterKinds[e.data['kind']] ?? 0) + e.data['amount']; } // edhn63 (CR 122.6)
    if (e.ev === 'becomes' && e.data['what'] === 'crewed' && typeof e.data['crewers'] === 'number') crewers = e.data['crewers']; // edh-d-89 (CR 702.122e): the crewers of that crew ability
    if (e.ev === 'dieRoll' && typeof e.data['result'] === 'number') dieHighest = Math.max(dieHighest ?? e.data['result'], e.data['result']); // edh-d-49 (CR 706.2): the highest result of the batch
    if (e.ev === 'damage' && typeof e.data['excess'] === 'number') excess = (excess ?? 0) + e.data['excess']; // edh-top-15 (CR 120.10)
    if (e.ev === 'activate' && typeof e.data['produced'] === 'string') produced = [...(produced ?? []), ...([...e.data['produced']] as ManaType[])]; // T38: CR 106.3, 605.1a
    if (e.ev === 'cast' && typeof e.data['spellsBefore'] === 'number') spellsBefore = e.data['spellsBefore']; // CR 702.40a: fixed when the spell was cast
    if (e.ev === 'cast' && typeof e.data['modesChosen'] === 'number') modesChosen = e.data['modesChosen']; // Standard round 3, r3-trig (CR 601.2b, 700.2)
    if (e.ev === 'activate' && typeof e.data['loyaltyRemoved'] === 'number') loyaltyRemoved = e.data['loyaltyRemoved']; // Standard round 3, r3-trig (CR 606.4)
    if (e.ev === 'action' && e.data['verb'] === 'cycle' && typeof e.data['x'] === 'number') x = e.data['x']; // CLOUD std-dft: the X of the cycling cost (CR 107.3a)
    if (e.ev === 'becomes' && e.data['what'] === 'monstrous' && typeof e.data['x'] === 'number') x = e.data['x']; // edh-perms-16: the N of the monstrosity (CR 701.37a)
    if (e.ev === 'cast' && typeof e.data['x'] === 'number') x = e.data['x']; // r4-fxz: the X announced for the spell cast (CR 107.3, 601.2b)
    if (e.ev === 'cast' && typeof e.data['manaSpent'] === 'number') {
      manaSpent = e.data['manaSpent']; // FAST5X E9, CR 601.2h, 702.191a: fixed when the spell was cast
      // FAST5X E19 (CR 106.3): the mana spent from sources of each subtype (triggers/normalize.ts#MANA_FROM keys); a cast with none has an empty record
      manaFrom = {};
      for (const [k, v] of Object.entries(e.data)) if (k.startsWith('manaFrom.') && typeof v === 'number') manaFrom[k.slice('manaFrom.'.length)] = v;
    }
    if (e.ev === 'action' && e.data['verb'] === 'votesFinished' && typeof e.data['ballots'] === 'string') ballots = JSON.parse(e.data['ballots']) as EventContext['ballots']; // M12F (CR 701.38a)
  }
  // design 3.5: a batch has the number of its events as its amount; an event that carries no number of its own (an object entering, a token created) is
  // counted even alone, so "that much" of "one or more artifacts enter" is 1 for one artifact (PUSH1 T2 review: it was undefined, CR 608.2b)
  // FAST4 T22: a discard is one card per event (triggers/normalize.ts: the zone change seen as the verb, CR 701.9a), so "whenever you discard one or more
  // cards, ... that many" counts the cards even when one was discarded (model/lint-roles.ts#patternsHaveAmount)
  if (amount === undefined && (group.length > 1 || group.every((e) => COUNTED.has(e.ev) || (e.ev === 'action' && (e.data['verb'] === 'discard' || e.data['verb'] === 'mill' /* edh-perms-20: one card per mill event, CR 701.17a */))))) amount = group.length;
  return { ev: group[0]!.ev, roles, ...(crewers !== undefined ? { crewers } : {}), ...(amount !== undefined ? { amount } : {}), ...(excess !== undefined ? { excess } : {}), ...(spellsBefore !== undefined ? { spellsBefore } : {}), ...(modesChosen !== undefined ? { modesChosen } : {}), ...(loyaltyRemoved !== undefined ? { loyaltyRemoved } : {}), ...(manaSpent !== undefined ? { manaSpent } : {}), ...(died !== undefined ? { died } : {}),
    ...(produced !== undefined ? { produced } : {}), ...(manaFrom !== undefined && Object.keys(manaFrom).length > 0 ? { manaFrom } : {}), ...(x !== undefined ? { x } : {}), ...(ballots !== undefined ? { ballots } : {}), ...(counterKinds !== undefined ? { counterKinds } : {}), ...(dieHighest !== undefined ? { dieHighest } : {}), before };
}
