/**
 * The checks parseCard runs on every ability it built before handing it out (design 6.8). Owner: WP17.
 *
 *  - G7 schema and semantic lint (model/validate.ts): an ability with an error is replaced by a manual ability (diagnostic `lint`).
 *  - G6 exact render gate (render/gate.ts): canonical English regenerated from the JSON alone must equal the Oracle line(s); a mismatch makes the ability
 *    manual (diagnostic `gate-mismatch`, both strings in the message). One-sided: a false reject costs automation, never correctness.
 * The ability is handed out AS BUILT, not canonicalized: model/canonical.ts drops defaults such as a library destination's `position: 'top'` (design 3.2), and the
 * renderer then prints "into its owner's library" where Oracle says "on top of", so the canonical form would fail the gate and display the wrong words for the
 * same meaning. Caches, snapshots and diffs canonicalize when they store (model/canonical.ts is idempotent and pure).
 *  - G11's compile-time twin, once more on the finished ability: a marker that survived lowering (`$...`, `'$link'`, `lower`) makes it manual.
 *  - The effect a manual triggered ability keeps (design 6.6: "Trigger now" runs it automatically) is checked the same way before it is handed out: no
 *    marker, no reference to the trigger event (a manual trigger has no event to read, CR 603.7c, as model/degrade.ts decides), the lint as a spell-shaped
 *    program, and the render gate against the effect's OWN text (the sentences after the trigger clause). Any failure drops the effect (the ability stays
 *    manual, without it); the gate result is what FaceParse.gate records for that ability.
 * Capability degrade (G8) and classification belong to cards/pipeline.ts (WP18): they need the engine's capability set.
 */
import type { AbilityDef, KeywordAbilityDef, ManualAbilityDef, SpellAbilityDef } from '../../types/ability';
import type { GateResult, RenderContext } from '../../render/api';
import { renderGate, renderGateKeywordLine } from '../../render/gate';
import { validateAbility } from '../../model/validate';
import type { Diagnostic } from '../types';
import type { KeptEffect } from './ability';
import { leftoverMarker, visit } from './util';

/** The gate entry of a manual ability (FaceParse.gate is aligned with the abilities; manual abilities are not gated). */
export const NOT_GATED: GateResult = Object.freeze({ ok: false, rendered: '', expected: '' }) as GateResult;

const shapeOf = (def: AbilityDef): ManualAbilityDef['shape'] =>
  def.kind === 'spell' ? 'spell' : def.kind === 'activated' ? 'activated' : def.kind === 'triggered' ? 'triggered' : def.kind === 'static' || def.kind === 'keyword' ? 'static' : 'unknown';

/**
 * The manual ability that replaces a refused one: the understood cost of an activated ability is kept (the engine still makes players pay it), and so are
 * its restrictions and its mana-ability status (a mana ability run by hand still does not use the stack, CR 605.3b), as model/degrade.ts keeps them:
 * `onlyIf` becomes `{cond:'ask'}` (the controller attests it, CR 602.5b).
 */
export function demote(def: AbilityDef, reason: string): ManualAbilityDef {
  const m: ManualAbilityDef = { kind: 'manual', text: def.text, reason, shape: shapeOf(def), prov: { by: 'fallback' } };
  if (def.src) m.src = [...def.src];
  if (def.label !== undefined) m.label = def.label;
  if (def.kind === 'activated') {
    m.cost = def.cost;
    if (def.isMana) m.mana = true;
    if (def.sorcerySpeed) m.sorcerySpeed = true;
    if (def.limit) m.limit = def.limit;
    if (def.onlyIf) m.onlyIf = def.onlyIf.cond === 'ask' ? def.onlyIf : { cond: 'ask', text: def.text };
    if (def.zone) m.zone = [...def.zone];
  }
  if (def.kind === 'triggered') {
    if (def.limit) m.limit = def.limit;
    if (def.zone) m.zone = [...def.zone];
  }
  return m;
}

/** Does a program read the trigger event (an event role, the event's amount)? Nested abilities (quoted) have events of their own. */
function readsEvent(effect: unknown): boolean {
  let found = false;
  visit(effect, (n) => {
    if (typeof n['kind'] === 'string' && ['activated', 'triggered', 'static', 'keyword', 'spell', 'manual', 'chapter'].includes(n['kind'] as string)) return false;
    if (n['ref'] === 'event' || n['q'] === 'eventAmount') found = true;
    return undefined;
  });
  return found;
}

