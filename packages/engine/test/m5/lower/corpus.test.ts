/**
 * WP17 corpus checks on the local Oracle index (git-ignored; skipped when absent; set OPENMTG_CACHE_DIR in a worktree). A deterministic tenth of the index
 * (every 10th card in file order): contract C1 (no face ends in a parser error) and guard G4 (every ledger tiles). The whole index was run once by hand
 * when WP17 was written: 34,473 cards in 35 s, no parser error, every ledger tiled.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '../../../src/parser/parse';
import { faceContexts, ledgerProblems, normalizeText } from '../../../src/parser/preprocess';
import { SLOW, slowTitle } from '../../slow';
import { localIndex, options } from './support';

// QT: a slow suite (npm run test:all). The index is read only when the suite runs.
const index = SLOW ? localIndex() : null;

describe.skipIf(!SLOW || index === null)(slowTitle('WP17 corpus (local Oracle index)'), () => {
  it('C1 and G4 on every 10th card: no parser error, every ledger tiles', () => {
    const opts = options();
    const problems: string[] = [];
    let cards = 0;
    for (let i = 0; i < index!.length; i += 10) {
      const c = index![i]!;
      cards++;
      const res = parseCard(c, opts);
      const ctxs = faceContexts(c, opts);
      res.faces.forEach((f, k) => {
        if (f.diagnostics.some((d) => d.code === 'parser-error')) problems.push(`${c.name}: parser-error`);
        const p = ledgerProblems(normalizeText(ctxs[k]?.text ?? '').text, f.ledger);
        if (p.length > 0) problems.push(`${c.name} face ${k}: ${p[0]}`);
        if (f.gate.length !== f.abilities.length) problems.push(`${c.name} face ${k}: gate not aligned`);
      });
    }
    expect(cards).toBeGreaterThan(1000);
    expect(problems.slice(0, 20)).toEqual([]);
  }, 120_000);
});
