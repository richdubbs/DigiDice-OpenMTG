/**
 * Helpers of the M6-3 tests (m6 design 3.4, 5 M6-3): real fixture cards in scenario states, driven by real actions (casting face down, the turn-face-up special
 * action, effects that manifest or turn permanents face down). Nothing is mocked.
 */
import { applyAction, compileCard, getChars, legalActions, viewFor, type CardDef, type DecisionAnswer, type FaceDownInfo, type GameState, type GameView, type LegalAction, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, find, put, tweak } from '../../m5/helpers';
import { drive } from '../../m5/cr-examples/helpers';

export { act, answer, find, pass, scenario, tweak } from '../../m5/helpers';
export { drive, resolveAll, resolveTop, stackNames } from '../../m5/cr-examples/helpers';
export { getChars, viewFor };

/** Cast `name` from `player`'s hand face down (`method`: 'morph' covers megamorph, CR 702.37b; 'disguise'), paying automatically. */
export function castFaceDown(s: GameState, name: string, method: 'morph' | 'disguise' = 'morph', player: PlayerId = 'p1', answers: DecisionAnswer[] = []): GameState {
  return drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player), method }), answers);
}

/** The face-down permanents of a player, oldest first. */
export const faceDownOf = (s: GameState, player: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.faceDown && s.objects[id]!.controller === player);

/** The turn-face-up special actions `player` may take now. */
export const turnUpActions = (s: GameState, player: PlayerId = 'p1'): LegalAction[] => legalActions(s, player).filter((a) => a.kind === 'special' && (a.action as { kind: string }).kind === 'turnFaceUp');

/** Take the turn-face-up special action for `id` (`via` when there are several procedures), answering and paying automatically. */
export function turnUp(s: GameState, id: ObjectId, via?: string, answers: DecisionAnswer[] = [], player: PlayerId = 'p1', x?: number): GameState {
  return drive(act(s, { type: 'special', player, kind: 'turnFaceUp', object: id, ...(via !== undefined ? { via: via as 'morph' } : {}), ...(x !== undefined ? { x } : {}) }), answers);
}

/** The error a special action is rejected with (the state must not change). */
export function rejectSpecial(s: GameState, id: ObjectId, via?: string, player: PlayerId = 'p1'): string {
  const r = applyAction(s, { type: 'special', player, kind: 'turnFaceUp', object: id, ...(via !== undefined ? { via: via as 'morph' } : {}) });
  if (!r.error) throw new Error('expected the special action to be rejected');
  return r.error.message;
}

/** Everything of a view as one string (for "never contains" checks of hidden information). */
export const viewText = (v: GameView): string => JSON.stringify(v);

/** Lands of the given name, n of them. */
export const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];

/** Characteristics in short. */
export function pt(s: GameState, id: ObjectId): string {
  const c = getChars(s, id);
  return `${c.power}/${c.toughness}`;
}

/** Put a card of the scenario onto the battlefield face down (test setup), with its face-down status; returns the new state and the permanent's id. */
export function putFaceDown(s: GameState, owner: PlayerId, name: string, info: FaceDownInfo = { by: 'morph', profile: 'plain' }): [GameState, ObjectId] {
  let id = '';
  const t = tweak(s, (x) => {
    id = put(x, owner, 'battlefield', name);
    Object.assign(x.objects[id]!, { faceDown: true, faceDownInfo: { ...info } });
  });
  return [t, id];
}

/** A synthetic card compiled by the default compiler from invented text (design 6.10: never Wizards text). */
export function synthetic(name: string, typeLine: string, manaCost: string, text: string, extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', type_line: typeLine, mana_cost: manaCost, oracle_text: text, colors: [], ...extra } as OracleCard);
}

/** The log texts a player is shown. */
export const logFor = (s: GameState, p: PlayerId): string[] => viewFor(s, p).log.map((l) => l.text);

/** getChars on a view, as the client runs it (m6 design D7: views carry the pseudo-definitions, so the characteristics function works on them). */
export const viewChars = (v: GameView, id: ObjectId): ReturnType<typeof getChars> => getChars(v as unknown as GameState, id);
