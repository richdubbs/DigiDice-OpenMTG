/**
 * WP11 (design 8.5, 8.6 stage 4): no handler mutates zones, life, damage or counters directly. Every state change of an effect goes through `propose`, and only
 * the performers (effects/perform.ts, effects/perform-direct.ts) call the milestone 3/4 primitives that make those changes. This lint reads the sources of
 * `src/effects/` and fails on a direct write or a direct call of a primitive anywhere else in the interpreter (handlers of WP10, WP12-WP15 included).
 *
 * WP31 extends it:
 *   - the state-writing primitives WP14 and WP15 added (rules/status.ts, rules/phasing.ts, rules/stack-objects.ts, core/durations.ts#addEffectRecord) are
 *     primitives too, reached from the interpreter only through effects/perform-direct.ts; importing a primitive under another name (`removeFromCombat as
 *     leaveCombat`) is a violation, so an alias can't hide a call;
 *   - the calls into other writers that the interpreter still makes directly (WP15's game ops, the trigger writers, the mana pool, hidden information) are
 *     allow-listed per file and per name, each with its reason;
 *   - `src/rules/` and `src/core/` are linted as well: a module there that writes the game state is one of the primitives or the turn machinery, listed below
 *     with its reason; any other module (a new one included) must not write the state.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT } from '../helpers';

/**
 * The performers, the only modules of the interpreter allowed to call the primitives or to write game state (design 8.5). Everything else in the interpreter
 * reads the state and proposes events; the bookkeeping of shields (uses and budgets left) and the payment of an "as it enters" cost are performers too.
 */
// M6-0 (m6 design 2.6): the performers of the milestone 5 proposal kinds moved, unchanged, to effects/perform-events.ts (a performer like the other two).
const ALLOWED = new Set(['effects/perform.ts', 'effects/perform-direct.ts', 'effects/perform-events.ts']);

/**
 * Milestone 3/4 primitives that change the game (core/zones.ts, core/manual.ts, rules/damage.ts, rules/life.ts, rules/counters.ts, rules/destroy.ts,
 * rules/pay.ts, rules/combat-state.ts, statics/links.ts): zones, life, damage, counters, payments, manual operations, links. WP31: the WP14 and WP15
 * primitives (rules/status.ts, rules/phasing.ts, rules/stack-objects.ts, core/durations.ts) and the other writers the interpreter calls (below).
 */
const PRIMITIVES = [
  'moveObject', 'dealDamage', 'gainLife', 'loseLife', 'changeLife', 'payLife', 'givePoison', 'addCounters', 'drawCard', 'drawCards', 'createToken', 'destroy', 'regenerate',
  'payPlan', 'applyManualOps', 'shuffleLibrary', 'setLink', 'removeFromCombat', 'addRegenerationShield',
  // WP31: WP14's and WP15's state-writing primitives (effects/perform-direct.ts is their performer).
  'tapPermanent', 'untapPermanent', 'attachPermanent', 'unattachPermanent', 'transformPermanent', 'flipPermanent' /* M6-4 */, 'addAttacker', 'phaseOutPermanent', 'phaseInForUntapStep',
  'removeFromStack', 'putCopyOnStack', 'addEffectRecord', 'addUntilMove' /* FAST4 MX1 (CR 610.3): performUntilMove */,
  // M6-3: the face-down primitives (rules/face-down.ts; effects/perform-direct.ts is their performer).
  'turnPermanentFaceUp', 'turnPermanentFaceDown',
  // FAST5 MX7: a card brought into the game from outside it (core/zones.ts; effects/perform-direct.ts#performBringIntoGame is its performer).
  'bringIntoGame',
  // WP31: other writers the interpreter calls directly (allow-listed per file in CALLS_ALLOWED).
  'setMonarch', 'setDayNight', 'createEmblem', 'winGame', 'loseGame', 'drawGame', 'addExtraTurns', 'addExtraPhase', 'markTurnEnding', 'dropPendingTriggers',
  'collectPendingTriggers', 'rollDice', 'flipCoin', 'createDelayedTrigger', 'putReflexiveTrigger', 'addMana', 'showCards', 'reorderLibrary',
];

/**
 * WP31: direct calls of a writer the interpreter is allowed to make, per file, with the reason. Each is the one primitive of its rule and has no `Proposed`
 * form (design 8.5); moving them behind a performer module is possible later, but nothing replaces or prevents these events in this build.
 */
