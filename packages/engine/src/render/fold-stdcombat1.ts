/**
 * std-combat-1 (lane std-combat): the folds of its templates (parser/templates/zz-cloud/std-combat-1.json), called from render/fold.ts#foldAt.
 *
 * `attachOneOfThemToA` (CR 701.3a, 608.2c-d, 301.5): "attach one of them to a Samurai you control" (Gilgamesh, Master-at-Arms): the controller chooses exactly one object
 * of a group named before (the Equipment a move put onto the battlefield, the reflexive trigger's "them"), then exactly one permanent of a description, and attaches the
 * first to the second; no target. Only that exact shape (eff.stdcombat1.attachOneOfThem.toA), with nothing after it reading either choice.
 */
import type { Duration, EffectStep, EventPattern, NumberCmp, ObjectFilter, ObjRef, PlayerRef, StaticEffect } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt } from './text';

const boundTo = (r: ObjRef | null | undefined, name: string | undefined): boolean => r?.ref === 'bound' && name !== undefined && r.name === name;

function attachOneOfThemToA(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || c?.op !== 'attach') return null;
  const one = (x: typeof a): boolean => x.who.ref === 'you' && x.min === 1 && x.max === 1 && x.random !== true && x.guard === undefined && x.groupLimit === undefined && x.perPlayer === undefined && x.as !== undefined;
  if (!one(a) || !one(b) || c.guard !== undefined || c.as !== undefined || !boundTo(c.what, a.as) || !boundTo(c.to as ObjRef, b.as)) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || Object.keys(a.from.filter).length !== 1 || a.from.filter.is === undefined) return null;
  if (b.from.ref !== 'each' || !('filter' in b.from) || (b.from.filter.zone !== undefined && b.from.filter.zone !== 'battlefield')) return null;
  if (JSON.stringify(list.slice(i + 3)).match(new RegExp(`"name":"(${a.as}|${b.as})"`))) return null;
  const from = a.from.filter.is;
  if (from.ref === 'each') return null;
  const them = K.obj(from, st, 'object');
  if (!them.plural) return null;
  const host = K.np(b.from.filter, st, { det: 'a' });
  bind(st, a.as, { nouns: K.nounsOf({}), plural: false });
  bind(st, b.as, { nouns: K.nounsOf(b.from.filter), plural: false });
  return { clauses: [plain(`attach one of ${them.text} to ${host}`)], consumed: 3 };
}

/** The folds of std-combat-1, tried before the shared ones (render/fold.ts#foldAt). */
export function foldStdCombat1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return attachOneOfThemToA(list, i, st);
}

/**
 * `playerCantAttackYou` (CR 508.1b-c, 506.3, 611.2a; template eff.stdcombat1.player.cantAttackYouOrWalkers.dur): "they can't attack you or planeswalkers you control this
 * turn" (Sandswirl Wanderglyph), a lasting `effect` of two restrictions on the creatures one player controls: a `cant` attackPlayer of you and a `cant` attack of the
 * planeswalkers you control (a battle you protect stays attackable: Oracle does not name it). Also said with the creatures as the subject. Null for any other shape.
 */
export function playerCantAttackYou(effects: readonly StaticEffect[], duration: string, st: RenderState): string | null {
  const [a, b] = effects;
  if (effects.length !== 2 || a?.s !== 'restrict' || b?.s !== 'restrict' || a.mode !== 'cant' || b.mode !== 'cant' || a.action !== 'attackPlayer' || b.action !== 'attack') return null;
  const only = (r: typeof a, extra: string): boolean => Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action', extra].includes(k));
  if (!only(a, 'otherPlayer') || !only(b, 'other') || JSON.stringify(a.otherPlayer) !== '{"ref":"you"}' || JSON.stringify(b.other) !== '{"types":["Planeswalker"],"controller":"you"}') return null;
  if (JSON.stringify(a.subject) !== JSON.stringify(b.subject) || a.subject.ref !== 'each' || !('filter' in a.subject)) return null;
  const f = a.subject.filter;
  if (Object.keys(f).sort().join(',') !== 'controller,types' || JSON.stringify(f.types) !== '["Creature"]' || typeof f.controller !== 'object') return null;
  const p = K.player(f.controller as PlayerRef, st, 'subject');
  const tail = duration === '' ? '' : ` ${duration}`;
  // (family player-cant-attack-you: a player named before is also "they")
  const who = p.they === true ? alt(p.text, 'they') : p.text;
  return `${who} can't attack you or planeswalkers you control${tail}`;
}

