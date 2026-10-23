/**
 * std-finish-1 (the last Standard cards; owner approval 2026-10-21 of std-promote-1's Q1-Q3): the promotions of five experimental templates on their Standard
 * golden cards, each a narrow wording (design 6.9 deviation: one card prints it), with the evidence in the template's own round's review file, and the rules
 * correction of Stolen Uniform's delayed trigger (no `once`, CR 603.7b; played in std-finish-1-scenarios.test.ts). CR cites from memory, unverified.
 *
 *   eff.stdrx32.delay.loseControl.ifAttached   Stolen Uniform (cloud-std-rx32-review.json)
 *   eff.unattach                               Stolen Uniform (cloud-std-rx32-review.json; effect/attach.json has no review file of its own)
 *   eff.r4dig.reveal.fromHand.one              Armored Kincaller (cloud-r4-dig-review.json)
 *   eff.r4dig.search.differentNames.reveal     Fblthp, Knows the Way (cloud-r4-dig-review.json; moved from cloud-std-ri-review.json)
 *   sta.t77.attached.pump.addtype.quoted       Ninja's Blades (fast5-t77-review.json)
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import rx32Review from '../../m5/golden/cards/cloud-std-rx32-review.json';
import digReview from '../../m5/golden/cards/cloud-r4-dig-review.json';
import riReview from '../../m5/golden/cards/cloud-std-ri-review.json';
import t77Review from '../../m5/golden/cards/fast5-t77-review.json';

type Golden = { card: string; verified: string; expect?: string }[];
const PROMOTED: readonly [string, Golden, string][] = [
  ['eff.stdrx32.delay.loseControl.ifAttached', rx32Review as Golden, 'Stolen Uniform'],
  ['eff.unattach', rx32Review as Golden, 'Stolen Uniform'],
  ['eff.r4dig.reveal.fromHand.one', digReview as Golden, 'Armored Kincaller'],
  ['eff.r4dig.search.differentNames.reveal', digReview as Golden, 'Fblthp, Knows the Way'],
  ['sta.t77.attached.pump.addtype.quoted', t77Review as Golden, "Ninja's Blades"],
];
const byId = (id: string): Template => TEMPLATE_SET.find((t) => t.id === id)!;

describe('std-finish-1 promotions (design 6.9; owner approval 2026-10-21)', () => {
  for (const [id, review, card] of PROMOTED) {
    it(`${id} is stable, its evidence the hand-verified golden card ${card} in its own round's review file`, () => {
      expect(byId(id).status, id).toBe('stable');
      const g = review.find((e) => e.card === card);
      expect(g, card).toBeDefined();
      expect(g!.verified, card).toContain(id);
    });
  }
  it('the golden entries this round wrote or moved pin their card as full; Fblthp has one golden entry, not two', () => {
    for (const card of ['Stolen Uniform', 'Armored Kincaller', 'Fblthp, Knows the Way']) {
      const g = [...(rx32Review as Golden), ...(digReview as Golden)].find((e) => e.card === card);
      expect(g?.expect, card).toBe('full');
    }
    expect((riReview as Golden).some((e) => e.card === 'Fblthp, Knows the Way')).toBe(false);
  });
  it('CR 603.7b: the lose-control delayed trigger has a stated duration and no `once`, so it triggers each time during the turn', () => {
    const build = byId('eff.stdrx32.delay.loseControl.ifAttached').build as { op: string; duration?: unknown; once?: boolean };
    expect(build.op).toBe('delay');
    expect(build.duration).toEqual({ d: 'endOfTurn' });
    expect(build.once).toBeUndefined();
  });
});
