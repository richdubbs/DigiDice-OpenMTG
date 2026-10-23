/**
 * CMDF item 6 (cosmetic): a total cost is printed in the order a mana cost is written (CR 107.4, 202.1: {X}, then the generic mana as one symbol, then the
 * rest), so a commander's base cost and its tax (CR 903.8) read "{3}{G}", not "{1}{G}{2}"; and the top-or-bottom choice reads "choose an option" (fixed by
 * FAST5 LNK1 in effects/handlers/choose.ts#choicePrompt; pinned here on the card the FAST4 audit noted).
 */
import { describe, expect, it } from 'vitest';
import { canonicalManaSymbols, manaCostText } from '../../src/rules/cost';
import { parseManaCost } from '../../src/types/mana';
import { cast, target } from '../m5/cr-examples/helpers';
import { find, pass, scenario } from '../m5/helpers';
import { act, commanderRec, commanderScenario, forests, inCommand, legend, tweak } from '../m11/rules/helpers';

const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

describe('CMDF item 6: a total cost in canonical order (CR 107.4, 202.1)', () => {
  it('canonicalManaSymbols: {X} first, the generic mana summed, then the other symbols in their order', () => {
    const t = (c: string): string => manaCostText(canonicalManaSymbols(parseManaCost(c)!));
    expect(t('{1}{G}{2}')).toBe('{3}{G}');
    expect(t('{W}{2}')).toBe('{2}{W}');
    expect(t('{G}{X}{1}{W/P}{2}')).toBe('{X}{3}{G}{W/P}');
    expect(t('{0}')).toBe('{0}');
    expect(t('{W}{U}')).toBe('{W}{U}');
  });

  it('CR 903.8, 601.2h: the payment of a commander with its tax asks for and logs "{3}{G}", not "{1}{G}{2}"', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], p1: { battlefield: forests(4) } });
    s = tweak(s, (t) => { commanderRec(t, 'p1', 'Test Titania').casts = 1; });
    s = act(s, { type: 'cast', player: 'p1', card: inCommand(s, 'Test Titania') });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{3}{G}', prompt: 'Pay {3}{G} for Test Titania.' });
  });
});

describe('CMDF item 6: "choose an option" (the top-or-bottom choice, CR 401.1, 608.2d)', () => {
  it('Uneasy Partings: the owner is asked to "choose an option", never "choose a option"', () => {
    let s = scenario(['Uneasy Partings', 'Grizzly Bears', 'Island'], { p1: { hand: ['Uneasy Partings'], battlefield: ['Island', 'Island', 'Island', 'Island'] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = cast(s, 'Uneasy Partings', [target(find(s, 'Grizzly Bears', 'battlefield'))]);
    s = pass(pass(s));
    expect(s.pending).toMatchObject({ kind: 'chooseOption', prompt: 'Uneasy Partings: choose an option' });
  });
});
