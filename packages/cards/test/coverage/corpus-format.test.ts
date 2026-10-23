import { describe, expect, it } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { sampleCards } from '../../src/coverage/corpus';

// `--format standard` keeps only the cards a format allows, so `unmatched --format standard` ranks shapes
// by the Standard cards they would unlock.
const card = (name: string, id: string, legalities: Record<string, string>): OracleCard =>
  ({ name, oracle_id: id, type_line: 'Creature', oracle_text: '', legalities }) as unknown as OracleCard;

describe('corpus option --format', () => {
  const all = [
    card('Legal Now', 'a', { standard: 'legal', commander: 'legal' }),
    card('Rotated', 'b', { standard: 'not_legal', commander: 'legal' }),
    card('Restricted Thing', 'c', { standard: 'restricted' }),
    card('Banned Thing', 'd', { standard: 'banned', commander: 'legal' }),
    { name: 'No Legalities', oracle_id: 'e', type_line: 'Instant', oracle_text: '' } as unknown as OracleCard,
  ];

  it('keeps the cards legal or restricted in the format (case-insensitive), nothing else', () => {
    expect(sampleCards(all, { format: 'standard' }).map((c) => c.name)).toEqual(['Legal Now', 'Restricted Thing']);
    expect(sampleCards(all, { format: ' Standard ' }).map((c) => c.name)).toEqual(['Legal Now', 'Restricted Thing']);
    expect(sampleCards(all, { format: 'commander' }).map((c) => c.name)).toEqual(['Legal Now', 'Rotated', 'Banned Thing']);
  });

  it('combines with the other sampling options and leaves the corpus whole without it', () => {
    expect(sampleCards(all, { format: 'standard', match: 'thing' }).map((c) => c.name)).toEqual(['Restricted Thing']);
    expect(sampleCards(all, {}).length).toBe(all.length);
  });
});