const CALLS_ALLOWED: Record<string, { names: string[]; why: string }> = {
  'effects/handlers/game.ts': {
    names: ['flipCoin', 'rollDice', 'createEmblem', 'setDayNight', 'setMonarch', 'drawGame', 'loseGame', 'winGame', 'collectPendingTriggers', 'addExtraPhase', 'addExtraTurns', 'dropPendingTriggers', 'markTurnEnding'],
    why: 'WP15\'s game ops call the one primitive of their rule (CR 104, 705, 706, 114, 725, 731, 500.7, 724); the game-end functions are the design 8.5 performers of game end (core/sba.ts)',
  },
  'effects/handlers/lasting.ts': { names: ['createDelayedTrigger', 'putReflexiveTrigger'], why: 'the one writers of delayed (CR 603.7) and reflexive (CR 603.12) triggered abilities (triggers/)' },
  'effects/handlers/cards-mana.ts': { names: ['addMana'], why: 'mana goes into the mana pool without the stack or the pipeline (CR 106.4, 605.3b): rules/mana.ts#addMana is the pool\'s primitive' },
  'effects/handlers/cards-library.ts': { names: ['showCards', 'reorderLibrary'], why: 'hidden information and library order are no game event a replacement can change (CR 701.20, 701.22; WP13 interface change in core/zones.ts)' },
  'effects/handlers/cards-reveal.ts': { names: ['showCards'], why: 'revealing and looking at cards changes who may see them, nothing else (CR 701.20)' },
  'effects/handlers/cards-draw.ts': { names: ['showCards'], why: 'a card discarded at random is shown to its owner (CR 701.20, 701.9b)' },
  'effects/handlers/learn.ts': { names: ['showCards'], why: 'FAST5 MX7: the Lesson card learn brings into the hand is revealed (CR 701.48a, 701.20a); revealing changes who may see it, nothing else' },
  'effects/bodies/m5.ts': { names: ['showCards'], why: "std-rx6: \"As ~ enters, look at an opponent's hand, then ...\" (an entering body, CR 614.12a, 402.3): looking at cards changes who may see them, nothing else (CR 701.20e)" },
  'effects/handlers/outside.ts': { names: ['showCards'], why: 'cloud r3-mech: the card a wish reveals from outside the game is shown to every player (CR 400.11b, 701.20a), as learn does; revealing changes who may see it, nothing else' },
};

/**
 * WP31: the modules of `src/rules/` and `src/core/` that write the game state, each with its reason: the primitives the performers call (design 8.5: "the
 * performers call milestone 4's primitives, which stay the single implementation of each rule"), the turn machinery and the costs, which are not effects.
 */
