/**
 * edh-zones-20 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 401.5, 604.1, 611.3a, 613.1f   "As long as the top card of your library is a Goblin card, ~ has all activated abilities of that card." (Conspicuous Snoop): a static ability that
 *                                     reads the top card of the library (`topCards` as a static object reference)
 *   CR 400.3, 404.1, 701.17a, 608.2h  "Target player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn." (Fraying Sanity): every card that went to that
 *                                     player's graveyard this turn, from any zone, counted when the ability resolves
 *   CR 603.1, 510.2, 109.4            "When ~ deals combat damage to a player who controls more lands than you, ..." (Cartographer's Hawk): the lands of the player dealt the damage and
 *                                     yours are counted once, as the damage is dealt (`TriggerDef.while`)
 *   CR 701.9a, 614.1a, 616.1, 401.4   "If an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard." (Library of Leng):
 *                                     only a discard an effect causes (not a cost, not the cleanup step), only your cards, optional
 *   CR 604.1, 613.1f                  "As long as ~ is on the battlefield, it has all activated abilities of all creature cards in all graveyards." (Necrotic Ooze)
 */
import { describe, expect, it } from 'vitest';
import { answer, legal, pass, put } from '../../m3/scenario';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { runCombat } from '../../m4/helpers';
import { act, card, cast, drive, find, full, obj, resolveAll, scenario } from '../r3-cost/support';

const setLibrary = (s: GameState, p: 'p1' | 'p2', names: string[]): void => {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of names) put(s, p, 'library', n);
};
const lifeOf = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => s.players.find((x) => x.id === p)!.life;
/** The activated abilities p1 can activate from the permanent. */
const activations = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1') => {
  const id = find(s, name, 'battlefield', player);
  return legal(s, player, 'activate').filter((a) => a.action.type === 'activate' && a.action.source === id).map((a) => a.action);
};
const activatedCount = (s: GameState, name: string): number => getChars(s, find(s, name, 'battlefield', 'p1')).abilities.filter((a) => a.def.kind === 'activated').length;

describe('"As long as the top card of your library is a Goblin card, ~ has all activated abilities of that card." (CR 401.5, 613.1f; Conspicuous Snoop)', () => {
  const SNOOP = card('Test Goblin Peeker', 'Creature — Goblin', 'As long as the top card of your library is a Goblin card, ~ has all activated abilities of that card.', '{0}', ['1', '1']);
  const TINKER = card('Test Goblin Tinker', 'Creature — Goblin', '{0}: You gain 1 life.', '{0}', ['1', '1']);
  const MULE = card('Test Rock Mule', 'Creature — Beast', '{0}: You gain 3 life.', '{0}', ['1', '1']);
  const defs = [SNOOP, TINKER, MULE];
  it('has no manual part', () => expect(full(SNOOP)).toBe(true));
  it('has the activated ability of a Goblin on top of the library, and loses it when a non-Goblin is on top', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Goblin Peeker'] }, defs });
    expect(activations(s0, 'Test Goblin Peeker').length).toBe(0);
    setLibrary(s0, 'p1', ['Test Goblin Tinker', 'Test Rock Mule']);
    const withTop = activations(s0, 'Test Goblin Peeker');
    expect(withTop.length).toBe(1);
    const s1 = act(s0, withTop[0]!);
    expect(lifeOf(resolveAll(s1))).toBe(21); // the Goblin's ability, resolved with the Peeker as its source
    setLibrary(s0, 'p1', ['Test Rock Mule', 'Test Goblin Tinker']); // a Goblin second from the top is not the top card
    expect(activations(s0, 'Test Goblin Peeker').length).toBe(0);
  });
  it('reads only your own library: a Goblin on top of an opponent\'s library gives nothing', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Goblin Peeker'] }, defs });
    setLibrary(s0, 'p1', ['Test Rock Mule']);
    setLibrary(s0, 'p2', ['Test Goblin Tinker']);
    expect(activations(s0, 'Test Goblin Peeker').length).toBe(0);
  });
});

