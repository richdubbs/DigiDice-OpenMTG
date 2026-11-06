/**
 * edh-c-84: `balance` (CR 608.2e, 701.21a, 701.9a): "Each player chooses a number of lands they control equal to the number of lands controlled by the player who controls the
 * fewest, then sacrifices the rest. Players discard cards and sacrifice creatures the same way." (Magus of the Balance, Restore Balance; cites checked against the 2026-09-25 text).
 *
 * The parts run one after another, in the order the card lists them. For each part the number each player keeps is the least number of those permanents (or cards in hand) any
 * player has when the part starts (a player who has lost the game is no player of it, CR 800.4a); every player in APNAP order (CR 101.4) chooses which of theirs to keep
 * (no choice when they have no more than that), and the rest are sacrificed (a permanent that can't be sacrificed stays, CR 701.21a, 101.2) or discarded (a card a "can't discard"
 * effect protects stays, CR 101.2) at the same time (CR 608.2e).
 */
import type { EffectStep } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import { cantDo, costUseDenial } from '../../rules/cant';
import { charsOfObject, controllerOf } from '../../rules/characteristics';
import type { StepHandler } from '../api';
import { sacrificeAll } from './zones-remove';
import { logAction, moveAsAction, namesOf, NOTHING, playerName, result } from './cards-util';

type Step = Extract<EffectStep, { op: 'balance' }>;

const balance: StepHandler<Step> = (cx, st) => {
  const g = cx.g;
  let total = 0;
  for (const part of st.parts) {
    const apnap = g.apnap().filter((p) => !g.player(p).hasLost);
    const pools = new Map<PlayerId, ObjectId[]>();
    for (const p of apnap) {
      if (part === 'cards') pools.set(p, (g.s.zones.hand[p] ?? []).slice());
      else {
        const type = part === 'lands' ? 'Land' : 'Creature';
        pools.set(p, Object.values(g.s.objects).filter((o) => o.zone === 'battlefield' && !o.phasedOut && controllerOf(g.s, o) === p && charsOfObject(g.s, o).types.includes(type)).map((o) => o.id));
      }
    }
    if (apnap.length === 0) continue;
    const keep = Math.min(...apnap.map((p) => pools.get(p)!.length));
    const rest: { p: PlayerId; ids: ObjectId[] }[] = [];
    for (const p of apnap) {
      const pool = pools.get(p)!;
      if (pool.length <= keep) continue;
      const word = part === 'cards' ? 'cards in your hand' : part === 'lands' ? 'lands' : 'creatures';
      const kept = keep === 0 ? [] : g.choose({
        kind: 'chooseObjects', player: p, prompt: `Choose ${keep} of your ${word} to keep; the rest ${part === 'cards' ? 'are discarded' : 'are sacrificed'}.`,
        options: pool, min: keep, max: keep, rules: ['CR 608.2d', 'CR 608.2e'],
      }).ids;
      rest.push({ p, ids: pool.filter((id) => !kept.includes(id)) });
    }
    if (part === 'cards') {
      for (const { p, ids } of rest) {
        const ok = ids.filter((id) => cantDo(g.s, 'discard', p, id, undefined, false, cx.source.id) === null); // edh-next-136: the source causes the discard (CR 109.5)
        const names = namesOf(g, ok);
        const moved = ok.flatMap((id) => moveAsAction(cx, { id, zone: 'hand' }, 'graveyard', 'discard', cx.controller) ?? []);
        if (moved.length > 0) {
          total += moved.length;
          logAction(cx, `${playerName(g, p)} discards ${names}.`, ['CR 701.9a', 'CR 608.2e']);
        }
      }
    } else {
      const handles: ObjHandle[] = rest.flatMap(({ p, ids }) => ids.filter((id) => costUseDenial(g.s, p, id, 'sacrifice', undefined, false, cx.source.id) === null) /* edh-next-136: the source causes the sacrifice (CR 109.5, 701.21a) */.map((id) => ({ id, zone: 'battlefield' as const })));
      total += sacrificeAll(cx, handles).length;
    }
  }
  return total === 0 ? NOTHING : result(total);
};

export const EDH_C84_HANDLERS = { balance };
