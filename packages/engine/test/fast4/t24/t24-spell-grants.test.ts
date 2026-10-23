/**
 * FAST4 T24 merge check (G10): `stackKind` became a static filter field (statics/match.ts), so the existing `sta.grant.each` shape "Instant and sorcery spells
 * you control have <keyword>" now reaches spells on the stack, and cards such as Cast Through Time, Samut, Tyrant of Naktamun, Pestilent Spirit and Heartflame
 * Duelist compile full. These scenarios play each granted keyword through the engine (synthetic wordings, design 6.10).
 *
 *   CR 702.88a, 613.1f   rebound: an instant cast from hand is exiled as it resolves and may be cast at its controller's next upkeep
 *   CR 702.61a, 613.1f   split second: while the spell is on the stack the opponent can't cast a spell
 *   CR 702.2b, 613.1f    deathtouch: 1 damage from the instant destroys a 4/4
 *   CR 702.15b, 613.1f   lifelink: damage dealt by the instant makes its controller gain that much life
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, labels, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
function settle(s0: GameState, targets: TargetChoice[] = [], yes = true): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], player: 'p1' | 'p2' = 'p1'): GameState =>
  settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);
function resolveAll(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets);
  return s;
}

const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.');

describe('"Instant and sorcery spells you control have <keyword>" (sta.grant.each, CR 613.1f)', () => {
  it('rebound (CR 702.88a): the instant cast from hand is exiled as it resolves, not put into the graveyard', () => {
    const SOURCE = card('Test Timeweaver', 'Enchantment', 'Instant and sorcery spells you control have rebound.');
    expect(automated(SOURCE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Timeweaver'] }, defs: [SOURCE, TONIC] });
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Tonic'));
    expect(life(s, 'p1')).toBe(before + 2);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).not.toContain('Test Tonic');
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Tonic');
  });
  it('split second (CR 702.61a): the opponent cannot cast an instant while the spell is on the stack', () => {
    const SOURCE = card('Test Tyrant', 'Creature — Human Wizard', 'Instant and sorcery spells you control have split second.', ['2', '1']);
    expect(automated(SOURCE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Tyrant'] }, p2: { hand: ['Test Tonic'] }, defs: [SOURCE, TONIC] });
    s = cast(s, 'Test Tonic');
    s = pass(s); // p1 passes, p2 has priority with the spell on the stack
    expect(s.pending?.player).toBe('p2');
    expect(labels(s, 'p2')).not.toContain('Cast Test Tonic');
  });
  it('deathtouch (CR 702.2b): 1 damage from the instant destroys a 4/4', () => {
    const SOURCE = card('Test Spirit', 'Creature — Spirit', 'Instant and sorcery spells you control have deathtouch.', ['3', '2']);
    expect(automated(SOURCE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Spirit'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SOURCE, BOLT, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Bolt', [{ kind: 'object', id: ogre }]));
    expect(s.zones.battlefield).not.toContain(ogre);
  });
  it('lifelink (CR 702.15b): the instant\'s controller gains as much life as the damage it dealt', () => {
    const SOURCE = card('Test Duelist', 'Creature — Human Knight', 'Instant and sorcery spells you control have lifelink.', ['3', '1']);
    expect(automated(SOURCE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Bolt'], battlefield: ['Test Duelist'] }, defs: [SOURCE, BOLT] });
    const before = life(s, 'p1');
    const foe = life(s, 'p2');
    s = resolveAll(cast(s, 'Test Bolt', [{ kind: 'player', id: 'p2' }]));
    expect(life(s, 'p2')).toBe(foe - 1);
    expect(life(s, 'p1')).toBe(before + 1);
  });
});
