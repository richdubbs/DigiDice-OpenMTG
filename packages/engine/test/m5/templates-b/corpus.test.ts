/**
 * WP20 corpus checks on the local Oracle index (git-ignored; skipped when absent; set OPENMTG_CACHE_DIR in a worktree).
 *
 *  - Guard G10 (design 6.8), until WP25's whole-index snapshot exists: adding the WP20 templates to the bootstrap set changes no ability that was automated
 *    without them (an ability with no manual node anywhere must come out identical), on a deterministic eighth of the index (every 8th card); on the same
 *    cards, contract C1 and guard G4 with the WP20 templates: no face ends in a parser error, every ledger tiles.
 *  - The abilities WP20 NEWLY automates (review fix: G10 checks only the old ones), on the same cards: none reads a filter bound to the source or to a trigger
 *    event role (the shape of the wrong "they"/"its" bindings, CR 608.2c, design 6.4) unless reviewed below, and every newly automated mana ability that
 *    classifies `full` has a shape rules/mana.ts runs as written (CR 602.5b, 605.1a, 605.3a). Since FAST5X E5 (MX8, merge 171cf8f2) the native path
 *    checks a mana ability's own activation restrictions ("Activate only if ...", "only once each turn", "only as a sorcery": CR 605.1a, 602.5b, 602.5d)
 *    and pays a mana cost and the other cost parts ("{1}, {T}", "Pay 1 life", "Tap an untapped creature you control", "Remove a charge counter from ~",
 *    "Sacrifice a Food": CR 605.3a, 118.3, 602.2b; test/fast5x/e5/native-mana.test.ts, test/fast5/fix-guards), so the guard flags only what it refuses: an attested
 *    condition, a per-combat limit, a zone other than the battlefield (CR 113.6) and a cost rules/mana.ts#manaCostShape calls `unsupported`.
 *  - Design 6.9: a template with fewer than 20 corpus matches is experimental unless three independently verified golden cards verify it. A match is an
 *    ACCEPTED use (review fix): a card whose ledger has a span consumed by the template, not a card whose parse merely tried it (`templatesUsed` also lists
 *    derivations that the gate, the lint or the taint pass rejected). Counted on the WHOLE index with the bootstrap + WP20 templates. This pass takes about
 *    40 s, so it runs only with OPENMTG_CORPUS_FULL=1 (it was run when the statuses were set). No template is stable by golden cards: the piles checks of
 *    golden.test.ts compare against this package's own program, which is not an independent verification.
 *
 * Measured when WP20 was written (34,473 index lines): cards whose every ability is automated by `parseCard` went from 3,195 (bootstrap) to 4,331
 * (bootstrap + WP20); automated abilities from 18,542 to 21,581 (before the capability degrade of WP18); no formerly automated ability changed. After the
 * review fixes, 3,032 abilities are newly automated, none with a filter bound to the source or to an event role.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, ActivatedAbilityDef } from '../../../src/types/ability';
import { parseCard } from '../../../src/parser/parse';
import { canonicalJson } from '../../../src/parser/holes';
import { faceContexts, ledgerProblems, normalizeText } from '../../../src/parser/preprocess';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions } from '../../../src/parser/parse';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { classifyAbility } from '../../../src/model/classify';
import { manaCostShape } from '../../../src/rules/mana';
import { SLOW, slowTitle } from '../../slow';
import { WP20, automated, localIndex, options } from './support';

// QT: about 13 s; a slow suite (npm run test:all). The index is read only when the suite runs.
const index = SLOW ? localIndex() : null;

/** Newly automated abilities whose filter is bound to the source or to an event role and that a reviewer found right ("card name: ability text"). */
const REVIEWED_FILTER_BINDINGS: ReadonlySet<string> = new Set<string>();

/** The references (`ref`) used inside any filter of a value. */
function filterRefs(v: unknown, inFilter = false, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => filterRefs(x, inFilter, out));
  else if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (inFilter && typeof o['ref'] === 'string') out.push(String(o['ref']));
    for (const [k, x] of Object.entries(o)) filterRefs(x, inFilter || k === 'filter', out);
  }
  return out;
}

/**
 * Why rules/mana.ts could not run this mana ability as written (rules/mana.ts#manaAbilityDenial, rules/timing.ts#activationRestrictionDenial), or null.
 * FAST5 fix-guards: mirrors the native path as FAST5X E5 left it (see the header): restrictions and costs it checks and pays are no longer flagged.
 */
