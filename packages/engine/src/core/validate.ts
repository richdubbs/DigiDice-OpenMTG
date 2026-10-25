/**
 * Validation of decision answers. Every answer is checked against the options the engine
 * offered, so a UI or bot can never make an illegal choice (CR 733: illegal actions are
 * rejected and reversed).
 */
import type { GameState } from '../types/state';
import { MANUAL_MAX_STEPS, MANUAL_MOVE_ZONES, type Decision, type DecisionAnswer } from '../types/decisions';
import { parseTypeLine } from '../cards/faces'; // WP18: from the face module, so the type-only graph of types/ is not widened to the compile pipeline
import { attackerRejection, blockRejection } from '../rules/combat-explain';
import { IllegalAnswer } from './errors';

/**
 * Every decision kind `validateAnswer` accepts an answer for (capabilities `decision:<kind>`, design 5.2). The `Record` type makes the list exhaustive:
 * a new decision kind does not compile until it is listed here, and then needs a `case` below.
 */
const DECISION_KIND_TABLE: Record<Decision['kind'], true> = {
  priority: true, playFirst: true, mulligan: true, chooseObjects: true, yesNo: true, chooseOption: true, chooseNumber: true, chooseColor: true,
  order: true, chooseTargets: true, payCost: true, declareAttackers: true, declareBlockers: true, assignDamage: true, chooseReplacement: true,
  manualResolve: true, chooseDivision: true, chooseName: true,
  commanderZone: true, // M11-0 (m11 design 4.3): CR 903.9a-b
};
export const DECISION_KINDS: readonly string[] = Object.keys(DECISION_KIND_TABLE);

const MANA_TYPES = new Set(['W', 'U', 'B', 'R', 'G', 'C']);
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function distinct<T>(xs: readonly T[]): boolean {
  return new Set(xs).size === xs.length;
}

/** FAST5 T66: does choosing `ids` keep the decision's `limit` (a total over the objects chosen together; always true without one)? */
export function chooseObjectsLimitHolds(d: Pick<Extract<Decision, { kind: 'chooseObjects' }>, 'limit'>, ids: readonly string[]): boolean {
  const lim = d.limit;
  if (lim === undefined) return true;
  const total = ids.reduce((n, id) => n + (lim.values[id] ?? 0), 0);
  switch (lim.op) {
    case '<=': return total <= lim.value;
    case '>=': return total >= lim.value;
    case '==': return total === lim.value;
    case '!=': return total !== lim.value;
    case '<': return total < lim.value;
    case '>': return total > lim.value;
  }
}