describe('CR 401.5: while the top card is cast, Conspicuous Snoop has nothing of the new top card (it is not revealed until the cast is finished)', () => {
  const SNOOP = card('Conspicuous Snoop', 'Creature — Goblin Rogue', 'Play with the top card of your library revealed.\nYou may cast Goblin spells from the top of your library.\nAs long as the top card of your library is a Goblin card, ~ has all activated abilities of that card.', '{0}', ['2', '2']);
  const PRICEY = card('Test Pricey Goblin', 'Creature — Goblin', 'Haste', '{1}', ['1', '1']);
  const MANA = card('Test Mana Goblin', 'Creature — Goblin', '{T}: Add {R}.', '{0}', ['1', '1']);
  const defs = [SNOOP, PRICEY, MANA];
  it('the mana ability of the card under the one being cast is not available to pay for it, and is once the cast is done', () => {
    const s0 = scenario([], { p1: { battlefield: ['Conspicuous Snoop', 'Plains'] }, defs });
    setLibrary(s0, 'p1', ['Test Pricey Goblin', 'Test Mana Goblin', 'Plains']);
    expect(activatedCount(s0, 'Conspicuous Snoop')).toBe(0); // a Goblin with no activated ability on top
    const s1 = act(s0, { type: 'cast', player: 'p1', card: s0.zones.library.p1![0]! });
    expect(s1.suspended?.action.type).toBe('cast');
    expect(activatedCount(s1, 'Conspicuous Snoop')).toBe(0); // mid-cast: the Mana Goblin is on top now but not revealed yet
    // the engine's own question and check of the payment read the same frozen library (the run replays the cast from the state it began from)
    const pay = s1.pending as unknown as { kind: string; manaSources: { objectId: string; label: string }[] };
    expect(pay.kind).toBe('payCost');
    const snoop = find(s1, 'Conspicuous Snoop', 'battlefield', 'p1');
    expect(pay.manaSources.some((m) => m.objectId === snoop)).toBe(false);
    expect(pay.manaSources.length).toBeGreaterThan(0); // the Plains is offered
    expect(() => answer(s1, { kind: 'payCost', auto: false, activations: [{ objectId: snoop, abilityKey: 'g:live:' + snoop + ':p:0:2:0~of:0' }] } as never)).toThrow(); // and paying with it by hand is refused
    const s2 = drive(s1);
    expect(s2.pending?.kind).toBe('priority');
    expect(activatedCount(s2, 'Conspicuous Snoop')).toBe(1); // the cast is finished: the new top card is revealed
  });
});

describe('"As long as ~ is on the battlefield, it has all activated abilities of all creature cards in all graveyards." (CR 613.1f; Necrotic Ooze)', () => {
  const OOZE = card('Test Grave Slime', 'Creature — Ooze', 'As long as ~ is on the battlefield, it has all activated abilities of all creature cards in all graveyards.', '{0}', ['1', '1']);
  const TINKER = card('Test Goblin Tinker', 'Creature — Goblin', '{0}: You gain 1 life.', '{0}', ['1', '1']);
  const GADGET = card('Test Idle Gadget', 'Artifact', '{0}: You gain 5 life.');
  const defs = [OOZE, TINKER, GADGET];
  it('has no manual part', () => expect(full(OOZE)).toBe(true));
  it('has the activated abilities of the creature cards in every graveyard, and none of a noncreature card', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grave Slime'], graveyard: ['Test Goblin Tinker', 'Test Idle Gadget'] }, p2: { graveyard: ['Test Goblin Tinker'] }, defs });
    const acts = activations(s0, 'Test Grave Slime');
    expect(activatedCount(s0, 'Test Grave Slime')).toBe(2);
    expect(acts.length).toBe(2); // one from each Tinker, none from the Gadget
    const s1 = resolveAll(act(s0, acts[0]!));
    expect(lifeOf(s1)).toBe(21);
  });
  it('has nothing while no creature card is in a graveyard', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Grave Slime'], graveyard: ['Test Idle Gadget'] }, defs });
    expect(activations(s0, 'Test Grave Slime').length).toBe(0);
  });
});

