/**
 * Standard merge wave 4: readings that only exist once two merged lines meet.
 *
 *   CR 608.2d   "you may draw a card and proliferate" (Tidus, Yuna's Guardian, reachable since r3-fx reads its trigger): one optional
 *               instruction over both verbs. M12's `eff.m12.player.mayDraw` ("{p} may draw N cards", written for "its controller may
 *               draw a card") read only the draw as optional and tied with `ch.may` over both (an equal-priority conflict, design 6.3
 *               rule 3); with `weak: 1` it reads a sentence only where no other template does.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { bare, card } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (text: string) => parseCard(card('Example Brute', 'Creature — Human Warrior', text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const json = (text: string): string => JSON.stringify(bare(face(text).abilities));

describe('CR 608.2d: "you may A and B" is one optional instruction', () => {
  it('"you may draw a card and proliferate" makes both verbs the one optional action', () => {
    const f = face('Whenever Example Brute deals combat damage to a player, you may draw a card and proliferate.');
    const text = JSON.stringify(bare(f.abilities));
    expect(f.abilities.every((a) => a.kind !== 'manual'), text).toBe(true);
    expect(text).toContain('"op":"may","who":{"ref":"you"},"do":[{"op":"draw","who":{"ref":"you"},"count":1},{"op":"action","action":"proliferate","who":{"ref":"you"}}]');
  });
  it('M12\'s "its controller may draw a card" keeps its template', () => {
    const f = face('Whenever a creature an opponent controls dies, its controller may draw a card.');
    expect(f.abilities.every((a) => a.kind !== 'manual'), json('Whenever a creature an opponent controls dies, its controller may draw a card.')).toBe(true);
    expect(f.templatesUsed).toContain('eff.m12.player.mayDraw');
  });
});
