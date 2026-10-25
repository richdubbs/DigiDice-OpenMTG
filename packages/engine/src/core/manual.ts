/**
 * Manual resolution (docs/ARCHITECTURE.md, "Abilities are data" item 5): when the engine does not
 * understand a card's text, the controller is shown the text and adjusts the game by hand with
 * ManualOps. Never silently skipped. Every manual change is logged at level "manual".
 *
 * Operations are validated before anything is applied (core/validate.ts#validateManualOps), and a bad operation
 * is an IllegalAction (the whole answer is rejected), never an engine crash. The log never names a card that moves
 * from one hidden zone to another (CR 400.2): only the players who may know it see the name.
 */
import { MANUAL_MOVE_ZONES, type ManualOp } from '../types/decisions';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject } from '../types/state';
import { charsOfObject } from '../rules/characteristics';
import { compileCard } from '../cards/compile';
import type { OracleCard } from '../types/card';
import { addCounters } from '../rules/counters';
import { changeLife, givePoison } from '../rules/life';
import { dealDamage } from '../rules/damage';
import { addMana, manaText } from '../rules/mana';
import { canSee } from './view';
import { IllegalAction, type DecisionInput, type Game } from './game';
import { createToken, drawCards, moveObject, shuffleLibrary } from './zones';
import { ringControlChanged } from './ring-state';
import { randomInt } from '../rng';
import { copiableOrWhy } from '../statics/copy';
import { makeCtx } from '../effects/ctx';
import { proposeNested, runNested } from '../effects/nested';

/**
 * A random index in [0, n) from the game's own RNG (design 8.8 rule 2: "at random" is never Math.random), for choices made at random while a spell or ability
 * resolves. The interpreter (effects/) may not import the RNG module itself (design 5.4), so the helper lives here, with the other resolution primitives.
 */
export function randomIndex(g: Game, n: number): number {
  return randomInt(g.s.rng, n);
}

function need(g: Game, id: ObjectId): void {
  if (!g.maybeObj(id)) throw new IllegalAction(`Manual adjustment: there is no object ${id}.`);
}

const isHiddenZone = (o: GameObject): boolean => o.zone === 'hand' || o.zone === 'library';

/** The name of an object for the public log: hidden cards stay anonymous. */
function shownName(g: Game, id: ObjectId): string {
  const o = g.maybeObj(id);
  return o && isHiddenZone(o) ? 'a card' : g.nameOf(id);
}

/**
 * A permanent entered with rules text the engine cannot automate yet (static, triggered and non-mana activated
 * abilities arrive in milestones 5-6): say so in the log instead of silently ignoring it (docs/ARCHITECTURE.md).
 */
export function warnUnsupportedText(g: Game, id: ObjectId): void {
  const o = g.maybeObj(id);
  if (!o) return;
  const c = charsOfObject(g.s, o);
  for (const a of c.abilities) {
    if (a.def.kind !== 'manual') continue;
    g.log(`${c.name} has rules text the engine cannot automate yet; apply it by hand: ${a.def.text.split('\n').join(' ')}`, { rules: ['CR 113.1'], level: 'manual' });
  }
}

/** A manualResolve decision as the engine raises it, before `step` is added. */
export type ManualInput = Omit<Extract<DecisionInput, { kind: 'manualResolve' }>, 'step'>;

/**
 * MRE (C6 gap 6): resolve by hand in steps. The manualResolve decision is asked; its answer's ops are handed to `apply` at once; while the answer says
 * `continue: true` the decision is asked again (a new id, `step` = the steps applied so far) with the game as those ops left it, so the player sees what
 * they did (Brainstorm: draw three, look at them, then put two back, CR 608.2c). An answer without `continue` ends it. Under the re-execution model each
 * answer is replayed in order from the action's base state, so the steps are deterministic; the validator bounds them (MANUAL_MAX_STEPS). Returns every
 * op applied, in order.
 *
 * A cancellable decision (a manual static ability, a manual mana ability) stays cancellable only on its first prompt: once a step is applied the player may
 * have seen hidden information (a drawn card, the result of a shuffle), and an action can be taken back only if none was revealed (CR 733.1, CR 400.2), so
 * every re-issued prompt is raised with `cancellable: false`. Otherwise "draw, look, cancel" would peek at the library (and at the next shuffle, since the
 * RNG is reverted with the rest) as often as the player liked.
 */
export function chooseManualSteps(g: Game, input: ManualInput, apply: (ops: ManualOp[]) => void): ManualOp[] {
  const all: ManualOp[] = [];
  for (let step = 0; ; step++) {
    const ans = g.choose({ ...input, ...(step > 0 ? { step, ...(input.cancellable ? { cancellable: false } : {}) } : {}) });
    apply(ans.ops);
    all.push(...ans.ops);
    if (ans.continue !== true) return all;
  }
}

