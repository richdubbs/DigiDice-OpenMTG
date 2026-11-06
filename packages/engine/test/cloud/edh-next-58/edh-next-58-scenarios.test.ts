/**
 * Commander lane cost, round edh-next-58: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites are from the
 * Comprehensive Rules of 2026-09-25 (see the round's record for any that could not be checked).
 *
 *   CR 118.9, 601.2b, 701.23a, 701.6a, 400.3  the Traps' alternative-cost conditions (searched their library, countered by an opponent's spell, cards put into a graveyard)
 *   CR 601.2f, 118.7, 205.2a, 701.21a         "~ costs {1} less to cast for each card type among permanents you've sacrificed this turn."
 *   CR 601.2b, 601.2f, 701.26a                "As an additional cost to cast ~, you may tap any number of untapped creatures you control. ~ costs {1} less ... for each creature tapped this way."
 *   CR 601.2f, 701.6a, 101.2                   "Spells with flash you cast cost {1} less to cast and can't be countered."
 *   CR 601.2f, 602.2b, 702.6a                  equip abilities of other Equipment; "for each" an object you control
 *   CR 601.2c, 601.2f                          "for each target" / "for each creature it targets"; "target you or a permanent you control"
 *   CR 602.2b, 118.7, 605.1a                   enchanted permanent's abilities (one-mana floor); "during your turn" cost increases on opponents' spells and abilities
 *   CR 404.1                                    "ten or more creature cards total in all graveyards"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
const resolveAll = (s0: GameState): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 30 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = settle(pass(s));
  return s;
};
const can = (s: GameState, player: 'p1' | 'p2', name: string): boolean => {
  const id = find(s, name, 'hand', player);
  return legal(s, player, 'cast').some((a) => a.object === id);
};
const cast = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): GameState => resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never)));
/** Answer whatever comes up (first options, auto payment) and pass priority until the stack is empty. */
const driveAll = (s0: GameState): GameState => {
  let s = s0;
  for (let g = 0; g < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const d = s.pending;
    if (d === null) break;
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, Math.max(d.min, 1)) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
};
const pickT = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