describe('"Target player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn." (CR 400.3, 404.1, 701.17a, 608.2h; Fraying Sanity)', () => {
  const GRIND = card('Test Grind', 'Sorcery', 'Target player mills three cards.');
  const ECHO = card('Test Echo Grind', 'Sorcery', 'Target player mills X cards, where X is the number of cards put into their graveyard from anywhere this turn.');
  const SHRED = card('Test Shred', 'Sorcery', 'Target player discards a card.');
  const defs = [GRIND, ECHO, SHRED];
  const lib = (s: GameState, p: 'p1' | 'p2'): number => s.zones.library[p]!.length;
  const tgt = (p: 'p1' | 'p2') => ({ targets: [[{ kind: 'player' as const, id: p }]] });
  it('has no manual part', () => expect(full(ECHO)).toBe(true));
  it('counts the cards milled into the targeted player\'s graveyard this turn', () => {
    let s = scenario([], { p1: { hand: ['Test Grind', 'Test Echo Grind'] }, p2: {}, defs });
    const before = lib(s, 'p2');
    s = resolveAll(cast(s, 'Test Grind', tgt('p2')));
    expect(lib(s, 'p2')).toBe(before - 3);
    s = resolveAll(cast(s, 'Test Echo Grind', tgt('p2')));
    expect(lib(s, 'p2')).toBe(before - 6); // X = 3
  });
  it('counts cards from any zone: a discarded card and a resolved spell, but only those put into that player\'s own graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Shred', 'Test Echo Grind'] }, p2: { hand: ['Plains'] }, defs });
    const before2 = lib(s, 'p2');
    s = resolveAll(cast(s, 'Test Shred', tgt('p2')));
    expect(s.zones.graveyard.p2!.length).toBe(1);
    s = resolveAll(cast(s, 'Test Echo Grind', tgt('p2')));
    expect(lib(s, 'p2')).toBe(before2 - 1); // X = 1: the discarded Plains; Test Shred went to p1's graveyard
  });
  it('the negative case: cards put into another player\'s graveyard are not counted', () => {
    let s = scenario([], { p1: { hand: ['Test Grind', 'Test Echo Grind'] }, p2: {}, defs });
    const before1 = lib(s, 'p1');
    s = resolveAll(cast(s, 'Test Grind', tgt('p2')));
    s = resolveAll(cast(s, 'Test Echo Grind', tgt('p1')));
    expect(lib(s, 'p1')).toBe(before1 - 1); // X = 1: only Test Grind, which went from the stack to p1's graveyard; p2's three milled cards are not p1's
  });
  it('a card that left the graveyard again is still counted', () => {
    // CR 400.3: a card put into a graveyard went there, whatever happened to it afterwards
    let s = scenario([], { p1: { hand: ['Test Grind', 'Test Echo Grind'] }, p2: {}, defs });
    const before = lib(s, 'p2');
    s = resolveAll(cast(s, 'Test Grind', tgt('p2')));
    for (const id of s.zones.graveyard.p2!.slice(0, 1)) { s.zones.graveyard.p2 = s.zones.graveyard.p2!.filter((x) => x !== id); s.zones.exile.push(id); s.objects[id]!.zone = 'exile'; }
    s = resolveAll(cast(s, 'Test Echo Grind', tgt('p2')));
    expect(lib(s, 'p2')).toBe(before - 6); // still X = 3
  });
});

describe('"When ~ deals combat damage to a player who controls more lands than you, you gain 3 life." (CR 603.1, 510.2, 109.4; Cartographer\'s Hawk)', () => {
  const HAWK = card('Test Land Hawk', 'Creature — Bird', 'When ~ deals combat damage to a player who controls more lands than you, you gain 3 life.', '{0}', ['1', '1']);
  const defs = [HAWK];
  const attack = (p1Lands: number, p2Lands: number): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Land Hawk', ...Array<string>(p1Lands).fill('Plains')] }, p2: { battlefield: Array<string>(p2Lands).fill('Plains') }, defs });
    return resolveAll(runCombat(s0, { attack: [[find(s0, 'Test Land Hawk', 'battlefield', 'p1')]] }));
  };
  it('has no manual part', () => expect(full(HAWK)).toBe(true));
  it('triggers when the player dealt damage controls more lands than you', () => {
    const s = attack(1, 3);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s)).toBe(23);
  });
  it('the negative cases: the same number of lands, or fewer, does not trigger it (the damage is still dealt)', () => {
    for (const [mine, theirs] of [[2, 2], [3, 1], [0, 0]] as const) {
      const s = attack(mine, theirs);
      expect(lifeOf(s, 'p2'), `${mine} v ${theirs}`).toBe(19);
      expect(lifeOf(s), `${mine} v ${theirs}`).toBe(20);
    }
  });
  it('counts lands only: other permanents the player controls do not count', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Land Hawk', 'Plains'] }, p2: { battlefield: ['Plains', 'Test Land Hawk', 'Test Land Hawk'] }, defs });
    const s = resolveAll(runCombat(s0, { attack: [[find(s0, 'Test Land Hawk', 'battlefield', 'p1')]] }));
    expect(lifeOf(s)).toBe(20); // one land each: the opponent's two other permanents are creatures
  });
});

