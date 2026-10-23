/**
 * WP22 review, finding 8 (design 6.4, the never-silently-wrong rule): "Other ..." opening a later sentence refers back to the group or target an earlier
 * sentence of the same ability named, not to the source ("Zombies you control get +2/+1 until end of turn. Other creatures you control get +1/+1 until
 * end of turn.": each creature gets one of the bonuses, never both). For a spell "other than the source" never means anything, since the spell is never
 * among the affected permanents. The object/group hole reads "other" as "other than the source" (`other: true`), so such a sentence must be manual
 * unless it is resolved to its antecedent (lower/anaphora.ts). Synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { castAuto, find, passBoth, scenario, synth } from '../helpers';
import { drainManual } from '../run/helpers';
import { automated, card, face, options } from './support';

const opts = options([], { capabilities: ENGINE_CAPABILITIES });
const parse = (type: string, text: string): AbilityDef[] => face(card('Test Rally', type, text), opts).abilities;
const json = (a: readonly AbilityDef[]): string => JSON.stringify(a);

describe('CR 608.2c, 611.2c, design 6.4: "Other ..." after a sentence that named a group or a target is never read as "other than the source"', () => {
  it('a spell: "Golems you control get +2/+1 until end of turn. Other creatures you control get +1/+1 until end of turn." is not fully automated', () => {
    const a = parse('Instant', 'Golems you control get +2/+1 until end of turn. Other creatures you control get +1/+1 until end of turn.');
    expect(automated(a), json(a)).toBe(false);
    expect(json(a)).not.toContain('"other":true');
  });
  // std-rB (parser/lower/targets.ts#otherNotSource): the one earlier target of a spell is the antecedent (unique candidate, design 6.4), so the sentence is
  // resolved to it, never to the source; before std-rB it stayed manual
  it('a spell with one target: "Target creature you control gets +3/+3 until end of turn. Other creatures you control get +1/+0 until end of turn." is resolved to that target', () => {
    const a = parse('Sorcery', 'Target creature you control gets +3/+3 until end of turn. Other creatures you control get +1/+0 until end of turn.');
    expect(automated(a), json(a)).toBe(true);
    expect(json(a)).not.toContain('"other":true');
    expect(json(a)).toContain('"affects":{"ref":"each","filter":{"types":["Creature"],"controller":"you","not":{"is":{"ref":"target","id":"t0"}}}}');
  });
  it('an activated ability of a permanent with an earlier group: "{2}: Golems you control get +1/+0 until end of turn. Other creatures you control gain haste until end of turn." is not fully automated', () => {
    const a = parse('Artifact', '{2}: Golems you control get +1/+0 until end of turn. Other creatures you control gain haste until end of turn.');
    expect(automated(a), json(a)).toBe(false);
  });
  it('a permanent\'s ability whose ONLY group is "other" keeps meaning "other than ~" (CR 109.2): "When ~ enters, other creatures you control get +1/+1 until end of turn."', () => {
    const a = parse('Creature — Golem', 'When ~ enters, other creatures you control get +1/+1 until end of turn.');
    expect(automated(a), json(a)).toBe(true);
    expect(json(a)).toContain('"other":true');
  });
  it('a spell never means "other than the source": "Other creatures you control get +1/+1 until end of turn." alone is not fully automated', () => {
    expect(automated(parse('Instant', 'Other creatures you control get +1/+1 until end of turn.'))).toBe(false);
  });
});

describe('CR 608.2c, 611.2c: the parsed spell never gives a Zombie both bonuses (scenario)', () => {
  it('a 2/2 Zombie never ends as a 5/4 and a 2/2 non-Zombie never as a 3/3: the "Other" sentence is resolved by hand (with the "until" of a manual sentence, taint T2 makes the spell manual, design 6.7)', () => {
    const rally: CardDef = synth({ name: 'Test Rally', type: 'Instant', cost: '{0}', abilities: parse('Instant', 'Zombies you control get +2/+1 until end of turn. Other creatures you control get +1/+1 until end of turn.') });
    const zombie: CardDef = synth({ name: 'Test Zombie', type: 'Creature — Zombie', cost: '{1}', pt: ['2', '2'], abilities: [] });
    const s0 = scenario(['Grizzly Bears'], { defs: [rally, zombie], p1: { hand: ['Test Rally'], battlefield: ['Test Zombie', 'Grizzly Bears'] } });
    const { s, seen } = drainManual(passBoth(castAuto(s0, 'Test Rally')));
    const pt = (g: GameState, name: string): [string, string] => { const c = getChars(g, find(g, name, 'battlefield')); return [c.power ?? '', c.toughness ?? '']; };
    expect(pt(s, 'Test Zombie')).not.toEqual(['5', '4']);
    expect(pt(s, 'Grizzly Bears')).not.toEqual(['3', '3']);
    expect(seen.join(' ')).toContain('Other creatures you control get +1/+1 until end of turn.');
  });
});

describe('CR 608.2c: "target X and each other X ..." in a spell keeps the target in the set either way (no false manual)', () => {
  it('"Target creature and each other creature that shares a color with it gain haste until end of turn." (a spell) is still fully automated', () => {
    const a = parse('Instant', 'Target creature and each other creature that shares a color with it gain haste until end of turn.');
    expect(automated(a), json(a)).toBe(true);
  });
  it('the same words in an activated ability of a permanent are not: there "other" would exclude the source instead of the target', () => {
    const a = parse('Artifact', '{3}: Target creature and each other creature that shares a color with it gain haste until end of turn.');
    expect(automated(a), json(a)).toBe(false);
  });
});
