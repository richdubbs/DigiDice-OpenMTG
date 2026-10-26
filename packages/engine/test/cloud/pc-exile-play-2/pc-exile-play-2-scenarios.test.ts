/**
 * pc-exile-play-2 (precon lane pc-exile-play): "The first spell you cast each turn has cascade" and "The first spell you cast from exile each turn has cascade"
 * played through the engine with synthetic cards (invented names, design 6.10). CR cites from memory, unverified (no rules/cr in the cloud checkout).
 *
 *   CR 601.2i, 702.85a   the first spell cast each turn has cascade; the second does not (the count is the caster's own, cast spells only)
 *   CR 601.2i, 400.7     the first spell cast from exile each turn, not the first spell of the turn; a spell cast from hand before it does not use it up
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../../../src/index';
import { act, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const NEXUS = card('Test Nexus', 'Enchantment', 'The first spell you cast each turn has cascade.');
const SORCERER = card('Test Sorcerer', 'Creature — Wizard', 'The first spell you cast from exile each turn has cascade.', ['1', '1']);
const CHARM = card('Test Charm', 'Instant', 'You gain 5 life.', undefined, '{1}');
const EXILER = card('Test Exiler', 'Instant', 'You may cast Test Exiler from exile.\nYou gain 5 life.', undefined, '{1}');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', undefined, '{0}');
const COPIER = card('Test Copier', 'Artifact', '{T}: Exile target instant card from your graveyard. Copy it. You may cast the copy without paying its mana cost.');
const TWIN = card('Test Twin', 'Instant', 'Copy target instant spell.', undefined, '{0}');
const DEFS = [COPIER, TWIN, NEXUS, SORCERER, CHARM, EXILER, SIP];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const castAction = (s: GameState, name: string, zone?: string): Action | undefined =>
  legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name && (zone === undefined || s.objects[a.object]!.zone === zone))?.action;
/** Cast `name` (from `zone` if given) and let everything resolve; a cascade's "you may cast" is answered yes. */
const cast = (s: GameState, name: string, zone?: string): GameState => resolveAll(settle(act(s, castAction(s, name, zone)!)));

describe('CR 601.2i, 702.85a: the first spell you cast each turn has cascade', () => {
  it('the first {1} spell cascades into the {0} spell on top of the library (+1 life); the second does not', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Nexus', 'Plains', 'Plains'], hand: ['Test Charm', 'Test Charm'], library: ['Test Sip', 'Test Sip'] } });
    const l0 = life(s0, 'p1');
    const s1 = cast(s0, 'Test Charm');
    expect(life(s1, 'p1')).toBe(l0 + 5 + 1);
    const s2 = cast(s1, 'Test Charm');
    expect(life(s2, 'p1')).toBe(l0 + 5 + 1 + 5);
  });
  it('without the enchantment the first spell does not cascade', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Plains'], hand: ['Test Charm'], library: ['Test Sip', 'Test Sip'] } });
    expect(life(cast(s0, 'Test Charm'), 'p1')).toBe(life(s0, 'p1') + 5);
  });
});

describe('CR 601.2i: the first spell you cast from exile each turn has cascade', () => {
  it('a spell cast from exile cascades; a second card from exile cast after it does not', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sorcerer', 'Plains', 'Plains'], exile: ['Test Exiler', 'Test Exiler'], library: ['Test Sip', 'Test Sip'] } });
    const l0 = life(s0, 'p1');
    const s1 = cast(s0, 'Test Exiler', 'exile');
    expect(life(s1, 'p1')).toBe(l0 + 5 + 1);
    const s2 = cast(s1, 'Test Exiler', 'exile');
    expect(life(s2, 'p1')).toBe(l0 + 5 + 1 + 5);
  });
  it('a spell cast from your hand first does not use it up and does not cascade; the later spell from exile does', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sorcerer', 'Plains', 'Plains'], hand: ['Test Charm'], exile: ['Test Exiler'], library: ['Test Sip', 'Test Sip'] } });
    const l0 = life(s0, 'p1');
    const s1 = cast(s0, 'Test Charm');
    expect(life(s1, 'p1')).toBe(l0 + 5);
    const s2 = cast(s1, 'Test Exiler', 'exile');
    expect(life(s2, 'p1')).toBe(l0 + 5 + 5 + 1);
  });
});

describe('CR 707.10, 707.12, 601.2i: copies and the first spell', () => {
  it('a copy of a spell put on the stack is not cast: it does not use up the first spell, which stays Test Charm', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Nexus', 'Plains'], hand: ['Test Charm', 'Test Twin'], library: ['Test Sip', 'Test Sip'] } });
    const l0 = life(s0, 'p1');
    let s = settle(act(s0, castAction(s0, 'Test Charm')!)); // the first spell: cascade triggers on cast
    s = settle(act(s, castAction(s, 'Test Twin')!), { targets: [{ kind: 'object', id: s.zones.stack.find((id) => nameOf(s, id) === 'Test Charm')! }] });
    s = resolveAll(s);
    // Charm (+5), its copy (+5), the cascade Sip (+1); Test Twin (the second spell cast) did not cascade
    expect(life(s, 'p1')).toBe(l0 + 5 + 5 + 1);
  });
  it('a copy of a card that is cast (CR 707.12) is a cast spell: as the first spell of the turn it has cascade', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Nexus', 'Test Copier'], graveyard: ['Test Charm'], library: ['Test Sip', 'Test Sip'] } });
    const l0 = life(s0, 'p1');
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && nameOf(s0, x.object!) === 'Test Copier')!;
    const s = resolveAll(act(s0, a.action), { targets: [{ kind: 'object', id: find(s0, 'Test Charm', 'graveyard', 'p1') }], yes: true });
    expect(life(s, 'p1')).toBe(l0 + 5 + 1);
  });
});
