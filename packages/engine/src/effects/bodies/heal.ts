/**
 * The `healFirst` replacement body (CR 614.1a). Owner: Cloud r5-repl.
 *
 * "If damage would be dealt to Wolverine, instead that damage is dealt, but all other damage already dealt to him is healed." (Wolverine, Fierce Fighter). It
 * applies to a damage event dealt to a permanent only: applying it marks the event (`Proposed.healFirst`), and the event's performer
 * (effects/perform-events.ts#performDamageEvent) removes the damage already marked on that permanent as the new damage is dealt, so nothing sees the permanent
 * between the two (no state-based action is checked in between, CR 704.3). The damage itself is not changed: its source, amount and combat flag stay, and other
 * replacement and prevention effects apply to it as usual (CR 616.1, the affected permanent's controller orders them).
 */
import type { BodyKinds } from '../registries';

export const HEAL_BODY_KINDS: Pick<BodyKinds, 'healFirst'> = {
  healFirst: {
    capabilities: ['healFirst'],
    fits: (_g, e) => e.ev === 'damage' && typeof e.to !== 'string',
    apply: (_g, e) => (e.ev === 'damage' && typeof e.to !== 'string' ? { ...e, healFirst: true } : e),
  },
};
