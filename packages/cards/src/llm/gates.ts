/**
 * The validation pipeline of the LLM compile step (design 11.3): a reply is rejected at the first failing gate. Pure apart from the injectable smoke
 * test (gate 7 runs the real engine through `applyAction`).
 *
 *   1 json       the reply parses; the top level is { faces: [ { abilities: [...] } x faces ] }
 *   2 schema     every ability against the generated schema (stored form: display fields optional; they are stripped anyway)
 *     authority  every ability names `src` lines, all of them lines the parser left manual and the tool requested (design 11.1: LLM output only
 *                overlays a unit the parser left manual; it never replaces a unit the parser accepted); no string of the stored form contains card
 *                text (design 11.4: names and Oracle text never enter the cache; `reason`s are replaced by a fixed token)
 *     manual     each unit must gain over the parser (llm/gain.ts): a unit whose overlay is only manual, or drops a cost, target or loyalty part the
 *                parser understood, is left to the parser; a reply that gains nothing anywhere is rejected (stored as a failure, never as an entry)
 *   3 lint       the semantic lint (G7)
 *     hydrate    display text is restored from the player's own lines; an index outside them refuses the entry
 *   4 capability ops and keywords the engine lacks are allowed and recorded (requiresEngine), never a failure
 *   5 render     the exact render gate (G6) on the card's own text, run by the engine's pipeline exactly as the game will run it
 *   6 critical   every critical word of the Oracle text (G3's list) is in the rendered text
 *   7 smoke      the executability smoke test (packages/cards/src/smoke) on the compiled card
 *   9 risk       `highRisk:*` flags (agreement, gate 8, is a second call: llm/run.ts)
 *
 * Gates 3-7 run through `compileCardDetailed` with the candidate as a REVIEWED LLM entry: the engine's own overlay rule, lint, render gate and
 * capability degrade decide, so what passes here is exactly what the game will play (no second implementation of the gates to drift).
 */
import {
  ABILITY_MODEL_VERSION, canonicalize, compileCardDetailed, manualNodes, readCompiledEntry, renderAbility, stripAbility, validateAbility,
  type AbilityDef, type CardDef, type CompileReport, type CompileSources, type CompiledCardEntry,
} from '@openmtg/engine';
import { cardTextIn, freeTextFree } from '../pack/card-text';
import type { FaceView } from './face-lines';
import { unitGain } from './gain';
import { highRiskFlags, missingCriticalWord } from './risk';
import type { GateName } from './types';
import type { CardWork } from './work';

export interface SmokeOutcome {
  failures: { kind: string; message: string }[];
}

export interface GateEnv {
  work: CardWork;
  /** The parser's sources (the game path, or a test's), without LLM data. */
  sources: CompileSources;
  views: readonly FaceView[];
  /** Gate 7. Omitted: no smoke test (tests of the other gates). */
  smoke?: (def: CardDef) => SmokeOutcome;
}

export interface GateFailure {
  ok: false;
  gate: GateName;
  message: string;
}

export interface GatePass {
  ok: true;
  /** The stored faces of the entry: structure only, no text, no provenance; `covers` limits the overlay to the requested lines. */
  faces: CompiledCardEntry['faces'];
  /** The card as the game plays it with this entry (reviewed). */
  def: CardDef;
  report: CompileReport;
  flags: string[];
  /** Capabilities the entry needs that this build lacks (gate 4). */
  requiresEngine: string[];
  /** Canonical meaning of the entry's applied abilities (gate 8 compares two runs with it). */
  meaning: string;
}

export type GateOutcome = GateFailure | GatePass;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const fail = (gate: GateName, message: string): GateFailure => ({ ok: false, gate, message });

/** Gate 1: the JSON object of a reply (a ```json fence around it is tolerated). */
export function parseReply(text: string): { value: unknown } | { error: string } {
  let t = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(t);
  if (fence) t = fence[1]!.trim();
  try {
    return { value: JSON.parse(t) as unknown };
  } catch (e) {
    return { error: `the reply is not JSON (${e instanceof Error ? e.message : String(e)})` };
  }
}

/**
 * Stored form of a model ability: display fields and provenance removed (the pipeline sets provenance itself), and every free-text `reason` replaced by
 * the fixed STORED_REASON (design 11.4: no Oracle text or card name in the cache or a pack; the player's own line explains a manual node).
 */
export function storedForm(a: unknown): Rec {
  let s: unknown;
  try {
    s = stripAbility(a as AbilityDef);
  } catch {
    s = structuredClone(a);
  }
  const out = isRec(s) ? { ...s } : {};
  delete out['prov'];
  return freeTextFree(out);
}

