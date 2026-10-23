/**
 * Phase 2 lane p2-promote, round p2-promote-2: the six templates this round made stable as narrow wordings (design 6.9 deviation: each is printed on one or two
 * cards of the whole index, so three golden cards cannot exist), each with its hand-verified golden card. The golden entries are in the review file of the
 * template's own round where it has one (the card's earlier entry, pinned full, where it already had one); M6-9's mutate trigger has none, so its card is in this
 * round's file (cloud-p2-promote-2-review.json). The scenarios are test/cloud/p2-promote-2 and test/m6/costs/m6-5.test.ts (the two kicker wordings).
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import t5 from '../../m5/golden/cards/t5-review.json';
import t3 from '../../m5/golden/cards/t3-review.json';
import t1 from '../../m5/golden/cards/push-t1-review.json';
import m65 from '../../m5/golden/cards/m6-5-review.json';
import own from '../../m5/golden/cards/cloud-p2-promote-2-review.json';

type Golden = { card: string; verified: string; expect?: string }[];
const PROMOTED: readonly { id: string; card: string; file: Golden }[] = [
  { id: 'sta.cantblock.noactivate', card: 'Gelid Shackles', file: t5 as Golden },
  { id: 'rst.each.blockonly', card: 'Dense Canopy', file: t3 as Golden },
  { id: 'kw.typecycling.wizard', card: 'Step Through', file: t1 as Golden },
  { id: 'eff.m6.gainlife.kicked', card: 'Lightkeeper of Emeria', file: m65 as Golden },
  { id: 'rep.m6.enters.counters.kicked', card: 'Vodalian Mindsinger', file: m65 as Golden },
  { id: 'trg.m6.yourCreature.mutates', card: 'Essence Symbiote', file: own as Golden },
];

describe('p2-promote-2: design 6.9 narrow wordings, stable on the card that prints them', () => {
  for (const p of PROMOTED) {
    it(`${p.id} is stable and ${p.card} is its golden card, pinned full and naming it`, () => {
      expect(TEMPLATE_SET.find((t) => t.id === p.id)?.status).toBe('stable');
      const e = p.file.find((g) => g.card === p.card);
      expect(e, p.card).toBeDefined();
      expect(e!.expect).toBe('full');
      expect(e!.verified).toContain(`(${p.id})`);
    });
  }
});
