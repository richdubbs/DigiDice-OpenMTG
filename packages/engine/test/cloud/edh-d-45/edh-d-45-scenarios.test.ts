/**
 * Commander lane cost, third pass, round edh-d-45 (coordinator D): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites are
 * from the 2026-09-25 text unless the record lists them as unverified.
 *
 *   CR 602.2b, 601.2f, 118.7   "This ability costs {1} less to activate for each creature with power 4 or greater your opponents control." / "... if it targets two creatures you control."
 *   CR 601.2b, 601.2f, 701.21a "... you may sacrifice any number of artifacts and/or creatures. ~ costs {2} less ... and {2} less to cast for each other ... you've sacrificed this turn."
 *   CR 601.2b, 601.2f, 122.1   "... you may remove any number of +1/+1 counters from among creatures you control. ~ costs {2} less to cast for each counter removed this way."
 *   CR 702.34a, 601.2f         "Flashback costs you pay cost {2} less." / "Flashback costs your opponents pay cost {2} more."
 *   CR 506.1, 508.1, 601.2f    "~ costs {2} less to cast if a player attacked you during their last turn."
 *   CR 105.1, 614.12a, 601.2f  "As ~ enters, choose two colors. Each spell you cast costs {1} less to cast for each of the chosen colors it is."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, passBoth, scenario } from '../../m3/scenario';

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
const can = (s: GameState, name: string): boolean => {
  const id = find(s, name, 'hand', 'p1');
  return legal(s, 'p1', 'cast').some((a) => a.object === id);
};
const canActivate = (s: GameState, name: string): boolean => {
  const id = find(s, name, 'battlefield', 'p1');
  return legal(s, 'p1', 'activate').some((a) => a.object === id && !a.isMana);
};
/** Cast `name`, answering a "how many" decision with `n` and a payment automatically; returns the state after the spell is on the stack and paid. */
const castWith = (s0: GameState, name: string, n?: number): GameState => {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never));
  for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) {
    const d = s.pending;
    if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: n ?? 0 });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, Math.max(d.min, 1)) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Grim Giganotosaurus: "This ability costs {1} less to activate for each creature with power 4 or greater your opponents control."
// ---------------------------------------------------------------------------------------------------------------------------------
const GIGA = card('Test Monster', 'Creature — Dinosaur', '{2}: Put a +1/+1 counter on ~. This ability costs {1} less to activate for each creature with power 4 or greater your opponents control.', { pt: ['2', '2'] });
const BIG = card('Test Big Beast', 'Creature — Beast', '', { pt: ['4', '4'] });
const SMALL = card('Test Small Beast', 'Creature — Beast', '', { pt: ['3', '3'] });

