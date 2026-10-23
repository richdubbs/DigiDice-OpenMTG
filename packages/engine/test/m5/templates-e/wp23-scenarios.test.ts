/**
 * WP23 golden cards played: the JSON the parser makes from their text (WP23 templates, WP17 bootstrap, the stand-ins of support.ts) is put on synthetic cards
 * and run by the real engine (applyAction, the W2 interpreter and handlers). Each test pins the rule the template's nesting encodes.
 *
 *   CR 118.12a, design D3   Rhystic Study: the payer decides first, the controller's "you may" comes only if they decline
 *   CR 118.12               Smothering Tithe: "that player may pay {2}. If the player doesn't, you create a Treasure token."
 *   CR 603.7, 118.12        Pact of Negation: the delayed upkeep trigger, "pay ... If you don't, you lose the game"
 *   CR 608.2c, 614.15       Memory Lapse: the countered spell goes on top of its owner's library
 *   CR 607.2a               Fiend Hunter: the exile and the return are linked
 *   CR 603.7c               Sneak Attack: the creature put onto the battlefield is sacrificed at the next end step
 *   CR 614.15               an "instead" fold decided on resolution
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, GameState } from '../../../src/index';
import { getChars } from '../../../src/index';
import { act, advanceTo, answer, castAuto, find, passBoth, scenario, synth } from '../helpers';
import { chosenObject, putOnStack } from '../eval/helpers';
import { drive, objectTarget } from '../announce/support';
import { automated, card, face, options } from './support';

const opts = options();

/** The abilities the parser makes of `text` on a face with `type`; they must be fully automated and pass the gate. */
function parsed(name: string, type: string, text: string): AbilityDef[] {
  const f = face(card(name, type, text), opts);
  expect(automated(f.abilities), `${name}: ${JSON.stringify(f.abilities)}`).toBe(true);
  expect(f.gate.every((g) => g.ok), name).toBe(true);
  return f.abilities;
}

const def = (name: string, type: string, text: string, pt?: [string, string]): CardDef => synth({ name, type, cost: '{0}', abilities: parsed(name, type, text), ...(pt ? { pt } : {}) });
const yesNo = (s: GameState, yes: boolean): GameState => answer(s, { kind: 'yesNo', yes });
const pendingOf = (s: GameState): string => (s.pending ? `${s.pending.player} ${s.pending.kind}` : 'none');
const inZone = (s: GameState, name: string, zone: 'graveyard' | 'hand' | 'exile' | 'battlefield' | 'library', owner = 'p2'): boolean => {
  const ids = zone === 'battlefield' || zone === 'exile' ? s.zones[zone] : s.zones[zone][owner]!;
  return ids.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
};

