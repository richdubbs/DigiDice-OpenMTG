/**
 * Commander lane group-choices (concept round), round edh-d-63 (coordinator D): the round's readings played through the engine with synthetic cards (invented
 * names, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its
 * negative case. CR cites are from the 2026-09-25 text unless the record lists them as unverified.
 *
 *   CR 614.12a, 607.2d, 102.1, 603.2, 120.2   "As ~ enters, choose two players. Whenever damage is dealt to one of the chosen players, the other chosen player also loses that much life."
 *   CR 614.1a, 120.3, 607.2d                   "If a source controlled by one of the chosen players would deal damage to the other chosen player or a permanent that player controls, ... double ..."
 *   CR 101.4, 108.4, 611.2c            "Choose left or right. Each player gains control of all nonland permanents controlled by the next player in the chosen direction."
 *   CR 122.1, 608.2d                          "Put a charge counter on this artifact or remove one from it."
 *   CR 614.12a, 607.2d, 702.1   "As ~ enters, choose two abilities from among first strike, vigilance, and lifelink. Humans you control have each of the chosen abilities."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { cast, resolveAll } from '../cmd3/helpers';
import { toDeclareAttackers } from '../../m4/helpers';

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
const hasKw = (s: GameState, id: string, kw: string): boolean => charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === kw);

// ---------------------------------------------------------------------------------------------------------------------------------
// Greymond: choose two abilities from among a list; the Humans you control have each of them
// ---------------------------------------------------------------------------------------------------------------------------------
const GREY = card('Test Stalwart', 'Creature — Human Soldier', 'As ~ enters, choose two abilities from among first strike, vigilance, and lifelink.\nHumans you control have each of the chosen abilities.', { pt: ['2', '2'] });
const HUMAN = card('Test Villager', 'Creature — Human', '', { pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 614.12a, 607.2d, 702.1: "As ~ enters, choose two abilities from among first strike, vigilance, and lifelink. Humans you control have each of the chosen abilities."', () => {
  const play = (picks: [string, string], opp = false): GameState => {
    let s = scenario([], { defs: [GREY, HUMAN, BEAR], p1: { hand: ['Test Stalwart'], battlefield: ['Test Villager', 'Test Bear'] }, p2: { battlefield: opp ? ['Test Villager'] : [] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Stalwart', 'hand', 'p1') } as never));
    s = passBoth(s);
    for (let g = 0, n = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      if (d.kind === 'chooseOption') {
        const want = picks[n++]!;
        const opt = (d.options as { id: string }[]).find((o) => o.id === want);
        if (!opt) throw new Error(`option ${want} not offered: ${JSON.stringify(d.options)}`);
        s = answer(s, { kind: 'chooseOption', ids: [opt.id] } as never);
      } else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  it('is automated', () => expect(noManual(GREY)).toEqual([]));
  it('a list with an ability the layers do not grant (shroud) stays manual', () => {
    const odd = card('Test Odd', 'Creature — Human', 'As ~ enters, choose two abilities from among flying, shroud, and haste.\nHumans you control have each of the chosen abilities.', { pt: ['1', '1'] });
    expect(noManual(odd).length).toBeGreaterThan(0);
  });
  it('with first strike and lifelink chosen: the Human you control and Greymond itself have exactly those two; a Bear and an opponent\'s Human have neither', () => {
    const s = play(['first strike', 'lifelink'], true);
    const mine = find(s, 'Test Villager', 'battlefield', 'p1');
    const grey = find(s, 'Test Stalwart', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Villager', 'battlefield', 'p2');
    for (const id of [mine, grey]) {
      expect(hasKw(s, id, 'first strike')).toBe(true);
      expect(hasKw(s, id, 'lifelink')).toBe(true);
      expect(hasKw(s, id, 'vigilance')).toBe(false);
    }
    for (const id of [bear, theirs]) for (const k of ['first strike', 'lifelink', 'vigilance']) expect(hasKw(s, id, k)).toBe(false);
  });
  it('the second choice never offers the first one again; the other pair gives vigilance and lifelink', () => {
    const s = play(['vigilance', 'lifelink']);
    const mine = find(s, 'Test Villager', 'battlefield', 'p1');
    expect(hasKw(s, mine, 'vigilance')).toBe(true);
    expect(hasKw(s, mine, 'lifelink')).toBe(true);
    expect(hasKw(s, mine, 'first strike')).toBe(false);
  });
  it('without Greymond on the battlefield the Human has none of them', () => {
    const s = scenario([], { defs: [GREY, HUMAN], p1: { battlefield: ['Test Villager'] } });
    expect(hasKw(s, find(s, 'Test Villager', 'battlefield', 'p1'), 'lifelink')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Sower of Discord and Bitter Feud: choose two players (four-player games)
// ---------------------------------------------------------------------------------------------------------------------------------
const SOWER = card('Test Discordant', 'Creature — Demon', 'As ~ enters, choose two players.\nWhenever damage is dealt to one of the chosen players, the other chosen player also loses that much life.', { pt: ['4', '4'] });
const FEUD = card('Test Grudge', 'Enchantment', 'As ~ enters, choose two players.\nIf a source controlled by one of the chosen players would deal damage to the other chosen player or a permanent that player controls, that source deals double that damage to that player or permanent instead.');
const BURN = card('Test Burn', 'Instant', 'Test Burn deals 3 damage to any target.');
const BUDDY = card('Test Buddy', 'Creature — Bear', '', { pt: ['9', '9'] });
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
/** A four-player game with `name` on p1's battlefield having chosen `chosen`. */
const chosenGame = (name: string, chosen: [string, string]): GameState =>
  mpScenario({
    players: 4, defs: [SOWER, FEUD, BURN, BUDDY], life: 20,
    zones: { p1: { battlefield: [name], hand: ['Test Burn'] }, p2: { battlefield: ['Test Buddy'] }, p3: { battlefield: ['Test Buddy'] } },
    setup: (t) => { const id = Object.values(t.objects).find((o) => o.defId === name)!; id.links = { chosenPlayers: { players: [...chosen] } }; },
  });
