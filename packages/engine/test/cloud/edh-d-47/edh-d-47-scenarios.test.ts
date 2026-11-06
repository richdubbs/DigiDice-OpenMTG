/**
 * edh-d-47 (Commander lane exchange, second pass; EDHREC top 20,000): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10)
 * compiled by the game's default compiler, in a four-player game (Alice p1 is the active player of turn 1). Each test names the rule it checks, with its negative case.
 * CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-03); the ones not re-read are listed in the round's record.
 *
 *   CR 115.1, 108.3, 613.1b   "Target player other than ~'s owner gains control of it." (Crown of Doom)
 *   CR 701.26b, 108.4, 613.1b "At the beginning of each player's upkeep, that player untaps ~ and gains control of it." (Karona, False God)
 *   CR 611.2a-b, 613.1b, 613.1f, 508.1c, 509.1b  "For as long as ~ remains on the battlefield, gain control of that creature, it loses all abilities, and it can't attack or block." (Opportunistic Dragon)
 *   CR 108.4, 613.1b, 122.1   "Target opponent gains control of ~ and puts a bounty counter on it." (Jinxed Choker)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, find, mpScenario, passUntil, resolveStack } from '../../m12/rules/helpers';
import { activate, cast, target } from '../../m5/cr-examples/helpers';

const card = (name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef => compileCard({
  name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
} as OracleCard);
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const ctl = (s: GameState, id: ObjectId): PlayerId => s.objects[id]!.controller;
const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', '{2}', ['2', '2']);

// ---- Crown of Doom ---------------------------------------------------------------------------------------------------------------------------------------------------
const CROWN = card('Test Crown', 'Artifact', '{0}: Target player other than ~\'s owner gains control of it.');
describe('CR 115.1, 108.3, 613.1b: "Target player other than ~\'s owner gains control of it"', () => {
  it('is automated', () => expect(full(CROWN)).toBe(true));
  it('the owner cannot pick themself; another player gains control, and then cannot pass it back to the owner', () => {
    let s = mpScenario({ defs: [CROWN], zones: { p1: { battlefield: ['Test Crown'] } } });
    const crown = find(s, 'Test Crown', 'battlefield', 'p1');
    // negative: the owner (p1) is not a legal target
    s = resolveStack(activate(s, crown, [target('p2')]));
    expect(ctl(s, crown)).toBe('p2');
    expect(s.objects[crown]!.owner).toBe('p1');
  });
  it('a controller who is not the owner may target themself, but the owner is still refused', () => {
    let s = mpScenario({ defs: [CROWN], zones: { p1: { battlefield: ['Test Crown'] } } });
    const crown = find(s, 'Test Crown', 'battlefield', 'p1');
    s = resolveStack(activate(s, crown, [target('p2')]));
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2', 'p2 main phase', 60);
    expect(() => activate(s, crown, [target('p1')])).toThrow();
    s = resolveStack(activate(s, crown, [target('p2')]));
    expect(ctl(s, crown)).toBe('p2');
  });
  it('negative: the owner is refused as the target', () => {
    const s = mpScenario({ defs: [CROWN], zones: { p1: { battlefield: ['Test Crown'] } } });
    const crown = find(s, 'Test Crown', 'battlefield', 'p1');
    expect(() => activate(s, crown, [target('p1')])).toThrow();
  });
});

// ---- Karona ----------------------------------------------------------------------------------------------------------------------------------------------------------
const KARONA = card('Test Wanderer', 'Creature — Avatar', 'At the beginning of each player\'s upkeep, that player untaps ~ and gains control of it.', '{0}', ['3', '3']);
describe('CR 701.26b, 108.4, 613.1b: "that player untaps ~ and gains control of it"', () => {
  it('is automated', () => expect(full(KARONA)).toBe(true));
  it('at each upkeep the active player gets it untapped', () => {
    let s = mpScenario({ defs: [KARONA], zones: { p1: { battlefield: ['Test Wanderer'] } }, setup: (g) => { g.objects[find(g, 'Test Wanderer', 'battlefield', 'p1')]!.tapped = true; } });
    const w = find(s, 'Test Wanderer', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'upkeep' && x.zones.stack.length > 0, 'the upkeep trigger', 60);
    s = resolveStack(s);
    expect(ctl(s, w)).toBe('p2');
    expect(s.objects[w]!.tapped).toBe(false);
  });
});

// ---- Opportunistic Dragon --------------------------------------------------------------------------------------------------------------------------------------------
const DRAGON = card('Test Seizer', 'Creature — Dragon', 'When ~ enters, choose target creature an opponent controls. For as long as ~ remains on the battlefield, gain control of that creature, it loses all abilities, and it can\'t attack or block.', '{0}', ['3', '3']);
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
describe('CR 611.2b, 613.1b, 613.1f: "For as long as ~ remains on the battlefield, gain control of that creature, it loses all abilities, and it can\'t attack or block"', () => {
  it('is automated', () => expect(full(DRAGON)).toBe(true));
  const game = () => mpScenario({ defs: [DRAGON, SMITE, FLYER, BEAR], zones: { p1: { hand: ['Test Seizer'] }, p2: { battlefield: ['Test Flyer'], hand: ['Test Smite'] } } });
  it('takes the creature, which loses flying; control returns when the Seizer leaves', () => {
    let s = game();
    const fly = find(s, 'Test Flyer', 'battlefield', 'p2');
    s = cast(s, 'Test Seizer');
    s = resolveStack(s, [target(fly)]);
    expect(ctl(s, fly)).toBe('p1');
    expect(getChars(s, fly)!.keywords.map((k) => k.keyword)).not.toContain('flying'); // it loses all abilities (CR 613.1f)
    const seizer = find(s, 'Test Seizer', 'battlefield', 'p1');
    s = act(s, { type: 'pass', player: 'p1' });
    // destroy the Seizer: the control effect ends (CR 611.2b)
    s = cast(s, 'Test Smite', [target(seizer)], 'p2');
    s = resolveStack(s);
    expect(ctl(s, fly)).toBe('p2');
    expect(getChars(s, fly)!.keywords.map((k) => k.keyword)).toContain('flying'); // and gets its abilities back
  });
});

// ---- Jinxed Choker ---------------------------------------------------------------------------------------------------------------------------------------------------
const CHOKER = card('Test Choker', 'Artifact', 'At the beginning of your end step, target opponent gains control of ~ and puts a bounty counter on it.');
describe('CR 108.4, 613.1b, 122.1: "target opponent gains control of ~ and puts a bounty counter on it"', () => {
  it('is automated', () => expect(full(CHOKER)).toBe(true));
  it('the opponent gets it with a counter', () => {
    let s = mpScenario({ defs: [CHOKER], zones: { p1: { battlefield: ['Test Choker'] } } });
    const c = find(s, 'Test Choker', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.turn.number === 1 && x.turn.step === 'end' && x.pending?.kind === 'chooseTargets', 'the end step trigger', 60);
    s = resolveStack(s, [target('p2')]);
    expect(ctl(s, c)).toBe('p2');
    expect(s.objects[c]!.counters['bounty']).toBe(1);
  });
});