const FILLER = card('Test Filler', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{0}' });
const MILL3 = card('Test Mill Three', 'Sorcery', 'Target player mills three cards.', { cost: '{0}' });
const MILL2 = card('Test Mill Two', 'Sorcery', 'Target player mills two cards.', { cost: '{0}' });
const TUTOR = card('Test Tutor', 'Instant', 'Search your library for a card, put it into your hand, then shuffle.', { cost: '{0}', colors: ['U'] });
const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.', { cost: '{0}', colors: ['U'] });
const SAC1 = card('Test Sacrifice', 'Sorcery', 'Sacrifice a creature.', { cost: '{0}' });
const SACART = card('Test Sacrifice Artifact', 'Sorcery', 'Sacrifice an artifact.', { cost: '{0}' });
const WIDGET = card('Test Widget', 'Artifact', '', { cost: '{0}' });

// ---------------------------------------------------------------------------------------------------------------------------------
// The Traps' alternative-cost conditions (CR 118.9, 601.2b)
// ---------------------------------------------------------------------------------------------------------------------------------
const SEARCH_TRAP = card('Test Search Trap', 'Instant — Trap', "If an opponent searched their library this turn, you may pay {0} rather than pay this spell's mana cost.\nYou gain 1 life.", { cost: '{3}{U}{U}', colors: ['U'] });
const COUNTER_TRAP = card('Test Counter Trap', 'Instant — Trap', "If a creature spell you cast this turn was countered by a spell or ability an opponent controlled, you may pay {0} rather than pay this spell's mana cost.\nYou gain 1 life.", { cost: '{3}{U}{U}', colors: ['U'] });
const GRAVE_TRAP = card('Test Grave Trap', 'Instant — Trap', "If an opponent had three or more cards put into their graveyard from anywhere this turn, you may pay {0} rather than pay this spell's mana cost.\nYou gain 1 life.", { cost: '{3}{B}{B}', colors: ['B'] });

describe('CR 701.23a, 118.9: "If an opponent searched their library this turn, you may pay {0} rather than pay this spell\'s mana cost."', () => {
  const board = (): GameState => scenario([], { defs: [SEARCH_TRAP, TUTOR, FILLER, SAC1], p1: { hand: ['Test Search Trap', 'Test Filler'] }, p2: { hand: ['Test Tutor'] } });
  it('is automated', () => expect(noManual(SEARCH_TRAP)).toEqual([]));
  it('with no mana the Trap is not castable before; once an opponent has searched their own library this turn it is castable for {0}', () => {
    const s0 = board();
    expect(can(s0, 'p1', 'Test Search Trap')).toBe(false);
    // p1 puts a spell on the stack, p2 responds with a tutor of their own library
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') } as never));
    s = pass(s);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Tutor', 'hand', 'p2') } as never));
    s = driveAll(s);
    expect(s.zones.stack.length).toBe(0);
    expect(can(s, 'p1', 'Test Search Trap')).toBe(true);
  });
  it('negative: searching your OWN library (the Trap\'s controller) does not count', () => {
    const s0 = scenario([], { defs: [SEARCH_TRAP, TUTOR], p1: { hand: ['Test Search Trap', 'Test Tutor'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tutor', 'hand', 'p1') } as never));
    s = driveAll(s);
    expect(can(s, 'p1', 'Test Search Trap')).toBe(false);
  });
});

describe('CR 701.6a, 118.9: "If a creature spell you cast this turn was countered by a spell or ability an opponent controlled, you may pay {0} rather than ..."', () => {
  const board = (): GameState => scenario([], { defs: [COUNTER_TRAP, NEGATE, FILLER, WIDGET], p1: { hand: ['Test Counter Trap', 'Test Filler', 'Test Widget'] }, p2: { hand: ['Test Negate'] } });
  it('is automated', () => expect(noManual(COUNTER_TRAP)).toEqual([]));
  const counterWhat = (name: string): GameState => {
    const s0 = board();
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never));
    s = pass(s);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Negate', 'hand', 'p2') } as never));
    s = answer(s, pickT(find(s, name, 'stack')));
    return resolveAll(s);
  };
  it('after an opponent countered your creature spell the Trap is castable with no mana', () => {
    expect(can(board(), 'p1', 'Test Counter Trap')).toBe(false);
    const s = counterWhat('Test Filler');
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Filler')).toBe(true);
    expect(can(s, 'p1', 'Test Counter Trap')).toBe(true);
  });
  it('negative: an opponent countering a NONcreature spell of yours does not count', () => {
    const s = counterWhat('Test Widget');
    expect(can(s, 'p1', 'Test Counter Trap')).toBe(false);
  });
});

describe('CR 400.3, 404.1, 118.9: "If an opponent had three or more cards put into their graveyard from anywhere this turn, you may pay {0} rather than ..."', () => {
  const board = (): GameState => scenario([], { defs: [GRAVE_TRAP, MILL3, MILL2], p1: { hand: ['Test Grave Trap', 'Test Mill Three', 'Test Mill Two'] } });
  const milled = (name: string, target: 'p1' | 'p2'): GameState => {
    const s0 = board();
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never));
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] } as DecisionAnswer);
    return resolveAll(s);
  };
  it('is automated', () => expect(noManual(GRAVE_TRAP)).toEqual([]));
  it('three cards of one opponent milled into their graveyard: castable for {0}; before it is not', () => {
    expect(can(board(), 'p1', 'Test Grave Trap')).toBe(false);
    const s = milled('Test Mill Three', 'p2');
    expect(s.zones.graveyard['p2']!.length).toBe(3);
    expect(can(s, 'p1', 'Test Grave Trap')).toBe(true);
  });
  it('negative: only two cards, or three cards into your own graveyard, are not enough', () => {
    expect(can(milled('Test Mill Two', 'p2'), 'p1', 'Test Grave Trap')).toBe(false);
    expect(can(milled('Test Mill Three', 'p1'), 'p1', 'Test Grave Trap')).toBe(false);
  });
});