describe('CR 602.2b, 601.2f: "This ability costs {1} less to activate for each creature with power 4 or greater your opponents control."', () => {
  const board = (opp: string[], own: string[] = []): GameState => scenario([], { defs: [GIGA, BIG, SMALL], p1: { battlefield: ['Test Monster', ...own] }, p2: { battlefield: opp } });
  it('is automated', () => expect(noManual(GIGA)).toEqual([]));
  it('two creatures with power 4 or greater make the {2} ability free; one makes it cost {1} (not payable with no land); power 3 and your own creatures count for nothing', () => {
    expect(canActivate(board(['Test Big Beast', 'Test Big Beast']), 'Test Monster')).toBe(true);
    expect(canActivate(board(['Test Big Beast']), 'Test Monster')).toBe(false);
    expect(canActivate(board(['Test Small Beast', 'Test Small Beast']), 'Test Monster')).toBe(false);
    expect(canActivate(board([], ['Test Big Beast', 'Test Big Beast']), 'Test Monster')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Wayta: "This ability costs {2} less to activate if it targets two creatures you control."
// ---------------------------------------------------------------------------------------------------------------------------------
const WAYTA = card('Test Trainer', 'Creature — Human', '{2}, {T}: Target creature you control fights another target creature. This ability costs {2} less to activate if it targets two creatures you control.', { pt: ['1', '1'] });
const PAL = card('Test Pal', 'Creature — Cat', '', { pt: ['1', '1'] });
const FOE = card('Test Foe', 'Creature — Cat', '', { pt: ['1', '1'] });

describe('CR 601.2c, 602.2b, 601.2f: "This ability costs {2} less to activate if it targets two creatures you control."', () => {
  const board = (): GameState => scenario([], { defs: [WAYTA, PAL, FOE], p1: { battlefield: ['Test Trainer', 'Test Pal'] }, p2: { battlefield: ['Test Foe'] } });
  const activate = (s: GameState, second: 'mine' | 'theirs'): GameState => {
    const t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Trainer', 'battlefield'), ability: 'p:0:0' } as never);
    const first = find(t, 'Test Pal', 'battlefield', 'p1');
    const other = second === 'mine' ? find(t, 'Test Trainer', 'battlefield', 'p1') : find(t, 'Test Foe', 'battlefield', 'p2');
    const one = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object' as const, id: first }] } as never);
    return answer(one, { kind: 'chooseTargets', targets: [{ kind: 'object' as const, id: other }] } as never);
  };
  it('is automated', () => expect(noManual(WAYTA)).toEqual([]));
  it('two creatures you control: {2} less, so the activation needs no mana ({T} only); one of them an opponent\'s: the full {2} is due and, with no land, it fails', () => {
    const free = activate(board(), 'mine');
    expect(free.pending?.kind).toBe('priority'); // on the stack with nothing left to pay: the {2} is gone and {T} is the Trainer's
    expect(free.zones.stack.length).toBe(1);
    const costly = activate(board(), 'theirs');
    expect(costly.pending?.kind).toBe('payCost'); // one target is an opponent's creature: the full {2} is still due
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Dargo: sacrifice any number, {2} less for each, and {2} less for each other artifact or creature sacrificed earlier this turn
// ---------------------------------------------------------------------------------------------------------------------------------
const DARGO = card('Test Shipwrecker', 'Legendary Creature — Giant Pirate', 'As an additional cost to cast ~, you may sacrifice any number of artifacts and/or creatures. ~ costs {2} less to cast for each permanent sacrificed this way and {2} less to cast for each other artifact or creature you\'ve sacrificed this turn.', { pt: ['6', '6'], cost: '{6}' });
const FODDER = card('Test Fodder', 'Creature — Rat', '', { pt: ['1', '1'] });
const ALTAR = card('Test Altar', 'Enchantment', 'Sacrifice a creature: You gain 1 life.');

describe('CR 601.2b, 601.2f, 701.21a: Dargo, the Shipwrecker', () => {
  const board = (fodder: number): GameState => scenario([], { defs: [DARGO, FODDER, ALTAR], p1: { hand: ['Test Shipwrecker'], battlefield: Array.from({ length: fodder }, () => 'Test Fodder') } });
  it('is automated', () => expect(noManual(DARGO)).toEqual([]));
  it('{2} less for each permanent that could be sacrificed: three creatures make the {6} spell free, two leave {2}, none leaves {6}', () => {
    expect(can(board(3), 'Test Shipwrecker')).toBe(true);
    expect(can(board(2), 'Test Shipwrecker')).toBe(false);
    expect(can(board(0), 'Test Shipwrecker')).toBe(false);
  });
  it('announcing 3 sacrifices exactly three creatures; the fourth stays', () => {
    const s = castWith(board(4), 'Test Shipwrecker', 3);
    expect(findAll(s, 'Test Fodder', 'battlefield', 'p1').length).toBe(1);
    expect(s.zones.stack.length).toBe(1);
  });
  it('the permanents sacrificed earlier this turn count too ("other" than the ones sacrificed for this cost): after three earlier sacrifices (none left to sacrifice now) it is free; after two it is not', () => {
    const sacrifice = (s0: GameState, times: number): GameState => {
      let s = s0;
      for (let i = 0; i < times; i++) {
        s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Altar', 'battlefield'), ability: 'p:0:0' } as never);
        for (let g = 0; g < 6 && s.pending && s.pending.kind !== 'priority'; g++) {
          const d = s.pending;
          if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, Math.max(d.min, 1)) });
          else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
          else throw new Error(`unexpected decision ${d.kind}`);
        }
        for (let g = 0; g < 6 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = pass(s);
      }
      return s;
    };
    const start = (n: number): GameState => scenario([], { defs: [DARGO, FODDER, ALTAR], p1: { hand: ['Test Shipwrecker'], battlefield: ['Test Altar', ...Array.from({ length: n }, () => 'Test Fodder')] } });
    expect(can(sacrifice(start(3), 3), 'Test Shipwrecker')).toBe(true);
    expect(can(sacrifice(start(2), 2), 'Test Shipwrecker')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Hierophant Bio-Titan: remove any number of +1/+1 counters from among creatures you control
// ---------------------------------------------------------------------------------------------------------------------------------
const TITAN = card('Test Bio Titan', 'Creature — Tyranid', 'As an additional cost to cast ~, you may remove any number of +1/+1 counters from among creatures you control. ~ costs {2} less to cast for each counter removed this way.', { pt: ['5', '5'], cost: '{4}' });
const HOST = card('Test Host', 'Creature — Cat', '', { pt: ['1', '1'] });

describe('CR 601.2b, 601.2f, 122.1: "you may remove any number of +1/+1 counters from among creatures you control. ~ costs {2} less to cast for each counter removed this way."', () => {
  const board = (counters: number): GameState => scenario([], { defs: [TITAN, HOST], p1: { hand: ['Test Bio Titan'], battlefield: [{ name: 'Test Host', counters: { '+1/+1': counters } }] } });
  it('is automated', () => expect(noManual(TITAN)).toEqual([]));
  it('two counters make the {4} spell free; one counter leaves {2} (uncastable with no land); no counters leave {4}', () => {
    expect(can(board(2), 'Test Bio Titan')).toBe(true);
    expect(can(board(1), 'Test Bio Titan')).toBe(false);
    expect(can(board(0), 'Test Bio Titan')).toBe(false);
  });
  it('announcing 2 removes exactly two counters; the creature keeps the rest', () => {
    const s = castWith(board(3), 'Test Bio Titan', 2);
    const host = find(s, 'Test Host', 'battlefield', 'p1');
    expect(s.objects[host]!.counters['+1/+1'] ?? 0).toBe(1);
    expect(s.zones.stack.length).toBe(1);
  });
  it('negative: announcing 0 pays nothing and removes nothing (the spell costs {4})', () => {
    const s = board(3);
    expect(can(s, 'Test Bio Titan')).toBe(true); // three counters could pay for it
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Catalyst Stone: flashback costs
// ---------------------------------------------------------------------------------------------------------------------------------
const STONE = card('Test Stone', 'Artifact', 'Flashback costs you pay cost {2} less.\nFlashback costs your opponents pay cost {2} more.');
const REPLAY = card('Test Replay', 'Sorcery', 'You gain 1 life.\nFlashback {2}', { cost: '{5}' });

describe('CR 702.34a, 601.2f, 118.7: "Flashback costs you pay cost {2} less." / "Flashback costs your opponents pay cost {2} more."', () => {
  const board = (stone: boolean, owner: 'p1' | 'p2' = 'p1'): GameState => scenario([], {
    defs: [STONE, REPLAY],
    p1: { battlefield: stone ? ['Test Stone'] : [], graveyard: owner === 'p1' ? ['Test Replay'] : [] },
    p2: { graveyard: owner === 'p2' ? ['Test Replay'] : [] },
  });
  const flashable = (s: GameState, player: 'p1' | 'p2'): boolean => legal(s, player, 'cast').some((a) => (a as { object?: string }).object === find(s, 'Test Replay', 'graveyard', player));
  it('is automated', () => expect(noManual(STONE)).toEqual([]));
  it('with the Stone your Flashback {2} is free (castable with no land); without it, it is not', () => {
    expect(flashable(board(true), 'p1')).toBe(true);
    expect(flashable(board(false), 'p1')).toBe(false);
  });
  it('your opponent\'s Flashback {2} costs {2} more under the Stone: two lands cannot pay {4}; without the Stone they pay {2}', () => {
    const lands = { graveyard: ['Test Replay'], battlefield: ['Test Isle', 'Test Isle'] };
    expect(flashable(scenario([], { defs: [STONE, REPLAY, ISLE], p1: lands, p2: { battlefield: ['Test Stone'] } }), 'p1')).toBe(false);
    expect(flashable(scenario([], { defs: [STONE, REPLAY, ISLE], p1: lands }), 'p1')).toBe(true);
  });
  it('negative: the Stone does not make the card cheaper to cast from your hand (its mana cost {5} is untouched)', () => {
    const s = scenario([], { defs: [STONE, REPLAY], p1: { battlefield: ['Test Stone'], hand: ['Test Replay'] } });
    expect(can(s, 'Test Replay')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Avenge: costs {2} less if a player attacked you during their last turn
// ---------------------------------------------------------------------------------------------------------------------------------
const AVENGE = card('Test Avenge', 'Sorcery', 'This spell costs {2} less to cast if a player attacked you during their last turn.\nYou gain 1 life.', { cost: '{2}' });

describe('CR 506.1, 508.1, 601.2f: "This spell costs {2} less to cast if a player attacked you during their last turn."', () => {
  const withHistory = (attacked: boolean, victim: 'p1' | 'p2' = 'p1'): GameState => {
    const s = structuredClone(scenario([], { defs: [AVENGE], p1: { hand: ['Test Avenge'] } })) as GameState;
    s.turn.number = 3;
    s.history.push({ turn: 2, combat: 0, ev: 'beginTurn', actor: 'p2', facts: {} } as never);
    if (attacked) s.history.push({ turn: 2, combat: 1, ev: 'attacks', actor: 'p2', facts: { defenderKind: 'player', defendingPlayer: victim } } as never);
    return s;
  };
  it('a player attacked you on their last turn: free; they did not attack: {2}; they attacked someone else: {2}', () => {
    expect(can(withHistory(true), 'Test Avenge')).toBe(true);
    expect(can(withHistory(false), 'Test Avenge')).toBe(false);
    expect(can(withHistory(true, 'p2'), 'Test Avenge')).toBe(false);
  });
  it('the attack must be on their own last turn: an attack on an earlier turn than their latest one does not count', () => {
    const s = withHistory(true);
    s.history.push({ turn: 2, combat: 0, ev: 'beginTurn', actor: 'p2', facts: {} } as never);
    // a later turn of p2 (turn 4 is not before turn 3), so turn 2 is still their last turn before this one
    expect(can(s, 'Test Avenge')).toBe(true);
    s.history.push({ turn: 2, combat: 0, ev: 'beginTurn', actor: 'p2', facts: {} } as never);
    s.turn.number = 5;
    s.history.push({ turn: 4, combat: 0, ev: 'beginTurn', actor: 'p2', facts: {} } as never);
    expect(can(s, 'Test Avenge')).toBe(false); // on turn 4 p2 attacked nobody
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Seal of the Guildpact: choose two colors; spells cost {1} less for each chosen color they are
// ---------------------------------------------------------------------------------------------------------------------------------
const SEAL = card('Test Seal', 'Artifact', 'As ~ enters, choose two colors.\nEach spell you cast costs {1} less to cast for each of the chosen colors it is.', { cost: '{0}' });
const RG = card('Test Gruul Spell', 'Sorcery', 'You gain 1 life.', { cost: '{2}', colors: ['R', 'G'] });
const RED = card('Test Red Spell', 'Sorcery', 'You gain 1 life.', { cost: '{2}', colors: ['R'] });
const BLUE = card('Test Blue Spell', 'Sorcery', 'You gain 1 life.', { cost: '{2}', colors: ['U'] });

describe('CR 105.1, 614.12a, 601.2f: Seal of the Guildpact, "As ~ enters, choose two colors. Each spell you cast costs {1} less to cast for each of the chosen colors it is."', () => {
  it('is automated', () => expect(noManual(SEAL)).toEqual([]));
  it('with red and green chosen: a red-green spell costs {2} less (free), a red spell {1} less (not free), a blue spell nothing less', () => {
    let s = scenario([], { defs: [SEAL, RG, RED, BLUE], p1: { hand: ['Test Seal', 'Test Gruul Spell', 'Test Red Spell', 'Test Blue Spell'] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Seal', 'hand', 'p1') } as never));
    s = passBoth(s);
    for (let g = 0, n = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      if (d.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (n++ === 0 ? 'R' : 'G') as never });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    const seal = find(s, 'Test Seal', 'battlefield', 'p1');
    const chosen = JSON.stringify(s.objects[seal]!.links ?? {});
    expect(chosen).toContain('R');
    expect(chosen).toContain('G');
    expect(can(s, 'Test Gruul Spell')).toBe(true);
    expect(can(s, 'Test Red Spell')).toBe(false);
    expect(can(s, 'Test Blue Spell')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Wayta: "If a creature you control being dealt damage causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time."
// ---------------------------------------------------------------------------------------------------------------------------------
const DOUBLER = card('Test Painmaster', 'Creature — Human', 'If a creature you control being dealt damage causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', { pt: ['1', '5'] });
const SIPHON = card('Test Siphon', 'Enchantment', 'Whenever a creature you control is dealt damage, you gain 1 life.');
const WITNESS = card('Test Witness', 'Enchantment', 'Whenever a creature is dealt damage, you gain 1 life.');
const PING = card('Test Ping', 'Instant', 'Test Ping deals 1 damage to target creature.');

describe('CR 603.2d, 120.1: a creature you control being dealt damage makes the triggered abilities it causes trigger an additional time', () => {
  const lifeAfter = (doubler: boolean, victim: 'p1' | 'p2', ability: string): number => {
    let s = scenario([], {
      defs: [DOUBLER, SIPHON, WITNESS, PING, PAL],
      p1: { hand: ['Test Ping'], battlefield: [...(doubler ? ['Test Painmaster'] : []), ability, 'Test Pal'] },
      p2: { battlefield: ['Test Pal'] },
    });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ping', 'hand', 'p1') } as never));
    const target = find(s, 'Test Pal', 'battlefield', victim);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object' as const, id: target }] } as never);
    for (let g = 0; g < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending;
      if (d === null) break;
      if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s.players.find((p) => p.id === 'p1')!.life;
  };
  const base = lifeAfter(false, 'p1', 'Test Siphon');
  it('is automated', () => expect(noManual(DOUBLER)).toEqual([]));
  it('your creature is dealt damage: the trigger it causes happens twice (one more life than without the doubler)', () => {
    expect(lifeAfter(true, 'p1', 'Test Siphon')).toBe(base + 1);
  });
  it('negative: damage to an opponent\'s creature causes a trigger of a "creature is dealt damage" ability only once', () => {
    expect(lifeAfter(true, 'p2', 'Test Witness')).toBe(lifeAfter(false, 'p2', 'Test Witness'));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Draco: "At the beginning of your upkeep, sacrifice ~ unless you pay {4}. This cost is reduced by {2} for each basic land type among lands you control."
// ---------------------------------------------------------------------------------------------------------------------------------
const DRACO = card('Test Hoard Dragon', 'Creature — Dragon', 'At the beginning of your upkeep, sacrifice ~ unless you pay {4}. This cost is reduced by {2} for each basic land type among lands you control.', { pt: ['9', '9'] });
const ISLE = card('Test Isle', 'Land — Island', '');
const MEADOW = card('Test Meadow', 'Land — Plains', '');
const MEADOW2 = card('Test Other Meadow', 'Land — Plains', '');

describe('CR 118.12, 118.7a: "sacrifice ~ unless you pay {4}. This cost is reduced by {2} for each basic land type among lands you control."', () => {
  const upkeep = (lands: string[]): GameState => {
    let s = advanceTo(scenario([], { defs: [DRACO, ISLE, MEADOW, MEADOW2], p1: { battlefield: ['Test Hoard Dragon', ...lands] } }), 3, 'upkeep');
    for (let g = 0; g < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
      const d = s.pending;
      if (d === null) break;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  it('is automated', () => expect(noManual(DRACO)).toEqual([]));
  it('two basic land types make the cost {0}: the Dragon stays; one type leaves {2} which is asked for (and not payable with no mana): it is sacrificed; no land: {4}, sacrificed', () => {
    const stays = upkeep(['Test Isle', 'Test Meadow', 'Test Other Meadow']);
    expect(findAll(stays, 'Test Hoard Dragon', 'battlefield', 'p1').length).toBe(1);
    const goes = upkeep(['Test Meadow']);
    expect(findAll(goes, 'Test Hoard Dragon', 'battlefield', 'p1').length).toBe(0); // {2} due, one Plains: it cannot be paid
    const pays = upkeep(['Test Meadow', 'Test Other Meadow']);
    expect(findAll(pays, 'Test Hoard Dragon', 'battlefield', 'p1').length).toBe(1); // {2} due and paid with the two Plains (one type: {4} less {2})
    expect(pays.objects[find(pays, 'Test Meadow', 'battlefield', 'p1')]!.tapped).toBe(true);
    expect(stays.objects[find(stays, 'Test Isle', 'battlefield', 'p1')]!.tapped).toBe(false); // two types: nothing due, no land tapped
    const bare = upkeep([]);
    expect(findAll(bare, 'Test Hoard Dragon', 'battlefield', 'p1').length).toBe(0);
  });
});