describe('CR 118.12a, design D3: Rhystic Study asks the opponent (the payer) first, then its controller', () => {
  const RHYSTIC = def('Test Study', 'Enchantment', 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.');
  const NOTHING = synth({ name: 'Test Nothing', type: 'Instant', cost: '{0}', abilities: [] });
  const setup = (): GameState => {
    let s = scenario(['Island'], { p1: { battlefield: ['Test Study'] }, p2: { hand: ['Test Nothing'], battlefield: ['Island'] }, defs: [RHYSTIC, NOTHING] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = castAuto(s, 'Test Nothing', { player: 'p2' });
    return passBoth(s);
  };

  it('the opponent declines: then the controller is asked, and draws', () => {
    let s = setup();
    expect(pendingOf(s)).toBe('p2 yesNo');
    s = yesNo(s, false);
    expect(pendingOf(s)).toBe('p1 yesNo');
    const before = s.zones.hand['p1']!.length;
    s = yesNo(s, true);
    expect(s.zones.hand['p1']!.length).toBe(before + 1);
  });

  it('the opponent pays {1}: the controller is never asked', () => {
    let s = yesNo(setup(), true);
    s = drive(s, [{ kind: 'payCost', auto: true }]);
    expect(pendingOf(s)).not.toBe('p1 yesNo');
  });
});

describe('CR 118.12: Smothering Tithe, "that player may pay {2}. If the player doesn\'t, you create a Treasure token."', () => {
  const TITHE = def('Test Tithe', 'Enchantment', "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.");
  const board = (): GameState => advanceTo(scenario(['Island'], { p1: { battlefield: ['Test Tithe'] }, p2: { battlefield: ['Island', 'Island'] }, defs: [TITHE] }), 2, 'draw');

  it('the drawing player declines: the controller of the Tithe creates a Treasure', () => {
    let s = passBoth(board());
    expect(pendingOf(s)).toBe('p2 yesNo');
    s = yesNo(s, false);
    // CR 111.10a: the predefined Treasure token (its definition is named "Treasure Token")
    expect(s.zones.battlefield.map((id) => `${s.objects[id]!.controller} ${s.defs[s.objects[id]!.defId]!.name}`)).toContain('p1 Treasure Token');
  });

  it('the drawing player pays {2}: no Treasure', () => {
    let s = yesNo(passBoth(board()), true);
    s = drive(s, [{ kind: 'payCost', auto: true }]);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Treasure Token')).toBe(false);
  });
});

describe('CR 603.7, 118.12: Pact of Negation\'s delayed upkeep trigger', () => {
  const PACT = def('Test Pact', 'Instant', "Counter target spell.\nAt the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.");
  const board = (): GameState => {
    const s = scenario(['Hill Giant', 'Island'], { p1: { hand: ['Test Pact'], battlefield: Array(5).fill('Island') }, defs: [PACT] });
    const giant = putOnStack(s, { name: 'Hill Giant', owner: 'p2' });
    return passBoth(castAuto(s, 'Test Pact', { answers: [{ kind: 'chooseTargets', targets: [chosenObject(giant)] }] }));
  };

  it('the spell is countered, and a delayed trigger waits for the controller\'s next upkeep (CR 603.7a)', () => {
    const s = board();
    expect(inZone(s, 'Hill Giant', 'graveyard')).toBe(true);
    expect(s.delayedTriggers).toHaveLength(1);
  });

  it('at that upkeep the controller declines to pay: they lose the game (CR 104.3e)', () => {
    let s = passBoth(advanceTo(board(), 3, 'upkeep'));
    expect(pendingOf(s)).toBe('p1 yesNo');
    s = yesNo(s, false);
    expect(s.result).toMatchObject({ winner: 'p2' });
  });

  it('at that upkeep the controller pays {3}{U}{U}: the game goes on', () => {
    let s = yesNo(passBoth(advanceTo(board(), 3, 'upkeep')), true);
    s = drive(s, [{ kind: 'payCost', auto: true }]);
    expect(s.result ?? null).toBeNull();
    expect(s.delayedTriggers).toEqual([]);
  });
});

describe('CR 608.2c, 614.15: Memory Lapse puts the countered spell on top of its owner\'s library', () => {
  it('the Hill Giant is the top card of p2\'s library, not in the graveyard', () => {
    const LAPSE = def('Test Lapse', 'Instant', "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard.");
    const s0 = scenario(['Hill Giant'], { p1: { hand: ['Test Lapse'] }, defs: [LAPSE] });
    const giant = putOnStack(s0, { name: 'Hill Giant', owner: 'p2' });
    const s = passBoth(castAuto(s0, 'Test Lapse', { answers: [{ kind: 'chooseTargets', targets: [chosenObject(giant)] }] }));
    expect(inZone(s, 'Hill Giant', 'graveyard')).toBe(false);
    const top = s.zones.library['p2']![0]!;
    expect(s.defs[s.objects[top]!.defId]!.name).toBe('Hill Giant');
  });
});

describe('CR 607.2a: Fiend Hunter exiles a creature and returns that card when it leaves', () => {
  const BLADE = def('Test Blade', 'Instant', 'Destroy target nonblack creature.');
  const HUNTER = def('Test Hunter', 'Creature — Human Cleric', "When ~ enters, you may exile another target creature.\nWhen ~ leaves the battlefield, return the exiled card to the battlefield under its owner's control.", ['1', '3']);

  it('enters: the target is exiled; destroyed: the exiled card returns under its owner\'s control', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Hunter', 'Test Blade'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [HUNTER, BLADE] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = passBoth(castAuto(s0, 'Test Hunter')); // the creature spell resolves; its enters trigger asks for a target
    s = drive(s, [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]);
    s = yesNo(passBoth(s), true);
    expect(inZone(s, 'Grizzly Bears', 'exile')).toBe(true);
    const hunter = find(s, 'Test Hunter', 'battlefield');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Blade', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(hunter)] });
    s = passBoth(drive(s, []));
    s = passBoth(s); // the leaves-the-battlefield trigger resolves
    expect(inZone(s, 'Grizzly Bears', 'battlefield')).toBe(true);
    const back = find(s, 'Grizzly Bears', 'battlefield');
    expect(s.objects[back]!.controller).toBe('p2');
  });
});

describe('CR 603.7c: Sneak Attack sacrifices the creature it put onto the battlefield at the next end step', () => {
  const SNEAK = def('Test Sneak', 'Enchantment', '{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.');

  it('the creature enters with haste and is sacrificed at the beginning of the end step', () => {
    const s0 = scenario(['Hill Giant', 'Mountain'], { p1: { hand: ['Hill Giant'], battlefield: ['Test Sneak', 'Mountain'] }, defs: [SNEAK] });
    let s = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Sneak', 'battlefield'), ability: 'p:0:0' }), []);
    s = passBoth(s);
    const choice = s.pending;
    expect(choice?.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Hill Giant', 'hand', 'p1')] });
    expect(inZone(s, 'Hill Giant', 'battlefield')).toBe(true);
    // CR 611.2c, 702.10: "That creature gains haste" reached the creature on the battlefield (layer 6)
    expect(getChars(s, find(s, 'Hill Giant', 'battlefield')).keywords.map((k) => k.keyword)).toContain('haste');
    s = passBoth(advanceTo(s, 1, 'end'));
    expect(inZone(s, 'Hill Giant', 'graveyard', 'p1')).toBe(true);
  });
});

describe('CR 614.15: "Y. If C, X instead." is decided on resolution', () => {
  const FOLD = def('Test Fold', 'Instant', "Draw a card. If you control a Forest, draw two cards instead.");

  it('without a Forest one card, with a Forest two (never three)', () => {
    for (const [lands, n] of [[[], 1], [['Forest'], 2]] as const) {
      const s0 = scenario(['Forest'], { p1: { hand: ['Test Fold'], battlefield: [...lands] }, defs: [FOLD] });
      const before = s0.zones.hand['p1']!.length;
      const s = passBoth(castAuto(s0, 'Test Fold'));
      expect(s.zones.hand['p1']!.length, `${lands.length} Forest`).toBe(before - 1 + n);
    }
  });
});
