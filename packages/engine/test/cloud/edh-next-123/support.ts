/** edh-next-123: shared helpers of this round's scenario tests (3- and 4-player Free-for-All games, CR 806; copied from edh-next-62's and C6's, which keep their own). */
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, mpScenario, pass } from '../../m12/rules/helpers';
import { legal } from '../../m3/scenario';
export { act, answer, find, legal, mpScenario, pass };

export function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node). */
export const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
export const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
export const exiled = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => nameOf(s, id) === name);
export const onBattlefield = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name);
export const castable = (s: GameState, player: PlayerId = 'p1'): ObjectId[] => legal(s, player, 'cast').map((a) => a.object!);
/** Move the named card of the player's library to its bottom (scenario setup; CR 401.1: the library's last card is its bottom). */
export function toBottom(s: GameState, p: PlayerId, name: string): void {
  const lib = s.zones.library[p]!;
  const i = lib.findIndex((id) => nameOf(s, id) === name);
  if (i < 0) throw new Error(`${name} not in ${p}'s library`);
  const [id] = lib.splice(i, 1);
  lib.push(id!);
}

/** Answer the pending decisions with `pick` (else the first legal options), paying costs automatically, passing priority until the stack is empty. */
export function resolveAll(s0: GameState, pick: (s: GameState) => DecisionAnswer | undefined = () => undefined, asked: [string, string][] = []): GameState {
  let t = s0;
  for (let i = 0; i < 600 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
    if (t.pending?.kind === 'priority') { t = act(t, { type: 'pass', player: t.pending.player }); continue; }
    const p = t.pending!;
    if (p.kind === 'payCost') { t = answer(t, { kind: 'payCost', auto: true }); continue; }
    asked.push([p.player, p.kind]);
    const a = pick(t) ?? (p.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: (p as { options: ObjectId[] }).options.slice(0, (p as { min: number }).min) } : undefined);
    if (a === undefined) throw new Error(`no answer for ${p.kind}: ${(p as { prompt?: string }).prompt}`);
    t = answer(t, a);
  }
  return t;
}
/** Pass priority (no attackers, no blockers) until `done`, answering what comes up with `pick`. */
export function passTo(s0: GameState, done: (s: GameState) => boolean, pick: (s: GameState) => DecisionAnswer | undefined = () => undefined, max = 600): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else { const a = pick(s); if (a === undefined) throw new Error(`no answer for ${s.pending?.kind}`); s = answer(s, a); }
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
