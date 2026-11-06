/**
 * The semantic lint of ability JSON: bound names, target ids, event roles, layers, `ask` positions (the issue codes of model/api.ts). Owner: WP1.
 *
 * Assumes a well-formed tree (model/validate.ts runs the schema first). Two passes per ability scope: model/lint-nodes.ts (checks a node and its
 * ancestors can decide) and model/lint-flow.ts (what earlier steps bound). An ability nested inside a node (a token's, a granted one, a class
 * level's) is its own scope: names, target ids and X do not cross the boundary.
 */
import type { Issue, ValidateAbility, ValidateContext } from './api';
import { allNamesOf, lintFlow } from './lint-flow';
import { lintNodes } from './lint-nodes';
import { ancestors, type WalkNode } from './walk';

function lintScope(def: unknown, base: string, ctx: ValidateContext, issues: Issue[], outer?: ReadonlySet<string>): void {
  const nested: WalkNode[] = [];
  lintNodes(def, base, ctx, issues, (n) => nested.push(n));
  lintFlow(def, base, issues, outer);
  const isStatic = typeof def === 'object' && def !== null && (def as { kind?: unknown }).kind === 'static';
  for (const n of nested) {
    const { grantedScope: _outer, ...inner } = ctx;
    // edh-d-91 (CR 607.2a, 613.1f; Timothar): an ability a RESOLVED effect grants (layer 6 `add` inside an effect step) may read the names its granting resolution bound (lasting-fix.ts#fixOuterNames)
    lintScope(n.value, n.path, isStatic && grantedByLayer6(n) ? { ...inner, grantedScope: true } : inner, issues, !isStatic && grantedByEffect(n) ? allNamesOf(def) : undefined);
  }
}

/** edh-d-91: the nested ability is in the `add` of a layer 6 modification of an `effect` step (a resolved effect's grant). */
function grantedByEffect(n: WalkNode): boolean {
  let layer6 = false;
  for (const a of ancestors(n)) {
    if (a.value['layer'] === 6 && n.path.startsWith(`${a.path}/add/`)) layer6 = true;
    if (a.def === 'EffectStep') return layer6 && a.value['op'] === 'effect';
  }
  return false;
}

/** r4-static: the nested ability is in the `add` of a layer 6 modification, with no effect step between (a static ability's grant, not a resolved effect's). */
function grantedByLayer6(n: WalkNode): boolean {
  for (const a of ancestors(n)) {
    if (a.def === 'EffectStep') return false;
    if (a.value['layer'] === 6 && n.path.startsWith(`${a.path}/add/`)) return true;
  }
  return false;
}

export const lintAbility: ValidateAbility = (def, ctx = {}) => {
  const issues: Issue[] = [];
  lintScope(def, '', ctx, issues);
  return issues;
};
