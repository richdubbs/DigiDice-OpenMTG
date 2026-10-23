/** Text output of a format report for the CLI (`npm run cards -- deck <file> --format <fmt>`), and the `--format` option parser. */
import { FORMATS } from './formats';
import type { FormatProblem, FormatReport } from './types';

const LABEL = { error: 'ERROR', warning: 'WARNING', note: 'NOTE' } as const;

export function problemLine(p: FormatProblem): string {
  return `${LABEL[p.severity]} [${p.rule}] ${p.message}`;
}

/** Report lines: a summary line, then one line per problem. */
export function reportLines(r: FormatReport): string[] {
  const errors = r.problems.filter((p) => p.severity === 'error').length;
  const warnings = r.problems.filter((p) => p.severity === 'warning').length;
  const verdict = errors ? `NOT LEGAL (${errors} error${errors === 1 ? '' : 's'})` : warnings ? `legal as far as checked (${warnings} warning${warnings === 1 ? '' : 's'}: not everything could be checked)` : 'legal';
  const size = r.format.commander ? `${r.counts.deck} cards with ${r.commanders.length ? r.commanders.join(' + ') : 'no commander'}` : `${r.counts.main} main, ${r.counts.sideboard} sideboard`;
  return [`Format ${r.format.name}: ${verdict}; ${size}.`, ...r.problems.map((p) => `  ${problemLine(p)}`)];
}

/** One line per format: id, name, aliases. */
export function formatListLines(): string[] {
  return FORMATS.map((f) => `  ${f.id.padEnd(14)} ${f.name}${f.aliases.length ? ` (also: ${f.aliases.join(', ')})` : ''}`);
}

/**
 * Take "--name value" or "--name=value" out of an argument list. `present` is true when the option was given; `value` is undefined when it had no value.
 * The value may be several words when quoted by the shell ("duel commander").
 */
export function takeOption(args: readonly string[], name: string): { rest: string[]; present: boolean; value?: string } {
  const rest: string[] = [];
  let present = false;
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === name) {
      present = true;
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i++;
      }
    } else if (a.startsWith(`${name}=`)) {
      present = true;
      value = a.slice(name.length + 1) || undefined;
    } else rest.push(a);
  }
  return value === undefined ? { rest, present } : { rest, present, value };
}
