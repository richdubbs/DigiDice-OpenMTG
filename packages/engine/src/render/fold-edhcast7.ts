/**
 * edh-cast-7 (Commander lane edh-cast): the fold of its template eff.edhc7.cast.yourCommander.free (parser/templates/zz-cloud/edh-cast-7.json), called from render/fold.ts#foldAt.
 *
 * `castYourCommanderFree` (CR 903.3d, 702.124e, 903.8, 601.2, 118.9d; Geode Golem): "You may cast your commander from the command zone without paying its mana cost.": a choice by you of
 * up to one commander you own in the command zone (with two commanders, either one, CR 702.124e), then its cast without paying its mana cost, both inside the resolution
 * (the commander tax and other additional costs are still paid, CR 118.9d, 903.8). Only that shape, and nothing after it reading the choice.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const COMMANDER_IN_COMMAND_ZONE = JSON.stringify({ commander: true, owner: 'you', zone: 'command' });
const plainKeys = (step: object, allowed: string[]): boolean => Object.keys(step).every((k) => allowed.includes(k));

function castYourCommanderFree(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  if (!plainKeys(a, ['op', 'who', 'from', 'min', 'max', 'as']) || JSON.stringify(a.from.filter) !== COMMANDER_IN_COMMAND_ZONE) return null;
  if (b?.op !== 'cast' || b.who.ref !== 'you' || b.free !== true || b.what.ref !== 'bound' || b.what.name !== a.as || !plainKeys(b, ['op', 'who', 'what', 'free'])) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null; // nothing later reads the chosen commander
  const text = 'you may cast your commander from the command zone without paying its mana cost';
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

export function foldEdhCast7(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return castYourCommanderFree(list, i, st);
}
