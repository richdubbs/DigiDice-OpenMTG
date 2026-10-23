/**
 * p2-misc-3 (Phase 2 lane p2-misc): "incubate X, where X is ..." (CR 701.53a, 107.3, 608.2h). The generic where-X reading of p2-counters-state-2
 * (eff.p2cs2.effects.whereX) already parsed it; the renderer now says incubate's computed number as "incubate X, where X is ..." (render/steps-lasting.ts
 * #WHERE_X_ACTIONS), so it passes the gate. Synthetic cards (design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { act, answer, find, pass, scenario } from '../../m5/helpers';
import { card as oracle, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const sorcery = (text: string) => parseCard(oracle('Example Brood', 'Sorcery', text), OPTS).faces[0]!;
function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
function settle(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); i++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

describe('CR 701.53a, 107.3: "Incubate X, where X is ..." passes the render gate (render/steps-lasting.ts#WHERE_X_ACTIONS)', () => {
  it('a counted X and an X read from an object are automated, with the generic where-X template', () => {
    for (const text of ['Incubate X, where X is the number of artifacts you control.', 'Draw a card, then incubate X, where X is the number of cards in your hand.']) {
      const f = sorcery(text);
      expect(fullyAutomated(f), text).toBe(true);
      expect(f.templatesUsed, text).toContain('eff.p2cs2.effects.whereX');
      expect(f.gate.every((g) => g.ok), text).toBe(true);
    }
  });
  it('fail closed: "Incubate X twice, where X is ..." and an X with no "where" are not automated', () => {
    expect(fullyAutomated(sorcery('Incubate X twice, where X is the number of artifacts you control.'))).toBe(false);
    expect(fullyAutomated(sorcery('Incubate X.'))).toBe(false);
  });
  it('played: an Incubator token with as many +1/+1 counters as the creatures exiled this way (counted as the action begins, CR 608.2h)', () => {
    const DUSK = card('Test Dusk Harvest', 'Sorcery', 'Exile all creatures. Incubate X, where X is the number of creatures exiled this way.');
    const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear'], hand: ['Test Dusk Harvest'] }, p2: { battlefield: ['Test Bear'] }, defs: [DUSK, BEAR] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dusk Harvest', 'hand', 'p1') }));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    expect(s.objects[tokens[0]!]!.counters['+1/+1']).toBe(3);
    expect(s.objects[tokens[0]!]!.controller).toBe('p1');
  });
});