describe('"If an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard." (CR 701.9a, 614.1a, 616.1, 401.4; Library of Leng)', () => {
  const VAULT = card('Test Lore Vault', 'Artifact', 'If an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard.');
  const SHRED = card('Test Shred', 'Sorcery', 'Target player discards a card.');
  const PAYER = card('Test Pay Imp', 'Creature — Imp', '{0}, Discard a card: You gain 1 life.', '{0}', ['1', '1']);
  const NOTE = card('Test Spare Note', 'Sorcery', 'You gain 1 life.');
  const defs = [VAULT, SHRED, PAYER, NOTE];
  const tgt = (p: 'p1' | 'p2') => ({ targets: [[{ kind: 'player' as const, id: p }]] });
  it('has no manual part', () => expect(full(VAULT)).toBe(true));
  it('an effect that makes you discard: you may put the card on top of your library instead', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Lore Vault'], hand: ['Test Shred', 'Test Spare Note'] }, defs });
    const note = find(s0, 'Test Spare Note', 'hand', 'p1');
    const s = resolveAll(cast(s0, 'Test Shred', tgt('p1')), { yes: [true], objects: [[note]] });
    expect(s.objects[s.zones.library.p1![0]!]!.defId).toBe('Test Spare Note');
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Shred']);
  });
  it('declining puts the card into the graveyard as usual', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Lore Vault'], hand: ['Test Shred', 'Test Spare Note'] }, defs });
    const note = find(s0, 'Test Spare Note', 'hand', 'p1');
    const s = resolveAll(cast(s0, 'Test Shred', tgt('p1')), { yes: [false], objects: [[note]] });
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Shred', 'Test Spare Note']);
    expect(s.objects[s.zones.library.p1![0]!]!.defId).toBe('Plains');
  });
  it('the negative cases: a discard paid as a cost, and an opponent\'s own discard, are left alone', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Lore Vault', 'Test Pay Imp'], hand: ['Test Spare Note'] }, p2: { hand: ['Test Spare Note'] }, defs });
    const note = find(s0, 'Test Spare Note', 'hand', 'p1');
    const imp = find(s0, 'Test Pay Imp', 'battlefield', 'p1');
    let s = drive(act(s0, { type: 'activate', player: 'p1', source: imp, ability: 'p:0:0' }), { objects: [[note]] });
    s = resolveAll(s);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Spare Note']); // a cost: no replacement, no question
    expect(lifeOf(s)).toBe(21);
    const t0 = scenario([], { p1: { battlefield: ['Test Lore Vault'], hand: ['Test Shred'] }, p2: { hand: ['Test Spare Note'] }, defs });
    const theirs = find(t0, 'Test Spare Note', 'hand', 'p2');
    const t = resolveAll(cast(t0, 'Test Shred', tgt('p2')), { yes: [true], objects: [[theirs]] });
    expect(t.zones.graveyard.p2!.map((id) => t.objects[id]!.defId)).toEqual(['Test Spare Note']); // the Vault only watches your own cards
  });
  it('the negative case: the hand-size discard of the cleanup step is no effect (CR 514.1), so nothing is asked', () => {
    let s = scenario([], { p1: { battlefield: ['Test Lore Vault'], hand: Array<string>(8).fill('Test Spare Note') }, defs });
    for (let i = 0; i < 80 && !(s.pending?.kind === 'chooseObjects'); i++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p1![0]!] });
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Spare Note']);
  });
});

describe('the top card of the library in a static ability\'s condition (CR 401.5, 611.3a, 613.4c): "As long as the top card of your library is a creature card, ~ gets +3/+3." (the same reading, Mul Daya Channelers)', () => {
  const CHANNELER = card('Test Top Brute', 'Creature — Elf', 'As long as the top card of your library is a creature card, ~ gets +3/+3.', '{0}', ['1', '1']);
  const TINKER = card('Test Goblin Tinker', 'Creature — Goblin', '{0}: You gain 1 life.', '{0}', ['1', '1']);
  const defs = [CHANNELER, TINKER];
  const power = (s: GameState): string | undefined => getChars(s, find(s, 'Test Top Brute', 'battlefield', 'p1')).power;
  it('is +3/+3 only while a creature card is on top of your library, and ends the moment it is not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Top Brute'] }, defs });
    setLibrary(s0, 'p1', ['Plains', 'Test Goblin Tinker']);
    expect(power(s0)).toBe('1');
    setLibrary(s0, 'p1', ['Test Goblin Tinker', 'Plains']);
    expect(power(s0)).toBe('4');
    setLibrary(s0, 'p2', ['Test Goblin Tinker']);
    setLibrary(s0, 'p1', ['Plains']);
    expect(power(s0)).toBe('1'); // an opponent's top creature card does not count
  });
});