const isEventRole = (r: unknown, role: string): boolean => JSON.stringify(r) === JSON.stringify({ ref: 'event', role });
const CMP_WORDS: Partial<Record<NumberCmp['op'], string>> = { '<=': 'less than or equal to', '>=': 'greater than or equal to', '<': 'less than', '>': 'greater than', '==': 'equal to' };

/**
 * `attachedToWithStat` (CR 603.2, 202.3; Eriette, the Beguiler): the permanent of "<an Aura> becomes attached to a nonland permanent an opponent controls with mana value
 * less than or equal to that Aura's mana value": the description of `by` with a mana value compared with the attached object's own (`{ref:'event', role:'subject'}`, the
 * parser's lower/ability.ts#resolveAttachAnaphors), the attached object named by its one subtype ("that Aura"). Null for any other description.
 */
export function attachedToWithStat(ev: Extract<EventPattern, { ev: 'becomes' }>, st: RenderState): string | null {
  const by = ev.by;
  const mv = by?.manaValue;
  if (by === undefined || mv === undefined || typeof mv.value !== 'object' || (mv.value as { q?: string }).q !== 'stat') return null;
  const q = mv.value as { q: 'stat'; stat: string; of: unknown };
  const words = CMP_WORDS[mv.op];
  const subs = ev.object?.subtypes ?? [];
  if (words === undefined || q.stat !== 'manaValue' || !isEventRole(q.of, 'subject') || Object.keys(q).length !== 3 || subs.length !== 1) return null;
  const rest: ObjectFilter = { ...by, manaValue: undefined };
  return `${K.np(rest, st, { det: 'a' })} with mana value ${words} that ${subs[0]!.toLowerCase()}'s mana value`;
}

/**
 * `gainControlWhileAttached` (CR 613.1b, 611.2b, 303.4; template eff.stdcombat1.gainControl.whileAuraAttached): after "<an Aura> becomes attached to <a permanent>", "gain
 * control of that permanent for as long as that Aura is attached to it": the controller change of the event's `object` while the event's `subject` stays attached to it.
 * Only after one attach event whose attached object is described by one subtype. Null for any other step.
 */
export function gainControlWhileAttached(effects: readonly StaticEffect[], d: Duration, st: RenderState): string | null {
  const [c] = effects;
  const trig = st.trigger ?? [];
  const ev = trig.length === 1 && trig[0]!.ev === 'becomes' && trig[0]!.what === 'attached' ? trig[0]! : undefined;
  const subs = ev?.ev === 'becomes' ? ev.object?.subtypes ?? [] : [];
  if (ev === undefined || subs.length !== 1 || effects.length !== 1 || c?.s !== 'continuous' || !isEventRole(c.affects, 'object')) return null;
  if (JSON.stringify(c.mods) !== JSON.stringify([{ layer: 2, controller: { ref: 'you' } }]) || Object.keys(c).length !== 3) return null;
  if (d.d !== 'whileObject' || d.as !== 'attached' || !isEventRole(d.object, 'subject') || !isEventRole(d.to, 'object') || d.counter !== undefined) return null;
  st.mentioned.add('e:object');
  st.mentioned.add('e:subject');
  return `gain control of that permanent for as long as that ${subs[0]!.toLowerCase()} is attached to it`;
}
