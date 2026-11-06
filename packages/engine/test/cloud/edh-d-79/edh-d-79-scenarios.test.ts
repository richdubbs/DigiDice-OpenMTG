/**
 * Commander coordinator D, round edh-d-79 (lane must-finish-5000, handed over by A): Grist, Voracious Larva // Grist, the Plague Swarm played through the engine with synthetic cards
 * (invented names, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1; Bob (p2), Cara (p3) and Dan (p4) are the others where a test needs
 * four players. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 707.2, 707.9b, 111.1, 608.2f   "For each creature card in your graveyard, create a token that's a copy of it, except it's a 1/1 black and green Insect." (Grist's -6)
 * CR cites are from memory of the Comprehensive Rules (listed as unverified in the record where not checked against the text).
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type PlayerId } from '../../../src/index';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { card, cast, drive, full, resolveAll, scenario } from '../r3-cost/support';
import { act, find } from '../../m3/scenario';

const tokens = (s: GameState, p: PlayerId) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token');

describe('"For each creature card in your graveyard, create a token that\'s a copy of it, except it\'s a 1/1 black and green Insect." (CR 707.2, 707.9b, 111.1, 608.2f; Grist\'s -6)', () => {
  const SPELL = card('Test Swarm Rite', 'Sorcery', "For each creature card in your graveyard, create a token that's a copy of it, except it's a 1/1 black and green Insect.");
  const BIGBEAR = card('Test Big Bear', 'Creature — Bear', 'Trample', '{5}', ['5', '5'], ['G']);
  const KNIGHT = card('Test Knight', 'Creature — Human Knight', 'Vigilance', '{2}{W}', ['3', '2'], ['W']);
  const RELIC = card('Test Relic', 'Artifact', '');
  const defs = [SPELL, BIGBEAR, KNIGHT, RELIC];
  const start = (p1grave: string[], p2grave: string[] = []) => scenario([], { p1: { hand: ['Test Swarm Rite'], graveyard: p1grave, library: [] }, p2: { graveyard: p2grave, library: [] }, p3: { library: [] }, p4: { library: [] }, defs } as never);
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('makes one 1/1 black and green Insect copy of EACH creature card in YOUR graveyard (copiable abilities kept, name kept, creature types replaced) and none for noncreature cards or other players\' graveyards', () => {
    const s = resolveAll(cast(start(['Test Big Bear', 'Test Knight', 'Test Relic'], ['Test Knight']), 'Test Swarm Rite'));
    const mine = tokens(s, 'p1');
    expect(mine.length).toBe(2);
    expect(tokens(s, 'p2').length).toBe(0);
    for (const id of mine) {
      const c = getChars(s, id);
      expect(String(c.power) + '/' + String(c.toughness)).toBe('1/1');
      expect([...c.colors].sort()).toEqual(['B', 'G']);
      expect(c.subtypes).toEqual(['Insect']);
      expect(c.types).toContain('Creature');
    }
    expect(mine.map((id) => getChars(s, id).name).sort()).toEqual(['Test Big Bear', 'Test Knight']);
    expect(s.zones.graveyard.p1!.length).toBe(4); // the three cards stay in the graveyard (copied, not exiled) beside the resolved spell
  });
  it('the negative case: with no creature card in your graveyard nothing is created', () => {
    const s = resolveAll(cast(start(['Test Relic'], ['Test Knight']), 'Test Swarm Rite'));
    expect(tokens(s, 'p1').length).toBe(0);
  });
});

// ---- the front face ------------------------------------------------------------------------------------------------------------------------------------------------
const mk2 = (name: string, front: { type: string; text: string; pt?: [string, string] }, back: { name: string; type: string; text: string; pt?: [string, string] }): CardDef => compileCard({
  name: `${name} // ${back.name}`, layout: 'transform', mana_cost: '{0}', type_line: `${front.type} // ${back.type}`, colors: [],
  card_faces: [
    { name, mana_cost: '{0}', type_line: front.type, oracle_text: front.text, colors: [], ...(front.pt ? { power: front.pt[0], toughness: front.pt[1] } : {}) },
    { name: back.name, mana_cost: '', type_line: back.type, oracle_text: back.text, colors: [], ...(back.pt ? { power: back.pt[0], toughness: back.pt[1] } : {}) },
  ],
} as unknown as OracleCard);

describe('"Whenever ~ or another creature you control enters, if it entered from your graveyard or you cast it from your graveyard, you may pay {G}. If you do, exile ~, then return it to the battlefield transformed under its owner\'s control." (CR 400.7d, 601.2a, 603.4, 712.14a; Grist)', () => {
  const LARVA = mk2('Test Larva', { type: 'Creature — Insect', pt: ['1', '1'], text: "Deathtouch\nWhenever ~ or another creature you control enters, if it entered from your graveyard or you cast it from your graveyard, you may pay {G}. If you do, exile ~, then return it to the battlefield transformed under its owner's control." },
    { name: 'Test Swarm', type: 'Creature — Insect Horror', pt: ['3', '3'], text: 'Trample' });
  const NAME = 'Test Larva // Test Swarm';
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const SPIRIT = card('Test Spirit', 'Creature — Spirit', 'Escape—{0}, Exile two other cards from your graveyard.', '{0}', ['1', '1']);
  const FOREST = card('Test Forest', 'Land', '{T}: Add {G}.');
  const defs = [LARVA, RAISE, BEAR, SPIRIT, FOREST];
  const start = (z: Record<string, unknown>) => scenario([], { p1: { hand: ['Test Raise'], battlefield: [NAME, 'Test Forest'], graveyard: ['Test Bear'], library: [], ...(z['p1'] as object ?? {}) }, p2: { library: [], ...(z['p2'] as object ?? {}) }, p3: { library: [] }, p4: { library: [] }, defs } as never);
  const raise = (s: GameState, who = 'p1') => cast(s, 'Test Raise', { targets: [[{ kind: 'object', id: find(s, 'Test Bear', 'graveyard', who as never) }]] });
  it('is automated on both faces', () => expect(full(LARVA)).toBe(true));
  it('a creature of yours that returns from your graveyard lets you pay {G}: the Larva is exiled and returns transformed (the Swarm face), under its owner\'s control', () => {
    const s = resolveAll(raise(start({})), { yes: [true] });
    const larva = find(s, NAME, 'battlefield', 'p1');
    expect(s.objects[larva]!.face).toBe(1);
    expect(s.objects[larva]!.controller).toBe('p1');
  });
  it('the negative case: declining the payment leaves the Larva as it is', () => {
    const s = resolveAll(raise(start({})), { yes: [false] });
    expect(s.objects[find(s, NAME, 'battlefield', 'p1')]!.face ?? 0).toBe(0);
  });
  it('the negative case: without {G} to pay nothing happens', () => {
    const s0 = start({ p1: { battlefield: [NAME] } });
    const s = resolveAll(raise(s0), { yes: [true] });
    expect(s.objects[find(s, NAME, 'battlefield', 'p1')]!.face ?? 0).toBe(0);
  });
  it('a creature you cast from your graveyard (escape) also counts', () => {
    const s0 = start({ p1: { hand: [], battlefield: [NAME, 'Test Forest'], graveyard: ['Test Spirit', 'Test Bear', 'Test Bear'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spirit', 'graveyard', 'p1'), method: 'escape' })), { yes: [true] });
    expect(s.objects[find(s, NAME, 'battlefield', 'p1')]!.face).toBe(1);
  });
  it('the negative case: a creature that enters from your hand (cast normally) does not', () => {
    const s0 = start({ p1: { hand: ['Test Bear'], graveyard: [] } });
    const s = resolveAll(cast(s0, 'Test Bear'), { yes: [true] });
    expect(s.objects[find(s, NAME, 'battlefield', 'p1')]!.face ?? 0).toBe(0);
  });
  it('the negative case (four players): a creature that returns from Bob\'s graveyard under Bob\'s control is not a creature you control and does not count', () => {
    const RAISE_ANY = card('Test Raise Any', 'Sorcery', "Return target creature card from a graveyard to the battlefield under its owner's control.");
    const s0 = scenario([], { p1: { hand: ['Test Raise Any'], battlefield: [NAME, 'Test Forest'], library: [] }, p2: { graveyard: ['Test Bear'], library: [] }, p3: { library: [] }, p4: { library: [] }, defs: [...defs, RAISE_ANY] } as never);
    const s = resolveAll(cast(s0, 'Test Raise Any', { targets: [[{ kind: 'object', id: find(s0, 'Test Bear', 'graveyard', 'p2') }]] }), { yes: [true] });
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.controller).toBe('p2');
    expect(s.objects[find(s, NAME, 'battlefield', 'p1')]!.face ?? 0).toBe(0);
  });
});