/** Check the effect a manual ability keeps (design 6.6); returns the ability (with or without it), its gate result and the diagnostics. */
function verifyKept(input: ManualAbilityDef, kept: KeptEffect | undefined, ctx: RenderContext, opts: { cardHasX: boolean; cyclingX?: boolean; layout: string }): Verified {
  const effect = input.effect!;
  const drop = (why: string, gate: GateResult = NOT_GATED): Verified => {
    const { effect: _dropped, ...rest } = input;
    return { def: { ...rest, reason: `${input.reason}; the understood effect is not kept: ${why}` }, gate, diagnostics: [{ level: 'manual', code: 'lint', message: `kept effect dropped (design 6.6): ${why}: "${input.text}"` }] };
  };
  if (kept === undefined) return drop('no text to check it against');
  const left = leftoverMarker(effect);
  if (left !== null) return drop(`an unresolved ${left} marker`);
  if (input.shape === 'triggered' && readsEvent(effect)) return drop('it reads the trigger event, which a manual trigger does not have (CR 603.7c)');
  const asSpell: SpellAbilityDef = { kind: 'spell', text: kept.lines.join('\n'), effect };
  const issues = validateAbility(asSpell, { cardHasX: opts.cardHasX, layout: opts.layout }).filter((i) => i.severity === 'error');
  if (issues.length > 0) return drop(`lint: ${issues[0]!.code} at ${issues[0]!.path || '/'}: ${issues[0]!.message}`);
  const gate = renderGate(asSpell, kept.lines, { ...ctx, oracleLines: kept.lines });
  if (!gate.ok) return drop(`gate-mismatch: rendered "${gate.rendered}", Oracle "${gate.expected}"`, gate);
  return { def: input, gate, diagnostics: [] };
}

export interface Verified { def: AbilityDef; gate: GateResult; diagnostics: Diagnostic[] }

/** Lint and gate one ability. `oracleLines`: the ability's Oracle line(s), label removed. */
export function verifyAbility(input: AbilityDef, oracleLines: string[], ctx: RenderContext, opts: { cardHasX: boolean; cyclingX?: boolean; layout: string; gateForm?: AbilityDef; kept?: KeptEffect }): Verified {
  if (input.kind === 'manual') return input.effect === undefined ? { def: input, gate: NOT_GATED, diagnostics: [] } : verifyKept(input, opts.kept, ctx, opts);
  const def = input;
  const left = leftoverMarker(def);
  if (left !== null) {
    const reason = `lint: an unresolved ${left} marker after lowering (design 6.5 pass 10)`;
    return { def: demote(def, reason), gate: NOT_GATED, diagnostics: [{ level: 'manual', code: 'lint', message: `${reason}: "${def.text}"` }] };
  }
  // r4-fxz (CR 400.7, 601.2i, 707.10): "you've cast another spell this turn" is a cast other than this object (parser/holes/cond.ts, rules/history.ts compares
  // the cast entry's spell with the source). Only an instant's or sorcery's spell ability is that spell as it resolves; a permanent, a card in another zone or
  // a triggered ability's source is a new object, never the spell it was, so its own spell would count as "another": refused
  // (wave 7, CR 113.6k, 603.4: an ability that functions only while its card is a spell on the stack, r3-trig's "When you cast this spell, if you've cast
  // another spell this turn, copy this spell." (Sage of the Skies), has that spell as its source: its own cast is not "another", so it is not refused)
  const onStackOnly = 'zone' in def && Array.isArray(def.zone) && def.zone.length > 0 && def.zone.every((z) => z === 'stack');
  if (!onStackOnly && (def.kind !== 'spell' || !(ctx.selfTypes ?? []).some((t) => t === 'Instant' || t === 'Sorcery')) && /"cond":"happened","event":\{"ev":"cast"[^{}]*"spell":\{[^{}]*"other":true/.test(JSON.stringify(def))) {
    const reason = '"another spell" in the turn\'s history of an object that is not that spell: its own spell would count (CR 400.7, 601.2i)';
    return { def: demote(def, reason), gate: NOT_GATED, diagnostics: [{ level: 'manual', code: 'lint', message: `${reason}: "${def.text}"` }] };
  }
  const issues = validateAbility(def, { cardHasX: opts.cardHasX, ...(opts.cyclingX === true ? { cyclingX: true } : {}), layout: opts.layout }).filter((i) => i.severity === 'error');
  if (issues.length > 0) {
    const first = issues[0]!;
    const reason = `lint: ${first.code} at ${first.path || '/'}: ${first.message}`;
    return { def: demote(def, reason), gate: NOT_GATED, diagnostics: [{ level: 'manual', code: 'lint', message: `${reason}: "${def.text}"` }] };
  }
  // the gate checks the untainted form when taint changed the program: what was understood must mean the text (design 6.8 G6)
  const gated = opts.gateForm ? ({ ...opts.gateForm, ...(def.label !== undefined ? { label: def.label } : {}) } as AbilityDef) : def;
  const gate = gated.kind === 'keyword' ? renderGateKeywordLine([gated as KeywordAbilityDef], oracleLines, ctx) : renderGate(gated, oracleLines, ctx);
  if (!gate.ok) {
    const reason = `gate-mismatch: rendered "${gate.rendered}", Oracle "${gate.expected}"`;
    return { def: demote(def, reason), gate, diagnostics: [{ level: 'manual', code: 'gate-mismatch', message: reason }] };
  }
  return { def, gate, diagnostics: [] };
}
