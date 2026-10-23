/**
 * The template set the coverage tools parse with (design 6.3, 6.9): every `*.json` file under the engine's `parser/templates/` directory, so the tools
 * always measure exactly the templates that are merged (bootstrap.json of WP17 and the packages WP19-WP23), whatever they are. Files are read in path
 * order, so the set (and every report built from it) is deterministic.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateTemplates, type Template } from '@openmtg/engine';
import { repoRoot } from '../paths';

export function defaultTemplatesDir(): string {
  return path.join(repoRoot(), 'packages', 'engine', 'src', 'parser', 'templates');
}

export interface TemplateSet {
  dir: string;
  /** The files read, relative to `dir`, with the number of templates each holds. */
  files: { file: string; count: number }[];
  templates: Template[];
  /** Problems found by the chart's own validator (design 6.9: rules cited, examples, two counter-examples, unique ids, patterns compile). */
  problems: { id: string; message: string }[];
}

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json')) out.push(p);
    }
  };
  walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Read every template file under `dir`. A file that is not a JSON array of templates is reported as a problem, never silently skipped. */
export function loadTemplates(dir: string = defaultTemplatesDir()): TemplateSet {
  const files: TemplateSet['files'] = [];
  const templates: Template[] = [];
  const problems: TemplateSet['problems'] = [];
  for (const file of jsonFiles(dir)) {
    const rel = path.relative(dir, file).replace(/\\/g, '/');
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      problems.push({ id: rel, message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (!Array.isArray(data)) {
      problems.push({ id: rel, message: 'a template file must hold a JSON array of templates' });
      continue;
    }
    files.push({ file: rel, count: data.length });
    templates.push(...(data as Template[]));
  }
  problems.push(...validateTemplates(templates));
  return { dir, files, templates, problems };
}
