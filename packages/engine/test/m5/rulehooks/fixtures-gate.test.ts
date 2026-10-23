/**
 * Design 6.8 (guard G6): the WP16 fixture cards are written in the JSON the render gate accepts for their Oracle text, so the tests exercise what the parser
 * can actually produce (a fixture in a form the gate rejects would test data no card ever has).
 */
import { describe, expect, it } from 'vitest';
import { renderGate, type AbilityDef, type CardDef } from '../../../src/index';
import { renderGateKeywordLine } from '../../../src/render/gate';
import { ARREST, DEATH_RATTLE_ONI, FIREBALL, FROGMITE, MANA_VAULT, PACIFISM, PLATINUM_ANGEL, THALIA, THOUGHTCAST, UNCOUNTERABLE } from './fixtures';

const statics = (def: CardDef): AbilityDef[] => def.faces[0]!.abilities.filter((a) => a.kind === 'static');

describe('design 6.8: every WP16 fixture rule ability renders as its Oracle text', () => {
  const check = (name: string, def: CardDef): void => {
    for (const a of statics(def)) {
      const r = renderGate(a, [a.text], { selfNames: [name] });
      expect(r.ok, `${a.text}\nrendered: ${r.rendered}`).toBe(true);
    }
  };

  it.each([
    ['Thalia, Guardian of Thraben', THALIA], ['Pacifism', PACIFISM], ['Mana Vault', MANA_VAULT], ['Test Uncounterable', UNCOUNTERABLE], ['Death-Rattle Oni', DEATH_RATTLE_ONI],
    ['Fireball', FIREBALL],
  ] as const)('%s', (name, def) => check(name, def));

  // Was a tracked gap (the renderer had no "A and B" joining of two restrictions with different subjects); the line renders since FAST3 T15's player-rule
  // renderer additions (render/stat.ts), so this is a plain `it` now.
  it('Platinum Angel ("You can\'t lose the game and your opponents can\'t win the game.")', () => check('Platinum Angel', PLATINUM_ANGEL));
  // FAST1 T5 (render family shared-subject): "can't attack or block, and its activated abilities can't be activated" (CR 602.5)
  it('Test Arrest ("... and its activated abilities can\'t be activated.")', () => check('Test Arrest', ARREST));

  it.each([['Frogmite', FROGMITE], ['Thoughtcast', THOUGHTCAST]] as const)('%s: "Affinity for artifacts" (CR 702.41a)', (name, def) => {
    const kw = def.faces[0]!.abilities.filter((a): a is Extract<AbilityDef, { kind: 'keyword' }> => a.kind === 'keyword');
    expect(renderGateKeywordLine(kw, ['Affinity for artifacts'], { selfNames: [name] }).ok).toBe(true);
  });
});
