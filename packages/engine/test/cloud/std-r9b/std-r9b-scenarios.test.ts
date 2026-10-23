/**
 * Standard round 9 (families of Standard cards): the templates of parser/templates/zz-cloud/std-r9b.json and the parser, lowering and renderer support of the
 * round, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named
 * after the rule it checks.
 *
 *   CR 701.23a, 201.2, 608.2h  "Search its controller's graveyard, hand, and library for any number of cards with the same name as that creature and exile
 *                              them. That player shuffles, then draws a card for each card exiled from their hand this way." (The End)
 *   CR 607.2a, 400.3           "Put all cards exiled with ~ into their owners' hands." (Connecting the Dots)
 *   CR 205.3m, 613.1d, 301.7   "Vehicle creatures you control are the chosen creature type in addition to their other types." (Lifecraft Engine)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

/** Answer the decisions that come up until priority (payments automatic; targets in order; other choices the first allowed, as many as allowed). */
function drive(s0: GameState, targets: ObjectId[][] = []): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: ObjectId[][]): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets);
  return s;
}
const cast = (s: GameState, name: string, targets?: ObjectId[][]): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets), targets);

describe('CR 701.23a, 201.2, 608.2h: "Search its controller\'s graveyard, hand, and library for any number of cards with the same name as that creature and exile them. That player shuffles, then draws a card for each card exiled from their hand this way."', () => {
  const PURGE = card('Test Purge', 'Sorcery', "Exile target creature. Search its controller's graveyard, hand, and library for any number of cards with the same name as that creature and exile them. That player shuffles, then draws a card for each card exiled from their hand this way.");
  const SHRUB = card('Test Shrub', 'Sorcery', "Exile target creature. Search its controller's graveyard, hand, and library for any number of cards with the same name as that creature and exile them. Then that player shuffles.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  it('is understood', () => {
    expect(noManual(PURGE)).toBe(true);
    expect(noManual(SHRUB)).toBe(true);
  });
  it('the cards of that name in the controller\'s three zones are exiled (the name read from the exiled creature, CR 608.2h); that player draws one card per card that was in their hand; a card of another name and the caster\'s own copy stay', () => {
    const s0 = scenario([], {
      defs: [PURGE, OGRE, ELF],
      p1: { hand: ['Test Purge', 'Test Ogre'] },
      p2: { battlefield: ['Test Ogre'], graveyard: ['Test Ogre', 'Test Elf'], hand: ['Test Ogre', 'Test Ogre', 'Test Elf'], library: ['Test Ogre'] },
    });
    const target = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const h2 = hand(s0, 'p2');
    const s = cast(s0, 'Test Purge', [[target]]);
    expect(findAll(s, 'Test Ogre', 'exile', 'p2')).toHaveLength(5); // the target, one from the graveyard, two from the hand, one from the library
    expect(findAll(s, 'Test Ogre', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Ogre', 'library', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Ogre', 'hand', 'p1')).toHaveLength(1); // the caster's own copy is not in the searched zones
    expect(findAll(s, 'Test Elf', 'graveyard', 'p2')).toHaveLength(1);
    expect(hand(s, 'p2')).toBe(h2 - 2 + 2); // two Ogres left the hand, then two cards were drawn (not five: only the cards exiled from the hand count)
  });
  it('nothing of that name in the hand: that player draws no card (the exiled target and graveyard copy were not in a hand)', () => {
    const s0 = scenario([], { defs: [PURGE, OGRE, ELF], p1: { hand: ['Test Purge'] }, p2: { battlefield: ['Test Ogre'], graveyard: ['Test Ogre'], hand: ['Test Elf'] } });
    const h2 = hand(s0, 'p2');
    const s = cast(s0, 'Test Purge', [[find(s0, 'Test Ogre', 'battlefield', 'p2')]]);
    expect(findAll(s, 'Test Ogre', 'exile', 'p2')).toHaveLength(2);
    expect(hand(s, 'p2')).toBe(h2);
  });
  it('CR 701.24a, 608.2c: "Then that player shuffles" names the controller of the target, not the caster', () => {
    const s0 = scenario([], { defs: [SHRUB, OGRE], p1: { hand: ['Test Shrub'] }, p2: { battlefield: ['Test Ogre'], library: ['Test Ogre'] } });
    const s = cast(s0, 'Test Shrub', [[find(s0, 'Test Ogre', 'battlefield', 'p2')]]);
    expect(findAll(s, 'Test Ogre', 'exile', 'p2')).toHaveLength(2);
    expect(s.log.some((e) => /Bob shuffles/.test(e.text))).toBe(true);
    expect(s.log.some((e) => /Alice shuffles/.test(e.text))).toBe(false);
  });
});