function nonNativeMana(a: ActivatedAbilityDef): string | null {
  // CR 602.5b, 605.3a: nobody is asked while mana abilities are activated for a payment, so the restriction reader refuses an attested condition
  if (a.onlyIf !== undefined && JSON.stringify(a.onlyIf).includes('"cond":"ask"')) return 'attested activation restriction (CR 602.5b)';
  if (a.limit?.per === 'combat') return 'activation limit per combat (CR 602.5b)'; // rules/timing.ts refuses it (no combat number kept)
  if (a.zone !== undefined && !(a.zone.length === 1 && a.zone[0] === 'battlefield')) return 'zone (CR 113.6)';
  if (manaCostShape(a) === 'unsupported') return 'cost the native path cannot pay (CR 605.3a, 118.3)';
  return null;
}

describe.skipIf(!SLOW || index === null)(slowTitle('WP20 corpus (local Oracle index)'), () => {
  it('guard G10, C1 and G4 on every 8th card: no formerly automated ability changes, no parser error, every ledger tiles; newly automated abilities have no unreviewed filter binding and no mana ability the native path cannot run', () => {
    const before = defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES] }); // W3b: the default is the whole template set
    const after = options();
    const changed: string[] = [];
    const suspicious: string[] = [];
    let compared = 0;
    let fresh = 0;
    for (let i = 0; i < index!.length; i += 8) {
      const c = index![i]!;
      const a = parseCard(c, before);
      const b = parseCard(c, after);
      const ctxs = faceContexts(c, after);
      a.faces.forEach((fa, k) => {
        const fb = b.faces[k]!;
        if (fb.diagnostics.some((d) => d.code === 'parser-error')) changed.push(`${c.name}: parser-error`);
        const p = ledgerProblems(normalizeText(ctxs[k]?.text ?? '').text, fb.ledger);
        if (p.length > 0) changed.push(`${c.name} face ${k}: ${p[0]}`);
        for (const x of fa.abilities) {
          if (!automated([x])) continue;
          compared++;
          const y = fb.abilities.find((z) => z.text === x.text && z.kind === x.kind);
          if (!y || canonicalJson(x) !== canonicalJson(y)) changed.push(`${c.name}: ${x.text}`);
        }
        for (const y of fb.abilities) {
          if (!automated([y]) || fa.abilities.some((x) => x.text === y.text && x.kind === y.kind && automated([x]))) continue;
          fresh++;
          const key = `${c.name}: ${y.text}`;
          const refs = filterRefs(y);
          if ((refs.includes('self') || refs.includes('event')) && !REVIEWED_FILTER_BINDINGS.has(key)) suspicious.push(`${key} (filter bound to ${refs.join(', ')})`);
          if (y.kind === 'activated' && y.isMana === true && classifyAbility(y, ENGINE_CAPABILITIES).level === 'full') {
            const why = nonNativeMana(y);
            if (why !== null) suspicious.push(`${key} (full mana ability with ${why})`);
          }
        }
      });
    }
    expect(compared).toBeGreaterThan(1500);
    expect(fresh).toBeGreaterThan(250);
    expect(changed.slice(0, 20)).toEqual([]);
    expect(suspicious.slice(0, 20)).toEqual([]);
  }, 300_000);

  it.skipIf(process.env['OPENMTG_CORPUS_FULL'] !== '1')('design 6.9 on the whole index: every stable template has at least 20 cards with an accepted use; every template is used by a card', () => {
    const opts = options();
    const accepted = new Map<string, number>(WP20.map((t) => [t.id, 0]));
    const tried = new Map<string, number>(WP20.map((t) => [t.id, 0]));
    let automatedAbilities = 0;
    for (const c of index!) {
      const res = parseCard(c, opts);
      const ok = new Set<string>();
      const used = new Set<string>();
      res.faces.forEach((f) => {
        for (const id of f.templatesUsed) used.add(id);
        for (const e of f.ledger) if (e.status === 'consumed' && e.by !== undefined) for (const id of e.by.split(',')) ok.add(id);
        automatedAbilities += f.abilities.filter((a: AbilityDef) => automated([a])).length;
      });
      for (const id of ok) if (accepted.has(id)) accepted.set(id, accepted.get(id)! + 1);
      for (const id of used) if (tried.has(id)) tried.set(id, tried.get(id)! + 1);
    }
    expect(automatedAbilities).toBeGreaterThan(20_000);
    for (const t of WP20) {
      if (t.status === 'stable') expect(accepted.get(t.id)!, `${t.id}: ${accepted.get(t.id)} cards accepted (${tried.get(t.id)} tried)`).toBeGreaterThanOrEqual(20);
      expect(accepted.get(t.id), `${t.id} is accepted on no card of the index`).toBeGreaterThan(0);
    }
  }, 300_000);
});
