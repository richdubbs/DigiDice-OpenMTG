/**
 * The CR 701 keyword actions as macros over the primitive ops (design 7.5), registered here by name. Owner: WP3. Capabilities `action:<name>` are built from
 * the keys, so an action is advertised only when its expansion is complete and faithful.
 *
 * Registered (M5 macros): investigate, incubate, populate, amass, explore, connive, adapt, support, doubleCounters, detain; native (WP32, run by
 * effects/handlers/actions-native.ts): cascade, discover, vote; native (PUSH1 T1, effects/handlers/actions-native-counters.ts): proliferate, bolster; native (FAST5 T37, the same file): monstrosity.
 *
 * NOT registered, on purpose: a card that uses them stays manual, never approximately automated. `UNREGISTERED_ACTIONS` gives the reason for each one (a test
 * requires a reason for every action name that has no macro and is one the design lists as a macro), so the forecast of the plan owner can see what is lost.
 * The "native" actions (cascade, discover, vote) got their owner in WP32: effects/handlers/actions-native.ts, the file `ActionMacro.native` names.
 */
import type { KeywordActionName } from '../../types/ability';
import type { ActionMacro } from '../types';
import { ADAPT, BLIGHT, DOUBLE_COUNTERS, SUPPORT } from './counters';
import { CONNIVE, EXPLORE, RECRUIT } from './library';
import { AIRBEND, ANOTHER_OF_EACH_KIND, BEHOLD, BOLSTER, CASCADE, DISCOVER, DOUBLE_EACH_KIND, GIVE_GIFT, GOAD, LEARN, MONSTROSITY, RENOWN, OPEN_ATTRACTION, PROLIFERATE, VENTURE, VOTE } from './native';
import { DETAIN } from './restrictions';
import { AMASS, INCUBATE, INVESTIGATE, POPULATE } from './tokens';
import { FACE_DOWN_MACROS } from './face-down';
import { MELD_MACROS } from './meld';
import { MELD_PAIR_MACROS } from './meld-pair';
import { EARTHBEND, EMPOWER, ENDURE } from './bending';
import { RING_MACROS } from './ring';
import { EVIDENCE_MACROS } from './evidence';
import { EXERT, FORAGE } from './exert-forage';

const MACROS: readonly ActionMacro[] = [
  INVESTIGATE, INCUBATE, POPULATE, AMASS, EXPLORE, CONNIVE, ADAPT, SUPPORT, DOUBLE_COUNTERS, DETAIN, CASCADE, DISCOVER, VOTE, PROLIFERATE, BOLSTER, MONSTROSITY, RENOWN,
  VENTURE, // MX4: venture into the dungeon (CR 701.49), effects/handlers/venture.ts
  LEARN, // FAST5 MX7: CR 701.48a (effects/handlers/learn.ts)
  OPEN_ATTRACTION, // FAST5 T38: CR 701.51a (effects/handlers/attraction.ts)
  ...FACE_DOWN_MACROS, // M6-3: manifest, cloak, manifest dread (CR 701.40, 701.58, 701.62); empty in M6-0
  ...MELD_MACROS, // M6-4: meld (CR 701.42); empty in M6-0
  ...MELD_PAIR_MACROS, // MX2: "exile them, then meld them into ..." (CR 701.42a)
  GIVE_GIFT, // FAST5X E1: "gives a gift" (CR 702.174c)
  ENDURE, EARTHBEND, EMPOWER, // FAST5 MX6: CR 701.63, 701.66, "empower <type> N" (bending.ts)
  ...RING_MACROS, // MX3: the Ring tempts you (CR 701.54)
  BLIGHT, // FAST5X E9: blight N (CR 701.68a); as a cost it is rules/cost.ts's putCounters part
  AIRBEND, // FAST5X E10: airbend (CR 701.65), effects/handlers/airbend.ts
  BEHOLD, // FAST5X E11: behold (CR 701.4a), effects/handlers/behold.ts
  ...EVIDENCE_MACROS, // FAST5X E12: suspect (CR 701.60), collect evidence (CR 701.59)
  RECRUIT, // FAST5X E18: recruit (reminder text; connive's shape, CR 701.50a)
  EXERT, FORAGE, // FAST5X E28: exert (CR 701.43a, macro over the MX5 untap restriction), forage (CR 701.61a, effects/handlers/forage.ts)
  GOAD, // M12-3: goad (CR 701.15), effects/handlers/goad.ts; the requirements in statics/requirements.ts#goadHits
  DOUBLE_EACH_KIND, // cloud std-spm: "double the number of each kind of counter on X" (CR 701.10e), effects/handlers/actions-native-counters.ts
  ANOTHER_OF_EACH_KIND, // r5-refs: "for each kind of counter on X, give that permanent or player another counter of that kind" (CR 122.6)
];

export const ACTION_MACROS: Readonly<Partial<Record<KeywordActionName, ActionMacro>>> = Object.fromEntries(MACROS.map((m) => [m.name, m]));

/** Why each action the design lists as a macro (7.5) or a native action is NOT registered. */
export const UNREGISTERED_ACTIONS: Readonly<Record<string, string>> = {
  clash: 'CR 701.30: both players reveal and compare mana values and may bottom the card; the comparison result has no condition to read',
  doublePT: 'CR 701.10a-b: the duration is part of the card\'s sentence ("until end of turn") and the step carries only `arg: string` (a counter kind or subtype), so it cannot say how long; guessing the duration would be a silent wrong answer',
  triple: 'CR 701.10a-b: the same as doublePT (the duration is not carried by the step)',
  // FAST5 MX6: the other new keyword actions of its package, not automated yet (FAST5X E10: airbend is registered; waterbend is a cost only; FAST5X E11: behold is registered)
  waterbend: 'CR 701.67a: "Waterbend [cost]" means "Pay [cost]...": it is only ever a cost, paid by rules/cost.ts and rules/pay.ts (FAST5X E10: a waterbend cost part needs no action macro, model/cap-walk.ts#COST_ONLY_ACTIONS); no instruction to waterbend as an effect is printed',
};
