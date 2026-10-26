/**
 * pc-exile-play-3 (precon lane pc-exile-play): "The next noncreature spell you cast this turn has cascade", "The next instant or sorcery spell you cast this turn has storm"
 * and "The next instant spell and the next sorcery spell you cast this turn each have cascade" played through the engine with synthetic cards (design 6.10). CR cites
 * from memory, unverified (no rules/cr in the cloud checkout).
 *
 *   CR 601.2a, 611.2c, 702.85a   the next matching spell has the keyword as it is cast (the cascade triggers); a spell that does not match leaves it waiting; the spell after does not have it
 *   CR 702.40a                   the next instant or sorcery has storm: it is copied once for each spell cast before it this turn
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../../../src/index';
import { act, advanceTo, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const BOOST = card('Test Boost', 'Artifact', '{T}: The next noncreature spell you cast this turn has cascade.');
const STORMER = card('Test Stormer', 'Artifact', '{T}: The next instant or sorcery spell you cast this turn has storm.');
const PAIR = card('Test Pair', 'Artifact', '{T}: The next instant spell and the next sorcery spell you cast this turn each have cascade.');
const CHARM = card('Test Charm', 'Instant', 'You gain 5 life.', undefined, '{1}');
const SORC = card('Test Rite', 'Sorcery', 'You gain 7 life.', undefined, '{1}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', undefined, '{0}');
const DEFS = [BOOST, STORMER, PAIR, CHARM, SORC, BEAR, SIP];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const castAction = (s: GameState, name: string): Action | undefined =>
  legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
const activate = (s: GameState, name: string): GameState => {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object !== undefined && nameOf(s, x.object) === name)!;
  return resolveAll(act(s, a.action));
};
const cast = (s: GameState, name: string): GameState => resolveAll(settle(act(s, castAction(s, name)!)));

describe('CR 601.2a, 611.2c, 702.85a: the next noncreature spell you cast this turn has cascade', () => {
  it('a creature spell cast first leaves it waiting; the next noncreature spell cascades (+1 from the {0} spell in the library); the one after does not', () => {
    let s = activate(scenario([], { defs: DEFS, p1: { battlefield: ['Test Boost', 'Plains', 'Plains', 'Plains'], hand: ['Test Bear', 'Test Charm', 'Test Charm'], library: ['Test Sip', 'Test Sip', 'Test Sip'] } }), 'Test Boost');
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Bear');
    expect(life(s, 'p1')).toBe(l0);
    s = cast(s, 'Test Charm');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1);
    s = cast(s, 'Test Charm');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1 + 5);
  });
  it('without activating it nothing cascades; the rider ends with the turn', () => {
    const base = scenario([], { defs: DEFS, p1: { battlefield: ['Test Boost', 'Plains'], hand: ['Test Charm'], library: ['Test Sip', 'Test Sip'] } });
    expect(life(cast(base, 'Test Charm'), 'p1')).toBe(life(base, 'p1') + 5);
    const later = advanceTo(activate(base, 'Test Boost'), 3, 'main1');
    expect(later.turn.nextSpell ?? []).toEqual([]);
  });
});

describe('CR 702.40a: the next instant or sorcery spell you cast this turn has storm', () => {
  it('after one {0} spell, the next instant is copied once (three resolutions in all: 1 + 1 + 1); a creature spell cast between does not take it', () => {
    let s = activate(scenario([], { defs: DEFS, p1: { battlefield: ['Test Stormer', 'Plains'], hand: ['Test Sip', 'Test Sip', 'Test Bear'] } }), 'Test Stormer');
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Bear'); // not an instant or sorcery: no storm, the rider waits
    expect(life(s, 'p1')).toBe(l0);
    s = cast(s, 'Test Sip'); // the next instant: storm counts the Bear (1 spell before it): one copy
    expect(life(s, 'p1')).toBe(l0 + 2);
    s = cast(s, 'Test Sip'); // no storm any more
    expect(life(s, 'p1')).toBe(l0 + 3);
  });
});

describe('CR 601.2a, 702.85a: the next instant spell and the next sorcery spell each have cascade', () => {
  it('the first instant and the first sorcery cascade (+1 each); a second instant does not', () => {
    let s = activate(scenario([], { defs: DEFS, p1: { battlefield: ['Test Pair', 'Plains', 'Plains', 'Plains'], hand: ['Test Charm', 'Test Charm', 'Test Rite'], library: ['Test Sip', 'Test Sip', 'Test Sip'] } }), 'Test Pair');
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Charm');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1);
    s = cast(s, 'Test Rite');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1 + 7 + 1);
    s = cast(s, 'Test Charm');
    expect(life(s, 'p1')).toBe(l0 + 5 + 1 + 7 + 1 + 5);
  });
});
