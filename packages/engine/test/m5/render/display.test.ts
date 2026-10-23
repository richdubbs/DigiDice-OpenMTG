/**
 * WP2 review fixes: the display text (renderAbility) is a faithful reading of the JSON (design 10.5: "by guard G6 the reading equals the Oracle sentence for
 * automated abilities"). With the Oracle lines of the ability in the context it is the reading that the gate matched, sentence for sentence; without them it is
 * the most faithful first reading, and a position the model cannot decide says so instead of guessing (CR 303.4, 301.5, 400.3, 110.2a).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EffectStep } from '../../../src/types/ability';
import { renderAbility, renderGate, normalizeForGate } from '../../../src/index';
import { examples } from './examples';
import { accepts, CTX, display, draw, mana, objTarget, rejects, spell, statics, t, you } from './build';

describe('CR 303.4 and 301.5: an attached-to reference of an unknown card is neutral on display and never accepted as printed', () => {
  const equipment = statics([{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: '7c', power: 2, toughness: 0 }] }]);
  const unknown = { selfNames: ['Test Card'] };
  it('shows "attached creature" (not "enchanted creature") when the card types are unknown', () => {
    expect(display(equipment, unknown)).toBe('Attached creature gets +2/+0.');
  });
  it('the gate accepts the real wordings only', () => {
    accepts(equipment, 'Equipped creature gets +2/+0.', unknown);
    accepts(equipment, 'Enchanted creature gets +2/+0.', unknown);
    rejects(equipment, 'Attached creature gets +2/+0.', unknown);
  });
  it('knowing the types picks the word', () => {
    expect(display(equipment, { selfNames: ['Test Card'], selfTypes: ['Artifact', 'Equipment'] })).toBe('Equipped creature gets +2/+0.');
    expect(display(equipment, { selfNames: ['Test Card'], selfTypes: ['Enchantment', 'Aura'] })).toBe('Enchanted creature gets +2/+0.');
  });
});

describe('CR 110.2a: a card put onto the battlefield under a stated controller says so', () => {
  const reanimate = spell([{ op: 'move', what: t('c'), to: { zone: 'battlefield', controller: you } } as EffectStep], [objTarget('c', { zone: 'graveyard', types: ['Creature'] })]);
  it('displays "under your control"', () => expect(display(reanimate)).toContain('under your control'));
  it('the gate accepts it with or without (the actor controls what it puts onto the battlefield)', () => {
    accepts(reanimate, 'Return target creature card from a graveyard to the battlefield under your control.');
    accepts(reanimate, 'Return target creature card from a graveyard to the battlefield.');
  });
});

describe('CR 400.3 and 701: the verb of a move follows where the card comes from', () => {
  it('a card revealed from the library is "put" into the hand, not "returned"', () => {
    const def = spell([
      { op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, as: 'c' } as EffectStep,
      { op: 'move', what: { ref: 'bound', name: 'c' }, to: { zone: 'hand' } } as EffectStep,
    ]);
    expect(display(def)).toMatch(/[Pp]ut (that|the) card|[Pp]ut it/);
    expect(display(def)).not.toMatch(/[Rr]eturn/);
  });
  it('a creature on the battlefield is "returned" to its owner\'s hand', () => {
    const bounce = spell([{ op: 'move', what: t('c'), to: { zone: 'hand' } } as EffectStep], [objTarget('c')]);
    expect(display(bounce)).toBe("Return target creature to its owner's hand.");
  });
});

describe('design 10.5: with the Oracle lines in the context the display is the reading that matched', () => {
  const drawThenDiscard = spell([draw(3), { op: 'discard', who: you, count: 2 } as EffectStep]);
  it('without them the joiner is the first reading and the sentence count may differ', () => {
    expect(renderAbility(drawThenDiscard, CTX)).toEqual(['Draw three cards.', 'Discard two cards.']);
  });
  it('with them, one Oracle sentence is one displayed sentence', () => {
    expect(renderAbility(drawThenDiscard, { ...CTX, oracleLines: ['Draw three cards, then discard two cards.'] })).toEqual(['Draw three cards, then discard two cards.']);
    expect(renderAbility(drawThenDiscard, { ...CTX, oracleLines: ['Draw three cards and discard two cards.'] })).toEqual(['Draw three cards and discard two cards.']);
  });
  it('lines that the gate rejects do not change the display', () => {
    expect(renderAbility(drawThenDiscard, { ...CTX, oracleLines: ['Gain 3 life.'] })).toEqual(['Draw three cards.', 'Discard two cards.']);
  });
  it('for every worked example that passes the gate, the display equals the Oracle text after normalization', () => {
    let checked = 0;
    for (const ex of examples as unknown as { name: string; oracle: string[]; card: { abilities?: AbilityDef[] } }[]) {
      const lines = ex.oracle.filter((l) => !(l.startsWith('(') && l.endsWith(')')));
      const names = [ex.name, ...(ex.name.includes(',') ? [ex.name.split(',')[0]!] : [])];
      for (const def of ex.card.abilities ?? []) {
        // the lines this ability covers: the shortest run that passes
        for (let start = 0; start < lines.length; start++) {
          let run: string[] | null = null;
          for (let k = 1; start + k <= lines.length && run === null; k++) if (renderGate(def, lines.slice(start, start + k), { selfNames: names }).ok) run = lines.slice(start, start + k);
          if (run === null) continue;
          const shown = renderAbility(def, { selfNames: names, oracleLines: run });
          expect(normalizeForGate(shown.join(' '), names), ex.name).toBe(normalizeForGate(run.join(' '), names));
          checked++;
          break;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

void mana;
