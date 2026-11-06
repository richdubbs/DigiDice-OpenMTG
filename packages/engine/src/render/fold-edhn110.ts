/**
 * edh-next-110 (concept lane tokens-counters, template code edhn110): the folds of its templates (parser/templates/zz-cloud/edh-next-110.json), called from render/fold.ts#foldAt.
 *
 * `chooseNthPlayer` (CR 608.2d, 102.1; Gluntch, the Bestower): "Choose a second player to draw a card." / "Then choose a third player to create two Treasure tokens.": a player choice that
 * offers none of the players chosen before in this resolution (`exclude` of `bound`), then the one instruction done by the player chosen. Only those two shapes (a draw of one card,
 * a token creation), the chosen player named by nothing after them.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { tokenText } from './steps-zones';
import { signed } from './text';

const NTH: Readonly<Record<string, string>> = { chosenPlayer2: 'second', chosenPlayer3: 'third' };

function chooseNthPlayer(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const d = list[i + 1];
  if (c?.op !== 'chooseValue' || c.what !== 'player' || c.who.ref !== 'you' || c.guard !== undefined || c.link !== undefined || c.options !== undefined || c.min !== undefined || c.max !== undefined) return null;
  if (c.secret !== undefined || c.random !== undefined || c.mostLife !== undefined || c.controlsMore !== undefined || c.cardKind !== undefined || c.counterOn !== undefined) return null;
  const nth = NTH[c.as];
  const ex = c.exclude;
  if (nth === undefined || ex === undefined) return null;
  const want = c.as === 'chosenPlayer2' ? ['chosenPlayer'] : ['chosenPlayer', 'chosenPlayer2'];
  if (ex.length !== want.length || ex.some((x, k) => typeof x !== 'object' || !('bound' in x) || x.bound !== want[k])) return null;
  if (d === undefined || d.guard !== undefined || d.as !== undefined) return null;
  const who = d.op === 'draw' || d.op === 'createToken' ? d.who : undefined;
  if (who === undefined || who.ref !== 'bound' || who.name !== c.as) return null;
  let what: string;
  if (d.op === 'draw') {
    if (d.count !== 1 || Object.keys(d).some((k) => !['op', 'who', 'count'].includes(k))) return null;
    what = 'draw a card';
  } else if (d.op === 'createToken') {
    if (typeof d.count !== 'number' || Object.keys(d).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
    what = `create ${tokenText(d.token, d.count, d.count !== 1, st)}`;
  } else return null;
  // the chosen player is named by nothing after the instruction but the exclusion list of the next choice
  if (JSON.stringify(list.slice(i + 2)).replace(/"exclude":\[[^\]]*\]/g, '').includes(`"${c.as}"`)) return null;
  return { clauses: [plain(`choose a ${nth} player to ${what}`, { leadThen: c.as === 'chosenPlayer3' })], consumed: 2 };
}

/**
 * `pumpGainsIf` (CR 608.2c, 611.2a, 613.1f, 613.4c; Aurelia, Exemplar of Justice): "Until end of turn, that creature gets +2/+0, gains trample if it's red, and gains vigilance if it's white.":
 * a fixed pump, then two grants of the same object and duration, each guarded by a condition checked as the effect begins. Only those three steps (the pump has no other part, each
 * grant is one keyword).
 */
function pumpGainsIf(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'effect' || b?.op !== 'effect' || c?.op !== 'effect' || a.duration === undefined || a.guard !== undefined || a.as !== undefined || b.guard === undefined || c.guard === undefined) return null;
  if (b.as !== undefined || c.as !== undefined || JSON.stringify(a.duration) !== JSON.stringify(b.duration) || JSON.stringify(a.duration) !== JSON.stringify(c.duration)) return null;
  const [pe, ge, he] = [a.effects, b.effects, c.effects];
  if (pe.length !== 1 || ge.length !== 1 || he.length !== 1) return null;
  const [p, g, h] = [pe[0]!, ge[0]!, he[0]!];
  if (p.s !== 'continuous' || g.s !== 'continuous' || h.s !== 'continuous' || p.cda !== undefined || g.cda !== undefined || h.cda !== undefined) return null;
  if (JSON.stringify(p.affects) !== JSON.stringify(g.affects) || JSON.stringify(p.affects) !== JSON.stringify(h.affects) || p.affects.ref === 'each') return null;
  if (p.mods.length !== 1 || g.mods.length !== 1 || h.mods.length !== 1) return null;
  const pump = p.mods[0]!;
  if (pump.layer !== '7c' || typeof pump.power !== 'number' || typeof pump.toughness !== 'number' || Object.keys(pump).some((x) => !['layer', 'power', 'toughness'].includes(x))) return null;
  const words: string[] = [];
  for (const m of [g.mods[0]!, h.mods[0]!]) {
    if (m.layer !== 6 || m.add?.length !== 1 || m.remove !== undefined || m.removeAll !== undefined || m.cantHave !== undefined || Object.keys(m).some((x) => !['layer', 'add'].includes(x))) return null;
    const k = m.add[0]!;
    if (k.kind !== 'keyword' || Object.keys(k).some((x) => x !== 'kind' && x !== 'keyword' && x !== 'text')) return null;
    if (k.text !== undefined && k.text !== k.keyword) return null;
    words.push(k.keyword);
  }
  const subj = K.obj(p.affects as ObjRef, st, 'subject');
  const dur = K.dur(a.duration, st);
  if (!dur || subj.plural) return null;
  const [c1, c2] = [K.cond(b.guard, st), K.cond(c.guard, st)];
  const body = `${subj.text} gets ${signed(pump.power)}/${signed(pump.toughness)}, gains ${words[0]} if ${c1}, and gains ${words[1]} if ${c2}`;
  return { clauses: [plain(`${dur}, ${body}`)], consumed: 3 };
}

export function foldEdhN110(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return chooseNthPlayer(list, i, st) ?? pumpGainsIf(list, i, st);
}
