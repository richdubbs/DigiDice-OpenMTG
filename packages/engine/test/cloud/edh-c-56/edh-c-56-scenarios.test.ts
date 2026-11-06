/**
 * Commander EDHREC ranks 29,501-30,000 (second pass), round edh-c-56: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 613.1f, 702.9, 613.7      "Enchanted creature loses flying."
 *   CR 406.1, 404.1              "Target player exiles all land cards from their graveyard."
 *   CR 119.3, 701.20a, 608.2c    "Target opponent loses 2 life, then reveals a card at random from their hand."
 *   CR 119.3, 608.2c             "At the beginning of your upkeep, you lose 2 life if you don't control an Ogre."
 *   CR 118.12a, 608.2c           "Unless target player pays {3}, that player loses 5 life and you gain 5 life."
 *   CR 701.8a, 120.3, 608.2b     "Destroy target Mountain. ~ deals 3 damage to that land's controller."
 *   CR 400.3, 303.4              "{0}: Return enchanted creature and ~ to their owners' hands."
 *   CR 122.1, 604.1, 613.4c      "As long as there is exactly one tide counter on ~, it gets -1/-1." (and exactly three: +1/+1)
 *   CR 702.16, 613.1f            "Target creature loses protection from black until end of turn."
 *   CR 701.8a, 201.2, 608.2c     "Destroy target nonland permanent if another permanent with the same name is on the battlefield."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find } from '../../m3/scenario';
import { mpScenario, resolveStack, lifeOf } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, cost = '{0}', extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...extra } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const has = (s: GameState, id: ObjectId, keyword: string, quality?: string): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === keyword && (quality === undefined || k.quality === quality));
const names = (s: GameState, zone: 'battlefield' | 'graveyard' | 'exile' | 'hand', p: string): string[] =>
  (zone === 'battlefield' ? s.zones.battlefield.filter((o) => s.objects[o]!.controller === p) : zone === 'exile' ? s.zones.exile.filter((o) => s.objects[o]!.owner === p) : s.zones[zone][p]!).map((o) => s.defs[s.objects[o]!.defId]!.name);
const noPay = { kind: 'yesNo', yes: false } as const;
const yesPay = { kind: 'yesNo', yes: true } as const;

describe('CR 613.1f, 702.9, 613.7: "Enchanted creature loses flying."', () => {
  const GROUND = card('Test Ground Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature loses flying.');
  const GIVE = card('Test Wing Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature has flying.');
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', '{0}', { power: '2', toughness: '2' });
  const game = (auras: string[]): { s: GameState; bird: ObjectId; other: ObjectId } => {
    let bird = '';
    let other = '';
    const s = mpScenario({ players: 3, defs: [GROUND, GIVE, BIRD], zones: { p1: { battlefield: ['Test Bird', 'Test Bird', ...auras] } }, setup: (t) => {
      const birds = t.zones.battlefield.filter((o) => t.defs[t.objects[o]!.defId]!.name === 'Test Bird');
      [bird, other] = birds as [string, string];
      for (const a of auras) t.objects[find(t, a, 'battlefield', 'p1')]!.attachedTo = bird;
    } });
    return { s, bird, other };
  };
  it('is automated', () => expect(full(GROUND)).toBe(true));
  it('the enchanted creature has no flying; the other bird and an unenchanted game (negative) keep it', () => {
    const a = game(['Test Ground Aura']);
    expect(has(a.s, a.bird, 'flying')).toBe(false);
    expect(has(a.s, a.other, 'flying')).toBe(true);
    const b = game([]);
    expect(has(b.s, b.bird, 'flying')).toBe(true);
  });
  it('a later effect that gives flying wins (the ruling: it can later gain flying from another effect, CR 613.7)', () => {
    const a = game(['Test Ground Aura', 'Test Wing Aura']);
    expect(has(a.s, a.bird, 'flying')).toBe(true);
  });
});

describe('CR 406.1, 404.1: "Target player exiles all land cards from their graveyard."', () => {
  const SOIL = card('Test Soil Spell', 'Instant', 'Target player exiles all land cards from their graveyard.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  const run = (target: 'p2' | 'p1'): GameState => {
    const s = mpScenario({ players: 3, cards: ['Mountain', 'Forest'], defs: [SOIL, BEAR], zones: { p1: { hand: ['Test Soil Spell'], graveyard: ['Forest', 'Test Bear'] }, p2: { graveyard: ['Mountain', 'Mountain', 'Test Bear'] } } });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Soil Spell', 'hand', 'p1') } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] } as never);
    return resolveStack(t, []);
  };
  it('is automated', () => expect(full(SOIL)).toBe(true));
  it('exiles the land cards of the target player\'s graveyard only; the creature card and the other graveyards stay', () => {
    const t = run('p2');
    expect(names(t, 'graveyard', 'p2')).toEqual(['Test Bear']);
    expect(names(t, 'exile', 'p2').sort()).toEqual(['Mountain', 'Mountain']);
    expect(names(t, 'graveyard', 'p1').sort()).toEqual(['Forest', 'Test Bear', 'Test Soil Spell'].sort());
  });
  it('the target may be yourself; then your lands go and the other graveyard stays (negative: not "each player")', () => {
    const t = run('p1');
    expect(names(t, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Soil Spell']);
    expect(names(t, 'graveyard', 'p2')).toHaveLength(3);
  });
});

describe('CR 119.3, 701.20a, 608.2c: "Target opponent loses 2 life, then reveals a card at random from their hand."', () => {
  const TORT = card('Test Torturer', 'Creature — Human Rogue', '{0}: Target opponent loses 2 life, then reveals a card at random from their hand.', '{0}', { power: '1', toughness: '1' });
  const start = (hand: string[]): GameState => {
    const s = mpScenario({ players: 3, defs: [TORT], zones: { p1: { battlefield: ['Test Torturer'] }, p2: { hand } } });
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Torturer', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
    return resolveStack(t.pending?.kind === 'chooseTargets' ? answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as never) : t, []);
  };
  it('is automated', () => expect(full(TORT)).toBe(true));
  it('the opponent loses 2 life and keeps every card in hand (the reveal moves nothing)', () => {
    const t = start(['Plains', 'Plains', 'Plains']);
    expect(lifeOf(t, 'p2')).toBe(18);
    expect(names(t, 'hand', 'p2')).toHaveLength(3);
    expect(lifeOf(t, 'p1')).toBe(20);
  });
  it('with no cards in hand the opponent just loses 2 life (the ruling)', () => {
    const t = start([]);
    expect(lifeOf(t, 'p2')).toBe(18);
  });
});

describe('CR 119.3, 608.2c: "At the beginning of your upkeep, you lose 2 life if you don\'t control an Ogre."', () => {
  const SCOURGE = card('Test Scourge', 'Creature — Demon', "At the beginning of your upkeep, you lose 2 life if you don't control an Ogre.", '{0}', { power: '4', toughness: '4' });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', { power: '2', toughness: '2' });
  const upkeep = (battlefield: string[]): GameState => {
    const s = mpScenario({ players: 3, defs: [SCOURGE, OGRE], zones: { p1: { battlefield } } });
    return resolveStack(advanceTo(s, 4, 'upkeep'), []);
  };
  it('is automated', () => expect(full(SCOURGE)).toBe(true));
  it('without an Ogre you lose 2 life; with an Ogre (negative) you lose nothing', () => {
    expect(lifeOf(upkeep(['Test Scourge']), 'p1')).toBe(18);
    expect(lifeOf(upkeep(['Test Scourge', 'Test Ogre']), 'p1')).toBe(20);
  });
});

describe('CR 118.12a, 608.2c: "Unless target player pays {3}, that player loses 5 life and you gain 5 life."', () => {
  const SYPHON = card('Test Syphon', 'Sorcery', 'Unless target player pays {3}, that player loses 5 life and you gain 5 life.');
  const run = (lands: number, answers: unknown[]): GameState => {
    const s = mpScenario({ players: 3, defs: [SYPHON], zones: { p1: { hand: ['Test Syphon'] }, p2: { battlefield: Array(lands).fill('Plains') } } });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Syphon', 'hand', 'p1') } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as never);
    return resolveStack(t, answers as never);
  };
  it('is automated', () => expect(full(SYPHON)).toBe(true));
  it('the target player decides: declining loses 5 life and you gain 5; paying {3} changes nothing', () => {
    const lose = run(3, [noPay]);
    expect(lifeOf(lose, 'p2')).toBe(15);
    expect(lifeOf(lose, 'p1')).toBe(25);
    const paid = run(3, [yesPay]);
    expect(lifeOf(paid, 'p2')).toBe(20);
    expect(lifeOf(paid, 'p1')).toBe(20);
  });
  it('without three mana to pay with (negative) the life is lost', () => {
    const t = run(2, [noPay, noPay]);
    expect(lifeOf(t, 'p2')).toBe(15);
    expect(lifeOf(t, 'p1')).toBe(25);
  });
});

describe('CR 701.8a, 120.3, 608.2b: "Destroy target Mountain. ~ deals 3 damage to that land\'s controller."', () => {
  const ERUPT = card('Test Eruption', 'Sorcery', "Destroy target Mountain. Test Eruption deals 3 damage to that land's controller.", '{0}');
  const PEAK = card('Test Stone Peak', 'Land — Mountain', 'Indestructible');
  const run = (land: string): GameState => {
    const s = mpScenario({ players: 3, cards: ['Mountain', 'Forest'], defs: [ERUPT, PEAK], zones: { p1: { hand: ['Test Eruption'] }, p2: { battlefield: [land] } } });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Eruption', 'hand', 'p1') } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, land, 'battlefield', 'p2') }] } as never);
    return resolveStack(t, []);
  };
  it('is automated', () => expect(full(ERUPT)).toBe(true));
  it('the Mountain is destroyed and its controller takes 3', () => {
    const t = run('Mountain');
    expect(names(t, 'battlefield', 'p2')).toEqual([]);
    expect(lifeOf(t, 'p2')).toBe(17);
    expect(lifeOf(t, 'p1')).toBe(20);
  });
  it('an indestructible Mountain stays but its controller still takes 3 (the ruling)', () => {
    const t = run('Test Stone Peak');
    expect(names(t, 'battlefield', 'p2')).toEqual(['Test Stone Peak']);
    expect(lifeOf(t, 'p2')).toBe(17);
  });
  it('a Forest cannot be the target (negative)', () => {
    const s = mpScenario({ players: 3, cards: ['Forest'], defs: [ERUPT], zones: { p1: { hand: ['Test Eruption'] }, p2: { battlefield: ['Forest'] } } });
    let ok = true;
    try {
      let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Eruption', 'hand', 'p1') } as never);
      if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Forest', 'battlefield', 'p2') }] } as never);
      t = resolveStack(t, []);
      ok = names(t, 'battlefield', 'p2').length === 0 || lifeOf(t, 'p2') !== 20;
    } catch { ok = false; }
    expect(ok).toBe(false);
  });
});

describe('CR 400.3, 303.4, 608.2c: "{0}: Return enchanted creature and ~ to their owners\' hands."', () => {
  const VANISH = card('Test Vanish Aura', 'Enchantment — Aura', "Enchant creature\n{0}: Return enchanted creature and this Aura to their owners' hands.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  const game = (): GameState => {
    let victim = '';
    return mpScenario({ players: 3, defs: [VANISH, BEAR], zones: { p1: { battlefield: ['Test Vanish Aura', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } }, setup: (t) => {
      victim = find(t, 'Test Bear', 'battlefield', 'p2');
      t.objects[find(t, 'Test Vanish Aura', 'battlefield', 'p1')]!.attachedTo = victim;
    } });
  };
  it('is automated', () => expect(full(VANISH)).toBe(true));
  it('the creature goes to its owner\'s hand, the Aura to its owner\'s hand; another creature stays', () => {
    const s = game();
    const t = resolveStack(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Vanish Aura', 'battlefield', 'p1'), ability: 'p:0:1' } as never), []);
    expect(names(t, 'hand', 'p2')).toContain('Test Bear');
    expect(names(t, 'hand', 'p1')).toContain('Test Vanish Aura');
    expect(names(t, 'battlefield', 'p2')).toEqual([]);
    expect(names(t, 'battlefield', 'p1')).toEqual(['Test Bear']);
  });
});

describe('CR 122.1, 604.1, 613.4c: "As long as there is exactly one tide counter on ~, it gets -1/-1. As long as there are exactly three tide counters on ~, it gets +1/+1."', () => {
  const TIDE = card('Test Tide Beast', 'Creature — Homarid', 'As long as there is exactly one tide counter on this creature, it gets -1/-1.\nAs long as there are exactly three tide counters on this creature, it gets +1/+1.', '{0}', { power: '2', toughness: '2' });
  const withCounters = (n: number): string => {
    const s = mpScenario({ players: 3, defs: [TIDE], zones: { p1: { battlefield: [{ name: 'Test Tide Beast', counters: n === 0 ? {} : { tide: n } }] } } });
    return pt(s, find(s, 'Test Tide Beast', 'battlefield', 'p1'));
  };
  it('is automated', () => expect(full(TIDE)).toBe(true));
  it('exactly one: 1/1; exactly three: 3/3', () => { expect(withCounters(1)).toBe('1/1'); expect(withCounters(3)).toBe('3/3'); });
  it('none, two or four (negative): 2/2', () => { expect(withCounters(0)).toBe('2/2'); expect(withCounters(2)).toBe('2/2'); expect(withCounters(4)).toBe('2/2'); });
});

describe('CR 702.16, 613.1f: "Target creature loses protection from black until end of turn."', () => {
  const SNITCH = card('Test Snitch', 'Creature — Octopus', 'Sacrifice this creature: Target creature loses protection from black until end of turn.', '{0}', { power: '1', toughness: '1' });
  const WARD = card('Test Warded One', 'Creature — Knight', 'Protection from black\nProtection from red', '{0}', { power: '2', toughness: '2' });
  it('is automated', () => expect(full(SNITCH)).toBe(true));
  it('the target loses protection from black only (still protection from red) and the Snitch is sacrificed; until end of turn it is back', () => {
    const s = mpScenario({ players: 3, defs: [SNITCH, WARD], zones: { p1: { battlefield: ['Test Snitch'] }, p2: { battlefield: ['Test Warded One'] } } });
    const w = find(s, 'Test Warded One', 'battlefield', 'p2');
    expect(has(s, w, 'protection', 'color:B')).toBe(true);
    let t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Snitch', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: w }] } as never);
    t = resolveStack(t, []);
    expect(has(t, w, 'protection', 'color:B')).toBe(false);
    expect(has(t, w, 'protection', 'color:R')).toBe(true);
    expect(names(t, 'battlefield', 'p1')).toEqual([]);
  });
});

describe('CR 701.8a, 201.2, 608.2c: "Destroy target nonland permanent if another permanent with the same name is on the battlefield. Draw a card."', () => {
  const WINNOW = card('Test Winnow', 'Instant', 'Destroy target nonland permanent if another permanent with the same name is on the battlefield.\nDraw a card.', '{0}');
  const TWIN = card('Test Twin', 'Artifact', '');
  const LONE = card('Test Lone', 'Artifact', '');
  const run = (target: string, owner: 'p1' | 'p2'): GameState => {
    const s = mpScenario({ players: 3, defs: [WINNOW, TWIN, LONE], zones: { p1: { hand: ['Test Winnow'], battlefield: ['Test Twin'] }, p2: { battlefield: ['Test Twin', 'Test Lone'] } } });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Winnow', 'hand', 'p1') } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, target, 'battlefield', owner) }] } as never);
    return resolveStack(t, []);
  };
  /** The hand before the cast held the spell and the card of the turn's draw step (multiplayer: the first player draws, CR 103.8a); casting takes one, the spell draws one. */
  const HAND_AFTER = 2;
  it('is automated', () => expect(full(WINNOW)).toBe(true));
  it('with another permanent of that name the target is destroyed; you draw a card either way', () => {
    const t = run('Test Twin', 'p2');
    expect(names(t, 'battlefield', 'p2')).toEqual(['Test Lone']);
    expect(names(t, 'hand', 'p1')).toHaveLength(HAND_AFTER);
  });
  it('with no other permanent of that name (negative) nothing is destroyed, and you still draw', () => {
    const t = run('Test Lone', 'p2');
    expect(names(t, 'battlefield', 'p2').sort()).toEqual(['Test Lone', 'Test Twin']);
    expect(names(t, 'hand', 'p1')).toHaveLength(HAND_AFTER);
  });
});