export function validateAnswer(s: GameState, d: Decision, a: DecisionAnswer): void {
  const fail = (msg: string, rules: string[] = d.rules ?? []): never => {
    throw new IllegalAnswer(msg, rules); // AF1: an answer error, never read as "no legal choice" (triggers/stack.ts, CR 603.3d)
  };
  if (a.kind !== d.kind) fail(`This decision needs a "${d.kind}" answer.`);
  switch (d.kind) {
    case 'priority':
      fail('Priority is answered with a priority action (pass, cast, activate, play a land).', ['CR 117.1']);
      break;
    case 'playFirst': {
      const ans = a as Extract<DecisionAnswer, { kind: 'playFirst' }>;
      if (!d.options.includes(ans.player)) fail('That player is not in this game.', ['CR 103.1']);
      break;
    }
    case 'mulligan': {
      const ans = a as Extract<DecisionAnswer, { kind: 'mulligan' }>;
      if (typeof ans.keep !== 'boolean') fail('Answer keep or mulligan.', ['CR 103.5']);
      if (!ans.keep && d.handSize <= 0) fail('You cannot mulligan to fewer than zero cards.', ['CR 103.5']);
      break;
    }
    case 'chooseObjects': {
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseObjects' }>;
      if (!Array.isArray(ans.ids) || !distinct(ans.ids)) fail('Choose each object at most once.');
      if (ans.ids.length < d.min || ans.ids.length > d.max) {
        fail(d.min === d.max ? `Choose exactly ${d.min}.` : `Choose between ${d.min} and ${d.max}.`);
      }
      for (const id of ans.ids) if (!d.options.includes(id)) fail('That object is not a legal choice.');
      if (!chooseObjectsLimitHolds(d, ans.ids)) fail(`Those choices break the limit: total ${d.limit!.stat === 'manaValue' ? 'mana value' : d.limit!.stat} must be ${d.limit!.op} ${d.limit!.value}.`, ['CR 608.2d', ...(d.rules ?? [])]);
      break;
    }
    case 'yesNo': {
      const ans = a as Extract<DecisionAnswer, { kind: 'yesNo' }>;
      if (typeof ans.yes !== 'boolean') fail('Answer yes or no.');
      break;
    }
    case 'chooseOption': {
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseOption' }>;
      if (!Array.isArray(ans.ids)) fail('Choose an option.');
      if (!d.allowRepeat && !distinct(ans.ids)) fail('Each option may be chosen only once.', ['CR 700.2']);
      if (ans.ids.length < d.min || ans.ids.length > d.max) {
        fail(d.min === d.max ? `Choose exactly ${d.min}.` : `Choose between ${d.min} and ${d.max}.`);
      }
      for (const id of ans.ids) {
        const opt = d.options.find((o) => o.id === id);
        if (!opt) fail('That is not one of the options.');
        if (opt?.disabled) fail(`That option can't be chosen: ${opt.disabled}`);
      }
      break;
    }
    case 'chooseNumber': {
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseNumber' }>;
      if (!Number.isInteger(ans.n) || ans.n < d.min || ans.n > d.max) fail(`Choose a whole number from ${d.min} to ${d.max}.`);
      break;
    }
    case 'chooseColor': {
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseColor' }>;
      if (!d.options.includes(ans.color)) fail('That color is not an option.');
      break;
    }
    case 'order': {
      const ans = a as Extract<DecisionAnswer, { kind: 'order' }>;
      const ids = d.items.map((i) => i.id);
      if (!Array.isArray(ans.ids) || ans.ids.length !== ids.length || !distinct(ans.ids) || ans.ids.some((x) => !ids.includes(x))) {
        fail('Put every item in order exactly once.');
      }
      break;
    }
    case 'chooseTargets': {
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseTargets' }>;
      if (!Array.isArray(ans.targets)) fail('Choose targets.', ['CR 601.2c']);
      if (ans.targets.length < d.min || ans.targets.length > d.max) {
        fail(d.min === d.max ? `Choose exactly ${d.min} target(s).` : `Choose between ${d.min} and ${d.max} targets.`, ['CR 601.2c']);
      }
      const keys = ans.targets.map((t) => `${t.kind}:${t.id}`);
      if (!distinct(keys)) fail('The same object or player can be chosen only once for each instance of the word "target".', ['CR 115.3']);
      for (const t of ans.targets) {
        const ok = t.kind === 'object' ? d.objects.includes(t.id) : d.players.includes(t.id);
        if (!ok) fail(`That is not a legal target for "${d.targetText}".`, ['CR 115.1', 'CR 601.2c']);
      }
      break;
    }
    case 'payCost': {
      const ans = a as Extract<DecisionAnswer, { kind: 'payCost' }>;
      if (typeof ans.auto !== 'boolean') fail('Say whether to pay automatically (auto: true) or list the mana abilities to activate (auto: false).', ['CR 601.2h']);
      if (ans.auto && !d.autoPayable) fail('Automatic payment is not possible with the available mana. Choose sources manually or cancel.', ['CR 601.2h']);
      if (!ans.auto) {
        if (!Array.isArray(ans.activations)) fail('A manual payment needs the list of mana abilities to activate (it may be empty).', ['CR 601.2g']);
        for (const act of ans.activations) {
          if (!act || !isStr(act.objectId) || !isStr(act.abilityKey) || (act.color !== undefined && !MANA_TYPES.has(act.color))) {
            fail('Each activation needs an objectId, an abilityKey and optionally a mana color.', ['CR 601.2g']);
          }
        }
        for (const [name, list] of [['lifeForPhyrexian', ans.lifeForPhyrexian], ['spendPool', ans.spendPool]] as const) {
          if (list === undefined) continue;
          if (!Array.isArray(list) || !list.every((n) => isInt(n) && n >= 0) || !distinct(list)) fail(`${name} must be a list of distinct non-negative whole numbers.`, ['CR 601.2h']);
        }
      }
      break;
    }
    case 'declareAttackers': {
      const ans = a as Extract<DecisionAnswer, { kind: 'declareAttackers' }>;
      if (!Array.isArray(ans.attacks)) fail('Declare the attacks (it may be an empty list).', ['CR 508.1']);
      const seen = new Set<string>();
      for (const at of ans.attacks) {
        if (!isRecord(at) || !isStr(at.attacker) || !isStr(at.defender)) fail('Each attack needs an attacker and what it attacks.', ['CR 508.1']);
        const c = d.candidates.find((x) => x.id === at.attacker);
        if (!c) {
          const why = attackerRejection(s, d.player, at.attacker);
          fail(why.message, why.rules);
        }
        if (seen.has(at.attacker)) fail('A creature can attack only once.', ['CR 508.1']);
        seen.add(at.attacker);
        if (c && !c.defenders.includes(at.defender)) fail('That creature cannot attack that player or permanent.', ['CR 508.1b']);
      }
      break;
    }
    case 'declareBlockers': {
      const ans = a as Extract<DecisionAnswer, { kind: 'declareBlockers' }>;
      if (!Array.isArray(ans.blocks)) fail('Declare the blocks (it may be an empty list).', ['CR 509.1']);
      const count = new Map<string, number>();
      for (const b of ans.blocks) {
        if (!isRecord(b) || !isStr(b.blocker) || !isStr(b.attacker)) fail('Each block needs a blocking creature and the attacker it blocks.', ['CR 509.1']);
        const c = d.candidates.find((x) => x.id === b.blocker);
        if (!c || !c.attackers.includes(b.attacker)) {
          const why = blockRejection(s, d.player, b.blocker, b.attacker);
          fail(why.message, c ? [...why.rules, 'CR 509.1b'] : why.rules);
        }
        const n = (count.get(b.blocker) ?? 0) + 1;
        count.set(b.blocker, n);
        if (c && n > c.maxBlocks) fail('That creature cannot block that many attackers.', ['CR 509.1a']);
      }
      if (!distinct(ans.blocks.map((b) => `${b.blocker}>${b.attacker}`))) fail('Duplicate block.');
      break;
    }
    case 'assignDamage': {
      const ans = a as Extract<DecisionAnswer, { kind: 'assignDamage' }>;
      if (!Array.isArray(ans.amounts)) fail('Assign damage to the recipients.', ['CR 510.1']);
      if (!ans.amounts.every((x) => isRecord(x) && isStr(x.id))) fail('Each damage amount needs a recipient and an amount.', ['CR 510.1']);
      if (!ans.amounts.every((x) => isInt(x.amount) && x.amount >= 0)) fail('Damage amounts must be whole numbers.', ['CR 510.1']);
      const total = ans.amounts.reduce((n, x) => n + x.amount, 0);
      if (!distinct(ans.amounts.map((x) => x.id))) fail('Give each recipient one amount.', ['CR 510.1c']);
      for (const x of ans.amounts) if (!d.recipients.some((r) => r.id === x.id)) fail('That creature or player cannot be assigned this damage.', ['CR 510.1c', 'CR 510.1d']);
      if (total !== d.amount) fail(`Assign exactly ${d.amount} damage.`, ['CR 510.1']);
      if (d.canTrample) {
        // CR 702.19b: nothing may be assigned to what the creature attacks until every blocker is assigned lethal damage.
        const given = (id: string): number => ans.amounts.find((x) => x.id === id)?.amount ?? 0;
        const target = d.recipients.find((r) => r.trampleTarget);
        if (target && given(target.id) > 0) {
          for (const r of d.recipients) {
            if (!r.trampleTarget && given(r.id) < r.lethal) fail('With trample, assign lethal damage to every blocker before assigning damage to the player or permanent it attacks.', ['CR 702.19b']);
          }
        }
      }
      break;
    }
    case 'chooseReplacement': {
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseReplacement' }>;
      if (!d.options.some((o) => o.id === ans.id)) fail('Choose one of the listed effects.', ['CR 616.1']);
      break;
    }
    case 'manualResolve': {
      const ans = a as Extract<DecisionAnswer, { kind: 'manualResolve' }>;
      if (!Array.isArray(ans.ops)) fail('Provide the list of manual adjustments (it may be empty).');
      // MRE (C6 gap 6): "Apply now" applies the ops and asks again; it must change something, and a resolution takes at most MANUAL_MAX_STEPS prompts.
      if (ans.continue !== undefined && typeof ans.continue !== 'boolean') fail('"continue" must be true or false.');
      if (ans.continue === true && ans.ops.length === 0) fail('Add at least one adjustment before applying it, or confirm to finish.');
      if (ans.continue === true && (d.step ?? 0) >= MANUAL_MAX_STEPS - 1) fail(`This resolution has taken ${MANUAL_MAX_STEPS} steps; apply the rest and confirm.`);
      validateManualOps(s, d.resolvingId, ans.ops, fail, d.player);
      break;
    }
    case 'chooseDivision': {
      // CR 601.2d: the amounts are parallel to the announced targets, each target gets at least 1, and they add up to the total.
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseDivision' }>;
      if (!Array.isArray(ans.amounts) || ans.amounts.length !== d.targets.length) fail(`Give one amount for each of the ${d.targets.length} target(s).`, ['CR 601.2d']);
      if (!ans.amounts.every((n) => isInt(n) && n >= 1)) fail(`Each target must be assigned at least 1 (${d.what}).`, ['CR 601.2d']);
      const sum = ans.amounts.reduce((n, x) => n + x, 0);
      if (sum !== d.total) fail(`Divide exactly ${d.total} (${d.what}) among the targets; those amounts add up to ${sum}.`, ['CR 601.2d']);
      break;
    }
    case 'chooseName': {
      // CR 607.2d, 608.2d: a card name, creature type, card type or land type; types come from a closed list, card names are checked by the caller's index.
      const ans = a as Extract<DecisionAnswer, { kind: 'chooseName' }>;
      if (!isStr(ans.name) || ans.name.trim() === '' || ans.name.length > 200) fail('Name something (a non-empty name of at most 200 characters).');
      if (d.options && !d.options.includes(ans.name)) fail(`"${ans.name}" is not one of the options.`);
      // std-rx28 (CR 201.3): "a land card name" / "a nonland card name": a card of this game whose face has that name must be of that kind (a land face or not); a name
      // no card of the game has is still a card name, and no object of the game has it
      if (d.cardKind !== undefined) {
        const faces = Object.values(s.defs).flatMap((def) => def.faces.filter((f) => f.name === ans.name));
        const fits = faces.some((f) => f.types.includes('Land') === (d.cardKind === 'land'));
        if (faces.length > 0 && !fits) fail(`Name ${d.cardKind === 'land' ? 'a land card' : 'a nonland card'}: "${ans.name}" is ${d.cardKind === 'land' ? 'not a land card' : 'a land card'}.`, ['CR 201.3']);
      }
      break;
    }
    case 'commanderZone': {
      // M11-0: CR 903.9a-b, 704.6d: the owner may put the commander into the command zone (yes) or not (no)
      const ans = a as Extract<DecisionAnswer, { kind: 'commanderZone' }>;
      if (typeof ans.command !== 'boolean') fail('Answer whether the commander goes to the command zone.', [`CR ${d.rule}`]);
      break;
    }
  }
}

