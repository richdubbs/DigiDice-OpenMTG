/**
 * The parser's own "stuck at" diagnostics per line (design 11.1 repair mode, 11.2 USER message: `Parser diagnostics for [2]: stuck at "unless" ...,
 * expected: ".", ",", "and"`). The engine records them for exactly this use (parser/types.ts Diagnostic.furthest). Pure; never throws.
 */
import { faceContexts, parseCard, preprocessFace, type Diagnostic, type OracleCard, type ParseOptions } from '@openmtg/engine';

const MAX_EXPECTED = 12;

/** One manual diagnostic as the prompt shows it. */
export function renderDiagnostic(d: Pick<Diagnostic, 'message' | 'furthest'>): string {
  const f = d.furthest;
  if (!f) return d.message;
  const more = f.expected.length > MAX_EXPECTED ? `, ... (${f.expected.length - MAX_EXPECTED} more)` : '';
  return `${d.message}; stuck at ${JSON.stringify(f.token)}, expected: ${f.expected.slice(0, MAX_EXPECTED).map((x) => JSON.stringify(x)).join(', ')}${more}`;
}

/** face index -> line index -> the parser's manual diagnostics for that line (in the line indexing of `src`). */
export function lineDiagnostics(card: OracleCard, opts: ParseOptions): Map<number, Map<number, string[]>> {
  const out = new Map<number, Map<number, string[]>>();
  try {
    const parsed = parseCard(card, opts);
    const contexts = faceContexts(card, opts);
    parsed.faces.forEach((f, i) => {
      const ctx = contexts[i];
      if (!ctx) return;
      const pre = preprocessFace(ctx, opts);
      const lines = new Map<number, string[]>();
      for (const d of f.diagnostics) {
        if (d.level !== 'manual' || !d.range) continue;
        const at = d.range[0];
        const line = pre.lines.findIndex((l) => !l.blank && at >= l.body[0] && at <= l.body[1]);
        if (line < 0) continue;
        const list = lines.get(line) ?? [];
        const text = renderDiagnostic(d);
        if (!list.includes(text)) list.push(text);
        lines.set(line, list);
      }
      out.set(i, lines);
    });
  } catch {
    /* no diagnostics: the prompt falls back to the manual reasons */
  }
  return out;
}