/** `chooseManualSteps` applying each step's ops with `applyManualOps` (logged, CR 400.2 for hidden cards). */
export function resolveManually(g: Game, player: PlayerId, input: ManualInput, sourceId?: ObjectId): ManualOp[] {
  return chooseManualSteps(g, input, (ops) => applyManualOps(g, player, ops, sourceId, input.subjectId));
}

/**
 * H1: an answer names objects as they were when it was given, but a `shuffle` earlier in the same answer makes every card of that library a new object
 * (core/zones.ts#shuffleLibrary). A later operation follows the card to its new id (`Game.renewedId`), so "shuffle, then put the found card on top"
 * (CR 701.24b) can be done by hand. Player ids and objects that still exist are left as they are.
 */
function followRenewed(g: Game, op: ManualOp): ManualOp {
  const r = (id: ObjectId): ObjectId => g.renewedId(id);
  switch (op.op) {
    case 'move': return { ...op, object: r(op.object), ...(op.attachTo !== undefined ? { attachTo: r(op.attachTo) } : {}) };
    case 'counters':
    case 'tap':
    case 'control':
    case 'discard':
    case 'tokenCopy': return { ...op, object: r(op.object) };
    case 'damage': return { ...op, target: r(op.target) };
    case 'attach': return { ...op, object: r(op.object), to: op.to === null ? null : r(op.to) };
    default: return op;
  }
}

/**
 * `sourceId`: the spell or ability being resolved (it can't be moved, CR 608.2n). `subjectId`: the object whose text is applied by hand when nothing resolves
 * (a static ability, counters a permanent enters with): the source of a delayed triggered ability a `tokenCopy` creates (CR 603.7d-g).
 */
