/**
 * Card wave 2, slice s19 (std-rx8): the readings this round added, played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory, unverified: rules/cr/
 * is not in the cloud checkout).
 *
 *   CR 401.1, 406.1, 608.2h, 603.10a   "exile cards equal to its mana value from the top of target player's library": as many cards as the sacrificed creature's
 *                                       mana value, from the targeted player's library only; sacrificing ~ itself ("another") triggers nothing
 *   CR 601.3, 305.1, 609.4b, 611.2a    "Until your next end step, you may play those cards, and mana of any type can be spent to cast those spells": the exiled
 *                                       cards can be played; a card that stayed in the library cannot
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { find, findAll, scenario } from '../../m5/helpers';
import { activate, resolveAll, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, pt0?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt0 ? { power: pt0[0], toughness: pt0[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

const SCAVENGER = card('Test Bone Scavenger', 'Creature — Demon', "Whenever you sacrifice another creature, exile cards equal to its mana value from the top of target player's library. Until your next end step, you may play those cards, and mana of any type can be spent to cast those spells.", ['4', '4'], '{3}{B}{R}');
const ALTAR = card('Test Altar', 'Artifact', 'Sacrifice a creature: You gain 1 life.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}');
const PEBBLE = card('Test Pebble', 'Artifact', '', undefined, '{0}');
const DEFS = [SCAVENGER, ALTAR, OGRE, PEBBLE];

const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const libSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.library[p]!.length;
/** Sacrifice `what` to the altar; the Scavenger's trigger (if any) targets p2 as it is put on the stack (CR 603.3d). */
const sacrifice = (s: GameState, what: string): GameState => {
  const altar = find(s, 'Test Altar', 'battlefield', 'p1');
  return activate(s, altar, [{ kind: 'chooseObjects', ids: [find(s, what, 'battlefield', 'p1')] }, target('p2')]);
};

describe('std-rx8 cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [SCAVENGER, ALTAR]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 401.1, 406.1, 608.2h, 603.10a: "exile cards equal to its mana value from the top of target player\'s library"', () => {
  const board = (): GameState => scenario([], {
    p1: { battlefield: ['Test Bone Scavenger', 'Test Altar', 'Test Ogre'], library: ['Test Ogre', 'Test Ogre'] },
    p2: { library: ['Test Pebble', 'Plains', 'Test Ogre', 'Test Pebble', 'Test Pebble'] },
    defs: DEFS,
  });
  it('sacrificing a creature of mana value 3 exiles the top three cards of the targeted player\'s library, and only those', () => {
    const s0 = board();
    const s = resolveAll(sacrifice(s0, 'Test Ogre'));
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p1')).toHaveLength(1);
    expect(exiled(s)).toEqual(['Plains', 'Test Ogre', 'Test Pebble']);
    expect(libSize(s, 'p2')).toBe(libSize(s0, 'p2') - 3);
    expect(libSize(s, 'p1')).toBe(libSize(s0, 'p1'));
  });
  it('sacrificing ~ itself is not "another creature": nothing is exiled', () => {
    const s0 = board();
    const s = resolveAll(sacrifice(s0, 'Test Bone Scavenger'));
    expect(findAll(s, 'Test Bone Scavenger', 'graveyard', 'p1')).toHaveLength(1);
    expect(s.zones.exile).toHaveLength(0);
    expect(libSize(s, 'p2')).toBe(libSize(s0, 'p2'));
  });
});

describe('CR 601.3, 305.1, 609.4b, 611.2a: "Until your next end step, you may play those cards, and mana of any type can be spent to cast those spells"', () => {
  it('the exiled spell can be cast and the exiled land played by ~\'s controller; the card left in the library cannot be', () => {
    let s = scenario([], {
      p1: { battlefield: ['Test Bone Scavenger', 'Test Altar', 'Test Ogre'], library: ['Test Ogre', 'Test Ogre'] },
      p2: { library: ['Test Pebble', 'Plains', 'Test Ogre', 'Test Pebble'] },
      defs: DEFS,
    });
    s = resolveAll(sacrifice(s, 'Test Ogre'));
    const exiledPebble = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Pebble')!;
    const exiledPlains = s.zones.exile.find((id) => s.objects[id]!.defId === 'Plains')!;
    const keptPebble = s.zones.library.p2!.find((id) => s.objects[id]!.defId === 'Test Pebble')!;
    const actions = legalActions(s, 'p1').map((a) => a.action as { type: string; card?: string });
    expect(actions.some((a) => a.type === 'cast' && a.card === exiledPebble)).toBe(true);
    expect(actions.some((a) => a.type === 'playLand' && a.card === exiledPlains)).toBe(true);
    expect(actions.some((a) => a.card === keptPebble)).toBe(false);
    expect(legalActions(s, 'p2').some((a) => (a.action as { card?: string }).card === exiledPebble)).toBe(false);
  });
});