const RULES_CORE_ALLOWED: Record<string, string> = {
  'core/zones.ts': 'the zone primitives (moveObject, createToken, drawCard, shuffle, revealing; CR 400.7, 111, 121, 701.24); every move and token goes through the funnels of effects/funnels.ts',
  'core/manual.ts': 'the manual operations a player applies by hand (design 10.5), through the primitives',
  'core/create.ts': 'creating the game state (CR 103)',
  'core/start.ts': 'the start of the game: play order, mulligans, opening hands (CR 103)',
  'core/turn.ts': 'the turn structure: steps, phases, priority (CR 500-514, 117)',
  'core/steps.ts': 'the turn-based actions of the steps (CR 502-514): untap, draw, cleanup, the end of "until end of turn" effects',
  'core/turn-effects.ts': 'extra turns and phases, ending the turn (CR 500.7, 724): the primitives of WP15\'s game ops',
  'core/mana-riders.ts': 'std-mana-1: a rider on mana applies to the spell as its costs are paid (CR 106.6, 601.2h), part of casting (actions/cast.ts), not an effect: the keyword it gives the spell is a continuous effect record as core/turn-effects.ts#lockNextSpellKeywords writes one, and "can\'t be countered" the stack flag the cast leaves for Cavern of Souls',
  'core/combat.ts': 'declaring attackers and blockers (CR 508-509)',
  // r5-static
  'core/combat-tax.ts': 'paying the costs to attack and block (CR 508.1h-j, 509.1d-f) through payPlan; payability is judged on a copy of the state with the attackers tapped (CR 508.1f)',
  'core/resolve.ts': 'a spell or ability leaving the stack as it resolves (CR 608)',
  'core/sba.ts': 'state-based actions and the end of the game (CR 704, 104): the design 8.5 performer of game end',
  'core/sba-objects.ts': 'the state-based actions on objects (CR 704.5)',
  'core/sba-commander.ts': 'M11-1: the state-based actions of the Commander rules (CR 704.6c, 704.6d): a commander its owner puts into the command zone is moved with moveObject, whose funnel proposes the move',
  'core/durations.ts': 'the one writer of resolved continuous effects (addEffectRecord, reached through effects/perform-direct.ts) and the end of durations (CR 611.2, 610.3); FAST4 MX1: of the moves "until" an event (addUntilMove, through effects/perform-direct.ts#performUntilMove)',
  'core/pregame.ts': 'FAST4 MX1: the opening-hand actions of the start of the game (CR 103.6a): the card is put onto the battlefield with moveObject, whose funnel proposes the move',
  'core/move-parts/copy.ts': 'M6-2, a part of moveObject (core/registries.ts#MOVE_PARTS): the copy effect a permanent enters with (CR 707.5, 613.7) and a spell copy becoming a token as it enters (CR 707.10f), before the zoneChanged event',
  'core/designations.ts': 'the monarch and day/night designations and their triggers (CR 725, 731)',
  'core/rad.ts': 'std-rx17: the rad counters\' inherent trigger is put into pendingTriggers as the precombat main phase begins (CR 728.1), as the monarch\'s (core/designations.ts)',
  'core/move-parts/components.ts': 'M6-4, a part of moveObject (core/registries.ts#MOVE_PARTS): two cards become one melded permanent as the first enters, and its cards become objects again as it leaves (CR 701.42a, 712.21); M6-9: so do the components of a merged permanent (CR 730.3); a card component of a token one is an object on the battlefield only while the pipeline is asked where it goes (CR 730.3e)',
  'core/resolve-parts/mutate.ts': 'M6-9, a part of resolvePermanentSpell (core/registries.ts#RESOLVE_PERMANENT_PARTS): a mutating creature spell leaves the stack and becomes a component of the permanent it merges with, with no new object and no zone change onto the battlefield (CR 702.140c, 730.2b)',
  'core/day-night.ts': 'M6-4: day and night change as the untap step\'s second part and immediately (CR 502.2, 731.2, 702.145c-d, f-g), through core/designations.ts#setDayNight',
  'rules/resolutions.ts': 'FAST5X E17: the record of the resolutions of an ability this turn (GameState.turnActivations, CR 608.2, 400.7) that "the Nth time this ability has resolved this turn" reads; written as the ability begins to resolve (effects/run.ts), no game event',
  'rules/counters.ts': 'addCounters (CR 122), the primitive of the counters performer',
  'rules/damage.ts': 'dealDamage (CR 120), the primitive of the damage performer',
  'rules/destroy.ts': 'destroy and regeneration shields (CR 701.8, 701.19), the primitive of the destroy performer',
  'rules/life.ts': 'life totals and poison counters (CR 119, 122.1f), the primitive of the life performer',
  'rules/mana.ts': 'mana abilities pay their own costs and add mana without the stack (CR 605.3)',
  'rules/pay.ts': 'paying costs (CR 601.2g-h, 118)',
  'rules/pay-parts.ts': 'paying the non-mana parts of costs (CR 118.3)',
  'rules/phasing.ts': 'phasing (CR 702.26, 502.1), the primitive behind effects/perform-direct.ts and the untap step',
  'rules/restrictions.ts': 'addPlayerRestriction, milestone 4\'s player restrictions as typed records (transition T1, design 4.5)',
  'rules/stack-objects.ts': 'removeFromStack and putCopyOnStack (CR 701.6a, 707.10), the primitives behind effects/perform-direct.ts',
  'rules/status.ts': 'tap, untap, attach, transform, flip, addAttacker (CR 701.3, 701.26, 701.27, 710.4, 508.4), the primitives behind effects/perform-direct.ts',
  'rules/face-down.ts': 'M6-3: turning a permanent face up or face down (CR 708.2a, 708.8, 613.7f), the primitives behind effects/perform-direct.ts',
  'core/control.ts': 'MX2: the controller after layer 2 written into the stored controller (CR 613.1b, 108.4), with the removal from combat (CR 506.4) and the CR 302.6 turn it implies; an immediate check, through effects/perform-direct.ts#performControlSync',
  'core/dungeons.ts': 'MX4: dungeons (CR 309): a dungeon card comes from outside the game straight into the command zone and is removed from the game when completed, no zone change of moveObject (CR 309.2a, 309.7, 704.5t); its room abilities trigger as the venture marker moves (CR 309.4c); the primitives behind effects/handlers/venture.ts',
  'core/apply.ts': 'M12-2: a concession in a multiplayer game re-runs the action it interrupted (m12 design D11): the events of the concession are turned into waiting triggers first (collectPendingTriggers, CR 603.2, 603.6c), as core/turn.ts#advance does',
  'core/leave.ts': 'M12-2: a player leaving a multiplayer game (CR 800.4a): their objects leave the game (removed with last known information, no zone change of moveObject: they go nowhere), the effects that gave them control end, their priority passes on and `PlayerState.left` is set; what they still control is exiled with moveObject, whose funnel proposes the move',
  'core/prepare.ts': 'M6-6: the prepared designation (CR 722.3a-b) and the copy of a prepare spell its controller creates in exile (CR 722.3c), the primitives behind effects/handlers/levels.ts and the enters part',
  'core/citys-blessing.ts': 'CMD3: the city\'s blessing (CR 702.131c), a designation of a player kept for the rest of the game, given by ascend (CR 702.131a-b): the primitive behind the designate handler and an immediate check',
  'core/player-control.ts': 'std-control-3: controlling another player (CR 723.1): the waiting and active player-control records, created by op controlPlayer and begun and ended by the turn machinery (core/turn.ts, core/steps.ts)',
};

