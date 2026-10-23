/**
 * WP17: the parser metrics of design 6.12: parse-only level, the tuning / held-out split, out-of-sample retention against the 90% gate, the ambiguity list and
 * rate, the abstract shapes of residue and their clustering by cards unlocked.
 */
import { describe, expect, it } from 'vitest';
import { RETENTION_GATE, abstractShape, ambiguityList, ambiguityRate, fnv1a32, halfOfKey, parseLevel, residueClusters, residueOf, retention, splitHalves, type CardOutcome } from '../../../src/parser/metrics';
import { parseCard } from '../../../src/parser/parse';
import { card, options, tpl } from './support';

const opts = options();
const outcome = (oracleId: string, name: string, typeLine: string, text: string, o = opts): CardOutcome => ({ oracleId, name, result: parseCard(card(name, typeLine, text), o) });

describe('WP17 design 6.12: parse-only level', () => {
  it('full when nothing is manual, partial when something is, manual when nothing runs', () => {
    expect(parseLevel(outcome('a', 'A', 'Instant', 'Draw two cards.').result)).toBe('full');
    expect(parseLevel(outcome('b', 'B', 'Instant', 'Draw two cards. Juggle the moon.').result)).toBe('partial');
    expect(parseLevel(outcome('c', 'C', 'Instant', 'Juggle the moon.').result)).toBe('manual');
    expect(parseLevel(outcome('d', 'D', 'Creature — Spirit', 'Flying\nJuggle the moon.').result)).toBe('partial');
  });
});

describe('WP17 design 6.12: out-of-sample retention', () => {
  it('each half is fixed by the hash of the card key (halfOfKey), in oracle_id order; the halves do not depend on which other cards are present', () => {
    const xs = ['d', 'a', 'c', 'b'].map((oracleId) => ({ oracleId }));
    const { tuning, heldOut } = splitHalves(xs);
    expect(tuning.map((x) => x.oracleId)).toEqual(['a', 'c']); // FNV-1a("a") and ("c") are even
    expect(heldOut.map((x) => x.oracleId)).toEqual(['b', 'd']);
    // a property of the card, not of its position: adding or removing other cards moves nothing (the 2026-10-19 Scryfall refresh broke the index-parity split)
    expect(splitHalves(xs.filter((x) => x.oracleId !== 'a')).heldOut.map((x) => x.oracleId)).toEqual(['b', 'd']);
    for (const x of xs) expect(halfOfKey(x.oracleId)).toBe(tuning.includes(x) ? 'tuning' : 'heldOut');
    expect(fnv1a32('')).toBe(0x811c9dc5); // the offset basis; FNV-1a test vector: "a" -> 0xe40c292c
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });
  it('ratio = held-out coverage / tuning coverage; the gate is 90%', () => {
    const full = (id: string) => outcome(id, `F${id}`, 'Instant', 'Draw two cards.');
    const manual = (id: string) => outcome(id, `M${id}`, 'Instant', 'Juggle the moon.');
    // tuning (even hash): 1 3 5 7 -> 4 full; held-out (odd hash): 0 2 4 6 -> 3 full
    const r = retention([full('0'), full('1'), full('2'), full('3'), full('4'), full('5'), manual('6'), full('7')]);
    expect(r.tuning).toMatchObject({ cards: 4, full: 4, coverage: 1 });
    expect(r.heldOut).toMatchObject({ cards: 4, full: 3, manual: 1, coverage: 0.75 });
    expect(r.ratio).toBe(0.75);
    expect(r.passes).toBe(false);
    expect(RETENTION_GATE).toBe(0.9);
    expect(retention([full('0'), full('1')]).passes).toBe(true);
  });
  it('a custom level function (the pipeline classification) can replace the parse-only level', () => {
    const r = retention([outcome('0', 'A', 'Instant', 'Draw a card.'), outcome('1', 'B', 'Instant', 'Draw a card.')], () => 'partial');
    expect(r.tuning.coverage).toBe(0);
    expect(r.ratio).toBe(1);
  });
});

describe('WP17 design 6.12: ambiguity list and rate (guard G5)', () => {
  it('lists every ambiguous unit with its readings', () => {
    const amb = options([
      tpl('effect', 'zap {o:Objs}', { op: 'destroy', what: '$o' }, { id: 'm.zap1' }),
      tpl('effect', 'zap {o:Objs}', { op: 'sacrifice', what: '$o' }, { id: 'm.zap2' }),
    ]);
    const outs = [outcome('1', 'Bolt Jar', 'Instant', 'Zap target creature.', amb), outcome('2', 'Calm', 'Instant', 'Draw a card.', amb)];
    const list = ambiguityList(outs);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ oracleId: '1', name: 'Bolt Jar', face: 0 });
    expect(list[0]!.alternatives).toHaveLength(2);
    expect(ambiguityRate(outs)).toBeCloseTo(0.5);
  });
});

describe('WP17 design 6.12: residue clustering by abstract shape', () => {
  it('abstract shapes: numbers, mana symbols, P/T, types, subtypes and colors become placeholders', () => {
    expect(abstractShape('Put two +1/+1 counters on target Elf.')).toBe('put N <pt> counters on target <subtype>.');
    expect(abstractShape('Pay {2}{G}: Destroy target red Artifact.')).toBe('pay {M}: destroy target <color> <type>.');
  });
  it('residue is the manual sentences, split into sentences', () => {
    expect(residueOf(outcome('1', 'A', 'Instant', 'Draw a card. Juggle the moon. Paint the sky.').result)).toEqual(['Juggle the moon.', 'Paint the sky.']);
  });
  it('clusters are ranked by cards unlocked (cards whose only residue is that shape), then by cards', () => {
    const outs = [
      outcome('1', 'A', 'Instant', 'Draw a card. Juggle 2 moons.'),
      outcome('2', 'B', 'Instant', 'Draw a card. Juggle 3 moons.'),
      outcome('3', 'C', 'Instant', 'Juggle 4 moons. Paint the sky.'),
      outcome('4', 'D', 'Instant', 'Paint the sky. Fold the sea.'),
      outcome('5', 'E', 'Instant', 'Draw a card.'),
    ];
    const clusters = residueClusters(outs);
    expect(clusters[0]).toEqual({ shape: 'juggle N moons.', cards: 3, unlocks: 2, examples: ['A', 'B', 'C'] });
    expect(clusters[1]).toMatchObject({ shape: 'paint the sky.', cards: 2, unlocks: 0 });
    expect(residueClusters(outs, { top: 1 })).toHaveLength(1);
  });
});