// ---------------------------------------------------------------------------------------------------------------------------------
// "~ costs {1} less to cast for each card type among permanents you've sacrificed this turn." (CR 205.2a, 701.21a, 601.2f)
// ---------------------------------------------------------------------------------------------------------------------------------
const GLUTTON = card('Test Glutton', 'Creature — Dragon', "Test Glutton costs {1} less to cast for each card type among permanents you've sacrificed this turn.", { pt: ['3', '3'], cost: '{3}{B}', colors: ['B'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{0}' });

describe("CR 205.2a, 701.21a, 601.2f: ~ costs {1} less to cast for each card type among permanents you've sacrificed this turn", () => {
  const board = (): GameState => scenario(['Swamp'], { defs: [GLUTTON, BEAR, WIDGET, SAC1, SACART], p1: { hand: ['Test Glutton', 'Test Sacrifice', 'Test Sacrifice Artifact'], battlefield: ['Swamp', 'Swamp', 'Test Bear', 'Test Bear', 'Test Widget'] } });
  it('is automated', () => expect(noManual(GLUTTON)).toEqual([]));
  it('two lands are not enough for {3}{B}; one creature card type sacrificed leaves {2}{B}: still not; creature and artifact make it {1}{B}: castable', () => {
    const s0 = board();
    expect(can(s0, 'p1', 'Test Glutton')).toBe(false);
    const s1 = driveAll(cast0(s0, 'Test Sacrifice'));
    expect(can(s1, 'p1', 'Test Glutton')).toBe(false);
    const s2 = driveAll(cast0(s1, 'Test Sacrifice Artifact'));
    expect(can(s2, 'p1', 'Test Glutton')).toBe(true);
  });
  it('negative: two creatures sacrificed are one card type (counted once)', () => {
    const s0 = scenario(['Swamp'], { defs: [GLUTTON, BEAR, SAC1], p1: { hand: ['Test Glutton', 'Test Sacrifice', 'Test Sacrifice'], battlefield: ['Swamp', 'Swamp', 'Test Bear', 'Test Bear'] } });
    const s1 = driveAll(cast0(driveAll(cast0(s0, 'Test Sacrifice')), 'Test Sacrifice'));
    expect(can(s1, 'p1', 'Test Glutton')).toBe(false);
  });
});

/** Cast without resolving (the spell stays on the stack until driveAll). */
function cast0(s: GameState, name: string): GameState {
  return settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// "As an additional cost to cast ~, you may tap any number of untapped creatures you control. ~ costs {1} less to cast for each creature tapped this way."
// ---------------------------------------------------------------------------------------------------------------------------------
const SINGULARITY = card('Test Singularity', 'Instant', 'As an additional cost to cast Test Singularity, you may tap any number of untapped creatures you control. Test Singularity costs {1} less to cast for each creature tapped this way.\nYou gain 3 life.', { cost: '{3}{R}', colors: ['R'] });

describe('CR 601.2b, 601.2f, 701.26a: tapping creatures as an additional cost reduces the cost', () => {
  const board = (bears: number, lands: number): GameState => scenario(['Mountain'], { defs: [SINGULARITY, BEAR], p1: { hand: ['Test Singularity'], battlefield: [...Array<string>(lands).fill('Mountain'), ...Array<string>(bears).fill('Test Bear')] } });
  it('is automated', () => expect(noManual(SINGULARITY)).toEqual([]));
  it('one Mountain pays {R} when three untapped creatures reduce {3}{R}; the creatures end up tapped', () => {
    const s0 = board(3, 1);
    expect(can(s0, 'p1', 'Test Singularity')).toBe(true);
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Singularity', 'hand', 'p1') } as never));
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 3 });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, d.max) });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else throw new Error(`unexpected ${d.kind}`);
    }
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(23);
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear');
    expect(bears.filter((id) => s.objects[id]!.tapped).length).toBe(3);
  });
  it('negative: with no creatures one Mountain cannot cast {3}{R}', () => {
    expect(can(board(0, 1), 'p1', 'Test Singularity')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Spells with flash you cast cost {1} less to cast and can't be countered."
// ---------------------------------------------------------------------------------------------------------------------------------
const NIGHTBONDER = card('Test Nightbonder', 'Creature — Faerie', "Flash\nSpells with flash you cast cost {1} less to cast and can't be countered.", { pt: ['1', '1'], cost: '{1}{U}', colors: ['U'] });
const FLASHER2 = card('Test Flasher', 'Creature — Faerie', 'Flash', { pt: ['2', '2'], cost: '{1}{U}', colors: ['U'] });
const SLOWPOKE = card('Test Slowpoke', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{U}', colors: ['U'] });

describe('CR 601.2f, 101.2: "Spells with flash you cast cost {1} less to cast and can\'t be countered."', () => {
  const board = (): GameState => scenario(['Island'], { defs: [NIGHTBONDER, FLASHER2, SLOWPOKE, NEGATE], p1: { hand: ['Test Flasher', 'Test Slowpoke'], battlefield: ['Test Nightbonder', 'Island'] }, p2: { hand: ['Test Negate'] } });
  it('is automated', () => expect(noManual(NIGHTBONDER)).toEqual([]));
  it('a flash spell costing {1}{U} is castable with one Island; a spell without flash is not', () => {
    const s = board();
    expect(can(s, 'p1', 'Test Flasher')).toBe(true);
    expect(can(s, 'p1', 'Test Slowpoke')).toBe(false);
  });
  it('the flash spell can\'t be countered by an opponent\'s counterspell', () => {
    const s0 = board();
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Flasher', 'hand', 'p1') } as never));
    s = pass(s);
    const negate = legal(s, 'p2', 'cast').some((a) => a.object === find(s, 'Test Negate', 'hand', 'p2'));
    if (negate) {
      s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Negate', 'hand', 'p2') } as never));
      if (s.pending?.kind === 'chooseTargets') s = answer(s, pickT(find(s, 'Test Flasher', 'stack')));
    }
    s = driveAll(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Flasher')).toBe(true);
  });
});

const canAct = (s: GameState, player: 'p1' | 'p2', source: string, zone: 'battlefield' | 'graveyard' = 'battlefield'): boolean => {
  const id = find(s, source, zone, player);
  return legal(s, player, 'activate').some((a) => a.object === id && !a.isMana);
};
const tappedLands = (s: GameState, player: 'p1' | 'p2'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && s.objects[id]!.tapped && /Mountain|Plains|Island|Swamp|Forest/.test(s.objects[id]!.defId)).length;

// ---------------------------------------------------------------------------------------------------------------------------------
// Equip abilities of other Equipment; equip abilities "for each Dragon you control"
// ---------------------------------------------------------------------------------------------------------------------------------
const WHIP = card('Test Whip', 'Artifact — Equipment', 'Equip abilities you activate of other Equipment cost {1} less to activate.\nEquip {2}', { cost: '{0}' });
const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equip {2}', { cost: '{0}' });
const DRAGON = card('Test Dragon', 'Creature — Dragon', '', { pt: ['4', '4'], cost: '{0}', colors: ['R'] });
const HOARD = card('Test Hoard Keeper', 'Creature — Goblin', 'Equip abilities you activate cost {1} less to activate for each Dragon you control.', { pt: ['1', '1'], cost: '{0}' });
const BLADE3 = card('Test Heavy Blade', 'Artifact — Equipment', 'Equip {3}', { cost: '{0}' });

describe('CR 601.2f, 602.2b, 702.6a: "Equip abilities you activate of other Equipment cost {1} less to activate."', () => {
  const board = (): GameState => scenario(['Plains'], { defs: [WHIP, BLADE, BEAR], p1: { battlefield: ['Test Whip', 'Test Blade', 'Test Bear', 'Plains'] } });
  it('is automated', () => expect(noManual(WHIP)).toEqual([]));
  it('the other Equipment equips for {1}: one Plains is enough; the Whip\'s own equip {2} is not reduced and is not payable', () => {
    const s = board();
    expect(canAct(s, 'p1', 'Test Blade')).toBe(true);
    expect(canAct(s, 'p1', 'Test Whip')).toBe(false);
  });
  it('negative: without the Whip the other Equipment\'s equip {2} is not payable with one Plains', () => {
    const s = scenario(['Plains'], { defs: [BLADE, BEAR], p1: { battlefield: ['Test Blade', 'Test Bear', 'Plains'] } });
    expect(canAct(s, 'p1', 'Test Blade')).toBe(false);
  });
});

describe('CR 601.2f, 602.2b, 702.6a: "Equip abilities you activate cost {1} less to activate for each Dragon you control." (the count is of Dragons you control)', () => {
  const board = (dragons: number, theirDragons = 0): GameState => scenario(['Plains'], { defs: [HOARD, BLADE3, BEAR, DRAGON], p1: { battlefield: ['Test Hoard Keeper', 'Test Heavy Blade', 'Test Bear', 'Plains', ...Array<string>(dragons).fill('Test Dragon')] }, p2: { battlefield: Array<string>(theirDragons).fill('Test Dragon') } });
  it('is automated', () => expect(noManual(HOARD)).toEqual([]));
  it('Equip {3} costs {1} with two Dragons (one Plains enough) and {2} with one Dragon (not enough)', () => {
    expect(canAct(board(2), 'p1', 'Test Heavy Blade')).toBe(true);
    expect(canAct(board(1), 'p1', 'Test Heavy Blade')).toBe(false);
  });
  it('negative: the opponent\'s Dragons are not counted', () => {
    expect(canAct(board(1, 3), 'p1', 'Test Heavy Blade')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Enchanted artifact's activated abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana."
// ---------------------------------------------------------------------------------------------------------------------------------
const POWER_AURA = card('Test Power Aura', 'Enchantment — Aura', "Enchant artifact\nEnchanted artifact's activated abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.", { cost: '{0}' });
const GEAR = card('Test Gear', 'Artifact', '{3}, {T}: You gain 1 life.', { cost: '{0}' });

describe("CR 602.2b, 118.7, 303.4: Enchanted artifact's activated abilities cost {2} less to activate (never below one mana)", () => {
  const board = (lands: number): GameState => scenario(['Plains'], { defs: [POWER_AURA, GEAR], p1: { hand: ['Test Power Aura'], battlefield: ['Test Gear', ...Array<string>(lands).fill('Plains')] } });
  const enchant = (s0: GameState): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Power Aura', 'hand', 'p1') } as never));
    s = answer(s, pickT(find(s, 'Test Gear', 'battlefield')));
    return driveAll(s);
  };
  it('is automated', () => expect(noManual(POWER_AURA)).toEqual([]));
  it('{3} becomes {1}: one Plains activates the enchanted Gear; unenchanted it needs three', () => {
    expect(canAct(board(1), 'p1', 'Test Gear')).toBe(false);
    const s = enchant(board(3));
    expect(canAct(s, 'p1', 'Test Gear')).toBe(true);
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Gear', 'battlefield'), ability: 'p:0:0' } as never);
    expect(tappedLands(settle(t), 'p1')).toBe(1); // only one Plains paid, not zero (the floor of one mana) and not three
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Spells you cast cost {1} less for each target" / "Each instant and sorcery spell you cast costs {1} less to cast for each creature it targets"
// ---------------------------------------------------------------------------------------------------------------------------------
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.', { cost: '{1}{R}', colors: ['R'] });
const HINATA = card('Test Hinata', 'Legendary Creature — Human', 'Spells you cast cost {1} less to cast for each target.\nSpells your opponents cast cost {1} more to cast for each target.', { pt: ['2', '2'], cost: '{0}' });
const TWIN = card('Test Twin Focus', 'Creature — Wizard', 'Each instant and sorcery spell you cast costs {1} less to cast for each creature it targets.', { pt: ['1', '1'], cost: '{0}' });

describe('CR 601.2c, 601.2f: "Spells you cast cost {1} less to cast for each target. Spells your opponents cast cost {1} more to cast for each target."', () => {
  const board = (hinata: boolean): GameState => scenario(['Mountain'], { defs: [HINATA, ZAP, BEAR], p1: { hand: ['Test Zap'], battlefield: [...(hinata ? ['Test Hinata'] : []), 'Mountain', 'Mountain', 'Test Bear'] }, p2: { hand: ['Test Zap'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
  const zapAt = (s0: GameState, player: 'p1' | 'p2'): GameState => {
    let s = act(s0, { type: 'cast', player, card: find(s0, 'Test Zap', 'hand', player) } as never);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: player === 'p1' ? 'p2' : 'p1' }] } as DecisionAnswer);
    return settle(s);
  };
  it('is automated', () => expect(noManual(HINATA)).toEqual([]));
  it('one target takes {1} off your Zap: one land is tapped instead of two', () => {
    expect(tappedLands(zapAt(board(true), 'p1'), 'p1')).toBe(1);
    expect(tappedLands(zapAt(board(false), 'p1'), 'p1')).toBe(2); // negative: without the modifier the full {1}{R}
  });
  it('an opponent\'s Zap with one target costs {1} more: three lands tapped instead of two', () => {
    const open = (hinata: boolean): GameState => {
      const s0 = board(hinata);
      const filler = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') } as never));
      return pass(settle(answer(filler, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer)));
    };
    expect(tappedLands(zapAt(open(true), 'p2'), 'p2')).toBe(3);
    expect(tappedLands(zapAt(open(false), 'p2'), 'p2')).toBe(2);
  });
});

describe('CR 601.2c, 601.2f: "Each instant and sorcery spell you cast costs {1} less to cast for each creature it targets."', () => {
  const board = (): GameState => scenario(['Mountain'], { defs: [TWIN, ZAP, BEAR], p1: { hand: ['Test Zap'], battlefield: ['Test Twin Focus', 'Mountain', 'Test Bear'] } });
  it('is automated', () => expect(noManual(TWIN)).toEqual([]));
  it('Zap on a creature costs {R}: castable with one land; the check before targets are chosen is optimistic', () => {
    const s0 = board();
    expect(can(s0, 'p1', 'Test Zap')).toBe(true);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') } as never);
    s = answer(s, pickT(find(s, 'Test Bear', 'battlefield')));
    expect(tappedLands(settle(s), 'p1')).toBe(1);
  });
  it('negative: aimed at the player (no creature) it costs the full {1}{R}: one land is not enough', () => {
    const s0 = board();
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') } as never);
    expect(() => settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer))).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Spells your opponents cast that target you or a permanent you control cost {2} more to cast."
// ---------------------------------------------------------------------------------------------------------------------------------
const SIEGE = card('Test Siege Wall', 'Creature — Wall', 'Spells your opponents cast that target you or a permanent you control cost {2} more to cast.', { pt: ['0', '4'], cost: '{0}' });
const THEIR_BEAR = card('Test Their Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{0}' });

describe('CR 115.1, 601.2c, 601.2f: "Spells your opponents cast that target you or a permanent you control cost {2} more to cast."', () => {
  const open = (): GameState => {
    const s0 = scenario(['Mountain'], { defs: [SIEGE, ZAP, BEAR, THEIR_BEAR, FILLER], p1: { hand: ['Test Filler'], battlefield: ['Test Siege Wall', 'Test Bear'] }, p2: { hand: ['Test Zap'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Test Their Bear'] } });
    return pass(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') } as never)));
  };
  const zapAt = (target: { kind: 'player'; id: 'p1' | 'p2' } | { kind: 'object'; name: string }): GameState => {
    const s0 = open();
    const s = act(s0, { type: 'cast', player: 'p2', card: find(s0, 'Test Zap', 'hand', 'p2') } as never);
    const t = target.kind === 'player' ? { kind: 'player' as const, id: target.id } : { kind: 'object' as const, id: find(s, target.name, 'battlefield') };
    return settle(answer(s, { kind: 'chooseTargets', targets: [t] } as DecisionAnswer));
  };
  it('is automated', () => expect(noManual(SIEGE)).toEqual([]));
  it('a Zap aimed at the controller costs {2} more (four lands tapped), and so does one aimed at their permanent', () => {
    expect(tappedLands(zapAt({ kind: 'player', id: 'p1' }), 'p2')).toBe(4);
    expect(tappedLands(zapAt({ kind: 'object', name: 'Test Bear' }), 'p2')).toBe(4);
  });
  it('negative: aimed at the opponent\'s own player or creature it costs {1}{R} only (two lands)', () => {
    expect(tappedLands(zapAt({ kind: 'player', id: 'p2' }), 'p2')).toBe(2);
    expect(tappedLands(zapAt({ kind: 'object', name: 'Test Their Bear' }), 'p2')).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "During your turn, spells your opponents cast cost {1} more to cast and abilities your opponents activate cost {1} more to activate unless they're mana abilities."
// ---------------------------------------------------------------------------------------------------------------------------------
const TITHE = card('Test Tithe Collector', 'Creature — Human', "During your turn, spells your opponents cast cost {1} more to cast and abilities your opponents activate cost {1} more to activate unless they're mana abilities.", { pt: ['1', '1'], cost: '{0}' });
const ROCK = card('Test Gem Rock', 'Artifact', '{1}, {T}: You gain 1 life.\n{T}: Add {C}.', { cost: '{0}' });

describe("CR 601.2f, 602.2b, 605.1a: During your turn, spells your opponents cast cost {1} more and abilities they activate cost {1} more unless they're mana abilities", () => {
  const open = (tithe: boolean): GameState => {
    const s0 = scenario(['Mountain'], { defs: [TITHE, ZAP, ROCK, FILLER], p1: { hand: ['Test Filler'], battlefield: tithe ? ['Test Tithe Collector'] : [] }, p2: { hand: ['Test Zap'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Test Gem Rock'] } });
    return pass(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') } as never)));
  };
  const zap = (tithe: boolean): GameState => {
    const s0 = open(tithe);
    return settle(answer(act(s0, { type: 'cast', player: 'p2', card: find(s0, 'Test Zap', 'hand', 'p2') } as never), { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] } as DecisionAnswer));
  };
  it('is automated', () => expect(noManual(TITHE)).toEqual([]));
  it('an opponent\'s Zap on your turn costs {1} more: three lands tapped instead of two', () => {
    expect(tappedLands(zap(true), 'p2')).toBe(3);
    expect(tappedLands(zap(false), 'p2')).toBe(2);
  });
  it('an opponent\'s ability costs {1} more ({2} instead of {1}); its mana ability does not', () => {
    const act1 = (tithe: boolean): GameState => settle(act(open(tithe), { type: 'activate', player: 'p2', source: find(open(tithe), 'Test Gem Rock', 'battlefield', 'p2'), ability: 'p:0:0' } as never));
    expect(tappedLands(act1(true), 'p2')).toBe(2);
    expect(tappedLands(act1(false), 'p2')).toBe(1);
  });
  it('negative: on the opponent\'s own turn nothing costs more (the Collector\'s controller\'s turn only)', () => {
    const s0 = scenario(['Mountain'], { defs: [TITHE, ZAP], p1: { battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Test Zap'] }, p2: { battlefield: ['Test Tithe Collector'] } });
    const s = settle(answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') } as never), { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer));
    expect(tappedLands(s, 'p1')).toBe(2); // p2's Collector works on p2's turns only: it is p1's turn, so p1's own spell is not an opponent's spell during p2's turn
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "If there are ten or more creature cards total in all graveyards, ~ costs {6} less to cast."
// ---------------------------------------------------------------------------------------------------------------------------------
const WOE = card('Test Woe Avatar', 'Creature — Avatar', 'If there are ten or more creature cards total in all graveyards, Test Woe Avatar costs {6} less to cast.', { pt: ['6', '6'], cost: '{6}{B}{B}', colors: ['B'] });

describe('CR 404.1, 601.2f: "If there are ten or more creature cards total in all graveyards, ~ costs {6} less to cast."', () => {
  const board = (mine: number, theirs: number): GameState => scenario(['Swamp'], { defs: [WOE, BEAR], p1: { hand: ['Test Woe Avatar'], battlefield: ['Swamp', 'Swamp'], graveyard: Array<string>(mine).fill('Test Bear') }, p2: { graveyard: Array<string>(theirs).fill('Test Bear') } });
  it('is automated', () => expect(noManual(WOE)).toEqual([]));
  it('five in each graveyard make ten: {B}{B} is payable with two Swamps; nine are not enough', () => {
    expect(can(board(5, 5), 'p1', 'Test Woe Avatar')).toBe(true);
    expect(can(board(4, 5), 'p1', 'Test Woe Avatar')).toBe(false);
  });
  it('negative: noncreature cards in graveyards are not counted', () => {
    const s = scenario(['Swamp'], { defs: [WOE, BEAR, WIDGET], p1: { hand: ['Test Woe Avatar'], battlefield: ['Swamp', 'Swamp'], graveyard: [...Array<string>(5).fill('Test Bear'), ...Array<string>(5).fill('Test Widget')] } });
    expect(can(s, 'p1', 'Test Woe Avatar')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "As long as <C>, activated abilities of cards in your graveyard cost {2} less to activate. This effect can't reduce the mana in that ability's activation cost to less than one mana."
// ---------------------------------------------------------------------------------------------------------------------------------
const CONVERGENCE = card('Test Convergence', 'Enchantment', "As long as you control a creature, activated abilities of cards in your graveyard cost {2} less to activate. This effect can't reduce the mana in that ability's activation cost to less than one mana.", { cost: '{0}' });
const RETURNER = card('Test Returner', 'Creature — Zombie', '{3}: Return Test Returner from your graveyard to your hand.', { pt: ['1', '1'], cost: '{0}' });

describe("CR 602.2b, 118.7, 611.3a: As long as C, activated abilities of cards in your graveyard cost {2} less (never below one mana)", () => {
  const board = (conv: boolean, bear: boolean): GameState => scenario(['Plains'], { defs: [CONVERGENCE, RETURNER, BEAR], p1: { graveyard: ['Test Returner'], battlefield: [...(conv ? ['Test Convergence'] : []), ...(bear ? ['Test Bear'] : []), 'Plains'] } });
  it('is automated', () => expect(noManual(CONVERGENCE)).toEqual([]));
  it('with a creature the {3} graveyard ability costs {1}: one Plains activates it', () => {
    expect(canAct(board(true, true), 'p1', 'Test Returner', 'graveyard')).toBe(true);
  });
  it('negative: without the creature (condition false), or without the enchantment, it costs {3}', () => {
    expect(canAct(board(true, false), 'p1', 'Test Returner', 'graveyard')).toBe(false);
    expect(canAct(board(false, true), 'p1', 'Test Returner', 'graveyard')).toBe(false);
  });
});

// Hinata ruling 2022-02-18 / Battlefield Thaumaturge ruling 2014-04-26: the different targets are counted, not the times the text says "target"
const TWICE_ZAP = card('Test Twice Zap', 'Instant', 'Test Twice Zap deals 1 damage to target creature. Test Twice Zap deals 1 damage to target creature.', { cost: '{2}{R}', colors: ['R'] });

describe('CR 601.2c, 115.3: a cost reduction per target counts each target once, even when the spell targets it twice', () => {
  const board = (): GameState => scenario(['Mountain'], { defs: [TWIN, TWICE_ZAP, BEAR, THEIR_BEAR], p1: { hand: ['Test Twice Zap'], battlefield: ['Test Twin Focus', 'Mountain', 'Mountain', 'Test Bear'] }, p2: { battlefield: ['Test Their Bear'] } });
  const aim = (names: [string, string]): GameState => {
    const s0 = board();
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Twice Zap', 'hand', 'p1') } as never);
    for (const n of names) s = answer(s, pickT(find(s, n, 'battlefield')));
    return settle(s);
  };
  it('is automated', () => expect(noManual(TWICE_ZAP)).toEqual([]));
  it('two different creatures: {1} off per creature takes {2}{R} down to {R} (one land); the same creature twice is one target: {1}{R} (two lands)', () => {
    expect(tappedLands(aim(['Test Bear', 'Test Their Bear']), 'p1')).toBe(1);
    expect(tappedLands(aim(['Test Bear', 'Test Bear']), 'p1')).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Review fixes: Archive Trap needs the opponent's search of THEIR OWN library; Ravenous Trap counts cards, not tokens; a per-target reduction never makes an unpayable spell castable
// ---------------------------------------------------------------------------------------------------------------------------------
const PEEK = card('Test Peek', 'Instant', "Search target opponent's library for a card and exile it. Then that player shuffles.", { cost: '{0}', colors: ['U'] });
const TOKENS = card('Test Token Maker', 'Sorcery', 'Target opponent creates three 1/1 white Soldier creature tokens.', { cost: '{0}' });
const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.', { cost: '{0}' });
const BIG_ROCK = card('Test Big Rock', 'Artifact', '', { cost: '{7}' });

describe('review: an opponent searching YOUR library is not "an opponent searched their library"', () => {
  it('p2 searches p1\'s library: the Search Trap stays uncastable', () => {
    const s0 = scenario([], { defs: [SEARCH_TRAP, PEEK, FILLER], p1: { hand: ['Test Search Trap', 'Test Filler'] }, p2: { hand: ['Test Peek'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Filler', 'hand', 'p1') } as never));
    s = pass(s);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Peek', 'hand', 'p2') } as never));
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] } as DecisionAnswer);
    s = driveAll(s);
    expect(can(s, 'p1', 'Test Search Trap')).toBe(false);
  });
});

describe('review: tokens that die are not cards put into a graveyard (CR 108.2b)', () => {
  it('three tokens of the opponent destroyed: the Grave Trap stays uncastable', () => {
    const s0 = scenario([], { defs: [GRAVE_TRAP, TOKENS, WRATH], p1: { hand: ['Test Grave Trap', 'Test Token Maker', 'Test Wrath'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Token Maker', 'hand', 'p1') } as never));
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    s = driveAll(s);
    s = driveAll(cast0(s, 'Test Wrath'));
    expect(s.zones.graveyard['p2']!.length).toBe(0);
    expect(can(s, 'p1', 'Test Grave Trap')).toBe(false);
  });
});

describe('review: Hinata-style reduction does not offer a spell with no targets that cannot be paid', () => {
  it('a {7} artifact with no lands is not castable with the modifier in play', () => {
    const s = scenario([], { defs: [HINATA, BIG_ROCK], p1: { hand: ['Test Big Rock'], battlefield: ['Test Hinata'] } });
    expect(can(s, 'p1', 'Test Big Rock')).toBe(false);
  });
});
