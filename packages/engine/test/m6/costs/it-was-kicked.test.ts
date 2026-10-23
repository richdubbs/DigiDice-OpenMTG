/**
 * M6-5a: "When ~ enters, if it was kicked, ..." (CR 603.4 intervening "if", CR 702.33d), the commonest kicker trigger. The Cond hole reads "it was kicked" with
 * the pronoun kept as a `$self` marker (parser/holes/cond.ts); parser/lower/ability.ts#resolveCondAnaphors keeps the reading only when the pronoun resolves to
 * the object itself, i.e. in the object's own enters trigger (CR 603.6a), because `wasCast` reads the cast history of the ability's own object. Every other
 * antecedent leaves the marker and the sentence stays manual.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import type { CardDef, GameState } from '../../../src/index';
import { castWith, drive, gamePath, handSize, no, resolveAll, resolveTop, scenario, stackNames, synthetic, yes } from './support';

const creature = (text: string): CardDef => synthetic('Test Kicked Elf', 'Creature — Elf', '{G}', `Kicker {2}\n${text}`, { power: '1', toughness: '1' } as never);
const ability = (d: CardDef): AbilityDef => d.faces[0]!.abilities[1]!;

describe('CR 603.4, 702.33d: "if it was kicked" in the object\'s own enters trigger', () => {
  it('parses to the intervening "if" wasCast kicked, as "if ~ was kicked" does, and passes the render gate (the card is full)', () => {
    const d = creature('When this creature enters, if it was kicked, draw a card.');
    expect(d.automation.level).toBe('full');
    expect(ability(d)).toMatchObject({ kind: 'triggered', interveningIf: { cond: 'wasCast', kicked: true } });
    expect(JSON.stringify(ability(d))).not.toContain('$self');
    const negated = creature('When this creature enters, if it wasn\'t kicked, draw a card.');
    expect(ability(negated)).toMatchObject({ interveningIf: { cond: 'not', of: { cond: 'wasCast', kicked: true } } });
  });

  it('fails closed for every other antecedent: another trigger event, a dies trigger, another object, an effect sentence, a static ability', () => {
    for (const text of [
      'Whenever this creature attacks, if it was kicked, draw a card.',
      'When this creature dies, if it was kicked, draw a card.',
      'Whenever a creature enters, if it was kicked, draw a card.',
      'As long as it was kicked, this creature has flying.',
    ]) {
      const d = creature(text);
      expect(d.automation.level, text).not.toBe('full');
      expect(ability(d).kind, text).toBe('manual');
    }
    // M6-5: in an instruction the same rule holds (parser/lower/anaphora.ts#ownCastHistory): another trigger's "it" stays manual
    for (const text of ['When this creature dies, draw a card. If it was kicked, draw a card.', 'Whenever a creature enters, draw a card. If it was kicked, draw a card.']) {
      const inEffect = ability(creature(text));
      expect(JSON.stringify(inEffect), text).toContain('"op":"manual"');
      expect(JSON.stringify(inEffect), text).not.toContain('wasCast');
    }
  });

  it('M6-5: in an instruction of the object\'s own enters trigger, "If it was kicked, ..." reads its cast record (CR 400.7d, 702.33e)', () => {
    const inEffect = ability(creature('When this creature enters, draw a card. If it was kicked, draw a card.'));
    expect(inEffect).toMatchObject({ effect: { steps: [{ op: 'draw' }, { op: 'if', cond: { cond: 'wasCast', kicked: true } }] } });
    expect(JSON.stringify(inEffect)).not.toContain('$self');
  });

  it('Archangel of Wrath\'s "When ~ enters, if it was kicked, it deals 2 damage to any target" is automated, and since M6-5 the whole card (two kickers, "kicked twice")', () => {
    const d = gamePath('Archangel of Wrath');
    const triggers = d.faces[0]!.abilities.filter((a) => a.kind === 'triggered');
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toMatchObject({ interveningIf: { cond: 'wasCast', kicked: true } });
    expect(triggers[1]).toMatchObject({ interveningIf: { cond: 'compare', left: { q: 'kickCount' }, op: '>=', right: 2 } });
    expect(d.automation.level).toBe('full');
  });

  it('kicked: the trigger draws a card; not kicked: it does not trigger at all (CR 603.4)', () => {
    const d = creature('When this creature enters, if it was kicked, draw a card.');
    const board = (): GameState => scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Test Kicked Elf'], battlefield: Array(3).fill('Forest') as string[], library: Array(3).fill('Grizzly Bears') as string[] }, defs: [d] });
    let s = resolveTop(castWith(board(), 'Test Kicked Elf', [yes]));
    expect(stackNames(s)).toEqual(['ability of Test Kicked Elf']);
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(1);
    s = drive(resolveTop(castWith(board(), 'Test Kicked Elf', [no])));
    expect(s.zones.stack).toEqual([]);
    expect(handSize(s, 'p1')).toBe(0);
  });
});
