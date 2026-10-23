/**
 * CMDF item 4: "~ can be your commander" (CR 903.3a) is modeled as a static ability `{ s: 'deckConstruction', rule: 'canBeCommander' }`: an ability that
 * modifies the rules for deck construction functions before the game begins (CR 113.6n) and does nothing in the game, so it no longer keeps its card manual.
 * Real fixture cards on the game path: Freyalise, Llanowar's Fury (a planeswalker) and Ashaya's Enduring Bond (a legendary sorcery).
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, getChars, type CardDef } from '../../src/index';
import { compiledDefs } from '../fixtures';
import { find, scenario } from '../m5/helpers';

const def = (name: string): CardDef => compiledDefs([name])[0]!;
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const DECK = { kind: 'static', text: '~ can be your commander.' };

describe('CMDF item 4: "~ can be your commander" (CR 903.3a, 113.6n)', () => {
  it('static:deckConstruction is a capability; Freyalise, Llanowar\'s Fury and Ashaya\'s Enduring Bond are full on the game path', () => {
    expect(ENGINE_CAPABILITIES.has('static:deckConstruction')).toBe(true);
    for (const n of ["Freyalise, Llanowar's Fury", "Ashaya's Enduring Bond"]) {
      const d = def(n);
      expect(full(d), `${n}: ${JSON.stringify(d.automation)}`).toBe(true);
      expect(d.faces[0]!.abilities.find((a) => a.text === DECK.text)).toMatchObject({ ...DECK, effects: [{ s: 'deckConstruction', rule: 'canBeCommander' }] });
    }
  });

  it('CR 113.6n: in a game the ability does nothing: Freyalise on the battlefield has its loyalty abilities and nothing else changes', () => {
    const s = scenario(["Freyalise, Llanowar's Fury", 'Grizzly Bears'], { p1: { battlefield: ["Freyalise, Llanowar's Fury", 'Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect([getChars(s, bears).power, getChars(s, bears).toughness]).toEqual(['2', '2']);
    expect(s.continuousEffects ?? []).toEqual([]);
  });
});