/**
 * Structure and references of manual adjustments: a bad operation is rejected with an explanation instead of crashing the
 * engine. The resolving spell or ability itself can't be moved (it leaves the stack when the answer is confirmed, CR 608.2n).
 */
function validateManualOps(s: GameState, resolvingId: string | undefined, ops: readonly unknown[], fail: (msg: string, rules?: string[]) => never, resolver?: string): void {
  const hasObject = (id: unknown): boolean => isStr(id) && s.objects[id] !== undefined;
  const hasPlayer = (id: unknown): boolean => isStr(id) && s.players.some((p) => p.id === id);
  ops.forEach((raw, i) => {
    const op = raw as Record<string, unknown> | null;
    const at = `Manual adjustment ${i + 1}`;
    if (!op || typeof op !== 'object') return fail(`${at} is not an operation.`);
    switch (op.op) {
      case 'move':
        if (!hasObject(op.object)) return fail(`${at}: there is no such object.`);
        if (op.object === resolvingId) return fail(`${at}: that is the spell or ability being resolved right now; it leaves the stack by itself when you confirm.`, ['CR 608.2n']);
        if (!isStr(op.to) || !MANUAL_MOVE_ZONES.includes(op.to)) return fail(`${at}: "${String(op.to)}" is not a zone you can move to (${MANUAL_MOVE_ZONES.join(', ')}).`);
        if (op.attachTo !== undefined) {
          if (op.to !== 'battlefield') return fail(`${at}: attachTo only goes with a move to the battlefield (an Aura enters attached, CR 303.4f).`, ['CR 303.4f']);
          if (!(hasObject(op.attachTo) || hasPlayer(op.attachTo))) return fail(`${at}: attachTo must be an object or a player.`, ['CR 303.4f']);
          if (op.attachTo === op.object) return fail(`${at}: nothing can be attached to itself.`, ['CR 303.4d', 'CR 301.5c']);
        }
        return;
      case 'life':
        if (!hasPlayer(op.player) || !isInt(op.delta)) return fail(`${at}: a life change needs a player and a whole number.`);
        return;
      case 'counters':
        if (!(hasObject(op.object) || hasPlayer(op.object)) || !isStr(op.counter) || op.counter === '' || !isInt(op.delta)) return fail(`${at}: counters need an object or player, a counter name and a whole number.`);
        if (op.counter === '__proto__') return fail(`${at}: "__proto__" is not a counter name.`, ['CR 122.1']);
        if (hasPlayer(op.object) && op.counter !== 'poison') return fail(`${at}: the engine tracks only poison counters on players (CR 122.1f); other counters go on objects.`, ['CR 122.1']);
        return;
      case 'tap':
        if (!hasObject(op.object) || typeof op.tapped !== 'boolean') return fail(`${at}: tapping needs an object and true or false.`);
        return;
      case 'draw':
        if (!hasPlayer(op.player) || !isInt(op.count) || op.count < 0 || op.count > 100) return fail(`${at}: drawing needs a player and a count from 0 to 100.`);
        return;
      case 'shuffle':
        if (!hasPlayer(op.player)) return fail(`${at}: shuffling needs a player.`);
        return;
      case 'control':
        if (!hasObject(op.object) || !hasPlayer(op.player)) return fail(`${at}: a control change needs an object and a player.`);
        return;
      case 'damage':
        if (!(hasObject(op.target) || hasPlayer(op.target)) || !isInt(op.amount) || op.amount < 0) return fail(`${at}: damage needs a target and a non-negative whole number.`);
        return;
      case 'attach':
        if (!hasObject(op.object) || !(op.to === null || hasObject(op.to) || hasPlayer(op.to))) return fail(`${at}: attaching needs an object and what to attach it to (an object, a player, or null to unattach).`);
        if (op.to === op.object) return fail(`${at}: nothing can be attached to itself.`, ['CR 303.4d', 'CR 301.5c']);
        return;
      case 'mana':
        if (!hasPlayer(op.player) || !Array.isArray(op.types) || op.types.length === 0 || !op.types.every((t) => isStr(t) && MANA_TYPES.has(t)) || (op.snow !== undefined && typeof op.snow !== 'boolean')) {
          return fail(`${at}: adding mana needs a player and a list of mana types (W, U, B, R, G, C).`, ['CR 106.3']);
        }
        return;
      case 'token': {
        if (!hasPlayer(op.player)) return fail(`${at}: a token needs the player who controls it.`, ['CR 111.2']);
        if (!isStr(op.name) || op.name.trim() === '' || op.name.length > 80) return fail(`${at}: a token needs a name.`, ['CR 111.4']);
        const parsed = isStr(op.typeLine) ? parseTypeLine(op.typeLine) : null;
        if (!parsed || parsed.types.length === 0) return fail(`${at}: a token needs a type line with a card type, such as "Token Creature - Soldier".`, ['CR 111.4']);
        for (const k of ['power', 'toughness'] as const) {
          const v = op[k];
          if (v === undefined ? parsed.types.includes('Creature') : !isStr(v) || !/^[-+]?(\d+|\*)$/.test(v)) return fail(`${at}: a creature token needs a power and a toughness (a number or *).`, ['CR 111.4']);
        }
        if (op.colors !== undefined && (!Array.isArray(op.colors) || !op.colors.every((c) => isStr(c) && c.length === 1 && 'WUBRG'.includes(c)))) return fail(`${at}: token colors are a list of W, U, B, R, G.`, ['CR 111.4']);
        if ((op.text !== undefined && (!isStr(op.text) || op.text.length > 1000)) || (op.tapped !== undefined && typeof op.tapped !== 'boolean')) return fail(`${at}: a token's rules text must be text, and tapped true or false.`);
        return;
      }
      case 'discard':
        if (!hasObject(op.object)) return fail(`${at}: there is no such object.`);
        if (s.objects[op.object as string]!.zone !== 'hand') return fail(`${at}: only a card in a hand can be discarded.`, ['CR 701.9a']);
        return;
      case 'tokenCopy':
        if (!hasObject(op.object) || !hasPlayer(op.player)) return fail(`${at}: a token copy needs the permanent to copy and the player who creates it.`, ['CR 707.2', 'CR 111.1']);
        if (s.objects[op.object as string]!.zone !== 'battlefield') return fail(`${at}: only a permanent on the battlefield can be copied this way.`, ['CR 707.2']);
        if (op.haste !== undefined && typeof op.haste !== 'boolean') return fail(`${at}: haste is true or false.`);
        if (op.atNextEndStep !== undefined && op.atNextEndStep !== 'sacrifice' && op.atNextEndStep !== 'exile') return fail(`${at}: at the next end step the token is sacrificed or exiled.`, ['CR 603.7']);
        // CR 603.7d, 701.21a: the delayed trigger is the resolving player's, and a player sacrifices only a permanent they control
        if (op.atNextEndStep === 'sacrifice' && resolver !== undefined && op.player !== resolver) return fail(`${at}: a token another player gets can't be sacrificed by you at the next end step; choose to exile it instead.`, ['CR 603.7d', 'CR 701.21a']);
        return;
      case 'note':
        if (!isStr(op.text)) return fail(`${at}: a note needs text.`);
        return;
      default:
        return fail(`${at}: unknown operation "${String(op.op)}".`);
    }
  });
}
