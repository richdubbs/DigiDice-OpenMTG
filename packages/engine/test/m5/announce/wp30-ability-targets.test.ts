/**
 * WP30 review: "target spell or ability that targets ..." (`filter:targets`, advertised since WP30) must find ABILITIES on the stack too, as the resolution
 * check does (effects/ctx.ts#targetLegal). CR 115.9b: such an object checks the current targets of the spell or ability. Real cards: Not of This World,
 * Teferi's Response, Siren Stormtamer.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectFilter, TargetSpec } from '../../../src/index';
import { targetOptions } from '../../../src/rules/targets';
import { find, scenario } from '../helpers';
import { chosenObject, putOnStack } from '../eval/helpers';

/** p1: Grizzly Bears, whose triggered ability is on the stack targeting p2's Hill Giant. */
function board(): { s: GameState; ability: string; giant: string } {
  const s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
  const giant = find(s, 'Hill Giant', 'battlefield');
  const ability = putOnStack(s, { name: 'Grizzly Bears', kind: 'triggered', targets: [[chosenObject(giant)]] });
  return { s, ability, giant };
}

const targetsYourPermanent: ObjectFilter = { targets: { ref: 'each', filter: { controller: 'you' } } };
const specOf = (kind: TargetSpec['kind'], filter: ObjectFilter): TargetSpec => ({ id: 'tX', kind, filter, min: 1, max: 1, text: 'target spell or ability that targets a permanent you control' });

describe('CR 115.9b: "target spell or ability that targets a permanent you control" sees abilities', () => {
  it('stackObject: the triggered ability that targets p2\'s Hill Giant is a legal target for p2, not for p1', () => {
    const { s, ability } = board();
    expect(targetOptions(s, specOf('stackObject', targetsYourPermanent), 'p2').objects).toEqual([ability]);
    expect(targetOptions(s, specOf('stackObject', targetsYourPermanent), 'p1').objects).toEqual([]);
  });

  it('ability: the same with "target activated or triggered ability that targets ..."', () => {
    const { s, ability } = board();
    expect(targetOptions(s, specOf('ability', targetsYourPermanent), 'p2').objects).toEqual([ability]);
    expect(targetOptions(s, specOf('ability', { ...targetsYourPermanent, stackKind: 'activatedAbility' }), 'p2').objects).toEqual([]);
  });

  it('is: an ability named by an earlier target is matched by identity; characteristics are still never read from an ability', () => {
    const { s, ability } = board();
    const chosen = new Map([['tA', [chosenObject(ability)]]]);
    expect(targetOptions(s, specOf('ability', { is: { ref: 'target', id: 'tA' } }), 'p2', undefined, undefined, { chosen }).objects).toEqual([ability]);
    expect(targetOptions(s, specOf('ability', { types: ['Creature'] }), 'p2').objects).toEqual([]);
  });
});
