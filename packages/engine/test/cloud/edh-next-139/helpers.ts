/**
 * Round edh-next-139 (must-finish round, group tokens): helpers of its scenario tests (synthetic cards with the printed wordings, invented names, design 6.10;
 * four-player games of the default compiler).
 */
import { activatedAbilities } from '../../../src/rules/abilities';
import { getChars, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, pass } from '../../m12/rules/helpers';

export interface Script {
  targets?: ObjectId[];
  yes?: (prompt: string, who: PlayerId) => boolean;
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId, max: number, min: number) => ObjectId[];
  option?: (options: { id: string; label: string }[], prompt: string, who: PlayerId) => string;
  number?: (min: number, max: number, prompt: string, who: PlayerId) => number;
  /** Keeps passing priority until this holds, as well as emptying the stack. */
  until?: (state: GameState) => boolean;
  /** Every prompt seen, in order. */
  asked?: string[];
  /** The division of an assignDamage decision (recipient ids -> amounts); default: all to the first. */
  assign?: (recipients: string[], amount: number, who: PlayerId) => number[];
  /** Several options at once (modes; repeats allowed): the ids chosen. Wins over `option`. */
  pick?: (options: { id: string; label: string }[], prompt: string, who: PlayerId, min: number, max: number) => string[];
  /** The color chosen for "one mana of any color" (default: the first offered). */
  color?: string;
  /** Stop at the first priority (do not resolve the stack). */
  noPass?: boolean;
}

/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
export function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  for (let i = 0; i < 600; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind !== 'priority') sc.asked?.push(`${d.player}: ${d.prompt}`);
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      const next = targets.shift();
      a = { kind: 'chooseTargets', targets: next !== undefined ? [/^p\d$/.test(next) ? { kind: 'player', id: next } : { kind: 'object', id: next }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ? sc.yes(d.prompt, d.player) : true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player, d.max ?? o.length, d.min ?? 0) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      a = { kind: 'chooseOption', ids: sc.pick ? sc.pick(o, d.prompt, d.player, d.min ?? 1, d.max ?? 1) : [sc.option ? sc.option(o, d.prompt, d.player) : o[0]!.id] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: sc.number ? sc.number(d.min ?? 0, d.max ?? 0, d.prompt, d.player) : d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'chooseColor') a = { kind: 'chooseColor', color: sc.color ?? (p as unknown as { options: string[] }).options[0]! } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'declareAttackers') a = { kind: 'declareAttackers', attacks: [] } as unknown as DecisionAnswer;
    else if (p.kind === 'assignDamage') {
      const x = p as unknown as { amount: number; recipients: { id: string }[] };
      const split = sc.assign ? sc.assign(x.recipients.map((r) => r.id), x.amount, d.player) : x.recipients.map((_, k) => (k === 0 ? x.amount : 0));
      a = { kind: 'assignDamage', amounts: x.recipients.map((r, k) => ({ id: r.id, amount: split[k] ?? 0 })) } as DecisionAnswer;
    } else if (p.kind === 'priority') {
      if (sc.noPass || (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s)))) break;
      s = pass(s);
      continue;
    } else throw new Error(`unexpected ${p.kind}: ${d.prompt}`);
    s = answer(s, a);
  }
  return s;
}

/** Activates the ability of `source` whose text matches `text` (as printed or granted). */
export function activate(s: GameState, source: ObjectId, text: RegExp, player: PlayerId = 'p1'): GameState {
  const ab = activatedAbilities(s, s.objects[source]!).find((a) => text.test(a.def.text ?? ''));
  if (ab === undefined) throw new Error(`no ability ${text} on ${source}: ${activatedAbilities(s, s.objects[source]!).map((a) => a.def.text).join(' | ')}`);
  return act(s, { type: 'activate', player, source, ability: ab.key } as never);
}
export const texts = (s: GameState, id: ObjectId): string[] => activatedAbilities(s, s.objects[id]!).map((a) => a.def.text ?? '');
export const powerOf = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
export const bfOf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
export const tokensOf = (s: GameState, p: PlayerId, sub?: string): ObjectId[] =>
  s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p && (sub === undefined || (getChars(s, id)!.subtypes as string[]).includes(sub)));
