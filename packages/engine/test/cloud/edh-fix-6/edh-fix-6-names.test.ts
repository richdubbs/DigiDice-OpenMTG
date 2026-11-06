/**
 * edh-fix-6 (fix:std-library-5-order): parser/parse.ts#withMeldNames keeps one options object per card name (so the parse memo keeps working). It was keyed by the
 * card's NAME only, so two cards of one name with different related parts ("Example Relic" in dozens of tests) shared the card-name set of the first one compiled in
 * the process: std-library-5's "Exile this card and two other cards named Example Relic from your graveyard" and std-ry4's combo-piece search read partial or full
 * by what an earlier test file of the same worker had compiled. The key is now the name and the related names.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';

const make = (text: string, parts: string[] = [], type = 'Sorcery'): OracleCard =>
  ({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], all_parts: parts.map((name) => ({ component: 'combo_piece', name, type_line: 'Legendary Creature — Elf' })) } as unknown as OracleCard);
const OWN = 'Draw a card.\nExile this card and two other cards named Example Relic from your graveyard: Draw a card. Activate only as a sorcery.';
const SEEK = 'Search your library for a card named Vexa, Keeper of Vows and put it into your hand. Then shuffle.';

describe('edh-fix-6: a card name is not the key of its card-name set', () => {
  it('a card of the same name with other combo pieces, compiled first, does not change how a later card reads its own name', () => {
    expect(compileCard(make(SEEK, ['Vexa, Keeper of Vows', 'Example Relic'])).automation.level).toBe('full'); // names: Vexa..., Example Relic
    expect(compileCard(make('Search your library for a card named Example Relic and put it into your hand. Then shuffle.', ['Zed, the Other'])).automation.level).toBe('full'); // another name set, same card name
    expect(compileCard(make(OWN)).automation.level).toBe('full');
  });
  it('and the other way round', () => {
    // other texts than the first test (the compile memo keeps cards by text), the own-name card first
    expect(compileCard(make(OWN.replace('two other', 'three other').replace('Draw a card.\nExile', 'Scry 1.\nExile'))).automation.level).toBe('full');
    expect(compileCard(make(SEEK.replace('into your hand', 'onto the battlefield'), ['Vexa, Keeper of Vows', 'Example Relic'])).automation.level).toBe('full');
  });
});
