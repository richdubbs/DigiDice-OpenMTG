/**
 * Semantic lint, part 1: the checks that only need a node and its ancestors (design 3.2-3.6, 10.1). Owner: WP1.
 *
 * Names and values bound by earlier steps are flow-sensitive and live in model/lint-flow.ts. Here: target visibility and uniqueness, event roles,
 * `subject`, `fixed`, `live`, `ask` positions, layers, divisions, `X`, `spellTargetCount`, and the "no semantics" gaps. Every check is a pure function
 * of the node, its ancestors and the ability root, so it runs in one walk.
 */
import type { EventPattern, EventRole } from '../types/ability';
import type { Issue, IssueCode, ValidateContext } from './api';
import { patternsExpose, patternsHaveAmount } from './lint-roles';
import { ABILITY_DEFS, ancestors, walkAbility, type WalkNode } from './walk';

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (typeof x === 'object' && x !== null ? (x as Rec) : {});
const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : []);

/** Nodes through which a `{q:'ask'}` quantity is not allowed (design 10.1 table: positions with no manual node). */
const ASK_BLOCKERS: ReadonlySet<string> = new Set([
  'TargetSpec', 'CostDef', 'CostPart', 'EventPattern', 'Duration', 'ManaRestriction', 'Destination', 'ModeSpec', 'TriggerDef', 'ReplacementDef',
  'RestrictionDef', 'CostModDef', 'PermissionDef', 'RuleModDef', 'TriggerModDef', 'AdditionalCostDef', 'AlternativeCostDef', 'PregameDef',
  'StaticAbilityDef', 'TriggeredAbilityDef', 'ActivatedAbilityDef', 'KeywordAbilityDef',
]);

/**
 * CLOUD C8 (CR 118.12, 400.7j): is `n` inside the `then` of a `pay` step whose cost discards a card other than ~ and that has no other way to pay (no `else`), with no
 * reflexive trigger between them? The `pay` handler remembers what such a payment discarded, for `{ref:'costDiscarded'}` (effects/handlers/pay.ts).
 */
function inPayDiscard(n: WalkNode, owner: WalkNode): boolean {
  let child: WalkNode = n;
  for (const a of ancestors(n)) {
    if (a === owner) return false;
    if (a.def === 'EffectStep' && a.value['op'] === 'reflexive') return false;
    if (a.def === 'EffectStep' && a.value['op'] === 'pay' && child.slot === 'then' && a.value['else'] === undefined) {
      const parts = rec(a.value['cost'])['other'];
      return Array.isArray(parts) && parts.some((p) => rec(p)['kind'] === 'discard' && rec(p)['self'] !== true);
    }
    child = a;
  }
  return false;
}

/**
 * CLOUD C8 (CR 603.7c, 603.12): is `n` inside the instructions of a delayed or reflexive triggered ability of the ability `owner`? That ability is an object of its own
 * on the stack, with no costs paid (`CostsPaid` is empty for it), so a reference to what a cost moved names nothing there.
 */
function inDeferred(n: WalkNode, owner: WalkNode): boolean {
  for (const a of ancestors(n)) {
    if (a === owner) return false;
    if (a.def === 'EffectStep' && (a.value['op'] === 'reflexive' || a.value['op'] === 'delay')) return true;
  }
  return false;
}

/** Layers a characteristic-defining ability may use (CR 604.3, 613.3): color, types, power and toughness. */
const CDA_LAYERS: readonly unknown[] = [4, 5, '7a'];

/**
 * FAST5 T78 (CR 608.2h, 118.12): is `n` inside the `then` of a `pay` step whose cost sacrifices a permanent other than ~ and that has no other way to pay (no `else`), with no
 * reflexive trigger between them? The `pay` handler remembers what such a payment sacrificed, for `{ref:'costSacrificed'}` (effects/handlers/pay.ts).
 */
function inPaySacrifice(n: WalkNode, owner: WalkNode): boolean {
  let child: WalkNode = n;
  for (const a of ancestors(n)) {
    if (a === owner) return false;
    // std-rw8 (CR 603.12, 608.2h): ... or inside the `do` of the reflexive trigger that waits for such a payment, an earlier step of the same list ("You may sacrifice
    // another creature. When you do, ~ deals damage equal to that creature's power ..."), as the object of a characteristic only: its value is read as the trigger is
    // created (effects/handlers/lasting-fix.ts#prepareDeferred)
    if (a.def === 'EffectStep' && a.value['op'] === 'reflexive') return child.slot === 'do' && n.slot === 'of' && rec(n.parent?.value)['q'] === 'stat' && waitsForPaySacrifice(a);
    if (a.def === 'EffectStep' && a.value['op'] === 'pay' && child.slot === 'then' && a.value['else'] === undefined) return paysOneSacrifice(a.value);
    child = a;
  }
  return false;
}

/** FAST5 T78: a `pay` step whose cost sacrifices ONE permanent other than ~ (one sacrifice part) and that has no other way to pay (no `else`). */
function paysOneSacrifice(step: Record<string, unknown>): boolean {
  const parts = rec(step['cost'])['other'];
  return step['op'] === 'pay' && step['else'] === undefined && Array.isArray(parts) && parts.filter((p) => rec(p)['kind'] === 'sacrifice').length === 1
    && parts.some((p) => rec(p)['kind'] === 'sacrifice' && rec(p)['self'] !== true && rec(p)['count'] === 1);
}

/** std-rw8: does reflexive step `r` wait for ("When you do") a `pay` step before it in its own list that sacrifices one permanent (`paysOneSacrifice`), the only payment that sacrifices? */
function waitsForPaySacrifice(r: WalkNode): boolean {
  const did = rec(r.value['when'])['did'];
  const list = r.parent !== null && r.index !== null ? rec(r.parent.value)[r.slot] : undefined;
  if (typeof did !== 'string' || !Array.isArray(list)) return false;
  const before = list.slice(0, r.index!).map(rec);
  const paid = before.find((x) => x['as'] === did);
  // costSacrificed lists everything a payment of this resolution sacrificed: another sacrificing payment before it would add to it
  const others = before.filter((x) => x !== paid && JSON.stringify(x).includes('"kind":"sacrifice"'));
  return paid !== undefined && paysOneSacrifice(paid) && others.length === 0;
}

/** Every target spec an ancestor program makes visible to `n` (CR 115.1: ids are per ability; a reflexive trigger adds its own, CR 603.12). */
export function visibleTargets(n: WalkNode): Map<string, Rec> {
  const out = new Map<string, Rec>();
  for (const a of ancestors(n)) {
    if (ABILITY_DEFS.has(a.def)) break;
    // std-tdm (CR 603.7, 603.3d): a delayed trigger's own targets (`delay.targets`) too
    const specs = a.def === 'EffectProgram' || (a.def === 'EffectStep' && (a.value['op'] === 'reflexive' || a.value['op'] === 'delay')) ? arr(a.value['targets']) : [];
    for (const s of specs) if (typeof s['id'] === 'string' && !out.has(s['id'])) out.set(s['id'], s);
    // std-costs-2 (CR 700.2, 608.2b): the program's own steps, which run after its chosen modes, see the targets of every mode ("Choose up to two. Return those cards
    // ... • Target artifact card."): the targets of the chosen modes are the ability's, and a mode not chosen has none (effects/run.ts merges the chosen modes)
    if (a.def === 'EffectProgram' && n.path.startsWith(`${a.path}/steps/`)) {
      for (const o of arr(rec(a.value['modes'])['options'])) for (const s of arr(rec(o['program'])['targets'])) if (typeof s['id'] === 'string' && !out.has(s['id'])) out.set(s['id'], s);
    }
  }
  return out;
}

