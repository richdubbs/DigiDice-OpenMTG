/**
 * `npm run cards -- try <card name | "sentence">` (design 6.9 step 2): the parse trace of one card or one sentence, from the parser's OWN output: every
 * unit the parser charted (the ledger: its text, its tokens as the parser read them, the templates of its derivation and their goal, or why it stayed
 * manual with the parser's diagnostic: code, the furthest token and what was expected there, the competing readings and their templates when
 * ambiguous), the abilities as JSON, the exact render gate (both strings), and the level the game would play the card at. Nothing is re-derived with a
 * guessed goal. A sentence that is not a card name is parsed as a synthetic card: a creature for a triggered, activated or keyword line, an instant
 * otherwise (or the type line given with `--type`); "~" in the sentence is the card itself.
 */
import type { ChartResult, OracleCard, Template } from '@openmtg/engine';
import type { CardRun, CoverageEngine } from './engine';
import { ambiguousReadings, preprocessedFaces, unitTokens, unitTraces } from './units';

export const TRY_CARD_NAME = 'Trial Subject';

/** The type line a lone sentence is parsed under: a creature when it reads as a permanent's ability, an instant otherwise. */
export function guessTypeLine(text: string): string {
  const t = text.trim().toLowerCase();
  if (/^(when|whenever|at)\b/.test(t)) return 'Creature — Human';
  if (/^[^"]*:/.test(t)) return 'Creature — Human';
  if (/^(enchanted|equipped|other|each other|creatures you control|as long as)\b/.test(t)) return 'Enchantment';
  return 'Instant';
}

export function syntheticCard(text: string, typeLine: string = guessTypeLine(text)): OracleCard {
  const oracle = text.replace(/~/g, TRY_CARD_NAME);
  const card: OracleCard = { name: TRY_CARD_NAME, layout: 'normal', type_line: typeLine, oracle_text: oracle, mana_cost: '{1}', colors: [], keywords: [] } as OracleCard;
  if (/\bCreature\b/.test(typeLine)) Object.assign(card, { power: '2', toughness: '2' });
  return card;
}

/** A chart result in one line (used for the readings of an ambiguous unit). */
export function describeChart(r: ChartResult): string {
  switch (r.status) {
    case 'ok': return `ok via [${r.derivation.templatesUsed.join(', ')}]${r.harmless ? `, ${r.harmless} harmless alternative(s)` : ''}${r.outranked.length ? `, outranked: ${r.outranked.map((d) => `[${d.templatesUsed.join(', ')}]`).join(' ')}` : ''} (${r.items} items)`;
    case 'ambiguous': return `AMBIGUOUS (G5): ${r.alternatives.map((d) => `[${d.templatesUsed.join(', ')}] ${JSON.stringify(d.value)}`).join('  VS  ')}`;
    case 'fail': return `no derivation: stopped at "${r.furthest.token}" (token ${r.furthest.index}), expected ${r.furthest.expected.slice(0, 12).join(' | ')}${r.unknownWords.length ? `; unknown words (G2): ${r.unknownWords.map((w) => w.token).join(', ')}` : ''}${r.skipped.length ? `; skipped for missing capabilities: ${r.skipped.join(', ')}` : ''}`;
    case 'needs-engine': return `needs-engine: [${r.templateIds.join(', ')}] needs ${r.missing.join(', ')}`;
    case 'budget': return `budget exhausted (${r.items} items)`;
  }
}

/** The units the parser charted on each face, as printable lines (design 6.9 step 2). */
export function traceUnits(run: CardRun, engine: CoverageEngine, templates: readonly Template[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const pres = preprocessedFaces(run.card, engine.parseOptions);
  for (const u of unitTraces(run.card, run.parse, engine.parseOptions, templates)) {
    const lines = out.get(u.face) ?? [];
    const pre = pres[u.face];
    lines.push(`unit ${u.range[0]}-${u.range[1]} "${u.text.replace(/\n/g, ' / ')}"`);
    if (pre) lines.push(`  tokens: ${unitTokens(pre, u.range, engine.parseOptions).map((t) => `${t.kind}:${t.norm}`).join(' ')}`);
    if (u.status === 'consumed') lines.push(`  consumed by [${u.by.join(', ')}]${u.goals.length ? ` (goal: ${u.goals.join(', ')})` : ' (structure)'}`);
    else lines.push(`  MANUAL: ${u.reason ?? 'no reason recorded'}`);
    for (const d of u.diagnostics) {
      lines.push(`  diagnostic ${d.level} ${d.code}: ${d.message}${d.furthest ? ` [stopped at "${d.furthest.token}", expected ${d.furthest.expected.slice(0, 12).join(' | ')}]` : ''}`);
      if (d.code === 'ambiguous' && pre && d.range) {
        const readings = ambiguousReadings(pre, d.range, engine.parseOptions);
        if (readings) lines.push(`  readings (goal ${readings.goal}): ${readings.alternatives.map((x) => `[${x.templatesUsed.join(', ')}] priority ${x.priority}: ${JSON.stringify(x.value)}`).join('  VS  ')}`);
      }
    }
    out.set(u.face, lines);
  }
  return out;
}

export function formatTry(run: CardRun, engine: CoverageEngine, opts: { json?: boolean; templates?: readonly Template[] } = {}): string[] {
  const out: string[] = [];
  const { card } = run;
  out.push(`${card.name} [${card.layout}] ${card.type_line ?? ''}`);
  out.push(`Pipeline: ${engine.pipeline()}; level ${run.level}${run.requiresEngine.length ? `; needs ${run.requiresEngine.join(', ')}` : ''}${run.error ? `; ERROR ${run.error}` : ''}`);
  const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces : [card];
  const units = traceUnits(run, engine, opts.templates ?? engine.parseOptions.templates);
  run.parse.faces.forEach((f, fi) => {
    const src = faces[fi];
    out.push('');
    out.push(`--- face ${fi}${src ? `: ${src.name}` : ''} ---`);
    out.push(...(units.get(fi) ?? []));
    out.push(`templates used: ${f.templatesUsed.join(', ') || '(none)'}${f.experimental.length ? `; experimental: ${f.experimental.join(', ')}` : ''}`);
    f.abilities.forEach((a, ai) => {
      const g = f.gate[ai];
      const level = run.def?.automation.faces?.[fi]?.abilities[ai]?.level;
      out.push(`ability ${ai}: ${a.kind}${level ? ` (${level})` : ''}: ${a.text}`);
      if (g && !(g.ok === false && g.rendered === '' && g.expected === '')) out.push(`  gate (G6): ${g.ok ? 'ok' : 'MISMATCH'}: rendered "${g.rendered}" / Oracle "${g.expected}"`);
      if (a.kind === 'manual') out.push(`  manual: ${a.reason}`);
      if (opts.json) out.push(...JSON.stringify(a, null, 2).split('\n').map((l) => `  ${l}`));
    });
    for (const d of f.diagnostics) out.push(`diagnostic ${d.level} ${d.code}: ${d.message}${d.furthest ? ` [furthest "${d.furthest.token}", expected ${d.furthest.expected.slice(0, 8).join(' | ')}]` : ''}`);
    out.push(`ledger: ${f.ledger.map((e) => `${e.range[0]}-${e.range[1]} ${e.status}${e.by ? `(${e.by})` : ''}`).join(', ')}`);
  });
  if (run.def) {
    const auto = run.def.automation;
    out.push('');
    out.push(`automation: ${auto.level}, source ${auto.source}, autoRatio ${auto.autoRatio ?? '-'}`);
    for (const f of auto.faces ?? []) for (const a of f.abilities) for (const m of a.manual) out.push(`  manual ${m.impact} ${m.path || '/'}: ${m.reason}`);
  }
  return out;
}