describe('CR 607.2a, 400.3: "Put all cards exiled with ~ into their owners\' hands." (the cards the linked instruction exiled, each to its owner\'s hand)', () => {
  const VAULT = card('Test Vault', 'Artifact', "{T}: Exile target creature.\n{1}, Sacrifice this artifact: Put all cards exiled with this artifact into their owners' hands.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(VAULT)).toBe(true));
  it('the creature it exiled goes to its owner\'s hand (an opponent\'s); a card in exile that something else exiled stays there', () => {
    const s0 = scenario([], { defs: [VAULT, OGRE, ELF], p1: { battlefield: ['Test Vault', 'Plains'] }, p2: { battlefield: ['Test Ogre'], exile: ['Test Elf'] } });
    const vault = find(s0, 'Test Vault', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const tapAbility = legal(s0, 'p1', 'activate').find((a) => a.action.type === 'activate' && a.action.source === vault && a.action.ability === 'p:0:0');
    const s1 = resolveAll(drive(act(s0, tapAbility!.action), [[ogre]]), [[ogre]]);
    expect(findAll(s1, 'Test Ogre', 'exile', 'p2')).toHaveLength(1);
    const h2 = hand(s1, 'p2');
    const sacAbility = legal(s1, 'p1', 'activate').find((a) => a.action.type === 'activate' && a.action.source === vault && a.action.ability === 'p:0:1');
    const s = resolveAll(drive(act(s1, sacAbility!.action)));
    expect(findAll(s, 'Test Ogre', 'hand', 'p2')).toHaveLength(1);
    expect(hand(s, 'p2')).toBe(h2 + 1);
    expect(findAll(s, 'Test Elf', 'exile', 'p2')).toHaveLength(1);
    expect(findAll(s, 'Test Vault', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 205.3m, 613.1d, 301.7: "Vehicle creatures you control are the chosen creature type in addition to their other types."', () => {
  const FOUNDRY = card('Test Foundry', 'Artifact', "As this artifact enters, choose a creature type.\nVehicle creatures you control are the chosen creature type in addition to their other types.");
  const HAULER = card('Test Hauler', 'Artifact Creature — Vehicle Construct', '', { pt: ['3', '3'] });
  const WAGON = card('Test Wagon', 'Artifact — Vehicle', 'Crew 1', { pt: ['3', '3'] });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  it('is understood', () => expect(noManual(FOUNDRY)).toBe(true));
  it('a Vehicle creature you control gains the chosen type and keeps its own; a creature that is no Vehicle, a Vehicle that is no creature and an opponent\'s Vehicle creature do not', () => {
    const s = scenario([], { defs: [FOUNDRY, HAULER, WAGON, OGRE], p1: { battlefield: ['Test Hauler', 'Test Wagon', 'Test Ogre'] }, p2: { battlefield: ['Test Hauler'] } });
    const foundry = put(s, 'p1', 'battlefield', 'Test Foundry');
    s.objects[foundry]!.links = { ...(s.objects[foundry]!.links ?? {}), type: { values: ['Goblin'] } }; // the choice "as this artifact enters" made (CR 607.2d)
    const subs = (id: ObjectId): string[] => getChars(s, id).subtypes;
    expect(subs(find(s, 'Test Hauler', 'battlefield', 'p1'))).toEqual(expect.arrayContaining(['Vehicle', 'Construct', 'Goblin']));
    expect(subs(find(s, 'Test Ogre', 'battlefield', 'p1'))).not.toContain('Goblin');
    expect(subs(find(s, 'Test Wagon', 'battlefield', 'p1'))).not.toContain('Goblin');
    expect(subs(find(s, 'Test Hauler', 'battlefield', 'p2'))).not.toContain('Goblin');
  });
});