/**
 * The event patterns whose roles `n` can read: those of the NEAREST provider, none when there is none. A replacement reads the event it replaces; a
 * delayed trigger waiting for an event reads that one; one waiting for a step or the end of combat reads the event of the ability that creates it, fixed
 * as it is created (FAST2 T10: CR 603.7c, effects/handlers/lasting-fix.ts#prepareDeferred); a manual ability has no event at all ("Trigger now" runs it
 * without one, design 6.6).
 */
function roleProviders(n: WalkNode): EventPattern[][] {
  for (const a of ancestors(n)) {
    // Cloud r4-repl (CR 611.2c, 614.12): the PATTERN of a replacement a resolving instruction creates names what the creating ability's event exposed ("Whenever you
    // cast a creature spell, that creature enters with ..."): the reference is fixed when the effect is created (effects/handlers/lasting-fix.ts, an event
    // pattern's identities), so its providers are the enclosing ability's, never the event the pattern describes. Its body still reads the replaced event.
    if (a.def === 'ReplacementDef' && n.path.startsWith(`${a.path}/replaces`) && [...ancestors(a)].some((x) => x.def === 'EffectStep' && x.value['op'] === 'effect')) continue;
    if (a.def === 'ReplacementDef') return [[a.value['replaces'] as EventPattern]];
    if (a.def === 'EffectStep' && a.value['op'] === 'delay') {
      const when = rec(a.value['when']);
      if (when['at'] === 'event') return [[when['event'] as EventPattern]];
      // FAST2 T10: a delayed trigger at a step or at end of combat names what the creating ability's event exposed ("destroy that creature at end of combat"):
      // the reference is fixed when the delayed trigger is created (CR 603.7c; effects/handlers/lasting-fix.ts#prepareDeferred), so the providers are the
      // enclosing ability's
      continue;
    }
    // std-copy-3 (CR 106.6, 603.2): "When that mana is spent to cast <spells>, ...": inside the trigger the mana carries, the event is that cast (actions/cast.ts#manaSpentTriggers)
    if (a.def === 'EffectStep' && a.value['op'] === 'addMana' && n.path.startsWith(`${a.path}/whenSpent/`)) return [[{ ev: 'cast', player: 'you', spell: rec(a.value['whenSpent'])['spells'] } as EventPattern]];
    if (a.def === 'TriggeredAbilityDef') return [arr(rec(a.value['trigger'])['on']) as unknown as EventPattern[]];
    if (a.def === 'ChapterAbilityDef') return [[{ ev: 'counters', change: 'put', on: { self: true } }]];
    if (ABILITY_DEFS.has(a.def)) return [];
  }
  return [];
}

/** FAST4 T26: is the node inside a triggered ability whose trigger is a "one or more" batch (CR 603.2c)? (the nearest ability, as roleProviders reads it) */
function triggerIsBatch(n: WalkNode): boolean {
  for (const a of ancestors(n)) {
    if (a.def === 'ReplacementDef' || (a.def === 'EffectStep' && a.value['op'] === 'delay' && rec(a.value['when'])['at'] === 'event')) return false;
    if (a.def === 'TriggeredAbilityDef') return rec(a.value['trigger'])['batch'] === true;
    if (ABILITY_DEFS.has(a.def)) return false;
  }
  return false;
}

/**
 * Merge train 8 (p2-replace-events-3, CR 701.22a, 614.1a): is the nearest provider of the node's event (as roleProviders reads it) the event a replacement
 * replaces? A scry proposal has its number of cards (effects/proposal-kinds/scry.ts); the event a "whenever you scry" trigger sees has none (triggers/normalize.ts).
 */
function providerIsReplacement(n: WalkNode): boolean {
  for (const a of ancestors(n)) {
    if (a.def === 'ReplacementDef' && n.path.startsWith(`${a.path}/replaces`) && [...ancestors(a)].some((x) => x.def === 'EffectStep' && x.value['op'] === 'effect')) continue;
    if (a.def === 'ReplacementDef') return true;
    if ((a.def === 'EffectStep' && a.value['op'] === 'delay' && rec(a.value['when'])['at'] === 'event') || ABILITY_DEFS.has(a.def)) return false;
  }
  return false;
}

const MANA_ASK = 'a mana ability resolves immediately, even in the middle of a payment, so it cannot ask: no manual step, quantity or condition (CR 605.3a-b)';

/** Is the node inside the effect of a mana ability (not its cost, which has its own check)? */
function inManaEffect(n: WalkNode): boolean {
  // std-copy-3 (CR 603.2): the triggered ability the mana carries ("When that mana is spent ...", `addMana.whenSpent`) resolves later, on the stack
  if (/\/whenSpent\//.test(n.path)) return false;
  for (let cur = n; cur.parent !== null; cur = cur.parent) {
    if (ABILITY_DEFS.has(cur.parent.def)) return cur.parent.def === 'ActivatedAbilityDef' && cur.parent.value['isMana'] === true && cur.slot === 'effect';
  }
  return false;
}

function condAskAllowed(n: WalkNode): boolean {
  let cur = n;
  while (cur.parent !== null && cur.parent.def === 'Condition') cur = cur.parent;
  const p = cur.parent;
  if (p === null) return false;
  if (p.def === 'EffectStep') return cur.slot === 'guard' || (cur.slot === 'cond' && p.value['op'] === 'if');
  return (p.def === 'ActivatedAbilityDef' || p.def === 'ManualAbilityDef') && cur.slot === 'onlyIf'; // the controller attests the restriction (CR 602.5b)
}

function qtyAskAllowed(n: WalkNode): boolean {
  for (const a of ancestors(n)) {
    if (a.def === 'EffectStep') return true;
    if (ASK_BLOCKERS.has(a.def) || ABILITY_DEFS.has(a.def)) return false;
  }
  return false;
}

const has = (n: WalkNode, def: string): WalkNode | null => {
  for (const a of ancestors(n)) {
    if (a.def === def) return a;
    if (ABILITY_DEFS.has(a.def)) return null;
  }
  return null;
};

/** `subject` is the object being modified (continuous effects) or the object an `each`-scoped step iterates (design 3.1). */
function subjectAllowed(n: WalkNode): boolean {
  for (const a of ancestors(n)) {
    if (a.def === 'Modification' || a.def === 'ContinuousEffectDef') return true;
    if (a.def === 'EffectStep') {
      if (a.value['op'] === 'forEach' || JSON.stringify(a.value).includes('"ref":"each"')) return true;
      if (a.value['op'] === 'damage' && a.value['perSource'] === true) return true; // FAST5 T49: each source of the group reads its own amount
    }
    if (ABILITY_DEFS.has(a.def)) return false;
  }
  return false;
}

function definesX(root: unknown): boolean {
  // FAST4 T31 (CR 107.3a, 602.2b): an X in a non-mana part of an activation cost ("Pay X {E}", "pay X life") is announced as the ability is activated
  // (rules/cost.ts#costHasX, actions/activate.ts), so its effect may read it
  const ab = typeof root === 'object' && root !== null ? (root as { kind?: unknown; cost?: { other?: unknown } }) : undefined;
  if (ab?.kind === 'activated' && JSON.stringify(ab.cost?.other ?? []).includes('"q":"X"')) return true;
  // std-r9 (CR 606.4, 107.3a): "−X", a loyalty cost announced as the ability is activated (CostDef.loyaltyX)
  if (ab?.kind === 'activated' && (ab.cost as { loyaltyX?: unknown } | undefined)?.loyaltyX === true) return true;
  let found = false;
  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    if (n.def === 'ManaSymbol' && n.value['kind'] === 'variable') found = true;
    // std-costs-1 (CR 701.59a, 107.3): "you may collect evidence X" in an ability that announced no X: the collector chooses X as they collect
    // (effects/handlers/evidence.ts#choosesEvidenceX)
    if (n.def === 'EffectStep' && n.value['op'] === 'action' && n.value['action'] === 'collectEvidence' && rec(n.value['n'])['q'] === 'X') found = true;
    return found ? false : undefined;
  });
  return found;
}

