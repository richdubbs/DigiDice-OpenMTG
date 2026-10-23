/**
 * Degrading the abilities of one card together: a consumer of a link whose producer became manual must become manual too (CR 607.1), or the card would
 * look automated while doing nothing (Fiend Hunter never returning its creature).
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, degradeAbilities, degradeAbility, validateAbility, validateCardAbilities } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

const NO_LINES = { lines: [], sentences: [] };
const fiend = EXAMPLES.find((e) => e.name === 'Fiend Hunter')!.faces[0]!.abilities;
const all = new Set(fiend.flatMap((a) => capabilitiesOf(a)));
const at = (def: unknown, path: string): unknown =>
  path.split('/').filter(Boolean).reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), def);

describe('degradeAbilities', () => {
  it('nothing missing: nothing changes', () => {
    const r = degradeAbilities(fiend, all, NO_LINES);
    expect(r.abilities).toEqual(fiend);
    expect(r.requires).toEqual([]);
  });
  it('a producer that loses its effect makes the consumer of its link manual, with the reason', () => {
    const caps = new Set([...all].filter((c) => c !== 'target:object'));
    const alone = fiend.map((a) => degradeAbility(a, caps, NO_LINES).def);
    expect(alone[0]).toMatchObject({ kind: 'manual', shape: 'triggered' });
    expect(at(alone[0], '/effect')).toBeUndefined(); // the target spec cannot be announced, so no effect is kept
    expect(at(alone[1], '/effect/steps/0/op')).toBe('move'); // on its own the consumer looks fine: that is the danger
    const together = degradeAbilities(fiend, caps, NO_LINES);
    expect(together.abilities[0]).toEqual(alone[0]);
    expect(at(together.abilities[1], '/effect/steps/0')).toMatchObject({ op: 'manual', reason: expect.stringContaining('tainted: link "exiled"') });
    expect(together.requires).toEqual(['target:object']);
    for (const a of together.abilities) expect(validateAbility(a)).toEqual([]);
  });
  it('a producer that stays automated (even as a manual trigger with its effect kept) keeps its consumer automated', () => {
    const caps = new Set([...all].filter((c) => c !== 'ev:zoneChange'));
    // both triggers lose their event; both keep their effects; the link is still produced by the kept effect of the first
    const r = degradeAbilities(fiend, caps, NO_LINES);
    expect(r.abilities.map((a) => (a as unknown as { kind: string }).kind)).toEqual(['manual', 'manual']);
    expect(at(r.abilities[1], '/effect/steps/0/op')).toBe('move');
  });
  it('a consumer whose condition or filter reads the link is tainted at the smallest unit', () => {
    const producer = fiend[0]!;
    const consumer = { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }, { op: 'tap', what: { ref: 'each', filter: { chosen: { link: 'exiled', quality: 'cardType' } } } }] } } as unknown as AbilityDef;
    const caps = new Set([...all, ...capabilitiesOf(consumer)].filter((c) => c !== 'target:object'));
    const r = degradeAbilities([producer, consumer], caps, NO_LINES);
    expect(at(r.abilities[1], '/effect/steps/0/op')).toBe('draw');
    expect(at(r.abilities[1], '/effect/steps/1/op')).toBe('manual');
  });
  it('the result of degrading the worked examples as whole cards is valid and needs nothing the engine lacks', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const everything = new Set(EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities.flatMap((a) => capabilitiesOf(a)))));
    for (let round = 0; round < 8; round++) {
      const have = new Set([...everything].filter(() => rnd() < 0.85));
      for (const ex of EXAMPLES) {
        for (const face of ex.faces) {
          const r = degradeAbilities(face.abilities, have, NO_LINES);
          for (const a of r.abilities) {
            expect(capabilitiesOf(a).filter((c) => !have.has(c)), ex.name).toEqual([]);
            expect(validateAbility(a), ex.name).toEqual([]);
          }
          // no consumer is left without a producer that the original card had
          expect(validateCardAbilities([{ abilities: r.abilities }]).filter((i) => i.severity === 'error' && i.code === 'unlinked'), ex.name).toEqual([]);
        }
      }
    }
  });
});