/** The meaning of abilities for agreement checks: canonical form without provenance or display text (as cards/pipeline.ts#comparable). */
export function meaningOf(defs: readonly AbilityDef[]): string {
  return defs
    .map((d) => {
      let c: unknown;
      try {
        c = canonicalize(d);
      } catch {
        c = d;
      }
      return JSON.stringify(c, (k, v: unknown) => (k === 'prov' || k === 'text' || k === 'span' || k === 'label' ? undefined : v));
    })
    .join('\n');
}

const isLlm = (a: AbilityDef): boolean => (a as { prov?: { by?: string } }).prov?.by === 'llm';
const srcOf = (a: unknown): number[] => (isRec(a) && Array.isArray(a['src']) ? (a['src'] as number[]) : []);

/**
 * The manual gate: units of the reply that do not gain over the parser are removed (with their lines from `covers`, so the parser keeps them). Returns
 * why each removed unit was removed.
 */
function dropUnitsWithoutGain(work: CardWork, faces: CompiledCardEntry['faces']): string[] {
  const dropped: string[] = [];
  for (const fw of work.faces) {
    const face = faces[fw.face];
    if (!face) continue;
    for (const u of fw.units) {
      const mine = face.abilities.filter((a) => srcOf(a).length > 0 && srcOf(a).every((l) => u.src.includes(l)));
      if (mine.length === 0) continue;
      const key = u.src.join(',');
      const theirs = (work.def.faces[fw.face]?.abilities ?? []).filter((a) => (a.src ?? []).join(',') === key);
      const v = unitGain(theirs, mine);
      if (v.gain) continue;
      face.abilities = face.abilities.filter((a) => !mine.includes(a));
      if (face.covers) face.covers = face.covers.filter((c) => !u.src.includes(c.line));
      dropped.push(`face ${fw.face} line(s) ${key}: ${v.why}`);
    }
  }
  return dropped;
}