export function applyManualOps(g: Game, player: PlayerId, ops: ManualOp[], sourceId?: ObjectId, subjectId?: ObjectId): void {
  const who = g.player(player).name;
  for (const given of ops) {
    const op = followRenewed(g, given);
    switch (op.op) {
      case 'move': {
        need(g, op.object);
        if (op.object === sourceId) throw new IllegalAction('That is the spell or ability being resolved right now; it leaves the stack by itself when you confirm.', ['CR 608.2n']);
        if (!MANUAL_MOVE_ZONES.includes(op.to)) throw new IllegalAction(`Manual adjustment: "${String(op.to)}" is not a zone you can move to.`);
        const from = g.obj(op.object);
        const name = g.nameOf(op.object);
        const owner = from.owner;
        const secret = isHiddenZone(from) && (op.to === 'hand' || op.to === 'libraryTop' || op.to === 'libraryBottom');
        const mayKnow = owner === player || canSee(g.s, from, player);
        const zone = op.to === 'libraryTop' || op.to === 'libraryBottom' ? 'library' : op.to;
        const moved = moveObject(g, op.object, zone, { cause: 'manual', ...(op.to === 'libraryBottom' ? { position: 'bottom' as const } : {}) });
        if (op.attachTo !== undefined && moved) {
          // CR 303.4f: an Aura that enters the battlefield without being cast enters attached to what its controller chooses; state-based actions look next.
          if (!g.s.players.some((p) => p.id === op.attachTo)) need(g, op.attachTo);
          g.obj(moved).attachedTo = op.attachTo;
        }
        const to = op.attachTo !== undefined && moved ? ` attached to ${g.s.players.some((p) => p.id === op.attachTo) ? g.player(op.attachTo).name : shownName(g, op.attachTo)}` : '';
        const known = `${who} moves ${name} to ${op.to}${to} by hand.`;
        if (secret) {
          // CR 400.2: a card moving from one hidden zone to another is not revealed to the other players.
          g.log(`${who} moves a card to ${op.to} by hand.`, {
            level: 'manual',
            privateText: { players: [...new Set([...(mayKnow ? [player] : []), owner])], text: known },
          });
        } else g.log(known, { level: 'manual' });
        break;
      }
      case 'life':
        g.player(op.player);
        changeLife(g, op.player, op.delta, 'manual adjustment', []);
        break;
      case 'counters': {
        if (g.s.players.some((p) => p.id === op.object)) {
          // CR 122.1f: poison counters on a player (ten lose the game, CR 704.5c).
          const p = g.player(op.object);
          if (op.delta > 0) givePoison(g, p.id, op.delta, 'manual adjustment');
          else if (op.delta < 0) {
            const lost = Math.min(p.poison, -op.delta);
            p.poison -= lost;
            if (lost > 0) g.emit({ type: 'countersChanged', target: p.id, counter: 'poison', delta: -lost });
          }
          g.log(`${who} changes poison counters on ${p.name} by ${op.delta} by hand. Poison: ${p.poison}.`, { rules: ['CR 122.1f'], level: 'manual' });
          break;
        }
        need(g, op.object);
        addCounters(g, op.object, op.counter, op.delta);
        g.log(`${who} changes ${op.counter} counters on ${shownName(g, op.object)} by ${op.delta} by hand.`, { level: 'manual' });
        break;
      }
      case 'token': {
        g.player(op.player);
        const def = compileCard({
          name: op.name, layout: 'token', type_line: op.typeLine, oracle_text: op.text ?? '', colors: op.colors ?? [],
          ...(op.power !== undefined ? { power: op.power } : {}), ...(op.toughness !== undefined ? { toughness: op.toughness } : {}),
        } as OracleCard);
        createToken(g, def, op.player, op.tapped === true ? { tapped: true } : {});
        g.log(`${who} creates a ${op.name} token under ${g.player(op.player).name}'s control by hand.`, { rules: ['CR 111.1'], level: 'manual' });
        break;
      }
      case 'tap': {
        need(g, op.object);
        g.obj(op.object).tapped = op.tapped;
        g.emit(op.tapped ? { type: 'tapped', objectId: op.object } : { type: 'untapped', objectId: op.object });
        g.log(`${who} ${op.tapped ? 'taps' : 'untaps'} ${shownName(g, op.object)} by hand.`, { level: 'manual' });
        break;
      }
      case 'draw':
        g.player(op.player);
        drawCards(g, op.player, op.count);
        break;
      case 'shuffle':
        g.player(op.player);
        shuffleLibrary(g, op.player);
        g.log(`${g.player(op.player).name} shuffles their library by hand.`, { level: 'manual' });
        break;
      case 'control': {
        need(g, op.object);
        g.player(op.player);
        const o = g.obj(op.object);
        o.controller = op.player;
        if (o.zone === 'battlefield') ringControlChanged(g.s, o.id, op.player); // MX3, CR 701.54a: the Ring-bearer designation ends
        delete o.baseController; // MX2: control given by hand is the new starting point of layer 2 (core/control.ts)
        o.controlledSinceTurn = g.s.turn.number;
        o.timestamp = g.newTimestamp();
        g.log(`${who} gives control of ${shownName(g, op.object)} to ${g.player(op.player).name} by hand.`, { level: 'manual' });
        break;
      }
      case 'damage': {
        // The resolving spell or ability deals the damage, so its keywords (deathtouch, lifelink, infect, wither) and protection apply (CR 120).
        const target = op.target;
        if (!g.s.players.some((p) => p.id === target)) need(g, target);
        g.log(`${who} deals ${op.amount} damage to ${g.s.players.some((p) => p.id === target) ? g.player(target).name : shownName(g, target)} by hand.`, { level: 'manual' });
        dealDamage(g, sourceId ?? null, target, op.amount);
        break;
      }
      case 'attach': {
        need(g, op.object);
        const o = g.obj(op.object);
        if (op.to === null) {
          delete o.attachedTo;
          g.log(`${who} unattaches ${shownName(g, op.object)} by hand.`, { level: 'manual' });
          break;
        }
        if (!g.s.players.some((p) => p.id === op.to)) need(g, op.to);
        if (op.to === op.object) throw new IllegalAction('Nothing can be attached to itself.', ['CR 303.4d', 'CR 301.5c']);
        o.attachedTo = op.to;
        o.timestamp = g.newTimestamp();
        g.log(`${who} attaches ${shownName(g, op.object)} to ${g.s.players.some((p) => p.id === op.to) ? g.player(op.to).name : shownName(g, op.to)} by hand.`, { level: 'manual' });
        break;
      }
      case 'mana': {
        // CR 106.3, 106.4: spells and non-mana abilities that add mana put it in the pool of the player the text names.
        g.player(op.player);
        addMana(g, op.player, op.types, undefined, op.snow === true);
        g.log(`${who} adds ${manaText(op.types)} to ${g.player(op.player).name}'s mana pool by hand.`, { rules: ['CR 106.3'], level: 'manual' });
        break;
      }
      case 'discard': {
        need(g, op.object);
        const o = g.obj(op.object);
        if (o.zone !== 'hand') throw new IllegalAction('Only a card in a hand can be discarded.', ['CR 701.9a']);
        const owner = g.player(o.owner).name;
        const name = g.nameOf(op.object);
        // CR 701.9a, 614.1: a discard through the proposal pipeline, as a card's own discard (effects/handlers/cards-util.ts#moveAsAction), so a replacement
        // such as madness (CR 702.35a) can change where it goes and discard triggers see it
        proposeNested(g, { ev: 'zoneChange', object: { id: o.id, zone: 'hand' }, from: 'hand', to: 'graveyard', destination: { cause: 'discard', causedBy: player } });
        g.log(`${owner} discards ${name} by hand.`, { rules: ['CR 701.9a'], level: 'manual' });
        break;
      }
      case 'tokenCopy': {
        need(g, op.object);
        g.player(op.player);
        const o = g.obj(op.object);
        const name = g.nameOf(op.object);
        if (o.zone !== 'battlefield') throw new IllegalAction('Only a permanent on the battlefield can be copied this way.', ['CR 707.2']);
        // CR 603.7d, 701.21a: the delayed trigger is the resolving player's, who sacrifices only a permanent they control
        if (op.atNextEndStep === 'sacrifice' && op.player !== player) throw new IllegalAction("A token another player gets can't be sacrificed by you at the next end step; choose to exile it instead.", ['CR 603.7d', 'CR 701.21a']);
        // What the copy step would hand back to be done by hand (effects/handlers/tokens-copy.ts) is refused here with its reason, so the player creates the
        // token with a `token` adjustment instead of meeting a second, unexplained prompt
        if (o.phasedOut) throw new IllegalAction(`${name} is phased out: it is treated as though it doesn't exist.`, ['CR 702.26b']);
        const copiable = copiableOrWhy(g.s, o);
        if ('reason' in copiable) throw new IllegalAction(`A token copy of ${name} can't be made automatically (${copiable.reason}): create it with "Create a token" instead.`, ['CR 707.2']);
        const def = g.s.defs[o.defId];
        if (op.haste === true && def && (def.layout === 'flip' || (def.faces.length === 2 && ['transform', 'modal_dfc', 'double_faced_token'].includes(def.layout)))) {
          throw new IllegalAction(`A token copy of ${name} with haste can't be made automatically (a double-faced or flip card with an exception, CR 707.8a, 707.9): create it with "Create a token" instead.`, ['CR 707.8a', 'CR 707.9']);
        }
        // The steps a card's own text compiles to (Kiki-Jiki, Mirror Breaker; Saheeli Rai): `copy` makes the token with the copiable values and the exception
        // (CR 707.9a) for `op.player`, `delay` the delayed triggered ability of the next end step (CR 603.7), controlled by the resolving player and with the
        // resolving spell or ability, else the object whose text is applied by hand, else the copied permanent, as its source (CR 603.7d-g)
        const anchor = (sourceId !== undefined ? g.maybeObj(sourceId) : undefined) ?? (subjectId !== undefined ? g.maybeObj(subjectId) : undefined) ?? o;
        const cx = makeCtx(g, anchor, { targets: [], steps: [] });
        cx.controller = player;
        cx.bindings.set('copied', { objects: [{ id: o.id, zone: 'battlefield' }], players: [], snapshots: {} });
        runNested(cx, [{
          op: 'copy', what: { ref: 'bound', name: 'copied' }, result: 'token', who: { ref: 'fixed', players: [op.player] }, as: 'them',
          except: op.haste === true ? [{ layer: 6, add: [{ kind: 'keyword', keyword: 'haste', text: 'Haste' }] }] : [],
          span: `Create a token that's a copy of ${name}${op.haste === true ? ', except it has haste' : ''}.`,
        }]);
        // Logged and given its end step only when a token was made (a replacement effect, or a player who left the game, can stop it)
        const made = cx.bindings.get('them')?.objects.length ?? 0;
        if (made === 0) {
          g.log(`${who} tries to create a token that's a copy of ${name} by hand, but no token is created.`, { rules: ['CR 707.2', 'CR 111.1'], level: 'manual' });
          break;
        }
        const them = { ref: 'bound', name: 'them' } as const;
        if (op.atNextEndStep !== undefined) {
          runNested(cx, [{ op: 'delay', when: { at: 'step', step: 'end', next: true }, capture: ['them'], do: [op.atNextEndStep === 'sacrifice' ? { op: 'sacrifice', what: them } : { op: 'move', what: them, to: { zone: 'exile' } }] }]);
        }
        const later = op.atNextEndStep === 'sacrifice' ? ' It is sacrificed at the beginning of the next end step.' : op.atNextEndStep === 'exile' ? ' It is exiled at the beginning of the next end step.' : '';
        g.log(`${who} creates a token that's a copy of ${name}${op.haste === true ? ', with haste,' : ''} under ${g.player(op.player).name}'s control by hand.${later}`, {
          rules: ['CR 707.2', 'CR 111.1', ...(op.haste === true ? ['CR 702.10'] : []), ...(later ? ['CR 603.7'] : [])],
          level: 'manual',
        });
        break;
      }
      case 'note':
        g.log(`${who}: ${op.text}`, { level: 'manual' });
        break;
    }
  }
}
