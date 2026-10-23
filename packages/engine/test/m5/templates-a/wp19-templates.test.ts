/**
 * WP19 (design 15.2): the template files of package A are well formed (design 6.3, 6.9; guard G9's static half).
 *
 *  - every template compiles, cites at least one rule, has at least two examples and two counter-examples (design 6.9 step 3), and ids are unique across the
 *    bootstrap templates and the five files;
 *  - each file holds only its own kind of template: trigger.json `trigger`, cost.json `cost`, keyword.json `ability` templates that build a keyword ability,
 *    condition.json effect templates that build an `if` step, duration.json effect templates that build a continuous `effect` step with a stated duration;
 *  - every cited rule exists in the Comprehensive Rules (checked when `rules/cr/` is present: it is git-ignored, so a worktree may set OPENMTG_RULES_DIR);
 *  - examples carry no Wizards text (design 6.10): they are not a line of any card of the local index (when `.cache/` exists).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { BOOTSTRAP_TEMPLATES } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { ALL, localIndex, WP19_FILES, WP19_TEMPLATES } from './support';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

describe('WP19 template files: well formed (design 6.3, 6.9)', () => {
  it('compile, cite rules, have two examples and two counter-examples each; ids are unique across bootstrap and WP19', () => {
    expect(validateTemplates(ALL)).toEqual([]);
    for (const t of WP19_TEMPLATES) {
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.cr.every((c) => /^CR \d{3}(\.\d+[a-z]?)?$/.test(c)), `${t.id}: ${t.cr.join(', ')}`).toBe(true);
      expect(t.since, t.id).toBe(1);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
    }
    const ids = new Set(BOOTSTRAP_TEMPLATES.map((t) => t.id));
    for (const t of WP19_TEMPLATES) expect(ids.has(t.id), `${t.id} duplicates a bootstrap id`).toBe(false);
  });

  it('ids carry the file prefix (trg., cost., kw., cond., dur.)', () => {
    const prefix: Record<string, string> = { 'trigger.json': 'trg.', 'cost.json': 'cost.', 'keyword.json': 'kw.', 'condition.json': 'cond.', 'duration.json': 'dur.' };
    for (const [file, list] of Object.entries(WP19_FILES)) for (const t of list) expect(t.id.startsWith(prefix[file]!), `${file}: ${t.id}`).toBe(true);
  });

  it('CR 603.1: trigger.json holds trigger templates whose build is a TriggerDef ({on: [...]}, optional batch)', () => {
    for (const t of WP19_FILES['trigger.json']!) {
      expect(t.kind, t.id).toBe('trigger');
      const b = t.build as Record<string, unknown>;
      expect(isRec(b) && (b['on'] === '$e' || Array.isArray(b['on'])), t.id).toBe(true);
      expect(Object.keys(b).every((k) => k === 'on' || k === 'batch'), t.id).toBe(true);
    }
  });

  it('CR 118.3: cost.json holds cost templates whose build is one CostPart', () => {
    for (const t of WP19_FILES['cost.json']!) {
      expect(t.kind, t.id).toBe('cost');
      expect(typeof (t.build as { kind?: unknown }).kind, t.id).toBe('string');
    }
  });

  it('CR 702.1: keyword.json holds ability templates that build one keyword ability', () => {
    for (const t of WP19_FILES['keyword.json']!) {
      expect(t.kind, t.id).toBe('ability');
      expect((t.build as { kind?: unknown }).kind, t.id).toBe('keyword');
    }
  });

  it('CR 608.2c: condition.json holds effect templates that build an "if" step consuming "if"', () => {
    for (const t of WP19_FILES['condition.json']!) {
      expect(t.kind, t.id).toBe('effect');
      expect((t.build as { op?: unknown }).op, t.id).toBe('if');
      expect(t.consumes, t.id).toContain('if');
    }
  });

  it('CR 611.2a: duration.json holds effect templates that build a continuous effect with the stated duration', () => {
    for (const t of WP19_FILES['duration.json']!) {
      expect(t.kind, t.id).toBe('effect');
      const b = t.build as { op?: unknown; duration?: unknown; effects?: { s?: unknown }[] };
      expect(b.op, t.id).toBe('effect');
      expect(b.duration, t.id).toBe('$d');
      expect(b.effects?.every((e) => e.s === 'continuous'), t.id).toBe(true);
    }
  });

  it('every template that is listed as higher priority builds a single pattern (it outranks the composed Event reading only where the renderer prints it)', () => {
    for (const t of WP19_TEMPLATES.filter((x) => (x.priority ?? 0) > 0)) {
      expect(t.kind, t.id).toBe('trigger');
      expect(Array.isArray((t.build as { on?: unknown }).on) && ((t.build as { on: unknown[] }).on.length === 1), t.id).toBe(true);
    }
  });
});

/** rules/cr of this checkout, of OPENMTG_RULES_DIR, or of the main checkout next to a worktree. */
function rulesDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '../../../../..');
  const candidates = [process.env['OPENMTG_RULES_DIR'], join(root, 'rules', 'cr'), join(root, '..', 'OpenMTG', 'rules', 'cr')].filter((x): x is string => typeof x === 'string' && x !== '');
  return candidates.find((p) => existsSync(p) && statSync(p).isDirectory());
}

function ruleNumbers(dir: string): Set<string> {
  const out = new Set<string>();
  const walk = (d: string): void => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.md')) for (const line of readFileSync(p, 'utf8').split('\n')) { const m = /^(\d{3}(?:\.\d+[a-z]?)?)\.? /.exec(line); if (m) out.add(m[1]!); }
    }
  };
  walk(dir);
  return out;
}

const RULES = rulesDir();

describe.skipIf(RULES === undefined)('WP19 template citations exist in the Comprehensive Rules (rules/cr)', () => {
  it('every "CR n" cited by a WP19 template is a rule of the edition in rules/cr', () => {
    const known = ruleNumbers(RULES!);
    const missing = WP19_TEMPLATES.flatMap((t: Template) => t.cr.map((c) => c.replace(/^CR /, '')).filter((n) => !known.has(n)).map((n) => `${t.id}: ${n}`));
    expect(missing).toEqual([]);
  });
});

const index = localIndex();

describe.skipIf(index === null)('WP19 test data hygiene (design 6.10) on the local Oracle index', () => {
  it('no example or counter-example is a line of a real card (synthetic wordings only)', () => {
    const lines = new Set<string>();
    for (const c of index!) for (const t of [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)]) for (const l of (t ?? '').split('\n')) lines.add(l.trim().toLowerCase());
    const clash: string[] = [];
    for (const t of WP19_TEMPLATES) for (const s of [...t.examples.map((e) => e.text), ...t.counterExamples]) {
      const words = s.trim().split(/\s+/).length;
      // a bare keyword ("Swampwalk", "Equip {4}") is a keyword's name, not prose; only sentences can carry someone's wording
      if (words > 3 && lines.has(s.trim().toLowerCase())) clash.push(`${t.id}: ${s}`);
    }
    expect(clash).toEqual([]);
  }, 60_000);
});