/** Gates 1-7 and 9 on one reply. */
export function runGates(env: GateEnv, replyText: string): GateOutcome {
  const { work, sources, views } = env;
  const card = work.card;
  const oracleId = card.oracle_id!;

  // [1] json
  const parsed = parseReply(replyText);
  if ('error' in parsed) return fail('json', parsed.error);
  const top = parsed.value;
  if (!isRec(top) || !Array.isArray(top['faces'])) return fail('json', 'the top level must be an object with a "faces" array');
  const facesIn = top['faces'] as unknown[];
  if (facesIn.length !== work.def.faces.length) return fail('json', `"faces" has ${facesIn.length} entries; the card has ${work.def.faces.length} face(s)`);

  // [2] schema (stored form) + authority
  const faces: CompiledCardEntry['faces'] = [];
  for (let i = 0; i < facesIn.length; i++) {
    const f = facesIn[i];
    if (!isRec(f) || !Array.isArray(f['abilities'])) return fail('json', `face ${i}: "abilities" must be an array`);
    const needed = new Set(work.faces.find((w) => w.face === i)?.units.flatMap((u) => u.src) ?? []);
    const abilities: Rec[] = [];
    for (let k = 0; k < f['abilities'].length; k++) {
      const a: unknown = f['abilities'][k];
      if (!isRec(a)) return fail('schema', `face ${i} ability ${k}: not an object`);
      const src = a['src'];
      if (!Array.isArray(src) || src.length === 0 || !src.every((l) => Number.isInteger(l))) return fail('authority', `face ${i} ability ${k}: "src" must list the line indices it comes from`);
      const outside = (src as number[]).filter((l) => !needed.has(l));
      if (outside.length > 0) {
        return fail('authority', `face ${i} ability ${k}: line(s) ${outside.join(', ')} ${needed.size === 0 ? 'were not requested' : `are not among the needed lines ${[...needed].join(', ')}`}; never redo a line the parser understood`);
      }
      abilities.push(storedForm(a));
    }
    const covers = [...needed].sort((a, b) => a - b).flatMap((line) => (views[i]?.sentences[line] ?? ['']).map((_, sentence) => ({ line, sentence })));
    faces.push({ abilities, covers });
  }
  if (faces.every((f) => f.abilities.length === 0)) return fail('authority', 'the reply has no ability for any needed line');
  // design 11.4: names and Oracle text never enter the cache (the reply's free text is already replaced; any other string is checked)
  if (cardTextIn({ faces }, card) !== null) {
    return fail('authority', "a string of the reply repeats the card's name or Oracle text; entries store structure only (use src and sentence indices, never card text)");
  }
  // [manual] each unit must gain over the parser; a reply that gains nothing is rejected
  const dropped = dropUnitsWithoutGain(work, faces);
  if (faces.every((f) => f.abilities.length === 0)) {
    return fail('manual', `the reply automates nothing the parser did not already understand (${dropped.join('; ')}); the parser keeps these lines`);
  }
  const candidate = { oracleId, textHash: work.report.textHash, modelVersion: ABILITY_MODEL_VERSION, faces, review: 'reviewed', source: 'llm', flags: [] };
  const read = readCompiledEntry(candidate);
  if ('problem' in read) {
    const reason = read.problem.reason;
    return fail(/: schema at /.test(reason) || /not a valid ability/.test(reason) ? 'schema' : 'lint', reason);
  }

  // [3]-[5] through the engine's pipeline, as the game will compile the card
  const { def, report } = compileCardDetailed(card, { ...sources, llm: new Map([[oracleId, read.entry]]), trust: 'reviewed' });
  if (report.llm === 'hydrate') return fail('hydrate', "an index in the reply (src line or step sentence) is outside the card's lines; the entry would be discarded");
  if (report.llm !== null) return fail('authority', `the entry cannot be used for this card (${report.llm})`);
  for (const n of report.notApplied) {
    if (n.reason.startsWith('the entry has no automated ability')) continue;
    return fail('authority', `face ${n.face} lines ${n.src.join(',')}: ${n.reason}`);
  }
  // The abilities on the lines the overlay took: the entry's own (prov llm), or the engine's demotion of one that failed its lint or render gate
  // (cards/pipeline.ts#verifyForeign: a manual ability with provenance 'fallback' and the gate's diagnostic as its reason).
  const applied: AbilityDef[] = [];
  const llmByFace: AbilityDef[][] = def.faces.map((f, i) => {
    const overlaid = new Set(report.faces[i]?.overlaid ?? []);
    return f.abilities.filter((a) => (a.src ?? []).length > 0 && (a.src ?? []).every((l) => overlaid.has(l)));
  });
  for (const list of llmByFace) {
    for (const a of list) {
      if (!isLlm(a) && a.kind === 'manual' && /^gate-mismatch/.test(a.reason)) return fail('render', a.reason);
      if (!isLlm(a) && a.kind === 'manual' && /^lint/.test(a.reason)) return fail('lint', a.reason);
      if (isLlm(a)) applied.push(a);
    }
  }
  if (applied.length === 0) return fail('authority', 'nothing of the reply was applied (every needed unit stayed with the parser)');
  const flags = new Set<string>();
  if (report.disagreements.length > 0) flags.add('templates:disagree');

  // [6] critical words of the source text are in the rendered text
  for (let i = 0; i < def.faces.length; i++) {
    const face = def.faces[i]!;
    const others = def.faces.filter((_, j) => j !== i).map((f) => f.name);
    for (const a of llmByFace[i]!) {
      if (a.kind === 'manual' || !isLlm(a)) continue;
      const oracle = typeof a.text === 'string' ? a.text : '';
      const ctx = { selfNames: [face.name, ...others], selfTypes: face.typeLine.split(/\s+/).filter((w) => w !== '' && !/^[—-]+$/.test(w) && w !== '//'), oracleLines: oracle.split('\n') };
      let rendered: string;
      try {
        rendered = renderAbility(a, ctx).join(' ');
      } catch (e) {
        return fail('critical', `the ability cannot be rendered (${e instanceof Error ? e.message : String(e)})`);
      }
      const missing = missingCriticalWord(oracle.replace(/~/g, face.name), rendered);
      if (missing !== null) return fail('critical', `the text says "${missing}" but the rendered ability does not: ${JSON.stringify(rendered)}`);
    }
  }

  // [7] executability smoke test on the compiled card
  if (env.smoke) {
    const s = env.smoke(def);
    if (s.failures.length > 0) return fail('smoke', s.failures.map((f) => `${f.kind}: ${f.message}`).slice(0, 3).join('; '));
  }

  // [4] capability record and [9] risk flags; lint warnings and manual parts as flags
  const before = new Set(work.def.automation.requiresEngine ?? []);
  const requiresEngine = (def.automation.requiresEngine ?? []).filter((c) => !before.has(c));
  for (const f of highRiskFlags(faces.flatMap((f) => f.abilities))) flags.add(f);
  for (const a of applied) {
    if (a.kind === 'manual' || safeManualNodes(a) > 0) flags.add('usesManual');
    try {
      if (validateAbility(a).some((x) => x.severity === 'warning')) flags.add('lint:warning');
    } catch {
      /* the pipeline already linted it */
    }
  }
  return { ok: true, faces, def, report, flags: [...flags].sort(), requiresEngine, meaning: meaningOf(applied) };
}

function safeManualNodes(a: AbilityDef): number {
  try {
    return manualNodes(a).length;
  } catch {
    return 0;
  }
}