/** Fields only a game object or a player has (never an interpreter value such as DestinationFacts or ExecCtx), so writing one is a state write whatever the receiver. */
const STATE_FIELDS = ['attachedTo', 'usesLeft', 'phasedOut', 'flipped', 'links', 'protector', 'timestamp', 'manaPool', 'turnStats', 'drewFromEmptyLibrary', 'hasLost', 'revealedTo'];
/** Receivers that name a game object, a player or a record by convention: their shared field names (tapped, controller, ...) are state writes too. */
const OBJECT_NAMES = ['o', 'obj', 'object', 'host', 'src', 'rec', 'perm', 'permanent', 'card', 'token', 'p', 'player'];

const RULES: [RegExp, string][] = [
  [/\bg\.s\.[\w.!?[\]'"]*\s*(\+|-|\*)?=(?!=)|\bg\.s\.[\w.!?[\]'"]*\.(push|splice|unshift|shift|pop|sort|reverse|fill)\s*\(|\bdelete\s+g\.s\./, 'writes the game state (g.s.*)'],
  [/\bg\.(obj|maybeObj|player)\([^)]*\)!?\.\w+\s*(\+|-)?=(?!=)/, 'writes a field of a game object or player'],
  [new RegExp(`\\.(${STATE_FIELDS.join('|')})\\s*(\\+|-)?=(?!=)|\\bdelete\\s+[\\w.!?]*\\.(${STATE_FIELDS.join('|')})\\b`), 'writes a field only game objects and players have'],
  [new RegExp(`\\b(${OBJECT_NAMES.join('|')})!?\\.(tapped|controller|owner|zone|faceDown|face|cast)\\s*=(?!=)`), 'writes a field of a game object'],
  [new RegExp(`(?<!\\bfunction\\s+)\\b(${PRIMITIVES.join('|')})\\s*\\(`), 'calls a primitive: propose the event instead (effects/propose.ts) or call its performer'], // (a declaration is no call)
  [new RegExp(`\\b(${PRIMITIVES.join('|')})\\s+as\\s+\\w+`), 'imports a primitive under another name (an alias hides its calls from this lint)'],
  [/\.(life|poison|damage|deathtouchDamaged)\s*(\+|-|\*)?=(?!=)/, 'writes a life total, poison or damage'],
  [/\.counters\s*\[[^\]]*\]\s*(\+|-)?=(?!=)|\bdelete\s+[\w.!?]*\.counters\b/, 'writes counters'],
  [/\.zones\.[\w.!?[\]'"]*\.(push|splice|unshift|shift|pop)\s*\(|\.zones\.\w+\s*(\[[^\]]*\])?\s*=(?!=)/, 'writes a zone'],
  [/\.objects\s*\[[^\]]+\]\s*=(?!=)|\bdelete\s+[\w.!?]*\.objects\s*\[/, 'creates or removes an object (CR 400.7: only moveObject / createToken do)'],
];

/** The code of a module without comments and string contents (a word in a comment or a log line is not a call). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')) // keep the line numbers
    .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""')
    .replace(/\/\/.*$/gm, '');
}

/** The primitive calls on a line this file is allowed to make (CALLS_ALLOWED), removed before the rules are applied. */
function withoutAllowedCalls(file: string, line: string): string {
  const names = CALLS_ALLOWED[file]?.names ?? [];
  return names.length === 0 ? line : line.replace(new RegExp(`\\b(${names.join('|')})\\s*\\(`, 'g'), '(');
}

function violations(file: string, text: string): string[] {
  const out: string[] = [];
  code(text).split('\n').forEach((raw, i) => {
    const line = withoutAllowedCalls(file, raw);
    for (const [re, why] of RULES) if (re.test(line)) out.push(`${file}:${i + 1}: ${why}: ${raw.trim()}`);
  });
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const rel = (p: string): string => relative(SRC_ROOT, p).split(sep).join('/');

describe('design 8.5: no state write outside the performers', () => {
  it('the lint finds direct writes and primitive calls (it is not vacuous)', () => {
    const bad = [
      'moveObject(cx.g, id, "graveyard");',
      'cx.g.player(p).life -= 3;',
      'o.counters["+1/+1"] = 2;',
      'g.s.zones.battlefield.push(id);',
      'o.damage += amount;',
      'delete g.s.objects[id];',
      'dealDamage (g, a, b, 1)',
      'g.s.continuousEffects = g.s.continuousEffects.filter((r) => r !== rec);',
      'g.s.continuousEffects.push(rec);',
      'rec.usesLeft = left;',
      'o.tapped = true;',
      'g.obj(id).attachedTo = host;',
      'payPlan(g, player, null, plan, name);',
      'applyManualOps(g, c.controller, ans.ops);',
      // WP31
      'tapPermanent(cx.g, h.id)',
      'addEffectRecord(g, rec);',
      'import { removeFromCombat as leaveCombat, attackerState } from "../../rules/combat-state";',
      'putCopyOnStack(g, original, who, targets);',
    ];
    for (const line of bad) expect(violations('x.ts', line), line).not.toEqual([]);
    const fine = [
      '// moveObject(g, id) in a comment', 'g.log(`it was destroy(ed)`);', 'const life = p.life; if (o.damage === 0) {}', 'propose(cx.g, { ev: "damage" });',
      'facts.tapped = true;', 'cx.controller = player;', 'const live = g.s.continuousEffects.filter(alive);', 'if (g.s.turn.number === 1) {}',
      'performTap(cx.g, h.id)', 'import { attackerState, isBlocking } from "../../rules/combat-state";', 'export function rollDie(g: Game, player: PlayerId): number {',
    ];
    for (const line of fine) expect(violations('x.ts', line), line).toEqual([]);
  });

  it('WP31: a writer allow-listed for one file is a violation in any other', () => {
    expect(violations('effects/handlers/game.ts', 'winGame(g, p, why);')).toEqual([]);
    expect(violations('effects/handlers/zones-status.ts', 'winGame(g, p, why);')).not.toEqual([]);
  });

  it('src/effects/**: only the performers change zones, life, damage or counters', () => {
    const found = sources(join(SRC_ROOT, 'effects')).flatMap((p) => (ALLOWED.has(rel(p)) ? [] : violations(rel(p), readFileSync(p, 'utf8'))));
    expect(found).toEqual([]);
  });

  it('WP31: every allow-listed call is still made (no stale entry)', () => {
    for (const [file, { names }] of Object.entries(CALLS_ALLOWED)) {
      const text = code(readFileSync(join(SRC_ROOT, file), 'utf8'));
      for (const n of names) expect(new RegExp(`\\b${n}\\s*\\(`).test(text), `${file} calls ${n}`).toBe(true);
    }
  });
});

describe('WP31, design 8.5: src/rules and src/core write the state only in the primitives and the turn machinery', () => {
  const files = [...sources(join(SRC_ROOT, 'rules')), ...sources(join(SRC_ROOT, 'core'))];

  it('a module not on the list writes nothing (a new module that does must be listed here with its reason, or call a primitive)', () => {
    const found = files.flatMap((p) => (Object.hasOwn(RULES_CORE_ALLOWED, rel(p)) ? [] : violations(rel(p), readFileSync(p, 'utf8'))));
    expect(found).toEqual([]);
  });

  it('every listed module exists and does write the state (no stale entry)', () => {
    for (const f of Object.keys(RULES_CORE_ALLOWED)) {
      const p = join(SRC_ROOT, f);
      expect(existsSync(p), f).toBe(true);
      expect(violations(f, readFileSync(p, 'utf8')).length, f).toBeGreaterThan(0);
    }
  });
});
