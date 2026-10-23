/** FAST5 T60 test helpers: synthetic cards compiled by the game's default compiler, and small drivers for casting, resolving and attaching. */
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, legal, pass } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

export function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

/** No ability of the card left manual. */
export const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));

export const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
export const subtypes = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes];
export const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types];
export const colors = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.colors];

/** Pay for what is being cast (automatically), answer the questions that come up. */
export function settle(s0: GameState, yes = true, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    const p = s.pending as unknown as { kind: string; options?: string[]; min?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, p.min ?? 0) });
    else break;
  }
  return s;
}

/** Both players pass until the stack is empty. */
export function resolveAll(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = settle(s0, true, targets);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, true, targets);
  return s;
}

/** Activate the `index`th non-mana ability of the named permanent of `player` (paying automatically, choosing `targets`), without resolving it. */
export function activate(s: GameState, name: string, targets: TargetChoice[] = [], index = 0, player: 'p1' | 'p2' = 'p1'): GameState {
  const id = find(s, name, 'battlefield', player);
  const la = legal(s, player, 'activate').filter((a) => a.object === id && !a.isMana)[index];
  if (!la) throw new Error(`no activated ability ${index} of ${name}`);
  return settle(act(s, la.action), true, targets);
}

export const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

/** Test setup (CR 301.5, 303.4): attach `equipment` to `to`, both on the battlefield under `owner`. */
export const attach = (s: GameState, equipment: string, to: string, owner: 'p1' | 'p2' = 'p1'): GameState =>
  tweak(s, (t) => { t.objects[find(t, equipment, 'battlefield', owner)]!.attachedTo = find(t, to, 'battlefield', owner); });
