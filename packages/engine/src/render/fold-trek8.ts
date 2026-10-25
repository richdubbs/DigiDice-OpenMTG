/**
 * trek-8: the readings of its templates (parser/templates/zz-cloud/trek-8.json) that need words of their own, called from render/fold.ts#foldAt and
 * render/steps-lasting.ts.
 *
 * `playerCantAttack` ("Target player can't attack this turn", "they can't attack this turn"; CR 508.1, 508.4, 611.2a): a player who can't attack is a player none of
 * whose creatures can be declared as an attacker, so the engine says it as the restriction on every creature the player controls (the wording of
 * "creatures that player controls can't attack this turn", templates eff.stdry4.each.cant.attack.dur); both wordings are readings of that one effect. A creature
 * put onto the battlefield attacking is not declared as an attacker (CR 508.4), which "can't attack" does not stop in either wording.
 *
 * `playerCantAttackThenYouPut` ("If they do, they can't attack this turn and you put a peace counter on ~."): another player's restriction followed by an
 * instruction of the controller, which Oracle says with "you" in front of its verb to change the subject (CR 608.2c); the instruction has no performer of its own,
 * the controller of the ability does it.
 */
import type { Duration, EffectStep, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { lasting } from './stat';
import { withVariants, type RenderState } from './state';
import { alt } from './text';

type EffectOf = Extract<EffectStep, { op: 'effect' }>;

/** The player and the duration of an `effect` step that is exactly "every creature this player controls can't attack", nothing else. */
export function playerCantAttack(s: EffectStep | undefined): { who: PlayerRef; duration: Duration } | null {
  if (s?.op !== 'effect' || s.guard !== undefined || s.as !== undefined || s.effects.length !== 1) return null;
  const e = s.effects[0]!;
  if (e.s !== 'restrict' || e.mode !== 'cant' || e.action !== 'attack' || Object.keys(e).length !== 4) return null;
  const sj = e.subject;
  if (sj.ref !== 'each' || !('filter' in sj)) return null;
  const f = sj.filter as { types?: string[]; controller?: unknown } & Record<string, unknown>;
  if (Object.keys(f).length !== 2 || JSON.stringify(f.types) !== '["Creature"]' || typeof f.controller !== 'object' || f.controller === null) return null;
  const who = f.controller as PlayerRef;
  if (who.ref === 'each' || who.ref === 'you') return null; // one player: "they", "that player", "target player"
  return { who, duration: (s as EffectOf).duration };
}

/** "<player> can't attack this turn" (and "this turn, <player> can't attack"). */
export function playerCantAttackText(who: PlayerRef, duration: Duration, st: RenderState): string {
  const subj = K.player(who, st, 'subject');
  const say = (text: string): string => lasting(`${text} can't attack`, duration, st);
  return subj.they === true ? alt(say(subj.text), say('they')) : say(subj.text);
}

export function foldTrek8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const pca = playerCantAttack(a);
  if (pca === null || b?.op !== 'putCounters' || b.guard !== undefined || b.as !== undefined) return null;
  const [folded, apart] = withVariants(st, [
    (v) => `${playerCantAttackText(pca.who, pca.duration, v)} and you ${K.clause(b, v).imp}`,
    // the two instructions written apart, as without this fold
    (v) => {
      const first = alt(K.clause(a!, v).sub, playerCantAttackText(pca.who, pca.duration, v));
      return `${first}${alt('. ', '. then ')}${K.clause(b, v).imp}`; // (sentences: "and" or a comma would give the counter to the player the restriction names)
    },
  ]);
  return { clauses: [plain(alt(folded!, apart!))], consumed: 2 };
}
