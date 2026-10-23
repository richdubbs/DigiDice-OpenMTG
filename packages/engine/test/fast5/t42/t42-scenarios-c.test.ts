/**
 * FAST5 T42 (part 3): entering attached or transformed, cards with the same name, looking at two cards, "other than ~", converge and "another" after the source
 * moved, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10).
 *
 *   CR 303.4f, 301.5e   "Return ~ from your graveyard to the battlefield attached to target creature", "... target Equipment card ... attached to ~"
 *   CR 712.14a          "Return ~ from your graveyard to the battlefield transformed."
 *   CR 201.2, 400.7     "Return target creature card and all other cards with the same name as that card from your graveyard to the battlefield tapped."
 *   CR 401.2, 608.2d    "Look at the top two cards of your library. Put one into your hand and the other into your graveyard."
 *   CR 109.2, 115.3     "return up to one target nonland permanent other than ~ to its owner's hand"; "another" excludes the creature that died
 *   CR 601.2h, 106.1    "exile target nonland permanent an opponent controls with mana value less than or equal to the number of colors of mana spent to cast ~"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, legal, scenario } from '../../m3/scenario';
import { KILL, MOUSE, OGRE, WOLF, card, cast, ids, inZone, noManual, offered, onBattlefield, pick, resolve, settle } from './support';

/** Activate the (only) non-mana ability of `name` in `zone` for p1, answering what comes up with `choose`. */
function activate(s: GameState, name: string, zone: 'battlefield' | 'graveyard', choose?: Parameters<typeof settle>[1]): GameState {
  const id = find(s, name, zone, 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name} in ${zone}`);
  return settle(act(s, la.action), choose);
}

describe('CR 712.14a: "{0}: Return ~ from your graveyard to the battlefield transformed. Activate only as a sorcery."', () => {
  const FRONT = { name: 'Test Knight', mana_cost: '{B}{R}', type_line: 'Legendary Creature — Human Knight', oracle_text: '{0}: Return ~ from your graveyard to the battlefield transformed. Activate only as a sorcery.', power: '3', toughness: '2', colors: ['B', 'R'] };
  const BACK = { name: 'Test Fiend', mana_cost: '', type_line: 'Legendary Creature — Demon', oracle_text: 'Flying', power: '5', toughness: '5', colors: ['B', 'R'] };
  const KNIGHT: CardDef = compileCard({ name: 'Test Knight // Test Fiend', layout: 'transform', mana_cost: '{B}{R}', type_line: 'Legendary Creature — Human Knight // Legendary Creature — Demon', colors: ['B', 'R'], card_faces: [FRONT, BACK] } as unknown as OracleCard);
  it('is automated', () => expect(noManual(KNIGHT)).toEqual([]));
  it('the card comes back with its back face up, as the creature on its back face', () => {
    const s0 = scenario([], { defs: [KNIGHT], p1: { graveyard: ['Test Knight // Test Fiend'] } });
    const s = resolve(activate(s0, 'Test Knight // Test Fiend', 'graveyard'));
    const id = find(s, 'Test Knight // Test Fiend', 'battlefield', 'p1');
    expect(s.objects[id]!.face).toBe(1);
    expect(inZone(s, 'graveyard')).toEqual([]);
  });
});

describe('CR 303.4f: "{0}: Return ~ from your graveyard to the battlefield attached to target creature you control with power 1 or less. Activate only as a sorcery."', () => {
  const RESCUE = card('Test Rescue', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2 and has flying.\n{0}: Return ~ from your graveyard to the battlefield attached to target creature you control with power 1 or less. Activate only as a sorcery.', { cost: '{1}{W}', colors: ['W'] });
  const ALL = [RESCUE, MOUSE, OGRE];
  it('is automated', () => expect(noManual(RESCUE)).toEqual([]));
  it('only the creature with power 1 or less is offered, and the Aura comes back attached to it', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test Mouse', 'Test Ogre'], graveyard: ['Test Rescue'] } });
    const id = find(s0, 'Test Rescue', 'graveyard', 'p1');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana)!;
    let s = settle(act(s0, la.action), (t) => (t.pending!.kind === 'chooseTargets' ? (expect(offered(t)).toEqual(['Test Mouse']), pick(find(t, 'Test Mouse', 'battlefield', 'p1'))) : undefined));
    s = resolve(s);
    const aura = find(s, 'Test Rescue', 'battlefield', 'p1');
    expect(s.objects[aura]!.attachedTo).toBe(find(s, 'Test Mouse', 'battlefield', 'p1'));
  });
});

describe('CR 301.5e: "When this creature enters, return target Equipment card from your graveyard to the battlefield attached to this creature."', () => {
  const SNUFFLER = card('Test Snuffler', 'Artifact Creature — Construct', 'When this creature enters, return target Equipment card from your graveyard to the battlefield attached to this creature.', { pt: ['4', '4'], cost: '{0}' });
  const SWORD = card('Test Sword', 'Artifact — Equipment', 'Equipped creature gets +2/+0.\nEquip {2}', { cost: '{2}' });
  const ALL = [SNUFFLER, SWORD, MOUSE];
  it('is automated', () => expect(noManual(SNUFFLER)).toEqual([]));
  it('the Equipment comes back attached to the creature; only Equipment cards are offered', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Snuffler'], graveyard: ['Test Sword', 'Test Mouse'] } });
    let s = resolve(cast(s0, 'Test Snuffler'));
    expect(offered(s)).toEqual(['Test Sword']);
    s = resolve(settle(answer(s, pick(find(s, 'Test Sword', 'graveyard', 'p1')))));
    const sword = find(s, 'Test Sword', 'battlefield', 'p1');
    expect(s.objects[sword]!.attachedTo).toBe(find(s, 'Test Snuffler', 'battlefield', 'p1'));
  });
});

describe('CR 201.2, 400.7: "Return target creature card and all other cards with the same name as that card from your graveyard to the battlefield tapped."', () => {
  const KING = card('Test King', 'Creature — Rat', '{T}: Return target creature card and all other cards with the same name as that card from your graveyard to the battlefield tapped.', { pt: ['1', '1'], cost: '{0}' });
  const ALL = [KING, MOUSE, WOLF];
  it('is automated', () => expect(noManual(KING)).toEqual([]));
  it('every card of that name returns, tapped; the cards of other names stay; the opponent\'s graveyard is not touched', () => {
    const s0 = scenario([], { defs: ALL, p1: { battlefield: ['Test King'], graveyard: ['Test Mouse', 'Test Mouse', 'Test Mouse', 'Test Wolf'] }, p2: { graveyard: ['Test Mouse'] } });
    let s = settle(activate(s0, 'Test King', 'battlefield', (t) => (t.pending!.kind === 'chooseTargets' ? pick(ids(t, 'Test Mouse', 'graveyard')[0]!) : undefined)));
    s = resolve(s);
    const mice = findAll(s, 'Test Mouse', 'battlefield', 'p1');
    expect(mice).toHaveLength(3);
    expect(mice.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(inZone(s, 'graveyard')).toEqual(['Test Wolf']);
    expect(inZone(s, 'graveyard', 'p2')).toEqual(['Test Mouse']);
  });
});

describe('CR 401.2, 608.2d: "Look at the top two cards of your library. Put one into your hand and the other into your graveyard."', () => {
  const SNOOP = card('Test Snoop', 'Instant', 'Look at the top two cards of your library. Put one into your hand and the other into your graveyard.', { cost: '{0}', colors: ['U'] });
  const ALL = [SNOOP, MOUSE, WOLF, OGRE];
  it('is automated', () => expect(noManual(SNOOP)).toEqual([]));
  it('the player chooses one of the two top cards for the hand; the other one goes to the graveyard; the third card stays', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Snoop'], library: ['Test Mouse', 'Test Wolf', 'Test Ogre'] } });
    let s = resolve(cast(s0, 'Test Snoop'));
    expect(s.pending?.kind).toBe('chooseObjects');
    const opts = (s.pending as unknown as { options: string[] }).options;
    expect(opts.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Mouse', 'Test Wolf']);
    s = settle(answer(s, { kind: 'chooseObjects', ids: [opts.find((id) => s.objects[id]!.defId === 'Test Wolf')!] }));
    expect(inZone(s, 'hand')).toContain('Test Wolf');
    expect(inZone(s, 'graveyard').filter((n) => n.startsWith('Test') && n !== 'Test Snoop')).toEqual(['Test Mouse']);
    expect(s.zones.library['p1']![0] && s.objects[s.zones.library['p1']![0]!]!.defId).toBe('Test Ogre');
  });
  it('a library of one card: that card is put into the hand and nothing is left for the graveyard', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Snoop'] } });
    // empty the library but for one card
    const lib = s0.zones.library['p1']!;
    const keep = lib[0]!;
    for (const id of lib.slice(1)) delete s0.objects[id];
    s0.zones.library['p1'] = [keep];
    const s = settle(resolve(cast(s0, 'Test Snoop')), (t) => (t.pending!.kind === 'chooseObjects' ? { kind: 'chooseObjects', ids: (t.pending as unknown as { options: string[] }).options.slice(0, 1) } : undefined));
    expect(s.zones.library['p1']).toHaveLength(0);
  });
});

describe('CR 109.2, 115.3: "return up to one target nonland permanent other than this creature to its owner\'s hand" and "another" after the source has moved', () => {
  const ECHO = card('Test Echo', 'Creature — Spirit', 'When this creature enters, return up to one target nonland permanent other than this creature to its owner\'s hand.', { pt: ['4', '4'], cost: '{0}' });
  const RING = card('Test Ring', 'Artifact', '', { cost: '{2}' });
  const RAVEN = card('Test Raven', 'Creature — Bird', 'When this creature dies, return another target creature card from your graveyard to your hand.', { pt: ['1', '1'], cost: '{0}' });
  const ALL = [ECHO, RING, MOUSE, RAVEN, KILL, WOLF];
  it('is automated', () => expect(noManual(ECHO)).toEqual([]));
  it('the Echo itself is not a legal target of its own ability; the other nonland permanents are', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Echo'], battlefield: ['Test Ring', 'Test Mouse', 'Plains'] } });
    const s = resolve(cast(s0, 'Test Echo'));
    expect(offered(s)).toEqual(['Test Mouse', 'Test Ring']);
  });
  it('a creature that dies cannot return itself with "another target creature card from your graveyard": only the other card is offered', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Kill'], battlefield: ['Test Raven'], graveyard: ['Test Wolf'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kill', 'hand', 'p1') }), (t) => (t.pending!.kind === 'chooseTargets' ? pick(find(t, 'Test Raven', 'battlefield', 'p1')) : undefined));
    s = resolve(s);
    expect(offered(s)).toEqual(['Test Wolf']);
  });
});

describe('CR 601.2h, 106.1: "When ~ enters, exile target nonland permanent an opponent controls with mana value less than or equal to the number of colors of mana spent to cast ~."', () => {
  const ARCHAIC = card('Test Archaic', 'Artifact Creature — Avatar', 'When this creature enters, exile target nonland permanent an opponent controls with mana value less than or equal to the number of colors of mana spent to cast this creature.', { pt: ['3', '3'], cost: '{3}' });
  const ALL = [ARCHAIC, MOUSE, WOLF, OGRE];
  it('is automated', () => expect(noManual(ARCHAIC)).toEqual([]));
  it('paid with a Plains, a Forest and a Mountain (three colors): the opponent\'s permanents of mana value 3 or less are offered', () => {
    const s0 = scenario(['Plains', 'Forest', 'Mountain'], { defs: ALL, p1: { hand: ['Test Archaic'], battlefield: ['Plains', 'Forest', 'Mountain'] }, p2: { battlefield: ['Test Mouse', 'Test Wolf', 'Test Ogre'] } });
    const s = resolve(cast(s0, 'Test Archaic'));
    expect(offered(s)).toEqual(['Test Mouse', 'Test Ogre', 'Test Wolf']);
  });
  it('paid with three Plains (one color): only mana value 1 or less', () => {
    const s0 = scenario(['Plains'], { defs: ALL, p1: { hand: ['Test Archaic'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Mouse', 'Test Wolf', 'Test Ogre'] } });
    const s = resolve(cast(s0, 'Test Archaic'));
    expect(offered(s)).toEqual(['Test Mouse']);
  });
});

void onBattlefield;