/** CLOUD std-dft (CR 702.29c): "when you cycle ~", the cycled card's own triggered ability (one trigger event: the cycle action done to this object). */
function cyclesSelf(root: unknown): boolean {
  const ab = typeof root === 'object' && root !== null ? (root as { kind?: unknown; trigger?: { on?: unknown } }) : undefined;
  const on = ab?.kind === 'triggered' && Array.isArray(ab.trigger?.on) ? (ab.trigger.on as unknown[]) : [];
  const p = on.length === 1 && typeof on[0] === 'object' && on[0] !== null ? (on[0] as { ev?: unknown; verb?: unknown; object?: { self?: unknown } }) : undefined;
  return p?.ev === 'action' && p.verb === 'cycle' && p.object?.self === true;
}

/**
 * std-rx30 (CR 702.37f, 702.168e, 107.3): "When this creature is turned face up, exile up to X other target creatures ..." (Aurelia's Vindicator, "Disguise {X}{3}{W}"):
 * the X of the ability triggered by the permanent itself turning face up is the X chosen as it was turned face up (GameObject.faceUpX; triggers/stack.ts gives the
 * ability that X). Shared with the engine.
 */
export function turnsFaceUpSelf(root: unknown): boolean {
  const ab = typeof root === 'object' && root !== null ? (root as { kind?: unknown; trigger?: { on?: unknown } }) : undefined;
  const on = ab?.kind === 'triggered' && Array.isArray(ab.trigger?.on) ? (ab.trigger.on as unknown[]) : [];
  const p = on.length === 1 && typeof on[0] === 'object' && on[0] !== null ? (on[0] as { ev?: unknown; what?: unknown; object?: Record<string, unknown> }) : undefined;
  return p?.ev === 'becomes' && p.what === 'turnedFaceUp' && p.object?.['self'] === true && Object.keys(p.object).length === 1;
}

/**
 * r4-fxz (CR 107.3, 603.2): a triggered ability every event of which is the cast of a spell with {X} in its mana cost ("Whenever you cast a spell with {X} in its
 * mana cost, ..."): its X is the X announced for that spell (triggers/stack.ts#castSpellX). Shared with the engine, which gives the ability that X.
 */
export function castsSpellWithX(root: unknown): boolean {
  const ab = typeof root === 'object' && root !== null ? (root as { kind?: unknown; trigger?: { on?: unknown; batch?: unknown } }) : undefined;
  const on = ab?.kind === 'triggered' && Array.isArray(ab.trigger?.on) && ab.trigger?.batch !== true ? (ab.trigger.on as unknown[]) : [];
  return on.length > 0 && on.every((p) => typeof p === 'object' && p !== null && (p as { ev?: unknown }).ev === 'cast' && (p as { spell?: { manaCostHasX?: unknown } }).spell?.manaCostHasX === true);
}

