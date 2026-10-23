/**
 * WP28's test deliverable (design 15.2: "doc links check"): every relative Markdown link in the project's documents points at a file or folder that
 * exists, so a moved or renamed document cannot leave dangling links behind. External links (http, https, mailto) and pure anchors are not checked;
 * links inside fenced code blocks and inline code are not links.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../../src/paths';

const ROOT = repoRoot();
const TOP_LEVEL = ['README.md', 'STATUS.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md'];

function markdownUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...markdownUnder(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** The link targets of a Markdown text, outside fenced code blocks and inline code: `[text](target "title")` and `[label]: target`. */
export function linkTargets(markdown: string): string[] {
  const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  for (const m of prose.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]!.replace(/^<|>$/g, ''));
  for (const m of prose.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) out.push(m[1]!);
  return out;
}

const isRelative = (t: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('#') && t !== '';

/** The broken relative links of one document, as "target" strings. */
function brokenLinks(file: string): string[] {
  const dir = path.dirname(file);
  return linkTargets(readFileSync(file, 'utf8'))
    .filter(isRelative)
    .filter((t) => {
      const clean = decodeURIComponent(t.replace(/[#?].*$/, ''));
      if (clean === '') return false;
      const abs = clean.startsWith('/') ? path.join(ROOT, clean) : path.resolve(dir, clean);
      return !existsSync(abs);
    });
}

describe('documentation links (WP28, design 15.2)', () => {
  it('the link extractor finds inline and reference links and skips code', () => {
    const md = 'See [a](docs/A.md#x) and [b](<b c.md>) "t".\n\n[ref]: ./r.md\n\n```\n[no](code.md)\n```\nand `[no](inline.md)` [web](https://example.com)';
    expect(linkTargets(md)).toEqual(['docs/A.md#x', 'b c.md', 'https://example.com', './r.md']);
  });

  const files = [...TOP_LEVEL.map((f) => path.join(ROOT, f)).filter((f) => existsSync(f)), ...markdownUnder(path.join(ROOT, 'docs'))];
  for (const file of files) {
    it(`every relative link of ${path.relative(ROOT, file).replace(/\\/g, '/')} resolves`, () => {
      expect(brokenLinks(file)).toEqual([]);
    });
  }
});
