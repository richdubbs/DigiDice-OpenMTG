/**
 * edh-zones-12: shared helpers of the round's scenario tests (synthetic cards, design 6.10; the engine drives, nothing is faked).
 */
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass } from '../../m3/scenario';

export { act, answer, find, pass, scenario } from '../../m3/scenario';

export function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; loyalty?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
/** No ability of the card is manual, at any depth. */
export const noManual = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
export const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
export const player = (id: string): TargetChoice => ({ kind: 'player', id });
export const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
export const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);
export const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
export const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
export const no: DecisionAnswer = { kind: 'yesNo', yes: false };
export const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
export const gyNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();
export const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();

/** One decision: mana is paid automatically, an order of triggers or moves stays as offered, targets come from `targets`, anything else from `answers`; null when nothing is left to answer it. */
function step(s: GameState, answers: DecisionAnswer[], targets: TargetChoice[][]): GameState | null {
  const p = s.pending;
  if (!p) return null;
  if (p.kind === 'payCost') return answer(s, { kind: 'payCost', auto: true });
  if (p.kind === 'order' && answers[0]?.kind !== 'order') return answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
  if (p.kind === 'chooseTargets') return targets.length > 0 ? answer(s, { kind: 'chooseTargets', targets: targets.shift()! }) : null;
  return answers.length > 0 ? answer(s, answers.shift()!) : null;
}
/** Answer the decisions until priority comes back (or no answer is left). */
export function drive(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 80; guard++) {
    const next = step(s, answers, targets);
    if (next === null) break;
    s = next;
  }
  return s;
}
/** Both players pass until the stack is empty, answering decisions on the way. */
export function resolveAll(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 200; guard++) {
    if (s.pending?.kind === 'priority') { s = pass(s); continue; }
    const next = step(s, answers, targets);
    if (next === null) break;
    s = next;
  }
  return s;
}
export function castAt(s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], who = 'p1'): GameState {
  const s = drive(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), [], targets);
  return resolveAll(s, answers);
}
export function activate(s0: GameState, source: ObjectId, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], nth = 0): GameState {
  const las = legalActions(s0, s0.pending!.player).filter((a) => a.kind === 'activate' && !a.isMana && a.object === source);
  const la = las[nth];
  if (!la) throw new Error(`no activation of ${nameOf(s0, source)}`);
  return resolveAll(drive(act(s0, la.action), [], targets), answers);
}