/** Part-1 lint of one ability. Nested abilities are handed to `onNested` (each is its own scope) and not walked here. */
export function lintNodes(root: unknown, base: string, ctx: ValidateContext, issues: Issue[], onNested: (n: WalkNode) => void): void {
  const out = (code: IssueCode, path: string, message: string, severity: 'error' | 'warning' = 'error'): void => {
    issues.push({ path, code, message, severity });
  };
  // CLOUD std-dft (CR 107.3a, 702.29a): the X of "when you cycle ~" is the X announced for the cycling cost (triggers/stack.ts), when that cost has one
  // r4-fxz (CR 107.3, 603.2): "Whenever you cast a spell with {X} in its mana cost, look at the top X cards of your library": the X of that spell (triggers/stack.ts)
  const xDefined = ctx.cardHasX !== false || definesX(root) || (ctx.cyclingX === true && cyclesSelf(root)) || castsSpellWithX(root) || turnsFaceUpSelf(root); // std-rx30: the face-up X
  const targetPaths = new Map<string, string[]>();

  walkAbility(root, (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) {
      onNested(n);
      return false;
    }
    const v = n.value;
    // std-costs-1 (CR 601.2c, 115.1): "for each isolation counter on it, exile up to one target ..." is one target per counter, chosen as the ability is put on the
    // stack; a `repeat` of the counters runs its steps again on the SAME targets, so its body may name no target
    if (n.def === 'EffectStep' && v['op'] === 'repeat' && rec(v['times'])['q'] === 'counters' && JSON.stringify(v['do'] ?? null).includes('"ref":"target"')) {
      out('executable-gap', n.path, 'a repeat for each counter whose instructions name a target: "for each counter, ... target ..." is one target per counter (CR 601.2c, 115.1)');
    }
    switch (n.def) {
      case 'ObjRef':
      case 'PlayerRef':
        return refChecks(n);
      case 'Quantity':
        quantityChecks(n);
        break;
      case 'Condition':
        if (v['cond'] === 'ask' && !condAskAllowed(n)) {
          out('ask-position', n.path, 'a manual condition (ask) is allowed only in a step guard, an `if` step or an activation restriction (design 10.1)');
        } else if (v['cond'] === 'ask' && inManaEffect(n)) out('ask-position', n.path, MANA_ASK);
        break;
      case 'TargetSpec':
        targetSpecChecks(n);
        break;
      case 'ModeSpec':
        modeChecks(n);
        break;
      case 'Modification':
        modificationChecks(n);
        break;
      case 'ContinuousEffectDef':
        if (arr(v['mods']).length === 0) out('executable-gap', n.path, 'a continuous effect with no modification does nothing');
        if (v['cda'] === true) cdaChecks(n);
        break;
      case 'ReplacementDef':
        if (rec(v['body'])['b'] === 'regeneration' && v['shield'] === undefined) {
          out('executable-gap', `${n.path}/shield`, 'a regeneration body is a shield: it needs `shield` (CR 614.8, 701.19); there is no static regeneration');
        }
        break;
      case 'EffectStep':
        stepChecks(n);
        break;
      case 'TokenDef':
        if (v['predefined'] === undefined && v['name'] === undefined && v['types'] === undefined && v['subtypes'] === undefined) {
          out('executable-gap', n.path, 'a token needs a predefined kind, a name or types');
        }
        break;
      case 'CostPart':
        if (v['kind'] === 'manual') {
          const ownCost = n.parent?.def === 'CostDef' && n.parent.parent?.def === 'ActivatedAbilityDef';
          const mana = ownCost && rec(root)['isMana'] === true;
          if (mana || has(n, 'AlternativeCostDef')) {
            out('ask-position', n.path, `a manual cost part is not allowed in ${mana ? 'a mana ability' : 'an alternative cost'}: it must be fully automated (design 10.1)`);
          }
        }
        break;
      case 'ActivatedAbilityDef':
        activatedChecks(n);
        break;
      case 'KeywordAbilityDef': {
        const k = v['keyword'];
        if (typeof k !== 'string' || k === '' || k !== k.toLowerCase()) out('executable-gap', `${n.path}/keyword`, 'a keyword is a canonical lower-case name');
        break;
      }
      case 'ChapterAbilityDef': {
        const ch = v['chapters'];
        if (!Array.isArray(ch) || ch.length === 0 || ch.some((c, i) => !Number.isInteger(c) || (c as number) < 1 || (i > 0 && (c as number) <= (ch[i - 1] as number)))) {
          out('executable-gap', `${n.path}/chapters`, 'chapters are positive integers in ascending order (CR 714.2)');
        }
        break;
      }
      case 'LevelBracketDef':
        if (typeof v['max'] === 'number' && typeof v['min'] === 'number' && v['max'] < v['min']) out('executable-gap', n.path, 'a level bracket ends before it starts (CR 711.2)');
        break;
      case 'StaticAbilityDef':
        if (arr(v['effects']).length === 0) out('executable-gap', `${n.path}/effects`, 'a static ability with no effect does nothing');
        break;
      default:
    }
    return undefined;

    function refChecks(node: WalkNode): void | false {
      const r = node.value['ref'];
      if (r === 'target') {
        const id = node.value['id'];
        const declared = typeof id === 'string' ? visibleTargets(node).get(id) : undefined;
        // r4-cost (CR 702.6a): in a keyword's cost change the target is the one of the activated ability the keyword stands for (keywords/expand.ts checks it)
        const keywordCost = [...ancestors(node)].some((a, i, all) => a.def === 'KeywordAbilityDef' && (i === 0 ? node : all[i - 1]!).slot === 'costChange');
        if (typeof id === 'string' && declared === undefined && !keywordCost) {
          out('unknown-target', node.path, `target "${id}" is not declared by this ability's target specs (CR 115.1, 608.2b)`);
        } else if (declared !== undefined && !node.names.includes('Ref')) {
          // a position typed as an object (or as a player) only: `Ref` positions take either
          const kind = declared['kind'];
          if (node.def === 'ObjRef' && kind === 'player') out('executable-gap', node.path, `target "${String(id)}" is a player, but an object is expected here (CR 115.1)`);
          if (node.def === 'PlayerRef' && (kind === 'object' || kind === 'spell' || kind === 'ability' || kind === 'stackObject')) {
            out('executable-gap', node.path, `target "${String(id)}" is not a player, but a player is expected here (CR 115.1)`);
          }
        }
      } else if (r === 'event') {
        const role = node.value['role'] as EventRole;
        const providers = roleProviders(node);
        if (providers.length === 0) out('bad-event-role', node.path, `{ref:'event'} is allowed only in a triggered ability, a replacement or an event-based delayed trigger (CR 603.7c)`);
        else if (!providers.some((p) => patternsExpose(p, role))) {
          out('bad-event-role', node.path, `role "${role}" is not exposed by ${providers.map((p) => p.map((e) => e.ev).join('|')).join(' / ')} (design 3.5)`);
        }
      } else if (r === 'subject') {
        if (!subjectAllowed(node)) out('bad-subject', node.path, `{ref:'subject'} is allowed only inside a continuous effect or an each-scoped step (design 3.1)`);
      } else if (r === 'grantor') {
        // r4-static (CR 201.5a, 613.1f): the granting object exists only for an ability a static ability's layer 6 effect grants (statics/mods.ts#withGrantor writes it
        // there); in a printed ability, a token's ability or a resolved effect's grant it would name nothing
        if (ctx.grantedScope !== true) out('bad-grantor', node.path, `{ref:'grantor'} is allowed only inside an ability that a static ability grants (layer 6, CR 613.1f)`);
      } else if (r === 'fixed') {
        out('fixed-in-card-data', node.path, `{ref:'fixed'} is written only by the effect handler, never in card data, packs or LLM output (design 2.3)`);
      } else if (r === 'iterating') {
        let inLoop = false;
        for (const a of ancestors(node)) {
          if (a.def === 'EffectStep' && a.value['op'] === 'forEach') inLoop = true;
          // T20 (FAST4) INTERFACE CHANGE: "each player may ...": the `may` of a group runs its steps once per player, that player iterating
          // (effects/handlers/control.ts#mayHandler: the choices first in APNAP order, CR 101.4, 608.2d); its own `who` is not inside such a step
          // M12 gaps: also the group "[you and] each opponent who voted for ..." (`voters`, the same plural `may`)
          if (a.def === 'EffectStep' && a.value['op'] === 'may' && (rec(a.value['who'])['ref'] === 'each' || rec(a.value['who'])['ref'] === 'voters')
            && (node.path.startsWith(`${a.path}/do/`) || node.path.startsWith(`${a.path}/otherwise/`))) inLoop = true;
          // C6 (CR 608.2e, 101.4): "each opponent sacrifices a creature with the greatest power among creatures they control": the sacrifice of a group binds each
          // choosing player as iterating while that player chooses (effects/handlers/zones-remove.ts#asChooser); only in its filter
          if (a.def === 'EffectStep' && a.value['op'] === 'sacrificeChoice' && rec(a.value['who'])['ref'] === 'each' && node.path.startsWith(`${a.path}/filter/`)) inLoop = true;
          // r5-refs (CR 608.2e, 101.4): ... and in its count, which the handler reads for each choosing player ("sacrifices half the creatures they control")
          if (a.def === 'EffectStep' && a.value['op'] === 'sacrificeChoice' && rec(a.value['who'])['ref'] === 'each' && a.value['mode'] !== 'all' && node.path.startsWith(`${a.path}/count/`)) inLoop = true;
          // std-rx30 (CR 608.2e, 101.4): "Each player loses half their life, then discards half the cards in their hand": the amount of a life change or the count of a
          // discard of a group, which the handler reads for each player (effects/handlers/cards-util.ts#readFor)
          if (a.def === 'EffectStep' && (a.value['op'] === 'loseLife' || a.value['op'] === 'gainLife') && rec(a.value['who'])['ref'] === 'each' && node.path.startsWith(`${a.path}/amount/`)) inLoop = true;
          if (a.def === 'EffectStep' && a.value['op'] === 'discard' && rec(a.value['who'])['ref'] === 'each' && node.path.startsWith(`${a.path}/count/`)) inLoop = true;
          // p2-zone-moves-1 (CR 121.2, 608.2e): ... and the count of a draw of a group ("then draws that many cards": the cards that player discarded)
          if (a.def === 'EffectStep' && a.value['op'] === 'draw' && rec(a.value['who'])['ref'] === 'each' && node.path.startsWith(`${a.path}/count/`)) inLoop = true;
          // C6 (CR 608.2c, 101.4): "for each player, choose a creature that player controls": a choice for each player binds that player while its objects are read
          if (a.def === 'EffectStep' && a.value['op'] === 'chooseObjects' && a.value['perPlayer'] !== undefined && node.path.startsWith(`${a.path}/from/`)) inLoop = true;
          // r5-refs (CR 101.4): ... and its chooser, when each of those players chooses for themselves ("each player chooses any number of creatures they control")
          if (a.def === 'EffectStep' && a.value['op'] === 'chooseObjects' && a.value['perPlayer'] !== undefined && node.path === `${a.path}/who`) inLoop = true;
          if (ABILITY_DEFS.has(a.def)) break;
        }
        if (!inLoop) out('unbound-name', node.path, `{ref:'iterating'} is allowed only inside a forEach`);
      } else if (r === 'costExiled') {
        // FAST5X E13 (craft, CR 702.167a): only an activated ability whose cost exiles cards reads what it exiled ("self": the cost exiles the source)
        let owner: WalkNode | null = null;
        for (const a of ancestors(node)) if (ABILITY_DEFS.has(a.def)) { owner = a; break; }
        const parts = owner?.value['kind'] === 'activated' ? rec(owner.value['cost'])['other'] : undefined;
        const self = rec(node.value)['self'] === true;
        // CLOUD C8 (CR 601.2b, 400.7j): ... or a spell reading the cards its additional cost exiled ("the exiled card"), checked card-wide (model/lint-card.ts#costReferenceIssues)
        const spellReads = owner?.value['kind'] === 'spell' && !self && !inDeferred(node, owner);
        if (!spellReads && !(Array.isArray(parts) && parts.some((p) => rec(p)['kind'] === 'exileFrom' && (rec(p)['self'] === true) === self))) {
          out('executable-gap', node.path, `{ref:'costExiled'} is allowed only in an activated ability whose cost exiles ${self ? '~' : 'cards other than ~'}, or in a spell whose additional cost exiles cards (CR 601.2b, 602.2b, 702.167a)`);
        }
      } else if (r === 'costBeheld' || r === 'costChosenObject' || r === 'costRevealed') { // p2-refs-1: and what a reveal cost revealed
        // std-rx28 (CR 601.2b, 701.4a): only a spell reads what its additional behold cost revealed or chose (checked card-wide, model/lint-card.ts#costReferenceIssues),
        // never a delayed or reflexive triggered ability, which paid no cost (CR 603.7c, 603.12)
        let owner: WalkNode | null = null;
        for (const a of ancestors(node)) if (ABILITY_DEFS.has(a.def)) { owner = a; break; }
        // std-costs-2 (CR 601.2b): and so does what its additional cost chose (`costChosenObject`)
        if (owner?.value['kind'] !== 'spell' || inDeferred(node, owner)) out('executable-gap', node.path, `{ref:'${r}'} is allowed only in a spell whose additional cost ${r === 'costBeheld' ? 'beholds (CR 601.2b, 701.4a)' : r === 'costRevealed' ? 'reveals a card (CR 601.2b, 701.20a)' : 'chooses an object (CR 601.2b)'}`);
      } else if (r === 'costTapped') {
        // T35: only an activated ability whose cost taps another permanent ("Tap another creature you control: ..." station, CR 702.184a) reads what it tapped
        let owner: WalkNode | null = null;
        for (const a of ancestors(node)) if (ABILITY_DEFS.has(a.def)) { owner = a; break; }
        const parts = owner?.value['kind'] === 'activated' ? rec(owner.value['cost'])['other'] : undefined;
        if (!(Array.isArray(parts) && parts.some((p) => rec(p)['kind'] === 'tapUntapped'))) out('executable-gap', node.path, `{ref:'costTapped'} is allowed only in an activated ability whose cost taps an untapped permanent (CR 602.2b, 702.184a)`);
      } else if (r === 'costSacrificed') {
        // FAST3 T18: only an ability with a cost of its own reads what that cost sacrificed (CR 602.2b; a spell's additional cost, CR 601.2b, is checked by
        // the parser, which writes the reference only next to such a cost): an activated ability must sacrifice something other than ~ as a cost
        let owner: WalkNode | null = null;
        for (const a of ancestors(node)) if (ABILITY_DEFS.has(a.def)) { owner = a; break; }
        const kind = owner?.value['kind'];
        const parts = kind === 'activated' ? rec(owner!.value['cost'])['other'] : undefined;
        const sacrifices = Array.isArray(parts) && parts.some((p) => rec(p)['kind'] === 'sacrifice' && rec(p)['self'] !== true);
        // FAST5 T78 (CR 608.2h, 118.12): ... or an ability whose effect has a payment that sacrifices a permanent other than ~, read inside that payment's own `then` (the
        // `pay` handler remembers what it sacrificed); not inside a reflexive trigger, which is an ability of its own that remembers nothing, except one that waits for
        // that payment (std-rw8: the reference is fixed as it is created)
        const paysSacrifice = owner !== null && inPaySacrifice(node, owner);
        if (kind !== 'spell' && !sacrifices && !paysSacrifice) out('executable-gap', node.path, `{ref:'costSacrificed'} is allowed only in a spell, in an activated ability whose cost sacrifices a permanent other than ~, or after an optional cost that sacrifices one (CR 601.2b, 602.2b, 118.12)`);
      } else if (r === 'costDiscarded') {
        // CLOUD C8 (CR 602.2b, 118.12, 400.7j): only what a cost of this ability discarded: an activated ability whose cost discards a card other than ~, a payment of the
        // effect that discards one (read inside its own `then`), or a spell, whose additional cost is checked card-wide (model/lint-card.ts#costReferenceIssues)
        let owner: WalkNode | null = null;
        for (const a of ancestors(node)) if (ABILITY_DEFS.has(a.def)) { owner = a; break; }
        const kind = owner?.value['kind'];
        const parts = kind === 'activated' ? rec(owner!.value['cost'])['other'] : undefined;
        const discards = Array.isArray(parts) && parts.some((p) => rec(p)['kind'] === 'discard' && rec(p)['self'] !== true);
        const paysDiscard = owner !== null && inPayDiscard(node, owner);
        if (kind !== 'spell' && !discards && !paysDiscard) out('executable-gap', node.path, `{ref:'costDiscarded'} is allowed only in a spell, in an activated ability whose cost discards a card other than ~, or after an optional cost that discards one (CR 601.2b, 602.2b, 118.12)`);
        else if (owner !== null && inDeferred(node, owner)) out('executable-gap', node.path, `{ref:'costDiscarded'} is not allowed in a delayed or reflexive triggered ability: it paid no cost (CR 603.7c, 603.12)`);
      }
      return undefined;
    }

    function quantityChecks(node: WalkNode): void {
      const q = node.value['q'];
      if (q === 'X') {
        let inCost = false;
        for (const a of ancestors(node)) {
          if (a.def === 'CostDef' || a.def === 'CostPart') inCost = true;
          if (ABILITY_DEFS.has(a.def)) break;
        }
        if (!xDefined && !inCost) out('bad-var', node.path, `{q:'X'} in an ability of a card without X in its cost (CR 107.3)`);
      } else if (q === 'ask') {
        if (!qtyAskAllowed(node)) out('ask-position', node.path, 'a manual quantity (ask) is allowed only inside a step (design 10.1)');
        else if (inManaEffect(node)) out('ask-position', node.path, MANA_ASK);
      } else if (q === 'live') {
        if (has(node, 'Modification') === null) out('live-position', node.path, `{q:'live'} is allowed only inside a continuous-effect modification (design 3.4)`);
      } else if (q === 'spellTargetCount') {
        const cm = has(node, 'CostModDef');
        // r4-cost (CR 601.2c, 602.2b): also the cost of an activated ability (its own cost change, a keyword's, or a modifier of activated abilities' costs)
        const abilityCost = (cm !== null && rec(cm.value['applies'])['abilities'] !== undefined) || [...ancestors(node)].some((a, i, all) => (a.def === 'ActivatedAbilityDef' || a.def === 'KeywordAbilityDef') && (i === 0 ? node : all[i - 1]!).slot === 'costChange');
        if (!abilityCost && (cm === null || rec(cm.value['applies'])['self'] !== true)) out('spell-target-count', node.path, `{q:'spellTargetCount'} is allowed only in the cost modifier of the spell itself (CR 601.2f)`);
      } else if (q === 'spellTargetTotal') {
        // std-costs-1 (CR 601.2c, 601.2f): the spell's targets are known as its total cost is determined; only an additional cost of the spell itself reads them
        // (actions/cast.ts#withTargetTotals fixes the number there)
        if (has(node, 'AdditionalCostDef') === null) out('spell-target-count', node.path, `{q:'spellTargetTotal'} is allowed only in an additional cost of the spell itself (CR 601.2f)`);
      } else if (q === 'costCount') {
        // std-costs-1 (CR 601.2b, 601.2f): only a cost modifier of the spell itself, in the static ability whose optional cost announces that number
        let owner: WalkNode | null = null;
        for (const a of ancestors(node)) if (ABILITY_DEFS.has(a.def)) { owner = a; break; }
        const effects = owner?.value['kind'] === 'static' && Array.isArray(owner.value['effects']) ? (owner.value['effects'] as unknown[]) : [];
        const announced = effects.some((e) => rec(e)['s'] === 'additionalCost' && rec(e)['announceCount'] === true && rec(e)['name'] === node.value['name']);
        const cm = has(node, 'CostModDef');
        if (!announced || cm === null || rec(cm.value['applies'])['self'] !== true) out('spell-target-count', node.path, `{q:'costCount'} is allowed only in the spell's own cost modifier, next to the optional cost that announces that number (CR 601.2b, 601.2f)`);
      } else if (q === 'eventAmount') {
        const providers = roleProviders(node);
        const batch = triggerIsBatch(node); // FAST4 T26: a "one or more ... attack" trigger counts the attackers (model/lint-roles.ts#patternsHaveAmount)
        const replaced = providerIsReplacement(node); // merge train 8: a scry has its number only as the event a replacement replaces (model/lint-roles.ts#patternsHaveAmount)
        if (providers.length === 0 || !providers.some((p) => patternsHaveAmount(p, batch, replaced))) {
          out('bad-event-role', node.path, `{q:'eventAmount'} ("that much") needs a trigger, replacement or event-based delayed trigger whose event has an amount (damage, life, draw, counters; design 3.5)`);
        }
      } else if (q === 'stat' && node.value['agg'] !== undefined && node.value['sum'] !== undefined) {
        // FAST5X E15 (CR 208.1, 202.3): a set's total and its greatest / least value are two different numbers; one quantity names one of them
        out('executable-gap', node.path, `{q:'stat'} has both sum and agg: the total and the greatest / least value of a set are different numbers`);
      } else if (q === 'targetCount') {
        const id = node.value['id'];
        if (typeof id === 'string' && !visibleTargets(node).has(id)) out('unknown-target', node.path, `targetCount names target "${id}", which this ability does not declare`);
      }
    }

    function targetSpecChecks(node: WalkNode): void {
      const t = node.value;
      const id = t['id'];
      if (typeof id === 'string') targetPaths.set(id, [...(targetPaths.get(id) ?? []), node.path]);
      const { min, max } = t;
      const bad = (x: unknown): boolean => typeof x === 'number' && (!Number.isInteger(x) || x < 0);
      if (min === 'any') out('bad-target-count', `${node.path}/min`, '"any" cannot be a minimum number of targets');
      if (bad(min)) out('bad-target-count', `${node.path}/min`, 'a number of targets is a non-negative integer');
      if (bad(max)) out('bad-target-count', `${node.path}/max`, 'a number of targets is a non-negative integer');
      if (max === 0) out('bad-target-count', `${node.path}/max`, 'a target spec that allows no target is meaningless');
      if (typeof min === 'number' && typeof max === 'number' && min > max) out('bad-target-count', node.path, `minimum ${min} is above maximum ${max} (CR 601.2c)`);
      const visible = visibleTargets(node);
      // p2-modal-1 (CR 700.2, 115.3): "Each mode must target a different player": a mode's target may differ from another mode's (the targets of the chosen modes are
      // announced as one set, actions/announce-targets.ts); only `distinctFrom` sees them, never a reference of a mode's steps
      for (const a of ancestors(node)) {
        if (ABILITY_DEFS.has(a.def)) break;
        if (a.def !== 'EffectProgram') continue;
        for (const o of arr(rec(a.value['modes'])['options'])) for (const sp of arr(rec(o['program'])['targets'])) if (typeof sp['id'] === 'string' && !visible.has(sp['id'])) visible.set(sp['id'], sp);
      }
      for (const d of (t['distinctFrom'] as unknown[] | undefined) ?? []) {
        if (d === id) out('bad-distinct', `${node.path}/distinctFrom`, `target "${String(id)}" cannot differ from itself`);
        else if (typeof d !== 'string' || !visible.has(d)) out('bad-distinct', `${node.path}/distinctFrom`, `distinctFrom names "${String(d)}", which is not a spec of the same ability`);
      }
    }

    /** CR 604.3a: a CDA defines the characteristics of its own object, and is not conditional. */
    function cdaChecks(node: WalkNode): void {
      if (rec(node.value['affects'])['ref'] !== 'self') {
        out('bad-layer', `${node.path}/affects`, 'a characteristic-defining ability defines the characteristics of its own object, not of others (CR 604.3a)');
      }
      const owner = node.parent;
      if (owner !== null && owner.def === 'StaticAbilityDef' && owner.value['condition'] !== undefined) {
        out('bad-layer', `${owner.path}/condition`, 'a characteristic-defining ability is not conditional (CR 604.3a)');
      }
    }

    function modeChecks(node: WalkNode): void {
      const m = node.value;
      if (typeof m['min'] === 'number' && m['allowRepeat'] !== true && arr(m['options']).length > 0 && m['min'] > arr(m['options']).length) {
        out('executable-gap', `${node.path}/min`, `the minimum ${String(m['min'])} is more than the ${arr(m['options']).length} modes, and a mode cannot be chosen twice (CR 700.2d)`);
      }
      if (arr(m['options']).length === 0) out('executable-gap', `${node.path}/options`, 'a modal ability needs at least one mode (CR 700.2)');
      if (m['min'] === 'any') out('bad-target-count', `${node.path}/min`, '"any" cannot be a minimum number of modes');
      if (typeof m['min'] === 'number' && typeof m['max'] === 'number' && m['min'] > m['max']) out('bad-target-count', node.path, 'the minimum number of modes is above the maximum (CR 700.2)');
    }

    function modificationChecks(node: WalkNode): void {
      const m = node.value;
      const layer = m['layer'];
      const parent = node.parent;
      const isEffect = parent !== null && parent.def === 'ContinuousEffectDef';
      if (isEffect && layer === '7a' && parent.value['cda'] !== true) {
        out('bad-layer', node.path, 'layer 7a is for characteristic-defining abilities only (CR 613.4a): set cda, or use layer 7b/7c');
      }
      if (isEffect && parent.value['cda'] === true && !CDA_LAYERS.includes(layer)) {
        out('bad-layer', node.path, `a characteristic-defining ability sets color, subtypes or power/toughness, not layer ${String(layer)} (CR 604.3)`);
      }
      if (isEffect && parent.value['cda'] === true && layer === 4 && (m['types'] !== undefined || m['supertypes'] !== undefined)) {
        out('bad-layer', node.path, 'a characteristic-defining ability defines subtypes, not card types or supertypes (CR 604.3a)');
      }
      for (const k of ['power', 'toughness']) {
        if (typeof m[k] === 'number' && !Number.isInteger(m[k])) out('executable-gap', `${node.path}/${k}`, `"${k}" is a whole number (CR 107.1)`);
      }
      // Cloud std-woe (CR 108.4, 613.1b): an object has one controller, so a control-changing effect gives it to one player, never to a set of players ("each opponent")
      const to = rec(m['controller'])['ref'];
      if (layer === 2 && (to === 'each' || to === 'otherOpponents')) out('bad-layer', `${node.path}/controller`, 'a control-changing effect gives control to one player, not to each of several (CR 108.4, 613.1b)');
      const payload: Record<string, boolean> = {
        '4': m['types'] !== undefined || m['subtypes'] !== undefined || m['supertypes'] !== undefined || m['named'] !== undefined,
        '5': m['colors'] !== undefined && Object.keys(rec(m['colors'])).length > 0,
        '6': m['add'] !== undefined || m['removeAll'] === true || m['remove'] !== undefined || m['cantHave'] !== undefined || m['addActivatedOf'] !== undefined, // r5-static
        '7a': m['power'] !== undefined || m['toughness'] !== undefined,
        '7b': m['power'] !== undefined || m['toughness'] !== undefined,
        '7c': m['power'] !== undefined || m['toughness'] !== undefined,
      };
      const key = String(layer);
      if (key in payload && !payload[key]) out('bad-layer', node.path, `a layer ${key} modification changes nothing`);
    }

    function stepChecks(node: WalkNode): void {
      const s = node.value;
      for (const k of Object.keys(s)) {
        const x = s[k];
        if (typeof x === 'number' && (!Number.isInteger(x) || x < 0)) out('executable-gap', `${node.path}/${k}`, `"${k}" is a whole number that is not negative (CR 107.1)`);
      }
      if (s['op'] === 'manual' && inManaEffect(node)) out('ask-position', node.path, MANA_ASK);
      switch (s['op']) {
        case 'damage':
          if (s['divided'] === 'announced') {
            const divides = [...visibleTargets(node).values()].filter((t) => rec(t['divide'])['what'] === 'damage');
            if (divides.length === 0) {
              out('bad-divide', node.path, 'divided:"announced" needs a target spec with divide.what "damage" (CR 601.2d)');
            } else if (typeof s['amount'] === 'number' && divides.every((t) => typeof rec(t['divide'])['total'] === 'number' && rec(t['divide'])['total'] !== s['amount'])) {
              out('bad-divide', `${node.path}/amount`, `the damage is ${String(s['amount'])}, but the division announced is of ${String(rec(divides[0]!['divide'])['total'])} (CR 601.2d)`);
            }
          }
          break;
        case 'addMana':
          if ((s['units'] === undefined) === (s['dynamic'] === undefined)) out('executable-gap', node.path, 'addMana needs exactly one of `units` and `dynamic` (design 3.2)');
          break;
        case 'chooseValue':
          if (s['what'] === 'option' && arr(s['options']).length === 0) out('executable-gap', node.path, 'a choice among options needs the options');
          break;
        case 'rollDie': {
          if (typeof s['sides'] !== 'number' || s['sides'] < 1) out('executable-gap', `${node.path}/sides`, 'a die has at least one side (CR 706)');
          const rows = arr(s['table']);
          rows.forEach((row, i) => {
            const { min, max } = row;
            if (typeof min !== 'number' || typeof max !== 'number' || min > max || min < 1 || (typeof s['sides'] === 'number' && max > s['sides'])) {
              out('executable-gap', `${node.path}/table/${i}`, `a die table row is a range inside 1..${String(s['sides'])} (CR 706.2)`);
            } else if (rows.slice(0, i).some((o) => typeof o['min'] === 'number' && typeof o['max'] === 'number' && o['min'] <= max && min <= o['max'])) {
              out('executable-gap', `${node.path}/table/${i}`, 'die table rows overlap (CR 706.2)');
            }
          });
          break;
        }
        case 'effect':
          if (arr(s['effects']).length === 0) out('executable-gap', `${node.path}/effects`, 'an effect step with no effect does nothing');
          break;
        case 'copy': {
          // CR 707.10: a copy of a spell or ability is a copy of an object on the stack; a target that is a permanent would be skipped (WP23 review)
          const what = rec(s['what']);
          const spec = what['ref'] === 'target' && typeof what['id'] === 'string' ? visibleTargets(node).get(what['id']) : undefined;
          if (s['result'] === 'spell' && spec !== undefined && !['spell', 'ability', 'stackObject'].includes(String(spec['kind']))) {
            out('executable-gap', `${node.path}/what`, `a spell copy of a target that is not on the stack (target kind ${String(spec['kind'])}, CR 707.10)`);
          }
          break;
        }
        case 'pay':
          // CR 107.3f: an X in a cost paid on resolution is chosen by the payer then; the pay handler reads an announced X (CR 601.2b, 602.2b), and r5-cost: in an
          // ability that announced none, the controller's own "you may pay {X}" once (effects/handlers/pay.ts#choosesX); anyone else's payment is still a gap
          // ... and never when a target of the ability reads X: its targets are chosen before the payment (CR 603.3d), when X is not chosen yet (Relentless Dead)
          if (hasVariableMana(s['cost']) && !announcesX() && (!(rec(s['who'])['ref'] === 'you' && s['times'] === undefined && s['mandatory'] !== true && s['else'] === undefined) || targetsReadX())) {
            out('executable-gap', `${node.path}/cost`, 'a payment with {X} on resolution needs the payer to choose X (CR 107.3f), which this build does not do; X is announced only by a spell with X in its mana cost or an activated ability with X in its cost');
          }
          break;
        default:
      }
    }

    /** r5-cost: a target spec of the ability itself (not of a reflexive trigger, chosen after the payment) that reads X. */
    function targetsReadX(): boolean {
      const eff = rec(rec(root)['effect']);
      return JSON.stringify([eff['targets'] ?? [], ...arr(rec(eff['modes'])['options']).map((o) => rec(o['program'])['targets'] ?? [])]).includes('"q":"X"');
    }

    /** A variable mana symbol ({X}) in a cost. */
    function hasVariableMana(cost: unknown): boolean {
      return arr(rec(cost)['mana']).some((m) => m['kind'] === 'variable');
    }

    /** Whether X of this ability is announced (CR 601.2b, 602.2b): a spell of a card with {X} in its mana cost, or an activated ability with {X} in its cost. */
    function announcesX(): boolean {
      const r = rec(root);
      if (r['kind'] === 'activated') return hasVariableMana(r['cost']);
      return r['kind'] === 'spell' && ctx.cardHasX !== false;
    }

    /** std-lci: a step beside `addMana` that the mana-ability resolver runs as written (see activatedChecks). */
    function resolverManaStep(st: Record<string, unknown>): boolean {
      if (st['guard'] !== undefined || st['as'] !== undefined) return false;
      if (st['op'] === 'removeCounters') return rec(st['from'])['ref'] === 'self';
      if (st['op'] === 'putCounters') return rec(st['on'])['ref'] === 'self';
      // CMD5 (CR 605.3b, 120.3): the source's fixed damage to its controller, "This land deals 1 damage to you." (model/cap-walk.ts#nativeManaEffect)
      if (st['op'] === 'damage') {
        const to = rec(st['to']);
        return rec(st['source'])['ref'] === 'self' && to['ref'] === 'you' && Object.keys(to).length === 1 && typeof st['amount'] === 'number';
      }
      // std-rx22 (CR 605.3b, 119.3): a fixed amount of life its controller gains, "You gain 1 life." (parser/lower/ability.ts#gainLifeYou)
      if (st['op'] === 'gainLife') {
        const who = rec(st['who']);
        return who['ref'] === 'you' && Object.keys(who).length === 1 && typeof st['amount'] === 'number';
      }
      // std-ry7 (CR 605.1a, 605.3b): a fixed draw by its controller, now or at a step ("Draw a card.", "Draw a card at the beginning of the next turn's upkeep."),
      // and the source staying tapped through its controller's next untap step (parser/lower/ability.ts#drawYou, #delayedDrawYou, #selfNoUntapNext)
      const drawYou = (x: Record<string, unknown>): boolean => {
        const who = rec(x['who']);
        return x['op'] === 'draw' && who['ref'] === 'you' && Object.keys(who).length === 1 && typeof x['count'] === 'number' && x['guard'] === undefined && x['as'] === undefined;
      };
      if (st['op'] === 'draw') return drawYou(st);
      if (st['op'] === 'delay') return arr(st['targets']).length === 0 && st['duration'] === undefined && rec(st['when'])['at'] === 'step' && arr(st['do']).length > 0 && arr(st['do']).every(drawYou);
      if (st['op'] === 'effect') {
        const d = rec(st['duration']);
        const effects = arr(st['effects']);
        const r = rec(effects[0]);
        const subject = rec(r['subject']);
        return d['d'] === 'throughNextUntap' && d['whose'] === 'you' && effects.length === 1 && r['s'] === 'restrict' && subject['ref'] === 'self' && Object.keys(subject).length === 1
          && r['mode'] === 'cant' && r['action'] === 'untapDuringUntapStep' && r['other'] === undefined;
      }
      if (st['op'] !== 'if') return false;
      const lists = [st['then'], ...(st['else'] !== undefined ? [st['else']] : [])];
      return lists.every((l) => Array.isArray(l) && l.length > 0 && l.every((x) => rec(x)['op'] === 'addMana' && Array.isArray(rec(x)['units']) && rec(x)['guard'] === undefined));
    }

    /** r3-cost: "Add {R}. When you do, ..." (a reflexive trigger of the mana the ability adds, CR 603.12; the resolver runs it, the trigger uses the stack). */
    function reflexiveAfterMana(st: Record<string, unknown>, steps: Record<string, unknown>[]): boolean {
      const when = rec(st['when']);
      return st['op'] === 'reflexive' && st['guard'] === undefined && when['if'] === undefined && arr(st['targets']).length === 0 && steps.some((x) => x['op'] === 'addMana' && x['as'] === when['did']);
    }

    /** std-mana-12 (CR 605.3b, 106.1): "This creature becomes that color until end of turn." after the addMana step that records that color (parser/lower/ability.ts#selfManaColor). */
    function manaColorAfterMana(st: Record<string, unknown>, steps: Record<string, unknown>[]): boolean {
      const effects = arr(st['effects']);
      const e = rec(effects[0]);
      const mods = arr(e['mods']);
      const colors = rec(rec(mods[0])['colors']);
      return st['op'] === 'effect' && st['guard'] === undefined && st['as'] === undefined && rec(st['duration'])['d'] === 'endOfTurn' && effects.length === 1 && e['s'] === 'continuous'
        && rec(e['affects'])['ref'] === 'self' && mods.length === 1 && rec(mods[0])['layer'] === 5 && typeof colors['chosen'] === 'string' && Object.keys(colors).length === 1
        && steps.some((x) => x['op'] === 'addMana' && x['link'] === colors['chosen']);
    }

    function activatedChecks(node: WalkNode): void {
      const a = node.value;
      const effect = rec(a['effect']);
      if (a['isMana'] === true) {
        if (arr(effect['targets']).length > 0) out('executable-gap', node.path, 'a mana ability has no target (CR 605.1a)');
        if (a['isLoyalty'] === true) out('executable-gap', node.path, 'an ability cannot be both a mana ability and a loyalty ability (CR 605.1a)');
        if (!JSON.stringify(effect).includes('"op":"addMana"')) out('executable-gap', node.path, 'a mana ability without an addMana step', 'warning');
        // CR 605.3b: the mana path (rules/mana.ts) runs only top-level addMana steps; any other instruction would be skipped (WP23 review). std-lci: except a
        // counter put on or removed from the object itself and a choice between plain productions ("add {G}{G} instead"): an effect without plain units goes
        // to the resolver, which runs every step at once (effects/mana-ability.ts; model/cap-walk.ts#nativeManaEffect, parser/lower/ability.ts#onlyAddMana)
        // r3-cost (CR 603.12): and a reflexive trigger with no targets that waits for an addMana step of the effect (parser/lower/ability.ts#reflexiveAfterMana)
        else if (effect['modes'] !== undefined || arr(effect['steps']).some((st) => st['op'] !== 'addMana' && !resolverManaStep(st) && !reflexiveAfterMana(st, arr(effect['steps'])) && !manaColorAfterMana(st, arr(effect['steps'])))) {
          out('executable-gap', `${node.path}/effect`, 'a mana ability whose instructions are not all addMana steps: the mana path would skip the others (CR 605.3b)');
        }
      }
      // std-r9: or "−X" (cost.loyaltyX, CR 606.4, 107.3a), never both
      if (a['isLoyalty'] === true && (rec(a['cost'])['loyalty'] === undefined) === (rec(a['cost'])['loyaltyX'] === undefined)) out('executable-gap', `${node.path}/cost`, 'a loyalty ability needs cost.loyalty or cost.loyaltyX, not both (CR 606.4)');
    }
  }, { path: base });

  for (const [id, paths] of targetPaths) {
    if (paths.length < 2) continue;
    const modal = paths.some((p) => p.includes('/modes/options/'));
    out(modal ? 'modal-ids' : 'duplicate-target', paths[1]!, `${modal ? 'target ids must be unique across all modes' : 'duplicate target id'} "${id}" (also ${paths[0]!}) (design 2.3, CR 608.2b)`);
  }
}
