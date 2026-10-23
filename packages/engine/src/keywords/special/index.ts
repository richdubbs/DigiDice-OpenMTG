/** Special actions keywords grant (CR 116.2): foretell, suspend, plot, turning a face-down permanent face up. Registered here by name. Owner: WP3. All four are PLANNED stubs (stub.ts). */
import type { SpecialActionDef } from '../types';
import { FORETELL } from './foretell';
import { TURN_FACE_UP } from './morph';
import { PLOT } from './plot';
import { SUSPEND } from './suspend';

export const SPECIAL_ACTIONS: readonly SpecialActionDef[] = [FORETELL, SUSPEND, PLOT, TURN_FACE_UP];

/** Which keywords grant which special action (the registry attaches them as `KeywordDef.special`). */
export const SPECIAL_BY_KEYWORD: Readonly<Record<string, readonly SpecialActionDef[]>> = {
  foretell: [FORETELL],
  suspend: [SUSPEND],
  plot: [PLOT],
  morph: [TURN_FACE_UP],
  disguise: [TURN_FACE_UP],
};
