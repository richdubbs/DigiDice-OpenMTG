/**
 * Helpers for the milestone 4 scenario tests: drive a real game through combat with real actions and answers.
 * Boards are built with the milestone 3 `scenario` helper (real fixture cards placed directly into zones).
 */
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type Step } from '../../src/index';
import { clone } from '../../src/util/clone';
import { act, answer, find, findAll, pass, scenario, type ScenarioOptions } from '../m3/scenario';

export { act, answer, find, findAll, pass, scenario };
export type { ScenarioOptions };

/** Pass priority until `done` is true; stops (and fails) if a decision other than priority comes up first. */
export function passUntil(s: GameState, done: (s: GameState) => boolean, what: string, max = 60): GameState {
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending!.kind !== 'priority') throw new Error(`Waiting for ${what} but a ${s.pending!.kind} decision is pending: ${s.pending!.prompt}`);
    s = pass(s);
  }
  throw new Error(`Never reached ${what}`);
}

/** From the main phase: pass until the active player is asked to declare attackers. */
export const toDeclareAttackers = (s: GameState): GameState => passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the declare attackers decision');

export function declareAttackers(s: GameState, attacks: [ObjectId, (PlayerId | ObjectId)?][]): GameState {
  const defender = (s.players.find((p) => p.id !== s.turn.activePlayer) ?? s.players[0]!).id;
  return answer(s, { kind: 'declareAttackers', attacks: attacks.map(([attacker, d]) => ({ attacker, defender: d ?? defender })) });
}

/** After attackers are declared: pass until the defending player is asked to declare blockers. */
export const toDeclareBlockers = (s: GameState): GameState => passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');

export const declareBlockers = (s: GameState, blocks: [ObjectId, ObjectId][]): GameState =>
  answer(s, { kind: 'declareBlockers', blocks: blocks.map(([blocker, attacker]) => ({ blocker, attacker })) });

/** Pass priority until the given step of the current turn has begun (stops at any decision; the caller answers it). */
export const toStep = (s: GameState, step: Step): GameState => passUntil(s, (x) => x.turn.step === step && x.pending?.kind === 'priority', `the ${step} step`);

/** Attack with the given creatures, declare no blocks, and pass to the end of combat. Returns the state at the end of combat step. */
export function attackUnblocked(s: GameState, attackers: ObjectId[]): GameState {
  s = declareAttackers(toDeclareAttackers(s), attackers.map((a) => [a] as [ObjectId]));
  s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
  if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
  return toStep(s, 'endCombat');
}

/** Mutate a copy of the state (test setup only). */
export function tweak(s: GameState, f: (s: GameState) => void): GameState {
  const t = clone(s);
  f(t);
  return t;
}

export const chars = (s: GameState, id: ObjectId) => s.objects[id]!;
export const inGraveyard = (s: GameState, name: string, owner: PlayerId): boolean => s.zones.graveyard[owner]!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
export const onBattlefield = (s: GameState, name: string, owner?: PlayerId): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name && (!owner || s.objects[id]!.controller === owner));
export const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
export const poisonOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.poison;
export const logHas = (s: GameState, re: RegExp, rule?: string): boolean => s.log.some((l) => re.test(l.text) && (!rule || l.rules?.includes(rule)));

/** A synthetic creature for rules no fixture card shows on its own (deathtouch + trample, ...). */
export function creature(name: string, pt: [string, string], text: string, cost = '{1}', type = 'Creature — Test'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, power: pt[0], toughness: pt[1], oracle_text: text, colors: [] } as OracleCard);
}

export const answerAll = (s: GameState, answers: DecisionAnswer[]): GameState => answers.reduce((t, a) => answer(t, a), s);

/** The legal "pass" etc. of the player with priority. */
export const legalOf = (s: GameState) => legalActions(s, s.pending!.player);

export type Assign = { id: string; amount: number }[];
export interface CombatPlan {
  attack: [ObjectId, (PlayerId | ObjectId)?][];
  block?: [ObjectId, ObjectId][];
  /** Answers to assignDamage decisions, by the creature whose damage it is (a function may compute them from the decision). */
  assign?: Record<ObjectId, Assign | ((d: Extract<NonNullable<GameState['pending']>, { kind: 'assignDamage' }>) => Assign)>;
  /** Stop at this step instead of the end of combat (priority is pending there). */
  until?: Step;
}

/** Declare attackers, blockers and damage assignments, pass priority through combat, and stop at the end of combat step (priority). */
export function runCombat(s0: GameState, plan: CombatPlan): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), plan.attack);
  const stop = plan.until ?? 'endCombat';
  for (let i = 0; i < 80; i++) {
    const d = s.pending;
    if (s.result) return s;
    if (!d) throw new Error('no decision');
    if (d.kind === 'declareBlockers') s = declareBlockers(s, plan.block ?? []);
    else if (d.kind === 'assignDamage') {
      const a = plan.assign?.[d.attacker];
      if (!a) throw new Error(`No damage assignment given for ${d.attacker}: ${d.prompt}`);
      s = answer(s, { kind: 'assignDamage', amounts: typeof a === 'function' ? a(d) : a });
    } else if (d.kind === 'priority') {
      if (s.turn.step === stop) return s;
      s = pass(s);
    } else throw new Error(`Unexpected ${d.kind} decision: ${d.prompt}`);
  }
  throw new Error('combat did not finish');
}

/**
 * Alice (p1) is at main1 with the given extra cards; after her attack Bob casts Lightning Bolt: used to kill a blocker mid-combat. Returns after Bolt resolved.
 * WP18: Lightning Bolt is automated by the compile pipeline: its target is chosen as it is cast (CR 601.2c) and it deals 3 damage when it resolves. A Bolt
 * compiled as manual text (`scenario(..., { manual: ['Lightning Bolt'] })`) is still resolved by hand with `amount` damage.
 */
export function boltDuringCombat(s: GameState, caster: PlayerId, target: ObjectId, amount = 3): GameState {
  if (s.pending!.player !== caster) s = pass(s);
  const bolt = find(s, 'Lightning Bolt', 'hand', caster);
  s = act(s, { type: 'cast', player: caster, card: bolt });
  if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: target }] });
  s = answer(s, { kind: 'payCost', auto: true });
  s = pass(s);
  s = pass(s);
  if (s.pending?.kind !== 'manualResolve') return s;
  return answer(s, { kind: 'manualResolve', ops: [{ op: 'damage', target, amount }] });
}