const burn = (s: GameState, target: { kind: 'player'; id: string } | { kind: 'object'; id: string }): GameState => resolveAll(cast(s, 'Test Burn', { targets: [target as never] }));
const buddyOf = (s: GameState, p: string): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Buddy' && s.objects[id]!.controller === p)!;

describe('CR 603.2, 120.2, 607.2d: "Whenever damage is dealt to one of the chosen players, the other chosen player also loses that much life."', () => {
  it('is automated', () => expect(noManual(SOWER)).toEqual([]));
  it('damage to either chosen player makes the other lose that much; nobody else is touched', () => {
    const a = burn(chosenGame('Test Discordant', ['p2', 'p3']), { kind: 'player', id: 'p2' });
    expect([lifeOf(a, 'p1'), lifeOf(a, 'p2'), lifeOf(a, 'p3'), lifeOf(a, 'p4')]).toEqual([20, 17, 17, 20]);
    const b = burn(chosenGame('Test Discordant', ['p2', 'p3']), { kind: 'player', id: 'p3' });
    expect([lifeOf(b, 'p1'), lifeOf(b, 'p2'), lifeOf(b, 'p3'), lifeOf(b, 'p4')]).toEqual([20, 17, 17, 20]);
  });
  it('negative: damage to a player who was not chosen, or to a creature, does nothing more; the chosen players may include the controller', () => {
    const c = burn(chosenGame('Test Discordant', ['p2', 'p3']), { kind: 'player', id: 'p4' });
    expect([lifeOf(c, 'p1'), lifeOf(c, 'p2'), lifeOf(c, 'p3'), lifeOf(c, 'p4')]).toEqual([20, 20, 20, 17]);
    const g = chosenGame('Test Discordant', ['p2', 'p3']);
    const d = burn(g, { kind: 'object', id: buddyOf(g, 'p2') });
    expect([lifeOf(d, 'p2'), lifeOf(d, 'p3')]).toEqual([20, 20]);
    const e = burn(chosenGame('Test Discordant', ['p1', 'p4']), { kind: 'player', id: 'p4' });
    expect([lifeOf(e, 'p1'), lifeOf(e, 'p4'), lifeOf(e, 'p2')]).toEqual([17, 17, 20]);
  });
  it('casting it: the controller chooses two different players, one after the other', () => {
    let s = mpScenario({ players: 4, defs: [SOWER], zones: { p1: { hand: ['Test Discordant'] } } });
    s = cast(s, 'Test Discordant');
    const offered: string[][] = [];
    const picks = ['p3', 'p4'];
    for (let g = 0, n = 0; g < 20 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending;
      if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseOption') { offered.push((d.options as { id: string }[]).map((o) => o.id)); s = answer(s, { kind: 'chooseOption', ids: [picks[n++]!] } as never); }
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    expect(offered).toEqual([['p1', 'p2', 'p3', 'p4'], ['p1', 'p2', 'p4']]);
    const id = find(s, 'Test Discordant', 'battlefield', 'p1');
    expect(s.objects[id]!.links?.['chosenPlayers']?.players).toEqual(['p3', 'p4']);
  });
});

describe('CR 614.1a, 120.3, 607.2d: Bitter Feud, "...deal damage to the other chosen player or a permanent that player controls, ... double that damage..."', () => {
  it('is automated', () => expect(noManual(FEUD)).toEqual([]));
  it('a source of one chosen player dealing damage to the other, or to their permanent, deals double', () => {
    const a = burn(chosenGame('Test Grudge', ['p1', 'p2']), { kind: 'player', id: 'p2' });
    expect(lifeOf(a, 'p2')).toBe(14);
    const g = chosenGame('Test Grudge', ['p1', 'p2']);
    const b = burn(g, { kind: 'object', id: buddyOf(g, 'p2') });
    expect(b.objects[buddyOf(g, 'p2')]!.damage).toBe(6);
  });
  it('negative: damage to oneself, to a player or permanent of someone not chosen, or from a source of an unchosen player is not doubled', () => {
    const a = burn(chosenGame('Test Grudge', ['p1', 'p2']), { kind: 'player', id: 'p1' });
    expect(lifeOf(a, 'p1')).toBe(17);
    const b = burn(chosenGame('Test Grudge', ['p1', 'p2']), { kind: 'player', id: 'p3' });
    expect(lifeOf(b, 'p3')).toBe(17);
    const g = chosenGame('Test Grudge', ['p2', 'p3']);
    const c = burn(g, { kind: 'player', id: 'p2' }); // p1's own burn: p1 is not a chosen player
    expect(lifeOf(c, 'p2')).toBe(17);
    const d = burn(g, { kind: 'object', id: buddyOf(g, 'p3') });
    expect(d.objects[buddyOf(g, 'p3')]!.damage).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Aminatou's -6 as a sorcery: choose left or right; each player gains control of the nonland permanents of the next player in that direction
// ---------------------------------------------------------------------------------------------------------------------------------
const ROTATE = card('Test Rotation', 'Sorcery', 'Choose left or right. Each player gains control of all nonland permanents controlled by the next player in the chosen direction.');
const TROPHY = card('Test Trophy', 'Artifact', '');
const trophyOf = (s: GameState, owner: string): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Trophy' && s.objects[id]!.owner === owner)!;

describe('CR 101.4, 108.4, 611.2c: "Choose left or right. Each player gains control of all nonland permanents controlled by the next player in the chosen direction."', () => {
  it('is automated', () => expect(noManual(ROTATE)).toEqual([]));
  const play = (dir: 'left' | 'right'): GameState => {
    const zones = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((p) => [p, { battlefield: ['Test Trophy', 'Plains'] }]));
    let s = mpScenario({ players: 4, defs: [ROTATE, TROPHY], zones: { ...zones, p1: { battlefield: ['Test Trophy', 'Plains'], hand: ['Test Rotation'] } } });
    s = cast(s, 'Test Rotation');
    for (let g = 0; g < 30 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending;
      if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d.options as { id: string; label: string }[]).find((o) => o.label === dir)!.id] } as never);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  const controllers = (s: GameState): string[] => ['p1', 'p2', 'p3', 'p4'].map((o) => s.objects[trophyOf(s, o)]!.controller);
  it('left: each player gets the next player\'s permanent (all at once, never two steps); the lands stay', () => {
    const s = play('left');
    expect(controllers(s)).toEqual(['p4', 'p1', 'p2', 'p3']); // p1's Trophy went to p4 (the player before p1 takes p1's), p2's to p1, ...
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller !== s.objects[id]!.owner)).toEqual([]);
  });
  it('right: the other way round', () => {
    expect(controllers(play('right'))).toEqual(['p2', 'p3', 'p4', 'p1']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Jinxed Choker, Sigurd: put a counter on it or remove one from it
// ---------------------------------------------------------------------------------------------------------------------------------
const CHOKER = card('Test Choker', 'Artifact', '{0}: Put a charge counter on this artifact or remove one from it.');
const SAGA = card('Test Tale', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after V.)\nI -- You gain 1 life.\nII -- You gain 1 life.\nIII -- You gain 1 life.\nIV -- You gain 1 life.\nV -- You gain 1 life.');
const BOAST = card('Test Skald', 'Creature — Human', '{0}: Put a lore counter on target Saga you control or remove one from it.', { pt: ['2', '2'] });

describe('CR 122.1, 608.2d: "Put a charge counter on this artifact or remove one from it." (the controller chooses as the ability resolves)', () => {
  it('are automated', () => { expect(noManual(CHOKER)).toEqual([]); expect(noManual(BOAST)).toEqual([]); });
  const activate = (s: GameState, name: string, pick: 'put' | 'remove', targets: { kind: 'object'; id: string }[] = []): GameState => {
    let t = act(s, { type: 'activate', player: 'p1', source: find(s, name, 'battlefield', 'p1'), ability: 'p:0:0' } as never);
    for (let g = 0; g < 30 && t.pending && (t.pending.kind !== 'priority' || t.zones.stack.length > 0); g++) {
      const d = t.pending;
      if (d.kind === 'priority') t = act(t, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseOption') t = answer(t, { kind: 'chooseOption', ids: [(d.options as { id: string; label: string }[]).find((o) => o.label === pick)!.id] } as never);
      else if (d.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: targets as never });
      else if (d.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return t;
  };
  it('put adds one charge counter; remove takes one away; removing from nothing does nothing', () => {
    const s = scenario([], { defs: [CHOKER], p1: { battlefield: [{ name: 'Test Choker', counters: { charge: 2 } }] } });
    const id = find(s, 'Test Choker', 'battlefield', 'p1');
    expect(activate(s, 'Test Choker', 'put').objects[id]!.counters['charge']).toBe(3);
    expect(activate(s, 'Test Choker', 'remove').objects[id]!.counters['charge']).toBe(1);
    const empty = scenario([], { defs: [CHOKER], p1: { battlefield: ['Test Choker'] } });
    expect(activate(empty, 'Test Choker', 'remove').objects[find(empty, 'Test Choker', 'battlefield', 'p1')]!.counters['charge'] ?? 0).toBe(0);
  });
  it('a target Saga you control: the one target gets or loses the lore counter; a Saga you do not control is no legal target', () => {
    const s = scenario([], { defs: [BOAST, SAGA], p1: { battlefield: ['Test Skald', { name: 'Test Tale', counters: { lore: 1 } }] }, p2: { battlefield: [{ name: 'Test Tale', counters: { lore: 1 } }] } });
    const mine = find(s, 'Test Tale', 'battlefield', 'p1');
    const before = s.objects[mine]!.counters['lore'] ?? 0;
    expect(activate(s, 'Test Skald', 'put', [{ kind: 'object', id: mine }]).objects[mine]!.counters['lore']).toBe(before + 1);
    expect(activate(s, 'Test Skald', 'remove', [{ kind: 'object', id: mine }]).objects[mine]!.counters['lore'] ?? 0).toBe(before - 1);
    const theirs = find(s, 'Test Tale', 'battlefield', 'p2');
    const t2 = activate(s, 'Test Skald', 'put', [{ kind: 'object', id: mine }]);
    expect(t2.objects[theirs]!.counters['lore'] ?? 0).toBe(s.objects[theirs]!.counters['lore'] ?? 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Pramikon, Mystic Barrier, Teyo: each player may attack only the nearest opponent in the chosen direction and planeswalkers controlled by that opponent
// ---------------------------------------------------------------------------------------------------------------------------------
const BARRIER = card('Test Barrier', 'Enchantment', 'As ~ enters, choose left or right.\nEach player may attack only the nearest opponent in the chosen direction and planeswalkers controlled by that opponent.');
const BARRIER2 = card('Test Fence', 'Enchantment', 'When ~ enters and at the beginning of your upkeep, choose left or right.\nEach player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent.');
const TEYO = card('Test Surveyor', 'Sorcery', 'Choose left or right. Until your next turn, each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent.');
const WARRIOR = card('Test Warrior', 'Creature — Human', '', { pt: ['2', '2'] });
const WALKER = card('Test Walker', 'Planeswalker — Test', '', {});
const BATTLE_FREE = card('Test Rest', 'Enchantment', '');

describe('CR 508.1b-c, 506.2, 101.4: "Each player may attack only the nearest opponent in the chosen direction and planeswalkers controlled by that opponent."', () => {
  it('are automated', () => { for (const d of [BARRIER, BARRIER2, TEYO]) expect(noManual(d)).toEqual([]); });
  const defendersOf = (s0: GameState): string[] => {
    const s = toDeclareAttackers(s0);
    const d = s.pending as { kind: string; candidates?: { id: string; defenders: string[] }[] };
    expect(d.kind).toBe('declareAttackers');
    return [...(d.candidates!.find((c) => s.objects[c.id]!.defId === 'Test Warrior')?.defenders ?? [])].sort();
  };
  const game = (dir: 'left' | 'right', extra: { defs?: ReturnType<typeof card>[]; name?: string } = {}): GameState =>
    mpScenario({
      players: 4, defs: [BARRIER, BARRIER2, WARRIOR, WALKER, ...(extra.defs ?? [])],
      zones: { p1: { battlefield: [extra.name ?? 'Test Barrier', 'Test Warrior'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, p3: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, p4: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] } },
      setup: (t) => { const id = Object.values(t.objects).find((o) => o.defId === (extra.name ?? 'Test Barrier'))!; id.links = { direction: { values: [dir] } }; },
    });
  const walkerOf = (s: GameState, p: string): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Walker' && s.objects[id]!.controller === p)!;
  it('left: the creature may attack only the next player in turn order and that player\'s planeswalker', () => {
    const s = game('left');
    expect(defendersOf(s)).toEqual(['p2', walkerOf(s, 'p2')].sort());
  });
  it('right: the previous player in turn order and that player\'s planeswalker', () => {
    const s = game('right');
    expect(defendersOf(s)).toEqual(['p4', walkerOf(s, 'p4')].sort());
  });
  it('the last chosen direction of a trigger that chooses again works the same; without the permanent every opponent and every planeswalker may be attacked', () => {
    const s = game('left', { name: 'Test Fence' });
    expect(defendersOf(s)).toEqual(['p2', walkerOf(s, 'p2')].sort());
    const free = mpScenario({ players: 4, defs: [WARRIOR, WALKER], zones: { p1: { battlefield: ['Test Warrior'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, p3: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] } } });
    expect(defendersOf(free)).toEqual(['p2', 'p3', 'p4', walkerOf(free, 'p2'), walkerOf(free, 'p3')].sort());
  });
  it('no direction was chosen (a copy that never entered): the ability has no effect (Pramikon ruling 2019-08-23)', () => {
    const s = mpScenario({ players: 4, defs: [BARRIER, WARRIOR], zones: { p1: { battlefield: ['Test Barrier', 'Test Warrior'] } } });
    expect(defendersOf(s)).toEqual(['p2', 'p3', 'p4']);
  });
  it('a resolved "until your next turn" effect keeps the side chosen as it resolved', () => {
    let s = mpScenario({ players: 4, defs: [TEYO, WARRIOR, WALKER], zones: { p1: { hand: ['Test Surveyor'], battlefield: ['Test Warrior'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, p3: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] } } });
    s = cast(s, 'Test Surveyor');
    for (let g = 0; g < 30 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending;
      if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d.options as { id: string; label: string }[]).find((o) => o.label === 'right')!.id] } as never);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    expect(defendersOf(s)).toEqual(['p4']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Order of Succession: each player, beginning with you and going on in the chosen direction, chooses a creature of the next player; all change control at once
// ---------------------------------------------------------------------------------------------------------------------------------
const ORDER = card('Test Succession', 'Sorcery', 'Choose left or right. Starting with you and proceeding in the chosen direction, each player chooses a creature controlled by the next player in that direction. Each player gains control of the creature they chose.');
const PAWN = card('Test Pawn', 'Creature — Human', '', { pt: ['1', '1'] });

describe('CR 101.4, 608.2c, 611.2c: Order of Succession, "Starting with you and proceeding in the chosen direction, each player chooses a creature controlled by the next player in that direction."', () => {
  it('is automated', () => expect(noManual(ORDER)).toEqual([]));
  const play = (dir: 'left' | 'right'): { s: GameState; choosers: string[] } => {
    const zones = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((p) => [p, { battlefield: ['Test Pawn', 'Test Pawn'] }]));
    let s = mpScenario({ players: 4, defs: [ORDER, PAWN], zones: { ...zones, p1: { battlefield: ['Test Pawn', 'Test Pawn'], hand: ['Test Succession'] } } });
    const choosers: string[] = [];
    s = cast(s, 'Test Succession');
    for (let g = 0; g < 40 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); g++) {
      const d = s.pending;
      if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d.options as { id: string; label: string }[]).find((o) => o.label === dir)!.id] } as never);
      else if (d.kind === 'chooseObjects') { choosers.push(d.player); const o = d as unknown as { options: string[]; min: number }; s = answer(s, { kind: 'chooseObjects', ids: o.options.slice(0, o.min) }); }
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return { s, choosers };
  };
  const pawnsControlledBy = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Pawn' && s.objects[id]!.controller === p).length;
  it('left: the players choose in turn order beginning with you; every player ends up with their own two minus the one chosen from them, plus the one they chose', () => {
    const { s, choosers } = play('left');
    expect(choosers).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => pawnsControlledBy(s, p))).toEqual([2, 2, 2, 2]);
    const swapped = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Pawn' && s.objects[id]!.controller !== s.objects[id]!.owner);
    expect(swapped.length).toBe(4); // one creature from each player went to the player before them in turn order
    const map = swapped.map((id) => `${s.objects[id]!.owner}>${s.objects[id]!.controller}`).sort();
    expect(map).toEqual(['p1>p4', 'p2>p1', 'p3>p2', 'p4>p3']);
  });
  it('right: you first, then the previous player, and so on; the creatures go the other way', () => {
    const { s, choosers } = play('right');
    expect(choosers).toEqual(['p1', 'p4', 'p3', 'p2']);
    const swapped = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Pawn' && s.objects[id]!.controller !== s.objects[id]!.owner);
    expect(swapped.map((id) => `${s.objects[id]!.owner}>${s.objects[id]!.controller}`).sort()).toEqual(['p1>p2', 'p2>p3', 'p3>p4', 'p4>p1']);
  });
});
