/**
 * The `transform` proposal kind (CR 701.27, 701.28, 712.18, 712.20; m6 design 2.4, 3.6). Owner: M6-4.
 *
 * Proposed by every transform and convert the engine performs (effects/handlers/dfc-ops.ts: the `changeFace` op, the daybound and nightbound transforms of
 * core/day-night.ts). Its replacement patterns are `becomes transformed` (`feature:replace.on.transform`). Its self candidates come from the characteristics the
 * permanent WILL have with its other face up (`selfCandidatesFrom`, CR 712.20: "As this creature transforms into ~, ..." on the back face applies while it
 * transforms). The performer is installed by effects/handlers/dfc-ops.ts (this part file may not import the interpreter: effects/registries.ts imports it).
 */
import { EngineBug } from '../../core/errors';
import type { Game } from '../../core/game';
import { cantDo } from '../../rules/cant';
import { charsOfObject, type Chars } from '../../rules/characteristics';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameState } from '../../types/state';
import type { Proposed } from '../api';
import type { Performed } from '../perform-events';
import type { ProposalKind } from '../registries';

type Transform = Extract<Proposed, { ev: 'transform' }>;

/** The performer (effects/handlers/dfc-ops.ts installs it when it loads). */
let performer: ((g: Game, e: Transform) => Performed | null) | null = null;
export function installTransformPerformer(f: ((g: Game, e: Transform) => Performed | null) | null): void {
  performer = f;
}

/**
 * The characteristics the permanent would have with its other face up (CR 712.18, 712.20): computed on a copy of the state in which it is turned over (its
 * effects keep applying: a copy effect still makes it a copy, CR 712.9 Cytoshape example). Pure.
 */
export function otherFaceHypothetical(s: GameState, id: ObjectId): Chars {
  const o = s.objects[id];
  if (!o) throw new EngineBug(`otherFaceHypothetical: no object ${id}`);
  const over = { ...o, face: o.face === 0 ? 1 : 0 };
  return charsOfObject({ ...s, objects: { ...s.objects, [id]: over } }, over);
}

const live = (g: Game, e: Transform) => {
  const o = g.s.objects[e.object.id];
  return o && o.zone === 'battlefield' && o.zone === e.object.zone ? o : undefined;
};

export const TRANSFORM_KIND: ProposalKind<Transform> = {
  ev: 'transform',
  capabilities: ['feature:replace.on.transform'],
  semOf: (g, e) => {
    const o = g.s.objects[e.object.id];
    return { seq: 0, batch: 0, before: {}, ev: 'becomes', roles: { subject: { objects: [e.object] }, ...(o ? { player: { players: [o.controller] } } : {}) }, data: { what: 'transformed', ...(e.convert ? { convert: true } : {}) } };
  },
  affectedPlayer: (g, e): PlayerId => g.s.objects[e.object.id]?.controller ?? g.s.turn.activePlayer, // CR 616.1: its controller
  // CR 101.2, 614.17, 701.28f: "can't transform" (also stops converting); CR 702.145b, e: "This permanent can't transform except due to its daybound
  // [nightbound] ability" (the day/night transform is marked `dayNight`, core/day-night.ts)
  forbidden: (g, e) => {
    const c = cantDo(g.s, 'transform', e.object.id);
    if (c) return `a "can't transform" effect applies (CR 101.2): ${c.message}`;
    const o = live(g, e);
    if (!o || e.dayNight === true) return null;
    const bound = charsOfObject(g.s, o).keywords.find((k) => k.keyword === 'daybound' || k.keyword === 'nightbound');
    return bound ? `it has ${bound.keyword} and can transform only due to it (CR 702.145${bound.keyword === 'daybound' ? 'b' : 'e'})` : null;
  },
  perform: (g, e) => {
    if (!performer) throw new EngineBug('transform: the performer is not installed (effects/handlers/dfc-ops.ts was not loaded)');
    return performer(g, e);
  },
  // CR 712.20: the replacement effects of the permanent as it will be with its other face up
  selfCandidatesFrom: (g, e) => {
    const o = live(g, e);
    return o ? { object: o.id, chars: otherFaceHypothetical(g.s, o.id) } : null;
  },
};
