/**
 * The worked examples of the design (docs/design/m5-ability-model.md, section 13), read from the document when a test runs. The document is the one place that
 * holds their Oracle text (design 6.10, D26: committed tests hold no verbatim card text of their own), so the tests of the renderer read the examples from it
 * instead of keeping a generated copy. One entry per "#### Card" heading: the Oracle lines of its block quote (bullets as "•") and the JSON block
 * (`abilities`, or `faces` for split cards).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface WorkedExample {
  name: string;
  oracle: string[];
  classification: string;
  card: { abilities?: unknown[]; faces?: { name: string; abilities: unknown[] }[] };
}

function load(): WorkedExample[] {
  const path = fileURLToPath(new URL('../../../../../docs/design/m5-ability-model.md', import.meta.url));
  const doc = readFileSync(path, 'utf8').split(/\r?\n/);
  const start = doc.findIndex((l) => l.startsWith('## 13. Worked examples'));
  const end = doc.findIndex((l, i) => i > start && l.startsWith('## 14.'));
  if (start < 0 || end < 0) throw new Error('the worked examples (section 13) were not found in docs/design/m5-ability-model.md');
  const out: WorkedExample[] = [];
  let cur: WorkedExample | null = null;
  let inJson = false;
  let json: string[] = [];
  for (const line of doc.slice(start, end)) {
    if (line.startsWith('#### ')) {
      cur = { name: line.slice(5).trim(), oracle: [], classification: '', card: {} };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (inJson) {
      if (line.startsWith('```')) {
        inJson = false;
        cur.card = JSON.parse(json.join('\n')) as WorkedExample['card'];
        json = [];
      } else json.push(line);
      continue;
    }
    if (line.startsWith('```json')) inJson = true;
    else if (line.startsWith('> ')) cur.oracle.push(line.slice(2).replace(/^\* /, '• '));
    else if (line.startsWith('Classification:')) cur.classification = line.replace('Classification: ', '').replace(/\*\*/g, '').replace(/\.$/, '');
  }
  return out;
}

export const examples: WorkedExample[] = load();
