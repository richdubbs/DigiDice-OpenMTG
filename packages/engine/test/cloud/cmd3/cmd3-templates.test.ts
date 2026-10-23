/**
 * CMD3 (commander batch): the templates of parser/templates/zz-cloud/cmd3.json, played through the engine with synthetic cards (wordings invented, design 6.10).
 *
 *   CR 614.12a, 607.2a  "This land enters tapped. As it enters, choose a color other than green.": the choice never offers the excluded color
 *   CR 106.1b, 607.2d   "{T}: Add {G} or one mana of the chosen color.": the player picks one of the two as the mana ability resolves (CR 605.3b)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pool, scenario } from '../../m3/scenario';
import { card, full } from './helpers';

const GLADE = card('Test Glade', 'Land', 'This land enters tapped. As it enters, choose a color other than green.\n{T}: Add {G} or one mana of the chosen color.');
const DEFS = [GLADE];

describe('the templates parse the synthetic cards', () => {
  it('the land is understood (the templates are stable: full)', () => {
    expect(full(GLADE), JSON.stringify(GLADE.automation)).toBe(true);
  });
});

describe('CR 614.12a, 106.1b: a color other than green, then {G} or the chosen color', () => {
  const played = (color: 'W' | 'U' | 'B' | 'R'): GameState => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Glade'] }, defs: DEFS });
    const s = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Glade', 'hand') });
    expect(s.pending?.kind).toBe('chooseColor');
    expect((s.pending as { options: string[] }).options.sort()).toEqual(['B', 'R', 'U', 'W']); // never green
    return answer(s, { kind: 'chooseColor', color });
  };

  it('it enters tapped, with the chosen color', () => {
    const s = played('U');
    const glade = find(s, 'Test Glade', 'battlefield');
    expect(s.objects[glade]!.tapped).toBe(true);
  });

  it('tapped for mana on the next turn: {G} or the chosen color, the player picks', () => {
    const s = advanceTo(played('U'), 3, 'main1');
    const glade = find(s, 'Test Glade', 'battlefield');
    const ability = legal(s, 'p1', 'activate').find((a) => a.object === glade && a.isMana)!;
    expect(ability).toBeDefined();
    const asked = act(s, ability.action);
    expect(asked.pending?.kind).toBe('chooseColor');
    expect((asked.pending as { options: string[] }).options.sort()).toEqual(['G', 'U']);
    expect(pool(answer(asked, { kind: 'chooseColor', color: 'U' }), 'p1')).toBe('U');
    expect(pool(answer(asked, { kind: 'chooseColor', color: 'G' }), 'p1')).toBe('G');
  });
});
