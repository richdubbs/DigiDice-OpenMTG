/**
 * edh-next-112 (concept lane library-draw): the round's parser, renderer and engine changes, one test each (no template: three readings of the hole grammars).
 * CR cites from memory (unverified: no rules/cr in a cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;

describe('edh-next-112 parser, renderer and engine changes (one test each)', () => {
  it('parser/holes/filter.ts (CR 607.2a, 201.2; Circu): "spells with the same name as a card exiled with ~" reads when the face has the exiling instruction; with none it stays manual; another noun stays unread', () => {
    const exile = "{0}: Exile the top card of target player's library.";
    const rest = "Your opponents can't cast spells with the same name as a card exiled with ~.";
    expect(fullyAutomated(face(card('Example Seer', 'Artifact Creature — Wizard', `${exile}\n${rest}`, { power: '1', toughness: '1' })))).toBe(true);
    expect(fullyAutomated(face(card('Example Seer', 'Artifact Creature — Wizard', rest, { power: '1', toughness: '1' })))).toBe(false);
    expect(fullyAutomated(face(card('Example Seer', 'Artifact Creature — Wizard', `${exile}\nYour opponents can't cast spells with the same name as a creature exiled with ~ or with the same type.`, { power: '1', toughness: '1' })))).toBe(false);
  });
  it('parser/holes/filter.ts + render/np.ts (CR 208.1, 201.2; Wild Pair): "a creature card with the same total power and toughness" reads in a trigger about a creature; in a spell (no event subject) it stays manual', () => {
    const trig = 'Whenever a creature enters, you may search your library for a creature card with the same total power and toughness, put it onto the battlefield, then shuffle.';
    expect(fullyAutomated(face(card('Example Twins', 'Enchantment', trig)))).toBe(true);
    expect(fullyAutomated(face(card('Example Plan', 'Sorcery', 'Search your library for a creature card with the same total power and toughness, put it onto the battlefield, then shuffle.')))).toBe(false);
  });
});
