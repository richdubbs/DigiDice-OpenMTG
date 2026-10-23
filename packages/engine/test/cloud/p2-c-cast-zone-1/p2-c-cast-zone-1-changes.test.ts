/**
 * Lane p2-c-cast-zone, round p2-c-cast-zone-1: the round's parser and lowering changes, one test each, with synthetic wordings (design 6.10). No template was added:
 *   - lower/cast-self.ts#castSelfProgramSafe and lower/ability.ts#triggered: a cast trigger of the spell itself is judged on its lowered effect (it names the spell only
 *     to copy or counter it), not on its text; its intervening "if" goes on to the whole-effect check; "if it was kicked" is this spell's cast record (CR 113.6k, 603.4)
 *   - parser/holes/cond.ts: "if ~ is in your graveyard" (CR 113.6m, 603.4)
 *   - lower/trigger-zone.ts: "When ~ is put into your graveyard from <a zone other than the battlefield>" automated from the graveyard (CR 113.6k)
 * The behavior is in p2-c-cast-zone-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { castSelfProgramSafe } from '../../../src/parser/lower/cast-self';
import { card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const creature = (text: string) => parseCard(card('Example Wyrm', 'Creature — Eldrazi', text, { power: '4', toughness: '4' }), OPTS).faces[0]!;
const json = (f: ReturnType<typeof creature>): string => JSON.stringify(f.abilities);

describe('p2-c-cast-zone-1: cast triggers of the spell itself (CR 113.6k, 601.2i)', () => {
  it('castSelfProgramSafe: the spell itself only as what a copy or counter acts on; any other {ref:self} or self filter is refused', () => {
    expect(castSelfProgramSafe({ steps: [{ op: 'copy', what: { ref: 'self' }, result: 'spell', who: { ref: 'you' } }] })).toBe(true);
    expect(castSelfProgramSafe({ steps: [{ op: 'counter', what: { ref: 'self' } }] })).toBe(true);
    expect(castSelfProgramSafe({ steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'manaSpent' } }] })).toBe(true);
    expect(castSelfProgramSafe({ steps: [{ op: 'move', what: { ref: 'self' }, to: { zone: 'exile' } }] })).toBe(false);
    expect(castSelfProgramSafe({ steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'you' }, amount: 1 }] })).toBe(false);
    expect(castSelfProgramSafe({ steps: [{ op: 'destroy', what: { ref: 'each', filter: { self: true } } }] })).toBe(false);
  });
  it('a pronoun that names another object no longer keeps the trigger manual; naming the spell itself still does', () => {
    expect(fullyAutomated(creature('When you cast this spell, search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'))).toBe(true);
    expect(fullyAutomated(creature('When you cast this spell, exile ~.'))).toBe(false);
  });
  it('the intervening "if" goes on to the whole-effect check ("draw cards equal to the difference" reads it)', () => {
    const f = creature('When you cast this spell, if you have fewer than five cards in hand, draw cards equal to the difference.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"zone":["stack"]');
  });
  it('"if it was kicked" is this spell\'s own cast record (no object)', () => {
    const f = creature('Kicker {2}\nWhen you cast this spell, if it was kicked, draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"interveningIf":{"cond":"wasCast","kicked":true}');
  });
});

describe('p2-c-cast-zone-1: abilities that function in the graveyard (CR 113.6k, 113.6m)', () => {
  it('parser/holes/cond.ts: "if ~ is in your graveyard" is the card itself in your graveyard; another zone stays manual', () => {
    const f = creature('At the beginning of your upkeep, if ~ is in your graveyard, you may pay {2}. If you do, return ~ to your hand.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"interveningIf":{"cond":"matches","object":{"ref":"self"},"filter":{"zone":"graveyard","owner":"you"}}');
    expect(json(f)).toContain('"zone":["graveyard"]');
    expect(fullyAutomated(creature('At the beginning of your upkeep, if ~ is in your hand, you may pay {2}. If you do, draw a card.'))).toBe(false);
  });
  it('lower/trigger-zone.ts: "When ~ is put into your graveyard from your library" functions in the graveyard; "from anywhere" stays manual', () => {
    const f = creature('When ~ is put into your graveyard from your library, you may put it onto the battlefield.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"zone":["graveyard"]');
    expect(fullyAutomated(creature('When ~ is put into a graveyard from anywhere, you gain 2 life.'))).toBe(false);
  });
  it('lower/ability.ts#deadWhereItFunctions: an ability with no zone whose condition needs ~ in another zone stays manual (it would never apply on the battlefield)', () => {
    expect(fullyAutomated(creature('As long as ~ is in your graveyard, lands you control have "{T}: Add {G}."'))).toBe(false);
  });
  it('a cast trigger that makes a token copy of the spell stays manual (only a spell copy or a counter of it is read from the stack)', () => {
    expect(fullyAutomated(creature("When you cast this spell, create a token that's a copy of it."))).toBe(false);
  });
});
