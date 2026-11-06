/**
 * Commander lane edh-b, round edh-b-5 (EDHREC ranks 8,001-9,000, second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 615.1, 615.5, 122.1        "If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from ~."
 *   CR 119.3, 120.3a, 608.2h      "You gain life equal to the total life lost by all players this turn."
 *   CR 701.17a, 608.2h            "Target player mills a card for each Locus you control."
 *   CR 701.9a, 121.1              "That player discards a card, then draws a card."; "Discard all the cards in your hand, then draw that many cards plus one."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { attackWith, card, full, counters, resolveAll as settleAll, settle } from '../cmd3/helpers';
import { runCombat } from '../../m4/helpers';
import { card as mcard, commanderOnBattlefield, commanderScenario, legend } from '../../m11/rules/helpers';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const gySize = (s: GameState, p: string): number => s.zones.graveyard[p]!.length;
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const plr = (id: string) => ({ kind: 'player' as const, id });

describe('CR 615.1, 615.5, 122.1: "If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from ~."', () => {
  const HIDE = card('Test Thornhide', 'Creature — Elemental', 'If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from ~.', ['2', '2']);
  const BOLT = card('Test Spark', 'Instant', '~ deals 3 damage to target creature.');
  const defs = [HIDE, BOLT];
  const start = (cn: number): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Spark'], battlefield: [{ name: 'Test Thornhide', ...(cn > 0 ? { counters: { '+1/+1': cn } } : {}) } as never] } } });
  const burn = (s0: GameState): GameState => {
    const hide = onBf(s0, 'p1', 'Test Thornhide')[0]!;
    const s = answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [obj(hide)] });
    return settleAll(s);
  };
  it('is automated', () => expect(full(HIDE)).toBe(true));
  it('CR 615.5: with a +1/+1 counter, the damage is prevented and one counter is removed', () => {
    const s0 = start(2);
    const hide = onBf(s0, 'p1', 'Test Thornhide')[0]!;
    const s = burn(s0);
    expect(s.objects[hide]!.zone).toBe('battlefield');
    expect(s.objects[hide]!.damage).toBe(0);
    expect(counters(s, hide, '+1/+1')).toBe(1);
  });
  it('negative: with no +1/+1 counter the damage is dealt (a 2/2 dies to 3 damage)', () => {
    const s0 = start(0);
    const hide = onBf(s0, 'p1', 'Test Thornhide')[0]!;
    const s = burn(s0);
    expect(s.zones.battlefield.includes(hide)).toBe(false);
  });
  it('negative: a counter of another kind does not switch the prevention on', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Spark'], battlefield: [{ name: 'Test Thornhide', counters: { charge: 2 } } as never] } } });
    const hide = onBf(s0, 'p1', 'Test Thornhide')[0]!;
    const s = burn(s0);
    expect(s.zones.battlefield.includes(hide)).toBe(false);
  });
});

describe('CR 615.5, 122.1 (Undergrowth Champion rulings 2015-08-25): damage from several sources at once is prevented by one application', () => {
  const HIDE = card('Test Thornhide', 'Creature — Elemental', 'If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from ~.', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('two blockers dealing damage together cost one counter, and the creature survives', () => {
    const s0 = mpScenario({ defs: [HIDE, BEAR], zones: { p1: { battlefield: [{ name: 'Test Thornhide', counters: { '+1/+1': 2 } } as never] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } } });
    const hide = onBf(s0, 'p1', 'Test Thornhide')[0]!;
    const [b1, b2] = onBf(s0, 'p2', 'Test Bear') as [ObjectId, ObjectId];
    const s = runCombat(s0, { attack: [[hide, 'p2']], block: [[b1, hide], [b2, hide]], assign: { [hide]: (d) => d.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? 4 : 0 })) } });
    expect(s.zones.battlefield.includes(hide)).toBe(true);
    expect(counters(s, hide, '+1/+1')).toBe(1);
    expect(s.objects[hide]!.damage).toBe(0);
  });
  it('negative: "remove that many counters" reads the amount of each application (two blockers dealing 2 and 3 remove 5)', () => {
    const CONJ = card('Test Warded Husk', 'Creature — Construct', 'If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage and remove that many +1/+1 counters from ~.', ['0', '0']);
    const BIG = card('Test Big Bear', 'Creature — Bear', '', ['3', '3']);
    const s0 = mpScenario({ defs: [CONJ, BEAR, BIG], zones: { p1: { battlefield: [{ name: 'Test Warded Husk', counters: { '+1/+1': 10 } } as never] }, p2: { battlefield: ['Test Bear', 'Test Big Bear'] } } });
    const husk = onBf(s0, 'p1', 'Test Warded Husk')[0]!;
    const blockers = [onBf(s0, 'p2', 'Test Bear')[0]!, onBf(s0, 'p2', 'Test Big Bear')[0]!];
    const s = runCombat(s0, { attack: [[husk, 'p2']], block: [[blockers[0]!, husk], [blockers[1]!, husk]], assign: { [husk]: (d) => d.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? 10 : 0 })) } });
    expect(counters(s, husk, '+1/+1')).toBe(5);
  });
  it('negative: damage from two separate spells is two applications (two counters removed)', () => {
    const BOLT = card('Test Spark', 'Instant', '~ deals 1 damage to target creature.');
    const s0 = mpScenario({ defs: [HIDE, BOLT], zones: { p1: { hand: ['Test Spark', 'Test Spark'], battlefield: [{ name: 'Test Thornhide', counters: { '+1/+1': 2 } } as never] } } });
    const hide = onBf(s0, 'p1', 'Test Thornhide')[0]!;
    let s = s0;
    for (let i = 0; i < 2; i++) {
      s = answer(act(s, { type: 'cast', player: 'p1', card: s.zones.hand['p1']!.find((id) => s.objects[id]!.defId === 'Test Spark')! }), { kind: 'chooseTargets', targets: [obj(hide)] });
      s = settleAll(s);
    }
    expect(counters(s, hide, '+1/+1')).toBe(0);
    expect(s.zones.battlefield.includes(hide)).toBe(true);
  });
});

describe('CR 119.3, 120.3a, 608.2h: "You gain life equal to the total life lost by all players this turn."', () => {
  const SIGIL = card('Test Grim Sigil', 'Artifact', '{T}, Sacrifice ~: You gain life equal to the total life lost by all players this turn.');
  const DRAIN = card('Test Drain Rite', 'Sorcery', 'Each opponent loses 2 life.');
  const defs = [SIGIL, DRAIN];
  it('is automated', () => expect(full(SIGIL)).toBe(true));
  it('adds up the life lost by every player this turn, the controller included', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Drain Rite'], battlefield: ['Test Grim Sigil'] } } });
    let s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Drain Rite', 'hand', 'p1') }));
    // three opponents lose 2 each (6); the controller also lost life this turn (3), and the gain comes after
    s.players.find((p) => p.id === 'p1')!.turnStats.lifeLost = 3;
    const before = life(s, 'p1');
    const sigil = onBf(s, 'p1', 'Test Grim Sigil')[0]!;
    s = settleAll(act(s, { type: 'activate', player: 'p1', source: sigil, ability: 'p:0:0' } as never));
    expect(life(s, 'p1')).toBe(before + 9);
    expect(s.zones.battlefield.includes(sigil)).toBe(false);
  });
  it('negative: with no life lost this turn nothing is gained', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Grim Sigil'] } } });
    const sigil = onBf(s0, 'p1', 'Test Grim Sigil')[0]!;
    const s = settleAll(act(s0, { type: 'activate', player: 'p1', source: sigil, ability: 'p:0:0' } as never));
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

describe('CR 701.17a, 608.2h: "Target player mills a card for each Locus you control."', () => {
  const POST = card('Test Mire Post', 'Land — Locus', '{3}, {T}: Target player mills a card for each Locus you control.');
  const defs = [POST];
  it('is automated', () => expect(full(POST)).toBe(true));
  it('mills one card for each Locus the controller has', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Mire Post', 'Test Mire Post', { name: 'Plains' }, { name: 'Plains' }, { name: 'Plains' }] } } });
    const post = onBf(s0, 'p1', 'Test Mire Post')[0]!;
    const before = gySize(s0, 'p2');
    let s = act(s0, { type: 'activate', player: 'p1', source: post, ability: 'p:0:0' } as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [plr('p2')] });
    s = settleAll(s);
    expect(gySize(s, 'p2')).toBe(before + 2);
  });
  it('negative: Loci an opponent controls are not counted', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Mire Post', { name: 'Plains' }, { name: 'Plains' }, { name: 'Plains' }] }, p3: { battlefield: ['Test Mire Post', 'Test Mire Post'] } } });
    const post = onBf(s0, 'p1', 'Test Mire Post')[0]!;
    const before = gySize(s0, 'p2');
    let s = act(s0, { type: 'activate', player: 'p1', source: post, ability: 'p:0:0' } as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [plr('p2')] });
    s = settleAll(s);
    expect(gySize(s, 'p2')).toBe(before + 1);
  });
});

describe('CR 701.9a, 121.1: "Discard all the cards in your hand, then draw that many cards plus one."', () => {
  const RENEW = card('Test Renewal Rite', 'Sorcery', 'Discard all the cards in your hand, then draw that many cards plus one.');
  const FILL = card('Test Filler', 'Artifact', '');
  const defs = [RENEW, FILL];
  it('is automated', () => expect(full(RENEW)).toBe(true));
  it('discards the whole hand and draws one more than it held', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Renewal Rite', 'Test Filler', 'Test Filler', 'Test Filler'] } } });
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Renewal Rite', 'hand', 'p1') }));
    const held = handSize(s0, 'p1') - 1; // the Rite is on the stack; the opening draw left a Plains in hand too
    expect(handSize(s, 'p1')).toBe(held + 1);
    expect(gySize(s, 'p1')).toBe(held + 1); // the Rite and everything that was in hand
  });
  it('negative: the draw is exactly one more than the cards discarded, not two more', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Renewal Rite'] } } });
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Renewal Rite', 'hand', 'p1') }));
    const held = handSize(s0, 'p1') - 1;
    expect(handSize(s, 'p1')).toBe(held + 1);
  });
});

describe('CR 701.9a, 121.1: "That player discards a card, then draws a card." (Memory Worm\'s second sentence)', () => {
  const ECHO = card('Test Memory Rite', 'Sorcery', 'Target player discards a card, then draws a card.');
  const FILL = card('Test Filler', 'Artifact', '');
  const defs = [ECHO, FILL];
  const run = (zones2: string[]): { s0: GameState; s: GameState } => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Memory Rite'] }, p2: { hand: zones2 } } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Memory Rite', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [plr('p2')] });
    return { s0, s: settleAll(s) };
  };
  it('is automated', () => expect(full(ECHO)).toBe(true));
  it('the target discards a card, then draws one: the hand size is the same and the discarded card is in the graveyard', () => {
    const { s0, s } = run(['Test Filler']);
    expect(handSize(s, 'p2')).toBe(handSize(s0, 'p2'));
    expect(s.zones.graveyard['p2']!.some((id) => s.objects[id]!.defId === 'Test Filler')).toBe(true);
  });
  it('negative: a player with an empty hand discards nothing but still draws', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Memory Rite'] } } });
    for (const id of [...s0.zones.hand['p2']!]) { delete s0.objects[id]; }
    s0.zones.hand['p2'] = [];
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Memory Rite', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [plr('p2')] });
    s = settleAll(s);
    expect(handSize(s, 'p2')).toBe(1);
    expect(gySize(s, 'p2')).toBe(0);
  });
});

describe('CR 601.2, 602.2, 603.2: "Whenever you cast a spell from your graveyard or activate an ability of a card in your graveyard, ..."', () => {
  const DIVER = card('Test Tide Diver', 'Creature — Merfolk', 'Whenever you cast a spell from your graveyard or activate an ability of a card in your graveyard, draw a card and put a +1/+1 counter on ~.', ['1', '1']);
  const ECHO = card('Test Echo Rite', 'Sorcery', 'You gain 1 life.\nFlashback {0}');
  const REVENANT = card('Test Grave Walker', 'Creature — Zombie', '{0}, Exile this card from your graveyard: You gain 1 life.', ['2', '2']);
  const defs = [DIVER, ECHO, REVENANT];
  it('is automated', () => expect(full(DIVER)).toBe(true));
  it('CR 601.2: casting a spell from the graveyard (flashback) draws a card and adds a +1/+1 counter', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Tide Diver'], graveyard: ['Test Echo Rite'] } } });
    const diver = onBf(s0, 'p1', 'Test Tide Diver')[0]!;
    const h = handSize(s0, 'p1');
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Rite', 'graveyard', 'p1'), method: 'flashback' } as never));
    expect(counters(s, diver, '+1/+1')).toBe(1);
    expect(handSize(s, 'p1')).toBe(h + 1);
  });
  it('negative: casting a spell from the hand does not trigger it', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Tide Diver'], hand: ['Test Echo Rite'] } } });
    const diver = onBf(s0, 'p1', 'Test Tide Diver')[0]!;
    const h = handSize(s0, 'p1');
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Rite', 'hand', 'p1') }));
    expect(counters(s, diver, '+1/+1')).toBe(0);
    expect(handSize(s, 'p1')).toBe(h - 1);
  });
  it('CR 602.2: activating an ability of a card in the graveyard (exiling it from there) triggers it too', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Tide Diver'], graveyard: ['Test Grave Walker'] } } });
    const diver = onBf(s0, 'p1', 'Test Tide Diver')[0]!;
    const walker = s0.zones.graveyard['p1']!.find((id) => s0.objects[id]!.defId === 'Test Grave Walker')!;
    const s = settleAll(act(s0, { type: 'activate', player: 'p1', source: walker, ability: 'p:0:0' } as never));
    expect(counters(s, diver, '+1/+1')).toBe(1);
  });
});

describe('CR 508.1, 603.2c: "Whenever two or more creatures attack, ..."', () => {
  const DAIS = card('Test Oil Dais', 'Artifact', 'Whenever two or more creatures attack, put an oil counter on ~.');
  const RAIDER = card('Test Raider', 'Creature — Human', '', ['2', '2']);
  const defs = [DAIS, RAIDER];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Oil Dais', 'Test Raider', 'Test Raider'] } } });
  it('is automated', () => expect(full(DAIS)).toBe(true));
  it('two attackers put an oil counter (one trigger for the declaration)', () => {
    const s0 = start();
    const dais = onBf(s0, 'p1', 'Test Oil Dais')[0]!;
    const s = settleAll(attackWith(s0, onBf(s0, 'p1', 'Test Raider')));
    expect(counters(s, dais, 'oil')).toBe(1);
  });
  it('negative: one attacker is not enough', () => {
    const s0 = start();
    const dais = onBf(s0, 'p1', 'Test Oil Dais')[0]!;
    const s = settleAll(attackWith(s0, [onBf(s0, 'p1', 'Test Raider')[0]!]));
    expect(counters(s, dais, 'oil')).toBe(0);
  });
});

describe('CR 701.24a, 701.55a, 608.2d: "Target creature\'s owner shuffles it into their library, then faces a villainous choice -- They lose 5 life, or they shuffle another creature they own into their library."', () => {
  const END = card('Test Final Hour', 'Instant', "Target creature's owner shuffles it into their library, then faces a villainous choice -- They lose 5 life, or they shuffle another creature they own into their library.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
  const defs = [END, BEAR, OGRE];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Final Hour'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } } });
  const cast = (s0: GameState): GameState => answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Final Hour', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [obj(onBf(s0, 'p2', 'Test Bear')[0]!)] });
  const inLibrary = (s: GameState, p: string, defId: string): boolean => s.zones.library[p]!.some((id) => s.objects[id]!.defId === defId);
  it('is automated', () => expect(full(END)).toBe(true));
  it('the owner shuffles the target away, then chooses the first option: they lose 5 life and keep their other creature', () => {
    const s0 = start();
    const s = resolveAllWith(cast(s0), { yes: true });
    expect(inLibrary(s, 'p2', 'Test Bear')).toBe(true);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 5);
    expect(onBf(s, 'p2', 'Test Ogre').length).toBe(1);
  });
  it('the owner chooses the second option: no life is lost and their other creature is shuffled into their library', () => {
    const s0 = start();
    const s = resolveAllWith(cast(s0), { yes: false });
    expect(inLibrary(s, 'p2', 'Test Bear')).toBe(true);
    expect(inLibrary(s, 'p2', 'Test Ogre')).toBe(true);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
  });
  it('negative: the caster does not choose, and the target creature itself is not an "another creature" choice', () => {
    const s0 = start();
    const seen: string[] = [];
    let s = cast(s0);
    for (let i = 0; i < 12 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      if (s.pending.kind === 'priority') { s = mpass(s); continue; }
      seen.push(`${s.pending.player}:${s.pending.kind}`);
      s = settle(s, { yes: false });
    }
    expect(seen.some((x) => x.startsWith('p2:yesNo'))).toBe(true);
    expect(seen.some((x) => x.startsWith('p1:yesNo'))).toBe(false);
  });
});
function resolveAllWith(s0: GameState, p: { yes: boolean }): GameState {
  let s = settle(s0, p);
  for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = settle(mpass(s), p);
  return s;
}

describe('CR 611.2c, 903.3: "Gain control of each noncommander creature with mana value 3 or less."', () => {
  const HOBBIT = mcard('Test Subjugation', '{0}', 'Sorcery', 'Gain control of each noncommander creature with mana value 3 or less.');
  const SMALL = mcard('Test Small Bear', '{2}', 'Creature — Bear', '', ['2', '2']);
  const BIG = mcard('Test Big Ogre', '{5}', 'Creature — Ogre', '', ['5', '5']);
  const CHIEF = legend('Test Foe Chief', '{1}{R}', ['2', '2'], ['R']);
  const setup = (): GameState => commanderOnBattlefield(commanderScenario({
    p1Commanders: [legend('Test Own Chief', '{1}{G}', ['2', '2'], ['G'])], p2Commanders: [CHIEF], defs: [HOBBIT, SMALL, BIG],
    p1: { hand: ['Test Subjugation'] }, p2: { battlefield: ['Test Small Bear', 'Test Big Ogre', 'Test Foe Chief'] },
  }), 'Test Foe Chief');
  const ctrl = (s: GameState, name: string): string => s.objects[s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!]!.controller;
  it('is automated', () => expect(full(HOBBIT)).toBe(true));
  it('takes the small creature, leaves the mana value 5 creature and the commander with its owner', () => {
    const s0 = setup();
    const s = settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Subjugation', 'hand', 'p1') }));
    expect(ctrl(s, 'Test Small Bear')).toBe('p1');
    expect(ctrl(s, 'Test Big Ogre')).toBe('p2');
    expect(ctrl(s, 'Test Foe Chief')).toBe('p2');
  });
});

describe('CR 205.3i, 305.1, 404.1: "You may play Desert lands from your graveyard." (the lands of one subtype only)', () => {
  const LORD = card('Test Dune Lord', 'Creature — Human', 'You may play Desert lands from your graveyard.', ['2', '2']);
  const DUNE = card('Test Dune', 'Land — Desert', '');
  const HILL = card('Test Hill', 'Land — Mountain', '');
  const defs = [LORD, DUNE, HILL];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Dune Lord'], graveyard: ['Test Dune', 'Test Hill'] } } });
  const playable = (s: GameState, name: string): boolean => applyAction(s, { type: 'playLand', player: 'p1', card: find(s, name, 'graveyard', 'p1') }).error === undefined;
  it('is automated', () => expect(full(LORD)).toBe(true));
  it('the Desert in the graveyard can be played', () => expect(playable(start(), 'Test Dune')).toBe(true));
  it('negative: a land that is not a Desert cannot be played from the graveyard', () => expect(playable(start(), 'Test Hill')).toBe(false));
});
